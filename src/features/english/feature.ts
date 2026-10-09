// feature.ts — english の hourly job 定義。`kura english` (src/cli/hourly.ts) が実行する。
// orchestrator (hourly-job) に素材取得・DB 書き込み・配信を委ね、LLM には生成だけ任せる。

import { isPublishEnabled } from "../../publish/policy.ts";
import type { HourlyFeature } from "../hourly-job.ts";
import { openEnglishDb } from "./db.ts";
import { type EnglishGenerated, insertEnglish, parseEnglishGenerated } from "./insert.ts";
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

export const feature = {
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
