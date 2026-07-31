#!/usr/bin/env bun
// insert.ts — per-hour timeline の writer (timeline.db への UPSERT)。
//
// orchestrator (hourly-job) が insertTimeline() を import して使う。CLI でも叩ける（手動）。
//   generated = { title, summary?, threads? }  ← LLM (timeline skill) が生成
//   threads = [ { label, bullets[] }, ... ] スレッド (repo/テーマ) 別の箇条書き。
//
// meta (window/volume/cwds) は LLM を信用せず history DB から引き直す。
// 生成 provenance (gen) は呼び手が渡す — orchestrator は LLM の model、CLI は selfProvenance()。
// schema / 型 / DB アクセスは同居の ./db.ts が所有する。

import { getHourWindow } from "../../history/query.ts";
import { hourTarget, type HourTarget } from "../../lib/clock.ts";
import {
  expectJsonArray,
  expectJsonObject,
  expectJsonString,
  jsonArrayOrNull,
} from "../../lib/json.ts";
import { selfProvenance, type Provenance } from "../../lib/provenance.ts";
import { openTimeline, upsertTimeline, type TimelineRow } from "./db.ts";

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
  if (
    root.summary !== undefined &&
    root.summary !== null &&
    typeof root.summary !== "string"
  ) {
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
        bullets: expectJsonArray(
          thread.bullets,
          `timeline.threads[${index}].bullets`,
        ).map((bullet, bulletIndex) =>
          expectJsonString(
            bullet,
            `timeline.threads[${index}].bullets[${bulletIndex}]`,
          ),
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

if (import.meta.main) {
  const dateArg = process.argv[2];
  const hourArg = process.argv[3];
  if (!dateArg || hourArg === undefined || !/^\d{1,2}$/.test(hourArg)) {
    process.stderr.write("usage: bun insert.ts <YYYY-MM-DD> <hour>  (stdin: narrative JSON)\n");
    process.exit(1);
  }
  let target;
  try {
    target = hourTarget(dateArg, Number.parseInt(hourArg, 10));
  } catch (error) {
    process.stderr.write(`${error}\n`);
    process.exit(1);
  }

  const stdin = await Bun.stdin.text();
  let generated: TimelineGenerated;
  try {
    generated = parseTimelineGenerated(stdin.trim() ? JSON.parse(stdin) : {});
  } catch (error) {
    process.stderr.write(`stdin has invalid timeline JSON: ${error}\n`);
    process.exit(1);
  }

  // CLI（in-session の手動実行）では生成 provenance を自己 introspection で取る。
  insertTimeline(target, generated, selfProvenance());
  process.stdout.write(`upserted timeline for ${target.windowStart}\n`);
}
