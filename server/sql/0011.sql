-- Pinned feeds support
-- `feeds.top` is declared in src/db/schema.ts but was never created by 0000-0010,
-- so a freshly migrated database breaks on every `orderBy desc(feeds.top)` query
-- and the pin/unpin endpoints fail at runtime.

ALTER TABLE `feeds` ADD COLUMN `top` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `info` SET `value` = '11' WHERE `key` = 'migration_version';
