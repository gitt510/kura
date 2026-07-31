// config.ts — kura 所有の設定値を process env → XDG config の順で解決する。

import { existsSync, readFileSync } from "node:fs";

type Environment = Readonly<Record<string, string | undefined>>;

export function envFilePath(env: Environment = process.env): string {
  const configHome = env.XDG_CONFIG_HOME || `${env.HOME ?? ""}/.config`;
  return `${configHome}/kura/env`;
}

function envFileValue(name: string, envFile: string): string | null {
  if (!existsSync(envFile)) return null;
  for (const line of readFileSync(envFile, "utf-8").split("\n")) {
    const match = line.match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.+?)\\s*$`));
    if (match) return match[1].replace(/^["']|["']$/g, "");
  }
  return null;
}

export function resolveEnv(name: string, env: Environment = process.env): string | null {
  const processValue = env[name];
  return processValue !== undefined ? processValue : envFileValue(name, envFilePath(env));
}
