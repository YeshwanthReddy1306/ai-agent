# COWORK-DEPLOY-PLAN.md — execute the Render deployment end-to-end

*Plan for a Claude Cowork session. Self-contained: no prior chat context needed.
The repo already contains a verified `render.yaml` (blueprint) and `DEPLOY-RENDER.md`
(human guide). This plan is the executable version with checks and stop-points.*

---

## Context (read once)

- **Project:** AI voice-agent admissions platform ("Sneha") — Node app, `server.js`, port from `process.env.PORT`.
- **Repo:** `github.com/YeshwanthReddy1306/ai-agent`, branch `main`. Everything needed is already committed, including `render.yaml`.
- **Goal:** a public HTTPS URL on Render's **free** plan that the owner can send to a school's management.
- **What the deploy serves:** `/showcase.html` (the pitch — password-gated), `/dashboard.html` (ops — gated), `/index.html` (call console — gated), `/enquiry.html` (public parent form). Gate = HTTP Basic auth, activated by the `ACCESS_SECRET` env var.
- **NOT in scope:** the telephony bridge (`telephony/bridge.js`), FreJun/Twilio phone calls, WhatsApp keys, payment gateway. Web-only demo.

## Hard rules for this session

1. **Never write an API key into any file, log, message, or commit.** Keys are pasted by the owner directly into dashboard fields, or by you only into the Render "Environment" secret fields — nowhere else.
2. **Do not edit application code.** If something looks broken, STOP and report; the app is in a verified-working state.
3. **Stop and ask the owner** at every point marked **[OWNER]** — those need their accounts or their decisions.
4. If a step fails twice, stop and report the exact error rather than improvising around it.

---

## Phase A — pre-flight

1. **[OWNER] Rotate the two secrets** (they were exposed in dev chats; a public URL makes that a live risk):
   - Sarvam: dashboard.sarvam.ai → API keys → regenerate
   - Groq: console.groq.com → API keys → regenerate
   - Owner keeps both new values ready to paste in Phase B. Also have them pick a **strong `ACCESS_SECRET`** (a passphrase, NOT `resonance2026`, which is burned in dev history).
2. **Verify the GitHub repo is Private:** github.com/YeshwanthReddy1306/ai-agent → Settings → General → Danger Zone shows "Change visibility" with current = Private. If Public → **[OWNER]** switch to Private before anything else (the repo holds persona IP and strategy docs).
3. Confirm `main` is pushed and current (`git log origin/main -1` matches local, or check the latest commit hash on GitHub matches what the owner reports).

## Phase B — create the Render service

4. **[OWNER]** Log into render.com (sign in with GitHub; authorize access to the `ai-agent` repo if prompted).
5. Dashboard → **New → Blueprint** → select repo `YeshwanthReddy1306/ai-agent`, branch `main`.
6. Render parses `render.yaml` and shows one web service: **admissions-ai** (runtime Node, plan free, region Singapore). If it asks for a "Blueprint name", use `admissions-ai`.
7. It will prompt for the three `sync: false` secrets. **[OWNER] pastes each** (or owner reads them out and you type ONLY into these secret fields):
   - `SARVAM_API_KEY` = the NEW rotated Sarvam key
   - `GROQ_API_KEY` = the NEW rotated Groq key
   - `ACCESS_SECRET` = the new strong passphrase
8. Click **Apply / Deploy**. First build takes ~2–4 min. Watch the deploy log; success = "Your service is live". Note the URL (e.g. `https://admissions-ai.onrender.com` — Render may add a suffix).

**If the deploy fails:** open the log. Expected working config: build `npm install`, start `node server.js`, health check `/enquiry.html`. A 401 on health check means the service was created from a stale blueprint — verify the health check path in service Settings is `/enquiry.html` and fix it there.

## Phase C — smoke test (all on the live URL)

| # | Test | Expected |
|---|---|---|
| 1 | Open `/enquiry.html` | Loads WITHOUT any password. Cream/maroon branded form |
| 2 | Open `/showcase.html` | Browser auth prompt → enter any username + the ACCESS_SECRET as password → page loads |
| 3 | Showcase pre-flight strip | `server ✓ voice ✓`; mic chip red until mic allowed — click "Run checks" after allowing |
| 4 | Act 01 wall | 12 tiles with live numbers (demo leads ship in the repo) |
| 5 | **[OWNER] one real call** in Act 02: pick a family → Call Sneha → allow mic → speak | She answers; ~0.2s slower than localhost is normal (Singapore). Ripple fires after ending |
| 6 | `/dashboard.html` → "12 Departments" in the left rail | Board renders: "8 fully live · 3 on SMS fallback · 1 awaiting a key" |
| 7 | Submit the enquiry form with a test name + the owner's real phone | Success message; the lead appears in Dashboard → Leads |
| 8 | Wrong password on `/showcase.html` (fresh private window) | 401 "Authorization required" — the gate works |

Record every result. If test 5 has no voice: check the service log for `[Turn]` lines and Sarvam errors, then report — do not patch code.

## Phase D — keep-awake (free tier sleeps after ~15 min idle)

9. **[OWNER]** uptimerobot.com → free account → **Add New Monitor**: type HTTP(s), URL = `https://<the-live-url>/enquiry.html`, interval 10 minutes (do NOT monitor a gated URL — it would just log 401s).
10. Confirm the monitor shows "Up".

## Phase E — handoff

11. Compose the message the owner sends the school (owner sends it, not you):
    - Link **directly to `/showcase.html`** (the bare domain lands on the call console — wrong first impression)
    - The password, ideally sent separately
    - One line: *"Open in Chrome on a laptop and allow the microphone when asked."*
12. Final report back to the owner: live URL, all smoke-test results, monitor status, and a reminder of the free-tier limits (sleeps when idle → UptimeRobot mitigates; `data/` resets on each deploy/restart — school-entered data does not survive; upgrade to Starter+disk or move to Lightsail Mumbai when the pilot starts).

## Rollback
Render dashboard → the service → Settings → **Suspend** (stops serving, keeps config) or **Delete**. Nothing else to unwind — DNS, data and keys all live in Render only.

## Success criteria
Live HTTPS URL · all 8 smoke tests pass · monitor up · owner has the handoff message · no secret ever written anywhere except Render's secret fields.
