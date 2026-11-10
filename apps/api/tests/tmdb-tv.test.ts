import { describe, expect, test } from "bun:test";
import { createTmdbProvider } from "../src/tmdb";
import { tmdbMetadataProvider } from "../src/metadata";
import { movieInputSchema } from "../src/validation";

const show = { id: 42, name: "我的大叔", original_name: "나의 아저씨", first_air_date: "2018-03-21", poster_path: "/show.jpg", overview: "电视剧简介", number_of_episodes: 16 };
const tvDetails = { ...show, aggregate_credits: { cast: [
  { id: 9, name: "李知恩", order: 1, roles: [{ character: "李至安" }, { character: "成年李至安" }, { character: "李至安" }] },
  { id: 8, name: "李善均", order: 0, roles: [{ character: "朴东勋" }] },
] } };

describe("TMDB television boundary", () => {
  test("metadata adapter preserves source IDs and explicit media types for API consistency validation", async () => {
    const provider = tmdbMetadataProvider({ configured: true, async search() { return []; }, async details() { return { title: "意外条目", tmdbId: 99, mediaType: "movie" }; } });
    expect(await provider.details(42, "tv")).toMatchObject({ tmdbId: 99, mediaType: "movie" });
  });
  test("maps TV search fields and uses the television endpoint", async () => {
    const provider = createTmdbProvider("token", (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/3/search/tv");
      expect(url.searchParams.get("query")).toBe("我的大叔");
      return Response.json({ results: [show] });
    }) as unknown as typeof fetch);
    expect(await provider.search("我的大叔", "tv")).toEqual([{ mediaType: "tv", tmdbId: 42, title: "我的大叔", originalTitle: "나의 아저씨", releaseDate: "2018-03-21", posterUrl: "https://image.tmdb.org/t/p/w500/show.jpg", overview: "电视剧简介" }]);
  });

  test("preserves TV origin countries in source-neutral search candidates", async () => {
    const provider = tmdbMetadataProvider(createTmdbProvider("token", (async () =>
      Response.json({ results: [{ ...show, origin_country: ["KR", "US"] }] })
    ) as unknown as typeof fetch));
    const [candidate] = await provider.search("我的大叔", "tv");
    expect(candidate?.countries).toEqual(["KR", "US"]);
    expect(candidate).toMatchObject({ provider: "tmdb", mediaType: "tv", externalId: 42 });
  });

  test("keeps country-bearing TV details valid for the strict import schema", async () => {
    const provider = tmdbMetadataProvider(createTmdbProvider("token", (async () =>
      Response.json({ ...tvDetails, origin_country: ["KR"], year: "2018" })
    ) as unknown as typeof fetch));
    const details = await provider.details(42, "tv");
    expect(movieInputSchema.parse(details)).toMatchObject({
      mediaType: "tv", tmdbId: 42, title: "我的大叔", episodeCount: 16,
      cast: [{ name: "李善均" }, { name: "李知恩" }],
    });
    expect(details).not.toHaveProperty("countries");
    expect(details).not.toHaveProperty("year");
  });

  test("loads full-show aggregate credits, merges roles and isolates movie/TV caches", async () => {
    const paths: string[] = [];
    const provider = createTmdbProvider("token", (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname === "/3/movie/42") return Response.json({ id: 42, title: "电影", credits: { cast: [] } });
      expect(url.pathname).toBe("/3/tv/42");
      expect(url.searchParams.get("append_to_response")).toBe("aggregate_credits");
      return Response.json(tvDetails);
    }) as unknown as typeof fetch);
    const result = await provider.details(42, "tv");
    expect(result).toMatchObject({ mediaType: "tv", tmdbId: 42, episodeCount: 16, title: "我的大叔", releaseDate: "2018-03-21" });
    expect(result.cast).toEqual([
      { tmdbPersonId: 8, name: "李善均", character: "朴东勋", profileUrl: null },
      { tmdbPersonId: 9, name: "李知恩", character: "李至安 / 成年李至安", profileUrl: null },
    ]);
    expect((await provider.details(42)).title).toBe("电影");
    await provider.details(42, "tv");
    expect(paths).toEqual(["/3/tv/42", "/3/movie/42"]);
  });

  test("uses an optional English overview fallback while preserving Chinese fields and credits", async () => {
    const languages: string[] = [];
    const provider = createTmdbProvider("token", (async (input: Parameters<typeof fetch>[0]) => {
      const language = new URL(String(input)).searchParams.get("language")!;
      languages.push(language);
      return Response.json(language === "zh-CN" ? { ...tvDetails, overview: "" } : { ...show, name: "My Mister", overview: "English synopsis" });
    }) as unknown as typeof fetch);
    expect(await provider.details(42, "tv")).toMatchObject({ title: "我的大叔", overview: "English synopsis", cast: [{ name: "李善均" }, { name: "李知恩" }] });
    expect(languages).toEqual(["zh-CN", "en-US"]);
    const failingFallback = createTmdbProvider("token", (async (input: Parameters<typeof fetch>[0]) => new URL(String(input)).searchParams.get("language") === "zh-CN" ? Response.json({ ...tvDetails, overview: "" }) : new Response("unavailable", { status: 500 })) as unknown as typeof fetch);
    expect((await failingFallback.details(42, "tv")).overview).toBe("");
  });

  test("loads person TV cast credits and keeps the actor movie/TV caches isolated", async () => {
    const appends: string[] = [];
    const provider = createTmdbProvider("token", (async (input: Parameters<typeof fetch>[0]) => {
      const append = new URL(String(input)).searchParams.get("append_to_response")!;
      appends.push(append);
      return Response.json({ id: 9, name: "李知恩", [append]: { cast: append === "tv_credits" ? [{ ...show, character: "李至安" }, { ...show, character: "至安" }] : [{ id: 42, title: "电影", character: "演员" }] } });
    }) as unknown as typeof fetch);
    const result = await provider.actorFilmography!(9, "tv");
    expect(result.movies).toHaveLength(1);
    expect(result.movies[0]).toMatchObject({ mediaType: "tv", tmdbId: 42, title: "我的大叔", releaseDate: "2018-03-21", character: "李至安 / 至安" });
    expect((await provider.actorFilmography!(9)).movies[0].title).toBe("电影");
    await provider.actorFilmography!(9, "tv");
    expect(appends).toEqual(["tv_credits", "movie_credits"]);
  });
});
