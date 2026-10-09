// publish.ts — timeline.db の 1 hour を Discord embed として webhook に投げる。
//
// orchestrator (hourly-job) が publishTimeline() を import して使う。CLI でも叩ける（手動再送）。
//   - データは timeline.db から引く (DB が真実)。要約 (insert) は別責務。
//   - timeline 専用 webhook (config の features.timeline.publish.discord)。username / avatar は生成 model 別。
//     旧 row (gen_model 無し) は "Timeline ⏱" と webhook 既定 avatar に fallback。帯色 blurple。
//   - 外部送信なので非冪等。冪等ガードは published_at。
//
// schema / 型 / 接続は同居の ./db.ts が所有する。webhook URL は出力に絶対出さない。

import { basename } from "node:path";
import type { HourTarget } from "../../clock.ts";
import { loadConfig } from "../../config.ts";
import { discordIdentity } from "../../discord/identity.ts";
import { fitDiscordFields } from "../../discord/payload.ts";
import { postDiscord } from "../../discord/webhook.ts";
import { parseJsonArray } from "../../json.ts";
import type { PublishResult } from "../hourly-job.ts";
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

// timeline.db の 1 hour を配信する。投稿できたら published、既 publish は skipped を
// 返す（正常系）。POST 失敗は throw（呼び手が扱う）。
export async function publishTimeline(target: HourTarget): Promise<PublishResult> {
  const { avatar } = loadConfig().features.timeline.publish.discord;
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
    if (row.published_at) return { kind: "skipped", reason: "already-published" };

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
      ...discordIdentity(row.gen_model, row.gen_effort, "Timeline ⏱", avatar),
      embeds: [
        {
          title,
          color: 0x5865f2, // blurple — timeline の帯色
          fields: fitDiscordFields(fields, title.length),
        },
      ],
    };

    const status = await postDiscord("timeline", payload);
    markPublished(db, row.window_start);
    return { kind: "published", status };
  } finally {
    db.close();
  }
}
