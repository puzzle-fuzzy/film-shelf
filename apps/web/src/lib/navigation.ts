import { isPageNumber } from "@film-shelf/shared/home-grid";
import type { MediaType } from "@film-shelf/shared";

export { pageFromSearch } from "@film-shelf/shared/home-grid";

interface NavigationState {
  from?: unknown;
  trail?: unknown;
}

interface NavigationLocation {
  pathname: string;
  search: string;
  hash?: string;
  state: unknown;
}

const movieDetailPath = /^\/(?:movies\/|catalog\/(?:douban\/)?(?:movies|tv)\/)/;

type MediaProvider = "tmdb" | "douban";

export function providerFromSearch(search: URLSearchParams): MediaProvider | undefined {
  const value = search.get("provider");
  return value === "tmdb" || value === "douban" ? value : undefined;
}

export function actorPageSearch(mediaType: MediaType, page: number, provider?: MediaProvider) {
  const query = new URLSearchParams();
  if (provider) query.set("provider", provider);
  if (mediaType === "tv") query.set("mediaType", "tv");
  if (page > 1) query.set("page", String(page));
  return query;
}

function validNumericId(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function actorLink(actor: { tmdbPersonId?: number | null; doubanPersonId?: number | null }, mediaType: MediaType) {
  const tmdb = validNumericId(actor.tmdbPersonId);
  const id = tmdb ? actor.tmdbPersonId : actor.doubanPersonId;
  if (!validNumericId(id)) return null;
  const query = actorPageSearch(mediaType, 1, tmdb ? undefined : "douban").toString();
  return `/actors/${id}${query ? `?${query}` : ""}`;
}

export function actorMoviePath(movie: { libraryMovieId: number | null; tmdbId: number | null; doubanId?: number | null; provider?: MediaProvider }, mediaType: MediaType) {
  if (validNumericId(movie.libraryMovieId)) return `/movies/${movie.libraryMovieId}`;
  const category = mediaType === "tv" ? "tv" : "movies";
  if (validNumericId(movie.tmdbId)) return `/catalog/${category}/${movie.tmdbId}`;
  return validNumericId(movie.doubanId) ? `/catalog/douban/${category}/${movie.doubanId}` : null;
}

export function mediaTypeFromSearch(search: URLSearchParams): MediaType | undefined {
  const value = search.get("mediaType");
  return value === "movie" || value === "tv" ? value : undefined;
}

export function homeLocation(recommendedPage: number, watchedPage: number, hash = "", mediaType?: MediaType) {
  const query = new URLSearchParams();
  if (mediaType) query.set("mediaType", mediaType);
  if (recommendedPage > 1) query.set("recommendedPage", String(recommendedPage));
  if (watchedPage > 1) query.set("watchedPage", String(watchedPage));
  const search = query.toString();
  return { pathname: "/", search: search ? `?${search}` : "", hash };
}

export function isPositiveId(value: string): boolean {
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

export function safeInternalPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const home = /^\/(?:\?([^#]+))?(?:#recently-watched)?$/.exec(value);
  if (home) {
    const pages = new URLSearchParams(home[1]);
    const keys = new Set<string>();
    for (const [key, page] of pages) {
      if (keys.has(key)) return null;
      if (key === "mediaType" ? page !== "movie" && page !== "tv" : (key !== "recommendedPage" && key !== "watchedPage") || !isPageNumber(page)) return null;
      keys.add(key);
    }
    return value;
  }
  const match = /^\/(recommended|watched|actors\/([1-9]\d*)|movies\/([1-9]\d*)|catalog\/(?:douban\/)?(?:movies|tv)\/([1-9]\d*))(?:\?([^#]+))?$/.exec(value);
  if (!match) return null;
  const id = match[2] || match[3] || match[4];
  if (id && !isPositiveId(id)) return null;
  if (match[5]) {
    if (match[3] || match[4]) return null;
    const keys = new Set<string>();
    for (const [key, item] of new URLSearchParams(match[5])) {
      if (keys.has(key)) return null;
      if (key === "provider") {
        if (!match[2] || item !== "tmdb" && item !== "douban") return null;
      } else if (key === "mediaType" ? item !== "movie" && item !== "tv" : key !== "page" || !isPageNumber(item)) return null;
      keys.add(key);
    }
  }
  return value;
}

function readNavigationState(value: unknown): NavigationState | null {
  return value !== null && typeof value === "object" ? value as NavigationState : null;
}

function readTrail(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const path of value.slice(0, 12)) {
    const safe = safeInternalPath(path);
    if (!safe) break;
    result.push(safe);
  }
  return result;
}

function locationNavigationState(location: NavigationLocation): NavigationState | null {
  const state = readNavigationState(location.state);
  if (safeInternalPath(state?.from) || !movieDetailPath.test(location.pathname)) return state;
  const search = new URLSearchParams(location.search);
  return { from: search.get("from"), trail: search.getAll("trail") };
}

export function nextNavigationState(location: NavigationLocation) {
  const from = safeInternalPath(location.pathname + location.search + (location.hash || ""))
    || safeInternalPath(location.pathname + location.search)
    || safeInternalPath(location.pathname);
  const previous = locationNavigationState(location);
  const previousFrom = safeInternalPath(previous?.from);
  const trail = previousFrom ? [previousFrom, ...readTrail(previous?.trail)].slice(0, 12) : [];
  return from ? { from, trail } : undefined;
}

export function movieDetailLink(pathname: string, location: NavigationLocation) {
  const navigation = nextNavigationState(location);
  if (!navigation) return pathname;
  const search = new URLSearchParams({ from: navigation.from });
  for (const path of navigation.trail) search.append("trail", path);
  return { pathname, search: `?${search}` };
}

export function backNavigation(location: NavigationLocation, fallback = "/") {
  const previous = locationNavigationState(location);
  const from = safeInternalPath(previous?.from);
  const to = from || fallback;
  const trail = from ? readTrail(previous?.trail) : [];
  const state = trail.length ? { from: trail[0], trail: trail.slice(1) } : undefined;
  const label = to.startsWith("/actors/") ? "返回参演作品" : movieDetailPath.test(to) ? "返回影视详情" : "返回片单";
  return { to, state, label };
}
