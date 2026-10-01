// db.ts — companion (companion.db) への型付きアクセス窓口。
//
// このファイルが schema owner: openCompanionDb() が schema.sql を冪等に適用する。
// writer / reader は run.ts のみ。読み出し元の会話 raw は別 DB (history/history.db)。

import { Database } from "bun:sqlite";
import { legacyDbPath, openStateDatabase, stateDbPath, tableColumns } from "../../lib/storage.ts";

export const COMPANION_DB = stateDbPath(
  "companion.db",
  legacyDbPath("companion", "companion.db"),
);
const SCHEMA_SQL = `${import.meta.dir}/schema.sql`;

// 1 card = user が agent に打った 1 prompt への英語 feedback。
//   note    : items の JSON 配列文字列 [{kind, from, to}] (SQLite に配列型が無いため
//             english feature の memo と同じ持ち方)。指摘ゼロは "[]"。
//             旧 row は string の配列 / plain string で、output に全文訳が入る —
//             読み手は旧形も受ける
//   lang / output : 旧契約の列。今は書かない (null)。schema は触らず残す
//   status  : "ok" | "error" (生成失敗。note は null)
export interface CardRow {
  key: string;
  session_id: string;
  cwd: string | null;
  lang: string | null;
  input: string;
  output: string | null;
  note: string | null;
  model: string | null;
  status: "ok" | "error";
  created_at: string;
}

// DB を開き schema を最新化して返す (冪等)。存在しなければ作成する。
export function openCompanionDb(): Database {
  const db = openStateDatabase(COMPANION_DB, SCHEMA_SQL);
  // 旧 schema の english 列は output へ rename する (CREATE IF NOT EXISTS では変わらない)。
  if (tableColumns(db, "cards").has("english")) {
    db.exec("ALTER TABLE cards RENAME COLUMN english TO output");
  }
  return db;
}

// key 先着を正とする — 仮 row で card 化済みの prompt が verbatim 化で再度届いても無視。
export function insertCard(db: Database, row: CardRow): void {
  db.query(
    `INSERT OR IGNORE INTO cards
       (key, session_id, cwd, lang, input, output, note, model, status, created_at)
     VALUES
       ($key, $session_id, $cwd, $lang, $input, $output, $note, $model, $status, $created_at)`,
  ).run({
    $key: row.key,
    $session_id: row.session_id,
    $cwd: row.cwd,
    $lang: row.lang,
    $input: row.input,
    $output: row.output,
    $note: row.note,
    $model: row.model,
    $status: row.status,
    $created_at: row.created_at,
  });
}

export function hasCard(db: Database, key: string): boolean {
  return db.query("SELECT 1 FROM cards WHERE key = $key").get({ $key: key }) !== null;
}

// 新しい順。restart 後の HTML 復元用。
export function recentCards(db: Database, limit: number): CardRow[] {
  return db
    .query("SELECT * FROM cards ORDER BY created_at DESC, rowid DESC LIMIT $limit")
    .all({ $limit: limit }) as CardRow[];
}
