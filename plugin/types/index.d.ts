export type ItemKind = "romaji" | "grammar" | "natural";
export type Item = { kind: ItemKind; from: string; to: string };
export type Card = { status: "pending" } | { status: "ok"; items: Item[] } | { status: "error" };
export type Entry = { id: string; input: string; card: Card };
export type Tldr = { status: "pending" } | { status: "ok"; text: string } | { status: "error" };
// summary は pane が見えていなかった turn では null: 要約を作っていない。
export type Turn = { id: string; question: string; answer: string; summary: Tldr | null };
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
    };
  }
}
