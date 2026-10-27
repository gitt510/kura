// feature.ts — timeline の hourly job 定義。`kura extension run timeline` (src/cli/extension.ts) が実行する。
// orchestrator (hourly-job) に素材取得・DB 書き込みを委ね、LLM には生成だけ任せる。

import { openKura } from "../../db.ts";
import type { HourlyFeature } from "../hourly-job.ts";
import { insertTimeline, parseTimelineGenerated, type TimelineGenerated } from "./insert.ts";

const isGenerated = (windowStart: string): boolean => {
  const db = openKura();
  try {
    return !!db.query("SELECT 1 AS x FROM timeline WHERE window_start = ?").get(windowStart);
  } finally {
    db.close();
  }
};

export const feature = {
  name: "timeline",
  isGenerated,
  parseGenerated: parseTimelineGenerated,
  insert: insertTimeline,
} satisfies HourlyFeature<TimelineGenerated>;
