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
import { configPath, defaultConfig, loadConfig, saveConfig } from "./config.ts";

const roots: string[] = [];

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "kura-config-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// raw を config.json として書いて読む。loadConfig の error は書いた path を名指しする。
function parseConfig(raw: unknown, name: string) {
  const path = join(tempDir(), name);
  writeFileSync(path, JSON.stringify(raw));
  return loadConfig(path);
}

test("config.json は XDG_CONFIG_HOME、無ければ HOME/.config に置く", () => {
  expect(configPath({ XDG_CONFIG_HOME: "/xdg" })).toBe("/xdg/kura/config.json");
  expect(configPath({ HOME: "/home/example" })).toBe("/home/example/.config/kura/config.json");
});

test("config.json が無ければ既定値で動く", () => {
  expect(loadConfig(join(tempDir(), "missing.json"))).toEqual(defaultConfig());
});

test("書かれていない項目は既定値で埋め、null と空文字は CLI の既定として扱う", () => {
  const config = parseConfig({ extensions: { tldr: { model: "sonnet", effort: " " } } }, "c.json");
  expect(config.extensions.tldr).toEqual({ agent: "claude", model: "sonnet", effort: null });
  expect(config.extensions.akapen).toEqual({ agent: "claude", model: "opus", effort: null });
  expect(Object.keys(config)).toEqual(["extensions", "mod"]);
  // model は書かなければ feature の既定、null (や空白) は CLI の既定
  expect(
    parseConfig({ extensions: { akapen: { model: "  " } } }, "config.json").extensions.akapen.model,
  ).toBeNull();
  expect(
    parseConfig({ extensions: { akapen: { model: null } } }, "config.json").extensions.akapen.model,
  ).toBeNull();
});

test("型の違う項目は path と項目名付きで拒否する", () => {
  expect(() => parseConfig({ extensions: { tldr: { model: 5 } } }, "c.json")).toThrow(
    /^invalid config .*\/c\.json: extensions\.tldr\.model must be a string$/,
  );
  expect(() => parseConfig({ extensions: { akapen: { agent: "codex" } } }, "c.json")).toThrow(
    'extensions.akapen.agent must be "claude"',
  );
  expect(() => parseConfig({ extensions: { tldr: { modle: 1 } } }, "c.json")).toThrow(
    'extensions.tldr has unknown key "modle"',
  );
  expect(() => parseConfig({ generator: "codex" }, "c.json")).toThrow(
    'config has unknown key "generator"',
  );
});

test("saveConfig は 0600 で書き、loadConfig で同じ値に戻る", () => {
  const path = join(tempDir(), "kura", "config.json");
  const config = defaultConfig();
  config.extensions.tldr.model = "sonnet";
  saveConfig(config, path);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(loadConfig(path)).toEqual(config);
});

test("companion は既定で閉じ、akapen / tldr を半々で積む", () => {
  expect(parseConfig({}, "config.json").mod.companion).toEqual({
    autoOpen: false,
    widgets: ["akapen", "tldr"],
    ratio: [0.5, 0.5],
  });
  const config = parseConfig(
    { mod: { companion: { autoOpen: true, widgets: ["tldr"], ratio: [1] } } },
    "config.json",
  );
  expect(config.mod.companion).toEqual({ autoOpen: true, widgets: ["tldr"], ratio: [1] });
});

test("前の版の key は、今の書き方を添えて拒否する", () => {
  expect(() => parseConfig({ features: {} }, "c.json")).toThrow(
    'config has unknown key "features" (renamed to "extensions")',
  );
  expect(() => parseConfig({ extensions: { timeline: {} } }, "c.json")).toThrow(
    'extensions has unknown key "timeline" (removed)',
  );
  expect(() => parseConfig({ mod: { companion: { rows: 10 } } }, "c.json")).toThrow(
    'mod.companion has unknown key "rows" (removed; the pane size is left to Claude Code)',
  );
});

test("companion の不正な値は項目名付きで拒否する", () => {
  expect(() => parseConfig({ mod: { companion: { autoOpen: "yes" } } }, "c.json")).toThrow(
    "mod.companion.autoOpen must be a boolean",
  );
  expect(() =>
    parseConfig({ mod: { companion: { widgets: ["a", "b", "c", "d"] } } }, "c.json"),
  ).toThrow("mod.companion.widgets must list at most 3 widgets");
  expect(() => parseConfig({ mod: { companion: { ratio: [0.5, 0] } } }, "c.json")).toThrow(
    "mod.companion.ratio.1 must be a positive number",
  );
  expect(() =>
    parseConfig({ mod: { companion: { widgets: ["akapen", "verbatim", "tldr"] } } }, "c.json"),
  ).toThrow("mod.companion.ratio must list one share per widget in mod.companion.widgets");
});

test("saveConfig は symlink を残したまま実体に書く", () => {
  const root = tempDir();
  const targetRoot = tempDir();
  chmodSync(targetRoot, 0o755);
  const real = join(targetRoot, "real.json");
  const link = join(root, "link.json");
  writeFileSync(real, "{}\n");
  symlinkSync(real, link);
  saveConfig(defaultConfig(), link);
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(JSON.parse(readFileSync(real, "utf-8"))).toEqual(defaultConfig());
  expect(statSync(targetRoot).mode & 0o777).toBe(0o755);
  expect(statSync(real).mode & 0o777).toBe(0o600);
});

test("saveConfig は壊れた symlink を置き換えずに失敗する", () => {
  const root = tempDir();
  const real = join(root, "missing.json");
  const link = join(root, "link.json");
  symlinkSync(real, link);
  expect(() => saveConfig(defaultConfig(), link)).toThrow();
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(existsSync(real)).toBe(false);
});
