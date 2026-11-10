# Television and Douban Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Search and import TV or movies from TMDB/Douban, retaining local posters and existing library behavior.
**Architecture:** Keep local movie IDs stable, introduce media/source identity, and add a server-side Douban adapter. Independent providers and image handling feed the existing API; both React apps consume the same shared types.
**Tech Stack:** Bun workspace, TypeScript, Hono, Drizzle SQLite, React/Vite; existing UI libraries.
**Spec:** `docs/superpowers/specs/2026-11-10-tv-metadata-design.md` (approved by user on 2026-11-10).

## Global Constraints

- Preserve existing movie IDs, fields, watched order, links, and poster references.
- No CLI subprocess dependency, browser cookies, automatic cross-source merging, or sample imports into the personal library.
- One selected source entry per record; Douban season entries may be separate. One primary poster; no episode progress.
- Use strict trusted image sources and existing byte/MIME/size checks; never accept arbitrary image hosts.
- Preserve legacy TMDB movie API defaults; add explicit media type to new external identities, cache keys, joins and links.
- Work in the existing checkout on `codex/tv-douban`; preserve the user's `.gitignore` edit.

## Review Focus

- Same numeric TMDB movie/TV IDs must coexist without cache, actor status, or catalog collisions (Tasks 1, 2, 4).
- Douban images and errors must remain bounded and cannot enable arbitrary requests or redirects (Tasks 2, 3).
- Switching source/type mid-request cannot show or import stale results (Task 5).
- Filtered home pagination, counts, preload and back navigation must agree (Tasks 4, 5).
- Old SQLite migrations and Windows file handles must preserve data and release resources (Task 1).

## Task 1: Shared contracts and database compatibility

**Files:** `packages/shared/src/index.ts`, `apps/api/src/schema.ts`, `apps/api/src/db.ts`, new Drizzle migration/snapshot/journal, `apps/api/tests/tv-library.test.ts`, `apps/api/tests/database-close.test.ts`.

**Interfaces:** Export `MediaType = "movie" | "tv"`, `MetadataSource = "tmdb" | "douban"`, and `MetadataSearchResult` with `provider`, `mediaType`, numeric `externalId`, title/originalTitle/posterUrl/releaseDate/overview and optional year/countries. `MovieInput` gains optional mediaType/doubanId/episodeCount; `Movie` gains required mediaType and nullable doubanId/episodeCount. `SearchMovie` gains optional mediaType/year/countries for backward-compatible provider fixtures. Detail and grid types expose the media fields they display.

- [x] Write regression tests for close/reopen/delete, old row preservation, nullable source IDs and same TMDB ID across movie/TV; run to establish failure.
- [x] Add fields with defaults and replace the standalone TMDB unique index with `(media_type, tmdb_id)`; add separate Douban unique index. Generate consistent Drizzle metadata, review migration to avoid table rebuild.
- [x] Finalize database resources on close using the supported Bun API; confirm the observed Windows cleanup failures are resolved without weakening assertions.
- [x] Run focused migration tests and existing API tests; commit only this task's files when integrated.

## Task 2: TMDB television and Douban metadata providers

**Files:** `apps/api/src/tmdb.ts`, new `metadata.ts`, `douban.ts`, optional bounded-cache helper; new `tmdb-tv.test.ts` and `douban.test.ts`.

**Interfaces:** Keep `MovieMetadataProvider.search(query, mediaType?: MediaType)`, `details(id, mediaType?: MediaType)`, `actorFilmography?(personId, mediaType?: MediaType)` with movie defaults. Export `MetadataProvider { readonly configured: boolean; search(query: string, mediaType: MediaType): Promise<MetadataSearchResult[]>; details(id: number, mediaType: MediaType): Promise<MovieInput> }`. Export `createDoubanProvider(fetcher?: typeof fetch): MetadataProvider` and `tmdbMetadataProvider(provider: MovieMetadataProvider): MetadataProvider` from `metadata.ts` (the adapter can live there; factory re-export allowed).

- [x] Write and run failing tests for TV search/detail/aggregate roles/person TV credits and movie/TV cache isolation.
- [x] Implement explicit TV field mapping, full-show credits, optional English detail fallback, and backward-compatible movie behavior.
- [x] Write and run failing Douban tests using My Mister ID 27602137; assert 2018-03-21, 16 episodes, names without TMDB IDs, actual high-resolution cover field, type mismatch rejection, missing fields and valid dates only.
- [x] Implement fixed-origin anonymous requests with timeout, bounded successful cache and request deduplication; reject verification/HTML/malformed responses, rate limits and invalid IDs. Search limits must remain bounded and type-filtered.
- [x] Run old and new provider tests; write task report with commands and evidence.

## Task 3: Trusted Douban poster previews and storage

**Files:** `apps/api/src/posters.ts`, new image-source helper if useful, `packages/shared/src/home-grid.ts`, new `apps/api/tests/douban-posters.test.ts`.

**Interfaces:** Keep `PosterStore` unchanged. Export `LOCAL_DOUBAN_POSTER_PATH_PATTERN` and `doubanPosterSource(localPath: string): string` from `posters.ts` for the API preview route. `localPosterUrl` maps trusted Douban remote URLs into local preview paths; `save` accepts the same preview paths. Select deterministic non-signed primary-image sources from provider details; signed search previews may use narrowly validated local encoding.

