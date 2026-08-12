import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const cli = join(import.meta.dir, "..", "..", "src", "cli.ts");
const queryHour = join(import.meta.dir, "..", "..", "src", "history", "query-hour.ts");
const schema = join(import.meta.dir, "..", "..", "src", "history", "schema.sql");
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kura-history-cli-"));
  const state = join(root, "kura");
  mkdirSync(state, { recursive: true });
  const db = new Database(join(state, "history.db"), { create: true });
  try {
    db.exec(readFileSync(schema, "utf-8"));
    const insert = db.prepare(
      "INSERT INTO messages " +
        "(uuid, session_id, cwd, role, text, model, timestamp) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    insert.run(
      "a1",
      "session-alpha-111",
      "/tmp/project-a",
      "user",
      "choose SQLite for local storage",
      null,
      "2026-07-20T01:00:00.000Z",
    );
    insert.run(
      "a2",
      "session-alpha-111",
      "/tmp/project-a",
      "assistant",
      "SQLite keeps the storage boundary simple",
      "gpt-fixture",
      "2026-07-20T01:01:00.000Z",
    );
    insert.run(
      "b1",
      "session-beta-222",
      "/tmp/project-b",
      "user",
      "compare SQLite with JSON",
      null,
      "2026-07-21T01:00:00.000Z",
    );
    insert.run(
      "noise-1",
      "session-noise-333",
      "/tmp/project-a",
      "user",
      "tool call was malformed and could not be parsed",
      null,
      "2026-07-20T01:02:00.000Z",
    );
  } finally {
    db.close();
  }
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(...args: string[]) {
  return Bun.spawnSync([process.execPath, cli, ...args], {
    env: { ...process.env, XDG_STATE_HOME: root },
  });
}

test("search は session 候補を JSON で返し limit を適用する", () => {
  const result = run("search", "--limit=1", "SQLite", "storage");
  expect(result.exitCode).toBe(0);

  const output = JSON.parse(result.stdout.toString());
  expect(output.query.keywords).toEqual(["SQLite", "storage"]);
  expect(output.count).toBe(2);
  expect(output.hits).toHaveLength(1);
  expect(output.hits[0]).toMatchObject({
    session: "session-alpha-111",
    short: "session",
    matched: ["SQLite", "storage"],
  });
});

test("show は session prefix を解決して会話を JSON で返す", () => {
  const result = run("show", "session-alpha-1");
  expect(result.exitCode).toBe(0);

  const output = JSON.parse(result.stdout.toString());
  expect(output.meta).toMatchObject({
    session: "session-alpha-111",
    cwd: "/tmp/project-a",
    model: "gpt-fixture",
    volume: { msgs: 2, user: 1, assistant: 1 },
  });
  expect(output.messages.map((message: { role: string; text: string }) => message.role)).toEqual([
    "user",
    "assistant",
  ]);
});

test("show は未知の session を runtime error にする", () => {
  const result = run("show", "missing");
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toBe("session not found: missing\n");
});

test("subcommand の --help / -h は詳細な help を stdout に出す", () => {
  for (const args of [
    ["search", "--help"],
    ["search", "-h"],
    ["show", "-h"],
    ["usage", "--help"],
  ]) {
    const result = run(...args);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(`usage: kura ${args[0]}`);
  }
  expect(run("search", "--help").stdout.toString()).toContain("OR-matched");
});

test("未知の subcommand への --help は usage error のまま", () => {
  const result = run("nonsense", "--help");
  expect(result.exitCode).toBe(2);
});

test("search / show の不正な引数は usage error にする", () => {
  for (const args of [
    ["search"],
    ["search", "--limit=0", "SQLite"],
    ["search", "--unknown", "SQLite"],
    ["show"],
    ["show", "one", "two"],
  ]) {
    const result = run(...args);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain(
      args[0] === "search"
        ? "kura search [--limit=N] <keyword...>"
        : "kura show <session-id-or-prefix>",
    );
  }
});

test("history DB を開くと廃止済みの列を削除する", () => {
  const path = join(root, "kura", "history.db");
  const db = new Database(path);
  try {
    db.exec("ALTER TABLE messages ADD COLUMN is_sidechain INTEGER NOT NULL DEFAULT 0");
    db.exec("ALTER TABLE tool_uses ADD COLUMN is_sidechain INTEGER NOT NULL DEFAULT 0");
  } finally {
    db.close();
  }

  expect(run("search", "SQLite").exitCode).toBe(0);

  const migrated = new Database(path, { readonly: true });
  try {
    const columns = (table: string) =>
      (migrated.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (column) => column.name,
      );
    expect(columns("messages")).not.toContain("is_sidechain");
    expect(columns("tool_uses")).not.toContain("is_sidechain");
  } finally {
    migrated.close();
  }
});

test("malformed retry message は search と hourly query の両方から除外する", () => {
  const search = run("search", "malformed");
  expect(search.exitCode).toBe(0);
  expect(JSON.parse(search.stdout.toString()).count).toBe(0);

  const hourly = Bun.spawnSync([process.execPath, queryHour, "2026-07-20", "10"], {
    env: { ...process.env, XDG_STATE_HOME: root },
  });
  expect(hourly.exitCode).toBe(0);
  const window = JSON.parse(hourly.stdout.toString());
  expect(window.meta.volume.user).toBe(1);
  expect(window.messages.map((message: { text: string }) => message.text)).toEqual([
    "choose SQLite for local storage",
  ]);
});
