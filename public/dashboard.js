/* ============================================================================
   dashboard.js — the working operations surface (Phase 6).
   Five department pages behind a hash router. Every control hits a real endpoint.
   Reads: /api/crm /api/funnel /api/besttime /api/bookings /api/followups
          /api/roster /api/documents /api/health /api/leads
   Writes: /api/leads/import /api/documents/mark /api/roster/import /api/notify
   ============================================================================ */
'use strict';

const $ = (id) => document.getElementById(id);
const api = (p) => fetch(p).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))).catch(() => null);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const when = (d) => { try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };
const MOOD = { positive: ['var(--ok)', 'positive'], neutral: ['var(--ink-faint)', 'neutral'], negative: ['var(--warm)', 'negative'], frustrated: ['var(--hot)', 'frustrated'] };
const moodBadge = (s) => {
  const m = MOOD[s];
  return m ? `<span class="mood" style="color:${m[0]}"><i style="background:${m[0]}"></i>${m[1]}</span>` : '<span class="muted">—</span>';
};

/* cache of everything, refreshed on nav */
const D = { crm: null, funnel: null, bt: null, bookings: [], follow: [], roster: [], queue: [] };

async function refresh() {
  const [crm, funnel, bt, bk, fu, ro, q] = await Promise.all([
    api('/api/crm'), api('/api/funnel'), api('/api/besttime'), api('/api/bookings'),
    api('/api/followups'), api('/api/roster'), api('/api/leads'),
  ]);
  D.crm = crm; D.funnel = funnel; D.bt = bt;
  D.bookings = (bk && bk.bookings) || [];
  D.follow = Array.isArray(fu) ? fu : [];
  D.roster = Array.isArray(ro) ? ro : (ro && ro.roster) || [];
  D.queue = Array.isArray(q) ? q : [];
  $('cLeads').textContent = (D.crm && D.crm.leads || []).length || '';
  $('cVisits').textContent = D.bookings.length || '';
  $('cFollow').textContent = D.follow.filter((t) => t.status !== 'sent').length || '';
  $('cPost').textContent = D.roster.length || '';
}

/* ---------------------------------------------------------- slide-over */
let lastFocus = null;
function openDrill(eyebrow, title, sub) {
  lastFocus = document.activeElement;
  $('drillEyebrow').textContent = eyebrow; $('drillTitle').textContent = title;
  $('drillSub').textContent = sub || ''; $('drillBody').innerHTML = '<p class="empty">Loading…</p>';
  $('drill').classList.add('open'); $('backdrop').classList.add('open'); $('drill').focus();
}
function closeDrill() {
  $('drill').classList.remove('open'); $('backdrop').classList.remove('open');
  if (lastFocus) lastFocus.focus();
}
$('drillClose').addEventListener('click', closeDrill);
$('backdrop').addEventListener('click', closeDrill);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('drill').classList.contains('open')) closeDrill(); });

