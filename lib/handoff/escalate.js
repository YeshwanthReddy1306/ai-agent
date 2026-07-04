const { pool } = require('../db');
const { generateEscalationContext } = require('./escalation-context');

async function escalateToHuman(leadId, reason, conversationId) {
  const context = await generateEscalationContext(leadId);
  const result = await pool.query(
    `INSERT INTO escalations (lead_id, conversation_id, reason, context, status, created_at)
     VALUES ($1, $2, $3, $4, 'pending', NOW()) RETURNING id`,
    [leadId, conversationId, reason, JSON.stringify(context)]
  );
  const ticketId = result.rows[0].id;
  
  await pool.query(
    `UPDATE conversations SET escalated = true, escalated_at = NOW() WHERE lead_id = $1`,
    [leadId]
  );
  
  await sendSlackNotification({ ticket_id: ticketId, context, reason });
  await sendEmailNotification({ ticket_id: ticketId, context, reason });
  
  return {
    message: "I'm connecting you to our senior admissions counselor. They'll call you back within 15 minutes with full context of your conversation.",
    ticket_id: ticketId,
    context: context
  };
}

async function sendSlackNotification(data) {
  const { ticket_id, context, reason } = data;
  if (!process.env.SLACK_WEBHOOK_URL) return; // Skip if no webhook config
  
  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `🚨 *New Escalation Request*\n*Ticket #${ticket_id}*\n*Reason:* ${reason}\n*Lead:* ${context.parent_name}\n*Student:* ${context.student_name} (${context.student_percentage}%)\n*Program:* ${context.program_interest}\n*Sentiment:* ${context.parent_sentiment}\n*Score:* ${context.lead_score}\n\n*Summary:*\n${context.conversation_summary}\n\n*Objections:*\n${context.objections.map(o => `• ${o.type}: ${o.details}`).join('\n')}\n\n*Suggested Next Action:* ${context.suggested_next_action}`
    })
  });
}

async function sendEmailNotification(data) {
  const { ticket_id, context, reason } = data;
  if (!process.env.SENDGRID_API_KEY) return; // Skip if no API key config
  
  await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: process.env.ESCALATION_EMAIL || 'escalations@resonance.com' }] }],
      from: { email: 'escalations@resonance.com' },
      subject: `Escalation Ticket #${ticket_id}: ${reason}`,
      content: [{ type: 'text/plain', value: `Escalation Ticket #${ticket_id}\n\nReason: ${reason}\nLead: ${context.parent_name}\nStudent: ${context.student_name}\nProgram: ${context.program_interest}\n\nSummary:\n${context.conversation_summary}\n\nObjections:\n${context.objections.map(o => `- ${o.type}: ${o.details}`).join('\n')}\n\nSuggested Next Action:\n${context.suggested_next_action}` }]
    })
  });
}

module.exports = { escalateToHuman };
