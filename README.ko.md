# Project Wiki Bootstrap

사람과 LLM 에이전트가 낮은 토큰 비용으로 프로젝트를 파악하도록 돕는 프로젝트 계획 위키 부트스트랩입니다.

언어: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

생성되는 위키는 세션 시작 컨텍스트를 작게 유지하기 위해 기본적으로 다음 두 파일만 로드하도록 설계되어 있습니다.

- `wiki/startup.md`: 현재 프로젝트 맥락의 짧은 요약
- `wiki/index.md`: 상세 문서를 언제 읽을지 안내하는 라우터

정본문서, 결정 기록, 메타 문서, 소스 요약은 현재 작업에 필요할 때만 Read On Demand로 읽습니다.

## 왜 필요한가

LLM 코딩 에이전트는 현재 프로젝트 의도, 결정, 가정, 리스크를 빠르게 복구할 수 있을 때 가장 유용합니다. 긴 대화 기록을 다시 읽거나 큰 문서 트리를 전부 로드하지 않고도 프로젝트를 파악하도록, 이 프로젝트는 항상 필요한 라우팅 컨텍스트와 상세 프로젝트 지식을 분리한 작은 위키 구조를 만듭니다.

제품 문서, 아키텍처 문서, 이슈 트래커를 대체하려는 도구는 아닙니다. 저장소 가까이에 있고 작업 중 갱신하기 쉬운, 낮은 토큰 비용의 프로젝트 계획 source of truth를 제공하는 것이 목적입니다.

## 영감

이 프로젝트는 Andrej Karpathy의 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 패턴에서 영향을 받았습니다. 원천 문서나 대화 기록에서 매번 컨텍스트를 다시 구성하는 대신, LLM의 도움으로 유지되는 지속적인 markdown wiki를 둔다는 아이디어입니다. `project-wiki-bootstrap`은 이 아이디어를 저장소 로컬 프로젝트 계획, 에이전트 시작 컨텍스트, 결정 이력, 가벼운 lifecycle 도구에 맞게 구체화합니다.

## 핵심 기능

- 낮은 토큰의 시작 컨텍스트: 초기 컨텍스트는 `wiki/startup.md`와 `wiki/index.md` 중심으로 유지합니다.
- Read On Demand 라우팅: 상세 정본문서, 결정 기록, 소스 노트, migration 문서, meta 문서는 필요할 때만 읽습니다.
- 프로젝트 지식 분리: 현재 정본은 `wiki/canonical/`, 결정 이유와 이력은 `wiki/decisions/`, 위키 운영 규칙은 `wiki/meta/`에 둡니다.
- 에이전트 지침 지원: Codex와 Claude Code가 읽을 수 있는 compact 프로젝트 지침을 생성합니다.
- Codex SessionStart hook: Codex 세션 시작 시 compact wiki 컨텍스트를 주입하는 hook을 등록합니다.
- Git commit trailer: 선택적 `prepare-commit-msg` hook으로 커밋 메시지에 wiki 영향 범위를 남깁니다.
- 반복 실행 가능: 스크립트를 다시 실행해도 관리 대상 운영 파일은 갱신하고 starter 프로젝트 wiki 페이지는 보존합니다.
- Migration mode: 기존 `wiki/`를 보존하고 새 wiki를 만든 뒤 legacy markdown inventory와 migration inbox를 생성합니다.
- Lifecycle 도구: lint, keyword search, index refresh, inbox capture, prune check, glossary init, migration review sync를 지원합니다.
- 오케스트레이션 독립성: 외부 오케스트레이션 프레임워크에 의존하지 않습니다.

## 생성 항목

- `AGENTS.md`: 프로젝트 전체에 적용되는 간결한 wiki-first 지침
- `CLAUDE.md`: Claude Code가 `AGENTS.md`를 가져오도록 연결하는 호환 파일
- `wiki/AGENTS.md`: wiki 디렉터리 내부에만 적용되는 상세 편집 규칙
- `.codex/hooks.json`: Codex `SessionStart` hook 등록
- `.codex/hooks/wiki-session-start.js`: 짧은 시작 컨텍스트 주입기
- `.githooks/prepare-commit-msg`: 선택적 git commit hook 엔트리포인트
- `.githooks/wiki-commit-trailers.js`: wiki commit trailer 생성기
- `wiki/startup.md`: 세션 시작 요약
- `wiki/index.md`: read/update/token-budget 힌트를 담은 라우팅 인덱스
- `wiki/canonical/`: 현재 프로젝트 정본
- `wiki/decisions/`: 프로젝트 결정 기록
- `wiki/meta/`: 위키 운영 규칙과 결정 정책
- `wiki/sources/`: 소스 요약

이 프로젝트는 외부 오케스트레이션 레이어와 독립적으로 동작합니다.

## 런타임 통합

### Skill

이 저장소는 Codex skill 또는 Claude Code skill로 설치할 수 있습니다. Skill은 사용자와 에이전트가 쓰는 워크플로 래퍼입니다. 언제 bootstrap script를 실행할지, 어떻게 검증할지, 어떤 lifecycle 명령이 있는지를 에이전트에게 알려줍니다.

Skill이 스크립트를 대체하는 것은 아닙니다. 현재 프로젝트 루트에서 스크립트를 안정적으로 호출하도록 절차를 제공하는 역할입니다.

