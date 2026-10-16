import { expect, test } from "bun:test";
import { join } from "node:path";

const cli = join(import.meta.dir, "..", "..", "src", "cli.ts");

function run(args: string[], stdin: string) {
  return Bun.spawnSync([process.execPath, cli, "extension", "run", "verbatim", ...args], {
    stdin: new TextEncoder().encode(stdin),
    env: process.env,
  });
}

test("verbatim は引数を受け付けず usage で拒否する", () => {
  const result = run(["--bogus"], '{"input": "hello there"}');
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("usage: kura extension run verbatim < prompt.json");
});

test("verbatim は不正な stdin を model を呼ばずに exit 2 で拒否する", () => {
  for (const input of ["not json", "{}", '{"input": "x", "turns": "no"}']) {
    const result = run([], input);
    expect(result.exitCode).toBe(2);
    expect(result.stdout.toString()).toBe("");
  }
});

test("訳さない入力は model を呼ばずに skipped を返す", () => {
  for (const input of ["ok", "/status", "<system-reminder>x</system-reminder>"]) {
    const result = run([], JSON.stringify({ input }));
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ status: "skipped" });
  }
});

test("kura extension run verbatim --help が verbatim の help を出す", () => {
  const result = Bun.spawnSync([process.execPath, cli, "extension", "run", "verbatim", "--help"], {
    env: process.env,
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("kura extension run verbatim < prompt.json");
});
