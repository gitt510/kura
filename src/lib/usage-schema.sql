-- usage.db — kura が行った全 LLM 呼び出しの token / cost 台帳。
-- 1 row = 1 call。writer は lib/usage.ts のみ。

CREATE TABLE IF NOT EXISTS calls (
  feature TEXT NOT NULL,                  -- 呼び出し元 (timeline / english / decisions / companion)
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
