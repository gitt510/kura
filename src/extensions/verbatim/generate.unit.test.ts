import { expect, test } from "bun:test";
import { defaultConfig } from "../../config.ts";
import { buildPrompt, parseVerbatimInput, resolveVerbatimModel } from "./generate.ts";

test("system は文全体を逐語に写す規則、prompt は直前の turn と入力", () => {
  const { system, prompt } = buildPrompt({
    input: "なんだっけ、あー、this を直して。まあ。",
    turns: [{ question: "q1", answer: "a1" }],
  });
  expect(prompt).toBe(
    "<context><user>q1</user>\n<assistant>a1</assistant></context>\n<input>なんだっけ、あー、this を直して。まあ。</input>",
  );
  expect(system).toContain("Say the whole <input> again");
  expect(system).toContain("Keep every filler, hesitation");
  expect(system).toContain("put [pasted] in their place");
  expect(system).toContain("Never translate or mention it");
  expect(system).toContain("Reply with the English alone");
  expect(system).not.toContain("JSON");
});

test("context は直前 1 turn だけ、長い turn は切り詰め、無ければ空の tag", () => {
  const long = { question: "q".repeat(2000), answer: "a".repeat(2000) };
  const { prompt } = buildPrompt({ input: "x", turns: [{ question: "q1", answer: "a1" }, long] });
  expect(prompt).not.toContain("q1");
  expect(prompt).toContain(`<user>${"q".repeat(1500)}</user>`);
  expect(buildPrompt({ input: "x", turns: [] }).prompt).toBe(
    "<context></context>\n<input>x</input>",
  );
});

test("stdin は input 必須、turns 省略可、形が違えば拒否", () => {
  expect(parseVerbatimInput('{"input": "fix this"}')).toEqual({ input: "fix this", turns: [] });
  expect(parseVerbatimInput('{"input": "x", "turns": [{"question": "q", "answer": "a"}]}')).toEqual(
    { input: "x", turns: [{ question: "q", answer: "a" }] },
  );
  for (const raw of ["not json", "{}", '{"input": 1}', '{"input": "x", "turns": [{"q": 1}]}']) {
    expect(() => parseVerbatimInput(raw)).toThrow();
  }
});

test("model の既定は opus、null と書けば CLI の既定", () => {
  expect(resolveVerbatimModel(defaultConfig())).toBe("opus");
  const config = defaultConfig();
  config.extensions.verbatim.model = null;
  expect(resolveVerbatimModel(config)).toBeNull();
});
