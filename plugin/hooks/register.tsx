// register.tsx — kura companion: Claude Code の横に、打った prompt の英語 feedback (akapen) と
// 直近の prompt の native 英訳 (verbatim) と、回答ごとの 3 行要約 (tldr) と、mod を読み込んだ
// 全 session の status (agents) を積む pane。
//
// 生成は kura の subcommand (`kura akapen` / `kura verbatim` / `kura tldr`) が持ち、usage も kura が記録する。
// この mod は呼んで表示するだけ。配置は `kura config` の mod.companion section が決める。
// widget が mod.companion.widgets に載っている間、その生成は session の始めから pane と関係なく
// 常に走り、pane はたまったものをいつでも見せる。載っていなければ何もしない。
//
// /kura-handoff も置く: この session の id を `kura handoff` に渡し、tmux の右に新しい
// Claude Code を開く。pane を開くのも system prompt を組むのも kura が持つ。

import type { EngineInterface, Register, RenderElement, Timer } from "claude-code";
import { atom, read, update } from "claude-code";
import type {
  Agents,
  Card,
  Entry,
  Item,
  ItemKind,
  Layout,
  Peer,
  Sentence,
  Tldr,
  Translation,
  Turn,
} from "../types";

const PANE = "kura-companion";
const COMMAND = "kura-companion";
const HANDOFF = "kura-handoff";
// 人が最後に pane を開いていたか閉じていたか。$.store に session をまたいで残し、autoOpen より優先する。
const IS_OPEN_KEY = "isPaneOpen";
const HISTORY_LIMIT = 30;
// 要約する turn と、kura tldr が context として読む直前の 3 turn。
const CONTEXT_TURNS = 4;
const TIMEOUT_MS = 120_000;
// 直すところの無い card を pane に出しておく時間。
const FLASH_MS = 2_000;
// 生成に失敗した card を pane に出しておく時間。見ても打つ手が無いので、残し続けない。
const ERROR_MS = 30_000;
// kura verbatim に context として渡す直前の turn の数。
const VERBATIM_CONTEXT = 1;

// 打った prompt ごとに 1 entry、古い順。band は最新を、pane は全部を出す。
const history = atom({ plugin: "kura", key: "history" } as const, []);
// 直近に打った prompt とその native 英訳。1 つだけ持ち、次の prompt で置き換わる。
const sentence = atom({ plugin: "kura", key: "sentence" } as const, null);
// main loop の question / answer とその要約、古い順。turn は prompt を打った時点で積み、回答で埋める。
const turns = atom({ plugin: "kura", key: "turns" } as const, []);
// session の始めか pane を開いたときに読んだ `kura config` の mod.companion section。
const layout = atom({ plugin: "kura", key: "layout" } as const, null);
// spinner が描く時刻 (ms)。生成を待つものがある間だけ TICK_MS ごとに進む。
const frame = atom({ plugin: "kura", key: "frame" } as const, 0);
// agents widget が最後に読んだ `claude agents --json`。自分も含む。
const agents = atom({ plugin: "kura", key: "agents" } as const, { peers: [] } as Agents);

type Elements = ReturnType<EngineInterface["ui"]["resolve"]>;

async function kura($: EngineInterface, args: string[], stdin?: string): Promise<string> {
  const run = await $.process.run(["kura", ...args], { stdin, timeoutMs: TIMEOUT_MS });
  if (run.exitCode !== 0) {
    const reason = run.stderr.trim().split("\n").pop() || `exit ${run.exitCode}`;
    throw new Error(`kura ${args[0]}: ${reason}`);
  }
  return run.stdout;
}

// ---- spinner ----

// 記号は行って戻る。文言と色は待っている item ごとに id から 1 つ選び、待つ間は変えない。
const GLYPHS = ["·", "✢", "✳", "✶", "✻", "✽"];
const CYCLE = [...GLYPHS, ...GLYPHS.slice(1, -1).reverse()];
const TICK_MS = 120;
// akapen と tldr で共通: 同じ prompt の card と turn は同じ id なので、同じ文言と色になる。
const WORDS = ["Pondering", "Distilling", "Brewing", "Mulling", "Polishing", "Simmering"];
// 色は ANSI 16 の名前だけで指定し、実際の RGB は terminal の theme に任せる。
const HUES = ["yellow", "magenta", "cyan", "blue", "green"];

function pick<T>(list: T[], id: string, salt: number): T {
  let hash = salt;
  for (const char of id) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return list[hash % list.length];
}

// 本家の spinner と同じく、文言の後ろに経った秒数と何を待っているかを dim で添える。
// 光を text の左外から右外へ流し、少し間を置いてまた左から。明るさは 3 段: 芯は bright の
// 太字、両隣は通常の色、その外は dim。長さ span の行の一部なら、offset はその中での位置で、
// その外も dim にせず通常の色にする。
function glow(
  elements: Elements,
  hue: string,
  text: string,
  now: number,
  offset = 0,
  span = [...text].length,
): RenderElement {
  const { Text } = elements;
  const chars = [...text];
  const isPart = offset > 0 || span !== chars.length;
  const at = (Math.floor(now / TICK_MS) % (span + 8)) - 3 - offset;
  return (
    <Text>
      {chars.map((char, index) => {
        const distance = Math.abs(index - at);
        return (
          <Text
            key={index}
            color={distance === 0 ? `${hue}Bright` : hue}
            bold={distance === 0}
            dimColor={!isPart && distance > 1}
          >
            {char}
          </Text>
        );
      })}
    </Text>
  );
}

function spinner(
  elements: Elements,
  id: string,
  now: number,
  status: string,
  startedAt?: number,
): RenderElement {
  const { Text } = elements;
  const tick = Math.floor(now / TICK_MS);
  const label = `${pick(WORDS, id, 1)}…`;
  const seconds =
    startedAt === undefined ? null : Math.max(0, Math.floor((now - startedAt) / 1000));
  const hue = pick(HUES, id, 2);
  return (
    <Text wrap="truncate-end">
      <Text color={hue}>{`${CYCLE[tick % CYCLE.length]} `}</Text>
      {glow(elements, hue, label, now)}
      <Text dimColor>{seconds === null ? ` (${status})` : ` (${seconds}s · ${status})`}</Text>
    </Text>
  );
}

function isWaiting(summary: Tldr): boolean {
  return summary.status === "answering" || summary.status === "pending";
}

