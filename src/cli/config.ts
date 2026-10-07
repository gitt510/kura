// config.ts — config.json の初期化と、1Password 参照の secrets.json への bake。

import { existsSync } from "node:fs";
import {
  configPath,
  defaultConfig,
  isSecretReference,
  loadConfig,
  saveConfig,
  secretsPath,
  writePrivateJson,
} from "../lib/config.ts";

type ConfigCommand = "init-config" | "bake-secrets";

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
  return command === "init-config" ? initConfig() : bakeSecrets();
}
