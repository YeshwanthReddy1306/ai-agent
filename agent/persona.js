const fs = require('fs');
const path = require('path');

const enPrompt = require('./personas/en');
const hiPrompt = require('./personas/hi');
const tePrompt = require('./personas/te');

const college = JSON.parse(fs.readFileSync(path.join(__dirname, 'college.json'), 'utf8'));

function buildSystemPrompt(lead, langCode = 'te-IN') {
  const streams = Object.entries(college.streams)
    .map(([k, v]) => `- ${k}: ${v.feePerYear}/year. ${v.note}`)
    .join('\n');
  const campuses = college.campuses
    .map((c) => `- ${c.area} (${c.landmark}) — ${c.type}`)
    .join('\n');
  const faq = Object.entries(college.faq || {})
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  if (langCode === 'en-IN') return enPrompt(college, lead, faq, campuses, streams);
  if (langCode === 'hi-IN') return hiPrompt(college, lead, faq, campuses, streams);
  return tePrompt(college, lead, faq, campuses, streams); // default to Telugu
}

// Deterministic opening line — instant, zero LLM latency on the first impression.
function greetingFor(lead) {
  const first = lead.parentName.split(' ')[0];
  const text = `Hello, good evening! This is ${college.agentName} from the admissions office at ${college.name}. Am I speaking with ${first}?`;
  return { text, lang: 'te-IN', emotion: 'warm' }; // Default acoustic model
}

module.exports = { buildSystemPrompt, greetingFor, college };
