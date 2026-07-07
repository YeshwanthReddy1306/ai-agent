# Audit + Premortem — 5-member & MVP (15-member) tiers
*2026-07-07 · State verified this session: preflight GREEN (2 human-action warnings), endpoints tested live, personas SHA-locked, 2 npm deps. Both tiers run the SAME software — the difference is call volume, telephony channels, and price. Findings apply to both unless tagged.*

---

# PART 1 — COMPREHENSIVE AUDIT (what has actually been built)

## 1A. Department-by-department (all 12), verified

| # | Dept | Built? | Evidence (tested this session) | Gap / placeholder |
|---|---|---|---|---|
| 1 | Lead capture | ✅ | Public `/api/enquiry` created a lead + queued instant callback; CSV import deduped a row live | Website widget/social-DM/ad auto-import = final product |
| 2 | First contact (voice) | ✅ | Outbound proven on real Twilio call; inbound webhook wired (`/incoming`, `setup-inbound.js`); 3-lang mirroring | 8 kHz phone quality ceiling → LiveKit rebuild |
| 3 | Counselling | ✅ | Locked veteran persona (SHA-verified); M5 handoff alert triggers on hot/booked/angry/unknown-inbound (tested all 5) | `COUNSELOR_PHONE` placeholder |
| 4 | Brochures | ✅ | `ops.brochureLinksFor` returns correct link by interest; auto-queued on warm/hot call | WhatsApp keys (SMS fallback live) |
| 5 | Visit coordination | ✅ | Booking captured in summary → CRM + reminder scheduled | — |
| 6 | Documents | ✅ | Checklist + mark-received tested; reminder queued on booked/hot | By design: humans verify, no OCR |
| 7 | Data entry | ✅ | Every call → structured summary → CRM, zero typing | — |
| 8 | Follow-up | ✅ | Scheduler: reminders, missed-call retry (engaged→msg / cold→voice), payment nudges | — |
| 9 | Payments | ✅ framework | Plan + installments set live; pre-due reminders scheduled | `PAYMENT_LINK_BASE` placeholder → college gateway at contract |
| 10 | CRM | ✅ | Atomic file store, auto-updated; `crm.get` powers M1 memory | Postgres at multi-college scale |
| 11 | Reporting | ✅ | `/api/funnel` returned correct 6-stage counts; admin cards | Branch/multi-college analytics = final |
| 12 | Post-admission | ✅ | Roster import + section-filtered broadcast (matched exactly 1) + all-broadcast (matched 2); per-language templates | College data-feed/ERP webhook at contract |

## 1B. Cross-cutting capabilities (the "soul" goals)

- **G3 cross-call memory (M1):** ✅ verified — returning-family prompt block + memory-aware greetings; never re-asks known facts. Locked personas untouched (memory rides as an appended block).
- **G4 anti-hallucination:** ✅ intact — curated `college.json` facts + sanitizer + on-demand injection + deterministic number-speaking + 16-Q golden suite (recalibrated to real Resonance facts) + edge-case capture loop.
- **G5 cost:** ✅ levers built — universal TTS line-cache (web+phone), 30b off-voice-path summaries, WhatsApp-first substitution, keep-alive sockets, cached greeting.
- **Latency free wins:** ✅ keep-alive + greeting cache live; streaming rebuild deferred to LiveKit (correctly).
- **Compliance:** ✅ DNC list (3-lang detection + pre-dial block); `/dial` shared-secret; ⚠️ 160-series/DLT registration still required before real outbound volume.

## 1C. Architecture health

- **2 dependencies** (`ws`, `undici`) — RCOS scaffold fully removed. Clean.
- **One synchronous LLM hop** per turn (AGENT-SPEC §1.6) — held.
- **Shared core** (`lib/*`) used by web + phone — no drift (the old bug class).
- **13 lib modules**, each single-purpose; file-backed stores with atomic writes.
- **Preflight GREEN**; personas SHA-locked; golden suite recalibrated.

## 1D. What is NOT built (honest)

1. **True streaming voice** (sub-second) — post-contract LiveKit rebuild.
2. **Real channels for placeholders** — WhatsApp API, counselor phone, payment gateway (all wired, dormant).
3. **OCR** — deliberately cut (humans verify docs).
4. **Rolling mid-call token compression (M8)** — deferred to protect the latency rule; **end-of-call summary is LIVE and unaffected.**
5. **Multi-college tenancy, Postgres, capture bots, ERP feed** — final product.
6. **Real deployment** — runs on this laptop + quick-tunnels (ephemeral). No permanent host yet.

