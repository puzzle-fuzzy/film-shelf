import type { ActorFilmography, MediaType, MetadataPoster, MetadataSearchResult, MovieInput } from "@film-shelf/shared";
import type { MovieMetadataProvider } from "./tmdb";

export interface MetadataProvider {
  readonly configured: boolean;
  search(query: string, mediaType: MediaType): Promise<MetadataSearchResult[]>;
  details(id: number, mediaType: MediaType): Promise<MovieInput>;
  posters?(id: number, mediaType: MediaType): Promise<MetadataPoster[]>;
  poster?(id: number, mediaType: MediaType, photoId: number): Promise<MetadataPoster>;
  actor?(personId: number): Promise<{ doubanPersonId: number; name: string; profileUrl: string | null; imdbId: string | null }>;
  actorFilmography?(personId: number, mediaType: MediaType): Promise<ActorFilmography>;
  imdbId?(id: number, mediaType: MediaType): Promise<string | null>;
}

export { createDoubanProvider } from "./douban";

export function tmdbMetadataProvider(provider: MovieMetadataProvider): MetadataProvider {
  return {
    get configured() { return provider.configured; },
    async search(query, mediaType) {
      return (await provider.search(query, mediaType)).map(({ tmdbId, ...result }) => ({ ...result, provider: "tmdb", mediaType, externalId: tmdbId }));
    },
    async details(id, mediaType) {
      const result = await provider.details(id, mediaType);
      return { ...result, ...(result.mediaType === undefined && mediaType === "movie" ? { mediaType: "movie" as const } : {}) };
    },
    ...(provider.posters ? { posters: (id: number, mediaType: MediaType) => provider.posters!(id, mediaType) } : {}),
  };
}
