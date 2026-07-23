# Phoenix Voice Agent 🔥

A human-sounding AI voice agent for **junior college admissions & sales teams** (Hyderabad).
It calls parents, speaks natural **Telugu / Hindi / English / code-mixed** like a real senior
admissions counselor, handles objections, books campus visits, and writes a call summary with
an interest score for the sales team.

Built on **Sarvam AI** (trained on Indian data):

| Stage | Service | Why |
|---|---|---|
| Hearing | Saaras v3 STT | Auto-detects Telugu/Hindi/English, handles Hyderabad code-mixing |
| Brain | Sarvam-105B LLM | Indian-language-native, highest quality for live calls |
| Voice | Bulbul v3 TTS | Natural Indian voices with emotion control (pace + expressiveness) |

**Zero npm dependencies.** Plain Node 18+. One server file.

## Quickstart (2 minutes)

```bash
# 1. Get a free API key (free credits included): https://dashboard.sarvam.ai
# 2. Configure
cp .env.example .env        # then paste your key into SARVAM_API_KEY=
# 3. Run
node server.js
# 4. Open http://localhost:3100 — pick a lead, press "Start call", allow the mic, and talk.
```

The call is fully hands-free: the agent greets first, then a voice-activity detector figures out
when you finish speaking. Tap the glowing circle to interrupt her mid-sentence (barge-in).

## v2 — emotional intelligence & humanization

- **EQ engine**: the persona diagnoses the parent's state every turn (worried / proud / skeptical /
  busy / irritated / chatty) and answers the *feeling* before the fact — mirror-then-lead.
- **9 emotions** mapped to voice delivery: warm, excited, empathetic, calm, urgent, amused,
  reassuring, concerned, proud (each changes pace + expressiveness in Bulbul v3).
- **Thinking-acks**: while the pipeline works, the agent murmurs a natural "haan…", "అలాగా…",
  "hmm…" (cached clips, near-zero cost) — the silence that screams "computer" is gone.
- **Human imperfections, budgeted**: thinking sounds, occasional self-repair, trailing thoughts —
  at most one per turn so it never becomes a tic.
- **No clipped first syllable**: a rolling pre-speech buffer captures the run-up before the VAD
  triggers, so "MPC fees entha?" never arrives as "...C fees entha?".
- **Faster turns**: 700 ms end-of-speech detection + parallel sentence-split TTS (first audio
  chunk arrives while the second is still rendering).
- **Second-no-is-final**: a graceful, warm exit is scripted into the sales playbook.
- **Regression suite**: `npm test` fires 16 tricky parent questions (fee traps, invented-fact bait,
  "are you a robot?", rival-college bait) and auto-flags invented numbers, robotic tells, monologues.
- **Ops hardening**: retry-once on every API call, text-only degradation when TTS fails, per-call
  usage metering, 6-min call cap with warm wrap-up, 90-day retention purge, stale-call sweep.

## How a turn works

```
Browser mic ──WAV──▶ POST /api/call/turn
                      ├─ Sarvam STT  (saaras:v3, language auto-detect)
                      ├─ Sarvam LLM  (persona prompt + lead context + full call memory)
                      │    reply ends with hidden tag  ~~te-IN|excited~~
                      ├─ Sarvam TTS  (bulbul:v3, emotion → pace/expressiveness)
                      ◀─ { transcript, reply, mp3 }
Browser plays reply ──▶ listens again
```

The agent decides **which language to speak** and **which emotion to use** on every turn via the
hidden tag; the server maps emotion → voice delivery (excited = faster + more expressive,
empathetic = slower + softer, etc.).

## Project layout

```
server.js            entire backend: static server + STT→LLM→TTS pipeline + call log
agent/persona.js     the system prompt that makes it sound human (the crown jewel)
agent/college.json   YOUR college's facts — edit this to onboard a new college
data/leads.json      the lead queue shown in the UI
data/calls.jsonl     appended after every call: summary, interest, objections (gitignored)
public/              call console UI (no framework)
```

## Onboarding a different college

Edit `agent/college.json` only — name, campuses, streams, fees, results, scholarship policy.
The persona, sales playbook, and guardrails are built in `agent/persona.js` from that file.
The agent is instructed to **never state a fact that isn't in the JSON** — unknown questions get
a natural "office will confirm on WhatsApp" instead of a hallucinated fee.

## What the recovered spec missed (and this build fixes)

The original "Project Phoenix" reconstruction (React/Redux/NestJS/Postgres, 16 phases) was a
generic SaaS skeleton. The things that actually decide whether this product works were absent:

1. **No voice pipeline at all** — now: complete STT→LLM→TTS loop with turn memory.
2. **No Indian-language design** — now: Sarvam end-to-end, auto language detection, mid-call switching.
3. **No humanness engineering** — now: persona with speech habits, 1–2 sentence turns, filler budget,
   number verbalization, anti-robotic bans, emotion-controlled delivery.
4. **No hallucination guardrails** — now: facts locked to `college.json`.
5. **No end-of-speech detection** — now: adaptive-threshold VAD in the browser.
6. **No barge-in** — now: tap-to-interrupt (auto voice barge-in on the roadmap).
7. **No sales outcome capture** — now: post-call LLM summary + interest score + objection list to `calls.jsonl`.
8. **No compliance thinking** — see [PREMORTEM.md](PREMORTEM.md) (TRAI/DND, DPDP, AI disclosure).

## Real phone calls (Phase 2 — bridge included, needs your Twilio creds)

The Twilio Media Streams bridge is written at `telephony/bridge.js` — same brain, phone transport
(8 kHz mulaw both ways, voice barge-in via `clear` events). To run it:

```bash
npm i ws                      # the only dependency, telephony-only
ngrok http 3200               # any public tunnel works
# .env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, PUBLIC_URL
npm run telephony
curl -X POST localhost:3200/dial -H "Content-Type: application/json" -d '{"leadId":"L-1001","to":"+91XXXXXXXXXX"}'
```

It is code-complete but **untested until credentials exist** — make the first call to your own
phone. India-native alternatives (Exotel/Ozonetel) use the same shape and ease TRAI compliance.
Next latency step: Sarvam's streaming STT/TTS WebSockets for sub-1.5 s turns.

**Compliance before scale**: telemarketer registration, 140-series caller ID, DND scrubbing,
recording consent. Details in PREMORTEM.md — India fines per violation.

## Costs (rough, per minute of call)

Sarvam pricing is credit-based; a typical turn ≈ 10 s audio STT + ~300 LLM tokens + ~15 s TTS.
At current published rates a full 3-minute call lands around **₹2–4** — versus ₹80–150 for a human
tele-caller minute-for-minute including salary/overheads. Verify current rates at dashboard.sarvam.ai.

8. Key upgrades you'll be doing for all of this
To elevate this architecture further, particularly from a full-stack and machine learning perspective, you could implement:

Advanced RAG (Retrieval-Augmented Generation): Ensure the model accesses a vector database of the institute's specific rulebooks and scholarship matrices so it never hallucinates a fee structure.

Live Sentiment Analysis: Build a backend flag in the CRM that monitors the parent's tone during the AI call. If the parent sounds frustrated or highly hesitant regarding fees, the system should trigger an immediate live-transfer to a human closer.

Omnichannel Integration: Expand the logic beyond voice. If a parent doesn't answer the phone, the system should seamlessly drop a conversational WhatsApp message that uses the exact same memory context as the voice agent.
