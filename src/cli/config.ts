// config.ts — config.json の初期化 (旧 env / publish.json からの移行を含む) と、
// 1Password 参照の secrets.json への bake。

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  configPath,
  defaultConfig,
  isSecretReference,
  type KuraConfig,
  loadConfig,
  parseConfig,
  saveConfig,
  secretsPath,
  writePrivateJson,
} from "../lib/config.ts";

type ConfigCommand = "init-config" | "bake-secrets";

const repo = resolve(import.meta.dir, "../..");

function parseEnvText(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const [, name, raw] = line.match(/^\s*(?:export\s+)?(KURA_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/) ?? [];
    const value = raw?.replace(/^["']|["']$/g, "");
    if (name && value) values.set(name, value);
  }
  return values;
}

// 旧 ~/.config/kura/env の値・repo の .env.ref の 1Password 参照・publish.json から
// config を組み立てる。webhook は参照があれば実値より参照を採る (実値を config に書かない)。
// 対応先の無い KURA_* 名は dropped で返す。
export function fromLegacy(legacy: {
  env: string | null;
  ref: string | null;
  publish: string | null;
}): { config: KuraConfig; dropped: string[] } {
  const config = defaultConfig();
  const env = parseEnvText(legacy.env ?? "");
  for (const [name, value] of parseEnvText(legacy.ref ?? "")) {
    if (isSecretReference(value)) env.set(name, value);
  }

  const dropped: string[] = [];
  for (const [name, value] of env) {
    const webhook = name.match(/^KURA_DISCORD_WEBHOOK_(ENGLISH|TIMELINE)$/)?.[1];
    const avatar = name.match(/^KURA_DISCORD_AVATAR_([A-Z0-9_]+)$/)?.[1];
    if (name === "KURA_GENERATOR") config.generator = value;
    else if (name === "KURA_CLAUDE_MODEL") config.claude.model = value;
    else if (name === "KURA_CLAUDE_EFFORT") config.claude.effort = value;
    else if (name === "KURA_CODEX_MODEL") config.codex.model = value;
    else if (name === "KURA_CODEX_EFFORT") config.codex.effort = value;
    else if (name === "KURA_COMPANION_MODEL") config.companion.model = value;
    else if (webhook) config.discord.webhooks[webhook.toLowerCase()] = value;
    else if (avatar) config.discord.avatars[avatar.toLowerCase()] = value;
    else dropped.push(name);
  }

  if (legacy.publish) {
    const parsed = JSON.parse(legacy.publish) as { enabled?: unknown };
    if (Array.isArray(parsed.enabled)) {
      config.publish.enabled = parsed.enabled.filter((v): v is string => typeof v === "string");
    }
  }
  return { config: parseConfig(config, "migrated config"), dropped };
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

function initConfig(): number {
  const target = configPath();
  if (existsSync(target)) throw new Error(`already exists: ${target}`);

  const legacyEnv = join(dirname(target), "env");
  const legacyPublish = join(dirname(target), "publish.json");
  const legacyRef = join(repo, ".env.ref");
  const found = [legacyEnv, legacyRef, legacyPublish].filter((path) => existsSync(path));
  const { config, dropped } = fromLegacy({
    env: readIfExists(legacyEnv),
    ref: readIfExists(legacyRef),
    publish: readIfExists(legacyPublish),
  });
  saveConfig(config, target);

  process.stdout.write(`config initialized: ${target}\n`);
  if (found.length > 0) {
    process.stdout.write(`migrated from: ${found.join(", ")}\n`);
    if (dropped.length > 0) process.stdout.write(`not migrated (unknown): ${dropped.join(", ")}\n`);
    process.stdout.write(`check the result, then remove the old files: rm ${found.join(" ")}\n`);
  }
  if (Object.values(config.discord.webhooks).some(isSecretReference)) {
    process.stdout.write("webhooks are 1Password references — run: just bake-secrets\n");
  }
  return 0;
}

function bakeSecrets(): number {
  const references = Object.values(loadConfig().discord.webhooks).filter(isSecretReference);
  if (references.length === 0) {
    throw new Error(`no op:// reference in ${configPath()} — nothing to bake`);
  }
  const baked: Record<string, string> = {};
  for (const reference of references) {
    const result = Bun.spawnSync(["op", "read", "--no-newline", reference], {
      stdin: "inherit",
      stdout: "pipe",
      stderr: "inherit",
    });
    if (result.exitCode !== 0) return result.exitCode ?? 1;
    baked[reference] = result.stdout.toString();
  }
  writePrivateJson(secretsPath(), baked);
  process.stdout.write(`secrets baked: ${secretsPath()} (${references.length})\n`);
  return 0;
}

export async function runConfig(command: ConfigCommand, args: string[]): Promise<number> {
  if (args.length !== 0) {
    process.stderr.write(`usage: kura ${command}\n`);
    return 2;
  }
  return command === "init-config" ? initConfig() : bakeSecrets();
}
