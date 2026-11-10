import { afterEach, beforeEach, expect, test } from "bun:test";
import type { MediaType, MovieInput } from "@film-shelf/shared";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";
import type { PosterStore } from "../src/posters";

const cover = "https://img2.doubanio.com/view/photo/l/public/p2891113171.jpg";
const localCover = `/api/posters/${"d".repeat(64)}.jpg`;
const drama: MovieInput = { mediaType: "tv", doubanId: 27602137, title: "我的大叔", originalTitle: "나의 아저씨", releaseDate: "2018-03-21", episodeCount: 16, posterUrl: cover, overview: "两个人相互理解的故事", cast: [{ name: "李知恩", character: "", profileUrl: null }] };
let database: ReturnType<typeof createDatabase>;
let detailsCalls: Array<[number, MediaType]>;
const posters: PosterStore = {
  async save(source) { return source ? localCover : null; },
  async variants() { return undefined; }, async ensureVariants() {},
  async respond() { return new Response(null, { status: 404 }); },
};
function makeApp(doubanDetails: (id: number, type: MediaType) => Promise<MovieInput> = async () => drama, posterStore: PosterStore = posters) {
  return createApp({ db: database.db, posters: posterStore,
    tmdb: { configured: false, async search() { return []; }, async details(id, type: MediaType = "movie") { return { tmdbId: id, mediaType: type, title: type === "tv" ? "TMDB 电视剧" : "TMDB 电影", episodeCount: type === "tv" ? 10 : null }; },
      async actorFilmography(_person, type: MediaType = "movie") { return { actor: { tmdbPersonId: 1, name: "演员", profileUrl: null }, movies: [{ mediaType: type, tmdbId: 100, title: "远程作品", originalTitle: "", posterUrl: null, overview: "", releaseDate: null, character: "角色" }] }; } },
    douban: { configured: true, async search(_query: string, type: MediaType) { return [{ provider: "douban" as const, mediaType: type, externalId: 27602137, title: "我的大叔", originalTitle: "", posterUrl: cover, overview: "", releaseDate: "2018-03-21", year: "2018", countries: ["韩国"] }]; },
      async details(id: number, type: MediaType) { detailsCalls.push([id, type]); return doubanDetails(id, type); } },
  });
}
function post(app: ReturnType<typeof createApp>, body: unknown, path = "/api/movies/import", method = "POST") {
  return app.request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => { database = createDatabase(":memory:"); detailsCalls = []; });
afterEach(() => database.close());

test("Douban search works without a TMDB token and exposes only local preview URLs", async () => {
  const app = makeApp();
  const health = await (await app.request("/api/health")).json();
  expect(health).toMatchObject({ tmdbConfigured: false, providers: { tmdb: false, douban: true } });
  const response = await app.request("/api/metadata/search?provider=douban&mediaType=tv&q=我的大叔");
  expect(response.status).toBe(200);
  const item = (await response.json()).results[0];
  expect(item).toMatchObject({ provider: "douban", mediaType: "tv", externalId: 27602137, year: "2018", countries: ["韩国"] });
  expect(item.posterUrl.startsWith("/api/posters/")).toBe(true);
  expect(detailsCalls).toEqual([]);
});

test("imports a Douban TV entry with local cover, identity, episodes and names, rejecting duplicates before fetching", async () => {
  const app = makeApp();
  const body = { provider: "douban", mediaType: "tv", externalId: 27602137 };
  const response = await post(app, body);
  expect(response.status).toBe(201);
  const movie = (await response.json()).movie;
  expect(movie).toMatchObject({ ...drama, tmdbId: null, posterUrl: localCover, status: "recommended", watchedAt: null });
  expect((await post(app, body)).status).toBe(409);
  expect(detailsCalls).toEqual([[27602137, "tv"]]);
  const detail = (await (await app.request(`/api/movies/${movie.id}`)).json()).movie;
  expect(detail.cast[0]).not.toHaveProperty("tmdbPersonId");
  expect(detail.episodeCount).toBe(16);
});

test("old TMDB import remains movie-only while same-number TV imports and duplicate checks are isolated", async () => {
  const app = makeApp();
  const film = await post(app, { tmdbId: 100 });
  expect(film.status).toBe(201);
  const filmData = (await film.json()).movie;
  expect(filmData).toMatchObject({ tmdbId: 100, mediaType: "movie", doubanId: null, episodeCount: null });
  const tv = await post(app, { provider: "tmdb", mediaType: "tv", externalId: 100 });
  expect(tv.status).toBe(201);
  expect((await tv.json()).movie).toMatchObject({ mediaType: "tv", title: "TMDB 电视剧", episodeCount: 10 });
  expect((await post(app, { tmdbId: 100 })).status).toBe(409);
  expect((await post(app, { provider: "tmdb", mediaType: "tv", externalId: 100 })).status).toBe(409);
});

