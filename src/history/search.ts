#!/usr/bin/env bun
// search.ts — history.db を複数キーワードで横断検索する reader。
//
// query.ts が単一 session を引くのに対し、こちらは session_id を知らない状態から
// キーワードで全 session を検索する。schema / 接続 / 型は ./db.ts が所有する。
// DB は read-only。書き込みは history source adapter が担う。
//
// CLI: bun search.ts [--limit=N] <keyword...>
//   stdout: { query:{keywords}, count, hits:[ {session, short, cwd,
//             span:{start,end}, matched:[kw...], hits, size, snippets:[...]} ] }
//   ランキング: 一致キーワード種類数 → 新しさ → ヒット数 (降順)。

import { openHistory, type MessageRow } from "./db.ts";
import { HISTORY_NOISE_PREDICATE } from "./noise.ts";

export interface SearchSnippet {
  role: MessageRow["role"];
  jst: string; // "YYYY-MM-DD HH:MM" (JST)
  kw: string; // この抜粋が一致したキーワード
  text: string; // 一致位置の周辺 (空白圧縮, 前後 … 省略)
}

export interface SearchHit {
  session: string; // full session_id
  short: string; // 先頭 7 桁
  cwd: string | null;
  span: { start: string; end: string }; // JST "YYYY-MM-DD HH:MM"
  matched: string[]; // 一致したキーワード (distinct, 入力順)
  hits: number; // 一致した message 数
  size: number; // session 全体の文字量 (ノイズ除外後, 全 role) — フルロードのコスト見積り用
  snippets: SearchSnippet[]; // 代表抜粋 (最大 3)
}

export interface SearchResult {
  query: { keywords: string[] };
  count: number;
  hits: SearchHit[];
}

// UTC ISO を JST の "YYYY-MM-DD HH:MM" にする。不正な値はそのまま返す。
function toJst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCHours(d.getUTCHours() + 9);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

// 一致位置の前後を切り出し、空白を畳んで前後を … で省略する。
function makeSnippet(text: string, kw: string): string {
  const i = text.toLowerCase().indexOf(kw.toLowerCase());
  if (i < 0) return text.slice(0, 160).replace(/\s+/g, " ").trim();
  const start = Math.max(0, i - 60);
  const end = Math.min(text.length, i + kw.length + 100);
  let s = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = "…" + s;
  if (end < text.length) s = s + "…";
  return s;
}

type Row = Pick<MessageRow, "session_id" | "cwd" | "role" | "timestamp" | "text">;

// keywords のいずれかを含む session を集約してランキングする。
export function searchSessions(keywords: string[], limit = 8): SearchResult {
  const kws = keywords.map((k) => k.trim()).filter(Boolean);
  if (kws.length === 0) return { query: { keywords: kws }, count: 0, hits: [] };

  const db = openHistory();
  try {
    // LIKE 特殊文字をエスケープして OR で並べる。
    const like = kws.map(() => "text LIKE ? ESCAPE '\\'").join(" OR ");
    const params = kws.map((k) => "%" + k.replace(/[%_\\]/g, "\\$&") + "%");
    const rows = db
      .query(
        "SELECT session_id, cwd, role, timestamp, text FROM messages " +
          `WHERE ${HISTORY_NOISE_PREDICATE} AND (${like}) ` +
          "ORDER BY timestamp",
      )
      .all(...params) as Row[];

    // session 単位に集約: 一致キーワード・件数・代表抜粋を貯める。
    type Acc = {
      cwd: string | null;
      first: string;
      last: string;
      hits: number;
      matched: Set<string>;
      snippets: SearchSnippet[];
      coveredKw: Set<string>;
    };
    const byId = new Map<string, Acc>();

    for (const r of rows) {
      // どのキーワードが当たったか (ランキングと抜粋ラベル用)。
      const hitKws = kws.filter((k) => r.text.toLowerCase().includes(k.toLowerCase()));
      if (hitKws.length === 0) continue; // LIKE と includes の差を吸収
      let a = byId.get(r.session_id);
      if (!a) {
        a = {
          cwd: r.cwd,
          first: r.timestamp,
          last: r.timestamp,
          hits: 0,
          matched: new Set(),
          snippets: [],
          coveredKw: new Set(),
        };
        byId.set(r.session_id, a);
      }
      a.hits += 1;
      a.last = r.timestamp; // 昇順走査なので last が最新
      for (const k of hitKws) a.matched.add(k);
      // 抜粋は最大 3、なるべく別キーワードを代表させる。
      if (a.snippets.length < 3) {
        const fresh = hitKws.find((k) => !a!.coveredKw.has(k)) ?? hitKws[0];
        a.coveredKw.add(fresh);
        a.snippets.push({
          role: r.role,
          jst: toJst(r.timestamp),
          kw: fresh,
          text: makeSnippet(r.text, fresh),
        });
      }
    }

    const hits: SearchHit[] = [...byId.entries()].map(([session, a]) => ({
      session,
      short: session.slice(0, 7),
      cwd: a.cwd,
      span: { start: toJst(a.first), end: toJst(a.last) },
      matched: kws.filter((k) => a.matched.has(k)),
      hits: a.hits,
      size: 0,
      snippets: a.snippets,
    }));

    // 一致キーワード種類数 → 新しさ → ヒット数 (降順)。
    hits.sort(
      (x, y) =>
        y.matched.length - x.matched.length ||
        y.span.end.localeCompare(x.span.end) ||
        y.hits - x.hits,
    );

    // 返す候補だけ session 全体の文字量を引く (フルロードのコスト見積り用)。
    const top = hits.slice(0, limit);
    if (top.length > 0) {
      const ph = top.map(() => "?").join(",");
      const sizeRows = db
        .query(
          "SELECT session_id, SUM(length(text)) AS size FROM messages " +
            `WHERE ${HISTORY_NOISE_PREDICATE} AND session_id IN (${ph}) ` +
            "GROUP BY session_id",
        )
        .all(...top.map((t) => t.session)) as { session_id: string; size: number }[];
      const sizeById = new Map(sizeRows.map((r) => [r.session_id, r.size]));
      for (const t of top) t.size = sizeById.get(t.session) ?? 0;
    }

    return { query: { keywords: kws }, count: hits.length, hits: top };
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  let limit = 8;
  const keywords: string[] = [];
  for (const a of argv) {
    const m = a.match(/^--limit=(\d+)$/);
    if (m) limit = Number(m[1]);
    else keywords.push(a);
  }
  if (keywords.length === 0) {
    process.stderr.write("usage: bun search.ts [--limit=N] <keyword...>\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(searchSessions(keywords, limit)) + "\n");
}
