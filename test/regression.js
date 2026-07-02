// Hallucination + persona regression suite (premortem #4).
// Runs tricky parent questions through the persona and flags:
//   1. any rupee/number claim that does not exist in college.json (invented facts)
//   2. robotic tells (bullet points, "As an AI", long replies)
//   3. missing language/emotion tag
// Usage: SARVAM_API_KEY in .env, then:  node test/regression.js
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (!process.env.SARVAM_API_KEY) {
  console.error('Set SARVAM_API_KEY in .env first.');
  process.exit(1);
}

const { llmChat } = require('../lib/sarvam');
const { buildSystemPrompt } = require('../agent/persona');
const questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));
const leads = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'leads.json'), 'utf8'));
const collegeRaw = fs.readFileSync(path.join(__dirname, '..', 'agent', 'college.json'), 'utf8');

// every number that legitimately exists in the facts (with and without separators)
const FACT_NUMBERS = new Set();
for (const m of collegeRaw.matchAll(/[\d,]+/g)) {
  const n = m[0].replace(/,/g, '');
  if (n.length >= 2) FACT_NUMBERS.add(n);
}

function auditReply(reply) {
  const problems = [];
  const tagged = /~~\s*[a-z]{2,3}-IN\s*\|\s*[a-z]+\s*~~\s*$/i.test(reply.trim());
  if (!tagged) problems.push('MISSING lang|emotion tag');
  const spoken = reply.replace(/~~[^~]*~~\s*$/, '').trim();
  if (/^[-*•]|\n[-*•]/.test(spoken)) problems.push('BULLET POINTS (robotic)');
  if (/as an ai|i am an ai|language model/i.test(spoken)) problems.push('AI SELF-REFERENCE');
  if (spoken.length > 420) problems.push(`TOO LONG (${spoken.length} chars — monologue)`);
  // flag suspicious money-looking numbers not present in the facts
  for (const m of spoken.matchAll(/(?:₹|rs\.?|rupees?)\s*([\d,]+)|([\d,]{4,})/gi) || []) {
    const n = (m[1] || m[2] || '').replace(/,/g, '');
    if (n && n.length >= 4 && !FACT_NUMBERS.has(n)) problems.push(`UNKNOWN NUMBER: ${n} (not in college.json)`);
  }
  return problems;
}

(async () => {
  const lead = leads[0];
  const system = { role: 'system', content: buildSystemPrompt(lead) };
  let failures = 0;
  console.log(`Running ${questions.length} regression questions against the persona…\n`);
  for (const [i, item] of questions.entries()) {
    try {
      const { text } = await llmChat([system, { role: 'user', content: item.q }], { temperature: 0.7 });
      const problems = auditReply(text);
      const status = problems.length ? '✗' : '✓';
      if (problems.length) failures++;
      console.log(`${status} Q${i + 1}: ${item.q}`);
      console.log(`   expect: ${item.note}`);
      console.log(`   reply : ${text.replace(/\n/g, ' ')}`);
      if (problems.length) console.log(`   FLAGS : ${problems.join(' · ')}`);
      console.log('');
    } catch (e) {
      failures++;
      console.log(`✗ Q${i + 1} errored: ${e.message}\n`);
    }
  }
  console.log(`${questions.length - failures}/${questions.length} passed automated checks.`);
  console.log('Auto-checks catch structure problems; READ the replies above — tone and honesty need human eyes.');
  process.exit(failures ? 1 : 0);
})();
