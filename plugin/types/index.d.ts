export type ItemKind = "romaji" | "grammar" | "natural";
export type Item = { kind: ItemKind; from: string; to: string };
export type Card = { status: "pending" } | { status: "ok"; items: Item[] } | { status: "error" };
// isFlashing の間は、直すところの無い card も pane に一瞬だけ出す。
// startedAt は spinner が経った秒数を出す起点 (ms)。
export type Entry = {
  id: string;
  input: string;
  card: Card;
  isFlashing?: boolean;
  startedAt?: number;
};
// answering は main loop が回答している間、pending は要約している間。
export type Tldr =
  | { status: "answering" }
  | { status: "pending" }
  | { status: "ok"; text: string; question?: string }
  | { status: "error" };
export type Turn = {
  id: string;
  question: string;
  answer: string;
  summary: Tldr;
  startedAt?: number;
};
// `kura config` の mod.companion section。null は Claude Code の既定に任せる。
export type Layout = {
  autoOpen: boolean;
  columns: number | null;
  rows: number | null;
  widgets: string[]; // 上から順、最大 2 つ。redpen / tldr の生成はここに載っている間だけ
  ratio: number; // 上の widget が占める高さの割合。1 つなら無視
};

// sessions widget の 1 行。`claude agents --json` の項目をそのまま持つ。status は status、
// 無ければ state (process の無い background job)。isSelf はこの session か。
export type Peer = {
  kind: string;
  sessionId: string;
  name: string;
  cwd: string;
  status: string;
  startedAt: number;
  isSelf: boolean;
};
// error は `claude agents` を読めなかった理由。
export type Sessions = { peers: Peer[]; error?: string };

declare module "claude-code" {
  interface PluginState {
    kura: {
      history: Entry[];
      turns: Turn[];
      layout: Layout | null;
      frame: number;
      sessions: Sessions;
    };
  }
}
