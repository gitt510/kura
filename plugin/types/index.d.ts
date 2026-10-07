export type ItemKind = "romaji" | "grammar" | "natural";
export type Item = { kind: ItemKind; from: string; to: string };
export type Card = { status: "pending" } | { status: "ok"; items: Item[] } | { status: "error" };
export type Entry = { id: string; input: string; card: Card };
export type Turn = { question: string; answer: string };
export type Tldr = { status: "pending" } | { status: "ok"; text: string } | { status: "error" };
// `kura config` の companion section。null は Claude Code の既定に任せる。
export type Layout = {
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
      tldr: Tldr | null;
      layout: Layout | null;
    };
  }
}
