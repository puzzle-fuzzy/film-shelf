# Multiple Posters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save several posters for a work, choose its primary cover, browse its gallery, then deploy, commit and push.

**Architecture:** Keep the existing primary-cover field and trusted image store. Add an owning poster table, isolated gallery service and local read API; augment existing admin drawer and viewer lightbox.

**Tech Stack:** Existing Bun workspaces, Hono, Drizzle/SQLite, React/Vite, TypeScript; no new dependencies required.

**Spec:** `docs/superpowers/specs/2026-11-10-multiple-posters-design.md`

## Global Constraints

- Preserve movie/TV data, magnets, watch order and public read-only access.
- At most 40 source candidates per operation and three image downloads in parallel.
- Anonymous Douban only; verify exact owner and poster category; never use unfiltered stills as a poster list.
- Retain the user-owned `.gitignore` modification; stage task files explicitly.

## Review Focus

- A poster ID from another movie cannot become this movie's cover.
- Upstream verification pages or foreign/still images do not silently become posters.
- Partial failures and repeated/concurrent imports retain prior covers and do not duplicate rows.
- Opening or refreshing a gallery works offline and does not trigger remote requests.
- Keyboard/mobile gallery behavior, selection persistence and legacy single-cover records remain usable.

### Task 1: Source adapters

**Files:** `apps/api/src/{douban,tmdb,metadata}.ts`, provider tests; shared `MetadataPoster` contract in `packages/shared/src/index.ts`.

**Interfaces:** Optional `posters(id, mediaType): Promise<MetadataPoster[]>` and Douban `poster(id, mediaType, photoId): Promise<MetadataPoster>`.

- [ ] Write failing tests for trusted poster paths, no-language TMDB images, media-type isolation and exact Douban owner/type checks.
- [ ] Implement bounded adapters using current caches, timeouts and fixed origins. Reject verification pages; support verified HTML listing and individually supplied photo IDs.
- [ ] Run provider tests and live read-only smoke for both Douban TV works.

### Task 2: Persistence and API

**Files:** `apps/api/src/{schema,app,validation,poster-gallery}.ts`, migration 0005 + Drizzle metadata, gallery integration tests.

**Interfaces:** The four gallery/cover routes specified by the design; shared `MoviePoster`, `MoviePosterList` contracts.

- [ ] Add RED tests for migration preservation, legacy/new cover registration, offline reads, foreign IDs, batch URL validation, deduplication/concurrency and partial failures.
- [ ] Implement additive migration, gallery service and route validation using existing image storage.
- [ ] Run gallery tests, existing API tests and typecheck; inspect migration on a clone.

### Task 3: Admin and viewer

**Files:** Existing admin detail drawer and new poster manager; viewer `DetailPoster`, its CSS and detail view's library identity.

**Interfaces:** Fetch the gallery only for the selected library detail. Admin sync/import/select uses the four API routes and refreshes its parent after successful cover selection.

- [ ] Add source album link, bounded batch photo-link input, pending/error/retry and explicit main-cover controls to the admin drawer.
- [ ] Extend the existing native-dialog lightbox with poster navigation, count and thumbnails; preserve dismissal/focus behavior and image containment.
- [ ] Verify typecheck/build and desktop/mobile keyboard behavior against the retrieved dialog/accessibility guides.

### Task 4: Integration and delivery

**Files:** Task-specific docs, tests, existing deployment scratch scripts (not tracked).

- [ ] Review tasks and final diff; resolve all material findings; run full tests/typecheck/build.
- [ ] Browser-test isolated data including setting/restoring the primary cover and reloading its gallery.
- [ ] Commit task files and push the current `codex/` branch; verify remote ref matches local commit.
- [ ] Build root-base public assets, back up production SQLite/posters, test migration on clone, extend only gallery GET proxy, atomically deploy with rollback.
- [ ] Populate verified Douban TV poster collections, preserve primary covers, and verify public galleries, 72 records, existing magnets and blocked write routes.
