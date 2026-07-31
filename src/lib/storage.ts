// storage.ts — kura の runtime state の置き場と旧 checkout 内 DB の一回移行。

import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";

const home = process.env.HOME;
if (!home) throw new Error("HOME is required");

const stateHome = process.env.XDG_STATE_HOME ?? `${home}/.local/state`;
export const KURA_STATE_DIR = `${stateHome}/kura`;
export const KURA_ROOT = resolve(import.meta.dir, "../..");

function prepareStateDir(): void {
  mkdirSync(KURA_STATE_DIR, { recursive: true, mode: 0o700 });
  try {
    chmodSync(KURA_STATE_DIR, 0o700);
  } catch {
    /* filesystem may not support POSIX permissions */
  }
}

// checkout 内にあった DB は初回だけ state dir へ原子的に移す。
// target が既にあればそちらを正本とし、legacy を上書きしない。
export function stateDbPath(name: string, legacyPath: string): string {
  prepareStateDir();
  const target = `${KURA_STATE_DIR}/${name}`;
  if (!existsSync(target) && existsSync(legacyPath)) {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const from = `${legacyPath}${suffix}`;
      const to = `${target}${suffix}`;
      if (existsSync(from) && !existsSync(to)) renameSync(from, to);
    }
  }
  secureStateFile(target);
  return target;
}

export function secureStateFile(path: string): void {
  try {
    if (existsSync(path)) chmodSync(path, 0o600);
  } catch {
    /* filesystem may not support POSIX permissions */
  }
}

export function legacyDbPath(feature: string, name: string): string {
  return join(KURA_ROOT, feature, name);
}

export function openStateDatabase(path: string, schemaPath: string): Database {
  const db = new Database(path, { create: true });
  secureStateFile(path);
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(readFileSync(schemaPath, "utf-8"));
  return db;
}

export function tableColumns(db: Database, table: string): Set<string> {
  return new Set(
    (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name),
  );
}
