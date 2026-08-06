import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "..", "..", "src", "cli.ts");
const usageLib = join(import.meta.dir, "..", "..", "src", "lib", "usage.ts");

function run(args: string[], stateHome: string) {
  return Bun.spawnSync([process.execPath, cli, "usage", ...args], {
    env: { ...process.env, XDG_STATE_HOME: stateHome },
  });
}

// usage.db に 1 call を direct insert する (LLM を呼ばずに記録経路を通す)。
function seed(stateHome: string, feature: string, createdAt: string) {
  const script = `
    const { openUsageDb, insertCall } = await import(${JSON.stringify(usageLib)});
    const db = openUsageDb();
    insertCall(db, {
      feature: ${JSON.stringify(feature)},
      agent: "claude",
      model: "claude-haiku-4-5",
      ok: true,
      usage: { inputTokens: 10, cacheCreationTokens: 100, cacheReadTokens: 1000, outputTokens: 40, costUsd: 0.0126 },
    }, ${JSON.stringify(createdAt)});
    db.close();
  `;
  const result = Bun.spawnSync([process.execPath, "-e", script], {
    env: { ...process.env, XDG_STATE_HOME: stateHome },
  });
  expect(result.exitCode).toBe(0);
}

test("usage は不明な引数を usage で拒否する", () => {
  const root = mkdtempSync(join(tmpdir(), "kura-usage-args-"));
  try {
    const result = run(["--bogus"], root);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("usage: kura usage [--days=N]");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("記録が無ければ案内だけ出して正常終了する", () => {
  const root = mkdtempSync(join(tmpdir(), "kura-usage-empty-"));
  try {
    const result = run([], root);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("no usage recorded yet");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("feature ごとの合計と TOTAL を表で出す", () => {
  const root = mkdtempSync(join(tmpdir(), "kura-usage-table-"));
  try {
    seed(root, "companion", new Date().toISOString());
    seed(root, "companion", new Date().toISOString());
    seed(root, "timeline", new Date().toISOString());

    const result = run([], root);
    const text = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    expect(text).toContain("Usage");
    expect(text).toMatch(/companion\s+│ claude-haiku-4-5\s+│ 2\s+│ 20\s+│ 80\s+│ 2,000\s+│ 200\s+│ 0\.0252/);
    expect(text).toMatch(/timeline\s+│ claude-haiku-4-5\s+│ 1\s+│/);
    expect(text).toMatch(/TOTAL\s+│ -\s+│ 3\s+│ 30\s+│ 120\s+│ 3,000\s+│ 300\s+│ 0\.0378/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--days は期間外の call を除外する", () => {
  const root = mkdtempSync(join(tmpdir(), "kura-usage-days-"));
  try {
    seed(root, "companion", new Date().toISOString());
    seed(root, "english", "2026-01-01T00:00:00.000Z");

    const result = run(["--days=7"], root);
    const text = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    expect(text).toContain("(last 7 days)");
    expect(text).toContain("companion");
    expect(text).not.toContain("english");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("kura --help が usage を載せる", () => {
  const result = Bun.spawnSync([process.execPath, cli, "--help"], { env: process.env });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("kura usage [--days=N]");
});
