// Language-routed LLM brain (RCOS v7.5 model-selection, modified for our use case).
//
// THE RULE: Telugu and Hindi ALWAYS go to Sarvam-105b. Groq (Llama-3) is used ONLY for
// English turns, and ONLY if GROQ_API_KEY is set. Groq destroys Telugu/Hindi (field-proven),
// so it never sees them. With no GROQ_API_KEY, every turn stays on Sarvam — zero change.
const { llmChat } = require('./sarvam');

async function groqChat(messages, opts = {}) {
  const key = process.env.GROQ_API_KEY;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages,
      temperature: opts.temperature ?? 0.6,
      max_tokens: opts.maxTokens ?? 220,
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return { text: (j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(), usage: j.usage || {} };
}

// Route by the persona language. English -> Groq (if key), else Sarvam. te/hi -> always Sarvam.
async function brainChat(messages, lang, opts = {}) {
  if (lang === 'en-IN' && process.env.GROQ_API_KEY) {
    try {
      return await groqChat(messages, opts);
    } catch (e) {
      console.warn('Groq failed, falling back to Sarvam:', e.message);
      return llmChat(messages, opts);
    }
  }
  return llmChat(messages, opts); // Telugu, Hindi, or no Groq key -> Sarvam (protects the voice)
}

function brainStatus() {
  return process.env.GROQ_API_KEY ? 'groq(en) + sarvam(te/hi)' : 'sarvam(all)';
}

module.exports = { brainChat, groqChat, brainStatus };
