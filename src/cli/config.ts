// config.ts — XDG config の初期化と 1Password materialization。

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

type ConfigCommand = "init-env" | "bake-env";

const repo = resolve(import.meta.dir, "../..");

function home(): string {
  const value = process.env.HOME;
  if (!value) throw new Error("HOME is required");
  return value;
}

function configTarget(): string {
  const configHome = process.env.XDG_CONFIG_HOME || join(home(), ".config");
  return join(configHome, "kura", "env");
}

export async function runConfig(command: ConfigCommand, args: string[]): Promise<number> {
  if (args.length !== 0) {
    process.stderr.write(`usage: kura ${command}\n`);
    return 2;
  }

  const target = configTarget();
  if (command === "init-env") {
    if (existsSync(target)) throw new Error(`already exists: ${target}`);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    copyFileSync(join(repo, ".env.example"), target);
    chmodSync(target, 0o600);
    process.stdout.write(`config initialized: ${target}\n`);
    process.stdout.write("edit the file and set the Discord webhook URLs\n");
    return 0;
  }

  const reference = join(repo, ".env.ref");
  if (!existsSync(reference)) {
    throw new Error(
      ".env.ref not found — run: cp .env.ref.example .env.ref, then edit the references",
    );
  }
  if (!/^[ \t]*[^#\s].*op:\/\//m.test(readFileSync(reference, "utf-8"))) {
    throw new Error(".env.ref has no valid op:// reference — aborting bake");
  }
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const result = Bun.spawnSync(["op", "inject", "-i", reference, "-o", target, "-f"], {
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) return result.exitCode ?? 1;
  chmodSync(target, 0o600);
  process.stdout.write(`config baked: ${target}\n`);
  return 0;
}
