# Work Tracker

A personal tracker for RFQs, opportunities and customers. It runs on your computer in the browser (`http://127.0.0.1:8765`). Your data lives in this git repository, in the `data/` folder. Every change is saved as a commit and pushed to the company git remote.

## What you need

- **Node.js 20 or newer** (the LTS version from https://nodejs.org).
- **git 2.30 or newer**, with access to the company git remote.

## First time on a computer

```sh
git clone https://github.com/amodmulay-ltts/ai-work-mgmt.git
cd ai-work-mgmt
./start.sh          # Linux or macOS
start.bat           # Windows
```

The first start installs the dependencies, asks for your name and email for git commits (once per computer), opens the browser, and asks who you are. After that it starts in a few seconds.

## Every day

1. Start the app with `./start.sh` or `start.bat`. It pulls the latest data first.
2. Work in the browser.
3. Stop it with **Ctrl+C** in the terminal. It releases the session lock and pushes everything before it exits.

Keyboard shortcuts, when you are not typing in a field: `/` search, `n` new opportunity, `g d` dashboard, `g l` opportunities list, `g s` RFQs I support.

### Pages

- **Dashboard:** what needs attention, your next actions, pipeline and aging, recent changes.
- **Type:** every opportunity has a type: Lead (a new customer, or a new opportunity with an existing customer), RFI, RFQ, RFP, Proactive proposal, Change request or Renewal. The type decides which fields the form asks for. Fields that a type does not use are stored empty, so changing the type never deletes anything. Each type's fields are listed in `config.json` under `opportunity_types`.
- **Tags:** every opportunity can have tags, such as RFQ or Hot lead. Type a new tag on an opportunity and it is added to the list. The dashboard and the opportunities list can be filtered by tags (an opportunity must have every tag picked). Tags are managed in **Settings**; a tag that opportunities still use cannot be removed.
- **Opportunities:** filter, sort and search. Export the current view to Excel with **Export to Excel**.
- **Support** and **My asks:** RFQs where you are a supporter (or have an open ask), and the asks other people have given you. Add supporters and asks on an opportunity's page, under **Support**.
- **Customers** and **People:** a customer or a person is created automatically when you type a new name on an opportunity. You can also add them here.
- **Weekly report:** plain Markdown for the week, with a Copy button for Outlook or Teams.
- **Settings:** your name and email, the stale threshold, and the lists used in dropdowns.

## Sync, conflicts and the session lock

- **Saving** writes the record to `data/` and makes one commit.
- **Pushing** happens about 30 seconds after the last change, when you press the sync badge, and when you stop the app. If the network is down, the badge shows **Sync error**. Your changes are safe on this computer and are pushed later.
- **Conflicts:** if the same record was changed on two computers, the version on this computer is kept in the file. The other version is saved in `data/_conflicts/`. A banner links to **Sync conflicts**, where you choose which version to keep.
- **Session lock:** `data/_lock.json` records which computer has the app open. If another computer has it open, a warning appears in the terminal and on the page. The app still works. A crash leaves the lock in place, so the warning shows until the app is stopped cleanly.

## Install as an app (Ubuntu)

Work Tracker can be installed as a desktop app with its own window and launcher icon. Use Chrome or Chromium (Edge also works). Firefox does not install web apps.

1. Start the app with `./start.sh` and keep the terminal open.
2. In Chrome, open the address bar menu (the install icon on the right of the address bar), or the three-dot menu, and choose **Install Work Tracker**.
3. It opens in its own window and appears in the Activities launcher.

The installed app opens the address it was installed from (`http://127.0.0.1:8765` by default). Start the app on the same port each time. If that port is busy, the launcher moves to the next free port and the installed app will not open until you install it again from the new address.

The app still needs the terminal running, because the data and pages come from it. Only the static files (styles, scripts and icons) are cached in the browser.

## Settings file

`data/config.json` holds the settings. You can edit most of them on the **Settings** page. The stages are fixed by the spec. To change them, edit `data/config.json` by hand and commit the change.

## Starting from an empty repository

If the remote is empty, add it once and push:

```sh
git remote add origin https://github.com/amodmulay-ltts/ai-work-mgmt.git
git push -u origin main
```

## Troubleshooting

- **A password or sign-in window appears:** git needs your credentials. Enter them once, and your computer will remember them.
- **Dependency install fails behind a proxy:** set `HTTPS_PROXY` (and npm's proxy setting), then start again.
- **Port 8765 is in use:** the app tries the next ten ports. To choose one yourself, run `./start.sh --port 9000`.
- **Data files that cannot be read** are listed in Settings, under *Data files that could not be read*. Fix them by hand or restore them from git history.
- **Run without git sync** (for example, when you are offline): `./start.sh --offline`. Changes are still committed locally.

## For developers

- Tests: `npm test` (Node's built-in test runner).
- The spec is in `PLAN.md`. Decisions and the progress log are in `NOTES.md`. The current working state is in `SESSION.md`.
