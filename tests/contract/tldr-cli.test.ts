import { expect, test } from "bun:test";
import { join } from "node:path";

const cli = join(import.meta.dir, "..", "..", "src", "cli.ts");

function run(args: string[], stdin: string) {
  return Bun.spawnSync([process.execPath, cli, "extension", "run", "tldr", ...args], {
    stdin: new TextEncoder().encode(stdin),
    env: process.env,
  });
}

test("tldr は引数を受け付けず usage で拒否する", () => {
  const result = run(["--bogus"], "{}");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("usage: kura extension run tldr < turns.json");
});

test("tldr は不正な stdin を model を呼ばずに exit 2 で拒否する", () => {
  for (const input of [
    "not json",
    "{}",
    '{"turns": []}',
    '{"turns": [{"question": "q", "answer": " "}]}',
  ]) {
    const result = run([], input);
    expect(result.exitCode).toBe(2);
    expect(result.stdout.toString()).toBe("");
  }
});

test("kura extension run tldr --help が tldr の help を出す", () => {
  const result = Bun.spawnSync([process.execPath, cli, "extension", "run", "tldr", "--help"], {
    env: process.env,
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("kura extension run tldr < turns.json");
});
