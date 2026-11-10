import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import type { MovieGridList, MovieInput } from "@film-shelf/shared";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";
import { localizeExistingPosters } from "../src/localize-posters";
import { createPosterStore, LOCAL_POSTER_PATH_PATTERN, posterVariantFilename, posterVariantWidths } from "../src/posters";
import { movies } from "../src/schema";
import type { MovieMetadataProvider } from "../src/tmdb";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
const cwebp = Bun.which("cwebp");
const ffprobe = Bun.which("ffprobe");
const hasPosterEncoder = ffprobe && cwebp && Bun.spawnSync([cwebp, "-version"]).stdout.toString().split(/\s/)[0] === "1.6.0";
const sourcePoster = "https://image.tmdb.org/t/p/w500/local-poster-test.png";
const previewPoster = "/api/posters/tmdb/w500/local-poster-test.png";
const actorPhoto = "https://image.tmdb.org/t/p/w185/actor.jpg";
const metadata: MovieInput = {
  title: "本地海报电影",
  originalTitle: "Local Poster Movie",
  posterUrl: sourcePoster,
  releaseDate: "2020-01-02",
  overview: "用于验证电影海报持久保存的资料。",
  cast: [{ name: "演员", character: "角色", profileUrl: actorPhoto }],
};

function providerFor(posterUrl = sourcePoster): MovieMetadataProvider {
  return {
    configured: true,
    async search() {
      return [{ tmdbId: 550, title: metadata.title, originalTitle: metadata.originalTitle!, posterUrl, releaseDate: metadata.releaseDate!, overview: metadata.overview! }];
    },
    async details(tmdbId) { return { ...metadata, tmdbId, posterUrl }; },
  };
}

let directory: string;
let databasePath: string;
let database: ReturnType<typeof createDatabase>;
let posters: ReturnType<typeof createPosterStore>;
let app: ReturnType<typeof createApp>;
let downloads: string[];
let offline: boolean;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "film-shelf-local-posters-"));
  databasePath = join(directory, "movies.sqlite");
  database = createDatabase(databasePath);
  downloads = [];
  offline = false;
  posters = createPosterStore({
    directory: join(directory, "posters"),
    fetcher: async (input) => {
      downloads.push(String(input));
      if (offline) throw new TypeError("The image host is offline");
      return new Response(png, { headers: { "content-type": "image/png" } });
    },
  });
  app = createApp({ db: database.db, tmdb: providerFor(), posters });
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

