// decisions-cli.test.ts — `kura decisions <repo>` の公開契約。
//
// TODO で確定した仕様を固定する:
//   同一 title は 1 件に畳み、最新 window の内容を採用して新しい順に返す。
//   repo は cwd の末尾一致。別 repo の decision は混ざらない。

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const cli = join(import.meta.dir, "..", "..", "src", "cli.ts");
const schema = join(import.meta.dir, "..", "..", "src", "features", "decisions", "schema.sql");
let root = "";

function entry(windowStart: string, cwd: string, decisions: unknown[]): void {
  const db = new Database(join(root, "kura", "decisions.db"), { create: true });
  try {
    db.exec(readFileSync(schema, "utf-8"));
    db.query(
      `INSERT INTO entries
         (window_start, window_end, date, cwd, intent, decisions, gen_model, gen_effort, created_at, updated_at)
       VALUES ($ws, NULL, $date, $cwd, NULL, $decisions, NULL, NULL, $now, $now)`,
    ).run({
      $ws: windowStart,
      $date: windowStart.slice(0, 10),
      $cwd: cwd,
      $decisions: JSON.stringify(decisions),
      $now: "2026-07-20T00:00:00.000Z",
    });
  } finally {
    db.close();
  }
}

function decision(title: string, body: string) {
  return { title, status: "discussed", touches: ["src/a.ts"], body };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kura-decisions-cli-"));
  mkdirSync(join(root, "kura"), { recursive: true });
  entry("2026-07-20 09:00:00", "/home/u/ghq/github.com/owner/repo", [
    decision("Use SQLite for state", "initial rationale"),
    decision("Adopt WAL mode", "reduce writer contention"),
  ]);
  entry("2026-07-20 14:00:00", "/home/u/ghq/github.com/owner/repo", [
    decision("Use SQLite for state", "revised rationale"),
  ]);
  entry("2026-07-20 15:00:00", "/home/u/ghq/github.com/owner/other", [
    decision("Unrelated decision", "belongs to another repo"),
  ]);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(...args: string[]) {
  return Bun.spawnSync([process.execPath, cli, ...args], {
    env: { ...process.env, XDG_STATE_HOME: root },
  });
}

test("同一 title は最新 body に畳まれ、新しい順に返る", () => {
  const result = run("decisions", "owner/repo");
  expect(result.exitCode).toBe(0);
  const json = JSON.parse(result.stdout.toString());
  expect(json.count).toBe(2);
  expect(json.decisions.map((d: { title: string }) => d.title)).toEqual([
    "Use SQLite for state",
    "Adopt WAL mode",
  ]);
  expect(json.decisions[0].body).toBe("revised rationale");
  expect(json.decisions[0].lastSeen).toBe("2026-07-20 14:00:00");
});

test("repo は cwd の末尾一致で、別 repo の decision は混ざらない", () => {
  const bare = JSON.parse(run("decisions", "repo").stdout.toString());
  expect(bare.count).toBe(2);
  const other = JSON.parse(run("decisions", "owner/other").stdout.toString());
  expect(other.decisions.map((d: { title: string }) => d.title)).toEqual(["Unrelated decision"]);
  const none = JSON.parse(run("decisions", "no-such-repo").stdout.toString());
  expect(none).toEqual({ query: { repo: "no-such-repo" }, count: 0, decisions: [] });
});

test("--limit を適用し、引数無しと未知 option は usage に落ちる", () => {
  const limited = JSON.parse(run("decisions", "--limit=1", "owner/repo").stdout.toString());
  expect(limited.count).toBe(1);
  expect(limited.decisions[0].title).toBe("Use SQLite for state");
  expect(run("decisions").exitCode).toBe(2);
  expect(run("decisions", "--frobnicate", "repo").exitCode).toBe(2);
});
