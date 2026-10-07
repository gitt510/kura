import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configPath,
  defaultConfig,
  loadConfig,
  parseConfig,
  resolveSecret,
  saveConfig,
} from "./config.ts";

const roots: string[] = [];

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "kura-config-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("config.json は XDG_CONFIG_HOME、無ければ HOME/.config に置く", () => {
  expect(configPath({ XDG_CONFIG_HOME: "/xdg" })).toBe("/xdg/kura/config.json");
  expect(configPath({ HOME: "/home/example" })).toBe("/home/example/.config/kura/config.json");
});

test("config.json が無ければ既定値で動く", () => {
  expect(loadConfig(join(tempDir(), "missing.json"))).toEqual(defaultConfig());
});

test("書かれていない項目は既定値で埋め、空文字は未設定として扱う", () => {
  const config = parseConfig(
    { generator: "codex", codex: { model: "gpt-5.6", effort: " " } },
    "config.json",
  );
  expect(config.generator).toBe("codex");
  expect(config.codex).toEqual({ model: "gpt-5.6", effort: null });
  expect(config.claude).toEqual({ model: null, effort: null });
  expect(config.companion.model).toBe("opus");
});

test("型の違う項目は path と項目名付きで拒否する", () => {
  expect(() => parseConfig({ claude: { model: 5 } }, "/c.json")).toThrow(
    "invalid config /c.json: claude.model must be a string",
  );
  expect(() => parseConfig({ publish: { enabled: "timeline" } }, "/c.json")).toThrow(
    "publish.enabled must be an array of strings",
  );
});

test("saveConfig は 0600 で書き、loadConfig で同じ値に戻る", () => {
  const path = join(tempDir(), "kura", "config.json");
  const config = defaultConfig();
  config.publish.enabled = ["timeline"];
  saveConfig(config, path);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(loadConfig(path)).toEqual(config);
});

test("secret は参照でなければそのまま、op:// 参照は bake 済みの値を引く", () => {
  const cache = join(tempDir(), "secrets.json");
  writeFileSync(cache, JSON.stringify({ "op://vault/item/url": "https://example.test/hook" }));
  expect(resolveSecret(undefined, cache)).toBeNull();
  expect(resolveSecret("https://plain.test", cache)).toBe("https://plain.test");
  expect(resolveSecret("op://vault/item/url", cache)).toBe("https://example.test/hook");
  expect(() => resolveSecret("op://vault/other/url", cache)).toThrow("run: just bake-secrets");
});
