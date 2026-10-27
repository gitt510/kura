// db.ts — kura の runtime state の置き場と、唯一の DB kura.db の窓口。
//
// table は core も usage も kura.db 1 つに置き、schema は schema.sql 1 つが正本。
// 機能ごとに分かれていた旧 DB (history.db など) は、kura.db を初めて作るときに一度だけ写す。

import { Database } from "bun:sqlite";
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const home = process.env.HOME;
if (!home) throw new Error("HOME is required");

const stateHome = process.env.XDG_STATE_HOME ?? `${home}/.local/state`;
export const KURA_STATE_DIR = `${stateHome}/kura`;
export const KURA_ROOT = resolve(import.meta.dir, "..");
export const KURA_DB = `${KURA_STATE_DIR}/kura.db`;
const SCHEMA_SQL = `${import.meta.dir}/schema.sql`;

// 旧 DB の file と、その table を kura.db のどの table に写すか。
const LEGACY: { file: string; tables: [from: string[], to: string][] }[] = [
  {
    file: "history.db",
    tables: [
      [["messages"], "messages"],
      [["tool_uses"], "tool_uses"],
    ],
  },
  { file: "usage.db", tables: [[["calls"], "usage"]] },
];

function prepareStateDir(): void {
  mkdirSync(KURA_STATE_DIR, { recursive: true, mode: 0o700 });
  try {
    chmodSync(KURA_STATE_DIR, 0o700);
  } catch {
    /* filesystem may not support POSIX permissions */
  }
}

export function secureStateFile(path: string): void {
  try {
    if (existsSync(path)) chmodSync(path, 0o600);
  } catch {
    /* filesystem may not support POSIX permissions */
  }
}

// kura.db を開き、schema を冪等に適用して返す。無ければ作り、旧 DB があれば中身を写す。
export function openKura(): Database {
  prepareStateDir();
  if (!existsSync(KURA_DB)) createKura();
  const db = new Database(KURA_DB, { create: true });
  secureStateFile(KURA_DB);
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(readFileSync(SCHEMA_SQL, "utf-8"));
  return db;
}

// 一時 file に schema と旧 DB の中身を作り切ってから kura.db に置く。hook が同時に
// 作りに来ても、link は既にある kura.db を上書きしないので、先に置けた 1 つだけが残る。
// 旧 DB は消さない — 写せたことを人が確かめてから消す。
function createKura(): void {
  const tmp = `${KURA_DB}.${process.pid}.tmp`;
  const db = new Database(tmp, { create: true });
  try {
    db.exec(readFileSync(SCHEMA_SQL, "utf-8"));
    for (const { file, tables } of LEGACY) {
      const path = `${KURA_STATE_DIR}/${file}`;
      if (existsSync(path)) copyLegacy(db, path, tables);
    }
    db.close();
    secureStateFile(tmp);
    try {
      linkSync(tmp, KURA_DB);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

// 列は両方にあるものだけを写す。旧 DB にしか無い列 (廃止済み) は捨て、kura.db にしか無い列は
// 既定値 (NULL) になる。
function copyLegacy(db: Database, path: string, tables: [string[], string][]): void {
  db.exec(`ATTACH DATABASE '${path.replaceAll("'", "''")}' AS legacy`);
  try {
    db.transaction(() => {
      for (const [candidates, to] of tables) {
        const from = candidates.find((name) => tableColumns(db, name, "legacy").size > 0);
        if (!from) continue;
        const target = tableColumns(db, to);
        const columns = [...tableColumns(db, from, "legacy")].filter((c) => target.has(c));
        const list = columns.map((c) => `"${c}"`).join(", ");
        db.exec(
          `INSERT OR IGNORE INTO main."${to}" (${list}) SELECT ${list} FROM legacy."${from}"`,
        );
      }
    })();
  } finally {
    db.exec("DETACH DATABASE legacy");
  }
}

export function tableColumns(db: Database, table: string, schema = "main"): Set<string> {
  return new Set(
    (db.query(`PRAGMA ${schema}.table_info("${table}")`).all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );
}
