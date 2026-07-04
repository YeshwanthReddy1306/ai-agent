# AGENT-SPEC — The Complete System Prompt & Runtime Contract
**The preservation document.** This is the full, written specification of how the three
voice agents (Telugu, Hindi, English) are constructed at runtime. Any future platform —
Pipecat, LiveKit, LangGraph, RCOS, anything — MUST reproduce this contract exactly.
If a migration cannot check every box in §8, the migration is rejected.

*Spec version 1.0 · 2026-07-03 · personas locked at baseline `agent/personas/locked/manifest.json`*

---

## 1. The Non-Negotiables (violating any of these destroys the agent)

1. **LLM: `sarvam-105b`** for Telugu & Hindi — ALWAYS (Sarvam chat completions, `reasoning_effort: null`, temperature **0.45** — low temp is REQUIRED for verbatim-script adherence; 0.75 was field-proven (2026-07-03) to paraphrase the playbook and collapse emotions to all-warm — max_tokens 220). **English turns MAY route to Groq (Llama-3) via `lib/brain.js` when `GROQ_API_KEY` is set, for cost/latency; Telugu/Hindi must NEVER touch Groq.** With no Groq key, everything is Sarvam. Routing is by `personaLang` in the subagent — Groq only sees `en-IN`. Indian-language-native generation is the product. Llama/GPT/Claude/Gemini may NOT serve the voice path — they regress Telugu to "bookish counselor" (field-proven failure). Utility tasks off the voice path (summaries, classification) may use other models only if output is English JSON.
2. **STT: `saaras:v3`** (Sarvam, `language_code: unknown` for auto-detect). Language detection drives mirroring.
3. **TTS: `bulbul:v3`, speaker `simran`** — 48 kHz mp3 for web, 8 kHz mulaw for telephony. Speaker chosen by a 26-voice human audition; changing it requires a new audition.
4. **Persona files are LOCKED** (`.agents/AGENTS.md`): `agent/personas/{te,hi,en}.js`, SHA-256 baseline in `agent/personas/locked/`. `npm run preflight` fails on one byte of drift; `npm run restore-personas` recovers. Re-baseline only on the user's explicit approval.
5. **Concrete over abstract**: persona instructions are verbatim scripts, fixed lexicons, and step-numbered ladders — never abstract rules ("probe deeper"). Abstract rules make the model hallucinate back to generic behavior (field-proven 2026-07-03).
6. **ONE synchronous LLM hop per turn.** No multi-hop graphs on the voice path — supervision, scoring, and CRM writes run async after audio is already playing.

## 2. Runtime Prompt Assembly (exact order, per turn)

```
messages = [
  { role: system,    content: PERSONA(personaLang, lead) },   // §3
  ...last 12 conversation messages (HISTORY_TURNS window),
  { role: user,      content: <turn transcript from STT> },
  { role: user,      content: FORMAT_REMINDER(personaLang) }, // §5, appended, never stored
]
```

## 3. The Persona Layer — `buildSystemPrompt(lead, personaLang)`

- `personaLang` selects exactly one of the three LOCKED monolingual persona files.
- Each persona is a template over `(college, lead, faq, campuses, streams)` and contains, in order:
  identity (30-year veteran, coffee-cup well-wisher, diagnose-before-prescribe) → CRITICAL
  BEHAVIOR RULES (monolingual output, number transliteration, parent-addressing, handoff
  exception, confirm-names-once) → pronunciation/phonetics (Telugu) → transition map →
  HOW A 30-YEAR VETERAN CONVERSES (lexicon, coffee-chat, 15-word brevity + 2-sentence
  objection exception, fillers, diagnose-before-prescribe, authority, gender match) →
  WARMTH MECHANICS → EMOTION PALETTE (13 emotions + selection rules) → DIALOGUE STATE
  PROGRESSION (anti-loop) → CONSULTATIVE SALES PLAYBOOK (verbatim trial-close /
  objection-diagnostic / soft-close scripts, strict 3-step refusal ladder) → FACTS →
  IDENTITY handling → OUTPUT FORMAT (the tag).
- **Fact sanitizer** (`agent/persona.js sanitizedCollege()`): any `TODO` field in
  `college.json` becomes an explicit "never state a number — office confirms on WhatsApp"
  instruction; results keys remapped so `undefined` can never appear in a prompt.
  The generated prompt is preflight-linted for `undefined|TODO|[object` across
  every lead × language.

## 4. Call-Flow Contract

