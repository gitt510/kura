import { expect, test } from "bun:test";
import { discordIdentity } from "./identity.ts";

const AVATAR = "https://example.test/claude.png";

test("feature の avatar と provenance から投稿者表示を作る", () => {
  expect(discordIdentity("claude-opus-5", "high", "Timeline", AVATAR)).toEqual({
    username: "claude-opus-5 (high)",
    avatar_url: AVATAR,
  });
});

test("avatar 未設定では model 名だけを使い、model 不明では feature 名へ戻る", () => {
  expect(discordIdentity("gpt-5.4", null, "Timeline", null)).toEqual({ username: "gpt-5.4" });
  expect(discordIdentity(null, "high", "Timeline", AVATAR)).toEqual({
    username: "Timeline",
    avatar_url: AVATAR,
  });
});

test("webhook username の80文字上限に収める", () => {
  const identity = discordIdentity("m".repeat(100), "high", "Timeline", null);
  expect(identity.username.length).toBe(80);
  expect(identity.username.endsWith("…")).toBe(true);
});
