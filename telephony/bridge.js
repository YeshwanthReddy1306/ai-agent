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

const { sttTranscribe, ttsSpeak, ttsCachedLine, EMOTION_STYLE } = require('../lib/sarvam');
const { SttStream, brainChatStream, TtsStream } = require('../lib/sarvam-stream');
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
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');


const TwilioTransport = require('./transports/twilio');
const FrejunTransport = require('./transports/frejun');
const provider = process.env.TELEPHONY_PROVIDER === 'frejun' ? 'frejun' : 'twilio';



// PCM16 mono 8k -> WAV buffer for Sarvam STT

// Sarvam TTS may return a WAV/RIFF container — strip to raw audio payload regardless of codec.
function toRawAudio(b64) {
  let buf = Buffer.from(b64, 'base64');
  if (buf.slice(0, 4).toString() === 'RIFF') {
    const idx = buf.indexOf('data');
    if (idx > 0) buf = buf.slice(idx + 8);
  }
  return buf;
}
// Legacy alias used by Twilio transport
const toRawMulaw = toRawAudio;

// ---------- per-call session over one Twilio media stream ----------
class CallSession {
  constructor(transportCtx, lead, opts = {}) {
    this.transport = transportCtx;
    this.lead = lead;
    this.inbound = !!opts.inbound;
    this.personaLang = 'en-IN';
    this.langCommitted = false;
    this.streak = { lang: null, count: 0 };
    // Codec selection: FreJun expects raw PCM16 (linear16), Twilio expects mulaw
    this.ttsCodec = provider === 'frejun' ? 'linear16' : 'mulaw';
    this.messages = [{ role: 'system', content: buildSystemPrompt(lead, this.personaLang) }];
    this.lastLang = 'en-IN';
    this.lastEmotion = 'warm';
    this.speaking = false;
    this.busy = false;
    this.sending = false;
    this.callSid = null;
    this.isVoicemail = false;
    this.transferred = false;
    this.lastActiveAt = Date.now();
    this.idleCount = 0;
    this.handlingIdle = false;

    this.stt = new SttStream();
    this.sttTranscript = '';
    this.sttLang = 'unknown';
    this.fallbackTimer = null;
    this.setupStt();
  }

  setupStt() {
    this.stt.on('start_speech', () => {
      if (this.stopped) return;
      this.speaking = true;
      this.idleCount = 0;
      this.lastActiveAt = Date.now();
      if (this.sending) this.bargeIn();
    });
    this.stt.on('end_speech', () => {
      if (this.stopped) return;
      this.speaking = false;
      this.stt.flush();
      if (this.fallbackTimer) {
        clearTimeout(this.fallbackTimer);
        this.fallbackTimer = null;
      }
      this.triggerTurn();
    });
    this.stt.on('transcript', (data) => {
      if (data.transcript) {
        this.sttTranscript += ' ' + data.transcript;
      }
      if (data.language_code) {
        this.sttLang = data.language_code;
      }
    });
    this.stt.on('error', (err) => {
      console.error(`[bridge] STT WS error for ${this.lead.id}:`, err.message);
      // Fallback timer ensures we don't hang if this completely fails
    });
  }

  get stopped() { return this.isVoicemail || this.transferred; }

  sendAudio(mulawBuf) {
    this.sending = true;
    this.transport.sendAudio(mulawBuf);
  }

  sendAudioRawBase64(b64Payload) {
    this.sending = true;
    this.transport.sendAudioRawBase64(b64Payload);
  }

  

  bargeIn() {
    if (!this.sending) return;
    this.transport.clear();
    this.sending = false;
  }

  async speak(text, lang, emotion) {
    const ttsText = spokenNumbers(ttsPhonetics(text, lang), lang); // numbers → natural speech
    const opts = { sampleRate: 8000, codec: this.ttsCodec };
    // G5 cost goal: short lines (all verbatim playbook scripts) are disk-cached —
    // an identical line spoken on any later call costs ₹0. Same voice, zero quality change.
    const audios = ttsText.length <= 200
      ? (await ttsCachedLine(ttsText, lang, emotion, opts)).audios
      : await ttsSpeak(ttsText, lang, emotion, opts);
    if (this.ttsCodec === 'mulaw') {
      for (const a of audios) this.sendAudio(toRawAudio(a));
    } else {
      for (const a of audios) this.sendAudioRawBase64(a);
    }
  }

