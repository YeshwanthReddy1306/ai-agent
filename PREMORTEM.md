# Premortem v4 — "It's January 2027 and the Resonance deployment failed. Why?"
*(supersedes v3, which is preserved in git history; informed by 28 real field calls on 2026-07-02)*

Ranked by (likelihood × damage). ✅ = already handled, 🛠 = concrete fix identified in AUDIT.md,
⚠️ = only you can do it.

## 1. The agent quotes a "TODO" or invents a fee on a real Resonance call
**Likelihood: certain if shipped as-is · Damage: fatal to the pilot.** The FACTS block currently
contains six `TODO — paste exact fee` strings and `Results 2025: undefined. undefined`. One parent
asking "fees entha?" ends the pilot.
🛠 AUDIT C1 + C2. ⚠️ Only you can supply the real Hyderabad fees, batch size, and local results.
**This is the gate: no external call until college.json has zero TODOs and the regression suite passes.**

## 2. Resonance never authorized this
**Likelihood: high if demoed publicly · Damage: legal + reputational.** The config carries the real
brand, real helpline, real admissions number. An unauthorized AI calling parents "from Resonance"
is a trademark problem, a TRAI problem, and a headline.
⚠️ Get written sign-off (or demo under a neutral name) before any call to a non-you phone number.

## 3. Language ping-pong makes the agent feel possessed
**Likelihood: high with code-mixed callers · Damage: high.** Persona now swaps wholesale on every
turn based on single-utterance STT language ID — the least reliable signal in Hyderabadi speech.
One misdetection mid-call and the "Telugu aunty" answers in formal English, then flips back.
🛠 AUDIT H1 (hysteresis: 2 consecutive turns before switching, lead language as anchor).

## 4. Truncated hearing → wrong facts in the CRM
**Likelihood: high at 400 ms · Damage: medium-high.** The log already shows "9.99.99" GPAs and
garbled names (Sathvik→సతీష్, Pooja/puja confusion). Cut-off audio produces confident nonsense,
which then flows into summaries a sales team would act on.
🛠 AUDIT H3 (550–600 ms endpoint) — plus a persona rule that names/numbers heard once are
confirmed once ("Sathvik, correct ah?") before being used.

## 5. A daughter gets called "mee abbayi" (your son)
**Likelihood: certain for female students · Damage: instant trust kill.** The urban-register regex
force-replaces బిడ్డ→అబ్బాయి regardless of gender; the log's daughter scenarios already hit this
path. The greeting-language regression (English opener for Telugu/Hindi parents) belongs to the
same family: personalization silently degraded.
🛠 AUDIT C4 + C5.

## 6. Summary data quietly rots the funnel
**Likelihood: proven — 6 of 28 records polluted · Damage: medium, compounding.** Placeholder echoes
(`"interest":"hot|warm|cold"`, `"objections":["..."]`) mean interest-ranking and objection reports
can't be trusted. A sales team drops leads over bad data without noticing.
🛠 AUDIT H4 (schema-validated summary, filled example in the prompt).

## 7. Token economics ambush the pilot
**Likelihood: medium · Damage: medium.** 38 minutes of testing burned ~275k tokens on sarvam-105b
with a full prompt resent per turn. A 200-call pilot at this shape is real money, and nobody has
priced it yet.
🛠 AUDIT H5 (trim FACTS, cap history, 30b-vs-105b bake-off). ⚠️ Check the dashboard balance and
compute ₹/call before promising Resonance a per-call price.

## 8. The 15-word straitjacket backfires on objections
**Likelihood: medium · Damage: medium.** One sentence, max 15 words is superb for pace, but a fee
objection genuinely needs two beats (validate + scholarship path). The log's best calls (7–8 turns)
worked partly because the tester was cooperative. A hostile objection may get an answer that feels
clipped or evasive.
🔜 Allow TWO sentences specifically inside objection handling; keep 15 words everywhere else.
Test with the regression suite's objection questions.

## 9. Telephony assumptions are still unpaid debt
**Likelihood: unchanged · Damage: medium.** The bridge inherited every new feature (register
replacements, BiPC phonetics, tolerant tags) but has still never touched a live Twilio stream, and
now carries duplicated logic that can drift from the server (AUDIT C5/M3).
⚠️ Twilio creds + first call to your own phone; 🛠 unify shared logic into lib/ first.

## 10. The scratch lab leaks into production
**Likelihood: low · Damage: low-medium.** 6 MB of voice-audition mp3s and key-reading test scripts
sit inside the working tree, uncommitted, next to a live key in a OneDrive-synced `.env`.
🛠 AUDIT M4/M5: gitignore `scratch/`, commit clean, rotate the key after the pilot setup.

---

## The launch gate (unchanged in spirit since v1, now concrete)
1. Zero TODO/undefined strings in the generated system prompt.
2. `npm test` green on the Resonance facts.
3. Resonance's written OK.
4. Ten real Telugu-speaking parents on test calls; if ≥8 say "I couldn't tell", ship the pilot.

---

# v4.1 — fix status (2026-07-03)

All ten items were addressed in code; three still carry a ⚠️ half that only you can complete.

| # | Risk | Status |
|---|------|--------|
| 1 | TODO/undefined in prompt | ✅ Sanitizer in `agent/persona.js`: TODO facts become explicit "defer to office, never state a number" instructions; results keys remapped (no more `undefined. undefined`). `npm run preflight` gates it (4 leads × 3 languages). ⚠️ Real fees/batch/local results still needed for the pilot — TODOs now warn, not break. |
| 2 | Brand authorization | ✅ `compliance.brandAuthorized:false` flag + boot and preflight warnings ("internal testing only"). ⚠️ Flip to true only with Resonance's written OK. |
| 3 | Language ping-pong | ✅ Hysteresis in `lib/textpost.js` (`nextPersonaLang`): persona flips only after 2 consecutive turns in the new language, anchored to the lead's language — wired into server AND bridge. |
| 4 | Truncated hearing | ✅ Adaptive VAD endpoint (450 ms for short utterances, 650 ms for sentences) + NAMES & SCORES confirm-once rule added to all three personas. |
| 5 | Gender/greeting regressions | ✅ Register pass is gender-aware (బిడ్డ→అమ్మాయి for daughters, కుమార్తె handled) and lives in one shared module; per-language greetings restored; en-IN acoustic remap now anchored to the LEAD's language (English leads keep the English voice). |
| 6 | Summary data rot | ✅ Summary prompt rewritten with a filled example; output schema-validated (interest whitelist, placeholder objections like "..." filtered) before anything reaches calls.jsonl. |
| 7 | Token economics | ✅ History window: every LLM call now carries system + last 12 messages (`HISTORY_TURNS` env), including summaries. ⚠️ Price a full call on the dashboard before quoting Resonance. |
| 8 | 15-word straitjacket | ✅ All personas + FORMAT_REMINDER now allow TWO short sentences specifically for objection/worry handling; 15 words everywhere else. |
| 9 | Telephony debt | ✅ Duplicated tag/register/phonetics logic unified into `lib/textpost.js`; bridge got the same hysteresis + history window. ⚠️ Still untested until Twilio creds — first call to your own phone. |
| 10 | Scratch/key hygiene | ✅ scratch/, cache/, *.bak gitignored (previous commit); `npm run preflight` added as the pre-call ritual. ⚠️ Rotate the API key at dashboard.sarvam.ai (it was shared in chat and lives in a OneDrive-synced .env). |
