import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ActorMovieList, CatalogMovieDetails, Movie, MovieInput, SearchMovie } from "@film-shelf/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";
import { ApiException } from "../src/errors";
import { createPosterStore } from "../src/posters";
import { movies } from "../src/schema";
import { createTmdbProvider, type MovieMetadataProvider } from "../src/tmdb";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const actor = { tmdbPersonId: 42, name: "测试演员", profileUrl: "https://image.tmdb.org/t/p/w185/person-42.jpg" };
const cover = (id: number) => `https://image.tmdb.org/t/p/w500/movie-${id}.png`;
const preview = (id: number) => `/api/posters/tmdb/w500/movie-${id}.png`;
const remoteMovie = (tmdbId: number): SearchMovie & { character: string } => ({
  tmdbId, title: `远程电影 ${tmdbId}`, originalTitle: `Movie ${tmdbId}`, posterUrl: cover(tmdbId),
  releaseDate: "2024-02-01", overview: "远程简介", character: "主角",
});

let directory: string;
let database: ReturnType<typeof createDatabase>;
let app: ReturnType<typeof createApp>;
let posters: ReturnType<typeof createPosterStore>;
let downloads: string[];
let failedCovers: Set<string>;
let filmography: Array<SearchMovie & { character: string }>;
let detailCalls: number[];
let actorCalls: number[];
let actorFailure: ApiException | undefined;
let detail: MovieInput;
let provider: MovieMetadataProvider;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "film-shelf-filmography-"));
  database = createDatabase(":memory:");
  downloads = [];
  failedCovers = new Set();
  filmography = [remoteMovie(11), remoteMovie(22), remoteMovie(33)];
  detailCalls = [];
  actorCalls = [];
  actorFailure = undefined;
  detail = {
    tmdbId: 77, title: "片库以外的电影", originalTitle: "An Uncollected Movie", posterUrl: cover(77),
    releaseDate: "2020-03-04", overview: "尚未加入片库的作品简介",
    cast: [{ tmdbPersonId: 42, name: actor.name, character: "主角", profileUrl: actor.profileUrl }],
  };
  provider = {
    configured: true,
    async search() { return []; },
    async details(id) { detailCalls.push(id); return detail; },
    async actorFilmography(id) {
      actorCalls.push(id);
      if (actorFailure) throw actorFailure;
      return { actor, movies: filmography };
    },
  };
  posters = createPosterStore({ directory, fetcher: async (url) => {
    const source = String(url);
    downloads.push(source);
    if (failedCovers.has(source)) throw new TypeError("Image unavailable in test");
    return new Response(png, { headers: { "content-type": "image/png" } });
  } });
  app = createApp({ db: database.db, tmdb: provider, posters });
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

