// generate.ts — 1 prompt を headless Claude で英語 feedback に変換する。
//
// tool は使わせない純粋な text→JSON 変換。KURA_NO_HISTORY=1 で走るので、
// この呼び出し自身の session は history にも companion にも入らない。
// 失敗した呼び出しは error card として残し、retry しない。

import { agentExecutable, parseClaudeJson } from "../../lib/agent.ts";
import { resolveEnv } from "../../lib/config.ts";

export interface GenerateInput {
  input: string;
  lang: "ja" | "en";
  context: string | null; // 同 session の直前の assistant 出力 (無ければ null)
}

export interface GenerateResult {
  english: string | null;
  note: string | null;
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

export function buildPrompt(job: GenerateInput): string {
  const context = (job.context ?? "").slice(0, CONTEXT_CLIP);
  return [
    "You are an English coach for a Japanese developer.",
    "The input below is a prompt the user typed to their coding agent mid-conversation.",
    'If the input is Japanese: translate it into the natural, casual English the user could have typed instead.',
    "If the input is English: rewrite it as more natural English; if it is already natural, return it unchanged.",
    "Do not use any tools. Reply with JSON only, no code fences:",
    '{"english": "...", "note": "..."}',
    'note: one short Japanese sentence — for Japanese input, the one phrase worth remembering; for English input, what you changed and why, or "OK 👍" if unchanged.',
    "",
    `<context>${context}</context>`,
    `<input lang="${job.lang}">${job.input}</input>`,
  ].join("\n");
}

// LLM の返答から card の中身を取り出す。code fence で包まれても受ける。
export function parseCardJson(result: string): { english: string; note: string } | null {
  const body = result.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, "");
  try {
    const parsed = JSON.parse(body) as { english?: unknown; note?: unknown };
    if (typeof parsed.english !== "string" || !parsed.english.trim()) return null;
    return {
      english: parsed.english,
      note: typeof parsed.note === "string" ? parsed.note : "",
    };
  } catch {
    return null;
  }
}

export async function generateCard(job: GenerateInput): Promise<GenerateResult> {
  const model = resolveCompanionModel();
  let executable: string;
  try {
    executable = agentExecutable("claude");
  } catch {
    return { english: null, note: null, model, status: "error" };
  }

  const child = Bun.spawn(
    [executable, "-p", buildPrompt(job), "--output-format", "json", "--model", model],
    {
      env: { ...process.env, KURA_NO_HISTORY: "1" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    },
  );
  const raw = await new Response(child.stdout).text();
  const exitCode = await child.exited;

  const parsed = parseClaudeJson(raw);
  const card = exitCode === 0 && !parsed.isError ? parseCardJson(parsed.result) : null;
  if (!card) return { english: null, note: null, model: parsed.model ?? model, status: "error" };
  return { english: card.english, note: card.note, model: parsed.model ?? model, status: "ok" };
}
