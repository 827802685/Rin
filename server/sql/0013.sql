-- P0 blog-markdown 导入器 + 内容组织（分类/taxonomy）支持
-- 为 feeds 表新增 slug / cover / category 三列，便于自定义 URL、封面与分类。

ALTER TABLE `feeds` ADD COLUMN `slug` text;
--> statement-breakpoint
ALTER TABLE `feeds` ADD COLUMN `cover` text;
--> statement-breakpoint
ALTER TABLE `feeds` ADD COLUMN `category` text;
--> statement-breakpoint
UPDATE `info` SET `value` = '13' WHERE `key` = 'migration_version';
