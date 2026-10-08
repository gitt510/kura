// register.tsx — kura companion: Claude Code の横に、打った prompt の英語 feedback (redpen) と
// 回答ごとの 3 行要約 (tldr) を積む pane。
//
// 生成は kura の subcommand (`kura redpen` / `kura tldr`) が持ち、usage も kura が記録する。
// この mod は呼んで表示するだけ。配置は `kura config` の companion section が決める。
// companion.enabled の間、生成は session の始めから pane と関係なく常に走り、pane はたまった
// ものをいつでも見せる。enabled でなければ companion は何もしない。
//
// /kura-handoff も置く: この session の id を `kura handoff` に渡し、tmux の右に新しい
// Claude Code を開く。pane を開くのも system prompt を組むのも kura が持つ。

import type { EngineInterface, Register, RenderElement } from "claude-code";
import { atom, read, update } from "claude-code";

import type { Card, Entry, Item, ItemKind, Layout, Tldr, Turn } from "../types";

const PANE = "kura-companion";
const COMMAND = "kura-companion";
const HANDOFF = "kura-handoff";
const HISTORY_LIMIT = 30;
// 要約する turn と、kura tldr が context として読む直前の 3 turn。
const CONTEXT_TURNS = 4;
const TIMEOUT_MS = 120_000;

// 打った prompt ごとに 1 entry、古い順。band は最新を、pane は全部を出す。
const history = atom({ plugin: "kura", key: "history" } as const, []);
// main loop の question / answer とその要約、古い順。
const turns = atom({ plugin: "kura", key: "turns" } as const, []);
// session の始めか pane を開いたときに読んだ `kura config` の companion section。
const layout = atom({ plugin: "kura", key: "layout" } as const, null);

type Elements = ReturnType<EngineInterface["ui"]["resolve"]>;

