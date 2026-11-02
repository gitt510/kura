export type ItemKind = "romaji" | "grammar" | "natural";
export type Item = { kind: ItemKind; from: string; to: string };
export type Card = { status: "pending" } | { status: "ok"; items: Item[] } | { status: "error" };
// isFlashing の間は、直すところの無い card と失敗した card も pane に出す。
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
// pending は通訳している間。
export type Translation =
  | { status: "pending" }
  | { status: "ok"; text: string }
  | { status: "error" };
// verbatim widget が出す直近の 1 prompt。id は同じ prompt の card / turn と同じ。
export type Sentence = {
  id: string;
  input: string;
  translation: Translation;
  startedAt?: number;
};
// band が id の英訳をどう見せているか。広げているか、閉じたか。
export type BandView = { id: string; isExpanded: boolean; isClosed: boolean };
// `kura config` の mod.sidebar section: Claude Code の横の pane。
export type Sidebar = {
  autoOpen: boolean;
  widgets: string[]; // 上から順、最大 3 つ
  ratio: number[]; // widget ごとの高さの取り分。widgets と同じ数で、合計で割る
};
// `kura config` の mod.sidebar と mod.abovePrompt。akapen / tldr / verbatim の生成は、
// widget がどちらかに載っている間だけ走る。
export type Layout = {
  sidebar: Sidebar;
  abovePrompt: { widgets: string[] }; // prompt 欄の上の band。いまは verbatim だけ
};

// agents widget の 1 行。`claude agents --json` の項目をそのまま持つ。status は status、
// 無ければ state (process の無い background job)。
export type Peer = {
  kind: string;
  sessionId: string;
  name: string;
  cwd: string;
  status: string;
  startedAt: number;
};
// error は `claude agents` を読めなかった理由。lastEvents は session ごとに最後に読んだ event
// (events/<sessionId>.json の name と at)。
export type Agents = {
  peers: Peer[];
  error?: string;
  lastEvents?: Record<string, { name: string; at: number }>;
};

declare module "claude-code" {
  interface PluginState {
    kura: {
      history: Entry[];
      turns: Turn[];
      sentence: Sentence | null;
      bandView: BandView | null;
      layout: Layout | null;
      frame: number;
      agents: Agents;
    };
  }
}
