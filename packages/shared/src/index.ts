export type MovieStatus = "recommended" | "watched";
export type MediaType = "movie" | "tv";
export type MetadataSource = "tmdb" | "douban";

export interface MetadataPoster {
  source: MetadataSource;
  sourceId: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface MoviePoster {
  id: number;
  url: string;
  width: number | null;
  height: number | null;
  source: MetadataSource | null;
  posterVariants?: PosterVariant[];
}

export interface MoviePosterList {
  posters: MoviePoster[];
  primaryPosterId: number | null;
}

export interface MetadataSearchResult {
  provider: MetadataSource;
  mediaType: MediaType;
  externalId: number;
  title: string;
  originalTitle: string;
  posterUrl: string | null;
  releaseDate: string | null;
  overview: string;
  year?: string;
  countries?: string[];
}

export interface CastMember {
  tmdbPersonId?: number | null;
  doubanPersonId?: number | null;
  name: string;
  character: string;
  profileUrl: string | null;
}

export interface MovieInput {
  mediaType?: MediaType;
  doubanId?: number | null;
  episodeCount?: number | null;
  tmdbId?: number | null;
  title: string;
  originalTitle?: string;
  posterUrl?: string | null;
  releaseDate?: string | null;
  overview?: string;
  cast?: CastMember[];
  magnetUrl?: string | null;
}

export interface Movie {
  id: number;
  mediaType: MediaType;
  doubanId: number | null;
  episodeCount: number | null;
  tmdbId: number | null;
  title: string;
  originalTitle: string;
  posterUrl: string | null;
  releaseDate: string | null;
  overview: string;
  cast: CastMember[];
  magnetUrl: string | null;
  status: MovieStatus;
  watchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SearchMovie {
  mediaType?: MediaType;
  year?: string;
  countries?: string[];
  tmdbId: number;
  title: string;
  originalTitle: string;
  posterUrl: string | null;
  releaseDate: string | null;
  overview: string;
}

export type MovieDetailData = Pick<Movie, "title" | "originalTitle" | "posterUrl" | "releaseDate" | "overview" | "cast" | "watchedAt" | "magnetUrl" | "mediaType" | "episodeCount" | "tmdbId" | "doubanId">;

export interface CatalogMovieDetails extends MovieDetailData {
  tmdbId: number | null;
  libraryMovieId: number | null;
  libraryStatus: MovieStatus | null;
}

export interface ActorSummary {
  tmdbPersonId: number | null;
  doubanPersonId?: number | null;
  name: string;
  profileUrl: string | null;
}

export interface ActorMovie extends Omit<SearchMovie, "tmdbId"> {
  tmdbId: number | null;
  doubanId?: number | null;
  provider?: MetadataSource;
  character: string;
  libraryMovieId: number | null;
  libraryStatus: MovieStatus | null;
  posterVariants?: PosterVariant[];
}

export interface ActorFilmography {
  actor: ActorSummary;
  movies: Array<Omit<ActorMovie, "libraryMovieId" | "libraryStatus" | "posterVariants">>;
}

export interface ActorMovieList {
  actor: ActorSummary;
  movies: ActorMovie[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MovieList {
  movies: Movie[];
  total: number;
  page: number;
  pageSize: number;
  counts: { all: number; recommended: number; watched: number };
}

export interface PosterVariant {
  url: string;
  width: number;
}

export type MovieGridItem = Pick<Movie, "id" | "title" | "posterUrl" | "releaseDate" | "mediaType"> & {
  posterVariants?: PosterVariant[];
};

export type MovieGridList = Omit<MovieList, "movies"> & { movies: MovieGridItem[] };

export interface ApiError {
  error: { code: string; message: string };
}
