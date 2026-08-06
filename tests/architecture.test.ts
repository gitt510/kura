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

// agent を spawn した経路だけが usage を記録できる。spawn 元が増えると記録漏れが
// 生まれるため、agent CLI を起動できる場所を lib/agent.ts 1 箇所に閉じ込める。
test("agent CLI を spawn するのは lib/agent.ts だけ", () => {
  const runner = join(src, "lib", "agent.ts");
  const violations = typescriptFiles(src)
    .filter((file) => file !== runner && !file.endsWith(".test.ts"))
    .filter((file) => /\bagentExecutable\b/.test(readFileSync(file, "utf-8")));

  expect(violations).toEqual([]);
});

test("history と lib は features に依存しない", () => {
  const violations = ["history", "lib"]
    .flatMap((dir) => typescriptFiles(join(src, dir)))
    .filter((file) => /from\s+["'][^"']*features\//.test(readFileSync(file, "utf-8")));

  expect(violations).toEqual([]);
});
