# Implementation Plan — MVP → Final Product
*2026-07-06 · The build roadmap for every goal, in order. Companion to ADMISSIONS-OPS-WORKFLOW.md (what/why) and LATENCY-PLAYBOOK.md (how-fast).*

## The Goals Ledger (owner-mandated, permanent)

| # | Goal | Applies to |
|---|---|---|
| G0 | **Main goal:** replace the 15-member admissions team (MVP) / 30-member org (final) — humans ₹15k/mo nominal, shift-based, ~200 calls each/day | Everything |
| G1 | **Minimize latency** — target P95 ≤1.2s voice-to-voice (final); every safe win on MVP meanwhile | MVP + Final |
| G2 | **Minimize token/usage cost** — without touching what makes Sneha human | MVP + Final |
| G3 | **The soul:** 30+yr veteran with true domain mastery; warm cup-of-tea feel; knows WHO it's talking to (father/mother/son/daughter); **remembers past calls** (child's name, prior conversation, details); college never feels the team's absence — performs BETTER than the humans | MVP + Final |
| G4 | **Zero hallucination** — never a false fee, promise, or invented fact, ever | MVP + Final |
| R1 | **Price-truth rule:** no invented prices. Official sources only; if unfindable → tell the owner and ask |
| R2 | Quality guardrails: sarvam-105b for te/hi (never swapped), Bulbul v3 + Simran (owner-locked), one LLM hop, no canned answers on the persona path, personas SHA-locked |

---

## PART A — MVP build (order of execution)

**M1. Cross-call memory — the G3 centerpiece (build first; pure code, no persona edit)**
The CRM already stores every call's summary, interest, objections, child's name, appointment. Inject a RETURNING-CALLER context block into the lead section of the prompt: calls so far, last summary, last objections, promised next action, child details. Add a returning-caller greeting variant ("మళ్ళీ మాట్లాడుతున్నాం రమేష్ గారు…" style — deterministic, like the existing greeting). Acceptance: call the same lead twice; on call 2 Sneha references the earlier conversation naturally and never re-asks known facts.

**M2. Lead import (Dept 1)**
Admin-page upload (CSV/Excel: parentName, phone, studentName, gender, language, area, interest, tenthResult, source) → validate → dedup against leads + CRM + DNC → append to queue. Errors shown per-row, nothing silently dropped. Acceptance: a 50-row file imports clean; a duplicate and a DNC row are visibly rejected.

**M3. Inbound webhook (Dept 2 inbound)**
Point the Twilio (later Exotel) number's incoming-call webhook at the bridge; look up caller number in leads+CRM → known lead gets recognized (M1 context); unknown caller → **[OWNER DECISION D1]** new-enquiry capture vs office-message. Acceptance: calling our number reaches Sneha; a known lead is greeted by name with memory.

**M4. WhatsApp brochure auto-send (Dept 4) — blocked on keys [ASK]**
After a call where interest ≥ warm or brochure requested: send the matching PDF link via WhatsApp Business API. Acceptance: end call → WhatsApp arrives < 1 min. (Until keys: SMS with link as fallback.)

**M5. Handoff alerts (Dept 3 human-in-loop)**
When a call ends hot, angry, or with an exceptional request: immediate SMS/WhatsApp to the counselor's number with the M1-style context brief. Acceptance: hot lead → human pinged within 1 min with usable context.

**M6. Document reminders (Dept 6, MVP slice)**
Checklist per admitted/visiting lead (Aadhaar, TC, SSC memo); scheduler sends WhatsApp/SMS reminders until marked received on the admin page.

**M7. G1 latency pack (MVP-safe wins)**
Done: keep-alive sockets, cached greeting. Next: (a) endpoint tuning from real call data (down from 1300ms where safe); (b) TRIAL streaming TTS in the current bridge via Sarvam's TTS WebSocket (first-chunk playback) — attempt only if it doesn't destabilize; (c) move server to an Indian region + Exotel (kills 150–300ms network + enables inbound properly). MVP acceptance: phone P95 ≤ 2.5s.

**M8. G2 cost pack**
(a) Rolling summary: keep last 8–10 turns verbatim + ~120-token running summary of older turns — REQUIRED to also preserve G3 memory on 15–20-min calls; golden-suite check that early-call facts survive. (b) Confirm cache billing once on paid plan [ASK]. (c) TTS text-normalization pass (strip anything unspoken before synthesis — every char is money).

**M9. Funnel dashboard (Dept 11 completion)**
Enquiry → called → conversation → visit booked → visited → admitted, per campus. Data already flows; this is a view.

**M10. Demo hardening**
Preflight green, 3 rehearsal calls per language reviewed, Sarvam credits confirmed, stable tunnel (ngrok/reserved) for the pitch, demo runbook per MVP-DEMO.md.

## PART B — Final product phases

