import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "..", "..", "src", "publish", "manage.ts");
let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kura-publish-policy-"));
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

function configFile(): string {
  return join(home, "config", "kura", "config.json");
}

function writeWebhook(webhook: string) {
  mkdirSync(join(home, "config", "kura"), { recursive: true });
  writeFileSync(configFile(), JSON.stringify({ discord: { webhooks: { timeline: webhook } } }));
}

function run(target: string, action: string) {
  return Bun.spawnSync([process.execPath, script, target, action], {
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, "config") },
  });
}

test("publish は default-off で、status は config file を作らない", () => {
  const result = run("all", "status");
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe("timeline: disabled\nenglish: disabled\n");
  expect(existsSync(configFile())).toBe(false);
});

test("publish enable は webhook と明示 opt-in を要求し、config の他の項目を残す", () => {
  expect(run("timeline", "enable").exitCode).toBe(1);
  writeWebhook("https://example.test/webhook");
  expect(run("timeline", "enable").exitCode).toBe(0);

  const config = JSON.parse(readFileSync(configFile(), "utf-8"));
  expect(config.publish).toEqual({ enabled: ["timeline"] });
  expect(config.discord.webhooks).toEqual({ timeline: "https://example.test/webhook" });
  expect(statSync(configFile()).mode & 0o777).toBe(0o600);
  expect(run("timeline", "check").exitCode).toBe(0);
});

test("all は publish を status / disable し、enable は拒否する", () => {
  writeWebhook("https://example.test/webhook");
  expect(run("timeline", "enable").exitCode).toBe(0);
  expect(run("all", "enable").exitCode).toBe(2);
  expect(run("all", "disable").exitCode).toBe(0);
  expect(run("timeline", "check").exitCode).toBe(1);
});
