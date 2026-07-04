# Audit & Premortem — current state (2026-07-04, post Groq + real data + CRM + scheduler)
*Every finding below was verified by running the code this session, not inferred.*

## Findings, ranked

### CRITICAL
- **C1 — Groq leaks the emotion word into spoken text (English turns).** VERIFIED: a live Groq
  reply was `"Day scholar fee is one lakh sixty thousand for first year, serious ~~en-IN|serious~~"`
  → after tag-strip the SPOKEN text is `"...for first year, serious"` — the word "serious" is read
  aloud. Happens because Groq writes the emotion inline before the tag. **Fix applied this audit:**
  a format-reminder clause telling the model the emotion goes ONLY in the tag + a comma-guarded
  trailing-emotion strip in `parseTag`. Watch English turns to confirm it's gone.
- **C2 — Preflight is RED.** VERIFIED: `npm run preflight` FAILS on `te.js` differing from the
  locked baseline (your Antigravity Telugu tuning). The project's own launch gate ("no external
  calls until preflight green") is therefore currently violated. **Decision needed:** re-lock the
  baseline to your tuned `te.js` (`npm run lock-personas`) so the gate is honest again.

### HIGH
- **H1 — The phone bridge is drifted.** VERIFIED: `telephony/bridge.js` has ZERO references to
  `brainChat`, `crm`, or `scheduler`. So when we wire Twilio, real phone calls will NOT use Groq
  routing, will NOT create CRM leads, and will NOT schedule follow-ups — they behave differently
  from the web console. Must be brought to parity BEFORE the first real phone call.
- **H2 — Groq English quality is under-tested.** One probe passed (short, tagged, real fee), but
  `groqChat` runs at temperature 0.6, not the 0.45 that Sarvam needs for script adherence. English
  script fidelity and tag consistency across a full call are unproven. Consider 0.45 + more probes.
- **H3 — The real `college.json` made the system prompt heavy, and it's resent every turn.** With
  all the real fees/campuses/scholarships, the ~1,600-word persona is re-sent to the LLM on every
  turn. On a 7-15 min call (25-50 turns) that inflates cost and latency — the earlier ₹85k/month
  estimate is now optimistic. Prompt-trimming/caching (flagged, not built) is now the top cost lever.
- **H4 — The public tunnel URL has no auth or rate limit.** Anyone with the link can hit
  `/api/call/turn` and burn YOUR Sarvam/Groq/Twilio credits. Fine for a link you hold; risky the
  moment you share it around for a pitch. Add a shared-secret or basic rate limit before wide sharing.

### MEDIUM
- **M1 — JSON persistence isn't concurrency-safe or durable.** `crm.json` and `followups.json` use
  read-modify-write with no lock (two calls ending at once could lose an update) and are wiped on
  restart/redeploy. Fine for demo; move to Postgres for the pilot.
- **M2 — The scheduler queues but cannot SEND.** Due follow-ups pile up and only log — no channel
  is wired yet. Honest, but "reminders automated" isn't true end-to-end until Twilio SMS/WhatsApp is on.
- **M3 — `rcos-mvp/` still holds the dangerous scaffold.** Its `full-reasoning` route uses Groq for
  ALL languages and its `faq-rules.ts` hardcodes ₹1,00,000 fees. If anyone ever deploys `rcos-mvp`
  instead of `server.js`, Telugu breaks and fake fees return. Keep it clearly non-deployed, or fix/delete it.
- **M4 — Secrets exposed in chat.** Sarvam, Twilio (SID+token), GitHub PAT, and Groq keys were all
  pasted here and the PAT was used to push. Rotate all four when convenient; `.env` is gitignored so
  none are in the repo.

### LOW
- Tunnel is ephemeral (expected for the free/no-card path) — PC sleep or restart kills it, URL changes.
- CRLF line-ending warnings on every commit (add `.gitattributes`).
- Doc sprawl (PREMORTEM.md, RCOS-PREMORTEM.md, this) — keep one index.

---

## Premortem — "it's demo/launch day and it failed. Why?"

| # | Failure | Likelihood | Fix |
|---|---|---|---|
| 1 | Parent asks a fee in English, hears "…, serious" leak — looks broken | was high | ✅ fixed this audit (C1) — verify live |
| 2 | First real phone call skips CRM + scheduler + Groq; lead vanishes, no follow-up | high once Twilio is wired | bring bridge to parity (H1) before dialing |
| 3 | Shared demo link gets hit by strangers → credits drained | medium | add shared-secret/rate-limit (H4) before sharing widely |
| 4 | A 15-min hot call costs more than quoted (fat prompt × 50 turns) | high at pilot | prompt-trim (H3); re-measure real ₹/call |
| 5 | Someone deploys `rcos-mvp` → Telugu breaks, fake fees return | low but fatal | fix/delete the scaffold (M3) |
| 6 | Preflight was red the whole time → an unnoticed regression ships | medium | re-lock persona baseline, keep the gate green (C2) |
| 7 | PC sleeps mid-pitch → tunnel dies | medium | ngrok for the real pitch; keep PC awake |
| 8 | A chat-leaked key is abused | low-medium | rotate all four keys (M4) |

## What's genuinely healthy (credit where due)
Telugu/Hindi never touch Groq (verified `brain: sarvam(all)` fallback and language routing). Real
Resonance data flows correctly (Groq quoted the real ₹1,60,000 Y1 fee). Numbers are spoken naturally,
persona is locked, CRM + scheduler + dashboard are real, and the whole thing runs on one process with
graceful degradation. The bones are good; the findings above are the sanding, not structural.
