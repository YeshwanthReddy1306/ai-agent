# Deploy the working voice agent to Render (fast path — no Dograh)

This deploys `server.js` (the working Sneha voice agent) as a Render Node web service.
Result: a live **HTTPS** URL you can open on any phone/laptop to Web Call the agent.
Time: ~20 minutes. No Docker, no Dograh, no Next.js.

## Why this and not Dograh
`server.js` already does STT → Sneha persona → TTS with a built-in browser call console.
Dograh only adds real phone-line (Jio SIP) telephony — not needed for an MVP/demo/test.
Add Dograh later, only when you need actual inbound/outbound phone numbers.

## Step 0 — put the repo on GitHub (one time)
Render deploys from a Git repo. From this folder:
```bash
# create an EMPTY repo at github.com/new (e.g. "sneha-voice-agent"), then:
git remote add origin https://github.com/<you>/sneha-voice-agent.git
git branch -M main
git push -u origin main
```
`.env` is gitignored, so your Sarvam key is NOT pushed — you'll set it in Render (below).

## Step 1 — create the service on Render
1. render.com → sign in with GitHub.
2. **New → Blueprint** → pick this repo. Render reads `render.yaml` and proposes the
   `sneha-voice-agent` web service. Click **Apply**.
   (Or: **New → Web Service** → this repo → Build `npm install`, Start `node server.js`.)

## Step 2 — set the secret
In the service → **Environment** → add:
- `SARVAM_API_KEY` = your key (marked secret)

The other vars (voice=simran, model=sarvam-105b, temperature=0.45) come from `render.yaml`.

## Step 3 — test
When the deploy is green, open `https://sneha-voice-agent.onrender.com`:
- `/api/health` should return `{"ok":true,"hasKey":true,...}`
- On the main page: pick a lead → **Start call** → allow mic → talk in Telugu.
  HTTPS means the mic works and you can send the link to anyone.

## Notes
- **Free plan** sleeps when idle (first call after a nap is slow). **Starter ($7/mo)** stays awake.
- `data/calls.jsonl` and transcripts are ephemeral on Render (wiped on redeploy) — fine for
  testing. Add a Render Postgres only when you need durable leads/CRM (Phase 2).
- This is the SAME code as localhost:3100 — Sarvam-105b, locked persona, fast-path off,
  spoken numbers. Nothing about the voice changes.

## When you actually need phone calls (later)
Then — and only then — add Dograh (or Twilio/Exotel) as a separate service that bridges a
phone line to this agent's `/api/call/turn`. The `telephony/bridge.js` in this repo is the
starting point. Don't block the MVP on it.
