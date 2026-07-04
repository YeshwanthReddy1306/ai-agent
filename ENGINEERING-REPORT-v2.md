# Engineering Due-Diligence & Change Report — Anti-Gravity Voice Agent
**Full reverse-engineering, architecture review, evolution report, and pre-mortem.**
*Prepared 2026-07-03 (Opus 4.8) · every source file read · every claim cited to file:line · inferences labeled [INFER].*
*Supersedes ENGINEERING-REPORT.md (commit 1555951) — the repo has materially changed since: a partial RCOS/LangGraph architecture and a separate Next.js app were grafted on.*

---

## 1. Executive Summary

Two projects now live in one folder:

1. **The working voice agent** (root: `server.js`, `agent/personas/`, `lib/sarvam.js`, `lib/textpost.js`, `public/`) — a field-tested, human-sounding admissions caller on Sarvam AI (Telugu/Hindi/English), with locked personas, hot-reload, transcripts, latency metering, and a preflight gate. This is the asset.
2. **A partial RCOS graft** (`agent/graph.js`, `agent/state.js`, `agent/subagents/`, `lib/tools/`, `lib/handoff/`, `lib/observability/`, `lib/db.js`, `lib/fast-path/`, and a whole separate `rcos-mvp/` Next.js app) — an in-progress attempt to implement the RCOS v6.1 plan (LangGraph orchestration, tool-calling, Postgres, escalation, metrics).

**The single most important finding:** the RCOS graft is **actively damaging the working agent, live, right now.** `server.js:222` runs a hardcoded English FAQ "fast-path" (`lib/fast-path/faq-rules.js`) *before* the persona/LLM on most turns. When a parent says anything containing "fee", "scholarship", "hostel", "campus", "namaskaram", or even the Telugu word "entha" (how much), the agent **bypasses Sneha entirely** and speaks a robotic **English bullet-list at a fictional ₹1,00,000 fee** — the exact "bookish counselor" the persona war was fought to kill, and a direct hallucination-guardrail breach (college.json fees are TODO). This is almost certainly the "the Telugu voice I trained is gone" regression. **[INFER — high confidence, from code path at server.js:216-250 cross-referenced with faq-rules.js:8-16.]**

**Maturity:** the core agent is a field-tested prototype; the RCOS graft is scaffold-grade (mock tools, no live DB, single-node graph) and half-wired. **Overall the repo has regressed** from the clean, zero-dependency, persona-faithful state of commit `36dea40`, because the graft was merged into the live turn handler without preserving the AGENT-SPEC contract the repo itself defines.

**Top recommendation:** disable the fast-path on the voice path immediately (one env var: `USE_FULL_REASONING` logic is inverted — see §12 C1), then decide deliberately whether RCOS lives *beside* the agent (separate service) rather than *in front of* it.

---

## 2. Repository Overview

```
Anti-Gravity Voice Agent/
├── server.js                  LIVE backend — turn pipeline NOW routes fast-path → graph → persona
├── agent/
│   ├── persona.js             fact sanitizer + persona dispatch + English greeting + hot-reload export
│   ├── college.json           Resonance facts (10 TODO fees, factsUpdatedAt)
│   ├── personas/{te,hi,en}.js  LOCKED 30-yr veteran prompts (the IP)
│   ├── personas/locked/        SHA-256 baseline + manifest
│   ├── graph.js         [NEW] LangGraph: START→admissions→END (single node)
│   ├── state.js         [NEW] LangGraph StateAnnotation (session state schema)
│   └── subagents/       [NEW] admissions.js (keyword intent), llm_helper.js (wraps Sarvam)
├── lib/
│   ├── sarvam.js              STT/LLM/TTS client, retries, service health, emotion map
│   ├── textpost.js            tag parse, register, phonetics, lang-switch, formatReminder
│   ├── fast-path/faq-rules.js [NEW] ⚠ hardcoded English bullet-list FAQ, ₹1,00,000 fees
│   ├── tools/           [NEW] index.js (4 tool schemas), executor.js (MOCKs), validation.js
│   ├── handoff/         [NEW] escalate.js, escalation-context.js (need Postgres)
│   ├── observability/   [NEW] metrics.js (Postgres INSERT)
│   └── db.js            [NEW] pg Pool → localhost:5432/rcos
├── public/                    call console UI (VAD, barge-in, latency chip, transcript)
├── telephony/bridge.js        Twilio Media Streams bridge (untested)
├── scripts/                   preflight.js, lock-personas.js
├── test/                      regression.js + questions.json (16 golden)
├── data/                      leads.json, calls.jsonl, transcripts/, edge-cases.jsonl
├── rcos-mvp/            [NEW] a SEPARATE Next.js 16 app (React 19, tailwind, ai-sdk, langgraph)
│                              — committed? NO (untracked); ~full node_modules + .next on disk
├── docs: AGENT-SPEC, MVP-DEMO, PREMORTEM, RCOS-PREMORTEM, AUDIT, REPORT, ENGINEERING-REPORT, README
└── package.json               ⚠ description says "zero dependencies" — now has 5 (langgraph, ai, groq, pg, dotenv)
```

