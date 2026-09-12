-- Rate limiting storage
-- Fixed-window counters used by login throttling and the AI chat endpoint.
-- `bucket_key` is unique so the counter can be bumped with a single atomic upsert.

CREATE TABLE IF NOT EXISTS `rate_limits` (
	`id` integer PRIMARY KEY NOT NULL,
	`bucket_key` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `rate_limits_bucket_key_unique` ON `rate_limits` (`bucket_key`);
--> statement-breakpoint
UPDATE `info` SET `value` = '12' WHERE `key` = 'migration_version';
