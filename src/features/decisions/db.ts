// db.ts — per-hour decisions (decisions.db) への型付きアクセス窓口。
//
// このファイルが schema owner: openDecisionsDb() が schema.sql を冪等に適用する。
// writer (insert.ts) と orchestrator (run.ts) がここを import して同じ table 形・型を共有する。
// 読み出し元の会話 raw は別 DB (history/history.db, reader: history/query.ts)。

import { Database } from "bun:sqlite";
import { legacyDbPath, openStateDatabase, stateDbPath } from "../../lib/storage.ts";

// schema は code と同居、DB は runtime state に置く。
export const DECISIONS_DB = stateDbPath("decisions.db", legacyDbPath("decisions", "decisions.db"));
const SCHEMA_SQL = `${import.meta.dir}/schema.sql`;

// 1 decision = 会話から蒸留したコード上の意思決定。field は本家 grepathy の抽出契約と一致させる。
//   title              : 決定の見出し。dedupe の鍵 — 同じ決定は knownTitles の title を一字一句再利用する
//   status             : directed (人が明示指示) | discussed (対話で合意) | agent-initiated (agent 独断)
//   statusNote         : status の補足 (optional)
//   touches            : 影響を受ける file / glob。会話に出た path のみ (発明しない)
//   body               : 理由 1-5 文。第三者視点・発話の引用なし
//   consideredRejected : 検討して却下した代替 (optional)
//   risk               : 導入リスク (optional)
//   reviewerAttention  : レビュアーが見るべき点 (optional)
export interface Decision {
  title: string;
  status: "directed" | "discussed" | "agent-initiated";
  statusNote?: string;
  touches: string[];
  body: string;
  consideredRejected?: string;
  risk?: string;
  reviewerAttention?: string;
}

// entry 1 件 = ある 1 時間 (JST hour bucket) × 1 repo (cwd) の 1 行。
// decisions は SQLite に配列型が無いため JSON 文字列で持つ。
export interface DecisionsEntry {
  window_start: string; // JST "YYYY-MM-DD HH:00:00" (PK の一部)
  window_end: string | null;
  date: string | null; // JST "YYYY-MM-DD"
  cwd: string; // PK の一部
  intent: string | null; // この hour × repo の作業目的 1-2 文
  decisions: string | null; // JSON array of Decision | null
  gen_model: string | null; // この行を生成した LLM の model id
  gen_effort: string | null; // 同 effort
}

// DB を開き schema を適用して返す (冪等)。存在しなければ作成する。
export function openDecisionsDb(): Database {
  return openStateDatabase(DECISIONS_DB, SCHEMA_SQL);
}

// (window_start, cwd) を PK に UPSERT する。
// created_at は初回のみ (ON CONFLICT で更新しない)、updated_at は毎回 now。
export function upsertDecisionsEntry(db: Database, row: DecisionsEntry): void {
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO entries
       (window_start, window_end, date, cwd, intent, decisions, gen_model, gen_effort, created_at, updated_at)
     VALUES
       ($window_start, $window_end, $date, $cwd, $intent, $decisions, $gen_model, $gen_effort, $now, $now)
     ON CONFLICT(window_start, cwd) DO UPDATE SET
       window_end=excluded.window_end, date=excluded.date,
       intent=excluded.intent, decisions=excluded.decisions,
       gen_model=excluded.gen_model, gen_effort=excluded.gen_effort,
       updated_at=excluded.updated_at`,
  ).run({
    $window_start: row.window_start,
    $window_end: row.window_end,
    $date: row.date,
    $cwd: row.cwd,
    $intent: row.intent,
    $decisions: row.decisions,
    $gen_model: row.gen_model,
    $gen_effort: row.gen_effort,
    $now: now,
  });
}

// ある cwd の直近 decision title を新しい順に引く (knownTitles)。
// orchestrator が素材に同梱し、LLM に「同じ決定なら一字一句同じ title を使え」と指示する
// (本家 grepathy 方式の決定論 dedupe — LLM のマージ再実行はしない)。
export function recentTitles(db: Database, cwd: string, limit = 50): string[] {
  const rows = db
    .query(
      `SELECT je.value ->> 'title' AS title, MAX(entries.window_start) AS last_seen
       FROM entries, json_each(entries.decisions) AS je
       WHERE entries.cwd = $cwd AND entries.decisions IS NOT NULL
       GROUP BY title ORDER BY last_seen DESC LIMIT $limit`,
    )
    .all({ $cwd: cwd, $limit: limit }) as { title: string | null }[];
  return rows.map((r) => r.title).filter((t): t is string => !!t);
}