// 待つものか、見えている pane に busy の session がある間だけ frame を進め、無くなったら止める。
let ticker: Timer | null = null;

function startTicker($: EngineInterface): void {
  if (ticker) return;
  ticker = $.clock.every(TICK_MS, () => {
    void (async () => {
      const now = await $.clock.now();
      const { peers: listed, lastEvents } = await read($, agents);
      const peers = settle(listed, lastEvents);
      const hasWaiting =
        (await read($, history)).some((entry) => entry.card.status === "pending") ||
        (await read($, sentence))?.translation.status === "pending" ||
        (await read($, turns)).some((turn) => isWaiting(turn.summary)) ||
        (peers.some((peer) => peer.status === MOVING || isFresh(peer, lastEvents, now)) &&
          (await paneState($)).isInView);
      if (!hasWaiting) {
        ticker?.cancel();
        ticker = null;
        return;
      }
      await update($, frame, () => now);
    })().catch(() => {});
  });
}

// ---- akapen ----

// agents と同じ信号機の配色: romaji は okay、natural は needs action、grammar は warning。
// 色は label にだけ付け、直す前の文は dim、直しは地の色 (verbatim の input / native と同じ)。
const KIND_COLOR: Record<ItemKind, string> = {
  romaji: "green",
  grammar: "red",
  natural: "yellow",
};

// kind ごとにこの順でまとめ、同じ kind の中は入力の順を保つ。
const KIND_ORDER: ItemKind[] = ["romaji", "grammar", "natural"];
// verbatim の [native] label の色。agents と同じ信号機の配色で、green は okay (正しい英語)。
// [input] label は地の色、本文は dim。
const NATIVE_COLOR = "green";

function byKind(items: Item[]): Item[] {
  return KIND_ORDER.flatMap((kind) => items.filter((item) => item.kind === kind));
}

// terminal の cell 数。East Asian wide は 2。
function cells(text: string): number {
  let width = 0;
  for (const char of text) width += (char.codePointAt(0) ?? 0) >= 0x1100 ? 2 : 1;
  return width;
}

// kura が skip した prompt (短すぎる・command) は null: entry を作らない。
function parseCard(stdout: string): Card | null {
  try {
    const out = JSON.parse(stdout) as { status?: string; items?: Item[] };
    if (out.status === "skipped") return null;
    if (out.status === "ok" && Array.isArray(out.items)) return { status: "ok", items: out.items };
  } catch {}
  return { status: "error" };
}