function createMovie(body: MovieInput) {
  return app.request("/api/movies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function importMovie(tmdbId: number) {
  return app.request("/api/movies/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tmdbId }) });
}

function posterPng() {
  const width = 500;
  const height = 750;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;

  function chunk(type: string, bytes: Buffer) {
    const contents = Buffer.concat([Buffer.from(type), bytes]);
    const result = Buffer.alloc(contents.length + 8);
    result.writeUInt32BE(bytes.length, 0);
    contents.copy(result, 4);
    result.writeUInt32BE(Bun.hash.crc32(contents), result.length - 4);
    return result;
  }

  // Uncompressed grayscale rows keep the real fixture larger than each thumbnail.
  const pixels = deflateSync(Buffer.alloc((width + 1) * height), { level: 0 });
  return Buffer.concat([png.subarray(0, 8), chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", Buffer.alloc(0))]);
}

function seedExistingMovie(posterUrl = sourcePoster) {
  return database.db.insert(movies).values({
    tmdbId: 900,
    title: "已经看过的旧电影",
    originalTitle: "Existing Watched Movie",
    titleSearch: "已经看过的旧电影",
    originalTitleSearch: "existing watched movie",
    posterUrl,
    releaseDate: "2019-03-04",
    overview: "原有简介",
    cast: [{ name: "旧演员", character: "旧角色", profileUrl: actorPhoto }],
    magnetUrl: `magnet:?xt=urn:btih:${"a".repeat(40)}`,
    status: "watched",
    watchedAt: "2026-01-02T03:04:05.000Z",
    createdAt: "2025-12-01T00:00:00.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
  }).returning().get()!;
}

describe("local poster integration", () => {
  test.skipIf(!hasPosterEncoder)("both movie creation endpoints generate real WebP thumbnails and keep the original for details", async () => {
    const original = posterPng();
    const posterDirectory = join(directory, "posters");
    const manualSource = "https://image.tmdb.org/t/p/w500/manual-poster-test.png";
    const realPosters = createPosterStore({
      directory: posterDirectory,
      fetcher: async (input) => {
        downloads.push(String(input));
        return new Response(original, { headers: { "content-type": "image/png" } });
      },
    });
    app = createApp({ db: database.db, tmdb: providerFor(), posters: realPosters });

    const preview = await app.request(previewPoster);
    expect(preview.status).toBe(200);
    expect(await readdir(posterDirectory)).toEqual([expect.stringMatching(/\.png$/)]);

    const imported = await importMovie(550);
    const manual = await createMovie({ ...metadata, tmdbId: 551, posterUrl: manualSource });
    expect(imported.status).toBe(201);
    expect(manual.status).toBe(201);
    expect(downloads).toEqual([sourcePoster, manualSource]);

    const grid = await app.request("/api/movies?status=recommended&view=grid");
    const { movies: cards } = await grid.json() as MovieGridList;
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.posterVariants?.map(({ width }) => width)).toEqual([...posterVariantWidths]);
      for (const { url, width } of card.posterVariants ?? []) {
        expect(url).not.toBe(card.posterUrl);
        const response = await app.request(url);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("image/webp");
        const thumbnail = Buffer.from(await response.arrayBuffer());
        expect(thumbnail.byteLength).toBeLessThan(original.byteLength);
        const dimensions = Bun.spawnSync([ffprobe!, "-v", "error", "-show_entries", "stream=width", "-of", "csv=p=0", "pipe:0"], { stdin: thumbnail });
        expect(dimensions.exitCode).toBe(0);
        expect(Number(dimensions.stdout.toString())).toBe(width);
      }

      const detail = await app.request(`/api/movies/${card.id}`);
      const { movie } = await detail.json();
      expect(movie.posterUrl).toBe(card.posterUrl);
      const fullImage = await app.request(movie.posterUrl);
      expect(fullImage.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await fullImage.arrayBuffer())).toEqual(original);
    }
  });

  test("the grid list advertises a complete set of local variants and keeps the original for details", async () => {
    const response = await createMovie(metadata);
    const { movie } = await response.json();
    const original = LOCAL_POSTER_PATH_PATTERN.exec(movie.posterUrl)![1]!;
    const variants = posterVariantWidths.map((width) => ({ width, filename: posterVariantFilename(original, width) }));
    const writeVariant = (filename: string) => writeFile(join(directory, "posters", filename), webp);
    const grid = async () => (await app.request("/api/movies?status=recommended&view=grid")).json();

    await writeVariant(variants[0]!.filename);
    const item = { id: movie.id, title: movie.title, releaseDate: movie.releaseDate, posterUrl: movie.posterUrl };
    expect(await grid()).toEqual({
      movies: [item],
      counts: { all: 1, recommended: 1, watched: 0 },
      total: 1,
      page: 1,
      pageSize: 20,
    });

    await Promise.all(variants.slice(1).map(({ filename }) => writeVariant(filename)));
    const posterVariants = variants.map(({ width, filename }) => ({ width, url: `/api/posters/${filename}` }));
    expect((await grid()).movies).toEqual([{ ...item, posterVariants }]);
    for (const { url } of posterVariants) {
      const image = await app.request(url);
      expect(image.status).toBe(200);
      expect(image.headers.get("content-type")).toBe("image/webp");
      expect(image.headers.get("cache-control")).toContain("immutable");
    }
    expect((await (await app.request("/api/movies")).json()).movies).toEqual([movie]);
    expect((await (await app.request(`/api/movies/${movie.id}`)).json()).movie.posterUrl).toBe(movie.posterUrl);
  });

  test("search defers the download and importing the same poster reuses the downloaded file", async () => {
    const searchResponse = await app.request("/api/tmdb/search?q=电影");
    expect(searchResponse.status).toBe(200);
    const result = (await searchResponse.json()).results[0];
    expect(result.posterUrl).toBe(previewPoster);
    expect(downloads).toEqual([]);

    const preview = await app.request(result.posterUrl);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(png);
    expect(downloads).toEqual([sourcePoster]);

    const directResponse = await createMovie({ ...metadata, tmdbId: 551, posterUrl: result.posterUrl });
    expect(directResponse.status).toBe(201);
    const direct = (await directResponse.json()).movie;
    expect(direct.posterUrl).toMatch(LOCAL_POSTER_PATH_PATTERN);
    expect(direct.cast[0].profileUrl).toBe("/api/actors/image/actor.jpg");

    const importedResponse = await importMovie(550);
    expect(importedResponse.status).toBe(201);
    const imported = (await importedResponse.json()).movie;
    expect(imported.posterUrl).toBe(direct.posterUrl);
    const list = await (await app.request("/api/movies")).json();
    expect(list.total).toBe(2);
    expect(list.movies.every((movie: { posterUrl: string }) => LOCAL_POSTER_PATH_PATTERN.test(movie.posterUrl))).toBe(true);
    expect((await (await app.request(`/api/movies/${direct.id}`)).json()).movie.posterUrl).toBe(direct.posterUrl);

    offline = true;
    const imageResponse = await app.request(direct.posterUrl);
    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers.get("content-type")).toContain("image/png");
    expect(Buffer.from(await imageResponse.arrayBuffer())).toEqual(png);
    expect(downloads).toEqual([sourcePoster]);
  });

  test("a failed preview download does not delay or discard search results", async () => {
    offline = true;
    const response = await app.request("/api/tmdb/search?q=电影");
    expect(response.status).toBe(200);
    const results = (await response.json()).results;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ title: metadata.title, tmdbId: 550, posterUrl: previewPoster });
    expect(downloads).toEqual([]);
    expect((await app.request(results[0].posterUrl)).status).toBe(502);
    expect(downloads).toEqual([sourcePoster]);
    expect((await (await app.request("/api/movies")).json()).total).toBe(0);
  });

  test("search hides untrusted image URLs and the preview route rejects unapproved paths", async () => {
    app = createApp({ db: database.db, tmdb: providerFor("https://example.com/poster.png"), posters });
    const response = await app.request("/api/tmdb/search?q=电影");
    expect((await response.json()).results[0].posterUrl).toBeNull();
    for (const path of [
      "/api/posters/tmdb/arbitrary/cover.png",
      "/api/posters/tmdb/w500/cover.svg",
      "/api/posters/tmdb/w500/%2e%2e%2fsecret.png",
      "/api/posters/tmdb/w500/https%3A%2F%2Fexample.com%2Fcover.png",
    ]) expect((await app.request(path)).status).toBe(404);
    expect(downloads).toEqual([]);
  });

  test("a failed poster download prevents direct creation and TMDB import", async () => {
    offline = true;
    const direct = await createMovie({ ...metadata, tmdbId: 551 });
    expect(direct.status).toBe(502);
    expect((await direct.json()).error.message).toBeTruthy();
    const imported = await importMovie(550);
    expect(imported.status).toBe(502);
    expect((await imported.json()).error.message).toBeTruthy();
    expect((await (await app.request("/api/movies")).json()).total).toBe(0);
  });

  test("backfill replaces only the poster URL and is repeatable", async () => {
    const before = seedExistingMovie();
    const result = await localizeExistingPosters(database.db, posters);
    expect(result.migrated).toBe(1);
    const after = database.db.select().from(movies).get()!;
    expect(after.posterUrl).toMatch(LOCAL_POSTER_PATH_PATTERN);
    expect({ ...after, posterUrl: before.posterUrl }).toEqual(before);
    const priorDownloads = downloads.length;
    expect((await localizeExistingPosters(database.db, posters)).migrated).toBe(0);
    expect(downloads).toHaveLength(priorDownloads);
    const response = await app.request(after.posterUrl!);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  });

  test("failed backfill leaves the original poster and all existing data untouched", async () => {
    const before = seedExistingMovie();
    offline = true;
    await expect(localizeExistingPosters(database.db, posters)).rejects.toMatchObject({ status: 502 });
    expect(database.db.select().from(movies).get()).toEqual(before);
  });

  test("persisted posters remain available after reopening the database while offline", async () => {
    seedExistingMovie();
    await localizeExistingPosters(database.db, posters);
    const localUrl = database.db.select().from(movies).get()!.posterUrl!;
    database.close();
    database = createDatabase(databasePath);
    offline = true;
    const offlinePosters = createPosterStore({
      directory: join(directory, "posters"),
      fetcher: async () => { throw new TypeError("No network allowed after restart"); },
    });
    app = createApp({ db: database.db, tmdb: providerFor(), posters: offlinePosters });
    expect((await localizeExistingPosters(database.db, offlinePosters)).migrated).toBe(0);
    const detail = await (await app.request("/api/movies/1")).json();
    expect(detail.movie.posterUrl).toBe(localUrl);
    const image = await app.request(localUrl);
    expect(image.status).toBe(200);
    expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
    const preview = await app.request(previewPoster);
    expect(preview.status).toBe(200);
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(png);
  });
});
