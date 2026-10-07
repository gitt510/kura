import { expect, test } from "bun:test";
import { clipInput, shouldSkip } from "./detect.ts";

test("相槌・合成 message・command 入力を skip する", () => {
  expect(shouldSkip("y")).toBe(true);
  expect(shouldSkip("  ok  ")).toBe(true);
  expect(shouldSkip("<system-reminder>...</system-reminder>")).toBe(true);
  expect(shouldSkip("/clear")).toBe(true);
  expect(shouldSkip("!ls -la")).toBe(true);
  expect(shouldSkip("fix the bug")).toBe(false);
  expect(shouldSkip("これを直して")).toBe(false);
});

test("3000 文字超の入力は先頭 1500 文字に切る", () => {
  const short = clipInput("a".repeat(3000));
  expect(short.truncated).toBe(false);
  expect(short.text).toHaveLength(3000);

  const long = clipInput("a".repeat(3001));
  expect(long.truncated).toBe(true);
  expect(long.text).toHaveLength(1500);
});
