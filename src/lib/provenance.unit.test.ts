import { expect, test } from "bun:test";
import { provenanceName, runProvenance } from "./provenance.ts";

test("provenanceName は model が無ければ null、effort は括弧で添える", () => {
  expect(provenanceName("claude-fable-5", "high")).toBe("claude-fable-5 (high)");
  expect(provenanceName("claude-fable-5", null)).toBe("claude-fable-5");
  expect(provenanceName(null, "high")).toBeNull();
});

test("runProvenance は自動実行で明示指定した model / effort を保持する", () => {
  expect(runProvenance("gpt-5.6", "high")).toEqual({ model: "gpt-5.6", effort: "high" });
});
