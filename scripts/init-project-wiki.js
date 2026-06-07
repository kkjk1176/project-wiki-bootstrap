#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const root = process.cwd();
const today = new Date().toISOString().slice(0, 10);
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);

const migrateMode = args.has("--migrate") || args.has("--adopt-existing");
const lintMode = args.has("--lint");
const glossaryMode = args.has("--glossary-init");
const refreshIndexMode = args.has("--refresh-index");
const captureInboxMode = args.has("--capture-inbox");
const pruneCheckMode = args.has("--prune-check");
const reviewMigrationMode = args.has("--review-migration") || args.has("--semantic-migrate");
const noGitConfigMode = args.has("--no-git-config");

function argValue(name) {
  const prefix = `${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = rawArgs.indexOf(name);
  if (index >= 0 && rawArgs[index + 1] && !rawArgs[index + 1].startsWith("--")) {
    return rawArgs[index + 1];
  }
  return "";
}

const queryTerm = argValue("--query");
const captureTitle = argValue("--title");
const captureContent = argValue("--content");
const captureCategory = argValue("--category") || "project-candidate";

function abs(relativePath) {
  return path.join(root, relativePath);
}

function exists(relativePath) {
  return fs.existsSync(abs(relativePath));
}

function read(relativePath) {
  return fs.readFileSync(abs(relativePath), "utf8");
}

function write(relativePath, content) {
  const filePath = abs(relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function mkdirp(relativePath) {
  fs.mkdirSync(abs(relativePath), { recursive: true });
}

function writeManaged(relativePath, content) {
  const previous = exists(relativePath) ? read(relativePath) : "";
  if (previous === content) return "exists";
  write(relativePath, content);
  return previous ? "updated" : "created";
}

function writeStarter(relativePath, content) {
  if (!exists(relativePath)) {
    write(relativePath, content);
    return "created";
  }
  const current = read(relativePath);
  if (current === content) return "exists";
  if (hasMetadataHeader(current)) return "exists";
  const generatedSignals = [
    "This file is the current project-planning truth",
    "This wiki keeps project planning knowledge",
    "This page tracks unresolved project questions",
    "# <Topic> v<N> Decisions",
    "# ADR: <Title>",
    "# Karpathy LLM Wiki",
    "# Glossary",
    "아직 제품/서비스 주제는 정해지지 않았다",
  ];
  if (!generatedSignals.some((signal) => current.includes(signal))) return "manual-review";
  write(relativePath, content);
  return "updated";
}

function upsertMarkedSection(relativePath, startMarker, endMarker, section, fallbackHeading) {
  if (!exists(relativePath)) {
    write(relativePath, `${section.trim()}\n`);
    return "created";
  }
  const current = read(relativePath);
  const start = current.indexOf(startMarker);
  const end = current.indexOf(endMarker);
  if (start >= 0 && end > start) {
    const next = `${current.slice(0, start).trimEnd()}\n\n${section.trim()}\n\n${current.slice(end + endMarker.length).trimStart()}`.trim() + "\n";
    if (next === current) return "exists";
    write(relativePath, next);
    return "updated";
  }
  if (fallbackHeading && current.includes(fallbackHeading)) {
    const headingIndex = current.indexOf(fallbackHeading);
    const prefix = current.slice(0, headingIndex).trimEnd();
    write(relativePath, `${prefix ? `${prefix}\n\n` : ""}${section.trim()}\n`);
    return "updated";
  }
  write(relativePath, `${current.trimEnd()}\n\n${section.trim()}\n`);
  return "updated";
}

function deleteIfGenerated(relativePath, sentinels) {
  if (!exists(relativePath)) return "absent";
  const current = read(relativePath);
  if (!sentinels.some((sentinel) => current.includes(sentinel))) return "manual-review";
  fs.unlinkSync(abs(relativePath));
  return "removed";
}

function parseJson(relativePath, fallback) {
  if (!exists(relativePath)) return fallback;
  try {
    return JSON.parse(read(relativePath));
  } catch (error) {
    throw new Error(`${relativePath} is not valid JSON: ${error.message}`);
  }
}

function hasMetadataHeader(text) {
  return /^---\n[\s\S]*?\n---\n/.test(text);
}

function metadataValue(text, key) {
  const header = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!header) return "";
  const match = header[1].match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : "";
}

function stripMetadataHeader(text) {
  return text.replace(/^---\n[\s\S]*?\n---\n/, "");
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function commandOk(command, commandArgs, options = {}) {
  try {
    childProcess.execFileSync(command, commandArgs, { stdio: "ignore", ...options });
    return true;
  } catch {
    return false;
  }
}

function isGitRepository() {
  try {
    return childProcess.execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() === "true";
  } catch {
    return false;
  }
}

function upsertGitHooksPath() {
  if (noGitConfigMode) return "skipped-no-git-config";
  if (!isGitRepository()) return "skipped-no-git";
  let previous = "";
  try {
    previous = childProcess.execFileSync("git", ["config", "--get", "core.hooksPath"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    previous = "";
  }
  if (previous === ".githooks") return "exists";
  childProcess.execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
    cwd: root,
    stdio: "ignore",
  });
  return previous ? `updated from ${previous}` : "configured";
}

function makeExecutable(relativePath) {
  if (!exists(relativePath)) return;
  const currentMode = fs.statSync(abs(relativePath)).mode;
  fs.chmodSync(abs(relativePath), currentMode | 0o755);
}

function upsertHookConfig() {
  const relativePath = ".codex/hooks.json";
  const config = parseJson(relativePath, { hooks: {} });
  if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) {
    config.hooks = {};
  }
  if (!Array.isArray(config.hooks.SessionStart)) config.hooks.SessionStart = [];

  const command = "node .codex/hooks/wiki-session-start.js";
  const hookEntry = {
    matcher: "startup|resume|clear",
    hooks: [{ type: "command", command, timeout: 10 }],
  };
  const existingIndex = config.hooks.SessionStart.findIndex((entry) => {
    return Array.isArray(entry?.hooks) && entry.hooks.some((hook) => hook?.command === command);
  });
  if (existingIndex >= 0) config.hooks.SessionStart[existingIndex] = hookEntry;
  else config.hooks.SessionStart.push(hookEntry);

  const next = `${JSON.stringify(config, null, 2)}\n`;
  const previous = exists(relativePath) ? read(relativePath) : "";
  write(relativePath, next);
  return previous === next ? "exists" : previous ? "updated" : "created";
}

const agentsSection = `<!-- PROJECT-WIKI-FIRST:START -->
## Wiki-First Planning

This project uses \`./wiki\` as the durable project-planning source of truth.

At the start of every session:

1. Review \`wiki/startup.md\` for compact current context.
2. Review \`wiki/index.md\` as the router for which files to read next.
3. Read detailed \`wiki/canonical/\`, \`wiki/decisions/\`, \`wiki/meta/\`, and \`wiki/sources/\` files on demand only when the current question needs them.

During conversation:

- Update \`./wiki\` in the same turn when project planning content is added, changed, or removed.
- Do not store non-project LLM memory, assistant preferences, collaboration reminders, or workflow instructions in project wiki canonical or decision docs.
- Follow \`wiki/AGENTS.md\` for detailed rules when editing files under \`wiki/\`.
- Let \`.githooks/prepare-commit-msg\` append wiki trailers automatically for staged wiki, hook, AGENTS, or project-wiki-bootstrap files.
<!-- PROJECT-WIKI-FIRST:END -->`;

const claudeSection = `<!-- PROJECT-WIKI-CLAUDE:START -->
# Claude Code Project Instructions

@AGENTS.md

## Claude Code Notes

Claude Code reads \`CLAUDE.md\`, not \`AGENTS.md\`, so this file imports \`AGENTS.md\` to share the same wiki-first planning contract with Codex and other agents.

At session start, follow the imported instructions: review \`wiki/startup.md\` and \`wiki/index.md\` first, then read detailed wiki pages on demand only when the current task needs them.
<!-- PROJECT-WIKI-CLAUDE:END -->`;

const wikiAgentsSection = `<!-- PROJECT-WIKI-INTERNAL:START -->
## Wiki Internal Rules

This file applies to \`./wiki\` and its children. Root \`AGENTS.md\` owns the project-wide wiki-first contract. Root \`CLAUDE.md\` imports \`AGENTS.md\` for Claude Code compatibility. This file owns detailed wiki editing rules.

Language policy:

- Wiki operating documents generated by this bootstrap are English by default.
- Project canonical content does not have a fixed default language. The LLM should choose the language that best matches the user's language, project context, and surrounding materials, then keep that choice consistent.
- If the user explicitly asks for a language, that instruction wins.

Reading rules:

- Treat \`startup.md\` as compact session context and \`index.md\` as the router.
- Read detailed \`canonical/\`, \`decisions/\`, \`meta/\`, and \`sources/\` files on demand only when the current question needs them.
- Prefer each file's TL;DR and metadata before reading the full body.

Storage boundaries:

- \`canonical/\` contains current project-planning truth only.
- \`decisions/\` contains project decision history only.
- \`meta/\` contains wiki operating rules, decision policy, bootstrap, lint, hook, and migration decisions.
- \`sources/\` contains external reference summaries and source notes.
- \`inbox/\` and migration inbox files contain candidates, not canonical truth.
- Do not store non-project LLM memory, assistant preferences, collaboration reminders, or workflow instructions in \`canonical/\` or \`decisions/\`; use root \`AGENTS.md\`, \`CLAUDE.md\`, hooks, or skills instead.

Update rules:

- Every wiki knowledge markdown file should include compact metadata with \`status\`, \`updated\`, \`scope\`, \`read_budget\`, \`decision_ref\`, and \`review_trigger\`. This \`wiki/AGENTS.md\` instruction file is excluded from that wiki-page metadata requirement.
- Put a compact TL;DR near the top of canonical, decision, meta, source, inbox, and migration pages.
- Update \`startup.md\` when session-start summary, recent important decisions, open questions, routing hints, or project-language choice changes.
- Update \`index.md\` when adding, moving, removing, or materially changing wiki pages.
- Use \`decisions/log.md\` for trivial timestamped project decisions, Decision Packs for grouped topic decisions, and Full ADRs only for product direction, architecture, public API, data model, security/permission, SEO contract, high migration-cost, or likely-to-be-challenged decisions.
- Initialize \`canonical/glossary.md\` only when terminology becomes useful.
- Keep migration inbox statuses as \`pending\`, \`adopted\`, \`rejected\`, \`resolved\`, or \`needs-human-review\`.

Commit rules:

- Follow the repository's commit-message policy when one exists.
- Let \`.githooks/prepare-commit-msg\` append wiki trailers automatically when git hooks are enabled.
- If bootstrap was run with \`--no-git-config\`, hook files are installed but \`core.hooksPath\` is not changed.
- Do not hand-write wiki trailers unless the hook is unavailable or a trailer needs correction.
<!-- PROJECT-WIKI-INTERNAL:END -->`;

const hookScript = `#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const cwd = process.env.CODEX_WORKSPACE_DIR || process.cwd();

function readIfExists(relativePath, maxChars) {
  const filePath = path.join(cwd, relativePath);
  try {
    const text = fs.readFileSync(filePath, "utf8").trim();
    if (text.length <= maxChars) return text;
    return \`\${text.slice(0, maxChars)}\\n\\n[truncated: \${relativePath}]\`;
  } catch {
    return "";
  }
}

const files = [
  ["wiki/startup.md", 3500],
  ["wiki/index.md", 4500],
];

const sections = files
  .map(([relativePath, maxChars]) => {
    const text = readIfExists(relativePath, maxChars);
    if (!text) return "";
    return \`## \${relativePath}\\n\\n\${text}\`;
  })
  .filter(Boolean);

const additionalContext = [
  "[Project wiki startup review]",
  "Use ./wiki as the project-planning source of truth only. Start with compact routing context; read detailed project canonical, decision, or meta files on demand.",
  "Project canonical content language is selected from user/project context; do not assume a fixed default language.",
  "When project planning content is added, changed, or removed, update ./wiki in the same turn.",
  "Do not put non-project LLM memory or collaboration instructions in project canonical/decision docs; use AGENTS.md, wiki/AGENTS.md, hooks, or skills.",
  "",
  ...sections,
].join("\\n");

process.stdout.write(JSON.stringify({
  continue: true,
  hookSpecificOutput: { additionalContext },
}));
`;

const gitPrepareCommitMsgHook = `#!/bin/sh
MSG_FILE="$1"
SOURCE="$2"

case "$SOURCE" in
  merge|squash|commit)
    exit 0
    ;;
esac

if command -v node >/dev/null 2>&1 && [ -f ".githooks/wiki-commit-trailers.js" ]; then
  node .githooks/wiki-commit-trailers.js "$MSG_FILE"
fi
`;

const gitWikiCommitTrailersScript = `#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const messagePath = process.argv[2];
if (!messagePath) process.exit(0);

function runGit(args) {
  try {
    return childProcess.execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function commandOk(command, args) {
  try {
    childProcess.execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function existingFile(relativePath) {
  try {
    return fs.readFileSync(relativePath, "utf8");
  } catch {
    return "";
  }
}

function truncateList(items) {
  if (items.length === 0) return "none";
  if (items.length <= 3) return items.join(", ");
  return items.slice(0, 3).join(", ") + ", +" + String(items.length - 3);
}

function metadataLine(text, label) {
  const match = text.match(new RegExp("^- " + label + ":\\\\s*(.+)$", "m"));
  return match ? match[1].trim() : "";
}

function migrationStatus(files) {
  const hasMigration = files.some((file) => file.startsWith("wiki/migration/") || file.endsWith("/migration-inbox.md"));
  if (!hasMigration) return "n/a";
  const text = existingFile("wiki/migration/verification.md") + "\\n" + existingFile("wiki/migration/review.md");
  const coverage = metadataLine(text, "coverage") || "unknown";
  const semantic = metadataLine(text, "semantic migration complete") || "unknown";
  const pending = metadataLine(text, "pending") || "unknown";
  const needsHuman = metadataLine(text, "needs-human-review") || "unknown";
  return "coverage " + coverage + "; semantic complete " + semantic + "; pending " + pending + "; needs-human-review " + needsHuman;
}

function wikiScope(files) {
  const scopes = [];
  const add = (name) => {
    if (!scopes.includes(name)) scopes.push(name);
  };
  for (const file of files) {
    if (file.startsWith("wiki/canonical/")) add("canonical");
    else if (file.startsWith("wiki/decisions/")) add("decisions");
    else if (file.startsWith("wiki/meta/")) add("meta");
    else if (file.startsWith("wiki/sources/")) add("sources");
    else if (file.startsWith("wiki/migration/") || file.endsWith("/migration-inbox.md")) add("migration");
    else if (file === "wiki/startup.md") add("startup");
    else if (file === "wiki/index.md") add("index");
    else if (file.startsWith(".codex/hooks/") || file === ".codex/hooks.json") add("hooks");
    else if (file === "AGENTS.md" || file === "CLAUDE.md") add("agents");
    else if (file.startsWith(".githooks/")) add("git-hooks");
    else if (file.startsWith("tools/project-wiki-bootstrap/")) add("skill");
  }
  return scopes.length === 0 ? "none" : scopes.join(", ");
}

function validationTrailers() {
  const home = process.env.HOME || "";
  const lintScript = [
    "tools/project-wiki-bootstrap/scripts/init-project-wiki.js",
    path.join(home, ".codex/skills/project-wiki-bootstrap/scripts/init-project-wiki.js"),
    path.join(home, ".claude/skills/project-wiki-bootstrap/scripts/init-project-wiki.js"),
  ].find((candidate) => fs.existsSync(candidate));
  const lintOk = Boolean(lintScript) && commandOk("node", [lintScript, "--lint"]);
  const sessionHookOk = fs.existsSync(".codex/hooks/wiki-session-start.js") && commandOk("node", [".codex/hooks/wiki-session-start.js"]);
  if (lintOk && sessionHookOk) return { tested: "project wiki lint; wiki session-start hook", notTested: "none" };
  const gaps = [];
  if (!lintOk) gaps.push("project wiki lint");
  if (!sessionHookOk) gaps.push("wiki session-start hook");
  return { tested: "prepare-commit-msg generated wiki trailers", notTested: gaps.join("; ") || "unknown" };
}

const staged = runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
  .split(/\\r?\\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const wikiFiles = staged.filter((file) => {
  return file.startsWith("wiki/")
    || file === "AGENTS.md"
    || file === "CLAUDE.md"
    || file === ".codex/hooks.json"
    || file.startsWith(".codex/hooks/")
    || file.startsWith(".githooks/")
    || file.startsWith("tools/project-wiki-bootstrap/");
});

if (wikiFiles.length === 0) process.exit(0);

let message = fs.readFileSync(messagePath, "utf8");
if (/^Wiki-scope:/m.test(message)) process.exit(0);

const decisionRefs = wikiFiles.filter((file) => file.startsWith("wiki/decisions/") || file === "wiki/meta/wiki-ops-v1-decisions.md");
const validation = validationTrailers();
const trailers = [
  ["Wiki-scope", wikiScope(wikiFiles)],
  ["Canonical-updated", truncateList(wikiFiles.filter((file) => file.startsWith("wiki/canonical/") && !file.endsWith("/migration-inbox.md")))],
  ["Decision-ref", truncateList(decisionRefs)],
  ["Startup-updated", wikiFiles.includes("wiki/startup.md") ? "yes" : "no"],
  ["Index-updated", wikiFiles.includes("wiki/index.md") ? "yes" : "no"],
  ["Migration-status", migrationStatus(wikiFiles)],
  ["Tested", validation.tested],
  ["Not-tested", validation.notTested],
];

const lines = [];
for (const [key, value] of trailers) {
  if (!new RegExp("^" + key + ":", "m").test(message)) lines.push(key + ": " + value);
}
if (lines.length > 0) fs.writeFileSync(messagePath, message.replace(/\\s*$/, "") + "\\n\\n" + lines.join("\\n") + "\\n");
`;

const metadata = (scope, budget, decisionRef, trigger, status = "active") => `---
status: ${status}
updated: ${today}
scope: ${scope}
read_budget: ${budget}
decision_ref: ${decisionRef}
review_trigger: ${trigger}
---
`;

const startup = `${metadata("startup-router", "short", "wiki/meta/wiki-ops-v1-decisions.md", "session-start summary, routing, language policy, or open project state changes")}
# Startup Context

## TL;DR

- This project is in an initial planning state unless the canonical wiki says otherwise.
- Project truth lives in \`wiki/canonical/\`, project decision history lives in \`wiki/decisions/\`, and source summaries live in \`wiki/sources/\`.
- Wiki operating rules and wiki operating decisions live in \`wiki/meta/\`.
- At session start, read only this file and \`wiki/index.md\` first; read detailed files on demand.
- Project canonical content language is not fixed by this bootstrap. The LLM should choose the language that best matches the user and project context.
- Update the wiki in the same turn when project-planning content changes.

## Read On Demand

- [[index]]: document router.
- [[canonical/project-brief]]: read only when product direction, audience, scope, success criteria, or core scenarios matter.
- [[canonical/open-questions]]: read only when unresolved questions or next clarification items matter.
- [[canonical/assumptions]]: read only when temporary assumptions or unverified premises matter.
- [[canonical/risks]]: read only when risks, revisit triggers, or uncertainty matter.

## Project State

- Problem/opportunity: undecided.
- Target users: undecided.
- Core scenario: undecided.
- Success criteria: undecided.
- Initial scope: undecided.
- Project content language: to be selected from user/project context.

## Recent Project Decisions

- None yet.

## Wiki Operating Pointers

- Decision recording follows [[meta/decision-policy]].
- Wiki operation follows [[meta/operating-model]].
- Wiki operating decisions are recorded only in [[meta/wiki-ops-v1-decisions]], not in project decision logs.

## Token Discipline

- The session-start hook injects only this file and \`wiki/index.md\`.
- Detailed files are selected by the "read when" rules in \`wiki/index.md\`.
- Long decision history is not injected wholesale; read only relevant Decision Packs or ADRs.
`;

const index = `${metadata("wiki-router", "short", "wiki/meta/wiki-ops-v1-decisions.md", "wiki page added, moved, removed, or routing changes")}
# Wiki Index

## How To Use This Index

This file is a router, not a file to expand into every answer. Read only the files that are relevant to the current question.

## Language Policy

- Operating documents generated by this bootstrap are English by default.
- Project canonical content language is chosen by the LLM from the user's language, project context, and surrounding materials.
- Keep the chosen project language consistent unless the user asks to switch.

## Boundary Rule

- \`wiki/canonical/\` and \`wiki/decisions/\` contain project-planning content only.
- Wiki operating rules and wiki operating decisions live in \`wiki/meta/\`.
- Non-project LLM memory, collaboration reminders, and workflow instructions belong in \`AGENTS.md\`, \`wiki/AGENTS.md\`, hooks, or skills, not in project canonical/decision docs.

## Startup

- [[startup]]
  - Read: every session start or compact project state lookup.
  - Update: startup summary, recent decisions, open questions, routes, language policy.
  - Token budget: short.

## Canonical

- [[canonical/project-brief]]
  - Read: product direction, audience, scope, success criteria, core scenarios.
  - Update: product, audience, scope, or success criteria changes.
  - Token budget: medium.
- [[canonical/open-questions]]
  - Read: unresolved questions or next clarifications.
  - Update: questions are added, answered, or moved.
  - Token budget: short.
- [[canonical/assumptions]]
  - Read: temporary assumptions or unverified premises.
  - Update: assumptions are added, validated, or retired.
  - Token budget: short.
- [[canonical/risks]]
  - Read: risks, revisit triggers, uncertainty.
  - Update: risks are added, mitigated, or resolved.
  - Token budget: short.

## Project Decisions

- [[decisions/recent]]
  - Read: recent important project decisions.
  - Update: a decision belongs in startup context.
  - Token budget: short.
- [[decisions/log]]
  - Read: project decision timing matters.
  - Update: a trivial decision needs timestamp tracking.
  - Token budget: on-demand.
- [[decisions/decision-pack-template]]
  - Read: creating a Decision Pack.
  - Update: Decision Pack format changes.
  - Token budget: short.
- [[decisions/full-adr-template]]
  - Read: creating a Full ADR.
  - Update: Full ADR format changes.
  - Token budget: short.

## Wiki Meta

- [[meta/operating-model]]
  - Read: wiki operation, hooks, bootstrap, maintenance, language policy.
  - Update: wiki operation or startup behavior changes.
  - Token budget: medium.
- [[meta/decision-policy]]
  - Read: decision level, ADR need, canonical/decision split.
  - Update: decision classification or ADR criteria changes.
  - Token budget: medium.
- [[meta/wiki-ops-v1-decisions]]
  - Read: wiki operating decisions, rejected alternatives, rationale.
  - Update when: wiki operating decisions change.
  - Token budget: medium.

## Sources

- [[sources/karpathy-llm-wiki]]
  - Read: source pattern and LLM Wiki rationale.
  - Update: source links, interpretation, application notes.
  - Token budget: short.
`;

const glossary = `${metadata("project-canonical", "medium", "wiki/meta/wiki-ops-v1-decisions.md", "project terms, roles, states, permissions, events, entities, API names, DB names, or UI labels are added or renamed")}
# Glossary

## TL;DR

- This file is the naming contract for project/product terminology.
- Do not store wiki operating terms, LLM collaboration instructions, or general working memory here.
- Prefer canonical terms from this file for API, database, UI, and policy wording.
- Use the project language chosen in [[startup]] unless the user says otherwise.

## Terms

| Term | Definition | Avoid | Related Canonical Doc | Status |
| --- | --- | --- | --- | --- |
|  |  |  |  | proposed |
`;

const glossaryIndexBlock = `<!-- PROJECT-WIKI-GLOSSARY:START -->
## Glossary

- [[canonical/glossary]]
  - Read: terms, roles, states, permissions, events, API/DB/UI names, naming conflicts.
  - Update: core term is added, renamed, or deprecated.
  - Token budget: medium.
<!-- PROJECT-WIKI-GLOSSARY:END -->`;

const inboxIndexBlock = `<!-- PROJECT-WIKI-INBOX:START -->
## Inbox

- [[inbox/project-candidates]]
  - Read: captured project candidates not yet adopted.
  - Update: \`--capture-inbox\` adds a candidate or status changes.
  - Token budget: on-demand.
<!-- PROJECT-WIKI-INBOX:END -->`;

const wikiOperatingModel = `${metadata("wiki-meta", "medium", "wiki/meta/wiki-ops-v1-decisions.md", "wiki operating rules, hook behavior, bootstrap behavior, language policy, or token policy changes")}
# Wiki Operating Model

## TL;DR

- This wiki keeps project-planning knowledge as durable markdown.
- The session-start hook injects only \`wiki/startup.md\` and \`wiki/index.md\`.
- Detailed canonical and decision files are read on demand.
- Root \`AGENTS.md\` keeps the project-wide wiki-first contract; \`wiki/AGENTS.md\` keeps detailed wiki editing rules.
- Operating documents generated by bootstrap are English by default.
- Project canonical content language is selected from user/project context, not hardcoded by this bootstrap.
- Search, index refresh, inbox capture, and lifecycle checks are explicit script modes.

## Purpose

This wiki prevents project-planning knowledge from being trapped in one-off conversations. It gives humans and LLM agents a compact startup path plus durable source-of-truth documents.

## Applied Source Pattern

Karpathy's LLM Wiki pattern favors a continuously maintained markdown wiki over repeatedly rebuilding answers from scratch. This project applies that pattern to project planning.

## Layers

1. Sources: external docs, links, user notes, and evidence summaries.
2. Canonical project truth: current valid planning content under \`wiki/canonical/\`.
3. Project decisions: rationale, rejected alternatives, and revisit triggers under \`wiki/decisions/\`.
4. Startup context: compact session summary in \`wiki/startup.md\`.
5. Router: read/update/token-budget guidance in \`wiki/index.md\`.
6. Wiki meta: operating rules, decision policy, bootstrap, migration, lint, and language policy under \`wiki/meta/\`.

## Language Policy

- Bootstrap-generated operating documents are English.
- Project canonical content should use the language that best matches the user's language, project context, and surrounding materials.
- Keep a consistent project language once selected.
- If the user explicitly requests a language, that request wins.

## Query Procedure

Start with \`wiki/startup.md\` and \`wiki/index.md\`. Then select only relevant canonical, decision, meta, or source files using the "read when" rules.

Use keyword query when explicit search is useful:

\`\`\`bash
node scripts/init-project-wiki.js --query "search terms"
\`\`\`

## Token Discipline

- Do not inject long canonical bodies or full decision logs into startup context.
- Put a compact TL;DR near the top of knowledge pages.
- Keep read/update/token-budget hints in \`wiki/index.md\`.
- Use \`decisions/log.md\` for accumulated timestamps and surface only important recent decisions in \`decisions/recent.md\` or \`startup.md\`.

## Git Hook Setup

- The script installs \`.githooks/prepare-commit-msg\` and \`.githooks/wiki-commit-trailers.js\`.
- By default, git repositories are configured with \`git config core.hooksPath .githooks\`.
- Run bootstrap with \`--no-git-config\` to install hook files without changing git config.
`;

const decisionPolicy = `${metadata("wiki-meta", "medium", "wiki/meta/wiki-ops-v1-decisions.md", "project decision recording levels or ADR criteria change")}
# Decision Policy

## TL;DR

- Canonical docs hold current agreement; project decision docs hold rationale and history.
- Simple project changes update canonical docs only.
- Trivial decisions that need timing go into \`decisions/log.md\`.
- Related decisions can be grouped into a Decision Pack.
- Heavy decisions use a Full ADR.
- Wiki operating decisions belong in \`wiki/meta/\`, not project decision history.

## 1. Canonical Only

Use only \`wiki/canonical/\` for simple spec confirmation, current behavior descriptions, reversible wording edits, and low-context changes.

## 2. One-Line Log

Use \`wiki/decisions/log.md\` when the main value is timestamp tracking.

\`\`\`md
- YYYY-MM-DD | area | decision | canonical: [[canonical/example]]
\`\`\`

## 3. Decision Pack

Use a Decision Pack when several related choices share one topic.

| Date | Decision | Rationale | Rejected Alternative | Revisit Trigger | Canonical Link |
| --- | --- | --- | --- | --- | --- |

## 4. Full ADR

Use a Full ADR when the decision affects product direction, architecture, public API, data model, security/permissions, SEO contracts, high migration cost, or a likely future challenge.

## Token Rules

- Put a TL;DR near the top of canonical docs.
- Do not inject full canonical or decision bodies into startup context.
- Read long decision files only when \`wiki/index.md\` routing says they are relevant.
`;

const starterFiles = {
  "wiki/README.md": `${metadata("wiki-entry", "short", "wiki/meta/wiki-ops-v1-decisions.md", "top-level wiki structure changes")}
# Project Wiki

This directory is the durable project-planning source of truth. Keep product direction, specs, constraints, terms, and decisions current here.

## Start Here

- [[startup]]
- [[index]]
- [[canonical/project-brief]]
- [[canonical/open-questions]]
- [[canonical/assumptions]]
- [[canonical/risks]]
`,
  "wiki/canonical/project-brief.md": `${metadata("project-canonical", "medium", "none", "product direction, audience, scope, success criteria, or language choice changes")}
# Project Brief

## TL;DR

- Current state: product/service topic is not decided yet.
- This file is the current project-planning truth for direction, audience, scope, and success criteria.
- Content language: choose from user/project context and keep it consistent.

## Current State

Product/service topic is not decided yet.

## To Decide

- Problem/opportunity
- Target users
- Core user scenario
- Success criteria
- Key constraints
- Initial scope
`,
  "wiki/canonical/open-questions.md": `${metadata("project-canonical", "short", "none", "project questions are added, answered, or retired")}
# Open Questions

## TL;DR

- This page tracks unresolved project questions.
- Move answered questions into relevant canonical docs or mark them resolved.

## Product

- What problem should this project solve?
- Who is it for?
- What is the first core scenario?
- What counts as success?

## Operations

- None yet.
`,
  "wiki/canonical/assumptions.md": `${metadata("project-canonical", "short", "none", "assumptions are added, validated, or retired")}
# Assumptions

## TL;DR

- This page tracks temporary assumptions before they are validated.
- When an assumption becomes true project knowledge, move it into the relevant canonical doc.

## Active

- Product/service topic is not decided yet.

## Retired

- None.
`,
  "wiki/canonical/risks.md": `${metadata("project-canonical", "short", "none", "project risks are added, mitigated, or resolved")}
# Risks

## TL;DR

- This page tracks project-planning risks and revisit triggers.
- When a risk is resolved, keep the status and evidence.

## Active

| Risk | Impact | Mitigation | Revisit Trigger |
| --- | --- | --- | --- |
| None | - | - | - |

## Resolved

None.
`,
  "wiki/decisions/README.md": `${metadata("project-decisions", "short", "wiki/meta/decision-policy.md", "project decision structure changes")}
# Decisions

This directory preserves project decision history. Current valid project specs belong in \`../canonical/\`.

Wiki operation, hook, bootstrap, lint, migration, and language-policy decisions belong in \`../meta/\`, not here.
`,
  "wiki/decisions/log.md": `${metadata("project-decisions", "on-demand", "wiki/meta/decision-policy.md", "trivial project decisions need timestamp tracking")}
# Decision Log

No project decisions yet.
`,
  "wiki/decisions/recent.md": `${metadata("project-decisions", "short", "wiki/meta/decision-policy.md", "recent important project decisions change")}
# Recent Decisions

## TL;DR

- Keep only recent important project decisions that may matter at session start.
- Use [[decisions/log]] for full timestamp tracking.

## Decisions

- None yet.
`,
  "wiki/meta/wiki-ops-v1-decisions.md": `${metadata("wiki-meta-decisions", "medium", "self", "wiki operation, metadata, lint, migration, language policy, or storage-boundary decisions change")}
# Wiki Operations v1 Decisions

Status: accepted
Scope: wiki operation
Canonical: [[meta/operating-model]], [[meta/decision-policy]]

| Date | Decision | Rationale | Rejected Alternative | Revisit Trigger | Canonical Link |
| --- | --- | --- | --- | --- | --- |
| ${today} | Keep the wiki root at \`./wiki\`. | Planning docs live with the project. | External docs only. | Another tool cannot read \`./wiki\` or the team needs another path. | [[meta/operating-model]] |
| ${today} | Split \`canonical/\` and \`decisions/\`. | Current truth and decision history are easier to scan when separated. | A single mixed docs directory. | The structure proves too heavy for small projects. | [[meta/decision-policy]] |
| ${today} | Inject only \`startup.md\` and \`index.md\`; route detailed files Read On Demand. | Full canonical and decision bodies waste startup tokens. | Always read detailed canonical and decision files first. | Important context is repeatedly missed at startup. | [[startup]], [[index]] |
| ${today} | Use metadata headers on wiki knowledge pages. | Agents and humans can quickly judge status, scope, budget, and review triggers. | Body-only conventions. | Header maintenance costs more than it saves. | [[meta/operating-model]] |
| ${today} | Keep wiki operating docs in \`wiki/meta/\`. | Project truth stays focused on product/project content. | Store operating docs in \`canonical/\` or \`decisions/\`. | Meta docs become hard to discover. | [[meta/operating-model]] |
| ${today} | Bootstrap-generated operating documents are English by default. | Repository entry points and operating contracts are easier for public users to inspect. | Generate operating docs in a fixed non-English language. | The project intentionally targets a single-language local audience. | [[meta/operating-model]] |
| ${today} | Project canonical content language is chosen from user/project context. | User language and source material should drive project truth, not the bootstrap tool. | Hardcode Korean or English as the canonical content language. | A team requires a fixed language policy. | [[startup]], [[index]] |
| ${today} | Install git hook files but allow \`--no-git-config\`. | Public users may not want \`core.hooksPath\` changed automatically. | Always configure git hooks. | Users prefer automatic setup and accept the side effect. | [[meta/operating-model]] |
| ${today} | Commit automation writes the \`Wiki-scope\` trailer. | Reviewers should see whether a commit touched startup, canonical docs, decisions, or wiki operations. | Leave wiki impact implicit in the diff. | Trailer format becomes too noisy. | [[meta/operating-model]] |
| ${today} | Migration may mark rows \`needs-human-review\`. | Ambiguous, risky, or high-impact legacy content should not be closed automatically. | Force every migrated row into adopted/rejected/resolved. | Human review queues become too large. | [[meta/operating-model]] |
| ${today} | Capture stores candidates in \`wiki/inbox/\`. | Useful ideas are not lost, but unreviewed content does not become canonical truth. | Save all conversation content directly into canonical docs. | Inbox content is frequently abandoned. | [[meta/operating-model]] |
`,
  "wiki/decisions/decision-pack-template.md": `${metadata("project-decision-template", "short", "wiki/meta/decision-policy.md", "decision pack format changes", "template")}
# <Topic> v<N> Decisions

Status: proposed | accepted | superseded
Scope:
Canonical:

| Date | Decision | Rationale | Rejected Alternative | Revisit Trigger | Canonical Link |
| --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD |  |  |  |  |  |
`,
  "wiki/decisions/full-adr-template.md": `${metadata("project-decision-template", "short", "wiki/meta/decision-policy.md", "full ADR format changes", "template")}
# ADR: <Title>

Status: proposed | accepted | superseded
Date: YYYY-MM-DD
Canonical:

## Context

## Decision

## Consequences

## Rejected Alternatives

## Revisit Trigger
`,
  "wiki/sources/karpathy-llm-wiki.md": `${metadata("source-summary", "short", "wiki/meta/wiki-ops-v1-decisions.md", "source interpretation or reference link changes")}
# Karpathy LLM Wiki

## TL;DR

- This pattern favors continuously maintained markdown wiki context over repeatedly reconstructing context from scratch.
- This project applies the pattern to project-planning source-of-truth management.

Source: [karpathy/llm-wiki.md](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
Checked: ${today}

## Applied Here

- \`wiki/startup.md\` stores compact session context.
- \`wiki/index.md\` routes reads and updates.
- \`wiki/canonical/\` stores current project truth.
- \`wiki/decisions/\` stores project decision history.
- \`wiki/meta/\` stores wiki operating rules and operating decisions.
`,
};

function walkFilesUnder(relativePath, predicate, acc = []) {
  const dirPath = abs(relativePath);
  if (!fs.existsSync(dirPath)) return acc;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    const childRelative = normalizePath(path.relative(root, fullPath));
    if (entry.isDirectory()) {
      walkFilesUnder(childRelative, predicate, acc);
    } else if (entry.isFile() && predicate(childRelative)) {
      acc.push(childRelative);
    }
  }
  return acc.sort();
}

