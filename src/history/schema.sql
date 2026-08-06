-- schema.sql — agent 横断 history DB の table 定義 (SoT)。
-- db.ts の openHistory() が冪等に適用する。生 sqlite。形は手で書く。

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
