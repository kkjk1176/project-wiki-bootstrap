# Project Wiki Bootstrap

帮助人类和 LLM 代理以较低的 token 成本理解项目的项目规划 wiki 引导工具。

语言: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

生成的 wiki 通过默认只加载以下两个文件来保持会话启动上下文精简。

- `wiki/startup.md`: 当前项目上下文的简短摘要
- `wiki/index.md`: 指示何时读取详细文档的路由器

正本文档、决策记录、元文档和来源摘要只在当前任务需要时按需读取。

## 为什么需要它

当 LLM 编码代理能够快速恢复当前项目意图、决策、假设和风险，而不必重读冗长的聊天记录或加载庞大的文档树时，它们最有用。这个项目创建一个小型、持久的 wiki 结构，把总是有用的路由上下文和详细的项目知识分离开。

它并不试图取代产品文档、架构文档或 issue tracker。它的目标是在仓库附近提供一个低 token 成本、易于在日常工作中更新的项目规划 source of truth。

## 灵感来源

本项目受到 Andrej Karpathy 的 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 模式启发。这个模式主张维护一个由 LLM 辅助更新的持久 markdown wiki，而不是每次都从原始文档或聊天历史重新构建上下文。`project-wiki-bootstrap` 将这一思想具体化为适用于仓库本地项目规划、代理启动上下文、决策历史和轻量 lifecycle 工具的实现。

## 核心功能

- 低 token 启动上下文: 初始上下文主要围绕 `wiki/startup.md` 和 `wiki/index.md`。
- 按需读取路由: 详细正本文档、决策、来源笔记、migration 文档和 meta 文档只在需要时读取。
- 项目知识分离: 当前正本放在 `wiki/canonical/`；理由和历史放在 `wiki/decisions/`；wiki 运行规则放在 `wiki/meta/`。
- 代理指令支持: 生成 Codex 和 Claude Code 可读取的 compact 项目级指令。
- Codex SessionStart hook: 注册一个在 Codex 会话启动时注入 compact wiki 上下文的 hook。
- Git commit trailer: 安装可选的 `prepare-commit-msg` hook，在提交信息中记录 wiki 影响范围。
- 幂等 bootstrap: 重新运行脚本会更新受管理的运行文件，同时保留 starter 项目 wiki 页面。
- Migration mode: 保留现有 `wiki/`，创建新的 wiki，并生成 legacy markdown inventory 和 migration inbox。
- Lifecycle 工具: 支持 lint、keyword search、index refresh、inbox capture、prune check、glossary init 和 migration review sync。
- 无编排锁定: 不依赖外部编排框架。

## 创建的内容

- `AGENTS.md`: 适用于整个项目的 compact wiki-first 指令
- `CLAUDE.md`: 让 Claude Code 引入 `AGENTS.md` 的兼容文件
- `wiki/AGENTS.md`: 仅适用于 wiki 目录内部的详细编辑规则
- `.codex/hooks.json`: Codex `SessionStart` hook 注册
- `.codex/hooks/wiki-session-start.js`: 简短启动上下文注入器
- `.githooks/prepare-commit-msg`: 可选 git commit hook 入口
- `.githooks/wiki-commit-trailers.js`: wiki commit trailer 生成器
- `wiki/startup.md`: 会话启动摘要
- `wiki/index.md`: 带有 read/update/token-budget 提示的路由索引
- `wiki/canonical/`: 当前项目正本
- `wiki/decisions/`: 项目决策历史
- `wiki/meta/`: wiki 运行规则和决策策略
- `wiki/sources/`: 来源摘要

本项目独立于外部编排层运行。

## 运行时集成

### Skill

这个仓库可以作为 Codex skill 或 Claude Code skill 安装。Skill 是用户和代理使用的工作流包装器。它告诉代理何时运行 bootstrap script、如何验证结果，以及有哪些 lifecycle 命令可用。

Skill 并不替代脚本。它提供的是从当前项目根目录可靠调用脚本的流程。

### Codex Hook

Bootstrap 会创建 `.codex/hooks.json` 和 `.codex/hooks/wiki-session-start.js`。在 Codex 中，它会注册为 `SessionStart` hook，并注入来自以下文件的 compact wiki 上下文。

