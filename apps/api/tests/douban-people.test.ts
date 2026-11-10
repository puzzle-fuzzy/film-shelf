import { describe, expect, test } from "bun:test";
import { createDoubanProvider } from "../src/douban";

const profile = "https://img3.doubanio.com/view/personage/m/public/9857d63a35c38fdd324cd0f6af2d0f13.jpg";
const subject = { id: "37335468", type: "tv", title: "努力克服自卑的我们", actors: [{ name: "具教焕" }] };
const person = {
  id: "27579062", type: "subject", subtype: "person", title: "具教焕", latin_title: "Kyo-hwan Koo",
  cover: { normal: { url: profile }, large: { url: profile.replace("/m/", "/l/") } },
  extra: { info: [["性别", "男"], ["IMDb编号", "nm3640854"]] },
};
const work = (id: number, type: "movie" | "tv", title: string, date: string | null, roles = ["演员"]) => ({
  roles, work: { id: String(id), type, title, year: date?.slice(0, 4), pubdate: date ? [`${date}(韩国)`] : [], cover_url: "https://img3.doubanio.com/view/photo/m_ratio_poster/public/p2931033503.jpg" },
});

describe("Douban actor identities and complete filmography", () => {
  test("does not repeat complete credits requests", async () => {
    let credits = 0;
    const provider = createDoubanProvider((async (input) => {
      if (!new URL(String(input)).pathname.endsWith("/celebrities")) return Response.json(subject);
      credits++;
      return Response.json({ actors: [{ id: "1363439", name: "具教焕", avatar: { large: profile } }] });
    }) as typeof fetch);
    expect((await provider.details(37335468, "tv")).cast?.[0]?.doubanPersonId).toBe(1363439);
    expect(credits).toBe(1);
  });

  test("merges incomplete anonymous credits and stops as soon as every subject actor has an identity", async () => {
    const urls: string[] = [];
    const provider = createDoubanProvider((async (input) => {
      if (!new URL(String(input)).pathname.endsWith("/celebrities")) return Response.json({ ...subject, actors: [{ name: "具教焕" }, { name: "高允贞" }] });
      urls.push(String(input));
      return Response.json({ actors: urls.length === 1
        ? [{ id: "1363439", name: "具教焕", avatar: { large: profile } }]
        : [{ id: "1363439", name: "具教焕", avatar: { large: profile } }, { id: "1412933", name: "高允贞", avatar: { normal: profile } }] });
    }) as typeof fetch);
    expect((await provider.details(37335468, "tv")).cast).toEqual([
      { name: "具教焕", character: "", profileUrl: profile, doubanPersonId: 1363439 },
      { name: "高允贞", character: "", profileUrl: profile, doubanPersonId: 1412933 },
    ]);
    expect(urls).toEqual([
      "https://m.douban.com/rexxar/api/v2/tv/37335468/celebrities?count=100",
      "https://m.douban.com/rexxar/api/v2/tv/37335468/celebrities?count=100",
    ]);
  });

  test("bounds incomplete credits attempts and keeps conflicting identities ambiguous across responses", async () => {
    let credits = 0;
    const provider = createDoubanProvider((async (input) => {
      if (!new URL(String(input)).pathname.endsWith("/celebrities")) return Response.json({ ...subject, actors: [{ name: "具教焕" }, { name: "高允贞" }] });
      credits++;
      return Response.json({ actors: credits === 1
        ? [{ id: "1363439", name: "具教焕", avatar: { large: profile } }]
        : [{ id: "100", name: "具教焕", avatar: { large: profile } }, { id: "1412933", name: "高允贞", avatar: { normal: profile } }] });
    }) as typeof fetch);
    expect((await provider.details(37335468, "tv")).cast).toEqual([
      { name: "具教焕", character: "", profileUrl: null },
      { name: "高允贞", character: "", profileUrl: profile, doubanPersonId: 1412933 },
    ]);
    expect(credits).toBe(3);
  });

  test("retains partial credits and stops immediately when a later normal request fails", async () => {
    let credits = 0;
    const provider = createDoubanProvider((async (input) => {
      if (!new URL(String(input)).pathname.endsWith("/celebrities")) return Response.json({ ...subject, actors: [{ name: "具教焕" }, { name: "高允贞" }] });
      credits++;
      return credits === 1
        ? Response.json({ actors: [{ id: "1363439", name: "具教焕", avatar: { large: profile } }] })
        : new Response("verification", { status: 403 });
    }) as typeof fetch);
    expect((await provider.details(37335468, "tv")).cast).toEqual([
      { name: "具教焕", character: "", profileUrl: profile, doubanPersonId: 1363439 },
      { name: "高允贞", character: "", profileUrl: null },
    ]);
    expect(credits).toBe(2);
  });

  test("attaches only unique exact-name safe actor IDs without changing the subject cast", async () => {
    const provider = createDoubanProvider((async (input) => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith("/celebrities")) return Response.json({ ...subject, actors: [{ name: "具教焕" }, { name: "同名" }, { name: "非法ID" }, { name: "缺ID" }] });
      expect(url.searchParams.get("count")).toBe("100");
      expect(url.searchParams.has("start")).toBe(false);
      return Response.json({ actors: [
        { id: "1363439", name: "具教焕", avatar: { large: profile } },
        { id: "1", name: "同名", avatar: { large: profile } },
        { id: "2", name: "同名", avatar: { large: profile } },
        { id: "9007199254740992", name: "非法ID", avatar: { large: profile } },
        { name: "缺ID", avatar: { large: profile } },
        { id: "5", name: "名单外", avatar: { large: profile } },
      ] });
    }) as typeof fetch);
    expect((await provider.details(37335468, "tv")).cast).toEqual([
      { name: "具教焕", character: "", profileUrl: profile, doubanPersonId: 1363439 },
      { name: "同名", character: "", profileUrl: null },
      { name: "非法ID", character: "", profileUrl: profile },
      { name: "缺ID", character: "", profileUrl: profile },
    ]);
  });

  test("reads migrated personage metadata with the requested celebrity ID and shares successful requests", async () => {
    let requests = 0;
    const provider = createDoubanProvider((async (input, init) => {
      requests++;
      expect(String(input)).toBe("https://m.douban.com/rexxar/api/v2/celebrity/1363439");
      expect(init?.credentials).toBe("omit");
      expect(init?.redirect).toBe("error");
      return Response.json(person);
    }) as typeof fetch);
    expect(typeof provider.actor).toBe("function");
    const results = await Promise.all([provider.actor!(1363439), provider.actor!(1363439)]);
    expect(results[0]).toEqual({ doubanPersonId: 1363439, name: "具教焕", profileUrl: profile, imdbId: "nm3640854" });
    expect(results[1]).toEqual(results[0]);
    await provider.actor!(1363439);
    expect(requests).toBe(1);
  });

  test("accepts duplicate credits for the same actor identity and photo while rejecting different same-name identities", async () => {
    const provider = createDoubanProvider((async (input) => new URL(String(input)).pathname.endsWith("/celebrities")
      ? Response.json({ actors: [
        { id: "1363439", name: "具教焕", character: "饰 黄东万", avatar: { normal: profile } },
        { id: 1363439, name: "具教焕", character: "其他角色", avatar: { large: profile } },
        { id: "10", name: "同名", avatar: { large: profile } },
        { id: "11", name: "同名", avatar: { large: profile } },
      ] })
      : Response.json({ ...subject, actors: [{ name: "具教焕" }, { name: "同名" }] })) as typeof fetch);
    expect((await provider.details(37335468, "tv")).cast).toEqual([
      { name: "具教焕", character: "", profileUrl: profile, doubanPersonId: 1363439 },
      { name: "同名", character: "", profileUrl: null },
    ]);
  });

  test("does not guess IMDb identities or trust foreign actor images", async () => {
    for (const info of [
      [["简介", "nm3640854"]],
      [["IMDb编号", "https://www.imdb.com/name/nm3640854/"]],
      [["IMDb编号", "nm3640854"], ["IMDb编号", "nm1234"]],
    ]) {
      const provider = createDoubanProvider((async () => Response.json({ id: "1363439", name: "具教焕", avatar: { large: "https://evil.test/person.jpg" }, extra: { info } })) as unknown as typeof fetch);
      expect(typeof provider.actor).toBe("function");
      expect(await provider.actor!(1363439)).toEqual({ doubanPersonId: 1363439, name: "具教焕", profileUrl: null, imdbId: null });
    }
  });

  test("rejects invalid actor IDs before any source request", async () => {
    let requests = 0;
    const provider = createDoubanProvider((async () => { requests++; return Response.json(person); }) as unknown as typeof fetch);
    for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => provider.actor!(id)).toThrow("资料 ID 必须是正整数");
      expect(() => provider.actorFilmography!(id, "tv")).toThrow("资料 ID 必须是正整数");
    }
    expect(requests).toBe(0);
  });

  test("loads every count-10 page before filtering acting works, merging duplicate roles and sorting by release date", async () => {
    const offsets: string[] = [];
    const pages = [
      [work(1, "tv", "较早", "2020-01-01", ["演员 (饰 小明)"]), work(2, "movie", "电影", "2025-01-01"), work(3, "tv", "导演作品", "2024-01-01", ["导演"]), ...Array.from({ length: 7 }, (_, i) => work(10 + i, "movie", `电影${i}`, "2010-01-01"))],
      [work(4, "tv", "最近", "2026-04-18", ["演员 (饰 黄东万)"]), work(1, "tv", "较早", "2020-01-01", ["演员 (饰 第二角色)"]), work(5, "tv", "待定", null), work(6, "tv", "同日", "2020-01-01")],
    ];
    const provider = createDoubanProvider((async (input) => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith("/works")) return Response.json(person);
      expect(url.searchParams.get("count")).toBe("10");
      expect(url.searchParams.get("sort")).toBe("time");
      offsets.push(url.searchParams.get("start")!);
      const start = Number(url.searchParams.get("start"));
      return Response.json({ start, count: 10, total: 14, works: pages[start / 10] });
    }) as typeof fetch);
    expect(typeof provider.actorFilmography).toBe("function");
    const [result, duplicate] = await Promise.all([provider.actorFilmography!(1363439, "tv"), provider.actorFilmography!(1363439, "tv")]);
    expect(offsets).toEqual(["0", "10"]);
    expect(result.actor).toEqual({ tmdbPersonId: null, doubanPersonId: 1363439, name: "具教焕", profileUrl: profile });
    expect(result.movies.map(movie => [movie.doubanId, movie.title, movie.character])).toEqual([
      [4, "最近", "黄东万"], [6, "同日", ""], [1, "较早", "小明 / 第二角色"], [5, "待定", ""],
    ]);
    expect(result.movies.every(movie => movie.tmdbId === null && movie.provider === "douban" && movie.mediaType === "tv")).toBe(true);
    expect(duplicate).toEqual(result);
  });

  test("fails explicitly for oversized or incomplete filmographies and retries failures", async () => {
    let total = 1001;
    let requests = 0;
    const provider = createDoubanProvider((async (input) => {
      if (!new URL(String(input)).pathname.endsWith("/works")) return Response.json(person);
      requests++;
      return Response.json({ start: 0, count: 10, total, works: [] });
    }) as typeof fetch);
    expect(typeof provider.actorFilmography).toBe("function");
    await expect(provider.actorFilmography!(1363439, "movie")).rejects.toMatchObject({ status: 502, code: "DOUBAN_FILMOGRAPHY_TOO_LARGE" });
    total = 11;
    await expect(provider.actorFilmography!(1363439, "movie")).rejects.toMatchObject({ status: 502, code: "DOUBAN_INVALID_RESPONSE" });
    total = 0;
    expect((await provider.actorFilmography!(1363439, "movie")).movies).toEqual([]);
    expect(requests).toBe(3);
  });
});

