// Shared end-of-call summary — used by BOTH server.js (web) and telephony/bridge.js (phone)
// so the two paths can never diverge again (audit H1). Returns a schema-validated object;
// callers persist it via crm.upsertLead + scheduler.fromCall.
const { llmChat } = require('./sarvam');

const HISTORY_TURNS = Number(process.env.HISTORY_TURNS) || 12;
const windowed = (m) => [m[0], ...m.slice(1).slice(-HISTORY_TURNS)];

const EMPTY = { interest: 'unknown', summary: 'Call too short to assess.', nextAction: 'Follow-up call', objections: [], unansweredQuestions: [], appointment: { booked: false, when: null } };

async function summarize(messages, agentName) {
  if (!messages || messages.length <= 3) return { ...EMPTY };
  try {
    const { text: raw } = await llmChat(
      [
        ...windowed(messages),
        {
          role: 'user',
          content:
            `SYSTEM TASK (the parent did not say this — do not answer as ${agentName}): the call has ended. Report on it in ONLY minified JSON, in English, no markdown. "interest" must be exactly one word: hot OR warm OR cold. "objections" lists real objections the parent raised, or [] if none. "unansweredQuestions" lists questions the parent asked that the counselor could NOT answer from her facts, or [] if none. "appointment" reports whether the parent AGREED to a campus visit: {"booked":true,"when":"Saturday morning"} if they clearly agreed to a specific time, else {"booked":false,"when":null}. A correctly formatted example for a DIFFERENT call: {"interest":"warm","summary":"Parent liked the small batches but wants to compare fees with one other college. Mood was friendly and unhurried.","nextAction":"Send fee comparison on WhatsApp and call back Thursday evening.","objections":["fees higher than expected"],"unansweredQuestions":["exact bus fee from Miyapur"],"appointment":{"booked":false,"when":null}}`,
        },
      ],
      // G5: summaries are off-voice-path English JSON — the cheaper 30b is allowed here
      // (AGENT-SPEC §1.1) and never affects what parents hear.
      { temperature: 0.2, maxTokens: 220, model: 'sarvam-30b' }
    );
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const arr = (a) => (Array.isArray(a) ? a : []).filter((x) => typeof x === 'string' && x.length > 3 && !/^\.+$/.test(x.trim()));
    return {
      interest: ['hot', 'warm', 'cold'].includes(String(parsed.interest).toLowerCase()) ? String(parsed.interest).toLowerCase() : 'unknown',
      summary: typeof parsed.summary === 'string' && parsed.summary.length > 10 ? parsed.summary : 'No usable summary generated.',
      nextAction: typeof parsed.nextAction === 'string' && parsed.nextAction.length > 3 ? parsed.nextAction : 'Follow-up call',
      objections: arr(parsed.objections),
      unansweredQuestions: arr(parsed.unansweredQuestions),
      appointment: parsed.appointment && parsed.appointment.booked === true
        ? { booked: true, when: typeof parsed.appointment.when === 'string' ? parsed.appointment.when : 'time to confirm' }
        : { booked: false, when: null },
    };
  } catch (e) {
    console.error('summary failed:', e.message);
    return { ...EMPTY };
  }
}

module.exports = { summarize };
