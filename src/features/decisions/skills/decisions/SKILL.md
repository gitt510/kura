---
name: decisions
description: ある 1 時間 (JST の hour bucket) の全セッション横断のユーザ発話から、repo (cwd) ごとのコード意思決定を grepathy 互換の contract で蒸留する。素材の取得・decisions.db への UPSERT はオーケストレーター run.ts が行い、この skill は生成だけを担う。/decisions または $decisions の明示指名か、run.ts が生成 agent で起動したときのみ動く。
disable-model-invocation: true
---

# Hourly Decisions（蒸留）

Goal: **JST のある 1 時間**の会話から、「何を・なぜそう決めたか」を repo ごとの
**decision record** に蒸留する。3 ヶ月後の自分や別の agent が読んで、
同じ議論をやり直さずに済む記録を残す。

この skill は **生成だけ**を担う（非決定的な判断）。素材取得・decisions.db への UPSERT は
**run.ts (orchestrator) の責務**であり、この skill は決定論的な処理を一切行わない。

入力は `/tmp/kura-decisions/messages.json`（orchestrator が用意）。出力は
`/tmp/kura-decisions/generated.json`。中心の思想は「**decision だけ**」— 作業ログでも
要約でもなく、後から効く意思決定のみを残す。

## Data layout

```
/tmp/kura-decisions/
├── messages.json   ← orchestrator が用意 (この skill の入力)。{ meta, messages, knownTitles } 形
└── generated.json  ← この skill が書く (packs)。run.ts がこれを DB へ UPSERT する
```

history / decisions.db は触らない（読むのも書くのも orchestrator 側）。

## Workflow

引数で `<YYYY-MM-DD> <hour>` が対象 hour として渡る（context 用）。素材は下記ファイルから読む。

### 1) 素材を読む

`/tmp/kura-decisions/messages.json` を Read する。

- `messages`: ユーザ発話のみ・ノイズ除外済み。各要素 `{ jst, cwd, text }`
- `knownTitles`: cwd ごとの既出 decision title の配列（新しい順）
- `meta.cwds`: この hour に登場した cwd の一覧。**pack の cwd はこの中からしか選ばない**

`messages` が空なら生成しない。

### 2) repo ごとに decision を蒸留する

`messages` を cwd で束ね、repo ごとに意思決定を抽出する。

**decision に該当するもの**: 設計の選択、命名の確定、方式の採用・却下、scope の限定、
運用ルールの決定、「やらない」と決めたこと。

**該当しないもの**: 単なる作業指示（commit して、push して）、質問と回答、調査、
進捗確認。決定の無い repo は pack ごと出さない。

各 decision の field（grepathy 互換の contract）:

- `title`: 決定の見出し 1 行。**knownTitles に同じ決定があれば、その title を
  一字一句そのままコピーする**（dedupe の鍵。言い換え・改善をしない）
- `status`: `directed`（人が明示的に指示）| `discussed`（対話の中で合意形成）|
  `agent-initiated`（agent の独断。人の承認なし）
- `statusNote`: status の補足が要るときだけ（例: 途中で方針転回した）
- `touches`: 影響を受ける file / glob の配列。**会話に出た path だけ**。発明しない。
  特定できなければ空配列
- `body`: なぜそう決めたか 1〜5 文。**第三者視点**で、agent の decision として書く
- `consideredRejected`: 検討して却下した代替と却下理由（あれば）
- `risk`: この決定が持ち込むリスク（あれば）
- `reviewerAttention`: 後から見る人が確認すべき点（あれば）

粒度: **1 repo 1 hour 最大 5 件**。迷ったら「3 ヶ月後に再議論を防ぐか」で絞る。

### 3) 書き出す

`/tmp/kura-decisions/generated.json` に Write する。

## generated.json schema

```json
{
  "packs": [
    {
      "cwd": "/Users/x/ghq/github.com/owner/repo",
      "intent": "この hour にこの repo で何をしようとしていたか 1-2 文",
      "decisions": [
        {
          "title": "publish の戻りを結果型にする",
          "status": "directed",
          "touches": ["src/lib/hourly-job.ts"],
          "body": "...",
          "consideredRejected": "..."
        }
      ]
    }
  ]
}
```

`packs` は decision のある repo の分だけ。decision の無い hour は step 1〜2 で抜ける
（このファイルを書かない）。

## Privacy 契約

- **ユーザ発話を引用しない**。逐語の転記・「〜と言った」形の記述を禁ずる
- すべて**第三者視点**で、agent が下した decision として書く
- secret（token・URL・鍵）と業務詳細（顧客名・価格・売上）は書かない。滲むならぼかす

## Guardrails

- 触れるのは `/tmp/kura-decisions/` の 2 ファイルだけ。history.db / decisions.db は触らない
- `cwd` は `meta.cwds` にあるものだけ。`touches` は会話に出た path だけ
- knownTitles と同じ決定は title を一字一句再利用（改変した瞬間 dedupe が壊れる）
- 作業ログ・要約で水増ししない。decision が無ければ無いが正しい