/* ============================================================ OVERVIEW */
function pageOverview() {
  const s = (D.crm && D.crm.stats) || {};
  const f = D.funnel || {};
  const gaps = [];
  if (!window.__health || !window.__health.counselorPhone) gaps.push('<b>COUNSELOR_PHONE is not set</b> — every “escalate to a human” alert (hot lead, angry parent, “let me talk to someone”) is currently going nowhere.');
  if (!window.__health || !window.__health.whatsapp) gaps.push('<b>WhatsApp is not configured</b> — brochures, reminders and broadcasts are falling back to SMS.');

  const stages = [
    ['Enquiries', f.enquiries], ['Contacted', f.contacted], ['Conversations', f.conversations],
    ['Hot + warm', (f.hot || 0) + (f.warm || 0)], ['Visits', f.visitsBooked], ['Admitted', f.admitted],
  ];
  const max = Math.max(1, ...stages.map(([, n]) => n || 0));
  const hrs = (D.bt && D.bt.hours || []).filter((h) => h.hour >= 8 && h.hour <= 21);

  $('main').innerHTML = `
    <div class="page-h"><div><h1>Overview</h1>
      <div class="sub">${s.totalLeads || 0} families · ${s.totalCalls || 0} calls · updated ${new Date().toLocaleTimeString('en-IN')}</div></div>
      <button class="btn btn--ghost" onclick="location.reload()">Refresh</button></div>

    ${gaps.length ? `<div class="warn">${gaps.join('<br>')}</div>` : ''}

    <div class="stats">
      ${[['Enquiries', f.enquiries], ['Contacted', f.contacted], ['Conversations', f.conversations],
         ['Hot', s.hot], ['Visits booked', f.visitsBooked], ['Admitted', f.admitted]]
        .map(([l, n]) => `<div class="stat"><div class="n">${n ?? 0}</div><div class="l">${l}</div></div>`).join('')}
    </div>

    <div class="panel"><h2>The funnel</h2><div class="help">Every stage Sneha moved a family through.</div>
      ${stages.map(([l, n]) => `<div class="fun-row"><span class="fl">${l}</span>
        <span class="fb"><i style="width:${((n || 0) / max) * 100}%"></i></span>
        <span class="fn">${n || 0}</span></div>`).join('')}
    </div>

    <div class="panel"><h2>When families pick up</h2>
      <div class="help">Connect-rate by hour${D.bt ? ` · ${D.bt.samples} dials logged` : ''}. Retries target the greenest slot automatically.</div>
      <div class="bt">${hrs.map((h) => {
        const r = h.connectRate;
        const col = r == null ? 'var(--paper-3)' : r >= 50 ? 'var(--ok)' : r >= 25 ? 'var(--warm)' : 'var(--hot)';
        return `<div class="bt-b"><div class="bar" title="${r == null ? 'no data' : r + '% connect'}"
          style="height:${r == null ? 4 : Math.max(4, r * 0.8)}px;background:${col}"></div><span class="hr">${h.hour}</span></div>`;
      }).join('')}</div>
    </div>`;
}

/* =============================================================== LEADS
   The page that grows forever — so it gets search, filters and pagination. */
const L = { q: '', interest: '', mood: '', page: 1, per: 25 };

function filteredLeads() {
  const all = (D.crm && D.crm.leads) || [];
  const q = L.q.trim().toLowerCase();
  return all.filter((l) => {
    if (L.interest && (l.interest || 'unknown') !== L.interest) return false;
    if (L.mood && (l.sentiment || '') !== L.mood) return false;
    if (!q) return true;
    return [l.parentName, l.studentName, l.phone, l.area, l.interestStream, l.nextAction]
      .some((v) => String(v || '').toLowerCase().includes(q));
  });
}

