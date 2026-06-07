# Project Wiki Bootstrap

Bootstrap a token-efficient project planning wiki for humans and LLM agents.

Languages: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

The generated wiki keeps session-start context small by loading only:

- `wiki/startup.md`: compact current project context
- `wiki/index.md`: router for which detailed files to read next

Detailed canonical, decision, meta, and source files are read on demand only when the current task needs them.

## Why This Exists

LLM coding agents are most useful when they can quickly recover the current project intent, decisions, assumptions, and risks without rereading a long chat history or loading a large documentation tree. This project creates a small, durable wiki structure that separates always-useful routing context from detailed project knowledge.

The goal is not to replace product docs, architecture docs, or issue trackers. The goal is to give humans and agents a low-token project-planning source of truth that stays close to the repository and is easy to update during normal work.

## Inspiration

This project is inspired by Andrej Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern: a persistent markdown wiki maintained with LLM help, instead of repeatedly reconstructing context from raw documents or chat history. `project-wiki-bootstrap` adapts that idea specifically for repository-local project planning, agent startup context, decision history, and lightweight lifecycle tooling.

## Core Features

- Token-efficient startup context: only `wiki/startup.md` and `wiki/index.md` are intended for initial context.
- Read On Demand routing: detailed canonical docs, decisions, source notes, migration pages, and meta docs are read only when needed.
- Project truth separation: current project truth lives in `wiki/canonical/`; rationale and history live in `wiki/decisions/`; wiki operating rules live in `wiki/meta/`.
- Agent instruction support: generates compact project-level instructions for Codex and Claude Code.
- Codex SessionStart hook: registers a hook that injects compact wiki startup context into Codex sessions.
- Git commit trailers: installs an optional `prepare-commit-msg` hook that records wiki impact in commit trailers.
- Idempotent bootstrap: rerunning the script updates managed operating files while preserving starter project wiki pages.
- Migration mode: moves an existing `wiki/` aside, creates a clean wiki, inventories legacy markdown, and writes migration inboxes.
- Lifecycle tools: supports linting, keyword search, index refresh, inbox capture, prune checks, glossary initialization, and migration review sync.
- No orchestration lock-in: the project is independent of external orchestration frameworks.

## What It Creates

- `AGENTS.md`: compact project-wide wiki-first instructions
- `CLAUDE.md`: Claude Code compatibility file that imports `AGENTS.md`
- `wiki/AGENTS.md`: detailed wiki-internal editing rules
- `.codex/hooks.json`: Codex `SessionStart` hook registration
- `.codex/hooks/wiki-session-start.js`: compact startup context injector
- `.githooks/prepare-commit-msg`: optional git commit hook entrypoint
- `.githooks/wiki-commit-trailers.js`: wiki commit trailer generator
- `wiki/startup.md`: session-start summary
- `wiki/index.md`: routing index with read/update/token-budget hints
- `wiki/canonical/`: current project truth
- `wiki/decisions/`: project decision history
- `wiki/meta/`: wiki operating rules and decision policy
- `wiki/sources/`: source summaries

This project is independent of external orchestration layers. It does not create project memory files for any orchestration framework.

## Runtime Integrations

### Skill

The repository can be installed as a Codex skill or a Claude Code skill. The skill is the user-facing workflow wrapper: it tells the agent when to run the bootstrap script, how to verify the result, and which lifecycle commands are available.

The skill does not replace the script. It gives the agent a reliable procedure for invoking the script from the current project root.

### Codex Hook

The bootstrap creates `.codex/hooks.json` and `.codex/hooks/wiki-session-start.js`. In Codex, this registers a `SessionStart` hook that emits compact project wiki context from:

- `wiki/startup.md`
- `wiki/index.md`

This keeps startup context small while still pointing the agent to detailed files when the task requires them.

### Claude Code Instructions

Claude Code reads `CLAUDE.md`, not `AGENTS.md`. The generated `CLAUDE.md` imports `AGENTS.md` using `@AGENTS.md`, so Claude Code and Codex share one compact wiki-first contract without duplicating the rules.

### Git Hook

