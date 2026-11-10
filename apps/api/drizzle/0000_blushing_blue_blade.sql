CREATE TABLE `movies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tmdb_id` integer,
	`title` text NOT NULL,
	`original_title` text DEFAULT '' NOT NULL,
	`poster_url` text,
	`release_date` text,
	`overview` text DEFAULT '' NOT NULL,
	`cast` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'recommended' NOT NULL,
	`watched_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "movies_status_check" CHECK("movies"."status" in ('recommended', 'watched')),
	CONSTRAINT "movies_watched_at_check" CHECK(("movies"."status" = 'recommended' and "movies"."watched_at" is null) or ("movies"."status" = 'watched' and "movies"."watched_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `movies_tmdb_id_unique` ON `movies` (`tmdb_id`);--> statement-breakpoint
CREATE INDEX `movies_status_created_idx` ON `movies` (`status`,`created_at`);