test("media filtering scopes rows and counts but counts stay independent of name search", async () => {
  const app = makeApp();
  await post(app, { title: "电影" }, "/api/movies");
  await post(app, { title: "剧集甲", mediaType: "tv", episodeCount: 16 }, "/api/movies");
  const second = await post(app, { title: "剧集乙", mediaType: "tv" }, "/api/movies");
  const secondId = (await second.json()).movie.id;
  await post(app, { status: "watched" }, `/api/movies/${secondId}/status`, "PATCH");
  const list = await (await app.request("/api/movies?mediaType=tv&q=甲&view=grid")).json();
  expect(list.total).toBe(1);
  expect(list.counts).toEqual({ all: 2, recommended: 1, watched: 1 });
  expect(list.movies[0]).toMatchObject({ mediaType: "tv", title: "剧集甲" });
  expect((await (await app.request("/api/movies")).json()).total).toBe(3);
});

test("actor library status and read-only catalogs never confuse movie and TV IDs", async () => {
  const app = makeApp();
  await post(app, { tmdbId: 100 });
  const tv = (await (await post(app, { provider: "tmdb", mediaType: "tv", externalId: 100 })).json()).movie;
  await post(app, { status: "watched" }, `/api/movies/${tv.id}/status`, "PATCH");
  const films = await (await app.request("/api/actors/1/movies")).json();
  const shows = await (await app.request("/api/actors/1/movies?mediaType=tv")).json();
  expect(films.movies[0]).toMatchObject({ title: "TMDB 电影", libraryStatus: "recommended", mediaType: "movie" });
  expect(shows.movies[0]).toMatchObject({ title: "TMDB 电视剧", libraryStatus: "watched", mediaType: "tv" });
  expect((await (await app.request("/api/catalog/movies/100")).json()).movie.mediaType).toBe("movie");
  expect((await (await app.request("/api/catalog/tv/100")).json()).movie.libraryMovieId).toBe(tv.id);
  const missing = await app.request("/api/catalog/tv/101");
  expect(missing.status).toBe(200);
  expect((await missing.json()).movie).toMatchObject({ mediaType: "tv", libraryMovieId: null, episodeCount: 10 });
  expect((await (await app.request("/api/movies")).json()).total).toBe(2);
});

test("mismatched source IDs and types cannot write or download a poster", async () => {
  let downloads = 0;
  for (const bad of [{ ...drama, mediaType: "movie" as const }, { ...drama, doubanId: 1 }]) {
    const app = makeApp(async () => bad, { ...posters, async save(source) { downloads++; return posters.save(source); } });
    expect((await post(app, { provider: "douban", mediaType: "tv", externalId: 27602137 })).status).toBe(502);
  }
  expect((await (await makeApp().request("/api/movies")).json()).total).toBe(0);
  expect(downloads).toBe(0);
});

test("Douban movies and same-number TMDB movies keep separate source identities", async () => {
  const app = makeApp(async (id, mediaType) => ({ ...drama, doubanId: id, mediaType, episodeCount: mediaType === "tv" ? 16 : null }));
  const imported = await post(app, { provider: "douban", mediaType: "movie", externalId: 100 });
  expect(imported.status).toBe(201);
  expect((await imported.json()).movie).toMatchObject({ doubanId: 100, tmdbId: null, mediaType: "movie", episodeCount: null });
  expect((await post(app, { tmdbId: 100 })).status).toBe(201);
  expect((await post(app, { provider: "douban", mediaType: "movie", externalId: 100 })).status).toBe(409);
  expect((await (await app.request("/api/movies")).json()).total).toBe(2);
});

test("validates explicit source/type identities and new fields without remote calls", async () => {
  const app = makeApp();
  for (const body of [{ provider: "unknown", mediaType: "tv", externalId: 1 }, { provider: "douban", mediaType: "book", externalId: 1 }, { provider: "douban", mediaType: "tv", externalId: -1 }, { provider: "douban", externalId: 1 }, { tmdbId: 100, provider: "douban", mediaType: "tv", externalId: 100 }]) expect((await post(app, body)).status).toBe(400);
  for (const body of [{ title: "剧", mediaType: "invalid" }, { title: "剧", mediaType: "tv", episodeCount: 0 }, { title: "剧", doubanId: -2 }, { title: "电影", episodeCount: 2 }]) expect((await post(app, body, "/api/movies")).status).toBe(400);
  for (const path of ["/api/metadata/search?provider=bad&mediaType=tv&q=x", "/api/metadata/search?provider=douban&mediaType=bad&q=x", "/api/movies?mediaType=bad", "/api/actors/1/movies?mediaType=bad"]) expect((await app.request(path)).status).toBe(400);
  expect(detailsCalls).toEqual([]);
});
