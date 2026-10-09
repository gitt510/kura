// generate.ts — agent の最新の回答を headless Claude で 3 行に圧縮する。
//
// 会話の続きとして作る: model は会話の assistant 本人として、長い回答への user の
// 「長い。3行で。」に答える。その次の返答が要約になる — 回答を外から要約させると、
// 回答の翻訳のような 3 行になる。形式は縛らない (縛るほど言い回しの幅が狭まる)。
// 同じ返答の先頭行に、最後の question を 1 行にまとめたものを `> ` 付きで書かせる。pane は
// 長い question をそのまま出せないので、その 1 行を question の代わりに出す。
// tool は使わせない。失敗した呼び出しは status "error" で返し、retry しない。

import { type ClaudePrompt, resolvePromptGeneration, runClaudePrompt } from "../../agent/run.ts";
import { type KuraConfig, loadConfig } from "../../config.ts";

export interface Turn {
  question: string;
  answer: string;
}

export interface TldrInput {
  turns: Turn[]; // 古い順。最後の turn の answer を圧縮する
}

export interface TldrResult {
  text: string | null; // ok なら 3 行の要約。error なら null
  question: string | null; // 最後の question の 1 行要約。返答が先頭行に書かなければ null
  model: string | null;
  status: "ok" | "error";
}

export const CONTEXT_TURNS = 3;
const CONTEXT_CLIP = 1500;

export function resolveTldrModel(config: KuraConfig = loadConfig()): string {
  return resolvePromptGeneration("tldr", config.features.tldr).model ?? "opus";
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

export const ASK =
  "長い。3行で。それと、私の最後の質問を 1 行にまとめて、最初の行に `> ` を付けて書いて。";

// 先頭行が `> ` なら question の 1 行要約として取り出し、残りを要約にする。
export function splitReply(reply: string): { question: string | null; text: string } {
  const [first, ...rest] = reply.trim().split("\n");
  const question = first.match(/^>\s*(.+)$/)?.[1]?.trim();
  if (!question || rest.join("\n").trim() === "") return { question: null, text: reply.trim() };
  return { question, text: rest.join("\n").trim() };
}

// system が要約する turn までの会話、prompt が user の次の発話。直前の turn は切り詰める。
export function buildPrompt(input: TldrInput): ClaudePrompt {
  const earlier = input.turns.slice(0, -1).slice(-CONTEXT_TURNS);
  const clip = (text: string) => text.slice(0, CONTEXT_CLIP);
  const turns = [
    ...earlier.map((turn) => ({ question: clip(turn.question), answer: clip(turn.answer) })),
    input.turns.at(-1)!,
  ].map((turn) => `<user>${turn.question}</user>\n<assistant>${turn.answer}</assistant>`);
  return {
    system: [
      `<conversation>\n${turns.join("\n")}\n</conversation>`,
      "",
      "You are the assistant in this conversation. Reply to the user's next message.",
    ].join("\n"),
    prompt: ASK,
  };
}

export async function generateTldr(input: TldrInput): Promise<TldrResult> {
  const model = resolveTldrModel();
  let run;
  try {
    run = await runClaudePrompt(
      "tldr",
      buildPrompt(input),
      model,
      resolvePromptGeneration("tldr", loadConfig().features.tldr).effort,
    );
  } catch {
    return { text: null, question: null, model, status: "error" }; // claude CLI が無い
  }
  const text = run.result.trim();
  if (!run.ok || !text) {
    const reason = run.stderr.trim().split("\n").pop() ?? "";
    process.stderr.write(
      `tldr generate failed (exit ${run.exitCode})${reason ? `: ${reason}` : ""}\n`,
    );
    return { text: null, question: null, model: run.model, status: "error" };
  }
  return { ...splitReply(text), model: run.model, status: "ok" };
}
