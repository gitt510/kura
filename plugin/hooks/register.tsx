// register.tsx — kura companion: Claude Code の横に、打った prompt の英語 feedback (redpen) と
// 回答ごとの 3 行要約 (tldr) と、worktree の変更 file (glance) を積む pane。
//
// 生成は kura の subcommand (`kura redpen` / `kura tldr`) が持ち、usage も kura が記録する。
// この mod は呼んで表示するだけ。配置は `kura config` の mod.companion section が決める。
// widget が mod.companion.widgets に載っている間、その生成は session の始めから pane と関係なく
// 常に走り、pane はたまったものをいつでも見せる。載っていなければ何もしない。
//
// /kura-handoff も置く: この session の id を `kura handoff` に渡し、tmux の右に新しい
// Claude Code を開く。pane を開くのも system prompt を組むのも kura が持つ。

import type { EngineInterface, Register, RenderElement, Timer } from "claude-code";
import { atom, read, update } from "claude-code";
import type { Card, Entry, FileRow, Glance, Item, ItemKind, Layout, Tldr, Turn } from "../types";
import { joinRows, parseNumstat, parseStatus, previewLines, previewOf } from "./glance";

const PANE = "kura-companion";
const COMMAND = "kura-companion";
const HANDOFF = "kura-handoff";
const HISTORY_LIMIT = 30;
// 要約する turn と、kura tldr が context として読む直前の 3 turn。
const CONTEXT_TURNS = 4;
const TIMEOUT_MS = 120_000;
// 直すところの無い card を pane に出しておく時間。
const FLASH_MS = 2_000;
// editing の spinner を tool が返ってから出しておく時間 — 一瞬の Edit でも見える。
const SPINNER_MIN_MS = 1_000;
// 1 回の refresh で preview を読む file の数。
const GLANCE_FILES = 40;

// 打った prompt ごとに 1 entry、古い順。band は最新を、pane は全部を出す。
const history = atom({ plugin: "kura", key: "history" } as const, []);
// main loop の question / answer とその要約、古い順。turn は prompt を打った時点で積み、回答で埋める。
const turns = atom({ plugin: "kura", key: "turns" } as const, []);
// session の始めか pane を開いたときに読んだ `kura config` の mod.companion section。
const layout = atom({ plugin: "kura", key: "layout" } as const, null);
// spinner が描く時刻 (ms)。生成を待つものがある間だけ TICK_MS ごとに進む。
const frame = atom({ plugin: "kura", key: "frame" } as const, 0);
// glance が最後に読んだ worktree と、今 Edit / Write / NotebookEdit が触っている file。
const glance = atom(
  { plugin: "kura", key: "glance" } as const,
  {
    rows: [],
    editing: [],
    root: "",
    branch: "",
  } as Glance,
);

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

// 記号は行って戻る。文言と palette は待っている item ごとに id から 1 つ選び、待つ間は変えない。
const GLYPHS = ["·", "✢", "✳", "✶", "✻", "✽"];
const CYCLE = [...GLYPHS, ...GLYPHS.slice(1, -1).reverse()];
const TICK_MS = 120;
// redpen と tldr で共通: 同じ prompt の card と turn は同じ id なので、同じ文言と palette になる。
const WORDS = ["Pondering", "Distilling", "Brewing", "Mulling", "Polishing", "Simmering"];
// 明るい順: 光の芯、その両隣、さらに外、地の色。
const PALETTES = [
  ["#fff7d6", "#ffd866", "#e0a526", "#9c7a2e"],
  ["#ffe3f1", "#ff8fc7", "#d9589a", "#8f4a6b"],
  ["#e0f7ff", "#78dcff", "#3aa7d9", "#3f6e85"],
  ["#eee6ff", "#b69cff", "#8a63e6", "#5f4f8f"],
  ["#e6ffe9", "#7ee68f", "#3fb85a", "#457552"],
];

function pick<T>(list: T[], id: string, salt: number): T {
  let hash = salt;
  for (const char of id) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return list[hash % list.length];
}

