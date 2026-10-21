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

### Made while building Phase 1 (2026-10-18)
- **View helpers are a JS module, not `macros.ejs`.** `app/lib/ui.js` builds the badges, health dot, due cells and form fields as HTML strings. Each value is escaped there. The EJS partial is `app/views/partials/deal-table.ejs`.
- **Routes stay in one file** (`app/routes.js`), as the spec layout says.
- **Enum lists are checked only on save.** Files loaded from disk get structural checks only, so a later config edit cannot hide a record.
- **Pull before creating records.** Deals, customers and people pull from the remote before a new id is allocated, as §4.6 asks.
- **Probability follows the stage only when the user did not edit it** in the same save. Otherwise the typed value wins.
- **Lock file and history:** `_lock.json` never appears in the timeline.
- **Known gap:** the Phase 1 dashboard is still the placeholder. The KPIs and lists come in Phase 2.

### Made while building Phase 2 (2026-10-18)
- **Dashboard replaces the placeholder** once a user is set. Until then the welcome card shows, as before.
- **Commit helper handles missing files.** `GitSync.commitUnlocked` stages the files that exist, removes the others from the index (a no-op for untracked files), and commits only what is staged.
- **Conflict copies are resolved one at a time** on `/conflicts`. Each choice is one commit.
- **Export uses the list's filters**, including the default "open" filter.
- **Next-action updates return to the page the user came from**, so the dashboard's inline update stays on the dashboard.

### Made while adding opportunity types (2026-10-21)
- **Type is required and drives the form.** Types (Lead, RFI, RFQ, RFP, Proactive Proposal, Change Request, Renewal / Extension) are listed in `config.json` under `opportunity_types`, each with the optional fields it shows and the fields it requires.
- **Lead** is a new customer, or a new opportunity with an existing customer. It is a type; the stage list is unchanged.
- **Hidden fields are stored empty, never deleted.** Changing the type keeps every value. An optional field that has a value is always shown.
- **Existing opportunities** get RFQ when their tags include RFQ, otherwise Lead.

### Made while changing deal type to tags and renaming (2026-10-21)
- **Type is a tag.** The fixed Type list is gone. Tags are free text: the form suggests known tags, and a new tag typed in is added to `config.tags` in the same commit. Settings can edit the list, but a tag that a deal still uses cannot be removed.
- **Old files keep their type.** A deal file with `type` loads with the type as its first tag, and the key is dropped on the next save.
- **The UI says opportunity; the code says deal.** Visible text and URLs (`/deals` to `/opportunities`) changed. Old /deals links redirect (308). `DL-` ids and `data/deals/` are kept, so no records move.
- **Dashboard and deals list filter by tag** with `?tag=…` (repeatable). A deal must have every tag picked. Unknown tags are ignored.

### Made while changing the dashboard layout (2026-10-21)
- **The dashboard is for open work.** Win rate and the due-in-7-days figure left it. Win rate is on the Wins page by year, and due dates show in Needs attention and on each opportunity.
- **Layout order:** KPIs, Health and BU, Internal activities, Recently updated, Needs attention and My next actions, Asks, Pipeline, Aging, Customers to connect, then Submissions due last.

### Made while moving wins to their own page (2026-10-21)
- **Wins by year lives on /wins**, not the dashboard. The dashboard is for open work. The page reads the same data.

### Made while adding people merge (2026-10-21)
- **Merge, not only delete.** A mistaken person is usually referenced in many places, so delete alone is blocked. Merge moves every reference, so the work is kept.
- **One reference list** (lib/merge.js personRefs) answers both "is it in use?" and "what moves?", so a new field that holds a person id must be added there.

### Made while adding internal activities (2026-10-21)
- **Activities are a separate record kind, not opportunities.** An opportunity needs a customer and runs through RFQ stages, so a prototype would distort the pipeline and win rate. The AC prefix and data/activities folder are new; nothing existing moved.
- **Updates are a log inside the activity file**, like the history on opportunities, so one file holds the whole story.
- **Quiet uses the stale setting** (14 days by default) and only applies to in-progress activities.

