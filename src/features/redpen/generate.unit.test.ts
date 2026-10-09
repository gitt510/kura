import { expect, test } from "bun:test";
import { defaultConfig } from "../../lib/config.ts";
import { buildPrompt, parseCardJson, resolveRedpenModel } from "./generate.ts";

test("system は 3 種類の item 契約、prompt は直前の assistant 文脈と入力を持ち、言語は指定しない", () => {
  const { system: prompt, prompt: material } = buildPrompt({
    input: "これを直して",
    context: "I fixed auth.ts",
  });
  expect(material).toBe("<context>I fixed auth.ts</context>\n<input>これを直して</input>");
  expect(prompt).toContain('{"items": [{"kind": "romaji", "from": "...", "to": "..."}]}');
  expect(prompt).toContain('reply exactly {"items": []}');
  expect(prompt).toContain('"from" must be a verbatim fragment of <input>');
  expect(prompt).toContain("Do NOT translate or rewrite the whole input.");
  expect(prompt).toContain("Japanese written in kana or kanji is NOT feedback material");
  expect(prompt).toContain('"to" is the English alone');
  expect(prompt).not.toContain("rule name in Japanese");
  expect(prompt).toContain("Never make items for: spelling, typos");
  expect(prompt).toContain("One item per fragment");
  expect(prompt).not.toContain("lang=");
});

test("文脈なしでは空の context tag になり、長い文脈は切られる", () => {
  expect(buildPrompt({ input: "x y z", context: null }).prompt).toContain("<context></context>");
  const clipped = buildPrompt({ input: "x y z", context: "c".repeat(5000) }).prompt;
  expect(clipped).toContain(`<context>${"c".repeat(1200)}</context>`);
});

test("items JSON は code fence 込みでも受け、空配列は空配列、items 欠落は null", () => {
  expect(
    parseCardJson('{"items": [{"kind": "romaji", "from": "housin", "to": "the approach"}]}'),
  ).toEqual([{ kind: "romaji", from: "housin", to: "the approach" }]);
  expect(parseCardJson('```json\n{"items": []}\n```')).toEqual([]);
  expect(parseCardJson('{"english": "old contract"}')).toBeNull();
  expect(parseCardJson("not json at all")).toBeNull();
  expect(parseCardJson("null")).toBeNull();
});

test("kind 不明や from / to 欠落の要素は落とし、5 件で切る", () => {
  const items = [
    null,
    "a string",
    { kind: "typo", from: "breifing", to: "briefing" },
    { kind: "romaji", from: 1, to: "x" },
    { kind: "grammar", from: "What determine", to: "What determines（三単現の -s）" },
    { kind: "natural", from: "", to: "x" },
    { kind: "ja", from: "こうやって", to: "like this" },
    { kind: "romaji", from: "taiou", to: " handle " },
  ];
  expect(parseCardJson(JSON.stringify({ items }))).toEqual([
    { kind: "grammar", from: "What determine", to: "What determines（三単現の -s）" },
    { kind: "romaji", from: "taiou", to: "handle" },
  ]);
  const many = Array.from({ length: 10 }, (_, i) => ({
    kind: "romaji",
    from: `f${i}`,
    to: `t${i}`,
  }));
  expect(parseCardJson(JSON.stringify({ items: many }))).toHaveLength(5);
});

test("model は config の redpen.model、無ければ opus", () => {
  expect(resolveRedpenModel(defaultConfig())).toBe("opus");
  expect(resolveRedpenModel({ ...defaultConfig(), redpen: { model: "sonnet" } })).toBe("sonnet");
});
