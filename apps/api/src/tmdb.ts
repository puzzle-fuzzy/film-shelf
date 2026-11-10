import type { ActorSummary, MediaType, MovieInput, SearchMovie } from "@film-shelf/shared";
import { z } from "zod";
import { ApiException } from "./errors";
import { createMetadataCache } from "./metadata-cache";

export interface MovieMetadataProvider {
  readonly configured: boolean;
  search(query: string, mediaType?: MediaType): Promise<SearchMovie[]>;
  details(tmdbId: number, mediaType?: MediaType): Promise<MovieInput>;
  actorFilmography?(personId: number, mediaType?: MediaType): Promise<ActorFilmography>;
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
const tvSummarySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  original_name: z.string().optional().default(""),
  poster_path: z.string().nullable().optional().default(null),
  first_air_date: z.string().optional().default(""),
  overview: z.string().optional().default(""),
  origin_country: z.array(z.string()).optional(),
});
const tvSearchResponseSchema = z.object({ results: z.array(tvSummarySchema) });
const tvDetailResponseSchema = tvSummarySchema.extend({
  number_of_episodes: z.number().int().nonnegative().nullable().optional().default(null),
  aggregate_credits: z.object({
    cast: z.array(z.object({
      id: z.number().int().positive().optional(),
      name: z.string(),
      roles: z.array(z.object({ character: z.string().optional().default("") })).default([]),
      profile_path: z.string().nullable().optional().default(null),
      order: z.number().optional().default(9999),
    })).default([]),
  }),
});
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
const tvPersonResponseSchema = personResponseSchema.omit({ movie_credits: true }).extend({
  tv_credits: z.object({ cast: z.array(tvSummarySchema.extend({ character: z.string().optional().default("") })).default([]) }),
});

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

function toTvSummary(show: z.infer<typeof tvSummarySchema>): Omit<SearchMovie, "countries" | "year"> {
  return {
    mediaType: "tv", tmdbId: show.id, title: show.name || show.original_name,
    originalTitle: show.original_name, posterUrl: imageUrl(show.poster_path, "w500"),
    releaseDate: show.first_air_date || null, overview: show.overview,
  };
}

function toSearchTv(show: z.infer<typeof tvSummarySchema>): SearchMovie {
  return {
    ...toTvSummary(show),
    ...(show.origin_country === undefined ? {} : { countries: show.origin_country }),
  };
}

export function createTmdbProvider(token = process.env.TMDB_READ_ACCESS_TOKEN || "", fetcher: typeof fetch = fetch): MovieMetadataProvider {
  const accessToken = token.trim();
  const cachedDetails = createMetadataCache<MovieInput>();
  const cachedFilmography = createMetadataCache<ActorFilmography>();
  async function request<T>(path: string, params: Record<string, string>, schema: z.ZodType<T>, resource: "movie" | "tv" | "person" = "movie"): Promise<T> {
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
      if (resource === "tv") throw new ApiException(404, "TMDB_TV_NOT_FOUND", "TMDB 中没有找到这部电视剧。");
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
    async search(query, mediaType = "movie") {
      if (mediaType === "tv") {
        const data = await request("search/tv", { query, include_adult: "false", page: "1" }, tvSearchResponseSchema, "tv");
        return data.results.map(toSearchTv);
      }
      const data = await request("search/movie", { query, include_adult: "false", page: "1" }, searchResponseSchema);
      return data.results.map(toSearchMovie);
    },
    details(tmdbId, mediaType = "movie") {
      return cachedDetails(`${mediaType}:${tmdbId}`, async () => {
        if (mediaType === "tv") {
          const data = await request(`tv/${tmdbId}`, { append_to_response: "aggregate_credits" }, tvDetailResponseSchema, "tv");
          let overview = data.overview;
          if (!overview.trim()) {
            // Translation coverage is optional; aggregate credits remain from the full-show request.
            try {
              const english = await request(`tv/${tmdbId}`, { language: "en-US" }, tvSummarySchema, "tv");
              overview = english.overview || overview;
            } catch { /* Preserve the usable Chinese result when the optional translation is unavailable. */ }
          }
          return {
            ...toTvSummary(data), mediaType: "tv", episodeCount: data.number_of_episodes || null, overview,
            cast: [...data.aggregate_credits.cast].sort((a, b) => a.order - b.order).slice(0, 20).map(person => ({
              ...(person.id === undefined ? {} : { tmdbPersonId: person.id }), name: person.name,
              character: [...new Set(person.roles.map(role => role.character.trim()).filter(Boolean))].join(" / "),
              profileUrl: imageUrl(person.profile_path, "w185"),
            })),
          };
        }
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
    actorFilmography(personId, mediaType = "movie") {
      return cachedFilmography(`${mediaType}:${personId}`, async () => {
        const data = mediaType === "tv"
          ? await request(`person/${personId}`, { append_to_response: "tv_credits" }, tvPersonResponseSchema, "person")
          : await request(`person/${personId}`, { append_to_response: "movie_credits" }, personResponseSchema, "person");
        if (data.id !== personId) throw new ApiException(502, "TMDB_INVALID_RESPONSE", "TMDB 返回的演员资料与所选演员不一致。");
        const credits = new Map<number, SearchMovie & { character: string }>();
        const characterSets = new Map<number, Set<string>>();
        const mappedCredits = "tv_credits" in data
          ? data.tv_credits.cast.map(credit => ({ ...toSearchTv(credit), character: credit.character }))
          : data.movie_credits.cast.map(credit => ({ ...toSearchMovie(credit), character: credit.character }));
        for (const credit of mappedCredits) {
          const character = credit.character.trim();
          const existing = credits.get(credit.tmdbId);
          if (!existing) {
            credits.set(credit.tmdbId, { ...credit, character });
            characterSets.set(credit.tmdbId, new Set(character ? [character] : []));
          } else if (character) {
            const characters = characterSets.get(credit.tmdbId)!;
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
