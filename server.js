// Phoenix Voice Agent — zero-dependency Node server (v2).
// Turn pipeline: browser mic (WAV) -> Sarvam STT -> persona LLM -> Sarvam TTS (emotion-mapped).
// v2: sticky language, TTS-fail degradation, usage tracking, call caps, retention purge,
//     ack clips for latency masking, call history, stale-call sweep.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---- .env loader (before requiring lib, which reads process.env lazily anyway) ----
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { sttTranscribe, ttsSpeak, ttsCachedLine, ttsCacheGet, ttsCachePut, ackClips, EMOTION_STYLE, serviceHealth } = require('./lib/sarvam');
const { brainChatStream, TtsStream } = require('./lib/sarvam-stream');
const { parseTag, applyRegister, ttsPhonetics, nextPersonaLang } = require('./lib/textpost');
const { spokenNumbers } = require('./lib/numbers');
const crm = require('./lib/crm');
const scheduler = require('./lib/scheduler');
const ops = require('./lib/ops');
const { brainStatus } = require('./lib/brain');
const { summarize } = require('./lib/callsummary');
const { college } = require('./agent/persona');

const API_KEY = process.env.SARVAM_API_KEY || '';
const PORT = Number(process.env.PORT) || 3100;
const MAX_CALL_MS = (Number(process.env.MAX_CALL_MINUTES) || college.compliance?.maxCallMinutes || 6) * 60000;
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS) || 90;

const leadsStore = require('./lib/leads'); // shared, hot-reloading lead store (M2)
const calls = new Map(); // callId -> { lead, messages, startedAt, lastLang, usage, wrapUpSent, touched }
const CALL_LOG = path.join(__dirname, 'data', 'calls.jsonl');

// ---- DPDP retention (premortem #3): purge old call records on boot ----
if (fs.existsSync(CALL_LOG) && RETENTION_DAYS > 0) {
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  const kept = fs
    .readFileSync(CALL_LOG, 'utf8')
    .split('\n')
    .filter((l) => {
      if (!l.trim()) return false;
      try { return new Date(JSON.parse(l).at).getTime() > cutoff; } catch { return false; }
    });
  fs.writeFileSync(CALL_LOG, kept.length ? kept.join('\n') + '\n' : '');
}

// ---- stale in-memory call sweep (client closed tab without ending) ----
setInterval(() => {
  const now = Date.now();
  for (const [id, c] of calls) if (now - c.touched > 30 * 60000) calls.delete(id);
}, 5 * 60000).unref();

// Follow-up scheduler tick — marks due reminders/follow-ups every minute (sends once a channel is wired).
setInterval(() => { Promise.resolve(scheduler.tick()).catch((e) => console.error('scheduler tick:', e.message)); }, 60000).unref();

// Parse the hidden tag and apply the urban-register pass (shared with the telephony
// bridge via lib/textpost.js). Each reply is voiced in ITS OWN language model — the
// bulbul:v3 speaker is the same person across te/hi/en, so mid-call language switches
// keep the same voice with correct pronunciation.
function parseReply(raw, fallbackLang, lead) {
  const parsed = parseTag(raw, fallbackLang);
  return {
    text: applyRegister(parsed.text, lead),
    lang: parsed.lang,
    emotion: parsed.emotion,
  };
}

const sessionUsage = { calls: 0, sttSeconds: 0, llmTokens: 0, ttsChars: 0 }; // running totals since boot (premortem N6)

