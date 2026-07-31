#!/usr/bin/env bun
// publish.ts — timeline.db の 1 hour を Discord embed として webhook に投げる。
//
// orchestrator (hourly-job) が publishTimeline() を import して使う。CLI でも叩ける（手動再送）。
//   - データは timeline.db から引く (DB が真実)。要約 (insert) は別責務。
//   - timeline 専用 webhook (KURA_DISCORD_WEBHOOK_TIMELINE)。username / avatar は生成 model 別。
//     旧 row (gen_model 無し) は "Timeline ⏱" と webhook 既定 avatar に fallback。帯色 blurple。
//   - 外部送信なので非冪等。冪等ガードは published_at（--force で上書き）。
//
// schema / 型 / 接続は同居の ./db.ts が所有する。webhook URL は出力に絶対出さない。

import { basename } from "node:path";
import { hourTarget, type HourTarget } from "../../lib/clock.ts";
import { discordIdentity } from "../../lib/discord-identity.ts";
import { postDiscord } from "../../lib/discord.ts";
import { fitDiscordFields } from "../../lib/discord-payload.ts";
import type { PublishResult } from "../../lib/hourly-job.ts";
import { parseJsonArray } from "../../lib/json.ts";
import { markPublished, openTimeline } from "./db.ts";

interface Row {
  window_start: string;
  window_end: string | null;
  date: string | null;
  hour: number;
  msgs: number;
  user_msgs: number;
  cwds: string | null;
  title: string;
  summary: string | null;
  threads: string | null;
  gen_model: string | null;
  gen_effort: string | null;
  published_at: string | null;
}

export interface PublishOptions {
  // 既定では published_at のある hour は再投稿しない（自動実行で二重配信しない）。
  // force で明示すれば再投稿する（手動の貼り直し）。
  force?: boolean;
}

// timeline.db の 1 hour を配信する。投稿できたら published、既 publish は skipped を
// 返す（正常系）。POST 失敗は throw（呼び手が扱う）。
export async function publishTimeline(
  target: HourTarget,
  opts: PublishOptions = {},
): Promise<PublishResult> {
  const { windowStart } = target;
  const db = openTimeline();
  try {
    const row = db
      .query(
        "SELECT window_start, window_end, date, hour, msgs, user_msgs, cwds, title, summary, threads, " +
          "gen_model, gen_effort, published_at FROM timelines WHERE window_start = ?",
      )
      .get(windowStart) as Row | null;

    if (!row) throw new Error(`no timeline for window: ${windowStart} (run insert first)`);
    // 冪等ガード: 既 publish は no-op
    if (row.published_at && !opts.force) return { kind: "skipped", reason: "already-published" };

    const bullets = (xs: string[]): string => xs.map((x) => `・${x}`).join("\n");
    const hhmm = (ts: string | null): string => (ts ? ts.slice(11, 16) : "-");

    const cwds = parseJsonArray<string>(row.cwds).map((p) => basename(p));
    const threads = parseJsonArray<{ label: string; bullets: string[] }>(row.threads);

    // title は window そのもの: "YYYYMMDD HH:MM - HH:MM" (JST)。date はハイフン無し。
    const title = `${(row.date ?? "").replaceAll("-", "")} ${hhmm(row.window_start)} - ${hhmm(row.window_end)}`;

    // meta は先頭の Meta field に ・key: value で縦に積む。
    const meta =
      `・volume: ${row.user_msgs} prompts / ${row.msgs} msg\n` +
      `・repos: ${cwds.length ? cwds.map((c) => `\`${c}\``).join(" ") : "-"}`;

    const fields: { name: string; value: string }[] = [{ name: "📋 Meta", value: meta }];
    if (row.summary) fields.push({ name: "📌 Summary", value: row.summary });
    for (const t of threads) {
      if (t.bullets?.length) fields.push({ name: t.label, value: bullets(t.bullets) });
    }

    const payload = {
      ...discordIdentity(row.gen_model, row.gen_effort, "Timeline ⏱"),
      embeds: [
        {
          title,
          color: 0x5865f2, // blurple — timeline の帯色
          fields: fitDiscordFields(fields, title.length),
        },
      ],
    };

    const status = await postDiscord("KURA_DISCORD_WEBHOOK_TIMELINE", payload);
    markPublished(db, row.window_start);
    return { kind: "published", status };
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const dateArg = process.argv[2];
  const hourArg = process.argv[3];
  if (!dateArg || hourArg === undefined || !/^\d{1,2}$/.test(hourArg)) {
    process.stderr.write("usage: bun publish.ts <YYYY-MM-DD> <hour> [--force]\n");
    process.exit(1);
  }
  let target;
  try {
    target = hourTarget(dateArg, Number.parseInt(hourArg, 10));
  } catch (error) {
    process.stderr.write(`${error}\n`);
    process.exit(1);
  }

  let result: PublishResult;
  try {
    result = await publishTimeline(target, { force: process.argv.includes("--force") });
  } catch (error) {
    process.stderr.write(`${error}\n`);
    process.exit(1);
  }
  if (result.kind === "skipped") {
    process.stdout.write(`skip (${result.reason}): ${target.windowStart}\n`);
  } else {
    process.stdout.write(`posted (${target.windowStart}) -> HTTP ${result.status}\n`);
  }
}
