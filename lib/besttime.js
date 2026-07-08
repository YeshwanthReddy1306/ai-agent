// Best-time-to-call analytics + smart retry (competitor-parity: OmniDim's connect-rate
// heatmap). Logs every dial's outcome by hour, computes connect-rate per hour, and picks
// the next high-connect slot for retries — the cost lever that stops wasting ring-time.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'dials.jsonl');

// outcome: 'connected' | 'no_answer' | 'voicemail'
function logDial(outcome) {
  try {
    const d = new Date();
    fs.appendFileSync(FILE, JSON.stringify({ at: d.toISOString(), hour: d.getHours(), dow: d.getDay(), outcome }) + '\n');
  } catch { /* analytics must never break a call */ }
}

function read() {
  try {
    return fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// Connect-rate by hour of day (0-23). connectRate is null until there's data for that hour.
function stats() {
  const rows = read();
  const byHour = {};
  for (const r of rows) {
    byHour[r.hour] = byHour[r.hour] || { conn: 0, total: 0 };
    byHour[r.hour].total++;
    if (r.outcome === 'connected') byHour[r.hour].conn++;
  }
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const b = byHour[h] || { conn: 0, total: 0 };
    hours.push({ hour: h, total: b.total, connectRate: b.total ? Math.round((b.conn / b.total) * 100) : null });
  }
  return { hours, samples: rows.length };
}

// Next good calling slot. Uses our own data once an hour has ≥10 dials; until then falls
// back to research defaults (4-5 PM best, 10-11 AM second — Convoso/Gong call analysis).
// Returns an ISO timestamp at least 1h in the future, on the hour.
function nextGoodSlot(fromMs) {
  const withData = stats().hours.filter((h) => h.total >= 10 && h.connectRate != null)
    .sort((a, b) => b.connectRate - a.connectRate).map((h) => h.hour);
  const preferred = withData.length ? withData.slice(0, 3) : [16, 10, 17, 11];
  const now = new Date(fromMs || Date.now());
  for (let add = 1; add <= 48; add++) {
    const t = new Date(now.getTime() + add * 3600000);
    if (preferred.includes(t.getHours())) { t.setMinutes(0, 0, 0); return t.toISOString(); }
  }
  return new Date(now.getTime() + 4 * 3600000).toISOString();
}

module.exports = { logDial, stats, nextGoodSlot };
