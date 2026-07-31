import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const script = join(import.meta.dir, "..", "..", "src", "history", "hooks.ts");

function run(home: string, source: "claude" | "codex" | "all", action: string) {
  return Bun.spawnSync([process.execPath, script, source, action], {
    env: { ...process.env, HOME: home },
  });
}

function settingsPath(home: string, agent: "claude" | "codex"): string {
  return agent === "claude"
    ? join(home, ".claude", "settings.json")
    : join(home, ".codex", "hooks.json");
}

function commands(path: string): string[] {
  const settings = JSON.parse(readFileSync(path, "utf-8"));
  return settings.hooks.Stop.flatMap((group: { hooks?: { command?: string }[] }) =>
    (group.hooks ?? []).map((hook) => hook.command ?? ""),
  );
}

for (const agent of ["claude", "codex"] as const) {
  test(`${agent} hook を idempotent に enable / disable する`, () => {
    const home = mkdtempSync(join(tmpdir(), `kura-hooks-${agent}-`));
    const path = settingsPath(home, agent);
    try {
      expect(run(home, agent, "enable").exitCode).toBe(0);
      expect(run(home, agent, "enable").exitCode).toBe(0);
      expect(commands(path)).toHaveLength(1);
      expect(commands(path)[0]).toBe(`"$HOME/.local/bin/kura" hook ${agent}`);
      expect(run(home, agent, "check").exitCode).toBe(0);
      expect(run(home, agent, "status").stdout.toString()).toBe(`${agent}: enabled\n`);
      expect(run(home, agent, "disable").exitCode).toBe(0);
      expect(commands(path)).toEqual([]);
      const disabled = run(home, agent, "status");
      expect(disabled.exitCode).toBe(0);
      expect(disabled.stdout.toString()).toBe(`${agent}: disabled\n`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
}

test("enable は旧 Claude hook を新 path へ置き換え、無関係な hook を残す", () => {
  const home = mkdtempSync(join(tmpdir(), "kura-hooks-legacy-"));
  const path = settingsPath(home, "claude");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: 'bun "$HOME/.local/share/kura/history/ingest.ts"' },
              { type: "command", command: '"$HOME/.local/bin/kura" ingest claude' },
              { type: "command", command: "echo keep-me" },
            ],
          },
        ],
      },
    }),
  );
  try {
    expect(run(home, "claude", "enable").exitCode).toBe(0);
    expect(commands(path)).toEqual([
      "echo keep-me",
      '"$HOME/.local/bin/kura" hook claude',
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("all は両方の history hook を status / disable し、enable は拒否する", () => {
  const home = mkdtempSync(join(tmpdir(), "kura-hooks-all-"));
  try {
    expect(run(home, "all", "disable").exitCode).toBe(0);
    expect(existsSync(settingsPath(home, "claude"))).toBe(false);
    expect(existsSync(settingsPath(home, "codex"))).toBe(false);

    expect(run(home, "claude", "enable").exitCode).toBe(0);
    expect(run(home, "codex", "enable").exitCode).toBe(0);
    expect(run(home, "all", "status").stdout.toString()).toBe(
      "claude: enabled\ncodex: enabled\n",
    );

    expect(run(home, "all", "enable").exitCode).toBe(2);
    expect(run(home, "all", "disable").exitCode).toBe(0);
    expect(commands(settingsPath(home, "claude"))).toEqual([]);
    expect(commands(settingsPath(home, "codex"))).toEqual([]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("hooks.Stop が array でなければ設定を上書きしない", () => {
  const home = mkdtempSync(join(tmpdir(), "kura-hooks-invalid-"));
  const path = settingsPath(home, "claude");
  mkdirSync(dirname(path), { recursive: true });
  const original = JSON.stringify({ hooks: { Stop: { hooks: [] } } }, null, 2) + "\n";
  writeFileSync(path, original);
  try {
    const result = run(home, "claude", "enable");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("hooks.Stop must be an array");
    expect(readFileSync(path, "utf-8")).toBe(original);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
