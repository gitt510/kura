// config.ts — kura の設定の正本 ~/.config/kura/config.json の読み書き窓口。
//
// 設定は環境変数から読まない — ファイルに書いた値と実際の動きを一致させるため。
// 置き場所だけは XDG 規約 (XDG_CONFIG_HOME) に従う。file が無ければ既定値で動く。
//
// 秘密 (Discord webhook) は "op://..." の 1Password 参照で書ける。参照は
// `kura bake-secrets` が state 側の secrets.json に解決しておき、実行時はそこから引く —
// 定期実行が 1Password の sign-in に依存せず、実値が config にも shell にも出ない。
// 参照でない値はそのまま使う。

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { KURA_STATE_DIR } from "./storage.ts";

type Environment = Readonly<Record<string, string | undefined>>;

export interface AgentConfig {
  model: string | null;
  effort: string | null;
}

// generator / effort の値の妥当性は使う側 (lib/agent.ts) が検証する。ここは形だけ。
export interface KuraConfig {
  generator: string;
  claude: AgentConfig;
  codex: AgentConfig;
  companion: { model: string };
  discord: {
    webhooks: Record<string, string>; // feature 名 → URL または op:// 参照
    avatars: Record<string, string>; // model family (小文字) → 画像 URL
  };
  publish: { enabled: string[] };
}

export function defaultConfig(): KuraConfig {
  return {
    generator: "claude",
    claude: { model: null, effort: null },
    codex: { model: null, effort: null },
    companion: { model: "opus" },
    discord: { webhooks: {}, avatars: {} },
    publish: { enabled: [] },
  };
}

function configHome(env: Environment): string {
  const home = env.XDG_CONFIG_HOME || (env.HOME ? `${env.HOME}/.config` : "");
  if (!home) throw new Error("HOME is required");
  return home;
}

export function configPath(env: Environment = process.env): string {
  return `${configHome(env)}/kura/config.json`;
}

export function secretsPath(): string {
  return `${KURA_STATE_DIR}/secrets.json`;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function section(raw: Json, key: string, path: string): Json {
  const value = raw[key];
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error(`invalid config ${path}: ${key} must be an object`);
  return value;
}

function stringOrNull(value: unknown, field: string, path: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string")
    throw new Error(`invalid config ${path}: ${field} must be a string`);
  return value.trim() || null;
}

function stringMap(value: unknown, field: string, path: string): Record<string, string> {
  if (value === undefined) return {};
  if (!isObject(value) || !Object.values(value).every((v) => typeof v === "string")) {
    throw new Error(`invalid config ${path}: ${field} must map names to strings`);
  }
  return value as Record<string, string>;
}

function agentSection(raw: Json, key: string, path: string): AgentConfig {
  const value = section(raw, key, path);
  return {
    model: stringOrNull(value.model, `${key}.model`, path),
    effort: stringOrNull(value.effort, `${key}.effort`, path),
  };
}

// 書かれていない項目は既定値で埋める。型が違う項目は path と項目名を付けて拒否する。
export function parseConfig(raw: unknown, path: string): KuraConfig {
  if (!isObject(raw)) throw new Error(`invalid config ${path}: must be a JSON object`);
  const defaults = defaultConfig();
  const discord = section(raw, "discord", path);
  const enabled = section(raw, "publish", path).enabled ?? [];
  if (!Array.isArray(enabled) || !enabled.every((v) => typeof v === "string")) {
    throw new Error(`invalid config ${path}: publish.enabled must be an array of strings`);
  }
  return {
    generator: stringOrNull(raw.generator, "generator", path) ?? defaults.generator,
    claude: agentSection(raw, "claude", path),
    codex: agentSection(raw, "codex", path),
    companion: {
      model:
        stringOrNull(section(raw, "companion", path).model, "companion.model", path) ??
        defaults.companion.model,
    },
    discord: {
      webhooks: stringMap(discord.webhooks, "discord.webhooks", path),
      avatars: stringMap(discord.avatars, "discord.avatars", path),
    },
    publish: { enabled },
  };
}

export function loadConfig(path: string = configPath()): KuraConfig {
  if (!existsSync(path)) return defaultConfig();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    throw new Error(`cannot parse ${path}: ${error}`);
  }
  return parseConfig(raw, path);
}

// 0600 で一時 file に書いてから rename する — 途中で落ちても壊れた config を残さない。
export function writePrivateJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    chmodSync(dirname(path), 0o700);
  } catch {
    /* filesystem may not support POSIX permissions */
  }
  const temp = `${path}.kura-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    /* filesystem may not support POSIX permissions */
  }
}

export function saveConfig(config: KuraConfig, path: string = configPath()): void {
  writePrivateJson(path, config);
}

export function isSecretReference(value: string): boolean {
  return value.startsWith("op://");
}

// webhook などの値を実値にする。op:// 参照は bake 済みの secrets.json から引く。
export function resolveSecret(
  value: string | undefined,
  cache: string = secretsPath(),
): string | null {
  if (!value) return null;
  if (!isSecretReference(value)) return value;
  let baked: Record<string, unknown> = {};
  if (existsSync(cache)) {
    try {
      baked = JSON.parse(readFileSync(cache, "utf-8"));
    } catch (error) {
      throw new Error(`cannot parse ${cache}: ${error}`);
    }
  }
  const resolved = baked[value];
  if (typeof resolved !== "string" || !resolved) {
    throw new Error(`${value} is not baked — run: just bake-secrets`);
  }
  return resolved;
}
