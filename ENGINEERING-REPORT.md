# Engineering Report — Anti-Gravity Voice Agent
**Full technical due-diligence, architecture review, evolution report, and pre-mortem**
*Prepared 2026-07-03 · repo at commit `33de8db` · every file read; inferences labeled as such*

---

## 1. Executive Summary

This repository contains a **production-track AI voice sales agent** for junior-college admissions in Hyderabad, currently branded for **Resonance Hyderabad**. A parent picks up a call and speaks to "Sneha," a 30-year-veteran admissions counselor who opens in English, instantly mirrors the parent's language (Telugu/Hindi/English), reads their emotional state every turn, runs a consultative sales playbook with exact veteran scripts, and books campus visits — while a post-call pipeline writes interest-scored summaries for the sales team.

The system is **remarkably lean**: a zero-dependency Node.js server (~300 lines), three engineered persona prompts, a shared text-post-processing library, a browser call console, and an untested-but-complete Twilio phone bridge. The entire brain is **Sarvam AI** (Indian-language STT/LLM/TTS) via three REST calls per conversational turn.

**Maturity: field-tested prototype.** 28 live test calls are logged. The core loop demonstrably works in three languages. What separates it from a pilot: real fee data (10 TODOs), brand authorization, telephony verification, and streaming latency work.

**Top strengths:** empirically-derived voice engineering (voice auditions, pronunciation experiments in `scratch/`), an unusually disciplined humanization prompt system, honest guardrails (fact sanitizer, preflight launch gate, call logs), zero-dependency simplicity.
**Top risks:** unfilled facts, unauthorized brand use, single-vendor dependence on Sarvam, sequential-API latency, and drift between the web server and the phone bridge.

---

## 2. Repository Overview

```
Anti-Gravity Voice Agent/            ~1,900 source lines + docs + lab artifacts
├── server.js            (~310)  entire web backend: static + voice pipeline + call log
├── lib/
│   ├── sarvam.js        (~170)  Sarvam client: STT/LLM/TTS, retries, usage, ack cache
│   └── textpost.js      (~ 90)  shared reply post-processing (tags, register, phonetics, lang switching)
├── agent/
│   ├── persona.js       (~ 85)  fact sanitizer + persona dispatch + English greeting
│   ├── college.json             Resonance Hyderabad facts (10 TODOs pending)
│   ├── college.srividya.json.bak  previous fictional college (untracked)
│   └── personas/{te,hi,en}.js   the three monolingual system prompts (LOCKED — see .agents/)
├── public/              (~600)  no-framework call console (index.html, app.js, styles.css)
├── telephony/bridge.js  (~260)  Twilio Media Streams bridge (UNTESTED — needs creds)
├── test/                        16-question hallucination/robotic-tell regression suite
├── scripts/preflight.js         launch gate: prompt lint, greeting contract, TODO/brand warnings
├── data/                        leads.json (4 demo leads), calls.jsonl (28 field calls), cache/ (ack clips)
├── scratch/             (lab)   voice auditions (26 mp3s), BiPC pronunciation tests, LLM API probes
├── .agents/AGENTS.md            persona-lock rule for AI coding agents
├── README.md · REPORT.md · AUDIT.md · PREMORTEM.md (v4.1)
└── package.json                 zero runtime deps; scripts: start/test/telephony/preflight
```

**Git history** (6 commits) tells the evolution story directly: `v1 → v2 (EQ engine) → v3 (Simran voice) → Resonance field build → premortem fixes → English-first opening + veteran closer`.

---

## 3. Product Vision

**What:** an outbound/inbound AI voice counselor for junior-college admissions that parents cannot distinguish from a warm, experienced human — "a warm cup of coffee with a trusted family well-wisher," per the personas.
**Problem solved:** admissions teams cannot scale personal, multilingual, emotionally intelligent follow-up calls to every lead; human tele-callers cost ~₹80–150/min fully loaded, this pipeline runs at rupees per call.
**Users:** (a) parents of 10th-class students receiving calls; (b) the institute's sales team consuming interest-scored call summaries.
**Current focus:** Resonance Hyderabad (ResoNET scholarship mechanics modeled in detail).
**Maturity:** field-tested web prototype; telephony written, unverified.
**Direction (inferred from artifacts):** web console → Twilio pilot → streaming latency → multi-college.

---

## 4. Architecture Overview

One process, three external API calls per turn, no database (JSONL + JSON files), no framework.

