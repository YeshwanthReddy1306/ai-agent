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

// Live transfer: did the parent explicitly ask to speak to a human? (te / hi / en)
const TRANSFER_PHRASES = /talk to (a |an )?(human|person|manager|counsel|senior|someone|staff|agent)|real person|human being|connect me to (a )?(human|person|manager|someone)|speak to (a |someone|the manager)|किसी (व्यक्ति|इंसान|आदमी|इंसान) से|इंसान से बात|मैनेजर से बात|असली (आदमी|व्यक्ति)|మనిషి\s*తో|సార్\s*తో\s*మాట్లాడ|సీనియర్\s*తో|మేనేజర్\s*తో|అసలు\s*మనిషి/i;
function isTransferRequest(text) {
  return TRANSFER_PHRASES.test(String(text || ''));
}

module.exports = { alertTeam, needsHuman, isTransferRequest };
