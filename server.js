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

const { sttTranscribe, llmChat, ttsSpeak, ackClips, EMOTION_STYLE, TTS_LANGS, serviceHealth } = require('./lib/sarvam');
const { parseTag, applyRegister, ttsPhonetics, nextPersonaLang, formatReminder } = require('./lib/textpost');
const { buildSystemPrompt, greetingFor, college, LANG_CODE } = require('./agent/persona');

const API_KEY = process.env.SARVAM_API_KEY || '';
const PORT = Number(process.env.PORT) || 3100;
const MAX_CALL_MS = (Number(process.env.MAX_CALL_MINUTES) || college.compliance?.maxCallMinutes || 6) * 60000;
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS) || 90;

const leads = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'leads.json'), 'utf8'));
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

// TTS that never kills the turn: on failure the text still reaches the client (premortem #6).
async function speakSafe(call, text, lang, emotion) {
  try {
    const ttsText = ttsPhonetics(text, lang);
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
    return json(res, 200, {
      ok: true, hasKey: !!API_KEY, college: college.name, agent: college.agentName,
      model: process.env.LLM_MODEL || 'sarvam-30b', voice: process.env.AGENT_VOICE || 'simran',
      maxCallMinutes: MAX_CALL_MS / 60000, sessionUsage,
      latency: { p50: percentile(0.5), p95: percentile(0.95), turns: turnLatencies.length },
      services: serviceHealth,
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/leads') return json(res, 200, leads);

  if (req.method === 'GET' && url.pathname === '/api/calls') {
    let rows = [];
    if (fs.existsSync(CALL_LOG)) {
      rows = fs.readFileSync(CALL_LOG, 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean).slice(-15).reverse();
    }
    return json(res, 200, rows);
  }

  if (req.method === 'GET' && url.pathname === '/api/acks') {
    const clips = await ackClips(url.searchParams.get('lang') || 'en-IN');
    return json(res, 200, { clips });
  }

  if (req.method === 'POST' && url.pathname === '/api/call/start') {
    const lead = leads.find((l) => l.id === body.leadId) || leads[0];
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
    const audios = await speakSafe(call, greeting.text, greeting.lang, greeting.emotion);
    return json(res, 200, { callId, lead, reply: greeting, audios });
  }

  if (req.method === 'POST' && url.pathname === '/api/call/turn') {
    const call = calls.get(body.callId);
    if (!call) return json(res, 404, { error: 'Unknown callId' });
    call.touched = Date.now();

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
    if (nextPersonaLang(call, stt.language_code || '', Number(process.env.LANG_SWITCH_TURNS) || 1)) {
      call.messages[0].content = call.buildPrompt(call.lead, call.personaLang);
      console.log(`[Turn] Persona switched to ${call.personaLang}`);
    }

    const { text: raw, usage } = await llmChat([...windowed(call.messages), formatReminder(call.personaLang)]);
    const tLlm = Date.now();
    console.log(`[Turn] Raw LLM response: "${raw}"`);
    addUsage(call, { tokens: usage.total_tokens || 0 });
    call.messages.push({ role: 'assistant', content: raw });

    const reply = parseReply(raw, call.lastLang, call.lead);
    console.log('[Turn] Parsed reply:', reply);
    call.lastLang = reply.lang; // sticky language across turns (premortem #5)
    const audios = await speakSafe(call, reply.text, reply.lang, reply.emotion);
    const tEnd = Date.now();
    const timings = { stt: tStt - t0, llm: tLlm - tStt, tts: tEnd - tLlm, total: tEnd - t0 };
    recordLatency(timings.total);
    console.log(`[Turn] latency: stt ${timings.stt}ms · llm ${timings.llm}ms · tts ${timings.tts}ms · total ${timings.total}ms (p95 ${percentile(0.95)}ms)`);
    return json(res, 200, { userText, userLang: stt.language_code, reply, audios, wrapUp, timings });
  }

  if (req.method === 'POST' && url.pathname === '/api/call/end') {
    const call = calls.get(body.callId);
    if (!call) return json(res, 404, { error: 'Unknown callId' });
    calls.delete(body.callId);
    const durationSec = Math.round((Date.now() - call.startedAt) / 1000);
    let summary = { interest: 'unknown', summary: 'Call too short to assess.', nextAction: 'Follow-up call', objections: [] };
    if (call.messages.length > 3) {
      try {
        // Premortem #6: filled example (not placeholders) + schema validation below, so
        // template junk like "hot|warm|cold" or ["..."] can never reach calls.jsonl again.
        const { text: raw } = await llmChat(
          [
            ...windowed(call.messages),
            {
              role: 'user',
              content:
                `SYSTEM TASK (the parent did not say this — do not answer as ${college.agentName}): the call has ended. Report on it in ONLY minified JSON, in English, no markdown. "interest" must be exactly one word: hot OR warm OR cold. "objections" lists real objections the parent raised, or [] if none. "unansweredQuestions" lists questions the parent asked that the counselor could NOT answer from her facts (had to defer to the office), or [] if none. A correctly formatted example for a DIFFERENT call: {"interest":"warm","summary":"Parent liked the small batches but wants to compare fees with one other college. Mood was friendly and unhurried.","nextAction":"Send fee comparison on WhatsApp and call back Thursday evening.","objections":["fees higher than expected"],"unansweredQuestions":["exact bus fee from Miyapur"]}`,
            },
          ],
          { temperature: 0.2, maxTokens: 220 }
        );
        const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
        summary = {
          interest: ['hot', 'warm', 'cold'].includes(String(parsed.interest).toLowerCase()) ? String(parsed.interest).toLowerCase() : 'unknown',
          summary: typeof parsed.summary === 'string' && parsed.summary.length > 10 ? parsed.summary : 'No usable summary generated.',
          nextAction: typeof parsed.nextAction === 'string' && parsed.nextAction.length > 3 ? parsed.nextAction : 'Follow-up call',
          objections: (Array.isArray(parsed.objections) ? parsed.objections : []).filter(
            (o) => typeof o === 'string' && o.length > 3 && !/^\.+$/.test(o.trim())
          ),
          unansweredQuestions: (Array.isArray(parsed.unansweredQuestions) ? parsed.unansweredQuestions : []).filter(
            (q) => typeof q === 'string' && q.length > 3 && !/^\.+$/.test(q.trim())
          ),
        };
        // Edge-case capture (RCOS F2, honest version): every question the agent could not
        // answer becomes a review item. A human answers it, adds it to college.json faq,
        // and the knowledge gap closes — the learn loop with zero new infrastructure.
        for (const q of summary.unansweredQuestions) {
          fs.appendFileSync(
            path.join(__dirname, 'data', 'edge-cases.jsonl'),
            JSON.stringify({ at: new Date().toISOString(), leadId: call.lead.id, parent: call.lead.parentName, question: q, status: 'open' }) + '\n'
          );
        }
      } catch (e) {
        console.error('summary failed:', e.message);
      }
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
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
