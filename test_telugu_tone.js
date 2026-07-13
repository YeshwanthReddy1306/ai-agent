const fs = require('fs');
if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m && m[2] !== undefined && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const { generateAgentResponse } = require('./agent/llm_helper');
const { buildSystemPrompt } = require('./agent/persona');

const dummyLead = { id: 'L-1001', name: 'Sathvik', phone: '1234567890', grade: '10th', stream: 'MPC', goal: 'IIT-JEE', parentName: 'Ramesh Goud', gender: 'male', location: 'Kukatpally' };

async function runTest() {
  const msgs = [
    { role: 'system', content: buildSystemPrompt(dummyLead, 'te-IN') },
    { role: 'user', content: 'యాక్చువల్లీ నా కొడుక్కి బైపీసీ ఇంట్రెస్ట్ ఉంది. నీట్ కి కోచింగ్ ఉందా?' }
  ];
  try {
    const { text } = await generateAgentResponse({ messages: msgs, personaLang: 'te-IN' });
    console.log('[LLM OUTPUT]:\n' + text);
  } catch (e) {
    console.error(e.message);
  }
}
runTest();
