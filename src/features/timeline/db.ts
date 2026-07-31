// db.ts — per-hour timeline (timeline.db) への型付きアクセス窓口。
//
// このファイルが schema owner: openTimeline() が schema.sql を冪等に適用する。
// writer (insert.ts) / publisher (publish.ts) がここを import して同じ table 形・型を共有する。
// 読み出し元の会話 raw は別 DB (history/history.db, reader: history/query.ts)。

import { Database } from "bun:sqlite";
import {
  legacyDbPath,
  openStateDatabase,
  stateDbPath,
  tableColumns,
} from "../../lib/storage.ts";

// schema は code と同居、DB は runtime state に置く。旧 checkout 内 DB は初回 import 時に移行する。
export const TIMELINE_DB = stateDbPath(
  "timeline.db",
  legacyDbPath("timeline", "timeline.db"),
);
const SCHEMA_SQL = `${import.meta.dir}/schema.sql`;

// timeline 1 件 = ある 1 時間 (JST hour bucket) の 1 行。
// cwds/threads は SQLite に配列型が無いため JSON 文字列で持つ。
// 意味の薄い hour は summary/threads を null にする (が、空 hour はそもそも skill が skip する)。
export interface TimelineRow {
  window_start: string; // JST "YYYY-MM-DD HH:00:00" (PK)
  window_end: string | null;
  date: string | null; // JST "YYYY-MM-DD"
  hour: number;
  msgs: number;
  user_msgs: number;
  cwds: string | null; // JSON array | null
  title: string;
  summary: string | null;
  threads: string | null; // JSON array of {label, bullets[]} | null
  gen_model: string | null; // この行を生成した LLM の model id
  gen_effort: string | null; // 同 effort
}

// DB を開き schema を最新化して返す (冪等)。存在しなければ作成する。
export function openTimeline(): Database {
  const db = openStateDatabase(TIMELINE_DB, SCHEMA_SQL);
  ensureColumns(db);
  return db;
}

// CREATE TABLE IF NOT EXISTS では既存 table の列を増やせないので、ALTER で差分を埋める (drift heal)。
function ensureColumns(db: Database): void {
  const cols = tableColumns(db, "timelines");
  for (const col of ["gen_model", "gen_effort"]) {
    if (!cols.has(col)) db.exec(`ALTER TABLE timelines ADD COLUMN ${col} TEXT`);
  }
}

// window_start を PK に UPSERT する。
// created_at は初回のみ (ON CONFLICT で更新しない)、updated_at は毎回 now。
// 再生成すると内容が追従する — "do nothing" でなく "upsert" が冪等な投入。
export function upsertTimeline(db: Database, row: TimelineRow): void {
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO timelines
       (window_start, window_end, date, hour,
        msgs, user_msgs, cwds,
        title, summary, threads, gen_model, gen_effort, created_at, updated_at)
     VALUES
       ($window_start, $window_end, $date, $hour,
        $msgs, $user_msgs, $cwds,
        $title, $summary, $threads, $gen_model, $gen_effort, $now, $now)
     ON CONFLICT(window_start) DO UPDATE SET
       window_end=excluded.window_end, date=excluded.date, hour=excluded.hour,
       msgs=excluded.msgs, user_msgs=excluded.user_msgs, cwds=excluded.cwds,
       title=excluded.title, summary=excluded.summary, threads=excluded.threads,
       gen_model=excluded.gen_model, gen_effort=excluded.gen_effort,
       updated_at=excluded.updated_at`,
  ).run({
    $window_start: row.window_start,
    $window_end: row.window_end,
    $date: row.date,
    $hour: row.hour,
    $msgs: row.msgs,
    $user_msgs: row.user_msgs,
    $cwds: row.cwds,
    $title: row.title,
    $summary: row.summary,
    $threads: row.threads,
    $gen_model: row.gen_model,
    $gen_effort: row.gen_effort,
    $now: now,
  });
}

// publish 成功時に published_at を stamp する (publish.ts が呼ぶ)。
// 再生成 (upsertTimeline) は published_at を触らないので、再生成しても publish 状態は保たれる。
export function markPublished(db: Database, windowStart: string): void {
  db.query("UPDATE timelines SET published_at = $now WHERE window_start = $ws").run({
    $now: new Date().toISOString(),
    $ws: windowStart,
  });
}
