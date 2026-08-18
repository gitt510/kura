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
  test("pending は meta 行 (時刻 · project) + [input] + processing 行 — 改行は空白に潰す", () => {
    const createdAt = "2026-08-17T00:00:00.000Z";
    const at = new Date(createdAt);
    const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    const line = formatEvent({
      type: "pending",
      input: "one\ntwo",
      created_at: createdAt,
      cwd: "/Users/tg/ghq/github.com/gitt510/kura",
    });
    expect(strip(line)).toBe(`${hhmm} · kura\n[input] one two\n[output] processing …`);
  });

  test("meta 要素が欠けたら残りだけ、両方無ければ meta 行ごと省く", () => {
    const noCwd = formatEvent({ type: "pending", input: "x", created_at: "broken", cwd: null });
    expect(strip(noCwd)).toBe("[input] x\n[output] processing …");
    const cwdOnly = formatEvent({ type: "pending", input: "x", cwd: "/a/b" });
    expect(strip(cwdOnly)).toBe("b\n[input] x\n[output] processing …");
  });

  test("長い input は 80 code point + … に切り詰める", () => {
    const line = formatEvent({ type: "pending", input: "あ".repeat(100) });
    expect(strip(line)).toContain(`[input] ${"あ".repeat(80)}…\n`);
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
