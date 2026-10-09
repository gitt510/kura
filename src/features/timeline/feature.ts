// feature.ts — timeline の hourly job 定義。`kura timeline` (src/cli/hourly.ts) が実行する。
// orchestrator (hourly-job) に素材取得・DB 書き込み・配信を委ね、LLM には生成だけ任せる。

import { isPublishEnabled } from "../../publish/policy.ts";
import type { HourlyFeature } from "../hourly-job.ts";
import { openTimeline } from "./db.ts";
import { insertTimeline, parseTimelineGenerated, type TimelineGenerated } from "./insert.ts";
import { publishTimeline } from "./publish.ts";

const isGenerated = (windowStart: string): boolean => {
  const db = openTimeline();
  try {
    return !!db.query("SELECT 1 AS x FROM timelines WHERE window_start = ?").get(windowStart);
  } finally {
    db.close();
  }
};

const isPublished = (windowStart: string): boolean => {
  const db = openTimeline();
  try {
    const row = db
      .query("SELECT published_at FROM timelines WHERE window_start = ?")
      .get(windowStart) as { published_at: string | null } | null;
    return !!row?.published_at;
  } finally {
    db.close();
  }
};

export const feature = {
  name: "timeline",
  isGenerated,
  parseGenerated: parseTimelineGenerated,
  insert: insertTimeline,
  publish: {
    enabled: () => isPublishEnabled("timeline"),
    isPublished,
    run: publishTimeline,
  },
} satisfies HourlyFeature<TimelineGenerated>;