const standardWikiFiles = new Set([
  "AGENTS.md",
  "wiki/AGENTS.md",
  ".githooks/prepare-commit-msg",
  ".githooks/wiki-commit-trailers.js",
  ".codex/hooks.json",
  ".codex/hooks/wiki-session-start.js",
  "wiki/README.md",
  "wiki/startup.md",
  "wiki/index.md",
  "wiki/inbox/project-candidates.md",
  "wiki/migration/inventory.md",
  "wiki/migration/plan.md",
  "wiki/migration/review.md",
  "wiki/migration/verification.md",
  "wiki/canonical/project-brief.md",
  "wiki/canonical/glossary.md",
  "wiki/canonical/open-questions.md",
  "wiki/canonical/assumptions.md",
  "wiki/canonical/risks.md",
  "wiki/canonical/migration-inbox.md",
  "wiki/decisions/README.md",
  "wiki/decisions/log.md",
  "wiki/decisions/recent.md",
  "wiki/decisions/decision-pack-template.md",
  "wiki/decisions/full-adr-template.md",
  "wiki/decisions/migration-inbox.md",
  "wiki/meta/operating-model.md",
  "wiki/meta/decision-policy.md",
  "wiki/meta/wiki-ops-v1-decisions.md",
  "wiki/sources/karpathy-llm-wiki.md",
  "wiki/sources/migration-inbox.md",
  "tools/project-wiki-bootstrap/SKILL.md",
  "tools/project-wiki-bootstrap/agents/openai.yaml",
  "tools/project-wiki-bootstrap/scripts/init-project-wiki.js",
]);