function request(path: string, body?: unknown, method = "POST") {
  return app.request(path, body === undefined ? undefined : {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

async function add(input: MovieInput): Promise<Movie> {
  const response = await request("/api/movies", input);
  expect(response.status).toBe(201);
  return (await response.json()).movie;
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = await response.json();
  expect(body.error).toMatchObject({ code });
  expect(typeof body.error.message).toBe("string");
  expect(body.error.message.length).toBeGreaterThan(0);
  expect(body.movies).toBeUndefined();
}

describe("actor filmography and read-only catalog", () => {
  test("overlays current library status and local titles/covers even when the remote filmography is cached", async () => {
    const recommended = await add({ tmdbId: 11, title: "本地修订片名", posterUrl: "https://image.tmdb.org/t/p/w500/local-11.png" });
    const watched = await add({ tmdbId: 22, title: "本地已观看电影", posterUrl: null });
    await request(`/api/movies/${watched.id}/status`, { status: "watched" }, "PATCH");
    let remoteRequests = 0;
    const cachedProvider = createTmdbProvider("test-token", (async () => {
      remoteRequests++;
      return Response.json({ id: 42, name: actor.name, profile_path: "/person-42.jpg", movie_credits: {
        cast: filmography.map(movie => ({ id: movie.tmdbId, title: movie.title, original_title: movie.originalTitle,
          poster_path: `/movie-${movie.tmdbId}.png`, release_date: movie.releaseDate, overview: movie.overview, character: movie.character })),
        crew: [],
      } });
    }) as unknown as typeof fetch);
    app = createApp({ db: database.db, tmdb: cachedProvider, posters });
    downloads = [];
    const before = database.db.select().from(movies).all();

    const response = await request("/api/actors/42/movies");
    expect(response.status).toBe(200);
    const first = await response.json() as ActorMovieList;
    expect(first).toMatchObject({ total: 3, page: 1, pageSize: 24, actor: { ...actor, profileUrl: "/api/actors/image/person-42.jpg" } });
    expect(first.movies.find(movie => movie.tmdbId === 11)).toMatchObject({ title: recommended.title, posterUrl: recommended.posterUrl, libraryMovieId: recommended.id, libraryStatus: "recommended" });
    expect(first.movies.find(movie => movie.tmdbId === 22)).toMatchObject({ title: watched.title, posterUrl: null, libraryMovieId: watched.id, libraryStatus: "watched" });
    const uncollected = first.movies.find(movie => movie.tmdbId === 33)!;
    expect(uncollected).toMatchObject({ libraryMovieId: null, libraryStatus: null });
    expect(uncollected.posterUrl).toBe(preview(33));
    expect(downloads).toEqual([]);
    expect(database.db.select().from(movies).all()).toEqual(before);

    expect((await request(`/api/movies/${recommended.id}/status`, { status: "watched" }, "PATCH")).status).toBe(200);
    const afterStatusChange = database.db.select().from(movies).all();
    const refreshed = await (await request("/api/actors/42/movies")).json() as ActorMovieList;
    expect(refreshed.movies.find(movie => movie.tmdbId === 11)!.libraryStatus).toBe("watched");
    expect(remoteRequests).toBe(1);
    expect(database.db.select().from(movies).all()).toEqual(afterStatusChange);
  });

  test("paginates the full filmography and downloads only covers individually requested by the client", async () => {
    filmography = [11, 22, 33, 44, 55].map(remoteMovie);
    filmography[1]!.posterUrl = null;
    failedCovers.add(cover(33));
    const page2 = await (await request("/api/actors/42/movies?page=2&pageSize=2")).json() as ActorMovieList;
    expect(page2).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(page2.movies.map(movie => movie.tmdbId)).toEqual([33, 44]);
    expect(page2.movies.map(movie => movie.posterUrl)).toEqual([preview(33), preview(44)]);
    const page1 = await (await request("/api/actors/42/movies?page=1&pageSize=2")).json() as ActorMovieList;
    expect(page1.movies.map(movie => movie.tmdbId)).toEqual([11, 22]);
    expect(page1.movies.map(movie => movie.posterUrl)).toEqual([preview(11), null]);
    const empty = await (await request("/api/actors/42/movies?page=9&pageSize=2")).json() as ActorMovieList;
    expect(empty).toMatchObject({ total: 5, page: 9, pageSize: 2, movies: [] });
    expect(downloads).toEqual([]);
    expect((await request(page2.movies[0]!.posterUrl!)).status).toBe(502);
    expect((await request(page2.movies[1]!.posterUrl!)).status).toBe(200);
    expect(downloads).toEqual([cover(33), cover(44)]);
    expect(database.db.select().from(movies).all()).toEqual([]);
  });

  test("opens uncollected movie details with local images and actor IDs without inserting a library record", async () => {
    const response = await request("/api/catalog/movies/77");
    expect(response.status).toBe(200);
    const movie = (await response.json()).movie as CatalogMovieDetails;
    expect(movie).toMatchObject({ tmdbId: 77, title: detail.title, originalTitle: detail.originalTitle,
      overview: detail.overview, releaseDate: detail.releaseDate, libraryMovieId: null, libraryStatus: null, magnetUrl: null, watchedAt: null });
    expect(movie.posterUrl).toBe(preview(77));
    expect(movie.cast).toEqual([{ ...detail.cast![0]!, profileUrl: "/api/actors/image/person-42.jpg" }]);
    expect(downloads).toEqual([]);
    const poster = await request(movie.posterUrl!);
    expect(poster.status).toBe(200);
    expect(Buffer.from(await poster.arrayBuffer())).toEqual(png);
    expect(downloads).toEqual([cover(77)]);
    expect(database.db.select().from(movies).all()).toEqual([]);
    expect((await request("/api/catalog/movies/77")).status).toBe(200);
    expect(database.db.select().from(movies).all()).toEqual([]);
    expect(detailCalls).toEqual([77, 77]);
  });

  test("keeps uncollected movie details available when only the poster download fails", async () => {
    failedCovers.add(cover(77));
    const response = await request("/api/catalog/movies/77");
    expect(response.status).toBe(200);
    const movie = (await response.json()).movie as CatalogMovieDetails;
    expect(movie).toMatchObject({
      ...detail,
      posterUrl: preview(77),
      cast: [{ ...detail.cast![0]!, profileUrl: "/api/actors/image/person-42.jpg" }],
      magnetUrl: null,
      watchedAt: null,
      libraryMovieId: null,
      libraryStatus: null,
    });
    expect(downloads).toEqual([]);
    expect((await request(movie.posterUrl!)).status).toBe(502);
    expect(downloads).toEqual([cover(77)]);
    expect(database.db.select().from(movies).all()).toEqual([]);
  });

  test("uses a collected movie's complete local details and magnet without requesting TMDB", async () => {
    const magnetUrl = `magnet:?xt=urn:btih:${"a".repeat(40)}`;
    const saved = await add({ tmdbId: 77, title: "本地片名", overview: "本地简介", posterUrl: cover(77), magnetUrl,
      cast: [{ tmdbPersonId: 42, name: actor.name, character: "本地角色", profileUrl: actor.profileUrl }] });
    const patched = await (await request(`/api/movies/${saved.id}/status`, { status: "watched" }, "PATCH")).json();
    const before = database.db.select().from(movies).all();
    downloads = [];
    const response = await request("/api/catalog/movies/77");
    expect(response.status).toBe(200);
    expect((await response.json()).movie).toMatchObject({ tmdbId: 77, libraryMovieId: saved.id,
      libraryStatus: "watched", title: saved.title, overview: saved.overview, posterUrl: saved.posterUrl,
      magnetUrl, watchedAt: patched.movie.watchedAt, cast: saved.cast });
    expect(detailCalls).toEqual([]);
    expect(downloads).toEqual([]);
    expect(database.db.select().from(movies).all()).toEqual(before);
  });

  test("validates actor/catalog IDs, pagination, and optional positive person IDs before querying remote metadata", async () => {
    for (const id of ["0", "-1", "1.5", "abc", "9007199254740992"]) {
      await expectError(await request(`/api/actors/${id}/movies`), 400, "VALIDATION_ERROR");
      await expectError(await request(`/api/catalog/movies/${id}`), 400, "VALIDATION_ERROR");
    }
    for (const query of ["page=0", "page=1.5", "page=1000001", "pageSize=0", "pageSize=101"]) {
      await expectError(await request(`/api/actors/42/movies?${query}`), 400, "VALIDATION_ERROR");
    }
    for (const id of [0, -1, "42", 1.5]) {
      await expectError(await request("/api/movies", { title: "无效演员 ID", cast: [{ tmdbPersonId: id, name: "演员", character: "角色", profileUrl: null }] }), 400, "VALIDATION_ERROR");
    }
    const saved = await add({ title: "兼容旧演员信息", cast: [
      { tmdbPersonId: 42, name: "已知演员", character: "主角", profileUrl: null },
      { tmdbPersonId: null, name: "未知演员", character: "配角", profileUrl: null },
      { name: "旧数据演员", character: "配角", profileUrl: null },
    ] });
    expect(saved.cast.map(person => person.tmdbPersonId)).toEqual([42, null, undefined]);
    expect(actorCalls).toEqual([]);
    expect(detailCalls).toEqual([]);
    expect(downloads).toEqual([]);
  });

  test("reports missing configuration, unsupported providers, upstream failures and invalid details instead of an empty filmography", async () => {
    actorFailure = new ApiException(404, "TMDB_PERSON_NOT_FOUND", "没有找到演员。");
    await expectError(await request("/api/actors/42/movies"), 404, "TMDB_PERSON_NOT_FOUND");
    actorFailure = new ApiException(502, "TMDB_UNAVAILABLE", "远程服务暂时不可用。");
    await expectError(await request("/api/actors/42/movies"), 502, "TMDB_UNAVAILABLE");
    const { actorFilmography: _unused, ...unsupportedProvider } = provider;
    app = createApp({ db: database.db, tmdb: unsupportedProvider, posters });
    await expectError(await request("/api/actors/42/movies"), 503, "METADATA_UNAVAILABLE");
    let called = false;
    app = createApp({ db: database.db, tmdb: createTmdbProvider("", (async () => { called = true; throw new Error("No network expected"); }) as unknown as typeof fetch), posters });
    await expectError(await request("/api/actors/42/movies"), 503, "TMDB_NOT_CONFIGURED");
    expect(called).toBe(false);

    app = createApp({ db: database.db, tmdb: provider, posters });
    for (const invalid of [
      { ...detail, tmdbId: 78 },
      { ...detail, title: "" },
      { ...detail, cast: [{ tmdbPersonId: 0, name: "演员", character: "角色", profileUrl: null }] },
    ]) {
      detail = invalid;
      await expectError(await request("/api/catalog/movies/77"), 502, "TMDB_INVALID_RESPONSE");
    }
    expect(downloads).toEqual([]);
    expect(database.db.select().from(movies).all()).toEqual([]);
  });
});
