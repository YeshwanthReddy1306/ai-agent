# Phoenix Voice Agent 🔥

A human-sounding AI voice agent for **junior college admissions & sales teams** (Hyderabad).
It calls parents, speaks natural **Telugu / Hindi / English / code-mixed** like a real senior
admissions counselor, handles objections, books campus visits, and writes a call summary with
an interest score for the sales team.

Built on **Sarvam AI** (trained on Indian data):

| Stage | Service | Why |
|---|---|---|
| Hearing | Saaras v3 STT | Auto-detects Telugu/Hindi/English, handles Hyderabad code-mixing |
| Brain | Sarvam-30B LLM | Indian-language-native, fast enough for live calls |
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

## Roadmap to real phone calls (Phase 2)

The web console is the product demo + agent tuning bench. To dial real numbers:

1. **Telephony provider**: Twilio Programmable Voice (global) or Exotel/Ozonetel (India-native,
   easier TRAI compliance). Outbound call → audio bridged over a **Media Streams WebSocket**.
2. **Swap transport, keep the brain**: the `/api/call/turn` pipeline stays identical; the WebSocket
   bridge replaces the browser (8 kHz mulaw in/out instead of 16 kHz WAV).
3. **Cut latency for phone-grade turn-taking**: move to Sarvam's **streaming** STT/TTS WebSocket APIs
   (partial transcripts in, chunked audio out) — target < 1.5 s response time.
4. **Compliance before scale**: register as telemarketer, 140-series caller ID, DND scrubbing,
   call-recording consent line. Details in PREMORTEM.md — India fines per violation.

## Costs (rough, per minute of call)

Sarvam pricing is credit-based; a typical turn ≈ 10 s audio STT + ~300 LLM tokens + ~15 s TTS.
At current published rates a full 3-minute call lands around **₹2–4** — versus ₹80–150 for a human
tele-caller minute-for-minute including salary/overheads. Verify current rates at dashboard.sarvam.ai.
