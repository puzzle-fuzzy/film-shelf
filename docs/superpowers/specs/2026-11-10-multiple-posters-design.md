# Multiple posters and primary covers

The user approved one primary cover, several saved posters per work, cover selection in the admin, and browsing other posters in the viewer. They also authorized implementation, production deployment, commit, and push in this chat.

## Intended behavior

- Preserve every existing movie/TV record, cover, magnet, watch status and order. `movies.poster_url` stays the compatibility primary cover used by grids and existing clients.
- Store additional posters separately with stable IDs, owning movie, local URL, source/source ID and optional dimensions. Backfill existing primary covers without altering movie records.
- Admin details can fetch more posters, add a batch of Douban photo-detail links, and select a saved poster as primary. Pending and error states preserve the current cover.
- Library details show the saved poster collection in the existing accessible lightbox, including thumbnails, next/previous controls and keyboard navigation. Uncollected catalog previews keep their existing behavior.
- Public access stays read-only. Only the saved-gallery GET route is added to the current Nginx allowlist; imports, sync and cover changes remain private.

## Approaches

1. Replace one remote cover URL: small but cannot retain alternatives or provide browsing.
2. Keep a primary cover and a local poster collection: chosen by the user; supports switching, browsing and offline reuse without expanding public write access.
3. Fetch remote albums every time a detail opens: depends on upstream availability and causes repeated requests; not chosen.

## Source boundaries

TMDB has movie/TV image endpoints with poster lists. Fetch all image languages, validate paths and bound each synchronization to 40 candidates.

Douban's anonymous subject photo list currently ignores tested poster filters and includes stills. Do not label that list as posters. A public album HTML response may be parsed only if its identity and poster category are verified, then each photo is checked through the anonymous photo-detail endpoint. Verification/redirect pages produce an actionable error. A batch of Douban photo-detail links is the supported fallback: validate each photo's `photo_type=poster` and exact owner URI before downloading. No browser cookies are sent to the server and no verification is bypassed.

Initial production validation will import real posters for the existing Douban TV works from their verified public album photo IDs. Preserve their current primary covers unless explicitly selecting another for a reversible validation.

## Persistence and API

- `movie_posters`: primary integer ID, movie FK, local URL, nullable source/source ID/dimensions, timestamp; unique per movie+URL and movie+source+source ID.
- `GET /api/movies/:id/posters` returns `MoviePosterList { posters, primaryPosterId }`, reads local data only.
- `POST /api/movies/:id/posters/sync` obtains and saves up to 40 candidates; returns gallery and added/failed counts.
- `POST /api/movies/:id/posters` accepts 1–40 strict Douban photo-detail URLs; validates ownership/category before saving.
- `PATCH /api/movies/:id/poster` accepts an integer poster ID belonging to that work and returns the updated movie.
- Downloads use the existing trusted-host image store, real MIME validation and local immutable cache; generate current WebP variants when available. Maximum three concurrent downloads; deduplicate synchronization per work. Do not hold a database transaction over network waits.
- The two batch poster POST requests receive a 120-second Bun idle deadline; ordinary routes keep their existing timeout. Verify this with a delayed real HTTP response, including an ordinary-route control.
- Partial download failures retain saved successes and existing primary cover; invalid source/ownership is never reported as successful. Selecting a cover is atomic and never alters recommendation/watch metadata or magnet links.

## Validation and delivery

Cover migration preservation, ownership and cross-work selection, deduplication/concurrency, partial failure, strict URLs, offline GET, and real provider boundaries with focused tests. Run API tests, all workspace typechecks and both builds; review the full diff. Validate desktop/mobile galleries, keyboard/focus, cover selection, reload persistence and old single-cover records using isolated QA data. Commit only task files, retain the user's `.gitignore` change, push the active `codex/` branch without force. Deploy an immutable release with SQLite/poster backups, clone migration check, atomic current symlink and rollback; verify live galleries, unchanged 72-record library and public write restrictions.
