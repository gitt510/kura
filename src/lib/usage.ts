// usage.ts — LLM 呼び出しの token / cost 台帳 (usage.db) への型付きアクセス窓口。
//
// このファイルが schema owner: openUsageDb() が usage-schema.sql を冪等に適用する。
// 記録は fail-open — 観測の失敗が生成を壊してはならないので、insert に失敗しても
// stderr に 1 行残して処理を続ける。

import type { Database } from "bun:sqlite";
import { legacyDbPath, openStateDatabase, stateDbPath } from "./storage.ts";

// agent の公開出力から読み取った 1 call 分の消費量。
export interface AgentUsage {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number | null; // Codex の公開 event は cost を含まないため null
}

export interface UsageRecord {
  feature: string;
  agent: string;
  model: string | null;
  ok: boolean;
  usage: AgentUsage;
}

export interface UsageSummaryRow {
  feature: string;
  model: string | null;
  calls: number;
  input_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  cost_usd: number | null; // 全 row が cost 無し (Codex) なら null
}

const SCHEMA_SQL = `${import.meta.dir}/usage-schema.sql`;

// path 解決は呼び出し時まで遅延する — module load で state dir を作らない
// (`kura --help` や setup 前の実行が state を生やさないため)。
export function usageDbPath(): string {
  return stateDbPath("usage.db", legacyDbPath("usage", "usage.db"));
}

export function openUsageDb(): Database {
  return openStateDatabase(usageDbPath(), SCHEMA_SQL);
}

export function insertCall(db: Database, record: UsageRecord, createdAt: string): void {
  db.query(
    `INSERT INTO calls
       (feature, agent, model, ok, input_tokens, cache_creation_tokens,
        cache_read_tokens, output_tokens, cost_usd, created_at)
     VALUES
       ($feature, $agent, $model, $ok, $input_tokens, $cache_creation_tokens,
        $cache_read_tokens, $output_tokens, $cost_usd, $created_at)`,
  ).run({
    $feature: record.feature,
    $agent: record.agent,
    $model: record.model,
    $ok: record.ok ? 1 : 0,
    $input_tokens: record.usage.inputTokens,
    $cache_creation_tokens: record.usage.cacheCreationTokens,
    $cache_read_tokens: record.usage.cacheReadTokens,
    $output_tokens: record.usage.outputTokens,
    $cost_usd: record.usage.costUsd,
    $created_at: createdAt,
  });
}

export function recordUsage(record: UsageRecord): void {
  try {
    const db = openUsageDb();
    try {
      insertCall(db, record, new Date().toISOString());
    } finally {
      db.close();
    }
  } catch (error) {
    process.stderr.write(`usage record failed (ignored): ${error}\n`);
  }
}

// feature × model ごとの合計。since (ISO 8601) 以降に絞れる。
export function usageSummary(db: Database, since: string | null): UsageSummaryRow[] {
  return db
    .query(
      `SELECT feature, model, COUNT(*) AS calls,
              SUM(input_tokens) AS input_tokens,
              SUM(cache_creation_tokens) AS cache_creation_tokens,
              SUM(cache_read_tokens) AS cache_read_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cost_usd) AS cost_usd
         FROM calls
        WHERE $since IS NULL OR created_at >= $since
        GROUP BY feature, model
        ORDER BY feature, model`,
    )
    .all({ $since: since }) as UsageSummaryRow[];
}
