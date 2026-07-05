# Project Intelligence Report — Anti-Gravity Voice Agent
*Full reverse-engineering pass · 2026-07-05 · every functional file read; every claim cited to a file or command output.*
*Labels: **[EVIDENCE]** = read directly from the repo · **[INFER]** = reasoned conclusion · **[UNKNOWN]** = cannot be determined from the code.*

*Coverage note (honesty): lockfiles, `styles.css` (cosmetic), mp3/b64 binaries, old transcript bodies, `ENGINEERING-REPORT.md` v1 (explicitly superseded by v2, which was read fully), rcos-mvp boilerplate (layout/globals/configs) and its TS lib mirrors (confirmed mirrors via its API routes) were skimmed or inventoried rather than read line-by-line. Everything else: read.*

---

## 1. Executive Summary

One folder contains **two products and one battlefield**:

1. **The asset** — a field-tested, three-language (Telugu/Hindi/English) AI admissions counselor ("Sneha") for Resonance Hyderabad, built on Sarvam AI end-to-end, with an unusually mature governance layer (persona SHA-256 locking, preflight launch gate, golden regression suite, premortems, a written runtime contract in AGENT-SPEC.md). It runs as a single zero-infra Node process (`server.js`, web) plus a Twilio Media Streams bridge (`telephony/bridge.js`, real phone calls — proven live on 2026-07-05).
2. **The scaffold** — a half-grafted "RCOS" contact-center platform (LangGraph, Postgres, tool-calling, escalation, metrics, a separate Next.js app, a full Dograh docker-compose) that is ~90% unwired, mock, or inert, and whose one dangerous piece (an English hardcoded-FAQ fast-path) has been defused but not removed.

**Current state in one sentence:** the voice agent works end-to-end on real phone calls; the last week of work has been a tuning war on *humanness* (persona leading the sale, language mirroring, anti-recitation, pace); the launch gate (`npm run preflight`) is currently **RED** because tonight's persona upgrades await the user's approval to re-lock; and the repo carries a significant load of dead scaffold that its own audits keep flagging.

## 2. Product Vision

**[EVIDENCE]** (README.md, AGENT-SPEC.md, MVP-DEMO.md, college.json): An AI voice agent that calls parents of prospective junior-college students in Hyderabad, sounds indistinguishable from a warm 30-year-veteran human counselor, speaks natural code-switched Telugu/Hindi/English with live language mirroring, answers only approved facts, handles objections with verbatim veteran scripts, books campus visits, and hands the sales team scored leads with summaries and follow-ups — automating the work of an admissions operations team.

**[INFER]** Business model: pitch to Resonance Hyderabad (real brand, real data already loaded) as a service replacing/augmenting a ~15-person team; economics documented at ~₹75-85k/month vs ₹2.25L human cost at 200 calls/day. **[UNKNOWN]** Contract status ("after I say contract is done" implies pending), pricing model, who operates it long-term.

## 3. Technology Stack

**[EVIDENCE]**
| Layer | Choice | Where |
|---|---|---|
| STT | Sarvam **saaras:v3**, auto-detect (`language_code: 'unknown'` — deliberate; a hint hard-locks detection, field-proven regression) | lib/sarvam.js:47, bridge.js:180 |
| LLM (te/hi, always) | Sarvam **sarvam-105b**, temp 0.45, reasoning off, max 220 tok | lib/sarvam.js:69, brain.js |
| LLM (en, optional) | Groq **llama-3.3-70b** when GROQ_API_KEY set, temp 0.6 | lib/brain.js:8 |
| TTS | Sarvam **bulbul:v3**, speaker **simran** (26-voice audition), per-emotion pace/temperature (13 emotions), 48kHz mp3 web / 8kHz mulaw phone | lib/sarvam.js:97-141 |
| Runtime | Node ≥18, single process each for web (3100) + bridge (3200) | package.json |
| Real deps in use | `ws` (bridge), `@langchain/langgraph`+`core` (single-node graph) | verified by grep |
| **Dead deps** | `ai`, `@ai-sdk/groq`, `dotenv` (never required anywhere in root app), `pg` (only by inert RCOS modules) | verified by grep |
| Persistence | JSON files with atomic temp+rename writes (crm.json, followups.json, dnc.json) + JSONL logs | lib/crm.js, scheduler.js, dnc.js |
| Telephony | Twilio REST + Media Streams over cloudflared quick-tunnels | bridge.js |
| Frontend | Vanilla JS/HTML/CSS call console + CRM dashboard (no framework) | public/ |

