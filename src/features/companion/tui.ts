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
const CYAN = "\x1b[36m";

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

// board の主役は output — 自分が打った input は先頭だけ見えれば十分なので切り詰める。
// code point 単位 (全角も 1) の粗い上限で、表示幅までは追わない。
const INPUT_CLIP = 80;
function clipLine(text: string): string {
  const chars = [...oneLine(text)];
  return chars.length > INPUT_CLIP ? `${chars.slice(0, INPUT_CLIP).join("")}…` : chars.join("");
}

// created_at (ISO) を local の HH:MM に。読めない値は stamp なし。
function stamp(iso: unknown): string {
  const date = new Date(String(iso));
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// card 先頭の meta 行 — 時刻と project (cwd の basename)。[input] 行を内容専用に
// 保つための行で、出せる要素が無ければ行ごと省く。
function metaLine(createdAt: unknown, cwd: unknown): string {
  const dir = typeof cwd === "string" ? (cwd.split("/").filter(Boolean).pop() ?? "") : "";
  const parts = [stamp(createdAt), dir].filter(Boolean);
  return parts.length ? `${DIM}${parts.join(" · ")}${RESET}\n` : "";
}

// pending が出しておく仮の行。card 側の CLEAR が \r + 行クリアで上書きする。
const PROCESSING = `${DIM}[output] processing …${RESET}`;
const CLEAR = "\r\x1b[K";

// broadcast event 1 件を log 出力に変換する。知らない event は null (書かない)。
export function formatEvent(event: unknown): string | null {
  const data = event as {
    type?: string;
    card?: CardRow;
    input?: unknown;
    created_at?: unknown;
    cwd?: unknown;
  };
  if (data?.type === "pending") {
    const meta = metaLine(data.created_at, data.cwd);
    return `${meta}${DIM}[input]${RESET} ${DIM}${clipLine(String(data.input))}${RESET}\n${PROCESSING}`;
  }
  if (data?.type === "card" && data.card) {
    const card = data.card;
    if (card.status === "error") return `${CLEAR}${RED}[output] generation failed${RESET}\n\n`;
    const lines = [`${GREEN}[output]${RESET} ${GREEN}${BOLD}${oneLine(card.output ?? "")}${RESET}`];
    // note は学習 feedback の本体 — dim の input と混ざらないよう label だけ色を付け、
    // 本文は通常輝度で読ませる。
    for (const note of parseNotes(card.note)) {
      lines.push(`${CYAN}[note]${RESET} ${oneLine(note)}`);
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