// 本家の spinner と同じく、文言の後ろに経った秒数と何を待っているかを dim で添える。
function spinner(
  { Text }: Elements,
  id: string,
  now: number,
  status: string,
  startedAt?: number,
): RenderElement {
  const tick = Math.floor(now / TICK_MS);
  const label = `${pick(WORDS, id, 1)}…`;
  const seconds =
    startedAt === undefined ? null : Math.max(0, Math.floor((now - startedAt) / 1000));
  const palette = pick(PALETTES, id, 2);
  // 光は label の左外から右外へ流れ、少し間を置いてまた左から。
  const at = (tick % (label.length + 8)) - 3;
  return (
    <Text wrap="truncate-end">
      <Text color={palette[1]}>{`${CYCLE[tick % CYCLE.length]} `}</Text>
      {[...label].map((char, index) => (
        <Text key={index} color={palette[Math.min(Math.abs(index - at), palette.length - 1)]}>
          {char}
        </Text>
      ))}
      <Text dimColor>{seconds === null ? ` (${status})` : ` (${seconds}s · ${status})`}</Text>
    </Text>
  );
}

function isWaiting(summary: Tldr): boolean {
  return summary.status === "answering" || summary.status === "pending";
}

// 待つものがある間だけ frame を進め、無くなったら止める。
let ticker: Timer | null = null;

function startTicker($: EngineInterface): void {
  if (ticker) return;
  ticker = $.clock.every(TICK_MS, () => {
    void (async () => {
      const hasWaiting =
        (await read($, history)).some((entry) => entry.card.status === "pending") ||
        (await read($, turns)).some((turn) => isWaiting(turn.summary)) ||
        (await read($, glance)).editing.length > 0;
      if (!hasWaiting) {
        ticker?.cancel();
        ticker = null;
        return;
      }
      const now = await $.clock.now();
      await update($, frame, () => now);
    })().catch(() => {});
  });
}

// ---- redpen ----

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

// ---- glance ----

const EDITING = "editing";

// file 名の横の ` ✻ editing`: 記号は spinner と同じく回り、光は editing の上を流れる。palette は path から。
function editingSpinner({ Text }: Elements, path: string, now: number): RenderElement {
  const tick = Math.floor(now / TICK_MS);
  const palette = pick(PALETTES, path, 2);
  const at = (tick % (EDITING.length + 8)) - 3;
  return (
    <Text>
      <Text color={palette[1]}>{` ${CYCLE[tick % CYCLE.length]} `}</Text>
      {[...EDITING].map((char, index) => (
        <Text key={index} color={palette[Math.min(Math.abs(index - at), palette.length - 1)]}>
          {char}
        </Text>
      ))}
    </Text>
  );
}

async function git($: EngineInterface, args: string[]) {
  return $.process.run(["git", ...args], { timeoutMs: TIMEOUT_MS });
}

// repo の root。一度読めたら atom に残す。
async function repoRoot($: EngineInterface): Promise<string> {
  const known = (await read($, glance)).root;
  if (known) return known;
  const top = await git($, ["rev-parse", "--show-toplevel"]);
  const root = top.exitCode === 0 ? top.stdout.trim() : "";
  if (root) await update($, glance, (g) => ({ ...g, root }));
  return root;
}

async function readWorktree($: EngineInterface, before: Glance): Promise<Partial<Glance>> {
  const status = await git($, ["status", "--porcelain", "--untracked-files=all"]);
  if (status.exitCode !== 0) {
    return { rows: [], error: status.stderr.trim().split("\n").pop() || "git status failed" };
  }
  const entries = parseStatus(status.stdout);
  const diff = await git($, ["diff", "--numstat", "HEAD", "--"]);
  const numstat = diff.exitCode === 0 ? parseNumstat(diff.stdout) : new Map();
  const isUntracked = (path: string, kind: string) => kind === "added" && !numstat.has(path);

  // untracked は HEAD との diff に出ない: /dev/null との diff で行数を数える。
  const untrackedLines = new Map<string, number>();
  for (const { path } of entries
    .filter(({ path, kind }) => isUntracked(path, kind))
    .slice(0, GLANCE_FILES)) {
    const count = await git($, ["diff", "--no-index", "--numstat", "/dev/null", path]);
    const added = Number(count.stdout.split("\n")[0]?.split("\t")[0]);
    untrackedLines.set(path, Number.isFinite(added) ? added : 0);
  }

  const root = await repoRoot($);
  const head = await git($, ["branch", "--show-current"]);
  const branch = head.exitCode === 0 ? head.stdout.trim() : before.branch;

  const rows = joinRows(entries, numstat, untrackedLines, before.rows);
  for (const row of rows.slice(0, GLANCE_FILES)) {
    const argv = isUntracked(row.path, row.kind)
      ? ["diff", "--no-index", "-U1", "--", "/dev/null", row.path]
      : ["diff", "-U1", "HEAD", "--", row.path];
    Object.assign(row, previewOf((await git($, argv)).stdout));
  }
  return { rows, root, branch, error: undefined };
}

