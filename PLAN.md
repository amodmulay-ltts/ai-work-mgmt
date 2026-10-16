# Work Tracker — Implementation Spec

> **For the implementing model:** read this whole document before writing any code. It is the single source of truth. When something is not specified, choose the simplest option that fits the rest of the spec, and note the choice in `NOTES.md`. Do not add features, libraries or services that are not listed here.

---

## 0. Rules for the implementing model

1. **Build in phase order** (§13). Finish a phase and pass its checks before starting the next one.
2. **Stack is fixed:** Python 3.11+, FastAPI, Jinja2, Pydantic v2, openpyxl, uvicorn. Do **not** add:
   - JavaScript frameworks (React, Vue, HTMX, Alpine), CSS frameworks (Tailwind, Bootstrap, Pico) or chart libraries
   - a database (SQLite, Postgres) or an ORM
   - Docker or Node
3. **No external network assets.** No CDNs and no web fonts. Everything the browser loads comes from `app/static/`. The app must work fully offline and behind a corporate proxy.
4. **All git calls go through `app/gitsync.py`.** Never use `git add -A`, `git add .` or `git push --force`. Never auto-commit anything outside `data/`.
5. **All data access goes through `app/store.py`.** Routes never read or write files directly.
6. **Cross-platform.** All code must work on Windows and Linux:
   - Use `pathlib.Path` everywhere.
   - Never hard-code `/` or `\`.
   - Never call shell builtins. Always call `subprocess.run([...], shell=False)`.
7. **Type hints on every function.** Keep functions short. Add a docstring wherever behaviour is not obvious.
8. After each phase: run `pytest`, start the app with `./start.sh`, and click through the pages in that phase's checks.

---

## 1. What we are building

A personal web app, used by one presales/solutions person at a time, for tracking RFQs/deals, customers and people. It runs locally in the browser at `http://127.0.0.1:8765`.

- **One command to start.** After `git clone`, run `./start.sh` (Linux/macOS) or `start.bat` (Windows). The script sets everything up and opens the browser.
- **The data lives in the repo.** Every record is one JSON file under `data/`.
- **Automatic versioning.** Every save becomes a git commit, and commits are pushed to the enterprise git remote automatically.
- **Multi-laptop.** The same repo can be used from a Windows laptop and a Linux machine. Data syncs through the remote.
- **Remote repository:** `https://github.com/amodmulay-ltts/ai-work-mgmt.git` (remote name `origin`, branch `main`). This repo holds both the code and the data.

**Out of scope:** user accounts and login, multi-user editing, C4C API integration or links (the C4C ID is plain text), currency conversion / FX rates, file attachments (store links only), a mobile layout, email sending, importing existing Excel data.

---

## 2. Repository layout (create exactly this)

```
ai-work-mgmt/
├── start.sh                  # Linux/macOS launcher (must be executable, LF line endings)
├── start.bat                 # Windows launcher (CRLF line endings)
├── run.py                    # cross-platform bootstrap: venv, deps, git checks, starts server
├── requirements.txt          # runtime deps
├── requirements-dev.txt      # pytest, httpx
├── .gitignore
├── .gitattributes
├── PLAN.md                   # this file
├── NOTES.md                  # implementer's decisions log
├── README.md                 # short: what it is, how to start, how sync works
├── app/
│   ├── __init__.py
│   ├── main.py               # create_app(), routes, lifespan
│   ├── models.py             # Pydantic models + enums
│   ├── config_defaults.py    # DEFAULT_CONFIG dict (see §5.4)
│   ├── store.py              # Store class: load/save/delete, ids, atomic writes, in-memory index
│   ├── gitsync.py            # GitSync class: commit, pull/merge, push worker, status
│   ├── metrics.py            # pure functions: age, health, buckets, pipeline totals
│   ├── forms.py              # parse form data -> model dicts, validation, auto-create people/customers
│   ├── history.py            # diff two Deal objects -> list[HistoryEntry] + commit summary
│   ├── export.py             # Excel export
│   ├── report.py             # weekly report (phase 3)
│   ├── filters.py            # Jinja filters: fmt_date, rel_days, money, money_compact
│   ├── templates/
│   │   ├── base.html
│   │   ├── _macros.html
│   │   ├── dashboard.html
│   │   ├── deals/list.html, deals/detail.html, deals/form.html
│   │   ├── customers/list.html, customers/detail.html, customers/form.html
│   │   ├── people/list.html, people/form.html
│   │   ├── settings.html
│   │   ├── conflicts.html
│   │   ├── report_weekly.html
│   │   └── error.html
│   └── static/
│       ├── app.css
│       └── app.js
├── data/                     # created on first run if missing; this is the versioned data
│   ├── config.json
│   ├── deals/DL-2026-0001.json ...
│   ├── customers/CU-0001.json ...
│   ├── people/PE-0001.json ...
│   └── _conflicts/           # only exists when a sync conflict happened
└── tests/
    ├── conftest.py
    ├── test_store.py
    ├── test_gitsync.py
    ├── test_metrics.py
    ├── test_history.py
    └── test_routes.py
```

### 2.1 `requirements.txt`
```
fastapi>=0.115
uvicorn>=0.30
jinja2>=3.1
python-multipart>=0.0.9
pydantic>=2.7
openpyxl>=3.1
```

### 2.2 `requirements-dev.txt`
```
-r requirements.txt
pytest>=8
httpx>=0.27
```

### 2.3 `.gitignore`
```
.venv/
__pycache__/
*.pyc
.pytest_cache/
*.tmp
.DS_Store
Thumbs.db
```

### 2.4 `.gitattributes` (important for Windows + Linux on the same repo)
```
* text=auto
*.json text eol=lf
*.py   text eol=lf
*.sh   text eol=lf
*.bat  text eol=crlf
*.md   text eol=lf
*.html text eol=lf
*.css  text eol=lf
*.js   text eol=lf
```

After creating `start.sh`, run `git update-index --chmod=+x start.sh` so it is executable on clone.

---

## 3. Launchers and bootstrap

All real logic lives in `run.py`. The shell scripts only find Python and hand over to it.

### 3.1 `start.sh` (use exactly this)
```sh
#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1; then
    exec "$c" run.py "$@"
  fi
done
echo "Python 3.11 or newer is required. Install it and run ./start.sh again."
exit 1
```

### 3.2 `start.bat` (use exactly this)
```bat
@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 run.py %*
  goto :end
)
where python >nul 2>nul
if %errorlevel%==0 (
  python run.py %*
  goto :end
)
echo Python 3.11 or newer is required. Install it from https://www.python.org/downloads/
pause
exit /b 1
:end
set rc=%errorlevel%
if not "%rc%"=="0" pause
exit /b %rc%
```

### 3.3 `run.py` behaviour

`run.py` uses **only the standard library** until it is running inside the venv. Before the version check, the code must stay compatible with old Python versions (no `match`, no `X | Y` type hints).

1. **Version check:** if `sys.version_info < (3, 11)`, print `Python 3.11+ required, found X.Y` and exit with code 1.
2. **Arguments** (`argparse`):
   - `--port INT` (default 8765)
   - `--no-browser`
   - `--offline` (skip all git network operations)
   - `--inside-venv` (internal flag)
3. **If not inside the venv** (no `--inside-venv` flag):
   1. Venv directory: `ROOT/.venv`. Interpreter: `.venv/Scripts/python.exe` on Windows (`os.name == "nt"`), `.venv/bin/python` otherwise.
   2. If the venv is missing, create it with `python -m venv .venv` and print `Creating virtual environment...`.
   3. Compute the SHA-256 of `requirements.txt`. If it differs from the contents of `.venv/.requirements.sha256` (or that file is missing):
      - print `Installing dependencies...`
      - run `<venv python> -m pip install --disable-pip-version-check -r requirements.txt`
      - on success, write the hash file. On failure, print the hint: `If you are behind a proxy, set HTTPS_PROXY or configure pip.conf / pip.ini`, then exit 1.
   4. Re-run itself as `subprocess.call([venv_python, "run.py", "--inside-venv", *original_args])` and exit with its return code. Use `subprocess`, not `os.exec*`, because exec behaves badly on Windows.
