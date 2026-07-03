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
