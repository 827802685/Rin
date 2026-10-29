-- 文章点赞（互动留存）：feeds 表新增 likes 计数列。
-- 递增走 SQL 层 `likes + 1`，避免并发丢失更新（同 visit-stats PV 的做法）。

ALTER TABLE `feeds` ADD COLUMN `likes` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `info` SET `value` = '14' WHERE `key` = 'migration_version';