4. **Inside the venv:**
   1. **Git checks:**
      - `git --version` must succeed and report ≥ 2.30. Otherwise print an error and exit 1.
      - If `ROOT/.git` does not exist: run `git init -b main` and print a warning that no remote is configured.
      - If no `origin` remote is configured, print this hint (but keep running): `No git remote configured. To enable sync run: git remote add origin https://github.com/amodmulay-ltts/ai-work-mgmt.git`
      - If `git config user.name` or `git config user.email` is empty: ask for them in the terminal with `input()` and store them with `git config user.name ...` (repo-local).
   2. Ensure `data/`, `data/deals`, `data/customers` and `data/people` exist. If `data/config.json` is missing, write `DEFAULT_CONFIG` to it and commit it through `GitSync.commit(["data/config.json"], "config: initial defaults")`.
   3. **Startup pull** (unless `--offline` or there is no remote): call `GitSync.pull(interactive=True)`, which lets git ask for credentials in the terminal the first time.
      - Print `Synced with remote` on success, or `Sync failed: <msg> — continuing offline` on failure.
      - Never exit because of a sync failure.
   4. **Choose a port:** try `--port` through `--port + 10` and pick the first one where `socket.bind(("127.0.0.1", p))` succeeds.
   5. **Open the browser:** unless `--no-browser`, start a daemon thread that waits until the port accepts connections (poll every 0.25 s, for up to 15 s), then calls `webbrowser.open(f"http://127.0.0.1:{port}")`.
   6. **Start the server:** `uvicorn.run(create_app(ROOT, sync_enabled=not offline), host="127.0.0.1", port=port, log_level="warning")`. Print `Work Tracker running at http://127.0.0.1:{port} — press Ctrl+C to stop`.
   7. **Ctrl+C:** uvicorn triggers the FastAPI lifespan shutdown, which calls `GitSync.flush()` (§6.5).

---

## 4. Domain rules

### 4.1 Stages (fixed defaults; stored in config and not editable in the UI)

| # | Stage | Default probability % | Terminal | Outcome |
|---|---|---|---|---|
| 1 | Lead | 5 | no | – |
| 2 | Qualified | 10 | no | – |
| 3 | RFI | 15 | no | – |
| 4 | RFQ Received | 25 | no | – |
| 5 | Solutioning | 35 | no | – |
| 6 | Proposal Submitted | 50 | no | – |
| 7 | Clarification / Negotiation | 70 | no | – |
| 8 | Won | 100 | yes | won |
| 9 | Lost | 0 | yes | lost |
| 10 | Dropped | 0 | yes | dropped |

### 4.2 Status (calculated, never stored)

- `stage` is terminal → status is `Won`, `Lost` or `Dropped`.
- Otherwise, if `on_hold` is true → status is `On Hold`.
- Otherwise → status is `Open`.

### 4.3 Automatic behaviours when a deal is saved

| Trigger | Effect |
|---|---|
| Stage changes | `probability` is set to the new stage's default. The user can still edit it afterwards. |
| Stage becomes `Proposal Submitted` and `submitted_on` is empty | `submitted_on = today` |
| Stage becomes terminal and `closed_on` is empty | `closed_on = today` |
| Stage moves from terminal back to non-terminal | `closed_on = None` and `outcome_reason = None` |
| New deal and `presales_owner` is empty | Defaults to `config.me_person_id` |
| New deal and `received_on` is empty | `received_on = today` |

### 4.4 Validation (show the errors on the form and keep the user's input)

- **Required:** `title`, `customer`, `type`, `stage`, `received_on`.
- **Date order:** `submission_due` must be ≥ `received_on` when both are set, and the same applies to `qa_due`.
- **Lost/Dropped:** `outcome_reason` is required when the stage is `Lost` or `Dropped`.
- **Ranges:**
  - `probability` is an integer from 0 to 100.
  - `est_value`, `effort_person_months` and `duration_months` must be ≥ 0 when set.
- **Links:** each URL must start with `http://` or `https://`.
- **Duplicate C4C ID:** if another deal has the same `c4c_id` (case-insensitive, trimmed), **save anyway** but show a warning: `Warning: C4C ID 1234 is also used by DL-2026-0003`.

### 4.5 Auto-create people and customers (so you can start from an empty system)

Owner fields and the customer field on the deal form are text inputs backed by a `<datalist>` of existing names. On save:

- **Customer field:** match the trimmed, case-insensitive name against existing customers. If nothing matches, create a new `Customer` with that name. Store `customer_id` on the deal.
- **Sales / Presales / Delivery owner:** match against existing people. If nothing matches, create a `Person` with role `Sales`, `Presales` or `Delivery` to match the field.
- **Customer contacts:** a textarea with one name per line. Each name is matched against people with role `Customer`. If nothing matches, create a person with `role="Customer"` and `customer_id` set to the deal's customer.
- **Commits:** auto-created records are written and committed in the **same commit** as the deal (§6.3: `commit(paths=[...all files...], message)`).
- **Flash message:** append the created names, e.g. `Saved · created customer "Bosch", person "Ravi K"`.

### 4.6 IDs

| Entity | Format | Example |
|---|---|---|
| Deal | `DL-{YYYY}-{NNNN}` (YYYY = year of creation, counter per year) | `DL-2026-0014` |
| Customer | `CU-{NNNN}` | `CU-0003` |
| Person | `PE-{NNNN}` | `PE-0021` |

- **Next number:** 1 + the highest existing number for that prefix, found by scanning filenames.
- **Before creating** a deal, customer or person, call `GitSync.pull()` (non-interactive, best effort, ignore failures). This avoids ID collisions between laptops. If a collision still happens, conflict handling (§6.4) preserves both versions.

---

## 5. Data model

### 5.1 `app/models.py`

Implement the following (Pydantic v2):

```python
from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, Field

class Link(BaseModel):
    label: str
    url: str

class HistoryEntry(BaseModel):
    at: datetime                      # local time with UTC offset, e.g. 2026-10-16T10:43:00+05:30
    kind: Literal["created", "stage", "hold", "field", "note"]
    text: str                         # human readable, e.g. "Submission due: 20 Oct 2026 → 24 Oct 2026"
    from_value: str | None = None
    to_value: str | None = None

class Deal(BaseModel):
    schema_version: int = 1
    id: str
    title: str
    type: str                         # one of config.deal_types
    source: str | None = None         # one of config.sources
    description: str = ""             # scope summary, multi-line
    customer_id: str
    contact_ids: list[str] = Field(default_factory=list)
    c4c_id: str | None = None         # LTTS C4C opportunity ID
    sales_owner_id: str | None = None
    presales_owner_id: str | None = None
    delivery_owner_id: str | None = None
    bu: str | None = None             # config.business_units
    practice: str | None = None       # free text with datalist of previously used values
    region: str | None = None         # config.regions
    stage: str
    on_hold: bool = False
    probability: int = Field(ge=0, le=100)
    priority: Literal["High", "Medium", "Low"] = "Medium"
    go_no_go: Literal["Pending", "Go", "No-Go"] = "Pending"
    go_no_go_on: date | None = None
    received_on: date
    qa_due: date | None = None        # customer clarification questions due
    submission_due: date | None = None
    submitted_on: date | None = None
    expected_decision_on: date | None = None
    expected_start_on: date | None = None
    closed_on: date | None = None
    currency: str = "USD"             # config.currencies
    est_value: float | None = None    # total contract value estimate, in `currency`
    effort_person_months: float | None = None
    duration_months: float | None = None
    pricing_model: str | None = None  # config.pricing_models
    incumbent: str | None = None
    competitors: list[str] = Field(default_factory=list)
    outcome_reason: str | None = None # config.outcome_reasons; required for Lost/Dropped
    next_action: str | None = None
    next_action_due: date | None = None
    tags: list[str] = Field(default_factory=list)
    links: list[Link] = Field(default_factory=list)
    history: list[HistoryEntry] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

class Customer(BaseModel):
    schema_version: int = 1
    id: str
    name: str
    short_name: str | None = None
    industry: str | None = None
    region: str | None = None
    country: str | None = None
    bu: str | None = None
    account_manager_id: str | None = None   # a Person with role Sales
    c4c_account_id: str | None = None
    website: str | None = None
    tags: list[str] = Field(default_factory=list)
    notes: str = ""
    created_at: datetime
    updated_at: datetime

Role = Literal["Sales", "Presales", "Delivery", "Leadership", "Customer", "Partner", "Other"]

class Person(BaseModel):
    schema_version: int = 1
    id: str
    name: str
    role: Role
    title: str | None = None
    email: str | None = None
    phone: str | None = None
    customer_id: str | None = None    # set when role == "Customer"
    notes: str = ""
    active: bool = True
    created_at: datetime
    updated_at: datetime
```

