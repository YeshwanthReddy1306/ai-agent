// Unified outbound message channel (Dept 4/6/9/12 all send through here).
// Order: WhatsApp Business API (when WHATSAPP_TOKEN is real) -> SMS (Twilio) -> queued/logged.
// WhatsApp is fully wired but dormant until real keys arrive — flip two env vars and every
// department starts sending on WhatsApp with zero code change.
const { sendSms } = require('./scheduler');

const PLACEHOLDER = /PLACEHOLDER|ADD_WHEN/i;
function whatsappReady() {
  const t = process.env.WHATSAPP_TOKEN || '';
  return t && !PLACEHOLDER.test(t) && !!process.env.WHATSAPP_PHONE_ID;
}

// WhatsApp Cloud API sender (Meta Graph). Utility templates are ₹0.115; free inside a
// 24h service window. Dormant until WHATSAPP_TOKEN + WHATSAPP_PHONE_ID are set for real.
async function sendWhatsApp(to, text) {
  if (!whatsappReady()) return { sent: false, reason: 'whatsapp not configured (placeholder token)' };
  const clean = String(to || '').replace(/\D/g, '');
  if (clean.length < 10) return { sent: false, reason: 'not a real phone number' };
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: clean, type: 'text', text: { body: text.slice(0, 1000) } }),
    });
    if (!res.ok) return { sent: false, reason: `whatsapp ${res.status}: ${(await res.text()).slice(0, 120)}` };
    return { sent: true, channel: 'whatsapp' };
  } catch (e) { return { sent: false, reason: 'whatsapp error: ' + e.message }; }
}

// One send point. preferred = 'whatsapp' (most departments) or 'sms'. Falls back gracefully;
// caller decides whether an unsent message should be re-queued (the scheduler does).
async function send({ to, text, preferred = 'whatsapp' }) {
  if (preferred === 'whatsapp') {
    const w = await sendWhatsApp(to, text);
    if (w.sent) return w;
    const s = await sendSms(to, text);
    if (s.sent) return { sent: true, channel: 'sms', fellBack: true };
    return { sent: false, channel: null, reason: w.reason + ' / ' + s.reason };
  }
  const s = await sendSms(to, text);
  return s.sent ? { sent: true, channel: 'sms' } : { sent: false, reason: s.reason };
}

module.exports = { send, sendWhatsApp, whatsappReady };
