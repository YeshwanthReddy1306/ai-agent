// Sarvam AI client — shared by the web server and the telephony bridge.
// All calls retry once with backoff (premortem #6) and report usage (premortem #7).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SARVAM = 'https://api.sarvam.ai';
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const key = () => process.env.SARVAM_API_KEY || '';

// Per-service health for graceful-degradation visibility (RCOS F10, honest version):
// consecutive failures + last error per Sarvam service, surfaced in /api/health.
const serviceHealth = {
  STT: { consecutiveFails: 0, lastError: null },
  LLM: { consecutiveFails: 0, lastError: null },
  TTS: { consecutiveFails: 0, lastError: null },
};

async function withRetry(fn, label) {
  const h = serviceHealth[label] || (serviceHealth[label] = { consecutiveFails: 0, lastError: null });
  try {
    const res = await fn();
    h.consecutiveFails = 0;
    h.lastError = null;
    return res;
  } catch (e) {
    console.warn(`${label} failed once (${e.message}), retrying…`);
    await new Promise((r) => setTimeout(r, 350));
    try {
      const res = await fn();
      h.consecutiveFails = 0;
      h.lastError = null;
      return res;
    } catch (e2) {
      h.consecutiveFails++;
      h.lastError = e2.message.slice(0, 200);
      h.at = new Date().toISOString();
      throw e2;
    }
  }
}

// ---------- STT ----------
// wavBuffer: 16 kHz or 8 kHz mono PCM16 WAV. Returns { transcript, language_code, seconds }.
async function sttTranscribe(wavBuffer, langHint = 'unknown') {
  return withRetry(async () => {
    const form = new FormData();
    form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'turn.wav');
    form.append('model', process.env.STT_MODEL || 'saaras:v3');
    form.append('language_code', langHint); // BCP-47 hint (e.g. te-IN, hi-IN) to skip auto-detect latency
    const res = await fetch(`${SARVAM}/speech-to-text`, {
      method: 'POST',
      headers: { 'api-subscription-key': key() },
      body: form,
    });
    if (!res.ok) throw new Error(`Sarvam STT ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    // WAV duration ≈ (bytes - 44) / (sampleRate * 2); read the rate from the header
    const rate = wavBuffer.length > 28 ? wavBuffer.readUInt32LE(24) : 16000;
    j.seconds = Math.round(((wavBuffer.length - 44) / (rate * 2)) * 10) / 10;
    return j;
  }, 'STT');
}

// ---------- LLM ----------
// Returns { text, usage: {prompt_tokens, completion_tokens} }.
async function llmChat(messages, opts = {}) {
  return withRetry(async () => {
    const res = await fetch(`${SARVAM}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'api-subscription-key': key(),
        Authorization: `Bearer ${key()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'sarvam-30b',
        messages,
        // Low temp = script adherence. The personas are built on VERBATIM scripts; at 0.75
        // the model paraphrased them into generic counselor-speak (field bug 2026-07-03).
        temperature: opts.temperature ?? (process.env.LLM_TEMPERATURE ? Number(process.env.LLM_TEMPERATURE) : 0.45),
        max_tokens: opts.maxTokens ?? 220,
        reasoning_effort: null, // live call: speed beats depth (disable thinking completely)
      }),
    });
    if (!res.ok) throw new Error(`Sarvam LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    const text = (j.choices?.[0]?.message?.content || '')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();
    return { text, usage: j.usage || {} };
  }, 'LLM');
}

// ---------- TTS ----------
// Emotion -> delivery. pace = speed, temperature = expressiveness (bulbul:v3).
const EMOTION_STYLE = {
  warm: { pace: 1.0, temperature: 0.6 },
  excited: { pace: 1.08, temperature: 0.95 },
  empathetic: { pace: 0.9, temperature: 0.5 },
  calm: { pace: 0.95, temperature: 0.4 },
  urgent: { pace: 1.12, temperature: 0.8 },
  amused: { pace: 1.04, temperature: 0.9 },
  reassuring: { pace: 0.93, temperature: 0.55 },
  concerned: { pace: 0.9, temperature: 0.5 },
  proud: { pace: 1.05, temperature: 0.85 },
  gentle: { pace: 0.86, temperature: 0.45 }, // sensitive news — slower, softer, low energy
  encouraging: { pace: 1.02, temperature: 0.75 }, // lifting a doubting parent — upbeat, not excited
  apologetic: { pace: 0.92, temperature: 0.5 }, // misheard / made a mistake — brief and sincere
  serious: { pace: 0.95, temperature: 0.35 }, // fees, dates, commitments — steady, no cheer
};
const TTS_LANGS = new Set(['te-IN', 'hi-IN', 'en-IN', 'ta-IN', 'kn-IN', 'ml-IN', 'mr-IN']);

