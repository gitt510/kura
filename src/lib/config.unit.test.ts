import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envFilePath, resolveEnv } from "./config.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("XDG_CONFIG_HOME の env file を読む", () => {
  const root = mkdtempSync(join(tmpdir(), "kura-config-"));
  roots.push(root);
  mkdirSync(join(root, "kura"));
  writeFileSync(join(root, "kura/env"), "KURA_TEST=file-value\n");

  const env = { HOME: "/unused", XDG_CONFIG_HOME: root };
  expect(envFilePath(env)).toBe(join(root, "kura/env"));
  expect(resolveEnv("KURA_TEST", env)).toBe("file-value");
});

test("process env を config file より優先する", () => {
  const root = mkdtempSync(join(tmpdir(), "kura-config-"));
  roots.push(root);
  mkdirSync(join(root, "kura"));
  writeFileSync(join(root, "kura/env"), "KURA_TEST=file-value\n");

  expect(resolveEnv("KURA_TEST", { XDG_CONFIG_HOME: root, KURA_TEST: "process-value" })).toBe(
    "process-value",
  );
});

test("process env の空文字は config file へ fallback しない", () => {
  const root = mkdtempSync(join(tmpdir(), "kura-config-"));
  roots.push(root);
  mkdirSync(join(root, "kura"));
  writeFileSync(join(root, "kura/env"), "KURA_TEST=file-value\n");

  expect(resolveEnv("KURA_TEST", { XDG_CONFIG_HOME: root, KURA_TEST: "" })).toBe("");
});

test("XDG_CONFIG_HOME がなければ HOME/.config を使う", () => {
  expect(envFilePath({ HOME: "/home/example" })).toBe("/home/example/.config/kura/env");
});
