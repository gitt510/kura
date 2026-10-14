// register.tsx — kura companion: Claude Code の横に、打った prompt の英語 feedback (akapen) と
// 回答ごとの 3 行要約 (tldr) と、mod を読み込んだ全 session の status (agents) を積む pane。
//
// 生成は kura の subcommand (`kura akapen` / `kura tldr`) が持ち、usage も kura が記録する。
// この mod は呼んで表示するだけ。配置は `kura config` の mod.companion section が決める。
// widget が mod.companion.widgets に載っている間、その生成は session の始めから pane と関係なく
// 常に走り、pane はたまったものをいつでも見せる。載っていなければ何もしない。
//
// /kura-handoff も置く: この session の id を `kura handoff` に渡し、tmux の右に新しい
// Claude Code を開く。pane を開くのも system prompt を組むのも kura が持つ。

import type { EngineInterface, Register, RenderElement, Timer } from "claude-code";
import { atom, read, update } from "claude-code";
import type { Agents, Card, Entry, Item, ItemKind, Layout, Peer, Tldr, Turn } from "../types";

const PANE = "kura-companion";
const COMMAND = "kura-companion";
const HANDOFF = "kura-handoff";
const HISTORY_LIMIT = 30;
// 要約する turn と、kura tldr が context として読む直前の 3 turn。
const CONTEXT_TURNS = 4;
const TIMEOUT_MS = 120_000;
// 直すところの無い card を pane に出しておく時間。
const FLASH_MS = 2_000;

