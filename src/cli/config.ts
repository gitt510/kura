// config.ts — config.json の表示・初期化と、1Password 参照の secrets.json への bake。

import { existsSync } from "node:fs";
import { configPath, defaultConfig, loadConfig, redactConfig, saveConfig } from "../lib/config.ts";
import { isSecretReference, secretsPath, writePrivateJson } from "../lib/secrets.ts";

type ConfigCommand = "config" | "init-config" | "bake-secrets";

// 既定値で埋めた実効値を JSON で出す。mod はこれを読み、補完・検証を kura に任せる。
function showConfig(): number {
  process.stdout.write(`${JSON.stringify(redactConfig(loadConfig()), null, 2)}\n`);
  return 0;
}

function initConfig(): number {
  const target = configPath();
  if (existsSync(target)) throw new Error(`already exists: ${target}`);
  saveConfig(defaultConfig(), target);
  process.stdout.write(`config initialized: ${target}\n`);
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
  if (command === "config") return showConfig();
  return command === "init-config" ? initConfig() : bakeSecrets();
}
