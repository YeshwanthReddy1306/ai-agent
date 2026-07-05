// The single LLM hop for a voice turn (AGENT-SPEC §1.6: one synchronous hop, nothing more).
// Formerly agent/subagents/llm_helper.js behind a single-node LangGraph wrapper — the graph
// added a dependency and a call frame but zero routing, so it was removed (2026-07-05).
const { brainChat } = require('../lib/brain');
const { formatReminder } = require('../lib/textpost');
const { relevantFacts } = require('../lib/facts');
const { sanitizedCollege } = require('./persona');

// Cap what each LLM call carries — system prompt + the last N exchanges.
const HISTORY_TURNS = Number(process.env.HISTORY_TURNS) || 12;
const windowed = (messages) => [messages[0], ...messages.slice(1).slice(-HISTORY_TURNS)];

async function generateAgentResponse(state) {
  // H3: inject long-tail facts ONLY when this turn's question needs them (transient — not
  // stored in history, so it never bloats later turns). The system prompt stays trimmed.
  const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
  const facts = relevantFacts(lastUser ? lastUser.content : '', sanitizedCollege());
  const factNote = facts ? [{ role: 'user', content: `REFERENCE FACTS (use only if relevant; do not read the labels aloud): ${facts}` }] : [];
  const messages = [...windowed(state.messages), ...factNote, formatReminder(state.personaLang)];

  // Route by language: English -> Groq (if GROQ_API_KEY set), Telugu/Hindi -> Sarvam always.
  const { text, usage } = await brainChat(messages, state.personaLang);
  return { text, usage };
}

module.exports = { generateAgentResponse };
