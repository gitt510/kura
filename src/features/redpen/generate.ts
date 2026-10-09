// generate.ts — 1 prompt を headless Claude で英語 feedback に変換する。
//
// tool は使わせない純粋な text→JSON 変換。KURA_NO_HISTORY=1 で走るので、
// この呼び出し自身の session は history に入らない。
// 失敗した呼び出しは status "error" で返し、retry しない。
//
// 契約は 1 つ — 入力の言語は判定しない。LLM が入力を断片に分けて種類を付けて返す。
// 全文の英訳 / 書き換えは出さない (文字が多くて読まれなくなる)。欲しいのは自分で
// 英文を組み立てる時の parts — だから kana / 漢字の日本語も対象外。romaji は
// 「英文を組もうとして単語が出てこず挫折した跡」なので、そこだけ拾う。

import { type ClaudePrompt, resolvePromptGeneration, runClaudePrompt } from "../../agent/run.ts";
import { type KuraConfig, loadConfig } from "../../config.ts";

export interface GenerateInput {
  input: string;
  context: string | null; // 同 session の直前の assistant 出力 (無ければ null)
}

// item の種類:
//   romaji  : romaji で書かれた日本語 → 英語
//   grammar : 意味が変わる文法ミス → 修正 (規則名は日本語)
//   natural : 文法は合っているが不自然な英語 → native の言い方
// typo は意図的に無い — 指が滑っただけで学習価値が無く、毎回発火して他を埋める。
export const ITEM_KINDS = ["romaji", "grammar", "natural"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface CardItem {
  kind: ItemKind;
  from: string;
  to: string;
}

export interface GenerateResult {
  items: CardItem[] | null; // ok なら配列 (指摘ゼロは [])。error なら null
  model: string | null;
  status: "ok" | "error";
}

// 速さより質 — parts の切り方と訳語の自然さが価値なので既定は opus (config の既定値)。
export function resolveRedpenModel(config: KuraConfig = loadConfig()): string {
  return resolvePromptGeneration("redpen", config.features.redpen).model ?? "opus";
}

const CONTEXT_CLIP = 1200;
const MAX_ITEMS = 5;

// system が coach の規則、prompt が 1 回分の素材 (直前の文脈と入力)。
export function buildPrompt(job: GenerateInput): ClaudePrompt {
  const context = (job.context ?? "").slice(0, CONTEXT_CLIP);
  const system = [
    "You are an English coach for a Japanese developer.",
    "The user message holds a prompt the user typed to their coding agent mid-conversation. It may be Japanese, English, or a mix.",
    "Do NOT translate or rewrite the whole input. Pick out only the fragments worth feedback and return them as items. The user assembles English by themselves from these parts.",
    "Item kinds:",
    '- "romaji": Japanese written in Latin letters (e.g. "housin", "taiou suru") — the user tried to write English and fell back to romaji for a word they did not know → the natural, casual English a native developer would type.',
    '- "grammar": an English grammar mistake that changes or obscures the meaning (tense, prepositions, word order, missing auxiliaries) → the fix, e.g. "I\'m working on it since Monday" → "I\'ve been working on it since Monday".',
    '- "natural": grammatical but unnatural English → how a native developer would say it, keeping the original intent.',
    "Japanese written in kana or kanji is NOT feedback material — ignore it entirely, even when it is the whole input.",
    "Never make items for: spelling, typos, punctuation, articles, tone, code, file names, commands, or English that is already natural.",
    '"to" is the English alone — no explanation, rule name, or note in parentheses, in any language.',
    '"from" must be a verbatim fragment of <input>. <context> is reference only, to resolve what the user is talking about — never make items from it.',
    "One item per fragment — never report the same fragment under two kinds.",
    `At most ${MAX_ITEMS} items, in the order they appear in the input.`,
    'Do not use any tools. Reply with JSON only, no code fences, in this shape (kind is one of "romaji", "grammar", "natural"):',
    '{"items": [{"kind": "romaji", "from": "...", "to": "..."}]}',
    'If nothing is worth feedback, reply exactly {"items": []}.',
  ].join("\n");
  return { system, prompt: `<context>${context}</context>\n<input>${job.input}</input>` };
}

function isKind(value: unknown): value is ItemKind {
  return typeof value === "string" && (ITEM_KINDS as readonly string[]).includes(value);
}

// 1 要素を item に正規化する。null / 非 object / kind 不明 / from・to 欠落は null。
function toCardItem(raw: unknown): CardItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as { kind?: unknown; from?: unknown; to?: unknown };
  if (!isKind(item.kind)) return null;
  if (typeof item.from !== "string" || !item.from.trim()) return null;
  if (typeof item.to !== "string" || !item.to.trim()) return null;
  return { kind: item.kind, from: item.from.trim(), to: item.to.trim() };
}

// LLM の返答から items を取り出す。code fence で包まれても受ける。
// 不正な要素は落とし、items が配列でなければ null。
export function parseCardJson(result: string): CardItem[] | null {
  const body = result.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, "");
  try {
    const parsed = JSON.parse(body) as { items?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    const items = parsed.items.map(toCardItem).filter((item): item is CardItem => item !== null);
    return items.slice(0, MAX_ITEMS);
  } catch {
    return null;
  }
}

export async function generateCard(job: GenerateInput): Promise<GenerateResult> {
  const model = resolveRedpenModel();
  let run;
  try {
    run = await runClaudePrompt(
      "redpen",
      buildPrompt(job),
      model,
      resolvePromptGeneration("redpen", loadConfig().features.redpen).effort,
    );
  } catch {
    return { items: null, model, status: "error" }; // claude CLI が無い
  }

  const items = run.ok ? parseCardJson(run.result) : null;
  if (!items) {
    // card は "generation failed" のまま、原因は起動 terminal 側で診断できるようにする。
    const reason = run.stderr.trim().split("\n").pop() ?? "";
    process.stderr.write(
      `redpen generate failed (exit ${run.exitCode})${reason ? `: ${reason}` : ""}\n`,
    );
    return { items: null, model: run.model, status: "error" };
  }
  return { items, model: run.model, status: "ok" };
}