### 5.2 File format rules

- **One record per file:** `data/<folder>/<id>.json`.
- **Serialise with** `model.model_dump(mode="json")` and then `json.dumps(obj, indent=2, ensure_ascii=False) + "\n"`. Keep fields in model order and don't sort keys, so diffs stay stable.
- **Encoding:** always read and write UTF-8 (pass `encoding="utf-8"` explicitly; Windows does not default to it). Use LF newlines (`newline="\n"` when writing).
- **Atomic writes:** write to `<file>.tmp` in the same folder, then call `os.replace(tmp, final)`.
- **Timestamps:** `datetime.now().astimezone().replace(microsecond=0)`.

### 5.3 Example deal file

```json
{
  "schema_version": 1,
  "id": "DL-2026-0014",
  "title": "ADAS validation services – Phase 2",
  "type": "RFQ",
  "source": "Customer RFQ",
  "description": "HIL test bench support for L2+ features, 3 sites.",
  "customer_id": "CU-0003",
  "contact_ids": ["PE-0012"],
  "c4c_id": "4589123",
  "sales_owner_id": "PE-0002",
  "presales_owner_id": "PE-0001",
  "delivery_owner_id": null,
  "bu": "Mobility",
  "practice": "ADAS & Autonomous",
  "region": "Europe",
  "stage": "Solutioning",
  "on_hold": false,
  "probability": 35,
  "priority": "High",
  "go_no_go": "Go",
  "go_no_go_on": "2026-10-02",
  "received_on": "2026-09-28",
  "qa_due": "2026-10-05",
  "submission_due": "2026-10-24",
  "submitted_on": null,
  "expected_decision_on": "2026-11-30",
  "expected_start_on": "2027-01-15",
  "closed_on": null,
  "currency": "EUR",
  "est_value": 1250000,
  "effort_person_months": 96,
  "duration_months": 18,
  "pricing_model": "T&M",
  "incumbent": "Competitor A",
  "competitors": ["Competitor A", "Competitor B"],
  "outcome_reason": null,
  "next_action": "Review effort estimate with delivery",
  "next_action_due": "2026-10-18",
  "tags": ["HIL", "ADAS"],
  "links": [{"label": "SharePoint folder", "url": "https://ltts.sharepoint.com/..."}],
  "history": [
    {"at": "2026-09-28T09:12:00+05:30", "kind": "created", "text": "Deal created", "from_value": null, "to_value": null},
    {"at": "2026-10-02T15:40:00+05:30", "kind": "stage", "text": "Stage: RFQ Received → Solutioning", "from_value": "RFQ Received", "to_value": "Solutioning"}
  ],
  "created_at": "2026-09-28T09:12:00+05:30",
  "updated_at": "2026-10-02T15:40:00+05:30"
}
```

### 5.4 `app/config_defaults.py` → `DEFAULT_CONFIG`

```json
{
  "schema_version": 1,
  "me_person_id": null,
  "stale_after_days": 14,
  "push_delay_seconds": 30,
  "stages": [
    {"name": "Lead", "probability": 5, "terminal": false, "outcome": null},
    {"name": "Qualified", "probability": 10, "terminal": false, "outcome": null},
    {"name": "RFI", "probability": 15, "terminal": false, "outcome": null},
    {"name": "RFQ Received", "probability": 25, "terminal": false, "outcome": null},
    {"name": "Solutioning", "probability": 35, "terminal": false, "outcome": null},
    {"name": "Proposal Submitted", "probability": 50, "terminal": false, "outcome": null},
    {"name": "Clarification / Negotiation", "probability": 70, "terminal": false, "outcome": null},
    {"name": "Won", "probability": 100, "terminal": true, "outcome": "won"},
    {"name": "Lost", "probability": 0, "terminal": true, "outcome": "lost"},
    {"name": "Dropped", "probability": 0, "terminal": true, "outcome": "dropped"}
  ],
  "deal_types": ["RFI", "RFQ", "RFP", "Proactive Proposal", "Change Request", "Renewal / Extension"],
  "sources": ["Customer RFQ", "Sales lead", "Account mining", "Partner", "Inbound / Website", "Other"],
  "business_units": ["Mobility", "Sustainability", "Hi-Tech"],
  "regions": ["North America", "Europe", "UK", "India", "APAC", "Japan", "Middle East"],
  "pricing_models": ["T&M", "Fixed Price", "Managed Capacity", "ODC", "Hybrid"],
  "currencies": ["USD", "EUR", "GBP", "INR", "JPY"],
  "outcome_reasons": ["Price", "Technical fit", "Relationship / incumbent", "Timeline", "Customer cancelled", "Scope changed", "No-Go decision", "Other"]
}
```

- **C4C ID** is a static text identifier. It is never a link. Show it as plain monospace text with a copy button next to it.
- **Currencies are never converted.** There are no FX rates. Every total is grouped by currency (§8, "Money totals").
- **Missing config keys:** when loading config, merge it over `DEFAULT_CONFIG` so that keys added later get default values.

---

## 6. Git sync (`app/gitsync.py`)

### 6.1 Class

```python
class GitSync:
    def __init__(self, repo: Path, enabled: bool = True, push_delay: int = 30): ...
    def has_remote(self) -> bool                    # `git remote get-url origin` succeeds
    def branch(self) -> str | None                  # `git rev-parse --abbrev-ref HEAD`; None if "HEAD" (detached)
    def commit(self, paths: list[Path], message: str) -> bool   # True if a commit was made
    def pull(self, interactive: bool = False) -> PullResult     # fetch + merge + conflict handling
    def schedule_push(self) -> None                 # (re)arm push timer
    def push_now(self) -> bool
    def start_worker(self) -> None                  # background push thread
    def flush(self, timeout: float = 20) -> None    # final push on shutdown
    def status(self) -> SyncStatus                  # for UI badge
```

- **`PullResult`** (dataclass): `ok: bool`, `changed: bool`, `conflicts: list[str]`, `error: str | None`.
- **`SyncStatus`** (dataclass): `state` (one of `"synced"`, `"pending"`, `"error"`, `"local"`, `"offline"`), `unpushed: int`, `last_error: str | None`, `last_push_at: datetime | None`.

### 6.2 Running git