const ignoredDirs = new Set([".git", ".codex", "node_modules", ".next", "dist", "build", "coverage", "vendor", "tmp", "temp"]);

function walkMarkdownFiles(dir = root, acc = [], baseDir = root) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = normalizePath(path.relative(root, fullPath));
    const basePath = normalizePath(path.relative(baseDir, fullPath));
    if (!relativePath || relativePath.startsWith("..")) continue;
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      if (relativePath === "tools/project-wiki-bootstrap") continue;
      if (relativePath.startsWith("wiki/migration")) continue;
      walkMarkdownFiles(fullPath, acc, baseDir);
    } else if (entry.isFile() && /\.(md|mdx)$/i.test(entry.name) && !standardWikiFiles.has(relativePath)) {
      acc.push({ path: relativePath, basePath });
    }
  }
  return acc.sort((a, b) => a.path.localeCompare(b.path));
}

function firstHeading(text, fallback) {
  const heading = text.match(/^#{1,3}\s+(.+)$/m);
  if (heading) return heading[1].trim().replace(/\s+/g, " ");
  return fallback.replace(/\.(md|mdx)$/i, "").split("/").pop();
}

function compactSummary(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_`>\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function classifyMarkdown(relativePath, text) {
  const haystack = `${relativePath}\n${text.slice(0, 8000)}`.toLowerCase();
  const hasDecisionSignal = /\b(adr|decision|decisions|rejected|alternative|tradeoff|rationale)\b|결정|기각|대안|재검토/.test(haystack);
  const hasSourceSignal = /\b(source|sources|reference|references|bibliography|citation|citations|research|paper|article|link)\b|출처|참고|자료|링크/.test(haystack);
  const hasCanonicalSignal = /\b(prd|brief|spec|requirements|roadmap|architecture|api|data model|policy|scope|goal|goals|user|users|persona|scenario|success)\b|정본|요구사항|기획|범위|목표|사용자|시나리오|성공/.test(haystack);
  if (hasDecisionSignal) return "decision";
  if (hasSourceSignal) return "source";
  if (hasCanonicalSignal) return "canonical";
  if (/^(docs|documentation|wiki|notes|knowledge|specs)\//.test(relativePath)) return "canonical";
  return "other";
}

function splitMarkdownRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function parseMarkdownTableRows(text, expectedColumns) {
  return text
    .split(/\r?\n/)
    .filter((line) => /^\|.+\|$/.test(line.trim()))
    .map(splitMarkdownRow)
    .filter((cells) => cells.length >= expectedColumns)
    .filter((cells) => !cells.every((cell) => /^-+$/.test(cell.replace(/\s/g, ""))))
    .filter((cells) => !/^(source|legacy source|document)$/i.test(cells[0]))
    .filter((cells) => cells[0] !== "none");
}

function markdownTableRows(items) {
  if (items.length === 0) return "| none | - | - | - |\n";
  return items.map((item) => `| ${item.path} | ${item.title.replace(/\|/g, "/")} | ${item.summary.replace(/\|/g, "/")} | pending |`).join("\n") + "\n";
}

function buildInbox(title, description, items) {
  return `${metadata("migration-inbox", "medium", "wiki/meta/wiki-ops-v1-decisions.md", "migration candidates are adopted or rescanned")}
# ${title}

## TL;DR

- ${description}
- Original files are preserved under a \`wiki_legacy\` directory.
- Review each item, rewrite useful meaning into canonical/decision/source/meta docs, then set status to adopted/rejected/resolved/needs-human-review.
- Status values: pending, adopted, rejected, resolved, needs-human-review.

| Source | Title | Summary | Status |
| --- | --- | --- | --- |
${markdownTableRows(items)}`;
}

function timestampSuffix() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
}

