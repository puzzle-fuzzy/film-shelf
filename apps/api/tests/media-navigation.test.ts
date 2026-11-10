import { describe, expect, test } from "bun:test";
import { backNavigation, homeLocation, mediaTypeFromSearch, movieDetailLink, nextNavigationState, safeInternalPath } from "../../web/src/lib/navigation";

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
});
