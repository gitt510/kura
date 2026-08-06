import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const root = mkdtempSync(join(tmpdir(), "kura-history-source-claude-"));
const fixture = join(import.meta.dir, "..", "fixtures", "claude.jsonl");
const cli = join(import.meta.dir, "..", "..", "src", "cli.ts");

afterEach(() => rmSync(root, { recursive: true, force: true }));

function runHook(
  sessionId: string,
  extraEnv: Record<string, string> = {},
  transcript = fixture,
) {
  mkdirSync(root, { recursive: true });
  const input = join(root, "hook-input.json");
  writeFileSync(
    input,
    JSON.stringify({
      session_id: sessionId,
      cwd: "/tmp/kura-fixture",
      transcript_path: transcript,
    }),
  );
  return Bun.spawnSync([process.execPath, cli, "hook", "claude"], {
    stdin: Bun.file(input),
    env: { ...process.env, XDG_STATE_HOME: root, ...extraEnv },
  });
}

function runPromptHook(
  sessionId: string,
  prompt: string,
  promptId: string,
  extraEnv: Record<string, string> = {},
) {
  mkdirSync(root, { recursive: true });
  const input = join(root, "prompt-hook-input.json");
  writeFileSync(
    input,
    JSON.stringify({
      session_id: sessionId,
      cwd: "/tmp/kura-fixture",
      transcript_path: join(root, "not-yet-written.jsonl"),
      hook_event_name: "UserPromptSubmit",
      prompt,
      prompt_id: promptId,
    }),
  );
  return Bun.spawnSync([process.execPath, cli, "hook", "claude"], {
    stdin: Bun.file(input),
    env: { ...process.env, XDG_STATE_HOME: root, ...extraEnv },
  });
}

function messages() {
  const db = new Database(join(root, "kura", "history.db"), { readonly: true });
  try {
    return db
      .query("SELECT uuid, session_id, role, text, model FROM messages ORDER BY timestamp")
      .all() as {
      uuid: string;
      session_id: string;
      role: string;
      text: string;
      model: string | null;
    }[];
  } finally {
    db.close();
  }
}

function promptRows() {
  const db = new Database(join(root, "kura", "history.db"), { readonly: true });
  try {
    return db
      .query("SELECT uuid, prompt_id, role, text FROM messages ORDER BY timestamp")
      .all() as { uuid: string; prompt_id: string | null; role: string; text: string }[];
  } finally {
    db.close();
  }
}

function toolUses() {
  const db = new Database(join(root, "kura", "history.db"), { readonly: true });
  try {
    return db
      .query("SELECT id, message_uuid, tool_name, input FROM tool_uses ORDER BY timestamp")
      .all() as { id: string; message_uuid: string; tool_name: string; input: string }[];
  } finally {
    db.close();
  }
}

test("Claude fixture を idempotent に保存する", () => {
  expect(runHook("claude-fixture").exitCode).toBe(0);
  expect(messages()).toEqual([
    {
      uuid: "claude-msg-1",
      session_id: "claude-fixture",
      role: "user",
      text: "fixture user message",
      model: null,
    },
    {
      uuid: "claude-msg-2",
      session_id: "claude-fixture",
      role: "assistant",
      text: "fixture assistant message",
      model: "claude-fixture-model",
    },
  ]);

  expect(runHook("claude-fixture").exitCode).toBe(0);
  expect(messages()).toHaveLength(2);
  expect(toolUses()).toHaveLength(2);
});

test("Claude tool-use input を保存する", () => {
  expect(runHook("claude-fixture").exitCode).toBe(0);
  expect(toolUses()).toEqual([
    {
      id: "toolu_fixture_1",
      message_uuid: "claude-msg-2",
      tool_name: "Read",
      input: JSON.stringify({ file_path: "/tmp/kura-fixture/README.md" }),
    },
    {
      id: "toolu_fixture_2",
      message_uuid: "claude-msg-4",
      tool_name: "Bash",
      input: JSON.stringify({ command: "echo fixture" }),
    },
  ]);
});

