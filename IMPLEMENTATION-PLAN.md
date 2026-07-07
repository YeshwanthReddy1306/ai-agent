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
| G5 | **HARD COST CEILING (owner 2026-07-06, 3 tiers, each at its own volume):** total run-cost (Sarvam+Groq+telephony+WhatsApp+infra, incl. recurring Dept-12) **< HALF the replaced team's salaries** — 5-member tier < ₹37,500/mo · MVP/15 < ₹1,12,500/mo · final/30 < ₹2,25,000/mo — voice/performance untouched. Current estimates with levers: ~₹20–25k / ~₹60–75k / ~₹1.2–1.5L — **all three under ceiling** (pending FreJun + Sarvam ASKs) | All tiers |
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

**M5. Handoff alerts (Dept 3 human-in-loop) — ✅ BUILT 2026-07-06**
Hot lead, booked visit, unknown inbound caller, or angry parent → instant SMS to `COUNSELOR_PHONE` with a context brief, the moment the call ends (web + phone). WhatsApp when keys arrive. Set `COUNSELOR_PHONE` in .env to activate.

**M6. Document reminders (Dept 6 — owner scope 2026-07-06: reminders ONLY, humans verify; NO OCR)**
Checklist per admitted/visiting lead (Aadhaar, TC, SSC memo); scheduler sends WhatsApp/SMS reminders until a human marks received on the admin page. The OCR/upload pipeline is REMOVED from scope — parents bring documents, humans see and verify them.

**M7. G1 latency pack (MVP-safe wins)**
Done: keep-alive sockets, cached greeting. Next: (a) endpoint tuning from real call data (down from 1300ms where safe); (b) TRIAL streaming TTS in the current bridge via Sarvam's TTS WebSocket (first-chunk playback) — attempt only if it doesn't destabilize; (c) move server to an Indian region + Exotel (kills 150–300ms network + enables inbound properly). MVP acceptance: phone P95 ≤ 2.5s.

**M4. WhatsApp brochures — ✅ BUILT (lib/ops.js + lib/notify.js) 2026-07-07.** Warm/hot call auto-queues the matching brochure link (ResoNET + DLPD/residential by interest). Sends via unified channel: WhatsApp when keys live, SMS fallback now. Placeholder-safe.

**M9. Funnel dashboard — ✅ BUILT.** /api/funnel + admin cards: enquiries → contacted → conversations → hot → visits → admitted.

**Dept 1 enquiry capture — ✅ BUILT.** Public /enquiry.html + /api/enquiry (outside the auth gate); creates a deduped/DNC-checked lead + queues an INSTANT callback (5-min golden window).

**Dept 9 payments framework — ✅ BUILT.** /api/payments/plan + /paid; installment schedule + pre-due-date WhatsApp reminders; PAYMENT_LINK_BASE placeholder until the college's gateway at contract.

