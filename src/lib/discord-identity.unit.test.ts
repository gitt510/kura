import { expect, test } from "bun:test";
import { discordIdentity } from "./discord-identity.ts";

test("model family 別 env と provenance から投稿者表示を作る", () => {
  const previous = process.env.KURA_DISCORD_AVATAR_CLAUDE;
  process.env.KURA_DISCORD_AVATAR_CLAUDE = "https://example.test/claude.png";
  try {
    expect(discordIdentity("claude-opus-5", "high", "Timeline")).toEqual({
      username: "claude-opus-5 (high)",
      avatar_url: "https://example.test/claude.png",
    });
    expect(discordIdentity("claude-fable-5", null, "Timeline").avatar_url).toBe(
      "https://example.test/claude.png",
    );
  } finally {
    if (previous === undefined) delete process.env.KURA_DISCORD_AVATAR_CLAUDE;
    else process.env.KURA_DISCORD_AVATAR_CLAUDE = previous;
  }
});

test("avatar 未設定では model 名だけを使い、model 不明では feature 名へ戻る", () => {
  const previous = process.env.KURA_DISCORD_AVATAR_GPT;
  process.env.KURA_DISCORD_AVATAR_GPT = "";
  try {
    expect(discordIdentity("gpt-5.4", null, "Timeline")).toEqual({
      username: "gpt-5.4",
    });
  } finally {
    if (previous === undefined) delete process.env.KURA_DISCORD_AVATAR_GPT;
    else process.env.KURA_DISCORD_AVATAR_GPT = previous;
  }
  expect(discordIdentity(null, "high", "Timeline")).toEqual({ username: "Timeline" });
});

test("webhook username の80文字上限に収める", () => {
  const identity = discordIdentity("m".repeat(100), "high", "Timeline");
  expect(identity.username.length).toBe(80);
  expect(identity.username.endsWith("…")).toBe(true);
});
