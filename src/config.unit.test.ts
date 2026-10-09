import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, defaultConfig, loadConfig, redactConfig, saveConfig } from "./config.ts";

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

test("書かれていない項目は既定値で埋め、空文字は未設定として扱う", () => {
  const config = parseConfig(
    { generator: "codex", codex: { model: "gpt-5.6", effort: " " } },
    "config.json",
  );
  expect(config.generator).toBe("codex");
  expect(config.codex).toEqual({ model: "gpt-5.6", effort: null });
  expect(config.claude).toEqual({ model: null, effort: null });
  expect(config.redpen.model).toBe("opus");
  expect(config.tldr.model).toBe("opus");
  expect(parseConfig({ redpen: { model: "  " } }, "config.json").redpen.model).toBe("opus");
});

test("型の違う項目は path と項目名付きで拒否する", () => {
  expect(() => parseConfig({ claude: { model: 5 } }, "c.json")).toThrow(
    /^invalid config .*\/c\.json: claude\.model must be a string$/,
  );
  expect(() => parseConfig({ publish: { enabled: "timeline" } }, "c.json")).toThrow(
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

test("companion は既定で無効で閉じ、幅と高さは Claude Code に任せ、redpen / tldr を 4:6 で積む", () => {
  expect(parseConfig({}, "config.json").companion).toEqual({
    enabled: false,
    autoOpen: false,
    columns: null,
    rows: null,
    widgets: [
      { id: "redpen", share: 4 },
      { id: "tldr", share: 6 },
    ],
  });
  const config = parseConfig(
    {
      companion: {
        enabled: true,
        autoOpen: true,
        columns: 64,
        widgets: [{ id: "tldr", share: 1 }],
      },
    },
    "config.json",
  );
  expect(config.companion).toEqual({
    enabled: true,
    autoOpen: true,
    columns: 64,
    rows: null,
    widgets: [{ id: "tldr", share: 1 }],
  });
});

test("companion の不正な値は項目名付きで拒否する", () => {
  expect(() => parseConfig({ companion: { enabled: 1 } }, "c.json")).toThrow(
    "companion.enabled must be a boolean",
  );
  expect(() => parseConfig({ companion: { autoOpen: "yes" } }, "c.json")).toThrow(
    "companion.autoOpen must be a boolean",
  );
  expect(() => parseConfig({ companion: { columns: 0 } }, "c.json")).toThrow(
    "companion.columns must be a positive integer",
  );
  expect(() =>
    parseConfig({ companion: { widgets: [{ id: "tldr", share: 1.5 }] } }, "c.json"),
  ).toThrow("companion.widgets must be an array");
});

test("redactConfig は参照でない webhook だけを伏せる", () => {
  const config = defaultConfig();
  config.discord.webhooks = {
    english: "op://Dev/Discord/english/webhook",
    timeline: "https://discord.com/api/webhooks/1/secret",
  };
  expect(redactConfig(config).discord.webhooks).toEqual({
    english: "op://Dev/Discord/english/webhook",
    timeline: "<redacted>",
  });
  expect(config.discord.webhooks.timeline).toBe("https://discord.com/api/webhooks/1/secret");
});
