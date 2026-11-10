CREATE TABLE `movie_posters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`movie_id` integer NOT NULL,
	`url` text NOT NULL,
	`source` text,
	`source_id` text,
	`width` integer,
	`height` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `movie_posters_movie_url_unique` ON `movie_posters` (`movie_id`,`url`);--> statement-breakpoint
CREATE UNIQUE INDEX `movie_posters_movie_source_unique` ON `movie_posters` (`movie_id`,`source`,`source_id`);--> statement-breakpoint
INSERT INTO movie_posters (movie_id, url, created_at) SELECT id, poster_url, created_at FROM movies WHERE poster_url IS NOT NULL AND poster_url <> '';