- **Single helper:** `_git(*args, interactive=False, timeout=60) -> subprocess.CompletedProcess`, which runs `["git", *args]` with `cwd=repo`, `capture_output=True`, `text=True` and `encoding="utf-8"`.
- **Non-interactive calls:** set `GIT_TERMINAL_PROMPT=0` in the env so git can't hang waiting for credentials. (Git Credential Manager on Windows may still show its own GUI, which is fine.)
- **Locking:** every git call is guarded by one `threading.RLock`, shared with `Store` writes (see §7).

### 6.3 `commit(paths, message)`

1. Every path must be inside `data/`. Otherwise raise `ValueError`.
2. `git add -- <paths...>`. Deletions are covered too: `git add` stages removals of paths that were deleted.
3. If `git diff --cached --quiet -- <paths...>` exits 0, nothing changed: return False.
4. `git commit -m "<message>" -- <paths...>`. The pathspec makes sure only these files are committed, even if other files are staged.
5. Call `schedule_push()` and return True.

**Commit message formats:**

| Event | Message |
|---|---|
| Create | `DL-2026-0014: created – ADAS validation services – Phase 2` |
| Stage change | `DL-2026-0014: stage Solutioning → Proposal Submitted` |
| Edit of one field | `DL-2026-0014: submission due 2026-10-20 → 2026-10-24` |
| Edit of several fields | `DL-2026-0014: updated 3 fields` |
| Note | `DL-2026-0014: note added` |
| Delete | `DL-2026-0014: deleted` |
| Customer / person changes | `CU-0003: created – Bosch`, `PE-0002: updated` |
| Config | `config: updated settings` |
| Sync merge | `sync: merge remote changes` (`sync: merge remote changes (2 conflicts saved)` when there were conflicts) |

### 6.4 `pull()`: fetch, merge, conflict handling

```
if not enabled or not has_remote(): return PullResult(ok=True, changed=False)
b = branch(); if b is None: return error "Detached HEAD – checkout a branch"
git fetch origin                                  (fail -> return error, ok=False)
if `git rev-parse --verify origin/<b>` fails:     (remote branch doesn't exist yet, e.g. empty repo)
    return ok=True, changed=False
old = git rev-parse HEAD
git merge --no-edit --autostash origin/<b>
if merge succeeded:
    changed = (git rev-parse HEAD) != old
    return ok=True, changed
# merge has conflicts
conflicted = `git diff --name-only --diff-filter=U` lines
if any path does not start with "data/":
    git merge --abort
    return ok=False, error="Code conflict in <paths> – resolve manually with git"
for path in conflicted:
    theirs = `git show :3:<path>`        (may fail if remote deleted it)
    ours_exists = `git cat-file -e :2:<path>` succeeds
    if theirs succeeded:
        write theirs to data/_conflicts/<stem>.<YYYYMMDD-HHMMSS>.theirs.json
    if ours_exists: git checkout --ours -- <path>
    else:           git checkout --theirs -- <path>      (we deleted, they edited -> keep theirs)
    git add -- <path>
git add -- data/_conflicts
git commit --no-edit -m "sync: merge remote changes (N conflicts saved)"
return ok=True, changed=True, conflicts=[...]
```

- After any pull with `changed=True`, the caller must call `store.reload()`.
- "Ours" means the local version. **The local version always wins in the file.** The remote version is never lost, because it goes to `data/_conflicts/`.

### 6.5 Push worker

- `schedule_push()` sets `self._deadline = time.monotonic() + push_delay` and signals a `threading.Event`.
- **Worker thread** (daemon): loops, waits for the event or deadline, and calls `push_now()` once the deadline has passed.
- **`push_now()`:**
  1. If the remote branch is missing, or the branch has no upstream, run `git push -u origin HEAD`. Otherwise run `git push origin HEAD`.
  2. If the push is rejected (stderr contains `rejected`, `non-fast-forward` or `fetch first`): call `pull()`, then retry the push once.
  3. **On success:** `last_error = None`, `last_push_at = now`.
  4. **On failure:** store `last_error`, schedule a retry with backoff (30 s, 60 s, 120 s, 300 s, then 600 s max), and never raise.
- **Unpushed count:** `git rev-list --count origin/<b>..HEAD`, or `git rev-list --count HEAD` if the remote branch does not exist.
- **`flush(timeout)`:** if `unpushed > 0`, call `push_now()` synchronously (with the timeout). Called from the lifespan shutdown.
- **Status mapping** (checked in this order):
  - `offline`: sync disabled via `--offline`
  - `local`: no remote configured
  - `error`: `last_error` is set
  - `pending`: `unpushed > 0`
  - `synced`: otherwise

---

## 7. Store (`app/store.py`)

```python
class Store:
    def __init__(self, root: Path, git: GitSync): ...   # root = repo root; data dir = root/"data"
    lock: threading.RLock                                # = git.lock (GitSync owns the RLock; Store reuses it)
    def load_all(self) -> None          # read all files into dicts: deals, customers, people, config
    def reload(self) -> None            # = load_all()
    problems: list[str]                 # files that failed to parse; shown as a banner, never crash
    # config
    def config(self) -> dict
    def save_config(self, cfg: dict, message: str = "config: updated settings") -> None
    # generic
    def next_id(self, kind: Literal["deal", "customer", "person"]) -> str
    # deals
    def list_deals(self) -> list[Deal]
    def get_deal(self, id: str) -> Deal | None
    def save(self, records: list[Deal | Customer | Person], message: str) -> None   # writes all, ONE commit
    def delete(self, record: Deal | Customer | Person, message: str) -> None
    # customers / people
    def list_customers(self) -> list[Customer]; def get_customer(self, id) -> Customer | None
    def list_people(self) -> list[Person];      def get_person(self, id) -> Person | None
    def find_customer_by_name(self, name: str) -> Customer | None    # trimmed, case-insensitive
    def find_person_by_name(self, name: str) -> Person | None
    def stage_names(self) -> list[str]; def stage(self, name) -> dict
```

- **`save()`:** under `lock`, for each record:
  1. set `updated_at`
  2. atomic write
  3. update the in-memory dict
  
  Then call `git.commit([all paths], message)`.
- **`delete()`:**
  - Removes the file and calls `git.commit([path], message)`.
  - Refuses to delete a **customer** that has deals (raise `ValueError("Customer has N deals")`).
  - Refuses to delete a **person** who is referenced by any deal or customer (raise `ValueError`). The UI offers "Mark inactive" instead.
- **Loading:** ignore `data/_conflicts/` and any `*.tmp` file. A file that fails validation is added to `problems` and skipped.

---

## 8. Metrics (`app/metrics.py`; pure functions, fully unit-tested)

All functions take `today: date` as a parameter (never call `date.today()` inside), which makes them testable.

| Function | Definition |
|---|---|
| `status(deal, cfg)` | §4.2 |
| `is_open(deal, cfg)` | stage not terminal (on-hold deals count as open) |
| `age_days(deal, today)` | `(closed_on or today) - received_on`, in days |
| `days_in_stage(deal, today)` | `today - date of last history entry with kind=="stage"` (or `created_at.date()` if there is none) |
| `days_to_submission(deal, today)` | `submission_due - today` if `submission_due` is set and `submitted_on` is None; else None. A negative value means overdue. |
| `is_stale(deal, cfg, today)` | open, not on hold, and `today - updated_at.date() > cfg.stale_after_days` |
| `weighted_value(deal)` | `est_value * probability / 100`, in the deal's own currency (None if there is no value) |
| `aging_bucket(deal, today)` | `"0–30"`, `"31–60"`, `"61–90"` or `"90+"` from `age_days` |
| `health(deal, cfg, today) -> (level, reasons)` | see below |

**Health levels:**

