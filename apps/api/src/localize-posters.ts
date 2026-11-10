import { and, eq, isNotNull } from "drizzle-orm";
import type { MovieDatabase } from "./db";
import { LOCAL_POSTER_PATH_PATTERN, type PosterStore } from "./posters";
import { moviePosters, movies } from "./schema";

export async function localizeExistingPosters(db: MovieDatabase, posters: PosterStore) {
  const existing = db.select({ id: movies.id, posterUrl: movies.posterUrl }).from(movies).where(isNotNull(movies.posterUrl)).all();
  let migrated = 0;
  for (const movie of existing) {
    if (!movie.posterUrl) continue;
    const localUrl = LOCAL_POSTER_PATH_PATTERN.test(movie.posterUrl) ? movie.posterUrl : await posters.save(movie.posterUrl);
    await posters.ensureVariants(localUrl);
    if (localUrl === movie.posterUrl) continue;
    db.transaction((tx) => {
      tx.update(movies).set({ posterUrl: localUrl }).where(and(eq(movies.id, movie.id), eq(movies.posterUrl, movie.posterUrl!))).run();
      if (!localUrl) return;
      // A previous sync may already have stored the same image under its local URL.
      const cached = tx.select({ id: moviePosters.id }).from(moviePosters).where(and(eq(moviePosters.movieId, movie.id), eq(moviePosters.url, localUrl))).get();
      const old = and(eq(moviePosters.movieId, movie.id), eq(moviePosters.url, movie.posterUrl!));
      if (cached) tx.delete(moviePosters).where(old).run();
      else tx.update(moviePosters).set({ url: localUrl }).where(old).run();
    });
    migrated++;
  }
  return { migrated };
}
