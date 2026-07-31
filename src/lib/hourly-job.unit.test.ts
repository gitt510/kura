import { expect, test } from "bun:test";
import { hourlyPlan } from "./hourly-job.ts";

test("未生成なら generate し、publish policy が enabled なら続けて publish する", () => {
  expect(hourlyPlan(false, false, false)).toEqual({
    generate: true,
    publish: false,
  });
  expect(hourlyPlan(false, true, false)).toEqual({
    generate: true,
    publish: true,
  });
});

test("生成済み・未配信なら LLM を再実行せず publish だけ retry する", () => {
  expect(hourlyPlan(true, true, false)).toEqual({
    generate: false,
    publish: true,
  });
  expect(hourlyPlan(true, true, true)).toEqual({
    generate: false,
    publish: false,
  });
});
