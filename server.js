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

const { sttTranscribe, llmChat, ttsSpeak, ackClips, EMOTION_STYLE, TTS_LANGS } = require('./lib/sarvam');
const { buildSystemPrompt, greetingFor, college } = require('./agent/persona');

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

// Parse the trailing hidden tag: "...spoken words ~~te-IN|excited~~"
function parseReply(raw, fallbackLang) {
  let text = raw.trim();
  let lang = TTS_LANGS.has(fallbackLang) ? fallbackLang : 'en-IN';
  let emotion = 'warm';
  const m = text.match(/~~\s*([a-z]{2,3}-IN)\s*\|\s*([a-z]+)\s*~~\s*$/i);
  if (m) {
    if (TTS_LANGS.has(m[1])) lang = m[1];
    if (EMOTION_STYLE[m[2].toLowerCase()]) emotion = m[2].toLowerCase();
    text = text.slice(0, m.index).trim();
  }
  text = text.replace(/[*_#`>~]+/g, '').replace(/\s{2,}/g, ' ').trim();
  return { text, lang, emotion };
}

function addUsage(call, { stt = 0, tokens = 0, ttsChars = 0 }) {
  call.usage.sttSeconds = Math.round((call.usage.sttSeconds + stt) * 10) / 10;
  call.usage.llmTokens += tokens;
  call.usage.ttsChars += ttsChars;
}

// TTS that never kills the turn: on failure the text still reaches the client (premortem #6).
async function speakSafe(call, text, lang, emotion) {
  try {
    addUsage(call, { ttsChars: text.length });
    return await ttsSpeak(text, lang, emotion);
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
      model: process.env.LLM_MODEL || 'sarvam-30b', voice: process.env.AGENT_VOICE || 'kavitha',
      maxCallMinutes: MAX_CALL_MS / 60000,
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
    const greeting = greetingFor(lead);
    const call = {
      lead,
      messages: [
        { role: 'system', content: buildSystemPrompt(lead) },
        { role: 'assistant', content: greeting.text },
      ],
      startedAt: Date.now(), touched: Date.now(), lastLang: greeting.lang,
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

    const stt = await sttTranscribe(Buffer.from(body.audio, 'base64'));
    addUsage(call, { stt: stt.seconds || 0 });
    const userText = (stt.transcript || '').trim();
    if (!userText) return json(res, 200, { empty: true }); // noise — no LLM/TTS spend

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

    const { text: raw, usage } = await llmChat(call.messages);
    addUsage(call, { tokens: usage.total_tokens || 0 });
    call.messages.push({ role: 'assistant', content: raw });

    const reply = parseReply(raw, call.lastLang);
    call.lastLang = reply.lang; // sticky language across turns (premortem #5)
    const audios = await speakSafe(call, reply.text, reply.lang, reply.emotion);
    return json(res, 200, { userText, userLang: stt.language_code, reply, audios, wrapUp });
  }

  if (req.method === 'POST' && url.pathname === '/api/call/end') {
    const call = calls.get(body.callId);
    if (!call) return json(res, 404, { error: 'Unknown callId' });
    calls.delete(body.callId);
    const durationSec = Math.round((Date.now() - call.startedAt) / 1000);
    let summary = { interest: 'unknown', summary: 'Call too short to assess.', nextAction: 'Follow-up call', objections: [] };
    if (call.messages.length > 3) {
      try {
        const { text: raw } = await llmChat(
          [
            ...call.messages,
            {
              role: 'user',
              content:
                'SYSTEM TASK (the parent did not say this — do not answer as Kavitha): the call has ended. Output ONLY minified JSON in English, no markdown: {"interest":"hot|warm|cold","summary":"2 sentences on what happened and the parent\'s mood","nextAction":"one concrete next step","objections":["..."]}',
            },
          ],
          { temperature: 0.2, maxTokens: 220 }
        );
        summary = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      } catch (e) {
        console.error('summary failed:', e.message);
      }
    }
    const record = {
      at: new Date().toISOString(), leadId: call.lead.id, parent: call.lead.parentName,
      durationSec, turns: Math.floor((call.messages.length - 2) / 2), usage: call.usage, ...summary,
    };
    fs.appendFileSync(CALL_LOG, JSON.stringify(record) + '\n');
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
});
