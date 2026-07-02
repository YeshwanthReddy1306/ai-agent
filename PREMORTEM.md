# Premortem — "It's January 2027 and Phoenix Voice failed. Why?"

Ranked by (likelihood × damage). ✅ = already mitigated in this build, 🔜 = mitigation planned, ⚠️ = open decision for you.

## 1. Parents hang up in the first 10 seconds ("it felt like a robot")
**Likelihood: high · Damage: fatal.** The entire value proposition is humanness.
- ✅ Persona enforces 1–2 sentence turns, one question at a time, filler budget, no lists/recaps.
- ✅ Emotion tag → TTS delivery mapping (excited/empathetic/calm change pace + expressiveness).
- ✅ Deterministic natural greeting (no LLM delay on the first impression).
- 🔜 The real killer is **latency** (see #2) and **turn-taking**: humans reply in ~200 ms, this build takes 2–4 s. Acceptable in a demo, noticeable on a phone. Fix: Sarvam streaming STT/TTS + speculative TTS of the first clause.
- ⚠️ Test with 10 real Telugu-speaking parents before any campaign. Their verdict is the only benchmark.

## 2. Latency spiral
**Likelihood: high · Damage: high.** Three sequential API calls per turn (STT → LLM → TTS).
- ✅ `sarvam-30b` + `reasoning_effort: low` + 220-token cap (short replies are also more human).
- ✅ VAD endpointing at 900 ms silence — the biggest hidden latency is usually waiting too long to decide the user finished.
- 🔜 Streaming APIs (both STT and TTS support WebSockets) would cut perceived latency to ~1–1.5 s.

## 3. Legal/regulatory shutdown (India-specific — the spec ignored this entirely)
**Likelihood: medium · Damage: fatal for outbound at scale.**
- ⚠️ **TRAI TCCCPR**: unsolicited commercial calls require registration as a telemarketer, a 140-series number, and **DND registry scrubbing**. Fines are per violation and providers disconnect violators. Calling *existing enquiries/leads* (like this build's queue) is materially safer than cold lists — keep it that way.
- ⚠️ **AI disclosure**: multiple jurisdictions are moving to mandatory disclosure of synthetic voices. The persona deflects the "are you a robot?" question once with humour, then **admits honestly if pressed** — this is deliberate; scripting it to lie is a brand-destroying news story waiting to happen ("College uses AI to trick parents").
- ⚠️ **DPDP Act 2023**: you're processing minors' academic data + parents' phone numbers. Needs consent records, retention policy, and deletion on request. `calls.jsonl` currently keeps summaries forever — add retention before production.
- ⚠️ Call recording/transcription consent line at call start for production.

## 4. The agent invents fees, dates, or seat promises
**Likelihood: medium · Damage: high** (an invented ₹40,000 fee is a refund demand + reputation hit).
- ✅ Facts locked to `agent/college.json`; unknown → "office will confirm on WhatsApp today".
- 🔜 Log every call transcript and spot-check weekly; add a regression suite of 30 tricky questions ("free seat confirm ah?", "hostel lo non-veg unda?", "principal evaru?").

## 5. Language detection misfires on Hyderabadi code-mixing
**Likelihood: medium · Damage: medium.** "Fees entha in total, sir cheppandi" can confuse STT language tags.
- ✅ STT set to auto-detect (`unknown`) and the **LLM chooses the reply language itself** via the hidden tag — so a wrong STT language label doesn't force a wrong reply language.
- ✅ TTS language whitelist with en-IN fallback prevents hard failures on a bad tag.
- 🔜 If Telugu STT accuracy disappoints on telephone (8 kHz) audio, test `saarika:v2.5` vs `saaras:v3` on real call recordings.

## 6. Sarvam API outage or rate limits mid-campaign
**Likelihood: low-medium · Damage: medium.**
- ✅ Every API error surfaces cleanly in the UI and ends the turn gracefully rather than dead air.
- 🔜 For production: retry-once with backoff, a "let me call you right back" TTS fallback (pre-rendered audio file, no API needed), and a circuit breaker that pauses the dialer.

## 7. Cost blindness
**Likelihood: medium · Damage: medium.** Credits burn silently; a stuck VAD loop could stream noise turns.
- ✅ Empty/noise transcripts short-circuit (no LLM/TTS spend on silence).
- ✅ 15 s hard cap per utterance, 30 MB body cap.
- 🔜 Add per-call and per-day spend counters to `calls.jsonl` records once real pricing is measured.

## 8. Demo-to-phone gap disappoints
**Likelihood: high · Damage: medium.** Browser audio is 16 kHz clean; phone lines are 8 kHz with traffic noise, crosstalk, kids shouting.
- 🔜 Phase 2 plan in README: Exotel/Twilio media streams, mulaw transcoding, re-tuned VAD thresholds, and STT accuracy re-testing on real telephone recordings **before** promising anything to a college.

## 9. One angry viral moment
**Likelihood: low · Damage: high.** A parent posts a recording: the agent argued, or wouldn't take no.
- ✅ Persona: accepts "not interested" warmly on the second no, never criticizes rival colleges, closes politely.
- 🔜 Production: hard cap call length (~6 min), sentiment check in the summary, human-escalation phrase ("I'll have our senior counselor call you").

## 10. The codebase rots into the 16-phase monster
**Likelihood: medium · Damage: slow death.** The original spec prescribed React+Redux+NestJS+Postgres+RabbitMQ for what is, today, one process and three fetch calls.
- ✅ Zero dependencies, ~600 lines total, one config file per college. Add infrastructure only when a real limit is hit (multi-tenant → then a DB; concurrent calls at scale → then a queue).
