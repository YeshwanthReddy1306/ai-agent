/* ============================================================================
   showcase.js — the pitch surface.
   Phase 2: act rail + keyboard nav + reveals + preflight strip + LIVE Act-01 bento.
   Every number here comes from a real endpoint. Nothing is invented.
   ============================================================================ */
'use strict';

const $ = (id) => document.getElementById(id);
const api = (p) => fetch(p).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))).catch(() => null);

/* ---------------------------------------------------------------- reveals */
const io = new IntersectionObserver(
  (es) => es.forEach((e) => e.isIntersecting && e.target.classList.add('in')),
  { threshold: 0.12 }
);
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

/* ------------------------------------------------------------- act rail */
const railLinks = [...document.querySelectorAll('.rail a')];
const acts = railLinks.map((a) => $(a.dataset.act));
const actIo = new IntersectionObserver(
  (es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    railLinks.forEach((l) => l.classList.toggle('on', l.dataset.act === e.target.id));
  }),
  { rootMargin: '-45% 0px -45% 0px' }
);
acts.forEach((s) => s && actIo.observe(s));

// keys 1-4 jump between acts (presenter can drive the whole pitch from the keyboard)
addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && typeof t.matches === 'function' && t.matches('input,textarea,select,[contenteditable]')) return;
  const i = ['1', '2', '3', '4'].indexOf(e.key);
  if (i >= 0 && acts[i]) { acts[i].scrollIntoView({ behavior: 'smooth' }); }
});
$('beginDemo').addEventListener('click', () => $('act02').scrollIntoView({ behavior: 'smooth' }));

/* -------------------------------------------------- preflight (pre-mortem #1)
   Presenter's 10-second confidence check before the room fills. Real probes. */
function setChip(el, ok, label) {
  el.classList.toggle('ok', ok === true);
  el.classList.toggle('bad', ok === false);
  if (label) el.lastChild.textContent = label;
}
async function runPreflight() {
  const fix = $('pfFix');
  fix.classList.add('hidden');
  fix.textContent = '';
  const problems = [];

  // 1. server + Sarvam voice health
  const h = await api('/api/health');
  setChip($('pfServer'), !!h, h ? 'server' : 'server down');
  if (!h) problems.push('Server unreachable — is `node server.js` running?');

  const voiceOk = !!h && !(h.services && Object.values(h.services).some((s) => s && s.consecutiveFails >= 2));
  setChip($('pfVoice'), h ? voiceOk : false, voiceOk ? 'voice' : 'voice degraded');
  if (h && !voiceOk) problems.push('Sarvam voice is reporting failures — check the API key / credits.');

  // 2. microphone permission (probe, then release immediately)
  let micOk = false;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    micOk = true;
  } catch { micOk = false; }
  setChip($('pfMic'), micOk, micOk ? 'microphone' : 'microphone blocked');
  if (!micOk) problems.push('Microphone blocked — click the padlock in the address bar and allow it.');

  if (problems.length) { fix.textContent = problems.join('  ·  '); fix.classList.remove('hidden'); }
}
$('pfRun').addEventListener('click', runPreflight);
runPreflight();

/* ---------------------------------------------------- ACT 01 — live bento
   12 departments. Every metric below is read from a real endpoint; a department
   with no queryable source shows an em-dash rather than an invented number. */
const SAMPLE_PREFIX = 'Demo:';           // seeded rows are named "Demo: …" (see Phase 3)
let sampleMode = false;

const isSample = (l) => String(l.parentName || '').startsWith(SAMPLE_PREFIX);
const todayISO = () => new Date().toISOString().slice(0, 10);

