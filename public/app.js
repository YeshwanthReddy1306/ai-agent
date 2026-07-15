/* Phoenix Voice — call console.
   Thin UI driver over the SHARED call engine (call-engine.js). The whole call loop —
   mic, VAD, streaming turns, gapless PCM Web-Audio playback, barge-in, retries — lives
   ONCE in call-engine.js and is used by both this console and the showcase. This file only
   wires that engine to the console's DOM.

   This replaces the old ~250-line duplicate loop that still played audio as MP3 and went
   silent after the pipeline moved to linear16 PCM. One engine, no duplicate to drift. */
'use strict';

const $ = (id) => document.getElementById(id);
const ui = { leads: [], lead: null, agentName: 'Sneha', phase: 'idle', timerStart: 0, timerInt: null };

/* ---------- boot ---------- */
(async function boot() {
  const health = await fetch('/api/health').then((r) => r.json()).catch(() => null);
  if (health) {
    ui.agentName = health.agent || 'Sneha';
    $('collegeName').textContent = health.college || '';
    $('orbCore').textContent = ui.agentName[0];
    $('healthDot').className = 'dot ' + (health.hasKey ? 'ok' : 'bad');
    $('healthText').textContent = health.hasKey
      ? `${health.agent} ready · ${health.model} · ${health.voice}`
      : 'API key missing';
    if (!health.hasKey) $('keyBanner').classList.remove('hidden');
  } else {
    $('healthDot').className = 'dot bad';
    $('healthText').textContent = 'server unreachable';
  }
  ui.leads = await fetch('/api/leads').then((r) => r.json()).catch(() => []);
  renderLeads();
  renderHistory();
  resetTranscript();
})();

/* ---------- DOM helpers (unchanged behavior) ---------- */
function resetTranscript() {
  $('transcript').innerHTML = '<div class="transcript-empty">Transcript will appear here during the call.</div>';
}

function renderLeads() {
  const box = $('leadList');
  box.innerHTML = '';
  for (const l of ui.leads) {
    const el = document.createElement('div');
    el.className = 'lead-card' + (ui.lead?.id === l.id ? ' active' : '');
    el.innerHTML = `
      <div class="lead-top"><span class="lead-name">${l.parentName}</span><span class="lead-lang">${l.language}</span></div>
      <div class="lead-meta"><b>${l.studentName}</b> · ${l.tenthResult} · wants <b>${l.interest}</b><br>${l.area} · ${l.source}</div>`;
    el.onclick = () => {
      if (ui.phase !== 'idle') return;                 // don't switch leads mid-call
      ui.lead = l;
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
  box.innerHTML = rows.map((r) => `<div class="history-item">
      <span class="badge sm ${r.interest}">${r.interest}</span>
      <span class="history-name">${r.parent}</span>
      <span class="history-meta">${Math.floor(r.durationSec / 60)}m${String(r.durationSec % 60).padStart(2, '0')}s</span>
    </div>`).join('');
}

function setPhaseUI(orbClass, label) {
  $('orb').className = 'orb ' + orbClass;
  $('stateText').textContent = label || '';
  $('micBars').classList.toggle('hidden', orbClass !== 'listening');
}

function addBubble(who, text, chips = []) {
  const t = $('transcript');
  t.querySelector('.transcript-empty')?.remove();
  const b = document.createElement('div');
  b.className = 'bubble ' + who;
  b.textContent = text;
  const real = chips.filter(Boolean);
  if (real.length) {
    const c = document.createElement('div');
    c.className = 'chips';
    c.innerHTML = real.map((x) => `<span class="chip">${x}</span>`).join('');
    b.appendChild(c);
  }
  t.appendChild(b);
  t.scrollTop = t.scrollHeight;
}

function startTimer() {
  ui.timerStart = Date.now();
  clearInterval(ui.timerInt);
  ui.timerInt = setInterval(() => {
    const s = Math.floor((Date.now() - ui.timerStart) / 1000);
    $('timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 500);
}
function stopTimer() { clearInterval(ui.timerInt); ui.timerInt = null; }

function callButtons(inCall) {
  $('btnStart').classList.toggle('hidden', inCall);
  $('btnEnd').classList.toggle('hidden', !inCall);
}
function endCallUI() { stopTimer(); callButtons(false); }

/* ---------- the shared engine, wired to this console ---------- */
const PHASE = {
  dialing: ['thinking', 'Connecting…'],
  listening: ['listening', 'Listening… speak naturally'],
  thinking: ['thinking', () => `${ui.agentName} is thinking…`],
  speaking: ['speaking', () => `${ui.agentName} is speaking — tap the circle to interrupt`],
  wrapping: ['thinking', 'Wrapping up…'],
  idle: ['idle', 'Idle'],
};

const engine = CallEngine({
  onPhase: (p) => {
    ui.phase = p;
    const [cls, label] = PHASE[p] || ['idle', ''];
    setPhaseUI(cls, typeof label === 'function' ? label() : label);
  },
  onUserTurn: ({ text, lang }) => addBubble('user', text, [lang]),
  onAgentTurn: ({ text, lang, emotion }) => addBubble('agent', text, [lang, emotion]),
  onSummary: (s) => {
    endCallUI();
    if (!s) { setPhaseUI('idle', 'Idle'); return; }
    $('sumInterest').textContent = s.interest || '—';
    $('sumInterest').className = 'badge ' + (s.interest || '');
    $('sumText').textContent = s.summary || '—';
    $('sumNext').textContent = s.nextAction || '—';
    $('sumObjections').textContent = (s.objections || []).join(', ') || 'None raised';
    const u = s.usage || {};
    $('sumDuration').textContent = `${s.durationSec || 0}s · ${s.turns || 0} turns · ${u.sttSeconds || 0}s STT · ${u.llmTokens || 0} tokens · ${u.ttsChars || 0} TTS chars`;
    $('summaryOverlay').classList.remove('hidden');
    renderHistory();
  },
  onError: (e) => {
    endCallUI();
    const msg = /Permission denied|NotAllowed|Microphone/i.test(String(e && e.message))
      ? 'Microphone blocked — allow mic access for this site and try again.'
      : (e && e.message) || 'Call failed';
    addBubble('agent', '⚠ ' + msg);
    setPhaseUI('idle', 'Call failed');
  },
});

/* ---------- controls ---------- */
$('btnStart').onclick = async () => {
  if (!ui.lead) return;
  callButtons(true);
  $('callTitle').textContent = `On call · ${ui.lead.parentName} (${ui.lead.phone})`;
  startTimer();
  try { await engine.start(ui.lead.id); }
  catch { /* onError already handled it */ }
};
$('btnEnd').onclick = () => engine.end();       // engine emits onSummary when done
$('orb').onclick = () => engine.bargeIn();      // tap while she speaks = interrupt
$('btnCloseSummary').onclick = () => {
  $('summaryOverlay').classList.add('hidden');
  resetTranscript();
  $('timer').textContent = '00:00';
  $('callTitle').textContent = 'Select a lead and start the call';
  ui.phase = 'idle';
  setPhaseUI('idle', 'Idle');
};
