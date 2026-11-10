import { and, eq, isNotNull } from "drizzle-orm";
import type { MovieDatabase } from "./db";
import { LOCAL_POSTER_PATH_PATTERN, type PosterStore } from "./posters";
import { movies } from "./schema";

export async function localizeExistingPosters(db: MovieDatabase, posters: PosterStore) {
  const existing = db.select({ id: movies.id, posterUrl: movies.posterUrl }).from(movies).where(isNotNull(movies.posterUrl)).all();
  let migrated = 0;
  for (const movie of existing) {
    if (!movie.posterUrl) continue;
    const localUrl = LOCAL_POSTER_PATH_PATTERN.test(movie.posterUrl) ? movie.posterUrl : await posters.save(movie.posterUrl);
    await posters.ensureVariants(localUrl);
    if (localUrl === movie.posterUrl) continue;
    db.update(movies).set({ posterUrl: localUrl }).where(and(eq(movies.id, movie.id), eq(movies.posterUrl, movie.posterUrl))).run();
    migrated++;
  }
  return { migrated };
}
