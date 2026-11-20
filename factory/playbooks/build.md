# Playbook: build

Read alongside `factory/playbooks/_global.md`, which takes precedence
wherever the two disagree. This is what defines the `build` line's scope for
triage, the boundary the builder treats as binding alongside
`protected_paths`, and the first place the approver looks for anything that
must escalate.

## What belongs on this line

Application code under `app/` (routes, forms, the store, lib helpers, views and
public assets) and its tests under `tests/`. Plain JavaScript (ES modules), Node
20+, server-rendered EJS views, no build step.

Any topic asking for a working code change: new behavior, a bug fix, a
refactor, performance work — anything that ends with the codebase doing
something it didn't do before, verified by `factory/checks.sh`.

## What doesn't belong here

- Documentation-only requests — those belong on the `docs` line; triage
  should route them there directly instead of accepting them onto `build`.
- Anything in "Never do this" in the global playbook.
- A topic that's really several unrelated changes bundled together. Triage
  should carve off the smallest useful slice and leave the rest unscoped.

## Always escalate (in addition to the global list)

- `app/store.js` and `app/git-sync.js`: how records are read, written and
  committed. A mistake here can lose entered data or push it somewhere it
  should not go.
- `app/models.js` and any change to a stored field: a change that old files
  cannot be read against.
- The conflict-copy handling for records changed on two machines.
