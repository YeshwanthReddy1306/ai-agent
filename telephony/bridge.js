// PHASE 2 — Twilio Media Streams <-> Sarvam bridge for REAL phone calls.
// STATUS: code-complete but UNTESTED until Twilio credentials are available.
// The brain (persona + pipeline) is identical to the web console; only the
// transport differs: 8 kHz mulaw frames over a WebSocket instead of browser WAV.
//
// Setup:
//   npm i ws                       (the only dependency, telephony-only)
//   ngrok http 3200                (or any public HTTPS/WSS tunnel)
//   .env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, PUBLIC_URL
//   node telephony/bridge.js
//   curl -X POST localhost:3200/dial -H "Content-Type: application/json" \
//        -d '{"leadId":"L-1001","to":"+91XXXXXXXXXX"}'
const http = require('http');
const fs = require('fs');
const path = require('path');

// .env (shared with the main server)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

let WebSocketServer;
try {
  ({ WebSocketServer } = require('ws'));
} catch {
  console.error('telephony needs the ws package: run  npm i ws');
  process.exit(1);
}

const { sttTranscribe, llmChat, ttsSpeak } = require('../lib/sarvam');
const { buildSystemPrompt, greetingFor } = require('../agent/persona');
const leads = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'leads.json'), 'utf8'));

const PORT = Number(process.env.TELEPHONY_PORT) || 3200;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, ''); // e.g. https://abc.ngrok.app
const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM = process.env.TWILIO_FROM_NUMBER;

// ---------- mulaw <-> PCM16 ----------
const MULAW_DECODE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  let t = (((u & 0x0f) << 3) + 0x84) << ((u & 0x70) >> 4);
  MULAW_DECODE[i] = (u & 0x80 ? 0x84 - t : t - 0x84);
}
const mulawToPcm = (buf) => {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = MULAW_DECODE[buf[i]];
  return out;
};

