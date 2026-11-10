import { ApiException } from "./errors";
import { LOCAL_POSTER_PATH_PATTERN } from "./posters";

const filenamePattern = /^[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/;
const sourcePattern = /^https:\/\/image\.tmdb\.org\/t\/p\/w185\/([A-Za-z0-9_-]+\.(?:jpg|png|webp))$/;
export const LOCAL_ACTOR_IMAGE_PATH_PATTERN = /^\/api\/actors\/image\/([A-Za-z0-9_-]+\.(?:jpg|png|webp))$/;

export function localActorImageUrl(source: string | null): string | null {
  if (!source) return null;
  if (LOCAL_ACTOR_IMAGE_PATH_PATTERN.test(source) || LOCAL_POSTER_PATH_PATTERN.test(source)) return source;
  const match = sourcePattern.exec(source);
  return match ? `/api/actors/image/${match[1]}` : null;
}

export function actorImageSource(filename: string): string {
  if (!filenamePattern.test(filename)) throw new ApiException(404, "ACTOR_IMAGE_NOT_FOUND", "没有找到这张演员照片。");
  return `https://image.tmdb.org/t/p/w185/${filename}`;
}
