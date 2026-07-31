# Briefing 出力フォーマット

GitHub Trending を Discord embed 1 メッセージにまとめるためのフォーマット定義。
LLM は `/tmp/briefing/trending.json` を読み、ここに沿って `/tmp/briefing/payload.json` を生成する。

---

## payload.json の構造

```json
{
  "date": "YYYY-MM-DD",
  "repos": [
    {
      "repo": "owner/repo",
      "url": "https://github.com/owner/repo",
      "stars": 8826,
      "stars_today": 485,
      "language": "Rust",
      "one_line": "15〜20字の日本語要約",
      "note": "補足1〜2文（50〜80字）"
    }
  ]
}
```

- `repo` / `url` / `stars` / `stars_today` / `language` は trending.json の値を**そのままコピー**する（推測しない）
- `repos` は trending.json の **全件**（並び順も trending のまま。選別・並べ替えはしない）

### Discord 上の見え方

各項目は 2 行で描画される（embed description に流し込む）:

```
**1. [owner/repo](url)** · ⭐17,247 (+1,229) · Haskell   ← 1行目: 順位 + repo 情報（見出し・リンク）
識別子を持たないメッセージ網。ユーザーIDも電話番号も…    ← 2行目: 要約（one_line + note）
```

- 1 行目 = 順位と repo 情報。順位は trending の並び順（publish 側が自動付与）。`repo` は太字リンク、`⭐総数 (+当日増分)`、言語。`stars_today` が当日の勢いを示す
- 2 行目 = 要約。`one_line` と `note` を繋いだ説明
- footer に `trending N件 → 表示 M件` が付き、生成 model は webhook の投稿者名と avatar に反映される

---

## 各フィールドの書き方

### one_line（15〜20字・見出し）

- そのツールの本質的な価値を 1 行で凝縮する
- リポジトリ名や description の直訳・言い換えにしない
- 「何ができるか」より「なぜ面白いか／何が新しいか」に寄せる

### note（50〜80字・1〜2文）

- one_line を補い、用途・特徴・既存ツールとの違いを具体的に書く
- 薄くならないよう、description から読み取れる要点を 1〜2 文に落とす
- 冗長な前置きや空句は入れない

---

## 方針（state-less）

- フィルタや選別はしない。trending.json の全件を、並び順そのままで要約する
- 製品名・ツール名は元の表記を維持する
