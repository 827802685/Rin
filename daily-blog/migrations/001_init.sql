-- 初始迁移：文章表（Day 1 最小可运行版本）
CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT    NOT NULL UNIQUE,
  title        TEXT    NOT NULL,
  summary      TEXT    NOT NULL DEFAULT '',
  content_md   TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  author       TEXT    NOT NULL DEFAULT 'admin',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_posts_status_time
  ON posts (status, COALESCE(published_at, created_at) DESC);
