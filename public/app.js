/* Phoenix Voice — call console.
   Flow: start -> agent greets (TTS) -> hands-free loop:
   listen (VAD detects end of speech) -> /api/call/turn -> play reply -> listen again.
   Tap the orb while the agent is speaking to interrupt (barge-in). */

const $ = (id) => document.getElementById(id);
const state = {
  leads: [],
  lead: null,
  callId: null,
  phase: 'idle', // idle | dialing | speaking | listening | thinking | ended
  timerStart: 0,
  timerInt: null,
  audioEl: null,
  // capture
  ctx: null, stream: null, proc: null,
  chunks: [], sampleRate: 48000,
  speaking: false, speechFrames: 0, silentFrames: 0, noiseFloor: 0.004,
};

// ---------- boot ----------
(async function boot() {
  const health = await fetch('/api/health').then((r) => r.json()).catch(() => null);
  if (health) {
    $('collegeName').textContent = health.college;
    $('orbCore').textContent = (health.agent || 'K')[0];
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
  $('transcript').innerHTML = '<div class="transcript-empty">Transcript will appear here during the call.</div>';
})();

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
  if (chips.length) {
    const c = document.createElement('div');
    c.className = 'chips';
    c.innerHTML = chips.map((x) => `<span class="chip">${x}</span>`).join('');
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
  $('transcript').innerHTML = '<div class="transcript-empty">Transcript will appear here during the call.</div>';
  $('timer').textContent = '00:00';
  $('callTitle').textContent = 'Select a lead and start the call';
  setPhase('idle', 'Idle');
};
$('orb').onclick = () => {
  // barge-in: interrupt the agent mid-sentence
  if (state.phase === 'speaking' && state.audioEl) {
    state.audioEl.pause();
    state.audioEl = null;
    startListening();
  }
};

async function startCall() {
  if (!state.lead) return;
  $('btnStart').classList.add('hidden');
  $('btnEnd').classList.remove('hidden');
  setPhase('dialing', 'Connecting…');
  $('callTitle').textContent = `On call · ${state.lead.parentName} (${state.lead.phone})`;
  try {
    await initMic(); // ask permission up front so the loop is seamless
    const r = await fetch('/api/call/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: state.lead.id }),
    }).then(jsonOrThrow);
    state.callId = r.callId;
    startTimer();
    playReply(r.reply, r.audio);
  } catch (e) {
    failCall(e);
  }
}

async function endCall() {
  clearInterval(state.timerInt);
  state.audioEl?.pause();
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
    $('sumDuration').textContent = `${s.durationSec}s · ${s.turns} turns`;
    $('summaryOverlay').classList.remove('hidden');
  } catch {
    setPhase('idle', 'Idle');
  }
}

function failCall(e) {
  console.error(e);
  addBubble('agent', `⚠ ${e.message}`);
  clearInterval(state.timerInt);
  stopMic();
  state.callId = null;
  $('btnEnd').classList.add('hidden');
  $('btnStart').classList.remove('hidden');
  setPhase('idle', 'Call failed — check server logs');
}

function jsonOrThrow(r) {
  return r.json().then((j) => {
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  });
}

// ---------- agent speech ----------
function playReply(reply, audioB64) {
  addBubble('agent', reply.text, [reply.lang, reply.emotion]);
  if (!audioB64) return startListening();
  setPhase('speaking', 'Kavitha is speaking — tap the circle to interrupt');
  const a = new Audio('data:audio/mp3;base64,' + audioB64);
  state.audioEl = a;
  a.onended = () => { state.audioEl = null; if (state.callId) startListening(); };
  a.onerror = () => { state.audioEl = null; if (state.callId) startListening(); };
  a.play().catch(() => startListening());
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
  state.proc.connect(state.ctx.destination); // required by some browsers; node outputs silence
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

  if (rms > threshold) {
    state.speechFrames++;
    state.silentFrames = 0;
    if (!state.speaking && state.speechFrames >= 2) state.speaking = true; // ~170ms of voice
  } else {
    if (!state.speaking) state.noiseFloor = state.noiseFloor * 0.95 + rms * 0.05; // adapt to room noise
    state.silentFrames++;
    state.speechFrames = 0;
  }

  if (state.speaking || state.speechFrames > 0) state.chunks.push(new Float32Array(f32));

  const frameMs = (f32.length / state.sampleRate) * 1000;
  const utteranceMs = state.chunks.length * frameMs;
  // end of utterance: ~900ms silence after speech, or 15s hard cap
  if ((state.speaking && state.silentFrames * frameMs > 900) || utteranceMs > 15000) {
    if (state.speaking) sendTurn();
    else startListening();
  }
}

async function sendTurn() {
  setPhase('thinking', 'Kavitha is thinking…');
  const wav = encodeWav(state.chunks, state.sampleRate);
  state.chunks = [];
  try {
    const r = await fetch('/api/call/turn', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId: state.callId, audio: wav }),
    }).then(jsonOrThrow);
    if (!state.callId) return; // call ended while waiting
    if (r.empty) return startListening(); // noise only — keep listening
    addBubble('user', r.userText, [r.userLang || '']);
    playReply(r.reply, r.audio);
  } catch (e) {
    if (state.callId) failCall(e);
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
    // average the source window for cheap anti-aliasing
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