Git: root repo tracks the agent; `rcos-mvp/`, `agent/subagents/`, `lib/tools|handoff|observability|fast-path`, `agent/graph.js|state.js` are **all uncommitted** (`git status`: `?? agent`, `?? lib`, `?? rcos-mvp`). The live `server.js` changes that wire them in are also uncommitted (`M server.js`). So the working committed state (`5217c45`) is clean; the damage lives in the uncommitted working tree.

---

## 3. Product Vision

Unchanged from prior report: an outbound/inbound AI admissions counselor for Hyderabad junior colleges (branded Resonance) that parents cannot distinguish from a warm 30-year human, in Telugu/Hindi/English, that books campus visits and hands scored leads to a sales team. **[INFER]** The RCOS graft signals a shifted ambition: from "one great voice agent" toward "a multi-channel, multi-branch, tool-calling contact-center OS" (RCOS = Resonance Contact/Care OS). The vision grew; the execution of the growth is what needs governance.

---

## 4. Architecture Overview (as it ACTUALLY runs today)

```
Browser (public/app.js)                 server.js /api/call/turn                    Sarvam
  mic → VAD → 16k WAV ──base64──▶  1. STT (saaras:v3, auto-lang) ──────────────▶ saaras:v3
                                   2. push user msg; language mirror (nextPersonaLang)
                                   3. ┌─ FAST PATH (server.js:216-250) ───────────┐
                                      │ if short query & keyword match:            │  ⚠ NO LLM,
                                      │   raw = hardcoded English FAQ text         │  NO PERSONA,
                                      │   → parseReply → TTS → RETURN              │  NO LANGUAGE
                                      └────────────────────────────────────────────┘  MIRROR
                                   4. ELSE full path:
                                      graph.invoke(state)  (@langchain/langgraph)
                                        └─ "admissions" node → generateAgentResponse
                                             └─ llmChat(windowed msgs + formatReminder) ─▶ sarvam-105b
                                   5. parseReply → applyRegister → ttsPhonetics ──▶ bulbul:v3 simran
  MP3 queue ◀──── reply + audios + timings ◀────────────────────────────────────┘
                                   6. logMetric → Postgres (silently fails if no DB)
  end → summary LLM (schema-validated) + transcript file + edge-cases.jsonl
```

- **Frontend**: unchanged, good — vanilla JS, adaptive VAD, pre-speech buffer, barge-in, gapless MP3, latency chip.
- **Backend**: `server.js` single Node process, in-memory call Map, hot-reload of personas per call (`freshAgent()`, server.js:102), 90-day retention purge, stale-call sweep.
- **AI orchestration**: NOW two-tier — (a) rule-based fast-path, (b) a **single-node LangGraph** that ultimately calls the same `llmChat`. The graph adds a dependency and a state schema but currently performs **no routing, no sub-agent selection, no tool-calling** — it is a wrapper around one LLM call. **[INFER: the graph is a placeholder for the RCOS multi-agent design, not yet functional as one.]**
- **Tools / DB / handoff / metrics / escalation**: written, **not wired into server.js** except `logMetric` (fire-and-forget) — and all require a Postgres instance at `localhost:5432/rcos` that is [INFER] not running (no migrations, no schema file in repo).
- **Deployment / auth / monitoring**: none (localhost only, no auth, metrics table has no reader endpoint in server.js).