function cardRows(
  elements: Elements,
  { id, card, startedAt }: Entry,
  columns: number,
  now: number,
): RenderElement {
  const { Box, Text } = elements;
  if (card.status === "pending") return spinner(elements, id, now, "proofreading", startedAt);
  if (card.status === "error") return <Text color="error">[kura] generation failed</Text>;
  if (card.items.length === 0) return <Text dimColor>nothing to flag ✓</Text>;

  return (
    <Box flexDirection="column">
      {byKind(card.items).map((item) => {
        const label = <Text color={KIND_COLOR[item.kind]}>{`[${item.kind}] `}</Text>;
        if (cells(`[${item.kind}] ${item.from} → ${item.to}`) <= columns) {
          return (
            <Text>
              {label}
              <Text dimColor>{item.from}</Text>
              {" → "}
              {item.to}
            </Text>
          );
        }
        // 1 行に収まらなければ、直しは元の文の下の行に置く。
        return (
          <Box flexDirection="column">
            <Text>
              {label}
              <Text dimColor>{item.from}</Text>
            </Text>
            <Text>→ {item.to}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ---- agents ----

// agents widget は `claude agents --json` の行を、status の順、同じ status なら name の順に並べて
// table に出す。値は言い換えず、
// status を値ごとの色で出すだけ。列の幅は中身から決め、切り詰めは Box / Text の layout に任せる。
// `claude agents` は 1 回の起動で CPU を約 0.15 秒使い、pane を開いた session がそれぞれ起動する。
// なので pane が見えている間だけ POLL_MS ごとに読み、見えるようになった瞬間と、ほかの session の
// event を見つけたときにも 1 回読む。見えているかと event は CHECK_MS ごとに確かめる (自分の
// process の中で済む)。
const POLL_MS = 10_000;
const CHECK_MS = 1_000;
const AGENTS_TIMEOUT_MS = 10_000;

// status の値ごとの記号と色。記号は herdr の status 表示に合わせる。色が付くのは動いているもの
// (busy: green、spinner の記号を回し、行全体に光を流す)、turn を終えたばかりでこちらの返信を
// 待っているもの (FRESH_MS 以内の idle: yellow、行全体に光を流す)、こちらが動かないと進まない
// もの (blocked / waiting / failed: red) だけで、ほかは地の文字色のまま記号で見分ける。
// 並びは集計行と table の status の順: こちらが動かないと進まないもの、動いているもの、
// 止まっているものの順。ここに無い status はその後ろ。
const MOVING = "busy";
// spin は光を流す行で回す記号と、1 つ進める間隔。busy は本家の spinner で作業中を、turn を
// 終えたばかりの idle は点字の loading で、こちらの返事を待っていることを示す。
type Look = { color?: string; mark: string; spin?: { frames: string[]; stepMs: number } };
const STATUS_LOOK: Record<string, Look> = {
  blocked: { color: "red", mark: "●" },
  waiting: { color: "red", mark: "●" },
  failed: { color: "red", mark: "●" },
  busy: { color: "green", mark: "●", spin: { frames: CYCLE, stepMs: TICK_MS } },
  done: { mark: "●" },
  idle: {
    mark: "○",
    spin: { frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], stepMs: TICK_MS },
  },
};
// turn を終えて idle になった session の行に、光を流す時間と色。過ぎれば地の文字色に戻る。
const FRESH_MS = 10 * 60_000;
const FRESH_COLOR = "yellow";
const STATUS_ORDER = Object.keys(STATUS_LOOK);
// 集計行に 0 でも出す status。
const ALWAYS_COUNTED = ["busy", "idle"];

function rankOf(status: string): number {
  const rank = STATUS_ORDER.indexOf(status);
  return rank === -1 ? STATUS_ORDER.length : rank;
}

// turn を終えてから FRESH_MS 以内の idle か。終えた時刻は events の turn.complete から読む。
function isFresh(peer: Peer, lastEvents: Agents["lastEvents"], now: number): boolean {
  const last = lastEvents?.[peer.sessionId];
  return peer.status === "idle" && last?.name === "turn.complete" && now - last.at < FRESH_MS;
}

// turn を終えた session は busy でも idle として扱う。turn の後も process が busy なのは
// background shell (dev server など) が動いているときで、session はこちらの返信を待っている。
// `claude agents --json` はこの 2 つを区別しないので、自分の hook が残した turn.complete で見分ける。
function settle(peers: Peer[], lastEvents: Agents["lastEvents"]): Peer[] {
  return peers.map((peer) =>
    peer.status === MOVING && lastEvents?.[peer.sessionId]?.name === "turn.complete"
      ? { ...peer, status: "idle" }
      : peer,
  );
}

// table の行の順: status の順、同じ status なら name の順。
function sortPeers(peers: Peer[]): Peer[] {
  return [...peers].sort(
    (a, b) => rankOf(a.status) - rankOf(b.status) || a.name.localeCompare(b.name),
  );
}
const OTHER_LOOK = { mark: "·" };

function lookOf(status: string): Look {
  return STATUS_LOOK[status] ?? OTHER_LOOK;
}

// `claude agents --json` の 1 行。読むのは表に出す項目だけ。
type AgentRow = {
  kind?: string;
  sessionId?: string;
  name?: string;
  cwd?: string;
  status?: string;
  state?: string;
  startedAt?: number;
};

async function readPeers($: EngineInterface): Promise<Peer[]> {
  const run = await $.process.run(["claude", "agents", "--json"], {
    timeoutMs: AGENTS_TIMEOUT_MS,
  });
  if (run.exitCode !== 0) {
    throw new Error(run.stderr.trim().split("\n").pop() || `claude agents: exit ${run.exitCode}`);
  }
  return (JSON.parse(run.stdout) as AgentRow[]).map((row) => ({
    kind: row.kind ?? "",
    sessionId: row.sessionId ?? "",
    name: row.name ?? "",
    cwd: row.cwd ?? "",
    // process の無い background job は status を持たず、state だけを持つ。
    status: row.status ?? row.state ?? "",
    startedAt: row.startedAt ?? 0,
  }));
}

// ---- events ----

// session 間の event。各 session は自分の file (events/<sessionId>.json) にだけ最新の 1 件を
// 書き、全 session の file を CHECK_MS ごとに stat で見る。書き手は file ごとに 1 人なので
// lock は要らない。event は「今読み直して」の合図と toast にだけ使い、table の正は
// `claude agents` のまま。mod の載っていない session は event を出さず、POLL_MS の poll が拾う。
// name は mod が受けた event の名前をそのまま持つ。言い換えない。
type PeerEvent = { name: "turn.start" | "turn.complete"; at: number; cwd: string };

// 落ちた session の file は消えずに残るので、session の始めに古いものを消す。
const EVENT_TTL_DAYS = 1;

async function eventsDir($: EngineInterface): Promise<string> {
  const stateHome =
    (await $.env.get("XDG_STATE_HOME")) || `${await $.env.get("HOME")}/.local/state`;
  return `${stateHome}/kura/events`;
}

async function publish($: EngineInterface, name: PeerEvent["name"]): Promise<void> {
  if (!(await isListed($, "agents"))) return;
  const event: PeerEvent = { name, at: await $.clock.now(), cwd: await $.session.cwd() };
  await $.fs.write(`${await eventsDir($)}/${await $.session.id()}.json`, JSON.stringify(event));
}

// background の subagent が 1 つ終わるたびに、親はその通知に答える turn を回す。
// 他の subagent がまだ動いている間の turn.complete は書かない: 最後の 1 つの後だけ鈴を鳴らす。
async function publishComplete($: EngineInterface): Promise<void> {
  const running = (await $.agent.list()).filter((agent) => agent.status === "running");
  if (running.length > 0) {
    $.ui.log(`turn.complete skipped: ${running.length} subagent(s) running`, { to: "debug" });
    return;
  }
  await publish($, "turn.complete");
}

async function pruneEvents($: EngineInterface): Promise<void> {
  const dir = await eventsDir($);
  if (!(await $.fs.exists(dir))) return;
  await $.process.run(
    ["find", dir, "-name", "*.json", "-mtime", `+${EVENT_TTL_DAYS - 1}`, "-delete"],
    { timeoutMs: AGENTS_TIMEOUT_MS },
  );
}

// debug log は --debug / --debug-file で起動したときだけ残る。開発時に `[kura]` の行を見る。
// 握りつぶす失敗・error の状態だけを残す失敗は、ここに理由を書く。
function debug($: EngineInterface, where: string, error: unknown): void {
  $.ui.log(`${where}: ${error instanceof Error ? error.message : error}`, { to: "debug" });
}

// toast はすべてこの形: cwd の最後の 1 段 › 最後に読んだ `claude agents` の name › 起きたこと。
// cwd と name のどちらも無ければ sessionId の頭。toast は 1 行しか描けず (改行は文字化けする)、
// 見出しの行は engine が plugin 名で埋めるので、全部を本文の 1 行に並べる。session を省けば
// この session。icon があれば先頭に置く。
async function toast(
  $: EngineInterface,
  session: { id: string; cwd: string } | null,
  text: string,
  icon?: string,
): Promise<void> {
  const { id, cwd } = session ?? { id: await $.session.id(), cwd: await $.session.cwd() };
  const peer = (await read($, agents)).peers.find((each) => each.sessionId === id);
  const dir = cwd.slice(cwd.lastIndexOf("/") + 1);
  const label = [dir, peer?.name].filter(Boolean).join(" › ") || id.slice(0, ID_SHOWN);
  const line = `${icon ? `${icon} ` : ""}${label} › ${text}`;
  $.ui.log(`toast: ${line}`, { to: "debug" });
  await $.ui.toast(line);
}

// sessionId ごとに最後に見た mtime。最初の 1 回は覚えるだけで toast は出さない。
let seen: Map<string, number> | null = null;

// 変わった file があれば、turn.complete を toast に出して true を返す。
async function scanEvents($: EngineInterface): Promise<boolean> {
  const dir = await eventsDir($);
  const entries = await $.fs.list(dir).catch(() => []);
  const current = new Map<string, number>();
  const found: NonNullable<Agents["lastEvents"]> = {};
  let isChanged = false;
  for (const entry of entries) {
    if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
    // 自分の file も読む: 自分の turn.complete も同じ toast で知らせる。
    const id = entry.name.slice(0, -".json".length);
    const path = `${dir}/${entry.name}`;
    const mtime = (await $.fs.stat(path).catch(() => null))?.mtimeMs;
    if (mtime === undefined) continue;
    current.set(id, mtime);
    if (seen?.get(id) === mtime) continue;
    // 最初の 1 回は中身を覚えるだけ: idle になった時刻は reload をまたいでも要る。
    const event = JSON.parse(await $.fs.read(path)) as PeerEvent;
    found[id] = { name: event.name, at: event.at };
    if (seen === null) continue;
    isChanged = true;
    if (event.name !== "turn.complete") continue;
    // turn が終わったこと (答え・中断・error のどれでも) を知らせる: 成功を言わない鈴。
    await toast($, { id, cwd: event.cwd }, event.name, "🔔");
  }
  if (Object.keys(found).length > 0) {
    await update($, agents, (s) => ({ ...s, lastEvents: { ...s.lastEvents, ...found } }));
  }
  seen = current;
  return isChanged;
}

let poller: Timer | null = null;
// 最後に `claude agents` を読んだ時刻。0 にすると次の check で読み直す。
let readAt = 0;

function startPolling($: EngineInterface): void {
  if (poller) return;
  // 重なった poll は走っている 1 回にまとめる。
  let isPolling = false;
  let wasInView = false;
  const poll = async () => {
    const isInView = (await paneState($)).isInView;
    // event は pane が隠れていても見る: toast は pane と関係なく出す。
    if (
      await scanEvents($).catch((error) => {
        debug($, "scanEvents", error);
        return false;
      })
    ) {
      readAt = 0;
    }
    const isAppearing = isInView && !wasInView;
    wasInView = isInView;
    if (isPolling || !isInView) return;
    if (!isAppearing && (await $.clock.now()) - readAt < POLL_MS) return;
    isPolling = true;
    try {
      const list = await readPeers($);
      readAt = await $.clock.now();
      await update($, agents, (s) => ({ peers: list, lastEvents: s.lastEvents }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await update($, agents, (s) => ({ ...s, error: message }));
    } finally {
      isPolling = false;
    }
    // age を進める。busy の spinner は ticker が回す。
    const now = await $.clock.now();
    await update($, frame, () => now);
    startTicker($);
  };
  void poll().catch(() => {});
  poller = $.clock.every(CHECK_MS, () => void poll().catch(() => {}));
}

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

// sessionId は頭の 7 文字と … を出す。
const ID_SHOWN = 7;
const NAME_MAX = 24;
const AGE_WIDTH = 4;
// 指した行の地の色。
const HOVER_COLOR = "subtle";

type RowValues = {
  status: string;
  kind: string;
  sessionId: string;
  name: string;
  cwd: string;
  age: string;
};
type Widths = Record<Exclude<keyof RowValues, "age">, number>;

// 列は Status / Name / Cwd / Kind / SessionId / Age の順。幅は中身の長さから決め、列の間は
// 1 cell。収まらなければ Name と Cwd が縮んで末尾を切る。文字の列は左寄せ、数値の Age は右寄せ。
function sessionRow(
  elements: Elements,
  key: string,
  values: RowValues,
  widths: Widths,
  options: { statusColor?: string; isHoverable?: boolean; wave?: number } = {},
): RenderElement {
  const { Box, Text } = elements;
  const { statusColor, isHoverable = false, wave } = options;
  const order = ["status", "name", "cwd", "kind", "sessionId", "age"] as const;
  const width = (column: (typeof order)[number]) =>
    column === "age" ? AGE_WIDTH : widths[column] + 1;
  const span = order.reduce((sum, column) => sum + width(column), 0);
  // 列の左端の、行の中での位置。
  const starts = order.map((_, index) =>
    order.slice(0, index).reduce((sum, column) => sum + width(column), 0),
  );
  return (
    <Box
      key={key}
      flexDirection="row"
      hover={isHoverable ? { backgroundColor: HOVER_COLOR } : undefined}
    >
      {order.map((column, index) => (
        <Box
          key={column}
          width={width(column)}
          flexShrink={column === "name" || column === "cwd" ? 1 : 0}
          paddingRight={column === "age" ? 0 : 1}
          justifyContent={column === "age" ? "flex-end" : "flex-start"}
        >
          <Text
            color={column === "status" || wave !== undefined ? statusColor : undefined}
            wrap="truncate-end"
          >
            {wave !== undefined && statusColor
              ? glow(elements, statusColor, values[column], wave, starts[index], span)
              : values[column]}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

// status の記号。光を流す行 (busy と、turn を終えたばかりの idle) は、その status の記号を回す。
function statusMark(status: string, now: number, isSpinning: boolean): string {
  const { mark, spin } = lookOf(status);
  if (!isSpinning || !spin) return mark;
  return spin.frames[Math.floor(now / spin.stepMs) % spin.frames.length];
}

// status は値をそのまま、前に記号を置く。
function statusText(status: string, now: number, isSpinning: boolean): string {
  return `${statusMark(status, now, isSpinning)} ${status || "-"}`;
}

// 行の見た目: 光を流すか (spinner の記号も回す) と、status の色。
function rowLook(
  peer: Peer,
  lastEvents: Agents["lastEvents"],
  now: number,
): { isLit: boolean; color?: string } {
  if (isFresh(peer, lastEvents, now)) return { isLit: true, color: FRESH_COLOR };
  return { isLit: peer.status === MOVING, color: lookOf(peer.status).color };
}

// table の上の行: session の数と、status の値ごとの数。値は status の順。busy と idle は 0 でも
// 出し、ほかは 1 つ以上あるときだけ出す。
// 記号と色は、その status の行のどれかが光っていれば、その行と同じにする。
function agentsSummary(
  { Text }: Elements,
  peers: Peer[],
  lastEvents: Agents["lastEvents"],
  now: number,
): RenderElement {
  const lit = (status: string) =>
    peers
      .filter((peer) => peer.status === status)
      .map((peer) => rowLook(peer, lastEvents, now))
      .find((look) => look.isLit);
  const counts = new Map<string, number>(ALWAYS_COUNTED.map((status) => [status, 0]));
  for (const peer of peers) counts.set(peer.status, (counts.get(peer.status) ?? 0) + 1);
  const ordered = [...counts].sort(([a], [b]) => rankOf(a) - rankOf(b));
  return (
    <Text wrap="truncate-end">
      <Text bold>{`${peers.length} ${peers.length === 1 ? "agent" : "agents"}`}</Text>
      {/* 0 の status は記号を回さず、色も付けずに地の文字で出す。 */}
      {ordered.map(([status, count]) =>
        count === 0 ? (
          <Text key={status}>{`  ${lookOf(status).mark} ${count} ${status}`}</Text>
        ) : (
          <Text key={status}>
            {"  "}
            <Text color={lit(status)?.color ?? lookOf(status).color}>
              {`${statusMark(status, now, lit(status) !== undefined)} `}
            </Text>
            {`${count} ${status || "-"}`}
          </Text>
        ),
      )}
    </Text>
  );
}

// session の table: 見出し、その下の罫線、1 session 1 行。指した行は地の色が変わる。
function agentsTable(
  elements: Elements,
  peers: Peer[],
  lastEvents: Agents["lastEvents"],
  now: number,
): RenderElement {
  const { Box } = elements;
  const rows = peers.map((peer) => ({
    peer,
    kind: peer.kind || "-",
    sessionId: peer.sessionId ? `${peer.sessionId.slice(0, ID_SHOWN)}…` : "-",
    name: peer.name || "-",
    // cwd は最後の / より後ろだけ。
    cwd: peer.cwd.slice(peer.cwd.lastIndexOf("/") + 1) || "-",
  }));
  const widest = (header: string, values: string[]) =>
    Math.max(cells(header), ...values.map((value) => cells(value)));
  const widths: Widths = {
    // 回る記号は tick ごとに cells が変わるので、幅は動かない記号で測る。
    status: widest(
      "Status",
      rows.map((row) => `${lookOf(row.peer.status).mark} ${row.peer.status || "-"}`),
    ),
    name: Math.min(
      NAME_MAX,
      widest(
        "Name",
        rows.map((row) => row.name),
      ),
    ),
    cwd: widest(
      "Cwd",
      rows.map((row) => row.cwd),
    ),
    kind: widest(
      "Kind",
      rows.map((row) => row.kind),
    ),
    // 頭の 7 文字と … で 8 cell。… は East Asian Ambiguous なので cells では数えない。
    sessionId: Math.max(cells("SessionId"), ID_SHOWN + 1),
  };
  const rule = (width: number) => "─".repeat(width);
  return (
    <Box flexDirection="column">
      {sessionRow(
        elements,
        "header",
        {
          status: "Status",
          name: "Name",
          cwd: "Cwd",
          kind: "Kind",
          sessionId: "SessionId",
          age: "Age",
        },
        widths,
      )}
      {sessionRow(
        elements,
        "rule",
        {
          status: rule(widths.status),
          name: rule(widths.name),
          cwd: rule(widths.cwd),
          kind: rule(widths.kind),
          sessionId: rule(widths.sessionId),
          age: rule(AGE_WIDTH),
        },
        widths,
      )}
      {rows.map(({ peer, ...values }, index) => {
        const look = rowLook(peer, lastEvents, now);
        return sessionRow(
          elements,
          peer.sessionId || String(index),
          {
            ...values,
            status: statusText(peer.status, now, look.isLit),
            age: elapsed(now - peer.startedAt),
          },
          widths,
          {
            statusColor: look.color,
            isHoverable: true,
            wave: look.isLit ? now : undefined,
          },
        );
      })}
    </Box>
  );
}

// summary と table は別の塊として、1 行空けて縦に積む。
function drawAgents(elements: Elements, { agents: s, now }: PaneData) {
  const { Box, Text } = elements;
  if (s.error) return <Text color="error">{s.error}</Text>;
  if (s.peers.length === 0) return <Text>No Claude Code agents.</Text>;
  const peers = sortPeers(settle(s.peers, s.lastEvents));
  return (
    <Box flexDirection="column" rowGap={1}>
      {agentsSummary(elements, peers, s.lastEvents, now)}
      {agentsTable(elements, peers, s.lastEvents, now)}
    </Box>
  );
}

// ---- pane ----

// pane は上から widget を積む (最大 3 つ)。行は ratio の比で分け、各 widget は自分の行数で切られる。
// どれを積むかは config の mod.companion.widgets が決める。
// align は切る側: bottom は最新が下に来る widget で上の古い方を、top は上から読む widget で下を切る。
type PaneData = {
  history: Entry[];
  sentence: Sentence | null;
  turns: Turn[];
  agents: Agents;
  now: number;
};
type Size = { columns: number; rows: number };
type Draw = (elements: Elements, data: PaneData, size: Size) => RenderElement;

// 生成中の card と、直すところのある card。直すところの無い card は FLASH_MS、失敗した card は
// ERROR_MS の間だけ出す。
function fixable(list: Entry[]): Entry[] {
  return list.filter(
    ({ card, isFlashing }) =>
      card.status === "pending" || (card.status === "ok" && card.items.length > 0) || isFlashing,
  );
}

function drawAkapen(elements: Elements, { history: list, now }: PaneData, { columns }: Size) {
  const { Box, Text } = elements;
  // 直すところのある card だけを古い順に — chat のように最新が一番下に来る。item が元の文の
  // 該当部分を持つので、打った prompt は出さない。
  const shown = fixable(list);
  return (
    <Box flexDirection="column">
      {shown.length === 0 && <Text dimColor>Prompts with something to fix show up here.</Text>}
      {shown.map((entry) => (
        <Box key={entry.id} flexDirection="column">
          {cardRows(elements, entry, columns, now)}
        </Box>
      ))}
    </Box>
  );
}

function summaryRows(
  elements: Elements,
  { id, summary, startedAt }: Turn,
  now: number,
): RenderElement {
  const { Text } = elements;
  if (summary.status === "answering") return spinner(elements, id, now, "waiting", startedAt);
  if (summary.status === "pending") return spinner(elements, id, now, "summarizing", startedAt);
  if (summary.status === "error") return <Text color="error">summary failed</Text>;
  return <Text>{summary.text}</Text>;
}

function drawTldr(elements: Elements, { turns: list, now }: PaneData) {
  const { Box, Text } = elements;
  // akapen と同じく古い順。question は `>` を付けた 1 行、要約はその下に 2 桁下げた kura tldr の 3 行。
  // 何 turn 出るかは領域の高さが決める。
  return (
    <Box flexDirection="column">
      <Text dimColor>[tldr]</Text>
      {list.length === 0 && <Text dimColor>The next answer is summarized here.</Text>}
      {list.map((turn, index) => {
        // 待っている間は spinner だけ: 打った prompt は transcript にあるので繰り返さない。
        // 終われば kura tldr がまとめた 1 行、無ければ打った prompt を切って出す。
        const question = isWaiting(turn.summary)
          ? ""
          : (turn.summary.status === "ok" && turn.summary.question) ||
            turn.question.replace(/\s+/g, " ").trim();
        return (
          <Box key={turn.id} flexDirection="column" marginTop={index > 0 ? 1 : 0}>
            {question !== "" && (
              <Text color="suggestion" wrap="truncate-end">
                {`> ${question}`}
              </Text>
            )}
            <Box flexDirection="column" paddingLeft={question !== "" ? 2 : 0}>
              {summaryRows(elements, turn, now)}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

// kura verbatim が skip する prompt (3 文字未満・合成 message・command)。akapen/detect.ts と同じ規則。
function isTrivial(text: string): boolean {
  const head = text.trim();
  return head.length < 3 || /^[</!]/.test(head);
}

// 幅に収まるまで文字を取る。残りは次の行。
function splitAt(word: string, width: number): [string, string] {
  let taken = 0;
  let head = "";
  for (const char of word) {
    if (taken + cells(char) > width) break;
    taken += cells(char);
    head += char;
  }
  return [head, word.slice(head.length)];
}

// 文を pane の幅で折り返す (空白で区切る。幅を超える 1 語は文字で切る)。最初の行は lead 桁を
// label に譲る。rows を超えたら切り、最終行の末尾に … を置く。描く側は行ごとに Text にして、
// Ink に折り返させない。
function wrapSentence(text: string, columns: number, rows: number, lead = 0): string[] {
  const lines: string[] = [];
  const width = () => Math.max(1, columns - (lines.length === 0 ? lead : 0));
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const joined = line ? `${line} ${word}` : word;
      if (cells(joined) <= width()) {
        line = joined;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      while (cells(rest) > width()) {
        const [head, tail] = splitAt(rest, width());
        lines.push(head);
        rest = tail;
      }
      line = rest;
    }
    lines.push(line);
  }
  const max = Math.max(1, rows);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  const room = Math.max(1, columns - (max === 1 ? lead : 0));
  let last = kept[max - 1];
  while (last && cells(`${last}…`) > room) last = [...last].slice(0, -1).join("");
  kept[max - 1] = `${last}…`;
  return kept;
}

// 直近の prompt ([input]) とその native 英訳 ([native])。label は最初の行の頭にだけ置き、
// 続く行は字下げせず幅いっぱいに使う。英訳を先に収め、prompt は残りの行に収める。
// 1 行しか無ければ英訳だけ。
function drawVerbatim(elements: Elements, { sentence: s, now }: PaneData, { columns, rows }: Size) {
  const { Box, Text } = elements;
  if (s === null) return <Text dimColor>The last prompt is said again in English here.</Text>;
  const { translation } = s;
  const labeled = (label: string, color: string | undefined, lines: string[], dimColor = false) =>
    lines.map((line, index) => (
      <Text key={`${label}-${index}`} wrap="truncate-end">
        {index === 0 && <Text color={color}>{`[${label}] `}</Text>}
        <Text dimColor={dimColor}>{line}</Text>
      </Text>
    ));
  const nativeLabel = <Text color={NATIVE_COLOR}>{"[native] "}</Text>;
  const lines =
    translation.status === "ok"
      ? wrapSentence(translation.text, columns, rows - 1, "[native] ".length)
      : [];
  const english =
    translation.status === "pending" ? (
      <Text wrap="truncate-end">
        {nativeLabel}
        {spinner(elements, s.id, now, "interpreting", s.startedAt)}
      </Text>
    ) : translation.status === "error" ? (
      <Text wrap="truncate-end">
        {nativeLabel}
        <Text color="error">interpretation failed</Text>
      </Text>
    ) : (
      labeled("native", NATIVE_COLOR, lines)
    );
  return (
    <Box flexDirection="column">
      {rows > 1 &&
        labeled(
          "input",
          undefined,
          wrapSentence(s.input, columns, rows - Math.max(1, lines.length), "[input] ".length),
          true,
        )}
      {english}
    </Box>
  );
}

type Widget = { draw: Draw; align: "top" | "bottom" };
const WIDGETS: Record<string, Widget> = {
  akapen: { draw: drawAkapen, align: "bottom" },
  verbatim: { draw: drawVerbatim, align: "top" },
  tldr: { draw: drawTldr, align: "bottom" },
  agents: { draw: drawAgents, align: "top" },
};

// 各 widget の行数。区切りの罫線を除いた行を ratio の比で分け、端数は最後の widget が取る。
function widgetHeights(ratio: number[], bodyRows: number): number[] {
  const room = Math.max(ratio.length, bodyRows - (ratio.length - 1));
  const total = ratio.reduce((sum, share) => sum + share, 0);
  const heights = ratio.map((share) => Math.max(1, Math.floor((room * share) / total)));
  const rest = room - heights.slice(0, -1).reduce((sum, rows) => sum + rows, 0);
  heights[heights.length - 1] = Math.max(1, rest);
  return heights;
}

async function paneState($: EngineInterface): Promise<{ isOpen: boolean; isInView: boolean }> {
  const pane = (await $.ui.panes()).find((candidate) => candidate.id === PANE);
  return { isOpen: !!pane, isInView: !!pane && pane.isPlaced && pane.isShown };
}

async function loadLayout($: EngineInterface): Promise<Layout> {
  const config = JSON.parse(await kura($, ["config"])) as { mod: { companion: Layout } };
  await update($, layout, () => config.mod.companion);
  return config.mod.companion;
}

// その widget が載っているか。読めていなければ一度だけ読む。読めなければ載っていないとして扱う。
async function isListed($: EngineInterface, widget: string): Promise<boolean> {
  try {
    return ((await read($, layout)) ?? (await loadLayout($))).widgets.includes(widget);
  } catch (error) {
    debug($, "isListed", error);
    return false;
  }
}

// config を読み直してから開く — config の変更は pane を開き直せば効く。
async function openPane($: EngineInterface): Promise<void> {
  const companion = await loadLayout($);
  if (companion.widgets.length === 0) {
    throw new Error("mod.companion.widgets is empty in kura config");
  }
  const unknown = companion.widgets.filter((widget) => !(widget in WIDGETS));
  if (unknown.length > 0) {
    await toast($, null, `unknown widget ${unknown.join(", ")} — skipped`);
  }
  await $.ui.open({
    id: PANE,
    title: "kura companion",
    ...(companion.columns ? { columns: companion.columns } : {}),
    ...(companion.rows ? { rows: companion.rows } : {}),
  });
}

// turn id の要約を kura tldr に作らせる。context はその turn と直前の turn。失敗はここで受ける。
async function summarize($: EngineInterface, id: string): Promise<void> {
  const settle = (summary: Tldr) =>
    update($, turns, (list) => list.map((each) => (each.id === id ? { ...each, summary } : each)));
  startTicker($);
  try {
    const list = await read($, turns);
    const end = list.findIndex((turn) => turn.id === id) + 1;
    const context = list
      .slice(Math.max(0, end - CONTEXT_TURNS), end)
      .map(({ question, answer }) => ({ question, answer }));
    const out = JSON.parse(await kura($, ["tldr"], JSON.stringify({ turns: context }))) as {
      status?: string;
      text?: string;
      question?: string | null;
    };
    await settle(
      out.status === "ok" && out.text
        ? { status: "ok", text: out.text, ...(out.question ? { question: out.question } : {}) }
        : { status: "error" },
    );
  } catch (error) {
    debug($, "summarize", error);
    await settle({ status: "error" }).catch(() => {});
  }
}

// 各 load の最初の event で宣言する。session.start だけだと hot reload の後に typeahead から
// 消えていた。宣言し直すと置き換わる。
let isDeclared = false;

async function declare($: EngineInterface): Promise<void> {
  if (isDeclared) return;
  isDeclared = true;
  await $.command.register({
    name: COMMAND,
    description: "Toggle the kura companion pane (English feedback and a three-line tldr)",
    immediate: true,
  });
  await $.command.register({
    name: HANDOFF,
    description: "Open a new Claude Code session in a tmux pane, handed this session's id",
    immediate: true,
  });
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await declare($);
    // reload は前の load の実行中の仕事を終わらせる。pending のまま残ったものは片付かない。
    await update($, history, (list) =>
      list
        .filter((entry) => entry.card.status !== "pending")
        .map((entry) => (entry.isFlashing ? { ...entry, isFlashing: false } : entry)),
    );
    await update($, sentence, (s) => (s?.translation.status === "pending" ? null : s));
    // id の無い turn は要約を turn ごとに持つ前の形、回答を待っていた turn は回答が届かない: 捨てる。
    // 要約の途中だった turn (と要約を持たない前の形) は作り直す。
    await update($, turns, (list) =>
      list
        .filter((turn) => turn.id !== undefined && turn.summary?.status !== "answering")
        .map((turn) =>
          !turn.summary || turn.summary.status === "pending"
            ? { ...turn, summary: { status: "pending" }, startedAt: undefined }
            : turn,
        ),
    );
    const done = await next(e);
    void (async () => {
      const companion = await loadLayout($);
      if (companion.widgets.includes("agents")) {
        void pruneEvents($).catch(() => {});
        startPolling($);
      }
      if (companion.widgets.includes("tldr")) {
        for (const turn of await read($, turns)) {
          if (turn.summary.status === "pending") void summarize($, turn.id);
        }
      }
      const wasOpen = (await $.store.get(IS_OPEN_KEY)) as boolean | undefined;
      if (
        companion.widgets.length > 0 &&
        (wasOpen ?? companion.autoOpen) &&
        !(await paneState($)).isOpen
      ) {
        await openPane($);
      }
    })().catch(async (error) => {
      await toast($, null, `${error instanceof Error ? error.message : error}`);
    });
    return done;
  });

  on("command.run", { command: COMMAND }, async ($) => {
    if ((await paneState($)).isOpen) {
      await $.ui.close({ id: PANE });
      return { text: "Companion pane closed." };
    }
    try {
      await openPane($);
      await $.store.set(IS_OPEN_KEY, true);
    } catch (error) {
      return {
        text: `Companion pane not opened: ${error instanceof Error ? error.message : error}`,
      };
    }
    return { text: "Companion pane opened." };
  });

  // command でも ctrl+x x でも、人が閉じたら覚えておく。unload (reload / 終了) は人の意思ではない。
  on("ui.close", { id: PANE }, async ($, e, next) => {
    const done = await next(e);
    if (e.origin.kind !== "unload") await $.store.set(IS_OPEN_KEY, false);
    return done;
  });

  on("command.run", { command: HANDOFF }, async ($) => {
    const id = await $.session.id();
    // kura は session の cwd で走り、そこで新しい session を開く。
    try {
      await kura($, ["handoff", id]);
    } catch (error) {
      return { text: `Handoff failed: ${error instanceof Error ? error.message : error}` };
    }
    return { text: `Handed off ${id.slice(0, 8)} to a new pane.` };
  });

  on("prompt.submit", async ($, e, next) => {
    if (e.origin?.kind !== "composer") return next(e);

    // card が prompt を止めないように、失敗はすべてこの task の中で受ける。
    // id は hot reload をまたいで一意 — history は module より長生きし、counter では重なる。
    const id = crypto.randomUUID();
    const settle = (card: Card | null) =>
      update($, history, (list) =>
        card === null
          ? list.filter((entry) => entry.id !== id)
          : list.map((entry) => (entry.id === id ? { ...entry, card } : entry)),
      );
    // card を ms の間だけ出して消す。
    const flashFor = async (ms: number) => {
      const flash = (isFlashing: boolean) =>
        update($, history, (list) =>
          list.map((entry) => (entry.id === id ? { ...entry, isFlashing } : entry)),
        );
      await flash(true);
      $.clock.after(ms, () => void flash(false).catch(() => {}));
    };
    void (async () => {
      if (!(await isListed($, "akapen"))) return;
      // spinner が経った秒数を出す起点。時刻が取れなければ秒数は出さない。
      const startedAt = await $.clock.now().catch(() => undefined);
      // command は turn にしない。回答中に打った prompt は、その turn の question に足す。
      if (!e.text.startsWith("/")) {
        await update($, turns, (list) => {
          const open = list.at(-1);
          if (open?.summary.status === "answering") {
            return [...list.slice(0, -1), { ...open, question: `${open.question}\n${e.text}` }];
          }
          // card と同じ id: 同じ prompt の akapen と tldr は同じ色の spinner になる。
          const turn: Turn = {
            id,
            question: e.text,
            answer: "",
            summary: { status: "answering" },
            startedAt,
          };
          return [...list, turn].slice(-HISTORY_LIMIT);
        });
      }
      await update($, history, (list) =>
        [...list, { id, input: e.text, card: { status: "pending" }, startedAt } as Entry].slice(
          -HISTORY_LIMIT,
        ),
      );
      startTicker($);
      try {
        const stdout = await kura($, ["akapen"], e.text);
        const card = parseCard(stdout);
        if (card?.status === "error") {
          debug($, "akapen", `unexpected output ${stdout.slice(0, 200)}`);
        }
        await settle(card);
        // 直すところが無ければ、その旨を一瞬だけ出して消す。
        if (card?.status === "ok" && card.items.length === 0) await flashFor(FLASH_MS);
        if (card?.status === "error") await flashFor(ERROR_MS);
      } catch (error) {
        debug($, "akapen", error);
        await settle({ status: "error" });
        await flashFor(ERROR_MS);
      }
    })().catch(() => {});

    // verbatim は card と同じ id で、直近の 1 prompt だけを持つ。kura が skip する prompt
    // (短すぎる・command) は前の英訳を残すため、ここでも同じ規則で触らない。
    // context は回答の済んだ直前の turn: 「これ」「上は」の指示先と口調はそこで決まる。
    void (async () => {
      if (isTrivial(e.text) || !(await isListed($, "verbatim"))) return;
      const startedAt = await $.clock.now().catch(() => undefined);
      const context = (await read($, turns))
        .filter((turn) => turn.id !== id && turn.answer.trim() !== "")
        .slice(-VERBATIM_CONTEXT)
        .map(({ question, answer }) => ({ question, answer }));
      await update($, sentence, () => ({
        id,
        input: e.text,
        translation: { status: "pending" },
        startedAt,
      }));
      startTicker($);
      const settle = (value: Sentence | null) =>
        update($, sentence, (current) => (current?.id === id ? value : current));
      try {
        const stdin = JSON.stringify({ input: e.text, turns: context });
        const stdout = await kura($, ["verbatim"], stdin);
        const out = JSON.parse(stdout) as { status?: string; text?: string };
        if (out.status === "skipped") return await settle(null);
        const translation: Translation =
          out.status === "ok" && out.text ? { status: "ok", text: out.text } : { status: "error" };
        if (translation.status === "error") {
          debug($, "verbatim", `unexpected output ${stdout.slice(0, 200)}`);
        }
        await settle({ id, input: e.text, translation, startedAt });
      } catch (error) {
        debug($, "verbatim", error);
        await settle({ id, input: e.text, translation: { status: "error" }, startedAt }).catch(
          () => {},
        );
      }
    })().catch(() => {});

    return next(e);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    void declare($).catch(() => {
      isDeclared = false;
    });
    const newest = (await read($, history)).at(-1);
    if (e.props.hasSurvey || newest === undefined) return next(e);
    // pane が開いていて見えていない間 (tab の裏・幅が足りない) だけ、band に最新の card を出す。
    const pane = await paneState($);
    if (!pane.isOpen || pane.isInView) return next(e);

    const now = newest.card.status === "pending" ? await read($, frame) : 0;
    return cardRows($.ui.resolve(e), newest, e.props.bodyColumns, now);
  });

  on("turn.start", async ($, e, next) => {
    void publish($, "turn.start").catch((error) => debug($, "publish turn.start", error));
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const done = await next(e);
    // main loop の turn だけ。subagent の turn は session の turn ではない。
    if (e.agentId === undefined) {
      void publishComplete($).catch((error) => debug($, "publish turn.complete", error));
    }
    if (e.agentId !== undefined || !(await isListed($, "tldr"))) return done;
    const open = (await read($, turns)).at(-1);
    const openId = open?.summary.status === "answering" ? open.id : undefined;
    // 中断・エラー・空の回答は要約しない: 回答を待っていた turn ごと捨てる。
    if (e.reason !== "answer" || !e.answer.trim()) {
      if (openId) await update($, turns, (list) => list.filter((turn) => turn.id !== openId));
      return done;
    }
    // id は hot reload をまたいで一意 — turns は module より長生きする。
    const id = openId ?? crypto.randomUUID();
    const filled = { answer: e.answer, summary: { status: "pending" } } as const;
    // prompt の無い turn (plugin が送った prompt など) は question を空で積む。
    await update($, turns, (list) =>
      openId
        ? list.map((turn) => (turn.id === id ? { ...turn, ...filled } : turn))
        : [...list, { id, question: "", ...filled }].slice(-HISTORY_LIMIT),
    );
    void summarize($, id);

    return done;
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e);
    const { Box, Text } = elements;
    const data: PaneData = {
      history: await read($, history),
      sentence: await read($, sentence),
      turns: await read($, turns),
      agents: await read($, agents),
      now: await read($, frame),
    };
    const current = await read($, layout);
    // 知らない widget は ratio ごと飛ばす。ratio が widgets と揃うことは kura config が保証する。
    const listed = (current?.widgets ?? []).map((widget, index) => ({
      widget,
      share: current?.ratio[index] ?? 1,
    }));
    const known = listed.filter(({ widget }) => widget in WIDGETS).slice(0, 3);
    const widgets = known.map(({ widget }) => widget);
    if (widgets.length === 0)
      return <Text dimColor>No widget to show — see mod.companion.widgets.</Text>;

    const columns = e.props.bodyColumns;
    const size = { columns, rows: e.props.scroll.bodyRows };
    const heights = widgetHeights(
      known.map(({ share }) => share),
      size.rows,
    );

    return (
      <Box flexDirection="column">
        {widgets.map((widget, index) => {
          const rows = heights[index] ?? 1;
          const { draw, align } = WIDGETS[widget];
          return (
            <Box key={widget} flexDirection="column">
              {index > 0 && <Text dimColor>{"─".repeat(columns)}</Text>}
              <Box
                flexDirection="column"
                justifyContent={align === "top" ? "flex-start" : "flex-end"}
                height={rows}
                overflow="hidden"
              >
                {/* 収まる間は上から積み、はみ出したら align の側に寄せて反対側を切る: 中身は
                    最低でも領域の高さを持つ。縮ませると行が領域に押し込まれ、重なって描かれた。 */}
                <Box flexDirection="column" flexShrink={0} minHeight={rows}>
                  {draw(elements, data, { columns, rows })}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
    );
  });
};
