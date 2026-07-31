#!/usr/bin/env bun
// publish.ts — english.db の 1 hour を Discord embed として webhook に投げる。
//
// orchestrator (hourly-job) が publishEnglish() を import して使う。CLI でも叩ける（手動再送）。
//   - データは english.db から引く (DB が真実)。カード生成 (insert) は別責務。
//   - english 専用 webhook (KURA_DISCORD_WEBHOOK_ENGLISH)。username は生成 provenance
//     ("claude-fable-5 (high)")・avatar は model 別 (lib/discord-identity.ts)・帯色 green。
//     旧 row (gen_model 無し) は "English Feed" と webhook 既定 avatar に fallback。
//   - 外部送信なので非冪等。冪等ガードは published_at（--force で上書き）。
//
// レイアウト (1 カード = 1 field):
//   title  : "YYYYMMDD HH:MM - HH:MM" (JST hour window)。
//   field  : name = kind ("🛠 指示")、value =
//              🇯🇵 **ja** / 💎 phrase     … 常時表示 (phrase は想起のヒント役)
//              || 🇺🇸 en 🔤 syl 🗣 read 📝 memo ✨ alt ||  … 丸ごと 1 spoiler
//   syl/read/memo/alt は旧 row には無いので、ある行だけ出す。
//
// schema / 型 / 接続は同居の ./db.ts が所有する。webhook URL は出力に絶対出さない。

import { hourTarget, type HourTarget } from "../../lib/clock.ts";
import { discordIdentity } from "../../lib/discord-identity.ts";
import { postDiscord } from "../../lib/discord.ts";
import { fitDiscordFields } from "../../lib/discord-payload.ts";
import type { PublishResult } from "../../lib/hourly-job.ts";
import { parseJsonArray } from "../../lib/json.ts";
import { markPublished, openEnglishDb, type Card } from "./db.ts";

interface Row {
  window_start: string;
  window_end: string | null;
  date: string | null;
  cards: string | null;
  gen_model: string | null;
  gen_effort: string | null;
  published_at: string | null;
}

export interface PublishOptions {
  // 既定では published_at のある hour は再投稿しない（自動実行で二重配信しない）。
  // force で明示すれば再投稿する（手動の貼り直し）。
  force?: boolean;
}

// english.db の 1 hour を配信する。投稿できたら published、既 publish / カード無しは
// skipped を返す（正常系）。POST 失敗は throw（呼び手が扱う）。
export async function publishEnglish(
  target: HourTarget,
  opts: PublishOptions = {},
): Promise<PublishResult> {
  const { windowStart } = target;
  const db = openEnglishDb();
  try {
    const row = db
      .query(
        "SELECT window_start, window_end, date, cards, gen_model, gen_effort, published_at " +
          "FROM entries WHERE window_start = ?",
      )
      .get(windowStart) as Row | null;

    if (!row) throw new Error(`no feed for window: ${windowStart} (run insert first)`);
    // 冪等ガード: 既 publish は no-op
    if (row.published_at && !opts.force) return { kind: "skipped", reason: "already-published" };

    const cards = parseJsonArray<Card>(row.cards);
    if (cards.length === 0) return { kind: "skipped", reason: "empty" }; // カード無し → 配信しない

    const hhmm = (ts: string | null): string => (ts ? ts.slice(11, 16) : "-");
    // title は window そのもの: "YYYYMMDD HH:MM - HH:MM" (JST)。date はハイフン無し。
    const title = `${(row.date ?? "").replaceAll("-", "")} ${hhmm(row.window_start)} - ${hhmm(row.window_end)}`;

    // 1 カード = 1 全幅 field。name = kind、value = 常時表示 (ja/phrase) + 英語ブロック 1 spoiler。
    const fields = cards.map((c) => {
      const hidden = [`🇺🇸 ${c.en}`];
      if (c.syl) hidden.push(`🔤 ${c.syl}`);
      if (c.read) hidden.push(`🗣 ${c.read}`);
      if (c.memo) hidden.push(`📝 ${c.memo}`);
      if (c.alt) hidden.push(`✨ ${c.alt}`);
      const value = [`🇯🇵 **${c.ja}**`, `💎 ${c.phrase}`, `|| ${hidden.join("\n")} ||`].join("\n");
      return { name: c.kind, value };
    });

    const payload = {
      ...discordIdentity(row.gen_model, row.gen_effort, "English Feed"),
      embeds: [
        {
          title,
          color: 0x2ecc71, // green — english の帯色
          fields: fitDiscordFields(fields, title.length),
        },
      ],
    };

    const status = await postDiscord("KURA_DISCORD_WEBHOOK_ENGLISH", payload);
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
    result = await publishEnglish(target, { force: process.argv.includes("--force") });
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
