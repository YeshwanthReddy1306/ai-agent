# Premortem v3 — "It's January 2027 and Phoenix Voice failed. Why?"

Round 1 raised 10 risks — all code-fixable ones fixed in v2. Round 2 raised 7 new ones (N1–N7) —
all code-fixable ones now fixed in v3 (voice: **Simran**, bulbul:v3, 48 kHz). This round records
those fixes and what genuinely remains. ✅ = mitigated in code, 🔜 = planned, ⚠️ = only you can do it.

## Status of the original 10

| # | Risk | Status |
|---|------|--------|
| 1 | Robot feel in first 10 seconds | ✅ EQ persona (mood reading, mirror-then-lead), varied greetings, disfluency budget, thinking-acks ("haan…", "hmm…") that fill the silence while the LLM works |
| 2 | Latency spiral | ✅ VAD endpoint 900→700 ms, pre-speech buffer (no re-asks from clipped audio), parallel sentence-split TTS (first audio ~2× sooner on long replies), acks mask the rest · 🔜 streaming APIs for sub-1.5 s |
| 3 | Compliance shutdown | ✅ 6-min call cap with warm wrap-up, 90-day retention purge, lead notes marking existing-enquiry status · ⚠️ telemarketer registration + 140-series number before scale (below) |
| 4 | Invented fees/promises | ✅ facts locked to college.json + FAQ block + **automated regression suite** (`npm test`, 16 tricky questions, flags any number not in the facts) |
| 5 | Language detection misfires | ✅ LLM picks reply language (not STT), sticky language across turns, whitelist + fallback |
| 6 | API outage mid-call | ✅ retry-once with backoff on every Sarvam call, TTS failure degrades to on-screen text instead of dead air, client auto-retries a failed turn once |
| 7 | Cost blindness | ✅ per-call usage metering (STT seconds, LLM tokens, TTS chars) in every summary + calls.jsonl; silence costs zero (no-transcript short-circuit); ack clips cached on disk forever (one-time cost) |
| 8 | Demo-to-phone gap | ✅ telephony bridge written (Twilio Media Streams ↔ Sarvam, mulaw 8 kHz, voice barge-in) — ⚠️ UNTESTED until Twilio creds arrive; treat first real call as a test call |
| 9 | Angry viral moment | ✅ second-no-is-final rule, never-argue EQ rules, escalation line, hard call cap, mood captured in summary |
| 10 | Codebase rot | ✅ still zero npm deps for the core (ws only for optional telephony); ~1,600 lines total |

## Round-2 risks (N1–N7) — status after v3

| # | Risk | v3 status |
|---|------|-----------|
| N1 | Ack clips backfire after sad news | ✅ Acks reduced to strictly neutral murmurs only ("hmm…", "hmm, one second…") in all three languages — no agreement/cheer sounds left to land wrong. Still delayed 700 ms, still only when the reply is slow. |
| N2 | Mid-reply TTS prosody seam | ✅ Split threshold raised 110 → 200 chars: typical 1–2 sentence replies are now ALWAYS a single TTS call (no seam possible); only genuinely long turns split, and only at a sentence pause. |
| N3 | Persona drift on long calls | ✅ A ~30-token format reminder is appended to every LLM call (never stored in history): 1–2 sentences, mirror language, emit the tag. Drift can no longer accumulate past a single turn. Fallbacks + `npm test` remain as the safety net. |
| N4 | Speakerphone/echo self-interruption | ✅ Bridge VAD now env-tunable (`BRIDGE_VAD_LEVEL`, default 600; `BRIDGE_MIN_SPEECH_MS`, default 250) and barge-in requires ~400 ms of sustained speech while the agent is talking — echo blips and coughs no longer cut her off. Web side already covered by echoCancellation + phase gating. |
| N5 | Twilio bridge untested | ⚠️ Unchanged by design — needs your Twilio creds. First call goes to your own phone with the console open. |
| N6 | Credit exhaustion mid-demo | ✅ Running session totals now in `/api/health` and logged after every call (calls, STT seconds, LLM tokens, TTS chars). ⚠️ Still check the dashboard balance before a college demo. |
| N7 | Premature multi-tenant build-out | ✅ Decision recorded: nothing multi-tenant until college #2 signs. No code needed. |

## New in v3 (introduced by the v3 changes — small, watch-only)

### V1. `simran` voice + 48 kHz assumptions unverified against the live API
**Likelihood: low · Damage: low.** Voice set to Simran (bulbul:v3) at 48 kHz per your playground
choice; both values come straight from Sarvam's published docs, but the first live TTS call is the
real test. If the API rejects the speaker or rate, the error surfaces cleanly in the UI and it's a
one-line `.env` change (`AGENT_VOICE`, or drop sample rate to 24000).

### V2. 48 kHz audio doubles response payloads
**Likelihood: certain · Damage: negligible locally.** ~2× the base64 over the wire vs 24 kHz.
Irrelevant on localhost/LAN demos; if you ever serve this over weak mobile data, set the sample
rate down in `lib/sarvam.js`. Telephony is unaffected (fixed 8 kHz mulaw).

### V3. Stale ack cache after voice changes
✅ Already handled: cache filenames are keyed on a hash of voice + phrase, so switching to Simran
auto-regenerates clips instead of replaying Kavitha-voiced audio.

## The two things code cannot fix (unchanged, still the biggest real risks)

1. **TRAI/TCCCPR compliance before outbound at scale**: telemarketer registration (PE-TM chain),
   140-series caller ID, DND scrubbing, consent records. Existing-enquiry follow-ups (the current
   lead model) are the defensible zone — stay in it until registration is done.
2. **Ten real Telugu parents saying "I couldn't tell"** is the only launch gate that matters.
   Everything in this repo is engineering; that test is the product.