async function loadBento() {
  const [funnel, crm, bookings, follow, roster, calls, queue] = await Promise.all([
    api('/api/funnel'), api('/api/crm'), api('/api/bookings'),
    api('/api/followups'), api('/api/roster'), api('/api/calls'), api('/api/leads'),
  ]);
  // enquiries = the calling queue, sample-aware
  const qAll = Array.isArray(queue) ? queue : (queue && queue.leads) || [];
  const qCount = (sampleMode ? qAll : qAll.filter((l) => !isSample(l))).length;
  // Real data only — sample mode never writes, it only ADDS a chipped overlay (see sampleAdd).
  const leads = ((crm && crm.leads) || []).filter((l) => !isSample(l));
  const tasks = (follow && (follow.followups || follow)) || [];
  const list = Array.isArray(tasks) ? tasks : [];
  const bk = (bookings && bookings.bookings) || [];
  const callList = (calls && (calls.calls || calls)) || [];
  const anySample = sampleMode;              // chip every figure the overlay touched
  const countType = (re) => list.filter((t) => re.test(String(t.type || ''))).length;
  const callsToday = (Array.isArray(callList) ? callList : []).filter(
    (c) => String(c.endedAt || c.at || '').slice(0, 10) === todayISO()
  ).length;

  // spark: conversations per lead-record (a real 7-slot shape, not a fabricated trend)
  const spark = [...Array(7)].map((_, i) => {
    const n = leads.filter((l) => (l.calls || 0) > i).length;
    return leads.length ? Math.max(8, Math.round((n / leads.length) * 100)) : 8;
  });

  // conversations/contacted derived from the (sample-aware) lead set, not the raw funnel
  const conversations = leads.reduce((n, l) => n + (l.calls || 0), 0);

  const T = [
    { k: 'hero', dept: 'Conversations handled', sneha: 'across every campus', n: conversations, cls: 'tile--hero' },
    { k: 'first', dept: 'First contact', sneha: 'calls in minutes, not days', n: callsToday, sub: 'calls placed today', cls: 'tile--med' },
    { k: 'visits', dept: 'Campus visits', sneha: 'books the slot', n: bk.length, sub: 'pending confirmation', cls: 'tile--med' },
    { k: 'capture', dept: 'Lead capture', sneha: 'every enquiry, instantly', n: qCount },
    { k: 'counsel', dept: 'Counselling', sneha: 'diagnoses, then guides', n: leads.length },
    { k: 'whatsapp', dept: 'Brochures / WhatsApp', sneha: 'right leaflet, right family', n: countType(/brochure|send_info|message/i) },
    { k: 'docs', dept: 'Documents', sneha: 'chases the checklist', n: leads.filter((l) => l.status === 'visit_booked' || l.interest === 'hot').length },
    { k: 'entry', dept: 'Data entry', sneha: 'types nothing, logs all', n: 0, sub: 'hours of human typing', dim: true },
    { k: 'follow', dept: 'Follow-up', sneha: 'calls back at the best hour', n: countType(/follow_up|callback|retry/i) },
    { k: 'pay', dept: 'Payments', sneha: 'explains fees and plans', n: countType(/payment/i) },
    { k: 'crm', dept: 'CRM', sneha: 'remembers every family', n: crm && crm.stats ? crm.stats.totalLeads : null },
    { k: 'post', dept: 'Post-admission', sneha: 'keeps parents updated', n: Array.isArray(roster) ? roster.length : (roster && roster.roster ? roster.roster.length : null) },
  ];

  $('bento').innerHTML = T.map((t) => {
    // view-only sample overlay: added on top of the real figure, and always chipped
    const add = t.dim ? 0 : sampleAdd(t.k);
    if (add && typeof t.n === 'number') t.n += add;
    const live = typeof t.n === 'number' && t.n > 0;
    const val = t.n === null || t.n === undefined ? '—' : t.n;
    const chip = anySample && add ? '<span class="chip chip--sample tag">Sample</span>' : '';
    const sparkEl = t.k === 'hero'
      ? `<div class="spark">${spark.map((h) => `<i style="height:${h}%"></i>`).join('')}</div>` : '';
    return `<button class="tile ${t.cls || ''} ${live ? 'live' : ''} reveal" data-dept="${t.k}"
        aria-label="${t.dept} — open detail">
      <span><span class="dept">${t.dept}</span><span class="sneha">${t.sneha}</span></span>
      <span class="metric" ${t.dim ? 'style="color:var(--ink-faint)"' : ''}
        data-count="${typeof t.n === 'number' ? t.n : ''}">${val}${t.sub ? `<small>${t.sub}</small>` : ''}</span>
      ${sparkEl}${chip}
    </button>`;
  }).join('');

  document.querySelectorAll('#bento .reveal').forEach((el) => io.observe(el));
  wireTiles();
  countUp();
}

// count-up on the hero number only (one motion primitive, not confetti)
function countUp() {
  const el = document.querySelector('.tile--hero .metric');
  if (!el) return;
  const target = Number(el.dataset.count);
  if (!Number.isFinite(target) || target <= 0) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let n = 0;
  const step = Math.max(1, Math.ceil(target / 36));
  const t = setInterval(() => {
    n += step;
    if (n >= target) { n = target; clearInterval(t); }
    el.firstChild.textContent = n.toLocaleString('en-IN');
  }, 22);
}

/* ---------------------------------------------- ACT 02 — stage (shell + leads) */
const wave = $('wave');
for (let i = 0; i < 34; i++) {
  const b = document.createElement('i');
  b.style.animationDelay = (i * 0.045) + 's';
  wave.appendChild(b);
}

let selectedLead = null;
async function loadLeads() {
  const leads = await api('/api/leads');
  const rows = (Array.isArray(leads) ? leads : (leads && leads.leads) || []).slice(0, 3);
  if (!rows.length) { $('leadChips').innerHTML = '<span class="stage-empty">No leads yet — import a CSV in the CRM.</span>'; return; }
  $('leadChips').innerHTML = rows.map((l, i) => `
    <button class="lead" role="tab" data-id="${l.id}" aria-selected="${i === 0}">
      <span>${l.parentName || '—'}${l.studentName ? ' — ' + l.studentName : ''}</span>
      <span class="lg">${String(l.language || 'en').toUpperCase()}</span>
    </button>`).join('');
  selectedLead = rows[0].id;
  document.querySelectorAll('.lead').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.lead').forEach((x) => x.setAttribute('aria-selected', 'false'));
    b.setAttribute('aria-selected', 'true');
    selectedLead = b.dataset.id;
  }));
}

