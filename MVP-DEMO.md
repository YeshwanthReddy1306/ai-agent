# MVP Demo Runbook
*How to demo the agent, what each RCOS failure mitigation looks like in THIS codebase, and what must be true before demoing to Resonance.*

---

## 1. The 10 RCOS Failures — honest status in this MVP

| # | RCOS failure | What exists HERE, today | Phase-2 (post-demo) |
|---|---|---|---|
| F1 | Knowledge outdated | Fact sanitizer (TODOs can never be spoken); `factsUpdatedAt` staleness warning in preflight; old configs kept as `.bak` | Per-field effective dates; per-branch config files |
| F2 | Unexpected questions | Persona defers unknowns to "office confirms on WhatsApp"; every deferred question auto-logged to `data/edge-cases.jsonl` at call end → human answers it → add to `college.json` faq → gap closed. Preflight counts open items. | Review dashboard; auto-suggest faq entries |
| F3 | Latency | ONE synchronous LLM hop (doctrine in AGENT-SPEC §1.6); per-turn stage timings (STT/LLM/TTS) logged + shown as a chip on every reply; P50/P95 over last 500 turns in `/api/health` | Sarvam streaming STT/TTS WebSockets → target ≤1.5s |
| F4 | Over-automation | Scope is deliberately Phase-1 only: inform, handle objections, book campus visits. No payments, no documents, no lifecycle. | Add features only per the phase gates, on metrics |
| F5 | Knowledge quality | Preflight prompt lint (no TODO/undefined, 4 leads × 3 langs); 16-question golden regression (`npm test`) flags invented numbers, robotic tells, monologues | Grow golden set from real transcripts |
| F6 | Branch testing matrix | Single branch by design; the whole knowledge layer is one swappable `college.json` | One config per branch; regression runs per config |
| F7 | Management acceptance | The demo itself + transcripts + call summaries + usage metering = the evidence pack | Counselor-as-trainer edge-case workflow |
| F8 | Complacency | `npm run preflight` before every session; `npm test` after every persona/facts change; full transcripts for spot-checks | Pass-rate history; scheduled weekly run |
| F9 | Uncalibrated confidence | Honestly: NOT built — fake calibration is worse than none. The data to calibrate on (booked-visit outcomes) starts accumulating in calls.jsonl now | Calibrate once ≥100 calls have outcomes |
| F10 | Complexity cascade | Zero-dependency core; retry-once on every API call; TTS→text degradation; client auto-retry; per-service consecutive-failure health in `/api/health`; stale-call sweep | Circuit-break the dialer when failures spike |

## 2. Pre-demo checklist (do NOT demo to Resonance until all ✅)

- [ ] Real fees/batch/results in `college.json` (kills the 10 preflight TODO warnings) + set `factsUpdatedAt`
- [ ] `compliance.brandAuthorized: true` (their written OK) — or demo under a neutral college name
- [ ] `npm run preflight` → zero warnings
- [ ] `npm test` → pass on real facts (the fee checks only work with real numbers)
- [ ] 3 rehearsal calls (one per language) reviewed via `data/transcripts/`
- [ ] Sarvam credit balance checked at dashboard.sarvam.ai
- [ ] Server started fresh: `node server.js` → both boot warnings gone

## 3. Demo script (12 minutes)

1. **Open http://localhost:3100** — show the lead queue ("these are real enquiry leads, not cold calls").
2. **Telugu call (the star)** — call Ramesh Goud. Let her greet in English, reply in Telugu → instant mirror. Ask "MPC fees entha?" → *serious* tone + scholarship path. Object "fees ekkuva undi" → the diagnostic script ("ROI గురించా, లేక financially tight గా ఉందా?"). Say "Narayana chustunnam" → polite differentiation. Agree to visit → two-slot close.
3. **Show the barge-in** — interrupt her mid-sentence (tap the orb): "she stops and listens, like a person."
4. **Language switch mid-call** — throw one Hindi sentence in; watch the mirror.
5. **End call** — the summary card: interest score, next action, objections, per-call cost metering. "This lands in your sales team's queue automatically."
6. **Show the transcript file** — full auditability of every word.
7. **Show `/api/health`** — live P50/P95 latency, per-service health: "we measure ourselves."
8. **The refusal ladder (optional, powerful)** — say no twice; she asks only for a campus visit before deciding, then blesses the child and lets go gracefully.
9. **Close with the numbers** — rupees per call vs a tele-caller, 24/7, three languages, every call logged and scored.

## 4. What NOT to claim in the demo

- Not "replaces your counselors" → **"answers every enquiry within a minute of it arriving, and hands your counselors warm, scored leads."**
- Not "under 1 second" → **"replies in 2–4 seconds today, sub-2 seconds on our streaming roadmap."**
- Not "never wrong" → **"it can only state facts you approved; anything else it defers to your office — and logs the question so the answer gets added."**
