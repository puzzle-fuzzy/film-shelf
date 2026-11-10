import { describe, expect, test } from "bun:test";
import { actorLink, actorMoviePath, actorPageSearch, backNavigation, homeLocation, mediaTypeFromSearch, movieDetailLink, nextNavigationState, providerFromSearch, safeInternalPath } from "../../web/src/lib/navigation";
import { getActorMovies, getCatalogMovie } from "../../web/src/lib/api";

describe("media navigation", () => {
  test("filter changes can reset both shelves and pagination keeps the filter", () => {
    expect(homeLocation(1, 1, "", "tv")).toEqual({ pathname: "/", search: "?mediaType=tv", hash: "" });
    expect(homeLocation(3, 2, "#recently-watched", "tv")).toEqual({ pathname: "/", search: "?mediaType=tv&recommendedPage=3&watchedPage=2", hash: "#recently-watched" });
    expect(homeLocation(1, 1)).toEqual({ pathname: "/", search: "", hash: "" });
    expect(mediaTypeFromSearch(new URLSearchParams("mediaType=tv"))).toBe("tv");
    expect(mediaTypeFromSearch(new URLSearchParams("mediaType=unknown"))).toBeUndefined();
  });

  test("a direct detail URL returns to both original filtered pages and shelf anchor", () => {
    const home = { ...homeLocation(3, 2, "#recently-watched", "tv"), state: null };
    const link = movieDetailLink("/movies/27", home);
    expect(typeof link).toBe("object");
    if (typeof link === "string") throw new Error("Expected a detail URL with return navigation");
    expect(backNavigation({ ...link, state: null }).to).toBe("/?mediaType=tv&recommendedPage=3&watchedPage=2#recently-watched");
  });

  test("TV catalog to actor to original detail retains the return trail", () => {
    const home = { ...homeLocation(2, 4, "", "tv"), state: null };
    const detailLink = movieDetailLink("/movies/27", home);
    if (typeof detailLink === "string") throw new Error("Expected return navigation");
    const detail = { ...detailLink, state: null };
    const actor = { pathname: "/actors/15", search: "?mediaType=tv&page=2", state: nextNavigationState(detail) };
    const catalogLink = movieDetailLink("/catalog/tv/99", actor);
    if (typeof catalogLink === "string") throw new Error("Expected return navigation");
    const backToActor = backNavigation({ ...catalogLink, state: null });
    expect(backToActor.to).toBe("/actors/15?mediaType=tv&page=2");
    const backToDetail = backNavigation({ ...actor, state: backToActor.state });
    expect(backToDetail.to).toBe("/movies/27");
    expect(backNavigation({ ...detail, state: backToDetail.state }).to).toBe("/?mediaType=tv&recommendedPage=2&watchedPage=4");
  });

  test("legacy movie links remain valid while unsafe return parameters are rejected", () => {
    for (const path of ["/movies/27", "/catalog/movies/99", "/catalog/tv/99", "/actors/15?page=2", "/?recommendedPage=2", "/?mediaType=movie", "/actors/15?mediaType=movie&page=2"]) expect(safeInternalPath(path)).toBe(path);
    for (const path of ["https://example.com", "//example.com", "/?mediaType=bad", "/?mediaType=tv&mediaType=movie", "/actors/15?mediaType=tv&page=0", "/catalog/tv/0", "/catalog/tv/99?page=2", "/?recommendedPage=2&redirect=elsewhere"]) expect(safeInternalPath(path)).toBeNull();
  });

  test("Douban actor URLs preserve provider through direct catalog detail return trails", () => {
    const actor = { pathname: "/actors/1026115", search: "?provider=douban&mediaType=tv&page=2", state: { from: "/movies/27", trail: ["/?mediaType=tv"] } };
    expect(safeInternalPath(actor.pathname + actor.search)).toBe("/actors/1026115?provider=douban&mediaType=tv&page=2");
    for (const pathname of ["/catalog/douban/tv/37322496", "/catalog/douban/movies/37322496"]) {
      expect(safeInternalPath(pathname)).toBe(pathname);
      const detail = movieDetailLink(pathname, actor);
      if (typeof detail === "string") throw new Error("Expected return navigation");
      const back = backNavigation({ ...detail, state: null });
      expect(back.to).toBe("/actors/1026115?provider=douban&mediaType=tv&page=2");
      expect(backNavigation({ ...actor, state: back.state }).to).toBe("/movies/27");
    }
  });

  test("provider is restricted to supported actor URLs and cannot bypass catalog return validation", () => {
    for (const path of ["/actors/15?provider=douban", "/actors/15?provider=tmdb&mediaType=tv&page=3"]) expect(safeInternalPath(path)).toBe(path);
    for (const path of ["/?provider=douban", "/watched?provider=douban", "/actors/15?provider=other", "/actors/15?provider=douban&provider=tmdb", "/movies/15?provider=douban", "/catalog/douban/tv/15?provider=douban", "/catalog/douban/tv/0", "/catalog/douban/tv/15?page=2", "/actors/15?provider=douban&redirect=//example.com"]) expect(safeInternalPath(path)).toBeNull();
  });

  test("actor pagination and media switches retain the Douban identity", () => {
    expect(actorPageSearch("tv", 3, "douban").toString()).toBe("provider=douban&mediaType=tv&page=3");
    expect(actorPageSearch("movie", 1, "douban").toString()).toBe("provider=douban");
    expect(actorPageSearch("tv", 2).toString()).toBe("mediaType=tv&page=2");
    expect(actorPageSearch("movie", 2, "tmdb").toString()).toBe("provider=tmdb&page=2");
    expect(providerFromSearch(new URLSearchParams("provider=douban"))).toBe("douban");
    expect(providerFromSearch(new URLSearchParams("provider=unknown"))).toBeUndefined();
  });

  test("actor and credit links prefer library or valid TMDB identity before a Douban fallback", () => {
    expect(actorLink({ tmdbPersonId: 22, doubanPersonId: 1026115 }, "tv")).toBe("/actors/22?mediaType=tv");
    expect(actorLink({ tmdbPersonId: null, doubanPersonId: 1026115 }, "tv")).toBe("/actors/1026115?provider=douban&mediaType=tv");
    expect(actorLink({ tmdbPersonId: 0, doubanPersonId: 1026115 }, "movie")).toBe("/actors/1026115?provider=douban");
    expect(actorLink({ tmdbPersonId: null, doubanPersonId: -1 }, "tv")).toBeNull();
    expect(actorMoviePath({ libraryMovieId: 27, tmdbId: null, doubanId: 37322496, provider: "douban" }, "tv")).toBe("/movies/27");
    expect(actorMoviePath({ libraryMovieId: null, tmdbId: 45, doubanId: 37322496, provider: "tmdb" }, "tv")).toBe("/catalog/tv/45");
    expect(actorMoviePath({ libraryMovieId: null, tmdbId: null, doubanId: 37322496, provider: "douban" }, "tv")).toBe("/catalog/douban/tv/37322496");
    expect(actorMoviePath({ libraryMovieId: null, tmdbId: null, doubanId: 37322496, provider: "douban" }, "movie")).toBe("/catalog/douban/movies/37322496");
  });

  test("actor requests carry provider while default TMDB requests remain backward compatible", async () => {
    const originalFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      requested.push(String(url));
      return String(url).startsWith("/api/catalog/")
        ? Response.json({ movie: { tmdbId: null, doubanId: 37322496, mediaType: "tv", episodeCount: 10, title: "剧集", originalTitle: "Series", posterUrl: null, releaseDate: null, overview: "简介", cast: [], watchedAt: null, magnetUrl: null, libraryMovieId: null, libraryStatus: null } })
        : Response.json({ actor: { tmdbPersonId: null, doubanPersonId: 1026115, name: "演员", profileUrl: null }, movies: [], total: 0, page: 2, pageSize: 24 });
    }) as typeof fetch;
    try {
      await getActorMovies("1026115", 2, new AbortController().signal, "tv", "douban");
      await getActorMovies("22", 2, new AbortController().signal, "tv");
      await getCatalogMovie("37322496", new AbortController().signal, "tv", "douban");
      expect(requested).toEqual(["/api/actors/1026115/movies?page=2&pageSize=24&mediaType=tv&provider=douban", "/api/actors/22/movies?page=2&pageSize=24&mediaType=tv", "/api/catalog/douban/tv/37322496"]);
    } finally { globalThis.fetch = originalFetch; }
  });
});
