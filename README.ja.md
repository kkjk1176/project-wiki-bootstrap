# Project Wiki Bootstrap

人間と LLM エージェントが低いトークンコストでプロジェクトを把握できるようにする、プロジェクト計画 wiki のブートストラップです。

言語: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

生成される wiki は、セッション開始時のコンテキストを小さく保つため、基本的に次の 2 つのファイルだけを読みます。

- `wiki/startup.md`: 現在のプロジェクト文脈の短い要約
- `wiki/index.md`: 詳細ドキュメントをいつ読むかを示すルーター

正本ドキュメント、意思決定記録、メタドキュメント、ソース要約は、現在の作業で必要になったときだけ Read On Demand で読みます。

## なぜ必要か

LLM コーディングエージェントは、現在のプロジェクトの意図、意思決定、仮定、リスクをすばやく復元できるときに最も役立ちます。長い会話履歴を読み直したり、大きなドキュメントツリー全体を読み込んだりせずにプロジェクトを把握できるよう、このプロジェクトは常に必要なルーティングコンテキストと詳細なプロジェクト知識を分離した小さな wiki 構造を作ります。

これは製品ドキュメント、アーキテクチャドキュメント、課題管理ツールを置き換えるものではありません。リポジトリの近くにあり、通常の作業中に更新しやすい、低トークンコストのプロジェクト計画 source of truth を提供することが目的です。

## インスピレーション

このプロジェクトは Andrej Karpathy の [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) パターンに影響を受けています。元ドキュメントや会話履歴から毎回コンテキストを再構成する代わりに、LLM の助けで維持される永続的な markdown wiki を置くという考え方です。`project-wiki-bootstrap` は、この考え方をリポジトリローカルのプロジェクト計画、エージェントの起動コンテキスト、意思決定履歴、軽量な lifecycle ツールに合わせて具体化します。

## 主な機能

- 低トークンの起動コンテキスト: 初期コンテキストは `wiki/startup.md` と `wiki/index.md` を中心に保ちます。
- Read On Demand ルーティング: 詳細な正本ドキュメント、意思決定、ソースノート、migration ドキュメント、meta ドキュメントは必要なときだけ読みます。
- プロジェクト知識の分離: 現在の正本は `wiki/canonical/`、意思決定の理由と履歴は `wiki/decisions/`、wiki 運用ルールは `wiki/meta/` に置きます。
- エージェント指示のサポート: Codex と Claude Code が読める compact なプロジェクト指示を生成します。
- Codex SessionStart hook: Codex セッション開始時に compact な wiki コンテキストを注入する hook を登録します。
- Git commit trailer: 任意の `prepare-commit-msg` hook で、コミットメッセージに wiki 影響範囲を残します。
- 冪等なブートストラップ: スクリプトを再実行しても、管理対象の運用ファイルを更新し、starter プロジェクト wiki ページは保持します。
- Migration mode: 既存の `wiki/` を保持して新しい wiki を作り、legacy markdown inventory と migration inbox を生成します。
- Lifecycle ツール: lint、keyword search、index refresh、inbox capture、prune check、glossary init、migration review sync をサポートします。
- オーケストレーション非依存: 外部オーケストレーションフレームワークに依存しません。

## 生成されるもの

- `AGENTS.md`: プロジェクト全体に適用される compact な wiki-first 指示
- `CLAUDE.md`: Claude Code が `AGENTS.md` を取り込むための互換ファイル
- `wiki/AGENTS.md`: wiki ディレクトリ配下だけに適用される詳細な編集ルール
- `.codex/hooks.json`: Codex `SessionStart` hook 登録
- `.codex/hooks/wiki-session-start.js`: 短い起動コンテキスト注入器
- `.githooks/prepare-commit-msg`: 任意の git commit hook エントリーポイント
- `.githooks/wiki-commit-trailers.js`: wiki commit trailer 生成器
- `wiki/startup.md`: セッション開始要約
- `wiki/index.md`: read/update/token-budget ヒントを持つルーティングインデックス
- `wiki/canonical/`: 現在のプロジェクト正本
- `wiki/decisions/`: プロジェクト意思決定履歴
- `wiki/meta/`: wiki 運用ルールと意思決定ポリシー
- `wiki/sources/`: ソース要約

このプロジェクトは外部オーケストレーションレイヤーから独立して動作します。

## ランタイム統合

### Skill

このリポジトリは Codex skill または Claude Code skill としてインストールできます。Skill はユーザーとエージェントが使うワークフローラッパーです。いつ bootstrap script を実行するか、どう検証するか、どの lifecycle コマンドがあるかをエージェントに伝えます。

Skill はスクリプトを置き換えるものではありません。現在のプロジェクトルートからスクリプトを安定して呼び出すための手順を提供します。

