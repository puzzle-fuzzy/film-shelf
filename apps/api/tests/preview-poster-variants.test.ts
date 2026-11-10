import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import type { ActorMovieList } from "@film-shelf/shared";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";
import { createPosterStore, localPosterUrl, posterVariantFilename, posterVariantWidths, type PosterStore } from "../src/posters";
import type { MovieMetadataProvider } from "../src/tmdb";

const tmdbSource = "https://image.tmdb.org/t/p/w500/uncollected.png";
const doubanSource = "https://img2.doubanio.com/view/photo/l/public/p2891113171.jpg";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
const cwebp = Bun.which("cwebp");
const ffprobe = Bun.which("ffprobe");
const hasPosterEncoder = ffprobe && cwebp && Bun.spawnSync([cwebp, "-version"]).stdout.toString().split(/\s/)[0] === "1.6.0";
let directory: string;

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "film-shelf-preview-variants-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

function posterPng() {
  const width = 500;
  const height = 750;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  const chunk = (type: string, bytes: Buffer) => {
    const contents = Buffer.concat([Buffer.from(type), bytes]);
    const result = Buffer.alloc(contents.length + 8);
    result.writeUInt32BE(bytes.length, 0);
    contents.copy(result, 4);
    result.writeUInt32BE(Bun.hash.crc32(contents), result.length - 4);
    return result;
  };
  return Buffer.concat([png.subarray(0, 8), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.alloc((width + 1) * height), { level: 0 })), chunk("IEND", Buffer.alloc(0))]);
}

function filmographyProvider(posterUrl = tmdbSource): MovieMetadataProvider {
  return {
    configured: true,
    async search() { return []; },
    async details() { return { tmdbId: 11, title: "未入库电影", posterUrl }; },
    async actorFilmography() {
      return {
        actor: { tmdbPersonId: 42, name: "演员", profileUrl: null },
        movies: [{ tmdbId: 11, title: "未入库电影", originalTitle: "", posterUrl, releaseDate: "2024-01-01", overview: "", character: "主角" }],
      };
    },
  };
}

