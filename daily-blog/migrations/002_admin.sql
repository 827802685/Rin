-- Day 2：后台管理所需的数据表（管理员账号 + 登录会话）
-- 全部使用 IF NOT EXISTS，保证可重复执行；不改写已执行的 001_init.sql。

CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  last_login_at TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 会话表：id 存的是会话令牌的 SHA-256 摘要，令牌明文只存在于用户 Cookie 中，
-- 因此即使数据库泄露也无法直接冒用会话。
CREATE TABLE IF NOT EXISTS admin_sessions (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  user_agent TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions (expires_at);
