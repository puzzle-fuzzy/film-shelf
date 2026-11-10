import { describe, expect, test } from "bun:test";

const show = { id: "27602137", type: "tv", title: "我的大叔", original_title: "나의 아저씨", pubdate: ["2018-03-21(韩国)"], year: "2018", countries: ["韩国"], intro: "生活的故事", episodes_count: 16, actors: [{ name: "李知恩" }], cover: { url: "https://img1.doubanio.com/thumbnail.jpg", image: { large: { url: "https://img1.doubanio.com/view/photo/l/public/p256.jpg" } } } };

async function factory(fetcher: typeof fetch) {
  const module = await import("../src/metadata");
  return module.createDoubanProvider(fetcher);
}

describe("Douban anonymous metadata boundary", () => {
  test("enriches the subject cast from complete celebrities while preserving names and filtering photo sources", async () => {
    const profile = "https://img3.doubanio.com/view/personage/m/public/9857d63a35c38fdd324cd0f6af2d0f13.jpg";
    const fallback = "https://img9.doubanio.com/view/celebrity/m/public/p1552642864.34.jpg";
    const names = ["具教焕", "高允贞", "缺图演员", "同名演员", "无资料演员"];
    const paths: string[] = [];
    const provider = await factory((async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (!path.endsWith("/celebrities")) return Response.json({ ...show, actors: names.map(name => ({ name })) });
      expect(new Headers(init?.headers).get("Referer")).toBe("https://m.douban.com/movie/subject/27602137/");
      return Response.json({ actors: [
        { name: "具教焕", avatar: { large: profile } },
        { name: "高允贞", avatar: { large: "https://example.com/untrusted.jpg", normal: fallback } },
        { name: "缺图演员", avatar: { large: "https://img3.doubanio.com.evil.test/view/personage/m/public/a.jpg" } },
        { name: "同名演员", avatar: { large: profile } },
        { name: "同名演员", avatar: { large: fallback } },
        { name: "不在主演名单", avatar: { large: profile } },
      ] });
    }) as typeof fetch);
    const result = await provider.details(27602137, "tv");
    expect(result.cast?.map(actor => actor.name)).toEqual(names);
    expect(result.cast?.map(actor => actor.profileUrl)).toEqual([profile, fallback, null, null, null]);
    expect(result.cast?.every(actor => actor.character === "" && !actor.tmdbPersonId)).toBe(true);
    expect(paths).toEqual(["/rexxar/api/v2/tv/27602137", "/rexxar/api/v2/tv/27602137/celebrities"]);
  });

  test("preserves subject metadata when optional actor photos are unavailable", async () => {
    const provider = await factory((async (input: Parameters<typeof fetch>[0]) => {
      if (new URL(String(input)).pathname.endsWith("/celebrities")) return new Response("verification", { status: 403 });
      return Response.json(show);
    }) as typeof fetch);
    expect(await provider.details(27602137, "tv")).toMatchObject({
      title: show.title, cast: [{ name: "李知恩", character: "", profileUrl: null }],
    });
  });

  test("imports My Mister with the full-resolution image, date, 16 episodes and names without TMDB IDs", async () => {
    const provider = await factory((async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://m.douban.com");
      if (url.pathname.endsWith("/celebrities")) return Response.json({ actors: [] });
      expect(url.pathname).toBe("/rexxar/api/v2/tv/27602137");
      const headers = new Headers(init?.headers);
      expect(headers.get("User-Agent")).toBeTruthy();
      expect(headers.get("Referer")).toBe("https://m.douban.com/movie/subject/27602137/");
      expect(headers.get("Cookie")).toBeNull();
      expect(init?.credentials).toBe("omit");
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json(show);
    }) as unknown as typeof fetch);
    expect(provider.configured).toBe(true);
    expect(await provider.details(27602137, "tv")).toEqual({ mediaType: "tv", doubanId: 27602137, tmdbId: null, title: "我的大叔", originalTitle: "나의 아저씨", releaseDate: "2018-03-21", episodeCount: 16, overview: "生活的故事", posterUrl: "https://img1.doubanio.com/view/photo/l/public/p256.jpg", cast: [{ name: "李知恩", character: "", profileUrl: null }] });
  });

  test("requests movie details directly while rejecting a mismatched response type", async () => {
    const provider = await factory((async (input: Parameters<typeof fetch>[0]) => {
      expect(new URL(String(input)).pathname).toBe("/rexxar/api/v2/movie/27602137");
      return Response.json(show);
    }) as unknown as typeof fetch);
    await expect(provider.details(27602137, "movie")).rejects.toMatchObject({ status: 422, code: "DOUBAN_TYPE_MISMATCH" });
  });

  test("derives country from mobile card subtitles, skips a year prefix and prefers structured countries", async () => {
    for (const [extra, expected] of [
      [{ card_subtitle: "韩国 / 剧情 / 金湲锡 / 李知恩 李善均" }, ["韩国"]],
      [{ card_subtitle: "2018 / 韩国 / 剧情 / 金湲锡" }, ["韩国"]],
      [{ card_subtitle: "2018 / 韩国 / 剧情", countries: ["中国大陆"] }, ["中国大陆"]],
      [{ card_subtitle: "2018" }, undefined],
    ] as const) {
      const provider = await factory((async () => Response.json({ items: [{ target_type: "tv", target: { id: "27602137", title: "我的大叔", ...extra } }] })) as unknown as typeof fetch);
      expect((await provider.search("大叔", "tv"))[0]!.countries).toEqual(expected ? [...expected] : undefined);
    }
  });

  test("bounds 150 distinct concurrent searches and details together, with same-key sharing and no queue", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started = 0;
    const provider = await factory((async (input: Parameters<typeof fetch>[0]) => {
      started++;
      await gate;
      return Response.json(new URL(String(input)).pathname.endsWith("search/movie") ? { items: [] } : { ...show, actors: [] });
    }) as unknown as typeof fetch);
    const detail = provider.details(27602137, "tv");
    const duplicate = provider.details(27602137, "tv");
    const searches = Array.from({ length: 150 }, (_, index) => provider.search(`query-${index}`, "tv"));
    const settled = Promise.allSettled([detail, duplicate, ...searches]);
    const beforeRelease = started;
    release();
    const results = await settled;
    expect(beforeRelease).toBe(4);
    expect(started).toBe(4);
    expect(results.slice(0, 2).every(result => result.status === "fulfilled")).toBe(true);
    const errors = results.filter(result => result.status === "rejected");
    expect(errors).toHaveLength(147);
    for (const result of errors) if (result.status === "rejected") expect(result.reason).toMatchObject({ status: 429, code: "DOUBAN_BUSY" });
    expect(await provider.search("retry-after-release", "tv")).toEqual([]);
    expect(started).toBe(5);
  });

  test("holds a concurrency slot until JSON consumption finishes", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started = 0;
    const provider = await factory((async () => {
      started++;
      const response = Response.json({ items: [] });
      response.json = async () => { await gate; return { items: [] }; };
      return response;
    }) as unknown as typeof fetch);
    const pending = Array.from({ length: 4 }, (_, index) => provider.search(`body-${index}`, "tv"));
    await Bun.sleep(0);
    const overflow = provider.search("body-overflow", "tv");
    const outcome = Promise.allSettled([...pending, overflow]);
    const beforeRelease = started;
    release();
    const results = await outcome;
    expect(beforeRelease).toBe(4);
    expect(results[4]).toMatchObject({ status: "rejected", reason: { status: 429, code: "DOUBAN_BUSY" } });
  });

  test("classifies body timeouts separately from syntax errors and releases capacity after any failure", async () => {
    for (const [error, expectedStatus, expectedCode] of [
      [new DOMException("body timeout", "TimeoutError"), 504, "DOUBAN_TIMEOUT"],
      [new DOMException("body abort", "AbortError"), 504, "DOUBAN_TIMEOUT"],
      [new TypeError("body network failure"), 502, "DOUBAN_UNAVAILABLE"],
      [new SyntaxError("invalid JSON"), 502, "DOUBAN_INVALID_RESPONSE"],
    ] as const) {
      let broken = true;
      const provider = await factory((async () => {
        const response = Response.json(show);
        if (broken) response.json = async () => { throw error; };
        return response;
      }) as unknown as typeof fetch);
      for (let retry = 0; retry < 5; retry++) await expect(provider.details(27602137, "tv")).rejects.toMatchObject({ status: expectedStatus, code: expectedCode });
      broken = false;
      expect((await provider.details(27602137, "tv")).title).toBe("我的大叔");
    }
    let broken = true;
    const provider = await factory((async () => { if (broken) throw new TypeError("fetch failed"); return Response.json(show); }) as unknown as typeof fetch);
    for (let retry = 0; retry < 5; retry++) await expect(provider.details(27602137, "tv")).rejects.toMatchObject({ code: "DOUBAN_UNAVAILABLE" });
    broken = false;
    expect((await provider.details(27602137, "tv")).title).toBe("我的大叔");
  });

  test("searches a fixed bounded endpoint and filters the selected media type", async () => {
    const provider = await factory((async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/rexxar/api/v2/search/movie");
      expect(url.searchParams.get("q")).toBe("我的大叔 & tv");
      expect(url.searchParams.get("start")).toBe("0");
      expect(url.searchParams.get("count")).toBe("20");
      const referer = new URL(new Headers(init?.headers).get("Referer")!);
      expect(referer.origin).toBe("https://m.douban.com");
      expect(referer.pathname).toBe("/search/");
      expect(referer.searchParams.get("query")).toBe("我的大叔 & tv");
      expect(referer.searchParams.get("type")).toBe("movie");
      return Response.json({ items: [{ target: show }, { target: { ...show, type: "movie", id: "1" } }, ...Array.from({ length: 30 }, (_, index) => ({ target: { ...show, id: String(index + 2) } }))] });
    }) as unknown as typeof fetch);
    const results = await provider.search("我的大叔 & tv", "tv");
    expect(results).toHaveLength(20);
    expect(results[0]).toMatchObject({ provider: "douban", mediaType: "tv", externalId: 27602137, releaseDate: "2018-03-21", year: "2018", countries: ["韩国"] });
    expect(results.every(result => result.mediaType === "tv")).toBe(true);
  });

  test("accepts mobile search target_type/cover_url and detail picture fallbacks without inventing images", async () => {
    const searchProvider = await factory((async () => Response.json({ items: [{ target_type: "tv", target: { id: "27602137", title: "我的大叔", cover_url: "https://img1.doubanio.com/search.jpg" } }] })) as unknown as typeof fetch);
    expect(await searchProvider.search("大叔", "tv")).toMatchObject([{ externalId: 27602137, mediaType: "tv", posterUrl: "https://img1.doubanio.com/search.jpg" }]);
    for (const [picture, expected] of [
      [{ cover_url: "https://img1.doubanio.com/cover.jpg", pic: { large: "https://img1.doubanio.com/pic.jpg" } }, "https://img1.doubanio.com/cover.jpg"],
      [{ pic: { large: "https://img1.doubanio.com/pic.jpg" } }, "https://img1.doubanio.com/pic.jpg"],
      [{}, null],
    ] as const) {
      const provider = await factory((async () => Response.json({ id: "27602137", type: "tv", title: "我的大叔", ...picture })) as unknown as typeof fetch);
      expect((await provider.details(27602137, "tv")).posterUrl).toBe(expected);
    }
  });

  test("selects the earliest valid premiere and imports at most 100 names without source roles or photos", async () => {
    const provider = await factory((async () => Response.json({ ...show, pubdate: ["2018-04-01(中国)", "2018-02-30", "2018-03-21(韩国)"], actors: Array.from({ length: 110 }, (_, index) => ({ name: `演员${index}`, character: "未经核实的角色", avatar: { large: "https://img1.doubanio.com/actor.jpg" } })) })) as unknown as typeof fetch);
    const details = await provider.details(27602137, "tv");
    expect(details.releaseDate).toBe("2018-03-21");
    expect(details.cast).toHaveLength(100);
    expect(details.cast![0]).toEqual({ name: "演员0", character: "", profileUrl: null });
  });

  test("rejects malformed search subjects instead of caching an empty success", async () => {
    const provider = await factory((async () => Response.json({ items: [{ target: { id: "invalid", type: "tv", title: "大叔" } }] })) as unknown as typeof fetch);
    await expect(provider.search("大叔", "tv")).rejects.toMatchObject({ code: "DOUBAN_INVALID_RESPONSE", status: 502 });
  });

  test("rejects mismatched types and IDs; keeps absent dates and episode counts unknown", async () => {
    const provider = await factory((async () => Response.json(show)) as unknown as typeof fetch);
    await expect(provider.details(27602137, "movie")).rejects.toMatchObject({ status: 422, code: "DOUBAN_TYPE_MISMATCH" });
    const different = await factory((async () => Response.json({ ...show, id: "1" })) as unknown as typeof fetch);
    await expect(different.details(27602137, "tv")).rejects.toMatchObject({ status: 502, code: "DOUBAN_INVALID_RESPONSE" });
    for (const pubdate of [undefined, ["2018"], ["2018-02-30(韩国)"], ["2018-13-01"], ["unknown"]]) {
      const minimal = await factory((async () => Response.json({ id: "27602137", type: "tv", title: "我的大叔", pubdate })) as unknown as typeof fetch);
      expect(await minimal.details(27602137, "tv")).toMatchObject({ releaseDate: null, episodeCount: null, cast: [], posterUrl: null });
    }
    let calls = 0;
    const noFetch = await factory((async () => { calls++; return Response.json(show); }) as unknown as typeof fetch);
    for (const id of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) await expect(noFetch.details(id, "tv")).rejects.toMatchObject({ status: 400, code: "INVALID_ID" });
    expect(calls).toBe(0);
  });

  test("rejects HTML, verification, invalid JSON and rate limits without caching failed requests", async () => {
    for (const [response, status, code] of [
      [new Response("<html>verify</html>", { headers: { "Content-Type": "text/html" } }), 502, "DOUBAN_INVALID_RESPONSE"],
      [Response.json({ message: "需要登录验证", url: "https://sec.douban.com" }), 502, "DOUBAN_INVALID_RESPONSE"],
      [Response.json({ ...show, episodes_count: "sixteen" }), 502, "DOUBAN_INVALID_RESPONSE"],
      [new Response("no-json", { headers: { "Content-Type": "application/json" } }), 502, "DOUBAN_INVALID_RESPONSE"],
      [new Response("blocked", { status: 403 }), 502, "DOUBAN_VERIFICATION_REQUIRED"],
      [new Response("limited", { status: 429 }), 429, "DOUBAN_RATE_LIMITED"],
      [new Response("missing", { status: 404 }), 404, "DOUBAN_NOT_FOUND"],
    ] as const) {
      let calls = 0;
      const provider = await factory((async () => ++calls === 1 ? response : Response.json({ ...show, actors: [] })) as unknown as typeof fetch);
      await expect(provider.details(27602137, "tv")).rejects.toMatchObject({ status, code });
      expect((await provider.details(27602137, "tv")).title).toBe("我的大叔");
      expect(calls).toBe(2);
    }
  });

  test("deduplicates concurrent requests and bounds successful cache entries", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ids: number[] = [];
    const provider = await factory((async (input: Parameters<typeof fetch>[0]) => {
      const id = Number(new URL(String(input)).pathname.split("/").at(-1));
      ids.push(id);
      await gate;
      return Response.json({ ...show, id, actors: [] });
    }) as unknown as typeof fetch);
    const pending = [provider.details(27602137, "tv"), provider.details(27602137, "tv")];
    expect(ids).toEqual([27602137]);
    release();
    await Promise.all(pending);
    await provider.details(27602137, "tv");
    expect(ids).toEqual([27602137]);
    for (let id = 1; id <= 100; id++) await provider.details(id, "tv");
    await provider.details(27602137, "tv");
    expect(ids.filter(id => id === 27602137)).toHaveLength(2);
  });

  test("maps request timeout and network failures", async () => {
    const timeout = await factory((async () => { throw new DOMException("timeout", "TimeoutError"); }) as unknown as typeof fetch);
    await expect(timeout.search("大叔", "tv")).rejects.toMatchObject({ status: 504, code: "DOUBAN_TIMEOUT" });
    const offline = await factory((async () => { throw new TypeError("offline"); }) as unknown as typeof fetch);
    await expect(offline.search("大叔", "tv")).rejects.toMatchObject({ status: 502, code: "DOUBAN_UNAVAILABLE" });
  });
});
