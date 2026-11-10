import type { ActorMovieList, CatalogMovieDetails, MediaType, MetadataSource, Movie, MovieGridList, MovieInput, MovieList } from "@film-shelf/shared";
import { and, desc, eq, getTableColumns, inArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { newestMovieOrder, normalizeSearchText, type MovieDatabase } from "./db";
import { ApiException } from "./errors";
import { movies } from "./schema";
import { createPosterStore, doubanPosterSource, localPosterUrl, LOCAL_POSTER_PATH_PATTERN, LOCAL_TMDB_POSTER_PATH_PATTERN, type PosterStore } from "./posters";
import { actorImageSource, localActorImageUrl } from "./actor-images";
import { createTmdbProvider, type MovieMetadataProvider } from "./tmdb";
import { createDoubanProvider, tmdbMetadataProvider, type MetadataProvider } from "./metadata";
import { actorMoviesQuerySchema, idSchema, importBodySchema, listQuerySchema, magnetBodySchema, metadataSearchQuerySchema, movieInputSchema, searchQuerySchema, statusBodySchema } from "./validation";

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
    const identity = source === "tmdb" ? and(eq(movies.mediaType, mediaType), eq(movies.tmdbId, externalId)) : eq(movies.doubanId, externalId);
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
    const mediaType = input.mediaType ?? "movie";
    if ((input.tmdbId && findExternalMovie("tmdb", mediaType, input.tmdbId)) || (input.doubanId && findExternalMovie("douban", mediaType, input.doubanId))) duplicateMovie();
    const posterUrl = await posters.save(input.posterUrl);
    await posters.ensureVariants(posterUrl);
    const timestamp = new Date().toISOString();
    const movie = db.insert(movies).values({
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
      cast: input.cast || [],
      magnetUrl: input.magnetUrl ?? null,
      status: "recommended",
      watchedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).onConflictDoNothing().returning(movieColumns).get();
    if (!movie) duplicateMovie();
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
    return posters.respond(cached[1]!);
  });
  app.get("/api/posters/douban/:encoded", async (c) => {
    const source = doubanPosterSource(c.req.path);
    const local = await posters.save(source);
    const cached = local && LOCAL_POSTER_PATH_PATTERN.exec(local);
    if (!cached) throw new ApiException(502, "POSTER_UNAVAILABLE", "海报暂时无法读取，请稍后重试。");
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
    const { page, pageSize, mediaType } = actorMoviesQuerySchema.parse(c.req.query());
    if (!provider.actorFilmography) throw new ApiException(503, "METADATA_UNAVAILABLE", "当前资料源暂不支持演员作品查询，请稍后重试。");
    const filmography = await provider.actorFilmography(personId, mediaType);
    const pageMovies = filmography.movies.slice((page - 1) * pageSize, page * pageSize);
    const localMovies = pageMovies.length ? db.select({
      id: movies.id,
      tmdbId: movies.tmdbId,
      status: movies.status,
      title: movies.title,
      posterUrl: movies.posterUrl,
    }).from(movies).where(and(eq(movies.mediaType, mediaType), inArray(movies.tmdbId, pageMovies.map((movie) => movie.tmdbId)))).all() : [];
    const library = new Map(localMovies.map((movie) => [movie.tmdbId, movie]));
    const results = await Promise.all(pageMovies.map(async (movie) => {
      const local = library.get(movie.tmdbId);
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

  async function catalogMovie(tmdbId: number, mediaType: MediaType): Promise<CatalogMovieDetails> {
    const local = findExternalMovie("tmdb", mediaType, tmdbId);
    let movie: CatalogMovieDetails;
    if (local) {
      const saved = serializeMovie(local);
      movie = {
        tmdbId,
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
        watchedAt: saved.watchedAt,
        libraryMovieId: saved.id,
        libraryStatus: saved.status,
      };
    } else {
      const metadata = await readMetadata("tmdb", mediaType, tmdbId);
      movie = {
        tmdbId,
        mediaType,
        doubanId: null,
        episodeCount: metadata.episodeCount ?? null,
        title: metadata.title,
        originalTitle: metadata.originalTitle || "",
        posterUrl: localPosterUrl(metadata.posterUrl),
        releaseDate: metadata.releaseDate ?? null,
        overview: metadata.overview || "",
        cast: (metadata.cast || []).map((actor) => ({ ...actor, profileUrl: localActorImageUrl(actor.profileUrl) })),
        magnetUrl: null,
        watchedAt: null,
        libraryMovieId: null,
        libraryStatus: null,
      };
    }
    return movie;
  }
  app.get("/api/catalog/movies/:tmdbId", async (c) => c.json({ movie: await catalogMovie(idSchema.parse(c.req.param("tmdbId")), "movie") }));
  app.get("/api/catalog/tv/:tmdbId", async (c) => c.json({ movie: await catalogMovie(idSchema.parse(c.req.param("tmdbId")), "tv") }));

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