- **Not open** → `("closed", [])`.
- **On hold** → `("hold", ["On hold"])`.
- **`red`** if any of these:
  - the submission is overdue: `"Submission overdue by Nd"`
  - `next_action_due` is more than 3 days in the past: `"Next action overdue by Nd"`
  - the deal is stale: `"No activity for Nd"`
- **`amber`** if any of these:
  - submission is due in 0–3 days: `"Submission due in Nd"` (or `"Submission due today"`)
  - `next_action_due` is today or in the past (0–3 days ago): `"Next action due"`
  - `next_action` is empty: `"No next action"`
- **`green`** otherwise, with no reasons.
- Collect **all** reasons that apply. The level is the most severe one.

**Dashboard aggregates:**

- **Money totals:** `money_totals(pairs: list[tuple[str, float | None]], cfg) -> dict[str, float]` sums the amounts **per currency** and skips None values. Keys are ordered by `config.currencies`; unknown currencies go last, alphabetically. Templates render the result with the macro `money_totals` as `EUR 1.2M · USD 3.0M`, or `—` when it is empty. **Never add amounts in different currencies together.**
- `pipeline_by_stage(deals, cfg)`: for each non-terminal stage, the `count` and `totals` (= `money_totals` of `est_value`) of open deals. Bar widths are based on `count`.
- `aging_counts(deals, today)`: counts per bucket for open deals.
- `win_stats(deals, today, days=90)`: won and lost counts among deals with `closed_on` in the last 90 days. `win_rate = won / (won + lost)`, or None if both are 0.

---

## 9. History (`app/history.py`)

`diff(old: Deal | None, new: Deal, people, customers) -> tuple[list[HistoryEntry], str]`

Returns the history entries and the commit summary.

- **`old is None`:** one entry, `kind="created"`, text `"Deal created"`.
- **`stage` changed:** an entry with `kind="stage"` and text `"Stage: A → B"`.
- **`on_hold` changed:** an entry with `kind="hold"` and text `"Put on hold"` or `"Resumed"`.
- **Any other field changed** (except `history`, `updated_at` and `created_at`):
  - one entry with `kind="field"` and text `"<Label>: <old> → <new>"`
  - display values for the text: names for ID fields, `16 Oct 2026` for dates, `—` for None, comma-joined lists
  - for `description`, use `"Description updated"` instead of showing the values
- Field labels come from one dict `FIELD_LABELS` (e.g. `submission_due → "Submission due"`). Reuse it for the form labels.
- **Commit summary:**
  - created: `created – <title>`
  - only a stage change: `stage A → B`
  - exactly one field: `<label lowercase> <old> → <new>`
  - otherwise: `updated N fields`
- **Notes:** `POST /deals/{id}/notes` appends `HistoryEntry(kind="note", text=<note>)`. The commit summary is `note added`.

---

## 10. Routes (`app/main.py`)

- `create_app(root: Path, sync_enabled: bool = True) -> FastAPI` builds `GitSync` and `Store` and keeps them on `app.state`.
- **Lifespan:**
  - startup: `store.load_all()` and `git.start_worker()`
  - shutdown: `git.flush()`
- **Routes:** `async def` routes that use `await request.form()` for POSTs. Every POST ends with a **303 redirect** (POST-redirect-GET).
- **Failed validation:** re-render the form with status 422, the errors and the submitted values.
- **Flash messages:** a cookie named `flash`, holding URL-encoded JSON `{"kind": "success"|"warning"|"error", "text": "..."}`. It is set on redirect, then read and deleted by the next page render.

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Dashboard |
| GET | `/deals` | List. Query parameters: `q`, `status` (default `open`; values `open`, `hold`, `won`, `lost`, `dropped`, `closed`, `all`), `stage`, `customer`, `owner` (matches sales, presales or delivery), `bu`, `priority`, `health`, `sort`, `dir` |
| GET | `/deals/new` | New deal form. `?customer=CU-…` pre-fills the customer. |
| POST | `/deals` | Create → redirect to `/deals/{id}` |
| GET | `/deals/{id}` | Detail |
| GET | `/deals/{id}/edit` | Edit form |
| POST | `/deals/{id}` | Update |
| POST | `/deals/{id}/stage` | Quick stage change. Form fields: `stage`, plus `outcome_reason` when Lost/Dropped. |
| POST | `/deals/{id}/hold` | Toggle on hold |
| POST | `/deals/{id}/next-action` | Update `next_action` and `next_action_due` only |
| POST | `/deals/{id}/notes` | Add a note |
| POST | `/deals/{id}/delete` | Delete → `/deals` |
| GET | `/customers`, `/customers/new`, `/customers/{id}`, `/customers/{id}/edit` | Customer pages |
| POST | `/customers`, `/customers/{id}`, `/customers/{id}/delete` | Customer actions |
| GET | `/people`, `/people/new`, `/people/{id}/edit` | People pages. The people list links straight to edit; there is no separate detail page. |
| POST | `/people`, `/people/{id}`, `/people/{id}/delete`, `/people/{id}/deactivate` | People actions |
| GET / POST | `/settings` | View and edit "me" (name + email), stale days, and the BU / region / currency / pricing / source / outcome lists (one item per line in textareas). Stages are shown read-only. |
| GET | `/conflicts` | Lists files in `data/_conflicts/`, each next to the current local version |
| POST | `/conflicts/{filename}/resolve` | Form field `action`: `keep_mine` (delete the conflict file) or `use_theirs` (overwrite the record with the conflict file, then delete it). One commit. |
| GET | `/export/deals.xlsx` | Excel export of the current `/deals` filter (same query parameters) |
| GET | `/api/sync/status` | JSON from `SyncStatus` |
| POST | `/sync` | `pull()`, then `push_now()`, then `reload` if changed → redirect back (`Referer`) with a flash message |
| GET | `/report/weekly` | Phase 3 (§12) |

**Search `q`:** case-insensitive substring match over `id`, `title`, the customer name, `c4c_id`, `tags`, `practice` and `description`.

**Sorting:** `sort` takes one of `id`, `title`, `customer`, `stage` (by stage order), `submission_due`, `age`, `value` (sorted by currency, then by amount; no conversion), `next_action_due`, `updated`.
- Default: `submission_due` ascending, with empty values last.
- Clicking a column header toggles `dir` between `asc` and `desc`.

**Form parsing (`app/forms.py`):**
- Empty strings become None.
- `tags` and `competitors` are comma-separated text: split, trim and de-duplicate them.
- `links` is a textarea with one link per line as `Label | URL`. A line with only a URL uses the URL as its label.
- Checkboxes are absent from the form data when unchecked, so treat a missing checkbox as False.

---

## 11. UI/UX style guide (follow exactly)

### 11.1 Design principles

1. **Calm, dense, professional.** This is a data tool for daily use, like a well-made enterprise admin screen. Keep decoration to a minimum. Tables come first.
2. **What needs attention stands out.** Colour is reserved for meaning (health, stage, overdue). Everything else is neutral grey and white.
3. **Two clicks or fewer** to do any daily task: change a stage, update the next action, add a note.
4. **Never lose input.** Validation errors keep the values the user typed. The edit form warns before you navigate away from unsaved changes.
5. **Desktop-first.** Design for 1280–1920 px wide screens. Below 900 px, tables scroll horizontally. No mobile layout.
6. **Light theme only.**

### 11.2 Design tokens (put this at the top of `app.css` and use only these variables)

