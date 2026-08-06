import { expect, test } from "bun:test";
import {
  chmodSync,
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

test("just は setup group に history interface を公開する", () => {
  const result = dryRun("history", "disable", "codex");
  expect(result.exitCode).toBe(0);
  expect(output(result)).toContain('src/cli.ts" history "disable" "codex"');
});

test("just は features group に schedule interface を公開する", () => {
  const result = dryRun("schedule", "enable", "timeline");
  expect(result.exitCode).toBe(0);
  expect(output(result)).toContain('src/cli.ts" schedule "enable" "timeline"');
});

test("just は features group に publish interface を公開する", () => {
  const result = dryRun("publish", "disable", "timeline");
  expect(result.exitCode).toBe(0);
  expect(output(result)).toContain('src/cli.ts" publish "disable" "timeline"');
});

test("just の default recipe は非公開で recipe 一覧を返す", () => {
  const result = Bun.spawnSync(["just", "--justfile", justfile]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("history action source");
  expect(result.stdout.toString()).toContain("schedule action feature");
  expect(result.stdout.toString()).toContain("publish action feature");
  expect(result.stdout.toString()).toContain("[setup]");
  expect(result.stdout.toString()).toContain("[features]");
  expect(result.stdout.toString()).toContain("[operations]");
  expect(result.stdout.toString()).not.toContain("[automation]");
  expect(result.stdout.toString()).not.toContain("[cli]");
  expect(result.stdout.toString()).not.toContain("[generation]");
  expect(result.stdout.toString()).not.toContain("[publish]");
  expect(result.stdout.toString()).not.toContain("_default");
});

test("個別 control の public action は enable / disable に限定する", () => {
  const { home, bin } = setupHome();
  try {
    for (const [control, target] of [
      ["history", "claude"],
      ["schedule", "timeline"],
      ["publish", "timeline"],
    ]) {
      const result = runWithHome(home, bin, "", control!, "status", target!);
      expect(result.exitCode).toBe(2);
      expect(output(result)).toContain(`<enable|disable>`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

function setupHome(): { home: string; bin: string } {
  const home = mkdtempSync(join(tmpdir(), "kura-justfile-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const launchctl = join(bin, "launchctl");
  writeFileSync(
    launchctl,
    `#!/bin/sh
if [ "$1" = "list" ]; then
  [ "\${KURA_TEST_ENABLED:-}" = "$2" ]
  exit
fi
exit 0
`,
  );
  chmodSync(launchctl, 0o755);
  return { home, bin };
}

function runWithHome(home: string, bin: string, enabled: string, ...args: string[]) {
  return Bun.spawnSync(["just", "--justfile", justfile, ...args], {
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_STATE_HOME: join(home, "state"),
      KURA_TEST_ENABLED: enabled,
    },
  });
}

test("setup は local entrypoint だけを作成する", () => {
  const { home, bin } = setupHome();
  const runtime = join(home, ".local", "share", "kura");
  const cli = join(home, ".local", "bin", "kura");
  try {
    expect(runWithHome(home, bin, "", "setup").exitCode).toBe(0);
    expect(readlinkSync(runtime)).toBe(repo);
    expect(readlinkSync(cli)).toBe(join(runtime, "src", "cli.ts"));
    expect(existsSync(join(home, "state", "kura"))).toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("teardown は history source・feature control・entrypoint を除去し、data を残す", () => {
  const { home, bin } = setupHome();
  const runtime = join(home, ".local", "share", "kura");
  const cli = join(home, ".local", "bin", "kura");
  const stateDir = join(home, "state", "kura");
  const configDir = join(home, ".config", "kura");
  const claudeSettings = join(home, ".claude", "settings.json");
  const timelineJob = join(home, "Library", "LaunchAgents", "kura.timeline.plist");
  try {
    expect(runWithHome(home, bin, "", "setup").exitCode).toBe(0);
    expect(runWithHome(home, bin, "", "history", "enable", "claude").exitCode).toBe(0);
    expect(runWithHome(home, bin, "", "schedule", "enable", "timeline").exitCode).toBe(0);

    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "history.db"), "data");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "env"), "KURA_GENERATOR=codex\n");
    writeFileSync(
      join(configDir, "publish.json"),
      `${JSON.stringify({ enabled: ["timeline"] }, null, 2)}\n`,
    );

    const result = runWithHome(home, bin, "kura.timeline", "teardown");
    expect(result.exitCode).toBe(0);
    expect(() => lstatSync(runtime)).toThrow();
    expect(() => lstatSync(cli)).toThrow();
    expect(() => lstatSync(timelineJob)).toThrow();
    expect(readFileSync(claudeSettings, "utf-8")).not.toContain(".local/bin/kura");
    expect(JSON.parse(readFileSync(join(configDir, "publish.json"), "utf-8"))).toEqual({
      enabled: [],
    });
    expect(readFileSync(join(stateDir, "history.db"), "utf-8")).toBe("data");
    expect(readFileSync(join(configDir, "env"), "utf-8")).toBe("KURA_GENERATOR=codex\n");
    expect(output(result)).toContain(`retained state: ${stateDir}`);
    expect(output(result)).toContain(`retained config: ${configDir}`);

    expect(runWithHome(home, bin, "", "teardown").exitCode).toBe(0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("teardown は ownership の preflight に失敗したら何も停止しない", () => {
  const { home, bin } = setupHome();
  const runtime = join(home, ".local", "share", "kura");
  const configDir = join(home, ".config", "kura");
  const claudeSettings = join(home, ".claude", "settings.json");
  const foreignJob = join(home, "Library", "LaunchAgents", "kura.english.plist");
  try {
    expect(runWithHome(home, bin, "", "setup").exitCode).toBe(0);
    expect(runWithHome(home, bin, "", "history", "enable", "claude").exitCode).toBe(0);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "publish.json"),
      `${JSON.stringify({ enabled: ["timeline"] }, null, 2)}\n`,
    );
    mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(foreignJob, "foreign");

    const result = runWithHome(home, bin, "", "teardown");
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain(`refusing to remove existing path: ${foreignJob}`);
    expect(readlinkSync(runtime)).toBe(repo);
    expect(readFileSync(claudeSettings, "utf-8")).toContain(".local/bin/kura");
    expect(JSON.parse(readFileSync(join(configDir, "publish.json"), "utf-8"))).toEqual({
      enabled: ["timeline"],
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("status は setup と features を表形式で表示する", () => {
  const { home, bin } = setupHome();
  const stateDir = join(home, "state", "kura");
  const configDir = join(home, ".config", "kura");
  try {
    expect(runWithHome(home, bin, "", "setup").exitCode).toBe(0);
    expect(runWithHome(home, bin, "", "history", "enable", "claude").exitCode).toBe(0);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "history.db"), "data");
    writeFileSync(join(stateDir, "timeline.db"), "data");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "env"),
      [
        "KURA_GENERATOR=codex",
        "KURA_CODEX_MODEL=gpt-test",
        "KURA_CODEX_EFFORT=high",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(configDir, "publish.json"),
      `${JSON.stringify({ enabled: ["timeline"] }, null, 2)}\n`,
    );

    const result = runWithHome(home, bin, "kura.timeline", "status");
    const text = output(result);
    expect(result.exitCode).toBe(0);
    expect(text).toContain("Setup\n┌");
    expect(text).toMatch(/cli\s+│ READY\s+│/);
    expect(text).toMatch(/env\s+│ PRESENT\s+│ ~\/\.config\/kura\/env/);
    expect(text).toMatch(/history\.db\s+│ PRESENT\s+│/);
    expect(text).toMatch(/history\/claude\s+│ ENABLED\s+│ Stop \+ UserPromptSubmit hooks/);
    expect(text).toMatch(/history\/codex\s+│ DISABLED\s+│ Stop hook/);
    expect(text).toContain("Features  codex · gpt-test · high  (config)");
    expect(text).toMatch(/timeline\s+│ PRESENT\s+│ ENABLED\s+│ ENABLED/);
    expect(text).toMatch(/english\s+│ NOT CREATED\s+│ DISABLED\s+│ DISABLED/);
    expect(text).toMatch(/decisions\s+│ NOT CREATED\s+│ DISABLED\s+│ -/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
