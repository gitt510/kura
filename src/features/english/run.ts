#!/usr/bin/env bun
// run.ts — english 自動配信の entrypoint。
// orchestrator (hourly-job) に素材取得・DB 書き込み・配信を委ね、LLM には生成だけ任せる。

import { runHourlyJob, type HourlyFeature } from "../../lib/hourly-job.ts";
import { isPublishEnabled } from "../../lib/publish-policy.ts";
import { openEnglishDb } from "./db.ts";
import {
  insertEnglish,
  parseEnglishGenerated,
  type EnglishGenerated,
} from "./insert.ts";
import { publishEnglish } from "./publish.ts";

const isGenerated = (windowStart: string): boolean => {
  const db = openEnglishDb();
  try {
    return !!db.query("SELECT 1 AS x FROM entries WHERE window_start = ?").get(windowStart);
  } finally {
    db.close();
  }
};

const isPublished = (windowStart: string): boolean => {
  const db = openEnglishDb();
  try {
    const row = db
      .query("SELECT published_at FROM entries WHERE window_start = ?")
      .get(windowStart) as { published_at: string | null } | null;
    return !!row?.published_at;
  } finally {
    db.close();
  }
};

const feature = {
  name: "english",
  isGenerated,
  parseGenerated: parseEnglishGenerated,
  insert: insertEnglish,
  publish: {
    enabled: () => isPublishEnabled("english"),
    isPublished,
    run: publishEnglish,
  },
} satisfies HourlyFeature<EnglishGenerated>;

process.exit(await runHourlyJob(feature, process.argv.slice(2)));
