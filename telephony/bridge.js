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

const { sttTranscribe, ttsSpeak, ttsCachedLine } = require('../lib/sarvam');
const { brainChat } = require('../lib/brain');
const { parseTag, applyRegister, ttsPhonetics, nextPersonaLang, formatReminder } = require('../lib/textpost');
const { spokenNumbers } = require('../lib/numbers');
const { buildSystemPrompt, greetingFor, college } = require('../agent/persona');
const { summarize } = require('../lib/callsummary');
const crm = require('../lib/crm');
const scheduler = require('../lib/scheduler');
const dnc = require('../lib/dnc');
const leadsStore = require('../lib/leads'); // shared, hot-reloading lead store (M2/M3)
const { alertTeam, isTransferRequest } = require('../lib/alerts'); // M5 alerts + live-transfer detection
const besttime = require('../lib/besttime'); // dial-outcome analytics + smart retry slots

// callSid -> live CallSession, so out-of-band webhooks (voicemail AMD, transfer) can reach
// the right in-flight call.
const sessionsByCallSid = new Map();

// Update a live Twilio call with new TwiML (used to hang up on voicemail, or dial a human).
async function twilioUpdateCall(callSid, twiml) {
  if (!SID || !TOKEN || !callSid) return { ok: false, reason: 'missing creds/callSid' };
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Calls/${callSid}.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ Twiml: twiml }),
  });
  return { ok: r.ok, reason: r.ok ? '' : `twilio ${r.status}` };
}

// Idle/silence handling (competitor-parity): gently re-prompt a quiet caller, then let go warmly.
const IDLE_LINES = {
  'te-IN': { first: 'హలో, వినిపిస్తోందా అండి?', second: 'ఒక్క నిమిషం ఆగుతా అండి, మీరు చెప్పండి.', bye: 'సరే అండి, తర్వాత మాట్లాడదాం. మీ అబ్బాయికి మంచి జరగాలి, ఉంటాను అండి!' },
  'hi-IN': { first: 'हैलो, आप सुन रहे हैं जी?', second: 'मैं एक पल रुकती हूँ, आप बताइए।', bye: 'ठीक है जी, फिर बात करते हैं। आपका दिन शुभ हो!' },
  'en-IN': { first: 'Hello, are you still there?', second: 'I will wait just a moment — please go ahead.', bye: 'No problem, we will talk later. You take care!' },
};