The bootstrap installs `.githooks/prepare-commit-msg` and `.githooks/wiki-commit-trailers.js`. In a git repository, it configures `core.hooksPath` to `.githooks` by default. The hook appends wiki-related trailers such as `Wiki-scope`, `Canonical-updated`, `Decision-ref`, `Startup-updated`, and `Index-updated` when relevant files are staged.

Use `--no-git-config` when you want the hook files installed but do not want the script to change `core.hooksPath`.

## Generated Wiki Model

- `wiki/startup.md`: compact session-start summary and project state.
- `wiki/index.md`: router that tells humans and agents which detailed files to read or update.
- `wiki/canonical/`: current project truth, such as brief, assumptions, risks, open questions, and optional glossary.
- `wiki/decisions/`: project decision history, recent decisions, Decision Pack template, and Full ADR template.
- `wiki/meta/`: wiki operating model, decision policy, bootstrap decisions, language policy, lint and migration rules.
- `wiki/sources/`: source summaries and references that informed the wiki.
- `wiki/inbox/`: captured candidates that are not yet canonical truth.
- `wiki/migration/`: generated migration inventory, plan, verification, and review state.

## Typical Workflow

1. Bootstrap the wiki in a project.
2. At session start, read `wiki/startup.md` and `wiki/index.md`.
3. Read detailed wiki pages only when the current task needs them.
4. When project planning content changes, update the relevant canonical, decision, source, or meta page in the same turn.
5. Run `--lint` to validate metadata, routing, hook setup, and expected files.
6. Let the git hook append wiki trailers when committing wiki-related changes, or use `--no-git-config` and manage git hook setup manually.

## Usage

From a project root, run the script directly:

```bash
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js
```

Migration mode for an existing wiki/docs structure:

```bash
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --migrate
```

Optional lifecycle commands:

```bash
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --lint
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --no-git-config
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --query "search terms"
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --refresh-index
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --capture-inbox --title "Candidate title" --content "Candidate content"
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --prune-check
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --review-migration
```

Other usage surfaces:

- Codex skill: install this repository as `~/.codex/skills/project-wiki-bootstrap`, then ask Codex to apply project-wiki-bootstrap in the current project.
- Claude Code skill: install this repository as `~/.claude/skills/project-wiki-bootstrap`, then invoke `/project-wiki-bootstrap` or ask Claude to initialize the project wiki.
- npm bin: after installation or linking, run `project-wiki-bootstrap` instead of the full `node .../scripts/init-project-wiki.js` path.

All surfaces still execute the same local bootstrap script because the tool creates and updates project files.

## Side Effects

When run in a git repository, the script configures:

```bash
git config core.hooksPath .githooks
```

This enables the generated commit-message hook. If a project already uses another `core.hooksPath`, review before running or reset the git config afterward.

To install hook files without changing git config:

```bash
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --no-git-config
```

## Language

This repository README is English by default for GitHub distribution. Localized documentation is available in [Korean](README.ko.md), [Japanese](README.ja.md), and [Simplified Chinese](README.zh.md).

Generated operating documents are English by default, including root `AGENTS.md`, `wiki/AGENTS.md`, `wiki/startup.md`, `wiki/index.md`, migration operating pages, and wiki meta pages.

Project canonical wiki content does not default to Korean or English. The LLM should choose the language from explicit user instruction, existing project language, source documents, and team context. When no signal exists, prefer the language already used in the current interaction or repository.

## Agent Compatibility

Codex reads `AGENTS.md` and uses the generated `.codex/hooks/wiki-session-start.js` SessionStart hook for compact startup context.

Claude Code reads `CLAUDE.md`, not `AGENTS.md`. The generated `CLAUDE.md` imports `AGENTS.md` with `@AGENTS.md`, matching Claude Code's documented compatibility path while keeping the project-wide rules in one place.

## Open Source Cleanup Priorities

1. Document side effects clearly. Done in this README.
2. Remove orchestration-specific generated files and wording. Done.
3. Keep root `AGENTS.md` compact and move detailed wiki rules to `wiki/AGENTS.md`. Done.
4. Add smoke tests for bootstrap, lint, idempotency, and no orchestration-specific file generation. Done.
5. Add `--no-git-config` before publishing to users who may not want `core.hooksPath` changed automatically. Done.
6. Keep generated operating documents English while letting project canonical content language be context-driven. Done.

## License

MIT
