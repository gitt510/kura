-- schema.sql — per-hour timeline (timeline.db) の table 定義 (SoT)。
-- timeline/db.ts の openTimeline() が冪等に適用する。生 sqlite。形は手で書く。
--
-- 会話の raw は別 DB (history/history.db)。
-- ここは「ある 1 時間 (JST の hour bucket) に全 session 横断で何をしたか」を 1 行に束ねる。
-- window_start (JST "YYYY-MM-DD HH:00:00") を PK にして、再生成が UPSERT で冪等になる。

CREATE TABLE IF NOT EXISTS timelines (
  window_start    TEXT PRIMARY KEY,   -- UPSERT のキー = JST hour bucket の開始 "YYYY-MM-DD HH:00:00"
  window_end      TEXT,               -- +1h (JST)。23 時台は翌日 00:00:00 に巻く
  date            TEXT,               -- JST "YYYY-MM-DD" (daily digest 用に分離)
  hour            INTEGER,            -- 0-23 (JST)
  msgs            INTEGER,            -- window 内 message 総数 (volume 指標)
  user_msgs       INTEGER,            -- window 内のユーザ発話数 (ノイズ除外後 = 実プロンプト数)
  cwds            TEXT,               -- JSON array | NULL (この hour に触った cwd 一覧)
  title           TEXT,               -- その hour を一言で
  summary         TEXT,               -- 1〜2 文の要旨 (冒頭表示) | NULL
  threads         TEXT,               -- JSON array of {label, bullets[]} | NULL (スレッド別 timeline)
  gen_model       TEXT,               -- この行を生成した LLM の model id (provenance.ts の自己 introspection)
  gen_effort      TEXT,               -- 同 effort。取れない環境では NULL
  created_at      TEXT,               -- レコード初回作成 (再生成でも保持)
  updated_at      TEXT,               -- レコード最終更新 (再生成で追従)
  published_at    TEXT                -- Discord publish 済み時刻 (NULL = 未送信)
);

CREATE INDEX IF NOT EXISTS idx_timelines_date ON timelines(date);
