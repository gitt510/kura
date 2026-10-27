// db.ts — kura.db の timeline table への型付きアクセス窓口。
//
// table の形は src/schema.sql が正本。writer (insert.ts) がここを
// import して型を共有する。読み出し元の会話は core の table (reader: store/query.ts)。

import type { Database } from "bun:sqlite";

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

// window_start を PK に UPSERT する。
// created_at は初回のみ (ON CONFLICT で更新しない)、updated_at は毎回 now。
// 再生成すると内容が追従する — "do nothing" でなく "upsert" が冪等な投入。
export function upsertTimeline(db: Database, row: TimelineRow): void {
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO timeline
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
