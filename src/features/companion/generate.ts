// generate.ts — 1 prompt を headless Claude で英語 feedback に変換する。
//
// tool は使わせない純粋な text→JSON 変換。KURA_NO_HISTORY=1 で走るので、
// この呼び出し自身の session は history にも companion にも入らない。
// 失敗した呼び出しは error card として残し、retry しない。

import { runClaudePrompt } from "../../lib/agent.ts";
import { resolveEnv } from "../../lib/config.ts";

export interface GenerateInput {
  input: string;
  lang: "ja" | "en";
  context: string | null; // 同 session の直前の assistant 出力 (無ければ null)
}

// output: 入力への英語 feedback 本文。LLM との JSON 契約上の key は "english" の
// まま (そこでは実際に英語そのものを指す) — 境界のここで output に読み替える。
export interface GenerateResult {
  output: string | null;
  notes: string[] | null;
  model: string | null;
  status: "ok" | "error";
}

// 頻度が高く軽いタスクなので既定は haiku。
export function resolveCompanionModel(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return resolveEnv("KURA_COMPANION_MODEL", env)?.trim() || "haiku";
}

const CONTEXT_CLIP = 1200;

// ja と en で契約を分ける。ja は英訳だけ (note は要約にしかならず読む価値が無い)。
// en は文法 feedback が主役 — ただし note は意味が変わるミスに絞る。冠詞・綴りは
// output との diff で見えるので note にしない (毎回発火して他の指摘を埋める)。
export function buildPrompt(job: GenerateInput): string {
  const context = (job.context ?? "").slice(0, CONTEXT_CLIP);
  const head = [
    "You are an English coach for a Japanese developer.",
    "The input below is a prompt the user typed to their coding agent mid-conversation.",
  ];
  const body =
    job.lang === "ja"
      ? [
          "Translate the input into the natural, casual English the user could have typed instead.",
          "Prefer idiomatic phrasing over a literal rendering — do not mirror the Japanese structure.",
          "Do not use any tools. Reply with JSON only, no code fences:",
          '{"english": "..."}',
        ]
      : [
          "Rewrite the input as the natural English a native developer would type — do not mirror the original sentence structure. If it is already natural, return it unchanged.",
          "Do not use any tools. Reply with JSON only, no code fences:",
          '{"english": "...", "notes": ["...", "..."]}',
          "notes: at most 2 short Japanese bullets about grammar mistakes in the original that affect meaning (verb agreement, tense, prepositions, word order).",
          'Format each bullet exactly as 原文の断片 → 修正（規則名は日本語）, e.g. "What determine → What determines（三単現の -s）".',
          "Never note articles, spelling, punctuation, tone, or word choice.",
          'If the original has no such grammar mistakes, reply notes: ["文法は OK 👍"].',
        ];
  return [
    ...head,
    ...body,
    "",
    `<context>${context}</context>`,
    `<input lang="${job.lang}">${job.input}</input>`,
  ].join("\n");
}

// LLM の返答から card の中身を取り出す。code fence で包まれても、
// 契約前の単数形 note で返ってきても受ける。
export function parseCardJson(result: string): { english: string; notes: string[] } | null {
  const body = result.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, "");
  try {
    const parsed = JSON.parse(body) as { english?: unknown; notes?: unknown; note?: unknown };
    if (typeof parsed.english !== "string" || !parsed.english.trim()) return null;
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.filter((item): item is string => typeof item === "string" && item !== "")
      : typeof parsed.note === "string" && parsed.note !== ""
        ? [parsed.note]
        : [];
    return { english: parsed.english, notes };
  } catch {
    return null;
  }
}

export async function generateCard(job: GenerateInput): Promise<GenerateResult> {
  const model = resolveCompanionModel();
  let run;
  try {
    run = await runClaudePrompt("companion", buildPrompt(job), model);
  } catch {
    return { output: null, notes: null, model, status: "error" }; // claude CLI が無い
  }

  const card = run.ok ? parseCardJson(run.result) : null;
  if (!card) {
    // card は "generation failed" のまま、原因は起動 terminal 側で診断できるようにする。
    const reason = run.stderr.trim().split("\n").pop() ?? "";
    process.stderr.write(
      `companion generate failed (exit ${run.exitCode})${reason ? `: ${reason}` : ""}\n`,
    );
    return { output: null, notes: null, model: run.model, status: "error" };
  }
  // ja は英訳のみが契約 — model が notes を返してきても落とす。
  const notes = job.lang === "ja" ? [] : card.notes;
  return { output: card.english, notes, model: run.model, status: "ok" };
}
