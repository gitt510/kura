import { expect, test } from "bun:test";
import { parseConfig } from "../../lib/config.ts";
import { buildPrompt, parseTldrInput, resolveTldrModel } from "./generate.ts";

const turn = (n: number) => ({ question: `q${n}`, answer: `a${n}` });

test("会話の続きとして、assistant 本人に「長い。3行で。」と返させる", () => {
  const { system, prompt } = buildPrompt({ turns: [turn(1)] });
  expect(prompt).toBe("長い。3行で。");
  expect(system).toBe(
    "<conversation>\n<user>q1</user>\n<assistant>a1</assistant>\n</conversation>\n\n" +
      "You are the assistant in this conversation. Reply to the user's next message.",
  );
});

test("会話には最後の turn と、その前の直近 3 turn だけを入れ、前の turn は切り詰める", () => {
  const long = { question: "q".repeat(2000), answer: "a".repeat(2000) };
  const { system } = buildPrompt({ turns: [turn(1), long, turn(3), turn(4), long] });
  expect(system).not.toContain("q1");
  expect(system).toContain(
    `<user>${"q".repeat(1500)}</user>\n<assistant>${"a".repeat(1500)}</assistant>\n<user>q3</user>`,
  );
  expect(system).toContain(
    `<user>${"q".repeat(2000)}</user>\n<assistant>${"a".repeat(2000)}</assistant>\n</conversation>`,
  );
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