### Codex Hook

Bootstrap は `.codex/hooks.json` と `.codex/hooks/wiki-session-start.js` を生成します。Codex では `SessionStart` hook として登録され、次のファイルの compact な wiki コンテキストを注入します。

- `wiki/startup.md`
- `wiki/index.md`

この方式により、起動コンテキストを小さく保ちながら、必要な場合は詳細ドキュメントへ移動できます。

### Claude Code Instructions

Claude Code は `AGENTS.md` ではなく `CLAUDE.md` を読みます。生成される `CLAUDE.md` は `@AGENTS.md` で同じ wiki-first 指示を取り込むため、Claude Code と Codex が 1 つの compact な契約を共有できます。

### Git Hook

Bootstrap は `.githooks/prepare-commit-msg` と `.githooks/wiki-commit-trailers.js` をインストールします。git リポジトリでは、デフォルトで `core.hooksPath` を `.githooks` に設定します。関連ファイルが staged の場合、hook は `Wiki-scope`、`Canonical-updated`、`Decision-ref`、`Startup-updated`、`Index-updated` などの trailer をコミットメッセージに追加します。

git 設定を変更したくない場合は `--no-git-config` を使用します。この場合、hook ファイルはインストールされますが `core.hooksPath` は変更されません。

## 生成される Wiki モデル

- `wiki/startup.md`: セッション開始用の短い要約とプロジェクト状態。
- `wiki/index.md`: どの詳細ファイルを読むか、または更新するかを示すルーター。
- `wiki/canonical/`: brief、assumptions、risks、open questions、optional glossary などの現在のプロジェクト正本。
- `wiki/decisions/`: プロジェクト意思決定履歴、recent decisions、Decision Pack template、Full ADR template。
- `wiki/meta/`: wiki 運用モデル、意思決定ポリシー、bootstrap decision、言語ポリシー、lint と migration ルール。
- `wiki/sources/`: wiki に影響したソース要約と参考リンク。
- `wiki/inbox/`: まだ正本ではない captured candidate。
- `wiki/migration/`: migration inventory、plan、verification、review 状態。

## 一般的な流れ

1. プロジェクトに wiki を bootstrap します。
2. セッション開始時に `wiki/startup.md` と `wiki/index.md` を読みます。
3. 現在の作業で必要なときだけ詳細 wiki ページを読みます。
4. プロジェクト計画の内容が変わったら、同じターンで関連する canonical、decision、source、meta ページを更新します。
5. `--lint` で metadata、routing、hook 設定、期待されるファイルを検証します。
6. wiki 関連の変更をコミットするときは git hook に trailer を付けさせるか、`--no-git-config` を使って hook 設定を手動管理します。

## 使い方

プロジェクトルートで直接実行します。

```bash
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js
```

既存の wiki やドキュメント構造を migration する場合:

```bash
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --migrate
```

git 設定を変更せず hook ファイルだけをインストールする場合:

```bash
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --no-git-config
```

検証と運用コマンド:

```bash
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --lint
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --query "search terms"
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --refresh-index
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --capture-inbox --title "Candidate title" --content "Candidate content"
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --prune-check
node /path/to/project-wiki-bootstrap/scripts/init-project-wiki.js --review-migration
```

コマンドを直接入力しない利用方法もあります。

- Codex skill: このリポジトリを `~/.codex/skills/project-wiki-bootstrap` にインストールし、Codex に現在のプロジェクトへ project-wiki-bootstrap を適用するよう依頼します。
- Claude Code skill: このリポジトリを `~/.claude/skills/project-wiki-bootstrap` にインストールし、`/project-wiki-bootstrap` を呼び出すか、Claude にプロジェクト wiki の初期化を依頼します。
- npm bin: インストールまたは link 後、長い `node .../scripts/init-project-wiki.js` の代わりに `project-wiki-bootstrap` コマンドを使います。

ただし、このツールはプロジェクトファイルを生成・更新するため、どの利用方法でも内部的には同じローカル bootstrap script が実行されます。

## 言語ポリシー

LLM は明示的なユーザー指示、既存のプロジェクト言語、ソースドキュメント、チーム文脈を見て決定する必要があります。シグナルがなければ、現在の会話またはリポジトリですでに使われている言語に従います。

## エージェント互換性

Codex は `AGENTS.md` と `.codex/hooks/wiki-session-start.js` SessionStart hook を使用します。

Claude Code は `AGENTS.md` ではなく `CLAUDE.md` を読みます。生成される `CLAUDE.md` は `@AGENTS.md` で同じ wiki-first 指示を取り込むため、ルールを重複させません。

## ライセンス

MIT
