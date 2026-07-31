import { expect, test } from "bun:test";
import { fitDiscordFields, truncateDiscordText } from "./discord-payload.ts";

test("Discord field の個別上限と embed 合計上限へ切り詰める", () => {
  const fields = Array.from({ length: 30 }, (_, i) => ({
    name: `${i}-${"n".repeat(300)}`,
    value: "v".repeat(2000),
  }));

  const fitted = fitDiscordFields(fields, 200);
  expect(fitted.length).toBeLessThanOrEqual(25);
  expect(fitted.every((field) => field.name.length <= 256)).toBe(true);
  expect(fitted.every((field) => field.value.length <= 1024)).toBe(true);
  expect(
    200 + fitted.reduce((sum, field) => sum + field.name.length + field.value.length, 0),
  ).toBeLessThanOrEqual(6000);
});

test("切り詰めた text の末尾を明示する", () => {
  expect(truncateDiscordText("abcdef", 4)).toBe("abc…");
  expect(truncateDiscordText("abc", 4)).toBe("abc");
});
