// status.ts — setup / feature state の収集、rich 表示、doctor、DB viewer。

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  resolveClaudeOptions,
  resolveCodexOptions,
  resolveGenerator,
} from "../lib/agent.ts";
import { envFilePath } from "../lib/config.ts";
import {
  isPublishEnabled,
  type PublishFeature,
} from "../lib/publish-policy.ts";
import { paint, renderTable, stateColor, type Row } from "./terminal.ts";

type OperationsCommand = "status" | "doctor" | "view-db";
type State =
  | "READY"
  | "PRESENT"
  | "ENABLED"
  | "DISABLED"
  | "NOT CREATED"
  | "MISSING"
  | "UNEXPECTED"
  | "ERROR";
type Source = "process env" | "config" | "default";

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
  return stat.isSymbolicLink() && readlinkSync(target) === expected
    ? "READY"
    : "UNEXPECTED";
}

function managerState(script: string, target: string): State {
  const result = Bun.spawnSync([process.execPath, script, target, "status"], {
    env: process.env,
  });
  if (result.exitCode !== 0) return "ERROR";
  const match = result.stdout.toString().match(
    new RegExp(`^${target}: (enabled|disabled)$`, "m"),
  );
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

function sourceOf(name: string): Source {
  if (process.env[name]) return "process env";
  const configFile = envFilePath();
  if (!existsSync(configFile)) return "default";
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.+?)\\s*$`, "m");
  return pattern.test(readFileSync(configFile, "utf-8")) ? "config" : "default";
}

function runtimeSummary(): {
  generator: string;
  model: string;
  effort: string;
  source: string;
} {
  const generator = resolveGenerator();
  const options =
    generator === "claude" ? resolveClaudeOptions() : resolveCodexOptions();
  const prefix = generator === "claude" ? "KURA_CLAUDE" : "KURA_CODEX";
  const sources = new Set<Source>([
    sourceOf("KURA_GENERATOR"),
    sourceOf(`${prefix}_MODEL`),
    sourceOf(`${prefix}_EFFORT`),
  ]);
  return {
    generator,
    model: options.model ?? "CLI default",
    effort: options.effort ?? "CLI default",
    source: [...sources].join(" + "),
  };
}

function tableCell(
  padded: string,
  raw: string,
  _rowIndex: number,
  columnIndex: number,
): string {
  if (columnIndex > 0) return stateColor(raw, padded);
  return padded;
}

function renderStatus(): number {
  const userHome = home();
  const stateDir = join(
    process.env.XDG_STATE_HOME || join(userHome, ".local", "state"),
    "kura",
  );
  const runtime = join(userHome, ".local", "share", "kura");
  const cli = join(userHome, ".local", "bin", "kura");
  const cliTarget = join(runtime, "src", "cli.ts");
  const hooks = join(repo, "src", "history", "hooks.ts");
  const jobs = join(repo, "src", "launchd", "jobs.ts");
  const historyDb = join(stateDir, "history.db");
  const environment = envFilePath();

  const setupRows: Row[] = [
    ["cli", symlinkState(cli, cliTarget), displayPath(cli)],
    [
      "env",
      existsSync(environment) ? "PRESENT" : "MISSING",
      displayPath(environment),
    ],
    [
      "history.db",
      existsSync(historyDb) ? "PRESENT" : "NOT CREATED",
      displayPath(historyDb),
    ],
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
    [
      "decisions",
      databaseState(stateDir, "decisions"),
      managerState(jobs, "decisions"),
      "-",
    ],
  ];
  process.stdout.write(
    `${renderTable(
      ["Feature", "Database", "Schedule", "Publish"],
      featureRows,
      tableCell,
    )}\n`,
  );
  return 0;
}

function renderDoctor(): number {
  const userHome = home();
  const runtime = join(userHome, ".local", "share", "kura");
  const cli = join(userHome, ".local", "bin", "kura");
  const stateDir = join(
    process.env.XDG_STATE_HOME || join(userHome, ".local", "state"),
    "kura",
  );
  const rows: Row[] = [
    ["bun", "READY", process.execPath],
    ["runtime", symlinkState(runtime, repo), displayPath(runtime)],
    ["cli", symlinkState(cli, join(runtime, "src", "cli.ts")), displayPath(cli)],
    ["state", existsSync(stateDir) ? "PRESENT" : "NOT CREATED", displayPath(stateDir)],
  ];
  process.stdout.write(`${paint.bold("Doctor")}\n`);
  process.stdout.write(
    `${renderTable(["Component", "State", "Detail"], rows, (cell, raw, row, column) =>
      column === 2 ? paint.dim(cell) : tableCell(cell, raw, row, column),
    )}\n`,
  );
  const healthy = rows.slice(0, 3).every((row) => row[1] === "READY");
  process.stdout.write(
    `\n${healthy ? paint.green(paint.bold("HEALTHY")) : paint.red(paint.bold("NEEDS SETUP"))}\n`,
  );
  return healthy ? 0 : 1;
}

async function viewDatabase(): Promise<number> {
  const executable = Bun.which("uvx");
  if (!executable) throw new Error("uvx not found — install uv: https://docs.astral.sh/uv/");
  const stateDir = join(
    process.env.XDG_STATE_HOME || join(home(), ".local", "state"),
    "kura",
  );
  const databases = existsSync(stateDir)
    ? readdirSync(stateDir)
        .filter((name) => name.endsWith(".db"))
        .sort()
        .map((name) => join(stateDir, name))
    : [];
  if (databases.length === 0) throw new Error(`no DB found in ${stateDir}`);
  process.stdout.write(
    `opening ${databases.length} db(s) in Datasette (Ctrl-C to stop)\n`,
  );
  const child = Bun.spawn([executable, "datasette", "--open", ...databases], {
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await child.exited;
}

export async function runOperations(
  command: OperationsCommand,
  args: string[],
): Promise<number> {
  if (args.length !== 0) {
    process.stderr.write(`usage: kura ${command}\n`);
    return 2;
  }
  if (command === "status") return renderStatus();
  if (command === "doctor") return renderDoctor();
  return await viewDatabase();
}