  async onStart(msg) {
    this.callSid = msg.callSid;
    if (this.callSid) sessionsByCallSid.set(this.callSid, this); // for voicemail/transfer webhooks
    if (!this.inbound) besttime.logDial('connected'); // the stream opened → the call was answered
    
    // Connect STT WS at start of call
    this.stt.connect();

    const greeting = greetingFor(this.lead, { inbound: this.inbound });
    this.lastLang = greeting.lang;
    this.lastEmotion = greeting.emotion;
    this.messages.push({ role: 'assistant', content: greeting.text });
    // Deterministic greeting — cached audio (free win #3): the caller hears Sneha
    // ~1-2s sooner on every call after the first for this lead.
    const ttsText = spokenNumbers(ttsPhonetics(greeting.text, greeting.lang), greeting.lang);
    const { audios } = await ttsCachedLine(ttsText, greeting.lang, greeting.emotion, { sampleRate: 8000, codec: this.ttsCodec });
    if (this.ttsCodec === 'mulaw') {
      for (const a of audios) this.sendAudio(toRawAudio(a));
    } else {
      for (const a of audios) this.sendAudioRawBase64(a);
    }
  }

  onMedia(pcm) {
    if (this.stopped) return;
    
    // Pipe all audio to STT stream directly
    this.stt.sendAudio(pcm);

    // We still track basic level for the 5s fallback safety timer
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) sum += Math.abs(pcm[i]);
    const level = sum / pcm.length;
    const VAD_LEVEL = Number(process.env.BRIDGE_VAD_LEVEL) || 600;

    if (level > VAD_LEVEL) {
      this.lastActiveAt = Date.now(); // reset idle clock
      // Start 5s fallback timer whenever we hear noise (safety amendment #1)
      if (!this.fallbackTimer && !this.busy) {
        this.fallbackTimer = setTimeout(() => {
          if (this.stopped || this.busy) return;
          console.log(`[bridge] 5s STT fallback triggered for ${this.lead.parentName} — WS didn't emit END_SPEECH`);
          this.speaking = false;
          this.stt.flush();
          this.fallbackTimer = null;
          this.triggerTurn();
        }, 5000);
      }
    }

    // Idle/silence handling: it's the caller's turn (agent finished, pipeline free) but
    // they've gone quiet for too long — gently re-prompt, then let go after a few tries.
    const IDLE_MS = Number(process.env.IDLE_MS) || 9000;
    if (!this.busy && !this.sending && !this.speaking && !this.handlingIdle && !this.stopped
        && Date.now() - this.lastActiveAt > IDLE_MS) {
      this.handlingIdle = true;
      this.onIdle().catch((e) => console.error('idle failed:', e.message)).finally(() => { this.handlingIdle = false; });
    }
  }

  // Triggered by END_SPEECH or the 5s fallback timer
  async triggerTurn() {
    if (this.stopped || this.busy) return;
    const text = this.sttTranscript.trim();
    const lang = this.sttLang;
    
    // Clear out for next turn
    this.sttTranscript = '';
    this.sttLang = 'unknown';

    // If STT stream yielded nothing, try batch fallback on the stored frames (omitted for pure stream approach, we rely on the transcript events)
    if (!text) {
      return; // Noise or empty
    }
    
    await this.turn(text, lang).catch((e) => console.error('turn failed:', e.message));
  }

  async turn(userText, detectedLang) {
    if (this.stopped) return;
    this.busy = true;
    try {
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
      if (nextPersonaLang(this, detectedLang || '', threshold)) {
        this.langCommitted = true;
        this.messages[0].content = buildSystemPrompt(this.lead, this.personaLang);
        console.log(`[bridge] persona switched to ${this.personaLang}`);
      }

      // history window + language-aware reminder — identical to the web server
      const HT = Number(process.env.HISTORY_TURNS) || 3;
      const chatMessages = [this.messages[0], ...this.messages.slice(1).slice(-HT), formatReminder(this.personaLang)];
      
      // Phase 2: Streaming LLM - early first sentence dispatch
      const brainStream = brainChatStream(chatMessages, this.personaLang);
      
      let rawFull = '';
      let currentEmotion = this.lastEmotion; // default to previous turn's emotion for early chunks
      let ttsStream = null;

      for await (const chunk of brainStream) {
        if (this.stopped) break; // abort generation if caller hung up
        
        rawFull += chunk + ' ';
        const parsed = parseTag(chunk, this.lastLang);
        
        const chunkEmotion = chunk.includes('~~') ? parsed.emotion : currentEmotion;
        
        this.lastLang = parsed.lang;
        currentEmotion = chunkEmotion;
        this.lastEmotion = currentEmotion;

        const text = applyRegister(parsed.text, this.lead);
        if (!text) continue;

        console.log(`[agent chunk] ${text}`);
        
        // Phase 3: Open TTS WebSocket on first chunk
        if (!ttsStream) {
          const style = EMOTION_STYLE[currentEmotion] || EMOTION_STYLE.warm;
          ttsStream = new TtsStream(parsed.lang, currentEmotion, style.pace, style.temperature, this.ttsCodec);
          ttsStream.on('audio', (b64) => this.sendAudioRawBase64(b64));
          ttsStream.on('final', () => this.onMarkDone());
          ttsStream.on('error', (err) => console.error(`[bridge] TTS WS error for ${this.lead.id}:`, err.message));
          ttsStream.connect();
        }

        const ttsText = spokenNumbers(ttsPhonetics(text, parsed.lang), parsed.lang);
        ttsStream.sendText(ttsText);
      }
      this.messages.push({ role: 'assistant', content: rawFull.trim() });
      if (ttsStream) ttsStream.flush();
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
      await this.transport.hangup().catch(() => {});
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
    await this.transport.hangup().catch(() => {});
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
      const r = await this.transport.transfer(counselor);
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
          console.log(`[bridge] ${this.isVoicemail ? 'voicemail' : 'no conversation'} — WhatsApp/SMS follow-up queued for ${this.lead.parentName}`);
        } else {
          // Same dial cap as scheduleMissed — a voicemail/no-speak call still counts as a miss.
          queueRetryOrGiveUp(this.lead, base, this.isVoicemail ? 'voicemail' : 'did not speak');
        }
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
    } finally {
      if (this.stt) this.stt.close();
      if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    }
  }
}

