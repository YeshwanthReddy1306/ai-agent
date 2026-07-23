const WebSocket = require('ws');
const events = require('events');

const API_KEY = process.env.SARVAM_API_KEY || '';

// STT WebSocket Stream Client
class SttStream extends events.EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.connected = false;
    this.audioBuffer = [];
  }

  connect() {
    // Phase 1 spec: mandatory language-code=unknown, vad_signals=true
    const url = `wss://api.sarvam.ai/speech-to-text/ws?model=saaras:v3&language-code=unknown&mode=transcribe&sample_rate=8000&input_audio_codec=pcm_s16le&vad_signals=true`;
    
    this.ws = new WebSocket(url, {
      headers: {
        'Api-Subscription-Key': API_KEY
      }
    });

    this.ws.on('open', () => {
      this.connected = true;
      this.emit('connected');
      // Drain any buffered audio sent before connection opened
      while (this.audioBuffer.length > 0) {
        this.ws.send(this.audioBuffer.shift());
      }
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'events' && msg.data?.event_type === 'vad') {
          if (msg.data.signal_type === 'START_SPEECH') {
            this.emit('start_speech');
          } else if (msg.data.signal_type === 'END_SPEECH') {
            this.emit('end_speech');
          }
        } else if (msg.type === 'data') {
          this.emit('transcript', msg.data);
        } else if (msg.type === 'error') {
          console.error('[stt-stream] error:', msg.data);
          this.emit('error', new Error(msg.data.error || 'Unknown STT WS error'));
        }
      } catch (e) {
        console.error('[stt-stream] invalid message:', e.message);
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      this.emit('close');
    });

    this.ws.on('error', (err) => {
      console.error('[stt-stream] WS error:', err.message);
      this.emit('error', err);
    });
  }

  sendAudio(pcmBuf) {
    const payload = JSON.stringify({
      audio: {
        data: pcmBuf.toString('base64'),
        sample_rate: '8000',
        encoding: 'audio/wav' // as specified by Sarvam docs for pcm
      }
    });
    if (this.connected) {
      this.ws.send(payload);
    } else {
      this.audioBuffer.push(payload);
    }
  }

  flush() {
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'flush' }));
    }
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}

// ---------- Phase 2: Streaming LLM Client ----------
// Async generator that yields complete sentences from the LLM (Sarvam or Groq).
async function* brainChatStream(messages, lang, opts = {}) {
  const isEnglish = (lang === 'en-IN' && process.env.GROQ_API_KEY);
  
  if (isEnglish) {
    yield* groqChatStream(messages, opts);
  } else {
    yield* sarvamChatStream(messages, opts);
  }
}

async function* groqChatStream(messages, opts) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages,
      temperature: opts.temperature ?? 0.6,
      max_tokens: opts.maxTokens ?? 220,
      stream: true,
      stream_options: { include_usage: true }
    })
  });

  if (!res.ok) throw new Error(`Groq stream failed: ${res.status}`);
  yield* parseSseTokens(res.body);
}

async function* sarvamChatStream(messages, opts) {
  const res = await fetch('https://api.sarvam.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'api-subscription-key': API_KEY,
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: opts.model || process.env.LLM_MODEL || 'sarvam-105b',
      messages,
      temperature: opts.temperature ?? (process.env.LLM_TEMPERATURE ? Number(process.env.LLM_TEMPERATURE) : 0.45),
      // FIX 2: 220 (was 800) — matches the non-streaming path. The persona wants 1-2 short
      // sentences; an 800-token budget invites rambling and longer thinking.
      max_tokens: opts.maxTokens ?? 220,
      // FIX 1: the big one. lib/sarvam.js has set this since day one ("live call: speed beats
      // depth — disable thinking completely") but it was dropped when the streaming path was
      // written. Without it sarvam-105b silently THINKS before it speaks — measured at ~6s of
      // dead air per turn on the web call path.
      reasoning_effort: null,
      stream: true,
      stream_options: { include_usage: true }
    })
  });

  if (!res.ok) throw new Error(`Sarvam stream failed: ${res.status}`);
  yield* parseSseTokens(res.body);
}

// Consumes standard OpenAI SSE format and chunks by sentence boundaries.
//
// FIX 3 — <think> containment. The non-streaming path strips think-blocks at the END of the
// request (lib/sarvam.js: .replace(/<think>[\s\S]*?<\/think>/g, '')). A streaming parser can't
// wait for the end: it yields on the first period it sees. So if the model ever emits a
// think-block (reasoning models do this even with reasoning_effort disabled), the old parser
// would hand Sneha's inner monologue straight to TTS and she would SPEAK IT to the parent.
// We therefore clean the accumulated text on every token and only ever emit from the cleaned
// view — an unterminated <think> suppresses everything after it until it closes.
function stripThink(s) {
  const out = s.replace(/<think>[\s\S]*?<\/think>/gi, '');   // drop complete blocks
  const open = out.search(/<think>/i);                       // a block still open?
  return open === -1 ? out : out.slice(0, open);             // never speak past it
}

