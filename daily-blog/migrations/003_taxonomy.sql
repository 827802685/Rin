-- Day 3：分类与标签（taxonomy）
-- 全部使用 IF NOT EXISTS，保证可重复执行；不改写已执行的 001_init.sql / 002_admin.sql。
--
-- 设计说明：文章与分类是「多对一」关系，但没有对 posts 表执行 ALTER TABLE ADD COLUMN。
-- 原因是 SQLite 的 ADD COLUMN 不支持 IF NOT EXISTS（重复执行会直接报 duplicate column name），
-- 无法满足「迁移可重复执行」的约束。因此用 post_categories 表 + post_id 主键来表达
-- 「一篇文章至多属于一个分类」，既保持幂等，也避免了改写已交付的表结构。

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (length(trim(name)) > 0)
);

-- 文章 ↔ 分类：post_id 为主键，从数据层面保证一篇文章只有一个分类。
CREATE TABLE IF NOT EXISTS post_categories (
  post_id     INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 文章 ↔ 标签：多对多。
CREATE TABLE IF NOT EXISTS post_tags (
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_post_categories_category ON post_categories (category_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags (tag_id);
