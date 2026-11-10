export type MovieStatus = "recommended" | "watched";

export interface CastMember {
  tmdbPersonId?: number | null;
  name: string;
  character: string;
  profileUrl: string | null;
}

export interface MovieInput {
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
  tmdbId: number;
  title: string;
  originalTitle: string;
  posterUrl: string | null;
  releaseDate: string | null;
  overview: string;
}

export type MovieDetailData = Pick<Movie, "title" | "originalTitle" | "posterUrl" | "releaseDate" | "overview" | "cast" | "watchedAt" | "magnetUrl">;

export interface CatalogMovieDetails extends MovieDetailData {
  tmdbId: number;
  libraryMovieId: number | null;
  libraryStatus: MovieStatus | null;
}

export interface ActorSummary {
  tmdbPersonId: number;
  name: string;
  profileUrl: string | null;
}

export interface ActorMovie extends SearchMovie {
  character: string;
  libraryMovieId: number | null;
  libraryStatus: MovieStatus | null;
  posterVariants?: PosterVariant[];
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

export type MovieGridItem = Pick<Movie, "id" | "title" | "posterUrl" | "releaseDate"> & {
  posterVariants?: PosterVariant[];
};

export type MovieGridList = Omit<MovieList, "movies"> & { movies: MovieGridItem[] };

export interface ApiError {
  error: { code: string; message: string };
}
