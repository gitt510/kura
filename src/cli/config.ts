// config.ts — config.json の表示と初期化。

import { existsSync } from "node:fs";
import { configPath, defaultConfig, loadConfig, saveConfig } from "../config.ts";

type ConfigCommand = "config" | "init-config";

// 既定値で埋めた実効値を JSON で出す。mod はこれを読み、補完・検証を kura に任せる。
function showConfig(): number {
  process.stdout.write(`${JSON.stringify(loadConfig(), null, 2)}\n`);
  return 0;
}

function initConfig(): number {
  const target = configPath();
  if (existsSync(target)) throw new Error(`already exists: ${target}`);
  saveConfig(defaultConfig(), target);
  process.stdout.write(`config initialized: ${target}\n`);
  return 0;
}

export async function runConfig(command: ConfigCommand, args: string[]): Promise<number> {
  if (args.length !== 0) {
    process.stderr.write(`usage: kura ${command}\n`);
    return 2;
  }
  if (command === "config") return showConfig();
  return initConfig();
}