- [x] Write/run failing tests for trusted static and signed preview URLs, offline reopening, concurrent deduplication and unchanged store contract.
- [x] Implement exact HTTPS host/path/query validation and same-origin preview URLs; add Douban Referer header when downloading, reject redirects, credentials, ports, traversal and unrelated hosts.
- [x] Extend shared local image URL validation without weakening TMDB behavior.
- [x] Run poster/actor-image tests and record results. Root adds preview HTTP route in Task 4.

## Task 4: Source-aware library API and filtered preload

**Files:** `apps/api/src/app.ts`, `validation.ts`, `home-html.ts`, API integration tests and home HTML tests.

**Interfaces:** `AppDependencies.douban?: MetadataProvider`. `GET /api/metadata/search?provider=...&mediaType=...&q=...` returns `{ results: MetadataSearchResult[] }`; `POST /api/movies/import` accepts either legacy `{tmdbId,magnetUrl?}` or `{provider,mediaType,externalId,magnetUrl?}`. `GET /api/catalog/tv/:tmdbId` is TV-only, legacy `/catalog/movies/:tmdbId` remains movie-only. Actor movies endpoint accepts `mediaType=movie|tv` default movie. Library optional `mediaType` filters both rows and counts, not counts by text query. Health adds `providers: {tmdb:boolean,douban:boolean}` while retaining `tmdbConfigured`.

- [x] Add/run failing real-SQLite tests for all import identities, localized posters, 409 duplicates, mismatches before write, old request bodies, TV catalog and actor overlay isolation.
- [x] Validate contracts, normalize stored defaults, make every external lookup and conflict target type-aware, and route the correct provider.
- [x] Add Douban preview route using Task 3 exports; legacy image routes retain behavior.
- [x] Add/run preload filter test; pass mediaType to SQL and keep pagination/priority consistent with shared grid configuration.
- [x] Run API suite and typecheck; fix real failures and record evidence.

## Task 5: Management and viewer UI

**Files:** `apps/admin/src/App.tsx`, adding/detail/table/sidebar/header components; `apps/web/src/App.tsx`, pages, `lib/api.ts`, `lib/navigation.ts`, relevant CSS; focused navigation tests where logic warrants them.

**Interfaces:** Consume Tasks 1/4 contracts verbatim. Selected external keys are `${provider}:${mediaType}:${externalId}`. Shared client media query is `mediaType` (absent = all at library level; absent = movie on legacy actor API). Public TV catalog route `/catalog/tv/:id`; movie route stays `/catalog/movies/:id`.

- [x] Consult modern-web-guidance and preserve existing UI patterns; add labeled source/type choices with only current-source configuration errors.
- [x] Implement explicit source/type selection, request cancellation and stale-result guards, correct source identity submission, year/country disambiguation and entry-granularity note. Keep pending imports bound to their selected candidate.
- [x] Add media filters/badges, correct premiere/episode copy, safe source links, and non-clickable Douban actors.
- [x] Extend viewer shelf filtering and URL state; reset pages on filter changes, preserve filter/pages when returning from details. Extend TMDB actor type switching and catalog links.
- [x] Run both frontend typechecks/builds and browser smoke checks for cancellation, My Mister sample metadata, filter/back navigation, mobile labels and existing movie behavior.

## Task 6: Review, documentation and final verification

**Files:** README and web README; task-scoped fixes only as warranted.

- [x] Review provider and image task diffs for spec and quality before integrating their callers; document rulings in the plan ledger.
- [x] Update usage, API identities, source limitations, data backup and migration notes.
- [x] Run `bun run typecheck`, `bun test`, `bun run build`, and `git diff --check` after integration. Browser testing uses an isolated temporary SQLite/poster directory, never the personal library.
- [x] Request fresh whole-branch review; resolve actionable findings and rerun relevant checks. Commit the feature locally without pushing or merging a shared branch.

## Execution rulings

- User explicitly approved the design and requested execution; proceed through the plan without another approval checkpoint.
- Reuse the current checkout on a feature branch per desktop instructions, avoiding an unsolicited worktree.
- Independent providers, poster handling and UI have disjoint file ownership and can run concurrently per active multi-agent instructions; root owns shared types, schema and integration.
- Baseline on Bun 1.4.3: 44 pass, 1 skip, 12 fail, all failures are temporary SQLite cleanup `EBUSY`; investigate and fix database close semantics in Task 1. The skipped encoder integration requires cwebp 1.6.0.

## Verification results

- All four workspaces pass typecheck; both frontends build. The admin bundle retains a non-blocking >500 kB chunk warning.
- Bun tests: 97 pass, 1 skip, 0 fail. The single skipped real-encoder test requires cwebp 1.6.0; original-image fallback and local storage are tested.
- Real anonymous Douban search and TV import of My Mister (27602137) verified in a temporary library, including 2018-03-21, 16 episodes, 19 actors and a local high-resolution cover. Browser checks covered media filtering, detail/back navigation, source selection and 390px layout.
- Task reviews passed. Final whole-branch review found missing TMDB TV candidate countries; regression added and fixed, strict detail validation preserved, scoped re-review READY/PASS.
- No personal library imports, no push, no merge. Temporary QA server stopped. Automatic approval review blocked removal of its temporary directory, which is retained.
