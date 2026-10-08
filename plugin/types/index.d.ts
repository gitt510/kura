export type ItemKind = "romaji" | "grammar" | "natural";
export type Item = { kind: ItemKind; from: string; to: string };
export type Card = { status: "pending" } | { status: "ok"; items: Item[] } | { status: "error" };
// isFlashing の間は、直すところの無い card も pane に一瞬だけ出す。
export type Entry = { id: string; input: string; card: Card; isFlashing?: boolean };
// answering は main loop が回答している間、pending は要約している間。
export type Tldr =
  | { status: "answering" }
  | { status: "pending" }
  | { status: "ok"; text: string; question?: string }
  | { status: "error" };
export type Turn = { id: string; question: string; answer: string; summary: Tldr };
// `kura config` の companion section。null は Claude Code の既定に任せる。
export type Layout = {
  enabled: boolean;
  autoOpen: boolean;
  columns: number | null;
  rows: number | null;
  widgets: { id: string; share: number }[];
};

declare module "claude-code" {
  interface PluginState {
    kura: {
      history: Entry[];
      turns: Turn[];
      layout: Layout | null;
      frame: number;
    };
  }
}
