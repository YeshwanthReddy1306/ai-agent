// M3 one-time setup: point the Twilio number's incoming-call webhook at our bridge.
// Run AFTER the bridge tunnel is up (PUBLIC_URL in .env):  node scripts/setup-inbound.js
// Re-run whenever the tunnel URL changes (quick tunnels change on every restart).
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const SID = process.env.TWILIO_ACCOUNT_SID, TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM = process.env.TWILIO_FROM_NUMBER, PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
if (!SID || !TOKEN || !FROM || !PUBLIC_URL) { console.error('Need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, PUBLIC_URL in .env'); process.exit(1); }

const auth = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64');

(async () => {
  const list = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(FROM)}`, { headers: { Authorization: auth } }).then((r) => r.json());
  const num = (list.incoming_phone_numbers || [])[0];
  if (!num) { console.error(`Number ${FROM} not found on this Twilio account.`); process.exit(1); }
  const voiceUrl = `${PUBLIC_URL}/incoming`;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers/${num.sid}.json`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ VoiceUrl: voiceUrl, VoiceMethod: 'POST' }),
  });
  const j = await r.json();
  if (!r.ok) { console.error('Twilio error:', j.message || r.status); process.exit(1); }
  console.log(`INBOUND READY — calls to ${FROM} now reach Sneha.`);
  console.log(`  VoiceUrl: ${j.voice_url}`);
})();
