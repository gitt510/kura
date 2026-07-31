// db.ts — daily briefing の生成物と publish 状態を保持する。

import { Database } from "bun:sqlite";
import {
  legacyDbPath,
  openStateDatabase,
  stateDbPath,
} from "../../lib/storage.ts";
import type { Payload } from "./publish.ts";

export const BRIEFING_DB = stateDbPath(
  "briefing.db",
  legacyDbPath("briefing", "briefing.db"),
);
const SCHEMA_SQL = `${import.meta.dir}/schema.sql`;

export interface BriefingEntry {
  date: string;
  payload: string;
  trending_count: number;
  gen_model: string | null;
  gen_effort: string | null;
  published_at: string | null;
}

export function openBriefingDb(): Database {
  return openStateDatabase(BRIEFING_DB, SCHEMA_SQL);
}

export function getBriefing(date: string): BriefingEntry | null {
  const db = openBriefingDb();
  try {
    return db.query("SELECT * FROM entries WHERE date = ?").get(date) as BriefingEntry | null;
  } finally {
    db.close();
  }
}

export function upsertBriefing(
  date: string,
  payload: Payload,
  trendingCount: number,
  model: string | null,
  effort: string | null,
): void {
  const db = openBriefingDb();
  try {
    const now = new Date().toISOString();
    db.query(
      `INSERT INTO entries
         (date, payload, trending_count, gen_model, gen_effort, created_at, updated_at)
       VALUES
         ($date, $payload, $trending_count, $gen_model, $gen_effort, $now, $now)
       ON CONFLICT(date) DO UPDATE SET
         payload=excluded.payload,
         trending_count=excluded.trending_count,
         gen_model=excluded.gen_model,
         gen_effort=excluded.gen_effort,
         published_at=NULL,
         updated_at=excluded.updated_at`,
    ).run({
      $date: date,
      $payload: JSON.stringify(payload),
      $trending_count: trendingCount,
      $gen_model: model,
      $gen_effort: effort,
      $now: now,
    });
  } finally {
    db.close();
  }
}

export function markBriefingPublished(date: string): void {
  const db = openBriefingDb();
  try {
    db.query("UPDATE entries SET published_at = ? WHERE date = ?").run(
      new Date().toISOString(),
      date,
    );
  } finally {
    db.close();
  }
}
