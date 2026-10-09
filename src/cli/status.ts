// status.ts — setup / feature state の収集と rich 表示。

import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { configPath } from "../config.ts";
import { resolveClaudeOptions, resolveCodexOptions, resolveGenerator } from "../lib/agent.ts";
import { isPublishEnabled, type PublishFeature } from "../lib/publish-policy.ts";
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

function runtimeSummary(): {
  generator: string;
  model: string;
  effort: string;
  source: string;
} {
  const generator = resolveGenerator();
  const options = generator === "claude" ? resolveClaudeOptions() : resolveCodexOptions();
  return {
    generator,
    model: options.model ?? "CLI default",
    effort: options.effort ?? "CLI default",
    source: existsSync(configPath()) ? "config" : "default",
  };
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

  try {
    const selected = runtimeSummary();
    process.stdout.write(
      `${paint.bold("Features")}  ${paint.cyan(selected.generator)} · ` +
        `${paint.cyan(selected.model)} · ${paint.cyan(selected.effort)}  ` +
        `${paint.dim(`(${selected.source})`)}\n`,
    );
  } catch (error) {
    process.stdout.write(
      `${paint.bold("Features")}  ${paint.red("RUNTIME ERROR")}  ` +
        `${paint.dim(error instanceof Error ? error.message : String(error))}\n`,
    );
  }

  const featureRows: Row[] = [
    [
      "timeline",
      databaseState(stateDir, "timeline"),
      managerState(jobs, "timeline"),
      publishState("timeline"),
    ],
    [
      "english",
      databaseState(stateDir, "english"),
      managerState(jobs, "english"),
      publishState("english"),
    ],
  ];
  process.stdout.write(
    `${renderTable(["Feature", "Database", "Schedule", "Publish"], featureRows, tableCell)}\n`,
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
