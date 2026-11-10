import { homeGridLayouts, homePosterPriorityCount, localPosterPath, pageFromSearch, posterGridSizes, posterSrcSet } from "@film-shelf/shared/home-grid";
import { eq } from "drizzle-orm";
import { newestMovieOrder, type MovieDatabase } from "./db";
import type { PosterStore } from "./posters";
import { movies } from "./schema";

export function createHomeHtmlRenderer(html: string, db: MovieDatabase, posters: PosterStore) {
  const readPriorityPosters = (limit: number, offset = 0) => db.select({ url: movies.posterUrl }).from(movies)
    .where(eq(movies.status, "recommended")).orderBy(...newestMovieOrder).limit(limit).offset(offset).all();
  const largestPriorityCount = Math.max(...homeGridLayouts.map(({ pageSize }) => homePosterPriorityCount(pageSize)));

  return async (search: URLSearchParams) => {
    const page = pageFromSearch(search, "recommendedPage");
    const firstPage = page === 1 ? readPriorityPosters(largestPriorityCount) : undefined;
    const viewportsByPoster = new Map<string, Set<string>>();
    for (const { media, pageSize } of homeGridLayouts) {
      const limit = homePosterPriorityCount(pageSize);
      const rows = firstPage?.slice(0, limit) ?? readPriorityPosters(limit, (page - 1) * pageSize);
      for (const { url } of rows) {
        if (!url || !localPosterPath.test(url)) continue;
        const viewports = viewportsByPoster.get(url) ?? new Set<string>();
        viewports.add(media);
        viewportsByPoster.set(url, viewports);
      }
    }

    const links = await Promise.all([...viewportsByPoster].map(async ([url, viewports]) => {
      const srcSet = posterSrcSet(await posters.variants(url));
      const image = srcSet ? `imagesrcset="${srcSet}" imagesizes="${posterGridSizes}"` : `href="${url}"`;
      const media = viewports.size === homeGridLayouts.length ? "" : ` media="${[...viewports].join(", ")}"`;
      return `<link rel="preload" as="image" fetchpriority="high" ${image}${media}>\n`;
    }));
    return html.replace("</head>", () => links.join("") + "</head>");
  };
}