## 1E. Tier differences (identical code, different dials)

| | 5-member | MVP / 15-member |
|---|---|---|
| Peak concurrent calls | ~8 channels | ~20 channels |
| Talk volume/mo | ~27k min | ~105k min |
| Run-cost est. | ~₹16–21k | ~₹60–76k |
| Half-price ceiling | ₹37,500 | ₹1,12,500 |
| Verdict | ✅ ~50% under | ✅ ~40% under |
| Server sizing | small box | small–medium box |
| Everything else | **identical software** | **identical software** |

---

# PART 2 — PREMORTEM ("It's pilot launch day. It failed. Why?") — both tiers

Ranked by (likelihood × damage). ✅ mitigated · ⚠️ owner-action · 🛠 build-fix identified.

### CRITICAL
1. **8 kHz phone STT mishears → agent gives an off reply on a live parent call.** Likelihood high on noisy lines; damage high (looks broken). 🛠 The real fix is the streaming/turn-detection LiveKit rebuild; ⚠️ meanwhile demo the *web* call for the cleanest impression and set expectations on phone. Current bridge mitigations (1300 ms endpoint, anchor-off auto-detect, hysteresis) reduce but don't eliminate it.
2. **No 160-series/DLT registration → TRAI blocks the number / 20-call-day cap.** Likelihood certain at volume without it; damage fatal (number dies mid-season). ⚠️ Register a transactional number via the chosen provider BEFORE real outbound volume. Gate item.
3. **Brand not authorized.** `brandAuthorized:false`. Calling parents "from Resonance" without written OK = trademark + TRAI exposure. ⚠️ Written sign-off or demo under a neutral name.

### HIGH
4. **Ephemeral tunnel dies mid-pitch.** Quick-tunnels change URL on sleep/restart; inbound webhook then points nowhere. 🛠 Use a reserved ngrok/stable URL for the pitch; re-run `setup-inbound.js` after any restart; permanent fix = Indian server. ⚠️
5. **All estimates are estimates until vendors reply.** The ₹60–76k / ₹16–21k could shift if FreJun's unlimited excludes API traffic. ⚠️ Send the VENDOR-OUTREACH emails/calls — the #1 unblock.
6. **File-based stores under real concurrent load.** crm/ops/followups are atomic-write JSON — fine for one pilot college; two calls ending in the same millisecond could still race a read-modify-write. 🛠 Postgres at multi-college (final product); acceptable for 5/15 pilot.
7. **WhatsApp keys absent → brochures/reminders go by SMS.** Works, but SMS is costlier and lower open-rate than the WhatsApp story we pitch. ⚠️ Owner provides Business API keys; everything flips automatically.

### MEDIUM
8. **Sarvam free-tier credit exhaustion mid-pilot.** ₹100 free credits won't cover a real pilot. ⚠️ Upgrade to paid + ask for startup credits before the pilot day.
9. **Counselor alert phone blank → hot leads land only in the queue, not real-time.** ⚠️ Set `COUNSELOR_PHONE`.
10. **Data on a OneDrive-synced laptop** — sync churn / accidental exposure; also single point of failure. 🛠 Move to a proper host before pilot; ⚠️ rotate the keys pasted in chat earlier.
11. **Persona edit without relock → preflight red / silent regression.** ✅ mitigated by the lock+preflight gate, but discipline-dependent.

