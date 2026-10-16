// db.ts — kura.db の core table (messages / tool_uses) への型付きアクセス窓口。
//
// table の形は src/schema.sql が正本。writer / reader 双方がここを import して同じ型を共有する。

import type { Database } from "bun:sqlite";

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
      stmt.run(r.uuid, promptId, r.session_id, r.cwd, r.role, r.text, r.model, r.timestamp);
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
      stmt.run(r.id, r.message_uuid, r.session_id, r.cwd, r.tool_name, r.input, r.timestamp);
    }
  })(rows);
}
