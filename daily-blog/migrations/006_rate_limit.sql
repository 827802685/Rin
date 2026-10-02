-- Day 7：交付加固（全局限流的命中记录）
-- 全部使用 IF NOT EXISTS，保证可重复执行；不改写已执行的 001~005 迁移。
--
-- 设计说明：
-- 1. 限流计数落库而不是放进程内存：评论限流（Day 5）已经用了同一套
--    「SQLite 时间窗口」的口径，这里保持一致，重启进程不会把额度清零
--    （否则攻击者只要持续触发重启就能绕过）；
-- 2. 不存明文 IP：subject 是加盐 SHA-256 摘要（见 src/lib/ip.js），
--    与评论表口径一致，库里没有可反查的个人信息；
-- 3. 只记「每一次请求」而不做预分配计数：额度、窗口全部由服务层按配置项计算，
--    改配置不需要改表结构，也不需要清理历史数据；
-- 4. 表只增不减，靠服务层的清理逻辑按窗口删除过期行，不做定时调度。

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket     TEXT NOT NULL,
  subject    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 主查询：按 (桶, 来源, 时间) 统计窗口内的命中次数。
CREATE INDEX IF NOT EXISTS idx_rate_limit_lookup
  ON rate_limit_hits (bucket, subject, created_at);

-- 清理：按时间删除全部桶的过期行。
CREATE INDEX IF NOT EXISTS idx_rate_limit_created
  ON rate_limit_hits (created_at);
