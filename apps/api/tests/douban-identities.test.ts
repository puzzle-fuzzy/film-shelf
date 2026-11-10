import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MediaType, MovieInput } from "@film-shelf/shared";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db";
import { backfillDoubanMovieIdentities, resolveDoubanMovieIdentity } from "../src/douban-identities";
import type { MetadataProvider } from "../src/metadata";
import { movies } from "../src/schema";
import type { MovieMetadataProvider } from "../src/tmdb";

let database: ReturnType<typeof createDatabase>;
let douban: MetadataProvider;
let tmdb: MovieMetadataProvider;
let imdbCalls: Array<[number, MediaType]>;
let findCalls: Array<[string, MediaType | "person"]>;
const input: MovieInput = {
  doubanId: 27602137, tmdbId: null, mediaType: "tv", title: "我的大叔", originalTitle: "나의 아저씨",
  releaseDate: "2018-03-21", episodeCount: 16, overview: "保留豆瓣简介", posterUrl: null,
  cast: [{ doubanPersonId: 1312852, name: "李知恩", character: "", profileUrl: null }],
};

beforeEach(() => {
  database = createDatabase(":memory:");
  imdbCalls = [];
  findCalls = [];
  douban = {
    configured: true,
    async search() { return []; },
    async details(id, mediaType) { return { doubanId: id, mediaType, title: "豆瓣作品" }; },
    async imdbId(id, mediaType) { imdbCalls.push([id, mediaType]); return "tt7923710"; },
  };
  tmdb = {
    configured: true,
    async search() { return []; },
    async details(id, mediaType = "movie") { return { tmdbId: id, mediaType, title: "TMDB 作品", releaseDate: input.releaseDate, episodeCount: input.episodeCount }; },
    async findByImdb(id, resource) { findCalls.push([id, resource]); return 76662; },
  };
});
afterEach(() => database.close());

describe("exact IMDb work identities", () => {
  test("adds only a unique TMDB identity and preserves the complete Douban input", async () => {
    const original = structuredClone(input);
    expect(await resolveDoubanMovieIdentity(input, douban, tmdb)).toEqual({ ...original, tmdbId: 76662 });
    expect(input).toEqual(original);
    expect(imdbCalls).toEqual([[27602137, "tv"]]);
    expect(findCalls).toEqual([["tt7923710", "tv"]]);
  });

  test("passes movie identity separately from the same-number TV identity", async () => {
    expect(await resolveDoubanMovieIdentity({ ...input, mediaType: "movie" }, douban, tmdb)).toMatchObject({ tmdbId: 76662, mediaType: "movie" });
    expect(findCalls).toEqual([["tt7923710", "movie"]]);
  });

  test("keeps entries with no exact mapping or an unavailable upstream unchanged", async () => {
    const variants: MetadataProvider[] = [
      { ...douban, async imdbId() { return null; } },
      { ...douban, async imdbId() { throw new Error("Douban temporarily unavailable"); } },
    ];
    for (const provider of variants) expect(await resolveDoubanMovieIdentity(input, provider, tmdb)).toEqual(input);
    expect(await resolveDoubanMovieIdentity(input, douban, { ...tmdb, async findByImdb() { return null; } })).toEqual(input);
    expect(await resolveDoubanMovieIdentity(input, douban, { ...tmdb, async findByImdb() { throw new Error("TMDB temporarily unavailable"); } })).toEqual(input);
  });

  test("does not replace existing IDs or query unavailable identity services", async () => {
    const unavailable = { ...tmdb, configured: false };
    for (const [candidate, service] of [
      [{ ...input, doubanId: null }, tmdb],
      [{ ...input, tmdbId: 88 }, tmdb],
      [input, unavailable],
    ] as const) expect(await resolveDoubanMovieIdentity(candidate, douban, service)).toEqual(candidate);
    const { imdbId: _imdb, ...noImdbSupport } = douban;
    const { findByImdb: _find, ...noFindSupport } = tmdb;
    expect(await resolveDoubanMovieIdentity(input, noImdbSupport, tmdb)).toEqual(input);
    expect(await resolveDoubanMovieIdentity(input, douban, noFindSupport)).toEqual(input);
    expect(imdbCalls).toEqual([]);
    expect(findCalls).toEqual([]);
  });

  test("does not turn a separately tracked Douban season into the TMDB whole series", async () => {
    expect(await resolveDoubanMovieIdentity({ ...input, releaseDate: "2020-03-21" }, douban, tmdb)).toEqual({ ...input, releaseDate: "2020-03-21" });
    expect(await resolveDoubanMovieIdentity(input, douban, { ...tmdb, async details(id) {
      return { tmdbId: id, mediaType: "tv", title: "包含多季的整剧", releaseDate: input.releaseDate, episodeCount: 32 };
    } })).toEqual(input);
    expect(await resolveDoubanMovieIdentity({ ...input, episodeCount: null }, douban, tmdb)).toEqual({ ...input, episodeCount: null });
  });
});

