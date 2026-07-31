import { expect, test } from "bun:test";
import { createPaint, renderTable } from "./terminal.ts";

test("terminal color は明示的に有効なときだけ ANSI sequence を付ける", () => {
  expect(createPaint(false).green("READY")).toBe("READY");
  expect(createPaint(true).green("READY")).toBe("\u001b[32mREADY\u001b[39m");
});

test("table は box drawing で header と row を描画する", () => {
  expect(renderTable(["Name", "State"], [["cli", "READY"]])).toBe(
    [
      "┌──────┬───────┐",
      "│ Name │ State │",
      "├──────┼───────┤",
      "│ cli  │ READY │",
      "└──────┴───────┘",
    ].join("\n"),
  );
});