### Codex Hook

Bootstrap은 `.codex/hooks.json`과 `.codex/hooks/wiki-session-start.js`를 생성합니다. Codex에서는 `SessionStart` hook으로 등록되어 다음 파일의 compact wiki 컨텍스트를 주입합니다.

- `wiki/startup.md`
- `wiki/index.md`

이 방식은 시작 컨텍스트를 작게 유지하면서도, 필요한 경우 상세 문서로 이동할 수 있게 합니다.

### Claude Code Instructions

Claude Code는 `AGENTS.md`가 아니라 `CLAUDE.md`를 읽습니다. 생성되는 `CLAUDE.md`는 `@AGENTS.md`로 같은 wiki-first 지침을 가져오므로 Claude Code와 Codex가 하나의 compact 계약을 공유합니다.

### Git Hook

Bootstrap은 `.githooks/prepare-commit-msg`와 `.githooks/wiki-commit-trailers.js`를 설치합니다. git 저장소에서는 기본적으로 `core.hooksPath`를 `.githooks`로 설정합니다. 관련 파일이 staged 상태이면 hook이 `Wiki-scope`, `Canonical-updated`, `Decision-ref`, `Startup-updated`, `Index-updated` 같은 trailer를 커밋 메시지에 추가합니다.

git 설정을 바꾸고 싶지 않다면 `--no-git-config`를 사용합니다. 이 경우 hook 파일은 설치되지만 `core.hooksPath`는 변경하지 않습니다.

## 생성되는 위키 모델

- `wiki/startup.md`: 세션 시작용 짧은 요약과 프로젝트 상태.
- `wiki/index.md`: 어떤 상세 파일을 읽거나 갱신할지 알려주는 라우터.
- `wiki/canonical/`: brief, assumptions, risks, open questions, optional glossary 같은 현재 프로젝트 정본.
- `wiki/decisions/`: 프로젝트 결정 이력, recent decisions, Decision Pack template, Full ADR template.
- `wiki/meta/`: 위키 운영 모델, 결정 정책, bootstrap 결정, 언어 정책, lint와 migration 규칙.
- `wiki/sources/`: 위키에 영향을 준 소스 요약과 참고 링크.
- `wiki/inbox/`: 아직 정본이 아닌 captured candidate.
- `wiki/migration/`: migration inventory, plan, verification, review 상태.

## 일반적인 흐름

1. 프로젝트에 wiki를 bootstrap합니다.
2. 세션 시작 시 `wiki/startup.md`와 `wiki/index.md`를 읽습니다.
3. 현재 작업에 필요할 때만 상세 wiki 페이지를 읽습니다.
4. 프로젝트 계획 내용이 바뀌면 같은 턴에서 관련 canonical, decision, source, meta 페이지를 갱신합니다.
5. `--lint`로 metadata, routing, hook 설정, 예상 파일을 검증합니다.
6. wiki 관련 변경을 커밋할 때는 git hook이 trailer를 붙이도록 두거나, `--no-git-config`를 사용해 hook 설정을 수동 관리합니다.

## 사용법

프로젝트 루트에서 직접 실행합니다.

```bash
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js
```

기존 위키나 문서 구조를 마이그레이션하려면:

```bash
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --migrate
```

git 설정을 변경하지 않고 hook 파일만 설치하려면:

```bash
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --no-git-config
```

검증과 운영 명령:

```bash
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --lint
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --query "search terms"
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --refresh-index
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --capture-inbox --title "Candidate title" --content "Candidate content"
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --prune-check
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --review-migration
```

명령어를 직접 입력하지 않는 사용 표면도 있습니다.

- Codex skill: 이 저장소를 `~/.codex/skills/project-wiki-bootstrap`에 설치한 뒤 Codex에게 현재 프로젝트에 project-wiki-bootstrap을 적용하라고 요청합니다.
- Claude Code skill: 이 저장소를 `~/.claude/skills/project-wiki-bootstrap`에 설치한 뒤 `/project-wiki-bootstrap`을 호출하거나 Claude에게 프로젝트 위키 초기화를 요청합니다.
- npm bin: 설치 또는 link 후 긴 `node .../scripts/init-project-wiki.js` 대신 `project-wiki-bootstrap` 명령을 사용합니다.

단, 이 도구는 프로젝트 파일을 생성하고 갱신하므로 어떤 표면을 쓰더라도 내부적으로는 같은 로컬 부트스트랩 스크립트가 실행됩니다.

## 언어 정책

LLM이 명시적 사용자 지시, 기존 프로젝트 언어, 소스 문서, 팀 맥락을 보고 결정해야 합니다. 신호가 없으면 현재 대화나 저장소에서 이미 쓰는 언어를 따릅니다.

## 에이전트 호환성

Codex는 `AGENTS.md`와 `.codex/hooks/wiki-session-start.js` SessionStart hook을 사용합니다.

Claude Code는 `AGENTS.md`가 아니라 `CLAUDE.md`를 읽습니다. 생성되는 `CLAUDE.md`는 `@AGENTS.md`로 같은 wiki-first 지침을 가져오므로 규칙을 중복하지 않습니다.

## 라이선스

MIT