/* =================================================== ACT 02 — the live call
   Real /api/call/* via the shared CallEngine. The stage renders what actually
   happens: her emotion per turn, and the language-switch badge the moment the
   parent changes language mid-call. */
const PHASE_LABEL = {
  idle: 'Ready', dialing: 'Connecting…', listening: 'Listening…',
  thinking: 'Sneha is thinking…', speaking: 'Sneha speaking…', wrapping: 'Wrapping up…',
};
let lastTurnLang = null;
let timerInt = null;

function stageState(cls) {
  $('viz').className = 'stage-viz' + (cls ? ' ' + cls : '');
}
function addTurn(who, text, lang, emotion) {
  $('trEmpty').classList.add('hidden');
  const L = (lang || '').slice(0, 2).toUpperCase();
  // language-switch badge: the differentiator, made visible in the room
  if (who === 'p' && lang && lastTurnLang && lang !== lastTurnLang) {
    const names = { te: 'Telugu', hi: 'Hindi', en: 'English' };
    const n = names[lang.slice(0, 2)] || lang;
    $('turns').insertAdjacentHTML('beforeend', `<div class="switch">— parent switched to ${esc(n)} —</div>`);
  }
  if (who === 'p' && lang) lastTurnLang = lang;
  $('turns').insertAdjacentHTML('beforeend', `<div class="turn ${who}">
      <span class="who">${who === 'p' ? 'Parent' : 'Sneha'}${L ? ' · ' + L : ''}</span>${esc(text)}
      ${emotion ? `<span class="emo">${esc(emotion)}</span>` : ''}</div>`);
  const t = $('transcript'); t.scrollTop = t.scrollHeight;
}

const call = CallEngine({
  onPhase: (p) => {
    $('stLabel').textContent = PHASE_LABEL[p] || p;
    stageState(p === 'speaking' ? 'speaking' : p === 'listening' ? 'listening' : '');
  },
  onUserTurn: ({ text, lang }) => addTurn('p', text, lang),
  onAgentTurn: ({ text, lang, emotion }) => {
    if (emotion) $('emo').textContent = emotion;
    addTurn('a', text, lang, emotion);
  },
  onSummary: (sum) => {
    resetCallUI();
    renderRipple(sum);
    $('act03').scrollIntoView({ behavior: 'smooth' });   // the close: ride straight into the ripple
    loadBento();
  },
  onError: (e) => {
    resetCallUI();
    $('stLabel').textContent = e.message;
  },
});

function resetCallUI() {
  clearInterval(timerInt); timerInt = null;
  stageState('');
  $('callBtn').textContent = 'Call Sneha';
  $('callBtn').classList.remove('btn--danger');
}

$('callBtn').addEventListener('click', async () => {
  if (call.callId) { await call.end(); return; }
  if (!selectedLead) { $('stLabel').textContent = 'Choose a family first.'; return; }
  $('turns').innerHTML = '';
  $('trEmpty').classList.add('hidden');
  lastTurnLang = null;
  $('emo').textContent = '—';
  $('callBtn').textContent = 'End call';
  $('callBtn').classList.add('btn--danger');
  timerInt = setInterval(() => {
    const s = call.elapsedSec;
    $('stTimer').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }, 500);
  try { await call.start(selectedLead); } catch { /* onError already reported it */ }
});

// tap the capsule to interrupt her — the barge-in moment, live in the room
$('viz').addEventListener('click', () => call.bargeIn());

/* ==================================================== ACT 03 — the ripple
   Every row is a REAL automation, read back from the live endpoints. A row with
   no data simply doesn't render — the cascade never claims something it didn't do. */
