#!/usr/bin/env bun
// publish.ts — payload を Discord embed で投げる決定論的な配信ツール。
//
// run.ts が publish() を import して使う（204 を戻り値で受け取り、DB に published_at を打つ）。
// CLI (bun publish.ts [payload.json]) でも単体で叩ける（手動再送・デバッグ）。
//
// state-less: publish 済みガードは持たない（冪等 guard は briefing.db / run.ts の責務）。
// webhook URL は config.ts (process env → XDG config) で解決し、値は決して出力しない。

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { discordIdentity } from "../../lib/discord-identity.ts";
import { postDiscord } from "../../lib/discord.ts";
import { truncateDiscordText } from "../../lib/discord-payload.ts";
import {
  expectJsonArray,
  expectJsonObject,
  expectJsonString,
} from "../../lib/json.ts";
import { selfProvenance } from "../../lib/provenance.ts";
import { BRIEFING_TMP } from "./fetch.ts";

export interface Repo {
  repo: string;
  url?: string;
  stars?: number;
  stars_today?: number;
  language?: string;
  one_line?: string;
  note?: string;
}
export interface Payload {
  date: string;
  repos: Repo[];
}

export function parseBriefingPayload(value: unknown, dateOverride?: string): Payload {
  const root = expectJsonObject(value, "briefing");
  const values = expectJsonArray(root.repos, "briefing.repos");
  if (values.length === 0) throw new Error("briefing.repos must not be empty");

  const repos = values.map((value, index): Repo => {
    const path = `briefing.repos[${index}]`;
    const source = expectJsonObject(value, path);
    const parsed: Repo = {
      repo: expectJsonString(source.repo, `${path}.repo`),
    };
    for (const key of ["url", "language", "one_line", "note"] as const) {
      if (source[key] !== undefined) {
        parsed[key] = expectJsonString(source[key], `${path}.${key}`);
      }
    }
    for (const key of ["stars", "stars_today"] as const) {
      const number = source[key];
      if (number !== undefined) {
        if (typeof number !== "number" || !Number.isFinite(number)) {
          throw new Error(`${path}.${key} must be a finite number`);
        }
        parsed[key] = number;
      }
    }
    return parsed;
  });

  return {
    date: dateOverride ?? expectJsonString(root.date, "briefing.date"),
    repos,
  };
}
export interface PublishOptions {
  // footer 用の trending 総数（run.ts が fetch 件数を渡す）。省略時は件数を省く。
  trendingCount?: number;
  // 投稿者表示用の生成 model（run.ts が agent の実行結果から渡す）。
  // 未指定（undefined）のときだけ selfProvenance() に fallback する（session 内 CLI 実行向け）。
  model?: string | null;
  effort?: string | null;
}
export interface PublishResult {
  status: number;
  shown: number;
  total: number;
  embeds: number;
}

export interface DiscordBody {
  username: string;
  avatar_url?: string;
  embeds: {
    title?: string;
    color: number;
    description: string;
    footer?: { text: string };
  }[];
}

const n = (x?: number): string => (x ?? 0).toLocaleString("en-US");

// embed description にまとめて流し込む（markdown フル対応。field name はリンクを
// 描画しないため、repo を太字リンクの見出しにするには description が要る）。
// 1 行目 = repo 情報（リンク・スター・当日増分・言語）、2 行目 = 要約。
const repoBlock = (r: Repo, rank: number): string => {
  const link = r.url ? `[${r.repo}](${r.url})` : r.repo;
  let star = `⭐${n(r.stars)}`;
  if (r.stars_today) star += ` **(+${n(r.stars_today)})**`;
  // `N.` を行頭に置くと Discord が ordered list として解釈し行が割れるため `\.` でエスケープする
  const head = [`**${rank}\\. ${link}**`, star, r.language].filter(Boolean).join(" · ");
  const summary = [r.one_line, r.note].filter(Boolean).join("。");
  return summary ? `${head}\n${summary}` : head;
};

