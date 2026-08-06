import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "..", "..", "src", "cli.ts");

function run(args: string[], stateHome: string) {
  return Bun.spawnSync([process.execPath, cli, "companion", ...args], {
    env: { ...process.env, XDG_STATE_HOME: stateHome },
  });
}

test("companion は不明な引数を usage で拒否する", () => {
  const root = mkdtempSync(join(tmpdir(), "kura-companion-usage-"));
  try {
    const result = run(["--bogus"], root);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain(
      "usage: kura companion [--port=N] [--session=<prefix>]",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("history.db が無ければ有効化の案内を出して終了する", () => {
  const root = mkdtempSync(join(tmpdir(), "kura-companion-nodb-"));
  try {
    const result = run([], root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("just history enable claude");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("kura --help が companion を載せる", () => {
  const result = Bun.spawnSync([process.execPath, cli, "--help"], { env: process.env });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("kura companion [--port=N] [--session=<prefix>]");
});
