-- schema.sql — per-hour english (english.db) の table 定義 (SoT)。
-- english/db.ts の openEnglishDb() が冪等に適用する。生 sqlite。形は手で書く。
--
-- 会話の raw は別 DB (history/history.db)。timeline (timeline.db) とも別。
-- ここは「ある 1 時間 (JST の hour bucket) のユーザ発話から作った英語学習カード」を 1 行に束ねる。
-- window_start (JST "YYYY-MM-DD HH:00:00") を PK にして、再生成が UPSERT で冪等になる。

CREATE TABLE IF NOT EXISTS entries (
  window_start    TEXT PRIMARY KEY,   -- UPSERT のキー = JST hour bucket の開始 "YYYY-MM-DD HH:00:00"
  window_end      TEXT,               -- +1h (JST)。23 時台は翌日 00:00:00 に巻く
  date            TEXT,               -- JST "YYYY-MM-DD" (title 表示・索引用に分離)
  cards           TEXT,               -- JSON array of Card (db.ts 所有: ja/phrase/en/syl/read/memo/alt) | NULL
  gen_model       TEXT,               -- この行を生成した LLM の model id (provenance.ts の自己 introspection)
  gen_effort      TEXT,               -- 同 effort。取れない環境では NULL
  created_at      TEXT,               -- レコード初回作成 (再生成でも保持)
  updated_at      TEXT,               -- レコード最終更新 (再生成で追従)
  published_at    TEXT                -- Discord publish 済み時刻 (NULL = 未送信)
);

CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