function prepareMigrationMode() {
  if (exists("wiki")) {
    let legacyPath = "wiki_legacy";
    if (exists(legacyPath)) legacyPath = `wiki_legacy_${timestampSuffix()}`;
    fs.renameSync(abs("wiki"), abs(legacyPath));
    return { legacyPath, note: `moved wiki to ${legacyPath}` };
  }
  if (exists("wiki_legacy")) return { legacyPath: "wiki_legacy", note: "using existing wiki_legacy" };
  return { legacyPath: "", note: "no existing wiki directory to migrate" };
}

function migrationTargetForKind(kind) {
  if (kind === "decision") return "wiki/decisions/migration-inbox.md";
  if (kind === "source") return "wiki/sources/migration-inbox.md";
  return "wiki/canonical/migration-inbox.md";
}

function runMigrationMode(migrationState) {
  const legacyPath = migrationState.legacyPath;
  const markdownFiles = legacyPath && exists(legacyPath) ? walkMarkdownFiles(abs(legacyPath), [], abs(legacyPath)) : [];
  const items = markdownFiles.map((file) => {
    const text = read(file.path);
    return {
      path: file.path,
      legacyPath: file.basePath,
      kind: classifyMarkdown(file.path, text),
      title: firstHeading(text, file.path),
      summary: compactSummary(text),
      bytes: Buffer.byteLength(text, "utf8"),
    };
  });
  const byKind = {
    canonical: items.filter((item) => item.kind === "canonical"),
    decision: items.filter((item) => item.kind === "decision"),
    source: items.filter((item) => item.kind === "source"),
    other: items.filter((item) => item.kind === "other"),
  };

  const inventoryRows = items.length === 0
    ? "| none | - | - | 0 | - |\n"
    : items.map((item) => `| ${item.path} | ${item.kind} | ${item.title.replace(/\|/g, "/")} | ${item.bytes} | ${item.summary.replace(/\|/g, "/")} |`).join("\n") + "\n";
  const inventory = `${metadata("migration-inventory", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration scan is rerun")}
# Migration Inventory

## TL;DR

- Generated: ${today}
- Legacy root: ${legacyPath || "none"}
- Markdown files: ${items.length}
- Legacy files are not copied directly into the new wiki; they are mapped to rewrite inboxes.

| Legacy Source | Classification | Title | Size (bytes) | Summary |
| --- | --- | --- | ---: | --- |
${inventoryRows}`;

  const plan = `${metadata("migration-plan", "short", "wiki/meta/wiki-ops-v1-decisions.md", "migration procedure or status changes")}
# Migration Plan

## TL;DR

- Generated: ${today}
- Preparation: ${migrationState.note}
- The new \`./wiki\` uses the standard structure.
- Next step: review inbox items and absorb useful meaning into canonical, decisions, sources, or meta docs.

## Counts

| Classification | Count |
| --- | ---: |
| canonical candidates | ${byKind.canonical.length} |
| decision candidates | ${byKind.decision.length} |
| source candidates | ${byKind.source.length} |
| other candidates | ${byKind.other.length} |
`;

  const verificationRows = items.length === 0
    ? "| none | - | - | pass | - |\n"
    : items.map((item) => `| ${item.path} | ${item.kind} | ${migrationTargetForKind(item.kind)} | mapped | pending semantic rewrite |`).join("\n") + "\n";
  const verification = `${metadata("migration-verification", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration inbox items are adopted, rejected, or rescanned")}
# Migration Verification

## TL;DR

- legacy root: ${legacyPath || "none"}
- legacy markdown files: ${items.length}
- mapped files: ${items.length}
- coverage: ${items.length === markdownFiles.length ? "pass" : "fail"}
- This verifies file coverage only. Semantic completeness is confirmed after inbox statuses are resolved.

| Legacy Source | Classification | New Wiki Target | Coverage | Semantic Status |
| --- | --- | --- | --- | --- |
${verificationRows}`;

  const migrationStartupBlock = `<!-- PROJECT-WIKI-MIGRATION:START -->
## Migration State

- ${today}: preserved existing wiki at \`${legacyPath || "no wiki_legacy"}\` and regenerated the standard wiki structure.
- Scanned ${items.length} legacy markdown files and created migration inventory, plan, verification, and inbox files.
- Do not delete \`${legacyPath || "wiki_legacy"}\` until all migration inbox items are adopted/rejected/resolved and needs-human-review is 0.
<!-- PROJECT-WIKI-MIGRATION:END -->`;

  const migrationIndexBlock = `<!-- PROJECT-WIKI-MIGRATION:START -->
## Migration

- [[migration/plan]]
  - Read when: migration procedure or status matters.
  - Update when: migration procedure or state changes.
  - Token budget: short.
- [[migration/inventory]]
  - Read when: legacy markdown file list and classification matter.
  - Update when: migration is rescanned.
  - Token budget: on-demand.
- [[migration/verification]]
  - Read when: legacy file coverage or semantic migration status matters.
  - Update when: migration inbox statuses change.
  - Token budget: on-demand.
- [[migration/review]]
  - Read when: semantic migration review status matters.
  - Update when: \`--review-migration\` syncs migration state.
  - Token budget: on-demand.
- [[canonical/migration-inbox]]
  - Read when: absorbing legacy canonical candidates.
  - Update when: candidates are adopted/rejected/resolved/needs-human-review.
  - Token budget: medium.
- [[decisions/migration-inbox]]
  - Read when: absorbing legacy decision candidates.
  - Update when: candidates are adopted/rejected/resolved/needs-human-review.
  - Token budget: medium.
- [[sources/migration-inbox]]
  - Read when: absorbing legacy source candidates.
  - Update when: candidates are adopted/rejected/resolved/needs-human-review.
  - Token budget: medium.
<!-- PROJECT-WIKI-MIGRATION:END -->`;

  const results = [];
  mkdirp("wiki/migration");
  results.push(["wiki/migration/inventory.md", writeManaged("wiki/migration/inventory.md", inventory)]);
  results.push(["wiki/migration/plan.md", writeManaged("wiki/migration/plan.md", plan)]);
  results.push(["wiki/migration/verification.md", writeManaged("wiki/migration/verification.md", verification)]);
  results.push(["wiki/canonical/migration-inbox.md", writeManaged("wiki/canonical/migration-inbox.md", buildInbox("Canonical Migration Inbox", "Legacy content that may belong in current project truth.", byKind.canonical.concat(byKind.other)))]);
  results.push(["wiki/decisions/migration-inbox.md", writeManaged("wiki/decisions/migration-inbox.md", buildInbox("Decision Migration Inbox", "Legacy content that may belong in project decision history.", byKind.decision))]);
  results.push(["wiki/sources/migration-inbox.md", writeManaged("wiki/sources/migration-inbox.md", buildInbox("Source Migration Inbox", "Legacy content that may belong in source summaries.", byKind.source))]);
  results.push(["wiki/startup.md migration state", upsertMarkedSection("wiki/startup.md", "<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->", migrationStartupBlock)]);
  results.push(["wiki/index.md migration router", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->", migrationIndexBlock)]);
  return { results, total: items.length, legacyPath };
}

function normalizeMigrationStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (["adopted", "rejected", "resolved", "needs-human-review", "pending"].includes(value)) return value;
  if (value.includes("adopt")) return "adopted";
  if (value.includes("reject")) return "rejected";
  if (value.includes("resolve")) return "resolved";
  if (value.includes("human")) return "needs-human-review";
  return "pending";
}

function migrationInboxStatusMap() {
  const inboxFiles = ["wiki/canonical/migration-inbox.md", "wiki/decisions/migration-inbox.md", "wiki/sources/migration-inbox.md"];
  const statuses = new Map();
  for (const file of inboxFiles) {
    if (!exists(file)) continue;
    for (const cells of parseMarkdownTableRows(read(file), 4)) {
      statuses.set(cells[0], { status: normalizeMigrationStatus(cells[3]), inbox: file });
    }
  }
  return statuses;
}

function semanticStatusForInboxStatus(status) {
  if (["adopted", "rejected", "resolved", "needs-human-review"].includes(status)) return status;
  return "pending semantic rewrite";
}

function runReviewMigrationMode() {
  if (!exists("wiki/migration/verification.md")) {
    console.error("missing wiki/migration/verification.md; run --migrate first");
    process.exit(1);
  }
  const verificationText = read("wiki/migration/verification.md");
  const verificationRows = parseMarkdownTableRows(verificationText, 5).map((cells) => ({
    legacyPath: cells[0],
    kind: cells[1],
    target: cells[2],
    coverage: cells[3],
  }));
  const inboxStatuses = migrationInboxStatusMap();
  const reviewedRows = verificationRows.map((row) => {
    const inbox = inboxStatuses.get(row.legacyPath);
    const status = inbox ? inbox.status : "needs-human-review";
    return { ...row, inboxStatus: status, semanticStatus: semanticStatusForInboxStatus(status), note: inbox ? inbox.inbox : "missing migration inbox row" };
  });
  const counts = reviewedRows.reduce((acc, row) => {
    acc[row.inboxStatus] = (acc[row.inboxStatus] || 0) + 1;
    return acc;
  }, {});
  const pending = counts.pending || 0;
  const needsHuman = counts["needs-human-review"] || 0;
  const complete = pending === 0 && needsHuman === 0;
  const reviewRows = reviewedRows.length === 0
    ? "| none | - | - | - | - |\n"
    : reviewedRows.map((row) => `| ${row.legacyPath} | ${row.kind} | ${row.inboxStatus} | ${row.semanticStatus} | ${row.note.replace(/\|/g, "/")} |`).join("\n") + "\n";
  const review = `${metadata("migration-review", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration inbox statuses change")}
# Migration Review

## TL;DR

- generated: ${today}
- total legacy rows: ${reviewedRows.length}
- adopted: ${counts.adopted || 0}
- rejected: ${counts.rejected || 0}
- resolved: ${counts.resolved || 0}
- pending: ${pending}
- needs-human-review: ${needsHuman}
- semantic migration complete: ${complete ? "yes" : "no"}

| Legacy Source | Classification | Inbox Status | Semantic Status | Evidence |
| --- | --- | --- | --- | --- |
${reviewRows}`;
  const verificationRowsText = reviewedRows.length === 0
    ? "| none | - | - | pass | - |\n"
    : reviewedRows.map((row) => `| ${row.legacyPath} | ${row.kind} | ${row.target} | ${row.coverage} | ${row.semanticStatus} |`).join("\n") + "\n";
  const legacyRoot = (verificationText.match(/^- legacy root:\s*(.+)$/m) || [])[1] || "unknown";
  const verification = `${metadata("migration-verification", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration inbox items are adopted, rejected, resolved, or marked needs-human-review")}
# Migration Verification

## TL;DR

- legacy root: ${legacyRoot}
- legacy markdown files: ${reviewedRows.length}
- mapped files: ${reviewedRows.filter((row) => row.coverage === "mapped").length}
- coverage: ${reviewedRows.every((row) => row.coverage === "mapped") ? "pass" : "fail"}
- semantic migration complete: ${complete ? "yes" : "no"}
- pending: ${pending}
- needs-human-review: ${needsHuman}

| Legacy Source | Classification | New Wiki Target | Coverage | Semantic Status |
| --- | --- | --- | --- | --- |
${verificationRowsText}`;
  const results = [
    ["wiki/migration/review.md", writeManaged("wiki/migration/review.md", review)],
    ["wiki/migration/verification.md", writeManaged("wiki/migration/verification.md", verification)],
  ];
  console.log("Project wiki migration review complete.");
  for (const [relativePath, status] of results) console.log(`${status.padEnd(7)} ${relativePath}`);
  console.log(`summary pending=${pending} needs-human-review=${needsHuman} complete=${complete ? "yes" : "no"}`);
}

function wikiMarkdownFiles() {
  return walkFilesUnder("wiki", (file) => /\.(md|mdx)$/i.test(file) && file !== "wiki/AGENTS.md").sort();
}

function wikiLinkForFile(relativePath) {
  return `[[${relativePath.replace(/^wiki\//, "").replace(/\.(md|mdx)$/i, "")}]]`;
}

function wikiTitleForFile(relativePath, text) {
  return firstHeading(stripMetadataHeader(text), relativePath);
}

function metadataSummary(relativePath, text) {
  return {
    status: metadataValue(text, "status") || "-",
    scope: metadataValue(text, "scope") || "-",
    budget: metadataValue(text, "read_budget") || "-",
  };
}

function stripMarkedSection(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start < 0 || end <= start) return text;
  return `${text.slice(0, start).trimEnd()}\n\n${text.slice(end + endMarker.length).trimStart()}`.trim() + "\n";
}

