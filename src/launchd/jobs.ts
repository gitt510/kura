#!/usr/bin/env bun
// jobs.ts — kura の scheduled job と launchd plist の配線を個別に管理する。

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

type Job = "timeline" | "english" | "briefing" | "decisions";
type Action = "enable" | "disable" | "status" | "check";

const jobs = ["timeline", "english", "briefing", "decisions"] as const;
const actions = ["enable", "disable", "status", "check"] as const;
const home = process.env.HOME;

function usageError(): never {
  process.stderr.write(
    "usage: bun jobs.ts <timeline|english|briefing|decisions> <enable|disable|status|check>\n" +
      "       bun jobs.ts all <disable|status>\n",
  );
  process.exit(2);
}

function runtimeError(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function isMember<T extends string>(values: readonly T[], value: string | undefined): value is T {
  return value !== undefined && values.includes(value as T);
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function runLaunchctl(args: string[], allowFailure = false): boolean {
  const result = Bun.spawnSync(["launchctl", ...args]);
  if (result.exitCode === 0) return true;
  if (allowFailure) return false;
  const detail = result.stderr.toString().trim();
  runtimeError(detail || `launchctl ${args[0]} failed`);
}

if (!home) runtimeError("HOME is required");

function manage(job: Job, action: Action): number {
  const label = `kura.${job}`;
  const source = join(import.meta.dir, `${label}.plist`);
  const agentsDir = join(home, "Library", "LaunchAgents");
  const target = join(agentsDir, `${label}.plist`);

  if (action === "status" || action === "check") {
    const enabled = runLaunchctl(["list", label], true);
    process.stdout.write(`${job}: ${enabled ? "enabled" : "disabled"}\n`);
    return action === "status" || enabled ? 0 : 1;
  }

  if (action === "disable") {
    runLaunchctl(["unload", target], true);
    if (pathExists(target)) {
      const stat = lstatSync(target);
      if (!stat.isSymbolicLink()) runtimeError(`refusing to remove existing path: ${target}`);
      unlinkSync(target);
    }
    process.stdout.write(`${job} generation disabled\n`);
    return 0;
  }

  const runtime = join(home, ".local", "share", "kura");
  if (!pathExists(runtime) || !lstatSync(runtime).isSymbolicLink()) {
    runtimeError("run: just setup");
  }
  if (!existsSync(source)) runtimeError(`job plist not found: ${source}`);

  mkdirSync(agentsDir, { recursive: true });
  if (pathExists(target)) {
    const stat = lstatSync(target);
    if (!stat.isSymbolicLink()) runtimeError(`refusing to replace existing path: ${target}`);
    if (readlinkSync(target) !== source) unlinkSync(target);
  }
  if (!pathExists(target)) symlinkSync(source, target);

  runLaunchctl(["unload", target], true);
  runLaunchctl(["load", target]);
  process.stdout.write(`${job} generation enabled\n`);
  return 0;
}

const [targetArg, actionArg, extra] = process.argv.slice(2);
if (extra !== undefined || !isMember(actions, actionArg)) usageError();
if (targetArg === "all") {
  if (actionArg !== "disable" && actionArg !== "status") usageError();
} else if (!isMember(jobs, targetArg)) {
  usageError();
}

const targets: readonly Job[] = targetArg === "all" ? jobs : [targetArg];
let exitCode = 0;
for (const job of targets) {
  if (manage(job, actionArg) !== 0) exitCode = 1;
}
process.exit(exitCode);
