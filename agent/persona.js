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
  const streams = Object.entries(safe.streams)
    .map(([k, v]) => `- ${k}: ${v.feePerYear}/year. ${v.note}`)
    .join('\n');
  const campuses = safe.campuses
    .map((c) => `- ${c.area} (${c.landmark}) — ${c.type}`)
    .join('\n');
  const faq = Object.entries(safe.faq || {})
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
