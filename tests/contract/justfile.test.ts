import { expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "..", "..");
const justfile = join(repo, "justfile");

function dryRun(...args: string[]) {
  return Bun.spawnSync(["just", "--justfile", justfile, "--dry-run", ...args]);
}

function output(result: ReturnType<typeof dryRun>): string {
  return result.stdout.toString() + result.stderr.toString();
}

test("just は setup group に記録の enable / disable を公開する", () => {
  expect(output(dryRun("enable", "claude"))).toContain('src/cli.ts" enable "claude"');
  expect(output(dryRun("disable", "codex"))).toContain('src/cli.ts" disable "codex"');
});

test("just の default recipe は非公開で recipe 一覧を返す", () => {
  const result = Bun.spawnSync(["just", "--justfile", justfile]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("enable agent");
  expect(result.stdout.toString()).toContain("disable agent");
  expect(result.stdout.toString()).toContain("[setup]");
  expect(result.stdout.toString()).toContain("[operations]");
  expect(result.stdout.toString()).not.toContain("[automation]");
  expect(result.stdout.toString()).not.toContain("[cli]");
  expect(result.stdout.toString()).not.toContain("[generation]");
  expect(result.stdout.toString()).not.toContain("_default");
});

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "kura-justfile-"));
}

function runWithHome(home: string, ...args: string[]) {
  return Bun.spawnSync(["just", "--justfile", justfile, ...args], {
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_STATE_HOME: join(home, "state"),
    },
  });
}

test("setup は local entrypoint だけを作成する", () => {
  const home = tempHome();
  const runtime = join(home, ".local", "share", "kura");
  const cli = join(home, ".local", "bin", "kura");
  try {
    expect(runWithHome(home, "setup").exitCode).toBe(0);
    expect(readlinkSync(runtime)).toBe(repo);
    expect(readlinkSync(cli)).toBe(join(runtime, "src", "cli.ts"));
    expect(existsSync(join(home, "state", "kura"))).toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("teardown は記録の hook と entrypoint を除去し、data を残す", () => {
  const home = tempHome();
  const runtime = join(home, ".local", "share", "kura");
  const cli = join(home, ".local", "bin", "kura");
  const stateDir = join(home, "state", "kura");
  const configDir = join(home, ".config", "kura");
  const claudeSettings = join(home, ".claude", "settings.json");
  try {
    expect(runWithHome(home, "setup").exitCode).toBe(0);
    expect(runWithHome(home, "enable", "claude").exitCode).toBe(0);

    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "kura.db"), "data");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), "{}");

    const result = runWithHome(home, "teardown");
    expect(result.exitCode).toBe(0);
    expect(() => lstatSync(runtime)).toThrow();
    expect(() => lstatSync(cli)).toThrow();
    expect(readFileSync(claudeSettings, "utf-8")).not.toContain(".local/bin/kura");
    expect(readFileSync(join(configDir, "config.json"), "utf-8")).toBe("{}");
    expect(readFileSync(join(stateDir, "kura.db"), "utf-8")).toBe("data");
    expect(output(result)).toContain(`retained state: ${stateDir}`);
    expect(output(result)).toContain(`retained config: ${configDir}`);

    expect(runWithHome(home, "teardown").exitCode).toBe(0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("teardown は ownership の preflight に失敗したら何も停止しない", () => {
  const home = tempHome();
  const runtime = join(home, ".local", "share", "kura");
  const cli = join(home, ".local", "bin", "kura");
  const claudeSettings = join(home, ".claude", "settings.json");
  try {
    expect(runWithHome(home, "setup").exitCode).toBe(0);
    expect(runWithHome(home, "enable", "claude").exitCode).toBe(0);
    rmSync(cli);
    writeFileSync(cli, "foreign");

    const result = runWithHome(home, "teardown");
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain(`refusing to remove existing path: ${cli}`);
    expect(readlinkSync(runtime)).toBe(repo);
    expect(readFileSync(claudeSettings, "utf-8")).toContain(".local/bin/kura");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("status は setup を表形式で表示する", () => {
  const home = tempHome();
  const stateDir = join(home, "state", "kura");
  const configDir = join(home, ".config", "kura");
  try {
    expect(runWithHome(home, "setup").exitCode).toBe(0);
    expect(runWithHome(home, "enable", "claude").exitCode).toBe(0);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "kura.db"), "data");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), "{}");

    const result = runWithHome(home, "status");
    const text = output(result);
    expect(result.exitCode).toBe(0);
    expect(text).toContain("Setup\n┌");
    expect(text).toMatch(/cli\s+│ READY\s+│/);
    expect(text).toMatch(/config\s+│ PRESENT\s+│ ~\/\.config\/kura\/config\.json/);
    expect(text).toMatch(/kura\.db\s+│ PRESENT\s+│/);
    expect(text).toMatch(/claude\s+│ ENABLED\s+│ Stop \+ UserPromptSubmit hooks/);
    expect(text).toMatch(/codex\s+│ DISABLED\s+│ Stop hook/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
