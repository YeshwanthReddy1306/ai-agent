/* Phoenix Voice — call console (v2).
   Hands-free loop: agent greets -> VAD detects your end-of-speech -> /api/call/turn
   -> reply plays -> listens again. Tap the orb to interrupt (barge-in).
   v2: pre-speech buffer (no clipped first syllable), thinking-acks that mask latency,
   multi-chunk gapless playback, auto-retry, call history. */

const $ = (id) => document.getElementById(id);
const state = {
  leads: [], lead: null, callId: null, agentName: 'Simran', agentLang: 'en-IN',
  phase: 'idle', // idle | dialing | speaking | listening | thinking | ended
  timerStart: 0, timerInt: null,
  audioEl: null, audioQueue: [],
  acks: {}, ackEl: null, ackTimer: null, // lang -> [b64]; played while thinking
  pendingEnd: false,
  // capture
  ctx: null, stream: null, proc: null,
  chunks: [], preBuffer: [], sampleRate: 48000,
  speaking: false, speechFrames: 0, silentFrames: 0, noiseFloor: 0.004,
};

// ---------- boot ----------
(async function boot() {
  const health = await fetch('/api/health').then((r) => r.json()).catch(() => null);
  if (health) {
    state.agentName = health.agent || 'Simran';
    $('collegeName').textContent = health.college;
    $('orbCore').textContent = state.agentName[0];
    $('healthDot').className = 'dot ' + (health.hasKey ? 'ok' : 'bad');
    $('healthText').textContent = health.hasKey
      ? `${health.agent} ready · ${health.model} · ${health.voice}`
      : 'API key missing';
    if (!health.hasKey) $('keyBanner').classList.remove('hidden');
  } else {
    $('healthDot').className = 'dot bad';
    $('healthText').textContent = 'server unreachable';
  }
  state.leads = await fetch('/api/leads').then((r) => r.json()).catch(() => []);
  renderLeads();
  renderHistory();
  resetTranscript();
})();

function resetTranscript() {
  $('transcript').innerHTML = '<div class="transcript-empty">Transcript will appear here during the call.</div>';
}

function renderLeads() {
  const box = $('leadList');
  box.innerHTML = '';
  for (const l of state.leads) {
    const el = document.createElement('div');
    el.className = 'lead-card' + (state.lead?.id === l.id ? ' active' : '');
    el.innerHTML = `
      <div class="lead-top"><span class="lead-name">${l.parentName}</span><span class="lead-lang">${l.language}</span></div>
      <div class="lead-meta"><b>${l.studentName}</b> · ${l.tenthResult} · wants <b>${l.interest}</b><br>${l.area} · ${l.source}</div>`;
    el.onclick = () => {
      if (state.phase !== 'idle') return;
      state.lead = l;
      renderLeads();
      $('btnStart').disabled = false;
      $('callTitle').textContent = `Ready to call ${l.parentName} about ${l.studentName}`;
    };
    box.appendChild(el);
  }
}

async function renderHistory() {
  const rows = await fetch('/api/calls').then((r) => r.json()).catch(() => []);
  const box = $('historyList');
  if (!rows.length) { box.innerHTML = '<div class="history-empty">No calls yet.</div>'; return; }
  box.innerHTML = rows
    .map(
      (r) => `<div class="history-item">
        <span class="badge sm ${r.interest}">${r.interest}</span>
        <span class="history-name">${r.parent}</span>
        <span class="history-meta">${Math.floor(r.durationSec / 60)}m${String(r.durationSec % 60).padStart(2, '0')}s</span>
      </div>`
    )
    .join('');
}

// ---------- phases / UI ----------
function setPhase(phase, label) {
  state.phase = phase;
  const orb = $('orb');
  orb.className = 'orb ' + (phase === 'speaking' ? 'speaking' : phase === 'listening' ? 'listening' : phase === 'thinking' || phase === 'dialing' ? 'thinking' : 'idle');
  $('stateText').textContent = label || '';
  $('micBars').classList.toggle('hidden', phase !== 'listening');
}

function addBubble(who, text, chips = []) {
  const t = $('transcript');
  t.querySelector('.transcript-empty')?.remove();
  const b = document.createElement('div');
  b.className = 'bubble ' + who;
  b.textContent = text;
  if (chips.filter(Boolean).length) {
    const c = document.createElement('div');
    c.className = 'chips';
    c.innerHTML = chips.filter(Boolean).map((x) => `<span class="chip">${x}</span>`).join('');
    b.appendChild(c);
  }
  t.appendChild(b);
  t.scrollTop = t.scrollHeight;
}

