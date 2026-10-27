import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "..", "..", "src", "cli.ts");
const schema = join(import.meta.dir, "..", "..", "src", "schema.sql");
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kura-history-cli-"));
  const state = join(root, "kura");
  mkdirSync(state, { recursive: true });
  const db = new Database(join(state, "kura.db"), { create: true });
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

test("kura.db が無ければ、旧 DB の中身を写して作り、旧 DB は残す", () => {
  const state = join(root, "kura");
  rmSync(join(state, "kura.db"));
  const legacy = (file: string, sql: string) => {
    const db = new Database(join(state, file), { create: true });
    try {
      db.exec(sql);
    } finally {
      db.close();
    }
  };
  // 廃止済みの列 (is_sidechain) を持ち、後から足した列 (prompt_id) を持たない古い形。
  legacy(
    "history.db",
    `CREATE TABLE messages (uuid TEXT PRIMARY KEY, session_id TEXT, cwd TEXT, role TEXT,
       text TEXT, model TEXT, timestamp TEXT, is_sidechain INTEGER);
     INSERT INTO messages VALUES ('m1', 'session-old', '/repo', 'user', 'legacy SQLite note',
       NULL, '2026-07-01T00:00:00.000Z', 0);`,
  );
  legacy(
    "usage.db",
    `CREATE TABLE calls (feature TEXT, agent TEXT, model TEXT, ok INTEGER, input_tokens INTEGER,
       cache_creation_tokens INTEGER, cache_read_tokens INTEGER, output_tokens INTEGER,
       cost_usd REAL, created_at TEXT);
     INSERT INTO calls VALUES ('akapen', 'claude', NULL, 1, 1, 0, 0, 1, NULL, '2026-07-01');`,
  );

  expect(run("search", "legacy").stdout.toString()).toContain("session-old");

  const db = new Database(join(state, "kura.db"), { readonly: true });
  try {
    const count = (table: string) =>
      (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(count("messages")).toBe(1);
    expect(count("usage")).toBe(1);
    const columns = (db.query("PRAGMA table_info(messages)").all() as { name: string }[]).map(
      (column) => column.name,
    );
    expect(columns).not.toContain("is_sidechain");
    expect(columns).toContain("prompt_id");
  } finally {
    db.close();
  }
  for (const file of ["history.db", "usage.db"]) {
    expect(existsSync(join(state, file))).toBe(true);
  }
});

test("malformed retry message は search から除外する", () => {
  const search = run("search", "malformed");
  expect(search.exitCode).toBe(0);
  expect(JSON.parse(search.stdout.toString()).count).toBe(0);
});