async function ttsRaw(text, lang, emotion, opts = {}) {
  const style = EMOTION_STYLE[emotion] || EMOTION_STYLE.warm;
  return withRetry(async () => {
    const res = await fetch(`${SARVAM}/text-to-speech`, {
      method: 'POST',
      headers: { 'api-subscription-key': key(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text.slice(0, 1400),
        target_language_code: TTS_LANGS.has(lang) ? lang : 'en-IN',
        model: 'bulbul:v3',
        speaker: process.env.AGENT_VOICE || 'simran',
        pace: style.pace,
        temperature: style.temperature,
        speech_sample_rate: opts.sampleRate || 48000, // 48 kHz high quality (best clarity)
        output_audio_codec: opts.codec || 'mp3',
      }),
    });
    if (!res.ok) throw new Error(`Sarvam TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    return j.audios?.[0] || '';
  }, 'TTS');
}

// Split a reply into <=2 chunks at sentence boundaries and synthesize them IN PARALLEL,
// so audio for the first sentence arrives ~2x sooner on long replies (premortem #2).
// Threshold 200: short/medium replies stay one TTS call so there is never a prosody seam (premortem N2).
async function ttsSpeak(text, lang, emotion, opts = {}) {
  const clean = text.trim();
  if (clean.length <= 200) return [await ttsRaw(clean, lang, emotion, opts)].filter(Boolean);
  const sentences = clean.match(/[^.!?।॥…]+[.!?।॥…]+["']?\s*|[^.!?।॥…]+$/g) || [clean];
  let first = sentences[0].trim();
  // keep the first chunk short so it starts playing fast; everything else is chunk two
  const rest = clean.slice(clean.indexOf(first) + first.length).trim();
  if (!rest) return [await ttsRaw(clean, lang, emotion, opts)].filter(Boolean);
  const audios = await Promise.all([
    ttsRaw(first, lang, emotion, opts),
    ttsRaw(rest, lang, emotion, opts),
  ]);
  return audios.filter(Boolean);
}

// ---------- acknowledgement clips (latency mask, premortem #1/#2) ----------
// Short human sounds played while the LLM thinks. Generated once, cached on disk.
// Premortem N1 fix: strictly NEUTRAL murmurs only — no cheerful agreement sounds that could
// land wrong right after a parent says something sad. Cache key includes phrase+voice so
// changing either regenerates the clips instead of replaying stale audio.
const ACK_PHRASES = {
  'te-IN': ['హ్మ్…', 'హ్మ్, ఒక్క క్షణం…'],
  'hi-IN': ['हम्म…', 'हम्म, एक सेकंड…'],
  'en-IN': ['Hmm…', 'Mm, one second…'],
};

async function ackClips(lang) {
  const l = ACK_PHRASES[lang] ? lang : 'en-IN';
  const voice = process.env.AGENT_VOICE || 'simran';
  const out = [];
  for (let i = 0; i < ACK_PHRASES[l].length; i++) {
    const sig = crypto.createHash('md5').update(voice + '|' + ACK_PHRASES[l][i]).digest('hex').slice(0, 8);
    const file = path.join(CACHE_DIR, `ack-${l}-${i}-${sig}.mp3.b64`);
    if (fs.existsSync(file)) {
      out.push(fs.readFileSync(file, 'utf8'));
      continue;
    }
    try {
      const b64 = await ttsRaw(ACK_PHRASES[l][i], l, 'calm');
      if (b64) {
        fs.writeFileSync(file, b64);
        out.push(b64);
      }
    } catch (e) {
      console.warn(`ack clip ${l}#${i} failed: ${e.message}`); // non-fatal — call works without acks
    }
  }
  return out;
}

module.exports = { sttTranscribe, llmChat, ttsSpeak, ttsRaw, ackClips, EMOTION_STYLE, TTS_LANGS, serviceHealth };