// Turn-latency tracking (RCOS F3, honest version): stage timings per turn, P50/P95
// over the last 500 turns, surfaced in /api/health and per-turn in the UI.
const turnLatencies = [];
function recordLatency(ms) {
  turnLatencies.push(ms);
  if (turnLatencies.length > 500) turnLatencies.shift();
}
function percentile(p) {
  if (!turnLatencies.length) return 0;
  const sorted = [...turnLatencies].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

function addUsage(call, { stt = 0, tokens = 0, ttsChars = 0 }) {
  call.usage.sttSeconds = Math.round((call.usage.sttSeconds + stt) * 10) / 10;
  call.usage.llmTokens += tokens;
  call.usage.ttsChars += ttsChars;
  sessionUsage.sttSeconds = Math.round((sessionUsage.sttSeconds + stt) * 10) / 10;
  sessionUsage.llmTokens += tokens;
  sessionUsage.ttsChars += ttsChars;
}

// Persona drift guard: the language-aware reminder now lives in lib/textpost.js
// (shared with the telephony bridge so web and phone behavior cannot diverge).

// PERSONA HOT-RELOAD: re-read agent/*.js + college.json on every NEW call, so persona
// edits take effect WITHOUT restarting the server. (Root cause of a bad field call on
// 2026-07-03: a stale server process kept pre-fine-tune prompts cached in memory.)
function freshAgent() {
  const marker = `${path.sep}agent${path.sep}`;
  for (const k of Object.keys(require.cache)) {
    if (k.includes(marker)) delete require.cache[k];
  }
  return require('./agent/persona');
}

// Premortem #7: cap what each LLM call carries — system prompt + the last N exchanges.
const HISTORY_TURNS = Number(process.env.HISTORY_TURNS) || 12;
const windowed = (messages) => [messages[0], ...messages.slice(1).slice(-HISTORY_TURNS)];

/* ---------------------------------------------------------------- streaming TTS
   REST TTS renders the WHOLE file before returning a byte — measured at ~3,400ms to first
   audio, which was the entire remaining latency after the reasoning_effort fix. Sarvam's TTS
   WebSocket emits chunks AS IT SYNTHESISES: first audio in ~400ms (measured).

   Three things this must NOT break:
     1. the disk cache (TTS ≈ 80% of the Sarvam bill — a repeat line must still cost ₹0),
     2. ordering (sentences must play in sequence),
     3. smoothness (a 7s reply arrives as ~70 chunks; one <Audio> element per chunk would
        stutter badly, so chunks are batched — small first batch for speed, larger after).       */
// linear16 (raw PCM16) — no MP3 encoder-padding, byte-concatenatable => the client can
// schedule batches on the Web Audio clock with zero seam. 24kHz is Bulbul v3's native rate
// (no resampling). ~3x the bytes of MP3, which only matters on the web path (phone uses mulaw).
const TTS_WS = { sampleRate: 24000, codec: 'linear16' };
const mergeB64 = (list) => Buffer.concat(list.map((b) => Buffer.from(b, 'base64'))).toString('base64');

// Pick the TTS language from the script the reply is actually written in (same Unicode ranges
// the STT-fallback uses). Telugu/Devanagari present => that language, even if the sentence also
// carries code-switched English words. Falls back to the turn's persona language when neither
// Indic script is present (a pure-English reply). Tag-independent, so it's correct from the
// first streamed sentence — before the ~~lang~~ tag arrives.
function ttsLangForText(text, fallback) {
  if (/[ఀ-౿]/.test(text)) return 'te-IN';   // Telugu
  if (/[ऀ-ॿ]/.test(text)) return 'hi-IN';   // Devanagari (Hindi)
  if (/[A-Za-z]/.test(text)) return 'en-IN';
  return fallback || 'en-IN';
}

async function speakStreamed(call, text, lang, emotion, onBatch, growth) {
  const ttsText = spokenNumbers(ttsPhonetics(text, lang), lang);

  // 1) CACHE FIRST — instant and free. Beats streaming every time. (Cached blob is PCM.)
  const hit = ttsCacheGet(ttsText, lang, emotion, TTS_WS);
  if (hit) { onBatch([hit], 'pcm16'); if (growth) growth.n++; return; }

  // 2) MISS -> stream it.
  const style = EMOTION_STYLE[emotion] || EMOTION_STYLE.warm;
  const all = [];
  await new Promise((resolve) => {
    let tts, batch = [], done = false;
    // GROWING batches. Each <Audio> element the client creates costs a handoff gap, and too many
    // of them stutter. Sarvam synthesises ~3x faster than realtime, so after a tiny first batch
    // (for speed) we can afford progressively larger ones — the audio already playing always
    // outlasts the wait for the next batch.
    //
    // The counter is shared ACROSS THE WHOLE TURN (passed in as `growth`), not per sentence:
    // when it reset per sentence, a 5-sentence reply produced 3,8,20 · 3,8,20 · 3,8,20… = 15
    // batches and audibly stuttered. Shared, the same reply emits ~5.
    const SIZES = [3, 8, 20, 40, 60];
    const targetSize = () => SIZES[Math.min(growth ? growth.n : 0, SIZES.length - 1)];

    const emit = () => {
      if (!batch.length) return;
      onBatch(batch.slice(), 'pcm16');            // WS delivers linear16
      batch = [];
      if (growth) growth.n++;
    };

    const finish = async () => {
      if (done) return; done = true;
      emit();                                                            // flush the tail
      if (all.length) {
        addUsage(call, { ttsChars: ttsText.length });                    // meter real synthesis
        ttsCachePut(ttsText, lang, emotion, TTS_WS, mergeB64(all));      // free next time
      }
      if (tts) tts.close();
      resolve();
    };

    try {
      tts = new TtsStream(lang, emotion, style.pace, style.temperature, TTS_WS.codec,
        { sampleRate: TTS_WS.sampleRate, minBufferSize: 30 });
      tts.on('audio', (b64) => {
        all.push(b64); batch.push(b64);
        if (batch.length >= targetSize()) emit();
      });
      tts.on('final', finish);
      tts.on('error', async (e) => {
        if (all.length) return finish();                                  // partial audio: keep it
        console.error('[tts-stream] falling back to REST:', e.message);   // nothing yet: fall back
        done = true;
        try {
          const audios = await speakSafe(call, text, lang, emotion);
          if (audios && audios.length) onBatch(audios, 'mp3');   // REST fallback is MP3, not PCM
        } catch (e2) { console.error('tts fallback failed:', e2.message); }
        if (tts) tts.close();
        resolve();
      });
      setTimeout(finish, 20000);                                          // hard safety net
      tts.connect();
      tts.sendText(ttsText);
      tts.flush();
    } catch (e) {
      console.error('[tts-stream] init failed:', e.message);
      finish();
    }
  });
}

// TTS that never kills the turn: on failure the text still reaches the client (premortem #6).
// Still used for the GREETING (already cached + instant) and as the streaming fallback.
async function speakSafe(call, text, lang, emotion) {
  try {
    // Deterministic delivery pass: acronym phonetics, then numbers → natural spoken words
    // (so no digit is ever read grammatically, regardless of what the LLM emitted).
    const ttsText = spokenNumbers(ttsPhonetics(text, lang), lang);
    // G5 cost goal: TTS is ~80% of the Sarvam bill. Short lines (≤200 chars — most
    // 15-word turns, and ALL the verbatim playbook scripts, which repeat by design)
    // are disk-cached: an identical line ever spoken again costs ₹0. Usage is metered
    // only on real synthesis.
    if (ttsText.length <= 200) {
      const r = await ttsCachedLine(ttsText, lang, emotion);
      if (!r.cached) addUsage(call, { ttsChars: ttsText.length });
      return r.audios;
    }
    addUsage(call, { ttsChars: ttsText.length });
    return await ttsSpeak(ttsText, lang, emotion);
  } catch (e) {
    console.error('TTS degraded to text-only:', e.message);
    return [];
  }
}

// ---- routes ----
async function handleApi(req, res, url, body) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    // Config-readiness flags: the ops dashboard surfaces these as honest warnings, so a
    // silently-unconfigured department (e.g. counsellor alerts firing into the void) is
    // visible instead of failing quietly.
    const PLACEHOLDER = /PLACEHOLDER|ADD_WHEN/i;
    const real = (v) => !!v && !PLACEHOLDER.test(v);
    return json(res, 200, {
      ok: true, hasKey: !!API_KEY, college: college.name, agent: college.agentName,
      model: process.env.LLM_MODEL || 'sarvam-30b', voice: process.env.AGENT_VOICE || 'simran',
      maxCallMinutes: MAX_CALL_MS / 60000, sessionUsage,
      latency: { p50: percentile(0.5), p95: percentile(0.95), turns: turnLatencies.length },
      services: serviceHealth, brain: brainStatus(),
      whatsapp: real(process.env.WHATSAPP_TOKEN) && real(process.env.WHATSAPP_PHONE_ID),
      counselorPhone: real(process.env.COUNSELOR_PHONE),
      paymentGateway: real(process.env.PAYMENT_LINK_BASE),
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/leads') return json(res, 200, leadsStore.all());

  // ---- Dept 1: public enquiry capture (website widget / form) ----
  // A prospective parent submits their details; we create the lead (deduped + DNC-checked)
  // and flag it for an immediate callback — the 5-minute golden window that beats humans.
  if (req.method === 'POST' && url.pathname === '/api/enquiry') {
    const r = leadsStore.addMany([{
      _line: 1, parentName: body.parentName, phone: body.phone, studentName: body.studentName,
      gender: body.gender, language: body.language, area: body.area, interest: body.interest,
      source: 'website enquiry form',
    }]);
    if (r.added.length) {
      const lead = r.added[0];
      scheduler.schedule({ leadId: lead.id, parent: lead.parentName, phone: lead.phone, student: lead.studentName,
        type: 'instant_callback', dueAt: new Date().toISOString(), channel: 'call',
        message: `NEW WEB ENQUIRY — call ${lead.parentName} about ${lead.studentName} NOW (5-minute golden window).` });
      return json(res, 200, { ok: true, message: "Thank you! Our admissions counselor will call you within minutes." });
    }
    const reason = (r.rejected[0] || {}).reason || 'could not accept the enquiry';
    return json(res, 200, { ok: false, message: reason === 'on the Do-Not-Call list' ? 'Thank you.' : `Please check your details: ${reason}` });
  }

  // M2: lead import — CSV text in, per-row verdicts out. Nothing silently dropped.
  if (req.method === 'POST' && url.pathname === '/api/leads/import') {
    const parsed = leadsStore.parseCsv(body.csv || '');
    if (parsed.error) return json(res, 400, { error: parsed.error });
    const report = leadsStore.addMany(parsed.rows);
    console.log(`[import] ${report.added.length} added, ${report.rejected.length} rejected`);
    return json(res, 200, { added: report.added.length, addedLeads: report.added, rejected: report.rejected });
  }

  if (req.method === 'GET' && url.pathname === '/api/calls') {
    let rows = [];
    if (fs.existsSync(CALL_LOG)) {
      rows = fs.readFileSync(CALL_LOG, 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean).slice(-15).reverse();
    }
    return json(res, 200, rows);
  }

  if (req.method === 'GET' && url.pathname === '/api/crm') {
    return json(res, 200, { stats: crm.stats(), leads: crm.listLeads() });
  }

  if (req.method === 'GET' && url.pathname === '/api/followups') {
    return json(res, 200, scheduler.listFollowups());
  }

  // ---- Dept 6: documents ----
  if (req.method === 'GET' && url.pathname === '/api/documents') {
    return json(res, 200, ops.documentStatus(url.searchParams.get('leadId')));
  }
  if (req.method === 'POST' && url.pathname === '/api/documents/mark') {
    ops.markDocument(body.leadId, body.doc, body.received !== false);
    return json(res, 200, { ok: true, status: ops.documentStatus(body.leadId) });
  }

  // ---- Dept 9: payments ----
  if (req.method === 'POST' && url.pathname === '/api/payments/plan') {
    const rec = ops.setPaymentPlan(body.leadId, { total: body.total, installments: body.installments });
    const lead = leadsStore.byId(body.leadId);
    if (lead) ops.schedulePaymentReminders(lead);
    return json(res, 200, { ok: true, payment: rec.payment });
  }
  if (req.method === 'POST' && url.pathname === '/api/payments/paid') {
    return json(res, 200, { ok: true, rec: ops.markInstallmentPaid(body.leadId, body.label) });
  }

  // ---- Dept 12: post-admission roster + broadcast ----
  if (req.method === 'GET' && url.pathname === '/api/roster') {
    return json(res, 200, ops.roster());
  }
  if (req.method === 'POST' && url.pathname === '/api/roster/import') {
    const parsed = leadsStore.parseCsv(body.csv || '');
    if (parsed.error) return json(res, 400, { error: parsed.error });
    const added = ops.importRoster(parsed.rows);
    return json(res, 200, { added: added.length });
  }
  if (req.method === 'POST' && url.pathname === '/api/notify') {
    const r = await ops.notifyRoster(body.type, body.detail || '', body.filter || {});
    return json(res, 200, { ok: true, ...r });
  }

  // ---- Best-time-to-call analytics ----
  if (req.method === 'GET' && url.pathname === '/api/besttime') {
    return json(res, 200, require('./lib/besttime').stats());
  }

  // ---- Campus-visit bookings (pilot-safe: each carries an .ics the counselor imports) ----
  if (req.method === 'GET' && url.pathname === '/api/bookings') {
    const booking = require('./lib/booking');
    return json(res, 200, { bookings: booking.list().map((b) => ({ ...b, ics: booking.ics(b) })) });
  }

  // ---- M9: funnel ----
  if (req.method === 'GET' && url.pathname === '/api/funnel') {
    const leadRows = crm.listLeads();
    const calls = leadRows.reduce((n, l) => n + (l.calls || 0), 0);
    return json(res, 200, {
      enquiries: leadsStore.all().length,
      contacted: leadRows.length,
      conversations: calls,
      hot: leadRows.filter((l) => l.interest === 'hot').length,
      warm: leadRows.filter((l) => l.interest === 'warm').length,
      visitsBooked: leadRows.filter((l) => l.appointment && l.appointment.booked).length,
      admitted: ops.roster().length,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/acks') {
    const clips = await ackClips(url.searchParams.get('lang') || 'en-IN');
    return json(res, 200, { clips });
  }

  if (req.method === 'POST' && url.pathname === '/api/call/start') {
    const lead = leadsStore.byId(body.leadId) || leadsStore.all()[0];
    const callId = crypto.randomUUID();
    const agent = freshAgent(); // pick up any persona edits made since the last call
    const greeting = agent.greetingFor(lead);
    const personaLang = 'en-IN'; // always open in English; mirror the caller from turn one
    const call = {
      lead,
      buildPrompt: agent.buildSystemPrompt,
      messages: [
        { role: 'system', content: agent.buildSystemPrompt(lead, personaLang) },
        { role: 'assistant', content: greeting.text },
      ],
      startedAt: Date.now(), touched: Date.now(), lastLang: greeting.lang,
      personaLang, streak: { lang: null, count: 0 }, // language-switch hysteresis (premortem #3)
      usage: { sttSeconds: 0, llmTokens: 0, ttsChars: 0 }, wrapUpSent: false,
    };
    calls.set(callId, call);
    // Greeting is deterministic — serve cached audio (free win #3); meter only real spend.
    let audios = [];
    try {
      const ttsText = spokenNumbers(ttsPhonetics(greeting.text, greeting.lang), greeting.lang);
      const r = await ttsCachedLine(ttsText, greeting.lang, greeting.emotion);
      if (!r.cached) addUsage(call, { ttsChars: ttsText.length });
      audios = r.audios;
    } catch (e) { console.error('TTS degraded to text-only:', e.message); }
    return json(res, 200, { callId, lead, reply: greeting, audios });
  }

  if (req.method === 'POST' && url.pathname === '/api/call/turn') {
    const call = calls.get(body.callId);
    if (!call) return json(res, 404, { error: 'Unknown callId' });
    call.touched = Date.now();

    // A Sarvam timeout (STT/LLM) used to throw out of here with no response ever sent, leaving
    // the client stuck in "thinking" forever. Now every failure sends SOMETHING back and keeps
    // the call alive — the parent can simply repeat instead of the call dying.
    try {
    const t0 = Date.now();
    const stt = await sttTranscribe(Buffer.from(body.audio, 'base64'), 'unknown');
    const tStt = Date.now();
    addUsage(call, { stt: stt.seconds || 0 });
    const userText = (stt.transcript || '').trim();
    console.log(`[Turn] User transcript: "${userText}"`);
    if (!userText) {
      console.log('[Turn] User transcript is empty (noise only).');
      return json(res, 200, { empty: true }); // noise — no LLM/TTS spend
    }

    call.messages.push({ role: 'user', content: userText });

    // hard call-length cap (premortem #9): tell the persona to wrap up warmly, once
    let wrapUp = false;
    if (Date.now() - call.startedAt > MAX_CALL_MS && !call.wrapUpSent) {
      call.wrapUpSent = true;
      wrapUp = true;
      call.messages.push({
        role: 'user',
        content: 'SYSTEM NOTE (the parent did not say this): the call has reached its time limit. Follow the WRAP-UP PROTOCOL now — one warm closing turn.',
      });
    }

    // Mirror the caller's language. LANG_SWITCH_TURNS=1 (default) switches the persona
    // the moment the caller changes language; set 2 in .env if misdetections ping-pong.
    let detectedLang = stt.language_code;
    if (!detectedLang) {
      if (/[\\u0C00-\\u0C7F]/.test(userText)) detectedLang = 'te-IN';
      else if (/[\\u0900-\\u097F]/.test(userText)) detectedLang = 'hi-IN';
      else if (/[a-zA-Z]/.test(userText)) detectedLang = 'en-IN';
    }

    if (nextPersonaLang(call, detectedLang || '', Number(process.env.LANG_SWITCH_TURNS) || 1)) {
      call.messages[0].content = call.buildPrompt(call.lead, call.personaLang);
      call.messages.push({ role: 'system', content: `CRITICAL: The user has switched their language. You MUST now reply ONLY in the script and language of your system prompt. Do NOT use the language from earlier in the conversation.` });
      console.log(`[Turn] Persona switched to ${call.personaLang}`);
    }

    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Transfer-Encoding': 'chunked' });
    res.write(JSON.stringify({ type: 'start', userText, userLang: stt.language_code, wrapUp }) + '\n');

    const chatMessages = [call.messages[0], ...call.messages.slice(1).slice(-HISTORY_TURNS)];
    const brainStream = brainChatStream(chatMessages, call.personaLang);
    
    let rawFull = '';
    let currentEmotion = 'warm';
    let chunkIndex = 0;          // monotonic audio index; client plays batches in this order
    let ttsChain = Promise.resolve();   // serialises sentence synthesis (see below)
    const growth = { n: 0 };            // batch-size curve, shared across ALL sentences this turn
    // Perceived latency = when the parent HEARS the first syllable, not when the whole
    // reply finished synthesising. The old metric timed the latter (Promise.all of every
    // TTS chunk), which reported ~5s and made the pipeline look far slower than it feels.
    let tFirstAudio = 0;
    let tFirstText = 0;

    for await (const chunk of brainStream) {
      if (typeof chunk === 'object' && chunk.usage) {
        addUsage(call, { tokens: chunk.usage.total_tokens || 0 });
        continue;
      }
      rawFull += chunk + ' ';
      const parsed = parseTag(chunk, call.lastLang);
      currentEmotion = chunk.includes('~~') ? parsed.emotion : currentEmotion;
      call.lastLang = parsed.lang;

      const text = applyRegister(parsed.text, call.lead);
      if (!text) continue;

      // TTS LANGUAGE = the script actually written, NOT parsed.lang. The ~~lang~~ tag only
      // appears at the END of a reply, so early sentences fall back to the PREVIOUS turn's
      // language — which on a mid-call language switch feeds Telugu/Hindi text to the TTS as
      // 'en-IN', so Sarvam returns nothing and the caller hears silence. Detecting the script
      // is deterministic, tag-independent, and gives the identical result when NOT switching
      // (so the working voice/latency is unchanged). call.personaLang is the fallback.
      const ttsLang = ttsLangForText(text, call.personaLang);

      // Instantly stream the text transcript line
      if (!tFirstText) tFirstText = Date.now();
      res.write(JSON.stringify({ type: 'text', text: text, lang: ttsLang, emotion: currentEmotion }) + '\n');

      // Stream this sentence's audio. Sentences are CHAINED (not raced) so their chunks can
      // never interleave — the client plays index 0,1,2… in order. Sentence N+1 synthesises
      // while sentence N is still playing, so chaining costs no perceived time.
      const lang = ttsLang, emo = currentEmotion, body = text;
      ttsChain = ttsChain.then(() => speakStreamed(call, body, lang, emo, (batch, format) => {
        if (!tFirstAudio) tFirstAudio = Date.now();   // <- the number the parent actually feels
        const rate = format === 'pcm16' ? TTS_WS.sampleRate : undefined;   // mp3 carries its own rate
        res.write(JSON.stringify({ type: 'audio', index: chunkIndex++, audios: batch, format, rate }) + '\n');
      }, growth)).catch((e) => { console.error('tts chain error:', e.message); });
    }

    await ttsChain;

    call.messages.push({ role: 'assistant', content: rawFull.trim() });
    
    const tEnd = Date.now();
    const timings = {
      stt: tStt - t0,                                   // batch STT: the biggest single block
      toFirstText: tFirstText ? tFirstText - t0 : 0,    // first sentence generated
      toFirstAudio: tFirstAudio ? tFirstAudio - t0 : 0, // PERCEIVED latency — what the parent feels
      total: tEnd - t0,                                 // whole reply synthesised (not perceived)
    };
    // Track the perceived number, not the total. Falls back to total if TTS produced nothing.
    recordLatency(timings.toFirstAudio || timings.total);
    console.log(`[Turn] stt ${timings.stt}ms · llm→first-sentence ${timings.toFirstText - timings.stt}ms · tts ${timings.toFirstAudio - timings.toFirstText}ms · FIRST-AUDIO ${timings.toFirstAudio}ms · total ${timings.total}ms`);
    
    // We send a close event so the client knows LLM generation is completely done
    res.write(JSON.stringify({ type: 'end', timings }) + '\n');
    res.end();
    return;
    } catch (e) {
      console.error('[Turn] failed (recovering, call stays alive):', e.message);
      // Pre-stream failure (STT threw): headers not sent yet -> tell the client "empty" so it
      // simply re-listens (parent repeats), exactly like a noise-only turn.
      if (!res.headersSent) return json(res, 200, { empty: true });
      // Mid-stream failure (LLM/TTS threw after we started streaming): close the reply cleanly
      // so the client finalizes and returns to listening instead of hanging in "thinking".
      try { res.write(JSON.stringify({ type: 'end', error: 'partial' }) + '\n'); res.end(); } catch { /* socket gone */ }
      return;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/call/end') {
    const call = calls.get(body.callId);
    if (!call) return json(res, 404, { error: 'Unknown callId' });
    calls.delete(body.callId);
    const durationSec = Math.round((Date.now() - call.startedAt) / 1000);
    // Shared summariser — identical logic on the phone bridge (audit H1).
    const summary = await summarize(call.messages, college.agentName);
    // Edge-case capture (RCOS F2): every question the agent could not answer becomes a
    // review item — a human answers it, adds it to college.json faq, gap closed.
    try {
      for (const q of summary.unansweredQuestions) {
        fs.appendFileSync(
          path.join(__dirname, 'data', 'edge-cases.jsonl'),
          JSON.stringify({ at: new Date().toISOString(), leadId: call.lead.id, parent: call.lead.parentName, question: q, status: 'open' }) + '\n'
        );
      }
    } catch (e) {
      console.error('edge-case write failed:', e.message);
    }
    // Full turn-by-turn transcript for review — raw LLM output kept (including the
    // hidden ~~lang|emotion~~ tags) so persona behavior can be audited after the call.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const transcriptFile = path.join(__dirname, 'data', 'transcripts', `${stamp}-${call.lead.id}.txt`);
    try {
      fs.mkdirSync(path.dirname(transcriptFile), { recursive: true });
      const lines = call.messages
        .slice(1) // skip the system prompt
        .filter((m) => !m.content.startsWith('SYSTEM')) // skip injected wrap-up/system notes
        .map((m) => `${m.role === 'assistant' ? college.agentName.toUpperCase() : 'PARENT'}: ${m.content}`);
      fs.writeFileSync(
        transcriptFile,
        `Call with ${call.lead.parentName} (${call.lead.id}) · ${new Date().toISOString()} · ${durationSec}s\n` +
          `Lead: ${call.lead.studentName}, ${call.lead.interest}, ${call.lead.area}\n\n` +
          lines.join('\n\n') + '\n'
      );
    } catch (e) {
      console.error('transcript write failed:', e.message);
    }

    const record = {
      at: new Date().toISOString(), leadId: call.lead.id, parent: call.lead.parentName,
      durationSec, turns: Math.floor((call.messages.length - 2) / 2), usage: call.usage,
      transcript: path.relative(__dirname, transcriptFile), ...summary,
    };
    fs.appendFileSync(CALL_LOG, JSON.stringify(record) + '\n');
    try { crm.upsertLead(call.lead, summary); } catch (e) { console.error('CRM upsert failed:', e.message); }
    try { scheduler.fromCall(call.lead, summary); } catch (e) { console.error('scheduler failed:', e.message); }
    try { await require('./lib/alerts').alertTeam(call.lead, summary, 'web'); } catch (e) { console.error('[alert] failed:', e.message); } // M5
    sessionUsage.calls++;
    console.log(`call done (${durationSec}s) · session totals: ${sessionUsage.calls} calls, ${sessionUsage.sttSeconds}s STT, ${sessionUsage.llmTokens} tokens, ${sessionUsage.ttsChars} TTS chars`);
    return json(res, 200, record);
  }

  return json(res, 404, { error: 'Not found' });
}

// ---- plumbing ----
function json(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const ACCESS_SECRET = process.env.ACCESS_SECRET || '';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Dept 1: the public enquiry form + its submit endpoint are intentionally OUTSIDE the
  // shared-secret gate — a prospective parent must reach them without a key. They only
  // CREATE a lead (rate-limited by nothing sensitive); they read nothing private.
  // Public: the parent enquiry page + its POST, plus the shared STYLING assets it needs
  // (tokens/ui css + self-hosted fonts). Only non-sensitive presentation files are exposed —
  // never data endpoints or internal pages.
  const isPublic = url.pathname === '/enquiry.html' || url.pathname === '/api/enquiry'
    || url.pathname === '/tokens.css' || url.pathname === '/ui.css'
    || url.pathname.startsWith('/fonts/');

  // Shared-secret gate (H4): if ACCESS_SECRET is set, require it before ANY route so a
  // shared demo link can't be used by strangers to burn Sarvam/Groq/Twilio credits.
  // Accept it via HTTP Basic auth (browser prompts once) OR a ?key= query param.
  if (ACCESS_SECRET && !isPublic) {
    const auth = req.headers.authorization || '';
    let ok = url.searchParams.get('key') === ACCESS_SECRET;
    if (!ok && auth.startsWith('Basic ')) {
      const [, pass = ''] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
      ok = pass === ACCESS_SECRET;
    }
    if (!ok) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Resonance demo"', 'Content-Type': 'text/plain' });
      return res.end('Authorization required. Ask for the access key.');
    }
  }

  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 30e6) req.destroy(); // cap base64 audio bodies
    });
    req.on('end', () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'Bad JSON' }); }
      handleApi(req, res, url, body).catch((e) => {
        console.error(e);
        json(res, 502, { error: e.message });
      });
    });
    return;
  }
  const file = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(path.join(__dirname, 'public'))) return json(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Phoenix Voice Agent -> http://localhost:${PORT}`);
  if (!API_KEY) console.log('WARNING: SARVAM_API_KEY not set — copy .env.example to .env and add your key (free credits at dashboard.sarvam.ai)');
  // Launch-gate warnings (premortem #1 and #2)
  const rawFacts = fs.readFileSync(path.join(__dirname, 'agent', 'college.json'), 'utf8');
  if (/TODO/i.test(rawFacts)) {
    console.log('WARNING: agent/college.json still has TODO facts — the agent will defer those to "office will confirm". Fill real numbers before any external call (run: npm run preflight).');
  }
  if (college.compliance?.brandAuthorized !== true) {
    console.log(`WARNING: "${college.name}" brand use is NOT marked authorized (compliance.brandAuthorized) — internal testing only.`);
  }
});
