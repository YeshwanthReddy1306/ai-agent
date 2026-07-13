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

// Wilson score lower bound (95%, z=1.96) — the fraction of a connect-rate we can defend
// given only `n` samples. Ranking hours by this instead of the raw rate stops a lucky
// 1-connect-of-1 hour ("100%") from outranking a proven 55-of-100 hour. As n grows it
// converges on the raw rate; with tiny n it stays near 0. (OmniDim adopted the same fix,
// changelog Jun 17 2026.) Returns 0..1.
function wilsonLower(pos, n) {
  if (!n) return 0;
  const z = 1.96, phat = pos / n, z2 = z * z;
  return (phat + z2 / (2 * n) - z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}

// Connect stats by hour of day (0-23). connectRate (raw, for display) is null until there's
// data; score is the Wilson lower bound (for ranking) — always defined, 0 when no data.
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
    hours.push({
      hour: h, total: b.total,
      connectRate: b.total ? Math.round((b.conn / b.total) * 100) : null,
      score: wilsonLower(b.conn, b.total),
    });
  }
  return { hours, samples: rows.length };
}

// Next good calling slot. Ranks hours by Wilson lower bound (needs a small floor of ≥5 dials
// so a single fluke can't win); until enough data exists, falls back to research defaults
// (4-5 PM best, 10-11 AM second — Convoso/Gong call analysis). Returns an ISO timestamp at
// least 1h in the future, on the hour.
function nextGoodSlot(fromMs) {
  const withData = stats().hours.filter((h) => h.total >= 5 && h.score > 0)
    .sort((a, b) => b.score - a.score).map((h) => h.hour);
  const preferred = withData.length ? withData.slice(0, 3) : [16, 10, 17, 11];
  const now = new Date(fromMs || Date.now());
  for (let add = 1; add <= 48; add++) {
    const t = new Date(now.getTime() + add * 3600000);
    if (preferred.includes(t.getHours())) { t.setMinutes(0, 0, 0); return t.toISOString(); }
  }
  return new Date(now.getTime() + 4 * 3600000).toISOString();
}

module.exports = { logDial, stats, nextGoodSlot };
