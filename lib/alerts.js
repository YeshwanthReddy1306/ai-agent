// M5: instant human-handoff alerts (completes owner decision D1) — a hot lead, a booked
// visit, an unknown inbound caller, or an angry parent pings a counselor's phone the
// moment the call ends, instead of waiting in the follow-ups queue. SMS today (works with
// Twilio creds); switches to WhatsApp when the Business API keys arrive.
const { sendSms } = require('./scheduler');

function needsHuman(lead, summary) {
  return (
    summary.interest === 'hot' ||
    (summary.appointment && summary.appointment.booked) ||
    String(lead.id).startsWith('L-INB') || // unknown inbound — always reviewed by a human
    (summary.objections || []).some((o) => /angry|complaint|frustrat|legal|refund|rude|shout/i.test(o))
  );
}

async function alertTeam(lead, summary, channel) {
  const to = process.env.COUNSELOR_PHONE;
  if (!to) return { sent: false, reason: 'COUNSELOR_PHONE not set' };
  if (!needsHuman(lead, summary)) return { sent: false, reason: 'no trigger' };
  const brief = [
    `[Sneha·${channel}] ${String(summary.interest).toUpperCase()} — ${lead.parentName} (${lead.studentName}, ${lead.interest})`,
    summary.appointment?.booked ? `VISIT: ${summary.appointment.when}` : '',
    (summary.objections || []).length ? `Concerns: ${summary.objections.join('; ')}` : '',
    `Next: ${summary.nextAction}`,
    `Ph: ${lead.phone}`,
  ].filter(Boolean).join(' | ').slice(0, 450);
  const r = await sendSms(to, brief);
  console.log(r.sent ? `[alert] counselor pinged — ${lead.parentName} (${summary.interest})` : `[alert] not sent (${r.reason})`);
  return r;
}

module.exports = { alertTeam, needsHuman };
