# Premortem v2 — "It's January 2027 and Phoenix Voice failed. Why?"

Round 1 raised 10 risks; every one that can be fixed in code is now fixed (✅ v2). This round
re-ranks what's left plus **new risks introduced by the v2 fixes themselves**. ✅ = mitigated in
code, 🔜 = planned, ⚠️ = decision/action only you can take.

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

## New risks (introduced by v2 or newly visible)

### N1. The ack clips backfire
**Likelihood: medium · Damage: medium.** A cheerful "haan…" right after a parent says something sad
(“vaalla nanna poyaru last year”) sounds sociopathic.
- ✅ Acks are neutral-calm murmurs, delayed 700 ms, and only fire when the reply is genuinely slow.
- 🔜 If it ever lands wrong in testing, cut the te/hi cheerful variants and keep only "hmm…".
- ⚠️ Listen for this specifically in your first 10 test calls.

### N2. Parallel-chunk TTS produces a mid-reply voice seam
**Likelihood: medium · Damage: low.** Two TTS calls = two prosody contexts; the join can sound like
a tiny edit cut.
- ✅ Split only happens above 110 chars and only at a sentence boundary (a natural pause point).
- 🔜 If audible, drop to single-call TTS below 200 chars (one-line change in `lib/sarvam.js`).

### N3. The persona is now long — model drift under pressure
**Likelihood: medium · Damage: medium.** ~1,400 words of instructions; a small model at
`reasoning_effort: low` may drop rules deep in a 10-turn call (e.g. forgetting the tag).
- ✅ Tag parse has a safe fallback (sticky language + warm emotion) so a dropped tag degrades invisibly.
- ✅ Regression suite catches structural drift cheaply — run it after every persona edit.
- 🔜 If drift shows up: try `sarvam-105b` (one env var), or compress the persona's FACTS section.

### N4. Echo loop on speakerphone
**Likelihood: medium · Damage: medium.** Parent puts you on speaker; the agent's own voice re-enters
the mic and the VAD treats it as the parent talking (self-interruption, garbage turns).
- ✅ Web: browser echoCancellation + mic ignored except in `listening` phase.
- ⚠️ Telephony: carrier-side echo is usually handled by Twilio, but test speakerphone explicitly;
  if it self-triggers, raise the bridge VAD threshold (500 → 800) and require 300 ms of speech.

### N5. Twilio bridge is fresh, untested code
**Likelihood: high that something needs a tweak · Damage: low if expected.** Mulaw header stripping,
frame pacing, and barge-in `clear` events are all textbook-correct but unverified against a live stream.
- ⚠️ First telephony test call should be to YOUR OWN phone, with the bridge console open.

### N6. Free-credit exhaustion mid-demo
**Likelihood: medium · Damage: embarrassing.** Sarvam free credits are finite; ack generation,
regression runs, and repeated demos add up.
- ✅ Usage is now visible per call; acks cached; silence free.
- ⚠️ Check the dashboard balance before any demo to a college.

### N7. One college.json for what is really multi-tenant SaaS
**Likelihood: low now · Damage: low.** Selling to a second college means a second config — fine.
Selling to twenty means auth, tenancy, a DB, and an admin UI. Do NOT build that until college #2 signs.

## The two things code cannot fix (unchanged, still the biggest real risks)

1. **TRAI/TCCCPR compliance before outbound at scale**: telemarketer registration (PE-TM chain),
   140-series caller ID, DND scrubbing, consent records. Existing-enquiry follow-ups (the current
   lead model) are the defensible zone — stay in it until registration is done.
2. **Ten real Telugu parents saying "I couldn't tell"** is the only launch gate that matters.
   Everything in this repo is engineering; that test is the product.
