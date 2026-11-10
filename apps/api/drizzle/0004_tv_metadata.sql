DROP INDEX `movies_tmdb_id_unique`;--> statement-breakpoint
ALTER TABLE `movies` ADD `media_type` text DEFAULT 'movie' NOT NULL;--> statement-breakpoint
ALTER TABLE `movies` ADD `douban_id` integer;--> statement-breakpoint
ALTER TABLE `movies` ADD `episode_count` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `movies_media_tmdb_unique` ON `movies` (`media_type`,`tmdb_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `movies_douban_unique` ON `movies` (`douban_id`);