- **Frontend** (`public/`): vanilla JS call console. Captures mic audio via ScriptProcessor, runs adaptive client-side VAD (450/650 ms endpoint, pre-speech ring buffer), WAV-encodes to 16 kHz PCM, POSTs base64 JSON. Plays multi-chunk MP3 replies gaplessly; tap-to-interrupt barge-in; lead queue + recent-calls panel + post-call summary card.
- **Backend** (`server.js`): routes `/api/health,leads,calls,acks,call/{start,turn,end}`. Holds calls in an in-memory Map (30-min TTL sweep). DPDP retention purge (90 days) on boot. Per-call and per-session usage metering.
- **AI layer**: persona prompt (language-selected) + windowed history (last 12 messages) + language-aware format reminder → `sarvam-105b` (reasoning disabled) → hidden `~~lang|emotion~~` tag → 13-emotion → pace/expressiveness mapping → `bulbul:v3` speaker `simran` @48 kHz.
- **Telephony** (`telephony/bridge.js`): same brain over Twilio Media Streams — 8 kHz mulaw both ways, server-side energy VAD, voice barge-in via `clear` events, `/dial` REST trigger.

## 5. System Diagram

```
 Browser (public/)                    server.js                        Sarvam AI
 ┌─────────────────┐   base64 WAV   ┌──────────────────────┐
 │ mic → VAD →     │ ─────────────▶ │ /api/call/turn        │ ──▶ STT saaras:v3 (lang auto)
 │ 16kHz WAV enc   │                │  ├ lang mirror (1-turn│ ◀── transcript + language_code
 │                 │                │  │  switch, hysteresis │
 │ MP3 queue ◀──── │ ◀───────────── │  │  optional)          │ ──▶ LLM sarvam-105b
 │ barge-in (tap)  │  reply + audio │  ├ windowed history +  │ ◀── "words ~~te-IN|gentle~~"
 └─────────────────┘                │  │  lang-aware reminder│
                                    │  ├ parseTag→register→  │ ──▶ TTS bulbul:v3 simran
 Twilio phone ◀──── mulaw 8k ─────▶ │  │  phonetics          │ ◀── base64 MP3 (48k) / mulaw (8k)
 (bridge.js, untested)              │  └ usage metering      │
                                    └──────┬───────────────┘
                                    data/calls.jsonl ◀─ end-of-call LLM summary (schema-validated)
```

---

## 6. Folder Analysis

| Folder | Purpose | Quality | Notes |
|---|---|---|---|
| `lib/` | Vendor client + shared text processing | High | The right abstractions; `textpost.js` exists specifically to stop server/bridge drift |
| `agent/` | All product knowledge & personality | High | Sanitizer pattern is excellent; `personas/` are LOCKED per `.agents/AGENTS.md` |
| `public/` | Demo/testing UI | Good | No framework, no build step; ScriptProcessor is deprecated (works, but AudioWorklet is the future) |
| `telephony/` | Phone transport | Unverified | Code-complete; has drifted behind the web path (see §12) |
| `test/`+`scripts/` | Quality gates | Good | Regression suite needs API credits to run; preflight is free and fast |
| `data/` | Leads, logs, ack cache | OK | calls.jsonl is the most valuable artifact (28 field calls); gitignored |
| `scratch/` | Empirical lab | Excellent practice | Voice auditions, BiPC pronunciation A/B, `reasoning_effort` probes — decisions here are evidence-based |
| `.agents/` | AI-agent governance | Notable | Persona-lock rule: personas are tested assets, not refactor targets |

## 7. File Analysis (key files)

- **server.js** — complete backend. Clean route dispatch, graceful TTS degradation (text-only on failure), wrap-up protocol at 6-min cap, schema-validated summaries. *Hidden assumption:* single-process memory (no horizontal scale without sticky sessions).
- **lib/sarvam.js** — retry-once on every call; TTS sentence-split parallelism >200 chars; ack clips cached by voice+phrase hash (currently unused by the client — dead-ish path, kept deliberately as an option).
- **lib/textpost.js** — tag parser (tolerant), gender-aware Telugu register replacements, BiPC phonetics, `nextPersonaLang(state, detected, threshold)` with threshold=1 default (instant mirroring) and `LANG_SWITCH_TURNS` escape hatch. `acousticFor` remains exported but the **web server no longer uses it** (each reply voiced in its own language model); **bridge still uses it** — intentional? *Labeled inference: drift, not decision.*
- **agent/persona.js** — fact sanitizer (TODO→defer-to-office instructions, results-key remapping so prompts never contain `undefined`), language dispatch, **English-always greeting** (user requirement 2026-07-03).
- **personas/te.js & en.js** — 30-year veteran consultative closer: diagnose-before-prescribe, concrete Hyderabad code-switch lexicon, established-authority tone, exact trial-close/objection-diagnostic/soft-close scripts, strict 3-step refusal ladder, 13-emotion palette with per-turn selection rules, warmth mechanics.
- **personas/hi.js** — **one generation behind**: still "25-year", old abstract playbook, retains the old DIALOGUE STATE PROGRESSION section. Hindi callers get a measurably weaker agent.
- **public/app.js** — VAD with noise-floor adaptation and pre-speech buffer, auto-retry-once per turn, gapless multi-chunk playback, thinking-acks **disabled by an early `return;`** (judged robotic in field tests) with dead code and a still-active `/api/acks` fetch behind it.
- **test/regression.js** — checks tags, robotic tells, monologues, and any number not present in college.json. Note: with fees as TODOs, the number-whitelist is nearly empty — it currently over-flags; refill facts to restore its power.

