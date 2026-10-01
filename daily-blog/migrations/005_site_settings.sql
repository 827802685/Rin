-- Day 6：站点配置（site_settings）
-- 全部使用 IF NOT EXISTS，保证可重复执行；不改写已执行的 001~004 迁移。
--
-- 设计说明：
-- 1. 用「键值对」而不是一张只有一行的宽表：新增配置项不必改表结构，
--    也就不需要再写一个迁移文件，避免每加一个设置项都动一次 schema；
-- 2. 环境变量仍然是默认值与「事实来源」：这里只存**被后台改过**的项，
--    表里没有的键一律回落到 config.js 的取值，因此清空这张表等于恢复默认；
-- 3. CHECK 约束要求键非空，避免写入空键导致配置项静默失效；
-- 4. 不存布尔/整数类型：SQLite 的类型亲和性会让 "1" 与 1 混在一起难以判断，
--    统一以 TEXT 存储，由服务层按键做显式解析与校验。

CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (length(trim(key)) > 0)
);
