import { z } from "zod";
import { LOCAL_DOUBAN_POSTER_PATH_PATTERN, LOCAL_POSTER_PATH_PATTERN, LOCAL_TMDB_POSTER_PATH_PATTERN } from "./posters";
import { LOCAL_ACTOR_IMAGE_PATH_PATTERN } from "./actor-images";

const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nullableUrl = z.string().trim().max(2048).url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "https:" || protocol === "http:";
}, "图片地址必须使用 http 或 https").nullable();
const posterUrl = z.union([
  z.string().regex(LOCAL_POSTER_PATH_PATTERN, "本地海报地址无效"),
  z.string().regex(LOCAL_TMDB_POSTER_PATH_PATTERN, "海报预览地址无效"),
  z.string().regex(LOCAL_DOUBAN_POSTER_PATH_PATTERN, "豆瓣海报预览地址无效"),
  nullableUrl,
]);
const actorPhotoUrl = z.union([z.string().regex(LOCAL_ACTOR_IMAGE_PATH_PATTERN), z.string().regex(LOCAL_POSTER_PATH_PATTERN), nullableUrl]);
const releaseDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "发行日期应为 YYYY-MM-DD").refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "发行日期无效").nullable();

export const magnetUrlSchema = z.string().max(16000, "磁力链接过长").nullable().transform((value, context) => {
  const text = value?.trim();
  if (!text) return null;
  try {
    if (/[\u0000-\u001f\u007f]/.test(text) || !/^magnet:\?/i.test(text)) throw new Error("Invalid magnet URL");
    const url = new URL(text);
    const hashes = url.searchParams.getAll("xt");
    const hasValidHash = hashes.some((hash) => /^urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(hash) || /^urn:btmh:1220[a-f0-9]{64}$/i.test(hash));
    if (url.protocol !== "magnet:" || url.host || url.pathname || url.hash || !hasValidHash) throw new Error("Invalid magnet URL");
    return url.href;
  } catch {
    context.addIssue({ code: "custom", message: "请输入包含有效 BTIH 或 BTMH 哈希的 magnet 磁力链接" });
    return z.NEVER;
  }
});

export const mediaTypeSchema = z.enum(["movie", "tv"]);
export const metadataSourceSchema = z.enum(["tmdb", "douban"]);

export const movieInputSchema = z.object({
  mediaType: mediaTypeSchema.default("movie"),
  doubanId: positiveInteger.nullable().optional(),
  episodeCount: positiveInteger.nullable().optional(),
  tmdbId: positiveInteger.nullable().optional(),
  title: z.string().trim().min(1, "请输入作品名称").max(300),
  originalTitle: z.string().trim().max(300).optional(),
  posterUrl: posterUrl.optional(),
  releaseDate: releaseDate.optional(),
  overview: z.string().trim().max(20000).optional(),
  cast: z.array(z.object({
    tmdbPersonId: positiveInteger.nullable().optional(),
    name: z.string().trim().min(1).max(200),
    character: z.string().trim().max(300),
    profileUrl: actorPhotoUrl,
  }).strict()).max(100).optional(),
  magnetUrl: magnetUrlSchema.optional(),
}).strict().refine((value) => value.mediaType === "tv" || value.episodeCount == null, { path: ["episodeCount"], message: "电影不能设置剧集集数" });

export const idSchema = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(positiveInteger);
export const movieStatusSchema = z.enum(["recommended", "watched"]);
export const statusBodySchema = z.object({ status: movieStatusSchema }).strict();
export const magnetBodySchema = z.object({ magnetUrl: magnetUrlSchema }).strict();
export const importBodySchema = z.union([
  z.object({ tmdbId: positiveInteger, magnetUrl: magnetUrlSchema.optional() }).strict().transform(({ tmdbId, magnetUrl }) => ({ provider: "tmdb" as const, mediaType: "movie" as const, externalId: tmdbId, magnetUrl })),
  z.object({ provider: metadataSourceSchema, mediaType: mediaTypeSchema, externalId: positiveInteger, magnetUrl: magnetUrlSchema.optional() }).strict(),
]);
export const searchQuerySchema = z.string().trim().min(1, "请输入作品名称").max(200);
export const metadataSearchQuerySchema = z.object({ provider: metadataSourceSchema, mediaType: mediaTypeSchema, q: searchQuerySchema });

const queryInteger = (max: number, fallback: string) => z.string().regex(/^[1-9]\d*$/).default(fallback).transform(Number).pipe(z.number().int().min(1).max(max));
export const listQuerySchema = z.object({
  mediaType: mediaTypeSchema.optional(),
  status: movieStatusSchema.optional(),
  view: z.literal("grid").optional(),
  q: z.string().trim().max(200).default(""),
  page: queryInteger(1000000, "1"),
  pageSize: queryInteger(100, "20"),
});
export const actorMoviesQuerySchema = z.object({
  mediaType: mediaTypeSchema.default("movie"),
  page: queryInteger(1000000, "1"),
  pageSize: queryInteger(100, "24"),
});

// Match the original string: URL parsing and trimming can disguise invalid input.
export const doubanPhotoUrlSchema = z.string().max(150).regex(/^https:\/\/movie\.douban\.com\/photos\/photo\/([1-9]\d*)\/(?![\s\S])/, "请输入豆瓣图片详情页地址").refine((value) => Number.isSafeInteger(Number(value.split("/").at(-2))), "图片编号无效");
export const posterPhotosBodySchema = z.object({ photoUrls: z.array(doubanPhotoUrlSchema).min(1).max(40) }).strict();
export const posterSelectionBodySchema = z.object({ posterId: positiveInteger }).strict();
export const posterSyncBodySchema = z.object({}).strict();
