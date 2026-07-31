import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const root = mkdtempSync(join(tmpdir(), "kura-history-source-codex-"));
const fixture = join(import.meta.dir, "..", "fixtures", "codex.jsonl");
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
      model: "gpt-fixture",
    }),
  );
  return Bun.spawnSync([process.execPath, cli, "hook", "codex"], {
    stdin: Bun.file(input),
    env: { ...process.env, XDG_STATE_HOME: root, ...extraEnv },
  });
}

function messages() {
  const db = new Database(join(root, "kura", "history.db"), { readonly: true });
  try {
    return db
      .query("SELECT session_id, role, text, model FROM messages ORDER BY timestamp")
      .all() as { session_id: string; role: string; text: string; model: string | null }[];
  } finally {
    db.close();
  }
}

test("Codex fixture を idempotent に保存する", () => {
  expect(runHook("codex-fixture").exitCode).toBe(0);
  expect(messages()).toEqual([
    { session_id: "codex-fixture", role: "user", text: "fixture user message", model: null },
    {
      session_id: "codex-fixture",
      role: "assistant",
      text: "fixture assistant message",
      model: "gpt-fixture",
    },
  ]);

  expect(runHook("codex-fixture").exitCode).toBe(0);
  expect(messages()).toHaveLength(2);
});

test("Codex message ID は transcript の行番号変更に依存しない", () => {
  mkdirSync(root, { recursive: true });
  const transcript = join(root, "shifted-codex.jsonl");
  const original = readFileSync(fixture, "utf-8");
  writeFileSync(transcript, original);
  expect(runHook("codex-stable-id", {}, transcript).exitCode).toBe(0);

  writeFileSync(transcript, `{"type":"thread.started"}\n${original}`);
  expect(runHook("codex-stable-id", {}, transcript).exitCode).toBe(0);
  expect(messages()).toHaveLength(2);
});

test("並行writerはlock解放を待ってmessageを保存する", async () => {
  expect(runHook("codex-seed").exitCode).toBe(0);
  const path = join(root, "kura", "history.db");
  const locker = new Database(path);
  locker.exec("BEGIN IMMEDIATE");

  const input = join(root, "hook-input.json");
  writeFileSync(
    input,
    JSON.stringify({
      session_id: "codex-waited",
      cwd: "/tmp/kura-fixture",
      transcript_path: fixture,
      model: "gpt-fixture",
    }),
  );
  const child = Bun.spawn([process.execPath, cli, "hook", "codex"], {
    stdin: Bun.file(input),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, XDG_STATE_HOME: root },
  });
  await Bun.sleep(100);
  locker.exec("COMMIT");
  locker.close();

  expect(await child.exited).toBe(0);
  expect(messages().filter((message) => message.session_id === "codex-waited")).toHaveLength(2);
});

test("KURA_NO_HISTORY=1 なら Codex history を保存しない", () => {
  expect(runHook("codex-no-history", { KURA_NO_HISTORY: "1" }).exitCode).toBe(0);
  expect(existsSync(join(root, "kura", "history.db"))).toBe(false);
});

test("hook は未知の agent を usage error にする", () => {
  const result = Bun.spawnSync([process.execPath, cli, "hook", "unknown"]);
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("usage: kura hook <claude|codex>");
});

test("hook boundary は public help に表示しない", () => {
  const result = Bun.spawnSync([process.execPath, cli, "--help"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).not.toContain("kura hook");
  expect(result.stdout.toString()).not.toContain("kura ingest");
});

test("running session が保持する旧 hook command も無音で処理する", () => {
  expect(runHook("codex-legacy-hook").exitCode).toBe(0);
  const input = join(root, "hook-input.json");
  const result = Bun.spawnSync([process.execPath, cli, "ingest", "codex"], {
    stdin: Bun.file(input),
    env: { ...process.env, XDG_STATE_HOME: root },
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe("");
  expect(result.stderr.toString()).toBe("");
});
