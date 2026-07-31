---
name: briefing
description: >-
  GitHub Trending（daily / 全言語）の取得済みデータを日本語でまとめ、配信用の payload を生成する。
  取得（fetch）と配信（Discord POST）はオーケストレーター run.ts が行う。この skill は要約だけを担う。
  状態を持たない。フィルタや選別はせず、trending の全件をそのまま要約する。
  /briefing または $briefing の明示指名か、run.ts が生成 agent で起動したときのみ動く。
disable-model-invocation: true
---

# Briefing（要約）

`/tmp/briefing/trending.json`（run.ts が fetch 済み）を読み、日本語でまとめて
`/tmp/briefing/payload.json` を生成する。

**取得（HTTP）と配信（Discord POST）は run.ts の責務**であり、この skill は
決定論的な処理を一切行わない — trending の全件をどう要約するかという **非決定的な判断だけ**を担う。
出力フォーマットは `assets/output-format.md` に従う。

---

## 手順

1. `/tmp/briefing/trending.json` を Read する。各エントリ = `{ repo, description, stars, stars_today, language, url }`
   - 万一 trending.json が無い / 空なら、要約対象が無いので payload.json は書かず、その旨を伝えて終了する（取得は run.ts の担当）
2. `assets/output-format.md` を Read してフォーマットと payload 構造を確認する
3. trending.json の **全件** について、各 repo の `one_line`（15〜20字）と `note`（50〜80字）を生成する。`stars` / `stars_today` / `language` / `url` / `repo` は trending.json からそのままコピーする（選別・並べ替えはしない。trending の並び順を保つ）
4. `assets/output-format.md` の構造で `/tmp/briefing/payload.json` を Write する

これで完了。配信（publish）は run.ts が payload.json を読んで行う。

---

## Invariants

- INV-001: 出力フォーマット・payload 構造は `assets/output-format.md` を正とする
- INV-002: state を持たない。catalog/除外URL/feedback/ログは作らない・読まない
- INV-003: payload.json は必ず Write する。run.ts がこれを読んで配信する
- INV-004: この skill は決定論的処理（HTTP 取得・Discord POST）を行わない。それは run.ts の責務

---

## Rules

- フィルタや選別はしない。trending の全件を、trending の並び順のまま要約する
- ネタ・ジョーク系や明らかな重複は外してよい程度の最小限の取捨
- 日本語でまとめる（製品名・ツール名は元の表記を維持）

---

## サポートファイル

| ファイル                                             | 内容                       |
| ---------------------------------------------------- | -------------------------- |
| [`assets/output-format.md`](assets/output-format.md) | payload 構造・要約の書き方 |

## 入出力ファイル（/tmp/briefing/, 揮発）

| ファイル       | 生成者          | 内容                                       |
| -------------- | --------------- | ------------------------------------------ |
| `trending.json` | run.ts (fetch)  | trending 全件（パース済み。この skill の入力） |
| `payload.json`  | この skill      | trending 全件の要約（run.ts が配信）        |
