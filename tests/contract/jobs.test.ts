import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "..", "..");
const script = join(repo, "src", "launchd", "jobs.ts");
let home = "";
let bin = "";
let log = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kura-jobs-"));
  bin = join(home, "bin");
  log = join(home, "launchctl.log");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(home, ".local", "share"), { recursive: true });
  symlinkSync(repo, join(home, ".local", "share", "kura"));

  const launchctl = join(bin, "launchctl");
  writeFileSync(
    launchctl,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$KURA_TEST_LAUNCHCTL_LOG"
if [ "$1" = "list" ]; then
  [ "\${KURA_TEST_ENABLED:-}" = "$2" ]
  exit
fi
exit 0
`,
  );
  chmodSync(launchctl, 0o755);
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

function run(job: string, action: string, enabled = "") {
  return Bun.spawnSync([process.execPath, script, job, action], {
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      KURA_TEST_LAUNCHCTL_LOG: log,
      KURA_TEST_ENABLED: enabled,
    },
  });
}

test("job は対象の plist だけを enable / disable する", () => {
  const target = join(home, "Library", "LaunchAgents", "kura.timeline.plist");
  const source = join(repo, "src", "launchd", "kura.timeline.plist");

  expect(run("timeline", "enable").exitCode).toBe(0);
  expect(lstatSync(target).isSymbolicLink()).toBe(true);
  expect(readlinkSync(target)).toBe(source);
  expect(readFileSync(log, "utf-8")).toBe(`unload ${target}\nload ${target}\n`);

  expect(run("timeline", "disable").exitCode).toBe(0);
  expect(() => lstatSync(target)).toThrow();
  expect(readFileSync(log, "utf-8")).toEndWith(`unload ${target}\n`);
});

test("job status は disabled でも成功し、check は状態を exit code にする", () => {
  const enabled = run("english", "status", "kura.english");
  expect(enabled.exitCode).toBe(0);
  expect(enabled.stdout.toString()).toBe("english: enabled\n");

  const disabled = run("english", "status");
  expect(disabled.exitCode).toBe(0);
  expect(disabled.stdout.toString()).toBe("english: disabled\n");
  expect(run("english", "check").exitCode).toBe(1);
});

test("job は未知の action と job を拒否する", () => {
  for (const args of [
    ["unknown", "enable"],
    ["timeline", "unknown"],
  ]) {
    const result = run(args[0]!, args[1]!);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain(
      "jobs.ts <timeline|english|decisions>",
    );
  }
});

test("all は全 job を status / disable し、enable は拒否する", () => {
  expect(run("timeline", "enable").exitCode).toBe(0);
  expect(run("english", "enable").exitCode).toBe(0);

  const status = run("all", "status", "kura.timeline");
  expect(status.exitCode).toBe(0);
  expect(status.stdout.toString()).toBe(
    "timeline: enabled\nenglish: disabled\ndecisions: disabled\n",
  );

  expect(run("all", "enable").exitCode).toBe(2);
  expect(run("all", "disable").exitCode).toBe(0);
  for (const job of ["timeline", "english"]) {
    expect(() =>
      lstatSync(join(home, "Library", "LaunchAgents", `kura.${job}.plist`)),
    ).toThrow();
  }
});

test("job enable は既存の通常 file を上書きしない", () => {
  const target = join(home, "Library", "LaunchAgents", "kura.decisions.plist");
  mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
  writeFileSync(target, "keep");

  const result = run("decisions", "enable");
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("refusing to replace existing path");
  expect(readFileSync(target, "utf-8")).toBe("keep");
});
