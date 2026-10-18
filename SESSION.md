# SESSION — current working state

Short, working file. Keep it under 5,000 words. When a feature or session is finished, move its decisions and history to `NOTES.md` and trim this file. `PLAN.md` is the spec.

---

## 1. Current status

| Phase | Status | Branch |
|---|---|---|
| Spec (`PLAN.md`) | Done | `main` |
| Phase 0 — Foundation (incl. session lock) | Done on Linux; Windows checks pending | `phase-0-foundation`, merged to `main` locally |
| Phase 1 — Core tracking | In progress | `phase-1-core` |
| Phase 2 — Insight and settings | Not started | |
| Phase 3 — Quality of life | Not started | |

**Push status:** `main` is ahead of `origin/main` and has not been pushed. This environment has no GitHub credentials. The user pushes from their own terminal with `git push origin main`.

---

## 2. Working decisions (this session)

- Phase 1 comes first on its own branch, then Phase 2, then Phase 3. Each branch is created from `main` after the previous one is merged locally.
- Work follows `PLAN.md` §13. Checks are run on Node 24 with `npm test`, and the app is run end to end in a temp copy, never in the real repo, so no `data/` commit lands there by accident.

---

## 3. Open items

- Windows checks for Phase 0 (`start.bat`, git credential prompt, first-run commit).
- Push `main` from the user's terminal.

---

## 4. Progress log

### 2026-10-18 — session
- Done: merged `phase-0-foundation` into `main`. Created this file, as `CLAUDE.md` now requires.
- Blocked: `git push` failed with "could not read Username" (no credentials in this environment).
- Next: Phase 1 on branch `phase-1-core`.
