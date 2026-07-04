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
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
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
}

// Mark scheduled tasks whose time has come as 'due'. (When a channel is wired, send here.)
function tick() {
  const list = read();
  let changed = false;
  const now = Date.now();
  for (const t of list) {
    if (t.status === 'scheduled' && new Date(t.dueAt).getTime() <= now) {
      t.status = 'due';
      t.dueMarkedAt = new Date().toISOString();
      changed = true;
      console.log(`[FOLLOWUP DUE] ${t.type} · ${t.parent} · ${t.message}`);
    }
  }
  if (changed) write(list);
}

function listFollowups() {
  return read().sort((a, b) => (a.dueAt || '').localeCompare(b.dueAt || ''));
}

module.exports = { schedule, fromCall, tick, listFollowups };