function extractMarkedSection(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start < 0 || end <= start) return "";
  return text.slice(start, end + endMarker.length).trim();
}

function withPreservedMarkedSections(relativePath, base, markerPairs) {
  if (!exists(relativePath)) return base;
  const current = read(relativePath);
  const preserved = markerPairs
    .map(([startMarker, endMarker]) => extractMarkedSection(current, startMarker, endMarker))
    .filter(Boolean)
    .filter((section) => !base.includes(section));
  if (preserved.length === 0) return base;
  return `${base.trimEnd()}\n\n${preserved.join("\n\n")}\n`;
}

function hasGlossaryNeedSignal(text) {
  return /(^|\n)##\s+(Glossary|Terms|Roles|Entities|Data Model|State Model|Permissions|Events|용어|역할|엔티티|상태 모델|권한|이벤트)(\s|$)|`[^`]+`\s*(term|role|state|permission|event|entity|API|DB|UI|용어|역할|상태|권한|이벤트|엔티티)/i.test(text);
}

function hasGlossaryTable(text) {
  const body = stripMetadataHeader(text);
  return /\|\s*Term\s*\|\s*Definition\s*\|\s*Avoid\s*\|\s*Related Canonical Doc\s*\|\s*Status\s*\|/.test(body);
}

function canonicalBodyForLint() {
  return walkFilesUnder("wiki/canonical", (file) => /\.(md|mdx)$/i.test(file) && file !== "wiki/canonical/glossary.md")
    .map((file) => stripMetadataHeader(read(file)))
    .join("\n");
}

