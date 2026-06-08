# Project Wiki Bootstrap

[![npm version](https://img.shields.io/npm/v/project-wiki-bootstrap.svg)](https://www.npmjs.com/package/project-wiki-bootstrap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Code evidence index](https://img.shields.io/badge/code%20evidence-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)

사람과 LLM 에이전트를 위한 낮은 토큰의 프로젝트 계획 wiki를 bootstrap합니다.

언어: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

생성되는 wiki는 시작 컨텍스트를 작게 유지하기 위해 다음 파일만 로드합니다.

- `wiki/startup.md`: 현재 프로젝트 컨텍스트의 compact 요약
- `wiki/index.md`: 다음에 읽을 상세 파일을 고르는 라우터

상세 canonical, decision, meta, source 파일은 현재 작업에 필요할 때만 Read On Demand로 읽습니다.

## 목차

- [빠른 시작](#빠른-시작)
- [Skill Actions](#skill-actions)
- [Skill 사용](#skill-사용)
- [코드 기반 정본화](#코드-기반-정본화)
- [설치되는 항목](#설치되는-항목)
- [생성되는 Wiki 모델](#생성되는-wiki-모델)
- [작동 방식](#작동-방식)
- [정책과 부작용](#정책과-부작용)
- [개발](#개발)
- [라이선스](#라이선스)

## 빠른 시작

`npx`는 skill 설치와 프로젝트 bootstrap에만 사용합니다. 이후 운영은 Codex 또는 Claude Code에 설치된 skill을 통해 수행합니다.

Codex와 Claude Code에 skill을 한 번 설치합니다.

```bash
npx project-wiki-bootstrap install-skill --scope user --agents both
```

skill을 한 저장소 안에 두려면 `--scope user` 대신 `--scope project`를 사용합니다.

```bash
npx project-wiki-bootstrap install-skill --scope project --agents both
```

그 다음 대상 프로젝트 root에서 bootstrap 명령 중 하나를 실행합니다.

| 상황 | 명령 |
| --- | --- |
| 새 project wiki 또는 일반 update | `npx project-wiki-bootstrap` |
| 기존 wiki/docs migration 필요 | `npx project-wiki-bootstrap --migrate` |
| git config를 변경하지 않고 hook 파일만 설치 | `npx project-wiki-bootstrap --no-git-config` |

일반적인 첫 실행:

```bash
npx project-wiki-bootstrap
```

한 agent에만 설치하려면 `--agents both` 대신 `--agents codex` 또는 `--agents claude`를 사용합니다.

## Skill Actions

이 패키지를 설치하면 Codex와 Claude Code에 `project-wiki-bootstrap`이라는 하나의 skill이 추가됩니다. 이 skill은 다음 project wiki action을 지원합니다.

- Bootstrap 또는 update: `AGENTS.md`, `CLAUDE.md`, `wiki/`, Codex hook, Claude Code hook, git hook 파일을 생성하거나 갱신합니다.
- Validate: 필수 파일, metadata header, routing, hook 설정, 실행 권한, git hook 설정을 확인합니다.
- Search: 경로, 제목, metadata, 본문 기준으로 관련 wiki page를 찾습니다.
- Refresh index: `wiki/index.md`의 auto-discovered page block을 갱신합니다.
- Capture candidate: 내용을 canonical truth로 만들지 않고 `wiki/inbox/project-candidates.md`에 후보로 저장합니다.
- Prune check: pending, stale, proposed, undecided 상태로 보이는 active wiki page를 보고합니다.
- Glossary init: 프로젝트 용어를 둘 canonical 위치가 필요할 때 `wiki/canonical/glossary.md`를 생성합니다.
- Code-informed canonicalization: 기존 코드를 분석해 코드로 확인된 프로젝트 기능, 정책, 제약, 도메인 규칙, open question을 wiki에 반영합니다.
- Code evidence index: 큰 저장소를 위한 폐기 가능한 SQLite 증거 cache를 만들고 file, symbol, import, route, 관계, full-text search table, read-only query surface를 제공합니다.
- Migration: 기존 wiki를 보존하고 새 wiki를 만든 뒤 legacy markdown inventory와 migration inbox를 생성합니다.
- Migration review: 처리된 migration inbox status를 review와 verification page로 동기화합니다.
- No-git-config setup: `core.hooksPath`를 변경하지 않고 hook 파일만 설치합니다.

## Skill 사용

설치 후 Codex에서는 자연어로 요청합니다.

- "이 프로젝트에 project-wiki-bootstrap을 적용해."
- "프로젝트 wiki 설정을 검증해."
- "인증 결정 관련 내용을 project wiki에서 찾아줘."
- "wiki index를 갱신해."
- "이 내용을 project wiki candidate로 캡처해."
- "기존 코드를 분석해서 project wiki를 갱신해."
- "`src/`와 `packages/api/`만 근거로 wiki를 갱신해."
- "migration된 wiki inbox를 검토해."

Claude Code에서는 skill을 직접 호출하거나 자연어로 요청합니다.

- `/project-wiki-bootstrap`
- "프로젝트 wiki를 초기화해."
- "프로젝트 wiki가 정상인지 확인해."
- "코드베이스를 읽고 프로젝트 동작을 wiki 정본으로 정리해."
- "릴리스 리스크 관련 wiki 노트를 찾아줘."

Skill은 이런 요청을 내부적으로 적절한 lifecycle operation에 매핑합니다. 프로젝트 wiki와 hook은 프로젝트 루트에서 bootstrap이 실행될 때만 생성됩니다.

## 코드 기반 정본화

저장소 코드가 프로젝트가 실제로 무엇을 하는지에 대한 가장 좋은 근거일 때 이 action을 사용합니다.

이 기능은 별도 CLI flag가 아니라 skill workflow입니다. 원하는 범위는 자연어로 요청합니다.

- "전체 저장소를 분석해서 코드 기준으로 wiki를 갱신해."
- "`apps/web/`와 `packages/core/`만 분석해."
- "동작을 이해하는 데 도움이 되지 않으면 generated file과 test는 제외해."

큰 저장소에서는 skill이 `npx project-wiki-bootstrap --code-index` 또는 `npx project-wiki-bootstrap --code-evidence-index`로 재생성 가능한 SQLite code evidence index를 만들 수 있습니다. 범위는 내부적으로 `--code-scope` 또는 `--code-evidence-scope`로 전달합니다. cache는 `.project-wiki/code-evidence.sqlite`에 있으며 canonical wiki content가 아니고, 폐기 가능한 분석 상태로 취급해야 합니다.

이 evidence index는 code graph 도구의 아이디어에서 영향을 받았지만, project-wiki의 용어와 목적에 맞게 설계했습니다. 독립적인 code intelligence 제품이 아니라 wiki 정본화를 위한 증거 cache입니다. 큰 저장소를 반복 스캔하지 않고 근거를 찾을 수 있도록 file inventory, extraction profile, symbol, import, route, config signal, relationship edge, full-text search table을 저장합니다.

안전성과 runtime 경계:

- Custom cache output은 반드시 `.project-wiki/` 아래에 있어야 합니다. 도구는 다른 위치의 code evidence database를 삭제하거나 생성하지 않습니다.
- Code scope는 project root 내부에 있어야 합니다.
- Git repository에서는 `git ls-files --cached --others --exclude-standard`를 사용해 `.gitignore`를 존중합니다.
- `.env.example`을 제외한 `.env*` 파일은 code evidence index에서 제외합니다.
- 기본 bootstrap package는 Node 18+를 지원하지만, code evidence indexing은 `node:sqlite`를 제공하는 Node runtime이 필요합니다. 현재 test는 Node 22.17.1에서 실행됩니다.

유용한 inspection surface:

| 목적 | 명령 |
| --- | --- |
| evidence cache build 또는 refresh | `npx project-wiki-bootstrap --code-index --code-scope src` |
| cache count와 metadata 확인 | `npx project-wiki-bootstrap --code-status` |
| indexed file과 extraction profile 목록 | `npx project-wiki-bootstrap --code-files` |
| indexed symbol 검색 | `npx project-wiki-bootstrap --code-search-symbol Auth` |
| read-only SQL 실행 | `npx project-wiki-bootstrap --code-query "select path from files order by path"` |

README는 광범위한 언어 지원 matrix를 공개하지 않습니다. index는 file별 extraction profile을 기록하며, 강한 extraction profile을 가진 근거만 code-proven으로 취급해야 합니다. Lightweight inventory나 heuristic finding은 완전한 언어 지원 주장으로 보지 말고 후속 읽기를 위한 pointer로 다뤄야 합니다.

이 workflow는 코드 구조와 프로젝트 정본을 분리합니다.

- 코드 구조, entrypoint, module 관계, read-on-demand route, 근거 경로는 `wiki/meta/` 아래에 LLM이 선택한 설명적이고 프로젝트에 맞는 파일명으로 둡니다.
- 코드로 확인된 product behavior, project feature, policy, constraint, terminology, domain rule, operational fact는 `wiki/canonical/`에 둡니다.
- 코드에서 발견한 중요한 설계 이유는 `wiki/decisions/`에 기록할 수 있습니다.
- 확신이 낮은 해석, 충돌, 부족한 맥락은 canonical truth에 바로 넣지 말고 `wiki/inbox/` 또는 `wiki/canonical/open-questions.md`에 둡니다.

이 workflow에서는 기존 starter doc 외에 고정 canonical 파일명을 사용하지 않습니다. 주제 경계, 예상 읽기 빈도, token budget을 보고 파일을 선택하거나 생성합니다. 하나의 파일이 서로 관련 없는 내용을 강제로 읽게 만들 정도로 커지면 집중된 문서로 분리합니다.

## 설치되는 항목

프로젝트 지침 파일:

- `AGENTS.md`: 프로젝트 전체에 적용되는 compact wiki-first 지침
- `CLAUDE.md`: `AGENTS.md`를 가져오는 Claude Code 호환 파일
- `wiki/AGENTS.md`: wiki 내부 상세 편집 규칙

시작 hook:

- `.codex/hooks.json`: Codex `SessionStart` hook 등록
- `.codex/hooks/wiki-session-start.js`: compact 시작 컨텍스트 주입기
- `.claude/settings.json`: Claude Code `SessionStart` hook 등록
- `.claude/hooks/wiki-session-start.js`: Claude Code용 compact 시작 컨텍스트 주입기

Git hook 파일:

- `.githooks/prepare-commit-msg`: 선택적 git commit hook 엔트리포인트
- `.githooks/wiki-commit-trailers.js`: wiki commit trailer 생성기

Wiki 파일과 디렉터리:

- `wiki/startup.md`: 세션 시작 요약
- `wiki/index.md`: read/update/token-budget 힌트를 담은 라우팅 인덱스
- `wiki/canonical/`: 현재 프로젝트 정본
- `wiki/decisions/`: 프로젝트 결정 기록
- `wiki/meta/`: wiki 운영 규칙과 결정 정책
- `wiki/sources/`: source summary
- `wiki/inbox/`: 아직 canonical truth가 아닌 captured candidate
- `wiki/migration/`: 생성된 migration inventory, plan, verification, review 상태

이 프로젝트는 외부 오케스트레이션 레이어와 독립적입니다. 어떤 오케스트레이션 프레임워크용 project memory file도 생성하지 않습니다.

## 생성되는 Wiki 모델

- `wiki/startup.md`: 세션 시작용 compact 요약과 프로젝트 상태.
- `wiki/index.md`: 사람과 에이전트에게 어떤 상세 파일을 읽거나 갱신할지 알려주는 라우터.
- `wiki/canonical/`: brief, assumptions, risks, open questions, optional glossary 같은 현재 프로젝트 정본.
- `wiki/decisions/`: 프로젝트 결정 이력, recent decisions, Decision Pack template, Full ADR template.
- `wiki/meta/`: wiki operating model, decision policy, bootstrap decisions, language policy, lint와 migration 규칙.
- `wiki/sources/`: wiki에 영향을 준 source summary와 참고 링크.
- `wiki/inbox/`: 아직 canonical truth가 아닌 captured candidate.
- `wiki/migration/`: 생성된 migration inventory, plan, verification, review 상태.

## 작동 방식

LLM 코딩 에이전트는 긴 채팅 기록이나 큰 문서 트리를 다시 읽지 않고 현재 프로젝트 의도, 결정, 가정, 리스크를 빠르게 복구할 때 가장 유용합니다.

이 프로젝트는 항상 유용한 라우팅 컨텍스트와 상세 프로젝트 지식을 분리하는 작고 지속 가능한 wiki 구조를 만듭니다. 제품 문서, 아키텍처 문서, 이슈 트래커를 대체하지 않습니다. 저장소 가까이에 있고 일반 작업 중 쉽게 갱신되는 낮은 토큰의 프로젝트 계획 source of truth를 제공하는 것이 목적입니다.

핵심 설계:

- 낮은 토큰의 시작 컨텍스트: 초기 컨텍스트는 `wiki/startup.md`와 `wiki/index.md` 중심입니다.
- Read On Demand 라우팅: 상세 canonical docs, decisions, source notes, migration pages, meta docs는 필요할 때만 읽습니다.
- 프로젝트 지식 분리: 현재 정본은 `wiki/canonical/`, 이유와 이력은 `wiki/decisions/`, wiki 운영 규칙은 `wiki/meta/`에 둡니다.
- 에이전트 지침 지원: Codex와 Claude Code가 읽을 수 있는 compact 프로젝트 지침을 생성합니다.
- Codex와 Claude Code 시작 hook: 두 도구 모두에 compact wiki 시작 컨텍스트를 주입하는 `SessionStart` hook을 등록합니다.
- Git commit trailer: 선택적 `prepare-commit-msg` hook으로 wiki 영향 범위를 commit trailer에 남깁니다.
- 반복 실행 가능: 스크립트를 다시 실행해도 관리 대상 운영 파일은 갱신하고 starter 프로젝트 wiki 페이지는 보존합니다.
- npx-first skill 설치: global npm install 없이 Codex와 Claude Code skill wrapper를 사용자 또는 프로젝트 범위에 설치합니다.

일반적인 흐름:

1. 프로젝트에 wiki를 bootstrap합니다.
2. 세션 시작 시 `wiki/startup.md`와 `wiki/index.md`를 읽습니다.
3. 현재 작업에 필요할 때만 상세 wiki 페이지를 읽습니다.
4. 프로젝트 계획 내용이 바뀌면 같은 턴에서 관련 canonical, decision, source, meta page를 갱신합니다.
5. 설치된 skill을 통해 Codex 또는 Claude Code에게 wiki 검증, 검색, 갱신, 캡처, migration을 요청합니다.
6. wiki 관련 변경을 커밋할 때 생성된 git hook이 wiki trailer를 붙이도록 둡니다.

이 프로젝트는 Andrej Karpathy의 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 패턴에서 영향을 받았습니다. 원천 문서나 대화 기록에서 매번 컨텍스트를 다시 구성하는 대신, LLM의 도움으로 유지되는 지속적인 markdown wiki를 둔다는 아이디어입니다.

## 정책과 부작용

Git 부작용:

- git 저장소에서는 기본적으로 `git config core.hooksPath .githooks`를 설정합니다.
- `core.hooksPath`를 변경하지 않고 hook 파일만 설치하려면 `npx project-wiki-bootstrap --no-git-config`를 사용합니다.
- 프로젝트가 이미 다른 `core.hooksPath`를 사용한다면 실행 전에 검토하거나 이후 git config를 되돌리세요.

파일 보존:

- 기존 `AGENTS.md`, `CLAUDE.md`, `wiki/AGENTS.md` 파일은 전체 덮어쓰기하지 않습니다.
- 관리 구간이 없으면 bootstrap은 marker로 둘러싼 project-wiki 섹션을 기존 내용 아래에 추가합니다.
- 다시 실행할 때는 자체 `PROJECT-WIKI-*` marker 사이의 내용만 교체하고, 그 밖의 프로젝트 고유 내용은 보존합니다.

언어 정책:

- 이 저장소 README는 GitHub 배포를 위해 기본적으로 영어입니다.
- 지역화 문서는 [한국어](README.ko.md), [일본어](README.ja.md), [중국어 간체](README.zh.md)로 제공됩니다.
- root `AGENTS.md`, `wiki/AGENTS.md`, `wiki/startup.md`, `wiki/index.md`, migration 운영 페이지, wiki meta 페이지를 포함한 생성 운영 문서는 기본적으로 영어입니다.
- 프로젝트 canonical wiki content는 한국어나 영어로 기본값을 고정하지 않습니다. LLM이 명시적 사용자 지시, 기존 프로젝트 언어, source document, team context를 보고 언어를 선택해야 합니다. 신호가 없으면 현재 대화나 저장소에서 이미 쓰는 언어를 따릅니다.

에이전트 호환성:

- Codex는 `AGENTS.md`와 `.codex/hooks/wiki-session-start.js`를 사용해 compact 시작 컨텍스트를 읽습니다.
- Claude Code는 `AGENTS.md`가 아니라 `CLAUDE.md`를 읽고, `.claude/hooks/wiki-session-start.js`로 같은 compact 시작 컨텍스트를 사용합니다.
- 생성되는 `CLAUDE.md`는 `@AGENTS.md`로 `AGENTS.md`를 가져오므로 프로젝트 전체 규칙을 한 곳에 유지합니다.

## 개발

소스는 TypeScript이며, 커밋되는 `dist/` 디렉터리는 npm bin과 skill 설치에서 사용하는 컴파일된 JavaScript입니다.

저장소 구조:

- `src/init-project-wiki.ts`: CLI 엔트리포인트와 최상위 orchestration.
- `src/args.ts`: command-line 인자 파싱과 mode flag.
- `src/types.ts`: status, migration row, hook config, query result, prune candidate에 대한 공유 TypeScript 계약.
- `src/workspace.ts`: 저장소 상대 경로 filesystem helper, markdown metadata helper, 실행 권한, 공통 command check.
- `src/hooks.ts`: Codex와 Claude Code `SessionStart` hook 생성, git hook 생성, git hook 설정.
- `src/install-skill.ts`: Codex와 Claude Code용 npx 기반 사용자/프로젝트 skill installer.
- `src/templates.ts`: 생성되는 `AGENTS.md`, `CLAUDE.md`, wiki starter page, wiki meta page, source summary template.
- `src/code-index.ts`: 큰 저장소를 위한 선택적 SQLite code evidence index builder, status/files/symbol inspection mode, read-only SQL query mode.
- `src/wiki-files.ts`: wiki file discovery, markdown table parsing, wiki link helper, metadata summary, marked-section preservation.
- `src/migration.ts`: 기존 wiki migration, migration inbox, migration verification, semantic review sync.
- `src/modes.ts`: `--lint`, `--query`, `--refresh-index`, `--capture-inbox`, `--prune-check` 같은 lifecycle command.
- `dist/`: zero-build 실행을 위해 커밋되는 build output.

개발 명령:

```bash
npm install
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

`src/` 아래 TypeScript 파일을 수정하면 커밋 전에 다시 build해서 대응되는 `dist/` 파일을 최신 상태로 유지합니다.

## 라이선스

MIT
