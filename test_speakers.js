require('dotenv').config();
async function test() {
  const res = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: { 'api-subscription-key': process.env.SARVAM_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'hello',
      target_language_code: 'te-IN',
      model: 'bulbul:v3',
      speaker: 'invalid_speaker_name_123',
    }),
  });
  console.log(res.status);
  console.log(await res.text());
}
test();
