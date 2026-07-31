#!/usr/bin/env bun
// query.ts — agent 横断 history DB の session reader。
//
// db.ts (schema / 接続 / 型) を起点に、ドメインクエリを提供する。
// session reader はここを呼ぶ。書き込みは source adapter の責務。
// 列の型は db.ts の MessageRow から導出し、二重定義しない。
//
// CLI: bun query.ts [SESSION_ID]
//   SESSION_ID 省略時は cwd の直近セッションを自己解決する。
//   stdout: { meta: { session, cwd, model, span:{start,end},
//                     volume:{msgs,user,assistant} },
//            messages: [ { role, text, timestamp }, ... ] }
//   meta は DB で計算済み — 要約側が目視で数えなくて済むようにする。

import { openHistory, type MessageRow } from "./db.ts";
import { HISTORY_NOISE_PREDICATE } from "./noise.ts";

export interface SessionMeta {
  session: string;
  cwd: string | null;
  model: string | null;
  span: { start: string; end: string };
  volume: { msgs: number; user: number; assistant: number };
}

export type SessionMessage = Pick<MessageRow, "role" | "text" | "timestamp">;

export interface Session {
  meta: SessionMeta;
  messages: SessionMessage[];
}

// cwd の直近セッション ID を返す (なければ null)。
export function latestSessionForCwd(cwd: string): string | null {
  const db = openHistory();
  try {
    const row = db
      .query(
        "SELECT session_id FROM messages WHERE cwd = ? " +
          "GROUP BY session_id ORDER BY MAX(timestamp) DESC LIMIT 1",
      )
      .get(cwd) as { session_id: string } | null;
    return row?.session_id ?? null;
  } finally {
    db.close();
  }
}

// id（完全一致）を優先し、なければ prefix 一致の最新 session を返す (なければ null)。
// statusline に出る先頭 7 桁のような prefix から full id を解決するため。
export function resolveSessionId(idOrPrefix: string): string | null {
  const db = openHistory();
  try {
    const exact = db
      .query("SELECT 1 FROM messages WHERE session_id = ? LIMIT 1")
      .get(idOrPrefix);
    if (exact) return idOrPrefix;
    const like = idOrPrefix.replace(/[%_\\]/g, "\\$&") + "%";
    const row = db
      .query(
        "SELECT session_id FROM messages WHERE session_id LIKE ? ESCAPE '\\' " +
          "GROUP BY session_id ORDER BY MAX(timestamp) DESC LIMIT 1",
      )
      .get(like) as { session_id: string } | null;
    return row?.session_id ?? null;
  } finally {
    db.close();
  }
}

// session_id のメタ情報とメッセージを取得する (なければ null)。
export function getSession(sessionId: string): Session | null {
  const db = openHistory();
  try {
    const meta = db
      .query(
        "SELECT session_id AS session, cwd, " +
          // <synthetic> は実モデルでなく合成メッセージの印。model 集計からは除外する
          // (GROUP_CONCAT は NULL を無視するので CASE で NULL に倒せば落ちる)。
          "GROUP_CONCAT(DISTINCT CASE WHEN model <> '<synthetic>' THEN model END) AS model, " +
          "MIN(timestamp) AS span_start, MAX(timestamp) AS span_end, " +
          "COUNT(*) AS msgs, " +
          "SUM(role = 'user') AS user, " +
          "SUM(role = 'assistant') AS assistant " +
          "FROM messages WHERE session_id = ?",
      )
      .get(sessionId) as {
      session: string | null;
      cwd: string | null;
      model: string | null;
      span_start: string | null;
      span_end: string | null;
      msgs: number;
      user: number;
      assistant: number;
    } | null;

    if (!meta || meta.session == null) return null;

    const messages = db
      .query(
        "SELECT role, text, timestamp FROM messages " +
          "WHERE session_id = ? ORDER BY timestamp",
      )
      .all(sessionId) as SessionMessage[];

    return {
      meta: {
        session: meta.session,
        cwd: meta.cwd,
        model: meta.model,
        span: { start: meta.span_start ?? "", end: meta.span_end ?? "" },
        volume: { msgs: meta.msgs, user: meta.user, assistant: meta.assistant },
      },
      messages,
    };
  } finally {
    db.close();
  }
}

