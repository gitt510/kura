import { expect, test } from "bun:test";
import { join } from "node:path";

const cli = join(import.meta.dir, "..", "..", "src", "cli.ts");

test("extension run は知らない extension を usage で拒否する", () => {
  const result = Bun.spawnSync([process.execPath, cli, "extension", "run", "timeline"], {
    env: process.env,
  });
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("usage: kura extension run <akapen|tldr|verbatim>");
});
