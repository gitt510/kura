#!/usr/bin/env bun
// sources/codex.ts — Codex transcript の history source adapter。
//
// Codex Stop hook の stdin payload から transcript を読み、kura の history.db に保存する。
// transcript JSONL は Codex の stable interface ではないため、Claude source とは分ける。
// event_msg の user_message / agent_message だけを会話として保存する。

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { insertMessages, openHistory, type MessageRow } from "../db.ts";

type CodexEvent = {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    message?: string;
  };
};

const nullable = (s: string | undefined | null): string | null =>
  s == null || s === "" ? null : s;

function messageId(sessionId: string, role: string, timestamp: string, text: string): string {
  const digest = createHash("sha256")
    .update(`${sessionId}\0${role}\0${timestamp}\0${text}`)
    .digest("hex");
  return `codex-${digest}`;
}

try {
  // kura 自身が起動する無人 worker は、agent を問わず history に入れない。
  if (process.env.KURA_NO_HISTORY === "1") process.exit(0);

  const payload = await Bun.stdin.text();
  let input: { session_id?: string; cwd?: string; transcript_path?: string; model?: string };
  try {
    input = JSON.parse(payload);
  } catch {
    process.exit(0);
  }

  const sessionId = input.session_id ?? "";
  const cwd = input.cwd ?? "";
  const transcriptPath = input.transcript_path ?? "";
  if (!sessionId || !transcriptPath || !existsSync(transcriptPath)) process.exit(0);

  const rows: MessageRow[] = [];
  const lines = readFileSync(transcriptPath, "utf-8").split("\n");
  for (const raw of lines) {
    if (!raw) continue;
    let event: CodexEvent;
    try {
      event = JSON.parse(raw);
    } catch {
      continue;
    }
    if (event.type !== "event_msg") continue;

    const kind = event.payload?.type;
    const role = kind === "user_message" ? "user" : kind === "agent_message" ? "assistant" : null;
    const text = event.payload?.message;
    const timestamp = event.timestamp ?? "";
    if (!role || !text || !timestamp) continue;

    rows.push({
      uuid: messageId(sessionId, role, timestamp, text),
      session_id: sessionId,
      cwd: nullable(cwd),
      role,
      text,
      model: role === "assistant" ? nullable(input.model) : null,
      timestamp,
    });
  }

  if (rows.length === 0) process.exit(0);
  const db = openHistory();
  try {
    insertMessages(db, rows);
  } finally {
    db.close();
  }
} catch (error) {
  process.stderr.write(
    `kura history hook failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
}

process.exit(0);
