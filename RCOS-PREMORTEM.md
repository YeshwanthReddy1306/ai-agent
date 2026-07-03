# RCOS Lite v6.1 — Premortem & Feasibility Verdict
*Assessed 2026-07-03 against the actual state of this repo (working 3-language agent, 28 field calls, 1 unauthorized pilot brand, solo builder + AI tooling, free-tier Sarvam credits).*

---

## The Verdict First

**Can it be done really?** Split answer:

| As written | Staged honestly |
|---|---|
| ❌ 10–14 week MVP with 4 sub-agents + LangGraph + 10 mitigation systems + telephony + dashboards | ✅ Phase-1 subset (1 branch, versioned knowledge, escalation queue, telephony) in 10–14 weeks |
| ❌ ₹6.24L total setup ("12 weeks of engineering" for what is 2–4 engineer-years of described scope) | ✅ ₹6L buys the SUBSET if you keep building solo+AI the way this repo was built |
| ❌ P95 < 1.0s through a multi-hop LangGraph (perception→memory→reasoning→planning→decision→supervisor→sub-agent) | ✅ P95 ~1.5–2.5s with streaming STT/TTS and a SINGLE LLM hop — the graph and the latency target contradict each other |
| ❌ 30+ branches in 12 months starting from an unsigned pilot | ✅ 1 → 3 → 10 branches over 12–18 months, gated on the plan's own (good) promotion metrics |
| ⚠️ Groq Llama-3 as the brain | ❌ This one is flatly wrong for you — see Failure #1 |

The plan's best ideas are real and worth keeping: **knowledge versioning with effective dates, human-in-the-loop edge-case capture, phased automation gates, golden-dataset regression, circuit breakers, the hidden-costs table** (₹48k/mo ops is the most honest number in the whole document). The wrapper around those ideas — stack choices, timeline, and several code snippets — does not survive contact with reality.

---

## Premortem: "It's month 6 of RCOS v6.1. It failed. Why?"

### 1. Groq Llama-3 destroyed the Telugu that took you weeks to build
**Likelihood: near-certain if followed · Impact: fatal.** The plan routes every conversation through `groq('llama-3-70b')` / `llama-3-8b` and even `claude-3-opus`. Llama-3 is weak at generating natural Telugu script and knows nothing of your Hyderabadi register rules; you *already ran this experiment* — the entire persona war was fought to stop sarvam-105b, an Indian-language-native model, from sounding bookish. Swapping to Llama-3 resurrects the "bookish counselor" you just killed, at native-script quality far below what you have today.
**Mitigation:** the LLM is non-negotiable — Sarvam (or another Indic-tuned model validated by your regression suite) stays. Groq can serve ONLY English-language, non-persona utility tasks (classification, summary JSON). Any model change must pass `npm test` + a human Telugu listen before deploy.

### 2. The latency target and the architecture are mutually exclusive
**Likelihood: certain · Impact: high (credibility).** P95 < 1s is promised while every turn traverses a blackboard graph with 8 named engines plus sub-agent dispatch plus RAG over Cloud SQL plus tool calls. Each LLM hop is 300–1500ms; the described graph implies 2–4 hops. Your current SINGLE-hop pipeline runs 3–4s. Multi-hop cannot beat single-hop.
**Mitigation:** commit to ONE synchronous LLM hop on the voice path (persona answer), with streaming STT/TTS to cut perceived latency; run supervision/scoring/lead-updates ASYNC after the reply is already speaking. Restate the target honestly: P95 ≤ 2.5s at MVP, ≤ 1.5s after streaming. If a stakeholder was sold "<1s", month 6 is when they call it a failure.

### 3. Nobody signed — the plan scales a customer that doesn't exist yet
**Likelihood: high · Impact: fatal for the business case.** The plan budgets for 30+ Resonance branches; today the brand is used without written authorization, fees are TODO placeholders, and zero revenue exists. The web scraper even targets `resonance.ac.in` with invented CSS selectors — scraping a brand you don't yet have a contract with.
**Mitigation:** the real Phase 0 (missing from the plan): Resonance sign-off + one branch's real data + 10-parent test + a paid pilot agreement. Every rupee of GCP/GKE/CRM spend before that signature is spend at risk.

