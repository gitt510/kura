import { expect, test } from "bun:test";
import { runProvenance } from "./provenance.ts";

test("runProvenance は自動実行で明示指定した model / effort を保持する", () => {
  expect(runProvenance("gpt-5.6", "high")).toEqual({ model: "gpt-5.6", effort: "high" });
});
