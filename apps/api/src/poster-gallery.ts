import type {
  MetadataPoster,
  MetadataSource,
  Movie,
  MoviePosterList,
} from "@film-shelf/shared";
import { and, asc, eq } from "drizzle-orm";
import type { MovieDatabase } from "./db";
import { ApiException } from "./errors";
import type { MetadataProvider } from "./metadata";
import { LOCAL_POSTER_PATH_PATTERN, type PosterStore } from "./posters";
import { moviePosters, movies } from "./schema";

export function createPosterGallery(
  db: MovieDatabase,
  store: PosterStore,
  providers: Record<MetadataSource, MetadataProvider>,
) {
  const active = new Set<number>();
  async function list(movie: Movie): Promise<MoviePosterList> {
    const rows = db
      .select()
      .from(moviePosters)
      .where(eq(moviePosters.movieId, movie.id))
      .orderBy(asc(moviePosters.id))
      .all();
    const current = db
      .select({ posterUrl: movies.posterUrl })
      .from(movies)
      .where(eq(movies.id, movie.id))
      .get();
    return {
      posters: await Promise.all(
        rows.map(async ({ id, url, width, height, source }) => ({
          id,
          url,
          width,
          height,
          source,
          posterVariants: await store.variants(url),
        })),
      ),
      primaryPosterId:
        rows.find((row) => row.url === current?.posterUrl)?.id ?? null,
    };
  }
  function select(movie: Movie, posterId: number) {
    db.transaction((tx) => {
      const poster = tx
        .select()
        .from(moviePosters)
        .where(
          and(
            eq(moviePosters.id, posterId),
            eq(moviePosters.movieId, movie.id),
          ),
        )
        .get();
      if (!poster || !LOCAL_POSTER_PATH_PATTERN.test(poster.url))
        throw new ApiException(
          404,
          "POSTER_NOT_FOUND",
          "没有找到本作品已保存的海报。",
        );
      tx.update(movies)
        .set({ posterUrl: poster.url, updatedAt: new Date().toISOString() })
        .where(eq(movies.id, movie.id))
        .run();
    });
  }
  async function append(movie: Movie, photoIds?: string[]) {
    if (active.has(movie.id))
      throw new ApiException(
        409,
        "POSTER_SYNC_IN_PROGRESS",
        "此作品正在同步海报，请稍后重试。",
      );
    active.add(movie.id);
    try {
      let source: MetadataSource;
      let externalId: number;
      if (photoIds) {
        if (!movie.doubanId)
          throw new ApiException(
            400,
            "DOUBAN_ID_REQUIRED",
            "请先为作品关联豆瓣资料。",
          );
        source = "douban";
        externalId = movie.doubanId;
      } else if (movie.doubanId && providers.douban.posters) {
        source = "douban";
        externalId = movie.doubanId;
      } else if (movie.tmdbId && providers.tmdb.posters) {
        source = "tmdb";
        externalId = movie.tmdbId;
      } else
        throw new ApiException(
          503,
          "POSTERS_UNAVAILABLE",
          "当前作品资料源暂不支持海报同步。",
        );
      const provider = providers[source];
      if (
        !provider.configured ||
        (photoIds ? !provider.poster : !provider.posters)
      )
        throw new ApiException(
          503,
          "POSTERS_UNAVAILABLE",
          "海报资料源暂不可用。",
        );
      // Resolve and validate ownership before downloading any manually supplied photo.
      let candidates: MetadataPoster[] = [];
      if (photoIds) {
        for (const photoId of new Set(photoIds)) {
          const candidate = await provider.poster!(
            externalId,
            movie.mediaType,
            Number(photoId),
          );
          if (candidate.source !== "douban" || candidate.sourceId !== photoId)
            throw new ApiException(
              502,
              "POSTER_INVALID_RESPONSE",
              "资料源返回的图片与请求不一致。",
            );
          candidates.push(candidate);
        }
      } else
        candidates = (
          await provider.posters!(externalId, movie.mediaType)
        ).slice(0, 40);
      const identities = new Set<string>();
      const urls = new Set<string>();
      const unique = candidates
        .filter((candidate) => {
          const identity = `${candidate.source}:${candidate.sourceId}`;
          if (identities.has(identity) || urls.has(candidate.url)) return false;
          identities.add(identity);
          urls.add(candidate.url);
          return true;
        })
        .slice(0, 40);
      let added = 0,
        failed = 0,
        succeeded = 0,
        cursor = 0;
      let firstError: unknown;
      await Promise.all(
        Array.from({ length: Math.min(3, unique.length) }, async () => {
          while (cursor < unique.length) {
            const candidate = unique[cursor++]!;
            try {
              if (
                candidate.source !== source ||
                !candidate.sourceId ||
                !candidate.url
              )
                throw new ApiException(
                  502,
                  "POSTER_INVALID_RESPONSE",
                  "资料源返回了无效海报。",
                );
              const existing = db
                .select({ id: moviePosters.id })
                .from(moviePosters)
                .where(
                  and(
                    eq(moviePosters.movieId, movie.id),
                    eq(moviePosters.source, source),
                    eq(moviePosters.sourceId, candidate.sourceId),
                  ),
                )
                .get();
              if (existing) {
                succeeded++;
                continue;
              }
              const url = await store.save(candidate.url);
              if (!url || !LOCAL_POSTER_PATH_PATTERN.test(url))
                throw new ApiException(
                  502,
                  "POSTER_DOWNLOAD_FAILED",
                  "海报无法保存到本地。",
                );
              await store.ensureVariants(url);
              const row = db
                .insert(moviePosters)
                .values({
                  movieId: movie.id,
                  url,
                  source,
                  sourceId: candidate.sourceId,
                  width: candidate.width,
                  height: candidate.height,
                  createdAt: new Date().toISOString(),
                })
                .onConflictDoNothing()
                .returning({ id: moviePosters.id })
                .get();
              if (row) added++;
              succeeded++;
            } catch (error) {
              failed++;
              firstError ??= error;
            }
          }
        }),
      );
      if (!succeeded) {
        if (firstError instanceof ApiException) throw firstError;
        throw new ApiException(
          502,
          "POSTERS_EMPTY",
          "未找到可保存的海报，请稍后重试或添加豆瓣图片详情页。",
        );
      }
      return { ...(await list(movie)), added, failed };
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw new ApiException(
        502,
        "POSTERS_UNAVAILABLE",
        "暂时无法读取海报资料，请稍后重试。",
      );
    } finally {
      active.delete(movie.id);
    }
  }
  return { list, select, append };
}