async function kura($: EngineInterface, args: string[], stdin?: string): Promise<string> {
  const run = await $.process.run(["kura", ...args], { stdin, timeoutMs: TIMEOUT_MS });
  if (run.exitCode !== 0) {
    const reason = run.stderr.trim().split("\n").pop() || `exit ${run.exitCode}`;
    throw new Error(`kura ${args[0]}: ${reason}`);
  }
  return run.stdout;
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

function cardRows({ Box, Text }: Elements, card: Card, columns: number): RenderElement {
  if (card.status === "pending") return <Text dimColor>[kura] processing …</Text>;
  if (card.status === "error") return <Text color="error">[kura] generation failed</Text>;
  if (card.items.length === 0) return <Text color="success">[kura] nothing to flag ✓</Text>;

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
              <Text dimColor>{item.from}</Text>
              {" → "}
              <Text bold>{item.to}</Text>
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
            <Text>
              {" ".repeat(LABEL_WIDTH)}→ <Text bold>{item.to}</Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ---- pane ----

// pane は上から widget を積む。各 widget は share の比で pane の行を分け合い、
// 自分の行数で切られる。どれを何の比で積むかは config の companion.widgets が決める。
type PaneData = { history: Entry[]; turns: Turn[] };
type Size = { columns: number; rows: number };
type Draw = (elements: Elements, data: PaneData, size: Size) => RenderElement;

// 直すところのある card。直すところの無い card は pane に出さない。
function fixable(list: Entry[]): Entry[] {
  return list.filter((entry) => entry.card.status !== "ok" || entry.card.items.length > 0);
}

function drawRedpen(elements: Elements, { history: list }: PaneData, { columns }: Size) {
  const { Box, Text } = elements;
  // 直すところのある card だけを古い順に — chat のように最新が一番下に来る。item が元の文の
  // 該当部分を持つので、打った prompt は出さない。
  const shown = fixable(list);
  return (
    <Box flexDirection="column">
      {shown.length === 0 && <Text dimColor>Prompts with something to fix show up here.</Text>}
      {shown.map((entry) => (
        <Box key={entry.id} flexDirection="column">
          {cardRows(elements, entry.card, columns)}
        </Box>
      ))}
    </Box>
  );
}

function summaryRows({ Text }: Elements, summary: Tldr | null): RenderElement {
  // null は要約の途中で reload された turn: 要約は作り直さない。
  if (summary === null) return <Text dimColor>not summarized</Text>;
  if (summary.status === "pending") return <Text dimColor>summarizing …</Text>;
  if (summary.status === "error") return <Text color="error">summary failed</Text>;
  return <Text>{summary.text}</Text>;
}

function drawTldr(elements: Elements, { turns: list }: PaneData, { columns }: Size) {
  const { Box, Text } = elements;
  // redpen と同じく古い順。chat のように question は右寄せの 1 行、要約は左寄せの kura tldr の 3 行。
  // 何 turn 出るかは領域の高さが決める。
  return (
    <Box flexDirection="column">
      <Text dimColor>[tldr]</Text>
      {list.length === 0 && <Text dimColor>The next answer is summarized here.</Text>}
      {list.map((turn, index) => (
        <Box key={turn.id} flexDirection="column">
          {index > 0 && <Text dimColor>{"┈".repeat(columns)}</Text>}
          <Box justifyContent="flex-end" paddingLeft={4} marginBottom={1}>
            <Text color="suggestion" wrap="truncate-end">
              {turn.question.replace(/\s+/g, " ")}
            </Text>
          </Box>
          {summaryRows(elements, turn.summary)}
        </Box>
      ))}
    </Box>
  );
}

const WIDGETS: Record<string, Draw> = { redpen: drawRedpen, tldr: drawTldr };

async function paneState($: EngineInterface): Promise<{ isOpen: boolean; isInView: boolean }> {
  const pane = (await $.ui.panes()).find((candidate) => candidate.id === PANE);
  return { isOpen: !!pane, isInView: !!pane && pane.isPlaced && pane.isShown };
}

async function loadLayout($: EngineInterface): Promise<Layout> {
  const config = JSON.parse(await kura($, ["config"])) as { companion: Layout };
  await update($, layout, () => config.companion);
  return config.companion;
}

// 読めていなければ一度だけ読む。読めなければ無効として扱う。
async function isEnabled($: EngineInterface): Promise<boolean> {
  try {
    return ((await read($, layout)) ?? (await loadLayout($))).enabled;
  } catch {
    return false;
  }
}

// config を読み直してから開く — config の変更は pane を開き直せば効く。
async function openPane($: EngineInterface): Promise<void> {
  const companion = await loadLayout($);
  if (!companion.enabled) throw new Error("companion.enabled is false in kura config");
  const unknown = companion.widgets.filter((widget) => !(widget.id in WIDGETS));
  if (unknown.length > 0) {
    await $.ui.toast(`kura: unknown widget ${unknown.map((w) => w.id).join(", ")} — skipped`);
  }
  await $.ui.open({
    id: PANE,
    title: "kura companion",
    ...(companion.columns ? { columns: companion.columns } : {}),
    ...(companion.rows ? { rows: companion.rows } : {}),
  });
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
  // 最後に打った prompt: 次の回答が答えている question。
  let question = "";

  on("session.start", async ($, e, next) => {
    await declare($);
    // reload は前の load の実行中の仕事を終わらせる。pending のまま残ったものは片付かない。
    await update($, history, (list) => list.filter((entry) => entry.card.status !== "pending"));
    // id の無い turn は要約を turn ごとに持つ前の形: 捨てる。
    await update($, turns, (list) =>
      list
        .filter((turn) => turn.id !== undefined)
        .map((turn) => (turn.summary?.status === "pending" ? { ...turn, summary: null } : turn)),
    );
    const done = await next(e);
    void (async () => {
      const companion = await loadLayout($);
      if (companion.enabled && companion.autoOpen && !(await paneState($)).isOpen) {
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
    question = e.text;

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
      if (!(await isEnabled($))) return;
      await update($, history, (list) =>
        [...list, { id, input: e.text, card: { status: "pending" } } as Entry].slice(
          -HISTORY_LIMIT,
        ),
      );
      try {
        await settle(parseCard(await kura($, ["redpen"], e.text)));
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

    return cardRows($.ui.resolve(e), newest.card, e.props.bodyColumns);
  });

  on("turn.complete", async ($, e, next) => {
    const done = await next(e);
    if (e.agentId !== undefined || e.reason !== "answer" || !e.answer.trim()) return done;
    if (!(await isEnabled($))) return done;
    // id は hot reload をまたいで一意 — turns は module より長生きする。
    const id = crypto.randomUUID();
    const turn: Turn = {
      id,
      question,
      answer: e.answer,
      summary: { status: "pending" },
    };
    await update($, turns, (list) => [...list, turn].slice(-HISTORY_LIMIT));

    const settle = (summary: Tldr) =>
      update($, turns, (list) =>
        list.map((each) => (each.id === id ? { ...each, summary } : each)),
      );
    void (async () => {
      try {
        const context = (await read($, turns))
          .slice(-CONTEXT_TURNS)
          .map(({ question, answer }) => ({
            question,
            answer,
          }));
        const stdin = JSON.stringify({ turns: context });
        const out = JSON.parse(await kura($, ["tldr"], stdin)) as {
          status?: string;
          text?: string;
        };
        await settle(
          out.status === "ok" && out.text ? { status: "ok", text: out.text } : { status: "error" },
        );
      } catch {
        await settle({ status: "error" });
      }
    })().catch(() => {});

    return done;
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e);
    const { Box, Text } = elements;
    const data: PaneData = { history: await read($, history), turns: await read($, turns) };
    const widgets = ((await read($, layout))?.widgets ?? []).filter(
      (widget) => widget.id in WIDGETS,
    );
    if (widgets.length === 0)
      return <Text dimColor>No widget to show — see companion.widgets.</Text>;

    const columns = e.props.bodyColumns;
    const gaps = widgets.length - 1;
    const room = Math.max(widgets.length, e.props.scroll.bodyRows - gaps);
    const total = widgets.reduce((sum, widget) => sum + widget.share, 0);

    return (
      <Box flexDirection="column">
        {widgets.map((widget, index) => {
          const rows = Math.max(1, Math.floor((room * widget.share) / total));
          const draw = WIDGETS[widget.id];
          return (
            <Box key={widget.id} flexDirection="column">
              {index > 0 && <Text dimColor>{"─".repeat(columns)}</Text>}
              <Box flexDirection="column" justifyContent="flex-end" height={rows} overflow="hidden">
                {/* 収まる間は上から積み、はみ出したら下に寄せて上の古い方を切る: 中身は
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
