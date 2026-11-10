import { describe, expect, test } from "bun:test";
import { createDoubanProvider, tmdbMetadataProvider } from "../src/metadata";
import { createTmdbProvider } from "../src/tmdb";

const photo = (id = 2936884228, extra: Record<string, unknown> = {}) => ({
  id: String(id), owner_uri: "douban://douban.com/tv/27602137", photo_type: "poster",
  image: { large: { url: `https://img3.doubanio.com/view/photo/l/public/p${id}.jpg`, width: 1000, height: 1445 } },
  ...extra,
});

describe("source-verified poster candidates", () => {
  test("verifies Douban poster ownership and classification without cookies, and shares repeat work", async () => {
    let calls = 0;
    const provider = createDoubanProvider((async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      calls++;
      expect(String(input)).toBe("https://m.douban.com/rexxar/api/v2/photo/2936884228");
      expect(new Headers(init?.headers).get("Referer")).toBe("https://m.douban.com/movie/subject/27602137/");
      expect(new Headers(init?.headers).get("Cookie")).toBeNull();
      expect(init?.credentials).toBe("omit");
      expect(init?.redirect).toBe("error");
      return Response.json(photo());
    }) as unknown as typeof fetch);
    expect(typeof provider.poster).toBe("function");
    const result = await Promise.all([provider.poster!(27602137, "tv", 2936884228), provider.poster!(27602137, "tv", 2936884228)]);
    expect(result[0]).toEqual({ source: "douban", sourceId: "2936884228", url: "https://img3.doubanio.com/view/photo/l/public/p2936884228.jpg", width: 1000, height: 1445 });
    expect(result[1]).toEqual(result[0]);
    expect(calls).toBe(1);
  });

  test("rejects stills, another work, mismatched IDs and untrusted image sources before returning candidates", async () => {
    for (const [extra, code] of [
      [{ photo_type: "still" }, "DOUBAN_NOT_POSTER"],
      [{ owner_uri: "douban://douban.com/tv/42" }, "DOUBAN_POSTER_MISMATCH"],
      [{ owner_uri: "douban://douban.com/movie/27602137" }, "DOUBAN_POSTER_MISMATCH"],
      [{ id: "42" }, "DOUBAN_POSTER_MISMATCH"],
      [{ image: { large: { url: "https://evil.example/image.jpg", width: 1000, height: 1445 } } }, "DOUBAN_INVALID_RESPONSE"],
      [{ image: { large: { url: "https://img3.doubanio.com/view/photo/l/public/p42.jpg", width: 1000, height: 1445 } } }, "DOUBAN_INVALID_RESPONSE"],
    ] as const) {
      const provider = createDoubanProvider((async () => Response.json(photo(2936884228, extra))) as unknown as typeof fetch);
      await expect(provider.poster!(27602137, "tv", 2936884228)).rejects.toMatchObject({ code });
    }
  });

  test("isolates movie and TV photo ownership caches and validates positive safe IDs before requesting", async () => {
    let calls = 0;
    const provider = createDoubanProvider((async () => { calls++; return Response.json(photo()); }) as unknown as typeof fetch);
    await provider.poster!(27602137, "tv", 2936884228);
    await expect(provider.poster!(27602137, "movie", 2936884228)).rejects.toMatchObject({ code: "DOUBAN_POSTER_MISMATCH" });
    for (const bad of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1]) await expect(provider.poster!(27602137, "tv", bad)).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(2);
  });

  test("reads only the fixed poster album, deduplicates and verifies each photo without requesting the mixed photo feed", async () => {
    const paths: string[] = [];
    const provider = createDoubanProvider((async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.hostname === "movie.douban.com") {
        expect(url.href).toBe("https://movie.douban.com/subject/27602137/photos?type=R");
        expect(init?.redirect).toBe("manual");
        expect(new Headers(init?.headers).get("Cookie")).toBeNull();
        return new Response('<h1>我的大叔的海报</h1><a href="https://movie.douban.com/subject/27602137/">作品</a><ul class="poster-col3"><li data-id="2936884228"></li><li data-id="2936884228"></li><li data-id="2562913558"></li></ul>', { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      return Response.json(photo(Number(url.pathname.split("/").at(-1))));
    }) as unknown as typeof fetch);
    expect(await provider.posters!(27602137, "tv")).toHaveLength(2);
    expect(paths).toEqual(["/subject/27602137/photos", "/rexxar/api/v2/photo/2936884228", "/rexxar/api/v2/photo/2562913558"]);
  });

  test("reports album verification pages and redirects honestly and retries failures rather than caching empty success", async () => {
    for (const response of [
      new Response(null, { status: 302, headers: { Location: "https://sec.douban.com/c" } }),
      new Response("<title>豆瓣</title><form id=sec>验证</form>", { headers: { "Content-Type": "text/html" } }),
      new Response("Forbidden", { status: 403 }),
    ]) {
      let calls = 0;
      const provider = createDoubanProvider((async () => { calls++; return response.clone(); }) as unknown as typeof fetch);
      for (let retry = 0; retry < 2; retry++) await expect(provider.posters!(27602137, "tv")).rejects.toMatchObject({ code: "DOUBAN_VERIFICATION_REQUIRED" });
      expect(calls).toBe(2);
    }
    const timeout = createDoubanProvider((async () => { throw new DOMException("timeout", "TimeoutError"); }) as unknown as typeof fetch);
    await expect(timeout.posters!(27602137, "tv")).rejects.toMatchObject({ code: "DOUBAN_TIMEOUT", status: 504 });
  });

  test("caps poster albums at 40 verified candidates and rejects overlarge or unrelated HTML", async () => {
    let photoCalls = 0;
    const body = `<h1>海报</h1><a href="/subject/27602137/">作品</a><ul class="poster-col3">${Array.from({ length: 50 }, (_, index) => `<li data-id="${2936884228 + index}"></li>`).join("")}</ul>`;
    const provider = createDoubanProvider((async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      if (url.hostname === "movie.douban.com") return new Response(body, { headers: { "Content-Type": "text/html" } });
      photoCalls++;
      return Response.json(photo(Number(url.pathname.split("/").at(-1))));
    }) as unknown as typeof fetch);
    expect(await provider.posters!(27602137, "tv")).toHaveLength(40);
    expect(photoCalls).toBe(40);
    for (const html of [body.replaceAll("27602137", "42"), "x".repeat(1_048_577)]) {
      const invalid = createDoubanProvider((async () => new Response(html, { headers: { "Content-Type": "text/html" } })) as unknown as typeof fetch);
      await expect(invalid.posters!(27602137, "tv")).rejects.toMatchObject({ code: "DOUBAN_VERIFICATION_REQUIRED" });
    }
  });

  test("keeps the shared four-request budget occupied until album HTML finishes reading", async () => {
    const pending: Array<{ controller: ReadableStreamDefaultController<Uint8Array>; id: number }> = [];
    let started = 0;
    const provider = createDoubanProvider((async (input: Parameters<typeof fetch>[0]) => {
      started++;
      const url = new URL(String(input));
      if (url.hostname === "m.douban.com") return Response.json(photo());
      const id = Number(url.pathname.split("/")[2]);
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { pending.push({ controller, id }); } }), { headers: { "Content-Type": "text/html" } });
    }) as unknown as typeof fetch);
    const albums = Array.from({ length: 4 }, (_, index) => provider.posters!(index + 1, "tv"));
    await Bun.sleep(0);
    await expect(provider.poster!(27602137, "tv", 2936884228)).rejects.toMatchObject({ code: "DOUBAN_BUSY" });
    expect(started).toBe(4);
    for (const { controller, id } of pending) {
      controller.enqueue(new TextEncoder().encode(`<h1>海报</h1><a href="/subject/${id}/">作品</a><ul class="poster-col3"></ul>`));
      controller.close();
    }
    expect(await Promise.all(albums)).toEqual([[], [], [], []]);
    await expect(provider.poster!(27602137, "tv", 2936884228)).resolves.toMatchObject({ sourceId: "2936884228" });
  });

  test("maps album body timeouts and releases the request budget for a later retry", async () => {
    let broken = true;
    const provider = createDoubanProvider((async () => {
      if (broken) return new Response(new ReadableStream({ pull() { throw new DOMException("body timeout", "TimeoutError"); } }), { headers: { "Content-Type": "text/html" } });
      return Response.json(photo());
    }) as unknown as typeof fetch);
    for (let retry = 0; retry < 5; retry++) await expect(provider.posters!(27602137, "tv")).rejects.toMatchObject({ code: "DOUBAN_TIMEOUT", status: 504 });
    broken = false;
    await expect(provider.poster!(27602137, "tv", 2936884228)).resolves.toMatchObject({ sourceId: "2936884228" });
  });

  test("TMDB returns only poster images from all languages with dimensions, deduplication, limits and isolated media caches", async () => {
    const paths: string[] = [];
    const provider = tmdbMetadataProvider(createTmdbProvider("token", (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      expect(url.searchParams.get("language")).toBe("");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token");
      return Response.json({ id: 42, backdrops: [{ file_path: "/ignore.jpg", width: 1920, height: 1080 }], posters: [
        { file_path: "/korean.jpg", width: 1000, height: 1500, iso_639_1: "ko" },
        { file_path: "/plain.jpg", width: 800, height: 1200, iso_639_1: null },
        { file_path: "/korean.jpg", width: 1000, height: 1500 },
        { file_path: "/../invalid.jpg", width: 1000, height: 1500 },
      ] });
    }) as unknown as typeof fetch));
    expect(typeof provider.posters).toBe("function");
    expect(await provider.posters!(42, "tv")).toEqual([
      { source: "tmdb", sourceId: "/korean.jpg", url: "https://image.tmdb.org/t/p/original/korean.jpg", width: 1000, height: 1500 },
      { source: "tmdb", sourceId: "/plain.jpg", url: "https://image.tmdb.org/t/p/original/plain.jpg", width: 800, height: 1200 },
    ]);
    await provider.posters!(42, "movie");
    await provider.posters!(42, "tv");
    expect(paths).toEqual(["/3/tv/42/images", "/3/movie/42/images"]);
  });

  test("TMDB rejects a mismatched subject and caps its successful result at 40 unique posters", async () => {
    const wrong = createTmdbProvider("token", (async () => Response.json({ id: 99, posters: [] })) as unknown as typeof fetch);
    await expect(wrong.posters!(42, "tv")).rejects.toMatchObject({ code: "TMDB_INVALID_RESPONSE" });
    const provider = createTmdbProvider("token", (async () => Response.json({ id: 42, posters: Array.from({ length: 55 }, (_, index) => ({ file_path: `/poster${index}.jpg`, width: 1000, height: 1500 })) })) as unknown as typeof fetch);
    expect(await provider.posters!(42)).toHaveLength(40);
  });
});
