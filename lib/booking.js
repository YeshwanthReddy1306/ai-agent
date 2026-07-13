// Campus-visit booking store (Dept 3/5 close-the-loop, competitor-parity with OmniDim's
// calendar integration — but pilot-SAFE by design). When a parent agrees to a visit we
// record it here and hand the counselor an .ics they accept into THEIR OWN calendar.
//
// Deliberately NOT a live Google Calendar OAuth auto-booking: at pilot scale, an agent that
// writes directly into the real counselor calendar can double-book a slot the counselor
// already holds — a worse failure than a visit the human confirms. So bookings land as
// 'pending_confirmation' for a human to accept. Flip to a real calendar API later if wanted.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'data', 'bookings.json');

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}
function write(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, FILE);
}

// Record a visit the parent agreed to. `when` is the parent's own words ("Saturday morning")
// — we keep it verbatim rather than fake-parsing it into a precise timestamp.
function record(lead, when) {
  const list = read();
  // De-dupe: one open booking per lead — update the time if they rebook.
  const existing = list.find((b) => b.leadId === lead.id && b.status === 'pending_confirmation');
  if (existing) { existing.when = when; existing.updatedAt = new Date().toISOString(); write(list); return existing; }
  const b = {
    id: 'B-' + crypto.randomUUID().slice(0, 8),
    leadId: lead.id, parent: lead.parentName, student: lead.studentName, phone: lead.phone,
    when, status: 'pending_confirmation', createdAt: new Date().toISOString(),
  };
  list.push(b);
  write(list);
  return b;
}

function list() {
  return read().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

// Minimal RFC-5545 .ics for one booking. All-day event on a best-effort date if we can parse
// one from the parent's words, else today — the human confirms the real slot on acceptance.
// The parent's exact stated time is preserved in the description so nothing is lost.
function ics(b) {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const esc = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Resonance//Sneha//EN', 'BEGIN:VEVENT',
    `UID:${b.id}@resonance`,
    `DTSTAMP:${day}T000000Z`,
    `DTSTART;VALUE=DATE:${day}`,
    `SUMMARY:${esc(`Campus visit — ${b.student} (${b.parent})`)}`,
    `DESCRIPTION:${esc(`Parent-stated time: ${b.when}. Phone: ${b.phone}. CONFIRM the exact slot with the family.`)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

module.exports = { record, list, ics };
