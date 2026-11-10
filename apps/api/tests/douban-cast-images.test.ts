import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { CastMember, MovieInput } from "@film-shelf/shared";
import { backfillDoubanCastImages, localizeCastImages } from "../src/cast-images";
import { createDatabase } from "../src/db";
import type { MetadataProvider } from "../src/metadata";
import { createPosterStore, type PosterStore } from "../src/posters";
import { movies } from "../src/schema";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const source = "https://img1.doubanio.com/view/personage/m/public/actor-one.jpg";
const local = `/api/posters/${"a".repeat(64)}.jpg`;
let directory: string;
let database: ReturnType<typeof createDatabase>;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "film-shelf-cast-images-"));
  database = createDatabase(join(directory, "movies.sqlite"));
});
afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

function provider(details: MetadataProvider["details"]): MetadataProvider {
  return { configured: true, async search() { return []; }, details };
}

function store(save: PosterStore["save"]): PosterStore {
  return {
    save,
    async ensureVariants() {},
    async variants() { return undefined; },
    async respond() { return new Response(null); },
  };
}

function seed(cast: CastMember[], doubanId: number | null = 37335468) {
  return database.db.insert(movies).values({
    title: "旧韩剧",
    doubanId,
    mediaType: "tv",
    episodeCount: 12,
    cast,
    status: "watched",
    watchedAt: "2026-11-09T10:20:30.000Z",
    watchedOrder: 8,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    magnetUrl: `magnet:?xt=urn:btih:${"b".repeat(40)}`,
  }).returning().get()!;
}

test("saves only trusted Douban photos locally, retaining other cast fields and offline image access", async () => {
  const downloads: string[] = [];
  const photoDirectory = join(directory, "photos");
  const posters = createPosterStore({
    directory: photoDirectory,
    fetcher: async (input) => {
      downloads.push(String(input));
      return new Response(png, { headers: { "Content-Type": "image/png" } });
    },
  });
  const cast: CastMember[] = [
    { name: "演员甲", character: "角色", tmdbPersonId: 99, profileUrl: source },
    { name: "演员乙", character: "", profileUrl: null },
    { name: "演员丙", character: "", profileUrl: local },
    { name: "演员丁", character: "", profileUrl: "https://image.tmdb.org/t/p/w185/person.jpg" },
    { name: "演员戊", character: "", profileUrl: "https://img1.doubanio.com.evil.test/view/personage/m/public/person.jpg" },
  ];
  const result = await localizeCastImages(cast, posters);
  const cached = result[0]!.profileUrl!;
  expect(cached).toMatch(/^\/api\/posters\/[a-f0-9]{64}\.png$/);
  expect(result[0]).toEqual({ ...cast[0]!, profileUrl: cached });
  expect(result.slice(1)).toEqual(cast.slice(1));
  expect(cast[0]!.profileUrl).toBe(source);
  expect(downloads).toEqual([source]);
  expect(await readdir(photoDirectory)).toEqual([cached.split("/").at(-1)!]);
  const offline = createPosterStore({ directory: photoDirectory, fetcher: async () => { throw new Error("offline"); } });
  const image = await offline.respond(cached.split("/").at(-1)!);
  expect(image.status).toBe(200);
  expect(image.headers.get("Content-Type")).toBe("image/png");
  expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
});

test("downloads in bounded batches of four and retains failed photo sources for retry", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const posters = store(async (url) => {
    calls++;
    maximum = Math.max(maximum, ++active);
    await gate;
    active--;
    if (url === source) throw new Error("temporary image failure");
    return local;
  });
  const cast = Array.from({ length: 10 }, (_, index) => ({
    name: `演员${index}`, character: "", profileUrl: index === 0 ? source : source.replace("actor-one", `actor-${index}`),
  }));
  const pending = localizeCastImages(cast, posters);
  expect(calls).toBe(4);
  release();
  const result = await pending;
  expect(calls).toBe(10);
  expect(maximum).toBe(4);
  expect(result[0]!.profileUrl).toBe(source);
  expect(result.slice(1).every((actor) => actor.profileUrl === local)).toBe(true);
  const retried = await localizeCastImages(result, store(async () => local));
  expect(retried.every((actor) => actor.profileUrl === local)).toBe(true);
});

