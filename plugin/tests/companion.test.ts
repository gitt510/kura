import type { EngineInterface, On, RenderElement } from "claude-code";
import { expect, mock, test } from "claude-code/testing";

const CARD = {
  status: "ok",
  model: "opus",
  items: [{ kind: "romaji", from: "kono houhou", to: "this approach" }],
};

const COMPANION = {
  enabled: true,
  autoOpen: false,
  columns: 64,
  rows: null,
  widgets: [
    { id: "redpen", share: 6 },
    { id: "tldr", share: 4 },
  ],
};

// band が読むのは hasSurvey と bodyColumns、pane は bodyColumns と scroll.bodyRows だけ。
const BAND = {
  plugin: "kura",
  component: "AbovePrompt",
  props: { hasSurvey: false, bodyColumns: 80 } as never,
} as const;
const PANE = {
  plugin: "kura",
  component: "Pane",
  requestId: "kura-companion",
  props: { bodyColumns: 60, scroll: { offset: 0, bodyRows: 30 } } as never,
} as const;

// card / tldr は prompt の経路の外で取りに行く。その task を終わらせる。
async function settle(): Promise<void> {
  for (let i = 0; i < 200; i++) await Promise.resolve();
}

function ran(stdout: string) {
  return {
    value: { exitCode: 0, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false },
  };
}

type Pane = "closed" | "hidden" | "shown";
type Engine = { calls: { argv: string[]; stdin: string }[]; opened: unknown[]; pane: Pane };

// mod の下で engine が答えるもの: kura の返答、prompt、空の描画、開いている pane。
// isHanging なら redpen / tldr は返らないまま待つ。
function engine(
  on: On,
  pane: Pane,
  companion = COMPANION,
  card = JSON.stringify(CARD),
  isHanging = false,
  tldr: object = { status: "ok", text: "three lines" },
): Engine {
  const state: Engine = { calls: [], opened: [], pane };
  on("process.run", async (_$, e) => {
    state.calls.push({ argv: [...e.argv], stdin: e.init?.stdin ?? "" });
    const command = e.argv[1];
    if (command === "config") return ran(JSON.stringify({ mod: { companion } }));
    if (isHanging) return new Promise<never>(() => {});
    if (command === "tldr") return ran(JSON.stringify(tldr));
    return ran(card);
  });
  on("prompt.submit", async (_$, e) => ({ text: e.text }));
  on("turn.complete", async (_$, e) => ({ text: e.answer }));
  on("ui.render", async ($, e) => {
    const { Box } = $.ui.resolve(e);
    return h(Box, {}) as RenderElement;
  });
  on("ui.open", async (_$, e) => {
    state.opened.push(e);
    state.pane = "shown";
    return { value: { isPlaced: true } } as never;
  });
  on("ui.panes", async () => ({
    value:
      state.pane === "closed"
        ? []
        : [
            {
              id: "kura-companion",
              title: "kura companion",
              isShown: state.pane === "shown",
              isFocused: false,
              isPlaced: true,
            },
          ],
  }));
  return state;
}

// kura config の読み出しを除いた、生成の呼び出し。
function generated(state: Engine) {
  return state.calls.filter((call) => call.argv[1] !== "config");
}

async function open($: EngineInterface): Promise<void> {
  await $.command.run({ command: "kura-companion" });
}

function typed($: EngineInterface, text: string) {
  return $.prompt.submit({ text, wait: false, origin: { kind: "composer" } });
}

test("pane が閉じていても card は作り、band には出さない", async ($, on) => {
  const state = engine(on, "closed");
  const text = "I think kono houhou is good";
  await typed($, text);
  await settle();
  expect(generated(state)).toEqual([{ argv: ["kura", "redpen"], stdin: text }]);

  const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
  expect(await ui.find({ type: "Text", text: /this approach/ })).toBeUndefined();
  await ui.unmount();
});

test("/kura-companion は kura config を読み、columns を渡して pane を開く", async ($, on) => {
  const state = engine(on, "closed");
  await open($);
  expect(state.calls.map((call) => call.argv)).toEqual([["kura", "config"]]);
  expect(state.opened).toEqual([expect.objectContaining({ id: "kura-companion", columns: 64 })]);
  expect(state.opened[0]).not.toHaveProperty("rows");
});

test("pane が開いていて見えない間は、打った prompt の card を band に出す", async ($, on) => {
  const state = engine(on, "hidden");
  const text = "I think kono houhou is good";
  await typed($, text);
  await settle();
  expect(generated(state)).toEqual([{ argv: ["kura", "redpen"], stdin: text }]);

  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({ ...BAND, surface });
    expect(await ui.find({ type: "Text", text: /this approach/ })).toBeDefined();
    await ui.unmount();
  }
});