```css
:root {
  /* colour – neutrals */
  --bg: #F8FAFC;            /* page background */
  --surface: #FFFFFF;       /* cards, tables, nav */
  --surface-muted: #F1F5F9; /* table header, hover, read-only fields */
  --border: #E2E8F0;
  --border-strong: #CBD5E1;
  --text: #0F172A;
  --text-muted: #64748B;
  --text-subtle: #94A3B8;

  /* colour – brand / action */
  --primary: #1D4ED8;
  --primary-hover: #1E40AF;
  --primary-soft: #DBEAFE;
  --focus: #2563EB;

  /* colour – semantic */
  --red: #DC2626;   --red-soft: #FEE2E2;
  --amber: #D97706; --amber-soft: #FEF3C7;
  --green: #16A34A; --green-soft: #DCFCE7;
  --grey: #6B7280;  --grey-soft: #F3F4F6;

  /* typography */
  --font: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "Cascadia Mono", "SF Mono", Consolas, "Liberation Mono", monospace;
  --fs-xs: 12px; --fs-sm: 13px; --fs-base: 14px; --fs-md: 16px; --fs-lg: 20px; --fs-xl: 24px;
  --lh: 1.5;

  /* spacing (4px scale) */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px;

  /* shape */
  --radius-sm: 4px; --radius: 6px; --radius-lg: 10px;
  --shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  --shadow-pop: 0 8px 24px rgba(15, 23, 42, 0.12);

  /* layout */
  --nav-h: 56px;
  --content-max: 1440px;
}
```

**Base styles:**
- `body`: font `var(--font)` at `var(--fs-base)`, line-height `var(--lh)`, colour `var(--text)`, background `var(--bg)`, margin 0.
- Headings:
  - `h1`: 20px, weight 600, margin `0 0 var(--s4)`
  - `h2`: 16px / 600
  - `h3`: 14px / 600, uppercase, `--text-muted`, letter-spacing 0.04em (used for section labels)
- Links: `--primary`, no underline; underline on hover.
- All numbers in tables and KPIs: `font-variant-numeric: tabular-nums`.
- IDs (`DL-2026-0014`, C4C IDs): `var(--mono)` at `var(--fs-sm)`.
- Focus (every interactive element): `outline: 2px solid var(--focus); outline-offset: 2px;`. Never remove focus outlines.

### 11.3 Stage colours (badges; background / text)

| Stage | Background | Text |
|---|---|---|
| Lead | #F1F5F9 | #475569 |
| Qualified | #E0F2FE | #0369A1 |
| RFI | #E0E7FF | #4338CA |
| RFQ Received | #EDE9FE | #6D28D9 |
| Solutioning | #FEF3C7 | #B45309 |
| Proposal Submitted | #FFEDD5 | #C2410C |
| Clarification / Negotiation | #FCE7F3 | #BE185D |
| Won | #DCFCE7 | #15803D |
| Lost | #FEE2E2 | #B91C1C |
| Dropped | #E5E7EB | #4B5563 |

- **Implementation:** define CSS classes `.stage-1` through `.stage-10`, numbered by stage order. The template computes the index from the stage's position in the config.
- **Unknown stage** (not in the config): use the Lead colours.

### 11.4 Components

| Component | Spec |
|---|---|
| **Top nav** | Height `--nav-h`, `--surface` background, 1px bottom border, sticky. Left: app name **"Work Tracker"** (16px/600) and nav links Dashboard · Deals · Customers · People · Settings (14px/500, `--text-muted`; active link `--text` with a 2px `--primary` bottom border). Right: sync badge, then the primary button **"+ New deal"**. |
| **Page container** | `max-width: var(--content-max)`, centred, padding `var(--s5)`. |
| **Page header** | Row: `h1` on the left, page actions on the right (buttons, gap `--s2`). Margin-bottom `--s4`. |
| **Card** | `--surface`, 1px `--border`, `--radius-lg`, `--shadow`, padding `--s4`. Card title is an `h2` with margin-bottom `--s3`. |
| **Buttons** | Height 32px, padding `0 var(--s3)`, `--radius`, 14px/500, inline-flex with gap `--s1`. **Primary:** `--primary` background, white text; hover `--primary-hover`. **Secondary:** `--surface` background, 1px `--border-strong`, `--text`; hover `--surface-muted`. **Danger:** white background, `--red` text and border; hover `--red-soft`. **Ghost:** transparent, `--text-muted`; hover `--surface-muted`. **Small variant `.btn-sm`:** height 26px, 13px. A disabled button has opacity 0.5. |
| **Inputs / selects / textarea** | Height 32px (textarea auto, min 80px), padding `0 var(--s2)`, 1px `--border-strong`, `--radius`, white background, 14px. On focus: border `--focus` plus the focus outline. Invalid fields: border `--red`, with the error text below in 12px `--red`. Label above the field: 13px/500, `--text`, margin-bottom `--s1`. Required fields have a red `*` after the label. Help text below the field: 12px `--text-muted`. |
| **Form layout** | Fieldsets drawn as cards, one per section: *Basics*, *Customer & owners*, *Dates*, *Commercials*, *Competition*, *Tracking*, *Links & notes*. Inside each, a CSS grid of 3 columns (`repeat(3, minmax(0,1fr))`, gap `--s4`). `description` and `links` span all 3 columns. A sticky footer bar at the bottom of the viewport (white, top border, padding `--s3`) holds **Save** (primary) and **Cancel** (ghost), right-aligned. |
| **Table** | Full width inside a card with 0 padding and `border-collapse: collapse`. **Header:** `--surface-muted` background, 12px/600 uppercase, `--text-muted`, letter-spacing 0.03em, sticky top (below the nav). **Rows:** 40px high, cell padding `0 var(--s3)`, 1px `--border` bottom, hover `--surface-muted`, and clicking anywhere on a row opens the deal (`data-href` plus JS). **Alignment:** numbers right-aligned; text truncated with ellipsis (`max-width` per column) and the full text in a `title` attribute. Sortable headers show ▲/▼ on the active column. |
| **Badge** | Inline-block, padding `2px 8px`, radius 999px, 12px/500, nowrap. Stage badges use §11.3. Priority badges: High = `--red-soft`/`--red`, Medium = `--amber-soft`/`--amber`, Low = `--grey-soft`/`--grey`. Status On Hold = `--grey-soft`/`--grey` with a ⏸ prefix. |
| **Health dot** | 10px circle. `green` = `--green`, `amber` = `--amber`, `red` = `--red`, `hold` = hollow (2px `--grey` border), `closed` = `--border-strong`. Always carries a `title` with the reasons joined by " · ", and a visually hidden text label for screen readers. |
| **Due date cell** | Shows the date plus relative text below it in 12px: `in 3d` (`--text-muted`), `today` (`--amber`, bold), `2d overdue` (`--red`, bold). Submitted deals show `submitted 12 Oct` in `--green`. |
| **KPI tile** | A card. Label: 12px uppercase `--text-muted`. Value: 24px/600. Sub-line: 12px `--text-muted` (red when it refers to overdue items). Four tiles in a 4-column grid. |
| **Bar (CSS chart)** | A row of label (150px) · bar track (flex, 8px high, `--surface-muted`, radius 999px) · value (right, tabular). The filled bar is `--primary`, its width a % of the maximum in the set. Used for "pipeline by stage" and "aging". |
| **Stage stepper** | On the deal detail page. Chips for the 7 non-terminal stages, then one chip for the outcome, connected by a 2px line. **Past stages:** `--primary-soft` background, `--primary` text, ✓ prefix. **Current:** `--primary` background, white text, bold. **Future:** `--surface`, `--text-subtle`, 1px `--border`. **Outcome chip:** shows "Outcome" in grey until the deal is closed, then the Won/Lost/Dropped stage colour. Each chip is a button that submits `/deals/{id}/stage`. Clicking **Lost** or **Dropped** opens a small inline form asking for the outcome reason. |
| **Timeline** | A vertical list with 1px left border line. Each entry has a 8px dot (`--primary` for stage, `--amber` for hold, `--text-subtle` for field, `--green` for note), a 12px `--text-muted` timestamp ("16 Oct 2026, 10:43"), then the text. Notes are shown in a `--surface-muted` box with `white-space: pre-wrap`. Newest first. |
| **Flash / toast** | Fixed top-right below the nav, width 360px, white, `--shadow-pop`, a 4px left border coloured by kind (`--green`, `--amber` or `--red`), padding `--s3`, close ×. Success messages hide automatically after 4 s; warnings and errors stay until closed. |
| **Banner** | Full-width strip under the nav for system problems (sync error, data file problems, unresolved conflicts). Error: `--red-soft` background and `--red` text. Warning: `--amber-soft` and `--amber`. Each banner includes a link to fix the problem, e.g. "Review conflicts". |
| **Sync badge** | Pill in the nav: dot plus text, 13px. `synced` → green dot "Synced". `pending` → amber dot "3 unpushed". `error` → red dot "Sync error" (full message in `title`). `local` → grey dot "Local only". `offline` → grey dot "Offline". Clicking it submits `POST /sync`. |
| **Empty state** | Centred inside a card, padding `--s7`, a 16px/600 title, 14px `--text-muted` text, and a primary button. Example on Deals: "No deals yet" / "Track your first RFQ or opportunity." / **+ New deal**. |
| **Definition grid** (detail view) | 3 columns. Each item: label 12px `--text-muted`, value 14px `--text`. An empty value shows `—` in `--text-subtle`. |

