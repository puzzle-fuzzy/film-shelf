import type { ActorMovieList, ApiError, CatalogMovieDetails, MediaType, Movie, MovieGridList, MovieStatus, MoviePosterList } from "@film-shelf/shared";

export class ApiRequestError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "ApiRequestError"; }
}

export function getMoviePosters(id: number, signal: AbortSignal): Promise<MoviePosterList> {
  return getJson<MoviePosterList>(`/api/movies/${id}/posters`, signal, "海报图集暂时无法载入，请重试。");
}

export async function getMovies(status: MovieStatus, page: number, pageSize: number, signal: AbortSignal, mediaType?: MediaType): Promise<MovieGridList> {
  const query = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize), view: "grid" });
  if (mediaType) query.set("mediaType", mediaType);
  return getJson<MovieGridList>(`/api/movies?${query}`, signal);
}

export async function getMovie(id: string, signal: AbortSignal): Promise<Movie> {
  return (await getJson<{ movie: Movie }>(`/api/movies/${encodeURIComponent(id)}`, signal, "电影详情暂时无法载入，请稍后重试。")).movie;
}

export async function getActorMovies(id: string, page: number, signal: AbortSignal, mediaType: MediaType = "movie", provider: "tmdb" | "douban" = "tmdb"): Promise<ActorMovieList> {
  const query = new URLSearchParams({ page: String(page), pageSize: "24" });
  query.set("mediaType", mediaType);
  if (provider === "douban") query.set("provider", provider);
  return getJson<ActorMovieList>(`/api/actors/${encodeURIComponent(id)}/movies?${query}`, signal, "参演电影暂时无法载入，请稍后重试。");
}

export async function getCatalogMovie(id: string, signal: AbortSignal, mediaType: MediaType = "movie", provider: "tmdb" | "douban" = "tmdb"): Promise<CatalogMovieDetails> {
  return (await getJson<{ movie: CatalogMovieDetails }>(`/api/catalog/${provider === "douban" ? "douban/" : ""}${mediaType === "tv" ? "tv" : "movies"}/${encodeURIComponent(id)}`, signal, "影视详情暂时无法载入，请稍后重试。")).movie;
}

async function getJson<T>(url: string, signal: AbortSignal, message = "暂时无法载入片单，请稍后重试。"): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(message);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new ApiRequestError(response.status, (data as ApiError | null)?.error?.message || message);
  }
  return data as T;
}
