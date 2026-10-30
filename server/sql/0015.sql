-- 友链动态聚合（朋友圈）：friends 表新增 rss 列，存储友链站点的 RSS/Atom 订阅地址。
-- 可空：未填写的友链不参与 /friend/circle 聚合，保持向后兼容。

ALTER TABLE `friends` ADD COLUMN `rss` text;
--> statement-breakpoint
UPDATE `info` SET `value` = '15' WHERE `key` = 'migration_version';