## 4. Folder-by-Folder

| Path | What it is | Verdict |
|---|---|---|
| `server.js` | Entire web backend: static serve + auth gate + turn pipeline + post-call pipeline + scheduler tick | **Live, healthy**; carries two RCOS hooks (graph.invoke, logMetric) |
| `agent/personas/{te,hi,en}.js` | The IP: three monolingual 30-yr-veteran prompts (~19.5k chars each after tonight) | **Live; drifted from locked baseline (approval pending)** |
| `agent/personas/locked/` | SHA-256 baseline of 2026-07-04 | Stale vs tonight's upgrades |
| `agent/persona.js` | Fact sanitizer, H3 prompt trim, dispatch, English-first greeting | Live, healthy |
| `agent/college.json` | Real Resonance facts, fees, ResoNET slabs, results, compliance flags | Live; `brandAuthorized:false` |
| `agent/graph.js, state.js, subagents/` | LangGraph: START→admissions→END, one node | **Ceremonial** — wraps one LLM call; keyword "intent" is English-only ('fee','visit') so useless for te/hi; state fields (trust_level, confidence, pending_tasks, goal, outcome) never meaningfully written |
| `lib/sarvam.js, textpost.js, numbers.js, brain.js` | Vendor client, shared post-processing, number verbalization, language routing | **The transport-agnostic core — highest quality code in the repo** |
| `lib/callsummary.js, crm.js, scheduler.js, dnc.js, facts.js` | Post-call summary, CRM, follow-ups, do-not-call, on-demand facts | Live, healthy |
| `lib/fast-path/faq-rules.js` | Rule FAQ router | **OFF by default (ENABLE_FAST_PATH)** but still contains fabricated facts: fake deadlines (Mar 31 2026), fake placement companies (Amazon/Microsoft/Google for a *junior college*), "14+ campuses" vs the real 34, non-ResoNET scholarship slabs, fake helpline 1800-123-456 |
| `lib/tools/` | 4 tool schemas + validation + **all-mock executor** | **Never required by anything** (grep-verified) |
| `lib/handoff/` | Slack/SendGrid/Postgres escalation | **Never called** (grep-verified); needs a DB that doesn't run |
| `lib/observability/metrics.js` + `lib/db.js` | Postgres metrics | **Wired into every turn** (server.js:257,295) — silently fails per-turn without Postgres; pure overhead today |
| `telephony/bridge.js` | Twilio Media Streams bridge: mulaw↔PCM, energy VAD (1300ms endpoint), barge-in, DNC, instant-first-then-hysteresis language switch, full post-call parity, JSON transcripts | **Live, proven on real calls tonight** |
| `public/` | Call console (VAD, pre-speech buffer, gapless playback, ack system **disabled**) + admin CRM page | Live; ack fetch/generation is a dead round-trip |
| `scripts/` | preflight (launch gate), lock-personas, **init-db.js + schema.sql (8-table RCOS Postgres schema — never applied)** | Gate healthy; DB scripts inert |
| `test/` | 16-question golden regression | **Stale**: expectations reference the old fictional college (₹95,000 fees, 42 IIT seats, ₹5,000 seat blocking, hostel timings) — several "expected" answers are now WRONG vs Resonance data |
| `data/` | leads (4 demo), crm, followups (**duplicate tasks accumulating per test call**), dnc, calls.jsonl, edge-cases, transcripts (two formats: web .txt, phone .json) | Working; hygiene issues |
| `rcos-mvp/` | Separate Next.js 16 app: default template UI, 4 API routes (fast-path, Groq full-reasoning **with te/hi guard added**, webhook, escalate), full **Dograh** docker-compose (postgres+pgvector, redis, minio, coturn, nginx, dograh-api/ui, cloudflared) | **Parked scaffold** — never deployed, guard added, not integrated |
| `scratch/` | The R&D lab: 26-voice audition mp3s, BiPC pronunciation experiments, reasoning_effort tests | Historical value only; gitignored |
| Docs (11 .md) | README, AGENT-SPEC (the contract), MVP-DEMO, 2 premortems, 2 audits, 2 engineering reports, REPORT, DEPLOY-RENDER | Exceptional discipline; **sprawling** and partially stale vs tonight's code |

