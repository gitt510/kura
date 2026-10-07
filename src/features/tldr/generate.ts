// generate.ts — agent の最新の回答を headless Claude で 3 行に圧縮する。
//
// 指示は「長い。3行で。」だけに留める — 形式を縛るほど model の言い回しの幅が狭まり、
// 読みやすさは上がらない。直前の turn は何の話かを解決するための参考として渡す。
// tool は使わせない。失敗した呼び出しは status "error" で返し、retry しない。

import { runClaudePrompt } from "../../lib/agent.ts";
import { type KuraConfig, loadConfig } from "../../lib/config.ts";

export interface Turn {
  question: string;
  answer: string;
}

export interface TldrInput {
  turns: Turn[]; // 古い順。最後の turn の answer を圧縮する
}

export interface TldrResult {
  text: string | null; // ok なら 3 行の要約。error なら null
  model: string | null;
  status: "ok" | "error";
}

export const CONTEXT_TURNS = 3;
const CONTEXT_CLIP = 1500;

export function resolveTldrModel(config: KuraConfig = loadConfig()): string {
  return config.tldr.model;
}

function isTurn(value: unknown): value is Turn {
  if (!value || typeof value !== "object") return false;
  const turn = value as { question?: unknown; answer?: unknown };
  return typeof turn.question === "string" && typeof turn.answer === "string";
}

// stdin の JSON を検証する。answer が空の最後の turn は圧縮対象にならないので拒否する。
export function parseTldrInput(raw: string): TldrInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`stdin is not JSON: ${error}`);
  }
  const turns = (parsed as { turns?: unknown } | null)?.turns;
  if (!Array.isArray(turns) || turns.length === 0 || !turns.every(isTurn)) {
    throw new Error('stdin must be {"turns": [{"question": string, "answer": string}, ...]}');
  }
  if (!turns.at(-1)!.answer.trim()) throw new Error("the last turn has an empty answer");
  return { turns };
}

export function buildPrompt(input: TldrInput): string {
  const target = input.turns.at(-1)!;
  const context = input.turns
    .slice(0, -1)
    .slice(-CONTEXT_TURNS)
    .map(
      (turn) =>
        `<turn>\n<question>${turn.question.slice(0, CONTEXT_CLIP)}</question>\n` +
        `<answer>${turn.answer.slice(0, CONTEXT_CLIP)}</answer>\n</turn>`,
    );
  return [
    ...(context.length > 0 ? [`<context>\n${context.join("\n")}\n</context>`, ""] : []),
    `<question>${target.question}</question>`,
    "",
    `<answer>${target.answer}</answer>`,
    "",
    "長い。3行で。",
  ].join("\n");
}

export async function generateTldr(input: TldrInput): Promise<TldrResult> {
  const model = resolveTldrModel();
  let run;
  try {
    run = await runClaudePrompt("tldr", buildPrompt(input), model);
  } catch {
    return { text: null, model, status: "error" }; // claude CLI が無い
  }
  const text = run.result.trim();
  if (!run.ok || !text) {
    const reason = run.stderr.trim().split("\n").pop() ?? "";
    process.stderr.write(
      `tldr generate failed (exit ${run.exitCode})${reason ? `: ${reason}` : ""}\n`,
    );
    return { text: null, model: run.model, status: "error" };
  }
  return { text, model: run.model, status: "ok" };
}
