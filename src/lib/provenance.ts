// provenance.ts — 実行中の agent session 自身の model / effort を introspect する。
//
// GEN worker や対話 session の中から insert / publish が呼ばれる前提。
// 宣言値 (--model / env での指定) は実態と乖離しうるので、実際に動いた値を自己参照で取る:
//   - model : $CLAUDE_CODE_SESSION_ID で自分の transcript を特定し、最後の assistant message の
//             message.model を読む (history/sources/claude.ts と同じ transcript 契約の再利用)。
//   - effort: $CLAUDE_EFFORT (CLI が subprocess に注入する。undocumented なので無ければ null)。
// session 外・transcript 不在など取れないケースはすべて null に倒す (表示側で省略/"-" にする)。

import { existsSync, readdirSync, readFileSync } from "node:fs";

export interface Provenance {
  model: string | null;
  effort: string | null;
}

// transcript JSONL を末尾から走査し、最後の assistant message の model を返す。
export function latestAssistantModel(transcriptPath: string): string | null {
  try {
    const lines = readFileSync(transcriptPath, "utf-8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i]) continue;
      try {
        const entry = JSON.parse(lines[i]) as { type?: string; message?: { model?: string } };
        if (entry.type === "assistant" && entry.message?.model) return entry.message.model;
      } catch {
        continue;
      }
    }
  } catch {
    /* transcript が読めない → null */
  }
  return null;
}

// 自分の transcript を探す。project dir 名は cwd 由来の munge で再現しづらいので、
// ~/.claude/projects/*/<session_id>.jsonl を総当たりする (dir は数十件なので安い)。
function findOwnTranscript(): string | null {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
  const home = process.env.HOME;
  if (!sessionId || !home) return null;
  const projects = `${home}/.claude/projects`;
  try {
    for (const dir of readdirSync(projects)) {
      const candidate = `${projects}/${dir}/${sessionId}.jsonl`;
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    /* projects dir が無い → null */
  }
  return null;
}

export function selfProvenance(): Provenance {
  const transcript = findOwnTranscript();
  return {
    model: transcript ? latestAssistantModel(transcript) : null,
    effort: process.env.CLAUDE_EFFORT?.trim() || null,
  };
}

// 自動経路用の provenance。agent の公開出力または invocation の明示指定値を包む。
// effort は自動判定値を取らず、呼び手が明示指定値を取得できた場合だけ保持する。
export function runProvenance(model: string | null, effort: string | null = null): Provenance {
  return { model, effort };
}

// 名前表示用の一行 ("<model> (<effort>)") — webhook username などにそのまま使う。
// model が取れないとき effort 単独では出所を示せないので null (fallback の判断は呼び手)。
export function provenanceName(model: string | null, effort: string | null): string | null {
  if (!model) return null;
  return effort ? `${model} (${effort})` : model;
}
