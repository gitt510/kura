import type { RenderElement } from "claude-code";
import { expect, mock, test } from "claude-code/testing";
import { joinRows, parseNumstat, parseStatus, previewLines, previewOf } from "../hooks/glance";

const STATUS = [
  " M src/a.ts",
  "?? src/new.ts",
  "D  src/gone.ts",
  "R  old.ts -> renamed.ts",
  "",
].join("\n");
const NUMSTAT = ["3\t1\tsrc/a.ts", "0\t12\tsrc/gone.ts", "2\t2\told.ts => renamed.ts", ""].join(
  "\n",
);

test("diff は最初の hunk に切り、数え直し、後ろの context を落とす", () => {
  const diff = [
    "--- a/x",
    "+++ b/x",
    "@@ -10,4 +10,5 @@",
    " ctx",
    "-gone",
    "+here",
    "+too",
    " tail",
    "@@ -40,1 +41,1 @@",
    "-x",
    "+y",
    "",
  ].join("\n");
  expect(previewOf(diff, 7)).toEqual({
    preview: "@@ -10,2 +10,3 @@\n ctx\n-gone\n+here\n+too",
    more: 2,
  });
  expect(previewOf("", 7)).toEqual({ preview: "", more: 0 });
});

test("preview の行は側ごとに番号を振る", () => {
  expect(previewLines("@@ -10,2 +10,3 @@\n ctx\n-gone\n+here\n+too")).toEqual([
    { number: 10, mark: " ", text: "ctx" },
    { number: 11, mark: "-", text: "gone" },
    { number: 11, mark: "+", text: "here" },
    { number: 12, mark: "+", text: "too" },
  ]);
});

test("status は kind に、numstat は数に読み、row にまとめる", () => {
  const status = parseStatus(STATUS);
  expect(status).toEqual([
    { path: "src/a.ts", kind: "changed" },
    { path: "src/new.ts", kind: "added" },
    { path: "src/gone.ts", kind: "deleted" },
    { path: "renamed.ts", kind: "changed" },
  ]);
  const numstat = parseNumstat(NUMSTAT);
  expect(numstat.get("renamed.ts")).toEqual({ added: 2, removed: 2 });
  const rows = joinRows(status, numstat, new Map([["src/new.ts", 7]]), [
    {
      path: "src/a.ts",
      kind: "changed",
      added: 1,
      removed: 0,
      preview: "@@ -1 +1 @@\n+x",
      more: 0,
    },
  ]);
  expect(rows.find((row) => row.path === "src/new.ts")).toEqual({
    path: "src/new.ts",
    kind: "added",
    added: 7,
    removed: 0,
    preview: "",
    more: 0,
  });
  expect(rows.find((row) => row.path === "src/a.ts")).toMatchObject({
    added: 3,
    removed: 1,
    preview: "@@ -1 +1 @@\n+x",
  });
});

function ran(exitCode: number, stdout: string) {
  return {
    value: { exitCode, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false },
  };
}

const COMPANION = { autoOpen: false, columns: 64, rows: null, widgets: ["glance"], ratio: 0.5 };
const NINE = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

test("書いている file に spinner を出し、終われば worktree の変更を preview 付きで出す", async ($, on) => {
  const clock = mock.clock(on);
  on("process.run", async (_$, e) => {
    const argv = e.argv.join(" ");
    if (argv === "kura config") return ran(0, JSON.stringify({ mod: { companion: COMPANION } }));
    if (argv.startsWith("git status")) return ran(0, STATUS);
    if (argv.startsWith("git diff --no-index --numstat"))
      return ran(1, "9\t0\t/dev/null => src/new.ts\n");
    if (argv.startsWith("git diff --no-index")) {
      return ran(
        1,
        `--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,9 @@\n${NINE.map((l) => `+${l}`).join("\n")}\n`,
      );
    }
    if (argv.startsWith("git diff -U1 HEAD --")) {
      return ran(0, "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old line\n+new line\n");
    }
    if (argv.startsWith("git diff --numstat")) return ran(0, NUMSTAT);
    if (argv.startsWith("git rev-parse")) return ran(0, "/repo\n");
    if (argv.startsWith("git branch")) return ran(0, "main\n");
    return ran(1, "");
  });
  on("ui.render", async ($, e) => {
    const { Box } = $.ui.resolve(e);
    return h(Box, {}) as RenderElement;
  });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  on("tool.call", async () => {
    await held;
    return { result: "ok", text: "ok" } as never;
  });

  const call = $.tool.call({ tool: "Write", file_path: "/repo/src/new.ts", content: "x" } as never);
  await clock.settle();
  const pane = await $.ui.mount({
    plugin: "kura",
    component: "Pane",
    requestId: "kura-companion",
    surface: "terminal",
    props: { bodyColumns: 80, scroll: { offset: 0, bodyRows: 30 } } as never,
  });
  expect(await pane.find({ text: /^new\.ts \S editing {2}src$/ })).toBeDefined();

  release();
  await call;
  await clock.advance(1_000);
  expect(await pane.find({ text: /editing/ })).toBeUndefined();
  expect(await pane.find({ type: "Text", text: /^4 files changed$/ })).toBeDefined();
  expect(await pane.findAll({ type: "Text", text: /^ M $/ })).toHaveLength(2);
  expect(await pane.findAll({ type: "Text", text: /^ A $/ })).toHaveLength(1);
  expect(await pane.find({ type: "Text", text: /^\+ seven$/ })).toBeDefined();
  expect(await pane.find({ type: "Text", text: /^\+ eight$/ })).toBeUndefined();
  expect(await pane.find({ type: "Text", text: /^- old line$/ })).toBeDefined();
  expect(await pane.find({ text: /… 2 more/ })).toBeDefined();
  await pane.unmount();
});
