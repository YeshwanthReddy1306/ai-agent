const { brainChat } = require('../../lib/brain');
const { formatReminder } = require('../../lib/textpost');
const { relevantFacts } = require('../../lib/facts');
const { sanitizedCollege } = require('../persona');

// Cap what each LLM call carries — system prompt + the last N exchanges.
const HISTORY_TURNS = Number(process.env.HISTORY_TURNS) || 12;
const windowed = (messages) => [messages[0], ...messages.slice(1).slice(-HISTORY_TURNS)];

async function generateAgentResponse(state, prefix = "") {
  // H3: inject long-tail facts ONLY when this turn's question needs them (transient — not
  // stored in history, so it never bloats later turns). The system prompt stays trimmed.
  const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
  const facts = relevantFacts(lastUser ? lastUser.content : '', sanitizedCollege());
  const factNote = facts ? [{ role: 'user', content: `REFERENCE FACTS (use only if relevant; do not read the labels aloud): ${facts}` }] : [];
  const messages = [...windowed(state.messages), ...factNote, formatReminder(state.personaLang)];

  if (prefix) {
    // Optionally inject a system instruction before generating
    messages.splice(messages.length - 1, 0, {
      role: 'user',
      content: `SYSTEM NOTE: ${prefix}`
    });
  }

  // Route by language: English -> Groq (if GROQ_API_KEY set), Telugu/Hindi -> Sarvam always.
  const { text, usage } = await brainChat(messages, state.personaLang);

  return { text, usage };
}

module.exports = { generateAgentResponse };
