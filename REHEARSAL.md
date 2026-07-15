# REHEARSAL.md — Pitch-day field manual
*The demo fails on logistics far more often than on the product. This is the checklist that stops that. Read it once; run the 10-minute pre-flight every time.*

---

## 0 · The one rule
**The pitch runs on `showcase.html`, on YOUR laptop, on YOUR phone hotspot.** Not the venue WiFi. Not the console. Not a borrowed machine. Everything below protects that.

---

## 1 · Start the system (do this first, every time)
```bash
cd "…/Anti-Gravity Voice Agent"
node server.js
```
- Runs on **http://localhost:3100**
- Open **http://localhost:3100/showcase.html** in **Chrome** (or Edge)
- It will ask for a password once → enter the **ACCESS_SECRET** from your `.env` (Basic auth; the browser remembers it for the session)
- Leave the server terminal visible — if anything misbehaves, the log tells you why

*(The dashboard is `/dashboard.html`, the CRM is `/admin.html`, the public parent form is `/enquiry.html` — but the PITCH is the showcase.)*

---

## 2 · 24 hours before — fill it with truth, and build your safety net

1. **Run 20–30 real web calls.** The wall's headline numbers (conversations, visits) come from real calls — an empty wall looks like a prototype. Do this the day before so Act 01 and Act 04 have real data. *(The `Sample data` toggle overlays illustrative numbers for scale, all chipped "Sample" — but real beats seeded.)*
2. **🎥 SCREEN-RECORD A FULL RUN.** This is your single most important insurance. Do one clean run of the whole 4-act flow — including a live call with a language switch — and screen-record it (OBS, Xbox Game Bar `Win+G`, or QuickTime). *The in-app "recorded replay" was never built*, so **this video IS your fallback** if the live call fails in the room. Have it open in another tab.
3. **Rehearse on the ACTUAL laptop + browser + zoom level** that goes to the meeting. Different machine = different resolution, mic, and font rendering.
4. **Test at 1366×768** (most college projectors) — the layout was verified there, but confirm on the real projector if you can borrow it.
5. **Charge everything. Bring the charger.**

---

## 3 · 10 minutes before — the pre-flight (matches the on-screen strip)

The showcase has a **pre-flight strip** at the top. Click **"Run checks"** and confirm three green chips:

| Chip | Green means | If red |
|---|---|---|
| **server** | `node server.js` is running | restart the server |
| **voice** | Sarvam is responding | check API key / credits; if Sarvam is slow, calls will lag — lean on the recording |
| **microphone** | browser mic allowed | click the padlock in the address bar → allow mic → re-run |

Then, by hand:
- **Hotspot on, venue WiFi OFF.** Test one real call over the hotspot.
- **Volume up**, external speaker if the room is big — Sneha's voice must fill the room.
- **Close every other tab and app** (mic conflicts, notifications, CPU).
- **Do ONE full live call yourself.** Take 3+ turns and a language switch. If turns 2–3 speak and the switch speaks, you're good.

---

## 4 · The demo flow — what to click, what to say

**Act 01 — The wall.** *"This is the entire admissions office. Twelve departments, one system."* Point at the big number. Click one or two tiles → the slide-over shows the **real artifact** (a queued WhatsApp message, the document checklist). Land on **Data entry → "nobody typed any of this."**

**Act 02 — The call.** Click **Begin the demonstration**. Pick a family → **Call Sneha** → allow mic → **talk to her.** The move: **switch to Telugu mid-call** and let the room watch the transcript flip and her keep going. Interrupt her (tap the capsule) to show barge-in.

**Act 03 — The ripple.** It fires automatically when the call ends. *"The call ended. Nobody typed anything."* Watch the cascade — summary, interest score, CRM update, WhatsApp queued, visit booked, follow-up scheduled.

**Act 04 — The case.** Switch the tier tabs (5 / 15 / 30). Point at the **measured vs modeled** chips: *"These green ones are real vendor rates. The amber ones are assumptions we'll replace with your real numbers."* The honesty is the pitch. Hit **Print this page** for the one-pager leave-behind.

---

## 5 · If it breaks mid-pitch — the fallback ladder

1. **Live call goes quiet / lags** → say *"let me show you a call I recorded earlier"* and **play the screen-recording** (§2.2). Never fumble live — cut to the video and keep talking.
2. **Sarvam times out** → the call now **recovers** (she goes quiet a beat, then you speak again) instead of freezing. If it keeps timing out, cut to the recording.
3. **Internet dies entirely** → the page + fonts are self-hosted, so the UI still renders; the *call* needs Sarvam, so cut to the recording. Hotspot is the primary; a second phone's hotspot is the backup.
4. **Mic won't allow** → address-bar padlock → allow. If the venue laptop blocks it, use your own laptop.

---

## 6 · Do NOT demo these (they're honestly not ready)

- **❌ Payments** — `PAYMENT_LINK_BASE` is a placeholder; it generates a **dead link**. Skip the Payments tile's action.
- **❌ The call console** (`index.html`) — silent since the audio upgrade. **Use `showcase.html` only.**
- **❌ Human transfer / counsellor alert as "working"** — `COUNSELOR_PHONE` is empty, so those alerts go nowhere. Describe them as capabilities, don't trigger them live.
- **❌ WhatsApp as "sending"** — `WHATSAPP_PHONE_ID` isn't set; messages queue and fall back to SMS. Show the *queued message* artifact; don't claim it just sent on WhatsApp.
- **⚠️ Don't let Sneha free-style on fees.** The current personas can occasionally invent a number (a bus fee, a "refundable deposit"). If a fee question comes up live and she says something odd, **steer back**: *"exact figures come from the counsellor — this is about the conversation."* Don't build the pitch around asking her precise fee math.

---

## 7 · Honest status the presenter should know
- **Latency** is ~1 second voice-to-voice when Sarvam is healthy — genuinely good. It degrades if Sarvam is slow; that's an external service you don't control in the room. The recording covers you.
- **Telugu/Hindi/English** all work, including mid-call switching.
- The three **placeholder keys** (counsellor phone, WhatsApp ID, payment link) are the only things between "demo" and "live pilot" — they're the college's to provide.

---

*Last updated: 2026-07-15. If the stack changes, re-verify §3 and §6.*
