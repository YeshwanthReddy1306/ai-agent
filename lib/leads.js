// Shared lead store (M2) — one source of truth for server + bridge, with import support.
// File-backed like crm/scheduler; reloads automatically when leads.json changes on disk,
// so an admin-page import is visible to the running bridge without a restart.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'leads.json');
const dnc = require('./dnc');

let cache = null;
let mtimeMs = 0;

function all() {
  const st = fs.statSync(FILE);
  if (!cache || st.mtimeMs !== mtimeMs) {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    mtimeMs = st.mtimeMs;
  }
  return cache;
}

const phoneKey = (p) => String(p || '').replace(/\D/g, '').slice(-10);

function byId(id) {
  return all().find((l) => l.id === id) || null;
}

function findByPhone(phone) {
  const k = phoneKey(phone);
  if (!k) return null;
  return all().find((l) => phoneKey(l.phone) === k) || null;
}

function write(list) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, FILE);
  cache = null; // force reload with fresh mtime
}

function nextId(list) {
  const nums = list.map((l) => Number((String(l.id).match(/^L-(\d+)$/) || [])[1] || 0));
  return 'L-' + (Math.max(1000, ...nums) + 1);
}

// Import rows (from CSV). Validates, dedups (queue + DNC), appends. Nothing silently lost:
// returns { added: [lead], rejected: [{ line, reason }] }.
const LANGS = new Set(['te', 'hi', 'en']);
function addMany(rows) {
  const list = all().slice();
  const added = [];
  const rejected = [];
  const seenInFile = new Set();
  for (const r of rows) {
    const line = r._line;
    const phone = phoneKey(r.phone);
    if (!r.parentName || !String(r.parentName).trim()) { rejected.push({ line, reason: 'missing parentName' }); continue; }
    if (phone.length !== 10) { rejected.push({ line, reason: `invalid phone "${r.phone || ''}" (need 10 digits)` }); continue; }
    if (seenInFile.has(phone)) { rejected.push({ line, reason: 'duplicate phone within this file' }); continue; }
    if (list.some((l) => phoneKey(l.phone) === phone)) { rejected.push({ line, reason: 'already in the lead queue' }); continue; }
    if (dnc.has(phone)) { rejected.push({ line, reason: 'on the Do-Not-Call list' }); continue; }
    seenInFile.add(phone);
    const lead = {
      id: nextId(list),
      parentName: String(r.parentName).trim(),
      studentName: String(r.studentName || 'their child').trim(),
      gender: ['male', 'female'].includes(String(r.gender || '').toLowerCase()) ? String(r.gender).toLowerCase() : 'male',
      language: LANGS.has(String(r.language || '').toLowerCase()) ? String(r.language).toLowerCase() : 'te',
      area: String(r.area || '').trim(),
      tenthResult: String(r.tenthResult || '').trim(),
      interest: String(r.interest || '').trim() || 'to be discovered',
      source: String(r.source || 'imported list').trim(),
      phone: '+91 ' + phone,
    };
    list.push(lead);
    added.push(lead);
  }
  if (added.length) write(list);
  return { added, rejected };
}

// Minimal CSV parser — header row maps columns by name; simple fields (no embedded commas).
const HEADER_MAP = {
  parentname: 'parentName', parent: 'parentName', name: 'parentName',
  phone: 'phone', mobile: 'phone', number: 'phone',
  studentname: 'studentName', student: 'studentName', child: 'studentName',
  gender: 'gender', language: 'language', lang: 'language',
  area: 'area', location: 'area',
  tenthresult: 'tenthResult', marks: 'tenthResult', gpa: 'tenthResult', result: 'tenthResult',
  interest: 'interest', stream: 'interest', course: 'interest',
  source: 'source',
};
function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { error: 'file needs a header row and at least one lead row' };
  const headers = lines[0].split(',').map((h) => HEADER_MAP[h.trim().toLowerCase().replace(/[^a-z]/g, '')] || null);
  if (!headers.includes('parentName') || !headers.includes('phone')) {
    return { error: 'header row must include at least "parentName" (or name/parent) and "phone" columns' };
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const row = { _line: i + 1 };
    headers.forEach((h, j) => { if (h && cells[j] !== undefined) row[h] = cells[j].trim(); });
    rows.push(row);
  }
  return { rows };
}

module.exports = { all, byId, findByPhone, addMany, parseCsv, phoneKey };