// ---------- missed-call retry logic ----------
// scheduleMissed: queue a retry call for a lead that didn't answer (used by transport status callbacks).
function scheduleMissed(lead) {
  const rec = crm.get(lead.id);
  const missCount = (rec && rec.dialAttempts) || 0;
  const MAX_MISSES = Number(process.env.MAX_MISSED_DIALS) || 3;
  if (missCount >= MAX_MISSES) {
    console.log(`[bridge] ${lead.parentName} missed ${missCount} dials — giving up, queueing WhatsApp`);
    scheduler.schedule({ leadId: lead.id, parent: lead.parentName, phone: lead.phone, student: lead.studentName,
      type: 'missed_call_message', dueAt: new Date(Date.now() + 10 * 60000).toISOString(), channel: 'whatsapp',
      message: `Namaste ${lead.parentName}, we tried to reach you about ${lead.studentName}. Please call us back or reply here.` });
    return;
  }
  crm.bumpDialAttempt(lead.id);
  const slot = besttime.nextGoodSlot();
  console.log(`[bridge] scheduling retry #${missCount + 1} for ${lead.parentName} at ${slot || 'next available'}`);
  scheduler.schedule({ leadId: lead.id, parent: lead.parentName, phone: lead.phone, student: lead.studentName,
    type: 'retry_call', dueAt: slot || new Date(Date.now() + 30 * 60000).toISOString(), channel: 'call',
    message: `Retry call #${missCount + 1} for ${lead.parentName}` });
}

// queueRetryOrGiveUp: same logic, used in finalize() for voicemail / no-speak calls.
function queueRetryOrGiveUp(lead, base, reason) {
  console.log(`[bridge] ${reason} for ${lead.parentName} — routing as missed`);
  scheduleMissed(lead);
}

// ---------- HTTP: /dial + /incoming + /call-status + health ----------

const bridgeCtx = {
  PUBLIC_URL,
  SID: process.env.TWILIO_ACCOUNT_SID,
  TOKEN: process.env.TWILIO_AUTH_TOKEN,
  FROM: process.env.TWILIO_FROM_NUMBER,
  createSession: (ctx, lead, opts) => new CallSession(ctx, lead, opts),
  sessionsByCallSid,
  scheduleMissed,
  leadsStore
};

const activeTransport = provider === 'frejun' 
  ? new FrejunTransport(bridgeCtx)
  : new TwilioTransport(bridgeCtx);

const server = http.createServer((req, res) => {
  if (activeTransport.handleHttp(req, res)) return;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'phoenix-telephony-bridge', provider }));
});

activeTransport.attachWebSocket(server);

server.listen(PORT, () => console.log(`Telephony bridge (${provider}) -> http://localhost:${PORT}`));
