import { expect, test } from "bun:test";
import { discordIdentity } from "./identity.ts";

const AVATARS = { claude: "https://example.test/claude.png" };

test("model family 別 avatar と provenance から投稿者表示を作る", () => {
  expect(discordIdentity("claude-opus-5", "high", "Timeline", AVATARS)).toEqual({
    username: "claude-opus-5 (high)",
    avatar_url: "https://example.test/claude.png",
  });
  expect(discordIdentity("claude-fable-5", null, "Timeline", AVATARS).avatar_url).toBe(
    "https://example.test/claude.png",
  );
});

test("avatar 未設定では model 名だけを使い、model 不明では feature 名へ戻る", () => {
  expect(discordIdentity("gpt-5.4", null, "Timeline", { gpt: "" })).toEqual({
    username: "gpt-5.4",
  });
  expect(discordIdentity(null, "high", "Timeline", AVATARS)).toEqual({ username: "Timeline" });
});

test("webhook username の80文字上限に収める", () => {
  const identity = discordIdentity("m".repeat(100), "high", "Timeline", {});
  expect(identity.username.length).toBe(80);
  expect(identity.username.endsWith("…")).toBe(true);
});
