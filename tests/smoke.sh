#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

cd "$TMPDIR"

node "$ROOT/scripts/init-project-wiki.js"
test -f AGENTS.md
test -f CLAUDE.md
test -f wiki/AGENTS.md
test -f wiki/startup.md
test -f wiki/index.md
test -f .codex/hooks/wiki-session-start.js

node "$ROOT/scripts/init-project-wiki.js" > rerun.log
grep -q "exists  AGENTS.md" rerun.log
grep -q "exists  CLAUDE.md" rerun.log
grep -q "exists  wiki/AGENTS.md" rerun.log

node "$ROOT/scripts/init-project-wiki.js" --lint
node .codex/hooks/wiki-session-start.js > hook.json
grep -q "wiki/startup.md" hook.json
grep -q "wiki/index.md" hook.json
grep -q "Read On Demand" wiki/startup.md
grep -q "Language Policy" wiki/index.md
grep -q "Project canonical content language" wiki/startup.md
grep -q "@AGENTS.md" CLAUDE.md

node "$ROOT/scripts/init-project-wiki.js" --glossary-init
test -f wiki/canonical/glossary.md
node "$ROOT/scripts/init-project-wiki.js" --refresh-index
node "$ROOT/scripts/init-project-wiki.js" --capture-inbox --title "Smoke" --content "Candidate content"
node "$ROOT/scripts/init-project-wiki.js" --query Smoke
node "$ROOT/scripts/init-project-wiki.js" --prune-check
node "$ROOT/scripts/init-project-wiki.js" --lint

mkdir "$TMPDIR/no-git-config"
cd "$TMPDIR/no-git-config"
git init >/dev/null
node "$ROOT/scripts/init-project-wiki.js" --no-git-config
test -f CLAUDE.md
test -f .githooks/prepare-commit-msg
if [ "$(git config --get core.hooksPath || true)" = ".githooks" ]; then
  echo "--no-git-config configured core.hooksPath unexpectedly" >&2
  exit 1
fi
