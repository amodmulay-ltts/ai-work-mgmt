# Playbook: build

Read alongside `factory/playbooks/_global.md`, which takes precedence
wherever the two disagree. This is what defines the `build` line's scope for
triage, the boundary the builder treats as binding alongside
`protected_paths`, and the first place the approver looks for anything that
must escalate.

## What belongs on this line

Working changes to the Work Tracker app: routes, forms, the store, lib
helpers, views and public assets under `app/`, and its tests under `tests/`.
Keep each topic scoped to one behavior and verify it with
`factory/checks.sh`. Follow `CLAUDE.md` and the spec in `PLAN.md`.

## What doesn't belong here

- Documentation-only requests — those belong on the `docs` line; triage
  should route them there directly instead of accepting them onto `build`.
- Changes to `factory/` or `.claude/`. Those are direct edits by the user.
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
- `PLAN.md` itself is the spec. If a topic conflicts with it, stop and ask
  rather than changing the spec.
