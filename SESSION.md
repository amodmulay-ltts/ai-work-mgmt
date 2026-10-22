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
| Table headers and look and feel (UI analysis TODO) | Done (175 tests pass); checked in headless Chrome | merged to `main` |
| New BU added from the opportunity and customer forms | Done (185 tests pass) | merged to `main` |
| Dashboard charts: health, submissions by month, BU | Done (189 tests pass) | merged to `main` |
| Customer connects (PLAN.md §16) | Done (202 tests pass) | merged to `main` |
| Type-to-confirm for deletes | Done (208 tests pass) | merged to `main` |
| Wins by year (dashboard) | Done (213 tests pass) | merged to `main` |
| Internal activities (PLAN.md §17) | Done (226 tests pass) | merged to `main` |
| Merge people entered by mistake (PLAN.md §18) | Done (235 tests pass) | `merge-people` |

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

### 2026-10-21 — add BU from the forms — Linux
- Done: BU on the opportunity and customer forms is a text field with the BU list as suggestions. A new BU is added to `config.business_units` in the same save, as new tags are. Settings still edits the list. 185 tests pass (new file `tests/bu-free-text.test.js`).
- Next: user review. Removing a BU in Settings does not yet check whether opportunities use it (tags do).

### 2026-10-21 — dashboard charts — Linux
- Done: three charts on the dashboard (health status bar, submissions due next 6 months, open opportunities by BU). Server-rendered HTML and CSS, no library. Checked in headless Chrome with seeded data.
- Found, not fixed: at 800px the top bar overflows sideways (the right-hand group is 45px too wide). It predates these charts.

### 2026-10-21 — customer connects — Linux
- Done: Teams meetings and visits are logged on each customer, with first and last connected shown on the customer page and list. Customers with no connect in `connect_after_days` (default 30, set in Settings) are flagged on the list and on the dashboard, for those with open opportunities. Spec in PLAN.md §16. 202 tests pass.
- Next: user review in the browser. Connects are not in the export yet.

### 2026-10-21 — type to confirm deletes — Linux
- Done: deleting an opportunity, customer or person needs its ID (opportunity) or exact name (customer, person) typed in a collapsed Delete box. The server checks the same text. Ask and connect removals still use a plain confirm. 208 tests pass.
- Next: decide whether ask and connect removals need the same challenge.

### 2026-10-21 — wins by year — Linux
- Done: the dashboard has a Wins by year card. It shows won counts per closing year as columns, and a table of won, lost, win rate and won value per year. Years run from the first closed year to this year. Dropped deals are left out of the rate. Terminal deals with no closed date are counted apart. 213 tests pass.
- Next: user review. Older wins are entered by setting the Closed on date on the opportunity. Import from a file is not built.

### 2026-10-21 — internal activities — Linux
- Done: a new record kind, activity (AC-0001), for prototypes, concepts and AI solutions that are not opportunities. It has its own pages, a dated updates log and a status, and it is not in the pipeline or win stats. The dashboard has an Internal activities card, and the type-to-confirm delete applies. Spec in PLAN.md §17. 226 tests pass.
- Next: user review. Export and weekly report are not included yet.

### 2026-10-21 — merge people — Linux
- Done: Merge… on the People page moves every reference of a wrong person to the right one and removes the wrong person, in one commit. Typed-name challenge as for deletes. Delete now also refuses a person used on an ask, a connect or an activity (it checked only opportunities and account managers). 235 tests pass.
- Not checked in a browser yet: the merge page layout.

### 2026-10-21 — wins page — Linux
- Done: Wins by year moved from the dashboard to /wins, with a Wins nav link. The dashboard no longer computes it. 236 tests pass.

### 2026-10-21 — dashboard layout — Linux
- Done: the KPI row has two cards (Open opportunities, Weighted pipeline). Due in 7 days and Win rate are removed. Health and BU are one row. Internal activities is the third row, with Recently updated below it. Needs attention, Asks, Pipeline and Aging stay in their places. Submissions due moved to the bottom. 236 tests pass.

### 2026-10-21 — won to date — Linux
- Done: the Win rate card is replaced by Won to date: the count of won opportunities and their estimated value per currency. The KPI row now has three cards. 237 tests pass.

### 2026-10-21 — customer chart — Linux
- Done: Open opportunities by customer, in the chart row beside Health and BU. Top 8 by count, each with its value per currency. 240 tests pass.

### 2026-10-21 — chart links — Linux
- Done: dashboard health, BU, customer and submission-month charts, and the wins page, link to the opportunities list. New list filters: submit_month (YYYY-MM), closed_year (YYYY), and bu=none (no BU). A dashboard tag-balance bug (an extra closing div left by the KPI edit) is fixed. 246 tests pass.
- Not checked in a browser yet: the look of the chart links.

### 2026-10-22 — pipeline export — Linux
- Done: Export pipeline (dashboard and opportunities list) makes a Pipeline sheet with the 12 headers asked for, in order. Mapping: Vertical is the customer industry; Sales/ ARM is the sales owner; Close Month is the closed date, or the expected decision date when open; TCV is the estimated value in millions of the opportunity currency (no conversion); Tenure is duration in years; Remarks is the next action. 249 tests pass.
- Open question: confirm the TCV currency and the Remarks and Vertical choices.

### 2026-10-22 — recently updated: next step and hover summary — Linux
- Done: Recently updated has a Next step column (with its due date). Hovering a row shows a summary: the ID and title, customer, stage and status, sales and presales owners, value and probability, next step, submission due, health reasons, and the first 200 characters of the description. The summary is a native browser tooltip. 252 tests pass.
- Not checked in a browser: how the tooltip looks (headless screenshots cannot show it).

### 2026-10-22 — pipeline as JSON — Linux
- Done: Export pipeline (dashboard and list) opens a page with the pipeline as JSON, keyed by the twelve headers in order, with a Copy button as on the weekly report. Download Excel stays on that page. 253 tests pass.

### 2026-10-22 — EUR only — Linux
- Done: every value is EUR. The currency list is EUR only, the currency choice is gone from the opportunity form, and the currency list is gone from Settings. A file that says USD or GBP loads as EUR (the amount is kept) and is written as EUR on its next save. 256 tests pass.

### 2026-10-22 — last updated column — Linux
- Done: Recently updated has a Last updated column, showing the date the opportunity was last saved. 257 tests pass.
- Note: the running server must be restarted to show new pages (see the earlier message about a stale process).

### 2026-10-22 — PWA — Linux
- Done: Work Tracker can be installed from Chrome or Chromium on Ubuntu. Manifest, two PNG icons (generated by scripts/make-icons.mjs), a service worker that caches only the static files, and the page head links. Chrome reports no installability errors and the worker registers. README has install steps. 261 tests pass.
- Not checked: installing on a real Ubuntu desktop (headless Chrome only reports installability).

### 2026-10-22 — app icon — Linux
- Done: new icon, a white W on a rounded blue square. The source is app/public/icon.svg (flat vector), and the PNGs for the install are generated from the same drawing by scripts/make-icons.mjs. The SVG is the browser tab icon.
