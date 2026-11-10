import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createPosterStore, isDoubanActorImageSource } from "../src/posters";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
const source = "https://image.tmdb.org/t/p/w500/poster.jpg";
type Fetcher = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "film-shelf-posters-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("persistent local poster storage", () => {
  test("saves only trusted Douban celebrity photos locally with the required image referer", async () => {
    let calls = 0;
    const store = createPosterStore({ directory, fetcher: async (_source, options) => {
      calls++;
      expect(new Headers(options?.headers).get("Referer")).toBe("https://movie.douban.com/");
      return new Response(jpeg, { headers: { "Content-Type": "image/jpeg" } });
    } });
    const valid = [
      "https://img3.doubanio.com/view/personage/m/public/9857d63a35c38fdd324cd0f6af2d0f13.jpg",
      "https://img9.doubanio.com/view/celebrity/m/public/p1552642864.34.jpg",
      "https://img3.doubanio.com/view/celebrity/m/public/p_7aSrpchoO4cel_avatar_uploaded1584272321.53.jpg",
    ];
    for (const url of valid) {
      expect(isDoubanActorImageSource(url)).toBe(true);
      const local = await store.save(url);
      expect(local).toMatch(/^\/api\/posters\/[a-f0-9]{64}\.jpg$/);
      const response = await store.respond(local!.split("/").at(-1)!);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpeg);
    }
    for (const url of [
      "https://img3.doubanio.com.evil.test/view/celebrity/m/public/p1.jpg",
      "https://img3.doubanio.com:444/view/celebrity/m/public/p1.jpg",
      "http://img3.doubanio.com/view/celebrity/m/public/p1.jpg",
      "https://img3.doubanio.com/view/celebrity/m/public/../p1.jpg",
      "https://img3.doubanio.com/view/celebrity/m/public/p1.jpg?redirect=http://127.0.0.1/",
      "https://img3.doubanio.com/view/celebrity/m/public/p1.jpg\n",
    ]) {
      expect(isDoubanActorImageSource(url)).toBe(false);
      await expect(store.save(url)).rejects.toMatchObject({ status: 400, code: "POSTER_URL_INVALID" });
    }
    expect(calls).toBe(valid.length);
  });

  test("downloads once, serves correct image bytes and survives an offline reopened store", async () => {
    let calls = 0;
    const store = createPosterStore({ directory, fetcher: async (_url, options) => {
      calls++;
      expect(options?.redirect).toBe("error");
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
    } });
    const local = await store.save(source);
    expect(local).toBe(`/api/posters/${createHash("sha256").update(source).digest("hex")}.jpg`);
    expect(await store.save(source)).toBe(local);
    expect(await store.save(local)).toBe(local);
    expect(calls).toBe(1);
    const reopened = createPosterStore({ directory, fetcher: async () => { throw new Error("offline"); } });
    expect(await reopened.save(source)).toBe(local);
    const response = await reopened.respond(local!.split("/").at(-1)!);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpeg);
    expect(await readdir(directory)).toHaveLength(1);
  });

  test("deduplicates simultaneous saves, keeps null values and supports PNG/WebP", async () => {
    let calls = 0;
    const store = createPosterStore({ directory, fetcher: async () => { calls++; return new Response(jpeg, { headers: { "content-type": "image/jpeg" } }); } });
    const paths = await Promise.all([store.save(source), store.save(source), store.save(source)]);
    expect(new Set(paths).size).toBe(1);
    expect(calls).toBe(1);
    expect(await store.save(null)).toBeNull();
    expect(await store.save(undefined)).toBeNull();
    for (const [extension, bytes] of [["png", png], ["webp", webp]] as const) {
      const image = createPosterStore({ directory, fetcher: async () => new Response(bytes, { headers: { "content-type": `image/${extension}` } }) });
      const path = await image.save(`https://image.tmdb.org/t/p/original/${extension}.${extension}`);
      expect(path).toEndWith(`.${extension}`);
      expect((await image.respond(path!.split("/").at(-1)!)).status).toBe(200);
    }
  });

  test("rejects arbitrary sources, traversal and missing local posters without making a request", async () => {
    let calls = 0;
    const store = createPosterStore({ directory, fetcher: async () => { calls++; return new Response(jpeg); } });
    for (const value of ["", "https://example.com/poster.jpg", "http://image.tmdb.org/t/p/w500/poster.jpg", "https://image.tmdb.org:444/t/p/w500/poster.jpg", "https://user:pass@image.tmdb.org/t/p/w500/poster.jpg", "https://image.tmdb.org/t/p/w500/poster.jpg?x=1", "https://image.tmdb.org/t/p/w500/poster.jpg#x", "https://image.tmdb.org/t/p/other/../w500/poster.jpg", "https://image.tmdb.org/t/p/w500/%70oster.jpg", "https://image.tmdb.org/t/p/w500/poster.svg", "/api/posters/../.env"]) {
      await expect(store.save(value)).rejects.toMatchObject({ status: 400, code: "POSTER_URL_INVALID" });
    }
    await expect(store.save(`/api/posters/${"a".repeat(64)}.jpg`)).rejects.toMatchObject({ status: 404, code: "POSTER_NOT_FOUND" });
    expect(calls).toBe(0);
    for (const filename of ["../.env", "poster.jpg", `${"a".repeat(64)}.jpg`]) expect((await store.respond(filename)).status).toBe(404);
  });

  test("does not serve symlinks or unvalidated image files placed in the storage directory", async () => {
    const store = createPosterStore({ directory });
    const filename = `${"b".repeat(64)}.jpg`;
    await writeFile(join(directory, filename), "not an image");
    expect((await store.respond(filename)).status).toBe(404);
    const outside = join(directory, "outside.txt");
    await writeFile(outside, jpeg);
    const link = `${"c".repeat(64)}.jpg`;
    await symlink(outside, join(directory, link));
    expect((await store.respond(link)).status).toBe(404);
  });

  test("rejects unsuccessful, wrong-MIME, mismatched and oversized responses without leftover files", async () => {
    const responses: Array<() => Response> = [
      () => new Response("not found", { status: 404 }),
      () => new Response(jpeg, { headers: { "content-type": "text/html" } }),
      () => new Response(jpeg, { headers: { "content-type": "image/png" } }),
      () => new Response("not an image", { headers: { "content-type": "image/jpeg" } }),
      () => new Response(jpeg, { headers: { "content-type": "image/jpeg", "content-length": String(11 * 1024 * 1024) } }),
      () => new Response(new Uint8Array(10 * 1024 * 1024 + 1), { headers: { "content-type": "image/jpeg" } }),
    ];
    for (const response of responses) {
      const store = createPosterStore({ directory, fetcher: async () => response() });
      await expect(store.save(source)).rejects.toMatchObject({ status: 502 });
      expect(await readdir(directory)).toEqual([]);
    }
  });

  test("reports timeouts/network failures and allows a later retry", async () => {
    const timeout: Fetcher = async () => { throw new DOMException("timeout", "TimeoutError"); };
    const offline: Fetcher = async () => { throw new TypeError("offline"); };
    await expect(createPosterStore({ directory, fetcher: timeout }).save(source)).rejects.toMatchObject({ status: 504, code: "POSTER_TIMEOUT" });
    await expect(createPosterStore({ directory, fetcher: offline }).save(source)).rejects.toMatchObject({ status: 502, code: "POSTER_DOWNLOAD_FAILED" });
    let calls = 0;
    const store = createPosterStore({ directory, fetcher: async () => {
      if (++calls === 1) throw new TypeError("offline");
      return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
    } });
    await expect(store.save(source)).rejects.toMatchObject({ code: "POSTER_DOWNLOAD_FAILED" });
    expect(await store.save(source)).toStartWith("/api/posters/");
    expect(calls).toBe(2);
  });

  test("cancels an upstream body rejected before reading it", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const store = createPosterStore({ directory, fetcher: async () => new Response(body, { headers: { "content-type": "text/html" } }) });
    await expect(store.save(source)).rejects.toMatchObject({ code: "POSTER_INVALID_IMAGE" });
    expect(cancelled).toBe(true);
    expect(await readdir(directory)).toEqual([]);
  });
});
