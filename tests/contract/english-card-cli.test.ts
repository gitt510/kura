import { expect, test } from "bun:test";
import { join } from "node:path";

const cli = join(import.meta.dir, "..", "..", "src", "cli.ts");

function run(args: string[], stdin: string) {
  return Bun.spawnSync([process.execPath, cli, "english-card", ...args], {
    stdin: new TextEncoder().encode(stdin),
    env: process.env,
  });
}

test("english-card は引数を受け付けず usage で拒否する", () => {
  const result = run(["--bogus"], "hello there");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("usage: kura english-card < prompt.txt");
});

test("card 化しない入力は model を呼ばずに skipped を返す", () => {
  for (const input of ["ok", "/status", "<system-reminder>x</system-reminder>"]) {
    const result = run([], input);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ status: "skipped" });
  }
});

test("kura --help が english-card を載せる", () => {
  const result = Bun.spawnSync([process.execPath, cli, "--help"], { env: process.env });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("kura english-card < prompt.txt");
});
