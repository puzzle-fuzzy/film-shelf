import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { MediaType } from "@film-shelf/shared";
import { createApp } from "../src/app";
import { createDatabase, migrationsFolder } from "../src/db";
import type { PosterStore } from "../src/posters";

const review = "  第一段：保留标点。\r\n\n第二段 <script>alert('text')</script> 与 é / e\u0301。\n  ";
const oldTimestamp = "2020-03-04T00:00:00.000Z";
const magnetUrl = `magnet:?xt=urn:btih:${"a".repeat(40)}`;
const posterUrl = `/api/posters/${"b".repeat(64)}.jpg`;
const posters: PosterStore = {
  async save(source) { return source ?? null; },
  async variants() { return undefined; }, async ensureVariants() {},
  async respond() { return new Response(null, { status: 404 }); },
};
let database: ReturnType<typeof createDatabase>;
let app: ReturnType<typeof createApp>;
let metadataCalls: number;

function makeApp(db: ReturnType<typeof createDatabase>["db"]) {
  return createApp({ db, posters,
    tmdb: { configured: true, async search() { return []; },
      async details(id, mediaType: MediaType = "movie") { metadataCalls++; return { tmdbId: id, mediaType, title: "远程作品", episodeCount: mediaType === "tv" ? 10 : null }; },
      async actorFilmography(_id, mediaType: MediaType = "movie") { return { actor: { tmdbPersonId: 1, name: "演员", profileUrl: null }, movies: [{ tmdbId: 100, mediaType, title: "远程作品", originalTitle: "", posterUrl: null, releaseDate: null, overview: "", character: "主角" }] }; },
    },
    douban: { configured: true, async search() { return []; },
      async details(id, mediaType) { metadataCalls++; return { doubanId: id, mediaType, title: "远程作品", episodeCount: mediaType === "tv" ? 10 : null }; },
    },
  });
}
const request = (path: string, body?: unknown, method = "POST", target = app) => target.request(path, body === undefined ? undefined : {
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
async function addMovie(mediaType: MediaType = "movie", identity = {}) {
  const response = await request("/api/movies", { mediaType, title: "本地作品", originalTitle: "Original", posterUrl, releaseDate: "2001-02-03", overview: "原有简介", cast: [{ name: "演员", character: "主角", profileUrl: null }], magnetUrl, ...(mediaType === "tv" ? { episodeCount: 16 } : {}), ...identity });
  expect(response.status).toBe(201);
  return (await response.json()).movie;
}
const save = (id: number, personalReview: unknown) => request(`/api/movies/${id}/personal-review`, { personalReview }, "PATCH");
const rawMovie = (id: number) => database.sqlite.prepare("SELECT * FROM movies WHERE id = ?").get(id) as Record<string, unknown>;

beforeEach(() => { database = createDatabase(":memory:"); metadataCalls = 0; app = makeApp(database.db); });
afterEach(() => database.close());

describe("personal reviews", () => {
  for (const mediaType of ["movie", "tv"] as const) {
    test(`round-trips and replaces verbatim ${mediaType} reviews while preserving every unrelated field`, async () => {
      const created = await addMovie(mediaType);
      expect(created.personalReview).toBeNull();
      await request(`/api/movies/${created.id}/status`, { status: "watched" }, "PATCH");
      database.sqlite.prepare("UPDATE movies SET updated_at = ? WHERE id = ?").run(oldTimestamp, created.id);
      const before = rawMovie(created.id);
      for (const text of [review, "\t覆盖后的正文\n\n "]) {
        const response = await save(created.id, text);
        expect(response.status).toBe(200);
        const edited = (await response.json()).movie;
        expect(edited.personalReview).toBe(text);
        expect(edited.updatedAt).not.toBe(oldTimestamp);
        expect((await (await request(`/api/movies/${created.id}`)).json()).movie.personalReview).toBe(text);
        expect((await (await request("/api/movies")).json()).movies[0].personalReview).toBe(text);
        const { personal_review, updated_at, ...unchanged } = rawMovie(created.id);
        const { personal_review: _review, updated_at: _updated, ...original } = before;
        expect(personal_review).toBe(text);
        expect(unchanged).toEqual(original);
      }
      expect(metadataCalls).toBe(0);
    });
  }

  test("unchanged saves and already-empty clears preserve updatedAt exactly", async () => {
    const movie = await addMovie();
    for (const text of [null, review]) {
      expect((await save(movie.id, text)).status).toBe(200);
      database.sqlite.prepare("UPDATE movies SET updated_at = ? WHERE id = ?").run(oldTimestamp, movie.id);
      const before = rawMovie(movie.id);
      const repeated = await save(movie.id, text);
      expect(repeated.status).toBe(200);
      expect((await repeated.json()).movie.updatedAt).toBe(oldTimestamp);
      expect(rawMovie(movie.id)).toEqual(before);
    }
    await save(movie.id, null);
    database.sqlite.prepare("UPDATE movies SET updated_at = ? WHERE id = ?").run(oldTimestamp, movie.id);
    for (const blank of ["", " \r\n\t\u3000 "]) {
      const cleared = await save(movie.id, blank);
      expect(cleared.status).toBe(200);
      expect((await cleared.json()).movie).toMatchObject({ personalReview: null, updatedAt: oldTimestamp });
    }
  });

  test("null, empty text and whitespace clear saved reviews without changing watched state or ordering", async () => {
    const first = await addMovie();
    const second = await addMovie();
    for (const movie of [first, second]) await request(`/api/movies/${movie.id}/status`, { status: "watched" }, "PATCH");
    const before = rawMovie(first.id);
    for (const blank of [null, "", " \r\n\t\u3000 "]) {
      expect((await save(first.id, review)).status).toBe(200);
      const response = await save(first.id, blank);
      expect(response.status).toBe(200);
      expect((await response.json()).movie.personalReview).toBeNull();
      const { personal_review, updated_at, ...unchanged } = rawMovie(first.id);
      const { personal_review: _review, updated_at: _updated, ...original } = before;
      expect(personal_review).toBeNull();
      expect(unchanged).toEqual(original);
    }
    const watched = await (await request("/api/movies?status=watched")).json();
    expect(watched.movies.map((movie: { id: number }) => movie.id)).toEqual([second.id, first.id]);
  });

  test("accepts 20000 characters and rejects malformed, extra, oversized and missing values without writes", async () => {
    const movie = await addMovie();
    const maximum = "字".repeat(20000);
    const accepted = await save(movie.id, maximum);
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).movie.personalReview).toBe(maximum);
    const before = rawMovie(movie.id);
    for (const body of [{}, { personalReview: 1 }, { personalReview: false }, { personalReview: [] }, { personalReview: {} }, { personalReview: "x".repeat(20001) }, { personalReview: " ".repeat(20001) }, { personalReview: review, extra: true }, { personalReview: review, status: "watched" }]) {
      const response = await request(`/api/movies/${movie.id}/personal-review`, body, "PATCH");
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
      expect(rawMovie(movie.id)).toEqual(before);
    }
    const malformed = await app.request(`/api/movies/${movie.id}/personal-review`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{" });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe("INVALID_JSON");
    expect((await save(999, review)).status).toBe(404);
    for (const id of ["0", "-1", "abc", "9007199254740992"]) expect((await request(`/api/movies/${id}/personal-review`, { personalReview: review }, "PATCH")).status).toBe(400);
    expect(rawMovie(movie.id)).toEqual(before);
  });

  test("does not accept personal text in movie creation, provider metadata or import inputs", async () => {
    expect((await request("/api/movies", { title: "禁止注入", personalReview: review })).status).toBe(400);
    expect((await request("/api/movies/import", { tmdbId: 100, personalReview: review })).status).toBe(400);
    const contaminated = createApp({ db: database.db, posters, tmdb: { configured: true, async search() { return []; }, async details(id) { return { tmdbId: id, title: "远程作品", personalReview: review }; } } });
    expect((await request("/api/movies/import", { tmdbId: 100 }, "POST", contaminated)).status).toBe(502);
    expect((await (await request("/api/movies")).json()).total).toBe(0);
  });

  for (const source of ["tmdb", "douban"] as const) for (const mediaType of ["movie", "tv"] as const) {
    test(`${source} ${mediaType} catalog uses the saved review and returns null for uncollected entries`, async () => {
      const movie = await addMovie(mediaType, source === "tmdb" ? { tmdbId: 100 } : { doubanId: 100 });
      expect((await save(movie.id, review)).status).toBe(200);
      const base = `/api/catalog/${source === "douban" ? "douban/" : ""}${mediaType === "movie" ? "movies" : "tv"}`;
      const saved = await app.request(`${base}/100`);
      expect(saved.status).toBe(200);
      expect((await saved.json()).movie).toMatchObject({ personalReview: review, libraryMovieId: movie.id, title: "本地作品" });
      expect(metadataCalls).toBe(0);
      const missing = await app.request(`${base}/101`);
      expect(missing.status).toBe(200);
      expect((await missing.json()).movie).toMatchObject({ personalReview: null, libraryMovieId: null, title: "远程作品" });
      expect(metadataCalls).toBe(1);
      expect((await (await request("/api/movies")).json()).total).toBe(1);
    });
  }

  test("grid and actor filmography omit saved review text", async () => {
    const movie = await addMovie("movie", { tmdbId: 100 });
    expect((await save(movie.id, review)).status).toBe(200);
    const grid = await (await request("/api/movies?view=grid")).json();
    expect(grid.movies[0]).toMatchObject({ id: movie.id, title: "本地作品" });
    expect(grid.movies[0]).not.toHaveProperty("personalReview");
    expect(grid.movies[0]).not.toHaveProperty("overview");
    const actor = await (await request("/api/actors/1/movies")).json();
    expect(actor.movies[0].libraryMovieId).toBe(movie.id);
    expect(actor.movies[0]).not.toHaveProperty("personalReview");
  });
});

test("additive review migration preserves all legacy fields, gallery and order, then persists text after reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "film-shelf-personal-review-"));
  const path = join(directory, "library.sqlite");
  const legacyFolder = join(directory, "legacy");
  mkdirSync(join(legacyFolder, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"));
  const entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 6);
  writeFileSync(join(legacyFolder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const entry of entries) copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(legacyFolder, `${entry.tag}.sql`));
  const legacy = new Database(path);
  let original: Record<string, unknown>[];
  let originalPosters: unknown[];
  try {
    migrate(drizzle({ client: legacy }), { migrationsFolder: legacyFolder });
    const insert = legacy.prepare("INSERT INTO movies (id, tmdb_id, douban_id, media_type, episode_count, title, title_search, original_title, original_title_search, poster_url, release_date, overview, cast, magnet_url, status, watched_at, watched_order, created_at, updated_at) VALUES (?, 100, ?, ?, ?, '旧作品', '旧作品', 'Legacy', 'legacy', ?, '2001-02-03', '保留简介', ?, ?, 'watched', ?, ?, '2019-01-01', ?)");
    insert.run(41, 888, "movie", null, posterUrl, JSON.stringify([{ name: "演员", character: "主角", profileUrl: null }]), magnetUrl, oldTimestamp, 9, oldTimestamp);
    insert.run(42, 889, "tv", 16, null, "[]", null, oldTimestamp, 10, oldTimestamp);
    legacy.prepare("INSERT INTO movie_posters (movie_id, url, created_at) VALUES (?, ?, ?)").run(41, posterUrl, oldTimestamp);
    original = legacy.prepare("SELECT * FROM movies ORDER BY id").all() as Record<string, unknown>[];
    originalPosters = legacy.prepare("SELECT * FROM movie_posters ORDER BY id").all();
  } finally { legacy.close(true); }
  let upgraded = createDatabase(path);
  try {
    const rows = upgraded.sqlite.prepare("SELECT * FROM movies ORDER BY id").all();
    expect(rows).toEqual(original!.map((row) => ({ ...row, personal_review: null })));
    expect(upgraded.sqlite.prepare("SELECT * FROM movie_posters ORDER BY id").all()).toEqual(originalPosters!);
    const migratedApp = makeApp(upgraded.db);
    const response = await request("/api/movies/42/personal-review", { personalReview: review }, "PATCH", migratedApp);
    expect(response.status).toBe(200);
    upgraded.close();
    upgraded = createDatabase(path);
    const reopened = makeApp(upgraded.db);
    const detail = await (await request("/api/movies/42", undefined, "GET", reopened)).json();
    expect(detail.movie).toMatchObject({ id: 42, personalReview: review, overview: "保留简介", status: "watched", watchedAt: oldTimestamp, episodeCount: 16 });
    const after = upgraded.sqlite.prepare("SELECT * FROM movies ORDER BY id").all() as Record<string, unknown>[];
    expect(after[0]).toEqual({ ...original![0], personal_review: null });
    const { personal_review, updated_at, ...otherFields } = after[1]!;
    const { updated_at: _updated, ...originalFields } = original![1]!;
    expect(personal_review).toBe(review);
    expect(otherFields).toEqual(originalFields);
    expect(upgraded.sqlite.prepare("SELECT * FROM movie_posters ORDER BY id").all()).toEqual(originalPosters!);
    const watched = await (await request("/api/movies?status=watched", undefined, "GET", reopened)).json();
    expect(watched.movies.map((movie: { id: number }) => movie.id)).toEqual([42, 41]);
  } finally { upgraded.close(); rmSync(directory, { recursive: true, force: true }); }
});
