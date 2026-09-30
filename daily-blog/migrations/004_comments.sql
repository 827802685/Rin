-- Day 5：评论（comments）
-- 全部使用 IF NOT EXISTS，保证可重复执行；不改写已执行的 001~003 迁移。
--
-- 设计说明：
-- 1. 评论只挂在文章上，不做楼层回复（parent_id），避免「树形评论 + 审核 + 防灌水」一次性引入过高的复杂度；
-- 2. status 用 CHECK 约束在数据库层面兜底，只允许 pending / approved / rejected 三种，
--    即使服务层被绕过也不会写出非法状态；
-- 3. 不存明文 IP：只存加盐摘要 ip_hash，用于「同一来源短时间内的提交频率」限制，
--    满足防灌水需求的同时不落库可反查的个人信息；
-- 4. 文章删除时评论连带清理（ON DELETE CASCADE），审核人账号删除时只置空审核人（SET NULL），
--    保留评论本身，避免管理员账号变动造成历史审核记录丢失。

CREATE TABLE IF NOT EXISTS comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id      INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_name  TEXT    NOT NULL,
  author_email TEXT    NOT NULL DEFAULT '',
  author_url   TEXT    NOT NULL DEFAULT '',
  content      TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending',
  ip_hash      TEXT    NOT NULL DEFAULT '',
  user_agent   TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  moderated_at TEXT,
  moderated_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  CHECK (status IN ('pending', 'approved', 'rejected')),
  CHECK (length(trim(author_name)) > 0),
  CHECK (length(trim(content)) > 0)
);

-- 前台详情页：按文章取已通过评论。
CREATE INDEX IF NOT EXISTS idx_comments_post_status ON comments (post_id, status, created_at);

-- 后台审核列表：按状态筛选后按时间倒序。
CREATE INDEX IF NOT EXISTS idx_comments_status_created ON comments (status, created_at DESC);

-- 防灌水：统计同一来源在最近一段时间内的提交次数。
CREATE INDEX IF NOT EXISTS idx_comments_ip_created ON comments (ip_hash, created_at);
