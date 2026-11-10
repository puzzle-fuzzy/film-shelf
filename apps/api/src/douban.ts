import type { MediaType, MetadataPoster, MetadataSearchResult, MovieInput } from "@film-shelf/shared";
import { z } from "zod";
import { ApiException } from "./errors";
import { createMetadataCache } from "./metadata-cache";
import type { MetadataProvider } from "./metadata";

const idSchema = z.union([z.number().int().positive().safe(), z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().positive().safe())]);
const imageSchema = z.object({ url: z.string().optional() });
const subjectSchema = z.object({
  id: idSchema,
  type: z.enum(["movie", "tv"]),
  title: z.string().trim().min(1),
  original_title: z.string().nullish(),
  intro: z.string().nullish(),
  pubdate: z.array(z.string()).nullish(),
  year: z.union([z.string(), z.number()]).nullish(),
  countries: z.array(z.string()).nullish(),
  card_subtitle: z.string().nullish(),
  episodes_count: z.number().int().nonnegative().nullish(),
  cover_url: z.string().nullish(),
  pic: z.object({ large: z.string().optional() }).nullish(),
  cover: z.object({
    url: z.string().optional(),
    image: z.object({ large: imageSchema.optional() }).optional(),
  }).nullish(),
  actors: z.array(z.object({
    name: z.string().trim().min(1),
  })).nullish(),
});
type Subject = z.infer<typeof subjectSchema>;
const photoSchema = z.object({
  id: idSchema,
  owner_uri: z.string(),
  photo_type: z.string(),
  image: z.object({ large: z.object({
    url: z.string(), width: z.number().int().positive().max(50000).nullish(), height: z.number().int().positive().max(50000).nullish(),
  }) }),
});

function invalidResponse(): never {
  throw new ApiException(502, "DOUBAN_INVALID_RESPONSE", "豆瓣返回的资料格式异常或需要验证，请稍后重试。");
}