### 11.5 Page layouts

**Dashboard (`/`)**
```
[nav]
Good morning, <first name>                                   [Export ▾] [Sync]
┌KPI: Open deals┐┌KPI: Weighted pipeline┐┌KPI: Due in 7 days┐┌KPI: Win rate (90d)┐
│ 23            ││ EUR 1.4M              ││ 5                ││ 40%               │
│               ││ USD 2.8M              ││                  ││                   │
│ 2 on hold     ││ (one line per currency)││ 2 overdue (red)  ││ 2 won · 3 lost    │
└───────────────┘└───────────────────────┘└──────────────────┘└───────────────────┘
┌Needs attention (2/3 width)──────────────────┐┌My next actions (1/3 width)──────┐
│ ● ID  Title  Customer  Why        Next act. ││ ☐ Review effort … DL-…  today   │
│ (red first, then amber, max 10, link "All") ││ (presales = me, sorted by due)  │
└─────────────────────────────────────────────┘└─────────────────────────────────┘
┌Pipeline by stage (1/2)──────────┐┌Aging of open deals (1/2)────────┐
│ Lead          ███░░░  4  $0.3M  ││ 0–30   █████░ 12                │
│ …                               ││ 90+    ██░░░░  3                │
└─────────────────────────────────┘└─────────────────────────────────┘
┌Recently updated (full width, last 8)──────────────────────────────────┐
└───────────────────────────────────────────────────────────────────────┘
```
- **Weighted pipeline KPI:** one line per currency (from `money_totals` of `weighted_value`), at 18px/600 instead of 24px, showing at most 4 currencies and then "+N more". The sub-line is "weighted · open deals".
- **Greeting:** "Good morning/afternoon/evening" by local time. Uses `me`'s first name, or no name if `me` is unset.
- **First run** (`me_person_id` is null): show a full-width card **at the top** saying "Welcome — tell us who you are". It holds name and email inputs and a **Save** button, which creates a Presales person and sets `me_person_id`.
- **Each row in "My next actions"** has an inline ✓ button. It opens a mini-form, inline in the row, to set the new next action and its due date, posting to `/deals/{id}/next-action`.

**Deals list (`/deals`)**
```
Deals (23)                                      [Export to Excel] [+ New deal]
[🔍 Search… (/)] [Status: Open ▾] [Stage ▾] [Customer ▾] [Owner ▾] [BU ▾] [Priority ▾] [Health ▾] [Clear]
┌───────────────────────────────────────────────────────────────────────────────────────┐
│● │ ID │ Title │ Customer │ Stage │ Sales owner │ Submission due │ Age │ Value │ Next action │
└───────────────────────────────────────────────────────────────────────────────────────┘
```
- **Filters:** a GET form; each select auto-submits on change (JS).
- **Columns:** Value shows the deal's own currency, compact (`EUR 1.25M`). Age is in days. Next action shows the text truncated to 40 characters and its due date below in 12px (red when overdue).

**Deal detail (`/deals/{id}`)**
```
DL-2026-0014 [Solutioning] [High] ● health                  [Put on hold] [Edit] [⋯ Delete]
ADAS validation services – Phase 2 (h1)
Bosch · C4C 4589123 ⧉ · Sales: Priya S · Presales: Amod M
[ ✓Lead ─ ✓Qualified ─ ✓RFI ─ ✓RFQ Received ─ Solutioning ─ Proposal Submitted ─ Clar./Neg. ─ Outcome ]
┌Main (2/3)───────────────────────────────────┐┌Sidebar (1/3)──────────────────────┐
│ Card: Overview (description, type, source,  ││ Card: Key numbers                  │
│   BU, practice, region, go/no-go)           ││  Age 18d · In stage 14d            │
│ Card: Dates (definition grid)               ││  Submission in 8d · Prob. 35%      │
│ Card: Commercials                           ││  Value EUR 1.25M · wtd EUR 438K    │
│ Card: Competition                           ││ Card: Next action (inline editable)│
│ Card: Links                                 ││ Card: Add note (textarea + button) │
│                                             ││ Card: Timeline                     │
└─────────────────────────────────────────────┘└────────────────────────────────────┘
```
- The customer name links to the customer page.
- The owner names link to `/deals?owner=<id>&status=all`.

**Customer detail:** a header with name, region, industry, account manager and C4C account ID, plus **Edit** and **+ New deal for this customer** (links to `/deals/new?customer=CU-…`). Below it:
- a Contacts card (people with `customer_id` = this customer)
- an Open deals table (same columns as the deals list)
- a Closed deals table
- a Notes card

**Customers list:** columns Name, Region, Industry, Account manager, Open deals, Open pipeline (per-currency totals, e.g. `EUR 1.2M · USD 300K`), Last activity.

**People list:** columns Name, Role (badge), Title, Email, Customer (if any), Open deals involved, Active. A filter by role sits at the top. Inactive people appear greyed out.

### 11.6 Formatting (Jinja filters in `app/filters.py`)

| Filter | Output |
|---|---|
| `fmt_date` | `16 Oct 2026`, or `—` for None |
| `fmt_datetime` | `16 Oct 2026, 10:43` |
| `rel_days(n)` | `today` / `in 3d` / `3d overdue` (the template picks the colour) |
| `money(value, currency)` | `EUR 1,250,000` |
| `money_compact(value, currency)` | `EUR 1.25M` / `USD 850K` / `INR 4.5M`. Always show the currency code; never use symbols. |
| `pct` | `35%` |

### 11.7 `app.js` (vanilla JS, about 150 lines, no build step)

1. **Clickable rows:** clicking a row with `data-href` navigates to it, unless the click was on a link, button or input.
2. **Auto-submit:** `select[data-autosubmit]` submits its form on change.
3. **Keyboard shortcuts** (ignored while typing in an input): `/` focuses the search box, `n` goes to `/deals/new`, `g d` to the dashboard, `g l` to the deals list.
4. **Unsaved changes:** on forms with `data-guard`, warn on `beforeunload` once any input has changed. Remove the warning on submit.
5. **Confirm:** any element with `data-confirm="…"` asks with `confirm()` before submitting or following the link.
6. **Toasts:** success toasts close themselves after 4 s. Every toast has a close button.
7. **Sync badge:** polls `/api/sync/status` every 10 s and updates the badge's text, dot and title.
8. **Copy:** a `[data-copy]` button copies its value to the clipboard and shows "Copied" for 1.5 s. Used for C4C IDs and the weekly report.
9. **Outcome reason:** the stage stepper's Lost/Dropped buttons reveal the inline outcome-reason form.

