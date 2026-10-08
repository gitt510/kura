import { expect, test } from "bun:test";
import { join } from "node:path";

const cli = join(import.meta.dir, "..", "..", "src", "cli.ts");

function run(args: string[], env: Record<string, string | undefined> = process.env) {
  return Bun.spawnSync([process.execPath, cli, "handoff", ...args], { env });
}

test("handoff は session-id 1 つ以外を usage で拒否する", () => {
  for (const args of [[], ["a", "b"], ["--bogus"]]) {
    const result = run(args);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("usage: kura handoff <session-id>");
  }
});

test("handoff は tmux の外では pane を開かずに失敗する", () => {
  const { TMUX: _, ...env } = process.env;
  const result = run(["9c48e030"], env);
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("not inside tmux");
});

test("kura --help が handoff を載せる", () => {
  const result = Bun.spawnSync([process.execPath, cli, "--help"], { env: process.env });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("kura handoff <session-id>");
});
