# FRONTEND-PLAN.md — The Pitch Frontend, Execution-Ready Spec v1.0
*2026-07-13 · Owner-approved direction: "editorial drama" (professional + eye-catching, NOT information-overloaded minimal, NOT dark-neon AI slop). This document is self-contained: any model/session can execute it without prior context. Skills to apply during build: hallmark, ui-ux-pro-max, ponytail.*

---

## 0 · HARD RULES (read first, non-negotiable)

1. **Backend is LOCKED.** No file outside `public/` may be created or edited. If a feature needs data the API doesn't expose, STOP and flag it to the owner — never "just add an endpoint."
2. **Every control is real.** Every button/toggle/link wires to a live endpoint from §3. Zero placeholder buttons. If an interaction can't be backed by a real endpoint, it doesn't ship.
3. **No invented content.** No fake metrics, fake testimonials, fake logos. Unmeasured numbers render as `— to be measured in pilot`. Sample data is always visibly chipped `SAMPLE`.
4. **No emoji as icons** (inline SVG only, one consistent 24×24 set). **No fake browser/phone chrome.** **No italic headers.** All colors/fonts via `tokens.css` variables — no inline hex.
5. **Persona/language/backend behavior is untouchable.** The frontend renders what the backend says; it never alters prompts, languages, or call logic.
6. **Auth:** all `/api/*` calls (except `/api/enquiry`) sit behind `ACCESS_SECRET` — served pages authenticate via HTTP Basic (browser caches after first prompt). Frontend fetches need no extra handling once the page loaded authenticated. `enquiry.html` + `POST /api/enquiry` are public.
7. **Owner review gates:** each phase (§7) ends with the owner viewing it in the browser preview and approving before the next phase starts. Phase −1 (the comp) requires approval before ANY project file is touched.

---

## 1 · DESIGN DNA (Hallmark declarations)

