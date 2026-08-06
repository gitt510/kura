// db.ts — kura の agent 横断 history DB への型付きアクセス窓口。
//
// このファイルが schema owner: openHistory() が schema.sql を冪等に適用し、
// 旧 DB の廃止列は migrateSchema() が除去する。writer / reader 双方が
// ここを import して同じ table 形・同じ型を共有する。

import { Database } from "bun:sqlite";
import {
  legacyDbPath,
  openStateDatabase,
  stateDbPath,
  tableColumns,
} from "../lib/storage.ts";

// schema は code と同居、DB は runtime state に置く。旧 checkout 内 DB は初回 import 時に移行する。
export const HISTORY_DB = stateDbPath(
  "history.db",
  legacyDbPath("history", "history.db"),
);
const SCHEMA_SQL = `${import.meta.dir}/schema.sql`;

export interface MessageRow {
  uuid: string;
  // Claude の prompt id。仮 row は uuid === prompt_id、verbatim row は実 uuid + prompt_id を持つ。
  prompt_id?: string | null;
  session_id: string;
  cwd: string | null;
  role: "user" | "assistant";
  text: string;
  model: string | null;
  timestamp: string;
}

export interface ToolUseRow {
  id: string;
  message_uuid: string;
  session_id: string;
  cwd: string | null;
  tool_name: string;
  input: string;
  timestamp: string;
}

// DB を開き、schema を最新化して返す (冪等)。存在しなければ作成する。
export function openHistory(): Database {
  const db = openStateDatabase(HISTORY_DB, SCHEMA_SQL);
  migrateSchema(db);
  return db;
}

// CREATE TABLE IF NOT EXISTS では既存 table の列を落とせないため、
// 廃止済みの列を個別に除去する。
function migrateSchema(db: Database): void {
  for (const table of ["messages", "tool_uses"]) {
    const cols = tableColumns(db, table);
    if (cols.has("is_sidechain")) {
      db.exec(`ALTER TABLE ${table} DROP COLUMN is_sidechain`);
    }
  }
  if (!tableColumns(db, "messages").has("prompt_id")) {
    db.exec("ALTER TABLE messages ADD COLUMN prompt_id TEXT");
  }
}

export function insertMessages(db: Database, rows: MessageRow[]): void {
  if (rows.length === 0) return;
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO messages (uuid, prompt_id, session_id, cwd, role, text, model, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  // verbatim row の insert 前に同じ prompt の仮 row (uuid = prompt_id) を消す。
  // UPDATE での昇格は verbatim row が既に居ると PK 衝突するため DELETE + INSERT。
  const supersede = db.prepare("DELETE FROM messages WHERE uuid = ?");
  db.transaction((rs: MessageRow[]) => {
    for (const r of rs) {
      const promptId = r.prompt_id ?? null;
      if (promptId && promptId !== r.uuid) supersede.run(promptId);
      stmt.run(
        r.uuid,
        promptId,
        r.session_id,
        r.cwd,
        r.role,
        r.text,
        r.model,
        r.timestamp,
      );
    }
  })(rows);
}

export function insertToolUses(db: Database, rows: ToolUseRow[]): void {
  if (rows.length === 0) return;
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO tool_uses (id, message_uuid, session_id, cwd, tool_name, input, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  db.transaction((rs: ToolUseRow[]) => {
    for (const r of rs) {
      stmt.run(
        r.id,
        r.message_uuid,
        r.session_id,
        r.cwd,
        r.tool_name,
        r.input,
        r.timestamp,
      );
    }
  })(rows);
}
