# Personal Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add editable personal reviews and import the user's 23 existing diary texts into the matching films.

**Architecture:** Add one nullable SQLite column and a dedicated private PATCH route. Pass saved text through local and catalog detail responses, render it using existing detail styles, and edit it in the existing admin drawer.

**Tech Stack:** Existing Bun workspace, Hono TypeScript, Drizzle/SQLite, React/React Router and shadcn dashboard.

**Spec:** `docs/superpowers/specs/2026-11-12-personal-reviews-design.md`

## Global Constraints

- Preserve every nonblank review verbatim, including whitespace and line breaks; maximum 20000 characters.
- Empty string, whitespace-only input and null clear the field to null; same-value PATCH is a no-op.
- Keep movie IDs, metadata, magnets, posters, watchedAt and watchedOrder intact.
- User-facing heading and admin label: `我的观后感`.
- Public API access remains read-only; do not expose PATCH through Nginx.
- No extra dependencies, menus, scores, public comments or file watcher.
- Keep diary text and personal library data out of Git.

## Review Focus

- Wrong-film import: explicit immutable IDs and provider identities; validate all 23 before any write (Task 3).
- Original text altered: compare exact Chinese, emoji and line breaks after PATCH/reopen (Task 1).
- Actor-origin navigation drops review: exercise saved and unsaved catalog routes for movie/TV and both providers (Task 1).
- Clearing leaves a visible empty block: verify hide behavior and successful admin clear in browser (Task 2/3).
- Upgrade changes old data or homepage payload grows: migration preservation and grid projection assertions (Task 1/3).

### Task 1: Persistence, API and contracts

**Files:** `apps/api/src/schema.ts`, `apps/api/src/validation.ts`, `apps/api/src/app.ts`, `apps/api/drizzle/0006_*`, `apps/api/drizzle/meta/*`, `packages/shared/src/index.ts`, `apps/api/tests/personal-review.test.ts`, related migration regression tests.

**Interfaces:** Produce `Movie.personalReview: string | null`, add it to `MovieDetailData`, expose `PATCH /api/movies/:id/personal-review` with `{ personalReview: string | null }` and `{ movie: Movie }` response. MovieInput/provider metadata remain unchanged.

- [x] Write meaningful API and upgrade tests covering the Global Constraints and source-detail/grid boundaries.
- [x] Run the new tests and record expected missing-feature failure.
- [x] Add schema/migration, validation and route; propagate local value or null through catalog details.
- [x] Update legacy SELECT-star migration assertions to preserve all original fields while asserting the new field is null.
- [x] Run focused API/migration tests and report exact commands and results.

### Task 2: Existing admin and viewer integration

**Files:** `apps/admin/src/components/movie-detail-dialog.tsx`, `apps/admin/src/App.tsx`, `apps/web/src/pages/MovieDetailView.tsx`, existing web detail styles only if needed, `README.md`.

**Interfaces:** Consume Task 1 contract. Add `personalReview` to the admin save callback field union and use its dedicated PATCH route. The admin uses a multiline native textarea consistent with existing shadcn inputs and an explicit `保存观后感` button.

- [x] Render a conditional `我的观后感` section directly after the synopsis using escaped plain text and existing pre-wrap typography.
- [x] Add admin editor save/clear/error/pending behavior; update selected film, table data and correct save feedback.
- [x] Update README usage/API documentation for personal review maintenance.
- [x] Run workspace typechecks/build; root performs browser save/clear and responsive checks with temporary QA records.

### Task 3: Review, release and one-time import

**Files:** Task-scoped scratch under `/Users/yxswy/Documents/Codex/2026-11-06/w/work/personal-review-2026-11-12/`; no diary content in tracked files.

**Interfaces:** Consume Task 1 PATCH route, 23 nonempty entries from `mapping/diary-mapping-preview.json`; confirmed alias `八仙 -> movie 9 八仙！`.

- [x] Independently review backend and frontend diffs; fix material findings.
- [x] Run `bun test`, `bun run typecheck`, `bun run build`; verify admin edit/clear and detail visibility using isolated QA data.
- [x] Back up current production SQLite; apply migration to a clone and compare all preexisting columns and poster records.
- [x] Build and stage a release from current deployed code, preserving environment/runtime dependencies, media symlink and Nginx restrictions; activate atomically with rollback.
- [x] Revalidate all 23 diary-to-film identities and source hash; import only nonempty reviews via loopback API, then compare every body exactly and verify all other fields/order unchanged.
- [x] Check public details, actor-origin details, homepage grid and public write rejection. Capture representative desktop/mobile screenshots.
