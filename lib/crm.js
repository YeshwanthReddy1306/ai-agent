// Lightweight CRM store — real lead + appointment persistence with zero external accounts.
// JSON-file backed now (works locally and on Render); swap to Postgres later by setting
// DATABASE_URL and pointing these functions at lib/db.js. One record per lead, updated
// after every call with the latest outcome, qualification, and any booked campus visit.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'crm.json');

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {}; // keyed by leadId
  }
}

function writeAll(obj) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp'; // atomic: write then rename, so a crash mid-write can't corrupt it
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, FILE);
}

// Merge a call outcome into the lead's CRM record (creates it if new).
function upsertLead(lead, outcome) {
  const db = readAll();
  const prev = db[lead.id] || { id: lead.id, calls: 0, createdAt: new Date().toISOString() };
  db[lead.id] = {
    ...prev,
    parentName: lead.parentName,
    studentName: lead.studentName,
    phone: lead.phone,
    area: lead.area,
    interestStream: lead.interest,
    language: lead.language,
    calls: prev.calls + 1,
    dialAttempts: 0, // a real conversation happened — reset the unanswered-dial retry counter
    lastCallAt: new Date().toISOString(),
    status: outcome.appointment?.booked ? 'visit_booked' : outcome.interest === 'hot' ? 'qualified' : 'contacted',
    interest: outcome.interest, // hot | warm | cold (qualification)
    lastSummary: outcome.summary,
    nextAction: outcome.nextAction,
    objections: outcome.objections || [],
    appointment: outcome.appointment?.booked ? outcome.appointment : prev.appointment || null,
    // Structured extracted fields — merge, keeping the most recent non-empty value.
    extracted: {
      ...(prev.extracted || {}),
      ...Object.fromEntries(Object.entries(outcome.extracted || {}).filter(([, v]) => v && v !== 'unknown')),
    },
  };
  writeAll(db);
  return db[lead.id];
}

function listLeads() {
  return Object.values(readAll()).sort((a, b) => (b.lastCallAt || '').localeCompare(a.lastCallAt || ''));
}

// Single-lead record — powers cross-call memory (M1) in the persona layer.
function get(leadId) {
  return readAll()[leadId] || null;
}

// Unanswered-dial retry counter (cost guard). Increments each time a dial never connects;
// returns the new attempt count so the caller can stop retrying past a cap. Reset to 0 by
// upsertLead the moment a real conversation happens.
function bumpDialAttempt(leadId) {
  const db = readAll();
  const rec = db[leadId] || { id: leadId, calls: 0, createdAt: new Date().toISOString() };
  rec.dialAttempts = (rec.dialAttempts || 0) + 1;
  db[leadId] = rec;
  writeAll(db);
  return rec.dialAttempts;
}

// Simple analytics for the dashboard.
function stats() {
  const leads = listLeads();
  const by = (k, v) => leads.filter((l) => l[k] === v).length;
  return {
    totalLeads: leads.length,
    hot: by('interest', 'hot'),
    warm: by('interest', 'warm'),
    cold: by('interest', 'cold'),
    visitsBooked: leads.filter((l) => l.appointment?.booked).length,
    totalCalls: leads.reduce((n, l) => n + (l.calls || 0), 0),
  };
}

module.exports = { upsertLead, listLeads, stats, get, bumpDialAttempt };