test("backfills exact unambiguous names while preserving cast order and all existing viewing metadata", async () => {
  const cast: CastMember[] = [
    { name: "演员甲", character: "保留角色", tmdbPersonId: 55, profileUrl: null },
    { name: "演员乙", character: "", profileUrl: local },
    { name: "同名演员", character: "配角", profileUrl: null },
    { name: "未匹配演员", character: "", profileUrl: null },
  ];
  const movie = seed(cast);
  const tmdbMovie = seed([{ name: "演员甲", character: "", profileUrl: null }], null);
  const downloads: string[] = [];
  let calls = 0;
  const douban = provider(async (id, mediaType) => {
    calls++;
    expect([id, mediaType]).toEqual([movie.doubanId!, "tv"]);
    return {
      doubanId: id, mediaType, title: "新标题不应覆盖",
      cast: [
        { name: "演员乙", character: "不同角色", profileUrl: source },
        { name: "同名演员", character: "", profileUrl: source },
        { name: "演员甲", character: "不同角色", tmdbPersonId: 999, profileUrl: source },
        { name: "同名演员", character: "", profileUrl: source.replace("actor-one", "another") },
        { name: "新增演员", character: "", profileUrl: source },
      ],
    };
  });
  const posters = store(async (url) => { downloads.push(url!); return local; });
  expect(await backfillDoubanCastImages(database.db, posters, douban)).toEqual({ updated: 1 });
  const saved = database.db.select().from(movies).where(eq(movies.id, movie.id)).get()!;
  expect(saved).toEqual({ ...movie, cast: [{ ...cast[0]!, profileUrl: local }, ...cast.slice(1)] });
  expect(database.db.select().from(movies).where(eq(movies.id, tmdbMovie.id)).get()).toEqual(tmdbMovie);
  expect(downloads).toEqual([source]);
  expect(await backfillDoubanCastImages(database.db, posters, douban)).toEqual({ updated: 0 });
  expect(calls).toBe(2);
  expect(downloads).toEqual([source]);
});

test("retries an existing raw photo without refetching metadata and tolerates individual failures", async () => {
  const movie = seed([{ name: "演员甲", character: "角色", profileUrl: source }]);
  let attempts = 0;
  const posters = store(async () => {
    if (++attempts === 1) throw new Error("offline");
    return local;
  });
  const noMetadata = provider(async () => { throw new Error("metadata must not be fetched"); });
  expect(await backfillDoubanCastImages(database.db, posters, noMetadata)).toEqual({ updated: 0 });
  expect(database.db.select().from(movies).get()).toEqual(movie);
  expect(await backfillDoubanCastImages(database.db, posters, noMetadata)).toEqual({ updated: 1 });
  expect(database.db.select().from(movies).get()).toEqual({ ...movie, cast: [{ ...movie.cast[0]!, profileUrl: local }] });
  expect(await backfillDoubanCastImages(database.db, posters, noMetadata)).toEqual({ updated: 0 });
  expect(attempts).toBe(2);
});

test("does not overwrite a concurrent cast edit while photos are being saved", async () => {
  const movie = seed([{ name: "演员甲", character: "原角色", profileUrl: null }]);
  const concurrent = [{ name: "演员甲", character: "人工修改角色", profileUrl: null }];
  const douban = provider(async (id, mediaType): Promise<MovieInput> => ({
    doubanId: id, mediaType, title: movie.title,
    cast: [{ name: "演员甲", character: "", profileUrl: source }],
  }));
  const posters = store(async () => {
    database.db.update(movies).set({ cast: concurrent }).where(eq(movies.id, movie.id)).run();
    return local;
  });
  expect(await backfillDoubanCastImages(database.db, posters, douban)).toEqual({ updated: 0 });
  expect(database.db.select().from(movies).get()).toEqual({ ...movie, cast: concurrent });
});

test("rejects mismatched metadata identity and can retry an unavailable provider later", async () => {
  const movie = seed([{ name: "演员甲", character: "", profileUrl: null }]);
  let calls = 0;
  const douban = provider(async (id, mediaType) => {
    calls++;
    if (calls === 1) throw new Error("provider unavailable");
    return { doubanId: id + 1, mediaType, title: "另一部作品", cast: [{ name: "演员甲", character: "", profileUrl: source }] };
  });
  const posters = store(async () => { throw new Error("must not download mismatched actor"); });
  expect(await backfillDoubanCastImages(database.db, posters, douban)).toEqual({ updated: 0 });
  expect(await backfillDoubanCastImages(database.db, posters, douban)).toEqual({ updated: 0 });
  expect(database.db.select().from(movies).get()).toEqual(movie);
});
