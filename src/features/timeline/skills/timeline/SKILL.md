---
name: timeline
description: ある 1 時間 (JST の hour bucket) に全 agent セッション横断で何をしたかを、repo/テーマ別のスレッドに束ねた timeline に要約する。素材の取得・DB への UPSERT・Discord 配信はオーケストレーター run.ts が行い、この skill は生成だけを担う。/timeline または $timeline の明示指名か、run.ts が生成 agent で起動したときのみ動く。
disable-model-invocation: true
---

# Hourly Timeline（生成）

Goal: **JST のある 1 時間**を、後から「その時間に何をしていたか」を一目で掴める
**repo/テーマ別のスレッド timeline** にする。*hour 単位*で全 session を横断し、
同じ 1 時間に複数 repo を行き来した実態を束ねる。

この skill は **生成だけ**を担う（非決定的な判断）。素材取得・timeline.db への UPSERT・Discord 配信は
**run.ts (orchestrator) の責務**であり、この skill は決定論的な処理を一切行わない。

入力は `/tmp/kura-timeline/messages.json`（orchestrator が用意）。出力は `/tmp/kura-timeline/generated.json`
（narrative）。中心の思想は「**slim**」— 各スレッドは事実の箇条書きを最小限に。触っていない repo は出さない。

## Data layout

```
/tmp/kura-timeline/
├── messages.json   ← orchestrator が用意 (この skill の入力)。{ meta, messages } 形
└── generated.json  ← この skill が書く (narrative)。run.ts がこれを DB へ UPSERT・配信する
```

history / timeline.db は触らない（読むのも書くのも orchestrator 側）。

## Workflow

引数で `<YYYY-MM-DD> <hour>` が対象 hour として渡る（context 用）。素材は下記ファイルから読む。

### 1) 素材を読む

`/tmp/kura-timeline/messages.json` を Read する。`messages`（ユーザ発話のみ・ノイズ除外済み。
各要素 `{ jst, cwd, text }`）**だけ**を使う。`meta`（window/volume/cwds）の数字は使わない
（DB は orchestrator が history から引き直す）。`messages` が空なら生成しない。

### 2) スレッドに束ねる（narrative だけ作る）

`messages` を読んで、**cwd（repo）やテーマで束ねた**スレッドに整理する。時系列の生ログでなく、
「この hour に走っていた仕事の筋」を並べる。slim 最優先 — 必要な分だけ。

- **title**: その hour を一言で（例: `9 時台 — 依存更新・mise 整備・summary テコ入れを並行`）。
- **summary**: 1〜2 文の要旨。その hour 全体で何が動いていたか。
- **threads**: `{ label, bullets[] }` の配列。1 スレッド = 1 repo/テーマ。
  - `label`: 先頭に意味のある絵文字 + repo/テーマ名（例: `🔧 owner/repo — npm 依存更新の PR`）。
  - `bullets`: そのスレッドで何をしたか。最重要のみ（1 スレッド 2〜4）。
  - 行き来した repo が多い hour ほどスレッドが増える。逆に 1 件しか触っていなければ 1 スレッド。

meta は**作らない**。数えるのは DB の仕事（orchestrator が引き直す）。

### 3) 書き出す

step 2 で作った narrative を `/tmp/kura-timeline/generated.json` に Write する。

これで完了。DB への UPSERT と Discord 配信は run.ts が generated.json を読んで行う。

## generated.json schema

step 2 で作るのはこれだけ（meta は含めない）:

```json
{
  "title": "9 時台 — 依存更新・mise 整備・summary テコ入れを並行",
  "summary": "...",
  "threads": [
    { "label": "🔧 owner/repo — npm 依存更新の PR", "bullets": ["...", "..."] },
    { "label": "📖 lexicon — 英語", "bullets": ["..."] }
  ]
}
```

`summary` は単一文字列、`threads` は配列。発話の無い hour は step 1 で抜ける（このファイルを書かない）。

## Guardrails

- 触れるのは `/tmp/kura-timeline/` の 2 ファイルだけ。history.db / timeline.db は触らない（orchestrator の責務）。
- 時刻はすべて **JST**。window は `[HH:00, HH+1:00)` の半開区間。23 時台の終端は翌日 00:00。
- meta（window/volume/cwds）の数字は LLM が持たない（写し間違いを防ぐ。orchestrator が引き直す）。
- 機微情報（社内 URL・token 等）が発話に出ても、スレッドは抽象な要約なので基本残らない。残るならぼかす。
- `messages` が空の hour は何もしない（generated.json を書かない）。
- スレッドは触った repo/テーマの分だけ。水増しして増やさない。