function buildRefreshIndexBlock() {
  const indexText = exists("wiki/index.md") ? read("wiki/index.md") : "";
  const comparableIndex = stripMarkedSection(indexText, "<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->");
  const files = wikiMarkdownFiles().filter((file) => !["wiki/index.md", "wiki/startup.md", "wiki/README.md"].includes(file));
  const missing = files.filter((file) => !comparableIndex.includes(wikiLinkForFile(file)));
  const rows = missing.length === 0
    ? "| none | - | - | - |\n"
    : missing.map((file) => {
        const meta = metadataSummary(file, read(file));
        return `| ${wikiLinkForFile(file)} | ${meta.scope} | ${meta.status} | ${meta.budget} |`;
      }).join("\n") + "\n";
  return `<!-- PROJECT-WIKI-AUTO-INDEX:START -->
## Auto-Discovered Pages

This block is managed by \`--refresh-index\`. Move useful rows into a hand-written section when they become part of the normal route.

| Document | Scope | Status | Token Budget |
| --- | --- | --- | --- |
${rows}<!-- PROJECT-WIKI-AUTO-INDEX:END -->`;
}

function runQueryMode() {
  if (!queryTerm.trim()) {
    console.error("missing query: use --query \"search terms\"");
    process.exit(1);
  }
  const terms = queryTerm.toLowerCase().split(/\s+/).filter(Boolean);
  const results = wikiMarkdownFiles().map((file) => {
    const text = read(file);
    const body = stripMetadataHeader(text);
    const title = wikiTitleForFile(file, text);
    const meta = metadataSummary(file, text);
    const weighted = `${file}\n${title}\n${meta.scope}\n${metadataValue(text, "tags")}\n${body}`.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (weighted.split(term).length - 1) + (file.toLowerCase().includes(term) ? 3 : 0) + (title.toLowerCase().includes(term) ? 5 : 0), 0);
    return { file, title, score, ...meta };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, 10);
  console.log(`Project wiki query: ${queryTerm}`);
  if (results.length === 0) console.log("no matches");
  for (const item of results) console.log(`${item.score.toString().padStart(3)}  ${item.file}  ${item.scope}  ${item.status}  ${item.title}`);
}