- **Genre:** editorial ("trust school") turned up to **editorial drama** — huge type, one bold accent, alternating light/dark full-bleed scenes, choreographed motion peaks, calm valleys.
- **Macrostructure (showcase):** chaptered narrative (genuinely ordinal Acts 01–04) with a **Bento Grid** wall in Act 01. Nav: slim left act-progress rail (mono numerals 01–04). Footer: single line.
- **Type (2+1, ALL SELF-HOSTED woff2 in `public/fonts/` — pre-mortem #5):**
  - Display: **Fraunces** (600/700, `opsz` auto) — headlines, act titles, wordmark
  - UI/body: **Inter** (400/500/600) — everything interactive and paragraph
  - Data: **IBM Plex Mono** (400/500) — numbers, timers, timestamps, transcripts, badges
- **Palette (OKLCH tokens — final values may be tuned ±5% in the comp phase, structure is fixed):**
  ```css
  :root {
    --paper:      oklch(97.5% 0.008 85);   /* warm cream */
    --paper-2:    oklch(94.5% 0.010 85);   /* raised cards */
    --ink:        oklch(22% 0.015 260);    /* near-black text */
    --ink-soft:   oklch(45% 0.012 260);    /* secondary text */
    --accent:     oklch(46% 0.095 155);    /* deep education green — THE accent */
    --accent-ink: oklch(97% 0.02 155);     /* text on accent */
    --stage:      oklch(18% 0.02 260);     /* Act-02 dark stage bg */
    --stage-ink:  oklch(93% 0.01 85);      /* text on stage */
    --hot:  oklch(55% 0.19 25);  --warm: oklch(70% 0.15 75);  --cold: oklch(55% 0.10 250);
    --ok:   oklch(60% 0.13 155); --sample: oklch(75% 0.14 85); /* SAMPLE chip amber */
    --line: oklch(88% 0.01 85);
    /* type scale */ --t-hero: clamp(3rem, 8vw, 7rem); --t-act: clamp(2rem, 4.5vw, 3.5rem);
    --t-body: 1.125rem; /* 18px floor — projector rule, pre-mortem #2 */
    /* space (4pt) */ --s1:4px; --s2:8px; --s3:16px; --s4:24px; --s5:40px; --s6:64px; --s7:104px;
    /* motion */ --ease-out: cubic-bezier(.22,.61,.36,1); --dur-1:180ms; --dur-2:400ms;
  }
  ```
- **Motion — exactly 4 primitives, all `transform`/`opacity`, all inside `@media (prefers-reduced-motion: no-preference)`:**
  1. Stat **count-up** (mono numbers, 600ms, once per view)
  2. **Ripple cascade** (rows fade+rise in, 400ms apart, connector line grows)
  3. **Orb states** (existing idle/listen/speak restyled to tokens)
  4. **Act-entry reveal** (fade + 12px rise as an act enters viewport, 400ms, once)
- **Wordmark:** text-only Fraunces 700 wordmark token `--brand-name` (placeholder `"[NAME]"` — owner shortlist: Pravesh / Sarathi; swapping is a one-line change). Client line beneath: "built for Resonance Hyderabad."
- **Responsive matrix (every phase verified at ALL of these):** 320 / 375 / 768 / **1366×768 (projector — pre-mortem #2/#9)** / 1440. No horizontal scroll (`overflow-x: clip`), grid tracks `minmax(0,1fr)`, one-line clickable text everywhere.
- **A11y floor:** 4.5:1 text contrast on paper AND stage, `:focus-visible` ring ≥3:1 (never animated), keyboard: acts 1–4 keys, Esc closes slide-over, tab order = visual order, all icon-buttons `aria-label`ed.

---

## 2 · FILE PLAN (everything that will be created/changed — nothing else)

```
public/
├─ fonts/                      NEW  self-hosted woff2 (Fraunces, Inter, IBM Plex Mono)
├─ tokens.css                  NEW  §1 tokens — single source of truth
├─ ui.css                      NEW  shared components (buttons, chips, cards, slide-over, badges)
├─ showcase.html               NEW  the pitch page (Acts 01–04 + preflight + rail)
├─ showcase.js                 NEW  all showcase logic (wall, stage, ripple, case, demo-mode, replay)
├─ index.html                  EDIT restyle + transcript language badges + emotion chip
├─ app.js                      EDIT additive only: render badges/chip from existing call responses
├─ styles.css                  EDIT rebase console styles onto tokens (keep layout/orb)
├─ admin.html                  EDIT restyle onto tokens (all features unchanged)
├─ enquiry.html                EDIT restyle onto tokens (public, warmest register)
└─ demo/
   ├─ sample-leads.csv         NEW  seed data for Demo Mode (clearly synthetic names)
   └─ recorded-call.json       NEW  captured real web-call transcript+events for Replay Mode
```

---

## 3 · API CONTRACT MAP (verified live 2026-07-13 — the frontend's complete vocabulary)

| Endpoint | Method | Used by | Notes |
|---|---|---|---|
| `/api/health` | GET | Preflight screen, masthead health dot | includes per-service Sarvam health |
| `/api/leads` | GET | Wall tile 1, stage lead selector, console queue | |
| `/api/leads/import` | POST (CSV text) | **Demo Mode seeding** + admin import | returns `{added, rejected}` |
| `/api/enquiry` | POST (public) | enquiry.html submit; **live capture demo** in pitch | queues instant callback task |
| `/api/calls` | GET | Recent-calls lists, wall metrics | |
| `/api/crm` | GET | Admin table, wall tiles, Act 04 | `{stats, leads}` — leads carry `sentiment`, `extracted`, `appointment` |
| `/api/funnel` | GET | Act 04 funnel, wall hero number | enquiries→contacted→conversations→hot/warm→visits→admitted |
| `/api/followups` | GET | Ripple events (brochure/follow-up/callback), Follow-up drill panel | task `type` field drives ripple row mapping |
| `/api/documents` / `/api/documents/mark` | GET / POST | Documents drill panel + admin checklist | |
| `/api/payments/plan` / `/api/payments/paid` | POST | Payments drill panel actions (admin-grade) | gateway link is a real placeholder — label honestly |
| `/api/roster` / `/api/roster/import` | GET / POST | Dept-12 drill panel + admin | |
| `/api/notify` | POST | Dept-12 broadcast (live in-room demo to a test number) | |
| `/api/besttime` | GET | Act 04 chart, follow-up badges | `hours[].connectRate` + Wilson `score` |
| `/api/bookings` | GET | Ripple booking row, Visits drill panel | each booking carries ready `.ics` string |
| `/api/acks` | GET | Stage: ack clips (existing console flow) | |
| `/api/call/start` | POST `{leadId}` | Stage `Call` button | returns `{callId, reply, audios[]}` |
| `/api/call/turn` | POST `{callId, audio}` | Stage mic loop (reuse console recorder flow) | returns reply text/lang/emotion + audios |
| `/api/call/end` | POST `{callId}` | Stage `End` + auto on hangup | **returns the summary** → ripple trigger |

**Ripple event → data source map (pre-mortem #4 resolved by design):**

| Cascade row | Source |
|---|---|
| Summary written · Interest scored | `POST /api/call/end` response (direct) |
| CRM updated — zero typing | `GET /api/crm` re-fetch, diff the lead's `lastCallAt` |
| Brochure queued on WhatsApp | `GET /api/followups` — task type brochure/send_info |
| Visit booked + .ics chip | `GET /api/bookings` (if `appointment.booked`) |
| Follow-up / callback scheduled @ best hour | `GET /api/followups` — `follow_up_call` / `callback_requested` + `dueAt` |
| Counselor alerted | **KNOWN GAP:** `alertTeam` fires SMS but isn't queryable. Ripple row renders ONLY when inferable (lead became `hot`/visit booked per CRM response); labeled "counselor alert sent (SMS)". Do NOT fake a timestamp. Flagged for owner → Antigravity if a real event feed is wanted later. |

---

## 4 · SHOWCASE PAGE — act by act, control by control

### 4.0 Preflight strip (pre-mortem #1) — top of page, collapsed by default
- Auto-runs on load: `GET /api/health` (server+Sarvam), mic permission probe (`getUserMedia` then release), fonts loaded check.
- Renders 3 mono status chips: `SERVER ✓ · VOICE ✓ · MIC ✓` (green) — any failure expands the strip with the fix instruction ("allow microphone in the address bar").
- **`Run checks` button** — ghost, re-runs all probes. This strip is the presenter's 10-second confidence check before the room fills.

### 4.1 Act 01 — "The Admissions Office" (bento wall)
**Scene:** warm paper. Fraunces headline `Your entire admissions office. One system.` (hero scale). Below: the **one trusted number** — connected conversations this month (`/api/funnel` conversations) at mono ~9rem with count-up. Then the bento:

**Bento layout (grid-template-areas, 12 depts, unequal spans):**
- **Hero tile (2×2):** Conversations — big number + 7-day sparkline drawn as CSS bars from `/api/calls`
- **3 medium tiles (2×1):** First Contact (calls today) · Campus Visits (`/api/bookings` count) · WhatsApp Ops (`/api/followups` sent count)
- **8 compact tiles (1×1):** Lead Capture · Counselling · Brochures · Documents · Data Entry · Follow-up · Payments · Post-admission
- Every tile: dept name (Inter 600) · live metric (mono) · 3-word Sneha line · hairline top rule → accent when count > 0. Numbers carrying seeded data show the amber `SAMPLE` chip.

| Control | Visual | Behavior (real wiring) |
|---|---|---|
| Any dept tile | hairline card; hover: hairline→ink, `cursor-pointer`; focus ring | Opens **slide-over** (right, 420px, Esc/backdrop closes) rendering that dept's live artifact: Brochures → WhatsApp-style thread from `/api/followups` messages (labeled "queued — sends live when WhatsApp keys active"); Documents → real checklist from `/api/documents?leadId=` with `Mark received` buttons → `POST /api/documents/mark`; Follow-up → queue rows + best-hour badges from `/api/besttime`; Payments → plan card + `Mark installment paid` → `POST /api/payments/paid`; Post-admission → roster count + broadcast composer → `POST /api/notify`; Lead Capture → embedded live `enquiry` form → `POST /api/enquiry` (submit in the room, watch it appear in the queue tile — Act 01's own live moment). |
| **`Begin the demonstration`** (the page's single primary CTA) | accent pill, Fraunces label, 8 states | Smooth-scroll to Act 02 + pre-select first demo lead |
| **`Sample data`** toggle (top-right, quiet) | switch + amber chip legend | ON: `POST /api/leads/import` with `demo/sample-leads.csv` (synthetic names like "Demo: Ramesh K"), then re-fetch all wall data; every affected figure gets `SAMPLE` chip (detected by the `Demo:` name prefix). OFF: hides seeded rows client-side (leads store has no delete API — seeded leads are filtered by prefix; document this honestly in the toggle tooltip). |

### 4.2 Act 02 — "The Call" (full-bleed dark stage)
**Scene transition:** paper → `--stage` full-bleed. The orb centered, glowing (existing animation, token colors). Right column: live transcript.

| Control | Visual | Behavior |
|---|---|---|
| Lead chips (3 demo leads) | quiet chips: name + `TE/HI/EN` tag, selected = accent ring | `GET /api/leads`, click selects; header updates |
| **`Call Sneha`** | accent pill; on start morphs in-place to `End call` (red-ink, same width — zero layout shift) + mono timer | `POST /api/call/start` → play `audios[]`; then the existing console mic loop → `POST /api/call/turn` per turn; `End` → `POST /api/call/end` |
| **Orb (tap)** | states: idle/listening/speaking; beneath it the **emotion chip** (mono lowercase: `warm · serious · empathetic…` from each turn's parsed emotion) | Tap while Sneha speaks = barge-in (existing behavior, kept) |
| **Transcript pane** | mono 15px, auto-scroll, parent turns ink-soft / Sneha turns ink; **language-switch badge** inline (`— switched to Telugu —`) whenever `reply.lang` changes | rendered from the same turn responses; hover a turn = timestamp |
| **`Replay recorded call`** (ghost, small, under stage — pre-mortem #1 fallback) | ghost button, labeled honestly | Streams `demo/recorded-call.json` (a REAL captured call: turns, langs, emotions, audio refs) through the same transcript/orb renderer at real-time pace. If venue network/Sarvam dies, Acts 02→03 still land. Recording it = run one good web call while `showcase.js` captures the turn stream (dev-time task in Phase 4). |

### 4.3 Act 03 — "The Ripple" (the close)
**Scene:** back to paper. Header: `The call ended. Nobody typed anything.` Cascade fires automatically ~1.5s after `POST /api/call/end` resolves (or after replay ends):

- Each row (400ms apart): mono timestamp · event line · inline artifact card (real summary text · interest badge with `hot/warm/cold` color · WhatsApp message body · booking card with **`.ics` chip** (click = data-URI download, exists in `/api/bookings` response) · follow-up row with best-hour badge).
- Connector line grows top→down between rows (transform scaleY).
- Data sources per row: see §3 map. Rows with no data for THIS call simply don't render — the cascade never lies.

| Control | Visual | Behavior |
|---|---|---|
| **`Replay ripple`** | ghost, appears after cascade completes | Re-runs animation from the same fetched data |
| Artifact cards | hairline, hover→ink | Click → same slide-over component as Act 01 (built once) |

### 4.4 Act 04 — "The Case" (boardroom)
**Scene:** calm paper, print-optimized. Funnel bars (`/api/funnel`, CSS bars, mono labels) · best-hour chart (`/api/besttime`, existing bar logic redrawn with tokens) · the **cost table**.

| Control | Visual | Behavior |
|---|---|---|
| Tier tabs `5 · 15 · 30 member` | quiet tabs, selected = accent underline | Swaps cost table + ceiling row (static VERIFIED numbers from ADMISSIONS-OPS-WORKFLOW.md; each line badged mono **`measured`** (green) or **`modeled`** (amber) — the restraint IS the pitch) |
| **`Print one-pager`** | ghost | `window.print()` + `@media print` stylesheet: Act 04 only, A4, ink-on-white |

### 4.5 Act rail (fixed left, desktop; dot-row top, mobile)
Mono `01 02 03 04`, current = ink solid + accent tick; click = smooth scroll; keys `1–4`; `IntersectionObserver` drives current-act state and act-entry reveals.

---

## 5 · WORKING SURFACES (deltas only — features 100% preserved)

- **`index.html` console:** token restyle; emoji brand → wordmark; transcript **language badges** + **emotion chip** (same two components as Act 02 — additive lines in `app.js` reading fields the API already returns). Everything else untouched.
- **`admin.html`:** token restyle; sticky table header + row hover; Mood/interest/status colors recalibrated for paper; all existing buttons (CSV import, roster import, broadcast, docs, payments, `.ics`) keep exact behavior, gain 8-state styling + `:focus-visible`. **This restyle is pulled EARLY into Phase 1** (pre-mortem #8 — visual continuity if management asks "show me the CRM").
- **`enquiry.html`:** warmest register — Fraunces heading, single column, 18px+ inputs, inline field validation, submit button with loading/success/error states → `POST /api/enquiry`.

---

## 6 · DEMO MODE & DATA HONESTY (spec)

- Seed file `demo/sample-leads.csv`: 24 synthetic leads, names prefixed `Demo:` (the chip detector + filter key), realistic areas/streams/languages, mixed interest levels.
- Seeding uses ONLY `POST /api/leads/import` (existing endpoint — zero backend change). CRM/call history CANNOT be faked via API — and must not be: wall metrics that come from real calls (conversations, bookings) show real counts; the owner runs **20–30 real web calls the week before the pitch** (pre-mortem #3 — calendar task, not code).
- Every rendered number derived from a `Demo:` lead carries the amber `SAMPLE` chip. No chip = real. This rule is absolute.

---

## 7 · BUILD PHASES (each ends with owner approval in browser preview)

| Phase | Scope | Acceptance gate (all must pass) |
|---|---|---|
| **−1 · Comp** | Act 01 bento + Act 02 stage as a static comp from **scratchpad only** (zero project files) | Owner says "that's the register" (iterate here until yes) |
| **0 · Foundation** | `fonts/` (self-hosted) + `tokens.css` + `ui.css` + wordmark | Fonts load offline (network tab: zero external requests); tokens render; owner approves |
| **1 · Early admin swap** | `admin.html` token restyle (colors/fonts only) | All admin features work identically; screenshot diff reviewed |
| **2 · Showcase shell** | `showcase.html` skeleton: acts, rail, preflight strip, reveals | Responsive at 320/375/768/**1366×768**/1440; keyboard nav; reduced-motion |
| **3 · Act 01 live** | Bento wall + slide-over + demo toggle, all wired | Every tile shows live API data; toggle seeds/filters; SAMPLE chips correct |
| **4 · Act 02+03 live** | Stage (real call) + ripple + **record one real call** → `recorded-call.json` + replay mode | Live web call works in preview; call end fires cascade with real artifacts; replay runs offline |
| **5 · Act 04 + print** | Funnel/chart/cost table + print stylesheet | Tier tabs swap; print preview = one clean A4; measured/modeled badges correct |
| **6 · Console + enquiry polish** | index.html badges/chip + enquiry restyle | Console: language badge appears on a live mixed-language call; enquiry submits end-to-end |
| **7 · Hardening** | Hallmark 58-gate slop test, contrast audit (paper AND stage), full keyboard pass, `prefers-reduced-motion`, 1366×768 final sweep | All gates pass; stamped scores in CSS header; `npm run preflight` still green (proves backend untouched) |
| **8 · Rehearsal support** | REHEARSAL.md: presenter checklist (hotspot fallback, mic check, actual-laptop run-through ×2, zoom level, replay-mode key) | Owner completes one full timed run-through |

**Pitch-critical path = Phases −1→5.** Phase 6 can slip past the pitch date without harming it.

---

## 8 · PRE-MORTEM FIXES — where each landed

| # | Risk | Fix location |
|---|---|---|
| 1 | Live call fails in the room | §4.0 preflight strip · §4.2 replay mode · §7 Phase 8 hotspot/rehearsal checklist |
| 2 | Underwhelms on projector | §1 editorial-drama register, 18px body floor, 1366×768 in every phase gate |
| 3 | Wall looks empty/fake | §6 demo mode + SAMPLE chips + owner's 20–30 real pre-pitch calls |
| 4 | Ripple holes | §3 event→source map done NOW; counselor-alert gap identified and honestly handled |
| 5 | Fonts CDN fails at venue | §2 self-hosted woff2, Phase 0 gate = zero external requests |
| 6 | Owner hates it when built | Phase −1 comp gate before any project file changes |
| 7 | Timeline creep | §7 critical path marked; Phase 6 deferrable |
| 8 | Old admin clashes mid-pitch | Phase 1 early token swap |
| 9 | Demo laptop differs | Phase 8 checklist: rehearse on the actual machine/browser/zoom |

---

## 9 · OPEN ITEMS (owner decisions, none block Phase −1)

1. **Product name** — wordmark placeholder `[NAME]`; shortlist Pravesh / Sarathi / owner's own. One-line swap in `tokens.css`.
2. **Counselor-alert ripple row** — if a real queryable event is wanted (vs the inferred row), that's a small Antigravity ask (log alerts to a queryable store). Cosmetic; ripple works without it.
3. **Pitch date** — sets the calendar for the 20–30 real calls and rehearsals.
