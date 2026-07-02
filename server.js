// Phoenix Voice Agent — zero-dependency Node server.
// Pipeline per turn: browser mic (WAV) -> Sarvam STT (saaras:v3, auto language)
// -> Sarvam-M LLM (persona) -> Sarvam TTS (bulbul:v3, emotion-mapped) -> browser.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildSystemPrompt, greetingFor, college } = require('./agent/persona');

// ---- .env loader ----
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const API_KEY = process.env.SARVAM_API_KEY || '';
const PORT = Number(process.env.PORT) || 3100;
const LLM_MODEL = process.env.LLM_MODEL || 'sarvam-30b'; // sarvam-30b is fastest; sarvam-105b for max quality
const VOICE = process.env.AGENT_VOICE || 'kavitha'; // bulbul:v3 speaker

const SARVAM = 'https://api.sarvam.ai';
const sarvamHeaders = { 'api-subscription-key': API_KEY };

const leads = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'leads.json'), 'utf8'));
const calls = new Map(); // callId -> { lead, messages, startedAt }
const CALL_LOG = path.join(__dirname, 'data', 'calls.jsonl');

// ---- Sarvam API ----
async function sttTranscribe(wavBuffer) {
  const form = new FormData();
  form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'turn.wav');
  form.append('model', 'saaras:v3');
  form.append('language_code', 'unknown'); // auto-detect Telugu/Hindi/English
  const res = await fetch(`${SARVAM}/speech-to-text`, { method: 'POST', headers: sarvamHeaders, body: form });
  if (!res.ok) throw new Error(`Sarvam STT ${res.status}: ${await res.text()}`);
  return res.json(); // { transcript, language_code }
}

async function llmChat(messages, opts = {}) {
  const res = await fetch(`${SARVAM}/v1/chat/completions`, {
    method: 'POST',
    headers: { ...sarvamHeaders, Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 220,
      reasoning_effort: 'low', // speed matters more than deep reasoning on a live call
    }),
  });
  if (!res.ok) throw new Error(`Sarvam LLM ${res.status}: ${await res.text()}`);
  const j = await res.json();
  let text = j.choices?.[0]?.message?.content || '';
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

// emotion -> voice delivery (bulbul:v3 pace + expressiveness temperature)
const EMOTION_STYLE = {
  warm: { pace: 1.0, temperature: 0.6 },
  excited: { pace: 1.08, temperature: 0.9 },
  empathetic: { pace: 0.92, temperature: 0.5 },
  calm: { pace: 0.95, temperature: 0.4 },
  urgent: { pace: 1.12, temperature: 0.8 },
};
const TTS_LANGS = new Set(['te-IN', 'hi-IN', 'en-IN', 'ta-IN', 'kn-IN', 'ml-IN', 'mr-IN']);

async function ttsSpeak(text, lang, emotion) {
  const style = EMOTION_STYLE[emotion] || EMOTION_STYLE.warm;
  const res = await fetch(`${SARVAM}/text-to-speech`, {
    method: 'POST',
    headers: { ...sarvamHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: text.slice(0, 1400),
      target_language_code: TTS_LANGS.has(lang) ? lang : 'en-IN',
      model: 'bulbul:v3',
      speaker: VOICE,
      pace: style.pace,
      temperature: style.temperature,
      speech_sample_rate: 24000,
      output_audio_codec: 'mp3',
    }),
  });
  if (!res.ok) throw new Error(`Sarvam TTS ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.audios?.[0] || ''; // base64 mp3
}

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
  text = text.replace(/[*_#`>]+/g, '').replace(/\s{2,}/g, ' ').trim();
  return { text, lang, emotion };
}

// ---- routes ----
async function handleApi(req, res, url, body) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, hasKey: !!API_KEY, college: college.name, agent: college.agentName, model: LLM_MODEL, voice: VOICE });
  }
  if (req.method === 'GET' && url.pathname === '/api/leads') {
    return json(res, 200, leads);
  }
  if (req.method === 'POST' && url.pathname === '/api/call/start') {
    const lead = leads.find((l) => l.id === body.leadId) || leads[0];
    const callId = crypto.randomUUID();
    const greeting = greetingFor(lead);
    const messages = [
      { role: 'system', content: buildSystemPrompt(lead) },
      { role: 'assistant', content: greeting.text },
    ];
    calls.set(callId, { lead, messages, startedAt: Date.now() });
    const audio = await ttsSpeak(greeting.text, greeting.lang, greeting.emotion);
    return json(res, 200, { callId, lead, reply: greeting, audio });
  }
  if (req.method === 'POST' && url.pathname === '/api/call/turn') {
    const call = calls.get(body.callId);
    if (!call) return json(res, 404, { error: 'Unknown callId' });
    const wav = Buffer.from(body.audio, 'base64');
    const stt = await sttTranscribe(wav);
    const userText = (stt.transcript || '').trim();
    if (!userText) return json(res, 200, { empty: true }); // silence / noise — let client keep listening
    call.messages.push({ role: 'user', content: userText });
    const raw = await llmChat(call.messages);
    call.messages.push({ role: 'assistant', content: raw });
    const reply = parseReply(raw, stt.language_code);
    const audio = await ttsSpeak(reply.text, reply.lang, reply.emotion);
    return json(res, 200, { userText, userLang: stt.language_code, reply, audio });
  }
  if (req.method === 'POST' && url.pathname === '/api/call/end') {
    const call = calls.get(body.callId);
    if (!call) return json(res, 404, { error: 'Unknown callId' });
    calls.delete(body.callId);
    const durationSec = Math.round((Date.now() - call.startedAt) / 1000);
    let summary = { interest: 'unknown', summary: 'Call too short to assess.', nextAction: 'Follow-up call', objections: [] };
    if (call.messages.length > 3) {
      try {
        const raw = await llmChat(
          [
            ...call.messages,
            {
              role: 'user',
              content:
                'SYSTEM TASK (not the parent speaking): The call has ended. Output ONLY minified JSON, in English, no markdown: {"interest":"hot|warm|cold","summary":"2 sentences on what happened","nextAction":"one concrete next step","objections":["..."]}',
            },
          ],
          { temperature: 0.2, maxTokens: 200 }
        );
        summary = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      } catch (e) {
        console.error('summary failed:', e.message);
      }
    }
    const record = { at: new Date().toISOString(), leadId: call.lead.id, parent: call.lead.parentName, durationSec, turns: Math.floor((call.messages.length - 2) / 2), ...summary };
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
      if (raw.length > 30e6) req.destroy(); // ~30 MB cap (base64 audio)
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
  // static
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