### 4. The "implemented" mitigations are sketches wearing production clothes
**Likelihood: certain (verified by reading the code) · Impact: medium-high (false confidence — ironically, Failure #8's own subject).** Evidence from the snippets themselves:
- Redis semantic cache calls **non-existent commands** (`FTS.SEARCH`, `FT.ADD` with wrong syntax; real RediSearch is `FT.SEARCH`/`HSET` with a vector index schema).
- `calculateBayesianConfidence` is keyword-penalty arithmetic labeled "Bayesian"; the "temperature scaling" formula is not temperature scaling.
- `getPilotMetrics()` returns **hardcoded** 0.85/0.12/4.2 — the promotion gates would pass on fake numbers.
- Deepgram Flux configured for Telugu (`language_hint: ['te']`) — Deepgram's Telugu is not production-grade, and you already own a better STT (Saaras v3). Two STT vendors for no reason.
- Escalation "connects you to our senior advisor" with **no transfer mechanism** (no SIP REFER, no queue, no advisor UI).
- Scraper selectors (`.fee-structure .hyderabad-branch`) are fictional.
**Mitigation:** treat the document as a design sketch, not deliverables. Each mitigation gets rebuilt small, on your stack, with a real test — the way this repo's preflight/lock/regression tools were built.

### 5. Ten systems, one maintainer
**Likelihood: high · Impact: slow death.** Versioned KB + scraper + validator + edge-case orchestrator + semantic cache + latency monitor + phase gatekeeper + calibrator + circuit breakers + golden dataset + GKE + Redis + Cloud SQL + LangGraph + Vercel AI SDK + Dograh — maintained by one person is 30+ surfaces that can silently rot. The plan's own Failure #10 ("complexity") is committed by the plan itself.
**Mitigation:** adopt a hard rule: a component enters the stack only when a logged field failure demands it. Your zero-dependency core is currently your biggest operational advantage; spend it reluctantly. Concretely: no Redis before cache-miss latency is a measured complaint; no LangGraph before a second concurrent workflow actually exists; no GKE before Cloud Run limits are hit.

### 6. The Python/JS seam nobody scoped
**Likelihood: high · Impact: medium.** Dograh/Pipecat is Python; the orchestration is LangGraph.**js** with Vercel AI SDK. The plan never says how audio frames, state, and barge-in signals cross that boundary (gRPC? WebSocket? shared Redis?). That seam is 2–4 weeks of unglamorous work and a permanent debugging tax, and it's in nobody's timeline.
**Mitigation:** pick one runtime for the voice path. Either go full Pipecat (Python) and port the persona/textpost layer, or extend your existing Node server with streaming — porting ~300 lines of your proven pipeline logic is cheaper than maintaining a cross-language bridge.

### 7. Costs are right-shaped but wrong at the edges — and missing the biggest line
**Likelihood: medium-high · Impact: medium.** ₹550/mo "Jio SIP trunks" won't cover business SIP with DIDs + per-minute usage at 200 calls/day (realistic: ₹5k–₹20k/mo with usage); WhatsApp Business API conversation fees at admissions volume exceed ₹2k/mo in season; and the single largest line — **the builder's own time for 8–12 months** — appears only as ₹6L "core software development," which at the described scope is a 2–4 engineer-year job. The hidden-ops table (₹48k/mo) is honest; the setup table is not.
**Mitigation:** re-baseline: pilot run-rate target ≤ ₹15k/mo (1 branch, Cloud Run or even the current box, no GKE/Redis); re-quote telephony from actual Jio/Exotel quotes; price your own year.

### 8. TRAI/DPDP is still a checkbox, now with more channels
**Likelihood: medium · Impact: fatal at scale.** v6.1 adds WhatsApp + SMS + email outbound — every one of them regulated under TCCCPR alongside voice (registered sender IDs, template approval, consent records), and the plan stores minors' data across Cloud SQL + Redis + logs with no consent/retention design beyond what this repo already has.
**Mitigation:** compliance is a Phase-1 deliverable, not Phase-4: PE-TM registration, 140-series numbering, DND scrub, WhatsApp template approval, and a data-retention map BEFORE branch #2.

### 9. Shadow mode without counselors' trust becomes surveillance
**Likelihood: medium · Impact: high (the humans kill it).** The change-management module is the right idea, but "AI running silent parallel to human counselors" measured against them, run by an outsider, reads as performance monitoring. Counselors who feel measured will feed the system bad examples and lobby management against it — Failure #7 realized through the very tool meant to prevent it.
**Mitigation:** flip the framing: counselors are paid trainers whose corrections in the edge-case dashboard visibly improve "their" agent; shadow-mode metrics compare the AI against the *process* (response time, follow-up rate), never against named individuals.

### 10. The pilot's success gets measured with the vanity metric
**Likelihood: medium · Impact: strategic.** "Resolution rate >80%" for an admissions SALES agent measures the wrong thing — a call can "resolve" (question answered) and convert nothing. The plan never defines the number the college actually buys: **campus visits booked and admissions attributable to the agent.**
**Mitigation:** add the two revenue metrics to the gate table: visit-booking rate per connected call (target: beat the human team's), and cost per booked visit. These decide renewal; the other nine metrics are engineering hygiene.

---

## Feasibility Re-Baseline (what "yes" actually looks like)

| Milestone | Plan says | Reality from this repo |
|---|---|---|
| Phase 0 (missing): Resonance contract + real data + 10-parent test | — | 2–6 weeks, mostly waiting on humans |
| MVP: 1 branch live on real phone line, escalation queue, versioned facts, streaming latency ≤2.5s | 10–14 weeks (with sub-agents, LangGraph, GKE) | 10–14 weeks IS credible for THIS subset, building on the existing ~1,900-line core |
| 5 branches + edge-case dashboard + golden dataset in CI | Months 4–6 | Months 4–8 |
| 10 branches + semantic cache + calibration (if data volume justifies) | Months 7–9 | Months 9–14 |
| 30+ branches, full lifecycle, LangGraph/Pipecat migration | Months 10–12 | Month 15+, only after 10-branch economics are proven |
| Pilot monthly run-rate | ₹90k best estimate | ≤ ₹15k until branch 3; the ₹90k shape becomes true near 10+ branches |

**Keep from RCOS v6.1 (genuinely good):** versioned knowledge with effective dates (drop-in upgrade to college.json), edge-case capture → human answer → learned-knowledge loop, phase gates with metric criteria, golden dataset in CI (extend the existing `npm test`), circuit-breaker/degradation pattern (already half-built: TTS→text fallback, retry-once), the hidden-ops cost table, asia-south1 region choice.

**Reject or defer:** Groq/Deepgram/Claude-Opus model swaps (Sarvam stays), multi-hop LangGraph on the synchronous voice path, GKE + Redis + 4 sub-agents at pilot scale, the fictional scraper, "<1s P95" as a promise, 30-branch budgeting before one signed branch.

**The one-sentence answer:** the destination is buildable and the mitigations are the right homework — but the road there starts from this repo's working core with Phase 0 (contract + data + parent test), not from a ₹6L greenfield rebuild on a stack that would undo your hardest-won asset: how Sneha sounds in Telugu.
