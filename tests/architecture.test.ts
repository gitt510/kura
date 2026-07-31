import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const src = join(import.meta.dir, "..", "src");

function typescriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

test("history と lib は features に依存しない", () => {
  const violations = ["history", "lib"]
    .flatMap((dir) => typescriptFiles(join(src, dir)))
    .filter((file) => /from\s+["'][^"']*features\//.test(readFileSync(file, "utf-8")));

  expect(violations).toEqual([]);
});