function projectCandidatesContent() {
  return `${metadata("inbox", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "candidates are adopted, rejected, or stale")}
# Project Candidates Inbox

## TL;DR

- This file temporarily stores project-canonical candidates from conversation.
- This file is not canonical truth.
- After review, move useful content into canonical/decision/source/meta docs or mark it rejected/resolved.

| Date | Title | Category | Content | Status |
| --- | --- | --- | --- | --- |
`;
}

function appendCaptureInbox() {
  mkdirp("wiki/inbox");
  const relativePath = "wiki/inbox/project-candidates.md";
  if (!exists(relativePath)) write(relativePath, projectCandidatesContent());
  if (!captureTitle && !captureContent) return "created";
  const title = (captureTitle || "Untitled candidate").replace(/\|/g, "/");
  const content = (captureContent || "").replace(/\r?\n/g, "<br>").replace(/\|/g, "/");
  const row = `| ${today} | ${title} | ${captureCategory.replace(/\|/g, "/")} | ${content} | pending |`;
  const current = read(relativePath);
  if (current.includes(row)) return "exists";
  write(relativePath, `${current.trimEnd()}\n${row}\n`);
  return "updated";
}

function runPruneCheckMode() {
  const candidates = [];
  for (const file of wikiMarkdownFiles()) {
    const text = read(file);
    const status = metadataValue(text, "status");
    const updated = metadataValue(text, "updated");
    const trigger = metadataValue(text, "review_trigger");
    const scope = metadataValue(text, "scope");
    const body = stripMetadataHeader(text);
    const reasons = [];
    const lifecycleScope = /project-canonical|project-decisions|inbox|migration-inbox/.test(scope);
    if (status === "active" && lifecycleScope && /pending|proposed|undecided|TODO|TBD|미정/i.test(body)) reasons.push("contains pending/proposed/undecided signal");
    if (status === "active" && trigger && /stale|old|expired|due|오래|도래|만료/i.test(trigger)) reasons.push(`review trigger: ${trigger}`);
    if (updated && updated < today && status === "active") reasons.push(`updated before today: ${updated}`);
    if (reasons.length > 0) candidates.push({ file, status, updated, reasons });
  }
  console.log("Project wiki prune-check");
  if (candidates.length === 0) console.log("no candidates");
  for (const item of candidates) {
    console.log(`${item.file}  status=${item.status || "-"}  updated=${item.updated || "-"}`);
    for (const reason of item.reasons) console.log(`  - ${reason}`);
  }
}