### Made while adding wins by year (2026-10-21)
- **Wins are counted by closing year** (closed_on), the same field the 90-day win rate uses. Dropped is not a loss, so it is left out of the rate.
- **Old wins are entered with the form.** The Closed on field already exists. There is no import from a file yet.

### Made while adding type-to-confirm deletes (2026-10-21)
- **Records need the challenge, small items do not yet.** Opportunity, customer and person deletes need the typed ID or exact name. Ask and connect removals keep the plain confirm. Saved as a standing rule in memory (feedback-confirm-deletes).
- **The check is exact after trimming spaces, and case-sensitive** for names, so a typo cannot pass.

### Made while adding customer connects (2026-10-21)
- **Connects are Teams meetings and visits only.** Calls and emails are not logged. The customer is the only link: an RFQ has no connect field, which keeps RFQs simple.
- **Flag uses its own setting** (`connect_after_days`, 30), not the stale setting for opportunities, because a customer contact cycle is slower than a deal update cycle.
- **Flag shows on the dashboard only for customers with open opportunities.** On the list it shows for every customer. Change either if you want it the other way.
- **Saving a customer always writes `connects`**, so new customer files have the field too.

### Made while adding dashboard charts (2026-10-21)
- **Three charts, one question each.** Health is a stacked status bar with words beside it (status colours are used only for status). Submissions are columns for the next six months, one hue, values printed on every column (six values is few enough). BU is bars in the same style as the existing stage and aging bars. No chart library.
- **Every chart has its numbers in text** (legend, column values or bar values), which covers the table-view need. The app has no dark mode, so there is no dark palette. Charts use the existing tokens.
- **Calculations are pure functions in metrics.js** (healthMix, submissionsByMonth, byBusinessUnit) so they are tested with a fixed date.

### Made while adding BU from the forms (2026-10-21)
- **BU is free text on the forms, like tags.** The form suggests the configured BUs. A new one is added to `config.business_units` in the same commit as the record. Matching ignores case, so `mobility` stores `Mobility`. Max 40 characters.
- **Settings still owns the list.** A BU removed there is not checked against existing records yet (tags are). Open question for the user.

