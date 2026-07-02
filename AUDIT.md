# Comprehensive Audit — Anti-Gravity Voice Agent
*(ranked by severity; verified against the actual code and the 28-call log on 2026-07-02)*

## CRITICAL — will visibly break or embarrass on a real call

### C1. Every system prompt contains "Results 2025: undefined. undefined"
All three persona files still reference `college.results['2025']` and `college.results.toppers`,
but `college.json` renamed those keys to `brandWide` / `hyderabad2025`. **Verified live**: the
prompt literally reads `Results 2025: undefined. undefined`. The agent has NO results to quote —
its strongest selling point — and an LLM seeing "undefined" may improvise numbers.
**Fix**: reference `college.results.brandWide` + `hyderabad2025` in `personas/{te,hi,en}.js`.

### C2. "TODO — paste exact fee" strings are injected into the live prompt
Six streams, hostel, and batch size all say `TODO — paste exact fee` inside the FACTS block. On a
real call the agent will either say "TODO" aloud or invent a fee. Side effect: `test/regression.js`
builds its allowed-numbers list from college.json, which now contains almost no numbers — so the
hallucination check can no longer pass any spoken fee.
**Fix**: fill real Resonance Hyderabad numbers before ANY external call; until then add a persona
rule: "if a fee shows TODO, say the counselor will confirm exact fees on WhatsApp".

### C3. Personas hardcode a "40 students per class" claim that the config calls unverified
`batchSize` is `TODO — confirm max students per section`, yet all three personas' playbooks say
"Pitch the class size (40 students)". The call log shows it was actually pitched
("interested in the small class size"). For a real institute this is an invented fact — exactly
what the guardrails exist to prevent.
**Fix**: make the playbook reference `${college.batchSize}` and fill the real number.

### C4. Greeting ignores the lead's language (regression from v3)
`greetingFor()` now returns one English sentence for every lead, tagged `te-IN`. The Hindi lead
(Imran) and Telugu leads get an English opener voiced through the Telugu acoustic model, and the
first assistant message contradicts the Telugu-only persona that follows. v3's per-language
greeting variants were deleted.
**Fix**: restore per-language greetings (keep the te-IN acoustic model if the accent is the goal).

### C5. Gender bug in the "urban register" replacements
`బిడ్డ → అబ్బాయి` (child → boy) is forced by regex regardless of the student's gender. The call
log includes daughter scenarios (Pooja, "Viveka") — those calls had the agent's text rewritten to
"your boy". The same 13-replacement list is duplicated verbatim in `server.js` and
`telephony/bridge.js` (they WILL drift apart).
**Fix**: drop the బిడ్డ rule (or gender-gate it from `lead.gender`), and move the list to one
shared module (`lib/register.js`) imported by both.

## HIGH — degrades quality or trust

### H1. Per-turn persona swap keyed to raw STT language detection → language ping-pong
`call.messages[0]` is rebuilt every turn in whatever language STT detected for the LAST utterance.
Hyderabadi code-mixing ("fees entha in total sir") is exactly what language ID gets wrong, and each
monolingual persona hard-locks the reply language. One misdetected turn flips the entire call to
English/Hindi, then back. v3's design (LLM chooses reply language, mirrors naturally) was safer.
**Fix**: add hysteresis — switch personas only after 2 consecutive turns in the new language; keep
the lead's language as the anchor.

### H2. English is force-remapped to the Telugu acoustic model — even on pure-English calls
`parseReply`: `lang = m[1] === 'en-IN' ? 'te-IN' : m[1]`. Sensible for a Telugu call that drifts
into English words; wrong for the English lead (Sarah/Joel) whose entire call now renders English
text through the te-IN model. Quality depends on an accent trade-off nobody chose deliberately.
**Fix**: only remap en-IN→te-IN when `lead.language === 'te'` (same for hi).

### H3. 400 ms VAD endpoint is likely clipping slow speakers
End-of-speech was cut 700→400 ms. Telugu parents pause mid-sentence; the log shows truncation
artifacts ("9.99.99" as a GPA, garbled names). Snappier turns are good; losing half the sentence
is not.
**Fix**: 550–600 ms, or adaptive (400 ms only after short utterances).

### H4. Call-summary JSON template echoes into real data (inherited v3 bug, now proven)
Six records in `calls.jsonl` contain `"interest":"hot|warm|cold"` or `"objections":["..."]` —
the LLM copied the template's placeholders. This pollutes the exact data a sales team would use.
**Fix**: rewrite the summary instruction with a filled example and "empty array if none", and
validate `interest ∈ {hot,warm,cold,unknown}` before writing the record.

### H5. Token burn: ~275k tokens for 38 minutes of testing
sarvam-105b + a ~2k-token system prompt resent every turn + full history + summaries. Fine for
R&D; at campaign scale this is the cost line. The `langHint` STT parameter added in lib is also
never actually used (always `'unknown'`), leaving its latency win unclaimed.
**Fix later**: trim the FACTS block, cap history to last ~12 turns, revisit 30b vs 105b with the
regression suite as judge.

## MEDIUM — hygiene and consistency

- **M1. Acks half-removed**: `scheduleAck` starts with `return;` but the client still fetches
  `/api/acks` and the server still generates/caches clips — dead code + a few wasted TTS calls.
  Remove fully or gate behind an `ACKS=off` env.
- **M2. Conflicting brevity rules**: server's FORMAT_REMINDER still says "1-2 SHORT spoken
  sentences" while every persona demands "ONE sentence (max 15 words)". Two instructions fight
  each turn. Align the reminder to the personas.
- **M3. Loose tag regex**: server accepts any word as emotion (`[a-zA-Z]+`) and strips every
  `xx-IN|word` match anywhere in the text; the bridge version whitelists emotions but server
  doesn't. Unify on the bridge's stricter pattern.
- **M4. Repo hygiene**: `scratch/` holds ~6 MB of mp3s that would enter git on the next commit —
  gitignore it. `.env.example` doesn't reflect the switch to sarvam-105b. `agent/college.srividya.json.bak`
  belongs in git history, not the tree. Nothing here is committed yet (all changes uncommitted).
- **M5. Key + brand exposure**: the live API key sits in `.env` inside a OneDrive-synced folder
  (cloud copy), and it was also shared in chat — rotate it at dashboard.sarvam.ai when convenient.
  The config now uses the real Resonance name and a real phone number: fine for internal testing,
  but do not demo/deploy as "Resonance" without their sign-off (trademark + TRAI exposure).

## What got BETTER (credit where due)
- Number/acronym transliteration rules and the BiPC phonetic patch — genuine TTS pronunciation wins,
  discovered empirically.
- Dialogue State Progression (never re-confirm identity, never re-pitch after booking) — kills the
  #1 robotic tell (loops) that v3 didn't address.
- Transition Map with banned stock-empathy phrases ("మీ బాధ నాకు అర్థం అవుతుందండి") — sharper EQ
  than v3's version.
- `reasoning_effort: null` — validated latency win.
- Parent-vs-student addressing + handoff exception — a real call-dynamics insight.
- ResoNET scholarship modeling with "never invent a slab" — exactly the right guardrail shape.
- 28 logged field calls — the single most valuable artifact in the folder.
