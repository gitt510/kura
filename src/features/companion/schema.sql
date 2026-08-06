-- schema.sql — companion (companion.db) の table 定義 (SoT)。
-- db.ts の openCompanionDb() が冪等に適用する。生 sqlite。形は手で書く。

CREATE TABLE IF NOT EXISTS cards (
  -- 1 prompt = 1 card。key は COALESCE(prompt_id, uuid) — 仮 row が verbatim row に
  -- 差し替わって rowid / uuid が変わっても同じ prompt を二重に card 化しない。
  key         TEXT PRIMARY KEY,
  session_id  TEXT,
  cwd         TEXT,
  lang        TEXT,
  input       TEXT,
  english     TEXT,
  note        TEXT,
  model       TEXT,
  status      TEXT,
  created_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_cards_created ON cards(created_at);