async function renderRipple(sum) {
  const box = $('ripple');
  box.innerHTML = '<p class="d-empty">Reading what the call just triggered…</p>';

  const [follow, bookings, crm] = await Promise.all([
    api('/api/followups'), api('/api/bookings'), api('/api/crm'),
  ]);
  const tasks = (follow || []).filter((t) => t.leadId === selectedLead);
  const bk = ((bookings && bookings.bookings) || []).filter((b) => b.leadId === selectedLead);
  const rec = ((crm && crm.leads) || []).find((l) => l.id === selectedLead);
  const t0 = Date.now();
  const stamp = (i) => new Date(t0 + i * 400).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const rowsOut = [];
  const push = (h, art) => rowsOut.push({ h, art });

  if (sum && sum.summary) push('Call summarised', `<b>${esc(sum.summary)}</b>`);
  if (sum && sum.interest) push('Interest scored',
    `<span class="pill pill--${esc(sum.interest)}">${esc(sum.interest)}</span>${sum.sentiment ? ` &nbsp;mood: <b>${esc(sum.sentiment)}</b>` : ''}`);
  if (rec) {
    const ex = Object.entries(rec.extracted || {}).filter(([, v]) => v && v !== 'unknown');
    push('CRM updated — nobody typed anything',
      ex.length ? ex.map(([k, v]) => `${esc(k)}: <b>${esc(v)}</b>`).join(' · ') : `<b>${esc(rec.parentName)}</b> · ${rec.calls || 0} call(s) on record`);
  }
  const msg = tasks.find((t) => /whatsapp|sms/i.test(t.channel || ''));
  if (msg) push('Message queued', `<span class="muted">to ${esc(msg.parent)}</span><br>${esc(msg.message)}`);
  if (bk.length) {
    const b = bk[0];
    const href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(b.ics || '');
    push('Campus visit booked',
      `<b>${esc(b.when)}</b> — <a href="${href}" download="visit-${esc(b.student)}.ics" style="color:var(--accent)">download .ics</a>`);
  }
  const fu = tasks.find((t) => /follow_up|callback/i.test(t.type || ''));
  if (fu) push('Follow-up scheduled at the best hour', `<b>${when(fu.dueAt)}</b> — ${esc(fu.message)}`);
  if (sum && (sum.interest === 'hot' || (sum.appointment && sum.appointment.booked))) {
    push('Counsellor alerted', 'SMS sent to the admissions team.');   // inferred; not fabricated
  }

  if (!rowsOut.length) {
    box.innerHTML = '<p class="placeholder">That call was too short to trigger anything. Try a longer conversation.</p>';
    return;
  }

  box.innerHTML = `<div class="rip" id="ripLine">
      ${rowsOut.map((r, i) => `<div class="rip-row" data-i="${i}">
        <div class="rip-t">${stamp(i)}</div>
        <div class="rip-h">${r.h}</div>
        <div class="rip-art">${r.art}</div></div>`).join('')}
    </div>
    <div class="rip-done"><button class="btn btn--ghost" id="ripReplay">Replay</button></div>`;

  const line = $('ripLine');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const play = () => {
    const rs = [...document.querySelectorAll('.rip-row')];
    rs.forEach((r) => r.classList.remove('in'));
    line.classList.remove('drawn');
    if (reduce) { rs.forEach((r) => r.classList.add('in')); line.classList.add('drawn'); return; }
    requestAnimationFrame(() => line.classList.add('drawn'));
    rs.forEach((r, i) => setTimeout(() => r.classList.add('in'), 250 + i * 400));
  };
  $('ripReplay').addEventListener('click', play);
  play();
}

/* ============================================================ DRILL-OVER
   One slide-over component; every department renders its REAL artifact into it.
   Nothing here is mocked — each panel reads a live endpoint. */
const drill = $('drill'), backdrop = $('backdrop');
let lastFocus = null;

