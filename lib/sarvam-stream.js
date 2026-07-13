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
      model: opts.model || process.env.LLM_MODEL || 'sarvam-30b',
      messages,
      temperature: opts.temperature ?? (process.env.LLM_TEMPERATURE ? Number(process.env.LLM_TEMPERATURE) : 0.45),
      max_tokens: opts.maxTokens ?? 800,
      stream: true,
      stream_options: { include_usage: true }
    })
  });

  if (!res.ok) throw new Error(`Sarvam stream failed: ${res.status}`);
  yield* parseSseTokens(res.body);
}

// Consumes standard OpenAI SSE format and chunks by sentence boundaries
async function* parseSseTokens(readableStream) {
  const decoder = new TextDecoder('utf-8');
  const reader = readableStream.getReader();
  let buffer = '';
  let sentence = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        let lines = buffer.split('\n');
        buffer = lines.pop(); // keep the incomplete line in buffer

        for (let line of lines) {
          line = line.trim();
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.usage) {
                yield { usage: data.usage };
              }
              const delta = data.choices?.[0]?.delta || {};
              const token = delta.content || '';
              sentence += token;
              
              // Wait for a valid sentence boundary
              if (token.match(/[.!?।॥…]+$/) || token.match(/["']$/) && sentence.match(/[.!?।॥…]+["']?$/)) {
                if (sentence.trim().length > 0) {
                  yield sentence.trim();
                  sentence = '';
                }
              }
            } catch (e) {
              // Ignore parse errors on chunks
            }
          }
        }
      }
      if (done) break;
    }
    // Yield any remaining text
    if (sentence.trim().length > 0) {
      yield sentence.trim();
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------- Phase 3: Streaming TTS Client ----------
class TtsStream extends events.EventEmitter {
  constructor(lang, emotion, pace, temperature, codec) {
    super();
    this.ws = null;
    this.connected = false;
    this.audioBuffer = []; // We buffer text chunks if they arrive before connection opens
    
    // Per-reply connection requires we send the config message first
    this.configSent = false;
    this.configMessage = JSON.stringify({
      target_language_code: lang,
      model: 'bulbul:v3',
      speaker: process.env.AGENT_VOICE || 'simran',
      pace: pace || 0.88,
      temperature: temperature || 0.6,
      speech_sample_rate: 8000,
      output_audio_codec: codec || 'mulaw'
    });
  }

  connect() {
    const url = `wss://api.sarvam.ai/text-to-speech/ws`;
    this.ws = new WebSocket(url, {
      headers: {
        'Api-Subscription-Key': API_KEY
      }
    });

    this.ws.on('open', () => {
      this.connected = true;
      this.ws.send(this.configMessage);
      this.configSent = true;
      this.emit('connected');
      
      // Drain any buffered text
      while (this.audioBuffer.length > 0) {
        this.ws.send(this.audioBuffer.shift());
      }
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.event === 'audio') {
          this.emit('audio', msg.audio); // base64 mulaw payload
        } else if (msg.event === 'final') {
          this.emit('final');
        } else if (msg.event === 'error') {
          console.error('[tts-stream] error:', msg.error);
          this.emit('error', new Error(msg.error));
        }
      } catch (e) {
        console.error('[tts-stream] invalid message:', e.message);
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      this.emit('close');
    });

    this.ws.on('error', (err) => {
      console.error('[tts-stream] WS error:', err.message);
      this.emit('error', err);
    });
  }

  sendText(text) {
    const payload = JSON.stringify({
      inputs: [text]
    });
    if (this.connected && this.configSent) {
      this.ws.send(payload);
    } else {
      this.audioBuffer.push(payload);
    }
  }

  flush() {
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event: 'flush' }));
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

module.exports = {
  SttStream,
  TtsStream,
  brainChatStream
};