## 5. System Diagram — the two-project split

```
        ┌──────────────────────── ONE FOLDER ────────────────────────┐
        │                                                             │
   ┌────┴─────── WORKING AGENT (the asset) ────────┐   ┌── RCOS GRAFT (scaffold) ──┐
   │ server.js  personas(LOCKED)  sarvam  textpost │   │ graph state subagents     │
   │ public  telephony  preflight  lock  transcripts│   │ tools(MOCK) db handoff    │
   │ ZERO-dep philosophy, field-tested             │   │ observability fast-path   │
   └───────────────────────────────────────────────┘   │ rcos-mvp/ (Next.js app)   │
                     ▲                                   └───────────┬───────────────┘
                     └────── graft reaches INTO the live turn ───────┘
                              handler (fast-path + graph.invoke)  ⚠ where the damage is
```

---

## 6. Folder-by-Folder Analysis

| Folder | Purpose | Quality | Verdict |
|---|---|---|---|
| `agent/personas/` (+locked) | The IP: 3 veteran prompts + SHA baseline | High | **Intact & locked** — preflight confirms byte-match. Untouched by the graft. |
| `agent/` (persona.js, college.json) | Sanitizer, dispatch, greeting, facts | High | Solid; hot-reload is a genuine fix |
| `agent/graph.js, state.js, subagents/` [NEW] | LangGraph orchestration | Low (scaffold) | Single node, no routing/tools; adds `@langchain/langgraph` for ~0 functional gain today. State schema is thoughtful but unused fields (trust_level, confidence, pending_tasks) are never written meaningfully. |
| `lib/` (sarvam, textpost) | Vendor client + shared post-processing | High | The transport-agnostic core; excellent |
| `lib/fast-path/` [NEW] | Rule FAQ router | **Dangerous** | Hardcoded English, bullet lists, ₹1,00,000 fees that contradict college.json; matches Telugu keywords → speaks English. **Actively harmful in the voice path.** |
| `lib/tools/` [NEW] | Tool schemas + MOCK executor + validation | Medium | Validation is genuinely good; executor is all mocks; not wired to the LLM (no tool-calling loop in server). |
| `lib/handoff/, observability/, db.js` [NEW] | Escalation, metrics, Postgres | Medium | Reasonable code, but depend on a DB/schema that doesn't exist in-repo; only `logMetric` is called (and swallows errors). |
| `public/` | Call console | Good | Unchanged, works |
| `rcos-mvp/` [NEW] | Separate Next.js app | Unknown/scaffold | A second product skeleton; not integrated with the agent; not in git; ships node_modules+.next on disk (~100s of MB in a OneDrive-synced folder). |
| `scripts/`, `test/` | Preflight, lock, regression | Good | The governance layer; still valid |
| `data/` | Leads, logs, transcripts, edge-cases | OK | Now includes the F2 edge-case capture |

## 7. File-by-File — the consequential ones