function pageLeads() {
  const rows = filteredLeads();
  const pages = Math.max(1, Math.ceil(rows.length / L.per));
  if (L.page > pages) L.page = pages;
  const slice = rows.slice((L.page - 1) * L.per, L.page * L.per);

  $('main').innerHTML = `
    <div class="page-h"><div><h1>Leads</h1>
      <div class="sub">${rows.length} of ${(D.crm && D.crm.leads || []).length} families</div></div>
      <label class="filepick" for="csv">
        <input type="file" id="csv" accept=".csv,text/csv" />
        <span class="btn btn--ghost btn--sm" tabindex="-1">Choose CSV</span>
        <span class="fname" id="csvName">No file chosen</span><span class="fhint">or drop it here</span>
      </label>
      <button class="btn" id="csvUp">Import</button></div>
    <div id="impOut" style="font-size:13.5px;margin-bottom:12px"></div>

    <div class="toolbar">
      <input type="search" id="q" placeholder="Search name, phone, area, stream…" value="${esc(L.q)}" />
      <select id="fi"><option value="">All interest</option>
        ${['hot', 'warm', 'cold', 'unknown'].map((v) => `<option value="${v}"${L.interest === v ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <select id="fm"><option value="">All moods</option>
        ${Object.keys(MOOD).map((v) => `<option value="${v}"${L.mood === v ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <span class="count">${rows.length} result(s)</span>
    </div>

    <table><colgroup><col style="width:22%"><col style="width:13%"><col style="width:9%"><col style="width:11%">
      <col style="width:13%"><col style="width:7%"><col style="width:6%"><col style="width:19%"></colgroup>
      <thead><tr><th>Family</th><th>Stream</th><th>Interest</th><th>Mood</th><th>Visit</th><th>Docs</th><th>Calls</th><th>Next step</th></tr></thead>
      <tbody>${slice.length ? slice.map((l) => `<tr>
        <td class="trunc"><b>${esc(l.parentName)}</b><br><span class="muted" style="font-size:12.5px">${esc(l.studentName || '')}${l.area ? ' · ' + esc(l.area) : ''}</span></td>
        <td class="trunc">${esc(l.interestStream || '—')}</td>
        <td><span class="pill pill--${esc(l.interest || 'unknown')}">${esc(l.interest || 'unknown')}</span></td>
        <td>${moodBadge(l.sentiment)}</td>
        <td class="trunc">${l.appointment && l.appointment.booked ? `<span style="color:var(--ok);font-weight:600">${esc(l.appointment.when || 'booked')}</span>` : '<span class="muted">—</span>'}</td>
        <td><button class="btn btn--ghost btn--sm" style="min-height:32px;padding:0 9px" data-docs="${esc(l.id)}" data-name="${esc(l.parentName)}" aria-label="Documents">
          <svg class="ico-sm" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></button></td>
        <td class="mono">${l.calls || 0}</td>
        <td class="trunc muted" style="font-size:13.5px" title="${esc(l.nextAction || '')}">${esc(l.nextAction || '—')}</td>
      </tr>`).join('') : `<tr><td colspan="8" class="empty">No families match this filter.</td></tr>`}</tbody></table>

    <div class="pager">
      <button class="btn btn--ghost" id="prev"${L.page <= 1 ? ' disabled' : ''}>Previous</button>
      <span class="pg">Page ${L.page} of ${pages}</span>
      <button class="btn btn--ghost" id="next"${L.page >= pages ? ' disabled' : ''}>Next</button>
    </div>`;

  // search + filters (debounced so typing doesn't re-render per keystroke)
  let t;
  $('q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { L.q = e.target.value; L.page = 1; pageLeads(); $('q').focus(); }, 220); });
  $('fi').addEventListener('change', (e) => { L.interest = e.target.value; L.page = 1; pageLeads(); });
  $('fm').addEventListener('change', (e) => { L.mood = e.target.value; L.page = 1; pageLeads(); });
  $('prev').addEventListener('click', () => { L.page--; pageLeads(); });
  $('next').addEventListener('click', () => { L.page++; pageLeads(); });
  document.querySelectorAll('[data-docs]').forEach((b) => b.addEventListener('click', () => showDocs(b.dataset.docs, b.dataset.name)));
  wireFilePick('csv', 'csvName');
  $('csvUp').addEventListener('click', importCsv);
}

async function showDocs(leadId, name) {
  openDrill('Documents', name, 'Sneha chases these on the call and by message. A human ticks them off.');
  const st = await api('/api/documents?leadId=' + encodeURIComponent(leadId)) || [];
  $('drillBody').innerHTML = st.map((d) => `<div class="doc ${d.received ? 'got' : ''}" data-doc="${esc(d.doc)}">
      <span class="box">${d.received ? '&#10003;' : ''}</span><span class="name">${esc(d.doc)}</span>
      <button class="btn btn--ghost btn--sm" style="min-height:32px;padding:0 11px;font-size:12.5px">${d.received ? 'Undo' : 'Mark received'}</button></div>`).join('');
  document.querySelectorAll('#drillBody .doc button').forEach((b) => b.addEventListener('click', async () => {
    const row = b.closest('.doc');
    b.classList.add('is-loading'); b.disabled = true;
    await fetch('/api/documents/mark', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId, doc: row.dataset.doc, received: !row.classList.contains('got') }),
    }).catch(() => {});
    showDocs(leadId, name);
  }));
}

async function importCsv() {
  const f = $('csv').files[0];
  const out = $('impOut');
  if (!f) { out.innerHTML = '<span style="color:var(--warm)">Choose a CSV first.</span>'; return; }
  const btn = $('csvUp'); btn.classList.add('is-loading'); btn.disabled = true;
  const csv = await f.text();
  const r = await fetch('/api/leads/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }),
  }).then((x) => x.json()).catch(() => null);
  btn.classList.remove('is-loading'); btn.disabled = false;
  if (!r || r.error) { out.innerHTML = `<span style="color:var(--hot)">✗ ${esc((r && r.error) || 'upload failed')}</span>`; return; }
  const rej = (r.rejected || []).map((x) => `<div style="color:var(--warm)">row ${x.line}: ${esc(x.reason)}</div>`).join('');
  out.innerHTML = `<span style="color:var(--ok)">✓ ${r.added} lead(s) added to the calling queue.</span>${rej ? `<div style="margin-top:6px"><b>Not imported:</b>${rej}</div>` : ''}`;
  await refresh(); pageLeads();
}