function runLintMode() {
  const errors = [];
  const warnings = [];
  const requiredFiles = [
    "AGENTS.md",
    "CLAUDE.md",
    "wiki/AGENTS.md",
    "wiki/startup.md",
    "wiki/index.md",
    "wiki/canonical/project-brief.md",
    "wiki/canonical/open-questions.md",
    "wiki/canonical/assumptions.md",
    "wiki/canonical/risks.md",
    "wiki/decisions/log.md",
    "wiki/decisions/recent.md",
    "wiki/meta/operating-model.md",
    "wiki/meta/decision-policy.md",
    "wiki/meta/wiki-ops-v1-decisions.md",
    ".githooks/prepare-commit-msg",
    ".githooks/wiki-commit-trailers.js",
    ".codex/hooks/wiki-session-start.js",
    ".codex/hooks.json",
  ];
  for (const file of requiredFiles) {
    if (!exists(file)) errors.push(`missing required file: ${file}`);
  }
  const files = wikiMarkdownFiles();
  const requiredMetadataKeys = ["status", "updated", "scope", "read_budget", "decision_ref", "review_trigger"];
  for (const file of files) {
    const text = read(file);
    if (!hasMetadataHeader(text)) {
      errors.push(`missing metadata header: ${file}`);
      continue;
    }
    for (const key of requiredMetadataKeys) {
      if (!metadataValue(text, key)) errors.push(`missing metadata key ${key}: ${file}`);
    }
  }
  const startupLength = exists("wiki/startup.md") ? read("wiki/startup.md").length : 0;
  const indexLength = exists("wiki/index.md") ? read("wiki/index.md").length : 0;
  if (startupLength > 3500) warnings.push(`startup exceeds hook budget: ${startupLength}/3500 chars`);
  if (indexLength > 4500) warnings.push(`index exceeds hook budget: ${indexLength}/4500 chars`);
  if (exists("wiki/startup.md") && /##\s+Always Read First/.test(read("wiki/startup.md"))) warnings.push("startup uses Always Read First; prefer Read On Demand routing");
  if (exists("AGENTS.md") && !read("AGENTS.md").includes("wiki/AGENTS.md")) warnings.push("root AGENTS.md should point detailed wiki editing rules to wiki/AGENTS.md");
  if (exists("CLAUDE.md") && !read("CLAUDE.md").includes("@AGENTS.md")) errors.push("CLAUDE.md should import AGENTS.md for Claude Code compatibility");
  if (exists("wiki/AGENTS.md") && !read("wiki/AGENTS.md").includes("Language policy")) warnings.push("wiki/AGENTS.md is missing language policy");
  for (const legacyFile of ["wiki/canonical/wiki-operating-model.md", "wiki/canonical/decision-policy.md", "wiki/decisions/wiki-v1-decisions.md"]) {
    if (exists(legacyFile)) errors.push(`legacy wiki-ops file must move out of project canonical/decisions: ${legacyFile}`);
  }
  if (exists(".codex/hooks/wiki-session-start.js")) {
    const hook = read(".codex/hooks/wiki-session-start.js");
    if (!hook.includes('["wiki/startup.md", 3500]') || !hook.includes('["wiki/index.md", 4500]')) errors.push("startup hook does not clearly inject only startup/index with expected budgets");
  }
  for (const file of [".githooks/prepare-commit-msg", ".githooks/wiki-commit-trailers.js"]) {
    if (exists(file) && (fs.statSync(abs(file)).mode & 0o111) === 0) errors.push(`${file} is not executable`);
  }
  if (isGitRepository() && !noGitConfigMode) {
    let hooksPath = "";
    try {
      hooksPath = childProcess.execFileSync("git", ["config", "--get", "core.hooksPath"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      hooksPath = "";
    }
    if (hooksPath !== ".githooks") warnings.push(`git core.hooksPath is not .githooks: ${hooksPath || "unset"}`);
  }
  if (exists("wiki/index.md") && !read("wiki/index.md").includes("## Language Policy")) errors.push("index is missing Language Policy section");
  if (exists("wiki/canonical/glossary.md")) {
    const glossaryText = read("wiki/canonical/glossary.md");
    if (!hasGlossaryTable(glossaryText)) errors.push("glossary is missing required table header: | Term | Definition | Avoid | Related Canonical Doc | Status |");
    if (exists("wiki/index.md") && !read("wiki/index.md").includes("[[canonical/glossary]]")) errors.push("glossary exists but index is missing glossary routing");
  } else if (hasGlossaryNeedSignal(canonicalBodyForLint())) {
    warnings.push("project canonical docs contain naming/model signals; consider running --glossary-init");
  }
  if (exists("wiki/meta/wiki-ops-v1-decisions.md")) {
    const ops = read("wiki/meta/wiki-ops-v1-decisions.md");
    for (const phrase of ["metadata headers", "Read On Demand", "language", "--no-git-config", "needs-human-review", "Wiki-scope"]) {
      if (!ops.includes(phrase)) warnings.push(`wiki ops decision pack may be missing decision phrase: ${phrase}`);
    }
  }
  console.log("Project wiki lint");
  for (const warning of warnings) console.log(`warn  ${warning}`);
  for (const error of errors) console.log(`error ${error}`);
  if (errors.length > 0) {
    console.log(`failed: ${errors.length} errors, ${warnings.length} warnings`);
    process.exit(1);
  }
  console.log(`passed: ${files.length} wiki markdown files checked, ${warnings.length} warnings`);
}

if (queryTerm) {
  runQueryMode();
  process.exit(0);
}
if (pruneCheckMode) {
  runPruneCheckMode();
  process.exit(0);
}
if (reviewMigrationMode) {
  runReviewMigrationMode();
  process.exit(0);
}
if (lintMode) {
  runLintMode();
  process.exit(0);
}

const migrationState = migrateMode ? prepareMigrationMode() : null;
const results = [];
if (migrationState) results.push(["migration prepare", migrationState.note]);

mkdirp("wiki/canonical");
mkdirp("wiki/decisions");
mkdirp("wiki/inbox");
mkdirp("wiki/meta");
mkdirp("wiki/sources");
mkdirp(".codex/hooks");
mkdirp(".githooks");

results.push(["AGENTS.md", upsertMarkedSection("AGENTS.md", "<!-- PROJECT-WIKI-FIRST:START -->", "<!-- PROJECT-WIKI-FIRST:END -->", agentsSection, "## Wiki-First Planning")]);
results.push(["CLAUDE.md", upsertMarkedSection("CLAUDE.md", "<!-- PROJECT-WIKI-CLAUDE:START -->", "<!-- PROJECT-WIKI-CLAUDE:END -->", claudeSection, "# Claude Code Project Instructions")]);
results.push(["wiki/AGENTS.md", upsertMarkedSection("wiki/AGENTS.md", "<!-- PROJECT-WIKI-INTERNAL:START -->", "<!-- PROJECT-WIKI-INTERNAL:END -->", wikiAgentsSection, "## Wiki Internal Rules")]);
results.push([".githooks/prepare-commit-msg", writeManaged(".githooks/prepare-commit-msg", gitPrepareCommitMsgHook)]);
makeExecutable(".githooks/prepare-commit-msg");
results.push([".githooks/wiki-commit-trailers.js", writeManaged(".githooks/wiki-commit-trailers.js", gitWikiCommitTrailersScript)]);
makeExecutable(".githooks/wiki-commit-trailers.js");
results.push(["git core.hooksPath", upsertGitHooksPath()]);
results.push([".codex/hooks.json", upsertHookConfig()]);
results.push([".codex/hooks/wiki-session-start.js", writeManaged(".codex/hooks/wiki-session-start.js", hookScript)]);
results.push(["wiki/startup.md", writeManaged("wiki/startup.md", withPreservedMarkedSections("wiki/startup.md", startup, [["<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->"]]))]);
results.push(["wiki/index.md", writeManaged("wiki/index.md", withPreservedMarkedSections("wiki/index.md", index, [
  ["<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->"],
  ["<!-- PROJECT-WIKI-GLOSSARY:START -->", "<!-- PROJECT-WIKI-GLOSSARY:END -->"],
  ["<!-- PROJECT-WIKI-INBOX:START -->", "<!-- PROJECT-WIKI-INBOX:END -->"],
  ["<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->"],
]))]);
results.push(["wiki/meta/operating-model.md", writeManaged("wiki/meta/operating-model.md", wikiOperatingModel)]);
results.push(["wiki/meta/decision-policy.md", writeManaged("wiki/meta/decision-policy.md", decisionPolicy)]);
results.push(["wiki/canonical/wiki-operating-model.md", deleteIfGenerated("wiki/canonical/wiki-operating-model.md", ["# Wiki Operating Model"])]);
results.push(["wiki/canonical/decision-policy.md", deleteIfGenerated("wiki/canonical/decision-policy.md", ["# Decision Policy"])]);
results.push(["wiki/decisions/wiki-v1-decisions.md", deleteIfGenerated("wiki/decisions/wiki-v1-decisions.md", ["# Wiki v1 Decisions", "# Wiki Operations v1 Decisions"])]);
for (const [relativePath, content] of Object.entries(starterFiles)) {
  results.push([relativePath, writeStarter(relativePath, content)]);
}
results.push(["wiki/meta/wiki-ops-v1-decisions.md", writeManaged("wiki/meta/wiki-ops-v1-decisions.md", starterFiles["wiki/meta/wiki-ops-v1-decisions.md"])]);
if (glossaryMode) {
  results.push(["wiki/canonical/glossary.md", writeStarter("wiki/canonical/glossary.md", glossary)]);
  results.push(["wiki/index.md glossary router", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-GLOSSARY:START -->", "<!-- PROJECT-WIKI-GLOSSARY:END -->", glossaryIndexBlock)]);
}
if (captureInboxMode) {
  results.push(["wiki/inbox/project-candidates.md", appendCaptureInbox()]);
  results.push(["wiki/index.md inbox router", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-INBOX:START -->", "<!-- PROJECT-WIKI-INBOX:END -->", inboxIndexBlock)]);
}
if (refreshIndexMode) {
  results.push(["wiki/index.md auto-discovered pages", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->", buildRefreshIndexBlock())]);
}
if (migrateMode) {
  const migration = runMigrationMode(migrationState);
  for (const result of migration.results) results.push(result);
  results.push(["migration summary", `${migration.total} files from ${migration.legacyPath || "no legacy"}`]);
}
const modes = [];
if (migrateMode) modes.push("migration");
if (glossaryMode) modes.push("glossary");
if (captureInboxMode) modes.push("capture-inbox");
if (refreshIndexMode) modes.push("refresh-index");
if (noGitConfigMode) modes.push("no-git-config");
console.log(modes.length > 0 ? `Project wiki bootstrap + ${modes.join(" + ")} complete.` : "Project wiki bootstrap complete.");
for (const [relativePath, status] of results) {
  console.log(`${String(status).padEnd(7)} ${relativePath}`);
}
