# Vendor Outreach — emails, call scripts, contacts
*2026-07-07 · Purpose: turn every [ASK] estimate into a vendor-stated fact (price-truth rule). Send the emails AND call for speed.*
*Contacts below are from official pages + business directories — VERIFY the number on the vendor's own contact page before dialing; I did not invent any of them.*

---

## 1. FreJun (telephony — the biggest cost swing)

**Why them:** ₹1,349/user/mo "unlimited India" could erase our ₹40k+ telephony line — IF it covers AI-agent/API traffic. That single answer is worth more than all other cost work combined.

**Contacts** ([contact page](https://frejun.com/contact-us/) is authoritative):
- Sales email: **sales@frejun.com** · General: **hello@frejun.com**
- Sales phone (India, directory-sourced — verify): **+91 92400 28408**
- Support: +91 80356 21212 / +91 80353 01939
- Office: FreJun India Pvt Ltd, Andheri East, Mumbai

**The 4 questions that decide everything (ask on the call, confirm by email):**
1. Does the **₹1,349/user unlimited-India plan cover automated / API-driven calls from an AI voice agent** (not a human dialing)? Or is unlimited only for human-agent seats?
2. For AI-agent traffic, what is the **Teler API real per-minute rate for India** (a blog cited $0.15/min ≈ ₹13 — confirm the true INR number)?
3. **Concurrency:** how many simultaneous calls per user/plan? We need 8 (5-member tier) / 20 (15-member) / 40 (30-member) parallel calls.
4. **Compliance:** do you provide a **160-series / DLT-registered** number for service/transactional calls to existing enquiries, and do you handle the PE-TM registration?

**Email draft (paste, fill [ ]):**
> Subject: AI voice-agent telephony — does unlimited-India cover API traffic? (volume: ~[X] min/mo)
>
> Hi FreJun team,
>
> We run an AI voice agent (in-house, Sarvam-based) that makes and receives admissions calls for education institutes in Hyderabad — Telugu/Hindi/English. Planning ~1,000–3,000 connected minutes/day at peak, both outbound and inbound.
>
> Before we choose a provider, four questions:
> 1) Does the ₹1,349/user unlimited-India plan cover **automated calls placed by our AI agent via API**, or is unlimited only for human-dialed seats?
> 2) If AI/API traffic is metered, what is the real **India per-minute rate** for the Teler API?
> 3) How many **simultaneous/concurrent calls** does each plan/user support?
> 4) Can you provide a **160-series / DLT-registered number** for transactional/service calls, and do you assist with PE-TM registration?
>
> We're comparing against Exotel/Ozonetel and ready to move fast. A quick call works too — best number to reach you?
>
> Thanks, [Name] · [phone] · Hyderabad

---

## 2. Sarvam AI (the voice/brain — ~60% of run-cost)

**Why them:** locks the biggest cost line (TTS) and — crucially — you're a **student founder**, so ask about startup/ecosystem credits that could subsidize the whole pilot.

**Contacts** ([contact page](https://www.sarvam.ai/contact-us) is authoritative — use the form; email format is first@sarvam.ai):
- Contact form: **sarvam.ai/contact-us** (routes to the right team)
- Head of Sales & BD: **Shubham Arora** (per public org data — reach via the form/LinkedIn, don't cold-dial a personal number)

**Questions:**
1. **Volume / enterprise pricing** for STT (Saaras v3), LLM (Sarvam-105b), TTS (Bulbul v3) above free tier — slabs at ~100k+ TTS-char/day and ~200k+ STT-sec/day?
2. **Prompt-cache billing:** is cached-input (₹2.5 vs ₹4/1M) auto-applied, and how do we see cache-hit tokens in usage?
3. **Startup / student-founder credits** or ecosystem program — we're an early-stage Indian edu-AI startup building fully on Sarvam.
4. **Bulbul fine-tuning / custom voice** availability (final-product roadmap) — is enterprise voice fine-tuning offered?
5. Streaming STT/TTS WebSocket — any pricing difference vs batch?

**Email draft:** (submit via the contact form)
> Subject: Enterprise/volume pricing + startup credits — building an edu voice agent fully on Sarvam
>
> Hi Sarvam team,
>
> We're an early-stage Hyderabad startup building an AI admissions agent for education institutes, **entirely on your stack** — Saaras v3 (STT), Sarvam-105b (LLM), Bulbul v3 / Simran (TTS). Telugu/Hindi/English, ~100k+ TTS chars and ~200k+ STT seconds per day at pilot scale.
>
> Could you share: (1) volume/enterprise slabs for STT/LLM/TTS; (2) how cached-input pricing and cache-hit tokens appear in usage; (3) any **startup/student-founder credit program**; (4) Bulbul custom-voice/fine-tuning availability; (5) streaming vs batch pricing?
>
> Happy to hop on a call. Thanks — [Name], [phone], Hyderabad.

---

## 3. Exotel (telephony comparison anchor)

**Why them:** the standard India cloud-telephony baseline to price FreJun against; also strong on compliance/DLT.

**Contacts** ([contact page](https://exotel.com/contact/) is authoritative):
- Sales phone (India): **+91 80889 19888** (also WhatsApp for support)
- Email: **hello@exotel.com** (format: name@exotel.com)
- Offices: Bengaluru (Domlur), Gurgaon, Mumbai

**Questions:**
1. **Per-minute outbound + inbound** rate for India at ~[X] min/mo (volume slab)?
2. **Channel/concurrency** cost — price for 8 / 20 / 40 simultaneous calls?
3. **AI voice agent via API / SIP** — supported, and any rate difference vs human-agent minutes?
4. **160-series / DLT** transactional number + registration support?
5. Number rental + one-time setup?

**Email/call opener:**
> Hi Exotel, we're launching an AI voice agent for education admissions in Hyderabad (Telugu/Hindi/English), ~[X] connected min/mo, outbound + inbound, needing [8/20/40] concurrent channels. Please share India per-minute rates at this volume, concurrency/channel pricing, API/SIP support for an AI agent, and 160-series/DLT options. Ready to move quickly — can we talk today?

---

## Bonus (optional, same script): Ozonetel +91 (via [ozonetel.com](https://ozonetel.com/) contact) · MyOperator ([myoperator.com](https://myoperator.com/)) — only if you want a third quote.

## Golden rule for all calls
Make THEM state the number. Don't accept "starts at" — ask "at MY volume of [X] minutes and [Y] concurrent calls, what is the all-in monthly?" Get it **in writing** (email/WhatsApp) so it's a fact, not a sales line.
