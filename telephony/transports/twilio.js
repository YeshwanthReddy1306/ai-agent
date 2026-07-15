const { WebSocketServer } = require('ws');
const dnc = require('../../lib/dnc');
const besttime = require('../../lib/besttime');

// ---------- mulaw <-> PCM16 ----------
const MULAW_DECODE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  let t = (((u & 0x0f) << 3) + 0x84) << ((u & 0x70) >> 4);
  MULAW_DECODE[i] = (u & 0x80 ? 0x84 - t : t - 0x84);
}
const mulawToPcm = (buf) => {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = MULAW_DECODE[buf[i]];
  return out;
};

// Update a live Twilio call with new TwiML
async function twilioUpdateCall(SID, TOKEN, callSid, twiml) {
  if (!SID || !TOKEN || !callSid) return { ok: false, reason: 'missing creds/callSid' };
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Calls/${callSid}.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ Twiml: twiml }),
  });
  return { ok: r.ok, reason: r.ok ? '' : `twilio ${r.status}` };
}

const parseForm = (raw) => Object.fromEntries(new URLSearchParams(raw));

class TwilioTransport {
  constructor(bridge) {
    this.bridge = bridge; // { PUBLIC_URL, SID, TOKEN, FROM, createSession, sessionsByCallSid, scheduleMissed, leadsStore }
  }

