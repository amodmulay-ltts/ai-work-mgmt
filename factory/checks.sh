#!/usr/bin/env bash
# This project's checks. Exit 0 only when the branch is fit to review.
#
# The gate runs this from the main checkout's copy of this file, with a job's
# worktree as the working directory. Keep it fast, deterministic and
# non-interactive: no watch modes, no prompts, nothing that rewrites files.
#
# Work Tracker is plain JavaScript on Node 20+ with no build step. Its checks
# are the test suite (node --test, see package.json). There is no lint or
# typecheck script yet.
set -euo pipefail

# A fresh worktree has no node_modules (it is gitignored), so install from the lockfile first.
if [ ! -d node_modules ]; then
  npm ci --prefer-offline --no-audit --no-fund
fi

npm test
