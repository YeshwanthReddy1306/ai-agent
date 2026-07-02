// Launch gate (premortem v4) — run before ANY external call:  npm run preflight
// Checks the things that would embarrass the agent on a real Resonance call.
const fs = require('fs');
const path = require('path');

const { buildSystemPrompt, greetingFor, college } = require('../agent/persona');
const leads = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'leads.json'), 'utf8'));

let warnings = 0;
let failures = 0;
const fail = (msg) => { failures++; console.log(`✗ FAIL  ${msg}`); };
const warn = (msg) => { warnings++; console.log(`⚠ WARN  ${msg}`); };
const ok = (msg) => console.log(`✓ ok    ${msg}`);

// 1. Generated prompts must never contain undefined/TODO/[object — for every lead × language
for (const lead of leads) {
  for (const lang of ['te-IN', 'hi-IN', 'en-IN']) {
    const p = buildSystemPrompt(lead, lang);
    for (const bad of ['undefined', 'TODO', '[object']) {
      if (p.includes(bad)) fail(`prompt(${lead.id}, ${lang}) contains "${bad}"`);
    }
  }
}
if (!failures) ok('no undefined/TODO leaks in any generated prompt (4 leads × 3 languages)');

// 2. Greeting language must match each lead
for (const lead of leads) {
  const g = greetingFor(lead);
  const expect = { te: 'te-IN', hi: 'hi-IN', en: 'en-IN' }[lead.language];
  if (expect && g.lang !== expect) fail(`greeting for ${lead.id} (${lead.language}) tagged ${g.lang}`);
  if (!g.text || g.text.length < 20) fail(`greeting for ${lead.id} is empty/too short`);
}
ok('greetings match lead languages');

// 3. Facts readiness — TODOs are SAFE (sanitizer defers them) but block a real pilot
const rawFacts = fs.readFileSync(path.join(__dirname, '..', 'agent', 'college.json'), 'utf8');
const todos = (rawFacts.match(/TODO/gi) || []).length;
if (todos) warn(`college.json has ${todos} TODO field(s) — agent will defer them to "office will confirm"; fill real numbers before the pilot`);
else ok('college.json fully filled — no TODO facts');

// 4. Brand authorization flag
if (college.compliance?.brandAuthorized !== true) {
  warn(`brand "${college.name}" not marked authorized (compliance.brandAuthorized) — internal testing only`);
} else ok('brand use authorized');

console.log('');
if (failures) {
  console.log(`PREFLIGHT FAILED — ${failures} failure(s), ${warnings} warning(s). Do not make external calls.`);
  process.exit(1);
}
console.log(warnings
  ? `Preflight passed with ${warnings} warning(s): safe for INTERNAL testing; clear warnings before the pilot.`
  : 'Preflight clean — ready for pilot calls (pending the 10-parent test).');
