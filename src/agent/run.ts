import { existsSync } from "node:fs";
import type { Generation } from "../config.ts";
import { type AgentUsage, recordUsage } from "./usage.ts";

// Claude CLI の --effort が受ける 5 段。
export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeOptions {
  model: string | null;
  effort: ClaudeEffort | null;
}

// tool を持たない 1 回きりの prompt 実行の結果。
export interface ClaudePromptRun {
  ok: boolean;
  exitCode: number;
  result: string; // agent の最終テキスト
  model: string | null; // 実行結果を優先し、無ければ要求した model
  stderr: string; // 失敗理由の提示は呼び手に委ねる
}

interface ParsedAgentOutput {
  complete: boolean;
  isError: boolean;
  model: string | null;
  result: string;
  usage: AgentUsage | null; // 出力に usage が無い / parse 失敗なら null
}

const CLAUDE_EFFORTS = new Set<ClaudeEffort>(["low", "medium", "high", "xhigh", "max"]);

// agent の binary を知るのはこの module だけ — spawn 経路を 1 本に保ち、
// usage 記録が呼び手の善意に依存しないようにする (tests/architecture.test.ts が強制)。
function agentExecutable(agent: "claude"): string {
  const discovered = Bun.which(agent);
  if (discovered) return discovered;

  const home = process.env.HOME;
  const fallback = home ? `${home}/.local/bin/${agent}` : "";
  if (fallback && existsSync(fallback)) return fallback;
  throw new Error(`${agent} CLI not found in PATH or ~/.local/bin/${agent}`);
}

// 無人 agent 実行の共通 env。KURA_NO_HISTORY=1 で自動 session の保存を防ぐ。
function agentEnv(): Record<string, string | undefined> {
  return { ...process.env, KURA_NO_HISTORY: "1" };
}

export function parseClaudeJson(raw: string): ParsedAgentOutput {
  try {
    const json = JSON.parse(raw) as {
      is_error?: boolean;
      result?: string;
      modelUsage?: Record<string, unknown>;
      usage?: {
        input_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
        output_tokens?: number;
      };
      total_cost_usd?: number;
    };
    const models = json.modelUsage ? Object.keys(json.modelUsage) : [];
    return {
      complete: raw.length > 0,
      isError: json.is_error === true,
      model: models[0] ?? null,
      result: typeof json.result === "string" ? json.result : "",
      usage: json.usage
        ? {
            inputTokens: json.usage.input_tokens ?? 0,
            cacheCreationTokens: json.usage.cache_creation_input_tokens ?? 0,
            cacheReadTokens: json.usage.cache_read_input_tokens ?? 0,
            outputTokens: json.usage.output_tokens ?? 0,
            costUsd: typeof json.total_cost_usd === "number" ? json.total_cost_usd : null,
          }
        : null,
    };
  } catch {
    return { complete: false, isError: true, model: null, result: "", usage: null };
  }
}

// tool も文脈も持たない 1 回きりの対話。system が model の立場と規則、prompt が user の発話。
export interface ClaudePrompt {
  system: string;
  prompt: string;
}

// Claude Code 本体の system prompt・tool 定義・MCP・skill・settings (CLAUDE.md・plugin・hook)
// を積まない — 入力は呼び手が渡した system と prompt だけになり、user 固有の指示
// (応答言語など) が生成物に混ざらない。積んだ場合の入力は 1 回あたり約 14k token 多い。
export function buildClaudePromptCommand(
  executable: string,
  { system, prompt }: ClaudePrompt,
  model: string | null,
  effort: ClaudeEffort | null = null,
): string[] {
  return [
    executable,
    "-p",
    prompt,
    "--system-prompt",
    system,
    "--tools",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--setting-sources",
    "",
    "--output-format",
    "json",
    ...(model ? ["--model", model] : []),
    ...(effort ? ["--effort", effort] : []),
  ];
}

// feature の生成設定を Claude の option に解決する。effort は Claude の語彙で検証する。
export function resolvePromptGeneration(
  feature: string,
  { model, effort }: Generation,
): ClaudeOptions {
  if (effort && !CLAUDE_EFFORTS.has(effort as ClaudeEffort)) {
    throw new Error(
      `${feature}.effort must be one of ${[...CLAUDE_EFFORTS].join(", ")} (got: ${effort})`,
    );
  }
  return { model, effort: effort as ClaudeEffort | null };
}

// tool を一切許さない 1 回の対話を Claude で実行する (非同期)。model は呼び手が明示する。
export async function runClaudePrompt(
  feature: string,
  input: ClaudePrompt,
  model: string | null,
  effort: ClaudeEffort | null = null,
): Promise<ClaudePromptRun> {
  const child = Bun.spawn(
    buildClaudePromptCommand(agentExecutable("claude"), input, model, effort),
    {
      env: agentEnv(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [raw, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const exitCode = await child.exited;

  const parsed = parseClaudeJson(raw);
  const ok = exitCode === 0 && parsed.complete && !parsed.isError;
  if (parsed.usage) {
    recordUsage({
      feature,
      agent: "claude",
      model: parsed.model ?? model,
      ok,
      usage: parsed.usage,
    });
  }
  return { ok, exitCode, result: parsed.result, model: parsed.model ?? model, stderr };
}
