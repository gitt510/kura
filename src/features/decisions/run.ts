#!/usr/bin/env bun
// run.ts — decisions 自動蒸留の entrypoint。
// orchestrator (hourly-job) に素材取得・DB 書き込みを委ね、LLM には生成だけ任せる。
//
// 配信先は未定（第 2 段）なので publish stage は持たない。
// 冪等 skip は「この hour が蒸留済みか」= 行の存在で判定する。

import { runHourlyJob, type HourlyFeature } from "../../lib/hourly-job.ts";
import { openDecisionsDb, recentTitles } from "./db.ts";
import {
  insertDecisions,
  parseDecisionsGenerated,
  type DecisionsGenerated,
} from "./insert.ts";

const isGenerated = (windowStart: string): boolean => {
  const db = openDecisionsDb();
  try {
    return !!db.query("SELECT 1 AS x FROM entries WHERE window_start = ? LIMIT 1").get(windowStart);
  } finally {
    db.close();
  }
};

const feature = {
  name: "decisions",
  isGenerated,
  parseGenerated: parseDecisionsGenerated,
  // 素材に knownTitles（cwd ごとの既出 decision title）を同梱する。
  // LLM は同じ決定に同じ title を一字一句使う → 字面一致の決定論 dedupe が成立する。
  materials: (_target, window) => {
    const db = openDecisionsDb();
    try {
      const knownTitles = Object.fromEntries(
        window.meta.cwds.map((cwd) => [cwd, recentTitles(db, cwd)]),
      );
      return { ...window, knownTitles };
    } finally {
      db.close();
    }
  },
  insert: insertDecisions,
} satisfies HourlyFeature<DecisionsGenerated>;

process.exit(await runHourlyJob(feature, process.argv.slice(2)));
