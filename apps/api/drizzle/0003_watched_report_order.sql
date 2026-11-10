ALTER TABLE `movies` ADD `watched_order` integer;--> statement-breakpoint
-- Preserve the watched list's existing created_at/id order before tracking new reports.
WITH watched AS (
  SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS position
  FROM movies
  WHERE status = 'watched'
)
UPDATE movies
SET watched_order = (SELECT position FROM watched WHERE watched.id = movies.id)
WHERE status = 'watched';--> statement-breakpoint
CREATE INDEX `movies_status_watched_order_idx` ON `movies` (`status`,`watched_order`);
