import { describe, expect, test } from "bun:test";
import type { CardRow } from "./db.ts";
import { formatEvent } from "./tui.ts";

const strip = (text: string | null) =>
  text?.replace(/\x1b\[[0-9;]*[mK]/g, "").replace(/\r/g, "");

function card(over: Partial<CardRow>): CardRow {
  return {
    key: "k",
    session_id: "s",
    cwd: null,
    lang: "ja",
    input: "入力",
    output: "Output.",
    note: null,
    model: "m",
    status: "ok",
    created_at: "2026-08-17T00:00:00.000Z",
    ...over,
  };
}

describe("formatEvent", () => {
  test("pending は [input] と改行なしの processing 行 — 改行は空白に潰す", () => {
    const line = formatEvent({ type: "pending", input: "one\ntwo" });
    expect(strip(line)).toBe("[input] one two\n[output] processing …");
  });

  test("card は行頭復帰 + 行クリアで processing 行を上書きする", () => {
    expect(formatEvent({ type: "card", card: card({}) })).toStartWith("\r\x1b[K");
  });

  test("card は [output] と note ごとの [note]、末尾に空行", () => {
    const text = formatEvent({
      type: "card",
      card: card({ note: JSON.stringify(["a → b（規則）", "OK 👍"]) }),
    });
    expect(strip(text)).toBe("[output] Output.\n[note] a → b（規則）\n[note] OK 👍\n\n");
  });

  test("配列化以前の plain string note も 1 件として受ける", () => {
    const text = formatEvent({ type: "card", card: card({ note: "plain" }) });
    expect(strip(text)).toContain("[note] plain\n");
  });

  test("error card は failed の 1 行", () => {
    const text = formatEvent({ type: "card", card: card({ status: "error", output: null }) });
    expect(strip(text)).toBe("[output] generation failed\n\n");
  });

  test("知らない event は書かない", () => {
    expect(formatEvent({ type: "mystery" })).toBeNull();
  });
});
