import type { ActorFilmography, ActorMovieList, CatalogMovieDetails, MediaType, MetadataSource, Movie, MovieGridList, MovieInput, MovieList } from "@film-shelf/shared";
import { and, desc, eq, getTableColumns, inArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { newestMovieOrder, normalizeSearchText, type MovieDatabase } from "./db";
import { ApiException } from "./errors";
import { moviePosters, movies } from "./schema";
import { createPosterGallery } from "./poster-gallery";
import { createPosterStore, doubanPosterSource, localPosterUrl, LOCAL_POSTER_PATH_PATTERN, LOCAL_TMDB_POSTER_PATH_PATTERN, type PosterStore } from "./posters";
import { actorImageSource, localActorImageUrl } from "./actor-images";
import { localizeCastImages } from "./cast-images";
import { resolveDoubanMovieIdentity } from "./douban-identities";
import { createTmdbProvider, type MovieMetadataProvider } from "./tmdb";
import { createDoubanProvider, tmdbMetadataProvider, type MetadataProvider } from "./metadata";
import { posterPhotosBodySchema, posterSelectionBodySchema, posterSyncBodySchema, actorMoviesQuerySchema, idSchema, importBodySchema, listQuerySchema, magnetBodySchema, personalReviewBodySchema, metadataSearchQuerySchema, movieInputSchema, searchQuerySchema, statusBodySchema } from "./validation";

const { titleSearch: _titleSearch, originalTitleSearch: _originalTitleSearch, watchedOrder: _watchedOrder, ...movieColumns } = getTableColumns(movies);
const gridMovieColumns = { id: movies.id, title: movies.title, releaseDate: movies.releaseDate, posterUrl: movies.posterUrl, mediaType: movies.mediaType };

function serializeMovie(movie: Movie): Movie {
  return { ...movie, cast: movie.cast.map((actor) => ({ ...actor, profileUrl: localActorImageUrl(actor.profileUrl) })) };
}

export interface AppDependencies {
  db: MovieDatabase;
  tmdb?: MovieMetadataProvider;
  tmdbToken?: string;
  douban?: MetadataProvider;
  posters?: PosterStore;
}

export function createApp({ db, tmdb = createTmdbProvider(), tmdbToken, douban = createDoubanProvider(), posters = createPosterStore() }: AppDependencies) {
  const provider = tmdbToken === undefined ? tmdb : createTmdbProvider(tmdbToken);
  const providers: Record<MetadataSource, MetadataProvider> = { tmdb: tmdbMetadataProvider(provider), douban };
  const gallery = createPosterGallery(db, posters, providers);
  const app = new Hono();
  app.use("/api/*", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: { code: "BODY_TOO_LARGE", message: "请求内容过大。" } }, 413) }));
  app.use("/api/*", async (c, next) => {
    if ((c.req.method === "POST" || c.req.method === "PATCH") && !/^application\/json(?:\s*;|$)/i.test(c.req.header("content-type") || "")) {
      return c.json({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "请使用 application/json 提交数据。" } }, 415);
    }
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof ApiException) return c.json({ error: { code: error.code, message: error.message } }, error.status);
    if (error instanceof z.ZodError) return c.json({ error: { code: "VALIDATION_ERROR", message: `数据格式有误：${error.issues[0]?.path.join(".") || "请求"}，${error.issues[0]?.message || "请检查输入"}` } }, 400);
    if (error instanceof SyntaxError) return c.json({ error: { code: "INVALID_JSON", message: "请求内容不是有效的 JSON。" } }, 400);
    if (error instanceof HTTPException) return c.json({ error: { code: "REQUEST_ERROR", message: error.message } }, error.status);
    console.error("API request failed:", error instanceof Error ? error.name : "UnknownError");
    return c.json({ error: { code: "INTERNAL_ERROR", message: "服务暂时无法处理请求，请稍后重试。" } }, 500);
  });

  function findMovie(id: number): Movie {
    const movie = db.select(movieColumns).from(movies).where(eq(movies.id, id)).get();
    if (!movie) throw new ApiException(404, "MOVIE_NOT_FOUND", "没有找到这部电影。");
    return serializeMovie(movie);
  }

  function findExternalMovie(source: MetadataSource, mediaType: MediaType, externalId: number) {
    const identity = and(eq(movies.mediaType, mediaType), source === "tmdb" ? eq(movies.tmdbId, externalId) : eq(movies.doubanId, externalId));
    return db.select(movieColumns).from(movies).where(identity).get();
  }

  function duplicateMovie(): never {
    throw new ApiException(409, "MOVIE_ALREADY_EXISTS", "这部作品已在片库中，请直接查看现有记录。");
  }

  async function readMetadata(source: MetadataSource, mediaType: MediaType, externalId: number) {
    const parsed = movieInputSchema.safeParse(await providers[source].details(externalId, mediaType));
    if (!parsed.success) throw new ApiException(502, `${source.toUpperCase()}_INVALID_RESPONSE`, "资料源返回的作品格式异常，请稍后重试。");
    const metadata = parsed.data;
    const returnedId = source === "tmdb" ? metadata.tmdbId : metadata.doubanId;
    if (returnedId !== externalId || metadata.mediaType !== mediaType) {
      throw new ApiException(502, `${source.toUpperCase()}_INVALID_RESPONSE`, "资料源返回的内容与所选作品不一致。");
    }
    return metadata;
  }

  async function insertMovie(input: MovieInput): Promise<Movie> {
    input = await resolveDoubanMovieIdentity(input, douban, provider);
    const mediaType = input.mediaType ?? "movie";
    const duplicateDouban = input.doubanId && db.select({ id: movies.id }).from(movies).where(eq(movies.doubanId, input.doubanId)).get();
    if ((input.tmdbId && findExternalMovie("tmdb", mediaType, input.tmdbId)) || duplicateDouban) duplicateMovie();
    const posterUrl = await posters.save(input.posterUrl);
    await posters.ensureVariants(posterUrl);
    const cast = await localizeCastImages(input.cast || [], posters);
    const timestamp = new Date().toISOString();
    const movie = db.transaction((tx) => {
      const inserted = tx.insert(movies).values({
        tmdbId: input.tmdbId ?? null,
        mediaType,
        doubanId: input.doubanId ?? null,
        episodeCount: mediaType === "tv" ? input.episodeCount ?? null : null,
        title: input.title,
        originalTitle: input.originalTitle || "",
        titleSearch: normalizeSearchText(input.title),
        originalTitleSearch: normalizeSearchText(input.originalTitle || ""),
        posterUrl,
        releaseDate: input.releaseDate ?? null,
        overview: input.overview || "",
        cast,
        magnetUrl: input.magnetUrl ?? null,
        status: "recommended",
        watchedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }).onConflictDoNothing().returning(movieColumns).get();
      if (!inserted) duplicateMovie();
      if (posterUrl) tx.insert(moviePosters).values({ movieId: inserted.id, url: posterUrl, createdAt: timestamp }).run();
      return inserted;
    });
    return serializeMovie(movie);
  }

  app.get("/api/health", (c) => c.json({ status: "ok", tmdbConfigured: provider.configured, providers: { tmdb: provider.configured, douban: douban.configured } }));
  app.get("/api/posters/:filename", (c) => posters.respond(c.req.param("filename")));
  app.get("/api/posters/tmdb/:size/:filename", async (c) => {
    const path = c.req.path;
    if (!LOCAL_TMDB_POSTER_PATH_PATTERN.test(path)) throw new ApiException(404, "POSTER_NOT_FOUND", "没有找到这张海报。");
    const local = await posters.save(path);
    const cached = local && LOCAL_POSTER_PATH_PATTERN.exec(local);
    if (!cached) throw new ApiException(502, "POSTER_UNAVAILABLE", "海报暂时无法读取，请稍后重试。");
    void posters.ensureVariants(local).catch((error: unknown) => console.warn("Could not prepare preview poster variants:", error instanceof Error ? error.name : "UnknownError"));
    return posters.respond(cached[1]!);
  });
  app.get("/api/posters/douban/:encoded", async (c) => {
    const source = doubanPosterSource(c.req.path);
    const local = await posters.save(source);
    const cached = local && LOCAL_POSTER_PATH_PATTERN.exec(local);
    if (!cached) throw new ApiException(502, "POSTER_UNAVAILABLE", "海报暂时无法读取，请稍后重试。");
    void posters.ensureVariants(local).catch((error: unknown) => console.warn("Could not prepare preview poster variants:", error instanceof Error ? error.name : "UnknownError"));
    return posters.respond(cached[1]!);
  });
  app.get("/api/actors/image/:filename", async (c) => {
    const local = await posters.save(actorImageSource(c.req.param("filename")));
    const cached = local && LOCAL_POSTER_PATH_PATTERN.exec(local);
    if (!cached) throw new ApiException(502, "ACTOR_IMAGE_UNAVAILABLE", "演员照片暂时无法读取，请稍后重试。");
    return posters.respond(cached[1]!);
  });

  app.get("/api/actors/:id/movies", async (c) => {
    const personId = idSchema.parse(c.req.param("id"));
    const { page, pageSize, mediaType, provider: actorSource } = actorMoviesQuerySchema.parse(c.req.query());
    let filmography: ActorFilmography;
    if (actorSource === "douban") {
      if (!douban.actor || !douban.actorFilmography) throw new ApiException(503, "METADATA_UNAVAILABLE", "当前资料源暂不支持演员作品查询，请稍后重试。");
      const actor = await douban.actor(personId);
      let matched: ActorFilmography | null = null;
      if (actor.imdbId && provider.configured && provider.findByImdb && provider.actorFilmography) {
        try {
          const tmdbPersonId = await provider.findByImdb(actor.imdbId, "person");
          if (tmdbPersonId) matched = await provider.actorFilmography(tmdbPersonId, mediaType);
        } catch (error) {
          console.warn("Could not read linked TMDB actor:", personId, error instanceof Error ? error.name : "UnknownError");
        }
      }
      const credits = matched || await douban.actorFilmography(personId, mediaType);
      const [localized] = await localizeCastImages([{ name: actor.name, character: "", profileUrl: actor.profileUrl }], posters);
      filmography = { ...credits, actor: {
        ...credits.actor, doubanPersonId: personId, name: actor.name,
        profileUrl: localActorImageUrl(localized?.profileUrl) || credits.actor.profileUrl,
      } };
    } else {
      if (!provider.actorFilmography) throw new ApiException(503, "METADATA_UNAVAILABLE", "当前资料源暂不支持演员作品查询，请稍后重试。");
      filmography = await provider.actorFilmography(personId, mediaType);
    }
    const pageMovies = filmography.movies.slice((page - 1) * pageSize, page * pageSize);
    const tmdbIds = pageMovies.flatMap(movie => movie.tmdbId ? [movie.tmdbId] : []);
    const doubanIds = pageMovies.flatMap(movie => movie.doubanId ? [movie.doubanId] : []);
    const localMovies = pageMovies.length ? db.select({
      id: movies.id,
      tmdbId: movies.tmdbId,
      doubanId: movies.doubanId,
      status: movies.status,
      title: movies.title,
      posterUrl: movies.posterUrl,
    }).from(movies).where(and(eq(movies.mediaType, mediaType), or(inArray(movies.tmdbId, tmdbIds), inArray(movies.doubanId, doubanIds)))).all() : [];
    const libraryTmdb = new Map(localMovies.filter(movie => movie.tmdbId).map(movie => [movie.tmdbId, movie]));
    const libraryDouban = new Map(localMovies.filter(movie => movie.doubanId).map(movie => [movie.doubanId, movie]));
    const results = await Promise.all(pageMovies.map(async (movie) => {
      const local = (movie.tmdbId ? libraryTmdb.get(movie.tmdbId) : undefined) || (movie.doubanId ? libraryDouban.get(movie.doubanId) : undefined);
      const posterUrl = localPosterUrl(local ? local.posterUrl : movie.posterUrl);
      return {
        ...movie,
        mediaType,
        title: local ? local.title : movie.title,
        posterUrl,
        posterVariants: await posters.variants(posterUrl),
        libraryMovieId: local?.id ?? null,
        libraryStatus: local?.status ?? null,
      };
    }));
    const result: ActorMovieList = {
      actor: { ...filmography.actor, profileUrl: localActorImageUrl(filmography.actor.profileUrl) },
      movies: results,
      total: filmography.movies.length,
      page,
      pageSize,
    };
    return c.json(result);
  });

  async function catalogMovie(externalId: number, mediaType: MediaType, source: MetadataSource = "tmdb"): Promise<CatalogMovieDetails> {
    const local = findExternalMovie(source, mediaType, externalId);
    let movie: CatalogMovieDetails;
    if (local) {
      const saved = serializeMovie(local);
      movie = {
        tmdbId: saved.tmdbId,
        mediaType,
        doubanId: saved.doubanId,
        episodeCount: saved.episodeCount,
        title: saved.title,
        originalTitle: saved.originalTitle,
        posterUrl: saved.posterUrl,
        releaseDate: saved.releaseDate,
        overview: saved.overview,
        cast: saved.cast,
        magnetUrl: saved.magnetUrl,
        personalReview: saved.personalReview,
        watchedAt: saved.watchedAt,
        libraryMovieId: saved.id,
        libraryStatus: saved.status,
      };
    } else {
      const metadata = await readMetadata(source, mediaType, externalId);
      const cast = source === "douban" ? await localizeCastImages(metadata.cast || [], posters) : metadata.cast || [];
      movie = {
        tmdbId: metadata.tmdbId ?? null,
        mediaType,
        doubanId: metadata.doubanId ?? null,
        episodeCount: metadata.episodeCount ?? null,
        title: metadata.title,
        originalTitle: metadata.originalTitle || "",
        posterUrl: localPosterUrl(metadata.posterUrl),
        releaseDate: metadata.releaseDate ?? null,
        overview: metadata.overview || "",
        cast: cast.map((actor) => ({ ...actor, profileUrl: localActorImageUrl(actor.profileUrl) })),
        magnetUrl: null,
        personalReview: null,
        watchedAt: null,
        libraryMovieId: null,
        libraryStatus: null,
      };
    }
    return movie;
  }
  app.get("/api/catalog/movies/:tmdbId", async (c) => c.json({ movie: await catalogMovie(idSchema.parse(c.req.param("tmdbId")), "movie") }));
  app.get("/api/catalog/tv/:tmdbId", async (c) => c.json({ movie: await catalogMovie(idSchema.parse(c.req.param("tmdbId")), "tv") }));
  app.get("/api/catalog/douban/movies/:id", async (c) => c.json({ movie: await catalogMovie(idSchema.parse(c.req.param("id")), "movie", "douban") }));
  app.get("/api/catalog/douban/tv/:id", async (c) => c.json({ movie: await catalogMovie(idSchema.parse(c.req.param("id")), "tv", "douban") }));

  app.get("/api/movies", async (c) => {
    const { status, view, q, page, pageSize, mediaType } = listQuerySchema.parse(c.req.query());
    const keyword = normalizeSearchText(q);
    const mediaFilter = mediaType ? eq(movies.mediaType, mediaType) : undefined;
    const filter = and(
      mediaFilter,
      status ? eq(movies.status, status) : undefined,
      keyword ? or(sql`instr(${movies.titleSearch}, ${keyword}) > 0`, sql`instr(${movies.originalTitleSearch}, ${keyword}) > 0`) : undefined,
    );
    const count = db.select({ value: sql<number>`count(*)` }).from(movies).where(filter).get()!.value;
    const counts = db.select({
      all: sql<number>`count(*)`,
      recommended: sql<number>`coalesce(sum(case when ${movies.status} = 'recommended' then 1 else 0 end), 0)`,
      watched: sql<number>`coalesce(sum(case when ${movies.status} = 'watched' then 1 else 0 end), 0)`,
    }).from(movies).where(mediaFilter).get()!;
    const order = status === "watched" ? [desc(movies.watchedOrder), ...newestMovieOrder] : newestMovieOrder;
    const offset = (page - 1) * pageSize;
    const pagination = { total: count, page, pageSize, counts };
    if (view === "grid") {
      const rows = db.select(gridMovieColumns).from(movies).where(filter).orderBy(...order).limit(pageSize).offset(offset).all();
      const result: MovieGridList = {
        ...pagination,
        movies: await Promise.all(rows.map(async (movie) => ({
          ...movie,
          posterVariants: await posters.variants(movie.posterUrl),
        }))),
      };
      return c.json(result);
    }
    const result: MovieList = {
      ...pagination,
      movies: db.select(movieColumns).from(movies).where(filter).orderBy(...order).limit(pageSize).offset(offset).all().map(serializeMovie),
    };
    return c.json(result);
  });

  app.get("/api/movies/:id/posters", async (c) => c.json(await gallery.list(findMovie(idSchema.parse(c.req.param("id"))))));
  app.post("/api/movies/:id/posters/sync", async (c) => {
    const movie = findMovie(idSchema.parse(c.req.param("id")));
    posterSyncBodySchema.parse(await c.req.json());
    return c.json(await gallery.append(movie));
  });
  app.post("/api/movies/:id/posters", async (c) => {
    const movie = findMovie(idSchema.parse(c.req.param("id")));
    const { photoUrls } = posterPhotosBodySchema.parse(await c.req.json());
    return c.json(await gallery.append(movie, photoUrls.map((url) => url.split("/").at(-2)!)));
  });
  app.patch("/api/movies/:id/poster", async (c) => {
    const movie = findMovie(idSchema.parse(c.req.param("id")));
    const { posterId } = posterSelectionBodySchema.parse(await c.req.json());
    gallery.select(movie, posterId);
    return c.json({ movie: findMovie(movie.id) });
  });

  app.get("/api/movies/:id", (c) => c.json({ movie: findMovie(idSchema.parse(c.req.param("id"))) }));

  app.get("/api/tmdb/search", async (c) => {
    const query = searchQuerySchema.parse(c.req.query("q"));
    const found = await provider.search(query);
    const results = found.map((movie) => ({ ...movie, posterUrl: localPosterUrl(movie.posterUrl) }));
    return c.json({ results });
  });

  app.get("/api/metadata/search", async (c) => {
    const { provider: source, mediaType, q } = metadataSearchQuerySchema.parse(c.req.query());
    const found = await providers[source].search(q, mediaType);
    const results = found.filter((entry) => entry.provider === source && entry.mediaType === mediaType)
      .map((entry) => ({ ...entry, posterUrl: localPosterUrl(entry.posterUrl) }));
    return c.json({ results });
  });

  app.post("/api/movies/import", async (c) => {
    const { provider: source, mediaType, externalId, magnetUrl } = importBodySchema.parse(await c.req.json());
    if (findExternalMovie(source, mediaType, externalId)) duplicateMovie();
    const movie = await readMetadata(source, mediaType, externalId);
    return c.json({ movie: await insertMovie({ ...movie, magnetUrl: magnetUrl ?? null }) }, 201);
  });

  app.post("/api/movies", async (c) => {
    const input = movieInputSchema.parse(await c.req.json());
    return c.json({ movie: await insertMovie(input) }, 201);
  });

  app.patch("/api/movies/:id/status", async (c) => {
    const id = idSchema.parse(c.req.param("id"));
    const { status } = statusBodySchema.parse(await c.req.json());
    const movie = findMovie(id);
    if (movie.status === status) return c.json({ movie });
    const timestamp = new Date().toISOString();
    const updated = db.update(movies).set({
      status,
      watchedAt: status === "watched" ? timestamp : null,
      watchedOrder: status === "watched" ? sql`(select coalesce(max(${movies.watchedOrder}), 0) + 1 from ${movies})` : null,
      updatedAt: timestamp,
    }).where(eq(movies.id, id)).returning(movieColumns).get()!;
    return c.json({ movie: serializeMovie(updated) });
  });

  app.patch("/api/movies/:id/personal-review", async (c) => {
    const id = idSchema.parse(c.req.param("id"));
    const { personalReview } = personalReviewBodySchema.parse(await c.req.json());
    const movie = findMovie(id);
    if (movie.personalReview === personalReview) return c.json({ movie });
    const updated = db.update(movies).set({ personalReview, updatedAt: new Date().toISOString() })
      .where(eq(movies.id, id)).returning(movieColumns).get()!;
    return c.json({ movie: serializeMovie(updated) });
  });

  app.patch("/api/movies/:id/magnet", async (c) => {
    const id = idSchema.parse(c.req.param("id"));
    const { magnetUrl } = magnetBodySchema.parse(await c.req.json());
    const movie = findMovie(id);
    if (movie.magnetUrl === magnetUrl) return c.json({ movie });
    const updated = db.update(movies).set({ magnetUrl, updatedAt: new Date().toISOString() })
      .where(eq(movies.id, id)).returning(movieColumns).get()!;
    return c.json({ movie: serializeMovie(updated) });
  });

  app.all("/api/*", (c) => c.json({ error: { code: "NOT_FOUND", message: "没有找到这个接口。" } }, 404));
  return app;
}