describe("cached preview poster variants", () => {
  test("TMDB and Douban preview aliases find persisted thumbnails after restarting offline", async () => {
    const store = createPosterStore({ directory, fetcher: async () => new Response(png, { headers: { "Content-Type": "image/png" } }) });
    for (const source of [tmdbSource, doubanSource]) {
      const preview = localPosterUrl(source)!;
      const files = await readdir(directory);
      expect(await store.variants(preview)).toBeUndefined();
      expect(await readdir(directory)).toEqual(files);
      const local = (await store.save(preview))!;
      const original = local.split("/").at(-1)!;
      const variants = posterVariantWidths.map(width => ({ url: `/api/posters/${posterVariantFilename(original, width)}`, width }));
      await Promise.all(variants.map(variant => writeFile(join(directory, variant.url.split("/").at(-1)!), webp)));

      const offline = createPosterStore({ directory, fetcher: async () => { throw new Error("Images must remain local after restart"); } });
      expect(await offline.variants(preview)).toEqual(variants);
      for (const variant of (await offline.variants(preview))!) {
        const response = await offline.respond(variant.url.split("/").at(-1)!);
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("image/webp");
        expect(response.headers.get("Cache-Control")).toContain("immutable");
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(webp);
      }
      expect(Buffer.from(await (await offline.respond(original)).arrayBuffer())).toEqual(png);
    }
  });

  test("actor listing only discovers existing thumbnails without downloading or generating images", async () => {
    const db = createDatabase(":memory:");
    const downloads: string[] = [];
    const store = createPosterStore({ directory, fetcher: async (source) => {
      downloads.push(String(source));
      return new Response(png, { headers: { "Content-Type": "image/png" } });
    } });
    const generation: string[] = [];
    const posters: PosterStore = { ...store, async ensureVariants(source) { generation.push(source || ""); await store.ensureVariants(source); } };
    const app = createApp({ db: db.db, posters, tmdb: filmographyProvider() });
    try {
      const before = await (await app.request("/api/actors/42/movies")).json() as ActorMovieList;
      expect(before.movies[0]!.posterVariants).toBeUndefined();
      expect(downloads).toEqual([]);
      expect(generation).toEqual([]);
      expect(await readdir(directory)).toEqual([]);

      const local = (await store.save(tmdbSource))!;
      const original = local.split("/").at(-1)!;
      const variants = posterVariantWidths.map(width => ({ url: `/api/posters/${posterVariantFilename(original, width)}`, width }));
      await Promise.all(variants.map(variant => writeFile(join(directory, variant.url.split("/").at(-1)!), webp)));
      const after = await (await app.request("/api/actors/42/movies")).json() as ActorMovieList;
      expect(after.movies[0]).toMatchObject({ posterUrl: localPosterUrl(tmdbSource), posterVariants: variants });
      expect(downloads).toEqual([tmdbSource]);
      expect(generation).toEqual([]);
    } finally { db.close(); }
  });

  test.skipIf(!hasPosterEncoder)("preview GETs respond before thumbnail encoding finishes and leave actor photos unchanged", async () => {
    const db = createDatabase(":memory:");
    const original = posterPng();
    const store = createPosterStore({ directory, fetcher: async () => new Response(original, { headers: { "Content-Type": "image/png" } }) });
    const release = Promise.withResolvers<void>();
    const jobs: Promise<void>[] = [];
    const sources: Array<string | null> = [];
    const posters: PosterStore = { ...store, ensureVariants(source) {
      sources.push(source);
      const job = release.promise.then(() => store.ensureVariants(source));
      jobs.push(job);
      return job;
    } };
    const app = createApp({ db: db.db, posters, tmdb: filmographyProvider() });
    try {
      for (const source of [tmdbSource, doubanSource]) {
        const preview = localPosterUrl(source)!;
        const response = await Promise.race([
          app.request(preview),
          Bun.sleep(1000).then(() => { throw new Error("Image response waited for thumbnail generation"); }),
        ]);
        expect(response.status).toBe(200);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(original);
      }
      expect(sources).toHaveLength(2);
      expect(sources.every(source => /^\/api\/posters\/[a-f0-9]{64}\.png$/.test(source || ""))).toBe(true);
      expect(await store.variants(localPosterUrl(tmdbSource))).toBeUndefined();
      expect((await app.request("/api/actors/image/actor.png")).status).toBe(200);
      expect(sources).toHaveLength(2);
      release.resolve();
      await Promise.all(jobs);
      for (const source of [tmdbSource, doubanSource]) {
        expect((await store.variants(localPosterUrl(source)))?.map(variant => variant.width)).toEqual([200, 360, 480]);
      }
    } finally {
      release.resolve();
      await Promise.all(jobs);
      db.close();
    }
  });

  test.skipIf(!hasPosterEncoder)("serializes encoding across images, deduplicates a queued image and continues after a failure", async () => {
    const store = createPosterStore({ directory, fetcher: async () => new Response(posterPng(), { headers: { "Content-Type": "image/png" } }) });
    const first = (await store.save(tmdbSource))!;
    const second = (await store.save(doubanSource))!;
    const invalidFilename = `${"e".repeat(64)}.png`;
    await writeFile(join(directory, invalidFilename), png.subarray(0, 8));

    let active = 0;
    let peak = 0;
    const probed: string[] = [];
    const originalSpawn = Bun.spawn;
    const spawn = spyOn(Bun, "spawn").mockImplementation((...args) => {
      const child = Reflect.apply(originalSpawn, Bun, args) as ReturnType<typeof Bun.spawn>;
      const command = Array.isArray(args[0]) ? args[0] : args[0].cmd;
      if (command[0] === ffprobe || command[0] === cwebp) {
        active++;
        peak = Math.max(peak, active);
        if (command[0] === ffprobe) probed.push(String(command.at(-1)));
        void child.exited.then(() => { active--; }, () => { active--; });
      }
      return child;
    });
    const warnings: unknown[][] = [];
    const warning = spyOn(console, "warn").mockImplementation((...values) => { warnings.push(values); });
    const jobs: Promise<void>[] = [];
    try {
      jobs.push(store.ensureVariants(`/api/posters/${invalidFilename}`));
      jobs.push(store.ensureVariants(first), store.ensureVariants(first), store.ensureVariants(second));
      await Promise.all(jobs);

      expect(peak).toBe(1);
      expect(active).toBe(0);
      expect(probed).toEqual([
        join(directory, invalidFilename),
        join(directory, first.split("/").at(-1)!),
        join(directory, second.split("/").at(-1)!),
      ]);
      expect(warnings).toHaveLength(1);
      expect(await store.variants(`/api/posters/${invalidFilename}`)).toBeUndefined();
      for (const source of [first, second]) {
        const variants = await store.variants(source);
        expect(variants?.map(variant => variant.width)).toEqual([200, 360, 480]);
        for (const variant of variants!) expect((await store.respond(variant.url.split("/").at(-1)!)).status).toBe(200);
      }
    } finally {
      await Promise.all(jobs);
      spawn.mockRestore();
      warning.mockRestore();
    }
  });
});