// Short courtesy lines for a live transfer (NOT persona scripts — one-line handoffs, per language).
const TRANSFER_LINE = {
  'te-IN': 'ఒక్క నిమిషం అండి, మా సీనియర్ కౌన్సెలర్ కి కనెక్ట్ చేస్తున్నా — వాళ్ళు మీకు హెల్ప్ చేస్తారు.',
  'hi-IN': 'एक मिनट जी, मैं आपको हमारे सीनियर काउंसलर से कनेक्ट कर रही हूँ — वो आपकी पूरी मदद करेंगे।',
  'en-IN': 'One moment — I am connecting you to our senior counselor who will help you further.',
};

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
  constructor(ws, lead, opts = {}) {
    this.ws = ws;
    this.lead = lead;
    this.inbound = !!opts.inbound; // M3: parent called US
    this.streamSid = null;
    this.personaLang = 'en-IN'; // English-first opening; mirrors the caller from turn one
    this.langCommitted = false; // first switch is instant; hysteresis (2 turns) only after
    this.streak = { lang: null, count: 0 };
    this.messages = [{ role: 'system', content: buildSystemPrompt(lead, this.personaLang) }];
    this.lastLang = 'en-IN';
    this.pcm = []; // Int16Array frames while user speaks
    this.speaking = false;
    this.speechMs = 0;
    this.silentMs = 0;
    this.busy = false; // pipeline in flight
    this.sending = false; // agent audio going out (for barge-in)
    this.callSid = null;
    this.isVoicemail = false; // AMD flagged an answering machine — stop, don't pitch to a recording
    this.transferred = false; // handed to a human — stop the agent pipeline
    this.lastActiveAt = Date.now(); // last time the caller spoke OR the agent finished speaking
    this.idleCount = 0; // consecutive silence prompts (3 = give up gracefully)
    this.handlingIdle = false;
  }

  get stopped() { return this.isVoicemail || this.transferred; }

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
    const ttsText = spokenNumbers(ttsPhonetics(text, lang), lang); // numbers → natural speech
    const opts = { sampleRate: 8000, codec: 'mulaw' };
    // G5 cost goal: short lines (all verbatim playbook scripts) are disk-cached —
    // an identical line spoken on any later call costs ₹0. Same voice, zero quality change.
    const audios = ttsText.length <= 200
      ? (await ttsCachedLine(ttsText, lang, emotion, opts)).audios
      : await ttsSpeak(ttsText, lang, emotion, opts);
    for (const a of audios) this.sendAudio(toRawMulaw(a));
  }

  async onStart(msg) {
    this.streamSid = msg.start.streamSid;
    this.callSid = msg.start.callSid;
    if (this.callSid) sessionsByCallSid.set(this.callSid, this); // for voicemail/transfer webhooks
    if (!this.inbound) besttime.logDial('connected'); // the stream opened → the call was answered
    const greeting = greetingFor(this.lead, { inbound: this.inbound });
    this.lastLang = greeting.lang;
    this.messages.push({ role: 'assistant', content: greeting.text });
    // Deterministic greeting — cached audio (free win #3): the caller hears Sneha
    // ~1-2s sooner on every call after the first for this lead.
    const ttsText = spokenNumbers(ttsPhonetics(greeting.text, greeting.lang), greeting.lang);
    const { audios } = await ttsCachedLine(ttsText, greeting.lang, greeting.emotion, { sampleRate: 8000, codec: 'mulaw' });
    for (const a of audios) this.sendAudio(toRawMulaw(a));
  }

  onMedia(payloadB64) {
    if (this.stopped) return; // voicemail or transferred — ignore inbound audio
    const pcm = mulawToPcm(Buffer.from(payloadB64, 'base64'));
    const frameMs = (pcm.length / 8000) * 1000; // Twilio sends 20ms frames
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) sum += Math.abs(pcm[i]);
    const level = sum / pcm.length;

    // Tunable for noisy lines / speakerphone echo (premortem N4):
    const VAD_LEVEL = Number(process.env.BRIDGE_VAD_LEVEL) || 600;
    const MIN_SPEECH = Number(process.env.BRIDGE_MIN_SPEECH_MS) || 250;
    // While the agent is speaking, demand sustained speech (~400ms) before barging in,
    // so line echo or a cough doesn't cut her off mid-sentence.
    const startAt = this.sending ? Math.max(400, MIN_SPEECH) : MIN_SPEECH;

    if (level > VAD_LEVEL) {
      this.speechMs += frameMs;
      this.silentMs = 0;
      if (!this.speaking && this.speechMs > startAt) {
        this.speaking = true;
        this.idleCount = 0; // caller is engaged again — reset the silence counter
        this.bargeIn(); // caller genuinely talked over the agent — stop agent audio
      }
    } else {
      this.silentMs += frameMs;
      this.speechMs = 0;
    }

    // Idle/silence handling: it's the caller's turn (agent finished, pipeline free) but
    // they've gone quiet for too long — gently re-prompt, then let go after a few tries.
    const IDLE_MS = Number(process.env.IDLE_MS) || 9000;
    if (!this.busy && !this.sending && !this.speaking && !this.handlingIdle && !this.stopped
        && Date.now() - this.lastActiveAt > IDLE_MS) {
      this.handlingIdle = true;
      this.onIdle().catch((e) => console.error('idle failed:', e.message)).finally(() => { this.handlingIdle = false; });
    }
    if (this.speaking) this.pcm.push(pcm);

    const total = this.pcm.reduce((n, f) => n + f.length, 0) / 8; // ms
    // Phone audio is 8 kHz and callers pause mid-sentence; 800 ms cut utterances into
    // fragments ("Capstone") that STT then misheard. 1300 ms captures whole sentences.
    if (this.speaking && !this.busy && (this.silentMs > (Number(process.env.PHONE_ENDPOINT_MS) || 1300) || total > 15000)) {
      const frames = this.pcm;
      this.pcm = [];
      this.speaking = false;
      this.turn(frames).catch((e) => console.error('turn failed:', e.message));
    }
  }

  async turn(frames) {
    if (this.stopped) return;
    this.busy = true;
    try {
      const merged = new Int16Array(frames.reduce((n, f) => n + f.length, 0));
      let off = 0;
      for (const f of frames) { merged.set(f, off); off += f.length; }
      // MUST stay 'unknown': Sarvam treats any other value as a hard instruction to
      // decode in that language (auto-detect OFF), not a soft hint — passing the lead's
      // language here silently prevented the caller from ever being detected in a
      // different language, breaking live mirroring. Always auto-detect on the phone too.
      const stt = await sttTranscribe(pcmToWav(merged), 'unknown');
      const userText = (stt.transcript || '').trim();
      if (!userText) return;
      this.idleCount = 0; // a real turn — the caller is engaged
      console.log(`[caller] ${userText}`);
      this.messages.push({ role: 'user', content: userText });
      // DNC: if the parent asks not to be called again, honor it — suppress the number so
      // no future dial reaches it. The persona still replies politely on this turn.
      if (dnc.isDncRequest(userText) && dnc.add(this.lead.phone, 'said do-not-call on call')) {
        console.log(`[bridge] DNC: ${this.lead.phone} added — will not be dialled again`);
      }
      // LIVE TRANSFER: parent explicitly asked for a human — hand off warmly, don't argue.
      if (isTransferRequest(userText)) { await this.transferToHuman(); return; }
      // Mirror the caller's language. The FIRST switch is instant (threshold 1) so a
      // Telugu/Hindi parent is answered in their language from the very first substantive
      // turn; AFTER that we apply hysteresis (2 consecutive turns) so a single 8 kHz
      // mishear can never ping-pong the language mid-call. Web keeps its own default.
      const threshold = Number(process.env.LANG_SWITCH_TURNS) || (this.langCommitted ? 2 : 1);
      if (nextPersonaLang(this, stt.language_code || '', threshold)) {
        this.langCommitted = true;
        this.messages[0].content = buildSystemPrompt(this.lead, this.personaLang);
        console.log(`[bridge] persona switched to ${this.personaLang}`);
      }

      // history window + language-aware reminder — identical to the web server
      // Same language-routed brain as the web server: English -> Groq, te/hi -> Sarvam.
      const { text: raw } = await brainChat([this.messages[0], ...this.messages.slice(1).slice(-12), formatReminder(this.personaLang)], this.personaLang);
      this.messages.push({ role: 'assistant', content: raw });
      // shared parsing/register pass; each reply voiced in its own language model
      const parsed = parseTag(raw, this.lastLang);
      const text = applyRegister(parsed.text, this.lead);

      this.lastLang = parsed.lang;
      console.log(`[agent] ${text}`);
      await this.speak(text, parsed.lang, parsed.emotion);
    } finally {
      this.busy = false;
    }
  }

  // Agent finished speaking (Twilio played our marked audio) — the caller's turn starts now,
  // so reset the idle clock from this moment.
  onMarkDone() { this.sending = false; this.lastActiveAt = Date.now(); }

  // Caller went quiet on their turn: prompt once, twice, then let go warmly on the third.
  async onIdle() {
    if (this.busy || this.stopped) return;
    this.idleCount += 1;
    const L = IDLE_LINES[this.personaLang] || IDLE_LINES['en-IN'];
    if (this.idleCount >= 3) {
      console.log(`[bridge] caller idle x3 — ending call warmly (${this.lead.parentName})`);
      await this.speak(L.bye, this.personaLang, 'warm');
      await twilioUpdateCall(this.callSid, '<Response><Hangup/></Response>').catch(() => {});
    } else {
      console.log(`[bridge] caller idle (${this.idleCount}) — gentle re-prompt`);
      await this.speak(this.idleCount === 1 ? L.first : L.second, this.personaLang, 'warm');
      this.lastActiveAt = Date.now(); // restart the idle clock after prompting
    }
  }

  // VOICEMAIL (Twilio AMD flagged an answering machine): don't waste a full pitch + minutes
  // on a recording. Hang up immediately and queue a retry the same way a missed call is.
  async onVoicemail() {
    if (this.stopped) return;
    this.isVoicemail = true;
    besttime.logDial('voicemail');
    console.log(`[bridge] voicemail detected for ${this.lead.parentName} — hanging up (no pitch to a recording)`);
    await twilioUpdateCall(this.callSid, '<Response><Hangup/></Response>').catch(() => {});
    // finalize() (fired on the resulting stop) sees isVoicemail and queues the retry.
  }

  // LIVE TRANSFER to a human counselor. Announce briefly in the parent's language, fire the
  // context alert so the counselor answers informed, then bridge the call to them. If no
  // counselor line is configured, promise a fast callback and queue it (graceful fallback).
  async transferToHuman() {
    if (this.transferred) return;
    this.transferred = true;
    const counselor = process.env.COUNSELOR_PHONE || '';
    const line = TRANSFER_LINE[this.personaLang] || TRANSFER_LINE['en-IN'];
    if (/^\+\d{10,15}$/.test(counselor) && this.callSid) {
      try { await alertTeam(this.lead, { interest: 'hot', summary: 'Parent asked to speak to a human — LIVE transfer in progress.', nextAction: 'Answer the transferred call now.', objections: [], appointment: { booked: false } }, 'phone-transfer'); } catch {}
      await this.speak(line, this.personaLang, 'reassuring');
      const r = await twilioUpdateCall(this.callSid, `<Response><Dial callerId="${FROM}"><Number>${counselor}</Number></Dial></Response>`);
      console.log(r.ok ? `[bridge] LIVE-transferred ${this.lead.parentName} → counselor ${counselor}` : `[bridge] transfer failed (${r.reason}) — queuing callback`);
      if (!r.ok) this.transferred = false; // let the fallback below run next time if it failed
      if (r.ok) return;
    }
    // Fallback: no counselor number (placeholder) or transfer failed → promise a callback.
    const cb = {
      'te-IN': 'అలాగే అండి, మా సీనియర్ కౌన్సెలర్ మిమ్మల్ని కొద్ది సేపట్లో కాల్ చేస్తారు, తప్పకుండా.',
      'hi-IN': 'ज़रूर जी, हमारे सीनियर काउंसलर आपको थोड़ी ही देर में कॉल करेंगे।',
      'en-IN': 'Of course — our senior counselor will call you back very shortly.',
    };
    await this.speak(cb[this.personaLang] || cb['en-IN'], this.personaLang, 'reassuring').catch(() => {});
    scheduler.schedule({ leadId: this.lead.id, parent: this.lead.parentName, phone: this.lead.phone, student: this.lead.studentName,
      type: 'human_callback', dueAt: new Date().toISOString(), channel: 'call',
      message: `URGENT: ${this.lead.parentName} asked for a human on the call — call back ASAP (no live counselor line was configured).` });
  }

  // Called when Twilio ends the stream — same outcome pipeline as the web server (audit H1):
  // summarise -> CRM lead -> schedule follow-ups. Runs once.
  async finalize() {
    if (this.finalized) return;
    this.finalized = true;
    try {
      // Missed-call follow-up (owner rule 2026-07-06): if the call produced NO
      // conversation (nobody spoke — didn't pick up, hung up on the greeting), don't
      // summarize air. Route by prior engagement: known/engaged family → WhatsApp/SMS
      // message; never-engaged lead → retry voice call later.
      const userTurns = this.messages.filter((m) => m.role === 'user').length;
      // Voicemail counts as "no real conversation" even if the recording's greeting got
      // transcribed as a user turn — route it to a retry, never summarize a machine.
      if (!userTurns || this.isVoicemail) {
        const rec = crm.get(this.lead.id);
        const engaged = !!(rec && rec.calls > 0);
        const base = { leadId: this.lead.id, parent: this.lead.parentName, phone: this.lead.phone, student: this.lead.studentName };
        if (engaged) {
          scheduler.schedule({ ...base, type: 'missed_call_message', dueAt: new Date(Date.now() + 10 * 60000).toISOString(), channel: 'whatsapp',
            message: `Namaste ${this.lead.parentName}, this is ${college.agentName} from ${college.name} — we tried to reach you about ${this.lead.studentName}. Reply here, or we will call again at a better time.` });
        } else {
          scheduler.schedule({ ...base, type: 'missed_call_retry', dueAt: new Date(Date.now() + 4 * 3600000).toISOString(), channel: 'call',
            message: `Retry call: ${this.lead.parentName} (${this.lead.studentName}) did not answer / did not speak.` });
        }
        console.log(`[bridge] ${this.isVoicemail ? 'voicemail' : 'no conversation'} — ${engaged ? 'WhatsApp/SMS follow-up queued' : 'voice retry queued'} for ${this.lead.parentName}`);
        return;
      }

      const summary = await summarize(this.messages, college.agentName);
      crm.upsertLead(this.lead, summary);
      scheduler.fromCall(this.lead, summary);
      try { await alertTeam(this.lead, summary, 'phone'); } catch (e) { console.error('[alert] failed:', e.message); }
      // Call Recorder / Compliance Logger: persist the full phone transcript (the web
      // server already saves web-call transcripts; the phone path previously did not).
      try {
        const dir = path.join(__dirname, '..', 'data', 'transcripts');
        fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = path.join(dir, `${this.lead.id}-${stamp}.json`);
        fs.writeFileSync(file, JSON.stringify({
          channel: 'phone', endedAt: new Date().toISOString(),
          lead: this.lead, agent: college.agentName, personaLang: this.personaLang,
          summary, messages: this.messages,
        }, null, 2));
      } catch (e) { console.error('[bridge] transcript save failed:', e.message); }
      // D1 (owner decision): every unknown-number inbound call gets flagged to the human
      // team after the call — it may be a new enquiry OR an existing parent on a new number.
      if (String(this.lead.id).startsWith('L-INB')) {
        scheduler.schedule({
          leadId: this.lead.id, parent: this.lead.parentName, phone: this.lead.phone, student: this.lead.studentName,
          type: 'human_review_inbound', dueAt: new Date().toISOString(), channel: 'call',
          message: `REVIEW: unknown number ${this.lead.phone} called in. Summary: ${summary.summary} — match to an existing family or create the enquiry.`,
        });
        console.log(`[bridge] unknown inbound ${this.lead.phone} flagged for human review`);
      }
      console.log(`[bridge] call finalized for ${this.lead.parentName} · interest ${summary.interest}` + (summary.appointment.booked ? ` · visit ${summary.appointment.when}` : ''));
    } catch (e) {
      console.error('[bridge] finalize failed:', e.message);
    }
  }
}

