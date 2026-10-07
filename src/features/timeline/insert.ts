// insert.ts — per-hour timeline の writer (timeline.db への UPSERT)。
//
// orchestrator (hourly-job) が insertTimeline() を import して使う。CLI でも叩ける（手動）。
//   generated = { title, summary?, threads? }  ← LLM (timeline skill) が生成
//   threads = [ { label, bullets[] }, ... ] スレッド (repo/テーマ) 別の箇条書き。
//
// meta (window/volume/cwds) は LLM を信用せず history DB から引き直す。
// 生成 provenance (gen) は orchestrator が LLM の model から渡す。
// schema / 型 / DB アクセスは同居の ./db.ts が所有する。

import { getHourWindow } from "../../history/query.ts";
import type { HourTarget } from "../../lib/clock.ts";
import {
  expectJsonArray,
  expectJsonObject,
  expectJsonString,
  jsonArrayOrNull,
} from "../../lib/json.ts";
import type { Provenance } from "../../lib/provenance.ts";
import { openTimeline, type TimelineRow, upsertTimeline } from "./db.ts";

export interface TimelineGenerated {
  title?: string;
  summary?: string | null;
  threads?: { label: string; bullets: string[] }[] | null;
}

export function parseTimelineGenerated(value: unknown): TimelineGenerated {
  const root = expectJsonObject(value, "timeline");
  if (root.title !== undefined && typeof root.title !== "string") {
    throw new Error("timeline.title must be a string");
  }
  if (root.summary !== undefined && root.summary !== null && typeof root.summary !== "string") {
    throw new Error("timeline.summary must be a string or null");
  }

  let threads: TimelineGenerated["threads"];
  if (root.threads === null) {
    threads = null;
  } else if (root.threads !== undefined) {
    threads = expectJsonArray(root.threads, "timeline.threads").map((value, index) => {
      const thread = expectJsonObject(value, `timeline.threads[${index}]`);
      return {
        label: expectJsonString(thread.label, `timeline.threads[${index}].label`),
        bullets: expectJsonArray(thread.bullets, `timeline.threads[${index}].bullets`).map(
          (bullet, bulletIndex) =>
            expectJsonString(bullet, `timeline.threads[${index}].bullets[${bulletIndex}]`),
        ),
      };
    });
  }

  return {
    title: root.title as string | undefined,
    summary: root.summary as string | null | undefined,
    threads,
  };
}

const str = (v: string | null | undefined): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

// generated (LLM 出力) を timeline.db に UPSERT する。meta は history DB から引き直す。
export function insertTimeline(
  target: HourTarget,
  generated: TimelineGenerated,
  gen: Provenance,
): void {
  const { meta } = getHourWindow(target.date, target.hour);
  const row: TimelineRow = {
    window_start: meta.window_start,
    window_end: meta.window_end,
    date: meta.date,
    hour: meta.hour,
    msgs: meta.volume.msgs,
    user_msgs: meta.volume.user,
    cwds: jsonArrayOrNull(meta.cwds),
    title: generated.title ?? `${meta.date} ${String(meta.hour).padStart(2, "0")}:00`,
    summary: str(generated.summary),
    threads: jsonArrayOrNull(generated.threads),
    gen_model: gen.model,
    gen_effort: gen.effort,
  };
  const db = openTimeline();
  try {
    upsertTimeline(db, row);
  } finally {
    db.close();
  }
}