function startTimer() {
  state.timerStart = Date.now();
  state.timerInt = setInterval(() => {
    const s = Math.floor((Date.now() - state.timerStart) / 1000);
    $('timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 500);
}

// ---------- call control ----------
$('btnStart').onclick = startCall;
$('btnEnd').onclick = endCall;
$('btnCloseSummary').onclick = () => {
  $('summaryOverlay').classList.add('hidden');
  resetTranscript();
  $('timer').textContent = '00:00';
  $('callTitle').textContent = 'Select a lead and start the call';
  setPhase('idle', 'Idle');
};
$('orb').onclick = () => {
  // barge-in: interrupt the agent mid-sentence
  if (state.phase === 'speaking') {
    stopPlayback();
    startListening();
  }
};

async function startCall() {
  if (!state.lead) return;
  $('btnStart').classList.add('hidden');
  $('btnEnd').classList.remove('hidden');
  state.pendingEnd = false;
  setPhase('dialing', 'Connecting…');
  $('callTitle').textContent = `On call · ${state.lead.parentName} (${state.lead.phone})`;
  try {
    await initMic(); // permission up front so the loop is seamless
    const r = await fetch('/api/call/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: state.lead.id }),
    }).then(jsonOrThrow);
    state.callId = r.callId;
    startTimer();
    loadAcks(r.reply.lang); // warm the ack cache in the background
    playReply(r.reply, r.audios);
  } catch (e) {
    failCall(e);
  }
}

async function endCall() {
  clearInterval(state.timerInt);
  stopPlayback();
  stopAck();
  stopMic();
  const callId = state.callId;
  state.callId = null;
  setPhase('thinking', 'Wrapping up…');
  $('btnEnd').classList.add('hidden');
  $('btnStart').classList.remove('hidden');
  if (!callId) return setPhase('idle', 'Idle');
  try {
    const s = await fetch('/api/call/end', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId }),
    }).then(jsonOrThrow);
    $('sumInterest').textContent = s.interest;
    $('sumInterest').className = 'badge ' + s.interest;
    $('sumText').textContent = s.summary;
    $('sumNext').textContent = s.nextAction || '—';
    $('sumObjections').textContent = (s.objections || []).join(', ') || 'None raised';
    const u = s.usage || {};
    $('sumDuration').textContent = `${s.durationSec}s · ${s.turns} turns · ${u.sttSeconds || 0}s STT · ${u.llmTokens || 0} tokens · ${u.ttsChars || 0} TTS chars`;
    $('summaryOverlay').classList.remove('hidden');
    renderHistory();
  } catch {
    setPhase('idle', 'Idle');
  }
}

function failCall(e) {
  console.error(e);
  const msg = /Permission denied|NotAllowed/i.test(String(e))
    ? 'Microphone blocked — allow mic access for this site and try again.'
    : e.message;
  addBubble('agent', `⚠ ${msg}`);
  clearInterval(state.timerInt);
  stopPlayback();
  stopAck();
  stopMic();
  state.callId = null;
  $('btnEnd').classList.add('hidden');
  $('btnStart').classList.remove('hidden');
  setPhase('idle', 'Call failed');
}

function jsonOrThrow(r) {
  return r.json().then((j) => {
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  });
}

// ---------- agent speech (multi-chunk gapless queue) ----------
function stopPlayback() {
  state.audioQueue = [];
  if (state.audioEl) { state.audioEl.onended = null; state.audioEl.pause(); state.audioEl = null; }
}

function playReply(reply, audios) {
  stopAck();
  state.agentLang = reply.lang || state.agentLang;
  addBubble('agent', reply.text, [reply.lang, reply.emotion, reply._latency]);
  if (!audios || !audios.length) {
    // TTS degraded — text is on screen, keep the conversation alive
    return state.pendingEnd ? endCall() : startListening();
  }
  setPhase('speaking', `${state.agentName} is speaking — tap the circle to interrupt`);
  state.audioQueue = audios.slice(1);
  playChunk(audios[0]);
}

function playChunk(b64) {
  const a = new Audio('data:audio/mp3;base64,' + b64);
  state.audioEl = a;
  a.onended = a.onerror = () => {
    state.audioEl = null;
    if (state.audioQueue.length) return playChunk(state.audioQueue.shift());
    if (state.pendingEnd) return endCall(); // wrap-up finished -> close the call
    if (state.callId) startListening();
  };
  a.play().catch(() => {
    state.audioEl = null;
    if (state.callId) startListening();
  });
}

// ---------- thinking-acks (mask pipeline latency with a human sound) ----------
async function loadAcks(lang) {
  if (state.acks[lang]) return;
  state.acks[lang] = [];
  try {
    const r = await fetch('/api/acks?lang=' + encodeURIComponent(lang)).then((x) => x.json());
    state.acks[lang] = r.clips || [];
  } catch { /* acks are a nicety, never fatal */ }
}

