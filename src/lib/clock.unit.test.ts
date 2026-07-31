import { expect, test } from "bun:test";
import { hourTarget, previousCompletedHour, resolveHourArgs } from "./clock.ts";

test("previousCompletedHour は直近の完了 JST hour を返す", () => {
  expect(previousCompletedHour(Date.UTC(2026, 6, 15, 1, 30))).toEqual({
    date: "2026-07-15",
    hour: 9,
    windowStart: "2026-07-15 09:00:00",
  });
});

test("previousCompletedHour は日付境界をまたぐ", () => {
  expect(previousCompletedHour(Date.UTC(2026, 6, 14, 15, 30))).toEqual({
    date: "2026-07-14",
    hour: 23,
    windowStart: "2026-07-14 23:00:00",
  });
});

test("hour args は 0..23 だけを受け付ける", () => {
  expect(resolveHourArgs(["2026-07-15", "0"])).toEqual(hourTarget("2026-07-15", 0));
  expect(() => resolveHourArgs(["2026-07-15", "24"])).toThrow();
  expect(() => resolveHourArgs(["2026-07-15"])).toThrow();
});
