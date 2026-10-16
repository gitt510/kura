-- schema.sql — kura.db の table 定義 (SoT)。db.ts の openKura() が開くたびに冪等に適用する。
-- 生 sqlite。形は手で書く。
--
-- core の table (messages / tool_uses) は名前に何も付けない。extension の table は extension 名で
-- 始める。extension が table を 1 つしか持たない間は、extension 名そのものを table 名にする。

-- ---- core: 保存した会話 ----

CREATE TABLE IF NOT EXISTS messages (
  uuid         TEXT PRIMARY KEY,
  -- Claude の UserPromptSubmit payload 由来の prompt id。仮 row は uuid = prompt_id で
  -- 保存され、Stop の transcript scan が同じ promptId を持つ verbatim row に差し替える。
  prompt_id    TEXT,
  session_id   TEXT,
  cwd          TEXT,
  role         TEXT,
  text         TEXT,
  model        TEXT,
  timestamp    TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_session   ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_cwd       ON messages(cwd);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

CREATE TABLE IF NOT EXISTS tool_uses (
  id           TEXT PRIMARY KEY,
  message_uuid TEXT,
  session_id   TEXT,
  cwd          TEXT,
  tool_name    TEXT,
  input        TEXT,
  timestamp    TEXT
);

CREATE INDEX IF NOT EXISTS idx_tool_uses_message ON tool_uses(message_uuid);
CREATE INDEX IF NOT EXISTS idx_tool_uses_session ON tool_uses(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_uses_name    ON tool_uses(tool_name);

-- ---- extension: timeline ----
-- 「ある 1 時間 (JST の hour bucket) に全 session 横断で何をしたか」を 1 行に束ねる。
-- window_start (JST "YYYY-MM-DD HH:00:00") を PK にして、再生成が UPSERT で冪等になる。

CREATE TABLE IF NOT EXISTS timeline (
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

CREATE INDEX IF NOT EXISTS idx_timeline_date ON timeline(date);

-- ---- extension: english ----
-- 「ある 1 時間 (JST の hour bucket) のユーザ発話から作った英語学習カード」を 1 行に束ねる。
-- window_start (JST "YYYY-MM-DD HH:00:00") を PK にして、再生成が UPSERT で冪等になる。

CREATE TABLE IF NOT EXISTS english (
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

CREATE INDEX IF NOT EXISTS idx_english_date ON english(date);

-- ---- usage: kura が行った全 LLM 呼び出しの token / cost 台帳 ----
-- 1 row = 1 call。writer は agent/usage.ts のみ。

CREATE TABLE IF NOT EXISTS usage (
  feature TEXT NOT NULL,                  -- 呼び出し元 (timeline / english / akapen)
  agent TEXT NOT NULL,                    -- claude | codex
  model TEXT,                             -- 実行 model。出力から取得できなければ null
  ok INTEGER NOT NULL,                    -- 1 = 生成成功。失敗でも消費した token は記録する
  input_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL,                          -- Claude のみ。Codex の公開 event は cost を含まない
  created_at TEXT NOT NULL                -- ISO 8601 UTC
);
