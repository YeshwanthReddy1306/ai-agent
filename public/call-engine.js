/* ============================================================================
   call-engine.js — the web-call loop, with ZERO DOM coupling.
   Faithfully extracted from the proven logic in app.js (mic + adaptive VAD +
   pre-speech buffer + 16k WAV encode + streaming NDJSON turns + gapless playback
   + barge-in). Callers drive their own UI via the callbacks in `on`.

   ponytail: app.js still carries its own copy of this loop. Phase 6 migrates the
   console onto this engine and deletes the duplicate — tracked, not forgotten.

   Usage:
     const call = CallEngine({ onPhase, onUserTurn, onAgentTurn, onSummary, onError });
     await call.start(leadId);  call.bargeIn();  await call.end();
   ============================================================================ */
'use strict';

function CallEngine(on = {}) {
  const s = {
    callId: null, agentLang: 'en-IN', phase: 'idle',
    ctx: null, stream: null, proc: null, sampleRate: 48000,
    chunks: [], preBuffer: [], speaking: false, speechFrames: 0, silentFrames: 0, noiseFloor: 0.004,
    // Web-Audio scheduled playback (replaces HTMLAudioElement handoff — see PLAYBACK below):
    actx: null, playHead: 0, streamBuffer: [], scheduleIndex: 0, streamEnd: false,
    decodeChain: Promise.resolve(), sources: [], finalizeTimer: null,
    turnController: null, lastWav: null, pendingEnd: false,
    startedAt: 0,
  };

  const emit = (fn, ...a) => { try { on[fn] && on[fn](...a); } catch (e) { console.error(e); } };
  const setPhase = (p) => { s.phase = p; emit('onPhase', p); };
  const jsonOrThrow = (r) => r.json().then((j) => {
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  });

  /* ---------------- mic + adaptive VAD ---------------- */
  async function initMic() {
    if (s.ctx) return;
    s.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    s.ctx = new (window.AudioContext || window.webkitAudioContext)();
    s.sampleRate = s.ctx.sampleRate;
    const src = s.ctx.createMediaStreamSource(s.stream);
    s.proc = s.ctx.createScriptProcessor(4096, 1, 1);
    src.connect(s.proc);
    s.proc.connect(s.ctx.destination);          // outputs silence; some browsers require it
    s.proc.onaudioprocess = (e) => onFrame(e.inputBuffer.getChannelData(0));
  }
  function stopMic() {
    if (s.proc) s.proc.disconnect();
    if (s.stream) s.stream.getTracks().forEach((t) => t.stop());
    if (s.ctx) s.ctx.close();
    s.ctx = s.stream = s.proc = null;
  }
  function listen() {
    s.chunks = []; s.preBuffer = [];
    s.speaking = false; s.speechFrames = 0; s.silentFrames = 0;
    setPhase('listening');
  }
  function onFrame(f32) {
    if (s.phase !== 'listening') return;
    let sum = 0;
    for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
    const rms = Math.sqrt(sum / f32.length);
    const threshold = Math.max(0.012, s.noiseFloor * 3);
    const frameMs = (f32.length / s.sampleRate) * 1000;

    if (!s.speaking) {                                  // rolling pre-buffer: no clipped first syllable
      s.preBuffer.push(new Float32Array(f32));
      if (s.preBuffer.length > 6) s.preBuffer.shift();  // ~0.5s
    }
    if (rms > threshold) {
      s.speechFrames++; s.silentFrames = 0;
      if (!s.speaking && s.speechFrames >= 2) { s.speaking = true; s.chunks = [...s.preBuffer]; }
    } else {
      if (!s.speaking) s.noiseFloor = s.noiseFloor * 0.95 + rms * 0.05;   // adapt to the room
      s.silentFrames++; s.speechFrames = 0;
    }
    if (s.speaking) s.chunks.push(new Float32Array(f32));

    const uttMs = s.chunks.length * frameMs;
    const endpointMs = uttMs < 1200 ? 280 : 400;        // short replies end fast; long ones aren't cut
    if ((s.speaking && s.silentFrames * frameMs > endpointMs) || uttMs > 15000) {
      if (s.speaking) sendTurn(); else listen();
    }
  }

  /* ============================ PLAYBACK — Web Audio scheduled ============================
     HTMLAudioElement playback handed off on the `onended` JS event, so any timing jitter left
     a gap ("sometimes stutter"). Instead we schedule every batch on the audio HARDWARE clock:
     each batch starts exactly where the previous ends (playHead += buffer.duration), decided
     ahead of time, with no JS event in the critical path.

     Audio is linear16 PCM (no MP3 encoder-padding, byte-concatenatable => truly gapless). The
     greeting still arrives as MP3 (a single blob, no gapless concern) and is decoded via
     decodeAudioData; each entry carries its own {format, rate}. A ~150ms lead absorbs jitter. */
  const AUDIO = { lead: 0.15 };

  function actx() {
    if (!s.actx) s.actx = new (window.AudioContext || window.webkitAudioContext)();
    if (s.actx.state === 'suspended') s.actx.resume().catch(() => {});
    return s.actx;
  }
  function mergeBytes(b64s) {
    let bin = '';
    for (const b of b64s) bin += atob(b);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  function pcm16ToBuffer(bytes, rate) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = bytes.byteLength >> 1;                   // int16 mono
    const buf = actx().createBuffer(1, n, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
    return buf;
  }
  async function toBuffer(entry) {
    const bytes = mergeBytes(entry.b64s);
    if (entry.format === 'pcm16') return pcm16ToBuffer(bytes, entry.rate || 24000);
    // mp3 / other encoded -> async decode (greeting path)
    return actx().decodeAudioData(bytes.buffer.slice(0));
  }

  // Pull every in-order batch that has arrived and schedule it back-to-back on the audio clock.
  function pump() {
    while (s.scheduleIndex in s.streamBuffer) {
      const entry = s.streamBuffer[s.scheduleIndex++];
      if (!entry || !entry.b64s || !entry.b64s.length) continue;
      s.decodeChain = s.decodeChain.then(async () => {
        if (!s.callId) return;
        let buf;
        try { buf = await toBuffer(entry); } catch (e) { console.error('decode failed', e); return; }
        const ctx = actx();
        const now = ctx.currentTime;
        if (s.playHead < now) s.playHead = now + AUDIO.lead;   // first batch, or recover from underrun
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        try { src.start(s.playHead); } catch { /* ctx closed */ return; }
        s.playHead += buf.duration;
        s.sources.push(src);
      }).catch(() => {});
    }
    scheduleFinalize();
  }

  // After the stream ends AND all queued batches are decoded, transition when the audio clock
  // reaches the end of the last scheduled buffer.
  function scheduleFinalize() {
    if (!s.streamEnd) return;
    s.decodeChain = s.decodeChain.then(() => {
      if (!s.streamEnd || (s.scheduleIndex in s.streamBuffer)) return; // more arrived; pump handles it
      const ctx = actx();
      const wait = Math.max(0, s.playHead - ctx.currentTime);
      clearTimeout(s.finalizeTimer);
      s.finalizeTimer = setTimeout(() => {
        if (!s.callId) return;
        if (s.pendingEnd) return end();
        listen();
      }, wait * 1000 + 40);
    }).catch(() => {});
  }

  function stopPlayback() {
    if (s.turnController) { s.turnController.abort(); s.turnController = null; }
    clearTimeout(s.finalizeTimer); s.finalizeTimer = null;
    for (const src of s.sources) { try { src.onended = null; src.stop(); } catch { /* already ended */ } }
    s.sources = [];
    s.streamBuffer = []; s.scheduleIndex = 0; s.streamEnd = false;
    s.playHead = 0; s.decodeChain = Promise.resolve();
  }

  /* ---------------- a turn ---------------- */
  async function sendTurn(retried) {
    setPhase('thinking');
    const wav = retried ? s.lastWav : encodeWav(s.chunks, s.sampleRate);
    s.lastWav = wav; s.chunks = [];
    try {
      s.turnController = new AbortController();
      const r = await fetch('/api/call/turn', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: s.callId, audio: wav }),
        signal: s.turnController.signal,
      });
      if (!s.callId) return;                              // ended while waiting

      if ((r.headers.get('content-type') || '').includes('application/json')) {
        const j = await r.json();
        if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
        if (j.empty) return listen();                     // noise, not speech
      } else if (!r.ok) throw new Error(`HTTP ${r.status}`);

      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '', sawUser = false, speakingStarted = false;
      // Reset the Web Audio scheduler for the NEW turn. This MUST clear scheduleIndex, playHead
      // and decodeChain — leaving them at the previous turn's values meant turn 2+ audio (which
      // arrives at index 0) was never scheduled (pump looked for the stale index), so every turn
      // after the first was silent and dropped straight to listening.
      clearTimeout(s.finalizeTimer); s.finalizeTimer = null;
      for (const src of s.sources) { try { src.onended = null; src.stop(); } catch { /* ended */ } }
      s.sources = [];
      s.streamBuffer = []; s.streamEnd = false;
      s.scheduleIndex = 0; s.playHead = 0; s.decodeChain = Promise.resolve();

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const m = JSON.parse(line);
          if (m.type === 'start') {
            if (!sawUser) { emit('onUserTurn', { text: m.userText, lang: m.userLang }); sawUser = true; }
            if (m.wrapUp) s.pendingEnd = true;
          } else if (m.type === 'text') {
            s.agentLang = m.lang || s.agentLang;
            if (!speakingStarted) { setPhase('speaking'); speakingStarted = true; }
            emit('onAgentTurn', { text: m.text, lang: m.lang, emotion: m.emotion });
          } else if (m.type === 'audio') {
            s.streamBuffer[m.index] = { b64s: m.audios, format: m.format || 'pcm16', rate: m.rate || 24000 };
            pump();
          } else if (m.type === 'end') {
            s.streamEnd = true; pump();
          }
        }
      }
      s.streamEnd = true; pump();
    } catch (e) {
      if (!s.callId) return;
      if (!retried) return sendTurn(true);                // one automatic retry
      fail(e);
    }
  }

  /* ---------------- public API ---------------- */
  async function start(leadId) {
    s.pendingEnd = false;
    setPhase('dialing');
    try {
      await initMic();                                    // ask permission up front
      const r = await fetch('/api/call/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      }).then(jsonOrThrow);
      s.callId = r.callId;
      s.startedAt = Date.now();
      s.agentLang = (r.reply && r.reply.lang) || s.agentLang;
      emit('onAgentTurn', { text: r.reply.text, lang: r.reply.lang, emotion: r.reply.emotion });
      if (!r.audios || !r.audios.length) return s.pendingEnd ? end() : listen();
      setPhase('speaking');
      stopPlayback();
      // greeting is a cached MP3 blob (single file, no gapless concern) — decode as mp3
      s.streamBuffer[0] = { b64s: r.audios.slice(), format: r.format || 'mp3', rate: r.rate || 48000 };
      s.streamEnd = true;
      pump();
      return r;
    } catch (e) { fail(e); throw e; }
  }

  async function end() {
    stopPlayback(); stopMic();
    const callId = s.callId;
    s.callId = null;
    setPhase('wrapping');
    if (!callId) { setPhase('idle'); return null; }
    try {
      const sum = await fetch('/api/call/end', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId }),
      }).then(jsonOrThrow);
      setPhase('idle');
      emit('onSummary', sum);
      return sum;
    } catch (e) { setPhase('idle'); emit('onError', e); return null; }
  }

  function bargeIn() {                                    // tap while she speaks
    if (s.phase !== 'speaking') return;
    stopPlayback();
    listen();
  }

  function fail(e) {
    const msg = /Permission denied|NotAllowed/i.test(String(e))
      ? 'Microphone blocked — allow mic access for this site and try again.'
      : e.message;
    stopPlayback(); stopMic();
    s.callId = null;
    setPhase('idle');
    emit('onError', new Error(msg));
  }

  /* ---------------- WAV: downsample to 16k mono PCM16 -> base64 ---------------- */
  function encodeWav(chunks, inRate) {
    let len = 0;
    for (const c of chunks) len += c.length;
    const input = new Float32Array(len);
    let off = 0;
    for (const c of chunks) { input.set(c, off); off += c.length; }

    const outRate = 16000;
    const ratio = inRate / outRate;
    const outLen = Math.floor(input.length / ratio);
    const pcm = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const a = Math.floor(i * ratio), b = Math.min(Math.floor((i + 1) * ratio), input.length);
      let acc = 0;
      for (let j = a; j < b; j++) acc += input[j];
      acc /= Math.max(1, b - a);
      pcm[i] = Math.max(-1, Math.min(1, acc)) * 0x7fff;
    }
    const buf = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(buf);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, outRate, true); v.setUint32(28, outRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    new Int16Array(buf, 44).set(pcm);
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  return { start, end, bargeIn, get phase() { return s.phase; }, get callId() { return s.callId; },
           get elapsedSec() { return s.startedAt ? Math.floor((Date.now() - s.startedAt) / 1000) : 0; } };
}