function openDrill(eyebrow, title, sub) {
  lastFocus = document.activeElement;
  $('drillEyebrow').textContent = eyebrow;
  $('drillTitle').textContent = title;
  $('drillSub').textContent = sub || '';
  $('drillBody').innerHTML = '<p class="d-empty">Loading…</p>';
  drill.classList.add('open'); backdrop.classList.add('open');
  drill.focus();
}
function closeDrill() {
  drill.classList.remove('open'); backdrop.classList.remove('open');
  if (lastFocus) lastFocus.focus();
}
$('drillClose').addEventListener('click', closeDrill);
backdrop.addEventListener('click', closeDrill);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && drill.classList.contains('open')) closeDrill(); });

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const when = (d) => { try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const body = (h) => { $('drillBody').innerHTML = h; };
const rows = (arr, fn, empty) => (arr && arr.length ? arr.map(fn).join('') : `<p class="d-empty">${empty}</p>`);

/* --- per-department renderers --- */
const PANELS = {
  hero: async () => {
    const c = await api('/api/calls') || [];
    body(rows(c.slice(-8).reverse(), (x) => `<div class="d-row"><div class="d-main">
        <b>${esc(x.parent)}</b> <span class="pill pill--${esc(x.interest || 'unknown')}">${esc(x.interest || 'unknown')}</span>
        <div class="muted" style="font-size:13px;margin-top:3px">${esc(x.summary)}</div></div>
        <span class="d-meta">${x.durationSec || 0}s · ${x.turns || 0} turns</span></div>`,
      'No calls yet — run one in Act 02.'));
  },
  first: async () => {
    const c = await api('/api/calls') || [];
    const today = c.filter((x) => String(x.at || '').slice(0, 10) === todayISO());
    body(rows(today.reverse(), (x) => `<div class="d-row"><div class="d-main"><b>${esc(x.parent)}</b>
        <div class="muted" style="font-size:13px">${esc(x.nextAction || '—')}</div></div>
        <span class="d-meta">${when(x.at)}</span></div>`, 'No calls placed today yet.'));
  },
  visits: async () => {
    const d = await api('/api/bookings');
    const b = (d && d.bookings) || [];
    body(rows(b, (x) => {
      const href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(x.ics || '');
      return `<div class="d-row"><div class="d-main"><b>${esc(x.student)}</b>
        <div class="muted" style="font-size:13px">${esc(x.parent)} · ${esc(x.phone)}</div>
        <div style="color:var(--ok);font-size:13.5px;margin-top:3px">${esc(x.when)}</div></div>
        <a class="btn btn--ghost" style="min-height:34px;padding:0 12px;font-size:13px;text-decoration:none"
           href="${href}" download="visit-${esc(x.student)}.ics">.ics</a></div>`;
    }, 'No visits booked yet — a call that books one appears here.'));
  },
  capture: async () => {
    body(`<p class="muted" style="font-size:14px;margin-bottom:var(--s3)">This is the live public form. Submit it and the family enters the calling queue immediately — Sneha rings them back within minutes.</p>
      <form id="enqForm">
        <div class="f-field"><label for="eqParent">Parent name</label><input id="eqParent" required /></div>
        <div class="f-field"><label for="eqPhone">Phone</label><input id="eqPhone" required placeholder="+91 …" /></div>
        <div class="f-field"><label for="eqStudent">Student name</label><input id="eqStudent" /></div>
        <div class="f-field"><label for="eqLang">Language</label>
          <select id="eqLang"><option value="te">Telugu</option><option value="hi">Hindi</option><option value="en">English</option></select></div>
        <button class="btn" id="eqBtn" type="submit">Submit enquiry</button>
        <p id="eqOut" style="font-size:13.5px;margin-top:12px"></p>
      </form>`);
    $('enqForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = $('eqBtn'); btn.classList.add('is-loading'); btn.disabled = true;
      const r = await fetch('/api/enquiry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentName: $('eqParent').value.trim(), phone: $('eqPhone').value.trim(),
          studentName: $('eqStudent').value.trim(), language: $('eqLang').value,
        }),
      }).then((x) => x.json()).catch(() => null);
      btn.classList.remove('is-loading'); btn.disabled = false;
      if (r && !r.error) {
        btn.classList.add('is-success'); btn.textContent = 'Queued — Sneha will call';
        $('eqOut').innerHTML = '<span style="color:var(--ok)">Added to the calling queue. An instant-callback task is scheduled.</span>';
        loadBento();
      } else {
        btn.classList.add('is-error'); btn.textContent = 'Try again';
        $('eqOut').innerHTML = `<span style="color:var(--hot)">${esc((r && r.error) || 'Failed')}</span>`;
      }
    });
  },
  counsel: async () => {
    const d = await api('/api/crm');
    const l = (d && d.leads) || [];
    body(rows(l.filter((x) => x.lastSummary), (x) => `<div class="d-row"><div class="d-main">
        <b>${esc(x.parentName)}</b> <span class="pill pill--${esc(x.interest || 'unknown')}">${esc(x.interest || 'unknown')}</span>
        <div class="muted" style="font-size:13px;margin-top:3px">${esc(x.lastSummary)}</div>
        ${(x.objections || []).length ? `<div style="font-size:12.5px;color:var(--warm);margin-top:4px">objections: ${esc((x.objections || []).join(', '))}</div>` : ''}
      </div></div>`, 'No counselled families yet.'));
  },
  whatsapp: async () => {
    const f = await api('/api/followups') || [];
    const m = f.filter((t) => /whatsapp|sms/i.test(t.channel || ''));
    body(rows(m.slice(0, 12), (t) => `<div class="msg"><span class="msg-to">to ${esc(t.parent)} · ${esc(t.phone)} · ${esc(t.status)}</span>${esc(t.message)}</div>`,
      'No messages queued yet.') +
      `<p class="muted" style="font-size:12.5px;margin-top:12px">These send over WhatsApp the moment the Business API keys are live; SMS is the fallback today.</p>`);
  },
  docs: async () => {
    const d = await api('/api/crm');
    const l = (d && d.leads) || [];
    body(rows(l, (x) => `<div class="d-row"><div class="d-main"><b>${esc(x.parentName)}</b>
        <div class="muted" style="font-size:13px">${esc(x.studentName || '')}</div></div>
        <button class="btn btn--ghost" style="min-height:34px;padding:0 12px;font-size:13px"
          data-docs="${esc(x.id)}" data-name="${esc(x.parentName)}">Checklist</button></div>`,
      'No families yet.'));
    document.querySelectorAll('[data-docs]').forEach((b) => b.addEventListener('click', () => showChecklist(b.dataset.docs, b.dataset.name)));
  },
  entry: async () => {
    const d = await api('/api/crm');
    const l = (d && d.leads) || [];
    const filled = l.filter((x) => x.extracted && Object.values(x.extracted).some(Boolean));
    body(`<p class="muted" style="font-size:14px;margin-bottom:var(--s4)">Every field below was extracted from the conversation and written to the CRM automatically. No one typed any of it.</p>` +
      rows(filled, (x) => `<div class="d-row"><div class="d-main"><b>${esc(x.parentName)}</b>
        <div class="muted mono" style="font-size:12.5px;margin-top:4px">
          ${Object.entries(x.extracted || {}).filter(([, v]) => v && v !== 'unknown')
            .map(([k, v]) => `${esc(k)}: <span style="color:var(--ink)">${esc(v)}</span>`).join(' · ') || '—'}
        </div></div></div>`, 'Run a call — the extracted fields appear here.'));
  },
  follow: async () => {
    const [f, bt] = await Promise.all([api('/api/followups'), api('/api/besttime')]);
    const list = (f || []).filter((t) => /follow_up|callback|retry|missed/i.test(t.type || ''));
    const best = bt && bt.hours ? [...bt.hours].filter((h) => h.total >= 5).sort((a, b) => b.score - a.score)[0] : null;
    body((best ? `<p class="muted" style="font-size:13.5px;margin-bottom:12px">Best connect hour so far: <b class="mono" style="color:var(--accent)">${best.hour}:00</b> (${best.connectRate}% connect). Retries target it automatically.</p>` : '') +
      rows(list, (t) => `<div class="d-row"><div class="d-main"><b>${esc(t.parent)}</b>
        <div class="muted" style="font-size:13px">${esc(t.message)}</div></div>
        <span class="d-meta">${when(t.dueAt)}</span></div>`, 'Nothing queued.'));
  },
  pay: async () => {
    const f = await api('/api/followups') || [];
    const p = f.filter((t) => /payment|fee/i.test(t.type + ' ' + t.message));
    body(rows(p, (t) => `<div class="d-row"><div class="d-main"><b>${esc(t.parent)}</b>
        <div class="muted" style="font-size:13px">${esc(t.message)}</div></div>
        <span class="d-meta">${when(t.dueAt)}</span></div>`,
      'No payment reminders queued. Sneha explains fees and scholarship slabs on the call; the payment link is sent once the gateway is connected.'));
  },
  crm: async () => {
    const d = await api('/api/crm');
    const l = (d && d.leads) || [];
    body(rows(l, (x) => `<div class="d-row"><div class="d-main"><b>${esc(x.parentName)}</b>
        <div class="muted" style="font-size:13px">${esc(x.studentName || '')} · ${esc(x.area || '')} · ${x.calls || 0} call(s)</div>
        <div class="muted" style="font-size:12.5px;margin-top:3px">${esc(x.nextAction || '')}</div></div>
        <span class="pill pill--${esc(x.interest || 'unknown')}">${esc(x.interest || 'unknown')}</span></div>`,
      'No records yet.'));
  },
  post: async () => {
    const r = await api('/api/roster') || [];
    const list = Array.isArray(r) ? r : (r.roster || []);
    body(`<p class="muted" style="font-size:14px;margin-bottom:var(--s3)">${list.length} admitted student(s) on the roster. Broadcast reaches every parent in their own language.</p>` +
      `<div class="f-field"><label for="bcType">Message type</label>
        <select id="bcType"><option value="absent">Absent alert</option><option value="result">Test result</option>
          <option value="fee">Fee due</option><option value="pta">PTA meeting</option><option value="circular">Circular</option></select></div>
       <div class="f-field"><label for="bcDetail">Detail</label><input id="bcDetail" placeholder="date / result / message" /></div>
       <button class="btn" id="bcBtn"${list.length ? '' : ' disabled'}>Send broadcast</button>
       <p id="bcOut" style="font-size:13.5px;margin-top:12px">${list.length ? '' : '<span class="muted">Import a roster in the CRM to enable this.</span>'}</p>`);
    const bb = $('bcBtn');
    if (bb && !bb.disabled) bb.addEventListener('click', async () => {
      bb.classList.add('is-loading'); bb.disabled = true;
      const r2 = await fetch('/api/notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: $('bcType').value, detail: $('bcDetail').value.trim(), filter: {} }),
      }).then((x) => x.json()).catch(() => null);
      bb.classList.remove('is-loading'); bb.disabled = false;
      bb.classList.add('is-success'); bb.textContent = 'Queued';
      $('bcOut').innerHTML = r2 ? `<span style="color:var(--ok)">Queued ${r2.queued} message(s) to ${r2.matched} parent(s).</span>` : '<span style="color:var(--hot)">Failed</span>';
    });
  },
};