function scheduleAck(lang) {
  return; // Disable thinking acks completely to prevent robotic/unnatural "hum" repetition
  const clips = state.acks[lang] || state.acks['en-IN'] || [];
  if (!clips.length) return;
  // if the reply hasn't arrived within ~700ms, murmur an acknowledgement like a human would
  state.ackTimer = setTimeout(() => {
    if (state.phase !== 'thinking') return;
    const a = new Audio('data:audio/mp3;base64,' + clips[Math.floor(Math.random() * clips.length)]);
    a.volume = 0.9;
    state.ackEl = a;
    a.play().catch(() => {});
  }, 700);
}

function stopAck() {
  clearTimeout(state.ackTimer);
  state.ackTimer = null;
  if (state.ackEl) { state.ackEl.pause(); state.ackEl = null; }
}

// ---------- mic + VAD ----------
async function initMic() {
  if (state.ctx) return;
  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  state.ctx = new (window.AudioContext || window.webkitAudioContext)();
  state.sampleRate = state.ctx.sampleRate;
  const src = state.ctx.createMediaStreamSource(state.stream);
  state.proc = state.ctx.createScriptProcessor(4096, 1, 1);
  src.connect(state.proc);
  state.proc.connect(state.ctx.destination); // node outputs silence; required by some browsers
  state.proc.onaudioprocess = (e) => onAudioFrame(e.inputBuffer.getChannelData(0));
}

function stopMic() {
  state.proc?.disconnect();
  state.stream?.getTracks().forEach((t) => t.stop());
  state.ctx?.close();
  state.ctx = state.stream = state.proc = null;
}

function startListening() {
  state.chunks = [];
  state.preBuffer = [];
  state.speaking = false;
  state.speechFrames = 0;
  state.silentFrames = 0;
  setPhase('listening', 'Listening… speak naturally');
}

function onAudioFrame(f32) {
  if (state.phase !== 'listening') return;
  let sum = 0;
  for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
  const rms = Math.sqrt(sum / f32.length);
  const threshold = Math.max(0.012, state.noiseFloor * 3);
  const frameMs = (f32.length / state.sampleRate) * 1000;

  if (!state.speaking) {
    // rolling pre-buffer so the first syllable is never clipped
    state.preBuffer.push(new Float32Array(f32));
    if (state.preBuffer.length > 6) state.preBuffer.shift(); // ~0.5s
  }

  if (rms > threshold) {
    state.speechFrames++;
    state.silentFrames = 0;
    if (!state.speaking && state.speechFrames >= 2) {
      state.speaking = true;
      state.chunks = [...state.preBuffer]; // include the run-up audio
    }
  } else {
    if (!state.speaking) state.noiseFloor = state.noiseFloor * 0.95 + rms * 0.05; // adapt to room
    state.silentFrames++;
    state.speechFrames = 0;
  }

  if (state.speaking) state.chunks.push(new Float32Array(f32));

  const utteranceMs = state.chunks.length * frameMs;
  // Adaptive endpoint (premortem #4): quick replies ("haan", "avunu") still end fast at
  // 450ms, but longer sentences get 650ms so a mid-sentence pause isn't cut off — the
  // flat 400ms was truncating slow speakers ("9.99.99" GPAs in the call log). 15s cap.
  const endpointMs = utteranceMs < 1200 ? 450 : 650;
  if ((state.speaking && state.silentFrames * frameMs > endpointMs) || utteranceMs > 15000) {
    if (state.speaking) sendTurn();
    else startListening();
  }
}

async function sendTurn(retried) {
  setPhase('thinking', `${state.agentName} is thinking…`);
  if (!retried) scheduleAck(state.agentLang);
  const wav = retried ? state.lastWav : encodeWav(state.chunks, state.sampleRate);
  state.lastWav = wav;
  state.chunks = [];
  try {
    const r = await fetch('/api/call/turn', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId: state.callId, audio: wav }),
    }).then(jsonOrThrow);
    if (!state.callId) return; // call ended while waiting
    if (r.empty) { stopAck(); return startListening(); } // noise only
    addBubble('user', r.userText, [r.userLang || '']);
    if (r.timings) r.reply._latency = (r.timings.total / 1000).toFixed(1) + 's';
    if (r.wrapUp) state.pendingEnd = true; // server hit the call cap — end after this reply plays
    if (r.reply?.lang) loadAcks(r.reply.lang); // keep ack cache in the agent's language
    playReply(r.reply, r.audios);
  } catch (e) {
    stopAck();
    if (!state.callId) return;
    if (!retried) return sendTurn(true); // one automatic retry (network blips, 5xx)
    failCall(e);
  }
}

// ---------- WAV encode (downsample to 16 kHz mono PCM16, return base64) ----------
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
    const start = Math.floor(i * ratio), end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let s = 0;
    for (let j = start; j < end; j++) s += input[j];
    s /= Math.max(1, end - start);
    pcm[i] = Math.max(-1, Math.min(1, s)) * 0x7fff;
  }

  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); writeStr(8, 'WAVE');
  writeStr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, outRate, true); v.setUint32(28, outRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  writeStr(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);

  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
