import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ActorFilmography, ActorMovieList, MediaType, MovieInput } from "@film-shelf/shared";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";
import type { MetadataProvider } from "../src/metadata";
import type { PosterStore } from "../src/posters";
import { movies } from "../src/schema";
import type { MovieMetadataProvider } from "../src/tmdb";

let database: ReturnType<typeof createDatabase>;
let app: ReturnType<typeof createApp>;
let douban: MetadataProvider;
let tmdb: MovieMetadataProvider;
let imdbId: string | null;
let tmdbPersonId: number | null;
let doubanWorks: ActorFilmography;
let detailCalls: Array<[number, MediaType]>;
const personId = 1363439;
const posters: PosterStore = {
  async save(source) { return source ?? null; },
  async variants() { return undefined; },
  async ensureVariants() {},
  async respond() { return new Response(null, { status: 404 }); },
};
const remoteWork = (doubanId: number, mediaType: MediaType = "tv") => ({
  provider: "douban" as const, mediaType, doubanId, tmdbId: null,
  title: `豆瓣作品 ${doubanId}`, originalTitle: "", releaseDate: "2026-04-18", posterUrl: null,
  overview: "豆瓣简介", character: "",
});

beforeEach(() => {
  database = createDatabase(":memory:");
  imdbId = "nm3640854";
  tmdbPersonId = 42;
  detailCalls = [];
  doubanWorks = {
    actor: { doubanPersonId: personId, tmdbPersonId: null, name: "具教焕", profileUrl: null },
    movies: [remoteWork(100), remoteWork(200)],
  };
  douban = {
    configured: true,
    async search() { return []; },
    async details(id, mediaType) {
      detailCalls.push([id, mediaType]);
      return { mediaType, doubanId: id, tmdbId: null, title: "未入库的豆瓣作品", overview: "完整豆瓣简介", releaseDate: "2026-04-18",
        episodeCount: mediaType === "tv" ? 12 : null, cast: [{ doubanPersonId: personId, name: "具教焕", character: "黄东万", profileUrl: null }] };
    },
    async actor(id) {
      if (id !== personId) throw new Error("Unexpected Douban person identity");
      return { doubanPersonId: personId, name: "具教焕", profileUrl: null, imdbId };
    },
    async actorFilmography(id, mediaType) {
      if (id !== personId) throw new Error("Unexpected Douban person identity");
      return { ...doubanWorks, movies: doubanWorks.movies.map(movie => ({ ...movie, mediaType })) };
    },
  };
  tmdb = {
    configured: true,
    async search() { return []; },
    async details(id, mediaType = "movie") { return { tmdbId: id, mediaType, title: "TMDB 资料", releaseDate: "2026-04-18", episodeCount: 12 }; },
    async findByImdb(id, resource) {
      if (id !== "nm3640854" || resource !== "person") throw new Error("Unexpected IMDb namespace");
      return tmdbPersonId;
    },
    async actorFilmography(id, mediaType = "movie") {
      if (id !== 42) throw new Error("A Douban ID must never be used as a TMDB person ID");
      return {
        actor: { tmdbPersonId: 42, name: "TMDB 译名", profileUrl: null },
        movies: [{ mediaType, tmdbId: 100, title: "TMDB 参演作品", originalTitle: "", posterUrl: null,
          releaseDate: "2026-04-18", overview: "TMDB 简介", character: "主角" }],
      };
    },
  };
  app = createApp({ db: database.db, tmdb, douban, posters });
});
afterEach(() => database.close());