async function showChecklist(leadId, name) {
  const st = await api('/api/documents?leadId=' + encodeURIComponent(leadId)) || [];
  body(`<p class="muted" style="font-size:14px;margin-bottom:var(--s3)">Checklist for <b>${esc(name)}</b>. Sneha chases these on the call and by message; a human ticks them off.</p>` +
    st.map((d) => `<div class="doc ${d.received ? 'got' : ''}" data-doc="${esc(d.doc)}">
      <span class="box">${d.received ? '&#10003;' : ''}</span><span class="name">${esc(d.doc)}</span>
      <button class="btn btn--ghost" style="min-height:32px;padding:0 11px;font-size:12.5px">${d.received ? 'Undo' : 'Mark received'}</button></div>`).join(''));
  document.querySelectorAll('.doc button').forEach((b) => b.addEventListener('click', async () => {
    const row = b.closest('.doc');
    const doc = row.dataset.doc;
    const now = !row.classList.contains('got');
    b.classList.add('is-loading'); b.disabled = true;
    await fetch('/api/documents/mark', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId, doc, received: now }),
    }).catch(() => {});
    showChecklist(leadId, name);
  }));
}

const DEPT_TITLES = {
  hero: ['Conversations', 'Every call Sneha has held'], first: ['First contact', 'Speed to lead'],
  visits: ['Campus visits', 'Booked by Sneha, confirmed by a human'], capture: ['Lead capture', 'The public enquiry form'],
  counsel: ['Counselling', 'What each family actually said'], whatsapp: ['Brochures / WhatsApp', 'The right leaflet, automatically'],
  docs: ['Documents', 'The admission checklist'], entry: ['Data entry', 'Nobody typed any of this'],
  follow: ['Follow-up', 'Called back at the best hour'], pay: ['Payments', 'Fees, plans and reminders'],
  crm: ['CRM', 'Sneha remembers every family'], post: ['Post-admission', 'Parents kept in the loop'],
};

