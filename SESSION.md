# SESSION — current working state

Short, working file. Keep it under 5,000 words. When a feature or session is finished, move its decisions and history to `NOTES.md` and trim this file. `PLAN.md` is the spec.

---

## 1. Current status

| Phase | Status | Branch |
|---|---|---|
| Spec (`PLAN.md`) | Done | `main` |
| Phase 0 — Foundation (incl. session lock) | Done on Linux; Windows checks pending | `phase-0-foundation`, merged to `main` locally |
| Phase 1 — Core tracking | Done (65 tests pass) | `phase-1-core` |
| Phase 2 — Insight and settings | Done (74 tests pass) | `phase-2-insight` |
| Phase 3 — Quality of life | Done (78 tests pass) | `phase-3-polish` |
| Feature: RFQs I support (PLAN.md §15, phases S1–S3) | Done | merged to `main` |
| Tags replace deal type; dashboard and list tag filter; Deal renamed Opportunity | Done (149 tests pass); implementation review complete | merged to `main` |
| Opportunity types drive the form and detail page | Done (169 tests pass); browser check pending | merged to `main` |
| Table headers and look and feel (UI analysis TODO) | Done (175 tests pass); checked in headless Chrome | `ui-table-headers`, merged to `main` |

**Push status:** `main` is synced with `origin/main` at `d29e535`.

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
- Phases 1–3 built and committed on their branches, merged into `main` locally.
- Next: Windows checks for Phase 0; push of `main` (user).

### 2026-10-19 — session
- Done: added the working rule (one branch per feature, merge and delete once tested), recorded in NOTES.md §2. Branches for phases 0–3 deleted (already merged).
- Done: planned "RFQs I support" as PLAN.md §15 (supporters and asks on a deal; `/support` and `/support/asks` pages; export and report additions; phases S1–S3). Spec only, no code.
- Built RFQs I support in three phases, each on its own branch, merged and deleted after its tests passed: S1 supporters and asks (26 tests), S2 pages, dashboard card, deals filter (15), S3 export and weekly report (4). Total 123 pass.
- Open questions in PLAN.md §15.8 were answered by default (no hours tracking; nav beside Deals). Revisit if the user says otherwise.
- Next: user review on the real data; push `main` from the user's terminal.

### 2026-10-21 — session
- Done: deal `type` replaced by tags (creatable, Settings list, old types migrate on load). Dashboard and deals list filter by `?tag=`. Visible "Deal" renamed to "Opportunity", with /deals redirecting to /opportunities. 148 tests pass.
- Decided by default: code names, DL- ids and data/deals kept, so no records move.
- Next: evaluate the implementation-review suggestions.

### 2026-10-21 — implementation review
- Done: reviewed the implementation against `PLAN.md`; follow-up suggestions were delivered in chat.
- Tests: 149/149 pass with a command-scoped `safe.bareRepository=all` setting. Without it, two git-sync tests are blocked by the machine's `safe.bareRepository=explicit` setting for generated bare test remotes.

### 2026-10-21 — opportunity types — Linux
- Done: Type is required again and drives the form (Lead, RFI, RFQ, RFP, Proactive Proposal, Change Request, Renewal / Extension). Each type shows its own fields, and the deal page prints only applicable rows. Hidden fields are stored empty. 169 tests pass.
- Next: user review in the browser (the show and hide script is not browser-tested here).

### 2026-10-21 — table headers and look and feel — Linux
- Done: resolved the UI TODO list. Sticky table headers removed (they never worked: `.table-wrap` scrolls sideways, which made it the scroll container). Column headings darker (`--text-header`, AA contrast). Stray monospace on the Asks heading removed. Needs attention and Asks tables now sit edge to edge in their cards, like the other lists. Wide tables and the `:has()` fallback left as they are (see NOTES §2).
- Verified in headless Chrome: header top stays in place when scrolled (before: scrolled away) and the asks header is in the sans font. 175 tests pass (new file `tests/table-headers.test.js`).
- Next: user review in the browser.
