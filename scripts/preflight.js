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

// 2. Call-flow contract (2026-07-03): the agent ALWAYS opens in English,
//    then mirrors the caller's language from turn one (LANG_SWITCH_TURNS=1).
for (const lead of leads) {
  const g = greetingFor(lead);
  if (g.lang !== 'en-IN') fail(`greeting for ${lead.id} must be en-IN (English-first opening), got ${g.lang}`);
  if (!g.text || g.text.length < 20) fail(`greeting for ${lead.id} is empty/too short`);
}
ok('greetings follow the English-first opening contract');

// 3. Facts readiness — TODOs are SAFE (sanitizer defers them) but block a real pilot
const rawFacts = fs.readFileSync(path.join(__dirname, '..', 'agent', 'college.json'), 'utf8');
const todos = (rawFacts.match(/TODO/gi) || []).length;
if (todos) warn(`college.json has ${todos} TODO field(s) — agent will defer them to "office will confirm"; fill real numbers before the pilot`);
else ok('college.json fully filled — no TODO facts');

// 4. Persona lock (.agents/AGENTS.md): live personas must match the approved baseline
const crypto = require('crypto');
const lockedDir = path.join(__dirname, '..', 'agent', 'personas', 'locked');
const manifestPath = path.join(lockedDir, 'manifest.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let drift = false;
  for (const [f, hash] of Object.entries(manifest.files)) {
    const cur = crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(__dirname, '..', 'agent', 'personas', f)))
      .digest('hex');
    if (cur !== hash) {
      drift = true;
      fail(`persona ${f} DIFFERS from the locked baseline (${manifest.lockedAt}) — run "npm run restore-personas" to undo the drift, or "npm run lock-personas" ONLY if the user explicitly approved the change`);
    }
  }
  if (!drift) ok(`personas match the locked baseline (locked ${manifest.lockedAt})`);
} else {
  warn('no persona lock baseline yet — run: npm run lock-personas');
}

// 5. Facts freshness (RCOS F1, honest version): fees/results go stale silently.
const FACTS_MAX_AGE_DAYS = Number(process.env.FACTS_MAX_AGE_DAYS) || 30;
if (!college.factsUpdatedAt) {
  warn('college.json has no factsUpdatedAt date — add it whenever facts are verified');
} else {
  const ageDays = Math.floor((Date.now() - new Date(college.factsUpdatedAt).getTime()) / 86400000);
  if (ageDays > FACTS_MAX_AGE_DAYS) warn(`facts are ${ageDays} days old (verified ${college.factsUpdatedAt}) — re-verify fees/results/deadlines with the office`);
  else ok(`facts verified ${ageDays} day(s) ago (${college.factsUpdatedAt})`);
}

// 6. Open edge cases (unanswered parent questions waiting for a human answer)
const edgeFile = path.join(__dirname, '..', 'data', 'edge-cases.jsonl');
if (fs.existsSync(edgeFile)) {
  const open = fs.readFileSync(edgeFile, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && e.status === 'open');
  if (open.length) warn(`${open.length} open edge-case question(s) in data/edge-cases.jsonl — answer them and add to college.json faq`);
  else ok('no open edge-case questions');
}

// 7. Brand authorization flag
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