// ---------- HTTP: /dial + /incoming + /call-status + health ----------
const parseForm = (raw) => Object.fromEntries(new URLSearchParams(raw));

// Missed-dial follow-up shared by /call-status (never connected) — same owner rule as
// finalize: engaged family → WhatsApp/SMS; never-engaged → retry voice call.
function scheduleMissed(lead) {
  const rec = crm.get(lead.id);
  const engaged = !!(rec && rec.calls > 0);
  const base = { leadId: lead.id, parent: lead.parentName, phone: lead.phone, student: lead.studentName };
  if (engaged) {
    scheduler.schedule({ ...base, type: 'missed_call_message', dueAt: new Date(Date.now() + 10 * 60000).toISOString(), channel: 'whatsapp',
      message: `Namaste ${lead.parentName}, this is ${college.agentName} from ${college.name} — we tried to reach you about ${lead.studentName}. Reply here, or we will call again at a better time.` });
  } else {
    // Smart retry: schedule the retry at the next high-connect-rate hour, not a blind +4h.
    scheduler.schedule({ ...base, type: 'missed_call_retry', dueAt: besttime.nextGoodSlot(), channel: 'call',
      message: `Retry call: ${lead.parentName} (${lead.studentName}) — no answer.` });
  }
  console.log(`[bridge] missed dial — ${engaged ? 'message' : 'voice retry'} queued for ${lead.parentName}`);
}