### LOW
12. Roster/lead CSV assumes simple fields (no commas-in-field). 🛠 note in the UI (done). 
13. Doc/UI is functional-not-beautiful — fine for pilot, polish later.
14. Missed-call detection depends on Twilio StatusCallback reaching the tunnel — dies if tunnel down (same root as #4).

## The launch gate (must be true before a real Resonance pilot)
1. ⚠️ Vendor quotes back (telephony + Sarvam) → pricing is fact.
2. ⚠️ 160-series/DLT number registered.
3. ⚠️ Brand authorization (or neutral name).
4. ⚠️ WhatsApp keys + counselor phone + payment gateway set.
5. ⚠️ Stable host + URL (off the laptop).
6. ⚠️ Sarvam paid plan + credits.
7. ✅ Preflight green (already) · ✅ 3 rehearsal calls/language reviewed · ✅ golden suite pass on real facts.
8. The historical bar: 10 real Telugu parents, ≥8 say "couldn't tell it wasn't human."

## Honest verdict
The **software** for both tiers is built, tested, and clears the half-cost goal on estimate. Nothing blocking is a *code* gap — every remaining CRITICAL/HIGH item is an **owner action** (vendor quotes, compliance registration, keys, a real host) or the **known phone-quality ceiling** that the streaming upgrade is designed to fix. The pilot is gated by paperwork and accounts, not by engineering.

---

# PART 3 — PRODUCTION READINESS (dev-free vs paid-production)

## 3A. Two different environments — don't confuse their costs

| | Dev / pilot (our build & testing) | Production (live at the college) |
|---|---|---|
| Host | **Oracle Always Free** ARM VM, Mumbai (₹0) or this laptop | **Cheap paid Indian VPS with SLA** (~₹800–2,000/mo) — free tiers have NO uptime guarantee and can be reclaimed; a paying college in admission season cannot risk that |
| Tunnel/URL | ephemeral quick-tunnel | **stable domain + fixed number** |
| Cost line | ~₹0 | already inside the quoted infra line (₹2–8k) — **projection does NOT change** |

**Key point:** the free tier saves money *while building*; production runs on a proper (still cheap) host that was already budgeted. The per-minute bulk (FreJun + Sarvam) is **identical** in both — usage is usage.

## 3B. Does the tier cost hold live at the college? Yes — with one dependency

- **Telephony + Sarvam (the bulk):** identical — ₹0.15/min is ₹0.15/min in test or production.
- **Server + channels (fixed):** budgeted with a real paid box.
- **The one variable = real call volume.** Cost scales proportionally with minutes talked. So the tier cost holds **only if we size the tier to Resonance's actual volume** → this is why "real lead/call volume" is a required kickoff number. Price the tier to reality, not assumption.

## 3C. Reliability checklist (make it WORK, not just cost right) — mostly one-time

- [ ] Reliable paid host (SLA) + **auto-restart on crash** (systemd/pm2) + **uptime alert** to the owner.
- [ ] **Stable phone number + 160-series/DLT registration** (not the ephemeral tunnel).
- [ ] **Graceful degradation** on a Sarvam/FreJun blip — already have retry-once + TTS→text fallback; confirm it holds under a real outage.
- [ ] **Daily data backup** (crm/ops/followups/students JSON) off the box.
- [ ] **Facts freshness** — fees/dates re-verified each season (edge-case loop handles the long tail; preflight warns at 30 days).
- [ ] Secrets in a proper store, keys rotated (the chat-pasted ones).
- [ ] Basic **monitoring dashboard** (calls today, failures, credit balance).

## 3D. The maintenance model (the owner's real question)

**Set up ONCE, then a few hours/month.** This is accurate for the run-cost and for a hardened single-college deployment, IF the one-time hardening (3C) is done first. Honest breakdown:

- **One-time:** deploy to the paid host, register the DLT number, wire real keys (WhatsApp/counselor/gateway), 3 rehearsal calls/language, load real leads. Days, not weeks.
- **Monthly (a few hours):** top up Sarvam/telephony credits, glance at the monitoring dashboard, answer any new edge-case questions into `college.json`, refresh facts if fees/dates changed that month. That's it — the system runs itself between touches (auto-restart, auto-CRM, auto-follow-ups, auto-reminders).
- **What would break the "few hours/month" promise:** (a) skipping the reliability hardening in 3C (then you firefight outages), (b) scaling to *many* colleges without a support person (per-college minutes are cheap, but 20 colleges' worth of monitoring/edge-cases exceeds a few hours — that's when the final product needs an ops hire), (c) a season fees/data change nobody loads (the agent then defers correctly, but conversions suffer).

**Verdict:** for the 5-member and MVP (single college), "set up once + a few hours/month" is a **realistic promise** — *conditional on doing the one-time production hardening in 3C.* The cash cost holds; the monthly *time* is genuinely small because the system is built to self-run (auto-restart, atomic stores, scheduler, hot-reload). It is NOT a promise that survives silently skipping the hardening or scaling to a fleet without ops support.