- `wiki/startup.md`
- `wiki/index.md`

这种方式可以保持启动上下文较小，同时在任务需要时仍然指向详细文档。

### Claude Code Instructions

Claude Code 读取 `CLAUDE.md`，而不是 `AGENTS.md`。生成的 `CLAUDE.md` 使用 `@AGENTS.md` 引入相同的 wiki-first 指令，因此 Claude Code 和 Codex 可以共享一个 compact 合约，而不重复规则。

### Git Hook

Bootstrap 会安装 `.githooks/prepare-commit-msg` 和 `.githooks/wiki-commit-trailers.js`。在 git 仓库中，它默认将 `core.hooksPath` 设置为 `.githooks`。当相关文件被 staged 时，hook 会向提交信息追加 `Wiki-scope`、`Canonical-updated`、`Decision-ref`、`Startup-updated`、`Index-updated` 等 trailer。

如果不希望更改 git 配置，请使用 `--no-git-config`。这种情况下会安装 hook 文件，但不会修改 `core.hooksPath`。

## 生成的 Wiki 模型

- `wiki/startup.md`: 会话启动用的简短摘要和项目状态。
- `wiki/index.md`: 告诉人类和代理应读取或更新哪些详细文件的路由器。
- `wiki/canonical/`: 当前项目正本，例如 brief、assumptions、risks、open questions 和 optional glossary。
- `wiki/decisions/`: 项目决策历史、recent decisions、Decision Pack template 和 Full ADR template。
- `wiki/meta/`: wiki 运行模型、决策策略、bootstrap decisions、语言策略、lint 和 migration 规则。
- `wiki/sources/`: 影响 wiki 的来源摘要和参考链接。
- `wiki/inbox/`: 尚未成为正本的 captured candidate。
- `wiki/migration/`: migration inventory、plan、verification 和 review 状态。

## 常见工作流

1. 在项目中 bootstrap wiki。
2. 会话启动时读取 `wiki/startup.md` 和 `wiki/index.md`。
3. 仅在当前任务需要时读取详细 wiki 页面。
4. 当项目规划内容变化时，在同一轮中更新相关 canonical、decision、source 或 meta 页面。
5. 运行 `--lint` 验证 metadata、routing、hook 设置和预期文件。
6. 提交 wiki 相关变更时，让 git hook 添加 trailer；或者使用 `--no-git-config` 手动管理 hook 设置。

## 使用方法

在项目根目录直接运行。

```bash
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js
```

迁移已有 wiki 或文档结构:

```bash
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --migrate
```

只安装 hook 文件而不修改 git 配置:

```bash
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --no-git-config
```

验证和运维命令:

```bash
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --lint
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --query "search terms"
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --refresh-index
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --capture-inbox --title "Candidate title" --content "Candidate content"
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --prune-check
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --review-migration
```

也可以不直接输入命令:

- Codex skill: 将此仓库安装到 `~/.codex/skills/project-wiki-bootstrap`，然后请求 Codex 在当前项目中应用 project-wiki-bootstrap。
- Claude Code skill: 将此仓库安装到 `~/.claude/skills/project-wiki-bootstrap`，然后调用 `/project-wiki-bootstrap`，或请求 Claude 初始化项目 wiki。
- npm bin: 安装或 link 后，使用 `project-wiki-bootstrap` 命令替代较长的 `node .../scripts/init-project-wiki.js`。

不过，这个工具会创建和更新项目文件，因此无论使用哪种入口，内部都会执行同一个本地 bootstrap script。

## 语言策略

LLM 应根据明确的用户指示、现有项目语言、来源文档和团队上下文来决定。没有信号时，应沿用当前对话或仓库中已经使用的语言。

## 代理兼容性

Codex 使用 `AGENTS.md` 和 `.codex/hooks/wiki-session-start.js` SessionStart hook。

Claude Code 读取 `CLAUDE.md`，而不是 `AGENTS.md`。生成的 `CLAUDE.md` 使用 `@AGENTS.md` 引入相同的 wiki-first 指令，因此不会重复规则。

## 许可证

MIT