describe("Douban subject IMDb crosswalk", () => {
  test("extracts only the IMDb table row from a fixed subject info path and reuses subject metadata", async () => {
    const requests: string[] = [];
    const provider = createDoubanProvider((async (input, init) => {
      const url = new URL(String(input));
      requests.push(String(url));
      expect(init?.credentials).toBe("omit");
      expect(init?.redirect).toBe("error");
      if (url.pathname.startsWith("/rexxar/")) return Response.json({ ...subject, actors: [], info_url: "https://www.douban.com/doubanapp//h5/movie/37335468/desc" });
      expect(url.origin).toBe("https://www.douban.com");
      expect(url.pathname).toBe("/doubanapp/h5/movie/37335468/desc");
      return new Response('<section class="subject-desc"><h1>影片信息</h1><table><tr><td>IMDb</td><td><a href="https://www.imdb.com/title/tt36732944/">tt36732944</a></td></tr></table></section><script>"tt99999"</script>', { headers: { "Content-Type": "text/html" } });
    }) as typeof fetch);
    await provider.details(37335468, "tv");
    expect(typeof provider.imdbId).toBe("function");
    expect(await provider.imdbId!(37335468, "tv")).toBe("tt36732944");
    expect(await provider.imdbId!(37335468, "tv")).toBe("tt36732944");
    expect(requests).toHaveLength(2);
  });

  test("ignores absent or ambiguous IMDb rows rather than scanning unrelated HTML", async () => {
    for (const html of [
      '<section class="subject-desc"><h1>影片信息</h1><table><tr><td>主演</td><td>tt36732944</td></tr></table></section>',
      '<section class="subject-desc"><h1>影片信息</h1><table><tr><td>IMDb</td><td>tt36732944 tt1234</td></tr></table></section>',
    ]) {
      const provider = createDoubanProvider((async (input) => new URL(String(input)).pathname.startsWith("/rexxar/")
        ? Response.json({ ...subject, actors: [], info_url: "https://www.douban.com/doubanapp//h5/movie/37335468/desc" })
        : new Response(html, { headers: { "Content-Type": "text/html" } })) as typeof fetch);
      expect(typeof provider.imdbId).toBe("function");
      expect(await provider.imdbId!(37335468, "tv")).toBeNull();
    }
  });

  test("rejects foreign or different-subject info URLs before requesting them", async () => {
    for (const info_url of ["https://evil.test/doubanapp/h5/movie/37335468/desc", "https://m.douban.com/doubanapp/h5/movie/1/desc"]) {
      let requests = 0;
      const provider = createDoubanProvider((async () => { requests++; return Response.json({ ...subject, actors: [], info_url }); }) as unknown as typeof fetch);
      expect(typeof provider.imdbId).toBe("function");
      await expect(provider.imdbId!(37335468, "tv")).rejects.toMatchObject({ status: 502, code: "DOUBAN_INVALID_RESPONSE" });
      expect(requests).toBe(1);
    }
  });

  test("surfaces verification, oversized HTML and interrupted bodies without caching a failed crosswalk", async () => {
    let attempts = 0;
    const provider = createDoubanProvider((async (input) => {
      if (new URL(String(input)).pathname.startsWith("/rexxar/")) return Response.json({ ...subject, actors: [], info_url: "https://www.douban.com/doubanapp//h5/movie/37335468/desc" });
      attempts++;
      if (attempts === 1) return new Response("verify", { status: 403 });
      if (attempts === 2) return new Response("large", { headers: { "Content-Type": "text/html", "Content-Length": "262145" } });
      if (attempts === 3) return new Response(new ReadableStream({ start(controller) { controller.error(new DOMException("timeout", "TimeoutError")); } }), { headers: { "Content-Type": "text/html" } });
      return new Response('<section class="subject-desc"><h1>影片信息</h1><table><tr><td>IMDb</td><td>tt36732944</td></tr></table></section>', { headers: { "Content-Type": "text/html" } });
    }) as typeof fetch);
    await expect(provider.imdbId!(37335468, "tv")).rejects.toMatchObject({ status: 502, code: "DOUBAN_VERIFICATION_REQUIRED" });
    await expect(provider.imdbId!(37335468, "tv")).rejects.toMatchObject({ status: 502, code: "DOUBAN_INVALID_RESPONSE" });
    await expect(provider.imdbId!(37335468, "tv")).rejects.toMatchObject({ status: 504, code: "DOUBAN_TIMEOUT" });
    expect(await provider.imdbId!(37335468, "tv")).toBe("tt36732944");
    expect(attempts).toBe(4);
  });
});