function seed(values: Partial<typeof movies.$inferInsert> & { title: string }) {
  return database.db.insert(movies).values({ createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-02-01T00:00:00.000Z", ...values }).returning().get();
}

describe("existing Douban library identity backfill", () => {
  test("changes only missing IDs, preserves ordering and fields, and skips same-type conflicts", async () => {
    seed({ title: "豆瓣剧集", doubanId: 27602137, mediaType: "tv", episodeCount: 16,
      releaseDate: "2018-03-21",
      originalTitle: "나의 아저씨", titleSearch: "豆瓣剧集", overview: "自定义简介", cast: input.cast,
      status: "watched", watchedAt: "2024-01-02T00:00:00.000Z", watchedOrder: 7,
      magnetUrl: `magnet:?xt=urn:btih:${"a".repeat(40)}` });
    seed({ title: "不同类型允许同号", doubanId: 901, mediaType: "movie" });
    seed({ title: "已有同型 TMDB 条目", mediaType: "tv", tmdbId: 76663 });
    seed({ title: "冲突的豆瓣条目", doubanId: 902, mediaType: "tv", releaseDate: input.releaseDate, episodeCount: input.episodeCount });
    seed({ title: "保留现有映射", doubanId: 903, mediaType: "tv", tmdbId: 44 });
    seed({ title: "手工条目", mediaType: "tv" });
    douban.imdbId = async id => id === 902 ? "tt90200" : "tt7923710";
    tmdb.findByImdb = async id => id === "tt90200" ? 76663 : 76662;
    const before = database.db.select().from(movies).orderBy(movies.id).all();

    expect(await backfillDoubanMovieIdentities(database.db, douban, tmdb)).toEqual({ updated: 2 });
    const after = database.db.select().from(movies).orderBy(movies.id).all();
    expect(after).toEqual(before.map((row, index) => index < 2 ? { ...row, tmdbId: 76662 } : row));
    expect(await backfillDoubanMovieIdentities(database.db, douban, tmdb)).toEqual({ updated: 0 });
    expect(database.db.select().from(movies).orderBy(movies.id).all()).toEqual(after);
  });

  for (const change of ["doubanId", "mediaType", "tmdbId"] as const) {
    test(`does not overwrite a row whose ${change} changes during the remote lookup`, async () => {
      const local = seed({ title: "并发更新", doubanId: 27602137, mediaType: "tv", releaseDate: input.releaseDate, episodeCount: input.episodeCount });
      const mutation = change === "doubanId" ? { doubanId: 999 } : change === "mediaType" ? { mediaType: "movie" as const } : { tmdbId: 55 };
      douban.imdbId = async () => {
        database.db.update(movies).set(mutation).where(eq(movies.id, local.id)).run();
        return "tt7923710";
      };
      expect(await backfillDoubanMovieIdentities(database.db, douban, tmdb)).toEqual({ updated: 0 });
      expect(database.db.select().from(movies).where(eq(movies.id, local.id)).get()).toEqual({ ...local, ...mutation });
    });
  }
});
