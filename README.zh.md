# Project Wiki Bootstrap

[![npm version](https://img.shields.io/npm/v/project-wiki-bootstrap.svg)](https://www.npmjs.com/package/project-wiki-bootstrap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Code evidence index](https://img.shields.io/badge/code%20evidence-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)

为人类和 LLM 代理 bootstrap 一个低 token 的项目规划 wiki。

语言: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

生成的 wiki 只加载以下文件，以保持启动上下文较小。

- `wiki/startup.md`: 当前项目上下文的 compact 摘要
- `wiki/index.md`: 选择下一步要读取的详细文件的路由器

详细的 canonical、decision、meta 和 source 文件只在当前任务需要时按需读取。

## 目录

- [快速开始](#快速开始)
- [Skill Actions](#skill-actions)
- [使用 Skill](#使用-skill)
- [基于代码的正本化](#基于代码的正本化)
- [安装内容](#安装内容)
- [生成的 Wiki 模型](#生成的-wiki-模型)
- [工作方式](#工作方式)
- [策略和副作用](#策略和副作用)
- [开发](#开发)
- [许可证](#许可证)

## 快速开始

`npx` 只用于 skill 安装和项目 bootstrap。之后的运维通过安装在 Codex 或 Claude Code 中的 skill 完成。

先为 Codex 和 Claude Code 安装一次 skill。

```bash
npx project-wiki-bootstrap install-skill --scope user --agents both
```

如果希望 skill 位于单个仓库内，请使用 `--scope project` 代替 `--scope user`。

```bash
npx project-wiki-bootstrap install-skill --scope project --agents both
```

然后在目标项目 root 中运行其中一个 bootstrap 命令。

| 场景 | 命令 |
| --- | --- |
| 新建 project wiki 或常规 update | `npx project-wiki-bootstrap` |
| 需要迁移已有 wiki/docs | `npx project-wiki-bootstrap --migrate` |
| 只安装 hook 文件而不修改 git config | `npx project-wiki-bootstrap --no-git-config` |

常见首次运行:

```bash
npx project-wiki-bootstrap
```

只安装某个 agent 时，使用 `--agents codex` 或 `--agents claude` 代替 `--agents both`。

## Skill Actions

安装此包后，会向 Codex 和 Claude Code 添加一个名为 `project-wiki-bootstrap` 的 skill。这个 skill 支持以下 project wiki action。

- Bootstrap 或 update: 创建或刷新 `AGENTS.md`、`CLAUDE.md`、`wiki/`、Codex hook、Claude Code hook 和 git hook 文件。
- Validate: 检查必需文件、metadata header、routing、hook 设置、可执行权限和 git hook 配置。
- Search: 根据路径、标题、metadata 和正文查找相关 wiki page。
- Refresh index: 更新 `wiki/index.md` 中的 auto-discovered page block。
- Capture candidate: 将内容作为候选保存到 `wiki/inbox/project-candidates.md`，但不把它变成 canonical truth。
- Prune check: 报告看起来处于 pending、stale、proposed 或 undecided 状态的 active wiki page。
- Glossary init: 当项目术语需要 canonical 归属位置时，创建 `wiki/canonical/glossary.md`。
- Code-informed canonicalization: 分析现有代码，并把代码确认的项目功能、策略、约束、领域规则和 open question 反映到 wiki 中。
- Code evidence index: 为大型仓库构建可丢弃的 SQLite 证据 cache，提供 file、symbol、import、route、关系、full-text search table 和 read-only query surface。
- Migration: 保留现有 wiki，创建新的 wiki，并生成 legacy markdown inventory 与 migration inbox。
- Migration review: 将已处理的 migration inbox status 同步到 review 和 verification page。
- No-git-config setup: 不修改 `core.hooksPath`，只安装 hook 文件。

## 使用 Skill

安装后，在 Codex 中使用自然语言请求。

- "把 project-wiki-bootstrap 应用到这个项目。"
- "验证项目 wiki 设置。"
- "在 project wiki 中查找认证相关决策。"
- "刷新 wiki index。"
- "把这段内容捕获为 project wiki candidate。"
- "分析现有代码并更新 project wiki。"
- "只以 `src/` 和 `packages/api/` 为依据更新 wiki。"
- "检查迁移后的 wiki inbox。"

在 Claude Code 中，可以直接调用 skill 或使用自然语言。

- `/project-wiki-bootstrap`
- "初始化项目 wiki。"
- "检查项目 wiki 是否正常。"
- "读取代码库，并把项目行为整理成 wiki 正本。"
- "查找关于发布风险的 wiki notes。"

Skill 会在内部把这些请求映射到合适的 lifecycle operation。项目 wiki 和 hook 只有在项目根目录执行 bootstrap 时才会创建。

## 基于代码的正本化

当仓库代码是说明项目实际行为的最佳依据时，使用这个 action。

这不是单独的 CLI flag，而是 skill workflow。所需范围用自然语言指定。

- "分析整个仓库，并基于代码更新 wiki。"
- "只分析 `apps/web/` 和 `packages/core/`。"
- "如果 generated file 和 test 对理解行为没有帮助，就排除它们。"

对于大型仓库，skill 可以通过 `npx project-wiki-bootstrap --code-index` 或 `npx project-wiki-bootstrap --code-evidence-index` 构建可重新生成的 SQLite code evidence index。范围在内部通过 `--code-scope` 或 `--code-evidence-scope` 传入。cache 位于 `.project-wiki/code-evidence.sqlite`，不是 canonical wiki content，应视为可丢弃的分析状态。

这个 evidence index 受到 code graph 工具思路的影响，但按 project-wiki 的术语和目的设计。它不是独立的 code intelligence 产品，而是用于 wiki 正本化的证据 cache。为了避免在大型仓库中反复扫描，它保存 file inventory、extraction profile、symbol、import、route、config signal、relationship edge 和 full-text search table，帮助 agent 快速找到证据。

安全性和 runtime 边界:

- Custom cache output 必须位于 `.project-wiki/` 下。此工具不会删除或创建其他位置的 code evidence database。
- Code scope 必须位于 project root 内部。
- 在 Git repository 中会使用 `git ls-files --cached --others --exclude-standard`，因此会尊重 `.gitignore`。
- 除 `.env.example` 外，`.env*` 文件都会从 code evidence index 中排除。
- 基础 bootstrap package 支持 Node 18+，但 code evidence indexing 需要提供 `node:sqlite` 的 Node runtime。当前 test 在 Node 22.17.1 上运行。

有用的 inspection surface:

| 目的 | 命令 |
| --- | --- |
| build 或 refresh evidence cache | `npx project-wiki-bootstrap --code-index --code-scope src` |
| 查看 cache count 和 metadata | `npx project-wiki-bootstrap --code-status` |
| 列出 indexed file 与 extraction profile | `npx project-wiki-bootstrap --code-files` |
| 搜索 indexed symbol | `npx project-wiki-bootstrap --code-search-symbol Auth` |
| 执行 read-only SQL | `npx project-wiki-bootstrap --code-query "select path from files order by path"` |

README 不发布广泛的语言支持 matrix。index 会记录每个 file 的 extraction profile，只有拥有强 extraction profile 的证据才应被视为 code-proven。Lightweight inventory 或 heuristic finding 应作为后续阅读的 pointer，而不是完整语言支持声明。

这个 workflow 会分离代码结构和项目正本。

- 代码结构、entrypoint、module 关系、read-on-demand route 和证据路径放在 `wiki/meta/` 下，由 LLM 选择描述性、项目特定的文件名。
- 代码确认的 product behavior、project feature、policy、constraint、terminology、domain rule 和 operational fact 放在 `wiki/canonical/`。
- 从代码中发现的重要设计理由可以记录在 `wiki/decisions/`。
- 低置信度解释、冲突或缺失上下文不要直接放入 canonical truth，而应放入 `wiki/inbox/` 或 `wiki/canonical/open-questions.md`。

这个 workflow 不会在现有 starter doc 之外使用固定 canonical 文件名。根据主题边界、预期读取频率和 token budget 选择或创建文件。当单个文件会迫使 agent 阅读无关内容时，把它拆分成更聚焦的文档。

## 安装内容

项目指令文件:

- `AGENTS.md`: 适用于整个项目的 compact wiki-first 指令
- `CLAUDE.md`: 引入 `AGENTS.md` 的 Claude Code 兼容文件
- `wiki/AGENTS.md`: wiki 内部详细编辑规则

启动 hook:

- `.codex/hooks.json`: Codex `SessionStart` hook 注册
- `.codex/hooks/wiki-session-start.js`: compact 启动上下文注入器
- `.claude/settings.json`: Claude Code `SessionStart` hook 注册
- `.claude/hooks/wiki-session-start.js`: Claude Code 的 compact 启动上下文注入器

Git hook 文件:

- `.githooks/prepare-commit-msg`: 可选 git commit hook 入口
- `.githooks/wiki-commit-trailers.js`: wiki commit trailer 生成器

Wiki 文件和目录:

- `wiki/startup.md`: 会话启动摘要
- `wiki/index.md`: 包含 read/update/token-budget 提示的路由索引
- `wiki/canonical/`: 当前项目正本
- `wiki/decisions/`: 项目决策历史
- `wiki/meta/`: wiki 运行规则和决策策略
- `wiki/sources/`: source summary
- `wiki/inbox/`: 尚未成为 canonical truth 的 captured candidate
- `wiki/migration/`: 生成的 migration inventory、plan、verification 和 review 状态

这个项目独立于外部编排层。它不会为任何编排框架创建 project memory file。

## 生成的 Wiki 模型

- `wiki/startup.md`: 会话启动用的 compact 摘要和项目状态。
- `wiki/index.md`: 告诉人类和代理应该读取或更新哪些详细文件的路由器。
- `wiki/canonical/`: 当前项目正本，例如 brief、assumptions、risks、open questions 和 optional glossary。
- `wiki/decisions/`: 项目决策历史、recent decisions、Decision Pack template 和 Full ADR template。
- `wiki/meta/`: wiki operating model、decision policy、bootstrap decisions、language policy、lint 和 migration 规则。
- `wiki/sources/`: 影响 wiki 的 source summary 和参考链接。
- `wiki/inbox/`: 尚未成为 canonical truth 的 captured candidate。
- `wiki/migration/`: 生成的 migration inventory、plan、verification 和 review 状态。

## 工作方式

当 LLM 编码代理不必重新阅读很长的聊天历史或大型文档树，就能快速恢复当前项目意图、决策、假设和风险时，它们最有用。

这个项目创建一个小而持久的 wiki 结构，把始终有用的路由上下文和详细项目知识分开。它不会替代产品文档、架构文档或 issue tracker。它的目标是提供一个靠近仓库、低 token、易于在日常工作中更新的项目规划 source of truth。

核心设计:

- 低 token 启动上下文: 初始上下文主要围绕 `wiki/startup.md` 和 `wiki/index.md`。
- 按需读取路由: 详细 canonical docs、decisions、source notes、migration pages 和 meta docs 只在需要时读取。
- 项目知识分离: 当前正本放在 `wiki/canonical/`，理由和历史放在 `wiki/decisions/`，wiki 运行规则放在 `wiki/meta/`。
- 代理指令支持: 生成 Codex 和 Claude Code 可读取的 compact 项目指令。
- Codex 和 Claude Code 启动 hook: 为两个工具注册 `SessionStart` hook，用于注入 compact wiki 启动上下文。
- Git commit trailer: 安装可选的 `prepare-commit-msg` hook，在 commit trailer 中记录 wiki 影响范围。
- 幂等 bootstrap: 重新运行脚本会更新受管理的运行文件，同时保留 starter 项目 wiki 页面。
- npx-first skill 安装: 无需 global npm install，即可将 Codex 和 Claude Code skill wrapper 安装到用户或项目范围。

常见工作流:

1. 在项目中 bootstrap wiki。
2. 会话启动时读取 `wiki/startup.md` 和 `wiki/index.md`。
3. 仅在当前任务需要时读取详细 wiki 页面。
4. 当项目规划内容变化时，在同一轮中更新相关 canonical、decision、source 或 meta page。
5. 通过已安装的 skill 请求 Codex 或 Claude Code 验证、搜索、更新、捕获或迁移 wiki。
6. 提交 wiki 相关变更时，让生成的 git hook 添加 wiki trailer。

这个项目受到 Andrej Karpathy 的 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 模式启发: 维护一个由 LLM 辅助更新的持久 markdown wiki，而不是每次都从原始文档或聊天历史重建上下文。

## 策略和副作用

Git 副作用:

- 在 git 仓库中，默认会设置 `git config core.hooksPath .githooks`。
- 如需只安装 hook 文件而不修改 `core.hooksPath`，使用 `npx project-wiki-bootstrap --no-git-config`。
- 如果项目已经使用其他 `core.hooksPath`，请在运行前审查，或在运行后重置 git config。

文件保留:

- 已存在的 `AGENTS.md`、`CLAUDE.md` 和 `wiki/AGENTS.md` 文件不会被整体覆盖。
- 如果不存在受管理的 section，bootstrap 会把带 marker 的 project-wiki section 追加到现有内容末尾。
- 重新运行时，bootstrap 只替换自身 `PROJECT-WIKI-*` marker 之间的内容，并保留周围的项目特定内容。

语言策略:

- 这个仓库 README 默认使用英语，便于 GitHub 分发。
- 本地化文档提供 [韩语](README.ko.md)、[日语](README.ja.md) 和 [简体中文](README.zh.md)。
- 生成的运行文档默认使用英语，包括 root `AGENTS.md`、`wiki/AGENTS.md`、`wiki/startup.md`、`wiki/index.md`、migration 运行页面和 wiki meta 页面。
- 项目 canonical wiki content 不固定默认为韩语或英语。LLM 应根据明确用户指令、现有项目语言、source document 和 team context 选择语言。没有信号时，遵循当前对话或仓库中已经使用的语言。

代理兼容性:

- Codex 读取 `AGENTS.md`，并使用 `.codex/hooks/wiki-session-start.js` 获取 compact 启动上下文。
- Claude Code 读取 `CLAUDE.md` 而不是 `AGENTS.md`，并使用 `.claude/hooks/wiki-session-start.js` 获取同样的 compact 启动上下文。
- 生成的 `CLAUDE.md` 使用 `@AGENTS.md` 引入 `AGENTS.md`，因此项目级规则保持在一个地方。

## 开发

源码是 TypeScript，提交到仓库的 `dist/` 目录是 npm bin 和 skill 安装使用的已编译 JavaScript。

仓库结构:

- `src/init-project-wiki.ts`: CLI 入口和顶层 orchestration。
- `src/args.ts`: command-line 参数解析和 mode flag。
- `src/types.ts`: status、migration row、hook config、query result 和 prune candidate 的共享 TypeScript 契约。
- `src/workspace.ts`: 仓库相对 filesystem helper、markdown metadata helper、可执行权限和通用 command check。
- `src/hooks.ts`: Codex 和 Claude Code `SessionStart` hook 生成、git hook 生成和 git hook 配置。
- `src/install-skill.ts`: 面向 Codex 和 Claude Code 的 npx 驱动用户/项目 skill installer。
- `src/templates.ts`: 生成的 `AGENTS.md`、`CLAUDE.md`、wiki starter page、wiki meta page 和 source summary template。
- `src/code-index.ts`: 面向大型仓库的可选 SQLite code evidence index builder、status/files/symbol inspection mode 和 read-only SQL query mode。
- `src/wiki-files.ts`: wiki file discovery、markdown table parsing、wiki link helper、metadata summary 和 marked-section preservation。
- `src/migration.ts`: 现有 wiki migration、migration inbox、migration verification 和 semantic review sync。
- `src/modes.ts`: `--lint`、`--query`、`--refresh-index`、`--capture-inbox`、`--prune-check` 等 lifecycle command。
- `dist/`: 为 zero-build 执行而提交的 build output。

开发命令:

```bash
npm install
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

修改 `src/` 下的 TypeScript 文件后，请在提交前重新 build，使对应的 `dist/` 文件保持最新。

## 许可证

MIT
