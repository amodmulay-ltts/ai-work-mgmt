# Work Tracker — instructions for Claude sessions

This repo is worked on from several devices, at different times. Your conversation history is not shared between them. The repo files are the only shared memory.

**At the start of every session, before doing anything else:**
1. Read `SESSION.md`. It has the current phase status, the decisions made so far, the open questions and the last progress entry.
2. Read `PLAN.md`. It is the implementation spec and the single source of truth for what to build.
3. Continue from the last progress entry. If the user's request conflicts with `PLAN.md` or `SESSION.md`, say so and ask before changing either file.
4. `NOTES.md`Should be refered only when requires and should not be in the context all the time

**At the end of every session:**
- Add a progress entry to `SESSION.md` §4 (template in that file) and update the status table in §1.
- Record any new decision in `NOTES.md` §2.
- Add any session relevant decisions to `SESSION.md`. Once a fetaure, or session context is completed move it to `NOTES.md`
- Remove unecessary content from `SESSION.md` to keep the context size low. Limit to 5k words


**Commits and pushes:** Always make a new branch for any new feature and commit when done. Push when the user asks. The data in `data/` is committed automatically by the app; do not commit it by hand.

**Rules for code** are in `PLAN.md` §0 (Node.js 20+, plain JavaScript, no Python, no new dependencies without a reason in `NOTES.md`).

- When reporting information to me, be extreamly concise and sacrifice grammar for the sake of concision

