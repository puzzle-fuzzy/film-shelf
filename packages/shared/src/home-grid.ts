import type { PosterVariant } from "./index";

// Match the grid breakpoints in apps/web/src/styles.css.
export const homeGridLayouts = [
  { maxWidth: 599, media: "(width <= 599px)", pageSize: 4 },
  { maxWidth: 899, media: "(width > 599px) and (width <= 899px)", pageSize: 6 },
  { maxWidth: 1279, media: "(width > 899px) and (width <= 1279px)", pageSize: 8 },
  { maxWidth: null, media: "(width > 1279px)", pageSize: 12 },
] as const;

// Both rows can fit in the initial mobile viewport.
export function homePosterPriorityCount(pageSize: number) {
  return pageSize === 4 ? pageSize : pageSize / 2;
}

// The API validates the decoded Douban source before fetching a same-origin preview.
export const localPosterPath = /^\/api\/posters\/(?:(?:[a-f0-9]{64}|tmdb\/(?:w92|w154|w185|w342|w500|w780|original)\/[A-Za-z0-9_-]+)\.(?:jpg|png|webp)|douban\/[A-Za-z0-9_-]{1,2048})(?![\s\S])/;
export const posterGridSizes = "(max-width: 599px) calc((100vw - 52px) / 2), (max-width: 899px) calc((100vw - 88px) / 3), (max-width: 1279px) calc((100vw - 152px) / 4), (max-width: 1440px) calc((100vw - 200px) / 6), 207px";

export function posterSrcSet(variants: PosterVariant[] | undefined) {
  return variants?.filter(({ url, width }) => localPosterPath.test(url) && Number.isSafeInteger(width) && width > 0)
    .map(({ url, width }) => `${url} ${width}w`).join(", ") || undefined;
}

export function isPageNumber(value: string): boolean {
  return /^[1-9]\d*$/.test(value) && Number(value) <= 1000000;
}

export function pageFromSearch(search: URLSearchParams, key = "page"): number {
  const value = search.get(key);
  return value && isPageNumber(value) ? Number(value) : 1;
}