// PCM16 mono 8k -> WAV buffer for Sarvam STT
function pcmToWav(pcm, rate = 8000) {
  const buf = Buffer.alloc(44 + pcm.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + pcm.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
  return buf;
}

// Sarvam TTS with codec=mulaw may return a WAV container — strip to raw mulaw if so.
function toRawMulaw(b64) {
  let buf = Buffer.from(b64, 'base64');
  if (buf.slice(0, 4).toString() === 'RIFF') {
    const idx = buf.indexOf('data');
    if (idx > 0) buf = buf.slice(idx + 8);
  }
  return buf;
}

// ---------- per-call session over one Twilio media stream ----------
class CallSession {
  constructor(ws, lead) {
    this.ws = ws;
    this.lead = lead;
    this.streamSid = null;
    this.messages = [{ role: 'system', content: buildSystemPrompt(lead) }];
    this.lastLang = 'en-IN';
    this.pcm = []; // Int16Array frames while user speaks
    this.speaking = false;
    this.speechMs = 0;
    this.silentMs = 0;
    this.busy = false; // pipeline in flight
    this.sending = false; // agent audio going out (for barge-in)
  }

  sendAudio(mulawBuf) {
    this.sending = true;
    // 100ms chunks (800 bytes at 8kHz mulaw) pace closely enough for Twilio's jitter buffer
    for (let i = 0; i < mulawBuf.length; i += 800) {
      this.ws.send(JSON.stringify({
        event: 'media', streamSid: this.streamSid,
        media: { payload: mulawBuf.slice(i, i + 800).toString('base64') },
      }));
    }
    this.ws.send(JSON.stringify({ event: 'mark', streamSid: this.streamSid, mark: { name: 'done' } }));
  }

  bargeIn() {
    if (!this.sending) return;
    this.ws.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
    this.sending = false;
  }

  async speak(text, lang, emotion) {
    const audios = await ttsSpeak(text, lang, emotion, { sampleRate: 8000, codec: 'mulaw' });
    for (const a of audios) this.sendAudio(toRawMulaw(a));
  }

  async onStart(msg) {
    this.streamSid = msg.start.streamSid;
    const greeting = greetingFor(this.lead);
    this.lastLang = greeting.lang;
    this.messages.push({ role: 'assistant', content: greeting.text });
    await this.speak(greeting.text, greeting.lang, greeting.emotion);
  }

  onMedia(payloadB64) {
    const pcm = mulawToPcm(Buffer.from(payloadB64, 'base64'));
    const frameMs = (pcm.length / 8000) * 1000; // Twilio sends 20ms frames
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) sum += Math.abs(pcm[i]);
    const level = sum / pcm.length;

    if (level > 500) {
      this.speechMs += frameMs;
      this.silentMs = 0;
      if (!this.speaking && this.speechMs > 200) {
        this.speaking = true;
        this.bargeIn(); // caller talked over the agent — stop agent audio
      }
    } else {
      this.silentMs += frameMs;
      this.speechMs = 0;
    }
    if (this.speaking) this.pcm.push(pcm);

    const total = this.pcm.reduce((n, f) => n + f.length, 0) / 8; // ms
    if (this.speaking && !this.busy && (this.silentMs > 800 || total > 15000)) {
      const frames = this.pcm;
      this.pcm = [];
      this.speaking = false;
      this.turn(frames).catch((e) => console.error('turn failed:', e.message));
    }
  }

  async turn(frames) {
    this.busy = true;
    try {
      const merged = new Int16Array(frames.reduce((n, f) => n + f.length, 0));
      let off = 0;
      for (const f of frames) { merged.set(f, off); off += f.length; }
      const stt = await sttTranscribe(pcmToWav(merged));
      const userText = (stt.transcript || '').trim();
      if (!userText) return;
      console.log(`[caller] ${userText}`);
      this.messages.push({ role: 'user', content: userText });
      const { text: raw } = await llmChat(this.messages);
      this.messages.push({ role: 'assistant', content: raw });
      // reuse the same tag format as the web server
      const m = raw.match(/~~\s*([a-z]{2,3}-IN)\s*\|\s*([a-z]+)\s*~~\s*$/i);
      const lang = m ? m[1] : this.lastLang;
      const emotion = m ? m[2].toLowerCase() : 'warm';
      const text = (m ? raw.slice(0, m.index) : raw).replace(/[*_#`>~]+/g, '').trim();
      this.lastLang = lang;
      console.log(`[kavitha] ${text}`);
      await this.speak(text, lang, emotion);
    } finally {
      this.busy = false;
    }
  }
}

// ---------- HTTP: /dial + health ----------
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/dial') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}');
        const lead = leads.find((l) => l.id === body.leadId) || leads[0];
        if (!SID || !TOKEN || !FROM || !PUBLIC_URL) throw new Error('Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, PUBLIC_URL in .env');
        if (!body.to) throw new Error('Provide "to": "+91..." (E.164)');
        const wss = PUBLIC_URL.replace(/^http/, 'ws') + '/media?leadId=' + encodeURIComponent(lead.id);
        const twiml = `<Response><Connect><Stream url="${wss}"/></Connect></Response>`;
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Calls.json`, {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: body.to, From: FROM, Twiml: twiml }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.message || `Twilio ${r.status}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, callSid: j.sid, lead: lead.id }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'phoenix-telephony-bridge' }));
});

// ---------- WS: Twilio media stream ----------
const wss = new WebSocketServer({ server, path: '/media' });
wss.on('connection', (ws, req) => {
  const leadId = new URL(req.url, 'http://x').searchParams.get('leadId');
  const lead = leads.find((l) => l.id === leadId) || leads[0];
  const session = new CallSession(ws, lead);
  console.log(`media stream connected for lead ${lead.id} (${lead.parentName})`);
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.event === 'start') session.onStart(msg).catch((e) => console.error(e.message));
    else if (msg.event === 'media') session.onMedia(msg.media.payload);
    else if (msg.event === 'stop') console.log('call ended by Twilio');
  });
});

server.listen(PORT, () => console.log(`Telephony bridge -> http://localhost:${PORT}  (POST /dial)`));
