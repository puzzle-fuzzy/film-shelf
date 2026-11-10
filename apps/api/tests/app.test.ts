import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MovieInput, SearchMovie } from "@film-shelf/shared";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";
import type { MovieMetadataProvider } from "../src/tmdb";
import type { PosterStore } from "../src/posters";

const metadata: MovieInput = {
  tmdbId: 550,
  title: "搏击俱乐部",
  originalTitle: "Fight Club",
  releaseDate: "1999-10-15",
  posterUrl: "https://image.tmdb.org/t/p/w500/test.jpg",
  overview: "一部测试电影的简介。",
  cast: [{ name: "Brad Pitt", character: "Tyler Durden", profileUrl: null }],
};

const provider: MovieMetadataProvider = {
  configured: true,
  async search(): Promise<SearchMovie[]> {
    return [{ tmdbId: 550, title: metadata.title, originalTitle: metadata.originalTitle!, posterUrl: metadata.posterUrl!, releaseDate: metadata.releaseDate!, overview: metadata.overview! }];
  },
  async details() { return metadata; },
};

const posters: PosterStore = {
  async variants() { return undefined; },
  async ensureVariants() {},
  async save(source) { return source ? `/api/posters/${"0".repeat(64)}.jpg` : null; },
  async respond() { return new Response(null, { status: 404 }); },
};

let database: ReturnType<typeof createDatabase>;
let app: ReturnType<typeof createApp>;
const request = (path: string, body?: unknown, method = "POST") => app.request(path, body === undefined ? undefined : {
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  database = createDatabase(":memory:");
  app = createApp({ db: database.db, tmdb: provider, posters });
});
afterEach(() => database.close());

describe("movie workflow with real SQLite and stubbed TMDB", () => {
  test("imports metadata, prevents duplicates, changes status and filters with global counts", async () => {
    const search = await request("/api/tmdb/search?q=搏击俱乐部");
    expect(search.status).toBe(200);
    expect((await search.json()).results[0].tmdbId).toBe(550);

    const imported = await request("/api/movies/import", { tmdbId: 550 });
    expect(imported.status).toBe(201);
    const { movie } = await imported.json();
    expect(movie.status).toBe("recommended");
    expect(movie.cast).toEqual(metadata.cast);
    expect(movie.watchedAt).toBeNull();
    expect((await request("/api/movies/import", { tmdbId: 550 })).status).toBe(409);

    const changed = await request(`/api/movies/${movie.id}/status`, { status: "watched" }, "PATCH");
    expect(changed.status).toBe(200);
    const watched = (await changed.json()).movie;
    expect(watched.status).toBe("watched");
    expect(watched.watchedAt).toBeTruthy();
    const sameStatus = await request(`/api/movies/${movie.id}/status`, { status: "watched" }, "PATCH");
    expect((await sameStatus.json()).movie.watchedAt).toBe(watched.watchedAt);

    const recommended = await request("/api/movies?status=recommended");
    const recommendedList = await recommended.json();
    expect(recommendedList.total).toBe(0);
    expect(recommendedList.counts).toEqual({ all: 1, recommended: 0, watched: 1 });
    const list = await (await request("/api/movies?status=watched&q=搏击")).json();
    expect(list.movies[0].id).toBe(movie.id);
    expect(list.total).toBe(1);
    const detail = await (await request(`/api/movies/${movie.id}`)).json();
    expect(detail.movie.overview).toBe(metadata.overview);

    const restored = await request(`/api/movies/${movie.id}/status`, { status: "recommended" }, "PATCH");
    expect((await restored.json()).movie.watchedAt).toBeNull();
  });

  test("allows Codex to enter metadata without an external token", async () => {
    app = createApp({ db: database.db, tmdbToken: "", posters });
    const created = await request("/api/movies", { title: "手动录入的电影", overview: "已核实的资料" });
    expect(created.status).toBe(201);
    const movie = (await created.json()).movie;
    expect(movie.tmdbId).toBeNull();
    expect(movie.status).toBe("recommended");
    const health = await (await request("/api/health")).json();
    expect(health.tmdbConfigured).toBe(false);
    const unavailable = await request("/api/tmdb/search?q=电影");
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).error.message).toBeTruthy();
  });

  test("rejects invalid input and keeps the database unchanged", async () => {
    for (const input of [{}, { title: " " }, { title: "电影", releaseDate: "2026-02-30" }, { title: "电影", posterUrl: "javascript:alert(1)" }]) {
      expect((await request("/api/movies", input)).status).toBe(400);
    }
    for (const path of ["/api/movies?status=bad", "/api/movies?page=0", "/api/movies?pageSize=999", "/api/movies/invalid", "/api/tmdb/search?q="]) {
      expect((await request(path)).status).toBe(400);
    }
    expect((await request("/api/movies/import", { tmdbId: -1 })).status).toBe(400);
    const malformed = await app.request("/api/movies", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.message).toBeTruthy();
    expect((await (await request("/api/movies")).json()).total).toBe(0);
    expect((await request("/api/movies/999/status", { status: "watched" }, "PATCH")).status).toBe(404);
    expect((await request("/api/movies/999/status", { status: "invalid" }, "PATCH")).status).toBe(400);
  });

  test("pagination stays stable when creation timestamps match", async () => {
    for (let index = 0; index < 3; index++) await request("/api/movies", { title: `影片 ${index}` });
    const first = await (await request("/api/movies?page=1&pageSize=2")).json();
    const second = await (await request("/api/movies?page=2&pageSize=2")).json();
    expect(first.movies).toHaveLength(2);
    expect(second.movies).toHaveLength(1);
    expect(first.total).toBe(3);
    expect(new Set([...first.movies, ...second.movies].map((movie: { id: number }) => movie.id)).size).toBe(3);
  });
});

test("SQLite migrations are repeatable and movie data persists after reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "film-shelf-test-"));
  const path = join(directory, "movies.sqlite");
  let stored = createDatabase(path);
  try {
    const writer = createApp({ db: stored.db, tmdb: provider, posters });
    const response = await writer.request("/api/movies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(metadata) });
    expect(response.status).toBe(201);
    stored.close();
    stored = createDatabase(path);
    const reader = createApp({ db: stored.db, tmdb: provider, posters });
    const list = await (await reader.request("/api/movies")).json();
    expect(list.total).toBe(1);
    expect(list.movies[0].title).toBe(metadata.title);
  } finally {
    stored.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
