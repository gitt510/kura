import { existsSync } from "node:fs";
import { resolveEnv } from "./config.ts";
import { KURA_ROOT } from "./storage.ts";
import { recordUsage, type AgentUsage } from "./usage.ts";

export type Generator = "claude" | "codex";
// Claude CLI の --effort が受ける 5 段。Codex の 8 段とは語彙が別物なので enum を共有しない。
export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";
export type CodexEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";
type Environment = Readonly<Record<string, string | undefined>>;

export interface ClaudeOptions {
  model: string | null;
  effort: ClaudeEffort | null;
}

export interface CodexOptions {
  model: string | null;
  effort: CodexEffort | null;
}

export interface AgentJsonRun {
  ok: boolean; // process が正常終了し、agent の出力が完了を示した
  exitCode: number;
  isError: boolean; // agent 自身が報告した実行エラー
  model: string | null; // 実行結果 (Claude の modelUsage) を優先し、無ければ env の明示指定値
  effort: string | null; // env の明示指定値のみ。自動判定値は公開出力から取得しない
  result: string; // agent の最終テキスト（ログ・デバッグ用）
  raw: string; // 生 stdout（パース失敗時の調査用）
}

interface ParsedAgentOutput {
  complete: boolean;
  isError: boolean;
  model: string | null;
  result: string;
  usage: AgentUsage | null; // 出力に usage が無い / parse 失敗なら null
}

export function resolveGenerator(env: Environment = process.env): Generator {
  const value = resolveEnv("KURA_GENERATOR", env) ?? "claude";
  if (value === "claude" || value === "codex") return value;
  throw new Error(`KURA_GENERATOR must be "claude" or "codex" (got: ${value})`);
}

const CLAUDE_EFFORTS = new Set<ClaudeEffort>(["low", "medium", "high", "xhigh", "max"]);

const CODEX_EFFORTS = new Set<CodexEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

export function resolveClaudeOptions(env: Environment = process.env): ClaudeOptions {
  const model = resolveEnv("KURA_CLAUDE_MODEL", env)?.trim() || null;
  const rawEffort = resolveEnv("KURA_CLAUDE_EFFORT", env)?.trim() || null;
  if (rawEffort && !CLAUDE_EFFORTS.has(rawEffort as ClaudeEffort)) {
    throw new Error(
      `KURA_CLAUDE_EFFORT must be one of ${[...CLAUDE_EFFORTS].join(", ")} (got: ${rawEffort})`,
    );
  }
  return { model, effort: rawEffort as ClaudeEffort | null };
}

export function resolveCodexOptions(env: Environment = process.env): CodexOptions {
  const model = resolveEnv("KURA_CODEX_MODEL", env)?.trim() || null;
  const rawEffort = resolveEnv("KURA_CODEX_EFFORT", env)?.trim() || null;
  if (rawEffort && !CODEX_EFFORTS.has(rawEffort as CodexEffort)) {
    throw new Error(
      `KURA_CODEX_EFFORT must be one of ${[...CODEX_EFFORTS].join(", ")} (got: ${rawEffort})`,
    );
  }
  return { model, effort: rawEffort as CodexEffort | null };
}

export function agentExecutable(agent: Generator): string {
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

export function parseCodexJsonl(raw: string): ParsedAgentOutput {
  let complete = false;
  let isError = false;
  let result = "";
  let usage: AgentUsage | null = null;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event: {
      type?: string;
      item?: { type?: string; text?: string };
      usage?: {
        input_tokens?: number;
        cached_input_tokens?: number;
        cache_write_input_tokens?: number;
        output_tokens?: number;
      };
    };
    try {
      event = JSON.parse(line);
    } catch {
      return { complete: false, isError: true, model: null, result: "", usage: null };
    }

    if (event.type === "turn.completed") {
      complete = true;
      if (event.usage) {
        // Codex の event は cost を持たない (token 数のみ)。
        usage = {
          inputTokens: event.usage.input_tokens ?? 0,
          cacheCreationTokens: event.usage.cache_write_input_tokens ?? 0,
          cacheReadTokens: event.usage.cached_input_tokens ?? 0,
          outputTokens: event.usage.output_tokens ?? 0,
          costUsd: null,
        };
      }
    }
    if (event.type === "turn.failed" || event.type === "error") isError = true;
    if (
      event.type === "item.completed" &&
      event.item?.type === "agent_message" &&
      typeof event.item.text === "string"
    ) {
      result = event.item.text;
    }
  }

  // Codex の公開 JSONL event は実行 model を含まない。内部 session file には依存しない。
  return { complete, isError, model: null, result, usage };
}