## 5. Architecture (as it actually runs)

```
WEB (proven):    Browser mic → VAD → 16k WAV → /api/call/turn
                   → STT auto-detect → [fast-path: OFF] → graph.invoke(1 node)
                   → brainChat (en→Groq | te/hi→Sarvam-105b) w/ persona + 12-msg window + formatReminder
                   → parseTag → applyRegister → phonetics → spokenNumbers → bulbul TTS (emotion pace/temp)
                   → mp3 chunks → browser; logMetric → /dev/null (no DB)
                 call end → summarize() → crm + scheduler + transcript + edge-cases

PHONE (proven):  Twilio ←→ WSS /media ←→ bridge: mulaw→PCM → energy-VAD (1300ms endpoint)
                   → same STT/brain/textpost pipeline + DNC check + barge-in via 'clear'
                   → TTS 8k mulaw → Twilio;  'stop' → finalize(): same post-call pipeline + JSON transcript
                 POST /dial → Twilio REST (⚠ NO AUTH — see §21)

SCHEDULER:       60s tick → due follow-ups → Twilio SMS (real numbers only) | 'call' tasks queue forever
```

**Key architectural truths [EVIDENCE]:** one synchronous LLM hop per turn (AGENT-SPEC §1.6 doctrine, held); persona rebuilt only on language switch; personas hot-reload per call on web (`freshAgent()`) but **NOT on the bridge** (restart required — cost me three restarts tonight); the LangGraph layer adds a dependency and a call frame but zero routing.

## 6. AI / Agent / Prompt Architecture

**[EVIDENCE]** There is **ONE agent** — the persona. The "multi-agent" surface (graph/state/subagents) is a single passthrough node. Prompt stack per AGENT-SPEC §2: `[persona(lang, lead) | last-12 window | user turn | formatReminder(lang)]`. Persona anatomy (all three languages, parity maintained): identity → critical rules (monolingual, transliterated numbers, parent-addressing, confirm-once, **noise-ignore**, **no-laugh-text**, **language-override-of-own-history**) → phonetics → transition map → veteran conversation rules (+ **firm-statement/question-tag discipline**) → warmth mechanics → 13-emotion palette → anti-loop progression (+ **global never-repeat-a-sentence**) → **THE OPENING (cold-call leading, moves-not-lines with 2 renderings each, why-called script, anti-echo, callback, SPIN need-building)** → consultative playbook (verbatim objection/refusal/close scripts) → facts (sanitized, trimmed, long-tail injected on demand by lib/facts.js) → output tag protocol.

Hallucination containment: TODO-sanitizer + facts-only rule + "office will confirm" deferral + deterministic `spokenNumbers` + edge-case capture loop. **[INFER]** This layered defense is the project's most distinctive engineering; its weakest link is that quality gates (regression suite) probe `llmChat` directly and can't see pipeline-level behavior.

## 7. Feature Inventory

**Complete & proven:** 3-language persona with live mirroring; web call console (VAD, barge-in, pre-speech buffer); real outbound phone calls (Twilio + tunnels); emotion-driven TTS delivery; number/acronym verbalization; call summaries → CRM → follow-up scheduling → SMS send; DNC list (3-language detection + pre-dial block); phone+web transcripts; latency P50/P95; usage metering; shared-secret web auth; persona lock/preflight/regression governance; admin CRM dashboard; hot-reload (web).

**Partial:** follow-ups ('call' channel never actions); edge-case loop (capture works, no review UI); Groq English path (works, temp 0.6 vs 0.45 untested at scale); inbound calls (bridge accepts any stream but no Twilio webhook configured — asked by user, unanswered); phone STT quality (8kHz ceiling documented, LiveKit/Pipecat migration researched and recommended as "the real build").

