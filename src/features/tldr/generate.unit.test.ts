import { expect, test } from "bun:test";
import { parseConfig } from "../../lib/config.ts";
import { buildPrompt, parseTldrInput, resolveTldrModel } from "./generate.ts";

const turn = (n: number) => ({ question: `q${n}`, answer: `a${n}` });

test("prompt は最後の turn を圧縮対象にし、指示は「長い。3行で。」だけ", () => {
  const prompt = buildPrompt({ turns: [turn(1)] });
  expect(prompt).toBe("<question>q1</question>\n\n<answer>a1</answer>\n\n長い。3行で。");
});

test("prompt は最後の turn より前の直近 3 turn を context に入れる", () => {
  const prompt = buildPrompt({ turns: [1, 2, 3, 4, 5].map(turn) });
  expect(prompt).toStartWith("<context>\n<turn>\n<question>q2</question>");
  expect(prompt).not.toContain("q1");
  expect(prompt).toContain("<answer>a4</answer>\n</turn>\n</context>");
  expect(prompt).toEndWith("<question>q5</question>\n\n<answer>a5</answer>\n\n長い。3行で。");
});

test("parseTldrInput は turns の形を検証する", () => {
  expect(parseTldrInput('{"turns": [{"question": "q", "answer": "a"}]}')).toEqual({
    turns: [{ question: "q", answer: "a" }],
  });
  expect(() => parseTldrInput("nope")).toThrow("stdin is not JSON");
  expect(() => parseTldrInput('{"turns": [{"question": "q"}]}')).toThrow('stdin must be {"turns"');
  expect(() => parseTldrInput('{"turns": [{"question": "q", "answer": ""}]}')).toThrow(
    "empty answer",
  );
});

test("model は config の tldr.model、無ければ opus", () => {
  expect(resolveTldrModel(parseConfig({}, "config.json"))).toBe("opus");
  expect(resolveTldrModel(parseConfig({ tldr: { model: "sonnet" } }, "config.json"))).toBe(
    "sonnet",
  );
});
