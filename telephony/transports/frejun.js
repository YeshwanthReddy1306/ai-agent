const { WebSocketServer } = require('ws');
const dnc = require('../../lib/dnc');
const besttime = require('../../lib/besttime');

class FrejunTransport {
  constructor(bridge) {
    this.bridge = bridge; 
  }

  async handleHttp(req, res) {
    if (req.method === 'POST' && req.url.startsWith('/api/frejun/flow')) {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let body;
        try { body = JSON.parse(raw); } catch { return res.end(); }
        
        const callId = body.call_id;
        const fromNumber = body.from_number;
        const params = new URL(req.url, 'http://x').searchParams;
        const leadId = params.get('leadId') || '';
        
        console.log(`[frejun] Flow webhook for call ${callId} from ${fromNumber}`);
        
        const qs = `?token=${encodeURIComponent(process.env.BRIDGE_WS_SECRET || '')}&callId=${encodeURIComponent(callId)}&leadId=${encodeURIComponent(leadId)}&from=${encodeURIComponent(fromNumber)}`;
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          action: 'stream',
          ws_url: this.bridge.PUBLIC_URL.replace(/^http/, 'ws') + '/api/frejun/media-stream' + qs,
          chunk_size: 500,
          record: true
        }));
      });
      return true;
    }

    if (req.method === 'POST' && req.url.startsWith('/api/frejun/call-status')) {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let form;
        try { form = JSON.parse(raw); } catch { return res.end(); }
        
        const status = (form.status || '').toLowerCase();
        console.log(`[frejun] status: ${status} for call ${form.call_id}`);
        
        if (['no-answer', 'failed', 'busy', 'canceled'].includes(status)) {
          besttime.logDial('no_answer');
          const session = this.bridge.sessionsByCallSid.get(form.call_id);
          if (session && session.lead) this.bridge.scheduleMissed(session.lead);
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
            return res.end(JSON.stringify({ error: 'Unauthorized' }));
          }
          const lead = this.bridge.leadsStore.byId(body.leadId) || this.bridge.leadsStore.all()[0];
          if (!process.env.FREJUN_API_KEY || !process.env.FREJUN_FROM_NUMBER || !this.bridge.PUBLIC_URL) {
            throw new Error('Set FREJUN_API_KEY, FREJUN_FROM_NUMBER, PUBLIC_URL in .env');
          }
          if (!body.to) throw new Error('Provide "to": "+91..."');
          if (dnc.has(body.to)) throw new Error(`${body.to} is on the Do-Not-Call list — refusing to dial`);

          console.log(`[frejun] Dialing ${body.to} for lead ${lead.id}...`);

          const r = await fetch('https://api.frejun.ai/api/v1/calls/initiate', {
            method: 'POST',
            headers: {
              'X-Api-Key': process.env.FREJUN_API_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from_number: process.env.FREJUN_FROM_NUMBER,
              to_number: body.to,
              flow_url: `${this.bridge.PUBLIC_URL}/api/frejun/flow?leadId=${encodeURIComponent(lead.id)}`,
              status_callback_url: `${this.bridge.PUBLIC_URL}/api/frejun/call-status?leadId=${encodeURIComponent(lead.id)}`,
              record: true
            }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.message || `FreJun ${r.status}`);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, callSid: j.data?.id || j.id, lead: lead.id }));
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
    const wss = new WebSocketServer({ server, path: '/api/frejun/media-stream' });
    wss.on('connection', (ws, req) => {
      const params = new URL(req.url, 'http://x').searchParams;
      const token = params.get('token') || '';
      if (process.env.BRIDGE_WS_SECRET && token !== process.env.BRIDGE_WS_SECRET) {
        console.warn('[frejun] Unauthorized WS connection');
        ws.close();
        return;
      }

      let callSid = params.get('callId') || 'unknown';
      let leadId = params.get('leadId');
      let inbound = !leadId;

      let lead = leadId ? this.bridge.leadsStore.byId(leadId) : null;
      if (!lead) {
        lead = this.bridge.leadsStore.findByPhone(params.get('from'));
        if (!lead) {
          lead = {
            id: 'L-INB-' + Date.now().toString(36),
            parentName: 'there',
            studentName: 'your child', gender: 'male', language: 'te',
            area: '', tenthResult: '', interest: 'to be discovered',
            source: 'inbound call', phone: params.get('from') || 'unknown',
          };
        }
      }

      let chunkIdCounter = 1;
      let playbackTimer = null;
      let session;

      const transportCtx = {
        sendAudioRawBase64: (b64Payload) => {
          ws.send(JSON.stringify({
            type: 'audio',
            audio_b64: b64Payload,
            chunk_id: chunkIdCounter++
          }));
          
          const byteLen = (b64Payload.length * 3) / 4;
          const durationMs = (byteLen / 16000) * 1000;
          
          if (playbackTimer) clearTimeout(playbackTimer);
          playbackTimer = setTimeout(() => {
            if (session) session.onMarkDone();
          }, durationMs);
        },
        sendAudio: (mulawBuf) => {
          console.error('[frejun] sendAudio(mulaw) called! FreJun expects raw PCM.');
        },
        clear: () => {
          ws.send(JSON.stringify({ type: 'clear' }));
          if (playbackTimer) {
            clearTimeout(playbackTimer);
            playbackTimer = null;
          }
          if (session) session.onMarkDone(); 
        },
        hangup: async () => {
          ws.close(1000);
        },
        transfer: async (to) => {
          throw new Error('Transfer not verified on FreJun yet');
        },
        supportsAmd: false,
        supportsLiveTransfer: false
      };

      session = this.bridge.createSession(transportCtx, lead, { inbound });
      if (callSid !== 'unknown') this.bridge.sessionsByCallSid.set(callSid, session);
      
      session.onStart({ callSid }).catch(console.error);

      ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }
        
        if (msg.type === 'audio' && msg.data?.audio_b64) {
          const pcmBuf = Buffer.from(msg.data.audio_b64, 'base64');
          session.onMedia(pcmBuf);
        }
      });
      
      ws.on('close', () => {
        if (playbackTimer) clearTimeout(playbackTimer);
        session.finalize();
        if (callSid !== 'unknown') this.bridge.sessionsByCallSid.delete(callSid);
      });
    });
  }
}

module.exports = FrejunTransport;