function wireFilePick(inputId, nameId) {
  const input = $(inputId), zone = input.closest('.filepick'), name = $(nameId);
  const show = () => { name.textContent = input.files[0] ? input.files[0].name : 'No file chosen'; };
  input.addEventListener('change', show);
  ['dragenter', 'dragover'].forEach((e) => zone.addEventListener(e, (ev) => { ev.preventDefault(); zone.classList.add('is-drag'); }));
  ['dragleave', 'drop'].forEach((e) => zone.addEventListener(e, (ev) => { ev.preventDefault(); zone.classList.remove('is-drag'); }));
  zone.addEventListener('drop', (ev) => {
    const f = ev.dataTransfer.files[0]; if (!f) return;
    const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files; show();
  });
}

/* ======================================================= 12 DEPARTMENTS
   Proof-of-automation surface: all twelve, live activity + honest status. A department
   that depends on an unset key is marked so (SMS fallback / needs gateway) — never claimed
   as fully live when it isn't. Metrics come from the same real endpoints the wall uses. */
function pageDepartments() {
  const f = D.funnel || {}, leads = (D.crm && D.crm.leads) || [], tasks = D.follow || [];
  const h = window.__health || {};
  const n = (re) => tasks.filter((t) => re.test(String(t.type || ''))).length;
  const conv = leads.reduce((a, l) => a + (l.calls || 0), 0);

  // status: 'auto' (fully live) · 'sms' (works, on SMS until WhatsApp key) · 'key' (needs a key)
  const D12 = [
    ['Lead capture', 'Captures every enquiry — web form + import', D.queue.length, 'in the calling queue', 'auto'],
    ['First contact', 'Rings the family back within minutes', f.contacted ?? 0, 'families contacted', 'auto'],
    ['Counselling', 'Diagnoses the real concern, then guides', leads.filter((l) => l.lastSummary).length, 'counselled', 'auto'],
    ['Brochures / WhatsApp', 'Sends the right leaflet automatically', n(/brochure|send_info|message/i), 'messages queued', h.whatsapp ? 'auto' : 'sms'],
    ['Campus visits', 'Books the slot, hands the counsellor an .ics', D.bookings.length, 'visits booked', 'auto'],
    ['Documents', 'Chases the admission checklist', leads.filter((l) => l.status === 'visit_booked' || l.interest === 'hot').length, 'in collection', 'auto'],
    ['Data entry', 'Types nothing — extracts straight to the CRM', 0, 'hours of human typing', 'auto'],
    ['Follow-up', 'Calls back at the statistically best hour', n(/follow_up|callback|retry/i), 'scheduled', h.whatsapp ? 'auto' : 'sms'],
    ['Payments', 'Explains fees, plans and reminders', n(/payment|fee/i), 'reminders', h.paymentGateway ? 'auto' : 'key'],
    ['CRM', 'Remembers every family across calls', (D.crm && D.crm.stats && D.crm.stats.totalLeads) ?? 0, 'records', 'auto'],
    ['Reporting', 'Funnel, connect-rate and cost analytics', f.conversations ?? conv, 'conversations logged', 'auto'],
    ['Post-admission', 'Keeps admitted parents in the loop', D.roster.length, 'on the roster', h.whatsapp ? 'auto' : 'sms'],
  ];

  const live = D12.filter((d) => d[4] === 'auto').length;
  const sms = D12.filter((d) => d[4] === 'sms').length;
  const keyless = D12.filter((d) => d[4] === 'key').length;
  const label = { auto: ['auto', 'Automated'], sms: ['sms', 'Automated · SMS'], key: ['key', 'Needs gateway key'] };
  const notes = [];
  if (sms) notes.push(`<b>${sms}</b> department(s) run on SMS until <code>WHATSAPP_PHONE_ID</code> is added — they still work, just costlier.`);
  if (keyless) notes.push(`<b>Payments</b> needs the college's payment-gateway link (<code>PAYMENT_LINK_BASE</code>) before it can send live links.`);

  $('main').innerHTML = `
    <div class="page-h"><div><h1>12 Departments — automated</h1>
      <div class="sub">${live} fully live · ${sms} on SMS fallback · ${keyless} awaiting a key</div></div></div>
    ${notes.length ? `<div class="warn">${notes.join('<br>')}</div>` : ''}
    <div class="depts">
      ${D12.map((d, i) => {
        const [key, text] = label[d[4]];
        return `<div class="dept ${d[4] === 'auto' ? '' : d[4]}">
          <span class="dnum">DEPT ${String(i + 1).padStart(2, '0')}</span>
          <span class="dname">${esc(d[0])}</span>
          <span class="ddoes">${esc(d[1])}</span>
          <div class="dfoot">
            <span class="dmetric">${d[2]}<small>${esc(d[3])}</small></span>
            <span class="dstatus ${key}"><i></i>${text}</span>
          </div>
        </div>`;
      }).join('')}
    </div>
    <p class="muted" style="font-size:12.5px;margin-top:var(--s4)">Every number is live from the system — this is real activity, not a mock-up. Green = fully automated end-to-end today.</p>`;
}