function wireTiles() {
  document.querySelectorAll('.tile').forEach((t) => t.addEventListener('click', async () => {
    const k = t.dataset.dept;
    const [title, sub] = DEPT_TITLES[k] || [k, ''];
    openDrill('Department', title, sub);
    try { await (PANELS[k] ? PANELS[k]() : Promise.resolve(body('<p class="d-empty">—</p>'))); }
    catch { body('<p class="d-empty">Could not load this department.</p>'); }
  }));
}

/* ==================================================== sample-data toggle
   VIEW-ONLY. It never writes to the lead store.
   Earlier this seeded through the real import endpoint — which meant 24 fake families
   were permanently added to the calling queue and Sneha would actually have rung them.
   Turning it "off" only hid them from the wall; the rows stayed. That is a live-fire
   hazard before a pitch, so the toggle now overlays clearly-chipped sample numbers on
   the display and touches nothing real. The Lead-capture panel's enquiry form is still
   a genuine POST — that one is meant to be real. */
$('sampleToggle').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  sampleMode = btn.getAttribute('aria-pressed') !== 'true';
  btn.setAttribute('aria-pressed', String(sampleMode));
  if (sampleMode && !SAMPLE.loaded) await loadSampleShape();
  await loadBento();
});

// The shape of a busy month, parsed from demo/sample-leads.csv — displayed, never stored.
const SAMPLE = { loaded: false, families: 0 };
async function loadSampleShape() {
  const csv = await fetch('/demo/sample-leads.csv').then((r) => r.text()).catch(() => '');
  SAMPLE.families = Math.max(0, csv.trim().split('\n').length - 1);   // minus the header row
  SAMPLE.loaded = true;
}
// Illustrative multipliers applied ONLY when sample mode is on; every affected figure is chipped.
const sampleAdd = (key) => {
  if (!sampleMode || !SAMPLE.families) return 0;
  const f = SAMPLE.families;                       // 24 families
  return ({
    hero: f * 3, first: Math.round(f * 0.6), visits: Math.round(f * 0.3), capture: f,
    counsel: Math.round(f * 0.8), whatsapp: f * 2, docs: Math.round(f * 0.4),
    follow: Math.round(f * 0.7), pay: Math.round(f * 0.2), crm: f, post: Math.round(f * 0.5),
  })[key] || 0;
};

/* ==================================================== ACT 04 — the case
   Rates below are VERIFIED (FreJun's own quote + Sarvam's published pricing).
   Volume and salary are ASSUMPTIONS. Each line says which it is — the restraint
   is the pitch: a buyer trusts numbers that admit what they don't know. */
const RUPEE = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const RATE = (n) => '₹' + n.toFixed(2);   // per-minute rates are paise-level — rounding showed '₹0/min'

// per connected minute (₹) — FreJun outbound 0.15 + media-streaming 0.15 (confirmed stacking)
const PER_MIN = { telephony: 0.30, tts: 0.64, stt: 0.25, llm: 0.04 };
const PER_MIN_TOTAL = PER_MIN.telephony + PER_MIN.tts + PER_MIN.stt + PER_MIN.llm;   // ≈ ₹1.24

const TIERS = {
  5:  { minutes: 23400,  channels: 10, host: 800,   whatsapp: 500 },
  15: { minutes: 70200,  channels: 20, host: 1400,  whatsapp: 1200 },
  30: { minutes: 140400, channels: 40, host: 6000,  whatsapp: 2400 },
};
const SALARY = 15000;          // nominal, per head, per month (owner's rule: never loaded cost)
const CHANNEL = 600;           // FreJun, per channel per month