// Discord 上限 (description 4096 字 / 1 メッセージ合計 6000 字) を超えないよう、
// repo ブロックを複数 embed に貪欲に詰める。
const PER_EMBED = 3900; // 1 embed の description 上限 (4096 に余裕)
const TOTAL = 5800; // 1 メッセージ全体の上限 (6000 に title/footer 分の余裕)

// payload を briefing webhook (KURA_DISCORD_WEBHOOK_BRIEFING) に POST する。
// 投げるたび新規メッセージ（非冪等）。冪等性の担保は呼び手が briefing.db で行う。
export function buildDiscordBody(
  payload: Payload,
  opts: PublishOptions = {},
): { body: DiscordBody; shown: number } {
  if (!payload.date || !Array.isArray(payload.repos) || payload.repos.length === 0) {
    throw new Error("payload が不正: { date, repos: [...] } が必要 (repos 空)");
  }

  const descs: string[] = [];
  let cur = "";
  let total = 0;
  let shown = 0;
  for (const [i, r] of payload.repos.entries()) {
    const block = truncateDiscordText(repoBlock(r, i + 1), PER_EMBED);
    const separator = cur ? "\n\n" : "";
    const added = separator.length + block.length;
    if (total + added > TOTAL) continue;
    if (cur && cur.length + added > PER_EMBED) {
      descs.push(cur);
      cur = block;
      total += block.length;
    } else {
      cur += `${separator}${block}`;
      total += added;
    }
    shown += 1;
  }
  if (cur) descs.push(cur);

  // model が渡されればそれを使い、未指定なら session 自己 introspection に倒す。
  const gen =
    opts.model !== undefined ? { model: opts.model, effort: opts.effort ?? null } : selfProvenance();
  const footer =
    typeof opts.trendingCount === "number"
      ? { text: `trending ${opts.trendingCount} 件 → 表示 ${shown} 件` }
      : undefined;

  const body: DiscordBody = {
    ...discordIdentity(gen.model, gen.effort, "Briefing"),
    embeds: descs.map((description, i) => ({
      ...(i === 0 ? { title: `🛠️ GitHub Trending — ${payload.date}` } : {}),
      color: 0x2ea043, // GitHub green — briefing の帯色
      description,
      ...(i === descs.length - 1 && footer ? { footer } : {}),
    })),
  };

  return { body, shown };
}

export async function publish(payload: Payload, opts: PublishOptions = {}): Promise<PublishResult> {
  const { body, shown } = buildDiscordBody(payload, opts);
  const status = await postDiscord("KURA_DISCORD_WEBHOOK_BRIEFING", body);
  return { status, shown, total: payload.repos.length, embeds: body.embeds.length };
}

if (import.meta.main) {
  const PAYLOAD_FILE = process.argv[2] ?? `${BRIEFING_TMP}/payload.json`;

  let payload: Payload;
  try {
    payload = parseBriefingPayload(JSON.parse(readFileSync(PAYLOAD_FILE, "utf-8")));
  } catch (error) {
    process.stderr.write(`payload を読めない: ${PAYLOAD_FILE}: ${error}\n`);
    process.exit(1);
  }

  // CLI では footer 件数のため同じ dir の trending.json を読む（取れなければ省略）。
  let trendingCount: number | undefined;
  try {
    const trending = JSON.parse(readFileSync(`${dirname(PAYLOAD_FILE)}/trending.json`, "utf-8"));
    if (Array.isArray(trending)) trendingCount = trending.length;
  } catch {
    /* trending.json が無ければ件数省略 */
  }

  let result: PublishResult;
  try {
    // model 未指定 → selfProvenance() に fallback（session 内で叩かれる前提）。
    result = await publish(payload, { trendingCount });
  } catch (error) {
    process.stderr.write(`${error}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `posted ${result.shown}/${result.total} repos in ${result.embeds} embed(s) (${payload.date}) -> HTTP ${result.status}\n`,
  );
}
