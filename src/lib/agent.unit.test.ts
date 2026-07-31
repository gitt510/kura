import { expect, test } from "bun:test";
import {
  buildClaudeCommand,
  buildCodexCommand,
  parseClaudeJson,
  parseCodexJsonl,
  resolveClaudeOptions,
  resolveCodexOptions,
  resolveGenerator,
  skillPrompt,
} from "./agent.ts";
import { KURA_ROOT } from "./storage.ts";

const WORK_DIR = "/tmp/kura-decisions";
const ALLOWED_TOOLS = [
  `Read(/${WORK_DIR}/**)`,
  `Write(/${WORK_DIR}/**)`,
  `Read(/${KURA_ROOT}/**)`,
].join(",");

test("generator は未指定なら Claude、指定時は Codex を選ぶ", () => {
  expect(resolveGenerator({ XDG_CONFIG_HOME: "/kura-test-no-config" })).toBe("claude");
  expect(resolveGenerator({ KURA_GENERATOR: "codex" })).toBe("codex");
});

test("未知の generator は拒否する", () => {
  expect(() => resolveGenerator({ KURA_GENERATOR: "other" })).toThrow(
    'KURA_GENERATOR must be "claude" or "codex"',
  );
});

test("Claude の model / effort を kura env から解決する", () => {
  expect(
    resolveClaudeOptions({
      KURA_CLAUDE_MODEL: "claude-fable-5",
      KURA_CLAUDE_EFFORT: "high",
    }),
  ).toEqual({ model: "claude-fable-5", effort: "high" });
  expect(resolveClaudeOptions({ XDG_CONFIG_HOME: "/kura-test-no-config" })).toEqual({
    model: null,
    effort: null,
  });
});

test("未知の Claude effort は拒否する", () => {
  expect(() => resolveClaudeOptions({ KURA_CLAUDE_EFFORT: "ultra" })).toThrow(
    "KURA_CLAUDE_EFFORT must be one of",
  );
});

test("Claude command は model / effort が明示されたときだけ flag を注入する", () => {
  expect(
    buildClaudeCommand(
      "/bin/claude",
      "/decisions 2026-07-17 14",
      { model: "claude-fable-5", effort: "high" },
      WORK_DIR,
    ),
  ).toEqual([
    "/bin/claude",
    "-p",
    "/decisions 2026-07-17 14",
    "--output-format",
    "json",
    "--allowedTools",
    ALLOWED_TOOLS,
    "--model",
    "claude-fable-5",
    "--effort",
    "high",
  ]);
  expect(
    buildClaudeCommand(
      "/bin/claude",
      "/decisions 2026-07-17 14",
      { model: null, effort: null },
      WORK_DIR,
    ),
  ).toEqual([
    "/bin/claude",
    "-p",
    "/decisions 2026-07-17 14",
    "--output-format",
    "json",
    "--allowedTools",
    ALLOWED_TOOLS,
  ]);
});

test("Claude command は permission bypass を持たない", () => {
  const command = buildClaudeCommand(
    "/bin/claude",
    "/decisions 2026-07-17 14",
    { model: null, effort: null },
    WORK_DIR,
  );
  expect(command).not.toContain("--dangerously-skip-permissions");
});

test("Codex の model / effort を kura env から解決する", () => {
  expect(
    resolveCodexOptions({
      KURA_CODEX_MODEL: "gpt-5.6",
      KURA_CODEX_EFFORT: "high",
    }),
  ).toEqual({ model: "gpt-5.6", effort: "high" });
  expect(resolveCodexOptions({ XDG_CONFIG_HOME: "/kura-test-no-config" })).toEqual({
    model: null,
    effort: null,
  });
});

test("未知の Codex effort は拒否する", () => {
  expect(() => resolveCodexOptions({ KURA_CODEX_EFFORT: "extreme" })).toThrow(
    "KURA_CODEX_EFFORT must be one of",
  );
});

test("Codex command は model / effort をその invocation だけに上書きする", () => {
  expect(
    buildCodexCommand("/bin/codex", "$decisions 2026-07-17 14", {
      model: "gpt-5.6",
      effort: "high",
    }),
  ).toEqual([
    "/bin/codex",
    "--ask-for-approval",
    "never",
    "exec",
    "--ephemeral",
    "--sandbox",
    "workspace-write",
    "--model",
    "gpt-5.6",
    "--config",
    'model_reasoning_effort="high"',
    "--json",
    "$decisions 2026-07-17 14",
  ]);
});

test("agent ごとの明示的な skill 呼び出しを組み立てる", () => {
  expect(skillPrompt("claude", "decisions", ["2026-07-17", "14"])).toBe(
    "/decisions 2026-07-17 14",
  );
  expect(skillPrompt("codex", "decisions", ["2026-07-17", "14"])).toBe(
    "$decisions 2026-07-17 14",
  );
});

test("Claude の単一 JSON から結果と model を読む", () => {
  expect(
    parseClaudeJson(
      JSON.stringify({
        is_error: false,
        result: "generated",
        modelUsage: { "claude-fixture": {} },
      }),
    ),
  ).toEqual({ complete: true, isError: false, model: "claude-fixture", result: "generated" });
});

test("Codex の JSONL から完了と最終 message を読む", () => {
  const raw = [
    JSON.stringify({ type: "thread.started", thread_id: "fixture" }),
    JSON.stringify({
      type: "item.completed",
      item: { id: "item_1", type: "agent_message", text: "generated" },
    }),
    JSON.stringify({ type: "turn.completed", usage: {} }),
  ].join("\n");

  expect(parseCodexJsonl(raw)).toEqual({
    complete: true,
    isError: false,
    model: null,
    result: "generated",
  });
});

test("Codex の失敗 event と壊れた JSONL は失敗に倒す", () => {
  expect(parseCodexJsonl(JSON.stringify({ type: "turn.failed" }))).toEqual({
    complete: false,
    isError: true,
    model: null,
    result: "",
  });
  expect(parseCodexJsonl("not-json")).toEqual({
    complete: false,
    isError: true,
    model: null,
    result: "",
  });
});
