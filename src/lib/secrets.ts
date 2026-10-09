// secrets.ts — 秘密 (Discord webhook) の扱い。config には "op://..." の 1Password 参照で書ける。
//
// 参照は `kura bake-secrets` が state 側の secrets.json に解決しておき、実行時はそこから引く —
// 定期実行が 1Password の sign-in に依存せず、実値が config にも shell にも出ない。
// 参照でない値はそのまま使う。

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { KURA_STATE_DIR } from "./storage.ts";

export function secretsPath(): string {
  return `${KURA_STATE_DIR}/secrets.json`;
}

export function isSecretReference(value: string): boolean {
  return value.startsWith("op://");
}

// 0600 で一時 file に書いてから rename する — 途中で落ちても壊れた file を残さない。
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