- **server.js** (the live wiring; `M`, uncommitted). New turn flow (§4). **Bug C1**: `USE_FULL_REASONING !== 'false'` defaults true, so `useFullReasoning=true`; the fast-path guard is `if (!useFullReasoning || !isComplexQuery)` → `if (false || !isComplexQuery)` → **fast-path runs for every non-complex (<16-word) query.** Voice turns are almost always <16 words → fast-path dominates → persona bypassed. The env intended to disable it does the opposite of what its name implies. Hot-reload (`freshAgent`, l.102) still correct. Full path preserves persona (initialState.messages[0] is the system prompt). Summary/transcript/edge-case logic intact.
- **lib/fast-path/faq-rules.js**: 12 rules, English bullet-list responses, `₹1,00,000` fees (l.13-16), 14-campus list, RET/deadline dates — none sourced from college.json. `routeFastPath` matches on substring incl. `entha`, `namaskaram`. **Every value here is a hardcoded fact the rest of the system is architected to never hardcode.**
- **agent/graph.js / state.js / subagents/admissions.js / llm_helper.js**: a correct-but-empty LangGraph. `admissions.js` does keyword intent tagging then calls `generateAgentResponse(state)`, which windows `state.messages` and appends `formatReminder` — persona-faithful **as long as messages[0] is the system prompt** (it is, from server). The graph provides no behavior the previous direct `llmChat` didn't.
- **lib/tools/executor.js**: `auditLog` guards `if (pool)` but `pool` is always a truthy Pool object even with no DB — so audit INSERTs will reject; caught only inside try. All executors are mocks returning `{success:true}`.
- **lib/db.js**: creates a Pool to `localhost:5432/rcos` unconditionally at require-time. Harmless until a query runs.
- **lib/handoff/escalate.js**: real Slack/SendGrid/Postgres escalation — **not called anywhere in server.js** (dead until wired; would throw without DB).
- **package.json**: `"description": "...zero dependencies"` is now false (5 deps). `main: server.js`. Scripts intact.
- **rcos-mvp/package.json**: Next 16, React 19, ai-sdk, groq, openai, langgraph, node-cron, pg, zod, tailwind. A full separate stack — [INFER] the RCOS dashboard/agent from the v6.1 plan, scaffolded, not connected to the voice agent.

## 8. AI & Prompt Architecture

Prompt stack (persona → history window → format reminder → tag protocol → register/phonetics) is exactly as documented in AGENT-SPEC.md and remains sound **on the full path**. The **fast-path is an unspoken third prompt source that answers with neither the persona nor the LLM** — it is invisible to the golden regression suite (which calls `llmChat` directly) and invisible to preflight (which lints prompts, not the router). So the repo's own quality gates cannot see this regression. Temperature 0.45 fix (commit 5217c45) is correct and preserved. Hallucination containment (sanitizer + FACTS-only + regression) is **defeated at runtime by the fast-path's hardcoded numbers.**

## 9. Voice System Architecture

STT/TTS/turn-taking/emotion/barge-in/telephony all as previously documented and intact. Latency instrumentation (per-turn stage timings, P50/P95 in `/api/health`) is new and good. The fast-path *does* cut latency to ~STT+TTS (no LLM) — but by destroying the product to do it. Human escalation now has real code (`escalate.js`) but is unwired and DB-dependent. Voice provider remains single-vendor Sarvam (lock-in unchanged).

## 10. Evolution Report (since ENGINEERING-REPORT.md / commit 1555951)

| Change | Evidence | [INFER] Why |
|---|---|---|
| Persona lock enforcement | scripts/lock-personas.js, personas/locked/ | User demanded the agents be un-changeable |
| Persona hot-reload + transcripts | server.js freshAgent, data/transcripts/ | Fix the stale-server bug that ate a Telugu call |
| Temperature 0.45 + stronger reminder | commit 5217c45, textpost formatReminder | Restore verbatim-script adherence & emotion variety |
| Latency metering, edge-cases, service health | server.js, sarvam.js, preflight.js | Honest versions of RCOS F1/F2/F3/F10 |
| **LangGraph + subagents** | agent/graph.js, state.js, subagents/ | Begin RCOS multi-agent orchestration |
| **Tool layer + validation + mock executor** | lib/tools/ | Begin RCOS tool-calling (appointment/crm/whatsapp/knowledge) |
| **Postgres + handoff + metrics** | lib/db.js, handoff/, observability/ | Begin RCOS persistence/escalation/analytics |
| **Fast-path FAQ router** | lib/fast-path/, server.js:216 | Chase RCOS "<1s P95" via rule shortcuts |
| **rcos-mvp/ Next.js app** | rcos-mvp/ | Begin the RCOS dashboard/second product |
| Dependencies 0 → 5 | package.json | Consequence of adopting langgraph/ai/pg |

**The arc:** a disciplined, zero-dependency, persona-faithful agent is being converted into the RCOS v6.1 platform — but **top-down and in-place**, grafting infrastructure in front of the working agent before the agent's own contract (AGENT-SPEC) was made enforceable against it. The premortem's Failure #5 (complexity, one maintainer) and #1 (model/stack swap killing Telugu) are both **now partially realized in code.**