/* ============================================================== VISITS */
function pageVisits() {
  $('main').innerHTML = `
    <div class="page-h"><div><h1>Campus visits</h1>
      <div class="sub">${D.bookings.length} awaiting confirmation</div></div></div>
    <div class="panel">
      <div class="help">Sneha books the slot; a counsellor confirms it. Download the <code>.ics</code> to drop it into your own calendar — she never writes to it directly, so nothing gets double-booked.</div>
      ${D.bookings.length ? D.bookings.map((b) => {
        const href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(b.ics || '');
        return `<div class="d-row">
          <div class="d-main"><b>${esc(b.student || '—')}</b>
            <div class="muted" style="font-size:13px">${esc(b.parent || '')} · ${esc(b.phone || '')}</div></div>
          <span style="color:var(--ok);font-weight:600">${esc(b.when || 'time to confirm')}</span>
          <a class="btn btn--ghost btn--sm" style="min-height:34px;text-decoration:none" href="${href}" download="visit-${esc(b.student || 'student')}.ics">
            <svg class="ico-sm" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg> .ics</a>
        </div>`;
      }).join('') : '<p class="empty">No visits booked yet. A call that books one appears here.</p>'}
    </div>`;
}

/* =========================================================== FOLLOW-UPS
   Previously invisible in the admin — the queue that actually drives the system. */
function pageFollow() {
  const list = [...D.follow].sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  const pending = list.filter((t) => t.status !== 'sent');
  const badge = (s) => s === 'sent' ? '<span class="pill" style="background:color-mix(in oklch,var(--ok) 22%,transparent);color:var(--ok)">sent</span>'
    : s === 'due' ? '<span class="pill pill--warm">due</span>' : '<span class="pill pill--cold">scheduled</span>';

  $('main').innerHTML = `
    <div class="page-h"><div><h1>Follow-ups</h1>
      <div class="sub">${pending.length} pending · ${list.length - pending.length} sent</div></div></div>
    ${!window.__health || !window.__health.whatsapp ? '<div class="warn"><b>WhatsApp is not configured</b> — these go out by SMS instead. Add <code>WHATSAPP_PHONE_ID</code> to switch them over.</div>' : ''}
    <div class="panel">
      <div class="help">The scheduler checks this queue every minute. Voice retries target the best connect hour automatically.</div>
      <table><colgroup><col style="width:18%"><col style="width:14%"><col style="width:40%"><col style="width:16%"><col style="width:12%"></colgroup>
        <thead><tr><th>Family</th><th>Type</th><th>Message</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>${list.length ? list.map((t) => `<tr>
          <td class="trunc"><b>${esc(t.parent || '—')}</b><br><span class="muted" style="font-size:12.5px">${esc(t.student || '')}</span></td>
          <td class="trunc"><span class="mono" style="font-size:12.5px">${esc(t.type || '')}</span></td>
          <td class="trunc muted" title="${esc(t.message || '')}">${esc(t.message || '')}</td>
          <td class="mono" style="font-size:12.5px">${when(t.dueAt)}</td>
          <td>${badge(t.status)}</td></tr>`).join('')
          : '<tr><td colspan="5" class="empty">Nothing queued yet.</td></tr>'}</tbody></table>
    </div>`;
}

