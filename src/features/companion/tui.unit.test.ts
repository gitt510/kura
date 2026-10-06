import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import type { CardRow } from "./db.ts";
import { formatEvent, parseItems } from "./tui.ts";

const strip = (text: string | null) => text && stripVTControlCharacters(text).replace(/\r/g, "");

const SEP = "─".repeat(64);

function card(over: Partial<CardRow>): CardRow {
  return {
    key: "k",
    session_id: "s",
    cwd: null,
    lang: null,
    input: "入力",
    output: null,
    note: JSON.stringify([{ kind: "romaji", from: "housin", to: "the approach" }]),
    model: "m",
    status: "ok",
    created_at: "2026-08-17T00:00:00.000Z",
    ...over,
  };
}

// created_at を local の yyyy-mm-dd hh:mm:ss に (test は TZ に依存しないよう同じ計算で組む)。
function localStamp(iso: string): string {
  const at = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

describe("parseItems", () => {
  test("items JSON はそのまま、旧 row (全文訳 / string 配列 / plain string) は note に畳む", () => {
    expect(parseItems(card({}))).toEqual([{ kind: "romaji", from: "housin", to: "the approach" }]);
    expect(parseItems({ output: "Fix this.", note: JSON.stringify(["a → b"]) })).toEqual([
      { kind: "note", text: "Fix this." },
      { kind: "note", text: "a → b" },
    ]);
    expect(parseItems({ output: null, note: "plain" })).toEqual([{ kind: "note", text: "plain" }]);
    expect(parseItems({ output: null, note: "[]" })).toEqual([]);
    expect(parseItems({ output: null, note: null })).toEqual([]);
  });

  test("不正な要素 (null / kind 不明 / from が非文字列 / 空 string) は落とす", () => {
    const note = JSON.stringify([
      null,
      "",
      { kind: "typo", from: "a", to: "b" },
      { kind: "romaji", from: 1, to: "x" },
      { kind: "romaji", from: "taiou", to: "handle" },
    ]);
    expect(parseItems({ output: null, note })).toEqual([
      { kind: "romaji", from: "taiou", to: "handle" },
    ]);
  });
});

describe("formatEvent", () => {
  test("pending は [meta] 時刻 · project · branch / [input] / [status] — 改行は空白に潰す", () => {
    const createdAt = "2026-08-17T00:00:00.000Z";
    const line = formatEvent({
      type: "pending",
      input: "one\ntwo",
      created_at: createdAt,
      cwd: "/Users/tg/ghq/github.com/gitt510/kura",
      branch: "main",
    });
    expect(strip(line)).toBe(
      `[meta]    ${localStamp(createdAt)} · kura · main\n[input]   one two\n[status]  processing …`,
    );
  });

  test("meta 要素が欠けたら残りだけ、全部無ければ [meta] の label だけ", () => {
    const noBranch = formatEvent({
      type: "pending",
      input: "x",
      created_at: "broken",
      cwd: "/a/b",
    });
    expect(strip(noBranch)).toStartWith("[meta]    b\n");
    const nothing = formatEvent({ type: "pending", input: "x", created_at: "broken", cwd: null });
    expect(strip(nothing)).toStartWith("[meta]    \n");
  });

  test("長い input は 80 code point + … に切り詰める", () => {
    const line = formatEvent({ type: "pending", input: "あ".repeat(100) });
    expect(strip(line)).toContain(`[input]   ${"あ".repeat(80)}…\n`);
  });

  test("card は行頭復帰 + 行クリアで [status] 行を上書きする", () => {
    expect(formatEvent({ type: "card", card: card({}) })).toStartWith("\r\x1b[K");
  });

  test("card は item ごとに [kind] from → to、label は 10 桁に揃い、末尾に separator", () => {
    const text = formatEvent({
      type: "card",
      card: card({
        note: JSON.stringify([
          { kind: "romaji", from: "taiou", to: "handle" },
          { kind: "grammar", from: "What determine", to: "What determines（三単現の -s）" },
          {
            kind: "natural",
            from: "change companion behavior",
            to: "change how companion behaves",
          },
        ]),
      }),
    });
    expect(strip(text)).toBe(
      "[romaji]  taiou → handle\n" +
        "[grammar] What determine → What determines（三単現の -s）\n" +
        `[natural] change companion behavior → change how companion behaves\n${SEP}\n`,
    );
  });

  test("指摘ゼロは [done] nothing to flag の 1 行", () => {
    const text = formatEvent({ type: "card", card: card({ note: "[]" }) });
    expect(strip(text)).toBe(`[done]    nothing to flag\n${SEP}\n`);
  });

  test("旧 row の全文訳と plain string note は [note] で見せる", () => {
    const text = formatEvent({ type: "card", card: card({ output: "Fix this.", note: "plain" }) });
    expect(strip(text)).toBe(`[note]    Fix this.\n[note]    plain\n${SEP}\n`);
  });

  test("error card は failed の 1 行", () => {
    const text = formatEvent({ type: "card", card: card({ status: "error", note: null }) });
    expect(strip(text)).toBe(`[error]   generation failed\n${SEP}\n`);
  });

  test("知らない event は書かない", () => {
    expect(formatEvent({ type: "mystery" })).toBeNull();
  });
});
