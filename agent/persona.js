const fs = require('fs');
const path = require('path');

const enPrompt = require('./personas/en');
const hiPrompt = require('./personas/hi');
const tePrompt = require('./personas/te');
const crm = require('../lib/crm');

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

  const base =
    langCode === 'en-IN' ? enPrompt(safe, lead, faq, campuses, streams)
    : langCode === 'hi-IN' ? hiPrompt(safe, lead, faq, campuses, streams)
    : tePrompt(safe, lead, faq, campuses, streams); // default to Telugu
  // M1 (cross-call memory) + inbound-unknown handling are APPENDED here — the locked
  // persona files are never touched; these blocks ride on top per call.
  return base + memoryBlock(lead) + inboundUnknownBlock(lead);
}

// ---- M1: cross-call memory (G3) ----
// The CRM already remembers every call (summary, objections, child, promises). A real
// 30-year counselor NEVER forgets a family — inject that memory into the prompt so she
// greets them as known people, references the last talk, and never re-asks.
function memoryBlock(lead) {
  const rec = crm.get(lead.id);
  if (!rec || !rec.calls) return '';
  const when = rec.lastCallAt ? new Date(rec.lastCallAt).toDateString() : 'recently';
  const lines = [
    `You have spoken with ${rec.parentName || lead.parentName} ${rec.calls} time(s) before (last: ${when}).`,
    `Child: ${rec.studentName || lead.studentName}. Stream interest: ${rec.interestStream || lead.interest}.`,
    rec.lastSummary ? `What happened last call: ${rec.lastSummary}` : '',
    rec.objections && rec.objections.length ? `Their concerns so far: ${rec.objections.join('; ')}.` : '',
    rec.appointment && rec.appointment.booked ? `They AGREED to a campus visit (${rec.appointment.when}) — confirm it, do not re-sell it.` : '',
    rec.nextAction ? `The promised next step was: ${rec.nextAction}` : '',
  ].filter(Boolean);
  return `\n\n## RETURNING FAMILY — YOUR REAL MEMORY (use it like a human would)
${lines.join('\n')}
MEMORY RULES: you KNOW this family — speak like it. Reference the last conversation naturally in your first substantive turn ("last time we spoke about..."). NEVER re-ask anything written above (name, child, stream, concerns). Continue from the promised next step. If they raised a concern before, acknowledge it before they repeat it — that is what 30 years of care sounds like.`;
}

// ---- M3/D1: inbound unknown caller ----
// Owner decision (2026-07-06): talk with them, warmly discover WHY they called — a new
// enquiry, or an existing parent calling from a different number — then the human team
// is notified after the call (handled by the bridge's finalize).
function inboundUnknownBlock(lead) {
  if (!String(lead.id).startsWith('L-INB')) return '';
  return `\n\n## INBOUND CALL — UNKNOWN NUMBER (they called US; you do not know them yet)
You answered the office line. You do NOT know who is calling. Your first job is warm discovery, not pitching:
1. Ask who is calling and how you can help — they may be a BRAND-NEW enquiry, or an EXISTING parent calling from a different number.
2. If they mention a student we already work with, ask the student's name so the office can match the records — do not guess or pretend to remember.
3. If they are new: learn the parent's name, the child's name, class, and stream interest naturally during the conversation (one question at a time, never a form-filling interrogation).
4. Help them fully as usual (facts rules unchanged). The admissions team will be informed about this call afterwards — you may say a colleague will follow up with the details.`;
}

// Call flow (user requirement, 2026-07-03): the agent ALWAYS opens in English; from the
// first reply onward it mirrors whatever language the parent speaks (instant switching).
// Deterministic — zero LLM latency on the first impression.
// M1/M3 variants (2026-07-06): a RETURNING family is greeted as known people; an INBOUND
// call gets a receiving greeting (they called us); an unknown inbound number gets warm
// discovery. All stay English-first per the call-flow contract.
function greetingFor(lead, opts = {}) {
  const first = lead.parentName.split(' ')[0];
  const rec = crm.get(lead.id);
  const returning = !!(rec && rec.calls > 0);
  const unknown = String(lead.id).startsWith('L-INB');
  let text;
  if (opts.inbound && unknown) {
    text = `Hello, good evening! Admissions office, ${college.name} — this is ${college.agentName} speaking. How can I help you?`;
  } else if (opts.inbound && returning) {
    text = `Hello ${first}! This is ${college.agentName} at ${college.name} admissions — so nice to hear from you again. How can I help?`;
  } else if (opts.inbound) {
    text = `Hello, good evening! Admissions office, ${college.name} — this is ${college.agentName}. Am I speaking with ${first}?`;
  } else if (returning) {
    text = `Hello, good evening ${first}! This is ${college.agentName} from ${college.name} — we spoke earlier about ${rec.studentName || lead.studentName}. Is this a good time?`;
  } else {
    text = `Hello, good evening! This is ${college.agentName} calling from the admissions office at ${college.name}. Am I speaking with ${first}?`;
  }
  return { text, lang: 'en-IN', emotion: 'warm' };
}

const LANG_CODE = { te: 'te-IN', hi: 'hi-IN', en: 'en-IN' };

module.exports = { buildSystemPrompt, greetingFor, college, sanitizedCollege, LANG_CODE };