### 11.8 Accessibility

- Every input has a `<label for>`.
- Colour is never the only signal: health dots have a `title` and screen-reader text, and overdue dates also contain the word "overdue".
- Text contrast meets WCAG AA (the tokens above are chosen for this, so don't lighten them).
- All actions can be done with the keyboard. The tab order follows visual order.

---

## 12. Excel export and weekly report

### 12.1 Excel export (`app/export.py`, phase 2)

- **Sheet:** one sheet named `Deals`, with a bold header row on a light grey fill (`F1F5F9`), the top row frozen and an autofilter on.
- **Columns, in this order:** ID, Title, Type, Customer, C4C ID, Stage, Status, Priority, Health, Sales owner, Presales owner, Delivery owner, BU, Practice, Region, Received, Q&A due, Submission due, Submitted, Expected decision, Closed, Age (days), Days in stage, Currency, Est. value, Probability %, Weighted value, Effort (PM), Duration (months), Pricing model, Incumbent, Competitors, Next action, Next action due, Outcome reason, Tags.
- **Cell formats:** dates are real Excel dates (format `dd-mmm-yyyy`); money uses `#,##0`.
- **Column widths:** `min(max(len(header), longest value) + 2, 50)`.
- **Filename:** `deals-YYYYMMDD.xlsx`, sent as an attachment.

### 12.2 Weekly report (`/report/weekly`, phase 3)

- Markdown text in a readonly textarea, with a **Copy** button. The week is Monday–Sunday, chosen with `?week=YYYY-MM-DD` (default: the current week).
- **Sections:**
  1. Submitted this week
  2. Won / Lost / Dropped this week (with reasons)
  3. Due next week
  4. At risk (red health)
  5. New this week
  6. Pipeline summary (count and weighted value by stage, grouped by currency)
- **Each deal line:** `- DL-2026-0014 · Bosch · ADAS validation – Phase 2 · Solutioning · due 24 Oct · EUR 1.25M`.

---

## 13. Phases and checks

### Phase 0 — Foundation

**Tasks:**
1. Create the repo files from §2: `.gitignore`, `.gitattributes`, both requirements files, `start.sh` and `start.bat` (exactly as in §3), and `run.py`.
2. `app/config_defaults.py`, `app/gitsync.py` (all of §6), and `app/store.py` with config loading and saving only.
3. `create_app` with the lifespan, `base.html` (nav, sync badge, flash and banner areas), `app.css` (tokens plus the base styles and components from §11.4), and `app.js` (features 5–7 of §11.7).
4. Placeholder Dashboard page: "Work Tracker is running", plus the first-run "who are you" card (this needs the `Person` model and saving people, so implement those now).
5. `GET /api/sync/status` and `POST /sync`.
6. `tests/test_gitsync.py`:
   - creates a temporary bare remote (`git init --bare -b main`) and two clones
   - configures `user.name`/`user.email` locally in each clone
   - tests: commit plus push; pull in the second clone; a conflict on the same deal file (local version kept, theirs saved to `_conflicts`); a deleted-vs-edited conflict; `commit()` refusing a path outside `data/`; `commit()` returning False when nothing changed

**Checks:**
- A fresh `git clone` followed by `./start.sh` on Linux, and `start.bat` on Windows, creates the venv, installs dependencies, opens the browser, and shows the dashboard.
- A second run starts in under 5 seconds (no reinstall).
- Entering your name on the first-run card creates `data/people/PE-0001.json`, a commit `PE-0001: created – <name>`, and a push within about 30 s. The badge goes from "1 unpushed" to "Synced".
- Ctrl+C pushes any pending commits before exiting.
- With the network unplugged: the app starts, the badge shows "Sync error", and edits are still committed locally.
- `pytest` passes.

### Phase 1 — Core tracking

**Tasks:**
1. The full `models.py`, the full `store.py`, `forms.py` (parsing, validation, auto-create from §4.5), `history.py` and `metrics.py`.
2. Deal pages:
   - new, edit, detail (with stepper, timeline, notes, next-action card, hold toggle), delete
   - the deals list with search, filters and sorting
3. Customer pages: list, detail, new, edit, delete.
4. People pages: list, new, edit, delete, deactivate.
5. Jinja filters (§11.6) and macros in `_macros.html`: `stage_badge`, `priority_badge`, `health_dot`, `due_cell`, `field` (form field with label, error and help), `def_item`.
6. Tests:
   - `test_metrics.py`: every function, including the boundary days (0, 3, 4, stale threshold ±1)
   - `test_history.py`: create, a stage change, a single field change, several fields, a note
   - `test_store.py`: ID generation, atomic writes, the problems list for a broken file, delete protection
   - `test_routes.py`: create a deal with a new customer and new owners (auto-create), validation errors (422, values kept), a stage change to Lost without a reason (error), filters

**Checks:**
- Starting from an empty `data/`, you can create a deal by typing a new customer name and new owner names. Exactly one commit is made, and it contains the deal, the customer and the people.
- Moving a deal to Proposal Submitted sets `submitted_on`. Moving it to Won sets `closed_on`. The timeline shows each change.
- Moving a deal to Lost asks for a reason.
- The deals list defaults to open deals sorted by submission due date. Every filter and sort works and is reflected in the URL.
- Health dots and their reasons match §8.
- Opening a deal JSON file in an editor shows clean, readable JSON. `git log` shows readable commit messages.

### Phase 2 — Insight and settings

**Tasks:**
1. The full dashboard (§11.5): KPIs, Needs attention, My next actions with inline update, pipeline by stage, aging, recently updated.
2. `/settings` (§10).
3. Excel export (§12.1), available from the deals list and the dashboard.
4. The conflicts page and the banner.
5. The data-problems banner for files that fail to parse.
6. JS features 1–4 and 8–9 of §11.7.

**Checks:**
- The dashboard numbers match a manual count from the deals list.
- The export opens in Excel with real dates, number formats, frozen headers and autofilter.
- Editing the same deal on two clones and syncing both produces a conflict entry. Both "keep mine" and "use theirs" work and create one commit.
- The C4C ID is shown as plain text with a working copy button, never as a link.
- No page ever adds amounts in different currencies together.

### Phase 3 — Quality of life

**Tasks:**
1. The weekly report (§12.2).
2. Keyboard shortcuts (if not already done).
3. A `README.md` covering:
   - first-time setup: `git clone https://github.com/amodmulay-ltts/ai-work-mgmt.git`, then `cd ai-work-mgmt` and run `./start.sh` or `start.bat`
   - daily use
   - how sync and conflicts work
   - how to edit `config.json`
4. Polish:
   - empty states on every list
   - an `error.html` for 404 and 500 errors, with a "Back to dashboard" link
   - page `<title>` values like `DL-2026-0014 · Work Tracker`

**Checks:** the weekly report text pastes cleanly into Outlook/Teams, and every page has an empty state and a proper title.

---

## 14. Definition of done (whole project)

- [ ] `git clone` + `./start.sh` / `start.bat` is the **only** setup step needed on a machine with Python 3.11+ and git.
- [ ] All data is in `data/` as pretty-printed JSON. Every change creates exactly one readable commit and is pushed automatically.
- [ ] The app never crashes because of git or network problems; they show up as the badge state or a banner.
- [ ] No external network requests from the browser (check the DevTools Network tab: everything comes from 127.0.0.1).
- [ ] `pytest` passes on Linux and Windows.
- [ ] The UI matches §11: tokens only, no inline colours, and every page uses the components as specified.
