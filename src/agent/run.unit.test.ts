import { expect, test } from "bun:test";
import { defaultConfig, type KuraConfig } from "../config.ts";
import { KURA_ROOT } from "../storage.ts";
import {
  buildClaudeCommand,
  buildClaudePromptCommand,
  buildCodexCommand,
  parseClaudeJson,
  parseCodexJsonl,
  resolveClaudeOptions,
  resolveCodexOptions,
  resolveGenerator,
  skillPrompt,
} from "./run.ts";

function config(patch: Partial<KuraConfig>): KuraConfig {
  return { ...defaultConfig(), ...patch };
}

const WORK_DIR = "/tmp/kura-timeline";
const ALLOWED_TOOLS = [
  `Read(/${WORK_DIR}/**)`,
  `Write(/${WORK_DIR}/**)`,
  `Read(/${KURA_ROOT}/**)`,
].join(",");

test("generator は未指定なら Claude、指定時は Codex を選ぶ", () => {
  expect(resolveGenerator(defaultConfig())).toBe("claude");
  expect(resolveGenerator(config({ generator: "codex" }))).toBe("codex");
});

test("未知の generator は拒否する", () => {
  expect(() => resolveGenerator(config({ generator: "other" }))).toThrow(
    'generator must be "claude" or "codex"',
  );
});

test("Claude の model / effort を config から解決する", () => {
  expect(
    resolveClaudeOptions(config({ claude: { model: "claude-fable-5", effort: "high" } })),
  ).toEqual({ model: "claude-fable-5", effort: "high" });
  expect(resolveClaudeOptions(defaultConfig())).toEqual({
    model: null,
    effort: null,
  });
});

test("未知の Claude effort は拒否する", () => {
  expect(() => resolveClaudeOptions(config({ claude: { model: null, effort: "ultra" } }))).toThrow(
    "claude.effort must be one of",
  );
});

test("Claude command は model / effort が明示されたときだけ flag を注入する", () => {
  expect(
    buildClaudeCommand(
      "/bin/claude",
      "/timeline 2026-07-17 14",
      { model: "claude-fable-5", effort: "high" },
      WORK_DIR,
    ),
  ).toEqual([
    "/bin/claude",
    "-p",
    "/timeline 2026-07-17 14",
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
      "/timeline 2026-07-17 14",
      { model: null, effort: null },
      WORK_DIR,
    ),
  ).toEqual([
    "/bin/claude",
    "-p",
    "/timeline 2026-07-17 14",
    "--output-format",
    "json",
    "--allowedTools",
    ALLOWED_TOOLS,
  ]);
});

test("Claude command は permission bypass を持たない", () => {
  const command = buildClaudeCommand(
    "/bin/claude",
    "/timeline 2026-07-17 14",
    { model: null, effort: null },
    WORK_DIR,
  );
  expect(command).not.toContain("--dangerously-skip-permissions");
});

test("Codex の model / effort を config から解決する", () => {
  expect(resolveCodexOptions(config({ codex: { model: "gpt-5.6", effort: "high" } }))).toEqual({
    model: "gpt-5.6",
    effort: "high",
  });
  expect(resolveCodexOptions(defaultConfig())).toEqual({
    model: null,
    effort: null,
  });
});

test("未知の Codex effort は拒否する", () => {
  expect(() => resolveCodexOptions(config({ codex: { model: null, effort: "extreme" } }))).toThrow(
    "codex.effort must be one of",
  );
});

test("Codex command は model / effort をその invocation だけに上書きする", () => {
  expect(
    buildCodexCommand("/bin/codex", "$timeline 2026-07-17 14", {
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
    "$timeline 2026-07-17 14",
  ]);
});

test("agent ごとの明示的な skill 呼び出しを組み立てる", () => {
  expect(skillPrompt("claude", "timeline", ["2026-07-17", "14"])).toBe("/timeline 2026-07-17 14");
  expect(skillPrompt("codex", "timeline", ["2026-07-17", "14"])).toBe("$timeline 2026-07-17 14");
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
  ).toEqual({
    complete: true,
    isError: false,
    model: "claude-fixture",
    result: "generated",
    usage: null,
  });
});

test("Claude の単一 JSON から token 消費と cost を読む", () => {
  expect(
    parseClaudeJson(
      JSON.stringify({
        is_error: false,
        result: "generated",
        total_cost_usd: 0.0126,
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 5297,
          cache_read_input_tokens: 17900,
          output_tokens: 42,
        },
      }),
    ).usage,
  ).toEqual({
    inputTokens: 10,
    cacheCreationTokens: 5297,
    cacheReadTokens: 17900,
    outputTokens: 42,
    costUsd: 0.0126,
  });
});

test("Codex の JSONL から完了と最終 message を読む", () => {
  const raw = [
    JSON.stringify({ type: "thread.started", thread_id: "fixture" }),
    JSON.stringify({
      type: "item.completed",
      item: { id: "item_1", type: "agent_message", text: "generated" },
    }),
    JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 120,
        cached_input_tokens: 45,
        cache_write_input_tokens: 30,
        output_tokens: 67,
        reasoning_output_tokens: 0,
      },
    }),
  ].join("\n");

  expect(parseCodexJsonl(raw)).toEqual({
    complete: true,
    isError: false,
    model: null,
    result: "generated",
    usage: {
      inputTokens: 120,
      cacheCreationTokens: 30,
      cacheReadTokens: 45,
      outputTokens: 67,
      costUsd: null,
    },
  });
});

test("Codex の失敗 event と壊れた JSONL は失敗に倒す", () => {
  expect(parseCodexJsonl(JSON.stringify({ type: "turn.failed" }))).toEqual({
    complete: false,
    isError: true,
    model: null,
    result: "",
    usage: null,
  });
  expect(parseCodexJsonl("not-json")).toEqual({
    complete: false,
    isError: true,
    model: null,
    result: "",
    usage: null,
  });
});

test("1 回きりの prompt は渡した system と prompt だけを送り、tool・MCP・skill・settings を積まない", () => {
  const command = buildClaudePromptCommand(
    "/bin/claude",
    { system: "You are a coach.", prompt: "hello" },
    "opus",
  );
  expect(command).toEqual([
    "/bin/claude",
    "-p",
    "hello",
    "--system-prompt",
    "You are a coach.",
    "--tools",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--setting-sources",
    "",
    "--output-format",
    "json",
    "--model",
    "opus",
  ]);
});
