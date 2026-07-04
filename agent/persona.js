const fs = require('fs');
const path = require('path');

const enPrompt = require('./personas/en');
const hiPrompt = require('./personas/hi');
const tePrompt = require('./personas/te');

const college = JSON.parse(fs.readFileSync(path.join(__dirname, 'college.json'), 'utf8'));

const TODO = /TODO/i;
const DEFER_FEE = '(exact figure NOT loaded — never state a number for this; say the admissions office will confirm it on WhatsApp today)';

// Premortem #1 fix: TODO placeholders and renamed keys must never reach the prompt.
// Anything unfilled becomes an explicit "defer to office" instruction, and the
// results keys the personas read ('2025', 'toppers') are mapped from the new
// brandWide / hyderabad2025 fields so the prompt never says "undefined".
function sanitizedCollege() {
  const c = JSON.parse(JSON.stringify(college));
  for (const k of Object.keys(c.streams || {})) {
    if (TODO.test(c.streams[k].feePerYear || '')) c.streams[k].feePerYear = DEFER_FEE;
  }
  if (TODO.test(c.hostel?.feePerYear || '')) c.hostel.feePerYear = DEFER_FEE;
  if (TODO.test(c.batchSize || '')) {
    c.batchSize = 'small batches with personal attention — the office confirms the exact section size; never state a number yourself';
  }
  const brand = c.results?.brandWide || c.results?.['2025'] || '';
  const local = c.results?.hyderabad2025 || c.results?.toppers || '';
  c.results = {
    ...c.results,
    2025: brand || 'the office will share the latest verified results list',
    toppers: !local || TODO.test(local)
      ? 'Hyderabad-centre-specific numbers are NOT loaded — NEVER present the national numbers as local results; offer to send the verified local list on WhatsApp'
      : local,
  };
  for (const k of Object.keys(c.faq || {})) {
    if (TODO.test(c.faq[k] || '')) c.faq[k] = 'the office will confirm this — do not guess';
  }
  return c;
}

function buildSystemPrompt(lead, langCode = 'te-IN') {
  const safe = sanitizedCollege();
  // Trim the long scholarship paragraph to the core slabs (edge-cases injected on demand).
  safe.scholarships = 'Scholarships come from the ResoNET / MegaResoFAST test and apply to TUITION only. Slabs by score: 95%+ = 100%, 90-95% = 75%, 85-90% = 60%, 80-85% = 50%, 75-80% = 30%, 50-75% = 10%. Earlier admission earns a larger scholarship. Give an exact slab only if the parent tells you the score; otherwise offer to book the test. (Board-marks, Olympiad, KVPY/NTSE and Defence/single-mother/sibling concessions also exist — mention only if the parent asks.)';
  // H3 trim: keep the COMMON facts inline (fees, scholarship slabs, results, batch,
  // contact) so frequent questions are answered instantly; the long tail (full campus
  // addresses, DLPD, brochures, scholarship edge-cases) is injected on demand by
  // lib/facts.js only on turns where the parent asks. This shrinks the per-turn prompt.
  const streams = Object.entries(safe.streams)
    .map(([k, v]) => `- ${k}: ${v.feePerYear}/year. ${v.note}`)
    .join('\n');
  // Campuses: nearest to the lead + a count note, not all 34 addresses.
  const area = (lead.area || '').toLowerCase();
  const near = safe.campuses.filter((c) => area && c.area.toLowerCase().includes(area.split(' ')[0]));
  const shown = (near.length ? near : safe.campuses.slice(0, 2));
  const campuses = shown.map((c) => `- ${c.area} (${c.landmark})`).join('\n')
    + `\n- ${safe.campusCountNote || '34 campuses across Hyderabad — ask for the nearest and I will give the exact address.'}`;
  // FAQ: core subset inline; the rest is injected on demand.
  const CORE_FAQ = ['Batch size', 'Registration', 'Parent updates'];
  const faq = Object.entries(safe.faq || {})
    .filter(([k]) => CORE_FAQ.includes(k))
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  if (langCode === 'en-IN') return enPrompt(safe, lead, faq, campuses, streams);
  if (langCode === 'hi-IN') return hiPrompt(safe, lead, faq, campuses, streams);
  return tePrompt(safe, lead, faq, campuses, streams); // default to Telugu
}

// Call flow (user requirement, 2026-07-03): the agent ALWAYS opens in English; from the
// first reply onward it mirrors whatever language the parent speaks (instant switching).
// Deterministic — zero LLM latency on the first impression.
function greetingFor(lead) {
  const first = lead.parentName.split(' ')[0];
  return {
    text: `Hello, good evening! This is ${college.agentName} calling from the admissions office at ${college.name}. Am I speaking with ${first}?`,
    lang: 'en-IN',
    emotion: 'warm',
  };
}

const LANG_CODE = { te: 'te-IN', hi: 'hi-IN', en: 'en-IN' };

module.exports = { buildSystemPrompt, greetingFor, college, sanitizedCollege, LANG_CODE };
