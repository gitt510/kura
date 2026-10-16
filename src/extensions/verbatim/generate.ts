// generate.ts — 1 prompt を headless Claude で、native が打ったであろう英語に写す。
//
// akapen が断片だけ拾うのに対し、verbatim は文全体を逐語に写す。日本語・英語・romaji の
// 区別は付けない — 「なんだっけ、あー、うーんと、まあ」のような filler も落とさず、native の
// 言い方に置く。引用・code fence・貼り付けは本人の言葉ではないので訳さず [pasted] に畳む。
// 直前の turn を context に渡す: 「これ」「上は」の指示先と口調はそこで決まる。context は
// 参照のみで、訳すのは input だけ。
// tool は使わせない純粋な text→text 変換。KURA_NO_HISTORY=1 で走るので、この呼び出し自身の
// session は history に入らない。失敗した呼び出しは status "error" で返し、retry しない。

import { type ClaudePrompt, resolvePromptGeneration, runClaudePrompt } from "../../agent/run.ts";
import { type KuraConfig, loadConfig } from "../../config.ts";

export interface Turn {
  question: string;
  answer: string;
}

export interface VerbatimInput {
  input: string;
  turns: Turn[]; // 直前の turn、古い順。無ければ []
}

export interface VerbatimResult {
  text: string | null; // ok なら英訳。error なら null
  model: string | null;
  status: "ok" | "error";
}

// context に入れる直前の turn の数と、turn ごとの長さ。
export const CONTEXT_TURNS = 1;
const CONTEXT_CLIP = 1500;

// native の言い回しが価値なので既定は opus (config の既定値)。
// null は CLI の既定に任せる。
export function resolveVerbatimModel(config: KuraConfig = loadConfig()): string | null {
  return resolvePromptGeneration("verbatim", config.extensions.verbatim).model;
}

function isTurn(value: unknown): value is Turn {
  if (!value || typeof value !== "object") return false;
  const turn = value as { question?: unknown; answer?: unknown };
  return typeof turn.question === "string" && typeof turn.answer === "string";
}

// stdin の JSON を検証する。turns は省略可。
export function parseVerbatimInput(raw: string): VerbatimInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`stdin is not JSON: ${error}`);
  }
  const { input, turns = [] } = (parsed ?? {}) as { input?: unknown; turns?: unknown };
  if (typeof input !== "string" || !Array.isArray(turns) || !turns.every(isTurn)) {
    throw new Error(
      'stdin must be {"input": string, "turns"?: [{"question": string, "answer": string}, ...]}',
    );
  }
  return { input, turns };
}

// system が通訳の規則、prompt が直前の turn と 1 回分の入力。
export function buildPrompt({ input, turns }: VerbatimInput): ClaudePrompt {
  const system = [
    "You are a simultaneous interpreter for a Japanese developer talking to their coding agent.",
    "The user message holds the prompt they just typed, inside <input>: Japanese, English, romaji, or any mix. <context> holds the previous exchange, for reference only — to resolve what they refer to and keep their tone. Never translate or mention it.",
    "Say the whole <input> again as a native English-speaking developer would have typed it in that moment: the same sentences in the same order, the same length, the same register and mood.",
    "Keep every filler, hesitation, self-correction, trailing-off and aside (なんだっけ, あー, うーんと, まあ, わすれちゃった) as its natural English equivalent (what was it, uh, hmm, well, I forget) — never drop or tidy them.",
    "Quoted lines (starting with >), fenced code blocks, and pasted material that is not the user's own words are not translated: put [pasted] in their place, once per block, and go on with the user's words around it.",
    "Keep code, file names, commands and identifiers exactly as written.",
    "Do not answer, carry out, explain, add, or shorten anything in the prompt.",
    "Reply with the English alone: no quotes, no notes, no labels, no code fences.",
  ].join("\n");
  const clip = (text: string) => text.slice(0, CONTEXT_CLIP);
  const context = turns
    .slice(-CONTEXT_TURNS)
    .map(
      (turn) => `<user>${clip(turn.question)}</user>\n<assistant>${clip(turn.answer)}</assistant>`,
    )
    .join("\n");
  return { system, prompt: `<context>${context}</context>\n<input>${input}</input>` };
}

export async function generateVerbatim(input: VerbatimInput): Promise<VerbatimResult> {
  const model = resolveVerbatimModel();
  let run;
  try {
    run = await runClaudePrompt(
      "verbatim",
      buildPrompt(input),
      model,
      resolvePromptGeneration("verbatim", loadConfig().extensions.verbatim).effort,
    );
  } catch {
    return { text: null, model, status: "error" }; // claude CLI が無い
  }
  const text = run.result.trim();
  if (!run.ok || !text) {
    const reason = run.stderr.trim().split("\n").pop() ?? "";
    process.stderr.write(
      `verbatim generate failed (exit ${run.exitCode})${reason ? `: ${reason}` : ""}\n`,
    );
    return { text: null, model: run.model, status: "error" };
  }
  return { text, model: run.model, status: "ok" };
}
