import { isPageNumber } from "@film-shelf/shared/home-grid";

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

const movieDetailPath = /^\/(?:catalog\/)?movies\//;

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
      if ((key !== "recommendedPage" && key !== "watchedPage") || keys.has(key) || !isPageNumber(page)) return null;
      keys.add(key);
    }
    return value;
  }
  const match = /^\/(recommended|watched|actors\/([1-9]\d*)|movies\/([1-9]\d*)|catalog\/movies\/([1-9]\d*))(?:\?page=([1-9]\d*))?$/.exec(value);
  if (!match) return null;
  const id = match[2] || match[3] || match[4];
  if (id && !isPositiveId(id)) return null;
  if (match[5] && (!isPageNumber(match[5]) || match[3] || match[4])) return null;
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
  const label = to.startsWith("/actors/") ? "返回参演电影" : movieDetailPath.test(to) ? "返回电影详情" : "返回片单";
  return { to, state, label };
}
