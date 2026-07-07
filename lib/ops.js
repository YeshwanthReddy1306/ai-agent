// Admissions operations — the automation behind Depts 4, 6, 9, 12.
// File-backed (data/ops.json for lead-linked doc/payment state; data/students.json for the
// post-admission roster). Everything sends through lib/notify (WhatsApp-first, SMS fallback).
const fs = require('fs');
const path = require('path');
const scheduler = require('./scheduler');

const college = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'agent', 'college.json'), 'utf8'));
const OPS = path.join(__dirname, '..', 'data', 'ops.json');
const ROSTER = path.join(__dirname, '..', 'data', 'students.json');

function readJson(f, fallback) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } }
function writeJson(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, f);
}
// Per-lead ops record { documents:{doc:bool}, payment:{...} }
function opsFor(leadId) { const db = readJson(OPS, {}); return db[leadId] || {}; }
function saveOps(leadId, rec) { const db = readJson(OPS, {}); db[leadId] = { ...db[leadId], ...rec }; writeJson(OPS, db); return db[leadId]; }

// ---------- Dept 4: brochures ----------
// Pick the right brochure link(s) for a lead and queue a WhatsApp/SMS send after the call.
function brochureLinksFor(lead) {
  const b = college.brochures || {};
  const interest = String(lead.interest || '').toLowerCase();
  const out = [];
  const reso = Object.entries(b).find(([k]) => /resonet|yccp/i.test(k));
  if (reso) out.push(`${reso[0]}: ${reso[1]}`);
  if (/distance|online|dlpd/.test(interest)) { const d = Object.entries(b).find(([k]) => /dlpd|distance/i.test(k)); if (d) out.push(`${d[0]}: ${d[1]}`); }
  if (/hostel|residential/.test(interest)) { const r = Object.entries(b).find(([k]) => /residential/i.test(k)); if (r) out.push(`${r[0]}: ${r[1]}`); }
  return out;
}
function sendBrochure(lead) {
  const links = brochureLinksFor(lead);
  if (!links.length) return;
  scheduler.schedule({
    leadId: lead.id, parent: lead.parentName, phone: lead.phone, student: lead.studentName,
    type: 'brochure', dueAt: new Date(Date.now() + 2 * 60000).toISOString(), channel: 'whatsapp',
    message: `Namaste ${lead.parentName}, as promised — details for ${lead.studentName} from ${college.name}:\n${links.join('\n')}\nReply here with any question, or to book a campus visit.`,
  });
}

// ---------- Dept 6: document collection (reminders only; humans verify) ----------
const REQUIRED_DOCS = ['Aadhaar card', 'Transfer Certificate (TC)', 'SSC / 10th memo', 'Passport photo'];
function documentStatus(leadId) {
  const rec = opsFor(leadId);
  const have = rec.documents || {};
  return REQUIRED_DOCS.map((d) => ({ doc: d, received: !!have[d] }));
}
function markDocument(leadId, doc, received = true) {
  const rec = opsFor(leadId);
  const documents = { ...(rec.documents || {}), [doc]: received };
  return saveOps(leadId, { documents });
}
function startDocumentCollection(lead) {
  saveOps(lead.id, { documents: opsFor(lead.id).documents || {} });
  const missing = documentStatus(lead.id).filter((d) => !d.received).map((d) => d.doc);
  if (!missing.length) return;
  scheduler.schedule({
    leadId: lead.id, parent: lead.parentName, phone: lead.phone, student: lead.studentName,
    type: 'document_reminder', dueAt: new Date(Date.now() + 24 * 3600000).toISOString(), channel: 'whatsapp',
    message: `Namaste ${lead.parentName}, for ${lead.studentName}'s admission at ${college.name} please keep ready: ${missing.join(', ')}. Bring the originals to the campus — our team will verify them.`,
  });
}

// ---------- Dept 9: payment coordination (framework; college gateway wired at contract) ----------
// PAYMENT_LINK_BASE placeholder until the college provides Razorpay/gateway. installments:
// [{label, amount, dueAt, paid}]. Reminders fire before each due date.
function setPaymentPlan(leadId, { total, installments }) {
  return saveOps(leadId, { payment: { total, installments: installments || [], setAt: new Date().toISOString() } });
}
function paymentLinkFor(leadId, amount) {
  const base = process.env.PAYMENT_LINK_BASE || 'PLACEHOLDER_GATEWAY_LINK';
  return `${base}?ref=${encodeURIComponent(leadId)}&amt=${amount}`;
}
function markInstallmentPaid(leadId, label) {
  const rec = opsFor(leadId);
  if (!rec.payment) return null;
  rec.payment.installments = (rec.payment.installments || []).map((i) => i.label === label ? { ...i, paid: true, paidAt: new Date().toISOString() } : i);
  return saveOps(leadId, { payment: rec.payment });
}
function schedulePaymentReminders(lead) {
  const rec = opsFor(lead.id);
  if (!rec.payment) return;
  for (const inst of rec.payment.installments || []) {
    if (inst.paid || !inst.dueAt) continue;
    const remindAt = new Date(new Date(inst.dueAt).getTime() - 24 * 3600000).toISOString();
    scheduler.schedule({
      leadId: lead.id, parent: lead.parentName, phone: lead.phone, student: lead.studentName,
      type: 'payment_reminder', dueAt: remindAt, channel: 'whatsapp',
      message: `Namaste ${lead.parentName}, a gentle reminder: ${lead.studentName}'s ${inst.label} of ₹${inst.amount} is due on ${new Date(inst.dueAt).toDateString()}. Pay securely here: ${paymentLinkFor(lead.id, inst.amount)}`,
    });
  }
}

