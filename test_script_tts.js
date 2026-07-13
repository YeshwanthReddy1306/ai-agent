const { textToSpeech } = require('./lib/sarvam');
async function test() {
  const text1 = 'అవునండి రమేష్ గారు, మా Madhapur campus లో BiPC కి మంచి faculty ఉన్నారు.';
  const text2 = 'అవునండి రమేష్ గారు, మా మాదాపూర్ క్యాంపస్ లో బైపీసీ కి మంచి ఫ్యాకల్టీ ఉన్నారు.';
  
  console.log('Testing Latin script mixing...');
  try { await textToSpeech(text1, 'te-IN'); console.log('Latin script OK'); } catch(e) { console.log('Latin script error', e.message); }
  
  console.log('Testing Telugu script mixing...');
  try { await textToSpeech(text2, 'te-IN'); console.log('Telugu script OK'); } catch(e) { console.log('Telugu script error', e.message); }
}
test();
