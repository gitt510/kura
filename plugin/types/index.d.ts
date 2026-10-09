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

export type FileKind = "added" | "changed" | "deleted";
// worktree の 1 file。preview は diff の最初の hunk を PREVIEW_LINES 行に切ったもの (無ければ "")、
// more はそこに入らなかった変更行の数。
export type FileRow = {
  path: string;
  kind: FileKind;
  added: number;
  removed: number;
  preview: string;
  more: number;
};
// editing は Edit / Write / NotebookEdit が今触っている repo 相対の path。root は repo の絶対 path
// (分かるまで "")。error は worktree を読めなかった理由。
export type Glance = {
  rows: FileRow[];
  editing: string[];
  root: string;
  branch: string;
  error?: string;
};

declare module "claude-code" {
  interface PluginState {
    kura: {
      history: Entry[];
      turns: Turn[];
      layout: Layout | null;
      frame: number;
      glance: Glance;
    };
  }
}