**P1. LiveKit PoC (the decided fork-resolver):** smallest possible LiveKit agent with Sarvam STT/LLM/TTS — Python plugin vs thin Node adapter judged side-by-side; Sneha ported per AGENT-SPEC §8 checklist (byte-identical personas, same reminder, same tag pipeline). Go/no-go on listen test: "same Sneha."
**P2. Streaming rebuild on the P1 winner:** streaming STT partials → LLM at stabilized text → TTS at first sentence; semantic turn detection; barge-in; P95 ≤1.2s measured per stage (G1 acceptance).
**P3. Telephony at scale:** Exotel SIP into LiveKit; inbound+outbound; channel sizing; concurrent-call load test.
**P4. Documents + OCR (Dept 6 full):** upload links → Sarvam doc digitization (₹0.5/page, official) → extracted fields → human verify → CRM prefill (Dept 7 full).
**P5. Payments (Dept 9):** payment links + reminders + confirmations (gateway MDR passed through; official rates from provider [ASK at build time]).
**P6. Multi-college tenancy:** Postgres, per-college facts DB + persona wiring + numbers; onboarding console (new college in a day).
**P7. Analytics (Dept 11 full):** branch-wise, college-wise, response-time and conversion reporting.
**P8. Post-admission comms (Dept 12).**
**P9. Jio SIP trunk migration** at 10+ colleges (owner-locked strategy) — re-run cost crossover with real operator quotes [ASK].

## PART C — G3 "soul" workplan (continuous, spans MVP→final)

1. **Memory:** M1 (returning-caller context) + M8a (rolling summary preserving rapport anchors) + CRM child/parent details always in prompt.
2. **Addressee awareness:** persona already has parent-vs-student rules + handoff exception; extend lead schema with relation (father/mother/guardian) and use it in address forms (గారు/జీ etc.). Persona edit → owner approval + relock.
3. **Domain mastery:** grow college.json + FAQ from every edge-case capture (the loop exists); add admission-process depth (RET stages, dates) each season [ASK for updates].
4. **Voice naturalness program (per language):** A/B emotion pace/temperature on real phone audio; TTS text normalization (breath-boundary chunking, punctuation-driven prosody); filler/disfluency balance review per language; quarterly 26-voice re-audition only if owner asks (Simran locked).
5. **Fine-tuning inquiry:** ask Sarvam whether Bulbul/105b custom fine-tuning exists for enterprise [ASK — this is the path past ~95% naturalness].
6. **Acceptance (the bar):** the historical gate stands — 10 real Telugu-speaking parents; ≥8 say "I couldn't tell it wasn't a person." Repeat per language before pilot.

## PART D — G4 anti-hallucination (standing architecture)

Curated verified facts DB (college.json) → sanitizer (unknown = "office will confirm") → on-demand fact injection (deterministic, no retrieval errors) → deterministic number-speaking → 16-question golden suite (invented-number detector) → edge-case capture → human answers → DB grows only through verification. Final product: OCR/RAG feeds the DB **at ingestion with human approval**, never a live call. Facts freshness gate (30-day warning) already enforced by preflight.

## Current [ASK] ledger (price-truth rule)

1. Exotel per-minute + channel rental — official quote needed (I can draft the email).
2. Sarvam paid-plan billing + cache-hit visibility + fine-tuning availability.
3. WhatsApp Business API keys + Meta conversation pricing at our volume.
4. Jio SIP trunk enterprise rates (at P9 time).
5. Resonance internals: shifts structure, lead volume, conversion funnel, real salaries, current CRM.

## Owner decisions — RESOLVED 2026-07-06

- **D1 ✅:** Unknown inbound caller → Sneha converses and warmly discovers the reason (new enquiry vs existing parent on a different number), then the human team is notified after the call (`human_review_inbound` task). BUILT.
- **D2 ✅:** M1–M3 approved and **BUILT 2026-07-06**: M1 cross-call memory (CRM → prompt memory block + returning-family greetings, web + phone) · M2 lead import (admin-page CSV upload, validate/dedup/DNC, per-row verdicts) · M3 inbound (Twilio webhook → bridge, caller recognition, unknown-caller discovery flow, `scripts/setup-inbound.js`) · PLUS missed-call follow-up (owner rule: engaged family → WhatsApp/SMS message; never-engaged → voice retry; covers both silent calls and never-answered dials via StatusCallback).
- **D3 ✅ (delegated to engineering):** assumed team model — 15 members across two overlapping shifts covering 9:00–20:00 (8 members 9–17h, 7 members 12–20h), 200 dials each = 3,000 dials/day; ~35% answered ≈ ~1,050 conversations; blended ~4 min ≈ ~70 talk-hours/day ≈ ~105,000 talk-min/month at season peak. **Replace with Resonance's real numbers at pilot kickoff [ASK].**
