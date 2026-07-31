#!/usr/bin/env bun
// sources/claude.ts — Claude Code transcript の history source adapter。
//
// transcript (JSONL) を読んで kura の history.db に保存する。
// schema / 型 / DB アクセスは同居の ./db.ts が所有する。読み出しは query.ts。
// Triggered from the Stop hook. Reads the JSON payload from stdin, scans
// the transcript referenced by transcript_path, and UPSERTs:
//   - every user / assistant message in the provided transcript into the `messages` table
//     (PK = uuid)
//   - every assistant tool_use block into the `tool_uses` table
//     (PK = tool_use id, e.g. toolu_xxx)
// Both inserts use INSERT OR IGNORE so re-runs are idempotent.
// Skipped:
//   - user entries with non-string content (tool_result echoes, attachments)
//   - assistant entries with no text block (still records tool_uses if any)
//
// Failures are reported but exit 0 so hooks never block the session.

import { existsSync, readFileSync } from "node:fs";
import {
  insertMessages,
  insertToolUses,
  openHistory,
  type MessageRow,
  type ToolUseRow,
} from "../db.ts";

const nullable = (s: string | undefined | null): string | null =>
  s == null || s === "" ? null : s;

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input?: unknown }
  | { type: string; [k: string]: unknown };

interface TranscriptEntry {
  type?: string;
  uuid?: string;
  sessionId?: string;
  timestamp?: string;
  message?: {
    content?: string | ContentBlock[];
    model?: string;
  };
}

try {
  // drain / tick など kura 自身の自動セッションは history に保存しない。
  // これが無いと自動 worker が history に入り、後続の集計が自己参照する。
  // 値は "1" のみ有効 — "0" 等で無効化できる直感と一致させる (presence 判定にしない)。
  if (process.env.KURA_NO_HISTORY === "1") process.exit(0);

  const payload = await Bun.stdin.text();
  let input: { session_id?: string; cwd?: string; transcript_path?: string };
  try {
    input = JSON.parse(payload);
  } catch {
    process.exit(0);
  }

  const sessionId = input.session_id ?? "";
  const cwd = input.cwd ?? "";
  const transcriptPath = input.transcript_path ?? "";

  if (!sessionId || !transcriptPath || !existsSync(transcriptPath)) {
    process.exit(0);
  }

  const lines = readFileSync(transcriptPath, "utf-8").split("\n");

  const messageRows: MessageRow[] = [];
  const toolRows: ToolUseRow[] = [];

  for (const line of lines) {
    if (!line) continue;
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "user" && entry.type !== "assistant") continue;

    const uuid = entry.uuid ?? "";
    const sid = entry.sessionId || sessionId;
    const ts = entry.timestamp ?? "";
    const content = entry.message?.content;

    // Extract text body
    let text = "";
    if (entry.type === "user") {
      if (typeof content === "string") text = content;
    } else if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const block of content) {
        if (block?.type === "text" && typeof block.text === "string") {
          texts.push(block.text);
        }
      }
      text = texts.join("\n");
    }

    if (text && uuid) {
      messageRows.push({
        uuid,
        session_id: sid,
        cwd: nullable(cwd),
        role: entry.type,
        text,
        model: nullable(entry.message?.model),
        timestamp: ts,
      });
    }

    // tool_use blocks (assistant only)
    if (entry.type === "assistant" && Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === "tool_use" && uuid) {
          const toolUse = block as { id: string; name: string; input?: unknown };
          if (!toolUse.id || !toolUse.name) continue;
          toolRows.push({
            id: toolUse.id,
            message_uuid: uuid,
            session_id: sid,
            cwd: nullable(cwd),
            tool_name: toolUse.name,
            input: JSON.stringify(toolUse.input ?? {}),
            timestamp: ts,
          });
        }
      }
    }
  }

  if (messageRows.length === 0 && toolRows.length === 0) {
    process.exit(0);
  }

  const db = openHistory();
  try {
    insertMessages(db, messageRows);
    insertToolUses(db, toolRows);
  } finally {
    db.close();
  }
} catch (error) {
  process.stderr.write(
    `kura history hook failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
}

process.exit(0);
