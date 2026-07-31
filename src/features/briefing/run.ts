#!/usr/bin/env bun
// run.ts — daily briefing の generate/store と optional publish を順に実行する。
//
//   1. guard    : 09:10 前なら skip
//   2. resume   : briefing.db に当日 row があれば fetch / generate / store を skip
//   3. fetch    : GitHub Trending を取得
//   4. generate : agent skill が payload.json を生成
//   5. store    : payload と provenance を briefing.db に保存
//   6. publish  : policy が enabled のときだけ DB の payload を Discord へ送る
//
// publish 失敗後の次回 trigger は、保存済み row から publish だけを retry する。

import { existsSync, readFileSync } from "node:fs";
import { runSkillJson } from "../../lib/agent.ts";
import { postDiscord } from "../../lib/discord.ts";
import { isPublishEnabled } from "../../lib/publish-policy.ts";
import { KURA_STATE_DIR } from "../../lib/storage.ts";
import {
  getBriefing,
  markBriefingPublished,
  upsertBriefing,
  type BriefingEntry,
} from "./db.ts";
import { BRIEFING_TMP, fetchTrending } from "./fetch.ts";
import { parseBriefingPayload, publish, type Payload } from "./publish.ts";

const force = process.argv.includes("--force");
const now = new Date();
const date = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const time = now.toLocaleTimeString("sv-SE", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
});
const payloadFile = `${BRIEFING_TMP}/payload.json`;
const publishEnabled = isPublishEnabled("briefing");

// 朝に複数回発火し、失敗した stage から再開する。
const FIRST_RUN = "09:10";
const NOTIFY_AFTER = "10:10";

async function reportFailure(reason: string): Promise<void> {
  process.stderr.write(`briefing ${date}: ${reason}\n`);
  if (!publishEnabled || force || time < NOTIFY_AFTER) return;
  try {
    await postDiscord("KURA_DISCORD_WEBHOOK_BRIEFING", {
      username: "Briefing",
      content: `❌ briefing failed (${reason}) — ${date} ${time} — log: ${KURA_STATE_DIR}/briefing.log`,
    });
  } catch {
    /* 失敗通知は best-effort */
  }
}

function parseStoredPayload(entry: BriefingEntry): Payload {
  try {
    return parseBriefingPayload(JSON.parse(entry.payload));
  } catch (error) {
    throw new Error(`briefing.db の payload を読めない: ${error}`);
  }
}

if (!force && time < FIRST_RUN) {
  process.stdout.write(`briefing ${date}: skip (before ${FIRST_RUN})\n`);
  process.exit(0);
}

let entry = getBriefing(date);
if (!force && entry?.published_at) {
  process.stdout.write(`briefing ${date}: skip (already published)\n`);
  process.exit(0);
}

if (!entry || force) {
  let trendingCount = 0;
  try {
    trendingCount = (await fetchTrending()).length;
  } catch (error) {
    await reportFailure(`fetch error: ${error}`);
    process.exit(1);
  }
  if (trendingCount === 0) {
    await reportFailure("trending 0 件 (fetch 失敗の可能性)");
    process.exit(1);
  }

  const run = runSkillJson("briefing", BRIEFING_TMP);
  if (run.result.trim()) process.stdout.write(`${run.result.trim()}\n`);
  if (!run.ok) {
    if (run.raw) {
      process.stderr.write(`agent raw (先頭 500 字): ${run.raw.slice(0, 500)}\n`);
    }
    await reportFailure(
      `summarize failed (exit ${run.exitCode}${run.isError ? ", is_error" : ""})`,
    );
    process.exit(1);
  }
  if (!existsSync(payloadFile)) {
    await reportFailure("payload.json が無い (要約が書けていない)");
    process.exit(1);
  }

  let payload: Payload;
  try {
    payload = parseBriefingPayload(JSON.parse(readFileSync(payloadFile, "utf-8")), date);
  } catch (error) {
    await reportFailure(`payload.json を読めない: ${error}`);
    process.exit(1);
  }
  try {
    upsertBriefing(date, payload, trendingCount, run.model, run.effort);
  } catch (error) {
    await reportFailure(`store error: ${error}`);
    process.exit(1);
  }
  entry = getBriefing(date);
  if (!entry) {
    await reportFailure("store 後の briefing row が無い");
    process.exit(1);
  }
} else {
  process.stdout.write(`briefing ${date}: generated row found\n`);
}

if (!entry) {
  await reportFailure("briefing row が無い");
  process.exit(1);
}

if (!publishEnabled) {
  process.stdout.write(`briefing ${date}: stored (publish disabled)\n`);
  process.exit(0);
}

const payload = parseStoredPayload(entry);
let result;
try {
  result = await publish(payload, {
    trendingCount: entry.trending_count,
    model: entry.gen_model,
    effort: entry.gen_effort,
  });
} catch (error) {
  await reportFailure(`publish error: ${error}`);
  process.exit(1);
}
if (result.status !== 204) {
  await reportFailure(`Discord が 204 以外を返した: ${result.status}`);
  process.exit(1);
}

markBriefingPublished(date);
process.stdout.write(
  `briefing ${date}: delivered ${result.shown}/${payload.repos.length} repos in ${result.embeds} embed(s) (HTTP ${result.status})\n`,
);
