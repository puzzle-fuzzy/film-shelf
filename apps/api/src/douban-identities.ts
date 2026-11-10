import type { MovieInput } from "@film-shelf/shared";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { MovieDatabase } from "./db";
import type { MetadataProvider } from "./metadata";
import { movies } from "./schema";
import type { MovieMetadataProvider } from "./tmdb";

/** Link providers only through a unique IMDb identity; never guess from translated titles. */
export async function resolveDoubanMovieIdentity(input: MovieInput, douban: MetadataProvider, tmdb: MovieMetadataProvider): Promise<MovieInput> {
  if (!input.doubanId || input.tmdbId || !tmdb.configured || !douban.imdbId || !tmdb.findByImdb) return input;
  try {
    const mediaType = input.mediaType ?? "movie";
    const imdbId = await douban.imdbId(input.doubanId, mediaType);
    if (!imdbId) return input;
    const tmdbId = await tmdb.findByImdb(imdbId, mediaType);
    if (tmdbId && mediaType === "tv") {
      // An IMDb series ID can also be listed on separate Douban season entries.
      // Keep those entries independent unless the release date and full episode count agree.
      const details = await tmdb.details(tmdbId, "tv");
      if (details.tmdbId !== tmdbId || details.mediaType !== "tv" || !input.releaseDate || !input.episodeCount
        || details.releaseDate !== input.releaseDate || details.episodeCount !== input.episodeCount) return input;
    }
    return tmdbId ? { ...input, tmdbId } : input;
  } catch (error) {
    console.warn("Could not link Douban work:", input.doubanId, error instanceof Error ? error.name : "UnknownError");
    return input;
  }
}

export async function backfillDoubanMovieIdentities(db: MovieDatabase, douban: MetadataProvider, tmdb: MovieMetadataProvider) {
  const existing = db.select().from(movies).where(and(isNotNull(movies.doubanId), isNull(movies.tmdbId))).all();
  let updated = 0;
  for (const movie of existing) {
    const linked = await resolveDoubanMovieIdentity(movie, douban, tmdb);
    if (!linked.tmdbId) continue;
    // A separately collected copy may already own this identity. Keep both entries intact.
    const duplicate = db.select({ id: movies.id }).from(movies).where(and(
      eq(movies.mediaType, movie.mediaType), eq(movies.tmdbId, linked.tmdbId),
    )).get();
    if (duplicate) continue;
    const saved = db.update(movies).set({ tmdbId: linked.tmdbId }).where(and(
      eq(movies.id, movie.id), eq(movies.doubanId, movie.doubanId!),
      eq(movies.mediaType, movie.mediaType), isNull(movies.tmdbId),
    )).returning({ id: movies.id }).get();
    if (saved) updated++;
  }
  return { updated };
}