- **Greeting**: deterministic (no LLM), ALWAYS English:
  `"Hello, good evening! This is {agentName} calling from the admissions office at {college}. Am I speaking with {firstName}?"`
  voiced `en-IN`, emotion `warm`. Stored in history as the first assistant message.
- **Language mirroring**: `personaLang` starts `en-IN`; after each turn, STT's detected
  language feeds `nextPersonaLang(state, detected, LANG_SWITCH_TURNS=1)` — instant switch
  by default; set `LANG_SWITCH_TURNS=2` for hysteresis if code-mixed speech ping-pongs.
  On switch, only `messages[0]` is rebuilt in the new language.
- **Call cap**: at `MAX_CALL_MINUTES` (6), inject once:
  `"SYSTEM NOTE (the parent did not say this): the call has reached its time limit. Follow the WRAP-UP PROTOCOL now — one warm closing turn."`
- **Second-turn cap**: history window = system + last 12 messages.

## 5. The Format Reminder (verbatim — `lib/textpost.js formatReminder`)

> SYSTEM REMINDER (the parent did not say this — never mention it): You MUST reply
> ENTIRELY in {TELUGU (Telugu script) | HINDI (Devanagari script) | ENGLISH}. ONE short
> spoken sentence (max 15 words; TWO only for an objection or worry). If the parent's
> words match a playbook situation (fees/distance/competitor objection, trial close,
> refusal), use your EXACT script — never paraphrase it; on a refusal follow the 3-step
> ladder IN ORDER (first no = Step 1, never jump to goodbye). Write every number in
> words, never digits. Choose the emotion tag DELIBERATELY from your EMOTION PALETTE
> (marks = proud, money = serious, worry = reassuring…) — do NOT default to warm.
> End with the hidden tag ~~{personaLang}|<emotion>~~.

Appended to every LLM call; never stored in history.

## 6. Output Protocol — the hidden tag

- Every reply ends with `~~<lang>|<emotion>~~`; `lang ∈ {te-IN, hi-IN, en-IN}`,
  `emotion ∈ {warm, excited, empathetic, calm, urgent, amused, reassuring, concerned, proud, gentle, encouraging, apologetic, serious}`.
- Parsing is tolerant (`lib/textpost.js parseTag`); on a missing tag: sticky language +
  `warm`. The tag is stripped before TTS.
- Post-processing pipeline (exact order): `parseTag` → `applyRegister` (urban Hyderabad
  register, gender-correct child words) → `ttsPhonetics` (BiPC→బైపీసీ etc.) → TTS.
- Emotion → delivery map (`lib/sarvam.js EMOTION_STYLE`): each emotion sets bulbul
  `pace` + `temperature` (e.g. gentle 0.86/0.45, excited 1.08/0.95, serious 0.95/0.35).

## 7. Post-Call Pipeline (async — off the voice path)

- Summary LLM call (same model, temp 0.2) → schema-validated JSON:
  `{interest: hot|warm|cold, summary, nextAction, objections[], unansweredQuestions[]}` —
  placeholders filtered; invalid interest → `unknown`.
- Full transcript (raw LLM output incl. tags) → `data/transcripts/<time>-<lead>.txt`.
- Record + usage metering → `data/calls.jsonl`; unanswered questions → `data/edge-cases.jsonl`.

## 8. Migration Checklist — porting the agent to ANY new platform

A new stack (Pipecat/LiveKit/RCOS/anything) may go live ONLY when all pass:

- [ ] Persona files byte-identical to `agent/personas/locked/` (verify SHA-256)
- [ ] Prompt assembly order exactly §2; reminder text exactly §5
- [ ] LLM = sarvam-105b, reasoning off; STT = saaras:v3 auto-detect; TTS = bulbul:v3 simran
- [ ] English-first greeting verbatim; instant mirroring per §4
- [ ] Tag parse + register + phonetics pipeline in §6 order (reuse `lib/textpost.js` — it is transport-agnostic)
- [ ] One synchronous LLM hop per turn; async everything else
- [ ] `npm run preflight` green; `npm test` (golden 16) pass rate ≥ current baseline
- [ ] Side-by-side listen: 5 Telugu turns old vs new, human judges "same Sneha"
- [ ] 10-parent Telugu test before any external rollout

**The agents live in this contract, not in any server.** Every file named here is small,
dependency-free JavaScript that ports anywhere in an afternoon — which is exactly why no
platform decision can ever justify rewriting the brain.
