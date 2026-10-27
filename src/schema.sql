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

-- ---- usage: kura が行った全 LLM 呼び出しの token / cost 台帳 ----
-- 1 row = 1 call。writer は agent/usage.ts のみ。

CREATE TABLE IF NOT EXISTS usage (
  feature TEXT NOT NULL,                  -- 呼び出し元 (akapen / tldr / verbatim)
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