export function skillPrompt(agent: Generator, skill: string, args: string[]): string {
  const invocation = agent === "claude" ? `/${skill}` : `$${skill}`;
  return [invocation, ...args].join(" ");
}

// model / effort は env で明示されたときだけ flag を注入する — 未設定なら CLI の既定に任せる
// (古い claude CLI は --effort を知らないため、無指定運用を壊さない)。
//
// 無人 Claude に許す tool は固定 allowlist のみで、permission bypass の経路は持たない。
// 生成 skill の契約は「workDir の素材 JSON を Read し、workDir へ generated JSON を Write する」
// だけ。KURA_ROOT の Read は skill 本体（SKILL.md 等）用。
// rule の `//` prefix は filesystem 絶対 path を意味する。headless `-p` では
// allowlist 外の tool は自動 deny されるため、prompt 待ちにはならない。
export function buildClaudeCommand(
  executable: string,
  prompt: string,
  options: ClaudeOptions,
  workDir: string,
): string[] {
  return [
    executable,
    "-p",
    prompt,
    "--output-format",
    "json",
    "--allowedTools",
    [`Read(/${workDir}/**)`, `Write(/${workDir}/**)`, `Read(/${KURA_ROOT}/**)`].join(","),
    ...(options.model ? ["--model", options.model] : []),
    ...(options.effort ? ["--effort", options.effort] : []),
  ];
}

export function buildCodexCommand(
  executable: string,
  prompt: string,
  options: CodexOptions,
): string[] {
  return [
    executable,
    "--ask-for-approval",
    "never",
    "exec",
    "--ephemeral",
    "--sandbox",
    "workspace-write",
    ...(options.model ? ["--model", options.model] : []),
    ...(options.effort
      ? ["--config", `model_reasoning_effort="${options.effort}"`]
      : []),
    "--json",
    prompt,
  ];
}

// repo-owned skill を選択した agent で非対話実行し、出力形式の差を共通結果へ畳む。
// Claude は単一 JSON、Codex は JSONL。途中で接続断・不正出力になった場合は ok=false に倒し、
// 呼び手が stamp を書かず次の trigger で再試行できるようにする。
// workDir = その skill に読み書きを許す唯一の交換 directory。
export function runSkillJson(skill: string, workDir: string, args: string[] = []): AgentJsonRun {
  const agent = resolveGenerator();
  const claudeOptions = agent === "claude" ? resolveClaudeOptions() : null;
  const codexOptions = agent === "codex" ? resolveCodexOptions() : null;
  const prompt = skillPrompt(agent, skill, args);
  const command =
    agent === "claude"
      ? buildClaudeCommand(agentExecutable(agent), prompt, claudeOptions!, workDir)
      : buildCodexCommand(agentExecutable(agent), prompt, codexOptions!);

  const child = Bun.spawnSync(command, {
    env: agentEnv(),
    stdin: "ignore", // stdin 待ちを避け、prompt のみを入力にする
    stdout: "pipe",
    stderr: "inherit",
  });
  const raw = child.stdout?.toString() ?? "";
  const parsed = agent === "claude" ? parseClaudeJson(raw) : parseCodexJsonl(raw);
  const exitCode = child.exitCode ?? 1;

  if (parsed.usage) {
    recordUsage({
      feature: skill,
      agent,
      model: parsed.model ?? claudeOptions?.model ?? codexOptions?.model ?? null,
      ok: exitCode === 0 && parsed.complete && !parsed.isError,
      usage: parsed.usage,
    });
  }

  return {
    ok: exitCode === 0 && parsed.complete && !parsed.isError,
    exitCode,
    isError: parsed.isError,
    model: parsed.model ?? claudeOptions?.model ?? codexOptions?.model ?? null,
    effort: claudeOptions?.effort ?? codexOptions?.effort ?? null,
    result: parsed.result,
    raw,
  };
}
