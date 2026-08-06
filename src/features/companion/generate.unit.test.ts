import { expect, test } from "bun:test";
import { buildPrompt, parseCardJson, resolveCompanionModel } from "./generate.ts";

test("prompt は lang / 入力 / 直前の assistant 文脈を含む", () => {
  const prompt = buildPrompt({ input: "これを直して", lang: "ja", context: "I fixed auth.ts" });
  expect(prompt).toContain('<input lang="ja">これを直して</input>');
  expect(prompt).toContain("<context>I fixed auth.ts</context>");
  expect(prompt).toContain('{"english": "...", "note": "..."}');
});

test("文脈なしでは空の context tag になり、長い文脈は切られる", () => {
  expect(buildPrompt({ input: "x y z", lang: "en", context: null })).toContain(
    "<context></context>",
  );
  const clipped = buildPrompt({ input: "x y z", lang: "en", context: "c".repeat(5000) });
  expect(clipped).toContain(`<context>${"c".repeat(1200)}</context>`);
});

test("card JSON は code fence 込みでも受け、english 欠落は null", () => {
  expect(parseCardJson('{"english": "Fix this please", "note": "OK 👍"}')).toEqual({
    english: "Fix this please",
    note: "OK 👍",
  });
  expect(parseCardJson('```json\n{"english": "Fix this", "note": ""}\n```')).toEqual({
    english: "Fix this",
    note: "",
  });
  expect(parseCardJson('{"note": "missing english"}')).toBeNull();
  expect(parseCardJson("not json at all")).toBeNull();
});

test("model は KURA_COMPANION_MODEL があればそれ、無ければ haiku", () => {
  expect(resolveCompanionModel({})).toBe("haiku");
  expect(resolveCompanionModel({ KURA_COMPANION_MODEL: "sonnet" })).toBe("sonnet");
  expect(resolveCompanionModel({ KURA_COMPANION_MODEL: "  " })).toBe("haiku");
});