## 11. Engineering Decisions & Trade-offs (of the graft)

- **LangGraph adopted** — buys a future multi-agent substrate; costs a heavy dependency and, today, an empty wrapper. Trade-off not yet paying off (single node).
- **Fast-path before LLM** — buys latency; costs the entire persona/language/fact contract on matched turns. **Wrong trade for a product whose value IS the persona.**
- **Postgres for state** — buys durability/analytics; costs a running DB + schema + migrations that don't exist yet, so the code is inert or throwing.
- **Separate rcos-mvp app** — buys a clean dashboard surface; costs a second stack to maintain and (on disk) large artifacts in a synced folder.
- **In-place graft vs sidecar** — the decision to reach into `server.js` rather than run RCOS as a separate service is the root cause of the regression.

## 12. Technical Debt (prioritized)

**CRITICAL**
- **C1 — Fast-path bypasses the persona on the voice path** (server.js:216-250 + faq-rules.js). Speaks English bullet-lists at fictional ₹1,00,000 fees for fee/scholarship/greeting/Telugu-"entha" turns. *Fix: gate it off for voice (default OFF), or restrict to English text-chat only. ~10 min. This is the "lost Telugu voice."*
- **C2 — Hardcoded fees contradict the no-hallucination architecture** (faq-rules.js:13). Even if kept for text chat, must read college.json, not literals. *Fix: delete literals; source from facts. ~1 hr.*

**HIGH**
- **H1 — Uncommitted, unreviewed graft in the live turn handler** (`M server.js` + untracked libs). The working committed build (5217c45) is clean; the running build is not. *Fix: decide, then commit or revert deliberately.*
- **H2 — LangGraph adds a dependency + failure surface for zero current benefit** (graph.js single node). *Fix: either implement real routing/tools or revert to the direct llmChat call for MVP.*
- **H3 — DB-dependent modules inert/throwing without Postgres** (db.js, handoff, observability, tools/executor auditLog). No schema/migrations in repo. *Fix: add schema + `if (process.env.DATABASE_URL)` guards, or remove until needed.*
- **H4 — `rcos-mvp/` node_modules + .next in a OneDrive-synced folder** (100s of MB, untracked). Sync churn + accidental-commit risk. *Fix: move out of the synced tree or gitignore + prune.*

**MEDIUM**
- M1 — package.json "zero dependencies" description now false.
- M2 — Regression/preflight cannot see the fast-path (quality gates blind to the biggest risk). Add a full-pipeline test that goes through `/api/call/turn`, not just `llmChat`.
- M3 — State schema fields (trust_level, confidence, pending_tasks) declared but never meaningfully set → dead schema.
- M4 — Two premortems (PREMORTEM.md, RCOS-PREMORTEM.md) + this = doc sprawl; keep one index.

**LOW** — CRLF warnings (add .gitattributes); README still pre-Resonance.

## 13. Security Review

- Live Sarvam key in `.env` (gitignored ✓) but in a **OneDrive-synced** folder and **rotated twice via chat** — rotate once more to a value never pasted, and consider a secrets manager before any shared deployment.
- `lib/db.js` default connection string embeds `postgres:password` — fine as a placeholder, must never reach prod.
- Escalation posts lead PII (name, %, sentiment) to Slack/SendGrid — ensure those webhooks are access-controlled before use.
- No auth on the server; do not expose beyond localhost without a shared secret. Unchanged from prior report.

## 14. Performance Review

- Full-path turn: ~3–4s (STT ~0.6s + LLM ~0.5–0.7s + TTS ~1.8–3.5s; TTS at 48kHz dominates — see live logs). Fast-path: ~STT+TTS only. **[INFER: the TTS 48kHz payload is the real latency lever, not the LLM — dropping to 24kHz or streaming TTS would help far more than the fast-path, without breaking the persona.]**
- LangGraph adds negligible CPU but a cold-require cost and a dependency.
- In-memory Map + JSONL append: fine to dozens of concurrent calls; Postgres path unproven.

## 15. Missing Components (severity-ranked)

