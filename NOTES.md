# NOTES — Work Tracker

This file is the shared memory of the project. Any person or AI session working on this repo, on any device, should read it first. It holds three things: the decisions that have been made, the open questions, and the progress log with a handoff for the next session.

**Rules for updating this file**
- Add a decision whenever you choose something the spec leaves open, or when the user changes a rule.
- Append a progress entry at the end of every working session (newest at the bottom). Do not rewrite old entries.
- Keep the "Current status" table up to date.
- Keep it short. Link to `PLAN.md` for details instead of copying them.

---

## 1. Current status

| Phase | Status | Notes |
|---|---|---|
| Spec (`PLAN.md`) | Done | Node.js version committed |
| Phase 0 — Foundation | Done on Linux; Windows checks pending | Code written on branch `phase-0-foundation`; 14 tests pass (git-sync and session lock); end-to-end runs checked on Linux (first run, save, push on Ctrl+C, offline, two computers and the lock). `start.bat` and Windows git prompts not run yet. |
| Phase 1 — Core tracking | Not started | |
| Phase 2 — Insight and settings | Not started | |
| Phase 3 — Quality of life | Not started | |

Update the status when a phase starts (`In progress`), when its checks pass (`Done`), or when it is blocked (`Blocked: <reason>`).

---

## 2. Decisions

### From the user (confirmed)
- **Platforms:** the app must run on Windows and Linux (both laptops are in use).
- **Remote:** `https://github.com/amodmulay-ltts/ai-work-mgmt.git`, branch `main`. It is the company's enterprise git, and the user is not worried about data confidentiality.
- **Session lock (advisory):** when another computer has the app open, the app shows a warning. It never blocks. Specified in `PLAN.md` §3.4 (`data/_lock.json`, written on start, released on Ctrl+C, pushed immediately). Added 2026-10-18 at the user's request. Built on branch `phase-0-foundation`.
- **Stages:** use the default stages in `PLAN.md` §4.1. No custom stages.
- **Start:** from scratch. No Excel import.
- **C4C ID:** a static identifier stored as plain text. Never a link, and no C4C API.
- **Currency:** no FX rates and no conversion. Totals are shown per currency.
- **Stack:** Node.js instead of Python (decided 2026-10-16).
- **Implementer:** the spec is written so that Haiku 5.5 can implement it phase by phase.

### Made while writing the spec (to confirm later if needed)
- **Express 5** for the server, **EJS** for views, **cookie-parser** for flash messages, **exceljs** for Excel export.
- **`node:test`** for tests. There are no test dependencies.
- **No TypeScript and no bundler.** Plain JavaScript (ES modules) only.
- **`package-lock.json` is committed.** `run.js` installs with `npm ci` and checks a hash to decide when to reinstall.
- **Dates are stored as `YYYY-MM-DD` strings,** not `Date` objects, to avoid timezone drift.
- **Git pushes** happen 30 s after the last change, and again on Ctrl+C.
- **Sync conflicts:** the local version wins in the file; the remote version is saved in `data/_conflicts/` and can be chosen later on the Conflicts page.
- **Person roles:** Sales, Presales, Delivery, Leadership, Customer, Partner, Other.
- **Deal IDs:** `DL-YYYY-NNNN`, with the counter reset each year. Customers are `CU-NNNN`, people are `PE-NNNN`.
- **Health levels:** red, amber, green, hold and closed, calculated from the rules in `PLAN.md` §8. They are never stored.

### Made while building Phase 0 (2026-10-16)
- **Pull before the store is created.** `createApp` pulls first, then creates `config.json`. Otherwise a second laptop conflicts on the config file. The spec (`PLAN.md` §3.3) was corrected.
- **Store writes commit with `commitUnlocked`.** `Store.save` already holds the lock, so it must not call the locking `commit()`. The spec (`PLAN.md` §7) was corrected.
- **Views and flash messages live in `app/lib/render.js`.** Pages render through `renderPage`, which wraps them in `layout.ejs`. Flash messages are a cookie read by the next page request.
- **Static files are served under `/static/`.** Example: `/static/app.css`.
- **Only the Dashboard is in the nav for Phase 0.** Other links are added together with their pages, so there are no dead links.
- **`uuid` override in `package.json`.** `exceljs` pulls in a `uuid` version with a known moderate issue. `"overrides": { "uuid": "^11.1.1" }` fixes it. `npm audit` reports 0 vulnerabilities.
- **Branch detection uses `git symbolic-ref --short HEAD`** rather than `rev-parse`, because it also works in a repo with no commits yet.
- **Push delay comes from `config.json`** (`push_delay_seconds`, default 30).
- **Git credential prompts** use the terminal (`/dev/tty`) on Linux, and Git Credential Manager on Windows. The Windows path is not tested yet.
- **Lock file conflicts are resolved silently.** When two computers both change `data/_lock.json`, the remote copy wins and nothing is saved to `_conflicts`. Only the lock is treated this way. `takeRemoteLock` in `app/git-sync.js`.
- **Holder name override:** `WORK_TRACKER_HOLDER` replaces `user@hostname`. It is used to test two copies on one machine.
- **Node version:** Node 24.22.0 (installed with nvm by the user) is the default for development. `npm test` passes on it (8/8). Node 20+ is the minimum in the spec.
- **Build tools on the planning/build machine:** Node.js 22 is installed in `~/.local/node` (official tarball, checksum verified). No system-wide install was possible. Nothing in the repo depends on this location.