function validDate(values: string[] | null | undefined): string | null {
  const dates: string[] = [];
  for (const value of values || []) {
    const match = /^(\d{4}-\d{2}-\d{2})(?:$|\s|\()/.exec(value);
    if (!match) continue;
    const candidate = match[1]!;
    const date = new Date(`${candidate}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === candidate) dates.push(candidate);
  }
  return dates.sort()[0] || null;
}

function imageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function summary(subject: Subject): MetadataSearchResult {
  const subtitleParts = (subject.card_subtitle || "").split("/").map(part => part.trim()).filter(Boolean);
  if (/^\d{4}年?$/.test(subtitleParts[0] || "")) subtitleParts.shift();
  const country = subtitleParts[0]?.replace(/^\d{4}年?\s+/, "");
  const countries = subject.countries ?? (country ? country.split(/\s+/) : undefined);
  return {
    provider: "douban", mediaType: subject.type, externalId: subject.id,
    title: subject.title, originalTitle: subject.original_title || "",
    // The API's cover.url may be a thumbnail. Prefer the original large image.
    posterUrl: imageUrl(subject.cover?.image?.large?.url) || imageUrl(subject.cover_url) || imageUrl(subject.pic?.large) || imageUrl(subject.cover?.url),
    releaseDate: validDate(subject.pubdate), overview: subject.intro || "",
    ...(subject.year == null ? {} : { year: String(subject.year) }),
    ...(countries === undefined ? {} : { countries }),
  };
}

/** Anonymous, fixed-origin provider. Never forwards browser cookies or follows login redirects. */
export function createDoubanProvider(fetcher: typeof fetch = fetch): MetadataProvider {
  const cachedDetails = createMetadataCache<MovieInput>();
  const cachedSearch = createMetadataCache<MetadataSearchResult[]>();
  const cachedPoster = createMetadataCache<MetadataPoster>();
  const cachedPosters = createMetadataCache<MetadataPoster[]>();
  let activeRequests = 0;

  async function request(path: string, params?: Record<string, string>, subjectId?: number): Promise<unknown> {
    if (activeRequests >= 4) throw new ApiException(429, "DOUBAN_BUSY", "豆瓣资料请求繁忙，请稍后重试。");
    activeRequests++;
    try {
      const url = new URL(`https://m.douban.com/rexxar/api/v2/${path}`);
      if (params) url.search = new URLSearchParams(params).toString();
      const referer = path === "search/movie"
        ? `https://m.douban.com/search/?${new URLSearchParams({ query: params?.q || "", type: "movie" })}`
        : `https://m.douban.com/movie/subject/${subjectId ?? path.split("/")[1]}/`;
      let response: Response;
      try {
        response = await fetcher(url, {
          headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 FilmShelf/1.0", Referer: referer },
          credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10000),
        });
      } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
          throw new ApiException(504, "DOUBAN_TIMEOUT", "豆瓣请求超时，请稍后重试。");
        }
        throw new ApiException(502, "DOUBAN_UNAVAILABLE", "暂时无法连接豆瓣，请稍后重试。");
      }
      if ([401, 403, 418].includes(response.status)) throw new ApiException(502, "DOUBAN_VERIFICATION_REQUIRED", "豆瓣需要人工验证，暂时无法匿名获取资料。");
      if (response.status === 404) throw new ApiException(404, "DOUBAN_NOT_FOUND", "豆瓣中没有找到这部作品。");
      if (response.status === 429) throw new ApiException(429, "DOUBAN_RATE_LIMITED", "豆瓣请求过于频繁，请稍后重试。");
      if (!response.ok) throw new ApiException(502, "DOUBAN_UNAVAILABLE", "豆瓣暂时无法提供资料，请稍后重试。");
      if (response.redirected || !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("Content-Type") || "")) invalidResponse();
      try { return await response.json(); } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
          throw new ApiException(504, "DOUBAN_TIMEOUT", "豆瓣请求超时，请稍后重试。");
        }
        if (error instanceof SyntaxError) return invalidResponse();
        throw new ApiException(502, "DOUBAN_UNAVAILABLE", "读取豆瓣资料失败，请稍后重试。");
      }
    } finally {
      // Keep the slot until body consumption completes; every transport/error path releases it.
      activeRequests--;
    }
  }

  function checkId(id: number) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new ApiException(400, "INVALID_ID", "资料 ID 必须是正整数。");
  }

  function verificationRequired(): never {
    throw new ApiException(502, "DOUBAN_VERIFICATION_REQUIRED", "豆瓣海报相册需要验证，可打开豆瓣相册后粘贴海报图片页链接。");
  }

  async function poster(id: number, mediaType: MediaType, photoId: number): Promise<MetadataPoster> {
    checkId(id);
    checkId(photoId);
    return cachedPoster(`${mediaType}:${id}:${photoId}`, async () => {
      const parsed = photoSchema.safeParse(await request(`photo/${photoId}`, undefined, id));
      if (!parsed.success) invalidResponse();
      const photo = parsed.data;
      if (photo.id !== photoId || photo.owner_uri !== `douban://douban.com/${mediaType}/${id}`) {
        throw new ApiException(422, "DOUBAN_POSTER_MISMATCH", "这张豆瓣图片不属于当前作品。");
      }
      if (photo.photo_type !== "poster") throw new ApiException(422, "DOUBAN_NOT_POSTER", "这张豆瓣图片不是海报，请选择海报相册中的图片。");
      const url = photo.image.large.url;
      const match = /^https:\/\/img[1239]\.doubanio\.com\/view\/photo\/(?:l|large|raw)\/public\/p([1-9][0-9]{0,19})\.(?:jpg|png|webp)$/.exec(url);
      if (!match || match[1] !== String(photoId)) invalidResponse();
      return { source: "douban", sourceId: String(photoId), url, width: photo.image.large.width ?? null, height: photo.image.large.height ?? null };
    });
  }

  async function posterIds(id: number): Promise<number[]> {
    if (activeRequests >= 4) throw new ApiException(429, "DOUBAN_BUSY", "豆瓣资料请求繁忙，请稍后重试。");
    activeRequests++;
    try {
      let response: Response;
      try {
        response = await fetcher(`https://movie.douban.com/subject/${id}/photos?type=R`, {
          headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 FilmShelf/1.0", Referer: `https://movie.douban.com/subject/${id}/` },
          credentials: "omit", redirect: "manual", signal: AbortSignal.timeout(10000),
        });
      } catch (error) {
        if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new ApiException(504, "DOUBAN_TIMEOUT", "豆瓣请求超时，请稍后重试。");
        throw new ApiException(502, "DOUBAN_UNAVAILABLE", "暂时无法连接豆瓣，请稍后重试。");
      }
      if ((response.status >= 300 && response.status < 400) || [401, 403, 418].includes(response.status) || response.redirected) verificationRequired();
      if (response.status === 429) throw new ApiException(429, "DOUBAN_RATE_LIMITED", "豆瓣请求过于频繁，请稍后重试。");
      if (!response.ok) throw new ApiException(502, "DOUBAN_UNAVAILABLE", "豆瓣暂时无法提供海报相册，请稍后重试。");
      if (!/^text\/html(?:\s*;|$)/i.test(response.headers.get("Content-Type") || "")) verificationRequired();
      const maximum = 1_048_576;
      if (Number(response.headers.get("Content-Length")) > maximum) verificationRequired();
      const reader = response.body?.getReader();
      if (!reader) verificationRequired();
      const decoder = new TextDecoder();
      let size = 0;
      let html = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maximum) { await reader.cancel(); verificationRequired(); }
          html += decoder.decode(chunk.value, { stream: true });
        }
        html += decoder.decode();
      } catch (error) {
        if (error instanceof ApiException) throw error;
        if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new ApiException(504, "DOUBAN_TIMEOUT", "豆瓣请求超时，请稍后重试。");
        throw new ApiException(502, "DOUBAN_UNAVAILABLE", "读取豆瓣海报相册失败，请稍后重试。");
      } finally { reader.releaseLock(); }
      if (!/<h1\b[^>]*>[\s\S]*?海报[\s\S]*?<\/h1>/i.test(html)
        || !new RegExp(`href=["'](?:https://movie\\.douban\\.com)?/subject/${id}/["']`, "i").test(html)) verificationRequired();
      const list = /<ul\b[^>]*class=["'][^"']*\bposter-col3\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i.exec(html);
      if (!list) verificationRequired();
      const ids = new Set<number>();
      for (const match of list[1]!.matchAll(/<li\b[^>]*\bdata-id=["']([1-9][0-9]{0,15})["']/g)) {
        const photoId = Number(match[1]);
        if (Number.isSafeInteger(photoId)) ids.add(photoId);
        if (ids.size >= 40) break;
      }
      return [...ids];
    } finally { activeRequests--; }
  }

  return {
    configured: true,
    poster,
    async posters(id, mediaType) {
      checkId(id);
      return cachedPosters(`${mediaType}:${id}`, async () => {
        const ids = await posterIds(id);
        const results: MetadataPoster[] = [];
        for (let start = 0; start < ids.length; start += 4) {
          results.push(...await Promise.all(ids.slice(start, start + 4).map(photoId => poster(id, mediaType, photoId))));
        }
        return results;
      });
    },
    async search(query: string, mediaType: MediaType) {
      const term = query.trim();
      if (!term || term.length > 200) throw new ApiException(400, "INVALID_QUERY", "请输入 1 至 200 个字符的搜索词。");
      return cachedSearch(`${mediaType}:${term}`, async () => {
        const payload = await request("search/movie", { q: term, start: "0", count: "20" });
        const envelope = z.object({ items: z.array(z.unknown()).optional(), subjects: z.array(z.unknown()).optional() }).safeParse(payload);
        if (!envelope.success || (!envelope.data.items && !envelope.data.subjects)) invalidResponse();
        const results: MetadataSearchResult[] = [];
        const seen = new Set<number>();
        // Work and output stay bounded even if the upstream ignores count.
        for (const item of (envelope.data.items || envelope.data.subjects || []).slice(0, 100)) {
          const target = item && typeof item === "object" && "target" in item ? item.target : item;
          const outerType = item && typeof item === "object" && "target_type" in item ? item.target_type : undefined;
          const normalized = target && typeof target === "object" ? { ...target, type: "type" in target ? target.type : outerType } : target;
          // Explicit non-film cards are not importable metadata subjects.
          if (normalized && typeof normalized === "object" && "type" in normalized && typeof normalized.type === "string" && !["tv", "movie"].includes(normalized.type)) continue;
          const parsed = subjectSchema.safeParse(normalized);
          if (!parsed.success) invalidResponse();
          if (parsed.data.type !== mediaType || seen.has(parsed.data.id)) continue;
          results.push(summary(parsed.data));
          seen.add(parsed.data.id);
          if (results.length >= 20) break;
        }
        return results;
      });
    },
    async details(id: number, mediaType: MediaType) {
      if (!Number.isSafeInteger(id) || id <= 0) throw new ApiException(400, "INVALID_ID", "资料 ID 必须是正整数。");
      return cachedDetails(`${mediaType}:${id}`, async () => {
        const parsed = subjectSchema.safeParse(await request(`${mediaType}/${id}`));
        if (!parsed.success || parsed.data.id !== id) invalidResponse();
        const subject = parsed.data;
        if (subject.type !== mediaType) throw new ApiException(422, "DOUBAN_TYPE_MISMATCH", "豆瓣条目类型与所选作品类型不一致。");
        const result = summary(subject);
        return {
          mediaType, doubanId: id, tmdbId: null,
          title: result.title, originalTitle: result.originalTitle, posterUrl: result.posterUrl,
          releaseDate: result.releaseDate, overview: result.overview,
          episodeCount: mediaType === "tv" ? subject.episodes_count || null : null,
          cast: (subject.actors || []).slice(0, 100).map(actor => ({
            name: actor.name, character: "", profileUrl: null,
          })),
        };
      });
    },
  };
}