test("KURA_NO_HISTORY=1 なら Claude history を保存しない", () => {
  expect(runHook("claude-no-history", { KURA_NO_HISTORY: "1" }).exitCode).toBe(0);
  expect(runPromptHook("claude-no-history", "prompt", "p-1", { KURA_NO_HISTORY: "1" }).exitCode).toBe(0);
  expect(existsSync(join(root, "kura", "history.db"))).toBe(false);
});

test("UserPromptSubmit payload を仮 row として idempotent に保存する", () => {
  expect(runPromptHook("claude-live", "draft prompt", "prompt-live-1").exitCode).toBe(0);
  expect(runPromptHook("claude-live", "draft prompt", "prompt-live-1").exitCode).toBe(0);
  expect(promptRows()).toEqual([
    { uuid: "prompt-live-1", prompt_id: "prompt-live-1", role: "user", text: "draft prompt" },
  ]);
});

test("command 入力と空入力は仮 row にしない", () => {
  expect(runPromptHook("claude-live", "/clear", "prompt-slash").exitCode).toBe(0);
  expect(runPromptHook("claude-live", "  !ls -la", "prompt-bang").exitCode).toBe(0);
  expect(runPromptHook("claude-live", "   ", "prompt-blank").exitCode).toBe(0);
  expect(runPromptHook("claude-live", "kept", "").exitCode).toBe(0);
  expect(existsSync(join(root, "kura", "history.db"))).toBe(false);
});

test("Stop scan は promptId の一致する仮 row を verbatim row に差し替える", () => {
  expect(runPromptHook("claude-fixture", "fixture user message (draft)", "claude-prompt-1").exitCode).toBe(0);
  expect(runHook("claude-fixture").exitCode).toBe(0);
  expect(runHook("claude-fixture").exitCode).toBe(0);
  const rows = promptRows();
  expect(rows.map((row) => row.uuid)).toEqual(["claude-msg-1", "claude-msg-2"]);
  expect(rows[0]).toEqual({
    uuid: "claude-msg-1",
    prompt_id: "claude-prompt-1",
    role: "user",
    text: "fixture user message",
  });
});

test("仮 row が無くても promptId 付き entry を verbatim に保存する", () => {
  expect(runHook("claude-fixture").exitCode).toBe(0);
  expect(promptRows()[0]).toEqual({
    uuid: "claude-msg-1",
    prompt_id: "claude-prompt-1",
    role: "user",
    text: "fixture user message",
  });
});

test("Claude source は空の message UUID と tool-use ID を保存しない", () => {
  mkdirSync(root, { recursive: true });
  const transcript = join(root, "transcript.jsonl");
  writeFileSync(
    transcript,
    [
      {
        type: "user",
        uuid: "",
        sessionId: "claude-empty-id",
        timestamp: "2026-07-24T00:00:00.000Z",
        message: { content: "must not be stored" },
      },
      {
        type: "user",
        uuid: "message-1",
        sessionId: "claude-empty-id",
        timestamp: "2026-07-24T00:00:01.000Z",
        message: { content: "stored message" },
      },
      {
        type: "assistant",
        uuid: "message-2",
        sessionId: "claude-empty-id",
        timestamp: "2026-07-24T00:00:02.000Z",
        message: {
          content: [
            { type: "tool_use", id: "", name: "Read", input: { path: "skip" } },
            { type: "tool_use", id: "tool-1", name: "Read", input: { path: "keep" } },
          ],
        },
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n"),
  );

  expect(runHook("claude-empty-id", {}, transcript).exitCode).toBe(0);
  expect(messages().map((message) => message.uuid)).toEqual(["message-1"]);
  expect(toolUses().map((toolUse) => toolUse.id)).toEqual(["tool-1"]);
});
