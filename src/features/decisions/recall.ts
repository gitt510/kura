// recall.ts — decisions.db から repo 単位の decision を引く read-only reader。
//
// 同一 title は 1 件に畳み、最新 window の内容を採用して新しい順に返す
// (SQLite の bare-column は MAX() を含む集約で最大行から取られる)。
// repo working tree への書き出しは行わない — 出力は呼び手へ返す JSON のみ。
//
// repo は cwd の完全一致か path 末尾一致 ("kura" は ".../gitt510/kura" に一致)。
// 別 repo の同名 title を混ぜないため、集約は (cwd, title) 単位。

import { openDecisionsDb, type Decision } from "./db.ts";

export interface RecalledDecision extends Decision {
  cwd: string;
  lastSeen: string; // 最新出現 window の開始 (JST "YYYY-MM-DD HH:00:00")
}

export interface RecallResult {
  query: { repo: string };
  count: number;
  decisions: RecalledDecision[];
}

export function recallDecisions(repo: string, limit = 50): RecallResult {
  const db = openDecisionsDb();
  try {
    const rows = db
      .query(
        `SELECT je.value AS decision, entries.cwd AS cwd, MAX(entries.window_start) AS last_seen
         FROM entries, json_each(entries.decisions) AS je
         WHERE entries.decisions IS NOT NULL
           AND (entries.cwd = $repo OR entries.cwd LIKE '%/' || $repo)
         GROUP BY entries.cwd, je.value ->> 'title'
         ORDER BY last_seen DESC
         LIMIT $limit`,
      )
      .all({ $repo: repo, $limit: limit }) as {
      decision: string;
      cwd: string;
      last_seen: string;
    }[];

    // insert 時に shape validation 済みだが、手書きの DB 内容にも耐える。
    const decisions = rows.flatMap((row): RecalledDecision[] => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.decision);
      } catch {
        return [];
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
      if (typeof (parsed as { title?: unknown }).title !== "string") return [];
      return [{ ...(parsed as Decision), cwd: row.cwd, lastSeen: row.last_seen }];
    });

    return { query: { repo }, count: decisions.length, decisions };
  } finally {
    db.close();
  }
}
