// lifecycle.ts — local entrypoint と kura-owned integration の setup / teardown。

import {
  lstatSync,
  mkdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";

type LifecycleCommand = "setup" | "teardown";

const repo = resolve(import.meta.dir, "../..");

function home(): string {
  const value = process.env.HOME;
  if (!value) throw new Error("HOME is required");
  return value;
}

function lstatOrNull(target: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function assertOwnedSymlink(target: string, expected: string, operation: string): void {
  const stat = lstatOrNull(target);
  if (!stat) return;
  if (!stat.isSymbolicLink() || readlinkSync(target) !== expected) {
    throw new Error(`refusing to ${operation} existing path: ${target}`);
  }
}

function runManager(
  script: string,
  args: string[],
  quiet = false,
): void {
  const result = Bun.spawnSync([process.execPath, script, ...args], {
    env: process.env,
    stdin: quiet ? "ignore" : "inherit",
    stdout: quiet ? "pipe" : "inherit",
    stderr: quiet ? "pipe" : "inherit",
  });
  if (result.exitCode !== 0) {
    const detail = result.stderr?.toString().trim();
    throw new Error(detail || `${script} failed`);
  }
}

function setup(): void {
  const userHome = home();
  const runtime = join(userHome, ".local", "share", "kura");
  const cli = join(userHome, ".local", "bin", "kura");
  const cliTarget = join(runtime, "src", "cli.ts");

  assertOwnedSymlink(runtime, repo, "replace");
  assertOwnedSymlink(cli, cliTarget, "replace");
  mkdirSync(join(userHome, ".local", "share"), { recursive: true });
  mkdirSync(join(userHome, ".local", "bin"), { recursive: true });
  if (!lstatOrNull(runtime)) symlinkSync(repo, runtime);
  if (!lstatOrNull(cli)) symlinkSync(cliTarget, cli);
  process.stdout.write(`kura is ready: ${cli}\n`);
}

function teardown(): void {
  const userHome = home();
  if (!Bun.which("launchctl")) throw new Error("launchctl is required");

  const runtime = join(userHome, ".local", "share", "kura");
  const cli = join(userHome, ".local", "bin", "kura");
  const cliTarget = join(runtime, "src", "cli.ts");
  assertOwnedSymlink(cli, cliTarget, "remove");
  assertOwnedSymlink(runtime, repo, "remove");

  const jobs = ["timeline", "english", "decisions"] as const;
  for (const job of jobs) {
    assertOwnedSymlink(
      join(userHome, "Library", "LaunchAgents", `kura.${job}.plist`),
      join(repo, "src", "launchd", `kura.${job}.plist`),
      "remove",
    );
  }

  const hooks = join(repo, "src", "history", "hooks.ts");
  const launchd = join(repo, "src", "launchd", "jobs.ts");
  const publish = join(repo, "src", "publish", "manage.ts");
  runManager(hooks, ["all", "status"], true);
  runManager(publish, ["all", "status"], true);

  runManager(publish, ["all", "disable"]);
  runManager(launchd, ["all", "disable"]);
  runManager(hooks, ["all", "disable"]);

  if (lstatOrNull(cli)) unlinkSync(cli);
  if (lstatOrNull(runtime)) unlinkSync(runtime);

  const stateDir = join(
    process.env.XDG_STATE_HOME || join(userHome, ".local", "state"),
    "kura",
  );
  const configDir = join(
    process.env.XDG_CONFIG_HOME || join(userHome, ".config"),
    "kura",
  );
  process.stdout.write("kura history sources, features, and local entrypoints removed\n");
  process.stdout.write(`retained state: ${stateDir}\n`);
  process.stdout.write(`retained config: ${configDir}\n`);
}

export async function runLifecycle(
  command: LifecycleCommand,
  args: string[],
): Promise<number> {
  if (args.length !== 0) {
    process.stderr.write(`usage: kura ${command}\n`);
    return 2;
  }
  if (command === "setup") setup();
  else teardown();
  return 0;
}