// ── per-hour window (timeline skill 用) ──────────────────────────────
// session 単位でなく「JST のある 1 時間」を全 session 横断で引く。
// timeline がスレッド別に束ねるための素材 = その hour のユーザ発話 + volume/cwds メタ。

export interface HourWindowMessage {
  jst: string; // "YYYY-MM-DD HH:MM:SS" (JST)
  cwd: string | null;
  text: string;
}

export interface HourWindow {
  meta: {
    date: string; // JST "YYYY-MM-DD"
    hour: number; // 0-23 (JST)
    window_start: string; // JST "YYYY-MM-DD HH:00:00"
    window_end: string; // JST "YYYY-MM-DD HH:00:00" (+1h, 23 時台は翌日 00:00:00)
    cwds: string[]; // この hour に触った cwd 一覧
    volume: { msgs: number; user: number }; // msgs=全 message, user=ノイズ除外後の発話数
  };
  messages: HourWindowMessage[]; // ユーザ発話のみ (ノイズ除外, JST 昇順)
}

// timestamp は UTC ISO で格納。比較は既存 (drain) と同じく "+9 hours" で JST 面に寄せて行う。
// /clear や tool_result, malformed retry などの非発話ノイズは除外する。
const WINDOW_PREDICATE =
  "datetime(timestamp, '+9 hours') >= $start " +
  "AND datetime(timestamp, '+9 hours') < datetime($start, '+1 hour')";
// JST の date (YYYY-MM-DD) と hour (0-23) で 1 時間枠 [HH:00, HH+1:00) を引く。
export function getHourWindow(date: string, hour: number): HourWindow {
  const db = openHistory();
  try {
    const start = `${date} ${String(hour).padStart(2, "0")}:00:00`;

    const bounds = db
      .query("SELECT datetime($start, '+1 hour') AS win_end")
      .get({ $start: start }) as { win_end: string };

    const vol = db
      .query(
        "SELECT COUNT(*) AS msgs, " +
          `SUM(CASE WHEN role = 'user' AND ${HISTORY_NOISE_PREDICATE} THEN 1 ELSE 0 END) AS user ` +
          `FROM messages WHERE ${WINDOW_PREDICATE}`,
      )
      .get({ $start: start }) as { msgs: number; user: number };

    const cwdRows = db
      .query(
        "SELECT DISTINCT cwd FROM messages " +
          `WHERE cwd IS NOT NULL AND ${WINDOW_PREDICATE}`,
      )
      .all({ $start: start }) as { cwd: string }[];

    const messages = db
      .query(
        "SELECT datetime(timestamp, '+9 hours') AS jst, cwd, text FROM messages " +
          `WHERE role = 'user' AND ${WINDOW_PREDICATE} AND ${HISTORY_NOISE_PREDICATE} ` +
          "ORDER BY timestamp",
      )
      .all({ $start: start }) as HourWindowMessage[];

    return {
      meta: {
        date,
        hour,
        window_start: start,
        window_end: bounds.win_end,
        cwds: cwdRows.map((r) => r.cwd),
        volume: { msgs: vol.msgs, user: vol.user ?? 0 },
      },
      messages,
    };
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const cwd = process.cwd();
  const arg = process.argv[2];
  const sid = arg ? resolveSessionId(arg) : latestSessionForCwd(cwd);
  if (!sid) {
    process.stderr.write(
      arg ? `session not found: ${arg}\n` : `no session found for cwd: ${cwd}\n`,
    );
    process.exit(1);
  }
  const session = getSession(sid);
  if (!session) {
    process.stderr.write(`session not found: ${sid}\n`);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(session) + "\n");
}
