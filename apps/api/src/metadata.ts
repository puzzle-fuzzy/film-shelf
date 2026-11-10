import type { MediaType, MetadataSearchResult, MovieInput } from "@film-shelf/shared";
import type { MovieMetadataProvider } from "./tmdb";

export interface MetadataProvider {
  readonly configured: boolean;
  search(query: string, mediaType: MediaType): Promise<MetadataSearchResult[]>;
  details(id: number, mediaType: MediaType): Promise<MovieInput>;
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
  };
}
