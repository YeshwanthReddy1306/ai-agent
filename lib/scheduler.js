// Follow-up scheduler — real, persistent queue of reminders/follow-ups (data/followups.json).
// Creates tasks from call outcomes; a tick marks them due. SENDING is the channel step
// (Twilio SMS/WhatsApp): once a channel is wired, due tasks get sent — until then they
// surface via /api/followups and the console so nothing is lost.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'data', 'followups.json');

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}
function write(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp'; // atomic write (temp + rename)
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, FILE);
}

function schedule(task) {
  const list = read();
  list.push({
    id: 'F-' + crypto.randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    status: 'scheduled',
    ...task,
  });
  write(list);
}

// Decide what to schedule from a completed call's outcome.
function fromCall(lead, summary) {
  const now = Date.now();
  const hrs = (h) => new Date(now + h * 3600000).toISOString();
  const base = { leadId: lead.id, parent: lead.parentName, phone: lead.phone, student: lead.studentName };

  if (summary.appointment && summary.appointment.booked) {
    schedule({ ...base, type: 'visit_reminder', dueAt: hrs(24), channel: 'whatsapp',
      message: `Namaste ${lead.parentName}, gentle reminder about ${lead.studentName}'s campus visit (${summary.appointment.when}) at Resonance. Reply here for directions.` });
  } else if (summary.interest === 'hot' || summary.interest === 'warm') {
    schedule({ ...base, type: 'follow_up_call', dueAt: hrs(48), channel: 'call',
      message: `Follow-up call for ${lead.parentName} about ${lead.studentName} (${summary.interest} lead). ${summary.nextAction || ''}` });
  }
  // Any deferred question -> a task to send the answer once the office confirms it.
  for (const q of summary.unansweredQuestions || []) {
    schedule({ ...base, type: 'send_info', dueAt: hrs(6), channel: 'whatsapp',
      message: `Send ${lead.parentName} the answer to: "${q}"` });
  }
  // Dept 4 (brochures) + Dept 6 (documents): a warm/hot call auto-sends the brochure; a
  // booked visit also starts the document checklist. Lazy require avoids a circular dep.
  try {
    const ops = require('./ops');
    if (summary.interest === 'hot' || summary.interest === 'warm' || (summary.appointment && summary.appointment.booked)) ops.sendBrochure(lead);
    if ((summary.appointment && summary.appointment.booked) || summary.interest === 'hot') ops.startDocumentCollection(lead);
  } catch (e) { console.error('[ops] post-call trigger failed:', e.message); }
}

// Send an SMS via Twilio. Returns {sent} — safely refuses without creds or a real E.164 number
// (the demo's placeholder phones like "+91 98XXXX1001" are skipped, not errored).
async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !tok || !from) return { sent: false, reason: 'no twilio creds' };
  const clean = String(to || '').replace(/\s/g, '');
  if (!/^\+\d{10,15}$/.test(clean)) return { sent: false, reason: 'not a real phone number' };
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: clean, From: from, Body: body }),
  });
  if (!res.ok) return { sent: false, reason: `twilio ${res.status}: ${(await res.text()).slice(0, 120)}` };
  return { sent: true };
}

// Mark due tasks and SEND them (SMS via Twilio). Text/WhatsApp tasks go by SMS for now;
// 'call' tasks stay 'due' for a human/outbound-dialer to action.
async function tick() {
  const list = read();
  let changed = false;
  const now = Date.now();
  for (const t of list) {
    if (t.status !== 'scheduled' || new Date(t.dueAt).getTime() > now) continue;
    changed = true;
    t.dueMarkedAt = new Date().toISOString();
    if (t.channel === 'call') {
      t.status = 'due';
      console.log(`[FOLLOWUP DUE · call] ${t.parent} · ${t.message}`);
      continue;
    }
    // whatsapp/sms/message channels go through the unified sender (WhatsApp-first,
    // SMS fallback). Lazy require avoids a circular dep with notify.js.
    const { send } = require('./notify');
    const r = await send({ to: t.phone, text: t.message, preferred: t.channel === 'sms' ? 'sms' : 'whatsapp' });
    if (r.sent) { t.status = 'sent'; t.sentAt = new Date().toISOString(); t.sentVia = r.channel; console.log(`[FOLLOWUP SENT · ${r.channel}] ${t.parent}`); }
    else { t.status = 'due'; console.log(`[FOLLOWUP DUE · ${t.type}] ${t.parent} — not sent (${r.reason}): ${t.message}`); }
  }
  if (changed) write(list);
}

function listFollowups() {
  return read().sort((a, b) => (a.dueAt || '').localeCompare(b.dueAt || ''));
}

module.exports = { schedule, fromCall, tick, listFollowups, sendSms };
