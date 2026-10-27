// db.ts — kura.db の english table への型付きアクセス窓口。
//
// table の形は src/schema.sql が正本。writer (insert.ts) がここを
// import して型を共有する。読み出し元の会話は core の table (reader: store/query.ts)。

import type { Database } from "bun:sqlite";

// 1 カード = その hour のユーザ発話 1 つを英語学習用に解剖したもの (1 hour 1 枚)。
//   ja     : 🇯🇵 言いたいこと (clean 版。typo / 固有名詞は修正、逐語ではない)
//   phrase : 💎 持ち帰る再利用フレーズ 1 つ ("..." 込み)。常時表示のヒント役
//   read   : 🗣 en を流れで読んだカタカナ。連結・弱形・脱落を反映 (例 "スワ ピナ")
//            これだけを見て en を書き起こすのが主な使い方
//   en     : 🇺🇸 その英訳 1 文 (casual / hedged)。書き取りの正解
//   syl    : 🔤 en の音節分割。単語間 " / "・音節間 "·" (例 "Pass·ing / the / da·ta·base")
//   memo   : 連結・音変化の解説 1〜2 点の配列 (無い文では省略可)。
//            旧 row は string 1 本 (2026-08 に配列化)
//   alt    : ✨ 同じ意図の別の言い方 1 文 (en と構文を変える)
// en/alt 以外の optional 群は 2026-07 の拡張 — 旧 row には無い。
export interface Card {
  ja: string;
  phrase: string;
  en: string;
  syl?: string;
  read?: string;
  memo?: string[] | string;
  alt?: string;
}

// entry 1 件 = ある 1 時間 (JST hour bucket) の 1 行。1 行が cards を束ねる。
// cards は SQLite に配列型が無いため JSON 文字列で持つ。
export interface EnglishEntry {
  window_start: string; // JST "YYYY-MM-DD HH:00:00" (PK)
  window_end: string | null;
  date: string | null; // JST "YYYY-MM-DD"
  cards: string | null; // JSON array of Card | null
  gen_model: string | null; // この行を生成した LLM の model id
  gen_effort: string | null; // 同 effort
}

// window_start を PK に UPSERT する。
// created_at は初回のみ (ON CONFLICT で更新しない)、updated_at は毎回 now。
// 再生成すると内容が追従する — "do nothing" でなく "upsert" が冪等な投入。
export function upsertEnglishEntry(db: Database, row: EnglishEntry): void {
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO english
       (window_start, window_end, date, cards, gen_model, gen_effort, created_at, updated_at)
     VALUES
       ($window_start, $window_end, $date, $cards, $gen_model, $gen_effort, $now, $now)
     ON CONFLICT(window_start) DO UPDATE SET
       window_end=excluded.window_end, date=excluded.date,
       cards=excluded.cards, gen_model=excluded.gen_model, gen_effort=excluded.gen_effort,
       updated_at=excluded.updated_at`,
  ).run({
    $window_start: row.window_start,
    $window_end: row.window_end,
    $date: row.date,
    $cards: row.cards,
    $gen_model: row.gen_model,
    $gen_effort: row.gen_effort,
    $now: now,
  });
}
