import type { ActorSummary, MovieInput, SearchMovie } from "@film-shelf/shared";
import { z } from "zod";
import { ApiException } from "./errors";

export interface MovieMetadataProvider {
  readonly configured: boolean;
  search(query: string): Promise<SearchMovie[]>;
  details(tmdbId: number): Promise<MovieInput>;
  actorFilmography?(personId: number): Promise<ActorFilmography>;
}

export interface ActorFilmography {
  actor: ActorSummary;
  movies: Array<SearchMovie & { character: string }>;
}

const movieSummarySchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  original_title: z.string().optional().default(""),
  poster_path: z.string().nullable().optional().default(null),
  release_date: z.string().optional().default(""),
  overview: z.string().optional().default(""),
});
const searchResponseSchema = z.object({ results: z.array(movieSummarySchema) });
const detailResponseSchema = movieSummarySchema.extend({
  credits: z.object({
    cast: z.array(z.object({
      id: z.number().int().positive().optional(),
      name: z.string(),
      character: z.string().optional().default(""),
      profile_path: z.string().nullable().optional().default(null),
      order: z.number().optional().default(9999),
    })).default([]),
  }),
});
const personResponseSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  profile_path: z.string().nullable().optional().default(null),
  movie_credits: z.object({
    cast: z.array(movieSummarySchema.extend({ character: z.string().optional().default("") })).default([]),
  }),
});

function createMetadataCache<T>() {
  const entries = new Map<number, { expiresAt: number; value: T }>();
  const pending = new Map<number, Promise<T>>();
  return async (key: number, load: () => Promise<T>): Promise<T> => {
    const entry = entries.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    }
    entries.delete(key);
    const existing = pending.get(key);
    if (existing) return existing;
    const request = load().then((value) => {
      entries.set(key, { expiresAt: Date.now() + 10 * 60 * 1000, value });
      while (entries.size > 100) entries.delete(entries.keys().next().value!);
      return value;
    }).finally(() => { pending.delete(key); });
    pending.set(key, request);
    return request;
  };
}

function imageUrl(path: string | null, size: "w185" | "w500") {
  return path && /^\/[A-Za-z0-9_.-]+$/.test(path) ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

function toSearchMovie(movie: z.infer<typeof movieSummarySchema>): SearchMovie {
  return {
    tmdbId: movie.id,
    title: movie.title || movie.original_title,
    originalTitle: movie.original_title,
    posterUrl: imageUrl(movie.poster_path, "w500"),
    releaseDate: movie.release_date || null,
    overview: movie.overview,
  };
}

export function createTmdbProvider(token = process.env.TMDB_READ_ACCESS_TOKEN || "", fetcher: typeof fetch = fetch): MovieMetadataProvider {
  const accessToken = token.trim();
  const cachedDetails = createMetadataCache<MovieInput>();
  const cachedFilmography = createMetadataCache<ActorFilmography>();
  async function request<T>(path: string, params: Record<string, string>, schema: z.ZodType<T>, resource: "movie" | "person" = "movie"): Promise<T> {
    if (!accessToken) throw new ApiException(503, "TMDB_NOT_CONFIGURED", "请先在项目 .env 中配置 TMDB_READ_ACCESS_TOKEN，然后重启服务。");
    const url = new URL(`https://api.themoviedb.org/3/${path}`);
    url.search = new URLSearchParams({ language: "zh-CN", ...params }).toString();
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new ApiException(504, "TMDB_TIMEOUT", "TMDB 请求超时，请稍后重试。");
      }
      throw new ApiException(502, "TMDB_UNAVAILABLE", "暂时无法连接 TMDB，请检查网络后重试。");
    }
    if (response.status === 401 || response.status === 403) throw new ApiException(502, "TMDB_AUTH_FAILED", "TMDB Token 无效或没有访问权限，请检查服务端配置。");
    if (response.status === 404) {
      if (resource === "person") throw new ApiException(404, "TMDB_PERSON_NOT_FOUND", "TMDB 中没有找到这位演员。");
      throw new ApiException(404, "TMDB_MOVIE_NOT_FOUND", "TMDB 中没有找到这部电影。");
    }
    if (response.status === 429) throw new ApiException(429, "TMDB_RATE_LIMITED", "TMDB 请求过于频繁，请稍后重试。");
    if (!response.ok) throw new ApiException(502, "TMDB_UNAVAILABLE", "TMDB 暂时无法提供电影资料，请稍后重试。");
    try {
      return schema.parse(await response.json());
    } catch {
      throw new ApiException(502, "TMDB_INVALID_RESPONSE", `TMDB 返回的${resource === "person" ? "演员" : "电影"}资料格式异常，请稍后重试。`);
    }
  }

  return {
    configured: accessToken.length > 0,
    async search(query) {
      const data = await request("search/movie", { query, include_adult: "false", page: "1" }, searchResponseSchema);
      return data.results.map(toSearchMovie);
    },
    details(tmdbId) {
      return cachedDetails(tmdbId, async () => {
        const data = await request(`movie/${tmdbId}`, { append_to_response: "credits" }, detailResponseSchema);
        const { tmdbId: id, ...summary } = toSearchMovie(data);
        return {
          tmdbId: id,
          ...summary,
          cast: [...data.credits.cast].sort((a, b) => a.order - b.order).slice(0, 20).map((person) => ({
            ...(person.id === undefined ? {} : { tmdbPersonId: person.id }),
            name: person.name,
            character: person.character,
            profileUrl: imageUrl(person.profile_path, "w185"),
          })),
        };
      });
    },
    actorFilmography(personId) {
      return cachedFilmography(personId, async () => {
        const data = await request(`person/${personId}`, { append_to_response: "movie_credits" }, personResponseSchema, "person");
        if (data.id !== personId) throw new ApiException(502, "TMDB_INVALID_RESPONSE", "TMDB 返回的演员资料与所选演员不一致。");
        const credits = new Map<number, SearchMovie & { character: string }>();
        const characterSets = new Map<number, Set<string>>();
        for (const credit of data.movie_credits.cast) {
          const character = credit.character.trim();
          const existing = credits.get(credit.id);
          if (!existing) {
            credits.set(credit.id, { ...toSearchMovie(credit), character });
            characterSets.set(credit.id, new Set(character ? [character] : []));
          } else if (character) {
            const characters = characterSets.get(credit.id)!;
            characters.add(character);
            existing.character = [...characters].join(" / ");
          }
        }
        return {
          actor: { tmdbPersonId: data.id, name: data.name, profileUrl: imageUrl(data.profile_path, "w185") },
          movies: [...credits.values()].sort((a, b) => {
            if (a.releaseDate !== b.releaseDate) {
              if (!a.releaseDate) return 1;
              if (!b.releaseDate) return -1;
              return b.releaseDate.localeCompare(a.releaseDate);
            }
            return b.tmdbId - a.tmdbId;
          }),
        };
      });
    },
  };
}
