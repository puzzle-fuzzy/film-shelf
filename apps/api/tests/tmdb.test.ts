import { describe, expect, test } from "bun:test";
import { createTmdbProvider } from "../src/tmdb";

const tmdbMovie = {
  id: 550,
  title: "搏击俱乐部",
  original_title: "Fight Club",
  poster_path: "/poster.jpg",
  release_date: "1999-10-15",
  overview: "电影简介",
};

describe("TMDB external boundary", () => {
  test("sends a server-side Bearer token, encodes Chinese search and maps poster metadata", async () => {
    let observedUrl: URL | undefined;
    let observedHeaders: Headers | undefined;
    const fetcher = (async (input: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
      observedUrl = new URL(String(input));
      observedHeaders = new Headers(options?.headers);
      return Response.json({ results: [tmdbMovie, { id: 1, title: "没有海报的电影", poster_path: null }] });
    }) as unknown as typeof fetch;
    const provider = createTmdbProvider("  private-test-token  ", fetcher);
    const results = await provider.search("搏击俱乐部 & Fight Club");
    expect(observedUrl!.origin).toBe("https://api.themoviedb.org");
    expect(observedUrl!.searchParams.get("query")).toBe("搏击俱乐部 & Fight Club");
    expect(observedUrl!.searchParams.get("language")).toBe("zh-CN");
    expect(observedHeaders!.get("Authorization")).toBe("Bearer private-test-token");
    expect(observedUrl!.search).not.toContain("private-test-token");
    expect(results[0]).toMatchObject({ tmdbId: 550, title: "搏击俱乐部", releaseDate: "1999-10-15", posterUrl: "https://image.tmdb.org/t/p/w500/poster.jpg" });
    expect(results[1].posterUrl).toBeNull();
    expect(results[1].releaseDate).toBeNull();
  });

  test("fetches selected movie credits and preserves cast order, missing images and release dates", async () => {
    const fetcher = (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/3/movie/550");
      expect(url.searchParams.get("append_to_response")).toBe("credits");
      return Response.json({ ...tmdbMovie, release_date: "", credits: { cast: [
        { name: "演员乙", character: "乙", order: 1, profile_path: "/person.jpg" },
        { name: "演员甲", character: "甲", order: 0, profile_path: null },
      ] } });
    }) as unknown as typeof fetch;
    const movie = await createTmdbProvider("test-token", fetcher).details(550);
    expect(movie.releaseDate).toBeNull();
    expect(movie.cast!.map((person) => person.name)).toEqual(["演员甲", "演员乙"]);
    expect(movie.cast![0].profileUrl).toBeNull();
    expect(movie.cast![1].profileUrl).toBe("https://image.tmdb.org/t/p/w185/person.jpg");
  });

  test("does not make a remote request when the token is missing", async () => {
    let called = false;
    const fetcher = (async () => { called = true; return Response.json({}); }) as unknown as typeof fetch;
    const provider = createTmdbProvider("", fetcher);
    expect(provider.configured).toBe(false);
    await expect(provider.search("电影")).rejects.toMatchObject({ status: 503, code: "TMDB_NOT_CONFIGURED" });
    expect(called).toBe(false);
  });

  test("distinguishes unauthorized, rate limit, unavailable and malformed upstream responses", async () => {
    for (const [status, code, mappedStatus] of [
      [401, "TMDB_AUTH_FAILED", 502],
      [403, "TMDB_AUTH_FAILED", 502],
      [404, "TMDB_MOVIE_NOT_FOUND", 404],
      [429, "TMDB_RATE_LIMITED", 429],
      [500, "TMDB_UNAVAILABLE", 502],
      [200, "TMDB_INVALID_RESPONSE", 502],
    ] as const) {
      const fetcher = (async () => new Response("non-json upstream response", { status })) as unknown as typeof fetch;
      await expect(createTmdbProvider("test-token", fetcher).search("电影")).rejects.toMatchObject({ status: mappedStatus, code });
    }
    const malformed = (async () => Response.json({ results: [{}] })) as unknown as typeof fetch;
    await expect(createTmdbProvider("test-token", malformed).search("电影")).rejects.toMatchObject({ status: 502, code: "TMDB_INVALID_RESPONSE" });
  });

  test("reports timeouts and connection failures as actionable errors", async () => {
    const timeout = (async () => { throw new DOMException("timed out", "TimeoutError"); }) as unknown as typeof fetch;
    const offline = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(createTmdbProvider("test-token", timeout).search("电影")).rejects.toMatchObject({ status: 504, code: "TMDB_TIMEOUT" });
    await expect(createTmdbProvider("test-token", offline).search("电影")).rejects.toMatchObject({ status: 502, code: "TMDB_UNAVAILABLE" });
  });
});