function seed(input: MovieInput) {
  return database.db.insert(movies).values({
    title: input.title, mediaType: input.mediaType ?? "movie", tmdbId: input.tmdbId ?? null,
    doubanId: input.doubanId ?? null, overview: input.overview ?? "", cast: input.cast ?? [],
    magnetUrl: input.magnetUrl ?? null, createdAt: "2025-01-01", updatedAt: "2025-01-01",
  }).returning().get();
}
async function actorMovies(mediaType: MediaType = "tv") {
  const response = await app.request(`/api/actors/${personId}/movies?provider=douban&mediaType=${mediaType}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<ActorMovieList>;
}

describe("Douban actor filmography", () => {
  test("uses the exact IMDb person bridge while preserving the clicked Douban actor", async () => {
    const result = await actorMovies();
    expect(result.actor).toMatchObject({ doubanPersonId: personId, tmdbPersonId: 42, name: "具教焕", profileUrl: null });
    expect(result.movies).toHaveLength(1);
    expect(result.movies[0]).toMatchObject({ tmdbId: 100, mediaType: "tv", title: "TMDB 参演作品", libraryMovieId: null, libraryStatus: null });
    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 24 });
    expect(database.db.select().from(movies).all()).toEqual([]);
  });

  test("overlays current TV library state on cached credits without confusing equal movie IDs", async () => {
    seed({ tmdbId: 100, mediaType: "movie", title: "同号电影" });
    const local = seed({ tmdbId: 100, doubanId: 37335468, mediaType: "tv", title: "本地剧名" });
    const first = await actorMovies();
    expect(first.movies[0]).toMatchObject({ libraryMovieId: local.id, libraryStatus: "recommended", title: "本地剧名" });
    expect((await app.request(`/api/movies/${local.id}/status`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "watched" }),
    })).status).toBe(200);
    const before = database.db.select().from(movies).all();
    const refreshed = await actorMovies();
    expect(refreshed.movies[0]).toMatchObject({ libraryMovieId: local.id, libraryStatus: "watched", title: "本地剧名", mediaType: "tv" });
    expect((await actorMovies("movie")).movies[0]).toMatchObject({ libraryStatus: "recommended", title: "同号电影", mediaType: "movie" });
    expect(database.db.select().from(movies).all()).toEqual(before);
  });

  for (const reason of ["missing IMDb", "no exact TMDB match"] as const) {
    test(`falls back to Douban works for ${reason} and matches library by provider identity`, async () => {
      if (reason === "missing IMDb") imdbId = null;
      else tmdbPersonId = null;
      seed({ tmdbId: 200, mediaType: "tv", title: "同号 TMDB 作品" });
      const local = seed({ doubanId: 100, mediaType: "tv", title: "本地豆瓣剧集" });
      const first = await actorMovies();
      expect(first.actor).toMatchObject({ doubanPersonId: personId, tmdbPersonId: null, name: "具教焕" });
      expect(first.movies[0]).toMatchObject({ provider: "douban", doubanId: 100, libraryMovieId: local.id, libraryStatus: "recommended", title: "本地豆瓣剧集" });
      expect(first.movies[1]).toMatchObject({ doubanId: 200, tmdbId: null, libraryMovieId: null, libraryStatus: null });
      await app.request(`/api/movies/${local.id}/status`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "watched" }),
      });
      expect((await actorMovies()).movies[0]!.libraryStatus).toBe("watched");
    });
  }

  for (const failingService of ["identity lookup", "filmography"] as const) {
    test(`keeps Douban actor works available after a TMDB ${failingService} error`, async () => {
      if (failingService === "identity lookup") tmdb.findByImdb = async () => { throw new Error("TMDB lookup unavailable"); };
      else tmdb.actorFilmography = async () => { throw new Error("TMDB credits unavailable"); };
      const result = await actorMovies();
      expect(result.actor).toMatchObject({ doubanPersonId: personId, tmdbPersonId: null, name: "具教焕" });
      expect(result.movies.map(movie => movie.doubanId)).toEqual([100, 200]);
      expect(result.total).toBe(2);
    });
  }

  for (const route of ["import", "manual"] as const) {
    test(`links a future Douban ${route} entry so the existing TMDB actor route reflects its live library status`, async () => {
      const identityCalls: Array<[number, MediaType]> = [];
      const lookupCalls: Array<[string, MediaType | "person"]> = [];
      douban.imdbId = async (id, mediaType) => { identityCalls.push([id, mediaType]); return "tt36732944"; };
      tmdb.findByImdb = async (id, resource) => {
        lookupCalls.push([id, resource]);
        if (id === "tt36732944" && resource === "tv") return 100;
        throw new Error("Work identities must use the exact resource namespace");
      };
      const body = route === "import"
        ? { provider: "douban", mediaType: "tv", externalId: 37335468 }
        : { mediaType: "tv", doubanId: 37335468, title: "手动保存的豆瓣剧集", releaseDate: "2026-04-18", episodeCount: 12, cast: [{ doubanPersonId: personId, name: "具教焕", character: "黄东万", profileUrl: null }] };
      const response = await app.request(route === "import" ? "/api/movies/import" : "/api/movies", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      expect(response.status).toBe(201);
      const local = (await response.json()).movie;
      expect(local).toMatchObject({ mediaType: "tv", tmdbId: 100, doubanId: 37335468, status: "recommended",
        cast: [{ doubanPersonId: personId, name: "具教焕", character: "黄东万" }] });
      expect(identityCalls).toEqual([[37335468, "tv"]]);
      expect(lookupCalls).toEqual([["tt36732944", "tv"]]);
      const legacyRoute = "/api/actors/42/movies?mediaType=tv";
      const first = await app.request(legacyRoute);
      expect(first.status).toBe(200);
      expect((await first.json()).movies[0]).toMatchObject({ tmdbId: 100, libraryMovieId: local.id, libraryStatus: "recommended", title: local.title });
      expect((await app.request(`/api/movies/${local.id}/status`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "watched" }),
      })).status).toBe(200);
      const refreshed = await app.request(legacyRoute);
      expect(refreshed.status).toBe(200);
      expect((await refreshed.json()).movies[0]).toMatchObject({ libraryMovieId: local.id, libraryStatus: "watched" });
    });
  }

  test("rejects an invalid actor provider before contacting metadata services", async () => {
    let upstreamCalls = 0;
    const unexpected = async (): Promise<never> => { upstreamCalls++; throw new Error("No upstream request expected"); };
    douban.actor = unexpected;
    douban.actorFilmography = unexpected;
    tmdb.findByImdb = unexpected;
    tmdb.actorFilmography = unexpected;
    const response = await app.request(`/api/actors/${personId}/movies?provider=unknown&mediaType=tv`);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(upstreamCalls).toBe(0);
  });

  test("does not mark a same-number Douban movie as a collected TV series", async () => {
    imdbId = null;
    seed({ doubanId: 100, mediaType: "movie", title: "另一个类型的电影" });
    const result = await actorMovies();
    expect(result.movies[0]).toMatchObject({ doubanId: 100, mediaType: "tv", title: "豆瓣作品 100", libraryMovieId: null, libraryStatus: null });
  });

  test("paginates fallback credits without mutating shared provider results", async () => {
    imdbId = null;
    const response = await app.request(`/api/actors/${personId}/movies?provider=douban&mediaType=tv&page=2&pageSize=1`);
    expect(response.status).toBe(200);
    const result = await response.json() as ActorMovieList;
    expect(result).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(result.movies.map(movie => movie.doubanId)).toEqual([200]);
    expect(doubanWorks.movies.every(movie => !("libraryMovieId" in movie))).toBe(true);
  });
});

describe("read-only Douban catalog", () => {
  test("opens remote details without adding library records", async () => {
    const response = await app.request("/api/catalog/douban/tv/37335468");
    expect(response.status).toBe(200);
    expect((await response.json()).movie).toMatchObject({ mediaType: "tv", doubanId: 37335468,
      title: "未入库的豆瓣作品", overview: "完整豆瓣简介", episodeCount: 12, libraryMovieId: null,
      libraryStatus: null, magnetUrl: null, watchedAt: null, cast: [{ doubanPersonId: personId, name: "具教焕" }] });
    expect(database.db.select().from(movies).all()).toEqual([]);
    expect(detailCalls).toEqual([[37335468, "tv"]]);
  });

  test("prefers complete local details and preserves all stored fields", async () => {
    const local = seed({ doubanId: 37335468, mediaType: "tv", title: "本地标题", overview: "本地简介",
      magnetUrl: `magnet:?xt=urn:btih:${"a".repeat(40)}`, cast: [{ doubanPersonId: personId, name: "具教焕", character: "本地角色", profileUrl: null }] });
    const before = database.db.select().from(movies).all();
    const response = await app.request("/api/catalog/douban/tv/37335468");
    expect(response.status).toBe(200);
    expect((await response.json()).movie).toMatchObject({ libraryMovieId: local.id, libraryStatus: "recommended",
      title: "本地标题", overview: "本地简介", magnetUrl: local.magnetUrl, cast: local.cast });
    expect(detailCalls).toEqual([]);
    expect(database.db.select().from(movies).all()).toEqual(before);
  });

  test("keeps remote movie and TV catalog identities separate", async () => {
    seed({ doubanId: 37335468, mediaType: "movie", title: "同号电影" });
    const response = await app.request("/api/catalog/douban/tv/37335468");
    expect(response.status).toBe(200);
    expect((await response.json()).movie).toMatchObject({ mediaType: "tv", libraryMovieId: null, title: "未入库的豆瓣作品" });
    expect(database.db.select().from(movies).all()).toHaveLength(1);
  });
});
