import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  latestAssistantModel,
  provenanceName,
  runProvenance,
  selfProvenance,
} from "./provenance.ts";

const root = mkdtempSync(join(tmpdir(), "kura-provenance-"));
const savedEnv = {
  HOME: process.env.HOME,
  CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID,
  CLAUDE_EFFORT: process.env.CLAUDE_EFFORT,
};

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function writeTranscript(path: string, lines: unknown[]): void {
  writeFileSync(path, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"));
}

test("latestAssistantModel は最後の assistant message の model を返す", () => {
  const transcript = join(root, "t.jsonl");
  mkdirSync(root, { recursive: true });
  writeTranscript(transcript, [
    { type: "user", message: { content: "hi" } },
    { type: "assistant", message: { model: "claude-old", content: [] } },
    "not json",
    { type: "assistant", message: { model: "claude-new", content: [] } },
    { type: "user", message: { content: "bye" } },
  ]);
  expect(latestAssistantModel(transcript)).toBe("claude-new");
});

test("latestAssistantModel は transcript 不在 / assistant 無しで null", () => {
  expect(latestAssistantModel(join(root, "missing.jsonl"))).toBeNull();
  const transcript = join(root, "empty.jsonl");
  mkdirSync(root, { recursive: true });
  writeTranscript(transcript, [{ type: "user", message: { content: "hi" } }]);
  expect(latestAssistantModel(transcript)).toBeNull();
});

test("selfProvenance は session id から自分の transcript を見つけて stamp する", () => {
  const projectDir = join(root, ".claude", "projects", "-tmp-kura-fixture");
  mkdirSync(projectDir, { recursive: true });
  writeTranscript(join(projectDir, "sid-123.jsonl"), [
    { type: "assistant", message: { model: "claude-fixture", content: [] } },
  ]);
  process.env.HOME = root;
  process.env.CLAUDE_CODE_SESSION_ID = "sid-123";
  process.env.CLAUDE_EFFORT = "high";
  expect(selfProvenance()).toEqual({ model: "claude-fixture", effort: "high" });
});

test("selfProvenance は session 外 (env 無し) で null に倒す", () => {
  process.env.HOME = root;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.CLAUDE_EFFORT;
  expect(selfProvenance()).toEqual({ model: null, effort: null });
});

test("provenanceName は model が無ければ null、effort は括弧で添える", () => {
  expect(provenanceName("claude-fable-5", "high")).toBe("claude-fable-5 (high)");
  expect(provenanceName("claude-fable-5", null)).toBe("claude-fable-5");
  expect(provenanceName(null, "high")).toBeNull();
});

test("runProvenance は自動実行で明示指定した model / effort を保持する", () => {
  expect(runProvenance("gpt-5.6", "high")).toEqual({ model: "gpt-5.6", effort: "high" });
});
