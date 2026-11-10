import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as posters from "../src/posters";
import { localPosterPath, posterSrcSet } from "@film-shelf/shared/home-grid";

const staticSource = "https://img2.doubanio.com/view/photo/l/public/p2891113171.jpg";
const signedSource = "https://qnmob3-sign.doubanio.com/view/photo/large/public/p2891113171.jpg?sa_cv=0123456789abcdef0123456789abcdef&sa_ct=01234567&imageView2/0/q/80/w/9999/h/120/format/jpg";
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const previewPath = (source: string) => `/api/posters/douban/${Buffer.from(source).toString("base64url")}`;
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "film-shelf-douban-posters-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("trusted Douban poster storage", () => {
  test("maps static and signed sources to local previews accepted by shared image rendering", () => {
    for (const source of [staticSource, signedSource]) {
      const expected = previewPath(source);
      expect(posters.localPosterUrl(source)).toBe(expected);
      expect(posters.localPosterUrl(expected)).toBe(expected);
      expect(localPosterPath.test(expected)).toBe(true);
      expect(posterSrcSet([{ url: expected, width: 185 }])).toBe(`${expected} 185w`);
    }
    expect(posters.localPosterUrl("https://image.tmdb.org/t/p/w500/poster.jpg")).toBe("/api/posters/tmdb/w500/poster.jpg");
    expect(localPosterPath.test("/api/posters/tmdb/w500/poster.jpg?x=1")).toBe(false);
    expect(localPosterPath.test("/api/posters/douban/../secret")).toBe(false);
    expect(localPosterPath.test(`/api/posters/douban/${"A".repeat(2049)}`)).toBe(false);
  });

  test("exports a validating preview decoder for the HTTP route", () => {
    expect(posters).toHaveProperty("doubanPosterSource");
    expect(posters).toHaveProperty("LOCAL_DOUBAN_POSTER_PATH_PATTERN");
    const api = posters as typeof posters & { doubanPosterSource(path: string): string; LOCAL_DOUBAN_POSTER_PATH_PATTERN: RegExp };
    for (const source of [staticSource, signedSource]) {
      expect(api.LOCAL_DOUBAN_POSTER_PATH_PATTERN.test(previewPath(source))).toBe(true);
      expect(api.doubanPosterSource(previewPath(source))).toBe(source);
    }
    expect(() => api.doubanPosterSource(previewPath("https://evil.example/image.jpg"))).toThrow();
  });

  test("saves remote and preview sources once concurrently, includes Referer and survives an offline reopening", async () => {
    const calls: string[] = [];
    const store: posters.PosterStore = posters.createPosterStore({ directory, fetcher: async (url, options) => {
      calls.push(String(url));
      expect(options?.redirect).toBe("error");
      expect(new Headers(options?.headers).get("Referer")).toBe("https://movie.douban.com/");
      return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
    } });
    for (const source of [staticSource, signedSource]) {
      const paths = await Promise.all([store.save(source), store.save(previewPath(source)), store.save(source)]);
      expect(new Set(paths).size).toBe(1);
      expect(paths[0]).toMatch(/^\/api\/posters\/[a-f0-9]{64}\.jpg$/);
      expect(await store.save(paths[0])).toBe(paths[0]);
      const reopened = posters.createPosterStore({ directory, fetcher: async () => { throw new Error("offline"); } });
      expect(await reopened.save(previewPath(source))).toBe(paths[0]);
      const response = await reopened.respond(paths[0]!.split("/").at(-1)!);
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpeg);
    }
    expect(calls).toEqual([staticSource, signedSource]);
    expect(await readdir(directory)).toHaveLength(2);
    expect(await store.save(null)).toBeNull();
    expect(await store.save(undefined)).toBeNull();
    expect(await store.variants(null)).toBeUndefined();
    await store.ensureVariants(null);
  });

  test("rejects untrusted, normalized, oversized and malformed sources before downloading", async () => {
    let requests = 0;
    const store = posters.createPosterStore({ directory, fetcher: async () => { requests++; return new Response(jpeg); } });
    const invalid = [
      staticSource.replace("https:", "http:"),
      staticSource.replace("img2.doubanio.com", "img2.doubanio.com.evil.example"),
      staticSource.replace("img2.doubanio.com", "doubanio.com"),
      staticSource.replace("img2.doubanio.com", "user:pass@img2.doubanio.com"),
      staticSource.replace("img2.doubanio.com", "img2.doubanio.com:444"),
      staticSource.replace("img2.doubanio.com", "img2.doubanio.com:443"),
      staticSource.replace("/photo/l/", "/photo/other/../l/"),
      staticSource.replace("p289", "%70289"),
      staticSource.replace(".jpg", ".svg"),
      `${staticSource}?x=1`, `${staticSource}#fragment`, `${staticSource}\n`,
      signedSource.replace("sa_ct=01234567", "sa_ct=not-a-signature"),
      `${signedSource}&url=https://evil.example/`,
      signedSource.replace("w/9999", "w/999999999"),
      signedSource.replace("large/public", "large/private"),
    ];
    for (const source of invalid) {
      expect(posters.localPosterUrl(source)).toBeNull();
      expect(posters.localPosterUrl(previewPath(source))).toBeNull();
      await expect(store.save(source)).rejects.toMatchObject({ status: 400, code: "POSTER_URL_INVALID" });
      await expect(store.save(previewPath(source))).rejects.toMatchObject({ status: 400, code: "POSTER_URL_INVALID" });
    }
    // The static fixture ends in "Zw"; "Zx" decodes to the same bytes but is not canonical.
    const noncanonical = `${previewPath(staticSource).slice(0, -1)}x`;
    for (const path of [noncanonical, `${previewPath(staticSource)}=`, `/api/posters/douban/${"A".repeat(2049)}`, "/api/posters/douban/AA", "/api/posters/douban/_w", `${previewPath(staticSource)}?x=1`]) {
      expect(posters.localPosterUrl(path)).toBeNull();
      await expect(store.save(path)).rejects.toMatchObject({ status: 400, code: "POSTER_URL_INVALID" });
    }
    expect(requests).toBe(0);
  });
});
