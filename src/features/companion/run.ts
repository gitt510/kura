// run.ts — companion の adhoc entrypoint。
//
// history.db (messages) を rowid cursor で polling し、起動以降に届いた user prompt を
// 英語 feedback card に変換して companion.db へ保存し、local page へ SSE 配信する。
// schedule / publish は持たない — 起動している間だけ動く。
//
// 重複排除は card の key (COALESCE(prompt_id, uuid))。仮 row → verbatim row の
// 差し替えで同じ prompt が新しい rowid で再度見えても 2 枚目は作らない。
// companion 自身の生成呼び出しは KURA_NO_HISTORY=1 で走るため messages に現れない。

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { HISTORY_DB } from "../../history/db.ts";
import { hasCard, insertCard, openCompanionDb, recentCards, type CardRow } from "./db.ts";
import { clipInput, detectLang, shouldSkip } from "./detect.ts";
import { generateCard, resolveCompanionModel } from "./generate.ts";
import { startServer } from "./server.ts";

const USAGE = "usage: kura companion [--port=N] [--session=<prefix>]\n";
const POLL_MS = 1000;
const REPLAY_LIMIT = 50;

interface PromptRow {
  rowid: number;
  uuid: string;
  prompt_id: string | null;
  session_id: string;
  cwd: string | null;
  text: string;
  timestamp: string;
}

export async function runCompanion(args: string[]): Promise<number> {
  let port = 4989;
  let sessionPrefix: string | null = null;
  for (const arg of args) {
    const portMatch = arg.match(/^--port=(\d+)$/);
    const sessionMatch = arg.match(/^--session=(.+)$/);
    if (portMatch) port = Number.parseInt(portMatch[1]!, 10);
    else if (sessionMatch) sessionPrefix = sessionMatch[1]!;
    else {
      process.stderr.write(USAGE);
      return 2;
    }
  }

  if (!existsSync(HISTORY_DB)) {
    process.stderr.write(
      "history.db not found — enable a history source first: just history enable claude\n",
    );
    return 1;
  }

  const history = new Database(HISTORY_DB, { readonly: true });
  const companion = openCompanionDb();
  const server = startServer(port, () =>
    recentCards(companion, REPLAY_LIMIT)
      .reverse()
      .map((card) => ({ type: "card", card })),
  );

  const sessionFilter = sessionPrefix ? " AND session_id LIKE $session || '%'" : "";
  const pollQuery = history.query(
    `SELECT rowid, uuid, prompt_id, session_id, cwd, text, timestamp
       FROM messages
      WHERE rowid > $cursor AND role = 'user'${sessionFilter}
      ORDER BY rowid`,
  );
  const contextQuery = history.query(
    `SELECT text FROM messages
      WHERE session_id = $session AND role = 'assistant' AND rowid < $rowid
      ORDER BY rowid DESC LIMIT 1`,
  );

  // 起動時点より前の prompt は遡らない。
  let cursor = (
    history.query("SELECT COALESCE(MAX(rowid), 0) AS max FROM messages").get() as { max: number }
  ).max;

  async function handle(row: PromptRow): Promise<void> {
    const key = row.prompt_id ?? row.uuid;
    if (hasCard(companion, key) || shouldSkip(row.text)) return;

    const { text: input } = clipInput(row.text);
    const lang = detectLang(input);
    const createdAt = new Date().toISOString();
    server.broadcast({
      type: "pending",
      key,
      input,
      lang,
      cwd: row.cwd,
      created_at: createdAt,
    });

    const context = contextQuery.get({ $session: row.session_id, $rowid: row.rowid }) as {
      text: string;
    } | null;
    const generated = await generateCard({ input, lang, context: context?.text ?? null });
    const card: CardRow = {
      key,
      session_id: row.session_id,
      cwd: row.cwd,
      lang,
      input,
      english: generated.english,
      note: generated.notes?.length ? JSON.stringify(generated.notes) : null,
      model: generated.model,
      status: generated.status,
      created_at: createdAt,
    };
    insertCard(companion, card);
    server.broadcast({ type: "card", card });
  }

  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const rows = pollQuery.all(
        sessionPrefix ? { $cursor: cursor, $session: sessionPrefix } : { $cursor: cursor },
      ) as PromptRow[];
      for (const row of rows) {
        cursor = Math.max(cursor, row.rowid);
        await handle(row);
      }
    } catch (error) {
      process.stderr.write(`companion poll failed: ${error}\n`);
    } finally {
      busy = false;
    }
  }, POLL_MS);

  process.stdout.write(`kura companion\n`);
  process.stdout.write(`  watching : ${HISTORY_DB}${sessionPrefix ? ` (session ${sessionPrefix}*)` : ""}\n`);
  process.stdout.write(`  model    : ${resolveCompanionModel()}\n`);
  process.stdout.write(`  page     : ${server.url}\n`);
  if (process.platform === "darwin") {
    try {
      Bun.spawn(["open", server.url], { stdout: "ignore", stderr: "ignore" });
    } catch {
      /* page は手で開けばよい */
    }
  }

  await new Promise(() => {}); // SIGINT で終了するまで常駐
  return 0;
}
