import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "..", "..", "src", "publish", "manage.ts");
let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kura-publish-policy-"));
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

function run(target: string, action: string, webhook = "") {
  return Bun.spawnSync([process.execPath, script, target, action], {
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, "config"),
      KURA_DISCORD_WEBHOOK_TIMELINE: webhook,
    },
  });
}

test("publish は default-off で、status は policy file を作らない", () => {
  const result = run("all", "status");
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe(
    "timeline: disabled\nenglish: disabled\n",
  );
  expect(existsSync(join(home, "config", "kura", "publish.json"))).toBe(false);
});

test("publish enable は webhook と明示 opt-in を要求する", () => {
  expect(run("timeline", "enable").exitCode).toBe(1);
  expect(run("timeline", "enable", "https://example.test/webhook").exitCode).toBe(0);

  const policy = join(home, "config", "kura", "publish.json");
  expect(JSON.parse(readFileSync(policy, "utf-8"))).toEqual({
    enabled: ["timeline"],
  });
  expect(statSync(policy).mode & 0o777).toBe(0o600);
  expect(run("timeline", "check").exitCode).toBe(0);
});

test("all は publish を status / disable し、enable は拒否する", () => {
  expect(run("timeline", "enable", "https://example.test/webhook").exitCode).toBe(0);
  expect(run("all", "enable", "https://example.test/webhook").exitCode).toBe(2);
  expect(run("all", "disable").exitCode).toBe(0);
  expect(run("timeline", "check").exitCode).toBe(1);
});