test("plugin が送った prompt は card を作らない", async ($, on) => {
  const state = engine(on, "hidden");
  await $.prompt.submit({
    text: "I think kono houhou is good",
    wait: false,
    origin: { kind: "plugin", name: "other" },
  });
  await settle();
  expect(state.calls).toEqual([]);
});

test("item は kind ごとにまとまり、長い item は直しを次の行に置く", async ($, on) => {
  const long = "In three sentence that convert latest agent output into three sentence";
  const items = [
    { kind: "grammar", from: "I make mod", to: "I want to make a mod" },
    {
      kind: "natural",
      from: long,
      to: "that summarizes the latest agent output in three sentences",
    },
    { kind: "grammar", from: "how's the impelment is?", to: "how would I implement it?" },
  ];
  engine(on, "hidden", COMPANION, JSON.stringify({ status: "ok", items }));
  await typed($, "x x x");
  await settle();

  const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
  const text = (await ui.find({ type: "Box" }))?.text ?? "";
  expect(text.indexOf("I make mod")).toBeLessThan(text.indexOf("impelment"));
  expect(text.indexOf("impelment")).toBeLessThan(text.indexOf(long));
  const row = await ui.find({ type: "Text", text: /^\[natural\]/ });
  expect(row?.text).not.toContain("→");
  await ui.unmount();
});

test("pane は config の順に redpen (prompt は出さない) と tldr を積み、band は空ける", async ($, on) => {
  engine(on, "closed");
  await open($);
  await typed($, "first prompt");
  await typed($, "second prompt");
  await settle();

  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  const text = (await pane.find({ type: "Box" }))?.text ?? "";
  const rule = "┈".repeat(60);
  expect(text.slice(0, text.indexOf("[tldr]"))).not.toContain("first prompt");
  // card の間に区切りは無く、item がそのまま続く。
  expect(text).not.toContain(rule);
  const first = text.indexOf("this approach");
  expect(first).toBeGreaterThanOrEqual(0);
  expect(text.indexOf("this approach", first + 1)).toBeGreaterThan(first);
  expect(text.indexOf("this approach", first + 1)).toBeLessThan(text.indexOf("[tldr]"));
  await pane.unmount();

  const band = await $.ui.mount({ ...BAND, surface: "terminal" });
  expect(await band.find({ type: "Text", text: /this approach/ })).toBeUndefined();
  await band.unmount();
});

test("直すところの無い card は一瞬だけ出して、pane から消す", async ($, on) => {
  const clock = mock.clock(on);
  engine(on, "closed", COMPANION, JSON.stringify({ status: "ok", model: "opus", items: [] }));
  await open($);
  await typed($, "fine prompt");
  await settle();

  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await pane.find({ type: "Text", text: /nothing to flag/ })).toBeDefined();
  await clock.advance(2_000);
  expect(await pane.find({ type: "Text", text: /nothing to flag/ })).toBeUndefined();
  expect(await pane.find({ type: "Text", text: /Prompts with something to fix/ })).toBeDefined();
  await pane.unmount();
});

test("知らない widget は飛ばし、残りで pane を描く", async ($, on) => {
  engine(on, "closed", {
    ...COMPANION,
    widgets: [
      { id: "nope", share: 1 },
      { id: "tldr", share: 1 },
    ],
  });
  await open($);

  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await pane.find({ type: "Text", text: /\[tldr\]/ })).toBeDefined();
  expect(await pane.find({ type: "Text", text: /Prompts with something to fix/ })).toBeUndefined();
  await pane.unmount();
});

function answered($: EngineInterface, answer: string) {
  return $.turn.complete({
    answer,
    durationMs: 1,
    isAborted: false,
    turnId: crypto.randomUUID(),
    reason: "answer",
  } as never);
}

test("回答ごとに直前の turn ごと kura tldr に渡し、要約を出す", async ($, on) => {
  const state = engine(on, "closed");
  await open($);
  for (const n of [1, 2, 3, 4, 5]) {
    await typed($, `q${n}`);
    await settle();
    await answered($, `a${n}`);
  }
  await settle();

  const sent = state.calls.filter((call) => call.argv[1] === "tldr").at(-1);
  expect(JSON.parse(sent?.stdin ?? "{}")).toEqual({
    turns: [2, 3, 4, 5].map((n) => ({ question: `q${n}`, answer: `a${n}` })),
  });
  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await pane.find({ type: "Text", text: /three lines/ })).toBeDefined();
  await pane.unmount();
});

