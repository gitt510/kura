import { expect, test } from "bun:test";
import { buildPrompt, parseCardJson, resolveCompanionModel } from "./generate.ts";

test("prompt は lang / 入力 / 直前の assistant 文脈を含む", () => {
  const prompt = buildPrompt({ input: "これを直して", lang: "ja", context: "I fixed auth.ts" });
  expect(prompt).toContain('<input lang="ja">これを直して</input>');
  expect(prompt).toContain("<context>I fixed auth.ts</context>");
  expect(prompt).toContain('{"english": "...", "notes": ["...", "..."]}');
});

test("文脈なしでは空の context tag になり、長い文脈は切られる", () => {
  expect(buildPrompt({ input: "x y z", lang: "en", context: null })).toContain(
    "<context></context>",
  );
  const clipped = buildPrompt({ input: "x y z", lang: "en", context: "c".repeat(5000) });
  expect(clipped).toContain(`<context>${"c".repeat(1200)}</context>`);
});

test("card JSON は code fence 込みでも受け、english 欠落は null", () => {
  expect(parseCardJson('{"english": "Fix this please", "notes": ["OK 👍"]}')).toEqual({
    english: "Fix this please",
    notes: ["OK 👍"],
  });
  expect(parseCardJson('```json\n{"english": "Fix this", "notes": []}\n```')).toEqual({
    english: "Fix this",
    notes: [],
  });
  expect(parseCardJson('{"notes": ["missing english"]}')).toBeNull();
  expect(parseCardJson("not json at all")).toBeNull();
});

test("単数形 note や不正要素混じりの notes も配列に畳む", () => {
  expect(parseCardJson('{"english": "Fix", "note": "旧契約の 1 文"}')).toEqual({
    english: "Fix",
    notes: ["旧契約の 1 文"],
  });
  expect(parseCardJson('{"english": "Fix", "notes": ["a", 1, "", "b"]}')).toEqual({
    english: "Fix",
    notes: ["a", "b"],
  });
});

test("model は KURA_COMPANION_MODEL があればそれ、無ければ haiku", () => {
  expect(resolveCompanionModel({})).toBe("haiku");
  expect(resolveCompanionModel({ KURA_COMPANION_MODEL: "sonnet" })).toBe("sonnet");
  expect(resolveCompanionModel({ KURA_COMPANION_MODEL: "  " })).toBe("haiku");
});