---

## 3. Open questions

- [ ] Should the app be run with the `Node.js` LTS installed through the company's software centre, or with a per-user install? (Affects how `start.bat` is tested on the Windows laptop.)
- [ ] Are the default "Lost/Dropped" reasons in `config.json` right for LTTS?
- [ ] Which BUs and regions should be in `config.json`? (`PLAN.md` §5.4 has placeholders.)
- [ ] Will the weekly report be pasted into Outlook or Teams? (It is plain Markdown in the spec.)

When a question is answered, move it to §2 as a decision and tick it off here.

---

## 4. Progress log

### How to resume on another device or at another time
1. Clone or pull the repo: `git pull` (or `git clone https://github.com/amodmulay-ltts/ai-work-mgmt.git` on a new machine).
2. Open the folder in Claude Code (or any coding assistant).
3. Start the session by asking it to read `NOTES.md` and `PLAN.md`, then to continue from the last entry in §4 of `NOTES.md`.
4. Before stopping, add a progress entry (template below) and commit it. Then push, so the next device gets it.

Conversation history is stored on the machine where the session ran, so a session started on one device is not visible on another. The repo files (`PLAN.md`, `NOTES.md`, `data/`) are the things that carry over.

**Progress entry template:**
```
### YYYY-MM-DD HH:MM — <device / who> — <phase or task>
- Done: …
- Changed files: …
- Checks run: … (pass / fail, with the output if it failed)
- Next step: …
- Blockers / questions: …
```

---

### 2026-10-16 — planning session — spec
- Done: wrote `PLAN.md` (Python version, then the Node.js version). Added `NOTES.md`.
- Changed files: `PLAN.md`, `NOTES.md`.
- Checks run: none. The implementation does not exist yet, and Node.js was not available on the planning machine.
- Next step: Phase 0 (`PLAN.md` §13). Start by creating the repo files in §2, then run `npm install` and commit `package-lock.json`.
- Blockers / questions: see §3.

### 2026-10-16 — Phase 0 build — Linux
- Done: repo files (`package.json`, `package-lock.json`, `.gitignore`, `.gitattributes`, `start.sh`, `start.bat`, `run.js`); `app/` (mutex, config defaults, models with the Person type, git-sync, store, render helpers, routes, server, views, `app.css`, `app.js`); tests (`tests/helpers.js`, `tests/git-sync.test.js`).
- Changed files: see `git status`. Nothing is committed yet.
- Checks run:
  - `npm test`: 8 of 8 pass (git-sync).
  - `npm audit`: 0 vulnerabilities (after the `uuid` override).
  - End-to-end on Linux with a local bare repo as the remote: npm install on first run; first page shows the welcome card; invalid form gives 422 with messages; valid save gives one commit holding the person and config; Ctrl+C pushes the pending commit; with the remote unreachable the badge shows "Sync error" and saves still commit locally; the toast and `POST /sync` work; `./start.sh` launches the app.
  - Not run: `start.bat` on Windows; the browser opening; a real GitHub push (the token was not stored, so no push was attempted).
- Next step: commit and push (the user has to ask; the token is needed). Then run the Windows checks for Phase 0 (`start.bat`, the git credential prompt, and the first-run commit). Then start Phase 1 (`PLAN.md` §13).
- Blockers / questions: none blocking. The conversation is on this machine only; the repo is the handoff.

### 2026-10-18 — planning — session lock
- Done: added the advisory session lock to the spec (`PLAN.md` §3.4), with the Phase 0 task and check. Recorded it as a decision.
- Changed files: `PLAN.md`, `NOTES.md`. No code changed.
- Checks run: none (spec only).
- Next step: implement §3.4 as part of Phase 0 (`PLAN.md` §13), then the Windows checks.
- Blockers / questions: none.

### 2026-10-18 — Phase 0 — session lock built — Linux
- Done: advisory session lock (`PLAN.md` §3.4): `Store.acquireLock`/`releaseLock`, lock taken on start and pushed at once, released on Ctrl+C before the final push, warning banner and terminal message. Lock-file conflicts resolved silently (remote copy wins). `WORK_TRACKER_HOLDER` override.
- Changed files: `app/store.js`, `app/server.js`, `app/git-sync.js`, `app/lib/render.js`, `app/views/layout.ejs`, `run.js`, `tests/lock.test.js` (new), `PLAN.md`, `NOTES.md`.
- Checks run:
  - `npm test` on Node 24: 14 of 14 pass (8 git-sync, 6 lock).
  - Two copies of the app against one bare remote: B started while A was open and showed the warning; A's release was pushed; B's restart showed no warning.
  - First attempt showed a lock conflict copy in `data/_conflicts`. Fixed, and the rerun showed none.
- Not run: `start.bat` and the Windows lock behaviour; a real push to GitHub.
- Next step: Windows checks for Phase 0. Then Phase 1.
- Blockers / questions: none.
