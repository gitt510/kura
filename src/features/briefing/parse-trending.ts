#!/usr/bin/env bun
// parse-trending.ts — parse GitHub Trending HTML to JSON.
//
// Input: raw HTML from https://github.com/trending[/lang]?since=daily
//   (jina.ai proxy is no longer usable — it blocks anonymous github.com access).
//   Multiple pages may be concatenated; "=== url ===" divider lines are ignored.
//
// Each repo lives in <article class="Box-row"> ... </article>. We split on the
// opening tag and pull repo / description / stars / language out of each block.
//
// Usage (CLI):   bun parse-trending.ts < trending.html
// Usage (module): import { parseTrending } from "./parse-trending.ts";
//
// Output: JSON array of {repo, description, stars, language, url}.

export interface TrendingRepo {
  repo: string;
  description: string;
  stars: number;
  stars_today: number;
  language: string;
  url: string;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&hellip;": "…",
  "&nbsp;": " ",
};

const decodeNumericEntity = (entity: string, digits: string): string => {
  const codePoint = Number(digits);
  if (
    !Number.isInteger(codePoint) ||
    codePoint < 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return entity;
  }
  return String.fromCodePoint(codePoint);
};

const decode = (s: string): string =>
  s
    .replace(/&#(\d+);/g, decodeNumericEntity)
    .replace(/&[a-z]+;|&#39;/gi, (m) => ENTITIES[m] ?? m);

// strip tags → collapse whitespace → decode entities.
const text = (html: string): string =>
  decode(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();

export function parseTrending(content: string): TrendingRepo[] {
  const repos: TrendingRepo[] = [];
  const seen = new Set<string>();

  const blocks = content.split(/<article class="Box-row">/).slice(1);

  for (const block of blocks) {
    // repo (owner/name) は stargazers リンクから確実に取れる。
    const repoMatch = block.match(/href="\/([^"/]+\/[^"/]+)\/stargazers"/);
    if (!repoMatch) continue;
    const repo = repoMatch[1];
    if (seen.has(repo)) continue;
    seen.add(repo);

    const descMatch = block.match(
      /<p class="col-9 color-fg-muted[^"]*">([\s\S]*?)<\/p>/,
    );
    const description = descMatch ? text(descMatch[1]).slice(0, 300) : "";

    const langMatch = block.match(
      /<span itemprop="programmingLanguage">([^<]*)<\/span>/,
    );
    const language = langMatch ? decode(langMatch[1].trim()) : "";

    // 開始タグ <a ...> ごとマッチさせる。href= から始めると class 名 (tmp-mr-3 等)
    // の数字を text() が拾ってしまうため。アンカー内テキスト = スター総数のみ。
    let stars = 0;
    const starMatch = block.match(
      /<a[^>]*href="\/[^"]+\/stargazers"[\s\S]*?<\/a>/,
    );
    if (starMatch) {
      const n = parseInt(text(starMatch[0]).replace(/[^0-9]/g, ""), 10);
      if (!Number.isNaN(n)) stars = n;
    }

    // "N stars today" = since=daily の当日増分。勢いの指標。
    let stars_today = 0;
    const todayMatch = block.match(/([\d,]+)\s*stars?\s+today/i);
    if (todayMatch) {
      const n = parseInt(todayMatch[1].replace(/,/g, ""), 10);
      if (!Number.isNaN(n)) stars_today = n;
    }

    repos.push({
      repo,
      description,
      stars,
      stars_today,
      language,
      url: `https://github.com/${repo}`,
    });
  }

  return repos;
}

if (import.meta.main) {
  const input = await Bun.stdin.text();
  const out = parseTrending(input);
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}