// ---------- Dept 12: post-admission parent communication (retention product) ----------
// Roster of admitted students: [{id, studentName, parentName, phone, language, class, section}]
function roster() { return readJson(ROSTER, []); }
function saveRoster(list) { writeJson(ROSTER, list); }
function importRoster(rows) {
  const list = roster();
  const added = [];
  for (const r of rows) {
    if (!r.parentName || !String(r.phone || '').replace(/\D/g, '').length) continue;
    const rec = { id: 'S-' + (list.length + added.length + 1001), studentName: r.studentName || 'student', parentName: r.parentName, phone: r.phone, language: r.language || 'te', class: r.class || '', section: r.section || '' };
    added.push(rec);
  }
  saveRoster(list.concat(added));
  return added;
}
// Per-language templates for each event type. Utility-template style (short, factual).
const TEMPLATES = {
  absent: {
    te: (s) => `నమస్తే, ${college.name}: మీ అబ్బాయి/అమ్మాయి ${s.studentName} ఈ రోజు హాజరు కాలేదు. ఏమైనా సమస్య ఉంటే మమ్మల్ని సంప్రదించండి.`,
    hi: (s) => `नमस्ते, ${college.name}: ${s.studentName} आज अनुपस्थित रहे। कोई समस्या हो तो हमसे संपर्क करें।`,
    en: (s) => `${college.name}: ${s.studentName} was marked absent today. Please contact us if there is any concern.`,
  },
  result: {
    te: (s, d) => `${college.name}: ${s.studentName} టెస్ట్ రిజల్ట్ సిద్ధంగా ఉంది — ${d}. వివరాలకు కాలేజీని సంప్రదించండి.`,
    hi: (s, d) => `${college.name}: ${s.studentName} का टेस्ट रिजल्ट तैयार है — ${d}।`,
    en: (s, d) => `${college.name}: ${s.studentName}'s test result is ready — ${d}.`,
  },
  fee: {
    te: (s, d) => `నమస్తే, ${college.name}: ${s.studentName} ఫీజు ఇన్‌స్టాల్‌మెంట్ ${d} బాకీ ఉంది. దయచేసి చెల్లించండి.`,
    hi: (s, d) => `नमस्ते, ${college.name}: ${s.studentName} की फीस किस्त ${d} बाकी है। कृपया भुगतान करें।`,
    en: (s, d) => `${college.name}: ${s.studentName}'s fee installment ${d} is due. Please pay at your earliest.`,
  },
  pta: {
    te: (s, d) => `${college.name}: ${d} న పేరెంట్-టీచర్ మీటింగ్. ${s.studentName} తల్లిదండ్రులు హాజరు కావాలని కోరుతున్నాం.`,
    hi: (s, d) => `${college.name}: ${d} को पैरेंट-टीचर मीटिंग है। ${s.studentName} के अभिभावक कृपया उपस्थित हों।`,
    en: (s, d) => `${college.name}: Parent-Teacher meeting on ${d}. Parents of ${s.studentName}, please attend.`,
  },
  circular: {
    te: (s, d) => `${college.name}: ${d}`, hi: (s, d) => `${college.name}: ${d}`, en: (s, d) => `${college.name}: ${d}`,
  },
};
function templateFor(type, student, detail) {
  const t = TEMPLATES[type]; if (!t) return null;
  const lang = ['te', 'hi', 'en'].includes(student.language) ? student.language : 'te';
  return (t[lang] || t.en)(student, detail);
}
// Broadcast a Dept-12 notification to a filter (all, or by class/section, or one student id).
async function notifyRoster(type, detail, filter = {}) {
  const list = roster().filter((s) =>
    (!filter.id || s.id === filter.id) &&
    (!filter.class || s.class === filter.class) &&
    (!filter.section || s.section === filter.section));
  const { send } = require('./notify');
  let queued = 0;
  for (const s of list) {
    const text = templateFor(type, s, detail);
    if (!text) continue;
    // Queue via scheduler (dueAt now) so it rides the same WhatsApp-first pipeline + retry.
    scheduler.schedule({ leadId: s.id, parent: s.parentName, phone: s.phone, student: s.studentName,
      type: `postadm_${type}`, dueAt: new Date().toISOString(), channel: 'whatsapp', message: text });
    queued++;
  }
  return { queued, matched: list.length };
}

module.exports = {
  REQUIRED_DOCS, brochureLinksFor, sendBrochure,
  documentStatus, markDocument, startDocumentCollection,
  setPaymentPlan, paymentLinkFor, markInstallmentPaid, schedulePaymentReminders,
  roster, importRoster, notifyRoster, templateFor,
};
