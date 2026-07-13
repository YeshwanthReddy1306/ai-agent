# Persona Locking Rule

## Context
The agent personas (`agent/personas/en.js`, `agent/personas/te.js`, and `agent/personas/hi.js`) have been carefully engineered and tested to act as a 30-year veteran sales closer with very specific constraints, formatting rules, and conversational logic.

## HARD RULE: DO NOT TOUCH PERSONAS
1. **LOCKED:** All three language personas (English, Telugu, Hindi) are completely locked.
2. **NO UNSOLICITED CHANGES:** You must NOT change them, refactor them, or "optimize" them unless the user explicitly asks you to.
3. **SURGICAL EDITS ONLY:** When the user DOES ask you to change something in a persona, you must ONLY change the exact specific thing requested. Do NOT touch, rewrite, or alter the other parts of the prompt.
4. **CLARIFY BEFORE ACTING:** If you have any doubt about the scope of the change or how it might affect the base persona, you MUST clarify it with the user BEFORE making a single change.
5. **NEVER OVERWRITE:** This rule is absolute and must never be overwritten or ignored.

## Enforcement (byte-exact baseline, added 2026-07-03)
The approved personas are snapshotted with SHA-256 checksums in `agent/personas/locked/`.
- `npm run preflight` **FAILS** if any live persona differs from the baseline.
- `npm run restore-personas` — overwrite the live personas with the approved baseline (undo any unapproved drift). The server hot-reloads personas per call, so a restore is live immediately.
- `npm run lock-personas` — re-snapshot the baseline. Run ONLY after the user has explicitly requested and approved a persona change.

# Rule: Context Window Degradation in Voice Agents
When building or optimizing voice agents (especially on large models like 105b), NEVER use a long conversation history (e.g., HISTORY_TURNS=12).
A long history causes:
1. Severe latency spikes as the call prolongs.
2. "Context-bias degradation" where the LLM forgets the strict system instructions, drops output formatting tags, and reverts to generic responses.
**Action:** Always maintain a short, sliding window of history (e.g., HISTORY_TURNS=3) to ensure lightning-fast latency and strict adherence to the persona.


# Rule: Conversational Freedom vs. State-Machine Funnels
When designing personas for conversational voice agents (especially using LLMs like Sarvam-105b), NEVER use rigid "state-machine" funnel steps like "Follow this exact path" or "Move to the next step ONLY after the parent answers".
Rigid instructions cause:
1. The AI to sound like it's "reading a script" instead of talking naturally.
2. Complete failure in objection handling (the AI ignores user questions and blindly repeats the script).
**Action:** Use "Goal-Oriented" instructions with "Conversational Freedom" and explicit "Objection Handling" blocks. Encourage filler words and colloquial grammar for native languages (Hindi/Telugu).


# Rule: Indic TTS Code-Switching (Hinglish & Tenglish)
When configuring prompts for Indic voice agents (specifically using engines like Sarvam AI), you MUST format English loanwords according to the TTS voice's native language model to prevent robotic accent-switching:

1. **Hinglish (Hindi-first voices like Simran)**:
   - **Rule**: STRICT TRANSLITERATION.
   - **Instruction**: The LLM MUST transliterate all English domain words and acronyms into Devanagari script (e.g., एडमिशन, फीस, हॉस्टल, डिटेल्स). NEVER use Latin script in the Hindi output.

2. **Tenglish (Telugu with non-native/generic voices)**:
   - **Rule**: LATIN SCRIPT + PHONETIC OVERRIDES.
   - **Instruction**: The LLM MUST output English domain words in English Latin script (e.g., admission, fees, hostel). Do NOT transliterate them into Telugu script.
   - **Post-Processing**: Because the TTS will mispronounce certain Latin words (e.g., reading "WhatsApp" as "WhaaatsApp"), you MUST use a pre-TTS regex replacer (	tsPhonetics) to swap known problem words with native script phonetic overrides (e.g., /\bwhatsapp\b/gi -> వాట్సాప్).