---

## 8. AI & Prompt Architecture

**Persona system** (the product's core IP): three monolingual prompts selected by `personaLang`; each hard-locks reply language and script, verbalizes numbers as English words/transliteration (TTS-driven decision), spells acronyms phonetically (బైపీసీ), enforces one-sentence/15-word turns (two-sentence exception for objections), bans stock-empathy phrases, and carries the emotion palette + transition map + warmth mechanics.

**Control protocol:** the LLM ends every reply with `~~<lang>|<emotion>~~`. Server parses tolerantly, strips it, maps emotion→TTS delivery. Fallback on missing tag: sticky language + warm. A ~40-token **language-aware reminder** is appended per call (never stored), pinning language, brevity, and tag — the anti-drift mechanism.

**Context management:** windowed history (system + last 12 messages, `HISTORY_TURNS`), full history retained in memory for the end-of-call summary (also windowed). Persona rebuilt only on language switch.

**Hallucination containment:** three layers — persona FACTS-only rule with defer-to-office phrasing; build-time sanitizer (nothing unfilled reaches the prompt); regression suite + preflight gate.

**Known prompt risks:** the 3-step refusal ladder is pushier than the earlier "second no is final" (brand/compliance surface, see §17); "never invent a slab" ResoNET rule is well-designed; identity handling (deflect once, admit if pressed) is the ethically/legally correct configuration — keep it.

## 9. Voice System Architecture

- **STT:** saaras:v3, `language_code: unknown` (auto-detect drives mirroring). 16 kHz WAV from browser; 8 kHz from phone. Known field issues: name garbling (Sathvik→సతీష్), truncated numbers — mitigated by adaptive endpointing + confirm-once persona rule.
- **TTS:** bulbul:v3 `simran` (chosen from a 26-voice audition), 48 kHz web / 8 kHz mulaw phone, 13 emotion→{pace, expressiveness} mappings, parallel two-chunk synthesis on long replies.
- **Turn-taking:** client VAD (adaptive threshold from noise floor; 450 ms endpoint for short utterances, 650 ms for sentences; 15 s cap; 0.5 s pre-speech buffer). Phone: energy VAD, 250 ms speech start, 800 ms endpoint, barge-in requires 400 ms sustained speech while agent audio is out.
- **Interrupts:** web = tap the orb; phone = voice barge-in with Twilio `clear`.
- **Latency budget (measured shape):** STT ~1 s + LLM (105b, reasoning off) ~1.5–2.5 s + TTS ~1 s ≈ **3–4 s/turn**. Acks (the latency mask) are currently disabled → dead air is the #1 UX cost. Streaming APIs are the known fix.
- **Lifecycle:** greeting (deterministic, English) → mirrored turns → 6-min wrap-up protocol → summary + usage record. Human escalation exists as a persona behavior ("senior counselor will call"), not yet as a system feature.

---

## 10. Evolution Report

Four visible generations (evidence: git history + working-tree deltas):

1. **Phoenix v1–v3** (upstream): trilingual single persona, LLM-chooses-language, acks, 9 emotions, fictional college.
2. **Antigravity field build:** repointed to real Resonance; persona split into monolingual files; number/acronym transliteration discovered via TTS experiments; sarvam-30b→105b; `reasoning_effort: null` (probed empirically); acks disabled (judged robotic); VAD 700→400 ms; **28 live field calls**.
3. **Premortem-fix layer:** fact sanitizer, hysteresis, gender-aware register, schema-validated summaries, history windowing, shared `textpost.js`, preflight gate, 13-emotion palette, warmth mechanics.
4. **Current layer:** **English-first opening** (all leads), **instant language mirroring** (threshold=1, env-tunable back to 2), language-aware per-turn reminder, per-language TTS voicing (dropped en→te remap), **30-year consultative closer scripts** (te/en), persona lock rule.

**Pattern across generations** (inferred): every change traces to either a field observation (calls.jsonl) or a controlled experiment (scratch/) — the project's development philosophy is *empirical, not aesthetic*. Product direction shifted from "demo that impresses" to "pilot that converts": concrete closer scripts, trial closes, refusal ladder.

## 11. Engineering Decisions (with tradeoffs)

| Decision | Rationale (evidence) | Tradeoff accepted |
|---|---|---|
| Zero npm dependencies | Node 18+ has fetch/FormData; auditability; no supply chain | Hand-rolled .env parsing, static serving |
| Sarvam end-to-end | Indian-data-trained; one vendor, one key; Telugu quality | Vendor lock-in (§17) |
| Monolingual personas + code-side language switching | Small models obey "write everything in X" better than "mirror the caller" (inferred from gen-2 rewrite) | 3 files to keep in sync — hi.js already lagging |
| Hidden `~~lang|emotion~~` tag | Single-generation control of voice + delivery; no second LLM call | Parser tolerance needed; tag occasionally dropped (fallbacks exist) |
| reasoning off + 15-word turns | Live-call latency + humans speak short | Complex objections constrained (2-sentence exception added) |
| English-first opening + instant mirroring | Consistent, professional first impression for unknown-language leads; parent's first reply reveals the real language | First reply after a Telugu parent's "haan cheppandi" costs one persona rebuild; misdetection can flip a call (env escape hatch exists) |
| Instant switch (threshold 1) over hysteresis (2) | User field decision: responsiveness beats stability | Re-exposes ping-pong risk premortem #3 warned about — monitored via `LANG_SWITCH_TURNS` |
| Files over database | 4 leads, 28 calls; a DB is unearned | Multi-tenant/pilot scale will force the migration |
| Persona lock (.agents/AGENTS.md) | Prompts are tested assets; AI-agent refactors are the biggest regression vector | Slower iteration; requires explicit user sign-off per change |

---

## 12. Technical Debt

**High-risk**
1. **hi.js persona is a generation behind** (25-yr, no closer scripts, old playbook) — Hindi calls are weaker product. *Effort: 1 hr (needs user sign-off per persona lock).*
2. **bridge.js drift**: still uses `acousticFor` (server doesn't), plain FORMAT-less reminder (server's is language-aware), silently inherits threshold=1. Phone and web now behave differently. *Effort: 1–2 hrs.*
3. **Untested telephony path** end-to-end. *Effort: 1 test call once creds exist.*

**Medium-risk**
4. te.js dropped the anti-loop DIALOGUE STATE PROGRESSION section during the closer rewrite (en kept it; identity-reconfirm loops were a real field bug). *Persona-locked — flag to user.*
5. Ack system half-removed: dead client code + live `/api/acks` endpoint + cache generation. Decide: delete or re-enable behind env.
6. Regression suite's number-whitelist is empty while fees are TODO (over-flags legitimate replies).
7. ScriptProcessor (deprecated) for mic capture.

**Low-risk:** CRLF/LF warnings on every commit (add `.gitattributes`); README quickstart still describes the fictional-college era defaults; `college.srividya.json.bak` untracked in tree.

## 13. Security Review

- **Key handling:** live Sarvam key in `.env` — correctly gitignored, but the folder is **OneDrive-synced** (cloud copy) and the key was pasted in a chat. **Rotate it.**
- **Server exposure:** binds all interfaces on :3100 with no auth — fine on localhost; do not tunnel publicly without adding at least a shared-secret header (anyone with the URL burns credits and can read leads/calls).
- Path traversal on static files: guarded (prefix check). Body cap 30 MB. No injection surfaces (no DB, no shell). PII (minors' academic data, parent phones) in plaintext JSONL with 90-day retention — adequate for testing; DPDP consent records needed before scale.

## 14. Performance Review

- **Turn latency 3–4 s** (three sequential vendor calls) — acceptable web-demo, marginal phone. Streaming STT/TTS (both supported by Sarvam via WebSockets) is the single biggest win, est. 1–1.5 s.
- Token burn measured: ~275k tokens/38 min at 105b pre-windowing; windowing (12 msgs) roughly halves per-turn prompt growth. 48 kHz MP3 ≈ 2× payload of 24 kHz — irrelevant on localhost.
- In-memory Map + JSONL append: fine to ~dozens of concurrent calls per process; no locks needed (single-threaded Node).

## 15. Missing Components (prioritized)

1. Real fees/batch/local-results data (10 TODOs) — **blocks pilot**
2. Brand authorization flag flip — **blocks any external call**
3. Telephony verification + bridge parity (§12.2)
4. hi.js closer parity
5. Streaming latency path
6. Human-escalation mechanism (transfer/callback queue) — currently a promise the persona makes with no system behind it
7. DND scrub + consent-line for outbound at scale; recording disclosure
8. Auth layer if ever exposed beyond localhost
9. Dashboard for calls.jsonl (sales-team consumption is raw JSONL today)

## 16. Risk Assessment (top 5 by likelihood × impact)

1. **Facts gap goes live** — TODO fees on a real call (sanitizer defers gracefully, but a fee-less sales call converts poorly). Detection: preflight warning. Mitigation: data entry.
2. **Vendor lock-in / Sarvam outage** — 100% of hearing, thinking, speaking is one vendor. Detection: retry logs. Long-term: abstract provider interface (lib/sarvam.js is already the seam).
3. **Instant-mirroring ping-pong returns** — code-mixed Hyderabadi speech + threshold 1. Detection: `[Turn] Persona switched` log frequency. Mitigation: `LANG_SWITCH_TURNS=2`.
4. **3-step refusal ladder reads as pressure** in a recorded viral clip. Detection: summaries' mood field. Mitigation: user decision on softening step 2 (persona locked).
5. **Web/bridge behavioral divergence** discovered live on the first phone pilot. Mitigation: §12.2 before dialing.

## 17. Pre-Mortem (delta on PREMORTEM.md v4.1)

PREMORTEM.md remains authoritative for items 1–10 (all code-fixable ones fixed). New failure modes introduced since:

- **"The Telugu aunty who greets in English"** — some Telugu-only parents may respond to the English opener with confusion or hang up in the first 5 seconds. *Likelihood: medium. Detection: short-call rate in calls.jsonl. Mitigation already in design: first reply mirrors instantly. Watch specifically in the next field round.*
- **First-turn language lock-in** — personaLang starts en-IN; if a parent's first utterance is misdetected (short "haan"), turn one replies in the wrong language. *Low-medium; self-corrects next turn at threshold 1.*
- **Persona tier mismatch** — Hindi leads get the weaker gen-3 persona while te/en run gen-4 closers; A/B contamination if conversion is ever measured. *Certain until fixed.*
- **Lock-rule deadlock** — `.agents/AGENTS.md` prevents agents from fixing known persona bugs (te.js anti-loop section loss) without explicit user requests; bugs can now persist by policy. *Mitigation: this report lists them; user must green-light.*

## 18. Improvement Roadmap

**Quick wins (hours):** bridge parity; hi.js closer parity (with sign-off); delete or env-gate ack dead code; `.gitattributes`; README refresh; restore te.js anti-loop rules (sign-off).
**Medium (days):** Sarvam streaming STT/TTS (sub-1.5 s turns); calls dashboard (one static page over calls.jsonl); provider abstraction interface; first Twilio test call; regression run + transcript review ritual after every persona change.
**Major (weeks):** Exotel/Ozonetel India-native telephony + TRAI registration; multi-college tenancy (config → per-tenant folders → DB when college #2 signs); human-escalation transfer; analytics on objection frequency to tune scripts.

## 19. Recommended Development Priorities

1. **Fill college.json** (user data entry) → preflight clean → `npm test` green.
2. **Field round 2 on the web console** (10 calls) specifically listening for: English-opener reaction, instant-switch stability, refusal-ladder tone.
3. **Bridge parity + first phone call to your own number** (needs Twilio creds).
4. **Streaming latency work** — the gap between "impressive demo" and "indistinguishable from human" is mostly these 2 seconds.
5. **Resonance authorization + TRAI/DND groundwork** before any non-you callee.

## 20. Conclusion

This is a small, unusually well-evidenced codebase that has already survived contact with reality — 28 field calls, a voice audition, pronunciation A/B tests, and four architectural generations, each responding to observed failures rather than speculation. The engineering asset is not the ~1,900 lines of code (rebuildable in a day); it is the **persona system + the empirical decisions encoded in it** — which is exactly why the persona-lock rule is the right governance. The path to a real pilot is not more code: it is data entry, one authorization, one phone-line test, and latency streaming. A new team starting from this report plus README/AUDIT/PREMORTEM could continue development immediately.
