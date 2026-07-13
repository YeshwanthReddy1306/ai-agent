# Admissions Operations Workflow Analysis
*The foundation document for the AI Admissions Platform — product scope, pilot pitch, and implementation priorities.*
*2026-07-05 · Demo/pilot college: **Resonance Hyderabad** · Every external claim cited; every unverified number flagged **[ASK]**.*

**The framing rule (from product strategy):** we do not sell "replacing people." We sell **automated workflows** — faster response, more enquiries handled, staff time moved from repetitive work to judgment work. The economics below still quantify the savings, because that's what the buyer ultimately computes.

---

## 1. The As-Is Workflow (how it works today, evidenced)

Real Hyderabad admission-counselor/telecaller job postings ([PlacementIndia](https://www.placementindia.com/job-search/admission-counselor-jobs-in-hyderabad.htm), [Naukri](https://www.naukri.com/admission-counselor-jobs-in-hyderabad-secunderabad), [Internshala](https://internshala.com/fresher-jobs/telecaller-admission-counselor-jobs/)) describe the actual daily work: *"calling prospective students from provided data, explaining course details and benefits, handling queries, following up with interested candidates, converting leads into admissions, maintaining call records"* against *"daily/weekly/monthly call targets"*, requiring *"good communication in Telugu, Hindi, or English."* Typical salary ₹15–20k/month (range ₹10k–₹99k across seniority) — the ₹15k/person figure used throughout is realistic.

```
Lead arrives (walk-in / web form / referral / exhibition)
  ↓ someone notices it            (hours–days later; industry average first response: 42 hours)
  ↓ someone calls                 (working hours only; language depends on who's free)
  ↓ someone explains courses/fees (quality varies by person, mood, experience)
  ↓ someone sends the brochure    (WhatsApp, manually, hundreds of times)
  ↓ someone writes down details   (or forgets to)
  ↓ someone schedules a visit     (calendar ping-pong)
  ↓ someone reminds the parent    (or forgets)
  ↓ someone chases documents      (Aadhaar, TC, SSC memo — repeatedly)
  ↓ someone types it all into records
  ↓ someone follows up again      ("did you visit? have you decided?")
  ↓ admission
```

**Season pressure:** the whole funnel compresses into a ~4-month window — TG EAPCET 2026 registration opened Feb 19, exams May 9–11, counselling/seat allotment through June ([Careers360](https://engineering.careers360.com/articles/ts-eamcet-2026), [TGCHE](https://eapcet.tgche.ac.in/)); Intermediate results and ResoNET scholarship-test cycles drive parallel spikes. A fixed-size human team is overwhelmed exactly when leads are most valuable. Software scales in season for free.

**[ASK — Resonance-specific]:** internal team structure, per-counselor daily call quota, actual lead volume/month, current CRM (if any). Public sources confirm the tasks, not one institute's internals — these become pilot-kickoff questions, not assumptions.

## 2–3. Roles and Their Tasks (the 12 departments)

| # | Department | Core tasks | Nature |
|---|---|---|---|
| 1 | Marketing & lead gen | Campaigns, school outreach, enquiry forms, lead import | Mixed |
| 2 | First contact | Call every enquiry, greet, explain courses/fees/hostel, record details | **Repetitive (highest volume)** |
| 3 | Admissions counselling | Aspirations, trust, objections, guidance | **Judgment-heavy** |
| 4 | Brochure/info desk | Send MPC/BiPC/hostel/fee/scholarship PDFs, again and again | **Pure repetition** |
| 5 | Campus-visit coordination | Schedule, confirm, remind, reschedule | Repetitive |
| 6 | Document collection | Remind for Aadhaar/TC/SSC memo, receive, check completeness | Repetitive + light judgment |
| 7 | Data entry | Type names/marks/phones into records | **Pure repetition** |
| 8 | Follow-up | "Did you visit? Paid? Decided?" calls | Repetitive |
| 9 | Payment coordination | Payment reminders, links, confirmations | Repetitive |
| 10 | CRM management | Update records after every interaction | **Pure repetition** |
| 11 | Reporting | Funnel/conversion/branch reports for management | Repetitive |
| 12 | Parent communication (post-admission) | Attendance, results, fees, circulars | Repetitive (future phase) |

## 4–5. Repetitive vs Judgment (the split that defines the product)

**Fully automatable (repetitive, rule-based):** lead capture & dedup, first-response calls, FAQs, course/fee/hostel/scholarship explanations, brochure dispatch, WhatsApp/SMS messaging, visit scheduling & reminders, document reminders & OCR extraction, form pre-fill, CRM updates, call summaries, lead scoring, follow-up scheduling, dashboards.

**Human-owned (judgment):** final admission approval, fee concessions, exceptional scholarship cases, angry/complex parents, policy, partnerships, marketing strategy — plus attending the campus visit itself.

**AI-assisted middle:** counselling conversations (the agent does discovery, objection handling, visit-close with veteran scripts; a human takes over on escalation).

## 6–7. Honest Mapping: what runs TODAY vs what the MVP adds

| Dept | Our system TODAY (live, field-tested) | MVP must add | Final product adds |
|---|---|---|---|
| 1 Lead gen | 4-lead demo queue, dedup-safe CRM upsert | Lead import (CSV/web form → queue) | Website/WhatsApp capture bots, auto-dedup at volume |
| 2 First contact | ✅ **The crown piece**: trilingual voice agent, live language mirroring, real phone calls (Twilio bridge), veteran persona, emotion-driven voice, DNC | Inbound answering (webhook config) | Streaming sub-second pipeline, both directions at scale |
| 3 Counselling | ✅ Objection scripts, refusal ladder, trial-closes, SPIN opening, callback memory | Human-handoff alert ("hot lead needs a person now") | Handoff console w/ full context brief |
| 4 Brochures | Brochure links in facts; agent offers them | ✅ WhatsApp auto-send after call (needs WhatsApp Business key **[ASK]**) | Multi-doc smart dispatch |
| 5 Visits | ✅ Visit capture in summary → CRM + reminder task | Calendar slots + confirmation message | Reschedule negotiation, capacity by campus |
| 6 Documents | — | Document checklist reminders via WhatsApp/SMS | Upload links + OCR extraction + missing-doc detection |
| 7 Data entry | ✅ Auto: every call → structured summary → CRM, zero typing | — (already automated for calls) | OCR → form pre-fill |
| 8 Follow-up | ✅ Scheduler: creates tasks from outcomes, sends SMS, 'call' queue | Auto-dial follow-up calls from the queue | Multi-touch cadences (call+WhatsApp+SMS) |
| 9 Payments | — | — (out of MVP scope deliberately) | Payment links + reminders + confirmations |
| 10 CRM | ✅ File-backed CRM + atomic writes | Postgres when volume demands | Multi-college tenancy |
| 11 Reporting | ✅ Admin dashboard: leads, hot/warm/cold, visits, calls; latency P50/P95 | Funnel view (enquiry→call→visit→admit) | Branch-wise, multi-college analytics |
| 12 Post-admission | — | — (future phase by design) | Attendance/results/fee notifications |

## 8. The To-Be Workflow

```
Lead arrives → AI responds within SECONDS (voice call or WhatsApp)
  → AI qualifies + counsels in the parent's language (switching live)
  → AI sends brochures → AI books the visit → AI updates CRM (all automatic)
  → AI schedules & sends every reminder (visit, documents, follow-up)
  → Human counselor steps in ONLY where judgment is needed (flagged hot/complex leads)
  → Human hosts the campus visit → admission
```

## 9. Expected Business Outcomes (the pitch numbers)

- **Speed-to-lead is the killer stat**: contacting within 5 minutes = **21× more likely to qualify** vs 30 minutes; **100× more likely to connect**; responding within 1 minute lifts conversions up to **391%**; **78% of buyers choose the first responder**; industry average response is 42 hours ([MIT/InsideSales study](https://25649.fs1.hubspotusercontent-na2.net/hub/25649/file-13535879-pdf/docs/mit_study.pdf), [Kixie](https://www.kixie.com/sales-blog/speed-to-lead-response-time-statistics-that-drive-conversions/), [Chili Piper](https://www.chilipiper.com/article/speed-to-lead-statistics)). Our agent answers in seconds, 24/7, in three languages.
- Every call logged, scored, summarized — zero data entry, zero forgotten follow-ups.
- Season scaling without hiring: 200 or 600 calls/day is a config change, not a recruitment drive.
- Consistency: the best counselor's script on every call, never a bad day.

---

# Economics (HONEST run-cost — 2026-07-13, CONFIRMED FreJun Teler rates via email from Yash/Presales, real Sarvam rates, owner's rules: nominal salaries, hybrid = 1 human)

## How cost is actually driven (read this first)
"200 calls/member/day" = **200 DIALS**, not 200 conversations. Unanswered/short dials cost ≈ ₹0 (you pay only for connected minutes). The cost driver is **connected conversation minutes**, which ≈ the human team's *actual talk output* (~180 real-talk-min/member/day; the rest of the shift is dialing, no-answers, data entry). The system makes all the dials AND can hold far more conversations than humans — see "Two operating points" below.

**FreJun's open pricing question is now RESOLVED — unfavorably.** Their email lists Outbound (₹0.15/min) and Media Streaming (₹0.15/min) as separate line items, confirming streaming **DOES stack** on top of the outbound rate. This was the single biggest unresolved variable in the model; it lands at the pessimistic end of the old ₹0.15–0.30 range, not the optimistic end.

**Confirmed FreJun Teler rates (2026-07-13 email):**
| Item | Rate |
|---|---|
| Channel | ₹600/channel/month (10-channel minimum to upgrade) |
| Outbound calling | ₹0.15/min |
| Inbound calling | ₹0.10/min |
| Media streaming (to our own backend) | ₹0.15/min — **stacks on outbound**, confirmed |
| Recording + storage | ₹0.04/min (optional — see lever below) |
| Free tier | 1 channel, ₹100 credit, 1 number (dev/trial only) |

Per-connected-outbound-minute telephony floor = ₹0.15 + ₹0.15 (stream) = **₹0.30/min**, or **₹0.34/min** if we keep call recording.

Per-connected-minute all-in ≈ **₹1.24–1.28** (telephony ₹0.30–0.34 + TTS ~₹0.64 cached + STT ₹0.25 + LLM ₹0.05). One 7-min call ≈ **₹8.7–9.0**.

*(Exotel was also quoted this week — ₹0.60/min outbound, ₹0.20/min inbound, ₹1.89L upfront for an 11-month term, and the quote never confirms real-time streaming to a custom backend. Ruled out: ~4x FreJun's rate and doesn't clearly support the core capability the whole architecture needs. FreJun Teler remains the vendor.)*

## Monthly run-cost at "match human output" (~180 talk-min/member/day × 26), WITH call recording

| | 5-member | MVP 15-member | Final 30-member |
|---|---|---|---|
| Connected talk-min/mo | ~23,400 | ~70,200 | ~1,40,400 |
| Variable (₹1.28/min) | ~₹30,000 | ~₹89,900 | ~₹1,79,700 |
| Fixed: FreJun channels (₹600×[10/20/40]) + AWS Lightsail Mumbai host (₹0.8k/1.4k/6k) + WhatsApp | ~₹8,300 | ~₹16,400 | ~₹32,000 |
| **TOTAL run-cost** | **~₹38,300** | **~₹1,06,300** | **~₹2,11,700** |
| **½-salary ceiling** | ₹37,500 | ₹1,12,500 | ₹2,25,000 |
| **Verdict** | ❌ **BREACHES ceiling** (+₹800, ~2%) | ✅ ~5.5% margin (was ~10%) | ✅ ~5.9% margin (was ~11%) |

## Same table WITHOUT call recording (₹1.24/min variable — drop the ₹0.04/min recording line)

| | 5-member | MVP 15-member | Final 30-member |
|---|---|---|---|
| Variable (₹1.24/min) | ~₹29,000 | ~₹87,000 | ~₹1,74,100 |
| **TOTAL run-cost** | **~₹37,300** | **~₹1,03,400** | **~₹2,06,100** |
| **Verdict** | ⚠️ razor-thin under (~₹200 / 0.5% headroom) | ✅ ~8.1% margin | ✅ ~8.4% margin |

**Honest note — this is a real downgrade from the last estimate, not a rounding change.** Confirming that streaming stacks (₹0.30/min, not the hoped-for ₹0.15/min) pushed every tier's variable cost up ~7%. The **5-member tier now fails the ceiling outright if we record calls**, and only survives razor-thin if we don't. MVP and Final tiers are still comfortably under, but margin roughly halved (10%→5.5%, 11%→5.9%).

**Levers to fix the 5-member tier (pick one before quoting a 5-member deal):**
1. **Drop call recording for the 5-member tier** — cheapest fix, gets to razor-thin-pass (~₹200 headroom). Recording stays on for MVP/Final where margin absorbs it.
2. **Push back on FreJun's 10-channel minimum** — it's ₹6,000 fixed cost dominating a low-volume tier; ask if a smaller account gets a lower channel floor.
3. **Sarvam TTS volume discount** — ask Sarvam directly; TTS is the single largest per-minute line (₹0.64 of ₹1.24–1.28).
4. **WhatsApp-first substitution** — shift more of the workflow (reminders, document collection, brochures) off voice minutes entirely; already partly built in `lib/ops.js`/`lib/notify.js`.
Do not quote a 5-member deal without applying at least lever #1.

**AWS Lightsail Mumbai host IS included** in the fixed line (₹800 / ₹1,400 / ₹6,000 by tier). Reliable, fixed-price, Mumbai region, one-click scale — chosen over Hostinger (cheaper but weaker uptime track record for a paying-college production system).

## Two operating points (the choice, not a failure)
1. **Match human output** → the table above (under half for MVP/Final; 5-member needs lever #1 applied).
2. **Unleash** (pursue every lead fully — parallel, tireless, instant response) → *more* connected minutes than humans could ever produce → costs more, but wins **more admissions**. Cost follows minutes: you can have "far more conversations than humans" OR "half their cost," not both at once. This is a lever the college chooses per their goal.

## Pricing is our choice inside the gap
We charge inside the gap between run-cost and the buyer's ₹75k/₹2.25L/₹4.5L spend. e.g. charge ₹1L for the 15-member replacement → college saves ₹1.25L/mo, our margin ~₹0. Set the charge deliberately; run-cost above is the floor, not the price.

**Still pending to make these EXACT [ASK]:** ~~FreJun media-streaming stacking~~ RESOLVED 2026-07-13 (confirmed, stacks). Still open: FreJun channel-minimum flexibility below 10 (ask on Exotel-style call), DLT number, Sarvam volume/student credits, and Resonance's REAL calls/day + connect rate + salaries.

---

# Engineering Plan (the three mandates)

## E1. Latency → 800ms–1.2s voice-to-voice (MVP path)

Current: ~3–4s per turn (batch STT → LLM → batch TTS). The fix is **streaming end-to-end** — Sarvam already ships it: streaming STT **<150ms** time-to-first-token ([docs](https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/speech-to-text/streaming-api)), streaming TTS **<250ms** first-byte ([docs](https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/text-to-speech/streaming-api)). Overlapping the stages cuts 600–900ms alone ([2026 latency techniques](https://futureagi.com/blog/how-to-optimize-voice-agent-latency-2026/)).

Implementation order:
1. **Adopt LiveKit or Pipecat with the official Sarvam plugins** (the decided rebuild — it IS the streaming migration; one build delivers latency + real turn detection + barge-in).
2. Stream STT partials → LLM starts before the parent finishes; LLM tokens → TTS at first sentence boundary; prebuffer the first audio frame.
3. Keep the ONE-hop doctrine (AGENT-SPEC §1.6) — no added hops, ever, on the voice path.
4. Physics note: a literal 0.05s is impossible (network RTT alone exceeds it); 800ms–1.2s is indistinguishable from human turn-taking and is the honest, reachable target.

## E2. Cost per call −50-60% (7-min avg, 15–20-min max) — CORRECTED with real Sarvam pricing

**Verified pricing ([Sarvam pricing page](https://docs.sarvam.ai/api-reference-docs/pricing)):** Sarvam-105B ₹4/1M input, **₹2.5/1M cached input**, ₹16/1M output · STT ₹30/hour (per second) · **TTS Bulbul v3 ₹30 per 10k chars, Bulbul v2 ₹15 per 10k chars.**

**The decisive finding — where a 7-min call's Sarvam money actually goes:**
| Component | Est. per 7-min call | Share |
|---|---|---|
| TTS (Bulbul v3, ~3k chars spoken) | ~₹9.0 | **~80%** |
| STT (~3.5 min caller audio) | ~₹1.75 | ~16% |
| LLM (25 turns × ~3.3k input + outputs) | **~₹0.35** | **~3%** |
| **Sarvam total** | **~₹11** | + telephony ~₹3.5 (Exotel-class) ≈ **₹15/call all-in** |

**So "cut LLM tokens 75%" was aiming at the wrong line — LLM tokens are nearly free. The real levers, in order:**
1. **TTS engine choice — DECIDED (owner audition, 2026-07-05): Bulbul v3 + Simran stays.** v2 is half the price but does not have Simran (closest fallback: a different voice, Anushka) — the owner judged Simran-v3's voice worth double. The dominant cost line stays ₹30/10k chars ≈ ₹9/call; that is the price of the product's soul, paid deliberately.
2. **Prompt caching — CONFIRMED to exist** (₹2.5 vs ₹4 cached input): keep the persona byte-stable within a call (it already is, per language) → ~25-30% off the LLM line. Tiny in ₹ but free to claim. **[VERIFY in usage fields that cache hits register.]**
3. **Rolling conversation summary** (keep last 8–10 turns verbatim + ~120-token running summary of older turns): on 15–20-min calls this is less about cost and more about **quality** — today, context older than the 12-turn window silently vanishes, killing CALLBACK memory on long calls. Guardrail: the summary must preserve the parent's stated worries/preferences, never just facts.
4. Already done (keep): trimmed persona + on-demand facts, 12-turn window, max_tokens 220, reasoning off, brevity contract (15-word turns also cap TTS characters — the persona's brevity rule IS a cost control).
5. **Net effect:** v2-if-it-passes (−40% total) + caching (−1%) + existing discipline ≈ **Sarvam ~₹6.6/call → ~₹34k/month at 5,200 calls** (vs ~₹57k on v3). Both are far below the human comparison either way.

## E3. Audio → ~95% human (honest ceiling stated)

1. **Streaming TTS** is the single biggest perceived-humanness jump — she starts speaking like a person mid-thought; dead air is the #1 robotic tell (E1 delivers this).
2. Per-emotion micro-tuning round 2: A/B the 13 emotion pace/temperature pairs on real **phone** audio (not web), per language.
3. **A/B Bulbul v2 vs v3 on the phone path**: v2 exposes pitch (−1..1) and loudness explicitly; v3 has better base quality but only pace+temperature ([Sarvam TTS](https://www.sarvam.ai/text-to-speech), [LiveKit Sarvam plugin](https://docs.livekit.io/agents/models/tts/plugins/sarvam/)). Winner judged by ear per language, per the AGENT-SPEC audition rule.
4. Text-side prosody (already built, keep tuning): fillers, 15-word turns, firm endings, no digits, transliterated numbers, Tenglish suffixes.
5. **Honest ceiling:** the last few percent are model-bound (SuperBot fine-tunes on 100k hours of real Indian calls). Prompt+parameter tuning realistically reaches ~95%; "indistinguishable always" would require voice-model fine-tuning — a final-product option if Sarvam offers it **[VERIFY]**.

---

# Competitive Position

| Player | What they sell | Pricing signal | Our wedge |
|---|---|---|---|
| [Bolna](https://www.bolna.ai/) | Indic voice-agent platform | ~6¢/min usage | Platform, not product — no admissions depth |
| [Ringg](https://www.ringg.ai/) | Hindi-first outbound agents | ₹9–12/min all-in | Generic lead-qualification flows |
| [SuperBot](https://superbot.one/) | Full-stack contact-center AI (100k-hr trained) | Enterprise | Strongest tech; still horizontal — no ResoNET logic, no admissions workflow |
| MyOperator | IVR + WhatsApp suite | SaaS | Not a conversational counselor |

**Positioning:** they sell *minutes*; we sell *the admissions operation* — a 30-year-veteran counselor persona, scholarship-slab-exact answers, visit-booking closes, and the whole 12-department workflow behind the call. Vertical beats horizontal in a procurement meeting.

---

# MVP vs Final Product (build definition)

**MVP (proves the 15-member replacement, demoed on Resonance):** voice agent (live today) + WhatsApp brochure auto-send + auto CRM (live) + visit booking + follow-up & document reminders + dashboard (live) + lead import + human-handoff alerts + inbound webhook. Runs on the tuned Twilio bridge.

**Final product (the platform, scoped for the 30-member org):** streaming sub-second voice (LiveKit/Pipecat + Sarvam plugins), **inbound AND outbound** at scale, OCR document pipeline + form pre-fill, payment links/reminders, multi-touch follow-up cadences, human-handoff console with context briefs, Postgres multi-college tenancy, onboarding console (new college = new facts file + persona wiring), branch-wise analytics, post-admission parent comms.

**Open values [ASK]:** real Sarvam billing from dashboard; Exotel/Ozonetel per-minute quote; WhatsApp Business API keys & conversation fees; Resonance team structure/quotas/lead volume; Sarvam prefix-caching and fine-tuning availability.
