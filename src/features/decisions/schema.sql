-- schema.sql — per-hour decisions (decisions.db) の table 定義 (SoT)。
-- decisions/db.ts の openDecisionsDb() が冪等に適用する。生 sqlite。形は手で書く。
--
-- 会話の raw は別 DB (history/history.db)。timeline / english とも別。
-- ここは「ある 1 時間 × 1 repo (cwd) の会話から蒸留したコード意思決定」を 1 行に束ねる。
-- timeline / english と違い hour が複数 repo をまたぐため、PK は (window_start, cwd) の複合。
-- 再生成は UPSERT で冪等。decision の形 (grepathy 互換の contract) は db.ts の Decision が所有する。

CREATE TABLE IF NOT EXISTS entries (
  window_start    TEXT NOT NULL,      -- JST hour bucket の開始 "YYYY-MM-DD HH:00:00"
  window_end      TEXT,               -- +1h (JST)。23 時台は翌日 00:00:00 に巻く
  date            TEXT,               -- JST "YYYY-MM-DD" (索引用に分離)
  cwd             TEXT NOT NULL,      -- 蒸留単位 = repo。本家 grepathy は branch だが history に branch 列が無い
  intent          TEXT,               -- この hour × repo の作業目的 1-2 文 (本家の pack-level intent)
  decisions       TEXT,               -- JSON array of Decision (db.ts 所有) | NULL
  gen_model       TEXT,               -- この行を生成した LLM の model id
  gen_effort      TEXT,               -- 同 effort。取れない環境では NULL
  created_at      TEXT,               -- レコード初回作成 (再生成でも保持)
  updated_at      TEXT,               -- レコード最終更新 (再生成で追従)
  published_at    TEXT,               -- 配信済み時刻。第 1 段は配信先未定のため常に NULL
  PRIMARY KEY (window_start, cwd)
);

CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
CREATE INDEX IF NOT EXISTS idx_entries_cwd  ON entries(cwd);