test("tldr は turn を古い順に、question 1 行と要約で出す", async ($, on) => {
  engine(on, "closed");
  await open($);
  for (const n of [1, 2, 3, 4]) {
    await typed($, `question ${n}`);
    await settle();
    await answered($, `a${n}`);
  }
  await settle();

  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  const text = (await pane.find({ type: "Box" }))?.text ?? "";
  const tldr = text.slice(text.indexOf("[tldr]"));
  expect(tldr.indexOf("question 1")).toBeLessThan(tldr.indexOf("question 2"));
  expect(tldr.indexOf("question 2")).toBeLessThan(tldr.indexOf("question 3"));
  expect(tldr.indexOf("question 3")).toBeLessThan(tldr.indexOf("question 4"));
  expect(tldr.split("three lines").length - 1).toBe(4);
  await pane.unmount();
});

test("要約ができたら、question は kura tldr がまとめた 1 行で出す", async ($, on) => {
  engine(on, "closed", COMPANION, JSON.stringify(CARD), false, {
    status: "ok",
    text: "three lines",
    question: "asked about kura",
  });
  await open($);
  await typed($, "a very long prompt about kura that goes on and on");
  await settle();
  await answered($, "a");
  await settle();

  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  const text = (await pane.find({ type: "Box" }))?.text ?? "";
  expect(text).toContain("> asked about kura");
  expect(text).not.toContain("goes on and on");
  await pane.unmount();
});

test("pane が閉じている間にたまった card と要約を、開いたときに出す", async ($, on) => {
  engine(on, "closed");
  await typed($, "I think kono houhou is good");
  await settle();
  await answered($, "a");
  await settle();
  await open($);

  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await pane.find({ type: "Text", text: /this approach/ })).toBeDefined();
  expect(await pane.find({ type: "Text", text: /three lines/ })).toBeDefined();
  await pane.unmount();
});

test("companion.enabled が false なら何も生成せず、pane も開かない", async ($, on) => {
  const state = engine(on, "closed", { ...COMPANION, enabled: false });
  await typed($, "I think kono houhou is good");
  await settle();
  await answered($, "a");
  await settle();
  expect(generated(state)).toEqual([]);

  const result = await $.command.run({ command: "kura-companion" });
  expect(JSON.stringify(result)).toContain("companion.enabled");
  expect(state.opened).toEqual([]);
});

test("生成を待つ間は文言と記号の spinner を出す", async ($, on) => {
  engine(on, "closed", COMPANION, JSON.stringify(CARD), true);
  await open($);
  await typed($, "I think kono houhou is good");
  await settle();
  await answered($, "a");
  await settle();

  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  const text = (await pane.find({ type: "Box" }))?.text ?? "";
  // 同じ prompt の card と turn は同じ文言の spinner になる。
  const words = text.match(/(Pondering|Distilling|Brewing|Mulling|Polishing|Simmering)…/g) ?? [];
  expect(words.length).toBe(2);
  expect(words[0]).toBe(words[1]);
  expect(text).toMatch(/\((\d+s · )?proofreading\)/);
  expect(text).toMatch(/\((\d+s · )?summarizing\)/);
  await pane.unmount();
});

test("tldr は prompt を打った時点で回答待ちの spinner だけを出し、prompt は出さない", async ($, on) => {
  engine(on, "closed");
  await open($);
  await typed($, "what is kura?");
  await settle();

  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  const text = (await pane.find({ type: "Box" }))?.text ?? "";
  expect(text).not.toContain("what is kura?");
  expect(text).toMatch(/…\s\((\d+s · )?waiting\)/);
  expect(text).toMatch(/(Pondering|Distilling|Brewing|Mulling|Polishing|Simmering)…/);
  await pane.unmount();
});

test("中断した turn は tldr から消し、command は turn にしない", async ($, on) => {
  const state = engine(on, "closed");
  await open($);
  await typed($, "/reload-plugins");
  await typed($, "never mind");
  await settle();
  await $.turn.complete({
    answer: "",
    durationMs: 1,
    isAborted: true,
    turnId: crypto.randomUUID(),
    reason: "aborted",
  } as never);
  await settle();

  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await pane.find({ type: "Text", text: /never mind|reload-plugins/ })).toBeUndefined();
  expect(
    await pane.find({ type: "Text", text: /The next answer is summarized here/ }),
  ).toBeDefined();
  await pane.unmount();
  expect(state.calls.filter((call) => call.argv[1] === "tldr")).toEqual([]);
});

test("/kura-handoff はこの session の id を kura handoff に渡すだけ", async ($, on) => {
  const state = engine(on, "closed");
  on("session.id", async () => ({ value: "9c48e030-f8d5-4a82-a57f-5e0f4dc15b2c" }));
  await $.command.run({ command: "kura-handoff" });
  expect(state.calls.map((call) => call.argv)).toEqual([
    ["kura", "handoff", "9c48e030-f8d5-4a82-a57f-5e0f4dc15b2c"],
  ]);
  expect(state.opened).toEqual([]);
});
