# Remove Syntra from this project

Everything the Syntra software factory added is listed here, with the commands
to take it out. Nothing in `app/`, `tests/` or `data/` was changed by the
install, so removal does not touch the app. Only `.gitignore` and
`CLAUDE.md` got small additions, and step 3 undoes them.

- **Installed:** 2026-11-25, on branch `syntra-factory`
- **Source:** https://github.com/amodmulay/syntra (commit `f59f7d8`)
- **Followed:** its `GETTING_STARTED.md` install prompt and `INSTALL.md`

## Easiest: ask Claude Code

Open this project in Claude Code and paste:

```text
Remove the Syntra software factory from this project by following removeme.md.
Work on a new branch called remove-syntra. Run the steps in order, show me the
diff, run npm test, and ask before merging or pushing.
```

## Or do it yourself

Run these from the project root. The first block only needs the second if the
factory was ever run (`/factory run`).

```bash
git checkout main
git checkout -b remove-syntra
```

### 1. Clean up anything the factory created while running

Skip this if you never ran `/factory run`.

```bash
# Stop the dashboard if it is still running. The [f] keeps pkill from matching its
# own command line (and killing the shell that is running this).
pkill -f "[f]actory/bin/dashboard" || true

# Remove job worktrees and the branches the factory cut for each job
for w in .worktrees/*; do [ -d "$w" ] && git worktree remove --force "$w"; done
git worktree prune
git branch --list 'factory/*' | xargs -r git branch -D
```

### 2. Delete the installed files

```bash
git rm -r --quiet \
  .claude/skills/factory \
  .claude/agents/triage.md .claude/agents/spec-writer.md .claude/agents/builder.md \
  .claude/agents/reviewer-code.md .claude/agents/reviewer-security.md \
  .claude/agents/reviewer-ux.md .claude/agents/reviewer-ui.md .claude/agents/approver.md \
  factory removeme.md

# Untracked leftovers (job state, worktrees), then the empty folders
rm -rf factory .worktrees
rmdir .claude/agents .claude/skills .claude 2>/dev/null || true
```

`rmdir` only removes a folder that is empty, so any other file you keep in
`.claude/` stays.

### 3. Undo the small edits to existing files

```bash
# .gitignore: drop the two lines the install added
sed -i '/^\/factory\/jobs\/$/d;/^\/\.worktrees\/$/d' .gitignore

# CLAUDE.md: drop the "## Software factory" section (up to the next "## " heading)
awk '/^## Software factory$/{skip=1; next} /^## /{skip=0} !skip' CLAUDE.md > CLAUDE.md.new && mv CLAUDE.md.new CLAUDE.md
```

`CLAUDE.md` may also hold your own uncommitted edits. Check them with
`git diff CLAUDE.md` before committing. The `## Validation` section there
(test and start commands) is useful on its own, so the commands above leave it.

### 4. Check and commit

```bash
git add .gitignore CLAUDE.md   # the deletions in step 2 are already staged
npm test                       # still passes: the app was never changed
git status                     # only the removals above, no data/ files
ls .claude factory 2>&1        # both should say: No such file or directory
grep -n "factory" .gitignore CLAUDE.md   # should print nothing
git commit -m "Remove the Syntra software factory"
```

Then merge `remove-syntra` into `main` when you are happy with it.

## What was installed

| Path | What it is |
|---|---|
| `.claude/skills/factory/SKILL.md` | the `/factory` command |
| `.claude/agents/` (8 files) | triage, spec-writer, builder, reviewer-code, reviewer-security, reviewer-ux, reviewer-ui, approver |
| `factory/config.json` | lines, routing, ports, dashboard port |
| `factory/checks.sh` | this project's checks (`npm test`) |
| `factory/bin/` | job, gate, route, pull, dashboard scripts |
| `factory/dashboard.html` | the job board |
| `factory/playbooks/` | global, build and docs boundaries, written for Work Tracker |
| `factory/inbox/` | where requests are filed (`.gitkeep` only) |
| `.gitignore` | two added lines: `/factory/jobs/` and `/.worktrees/` |
| `CLAUDE.md` | an added "Software factory" section (and a "Validation" section) |

Created only when the factory runs: `factory/jobs/` (job state), `.worktrees/`
(one checkout per job), `factory/<job-id>` git branches, and
`factory/records/` (a small summary per finished job).

## Not installed (so nothing to remove)

- The GitHub issue form (`.github/ISSUE_TEMPLATE/`) and the `factory` label.
  The GitHub CLI `gh` is not installed on this machine, so issues are not
  pulled in. Requests are filed as files in `factory/inbox/` instead.
- If you later turn on GitHub issues and want it gone too:
  `gh label delete factory`, and the `factory-done` and `factory-rejected`
  labels if they exist.

## An older install exists on another branch

The earlier ei software factory was installed on the unmerged branch
`software-factory`. It uses the same paths as Syntra, so the two can never
both be merged. Remove that one when you decide: `git branch -D software-factory`.
