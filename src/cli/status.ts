// status.ts — setup / feature state の収集と rich 表示。

import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveGeneration } from "../agent/run.ts";
import { configPath, loadConfig } from "../config.ts";
import { isPublishEnabled, type PublishFeature } from "../publish/policy.ts";
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

function publishState(feature: PublishFeature): State {
  try {
    return isPublishEnabled(feature) ? "ENABLED" : "DISABLED";
  } catch {
    return "ERROR";
  }
}

function databaseState(stateDir: string, feature: string): State {
  return existsSync(join(stateDir, `${feature}.db`)) ? "PRESENT" : "NOT CREATED";
}

// feature の生成設定を 1 cell に: `codex · gpt-5.6 · high`。null は CLI の既定。
function generationState(feature: PublishFeature): string {
  try {
    const { agent, options } = resolveGeneration(feature, loadConfig().features[feature]);
    return `${agent} · ${options.model ?? "CLI default"} · ${options.effort ?? "CLI default"}`;
  } catch {
    return "ERROR";
  }
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
  const hooks = join(repo, "src", "history", "hooks.ts");
  const jobs = join(repo, "src", "launchd", "jobs.ts");
  const historyDb = join(stateDir, "history.db");
  const config = configPath();

  const setupRows: Row[] = [
    ["runtime", symlinkState(runtime, repo), displayPath(runtime)],
    ["cli", symlinkState(cli, cliTarget), displayPath(cli)],
    ["config", existsSync(config) ? "PRESENT" : "MISSING", displayPath(config)],
    ["history.db", existsSync(historyDb) ? "PRESENT" : "NOT CREATED", displayPath(historyDb)],
    ["history/claude", managerState(hooks, "claude"), "Stop + UserPromptSubmit hooks"],
    ["history/codex", managerState(hooks, "codex"), "Stop hook"],
  ];

  process.stdout.write(`${paint.bold("Setup")}\n`);
  process.stdout.write(
    `${renderTable(["Component", "State", "Detail"], setupRows, (cell, raw, row, column) =>
      column === 2 ? paint.dim(cell) : tableCell(cell, raw, row, column),
    )}\n\n`,
  );

  const featureRows: Row[] = [
    [
      "timeline",
      generationState("timeline"),
      databaseState(stateDir, "timeline"),
      managerState(jobs, "timeline"),
      publishState("timeline"),
    ],
    [
      "english",
      generationState("english"),
      databaseState(stateDir, "english"),
      managerState(jobs, "english"),
      publishState("english"),
    ],
  ];
  process.stdout.write(
    `${renderTable(["Feature", "Agent", "Database", "Schedule", "Publish"], featureRows, tableCell)}\n`,
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
