// status.ts — setup state の収集と rich 表示。

import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { configPath } from "../config.ts";
import { paint, type Row, renderTable, stateColor } from "./terminal.ts";

type State =
  | "READY"
  | "PRESENT"
  | "ENABLED"
  | "DISABLED"
  | "NOT CREATED"
  | "MISSING"
  | "UNEXPECTED"
  | "ERROR";

const repo = resolve(import.meta.dir, "../..");

function home(): string {
  const value = process.env.HOME;
  if (!value) throw new Error("HOME is required");
  return value;
}

function displayPath(target: string): string {
  const userHome = home();
  return target === userHome
    ? "~"
    : target.startsWith(`${userHome}/`)
      ? `~/${target.slice(userHome.length + 1)}`
      : target;
}

function lstatOrNull(target: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function symlinkState(target: string, expected: string): State {
  const stat = lstatOrNull(target);
  if (!stat) return "MISSING";
  return stat.isSymbolicLink() && readlinkSync(target) === expected ? "READY" : "UNEXPECTED";
}

function managerState(script: string, target: string): State {
  const result = Bun.spawnSync([process.execPath, script, target, "status"], {
    env: process.env,
  });
  if (result.exitCode !== 0) return "ERROR";
  const match = result.stdout.toString().match(new RegExp(`^${target}: (enabled|disabled)$`, "m"));
  if (match?.[1] === "enabled") return "ENABLED";
  if (match?.[1] === "disabled") return "DISABLED";
  return "ERROR";
}

function tableCell(padded: string, raw: string, _rowIndex: number, columnIndex: number): string {
  if (columnIndex > 0) return stateColor(raw, padded);
  return padded;
}

function renderStatus(): number {
  const userHome = home();
  const stateDir = join(process.env.XDG_STATE_HOME || join(userHome, ".local", "state"), "kura");
  const runtime = join(userHome, ".local", "share", "kura");
  const cli = join(userHome, ".local", "bin", "kura");
  const cliTarget = join(runtime, "src", "cli.ts");
  const hooks = join(repo, "src", "store", "hooks.ts");
  const kuraDb = join(stateDir, "kura.db");
  const config = configPath();

  const setupRows: Row[] = [
    ["runtime", symlinkState(runtime, repo), displayPath(runtime)],
    ["cli", symlinkState(cli, cliTarget), displayPath(cli)],
    ["config", existsSync(config) ? "PRESENT" : "MISSING", displayPath(config)],
    ["kura.db", existsSync(kuraDb) ? "PRESENT" : "NOT CREATED", displayPath(kuraDb)],
    ["claude", managerState(hooks, "claude"), "Stop + UserPromptSubmit hooks"],
    ["codex", managerState(hooks, "codex"), "Stop hook"],
  ];

  process.stdout.write(`${paint.bold("Setup")}\n`);
  process.stdout.write(
    `${renderTable(["Component", "State", "Detail"], setupRows, (cell, raw, row, column) =>
      column === 2 ? paint.dim(cell) : tableCell(cell, raw, row, column),
    )}\n`,
  );
  return 0;
}

export function runStatus(args: string[]): number {
  if (args.length !== 0) {
    process.stderr.write("usage: kura status\n");
    return 2;
  }
  return renderStatus();
}