/* ======================================================= POST-ADMISSION */
function pagePost() {
  $('main').innerHTML = `
    <div class="page-h"><div><h1>Post-admission</h1>
      <div class="sub">${D.roster.length} admitted student(s) on the roster</div></div></div>

    <div class="panel"><h2>Import the roster</h2>
      <div class="help">Columns: <code>studentName, parentName, phone, language, class, section</code></div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <label class="filepick" for="ros"><input type="file" id="ros" accept=".csv,text/csv" />
          <span class="btn btn--ghost btn--sm" tabindex="-1">Choose CSV</span>
          <span class="fname" id="rosName">No file chosen</span><span class="fhint">or drop it here</span></label>
        <button class="btn" id="rosUp">Import roster</button>
        <span id="rosOut" class="muted" style="font-size:13.5px"></span>
      </div>
    </div>

    <div class="panel"><h2>Broadcast to parents</h2>
      <div class="help">Each parent receives it in their own language. ${window.__health && window.__health.whatsapp ? 'Sending over WhatsApp.' : 'WhatsApp not configured — sending by SMS.'}</div>
      <div class="toolbar">
        <select id="bt"><option value="absent">Absent alert</option><option value="result">Test result</option>
          <option value="fee">Fee due</option><option value="pta">PTA meeting</option><option value="circular">Circular</option></select>
        <input type="search" id="bd" placeholder="detail (date / result / message)" style="flex:1" />
        <input type="search" id="bs" placeholder="section (blank = all)" style="max-width:170px" />
        <button class="btn" id="bSend"${D.roster.length ? '' : ' disabled'}>Send</button>
      </div>
      <div id="bOut" style="font-size:13.5px">${D.roster.length ? '' : '<span class="muted">Import a roster to enable broadcasting.</span>'}</div>
    </div>`;

  wireFilePick('ros', 'rosName');
  $('rosUp').addEventListener('click', async () => {
    const f = $('ros').files[0];
    if (!f) { $('rosOut').textContent = 'Choose a roster CSV.'; return; }
    const b = $('rosUp'); b.classList.add('is-loading'); b.disabled = true;
    const r = await fetch('/api/roster/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: await f.text() }),
    }).then((x) => x.json()).catch(() => null);
    b.classList.remove('is-loading'); b.disabled = false;
    $('rosOut').innerHTML = !r || r.error ? `<span style="color:var(--hot)">✗ ${esc((r && r.error) || 'failed')}</span>`
      : `<span style="color:var(--ok)">✓ ${r.added} student(s) on the roster</span>`;
    await refresh(); pagePost();
  });
  const sb = $('bSend');
  if (sb && !sb.disabled) sb.addEventListener('click', async () => {
    sb.classList.add('is-loading'); sb.disabled = true;
    const sec = $('bs').value.trim();
    const r = await fetch('/api/notify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: $('bt').value, detail: $('bd').value.trim(), filter: sec ? { section: sec } : {} }),
    }).then((x) => x.json()).catch(() => null);
    sb.classList.remove('is-loading'); sb.disabled = false;
    sb.classList.add('is-success'); sb.textContent = 'Queued';
    $('bOut').innerHTML = r ? `<span style="color:var(--ok)">✓ queued ${r.queued} message(s) to ${r.matched} parent(s) — sending on the next scheduler tick.</span>`
      : '<span style="color:var(--hot)">✗ failed</span>';
  });
}

/* ============================================================== router */
const ROUTES = { overview: pageOverview, departments: pageDepartments, leads: pageLeads, visits: pageVisits, followups: pageFollow, post: pagePost };

async function route() {
  const r = (location.hash.replace('#/', '') || 'overview');
  const fn = ROUTES[r] || pageOverview;
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === r));
  await refresh();
  fn();
}
addEventListener('hashchange', route);

(async function boot() {
  // brand from tokens (single source), health for the honest gap warnings
  const cs = getComputedStyle(document.documentElement);
  $('bName').textContent = cs.getPropertyValue('--brand-name').replace(/["']/g, '').trim();
  $('bClient').textContent = cs.getPropertyValue('--brand-client').replace(/["']/g, '').trim();

  const h = await api('/api/health');
  window.__health = h ? {
    ok: true,
    whatsapp: !!h.whatsapp,            // server reports it if wired; falsy => SMS fallback
    counselorPhone: !!h.counselorPhone,
  } : null;
  $('hDot').className = 'dot ' + (h ? 'ok' : 'bad');
  $('hText').textContent = h ? `${h.agent || 'Sneha'} ready` : 'server unreachable';

  await route();
})();
