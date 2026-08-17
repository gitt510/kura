// tui.ts — companion の terminal 出力面。server.ts (SSE + HTML) の代替として
// 同じ broadcast/stop 形を持ち、card を log として stdout へ逐次 append する。
// 画面制御はしない — 履歴は terminal の scrollback がそのまま持つ。
//
// pending で [input] と仮の「[output] processing …」(改行なし) を書き、生成完了で
// その行を \r + 行クリアで本物の [output] / [note] に差し替える。handle() は
// poll loop 内で 1 件ずつ await されるため、この差し替えの間に別 prompt の行が
// 割り込むことはない。

import type { CardRow } from "./db.ts";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";

export interface TuiHandle {
  broadcast(event: unknown): void;
  stop(): void;
}

// note は JSON 配列文字列だが、配列化以前の plain string row も受ける (page と同じ)。
function parseNotes(note: string | null): string[] {
  if (!note) return [];
  try {
    const parsed = JSON.parse(note);
    return Array.isArray(parsed) ? parsed.map(String) : [note];
  } catch {
    return [note];
  }
}

// 1 field = 1 行の log にする — 改行と連続空白は 1 空白に潰す。
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// pending が出しておく仮の行。card 側の CLEAR が \r + 行クリアで上書きする。
const PROCESSING = `${DIM}[output] processing …${RESET}`;
const CLEAR = "\r\x1b[K";

// broadcast event 1 件を log 出力に変換する。知らない event は null (書かない)。
export function formatEvent(event: unknown): string | null {
  const data = event as { type?: string; card?: CardRow; input?: unknown };
  if (data?.type === "pending") {
    return `${DIM}[input]${RESET} ${DIM}${oneLine(String(data.input))}${RESET}\n${PROCESSING}`;
  }
  if (data?.type === "card" && data.card) {
    const card = data.card;
    if (card.status === "error") return `${CLEAR}${RED}[output] generation failed${RESET}\n\n`;
    const lines = [`${GREEN}[output]${RESET} ${GREEN}${BOLD}${oneLine(card.output ?? "")}${RESET}`];
    for (const note of parseNotes(card.note)) {
      lines.push(`${DIM}[note] ${oneLine(note)}${RESET}`);
    }
    return `${CLEAR}${lines.join("\n")}\n\n`;
  }
  return null;
}

export function startTui(): TuiHandle {
  return {
    broadcast(event: unknown): void {
      const text = formatEvent(event);
      if (text) process.stdout.write(text);
    },
    stop(): void {},
  };
}
