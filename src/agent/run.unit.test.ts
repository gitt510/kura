import { expect, test } from "bun:test";
import { buildClaudePromptCommand, parseClaudeJson, resolvePromptGeneration } from "./run.ts";

test("生成設定を Claude の option に解決し、effort は Claude の語彙で検証する", () => {
  expect(
    resolvePromptGeneration("akapen", { agent: "claude", model: "opus", effort: "high" }),
  ).toEqual({ model: "opus", effort: "high" });
  expect(() =>
    resolvePromptGeneration("akapen", { agent: "claude", model: null, effort: "ultra" }),
  ).toThrow("akapen.effort must be one of");
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
