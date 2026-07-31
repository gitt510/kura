---
name: english
description: ある 1 時間 (JST の hour bucket) に自分が agent へ打った日本語の発話から、英語学習カード 1 枚 (en 2 案 + 発音ブロック) を作る。素材 (messages) の取得・DB への UPSERT・Discord 配信はオーケストレーター run.ts が行い、この skill は生成だけを担う。/english または $english の明示指名か、run.ts が生成 agent で起動したときのみ動く。
disable-model-invocation: true
---

# English Feed（生成）

Goal: 待ち時間にちらっと見るだけで英語が積み上がるよう、**自分が実際に agent へ打った日本語**を
素材に、再利用できる英語表現を 1 時間ごとに **カード 1 枚**へ落とす。

この skill は **生成だけ**を担う（非決定的な判断）。素材取得・english.db への UPSERT・Discord 配信は
**run.ts (orchestrator) の責務**であり、この skill は決定論的な処理を一切行わない。

入力は `/tmp/kura-english/messages.json`（orchestrator が用意）。出力は `/tmp/kura-english/generated.json`
（cards）。中心の思想は **narrow & deep** — 毎時 1 枚に絞り、そのぶん 1 枚に「言い方 2 つ + 発音」まで持たせる。

## Data layout

```
/tmp/kura-english/
├── messages.json   ← orchestrator が用意 (この skill の入力)。{ meta, messages } 形
└── generated.json  ← この skill が書く (cards)。run.ts がこれを DB へ UPSERT・配信する
```

history / english.db は触らない（読むのも書くのも orchestrator 側）。

## Workflow

引数で `<YYYY-MM-DD> <hour>` が対象 hour として渡る（context 用）。素材は下記ファイルから読む。

### 1) 素材を読む

`/tmp/kura-english/messages.json` を Read する。`messages`（ユーザ発話のみ・ノイズ除外済み）**だけ**を使う。
`meta` の volume/cwds 等の数字は使わない（DB は orchestrator が持つ）。`messages` が空なら生成しない。

### 2) カードに落とす（1 枚だけ）

`messages` の中から、**agent との会話で再利用価値が最も高い発話を 1 つだけ**選ぶ。
候補が複数あっても 1 枚。

選んだら、訳す前に**芯となる 1 節（1 つの意図）だけを切り出す**。発話が複数の文・節を
持っていても、カードに載るのはこの 1 節だけ — **ja も en も切り出した節だけを書き、
選ばなかった節はどちらにも出さない**。

カードは `{ kind, ja, phrase, en, syl, read, memo, alt }`（並びは Discord 表示順）:

- **kind**: その発話が agent に対する「どんな一手」か。先頭に絵文字を付けたラベル。
  - `🛠 指示`（やってほしい作業を出す） / `🚦 段取り`（着手前の確認・順序・ゲート） /
    `❓ 質問`（前提や根っこを問う） / `🤔 相談`（方針を一緒に決める） /
    `🔧 修正`（直し・変更を頼む） / `🔍 確認`（理解や守備範囲を確かめる）
  - 合うものを選ぶ。無ければ近いものを 1 つ。
- **ja**: 切り出した芯 1 節の **clean 版**（typo・誤変換・固有名詞は修正、フィラーは落とす。逐語ではない）。
- **phrase**: 持ち帰る**再利用フレーズ 1 つ**。`"..."` で括る。agent 会話で効く定型を優先
  （`"take it all the way to X"` / `"before we do — let me see X first"` / `"what even is X?"` など）。
  常時表示され、en を想起するときのヒントになる。
- **en**: その英訳。**コーディング agent に話すときの口調** — direct・casual・少し hedged。教科書英語にしない。
  - **1 文・目安 12 語以内**。関係節や `but` 連結で伸ばさない。収まらないなら芯の切り出しが広すぎる — 節の選び直しに戻る（ja も一緒に狭まる）。
  - 技術用語は英語のまま（`refactor` / `schema` / `branch` / `token` など）。
- **syl**: en の**音節分割**。単語間は ` / `、音節間は `·`。
  例: `Pass·ing / the / da·ta·base / in·to / build·App`
- **read**: en を**ネイティブの流れで読んだカタカナ**。単語ごとの棒読みではなく、
  連結・弱形・脱落を反映する（`swap in a` → `スワ ピナ`、`route handlers` → `ルー ハンドラーズ`）。
- **memo**: read で起きている**連結・音変化の解説を 1〜2 点**、日本語 1〜2 文で。
  例: `swap in a は /p/ と /n/ が後続母音に連結して スワ ピナ と流れる。`
  目立った連結の無い文では省略してよい（key ごと落とす）。
- **alt**: 同じ意図を**別の S-V で言い直した 1 文**。en と主語・動詞を替えて組み立て直す
  （en が命令文なら主語を立てる: `Can you …?` / `Let's …` / `I want …` 等）。
  同義語置換は不可。en より短くてよい。

### 3) 書き出す

step 2 で作った cards を `/tmp/kura-english/generated.json` に Write する。

これで完了。DB への UPSERT と Discord 配信は run.ts が generated.json を読んで行う。

## generated.json schema

step 2 で作るのはこれだけ（meta は含めない）:

```json
{
  "cards": [
    {
      "kind": "🛠 指示",
      "ja": "一旦 branch を切って、PR を出すところまでお願い。",
      "phrase": "\"take it all the way to X\"",
      "en": "For now, cut a branch and take it all the way to a PR.",
      "syl": "For / now / cut / a / branch / and / take / it / all / the / way / to / a / P·R",
      "read": "フォナウ カッタ ブランチ アン テイキッ オール ザ ウェイ トゥア ピーアール",
      "memo": "cut a は /t/ が母音に連結して カッタ。take it は /k/ と /ɪ/ がつながって テイキッ と流れる。",
      "alt": "Let's get this branch all the way to a PR."
    }
  ]
}
```

`cards` は常に**長さ 1 の配列**（過去 row との互換のため配列形は保つ）。`memo` は無ければ key ごと省略。
発話の無い hour は step 1 で抜ける（このファイルを書かない）。

## Guardrails

- 触れるのは `/tmp/kura-english/` の 2 ファイルだけ。history.db / english.db は触らない（orchestrator の責務）。
- 時刻はすべて **JST**。window は `[HH:00, HH+1:00)` の半開区間。
- **カードは 1 枚だけ**。発話が多い hour でも増やさない — 選抜で応える。
- **ja と en は同じ芯 1 節を写す**。en に出ない情報を ja に残さない。en・alt はそれぞれ 1 文。
- 機微情報（社内 URL・token 値・実名・secret）は ja/en に残さない。出てきたら `<internal URL>` 等にぼかすか、そのカードを採らない。
- `messages` が空の hour は何もしない（generated.json を書かない）。
- 文法解説・語彙リスト・「今日のまとめ」は出さない。カードだけ。

## Trigger hints (JP/EN)

- JP: `今日の英語` / `english feed` / `○時台の英語` / `直近1時間の英語カード`
- EN: `english feed` / `make english cards`
