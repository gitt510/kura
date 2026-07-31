CREATE TABLE IF NOT EXISTS entries (
  date            TEXT PRIMARY KEY,
  payload         TEXT NOT NULL,
  trending_count  INTEGER NOT NULL,
  gen_model       TEXT,
  gen_effort      TEXT,
  published_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
