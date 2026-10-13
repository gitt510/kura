import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSecret, writePrivateJson } from "./secrets.ts";

const roots: string[] = [];

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "kura-secrets-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("secret は参照でなければそのまま、op:// 参照は bake 済みの値を引く", () => {
  const cache = join(tempDir(), "secrets.json");
  writeFileSync(cache, JSON.stringify({ "op://vault/item/url": "https://example.test/hook" }));
  expect(resolveSecret(undefined, cache)).toBeNull();
  expect(resolveSecret("https://plain.test", cache)).toBe("https://plain.test");
  expect(resolveSecret("op://vault/item/url", cache)).toBe("https://example.test/hook");
  expect(() => resolveSecret("op://vault/other/url", cache)).toThrow("run: just bake-secrets");
});

test("writePrivateJson は symlink を残したまま実体に書く", () => {
  const root = tempDir();
  const targetRoot = tempDir();
  chmodSync(targetRoot, 0o755);
  const real = join(targetRoot, "real.json");
  const link = join(root, "link.json");
  writeFileSync(real, "{}\n");
  symlinkSync(real, link);
  writePrivateJson(link, { a: 1 });
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(JSON.parse(readFileSync(real, "utf-8"))).toEqual({ a: 1 });
  expect(statSync(targetRoot).mode & 0o777).toBe(0o755);
  expect(statSync(real).mode & 0o777).toBe(0o600);
});

test("writePrivateJson は壊れた symlink を置き換えずに失敗する", () => {
  const root = tempDir();
  const real = join(root, "missing.json");
  const link = join(root, "link.json");
  symlinkSync(real, link);
  expect(() => writePrivateJson(link, { a: 1 })).toThrow();
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(existsSync(real)).toBe(false);
});