async function* parseSseTokens(readableStream) {
  const decoder = new TextDecoder('utf-8');
  const reader = readableStream.getReader();
  let buffer = '';
  let raw = '';        // everything the model has emitted, verbatim
  let emitted = 0;     // how many chars of the CLEANED text we've already yielded

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep the incomplete line in the buffer

        for (const line of lines.map((l) => l.trim())) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.usage) yield { usage: data.usage };
            const token = data.choices?.[0]?.delta?.content || '';
            if (!token) continue;
            raw += token;

            // Emit every COMPLETE sentence available in the cleaned view.
            const cleaned = stripThink(raw);
            let m;
            while ((m = cleaned.slice(emitted).match(/^([\s\S]*?[.!?।॥…]+["']?)(\s*)/))) {
              const out = m[1].trim();
              emitted += m[0].length;
              if (out) yield out;
            }
          } catch { /* ignore partial/invalid SSE chunks */ }
        }
      }
      if (done) break;
    }
    // flush whatever tail is left (a reply with no terminal punctuation)
    const tail = stripThink(raw).slice(emitted).trim();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

// ---------- Phase 3: Streaming TTS Client ----------
// Streaming TTS over Sarvam's WebSocket. Audio chunks arrive AS THEY ARE SYNTHESISED, so the
// first syllable reaches the caller in a few hundred ms instead of waiting ~3.4s for the REST
// endpoint to render the whole file (measured).
//
// PROTOCOL (per Sarvam's official WS docs — the earlier implementation invented its own shape
// and would have produced silence):
//   client -> { "type":"config", "data":{...} } | { "type":"text", "data":{"text":"…"} } | { "type":"flush" }
//   server -> { "type":"audio", "data":{"audio":"<base64>"} }
//             { "type":"event", "data":{"event_type":"final"} }
//             { "type":"error", "data":{"message":"…"} }
class TtsStream extends events.EventEmitter {
  constructor(lang, emotion, pace, temperature, codec, opts = {}) {
    super();
    this.ws = null;
    this.connected = false;
    this.pending = [];        // text queued before the socket opened
    this.configSent = false;
    this.closed = false;

    this.configMessage = JSON.stringify({
      type: 'config',
      data: {
        target_language_code: lang,
        model: 'bulbul:v3',
        speaker: process.env.AGENT_VOICE || 'simran',
        pace: pace || 0.88,
        temperature: temperature || 0.6,
        // caller decides: phone wants 8k mulaw, web wants mp3 at a normal rate
        speech_sample_rate: String(opts.sampleRate || 22050),
        output_audio_codec: codec || 'mp3',
        // latency dial: how much text buffers before synthesis starts (default 50).
        // Lower = first chunk sooner; too low = choppy chunks.
        min_buffer_size: opts.minBufferSize || 30,
        max_chunk_length: opts.maxChunkLength || 150,
      },
    });
  }

  connect() {
    // Two query params, both load-bearing (learned the hard way):
    //  · model      — the socket defaults to bulbul:v2 otherwise, which REJECTS our v3 speaker
    //                 ("simran is not compatible with bulbul:v2"). The config-body model is ignored.
    //  · send_completion_event — docs say it defaults to true. It does NOT. Without it the
    //                 'final' event never arrives and the reply never terminates.
    this.ws = new WebSocket(
      'wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3&send_completion_event=true',
      { headers: { 'Api-Subscription-Key': API_KEY } }
    );

    this.ws.on('open', () => {
      this.connected = true;
      this.ws.send(this.configMessage);      // config MUST be the first message
      this.configSent = true;
      this.emit('connected');
      while (this.pending.length) this.ws.send(this.pending.shift());
    });

    this.ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'audio') {
        const b64 = msg.data && msg.data.audio;
        if (b64) this.emit('audio', b64);
      } else if (msg.type === 'event') {
        if (msg.data && msg.data.event_type === 'final') this.emit('final');
      } else if (msg.type === 'error') {
        const m = (msg.data && (msg.data.message || msg.data.error)) || 'tts stream error';
        console.error('[tts-stream] error:', m);
        this.emit('error', new Error(m));
      }
    });

    this.ws.on('close', () => { this.connected = false; this.emit('close'); });
    this.ws.on('error', (err) => { this.emit('error', err); });
  }

  sendText(text) {
    if (!text || this.closed) return;
    const payload = JSON.stringify({ type: 'text', data: { text } });
    if (this.connected && this.configSent) this.ws.send(payload);
    else this.pending.push(payload);
  }

  flush() {
    const payload = JSON.stringify({ type: 'flush' });
    if (this.connected && this.ws.readyState === WebSocket.OPEN) this.ws.send(payload);
    else this.pending.push(payload);
  }

  close() {
    this.closed = true;
    if (this.ws) { try { this.ws.close(); } catch { /* already gone */ } this.ws = null; }
    this.connected = false;
  }
}

module.exports = {
  SttStream,
  TtsStream,
  brainChatStream
};
