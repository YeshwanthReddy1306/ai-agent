# Latency Playbook — fast WITHOUT losing Sneha
*Research synthesis 2026-07-05. Question: how to cut voice-agent latency while preserving quality/performance. Sources: owner-supplied articles, framework docs, open-source repos, working systems. Reddit thread was unfetchable (Reddit blocks automated reads) — its topic is covered by the other sources.*

## 0. The target, and the physics

- Natural human turn-taking: a reply within **200–300ms** feels instant; **>500ms** starts to feel unnatural; **>2s** stops feeling like conversation ([Telnyx](https://telnyx.com/resources/voice-ai-delay-causes)).
- **Our target: 800ms–1.2s voice-to-voice** — proven reachable (see §3). A literal 0.05s is physically impossible: network round-trips + audio framing alone exceed it.
- **Where our ~3–4s goes today** (our own logged stage timings): endpoint wait ~1.3s (phone VAD) → STT ~0.6s (batch) → LLM ~0.5–0.7s → TTS ~1.5–3s (batch, 48kHz web / full-utterance phone). Every stage waits for the previous one to finish completely. That serialization IS the problem.

## 1. The technique table (stage × saving × quality risk)

| Stage | Technique | Saves | Quality risk & verdict for US |
|---|---|---|---|
| Endpointing | Tune silence threshold on real call data; ML/semantic endpointing (infer sentence-completion from the partial transcript) instead of dumb silence timers | 200–300ms/turn ([Relinns](https://relinns.com/blogs/tips-to-improve-voice-agent-latency), [Bluejay](https://getbluejay.ai/blog/12-ways-to-reduce-voice-agent-latency)) | ⚠ Our 1300ms phone endpoint exists because 800ms cut sentences into garble. Semantic endpointing (LiveKit/Pipecat turn-detector, or Sarvam's STT-signaled end-of-speech) gives BOTH: fast cuts on complete sentences, patience mid-sentence. **Adopt in rebuild, don't blindly lower the timer now.** |
| STT | **Streaming STT** — transcribe while the caller is still talking; LLM can start on stabilized partials | 200–400ms ([Telnyx](https://telnyx.com/resources/voice-ai-delay-causes), [rnikhil](https://rnikhil.com/2025/05/18/how-to-reduce-latency-voice-agents)) | ✅ None — same saaras:v3 accuracy, Sarvam streams at **<150ms TTFT** ([docs](https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/speech-to-text/streaming-api)). Language auto-detect must stay on. |
| LLM | Optimize **TTFT** (short prompts, prompt caching, warm/persistent connections) — not model swaps | 200–600ms ([Relinns](https://relinns.com/blogs/tips-to-improve-voice-agent-latency)) | ✅ Sarvam has cached-input pricing (₹2.5 vs ₹4/1M) → caching exists; persistent HTTP/gRPC connections are free wins. ❌ **We will NOT swap to a smaller/faster model for te/hi** — Sarvam-105b IS the product (30b writes Romanized Telugu, field-proven). |
| LLM→TTS | **Stream LLM tokens into TTS at the first sentence boundary** — she starts speaking while still "thinking" the rest | 200–500ms ([Relinns](https://relinns.com/blogs/tips-to-improve-voice-agent-latency), [FutureAGI](https://futureagi.com/blog/how-to-optimize-voice-agent-latency-2026/)) | ✅ None, and it's the single most human-feeling change. Our 15-word turns = usually ONE sentence anyway, so the whole reply starts almost immediately. |
| TTS | **Streaming TTS** — play the first audio chunk while the rest synthesizes | 300–1500ms (our TTS is the fattest stage) | ✅ Sarvam streaming TTS: **<250ms first-byte** ([docs](https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/text-to-speech/streaming-api)). Phone path also drops the 48kHz penalty (8kHz mulaw already). |
| Network | **Co-locate everything** — run our server in an Indian region (Sarvam is in India; Twilio media crosses continents today) | 160–400ms total; inter-continent hops cost 150–300ms each ([Telnyx](https://telnyx.com/resources/voice-ai-delay-causes), [Relinns](https://relinns.com/blogs/tips-to-improve-voice-agent-latency)) | ✅ None. Our current path (Hyderabad phone → Twilio US → cloudflared → a Windows laptop → Sarvam India) is a world tour. Indian telephony (Exotel/Ozonetel) + an asia-south1 server collapses it. |
| Context | Pre-load at call start (lead data, facts — during the greeting); rolling summary instead of resending history | 5ms vs 400ms per lookup ([Relinns](https://relinns.com/blogs/tips-to-improve-voice-agent-latency)); prompt-size cuts help TTFT ([rnikhil](https://rnikhil.com/2025/05/18/how-to-reduce-latency-voice-agents)) | ✅ We already pre-build the persona at call start and inject facts on demand. Add the rolling summary (also fixes >12-turn memory). |
| Perception | Brief, varied "thinking" sounds ONLY when a real delay hits | masks 400–700ms ([Relinns](https://relinns.com/blogs/tips-to-improve-voice-agent-latency)) | ⚠ We disabled ack clips as robotic. Research nuance: they work when **varied (5–6 options), timely, and used only on genuinely slow turns** — worth ONE careful retry after streaming lands, not before. |
| Ops | Track **P95/P99 per stage** with turn IDs, not averages; regression-gate deploys | catches the 1-in-20 four-second turns ([Relinns](https://relinns.com/blogs/tips-to-improve-voice-agent-latency), [Bluejay](https://getbluejay.ai/blog/12-ways-to-reduce-voice-agent-latency)) | ✅ We already log per-turn stage timings + P50/P95 — extend to P99 + per-stage in the rebuild. |
| Caching | Semantic caching of frequent answers (~50ms hits) ([rnikhil](https://rnikhil.com/2025/05/18/how-to-reduce-latency-voice-agents)) | seconds on FAQ turns | ❌ **REJECTED for the voice path.** This is the fast-path disaster we already lived — canned answers bypass the persona, language mirroring, and warmth. Cache TTS audio of the fixed greeting only. |

## 2. Recommended stage budget (from [Telnyx](https://telnyx.com/resources/voice-ai-delay-causes))

VAD ≤250ms · STT ≤300ms · LLM ≤600ms · TTS ≤200ms · network ≤150ms → **≈1.0–1.5s worst-case, sub-second typical.**

## 3. Proof it works — real systems running at these numbers

- **Retell AI: ~600ms end-to-end** via tight STT→LLM→TTS pipelining ([rnikhil](https://rnikhil.com/2025/05/18/how-to-reduce-latency-voice-agents)).
- **Pipecat: <800ms voice-to-voice** — even running local models on a Mac ([pipecat repo](https://github.com/pipecat-ai/pipecat), [macos-local-voice-agents](https://github.com/kwindla/macos-local-voice-agents)).
- **Modal + Pipecat + open models: ~1s voice-to-voice**, fully documented build ([Modal blog](https://modal.com/blog/low-latency-voice-bot)).
- **Bolna (Indian, open-source): 500–800ms** with provider fallback + latency dashboard ([via GitHub guide](https://blog.dograh.com/ai-voice-agents-github-proven-guide-dograh-vs-livekit-vs-pipecat/)).
- **LiveKit Agents**: the WebRTC-native framework built exactly for this ([repo](https://github.com/livekit/agents)); **NVIDIA ships Pipecat-based reference agents** ([repo](https://github.com/NVIDIA/voice-agent-examples)).
- And **Sarvam publishes official plugins for both Pipecat and LiveKit** — our exact stack, pre-integrated.

## 4. Our implementation order (the MVP path)

1. **The rebuild IS the latency fix** (post-contract, as decided): LiveKit *or* Pipecat + Sarvam's official plugins → streaming STT (+~300ms), token→TTS streaming (+~400ms), streaming TTS first-byte (+~500ms+), semantic turn-detection (+~200–800ms vs our 1300ms timer). Compound effect: **3–4s → ~1s.**
2. **Move the server to India** alongside Indian telephony (Exotel/Ozonetel) — kills the trans-continental tour (+150–300ms and jitter).
3. **Free wins doable BEFORE the rebuild** (current bridge, zero quality risk): persistent HTTP connections to Sarvam; verify prompt-cache hits; pre-synthesize + cache the fixed English greeting audio (skips one full TTS round-trip on every call's first turn).
4. **Instrument P95/P99 per stage** from day one of the rebuild; regression-gate.

## 5. What we deliberately REFUSE to do (this is the "maintain performance" half)

1. **No smaller/faster LLM for Telugu/Hindi** — the entire product is how Sneha speaks; 105b stays (AGENT-SPEC §1.1).
2. **No canned/semantic-cached replies on the persona path** — already proven fatal (the fast-path regression).
3. **No multi-hop "smart" routing** — one synchronous LLM hop, forever (AGENT-SPEC §1.6).
4. **No endpoint-timer cuts without semantic detection** — fast-but-garbled loses more than slow-but-heard.
5. **No latency claims beyond measurement** — we quote our own P95, not the marketing number.
