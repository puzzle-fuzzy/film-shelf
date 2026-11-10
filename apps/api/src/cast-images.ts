import type { CastMember } from "@film-shelf/shared";
import { and, eq, isNotNull } from "drizzle-orm";
import type { MovieDatabase } from "./db";
import type { MetadataProvider } from "./metadata";
import { isDoubanActorImageSource, type PosterStore } from "./posters";
import { movies } from "./schema";

export async function localizeCastImages(cast: CastMember[], posters: PosterStore): Promise<CastMember[]> {
  const result: CastMember[] = [];
  for (let start = 0; start < cast.length; start += 4) {
    result.push(...await Promise.all(cast.slice(start, start + 4).map(async (actor) => {
      if (!isDoubanActorImageSource(actor.profileUrl)) return actor;
      try {
        const local = await posters.save(actor.profileUrl);
        return local ? { ...actor, profileUrl: local } : actor;
      } catch (error) {
        console.warn("Could not save actor photo:", actor.name, error instanceof Error ? error.name : "UnknownError");
        return actor;
      }
    })));
  }
  return result;
}

export async function backfillDoubanCastImages(db: MovieDatabase, posters: PosterStore, douban: MetadataProvider) {
  const existing = db.select({
    id: movies.id,
    doubanId: movies.doubanId,
    mediaType: movies.mediaType,
    cast: movies.cast,
  }).from(movies).where(isNotNull(movies.doubanId)).all();
  let updated = 0;

  for (const movie of existing) {
    let cast = movie.cast;
    if (cast.some((actor) => !actor.profileUrl)) {
      try {
        const metadata = await douban.details(movie.doubanId!, movie.mediaType);
        if (metadata.doubanId !== movie.doubanId || metadata.mediaType !== movie.mediaType) {
          throw new Error("The refreshed cast belongs to a different work.");
        }
        const profiles = new Map<string, string | null>();
        for (const actor of metadata.cast || []) {
          const source = isDoubanActorImageSource(actor.profileUrl) ? actor.profileUrl : null;
          profiles.set(actor.name, profiles.has(actor.name) ? null : source);
        }
        cast = cast.map((actor) => {
          const source = profiles.get(actor.name);
          return !actor.profileUrl && source ? { ...actor, profileUrl: source } : actor;
        });
      } catch (error) {
        console.warn("Could not refresh actor photos:", movie.id, error instanceof Error ? error.name : "UnknownError");
      }
    }

    const localized = await localizeCastImages(cast, posters);
    if (JSON.stringify(localized) === JSON.stringify(movie.cast)) continue;
    const saved = db.update(movies).set({ cast: localized }).where(and(
      eq(movies.id, movie.id),
      eq(movies.cast, movie.cast),
    )).returning({ id: movies.id }).get();
    if (saved) updated++;
  }
  return { updated };
}
