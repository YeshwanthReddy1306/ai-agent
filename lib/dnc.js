// Do-Not-Call list — the one pre-contract safety piece. If a parent says "don't call me
// again," we honor it: the number is suppressed and future dials to it are refused.
// JSON-file backed, same atomic-write pattern as lib/crm.js. Zero external accounts.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'dnc.json');

// Normalize to the last 10 digits so "+91 98XXXX1001", "098...", "98..." all match.
function key(number) {
  return String(number || '').replace(/\D/g, '').slice(-10);
}

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return []; // [{ number, key, reason, addedAt }]
  }
}

function writeAll(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp'; // atomic: write then rename
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, FILE);
}

function has(number) {
  const k = key(number);
  return !!k && readAll().some((e) => e.key === k);
}

function add(number, reason = 'caller requested') {
  const k = key(number);
  if (!k) return false;
  const list = readAll();
  if (list.some((e) => e.key === k)) return false; // already listed
  list.push({ number, key: k, reason, addedAt: new Date().toISOString() });
  writeAll(list);
  return true;
}

function list() {
  return readAll();
}

// Detect a do-not-call request in the caller's own words (te / hi / en).
const DNC_PHRASES = /(don'?t|do not|stop|never|please no|no more)\s+(call|calling|phone|ring)|remove\s+(my|this)\s+(number|name)|मुझे\s*(मत|फोन मत)\s*(कॉल|फोन)|फोन\s*मत\s*(करो|करना|कीजिये)|दोबारा\s*(मत|फोन मत)|కాల్\s*చేయ(కండి|వద్దు)|మళ్ళీ\s*(కాల్\s*చేయకండి|ఫోన్\s*చేయకండి)|ఫోన్\s*చేయ(కండి|వద్దు)/i;
function isDncRequest(text) {
  return DNC_PHRASES.test(String(text || ''));
}

module.exports = { has, add, list, isDncRequest, key };
