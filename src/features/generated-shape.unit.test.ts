import { expect, test } from "bun:test";
import { parseEnglishGenerated } from "./english/insert.ts";
import { parseTimelineGenerated } from "./timeline/insert.ts";

test("generated JSON のrootはobjectだけを受け付ける", () => {
  expect(() => parseTimelineGenerated(null)).toThrow("timeline must be an object");
  expect(() => parseEnglishGenerated("cards")).toThrow("english must be an object");
});

test("timeline thread の必須fieldをpath付きで検証する", () => {
  expect(() => parseTimelineGenerated({ threads: [{ label: "work" }] })).toThrow(
    "timeline.threads[0].bullets must be an array",
  );
});

test("english card の必須fieldをpath付きで検証する", () => {
  expect(() =>
    parseEnglishGenerated({
      cards: [{ ja: "日本語", phrase: "phrase" }],
    }),
  ).toThrow("english.cards[0].en must be a string");
});
