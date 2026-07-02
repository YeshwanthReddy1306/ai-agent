# Report — What Changed & What Happened
*(Anti-Gravity Voice Agent vs. phoenix-voice-agent v3, written 2026-07-02)*

This folder is a copy of `phoenix-voice-agent` at commit `e0bd6dc` (v3) with a substantial
uncommitted evolution on top — built in the Antigravity IDE. Below: every change, then the
story the artifacts tell.

---

## 1. Changes made (file by file)

### `agent/college.json` — repointed from fiction to a REAL institute
- College: Sri Vidya Junior College (fictional) → **Resonance Hyderabad** (real brand), agent renamed Simran → **Sneha**.
- Campuses updated to real localities (Kavuri Hills Madhapur main, KPHB/Kukatpally).
- Streams expanded: added **MPC + SAT**, **JEE Long Term**, **NEET Long Term** (repeater programs); EAPCET renamed EAMCET.
- **All fees replaced with `"TODO — paste exact fee"`** — deliberately blanked until real numbers arrive.
- Scholarships rewritten around the real **ResoNET** test logic (flat minimum 50% for selected JEE/NEET students, centre vs online test caps, "never invent a slab" rule).
- Results split into `brandWide` (real national numbers: 52,395+ JEE Advanced selections) and `hyderabad2025` (TODO).
- Real contact number (+91 9121219858) and national helpline added.
- Old config preserved as `college.srividya.json.bak`.

### `agent/persona.js` + NEW `agent/personas/{te,hi,en}.js` — persona architecture rebuilt
- The single trilingual persona was split into **three monolingual persona files**; `buildSystemPrompt(lead, langCode)` now selects one.
- Each persona hard-locks its language ("YOU MUST RESPOND ENTIRELY IN TELUGU") instead of the old "mirror the caller" rule.
- New instruction blocks not in v3:
  - **Number transliteration**: speak numbers as English words / Telugu-script English ("నైన్ పాయింట్ జీరో"), never native Telugu numerals — a TTS-pronunciation lesson.
  - **Acronym phonetics**: MPC→ఎంపీసీ, BiPC→బైపీసీ etc. spelled in Telugu script for correct TTS.
  - **"Tenglish" suffixing**: seat-u, fees-u, college-lu.
  - **Parent-vs-student addressing** rule + phone-handoff exception (never call the parent "babu").
  - **Conversational Transition Map**: per-situation openers (factual / worry / sensitive news / AI-check).
  - **Dialogue State Progression**: never re-confirm identity, never re-pitch after booking — anti-loop rules.
  - **Strict brevity: ONE sentence, max 15 words** (v3 allowed 1–2 sentences).
  - Urban Hyderabad register mandated; rural/textbook Telugu banned.
- Greeting function simplified to a single English line for all leads, tagged `te-IN` (see audit — this is a regression).

### `server.js`
- **Dynamic persona swap**: on every turn, the system prompt is rebuilt in the language STT detected.
- **`parseReply` rewritten**: tolerant tag regex (catches malformed `te-IN|warm` without `~~`), and **en-IN is forced to the te-IN acoustic model** to avoid a jarring voice switch.
- **"Urban Register Enforcement"**: 13 regex replacements swap formal Telugu for spoken Hyderabad Telugu (కుమారుడు→అబ్బాయి, ధన్యవాదాలు→థాంక్స్ అండి, కళాశాల→college…).
- **BiPC phonetic patch** before TTS (bipc → బైపీసీ / बाय पी सी / By-P-C).
- Turn-level debug logging added (transcript, raw LLM output, parsed reply).

### `lib/sarvam.js`
- `sttTranscribe` gained a `langHint` parameter (still always called with `'unknown'`).
- `reasoning_effort: 'low'` → **`null`** (thinking disabled entirely — validated by a scratch experiment).
- Comment change on 48 kHz.

### `public/app.js`
- **Thinking-acks disabled** (`return;` at the top of `scheduleAck`) — judged robotic ("hum" repetition).
- **VAD endpoint 700 ms → 400 ms** — snappier turn-taking.

### `telephony/bridge.js`
- Same tolerant tag parsing, urban-register replacements, and BiPC phonetics mirrored in (duplicated code — see audit).

### `test/regression.js`
- Tag check made tolerant; FORMAT_REMINDER updated to the 15-word rule and appended to test calls.

### `.env`
- `LLM_MODEL` switched **sarvam-30b → sarvam-105b** (quality over speed).

### NEW `scratch/` — an experimentation lab (not production code)
- `test_all_voices.js` / `test_final_voices.js` / `test_missing_voices.js` + **26 saved voice samples** — a full bulbul:v3 voice audition (simran kept).
- `test_tts_bipc.js` + 5 audio variants — how to spell "BiPC" so Telugu TTS says it right (phonetic బైపీసీ won).
- `test_llm.js` / `test_reasoning_none.js` — verified sarvam-30b/105b behavior and that `reasoning_effort: null` kills thinking.
- `test_pipeline.js`, `test_complex_prompt.js` — end-to-end and prompt-stress checks.

---

## 2. What happened (the story in the artifacts)

On **2 July 2026**, the copied repo was opened in Antigravity, the live Sarvam key was added, and
roughly **eight hours of hands-on R&D** followed:

1. **Voice audition** — all ~26 bulbul:v3 speakers were synthesized and compared; **Simran** was confirmed.
2. **API science** — scratch experiments established that `reasoning_effort: null` fully disables
   the model's thinking (lower latency) and that `sarvam-105b` was worth the switch.
3. **Pronunciation engineering** — five spellings of "BiPC" were rendered and listened to; Telugu-script
   phonetic spelling won and was wired into server + bridge. The same lesson generalized into the
   personas' number/acronym transliteration rules.
4. **Persona rebuild** — the trilingual persona was split into three tuned monolingual personas with
   psychological structure (transition map, dialogue-state progression, anti-loop rules, 15-word turns).
5. **Live field testing — 28 real web calls** (~38 minutes of conversation, ~275k LLM tokens,
   ~5 min of STT audio), captured in `data/calls.jsonl`. The tester role-played hard scenarios:
   proud parent, fee-sensitive parent, busy parent ("call me next week"), disappointed parent
   ("results were not as expected"), a daughter instead of the expected son, name confusion
   ("Pooja / puja"), and identity mix-ups. Interest levels, next actions and objections were logged
   every call. Calls grew from 4-second false starts at 05:05 to fluent 6–8-turn, 2+ minute
   conversations by the afternoon — visible tuning progress.
6. **Product repositioning** — the target changed from a fictional demo college to **Resonance
   Hyderabad** with real ResoNET scholarship mechanics, real campuses, and a real contact number —
   with fees deliberately left as TODO placeholders pending exact figures.

**Net:** v3 was a polished engine; this folder turned it into a field-tested product aimed at a real
institute, and the call logs prove the core loop works end-to-end in Telugu, Hindi and English.
The cost of the sprint: several regressions and loose ends slipped in — see `AUDIT.md` (ranked) and
`PREMORTEM.md` (v4).
