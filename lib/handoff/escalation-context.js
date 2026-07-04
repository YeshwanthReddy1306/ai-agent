const { pool } = require('../db');

async function generateEscalationContext(leadId) {
  const lead = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId]);
  
  const conversation = await pool.query(
    'SELECT * FROM conversations WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1',
    [leadId]
  );
  
  const messages = await pool.query(
    'SELECT sender, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
    [conversation.rows[0].id]
  );
  
  const objections = await detectObjections(messages.rows);
  const sentiment = await detectSentiment(messages.rows);
  const summary = await generateSummary(messages.rows);
  const score = lead.rows[0].score || 0;
  
  return {
    lead_id: leadId,
    parent_name: lead.rows[0].name || 'Parent',
    student_name: lead.rows[0].student_name || 'Student',
    student_percentage: lead.rows[0].student_percentage || 0,
    program_interest: lead.rows[0].program_interest || 'Unknown',
    conversation_summary: summary,
    objections: objections,
    parent_sentiment: sentiment,
    suggested_next_action: await getSuggestedAction(objections, sentiment),
    transcript_link: `https://dashboard.resonance.local/transcripts/${conversation.rows[0].id}`,
    lead_score: score,
    conversation_history: messages.rows.map((row) => ({
      sender: row.sender,
      content: row.content,
      timestamp: row.created_at
    }))
  };
}

async function detectObjections(messages) {
  const objections = [];
  const keywords = {
    fee: ['expensive', 'too much', 'high fee', 'costly', 'price'],
    roi: ['worth it', 'return', 'value', 'investment'],
    location: ['far', 'distance', 'transport', 'commute'],
    comparison: ['other college', 'competitor', 'better than']
  };
  
  for (const msg of messages) {
    if (!msg.content) continue;
    const content = msg.content.toLowerCase();
    for (const [type, words] of Object.entries(keywords)) {
      if (words.some(w => content.includes(w))) {
        objections.push({ type, details: msg.content });
        break;
      }
    }
  }
  return objections;
}

async function detectSentiment(messages) {
  const userMessages = messages.filter(m => m.sender === 'user');
  if (userMessages.length === 0) return 'neutral';
  
  const text = userMessages.map(m => m.content).join(' ').toLowerCase();
  const negative = ['frustrated', 'angry', 'annoyed', 'worried', 'concerned'];
  const positive = ['interested', 'excited', 'happy', 'appreciate', 'great'];
  
  if (negative.some(w => text.includes(w))) return 'concerned';
  if (positive.some(w => text.includes(w))) return 'positive';
  return 'neutral';
}

async function generateSummary(messages) {
  const userMsgs = messages.filter(m => m.sender === 'user').slice(0, 3);
  const agentMsgs = messages.filter(m => m.sender === 'agent').slice(-3);
  
  return [
    'User asked: ' + userMsgs.map(m => `"${m.content}"`).join('; '),
    'Agent responded: ' + agentMsgs.map(m => `"${m.content}"`).join('; ')
  ].join(' ');
}

async function getSuggestedAction(objections, sentiment) {
  if (objections.length === 0) return 'Proceed with admission process';
  if (objections.some(o => o.type === 'fee')) return 'Explain fee breakdown and scholarship options';
  if (objections.some(o => o.type === 'roi')) return 'Share placement record and alumni success stories';
  if (objections.some(o => o.type === 'location')) return 'Explain transport options and hostel facilities';
  if (objections.some(o => o.type === 'comparison')) return 'Highlight unique strengths and differentiation';
  if (sentiment === 'concerned') return 'Provide reassurance and evidence';
  return 'Schedule campus visit';
}

module.exports = { generateEscalationContext };
