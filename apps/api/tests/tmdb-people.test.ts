import { describe, expect, test } from "bun:test";
import { createTmdbProvider } from "../src/tmdb";

const credit = (id: number, release_date = "2024-02-01", character = "主角") => ({
  id, title: `电影 ${id}`, original_title: `Movie ${id}`, poster_path: `/movie-${id}.jpg`,
  release_date, overview: "电影简介", character,
});
const person = {
  id: 42, name: "测试演员", profile_path: "/person.jpg",
  movie_credits: { cast: [credit(11)], crew: [] as unknown[] },
};

describe("TMDB people boundary", () => {
  test("fetches Chinese movie credits using a server-side token, includes cast only, deduplicates roles and sorts released films before unknown dates", async () => {
    let requests = 0;
    const fetcher = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requests++;
      const url = new URL(String(input));
      expect(url.origin).toBe("https://api.themoviedb.org");
      expect(url.pathname).toBe("/3/person/42");
      expect(url.searchParams.get("language")).toBe("zh-CN");
      expect(url.searchParams.get("append_to_response")).toBe("movie_credits");
      expect(url.searchParams.has("page")).toBe(false);
      expect(url.search).not.toContain("private-token");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer private-token");
      return Response.json({ ...person, movie_credits: { cast: [
        credit(30, "1999-01-01"), credit(20, "2024-02-01", "角色甲"), credit(40, ""),
        credit(20, "2024-02-01", "角色乙"), credit(20, "2024-02-01", "角色甲"),
        { id: 50, title: "未定档作品", poster_path: null },
      ], crew: [{ ...credit(99, "2025-01-01"), job: "Director" }] } });
    }) as unknown as typeof fetch;
    const provider = createTmdbProvider("  private-token  ", fetcher);
    const result = await provider.actorFilmography!(42);
    expect(result.actor).toEqual({ tmdbPersonId: 42, name: person.name, profileUrl: "https://image.tmdb.org/t/p/w185/person.jpg" });
    expect(result.movies.map(movie => movie.tmdbId)).toEqual([20, 30, 50, 40]);
    expect(result.movies[0]).toMatchObject({ title: "电影 20", originalTitle: "Movie 20", posterUrl: "https://image.tmdb.org/t/p/w500/movie-20.jpg", releaseDate: "2024-02-01" });
    expect(result.movies[0]!.character).toContain("角色甲");
    expect(result.movies[0]!.character).toContain("角色乙");
    expect(result.movies[0]!.character.match(/角色甲/g)).toHaveLength(1);
    expect(result.movies.slice(2).map(movie => movie.releaseDate)).toEqual([null, null]);
    expect(result.movies[2]!.posterUrl).toBeNull();
    expect(await provider.actorFilmography!(42)).toEqual(result);
    expect(requests).toBe(1);
  });

  test("shares concurrent requests and keeps a bounded cache of successful actor responses", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetchedIds: number[] = [];
    const fetcher = (async (input: Parameters<typeof fetch>[0]) => {
      const id = Number(new URL(String(input)).pathname.split("/").at(-1));
      fetchedIds.push(id);
      await gate;
      return Response.json({ ...person, id });
    }) as unknown as typeof fetch;
    const provider = createTmdbProvider("test-token", fetcher);
    const pending = [provider.actorFilmography!(42), provider.actorFilmography!(42), provider.actorFilmography!(42)];
    expect(fetchedIds).toEqual([42]);
    release();
    const results = await Promise.all(pending);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    await provider.actorFilmography!(42);
    expect(fetchedIds).toEqual([42]);
    for (let id = 100; id < 200; id++) await provider.actorFilmography!(id);
    await provider.actorFilmography!(42);
    expect(fetchedIds.filter(id => id === 42)).toHaveLength(2);
  });

  test("distinguishes missing token, missing actor and malformed or failed upstream responses without caching failures", async () => {
    let called = false;
    const noToken = createTmdbProvider("", (async () => { called = true; throw new Error("Unexpected network"); }) as unknown as typeof fetch);
    await expect(noToken.actorFilmography!(42)).rejects.toMatchObject({ status: 503, code: "TMDB_NOT_CONFIGURED" });
    expect(called).toBe(false);
    for (const [status, code, mappedStatus] of [
      [404, "TMDB_PERSON_NOT_FOUND", 404], [401, "TMDB_AUTH_FAILED", 502],
      [429, "TMDB_RATE_LIMITED", 429], [500, "TMDB_UNAVAILABLE", 502],
    ] as const) {
      const fetcher = (async () => new Response("upstream failure", { status })) as unknown as typeof fetch;
      await expect(createTmdbProvider("test-token", fetcher).actorFilmography!(42)).rejects.toMatchObject({ status: mappedStatus, code });
    }
    for (const payload of [
      { id: 42, name: person.name },
      { ...person, movie_credits: { cast: [{ id: "11", title: "错误 ID" }] } },
      { ...person, movie_credits: { cast: null } },
    ]) {
      let calls = 0;
      const fetcher = (async () => { calls++; return Response.json(calls === 1 ? payload : person); }) as unknown as typeof fetch;
      const provider = createTmdbProvider("test-token", fetcher);
      await expect(provider.actorFilmography!(42)).rejects.toMatchObject({ status: 502, code: "TMDB_INVALID_RESPONSE" });
      expect((await provider.actorFilmography!(42)).movies).toHaveLength(1);
      expect(calls).toBe(2);
    }
  });

  test("preserves optional positive person IDs on movie cast while remaining compatible with credits without IDs", async () => {
    const fetcher = (async () => Response.json({ ...credit(11), credits: { cast: [
      { id: 42, name: "已知演员", character: "主角", profile_path: "/person.jpg", order: 0 },
      { name: "旧资料演员", character: "配角", profile_path: null, order: 1 },
    ] } })) as unknown as typeof fetch;
    const movie = await createTmdbProvider("test-token", fetcher).details(11);
    expect(movie.cast).toEqual([
      { tmdbPersonId: 42, name: "已知演员", character: "主角", profileUrl: "https://image.tmdb.org/t/p/w185/person.jpg" },
      { name: "旧资料演员", character: "配角", profileUrl: null },
    ]);
    expect(Object.hasOwn(movie.cast![1]!, "tmdbPersonId")).toBe(false);
    for (const id of [0, -1, "42"]) {
      const invalid = (async () => Response.json({ ...credit(11), credits: { cast: [{ id, name: "演员", character: "主角" }] } })) as unknown as typeof fetch;
      await expect(createTmdbProvider("test-token", invalid).details(11)).rejects.toMatchObject({ status: 502, code: "TMDB_INVALID_RESPONSE" });
    }
  });
});
