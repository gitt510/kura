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
// レイアウト。カナだけを手がかりに en を書き起こす練習が主用途:
//   title       : "YYYYMMDD HH:MM - HH:MM" (JST hour window)。
//   description : **📋 問題** / ja / phrase・read の bullet … 常時表示の手がかり
//   field       : name = 🔓 答え合わせ、value = || syl / memo・alt の bullet ||
//   2 つの節は「太字の見出し → 無印の主文 → bullet」で同じ 3 段に揃える。絵文字は見出しだけに置く
//   (spoiler の 1 行目は `||` に続いて行頭を取れないので、主文が無印なのは構造上の要請でもある)。
//   英文は syl (音節区切り付き) だけ出す。en は表示しない — syl/read/alt の素として DB に残るだけ。
//   field name が description との唯一のブロック区切りになる (Components V2 の separator は要らない)。
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

    // cards は契約上つねに長さ 1（SKILL.md「カードは 1 枚だけ」）。手がかりは見出しを持たない
    // ブロックなので description に置き、答え合わせは丸ごと 1 spoiler の field 1 つに畳む。
    const card = cards[0];
    // 見えている側: 見出し (太字) → 無印の ja → bullet。答え合わせ側と同じ 3 段にする。
    const cue = [`**📋 問題**`, card.ja, `- ${card.phrase}`];
    if (card.read) cue.push(`- ${card.read}`);

    // 答え合わせ側: field name (🔓) が節の頭。中身は全部 bullet。
    // 英文は音節区切りのある syl だけ出す。en は syl/read/alt の素なので DB には残すが表示しない
    // (syl の無い旧 row だけ、英文がまったく出ないのを防ぐために en で代替する)。
    // spoiler の 1 行目は `||` に続くので行頭にならず bullet にできない (改行を挟むと空行が入る)。
    // 先頭の英文は無印のまま節の答えとして置き、注釈だけ bullet にする。
    const answer = [card.syl ?? card.en];
    if (card.memo) answer.push(`- ${card.memo}`);
    if (card.alt) answer.push(`- ${card.alt}`);

    const description = cue.join("\n");
    const fields = [{ name: "🔓 答え合わせ", value: `|| ${answer.join("\n")} ||` }];

    const payload = {
      ...discordIdentity(row.gen_model, row.gen_effort, "English Feed"),
      embeds: [
        {
          title,
          description,
          color: 0x2ecc71, // green — english の帯色
          fields: fitDiscordFields(fields, title.length + description.length),
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