**Missing vs stated ambitions:** WhatsApp/OCR (placeholder keys by design); RAG (deliberately deferred); Pattern Finder/Continuous Trainer/Capacity Balancer (aspirational, no data volume); real DB persistence; deployment off this laptop (Render blocked on credit card; quick-tunnels are ephemeral); inbound; brand authorization.

## 8. Technical Debt (ranked, all [EVIDENCE])

**CRITICAL**
- **D1. Unauthenticated `/dial`** on a public tunnel: anyone with the URL can trigger outbound Twilio calls to arbitrary numbers on your account. bridge.js:252 has no secret check (web server has one; bridge doesn't).
- **D2. Preflight RED** — 3 persona files differ from baseline. The repo's own rule: "no external calls until green." Needs your approve-and-relock (or revert) decision.

**HIGH**
- **D3. Stale golden suite** — test/questions.json expects the *fictional* college's numbers; the suite would flag correct Resonance answers. The #1 safety net is currently mis-calibrated.
- **D4. Dead-scaffold load**: tools/ + handoff/ + db.js + init-db/schema.sql + graph layer + rcos-mvp + 3 dead npm deps + acousticFor + ack round-trip — ~15 surfaces that rot, confuse, and (logMetric) run on the hot path failing silently every turn.
- **D5. AGENT-SPEC v1.0 is now false in places** (emotion paces changed, LANG_SWITCH hysteresis, new persona sections, DNC, transcript formats) — the "preservation document" no longer preserves reality.
- **D6. Secrets**: all four keys (Sarvam/Twilio/Groq/GitHub) previously pasted in chat, never rotated; .env lives in OneDrive-synced folder.

**MEDIUM**: followups duplicate accumulation (no dedup per lead); retention purge covers calls.jsonl only (transcripts/crm keep PII forever — DPDP gap); bridge lacks persona hot-reload; two transcript formats; README/package.json still claim "zero dependencies"; test lead names (greeting says "Ramesh" but caller may be you) pollute CRM with test data; CRLF noise.

## 9. Risks

1. **A leaked tunnel URL = your Twilio balance dials strangers** (D1) — likelihood medium, impact high, fix ~15 min.
2. **Compliance**: real-brand calls without written authorization; no consent capture/recording disclosure; TRAI/DPDP obligations documented but unimplemented — fatal at scale, fine for self-testing.
3. **8kHz phone STT ceiling** — mishears drive most "irrelevant reply" complaints; prompts can't fully fix ears (LiveKit/Pipecat + Sarvam plugins identified as the real path).
4. **Single-vendor Sarvam lock-in** — mitigated by AGENT-SPEC's migration checklist.
5. **Solo-maintainer complexity** — the RCOS premortem's Failure #5, already half-realized by the scaffold load.
6. **OneDrive sync** of a live repo incl. node_modules — churn/corruption/exfil surface.

## 10. Strengths (genuinely unusual)

Governance-as-code (lock/preflight/golden/premortems/AGENT-SPEC — rare at any size); transport-agnostic core (`lib/textpost.js` shared by web+phone, zero drift); layered anti-hallucination; honest docs that record failures and falsified claims; field-tested iteration loop (28 web calls + 6 phone calls with transcripts); deterministic delivery layer (numbers/phonetics/register) immune to prompt drift; the persona files themselves — deep, concrete, trilingual parity.

## 11. Questions the code cannot answer → **[UNKNOWN]**

1. Resonance contract status/timeline (you said "after contract is done" — the real build waits on it).
2. Is this a **product for Resonance** or a **platform for many colleges**? (college.json is swappable by design; RCOS docs dream multi-branch; nothing decides it.)
3. Deployment target after the laptop (Render blocked; GCP mentioned; ngrok for pitch).
4. Inbound calls — wanted for MVP or later?
5. Budget/timeline for the LiveKit/Pipecat phone rebuild.
6. Who reviews the CRM/edge-cases day-to-day once real calls flow?
7. Which of the RCOS scaffold pieces (tools, Postgres, escalation UI, rcos-mvp) do you still want *at all*?
8. What does "done" look like for the pitch demo vs the pilot?
