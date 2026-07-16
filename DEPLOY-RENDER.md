# DEPLOY-RENDER.md — put the demo on a public HTTPS URL (free tier)

One web service, deployed from `render.yaml`. ~15 minutes of your time.
Deploys the showcase + dashboard + call console + enquiry page. No phone calls
(the telephony bridge is a separate, later, Lightsail concern).

---

## 0 · Before anything — rotate the exposed keys (5 min, non-negotiable)
The Sarvam / Groq keys have been pasted into chats during development. A public
URL makes leaked keys a live risk.
- Sarvam → dashboard.sarvam.ai → regenerate API key
- Groq → console.groq.com → regenerate
- Update your local `.env` with the new values (you'll paste the same into Render).

## 1 · Make sure the GitHub repo is PRIVATE
Repo: `github.com/YeshwanthReddy1306/ai-agent`. It contains the personas, the
college fact base, and the strategy docs — check Settings → General → visibility
is **Private**. (History is verified clean of secrets; `.env` was never committed.)

## 2 · Push the latest
```bash
git push origin main
```

## 3 · Create the service from the blueprint
1. render.com → sign in with GitHub
2. **New → Blueprint** → select the `ai-agent` repo
3. Render reads `render.yaml` and prompts for the three secrets:
   - `SARVAM_API_KEY` → the NEW rotated key
   - `GROQ_API_KEY`  → the NEW rotated key
   - `ACCESS_SECRET` → pick a STRONG password (this is the only thing between
     the public internet and your Sarvam credits — not `resonance2026`)
4. **Apply**. First build ≈ 2–3 min.

## 4 · Smoke-test the live URL (`https://admissions-ai.onrender.com` or similar)
| Check | Expect |
|---|---|
| `/enquiry.html` | loads with NO password (public parent form) |
| `/showcase.html` | browser asks for a password → the ACCESS_SECRET |
| Showcase preflight strip | server ✓ voice ✓ — then allow the mic ✓ |
| One real call | Sneha answers; ~0.2s slower than localhost is normal (Singapore) |
| `/dashboard.html` → 12 Departments | live board renders |

## 5 · Keep it awake (free tier sleeps after ~15 min)
- uptimerobot.com (free) → HTTP monitor → `https://<your-url>/enquiry.html`,
  interval 10 min. That keeps the cold-start away during the review window.
- Belt-and-braces: open the URL yourself 5 minutes before the client does.

## 6 · Share with the school
Send: the URL + the ACCESS_SECRET password (separately, ideally) + one line:
"open on Chrome, laptop, allow the microphone when asked."
Per REHEARSAL.md: lead them to the **showcase**; dashboard second; skip Payments.

---

## Known free-tier limits (accepted for the demo)
- **Sleeps when idle** → first cold hit waits ~30–60s (mitigated by step 5)
- **No persistent disk** → `data/` resets on every deploy/restart: call history,
  bookings and imported leads vanish; the repo's demo leads re-seed themselves.
  When the school starts using it for real → Starter plan + disk, or Lightsail.
- **Singapore region** → ~+0.2s per voice turn vs. Mumbai. The pilot's Lightsail
  Mumbai box removes this.

## Redeploying after changes
`git push` → Render auto-deploys (`autoDeploy: true`). Data resets each deploy.
