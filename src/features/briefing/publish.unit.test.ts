import { expect, test } from "bun:test";
import {
  buildDiscordBody,
  parseBriefingPayload,
  type Payload,
} from "./publish.ts";

function repo(name: string, oneLine: string) {
  return { repo: name, one_line: oneLine };
}

test("oversizedな先頭repoを切り詰めて空payloadを作らない", () => {
  const payload: Payload = {
    date: "2026-07-24",
    repos: [repo("first", "x".repeat(10_000)), repo("second", "short")],
  };

  const result = buildDiscordBody(payload, { model: null });
  expect(result.body.embeds.length).toBeGreaterThan(0);
  expect(result.body.embeds[0]!.description.length).toBeLessThanOrEqual(3900);
  expect(result.body.embeds.some((embed) => embed.description.includes("second"))).toBe(true);
});

test("収まらないrepoがあっても後続の小さいrepoを検討する", () => {
  const payload: Payload = {
    date: "2026-07-24",
    repos: [
      repo("first", "x".repeat(3800)),
      repo("does-not-fit", "y".repeat(2500)),
      repo("later", "short"),
    ],
  };

  const result = buildDiscordBody(payload, { model: null });
  const rendered = result.body.embeds.map((embed) => embed.description).join("\n");
  expect(rendered).not.toContain("does-not-fit");
  expect(rendered).toContain("later");
  expect(result.shown).toBe(2);
});

test("briefing payload のrootと必須fieldを検証する", () => {
  expect(() => parseBriefingPayload(null)).toThrow("briefing must be an object");
  expect(() => parseBriefingPayload({ repos: [{}] }, "2026-07-24")).toThrow(
    "briefing.repos[0].repo must be a string",
  );
  expect(() => parseBriefingPayload({ repos: [] }, "2026-07-24")).toThrow(
    "briefing.repos must not be empty",
  );
});

test("description・title・footerの合計をDiscord上限内に収める", () => {
  const payload: Payload = {
    date: "2026-07-24",
    repos: Array.from({ length: 10 }, (_, index) =>
      repo(`repo-${index}`, "x".repeat(1000)),
    ),
  };
  const result = buildDiscordBody(payload, {
    model: "m".repeat(1000),
    effort: "high",
  });
  const total = result.body.embeds.reduce(
    (sum, embed) =>
      sum +
      (embed.title?.length ?? 0) +
      embed.description.length +
      (embed.footer?.text.length ?? 0),
    0,
  );
  expect(total).toBeLessThanOrEqual(6000);
  expect(result.body.username.length).toBe(80);
  expect(result.body.username.endsWith("…")).toBe(true);
  expect(result.body.embeds.at(-1)?.footer).toBeUndefined();
});

test("生成 provenance は投稿者名へ移し、footer は trending 件数だけを持つ", () => {
  const payload: Payload = {
    date: "2026-07-24",
    repos: [repo("first", "short")],
  };
  const result = buildDiscordBody(payload, {
    trendingCount: 25,
    model: "gpt-5.6-sol",
    effort: "high",
  });

  expect(result.body.username).toBe("gpt-5.6-sol (high)");
  expect(result.body.embeds.at(-1)?.footer?.text).toBe("trending 25 件 → 表示 1 件");
});