// 打った prompt ごとに 1 entry、古い順。band は最新を、pane は全部を出す。
const history = atom({ plugin: "kura", key: "history" } as const, []);
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
      const hasWaiting =
        (await read($, history)).some((entry) => entry.card.status === "pending") ||
        (await read($, turns)).some((turn) => isWaiting(turn.summary)) ||
        ((await read($, agents)).peers.some((peer) => peer.status === MOVING) &&
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

const KIND_COLOR: Record<ItemKind, string> = {
  romaji: "success",
  grammar: "error",
  natural: "warning",
};

// kind ごとにこの順でまとめ、同じ kind の中は入力の順を保つ。
const KIND_ORDER: ItemKind[] = ["romaji", "grammar", "natural"];
const LABEL_WIDTH = 10;

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
        const label = (
          <Text color={KIND_COLOR[item.kind]}>{`[${item.kind}]`.padEnd(LABEL_WIDTH)}</Text>
        );
        if (LABEL_WIDTH + cells(item.from) + 3 + cells(item.to) <= columns) {
          return (
            <Text>
              {label}
              <Text>{item.from}</Text>
              {" → "}
              <Text color={KIND_COLOR[item.kind]}>{item.to}</Text>
            </Text>
          );
        }
        // 1 行に収まらなければ、直しは元の文の下の行に置く。
        return (
          <Box flexDirection="column">
            <Text>
              {label}
              <Text>{item.from}</Text>
            </Text>
            <Text>
              {" ".repeat(LABEL_WIDTH)}→ <Text color={KIND_COLOR[item.kind]}>{item.to}</Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ---- agents ----

// agents widget は `claude agents --json` の行を、JSON の順のまま table に出す。値は言い換えず、
// status を値ごとの色で出すだけ。列の幅は中身から決め、切り詰めは Box / Text の layout に任せる。
// `claude agents` は 1 回の起動で CPU を約 0.15 秒使い、pane を開いた session がそれぞれ起動する。
// なので pane が見えている間だけ POLL_MS ごとに読み、見えるようになった瞬間と、ほかの session の
// event を見つけたときにも 1 回読む。見えているかと event は CHECK_MS ごとに確かめる (自分の
// process の中で済む)。
const POLL_MS = 10_000;
const CHECK_MS = 1_000;
const AGENTS_TIMEOUT_MS = 10_000;

// status の値ごとの記号と色。記号は herdr の status 表示に合わせる。色が付くのは動いているもの
// (busy: green、spinner の記号を回し、行全体に光を流す) と、こちらが動かないと進まないもの
// (blocked / waiting / failed: red) だけで、ほかは地の文字色のまま記号で見分ける。
const MOVING = "busy";
const STATUS_LOOK: Record<string, { color?: string; mark: string }> = {
  blocked: { color: "red", mark: "●" },
  waiting: { color: "red", mark: "●" },
  failed: { color: "red", mark: "●" },
  done: { mark: "●" },
  busy: { color: "green", mark: "●" },
  idle: { mark: "○" },
};
const OTHER_LOOK = { mark: "·" };

function lookOf(status: string): { color?: string; mark: string } {
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
  const self = await $.session.id();
  return (JSON.parse(run.stdout) as AgentRow[]).map((row) => ({
    kind: row.kind ?? "",
    sessionId: row.sessionId ?? "",
    name: row.name ?? "",
    cwd: row.cwd ?? "",
    // process の無い background job は status を持たず、state だけを持つ。
    status: row.status ?? row.state ?? "",
    startedAt: row.startedAt ?? 0,
    isSelf: row.sessionId === self,
  }));
}

// ---- events ----

// session 間の event。各 session は自分の file (events/<sessionId>.json) にだけ最新の 1 件を
// 書き、全 session の file を CHECK_MS ごとに stat で見る。書き手は file ごとに 1 人なので
// lock は要らない。event は「今読み直して」の合図と toast にだけ使い、table の正は
// `claude agents` のまま。mod の載っていない session は event を出さず、POLL_MS の poll が拾う。
type PeerEvent = { kind: "busy" | "done" | "failed"; at: number; cwd: string };

// 落ちた session の file は消えずに残るので、session の始めに古いものを消す。
const EVENT_TTL_DAYS = 1;

async function eventsDir($: EngineInterface): Promise<string> {
  const stateHome =
    (await $.env.get("XDG_STATE_HOME")) || `${await $.env.get("HOME")}/.local/state`;
  return `${stateHome}/kura/events`;
}

async function publish($: EngineInterface, kind: PeerEvent["kind"]): Promise<void> {
  if (!(await isListed($, "agents"))) return;
  const event: PeerEvent = { kind, at: await $.clock.now(), cwd: await $.session.cwd() };
  await $.fs.write(`${await eventsDir($)}/${await $.session.id()}.json`, JSON.stringify(event));
}

async function pruneEvents($: EngineInterface): Promise<void> {
  const dir = await eventsDir($);
  if (!(await $.fs.exists(dir))) return;
  await $.process.run(
    ["find", dir, "-name", "*.json", "-mtime", `+${EVENT_TTL_DAYS - 1}`, "-delete"],
    { timeoutMs: AGENTS_TIMEOUT_MS },
  );
}

// sessionId ごとに最後に見た mtime。最初の 1 回は覚えるだけで toast は出さない。
let seen: Map<string, number> | null = null;

// 変わった file があれば、done / failed を toast に出して true を返す。
async function scanEvents($: EngineInterface): Promise<boolean> {
  const dir = await eventsDir($);
  const entries = await $.fs.list(dir).catch(() => []);
  const current = new Map<string, number>();
  let isChanged = false;
  for (const entry of entries) {
    if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
    // 自分の file も読む: 自分の done も同じ toast で知らせる。
    const id = entry.name.slice(0, -".json".length);
    const path = `${dir}/${entry.name}`;
    const mtime = (await $.fs.stat(path).catch(() => null))?.mtimeMs;
    if (mtime === undefined) continue;
    current.set(id, mtime);
    if (seen === null || seen.get(id) === mtime) continue;
    isChanged = true;
    const event = JSON.parse(await $.fs.read(path)) as PeerEvent;
    if (event.kind === "busy") continue;
    // 1 行目は cwd の最後の 1 段と、最後に読んだ `claude agents` の name。どちらも無ければ
    // sessionId の頭。2 行目は event の種類。
    const peer = (await read($, agents)).peers.find((each) => each.sessionId === id);
    const cwd = event.cwd.slice(event.cwd.lastIndexOf("/") + 1);
    const label = [cwd, peer?.name].filter(Boolean).join("・") || id.slice(0, ID_SHOWN);
    await $.ui.toast(`${label}\n${event.kind}`);
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
    if (await scanEvents($).catch(() => false)) readAt = 0;
    const isAppearing = isInView && !wasInView;
    wasInView = isInView;
    if (isPolling || !isInView) return;
    if (!isAppearing && (await $.clock.now()) - readAt < POLL_MS) return;
    isPolling = true;
    try {
      const list = await readPeers($);
      readAt = await $.clock.now();
      await update($, agents, () => ({ peers: list }));
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
  options: { statusColor?: string; isBold?: boolean; isHoverable?: boolean; wave?: number } = {},
): RenderElement {
  const { Box, Text } = elements;
  const { statusColor, isBold = false, isHoverable = false, wave } = options;
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
            bold={isBold}
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

// status の記号。busy は spinner の記号を回す。
function statusMark(status: string, now: number): string {
  const spinning = status === MOVING ? CYCLE[Math.floor(now / TICK_MS) % CYCLE.length] : undefined;
  return spinning ?? lookOf(status).mark;
}

// status は値をそのまま、前に記号を置く。
function statusText(status: string, now: number): string {
  return `${statusMark(status, now)} ${status || "-"}`;
}

// table の上の行: session の数と、status の値ごとの数。値は JSON に出てきた順。
function agentsSummary({ Text }: Elements, peers: Peer[], now: number): RenderElement {
  const counts = new Map<string, number>();
  for (const peer of peers) counts.set(peer.status, (counts.get(peer.status) ?? 0) + 1);
  return (
    <Text wrap="truncate-end">
      <Text bold>{`${peers.length} ${peers.length === 1 ? "agent" : "agents"}`}</Text>
      {[...counts].map(([status, count]) => (
        <Text key={status}>
          {"  "}
          <Text color={lookOf(status).color}>{`${statusMark(status, now)} `}</Text>
          {`${count} ${status || "-"}`}
        </Text>
      ))}
    </Text>
  );
}

// session の table: 見出し、その下の罫線、1 session 1 行。指した行は地の色が変わる。
function agentsTable(elements: Elements, peers: Peer[], now: number): RenderElement {
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
      {rows.map(({ peer, ...values }, index) =>
        sessionRow(
          elements,
          peer.sessionId || String(index),
          {
            ...values,
            status: statusText(peer.status, now),
            age: elapsed(now - peer.startedAt),
          },
          widths,
          {
            statusColor: lookOf(peer.status).color,
            isBold: peer.isSelf,
            isHoverable: true,
            wave: peer.status === MOVING ? now : undefined,
          },
        ),
      )}
    </Box>
  );
}

// summary と table は別の塊として、1 行空けて縦に積む。
function drawAgents(elements: Elements, { agents: s, now }: PaneData) {
  const { Box, Text } = elements;
  if (s.error) return <Text color="error">{s.error}</Text>;
  if (s.peers.length === 0) return <Text>No Claude Code agents.</Text>;
  return (
    <Box flexDirection="column" rowGap={1}>
      {agentsSummary(elements, s.peers, now)}
      {agentsTable(elements, s.peers, now)}
    </Box>
  );
}

// ---- pane ----

// pane は上から widget を積む (最大 2 つ)。上の widget が ratio の割合の行を取り、下が残り。
// 各 widget は自分の行数で切られる。どれを積むかは config の mod.companion.widgets が決める。
// align は切る側: bottom は最新が下に来る widget で上の古い方を、top は上から読む widget で下を切る。
type PaneData = {
  history: Entry[];
  turns: Turn[];
  agents: Agents;
  now: number;
};
type Size = { columns: number; rows: number };
type Draw = (elements: Elements, data: PaneData, size: Size) => RenderElement;

// 直すところのある card。直すところの無い card は FLASH_MS の間だけ出す。
function fixable(list: Entry[]): Entry[] {
  return list.filter(
    (entry) => entry.card.status !== "ok" || entry.card.items.length > 0 || entry.isFlashing,
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

const WIDGETS: Record<string, { draw: Draw; align: "top" | "bottom" }> = {
  akapen: { draw: drawAkapen, align: "bottom" },
  tldr: { draw: drawTldr, align: "bottom" },
  agents: { draw: drawAgents, align: "top" },
};

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
  } catch {
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
    await $.ui.toast(`kura: unknown widget ${unknown.join(", ")} — skipped`);
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
  } catch {
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
      if (companion.widgets.length > 0 && companion.autoOpen && !(await paneState($)).isOpen) {
        await openPane($);
      }
    })().catch(async (error) => {
      await $.ui.toast(`kura companion: ${error instanceof Error ? error.message : error}`);
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
    } catch (error) {
      return {
        text: `Companion pane not opened: ${error instanceof Error ? error.message : error}`,
      };
    }
    return { text: "Companion pane opened." };
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
        const card = parseCard(await kura($, ["akapen"], e.text));
        await settle(card);
        // 直すところが無ければ、その旨を一瞬だけ出して消す。
        if (card?.status === "ok" && card.items.length === 0) {
          const flash = (isFlashing: boolean) =>
            update($, history, (list) =>
              list.map((entry) => (entry.id === id ? { ...entry, isFlashing } : entry)),
            );
          await flash(true);
          $.clock.after(FLASH_MS, () => void flash(false).catch(() => {}));
        }
      } catch {
        await settle({ status: "error" });
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
    void publish($, "busy").catch(() => {});
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const done = await next(e);
    // 中断は自分で止めたもの: 知らせない。background の作業を待って止まった turn も done を
    // 出す — 作業の終わりを知らせる classic.Stop は、組織が管理する環境の plugin に届かないことがある。
    if (e.agentId === undefined && e.reason !== "aborted") {
      void publish($, e.reason === "answer" ? "done" : "failed").catch(() => {});
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
      turns: await read($, turns),
      agents: await read($, agents),
      now: await read($, frame),
    };
    const current = await read($, layout);
    const widgets = (current?.widgets ?? []).filter((widget) => widget in WIDGETS).slice(0, 2);
    if (widgets.length === 0)
      return <Text dimColor>No widget to show — see mod.companion.widgets.</Text>;

    const columns = e.props.bodyColumns;
    const gaps = widgets.length - 1;
    const room = Math.max(widgets.length, e.props.scroll.bodyRows - gaps);
    const first =
      widgets.length === 1 ? room : Math.max(1, Math.floor(room * (current?.ratio ?? 0.5)));
    const heights = [first, Math.max(1, room - first)];

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
