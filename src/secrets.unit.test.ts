import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSecret } from "./secrets.ts";

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