// 重なった refresh は走っている 1 回にまとめる。
let refreshing: Promise<void> | undefined;

function refresh($: EngineInterface): Promise<void> {
  refreshing ??= (async () => {
    try {
      const next = await readWorktree($, await read($, glance));
      await update($, glance, (g) => ({ ...g, ...next }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await update($, glance, (g) => ({ ...g, rows: [], error: message })).catch(() => {});
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
}

function editedPath(e: { tool: string } & Record<string, unknown>): string | undefined {
  const path =
    e.tool === "Edit" || e.tool === "Write"
      ? e.file_path
      : e.tool === "NotebookEdit"
        ? e.notebook_path
        : undefined;
  return typeof path === "string" ? path : undefined;
}

// 書いている間は file 名の横に spinner を出す。path は repo 相対 — git の出力と同じ形。
async function startEditing(
  $: EngineInterface,
  raw: string | undefined,
): Promise<string | undefined | null> {
  if (!(await isListed($, "glance"))) return null;
  if (raw === undefined) return undefined;
  const path = relative(await repoRoot($), raw);
  await update($, glance, (g) => ({ ...g, editing: [...g.editing, path] }));
  startTicker($);
  return path;
}

function relative(root: string, path: string): string {
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

// row の表示は joaofatoretto/round-changes (MIT) に倣う: badge、太字の名前と dim の folder、数、size bar。
function keepStart(text: string, width: number): string {
  if (width <= 0) return "";
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

function keepEnd(text: string, width: number): string {
  if (width <= 0) return "";
  return text.length <= width ? text : `…${text.slice(text.length - width + 1)}`;
}

function splitPath(path: string): { dir: string; name: string } {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? { dir: "", name: path } : { dir: path.slice(0, cut), name: path.slice(cut + 1) };
}

function sizeBar(added: number, removed: number, largest: number, width: number) {
  const total = added + removed;
  if (total === 0 || largest === 0 || width === 0) return { plus: 0, minus: 0, rest: width };
  const filled = Math.max(1, Math.round((total / largest) * width));
  let plus = Math.round((added / total) * filled);
  if (added > 0 && plus === 0) plus = 1;
  if (removed > 0 && plus === filled) plus = filled - 1;
  return { plus, minus: Math.max(0, filled - plus), rest: width - filled };
}

function countsOf(added: number, removed: number): string {
  if (added + removed === 0) return "±0";
  return [added > 0 && `+${added}`, removed > 0 && `−${removed}`].filter(Boolean).join(" ");
}

const BADGE: Record<FileRow["kind"], { label: string; color: string }> = {
  added: { label: " A ", color: "success" },
  changed: { label: " M ", color: "warning" },
  deleted: { label: " D ", color: "error" },
};
const ORDER: Record<FileRow["kind"], number> = { added: 0, changed: 1, deleted: 2 };
// これより狭いと size bar と folder を出さない。
const WIDE = 56;
const BAR = 5;

function badge({ Text }: Elements, kind: FileRow["kind"]): RenderElement {
  return (
    <Text bold color="inverseText" backgroundColor={BADGE[kind].color}>
      {BADGE[kind].label}
    </Text>
  );
}

// hunk をそのまま行に: dim の行番号、記号、側で色を変えた本文。背景は付けない。
function previewBlock({ Box, Text }: Elements, preview: string): RenderElement {
  const lines = previewLines(preview);
  const digits = Math.max(1, ...lines.map((line) => String(line.number).length));
  return (
    <Box flexDirection="column" paddingLeft={4}>
      {lines.map((line, index) => (
        <Text key={index} wrap="truncate-end">
          <Text dimColor>{`${String(line.number).padStart(digits)} `}</Text>
          <Text
            color={
              line.mark === "+"
                ? "diffAddedWord"
                : line.mark === "-"
                  ? "diffRemovedWord"
                  : undefined
            }
            dimColor={line.mark === " "}
          >
            {`${line.mark} ${line.text}`}
          </Text>
        </Text>
      ))}
    </Box>
  );
}

function summaryLine({ Text }: Elements, rows: FileRow[]): RenderElement {
  if (rows.length === 0) return <Text dimColor>No changes</Text>;
  const added = rows.reduce((sum, row) => sum + row.added, 0);
  const removed = rows.reduce((sum, row) => sum + row.removed, 0);
  const kinds = (Object.keys(BADGE) as FileRow["kind"][])
    .map(
      (kind) => [BADGE[kind].label.trim(), rows.filter((row) => row.kind === kind).length] as const,
    )
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`)
    .join(" · ");
  return (
    <Text wrap="truncate-end">
      <Text bold>{`${rows.length} ${rows.length === 1 ? "file" : "files"} changed`}</Text>
      {"  "}
      <Text color="diffAddedWord">{`+${added}`}</Text>{" "}
      <Text color="diffRemovedWord">{`−${removed}`}</Text>
      <Text dimColor>{`   ${kinds}`}</Text>
    </Text>
  );
}

function drawGlance(elements: Elements, { glance: g, now }: PaneData, { columns }: Size) {
  const { Box, Text } = elements;
  if (g.error) return <Text color="error">{g.error}</Text>;
  const editing = new Set(g.editing);
  const listed = new Set(g.rows.map((row) => row.path));
  // git にまだ出ていない、書いている途中の file は仮の A row にする。
  const unlisted = g.editing.filter(
    (path, index) => !listed.has(path) && g.editing.indexOf(path) === index,
  );

  const narrow = columns < WIDE;
  const barWidth = narrow ? 0 : BAR;
  const labelRoom = columns - 3 - 1 - (barWidth > 0 ? barWidth + 1 : 0);
  const largest = Math.max(1, ...g.rows.map((row) => row.added + row.removed));
  const spinWidth = EDITING.length + 3;

  const rowOf = (row: FileRow) => {
    const isEditing = editing.has(row.path);
    const { dir, name } = splitPath(row.path);
    const counts = countsOf(row.added, row.removed);
    const spin = isEditing ? spinWidth : 0;
    const shown = keepStart(name, Math.max(4, labelRoom - counts.length - 2 - spin));
    const dirRoom = labelRoom - shown.length - spin - counts.length - 4;
    const folder = dir !== "" && !narrow && dirRoom > 3 ? `  ${keepEnd(dir, dirRoom)}` : "";
    const gap = " ".repeat(
      Math.max(1, labelRoom - shown.length - spin - folder.length - counts.length),
    );
    const bar = sizeBar(row.added, row.removed, largest, barWidth);
    return (
      <Box key={row.path} flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {badge(elements, row.kind)}
          <Text wrap="truncate-end">
            <Text bold>{shown}</Text>
            {isEditing && editingSpinner(elements, row.path, now)}
            <Text dimColor>{folder}</Text>
            {gap}
            <Text color={row.removed > 0 && row.added === 0 ? "diffRemovedWord" : "diffAddedWord"}>
              {counts}
            </Text>
          </Text>
          {barWidth > 0 && (
            <Box width={barWidth} flexShrink={0}>
              <Text color="diffAddedWord">{"■".repeat(bar.plus)}</Text>
              <Text color="diffRemovedWord">{"■".repeat(bar.minus)}</Text>
              <Text dimColor>{"·".repeat(bar.rest)}</Text>
            </Box>
          )}
        </Box>
        {row.preview !== "" && previewBlock(elements, row.preview)}
        {row.more > 0 && <Text dimColor>{`    … ${row.more} more`}</Text>}
      </Box>
    );
  };

  const rows = [...g.rows].sort(
    (a, b) => ORDER[a.kind] - ORDER[b.kind] || a.path.localeCompare(b.path),
  );
  return (
    <Box flexDirection="column">
      {summaryLine(elements, g.rows)}
      {unlisted.map((path) => {
        const { dir, name } = splitPath(path);
        return (
          <Box key={`editing:${path}`} flexDirection="row" gap={1}>
            {badge(elements, "added")}
            <Text wrap="truncate-end">
              <Text bold>{name}</Text>
              {editingSpinner(elements, path, now)}
              <Text dimColor>{dir ? `  ${dir}` : ""}</Text>
            </Text>
          </Box>
        );
      })}
      {rows.map(rowOf)}
    </Box>
  );
}

// ---- pane ----

// pane は上から widget を積む (最大 2 つ)。上の widget が ratio の割合の行を取り、下が残り。
// 各 widget は自分の行数で切られる。どれを積むかは config の mod.companion.widgets が決める。
// align は切る側: bottom は最新が下に来る widget で上の古い方を、top は上から読む widget で下を切る。
type PaneData = { history: Entry[]; turns: Turn[]; glance: Glance; now: number };
type Size = { columns: number; rows: number };
type Draw = (elements: Elements, data: PaneData, size: Size) => RenderElement;

// 直すところのある card。直すところの無い card は FLASH_MS の間だけ出す。
function fixable(list: Entry[]): Entry[] {
  return list.filter(
    (entry) => entry.card.status !== "ok" || entry.card.items.length > 0 || entry.isFlashing,
  );
}

function drawRedpen(elements: Elements, { history: list, now }: PaneData, { columns }: Size) {
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
  // redpen と同じく古い順。question は `>` を付けた 1 行、要約はその下に 2 桁下げた kura tldr の 3 行。
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
  redpen: { draw: drawRedpen, align: "bottom" },
  tldr: { draw: drawTldr, align: "bottom" },
  glance: { draw: drawGlance, align: "top" },
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
    // 前の load で書いていた途中の file は、もう終わったか届かない。
    await update($, glance, (g) => ({ ...g, editing: [] }));
    const done = await next(e);
    void (async () => {
      const companion = await loadLayout($);
      if (companion.widgets.includes("glance")) void refresh($);
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
      if (!(await isListed($, "redpen"))) return;
      // spinner が経った秒数を出す起点。時刻が取れなければ秒数は出さない。
      const startedAt = await $.clock.now().catch(() => undefined);
      // command は turn にしない。回答中に打った prompt は、その turn の question に足す。
      if (!e.text.startsWith("/")) {
        await update($, turns, (list) => {
          const open = list.at(-1);
          if (open?.summary.status === "answering") {
            return [...list.slice(0, -1), { ...open, question: `${open.question}\n${e.text}` }];
          }
          // card と同じ id: 同じ prompt の redpen と tldr は同じ palette の spinner になる。
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
        const card = parseCard(await kura($, ["redpen"], e.text));
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

  on("tool.call", async ($, e, next) => {
    const raw = editedPath(e as { tool: string } & Record<string, unknown>);
    if (!raw && e.tool !== "Bash") return next(e);
    // glance が載っていなければ null。tool を止めないように、失敗も null にする。
    const path = await startEditing($, raw).catch(() => null);
    if (path === null) return next(e);
    try {
      return await next(e);
    } finally {
      if (path !== undefined) {
        $.clock.after(SPINNER_MIN_MS, () => {
          void update($, glance, (g) => {
            const index = g.editing.indexOf(path);
            return index < 0
              ? g
              : { ...g, editing: [...g.editing.slice(0, index), ...g.editing.slice(index + 1)] };
          }).catch(() => {});
        });
      }
      void refresh($);
    }
  });

  on("turn.complete", async ($, e, next) => {
    const done = await next(e);
    if (await isListed($, "glance")) void refresh($);
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
      glance: await read($, glance),
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
