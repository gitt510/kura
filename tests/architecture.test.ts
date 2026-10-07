import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const src = join(import.meta.dir, "..", "src");

function typescriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

const sources = () => typescriptFiles(src).filter((file) => !file.endsWith(".test.ts"));

// agent を spawn した経路だけが usage を記録できる。spawn 元が増えると記録漏れが
// 生まれるため、agent CLI を起動できる場所を lib/agent.ts 1 箇所に閉じ込める。
// binary の解決 (agentExecutable / Bun.which) も、名前を直書きした spawn も検出する。
const agentSpawn = [
  /\bagentExecutable\b/,
  /\bwhich\(\s*["'`](claude|codex)["'`]/,
  /\b(spawn|spawnSync|exec|execSync|execFile|execFileSync)\(\s*\[?\s*["'`](claude|codex)\b/,
  /\$`\s*(claude|codex)\b/,
];

test("agent CLI を spawn するのは lib/agent.ts だけ", () => {
  const runner = join(src, "lib", "agent.ts");
  const violations = sources()
    .filter((file) => file !== runner)
    .filter((file) => agentSpawn.some((pattern) => pattern.test(readFileSync(file, "utf-8"))));

  expect(violations).toEqual([]);
});

test("agent spawn の検出 pattern は直書きの spawn を捕まえる", () => {
  for (const code of [
    'Bun.spawn(["claude", "-p", prompt])',
    "Bun.spawnSync([ 'codex', 'exec' ])",
    'const bin = Bun.which("claude")',
    "await $`claude -p ${prompt}`",
    'execFileSync("codex", ["exec"])',
  ]) {
    expect(agentSpawn.some((pattern) => pattern.test(code))).toBe(true);
  }
});

// 実行の入口は src/cli.ts の subcommand だけ。launchd も mod も手動も同じ入口を通り、
// config・引数解釈・log が揃う。features は関数を export するだけで、process を持たない。
test("features は実行の入口を持たない", () => {
  const violations = sources()
    .filter((file) => file.startsWith(join(src, "features")))
    .filter((file) =>
      /import\.meta\.main|process\.exit|process\.argv|Bun\.stdin/.test(readFileSync(file, "utf-8")),
    );

  expect(violations).toEqual([]);
});

test("history と lib は features に依存しない", () => {
  const violations = ["history", "lib"]
    .flatMap((dir) => typescriptFiles(join(src, dir)))
    .filter((file) => /from\s+["'][^"']*features\//.test(readFileSync(file, "utf-8")));

  expect(violations).toEqual([]);
});
