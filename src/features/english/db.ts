// db.ts — per-hour english (english.db) への型付きアクセス窓口。
//
// このファイルが schema owner: openEnglishDb() が schema.sql を冪等に適用する。
// writer (insert.ts) / publisher (publish.ts) がここを import して同じ table 形・型を共有する。
// 読み出し元の会話 raw は別 DB (history/history.db, reader: history/query.ts)。

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import {
  legacyDbPath,
  openStateDatabase,
  stateDbPath,
  tableColumns,
} from "../../lib/storage.ts";

// schema は code と同居、DB は runtime state に置く。旧 checkout 内 DB は初回 import 時に移行する。
export const ENGLISH_DB = stateDbPath(
  "english.db",
  legacyDbPath("english", "english.db"),
);
const SCHEMA_SQL = `${import.meta.dir}/schema.sql`;

// 1 カード = その hour のユーザ発話 1 つを英語学習用に解剖したもの (1 hour 1 枚)。
// 並び順は Discord 表示順と同じ。ja / phrase が常時表示、en 以降は丸ごと 1 spoiler。
//   kind   : 会話の一手の種類 (先頭に絵文字)。例 "🛠 指示" / "🚦 段取り" / "❓ 質問"
//   ja     : 🇯🇵 言いたいこと (clean 版。typo / 固有名詞は修正、逐語ではない)
//   phrase : 💎 持ち帰る再利用フレーズ 1 つ ("..." 込み)。常時表示のヒント役
//   en     : 🇺🇸 その英訳 1 文 (casual / hedged。ここから下が spoiler)
//   syl    : 🔤 en の音節分割。単語間 " / "・音節間 "·" (例 "Pass·ing / the / da·ta·base")
//   read   : 🗣 en を流れで読んだカタカナ。連結・弱形・脱落を反映 (例 "スワ ピナ")
//   memo   : 📝 連結・音変化の解説 1〜2 点 (無い文では省略可)
//   alt    : ✨ 同じ意図の別の言い方 1 文 (en と構文を変える)
// en/alt 以外の optional 群は 2026-07 の拡張 — 旧 row には無いので publish 側は optional 扱いする。
export interface Card {
  kind: string;
  ja: string;
  phrase: string;
  en: string;
  syl?: string;
  read?: string;
  memo?: string;
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

// DB を開き schema を最新化して返す (冪等)。存在しなければ作成する。
export function openEnglishDb(): Database {
  migrateFeedsToEntries(ENGLISH_DB); // 旧 table 名 feeds → entries を schema 適用前に当てる
  const db = openStateDatabase(ENGLISH_DB, SCHEMA_SQL);
  ensureColumns(db);
  return db;
}

// 旧 schema の table 名 `feeds` を `entries` に一度だけ改名する。
// openStateDatabase が CREATE TABLE entries で空 table を作る前に走らせる必要があるので raw に当てる。
// 両 table が並存していたら rename しない (既存データ側を正とする)。
function migrateFeedsToEntries(path: string): void {
  if (!existsSync(path)) return;
  const db = new Database(path);
  try {
    const tables = new Set(
      (
        db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
      ).map((t) => t.name),
    );
    if (tables.has("feeds") && !tables.has("entries")) {
      db.exec("ALTER TABLE feeds RENAME TO entries");
      db.exec("DROP INDEX IF EXISTS idx_feeds_date"); // schema が idx_entries_date を作り直す
    }
  } finally {
    db.close();
  }
}

// CREATE TABLE IF NOT EXISTS は既存 table の列を増減できないので、ALTER で差分を埋める (drift heal)。
function ensureColumns(db: Database): void {
  const cols = tableColumns(db, "entries");
  for (const col of ["gen_model", "gen_effort"]) {
    if (!cols.has(col)) db.exec(`ALTER TABLE entries ADD COLUMN ${col} TEXT`);
  }
  // 旧 schema の死列 (誰も読まない volume/cwds メタ) を落とす。idx は date のみで索引外なので DROP は安全。
  for (const col of ["hour", "msgs", "user_msgs", "cwds"]) {
    if (cols.has(col)) db.exec(`ALTER TABLE entries DROP COLUMN ${col}`);
  }
}

// window_start を PK に UPSERT する。
// created_at は初回のみ (ON CONFLICT で更新しない)、updated_at は毎回 now。
// 再生成すると内容が追従する — "do nothing" でなく "upsert" が冪等な投入。
export function upsertEnglishEntry(db: Database, row: EnglishEntry): void {
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO entries
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

// publish 成功時に published_at を stamp する (publish.ts が呼ぶ)。
// 再生成 (upsertEnglishEntry) は published_at を触らないので、再生成しても publish 状態は保たれる。
export function markPublished(db: Database, windowStart: string): void {
  db.query("UPDATE entries SET published_at = $now WHERE window_start = $ws").run({
    $now: new Date().toISOString(),
    $ws: windowStart,
  });
}