1. Real fees/results in college.json (10 TODO) — blocks pilot.
2. Brand authorization — blocks external calls.
3. DB schema/migrations for all the Postgres code (none in repo).
4. Tool-calling loop (tools defined but LLM never invokes them; no function-calling wired to Sarvam).
5. Streaming STT/TTS (the real latency fix).
6. Auth, dashboard reader for metrics, telephony verification.
7. Tests for the fast-path and the graph path (both untested).

## 16. Risk Assessment (top 5)

1. **Persona silently bypassed in production** (C1) — likelihood: happening now; impact: fatal to the product's only differentiator; detection: listen to any Telugu fee call / read a transcript; mitigation: gate off fast-path.
2. **Invented fees spoken to real parents** (C2) — likelihood: high if demoed as-is; impact: refund/legal/brand; mitigation: delete hardcoded facts.
3. **Complexity outruns the single maintainer** (RCOS premortem F5, now real) — likelihood: high; impact: slow rot; mitigation: sidecar RCOS, keep the agent minimal.
4. **Unreviewed graft merged to live path** (H1) — likelihood: realized; impact: exactly this regression; mitigation: commit discipline + the full-pipeline test.
5. **DB code throws under load when Postgres absent/misconfigured** (H3) — likelihood: medium; impact: turn failures; mitigation: env-guard every DB path.

## 17. Pre-Mortem — "It's launch day. It failed. Why?"

- **The demo parent asked about fees in Telugu and heard an English robot quote ₹1,00,000.** (C1+C2) — *near-certain as-is; the #1 fix.*
- **A stakeholder was promised "<1s" and the graph/DB path delivered 3–4s + occasional errors.** — align expectations to 2–4s (§14).
- **The maintainer drowned** keeping LangGraph + Postgres + tools + rcos-mvp + the agent alive solo. — run RCOS as a separate, optional service; the agent must keep booting with zero infra.
- **A persona "improvement" via the graft path regressed Telugu and nobody noticed** because the golden tests only probe `llmChat`. — add an end-to-end turn test.
- **OneDrive synced a half-written .next build mid-save and corrupted a file / leaked the key.** — get build artifacts and secrets out of the synced tree.

## 18. Improvement Roadmap

**Immediate (today):** gate off the fast-path for voice (C1); delete hardcoded fees (C2); commit or revert the graft deliberately (H1); add `.gitattributes`.
**This week:** decide RCOS topology — **strong recommendation: sidecar, not in-line.** Keep `server.js` persona-pure; run graph/tools/DB as a separate `rcos-mvp` service that the agent calls only for async post-call work (CRM, escalation, analytics). Add an end-to-end `/api/call/turn` test to the golden suite. Env-guard every Postgres path.
**This month:** real tool-calling loop (if RCOS proceeds); streaming STT/TTS for latency; DB schema + migrations; move rcos-mvp out of OneDrive.
**Deliberately deferred:** multi-branch, 4 sub-agents, semantic cache, calibration — per RCOS-PREMORTEM, until one branch is signed and economics proven.

## 19. Recommended Development Priorities

1. **Restore the Telugu voice** (C1/C2) — the user's stated pain; ~1 hour; nothing else matters until this is done and heard.
2. **Freeze the contract against the graft** — make the golden suite test the real turn endpoint so the personas can't be silently bypassed again.
3. **Choose sidecar RCOS** — protect the zero-infra bootability of the agent.
4. **Fill facts + get authorization** — the pilot gate.
5. **Then, and only then**, extend RCOS depth.

## 20. Conclusion

The working voice agent is still, at its core, an excellent and well-governed asset — locked personas, hot-reload, transcripts, preflight, an explicit AGENT-SPEC. But between the last report and now, an ambitious RCOS platform was grafted *in front of* it, and the graft's fast-path is **live-bypassing the very Telugu persona the user spent this entire project protecting**, quoting invented fees in English. The fix is small and urgent (§12 C1/C2). The larger lesson is architectural: RCOS should stand *beside* the agent as a sidecar, never *in front of* it — because this repo already proved, in its own AGENT-SPEC and lock system, that the persona is the product, and nothing on the voice path may be allowed to bypass it. Do §19 items 1–3 and the agent is restored and protected; the RCOS ambition can then proceed safely and on evidence.
