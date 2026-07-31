#!/usr/bin/env bun
// fetch.ts — GitHub Trending を取得・パースする決定論的な前処理。
//
// state-less: catalog diff も除外 URL も持たない。一次ソースを毎回まるごと取る。
// GitHub Trending (daily, 全言語) の HTML を直接取得し、parseTrending で JSON 化して
// {tmp}/trending.json に書き出し、パース結果を返す。
// (r.jina.ai は github.com への匿名アクセスを 451 でブロックするため使わない。)
//
// run.ts が fetchTrending() を import して使う（配信フローの Step: 取得）。
// CLI (bun fetch.ts) でも単体で叩ける（デバッグ・手動）。

import { mkdirSync } from "node:fs";
import { parseTrending, type TrendingRepo } from "./parse-trending.ts";

export const BRIEFING_TMP = "/tmp/briefing";
const FETCH_TIMEOUT_MS = 25_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const GH_URLS = ["https://github.com/trending?since=daily"];

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": UA, Accept: "text/html" },
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

// trending を取得し {outDir}/trending-raw.txt と {outDir}/trending.json に書き出して返す。
export async function fetchTrending(outDir: string = BRIEFING_TMP): Promise<TrendingRepo[]> {
  mkdirSync(outDir, { recursive: true });

  const rawParts: string[] = [];
  for (const url of GH_URLS) {
    rawParts.push(`=== ${url} ===`);
    rawParts.push(await fetchText(url, FETCH_TIMEOUT_MS));
    rawParts.push("");
  }
  const raw = rawParts.join("\n");
  await Bun.write(`${outDir}/trending-raw.txt`, raw);

  const trending = parseTrending(raw);
  await Bun.write(`${outDir}/trending.json`, JSON.stringify(trending, null, 2));
  return trending;
}

if (import.meta.main) {
  const trending = await fetchTrending();
  if (trending.length === 0) {
    console.error("⚠️  trending 0 件 (fetch 失敗の可能性)。trending-raw.txt を確認。");
    process.exit(1);
  }
  console.log(`✅ fetch 完了: ${trending.length} 件 -> ${BRIEFING_TMP}/trending.json`);
}