### Made while fixing table headers and look and feel (2026-10-21)
- **No sticky table headers.** `.table-wrap` scrolls sideways on narrow screens, and that makes it the scroll container, so `position: sticky` on `th` never pins anything (measured in headless Chrome). Pinning would need the sideways scroll removed, which costs more on narrow screens than pinned headers gain. Revisit only if long lists become a problem.
- **Column headings use `--text-header` (#475569)**, about 6.9:1 on the header band. The muted token (about 4.3:1) was below AA for 12px text.
- **Tables sit flush in their cards.** Any table card uses `card table-card` with the title and footer in `card-pad`. The Asks table inside the support card uses a negative margin to run edge to edge.
- **Not done, on purpose:** wide tables do not hide columns on narrow windows (desktop tool; horizontal scroll is enough). The `:has()` two-column dashboard layout has no fallback beyond one column on older browsers.

### Made while building RFQs I support (2026-10-19)
- **Asks live inside the deal file.** One deal is one file and one commit, the same as the history.
- **Ask numbers come from `support_seq`** (last number used), so a removed ask's number is never reused. "Highest existing + 1" would reuse it.
- **Older deal files get empty support fields on load** (`withSupportDefaults`). They are not treated as broken.
- **Inline changes on the deal page show errors as a flash message**, not a 422 re-render. Full forms still re-render with 422.
- **"Asks due next week" includes overdue asks**, marked "(overdue)". Asks on closed deals are left out.
- **Owners cannot also be supporters.** New deals default the presales owner to the current user, so you cannot support your own deal. This is intended.

### Working method (set by the user, 2026-10-18)
- **Every feature or phase gets its own branch**, so a change cannot break the software unnoticed.
- **Once its tests pass, merge the branch into `main` and delete the branch.** Nothing is pushed unless the user asks.

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

### 2026-10-18 — Phase 1 — core tracking — Linux
- Done: deal, customer and people pages (list, detail, form, delete), stage stepper with outcome reasons, notes, next actions, hold, health and aging rules, per-currency totals, auto-create of customers and people, one commit per save.
- Changed files: `app/models.js`, `app/metrics.js`, `app/history.js`, `app/forms.js`, `app/store.js`, `app/routes.js`, `app/lib/format.js`, `app/lib/ui.js`, `app/lib/render.js`, `app/server.js`, views under `app/views/`, `app/public/app.js`, `app/public/app.css`, tests `metrics`, `history`, `store`, `routes`.
- Checks: `npm test` 65 of 65 pass on Node 24.
- Not run: a browser visual check. Pages are checked by the route tests, which fetch the HTML.
- Next step: Phase 2 (dashboard, settings, Excel export, conflicts page, data-problems banner, shortcuts).

### 2026-10-18 — Phase 2 — insight and settings — Linux
- Done: full dashboard (KPIs, needs attention, my next actions with inline update, pipeline and aging bars, recently updated), settings (me, stale threshold, lists, read-only stages, data problems), Excel export (36 columns, same filters as the list), conflicts page (keep mine / use theirs), banners for conflicts and unreadable data files, keyboard shortcuts and reveal forms.
- Changed files: `app/export.js` (new), `app/routes.js`, `app/store.js`, `app/git-sync.js`, `app/lib/render.js`, views (`dashboard`, `settings`, `conflicts`, `layout`, `deals/list`, `deals/detail`), `app/public/app.js`, `app/public/app.css`, `tests/insight.test.js` (new).
- Checks: `npm test` 74 of 74 pass on Node 24.
- Next step: Phase 3 (weekly report, README, polish).

### 2026-10-18 — Phase 3 — quality of life — Linux
- Done: weekly report (Monday–Sunday, Markdown, Copy button, previous and next week), README rewritten for setup, daily use, sync and conflicts, settings file, and troubleshooting. Polish: empty states on every list, 404 and 500 pages, page titles.
- Changed files: `app/report.js` (new), `app/lib/dates.js` (new), `app/routes.js`, `app/public/app.js`, `app/public/app.css`, `app/views/report-weekly.ejs` (new), `app/views/dashboard.ejs`, `README.md`, `tests/report.test.js` (new).
- Checks: `npm test` 78 of 78 pass on Node 24. An end-to-end run of `run.js` on a temp copy: every page answers (200, or 404 for an unknown page); `Ctrl+C` pushed the lock release (3 commits on the remote).
- Next step: the Windows checks for Phase 0 and the push of `main`, both waiting on the user.

### 2026-10-19 — RFQs I support — S1, S2, S3 — Linux
- Done: supporters and asks on the deal page (S1); `/support` and `/support/asks`, the dashboard card "Asks for me", nav items, `g s`, a Support filter and Supporters column on the deals list (S2); Supporters and Open asks Excel columns, and "Asks due next week" in the weekly report (S3). Spec in PLAN.md §15.
- Changed files: `app/models.js`, `app/store.js`, `app/forms.js`, `app/history.js`, `app/metrics.js`, `app/support.js` (new), `app/routes.js`, `app/export.js`, `app/report.js`, `app/public/app.js`, `app/public/app.css`, `app/views/deals/detail.ejs`, `app/views/deals/list.ejs`, `app/views/support/` (new), `app/views/partials/deal-table.ejs`, `app/views/dashboard.ejs`, `app/views/layout.ejs`, `README.md`, `tests/support.test.js` (new), `tests/support-pages.test.js` (new), `tests/support-export.test.js` (new), `tests/insight.test.js` (column numbers).
- Checks: `npm test` 123 of 123 pass on Node 22 (78 existing, 26 + 15 + 4 new). Tests run after each phase; each branch was merged only when they passed.
- Not checked: a visual browser check of the new cards and the chips; Windows.

### 2026-10-21 — tags and opportunity rename — Linux
- Done: tags replace the fixed deal type (`app/lib/tags.js` new; models, store, forms, export, settings changed). Dashboard and deals list filter by tag (`partials/tag-filter.ejs` new). Visible names and /deals URLs now say opportunity (35 files, phrase-level, identifiers untouched).
- Tests: 148 of 148 pass on Node 22. New: `tests/tags.test.js` (17), `tests/tags-filter.test.js` (8), `tests/rename.test.js` (3). Existing export expectations updated (37 columns; sheet "Opportunities"; file "opportunities-…").
- Not checked: a visual browser check of the tag chips; Windows.
