// tui.ts — companion の terminal 出力面。server.ts (SSE + HTML) の代替として
// 同じ broadcast/stop 形を持ち、card を log として stdout へ逐次 append する。
// 画面制御はしない — 履歴は terminal の scrollback がそのまま持つ。
//
// 1 card = [meta] → [input] → item 行 → separator。全行が [label] 始まりで本文の桁を
// 揃える (label rail)。pending で [meta] / [input] と仮の「[status] processing …」
// (改行なし) を書き、生成完了でその行を \r + 行クリアで本物の item 行に差し替え、
// 末尾に separator を引いて card を閉じる。
// handle() は poll loop 内で 1 件ずつ await されるため、この差し替えの間に別 prompt の
// 行が割り込むことはない。

import type { CardRow } from "./db.ts";
import { type CardItem, type ItemKind, toCardItem } from "./generate.ts";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";

export interface TuiHandle {
  broadcast(event: unknown): void;
  stop(): void;
}

// note 列を item に戻す。旧 row (string 配列 / plain string / 全文訳) は "note" 扱いの
// 1 行にして捨てずに見せる。
export type LogItem = CardItem | { kind: "note"; text: string };

export function parseItems(card: Pick<CardRow, "note" | "output">): LogItem[] {
  const items: LogItem[] = [];
  if (card.output) items.push({ kind: "note", text: card.output });
  if (!card.note) return items;
  let parsed: unknown;
  try {
    parsed = JSON.parse(card.note);
  } catch {
    return [...items, { kind: "note", text: card.note }];
  }
  if (!Array.isArray(parsed)) return [...items, { kind: "note", text: card.note }];
  for (const raw of parsed) {
    if (typeof raw === "string") {
      if (raw) items.push({ kind: "note", text: raw });
      continue;
    }
    const item = toCardItem(raw);
    if (item) items.push(item);
  }
  return items;
}

// 1 field = 1 行の log にする — 改行と連続空白は 1 空白に潰す。
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// board の主役は item — 自分が打った input は先頭だけ見えれば十分なので切り詰める。
// code point 単位 (全角も 1) の粗い上限で、表示幅までは追わない。
const INPUT_CLIP = 80;
function clipLine(text: string): string {
  const chars = [...oneLine(text)];
  return chars.length > INPUT_CLIP ? `${chars.slice(0, INPUT_CLIP).join("")}…` : chars.join("");
}

// created_at (ISO) を local の yyyy-mm-dd hh:mm:ss に (log の慣習)。読めない値は空。
function stamp(iso: unknown): string {
  const date = new Date(String(iso));
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${ymd} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// 全行を [label] で始め、本文の開始桁を揃える。最長の [natural] / [status] に合わせる。
const LABEL_WIDTH = 10;
function label(name: string, color: string): string {
  return `${color}${`[${name}]`.padEnd(LABEL_WIDTH)}${RESET}`;
}

const SEPARATOR = `${DIM}${"─".repeat(64)}${RESET}`;

// card 先頭の meta 行 — 時刻 · project (cwd の basename) · branch。無い要素は省く。
function metaLine(createdAt: unknown, cwd: unknown, branch: unknown): string {
  const dir = typeof cwd === "string" ? (cwd.split("/").filter(Boolean).pop() ?? "") : "";
  const parts = [stamp(createdAt), dir, typeof branch === "string" ? branch : ""].filter(Boolean);
  return `${label("meta", DIM)}${DIM}${parts.join(" · ")}${RESET}`;
}

// pending が出しておく仮の行。card 側の CLEAR が \r + 行クリアで上書きする。
const PROCESSING = `${label("status", YELLOW)}${DIM}processing …${RESET}`;
const CLEAR = "\r\x1b[K";

const KIND_COLOR: Record<ItemKind | "note", string> = {
  romaji: GREEN,
  grammar: RED,
  natural: YELLOW,
  note: CYAN,
};

// label に kind の色、from は dim、→ の右の to だけ bold — 修正後を縦に拾えるように。
function itemLine(item: LogItem): string {
  if (item.kind === "note") return `${label("note", CYAN)}${oneLine(item.text)}`;
  return `${label(item.kind, KIND_COLOR[item.kind])}${DIM}${oneLine(item.from)}${RESET} → ${BOLD}${oneLine(item.to)}${RESET}`;
}

// broadcast event 1 件を log 出力に変換する。知らない event は null (書かない)。
export function formatEvent(event: unknown): string | null {
  const data = event as {
    type?: string;
    card?: CardRow;
    input?: unknown;
    created_at?: unknown;
    cwd?: unknown;
    branch?: unknown;
  };
  if (data?.type === "pending") {
    const meta = metaLine(data.created_at, data.cwd, data.branch);
    const input = `${label("input", DIM)}${DIM}${clipLine(String(data.input))}${RESET}`;
    return `${meta}\n${input}\n${PROCESSING}`;
  }
  if (data?.type === "card" && data.card) {
    const card = data.card;
    const items = parseItems(card);
    const lines =
      card.status === "error"
        ? [`${label("error", RED)}${RED}generation failed${RESET}`]
        : items.length
          ? items.map(itemLine)
          : [`${label("done", GREEN)}${GREEN}nothing to flag${RESET}`]; // 指摘ゼロも 1 行 — 失敗と区別する
    return `${CLEAR}${lines.join("\n")}\n${SEPARATOR}\n`;
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