  async handleHttp(req, res) {
    if (req.method === 'POST' && req.url.startsWith('/incoming')) {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const form = parseForm(raw);
        const from = form.From || '';
        console.log(`[bridge] INBOUND call from ${from || 'unknown'}`);
        const wss = this.bridge.PUBLIC_URL.replace(/^http/, 'ws') + '/media?inbound=1&from=' + encodeURIComponent(from);
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(`<Response><Connect><Stream url="${wss}"/></Connect></Response>`);
      });
      return true;
    }

    if (req.method === 'POST' && req.url.startsWith('/amd')) {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const form = parseForm(raw);
        const answeredBy = (form.AnsweredBy || '').toLowerCase();
        const s = this.bridge.sessionsByCallSid.get(form.CallSid);
        if (s && /machine|fax/.test(answeredBy)) s.onVoicemail().catch((e) => console.error('[amd]', e.message));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
      return true;
    }

    if (req.method === 'POST' && req.url.startsWith('/call-status')) {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const form = parseForm(raw);
        const status = (form.CallStatus || '').toLowerCase();
        const leadId = new URL(req.url, 'http://x').searchParams.get('leadId');
        const lead = this.bridge.leadsStore.byId(leadId);
        if (['no-answer', 'busy', 'failed', 'canceled'].includes(status)) {
          besttime.logDial('no_answer');
          if (lead) this.bridge.scheduleMissed(lead);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
      return true;
    }

    if (req.method === 'POST' && req.url === '/dial') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', async () => {
        try {
          const body = JSON.parse(raw || '{}');
          const SECRET = process.env.ACCESS_SECRET || '';
          if (SECRET && body.key !== SECRET) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Unauthorized — include the access key' }));
          }
          const lead = this.bridge.leadsStore.byId(body.leadId) || this.bridge.leadsStore.all()[0];
          if (!this.bridge.SID || !this.bridge.TOKEN || !this.bridge.FROM || !this.bridge.PUBLIC_URL) throw new Error('Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, PUBLIC_URL in .env');
          if (!body.to) throw new Error('Provide "to": "+91..." (E.164)');
          if (dnc.has(body.to)) throw new Error(`${body.to} is on the Do-Not-Call list — refusing to dial`);
          const wss = this.bridge.PUBLIC_URL.replace(/^http/, 'ws') + '/media?leadId=' + encodeURIComponent(lead.id);
          const twiml = `<Response><Connect><Stream url="${wss}"/></Connect></Response>`;
          const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.bridge.SID}/Calls.json`, {
            method: 'POST',
            headers: {
              Authorization: 'Basic ' + Buffer.from(`${this.bridge.SID}:${this.bridge.TOKEN}`).toString('base64'),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              To: body.to, From: this.bridge.FROM, Twiml: twiml,
              StatusCallback: `${this.bridge.PUBLIC_URL}/call-status?leadId=${encodeURIComponent(lead.id)}`,
              StatusCallbackEvent: 'completed',
              MachineDetection: 'Enable',
              AsyncAmdStatusCallback: `${this.bridge.PUBLIC_URL}/amd`,
              AsyncAmdStatusCallbackMethod: 'POST',
            }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.message || `Twilio ${r.status}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, callSid: j.sid, lead: lead.id }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    return false;
  }

  attachWebSocket(server) {
    const wss = new WebSocketServer({ server, path: '/media' });
    wss.on('connection', (ws, req) => {
      const params = new URL(req.url, 'http://x').searchParams;
      const inbound = params.get('inbound') === '1';
      let lead;
      if (inbound) {
        const from = params.get('from') || '';
        lead = this.bridge.leadsStore.findByPhone(from);
        if (!lead) {
          lead = {
            id: 'L-INB-' + Date.now().toString(36),
            parentName: 'there',
            studentName: 'your child', gender: 'male', language: 'te',
            area: '', tenthResult: '', interest: 'to be discovered',
            source: 'inbound call from unknown number', phone: from || 'unknown',
          };
        }
      } else {
        lead = this.bridge.leadsStore.byId(params.get('leadId')) || this.bridge.leadsStore.all()[0];
      }

      let callSid = null;
      let streamSid = null;

      const transportCtx = {
        sendAudio: (mulawBuf) => {
          for (let i = 0; i < mulawBuf.length; i += 800) {
            ws.send(JSON.stringify({
              event: 'media', streamSid,
              media: { payload: mulawBuf.slice(i, i + 800).toString('base64') },
            }));
          }
          ws.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: 'done' } }));
        },
        sendAudioRawBase64: (b64Payload) => {
          ws.send(JSON.stringify({
            event: 'media', streamSid,
            media: { payload: b64Payload },
          }));
        },
        clear: () => {
          ws.send(JSON.stringify({ event: 'clear', streamSid }));
        },
        hangup: async () => {
          await twilioUpdateCall(this.bridge.SID, this.bridge.TOKEN, callSid, '<Response><Hangup/></Response>').catch(() => {});
        },
        transfer: async (to) => {
          const twiml = `<Response><Dial callerId="${this.bridge.FROM}"><Number>${to}</Number></Dial></Response>`;
          return await twilioUpdateCall(this.bridge.SID, this.bridge.TOKEN, callSid, twiml);
        },
        supportsAmd: true,
        supportsLiveTransfer: true
      };

      const session = this.bridge.createSession(transportCtx, lead, { inbound });
      console.log(`media stream connected ${inbound ? '[INBOUND]' : ''} for ${lead.id} (${lead.parentName}, ${lead.phone})`);

      ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }
        if (msg.event === 'start') {
          streamSid = msg.start.streamSid;
          callSid = msg.start.callSid;
          if (callSid) this.bridge.sessionsByCallSid.set(callSid, session);
          session.onStart({ streamSid, callSid }).catch((e) => console.error(e.message));
        } else if (msg.event === 'media') {
          const pcm = mulawToPcm(Buffer.from(msg.media.payload, 'base64'));
          session.onMedia(pcm);
        } else if (msg.event === 'mark') {
          session.onMarkDone();
        } else if (msg.event === 'stop') {
          console.log('call ended by Twilio');
          session.finalize();
          if (callSid) this.bridge.sessionsByCallSid.delete(callSid);
        }
      });
      ws.on('close', () => { if (callSid) this.bridge.sessionsByCallSid.delete(callSid); });
    });
  }
}

module.exports = TwilioTransport;