const server = http.createServer((req, res) => {
  // M3: INBOUND — Twilio hits this webhook when someone calls OUR number. We answer with
  // TwiML that opens the media stream, tagging the caller's number so the session can
  // recognize a known family (M1 memory) or run warm discovery for an unknown one (D1).
  if (req.method === 'POST' && req.url.startsWith('/incoming')) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const form = parseForm(raw);
      const from = form.From || '';
      console.log(`[bridge] INBOUND call from ${from || 'unknown'}`);
      const wss = PUBLIC_URL.replace(/^http/, 'ws') + '/media?inbound=1&from=' + encodeURIComponent(from);
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<Response><Connect><Stream url="${wss}"/></Connect></Response>`);
    });
    return;
  }

  // Voicemail (AMD) callback: Twilio reports human vs machine here, asynchronously, while
  // the media stream is already live. On a machine, tell the matching session to hang up.
  if (req.method === 'POST' && req.url.startsWith('/amd')) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const form = parseForm(raw);
      const answeredBy = (form.AnsweredBy || '').toLowerCase(); // human | machine_start | machine_end_* | fax | unknown
      const s = sessionsByCallSid.get(form.CallSid);
      if (s && /machine|fax/.test(answeredBy)) s.onVoicemail().catch((e) => console.error('[amd]', e.message));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    return;
  }

  // Missed-dial callback: Twilio reports outbound calls that never connected
  // (no-answer / busy / failed) — the media stream never opens for those, so the
  // follow-up must be queued here.
  if (req.method === 'POST' && req.url.startsWith('/call-status')) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const form = parseForm(raw);
      const status = (form.CallStatus || '').toLowerCase();
      const leadId = new URL(req.url, 'http://x').searchParams.get('leadId');
      const lead = leadsStore.byId(leadId);
      if (['no-answer', 'busy', 'failed', 'canceled'].includes(status)) {
        besttime.logDial('no_answer');
        if (lead) scheduleMissed(lead);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/dial') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}');
        // Shared-secret gate: /dial spends YOUR Twilio money and rings REAL phones — it must
        // never be open on a public tunnel. Same ACCESS_SECRET as the web server; pass it as
        // {"key": "..."} in the dial body. No secret configured = localhost-dev only mindset.
        const SECRET = process.env.ACCESS_SECRET || '';
        if (SECRET && body.key !== SECRET) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Unauthorized — include the access key' }));
        }
        const lead = leadsStore.byId(body.leadId) || leadsStore.all()[0];
        if (!SID || !TOKEN || !FROM || !PUBLIC_URL) throw new Error('Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, PUBLIC_URL in .env');
        if (!body.to) throw new Error('Provide "to": "+91..." (E.164)');
        if (dnc.has(body.to)) throw new Error(`${body.to} is on the Do-Not-Call list — refusing to dial`);
        const wss = PUBLIC_URL.replace(/^http/, 'ws') + '/media?leadId=' + encodeURIComponent(lead.id);
        const twiml = `<Response><Connect><Stream url="${wss}"/></Connect></Response>`;
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Calls.json`, {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: body.to, From: FROM, Twiml: twiml,
            // Missed-dial detection: Twilio reports the final call status here so
            // unanswered calls get their follow-up queued (they never open the stream).
            StatusCallback: `${PUBLIC_URL}/call-status?leadId=${encodeURIComponent(lead.id)}`,
            StatusCallbackEvent: 'completed',
            // Voicemail detection (competitor-parity upgrade): Twilio's async answering-
            // machine detection runs alongside the media stream and reports human vs machine
            // to /amd — on a machine we hang up instead of pitching to a recording.
            MachineDetection: 'Enable',
            AsyncAmdStatusCallback: `${PUBLIC_URL}/amd`,
            AsyncAmdStatusCallbackMethod: 'POST',
          }),
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
  const params = new URL(req.url, 'http://x').searchParams;
  const inbound = params.get('inbound') === '1';
  let lead;
  if (inbound) {
    // M3: recognize the caller by number (M1 memory kicks in for known families);
    // unknown number → provisional lead + warm-discovery persona block (D1).
    const from = params.get('from') || '';
    lead = leadsStore.findByPhone(from);
    if (!lead) {
      lead = {
        id: 'L-INB-' + Date.now().toString(36),
        parentName: 'there', // greeting says "How can I help you?" — no name assumed
        studentName: 'your child', gender: 'male', language: 'te',
        area: '', tenthResult: '', interest: 'to be discovered',
        source: 'inbound call from unknown number', phone: from || 'unknown',
      };
    }
  } else {
    lead = leadsStore.byId(params.get('leadId')) || leadsStore.all()[0];
  }
  const session = new CallSession(ws, lead, { inbound });
  console.log(`media stream connected ${inbound ? '[INBOUND]' : ''} for ${lead.id} (${lead.parentName}, ${lead.phone})`);
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.event === 'start') session.onStart(msg).catch((e) => console.error(e.message));
    else if (msg.event === 'media') session.onMedia(msg.media.payload);
    else if (msg.event === 'mark') session.onMarkDone();
    else if (msg.event === 'stop') { console.log('call ended by Twilio'); session.finalize(); if (session.callSid) sessionsByCallSid.delete(session.callSid); }
  });
  ws.on('close', () => { if (session.callSid) sessionsByCallSid.delete(session.callSid); });
});

server.listen(PORT, () => console.log(`Telephony bridge -> http://localhost:${PORT}  (POST /dial)`));
