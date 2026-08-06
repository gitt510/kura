import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { insertCall, usageSummary, type UsageRecord } from "./usage.ts";

const schema = readFileSync(`${import.meta.dir}/usage-schema.sql`, "utf-8");

function memoryDb(): Database {
  const db = new Database(":memory:");
  db.exec(schema);
  return db;
}

function claudeCall(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    feature: "companion",
    agent: "claude",
    model: "claude-haiku-4-5",
    ok: true,
    usage: {
      inputTokens: 10,
      cacheCreationTokens: 100,
      cacheReadTokens: 1000,
      outputTokens: 40,
      costUsd: 0.01,
    },
    ...overrides,
  };
}

test("feature × model ごとに call 数・token・cost を合計する", () => {
  const db = memoryDb();
  insertCall(db, claudeCall(), "2026-08-06T00:00:00.000Z");
  insertCall(db, claudeCall({ ok: false }), "2026-08-06T01:00:00.000Z");
  insertCall(
    db,
    claudeCall({
      feature: "timeline",
      agent: "codex",
      model: null,
      usage: {
        inputTokens: 200,
        cacheCreationTokens: 0,
        cacheReadTokens: 50,
        outputTokens: 80,
        costUsd: null,
      },
    }),
    "2026-08-06T02:00:00.000Z",
  );

  expect(usageSummary(db, null)).toEqual([
    {
      feature: "companion",
      model: "claude-haiku-4-5",
      calls: 2,
      input_tokens: 20,
      cache_creation_tokens: 200,
      cache_read_tokens: 2000,
      output_tokens: 80,
      cost_usd: 0.02,
    },
    {
      feature: "timeline",
      model: null,
      calls: 1,
      input_tokens: 200,
      cache_creation_tokens: 0,
      cache_read_tokens: 50,
      output_tokens: 80,
      cost_usd: null,
    },
  ]);
});

test("since で期間を絞れる", () => {
  const db = memoryDb();
  insertCall(db, claudeCall(), "2026-07-01T00:00:00.000Z");
  insertCall(db, claudeCall(), "2026-08-06T00:00:00.000Z");

  const rows = usageSummary(db, "2026-08-01T00:00:00.000Z");
  expect(rows).toHaveLength(1);
  expect(rows[0]!.calls).toBe(1);
});