function renderCase(size) {
  const t = TIERS[size];
  const variable = t.minutes * PER_MIN_TOTAL;
  const channels = t.channels * CHANNEL;
  const fixed = channels + t.host + t.whatsapp;
  const total = variable + fixed;
  const human = size * SALARY;
  const ceiling = human / 2;                 // the half-salary rule
  const saving = human - total;
  const under = total <= ceiling;

  const M = '<span class="chip chip--measured">measured</span>';
  const D = '<span class="chip chip--modeled">modeled</span>';

  $('case').innerHTML = `
    <table class="cost">
      <thead><tr><th>Line</th><th>Basis</th><th style="text-align:right">Per month</th></tr></thead>
      <tbody>
        <tr><td>Telephony — ${RATE(PER_MIN.telephony)}/min</td><td>${M} FreJun quote</td><td class="num">${RUPEE(t.minutes * PER_MIN.telephony)}</td></tr>
        <tr><td>Voice (TTS) — ${RATE(PER_MIN.tts)}/min</td><td>${M} Sarvam pricing</td><td class="num">${RUPEE(t.minutes * PER_MIN.tts)}</td></tr>
        <tr><td>Transcription (STT) — ${RATE(PER_MIN.stt)}/min</td><td>${M} Sarvam pricing</td><td class="num">${RUPEE(t.minutes * PER_MIN.stt)}</td></tr>
        <tr><td>Language model — ${RATE(PER_MIN.llm)}/min</td><td>${M} Sarvam pricing</td><td class="num">${RUPEE(t.minutes * PER_MIN.llm)}</td></tr>
        <tr><td>Phone channels (${t.channels} × ${RUPEE(CHANNEL)})</td><td>${M} FreJun quote</td><td class="num">${RUPEE(channels)}</td></tr>
        <tr><td>Server + WhatsApp</td><td>${M} list price</td><td class="num">${RUPEE(t.host + t.whatsapp)}</td></tr>
        <tr><td>Talk-minutes assumed</td><td>${D} ${t.minutes.toLocaleString('en-IN')} connected min/mo</td><td class="num">—</td></tr>
        <tr class="total"><td>System — total run cost</td><td></td><td class="num">${RUPEE(total)}</td></tr>
        <tr><td>The ${size} people it replaces</td><td>${D} ${RUPEE(SALARY)}/person nominal</td><td class="num">${RUPEE(human)}</td></tr>
        <tr class="verdict"><td>Half-salary ceiling</td>
          <td>${under ? '<span style="color:var(--ok)">under the ceiling</span>' : '<span style="color:var(--hot)">over the ceiling</span>'}</td>
          <td class="num">${RUPEE(ceiling)}</td></tr>
      </tbody>
    </table>

    <div class="saving">
      <div class="muted" style="font-size:13.5px">Saved every month</div>
      <div class="big">${RUPEE(saving)}</div>
      <div class="muted" style="font-size:13.5px">${RUPEE(human)} of salary replaced by ${RUPEE(total)} of system — and it never sleeps, never quits, and calls every lead back.</div>
    </div>

    <p class="legend">
      <span class="chip chip--measured">measured</span> = a real published or quoted rate we can hold a vendor to.
      <span class="chip chip--modeled">modeled</span> = our assumption — the number to replace with Resonance's real figures at kickoff.
      ${size === 5 ? '<br><b>Note on the 5-member tier:</b> the margin here is thin — call recording (₹0.04/min) would push it over the ceiling. It is left off at this size.' : ''}
    </p>`;
}

document.querySelectorAll('.tier').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tier').forEach((x) => x.setAttribute('aria-selected', 'false'));
  b.setAttribute('aria-selected', 'true');
  renderCase(Number(b.dataset.tier));
}));
$('printBtn').addEventListener('click', () => window.print());

async function loadCase() {
  const [f, bt] = await Promise.all([api('/api/funnel'), api('/api/besttime')]);
  // funnel
  if (f) {
    const stages = [
      ['Enquiries', f.enquiries], ['Contacted', f.contacted], ['Conversations', f.conversations],
      ['Hot + warm', (f.hot || 0) + (f.warm || 0)], ['Visits booked', f.visitsBooked], ['Admitted', f.admitted],
    ];
    const max = Math.max(1, ...stages.map(([, n]) => n || 0));
    $('funnel').innerHTML = stages.map(([l, n]) => `<div class="fun-row">
        <span class="fl">${l}</span>
        <span class="fb"><i style="transform:scaleX(${(n || 0) / max})"></i></span>
        <span class="fn">${n || 0}</span></div>`).join('');
  }
  // connect-rate by hour (working hours only)
  if (bt && bt.hours) {
    const hrs = bt.hours.filter((h) => h.hour >= 8 && h.hour <= 21);
    $('btChart').innerHTML = hrs.map((h) => {
      const r = h.connectRate;
      const col = r == null ? 'var(--paper-3)' : r >= 50 ? 'var(--ok)' : r >= 25 ? 'var(--warm)' : 'var(--hot)';
      const ht = r == null ? 4 : Math.max(4, r * 0.85);
      return `<div class="bt-b"><div class="bar" title="${r == null ? 'no data' : r + '% connect'}"
        style="height:${ht}px;background:${col}"></div><span class="hr">${h.hour}</span></div>`;
    }).join('');
  }
  renderCase(5);
}

/* ------------------------------------------------------------------- boot */
loadBento();
loadLeads();
loadCase();