**Dept 12 post-admission — ✅ BUILT (core retention product).** Roster import + per-language templates (absent/result/fee/pta/circular) + filtered broadcast (all/class/section) via the WhatsApp-first channel. Admin panel live.

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
**P4. ~~Documents OCR~~ — REMOVED (owner scope 2026-07-06): documents stay reminder-only (M6); humans see and verify them. No OCR.**
**P5. Payments (Dept 9) — post-contract:** the college provides their gateway (Razorpay link / QR scanner) at signing; we build: seat-confirmed → payment link on WhatsApp → polite reminders on schedule → paid → CRM update + receipt → installment schedule (2–3 installments per Resonance structure) tracked with pre-due-date reminders. Humans: disputes + concessions only.
**P6. Multi-college tenancy:** Postgres, per-college facts DB + persona wiring + numbers; onboarding console (new college in a day).
**P7. Analytics (Dept 11 full):** branch-wise, college-wise, response-time and conversion reporting.
**P8. Post-admission comms (Dept 12) — ELEVATED (owner 2026-07-06: "one of the main parts, make it work 100%").** Research findings (2026-07-06): the proven India pattern is ERP/webhook → WhatsApp Business API **utility templates at ₹0.115/message** ([Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)); WhatsApp fee reminders hit **98% open rates vs 75% SMS** and institutions report **40–50% better on-time fee collection** and **70–80% parent adoption in the first term** ([industry](https://www.classcare.in/features/whatsapp-integration-system/), [WABA education guide](https://waba.nxccontrols.in/blog/whatsapp-business-api-for-education-fee-reminders-admissions-student-support-2026)). Build (framework now, integrate at contract): notification engine with per-language templates (te/hi/en) + trigger types (absent, test result/SAPER, fee due, PTA, circular, event) + data feed (CSV/manual upload first, college-ERP webhook when they connect theirs) + delivery/read tracking. This is the retention product — the college pays year-round.
**P10. Capture bots (Dept 1 full) — build-ready, integrate at contract:** website chat widget, WhatsApp number bot, social-DM auto-response, ad-platform auto-import — all feeding the same dedup + DNC + instant-call pipeline (the 5-minute golden window).
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

## G5 cost-attack plan (telephony research 2026-07-06)

| Lever | Finding | Status |
|---|---|---|
| **TTS line-cache** | Verbatim playbook scripts repeat by design → identical lines ≤200 chars disk-cached; repeat = ₹0. Est. 25–40% off the biggest cost line at volume | ✅ BUILT (web+phone) |
| **FreJun unlimited India** | ₹1,349/user/mo Standard, ₹1,699 Pro — "genuinely unlimited" India in/outbound per their own [knowledge base](https://knowledge.frejun.com/frejun-india-plans-and-pricing). ⚠ Owner's "₹0.15/min Teler" figure NOT confirmed — FreJun's own blog cites **$0.15/min** (≈₹13/min) for "telephony + AI compute" bundles. **[ASK FreJun: does per-user unlimited apply to API/AI-agent traffic, and what is Teler's real India per-min rate?]** | Lead option |
| **Toll-free masking (principal's model)** | Real, ~₹2–4k/mo — but built for human agents; also needs DLT compliance | Fallback |
| **Employee-SIM model (principal's model)** | ❌ REJECTED for us: TRAI's amendment **blocks 10-digit numbers for business communication**; unregistered telemarketers face a **20-call/day cap and disconnection** ([TRAI regs](https://www.trai.gov.in/sites/default/files/2025-02/Regulation_12022025.pdf), [guide](https://www.elisiontec.com/140-and-160-series-regulations-from-trai-complete-guide-faqs/)). Colleges ride a gray zone per-staff-SIM; an automated system cannot | Non-compliant |
| **Our compliance lane** | Calls to existing enquiries = service/transactional → **160-series number** + PE-TM/DLT registration (140-series is for promotional) | Required before pilot |
| **WhatsApp-first substitution** | Reminder as template ₹0.115 vs reminder call ~₹4+ → route every non-conversation touch to WhatsApp | Scheduler already prefers it |
| Ameyo / CloudConnect | Quote-only pricing (no public rates) | Quote at pilot |

## Current [ASK] ledger (price-truth rule)

1. **FreJun sales:** does unlimited-per-user cover API/AI-agent (Teler) traffic? Real India per-minute for Teler? Channel/number costs?
2. Exotel per-minute + channel rental — official quote (comparison anchor).
3. Sarvam paid-plan billing + volume/enterprise pricing + cache-hit visibility + fine-tuning availability.
4. WhatsApp Business API keys + Meta conversation pricing at our volume.
5. Jio SIP trunk enterprise rates (at P9 time).
6. Resonance internals: shifts structure, lead volume, conversion funnel, real salaries, current CRM.
7. 160-series number + DLT/PE-TM registration process via the chosen telephony provider (pre-pilot compliance gate).

## Owner decisions — RESOLVED 2026-07-06

- **D1 ✅:** Unknown inbound caller → Sneha converses and warmly discovers the reason (new enquiry vs existing parent on a different number), then the human team is notified after the call (`human_review_inbound` task). BUILT.
- **D2 ✅:** M1–M3 approved and **BUILT 2026-07-06**: M1 cross-call memory (CRM → prompt memory block + returning-family greetings, web + phone) · M2 lead import (admin-page CSV upload, validate/dedup/DNC, per-row verdicts) · M3 inbound (Twilio webhook → bridge, caller recognition, unknown-caller discovery flow, `scripts/setup-inbound.js`) · PLUS missed-call follow-up (owner rule: engaged family → WhatsApp/SMS message; never-engaged → voice retry; covers both silent calls and never-answered dials via StatusCallback).
- **D3 ✅ (delegated to engineering):** assumed team model — 15 members across two overlapping shifts covering 9:00–20:00 (8 members 9–17h, 7 members 12–20h), 200 dials each = 3,000 dials/day; ~35% answered ≈ ~1,050 conversations; blended ~4 min ≈ ~70 talk-hours/day ≈ ~105,000 talk-min/month at season peak. **Replace with Resonance's real numbers at pilot kickoff [ASK].**
