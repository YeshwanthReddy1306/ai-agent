const { llmChat } = require('../../lib/sarvam');
const { formatReminder } = require('../../lib/textpost');

// Cap what each LLM call carries — system prompt + the last N exchanges.
const HISTORY_TURNS = Number(process.env.HISTORY_TURNS) || 12;
const windowed = (messages) => [messages[0], ...messages.slice(1).slice(-HISTORY_TURNS)];

async function generateAgentResponse(state, prefix = "") {
  // Use the existing Sarvam LLM pipeline for MVP to maintain TTS/persona integrity
  const messages = [...windowed(state.messages), formatReminder(state.personaLang)];
  
  if (prefix) {
    // Optionally inject a system instruction before generating
    messages.splice(messages.length - 1, 0, {
      role: 'user',
      content: `SYSTEM NOTE: ${prefix}`
    });
  }

  const { text, usage } = await llmChat(messages);
  
  return { text, usage };
}

module.exports = { generateAgentResponse };
