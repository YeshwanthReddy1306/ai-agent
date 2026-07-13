require('dotenv').config();
const { generateAgentResponse } = require('../agent/llm_helper');
const { parseTag, applyRegister, ttsPhonetics, nextPersonaLang, formatReminder } = require('../lib/textpost');
const { buildSystemPrompt } = require('../agent/persona');

const dummyLead = { id: 'L-TEST', name: 'Sathvik', phone: '1234567890', grade: '10th', stream: 'MPC', goal: 'IIT-JEE', parentName: 'Ramesh Goud', gender: 'male', location: 'Kukatpally' };
const dummyLeadFemale = { ...dummyLead, name: 'Sita', gender: 'female' };

const tests = [
  { name: '1. Ideal Path (English)', lang: 'en-IN', lead: dummyLead, history: [ { role: 'assistant', content: 'Hello, good evening Ramesh! This is Sneha from Resonance Hyderabad. Is this a good time?' }, { role: 'user', content: 'Yes, go ahead.' } ] },
  { name: '2. Ping-Pong Prevention (STT Glitch)', lang: 'en-IN', lead: dummyLead, isLangDetectTest: true, detectedLangSeq: ['en-IN', 'te-IN', 'en-IN', 'te-IN', 'te-IN'] },
  { name: '3. Hyderabad Telugu (Mixing English)', lang: 'te-IN', lead: dummyLead, history: [ { role: 'assistant', content: 'నమస్కారం రమేష్ గారు! నేను రెసొనెన్స్ హైదరాబాద్ నుండి స్నేహను మాట్లాడుతున్నాను.' }, { role: 'user', content: 'అవును చెప్పండి.' }, { role: 'assistant', content: 'సాత్విక్ ఇప్పుడు ఏ క్లాస్ లో ఉన్నాడు మరియు అతని లక్ష్యం ఏమిటి?' }, { role: 'user', content: 'వాడు టెన్త్ క్లాస్, వాడి గోల్ ఐఐటి.' } ] },
  { name: '4. Gibberish Background Noise (Avoid Roleplay)', lang: 'hi-IN', lead: dummyLead, history: [ { role: 'assistant', content: 'बहुत बढ़िया! तो बताइए, Sathvik अभी किस क्लास में है और उसका मेन गोल क्या है - IIT या NEET?' }, { role: 'user', content: 'अरे राजू वो टीवी बंद कर! अरे वो सब्जी जल रही है!' } ] },
  { name: '5. Angry Parent', lang: 'en-IN', lead: dummyLead, history: [ { role: 'assistant', content: 'So, Sathvik is currently in 10th grade and aiming for IIT. Have you thought about enrolling him in a coaching institute?' }, { role: 'user', content: 'Why are you people calling me every single day? I already told you I am busy!' } ] },
  { name: '6. Too Expensive Objection (No TODO leaks)', lang: 'hi-IN', lead: dummyLead, history: [ { role: 'assistant', content: 'हमारे पास एक scholarship test है। क्या आप इसके बारे में जानना चाहेंगे?' }, { role: 'user', content: 'नहीं, Resonance की फीस बहुत ज्यादा है, हम अफोर्ड नहीं कर सकते।' } ] },
  { name: '7. Gender Register Test (Female Lead)', lang: 'te-IN', lead: dummyLeadFemale, history: [ { role: 'assistant', content: 'నమస్కారం రమేష్ గారు! నేను రెసొనెన్స్ హైదరాబాద్ నుండి స్నేహను మాట్లాడుతున్నాను. సీత గురించి మాట్లాడటానికి ఇది కరెక్ట్ టైమేనా?' }, { role: 'user', content: 'అవును చెప్పండి.' } ] },
  { name: '8. Context Bloat Simulation (6 Turns)', lang: 'hi-IN', lead: dummyLead, history: [ { role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello Ramesh ji!' }, { role: 'user', content: 'Yes' }, { role: 'assistant', content: 'What is his goal?' }, { role: 'user', content: 'IIT' }, { role: 'assistant', content: 'Does he want MPC?' }, { role: 'user', content: 'Yes' }, { role: 'assistant', content: 'We have a scholarship test.' }, { role: 'user', content: 'Ok' }, { role: 'assistant', content: 'Should I send details on WhatsApp?' }, { role: 'user', content: 'Yes send it.' } ] },
  { name: '9. Acronym Phonetics', lang: 'en-IN', lead: dummyLead, history: [ { role: 'assistant', content: 'What stream does he want?' }, { role: 'user', content: 'BiPC and MPC.' } ] },
  { name: '10. The Wrap-Up', lang: 'en-IN', lead: dummyLead, history: [ { role: 'assistant', content: 'I can share the scholarship details on WhatsApp right now.' }, { role: 'user', content: 'Okay fine, just send it and call me tomorrow evening.' } ] }
];

async function runTests() {
  for (const t of tests) {
    console.log('\n=======================================================');
    console.log('TEST ' + t.name + ' (Lang: ' + t.lang + ')');
    if (t.isLangDetectTest) {
      let state = { personaLang: 'en-IN', streak: { lang: null, count: 0 } };
      for (const det of t.detectedLangSeq) {
        console.log('Detected: ' + det + ' -> Switched: ' + nextPersonaLang(state, det, 2) + ' -> Current Lang: ' + state.personaLang);
      }
      continue;
    }
    try {
      const msgs = [{ role: 'system', content: buildSystemPrompt(t.lead, t.lang) }, ...t.history, { role: 'system', content: formatReminder(t.lang) }];
      const { text: raw } = await generateAgentResponse({ messages: msgs, personaLang: t.lang });
      const parsed = parseTag(raw, t.lang);
      const processed = applyRegister(parsed.text, t.lead);
      const phonetics = ttsPhonetics(processed, t.lang);
      console.log('[RAW]: ' + raw);
      console.log('[PROCESSED]: ' + processed);
      if (processed !== phonetics) console.log('[PHONETICS]: ' + phonetics);
    } catch (e) { console.error(e.message); }
  }
}
runTests();
