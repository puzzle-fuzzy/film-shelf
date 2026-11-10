import type { ActorFilmography, MediaType, MetadataPoster, MetadataSearchResult, MovieInput } from "@film-shelf/shared";
import { z } from "zod";
import { ApiException } from "./errors";
import { createMetadataCache } from "./metadata-cache";
import type { MetadataProvider } from "./metadata";
import { isDoubanActorImageSource } from "./posters";

const idSchema = z.union([z.number().int().positive().safe(), z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().positive().safe())]);
const imageSchema = z.object({ url: z.string().optional() });
const subjectSchema = z.object({
  id: idSchema,
  type: z.enum(["movie", "tv"]),
  title: z.string().trim().min(1),
  original_title: z.string().nullish(),
  intro: z.string().nullish(),
  info_url: z.string().nullish(),
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
const actorSchema = z.object({
  // Older cached credits can have photos but no identity. A malformed ID must not discard a valid photo.
  id: z.unknown().optional(),
  name: z.string().trim().min(1),
  avatar: z.object({ large: z.string().nullish(), normal: z.string().nullish() }).nullish(),
});
const celebritiesSchema = z.object({ actors: z.array(z.unknown()) });
const personSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  cover: z.object({ normal: imageSchema.nullish() }).nullish(),
  avatar: z.object({ large: z.string().nullish(), normal: z.string().nullish() }).nullish(),
  extra: z.object({ info: z.array(z.tuple([z.string(), z.string()])).nullish() }).nullish(),
});
const worksPageSchema = z.object({
  start: z.number().int().nonnegative().safe(),
  count: z.number().int().positive().safe(),
  total: z.number().int().nonnegative().safe(),
  works: z.array(z.object({ roles: z.array(z.string()), work: z.unknown() })).max(10),
});
type DoubanActor = { doubanPersonId: number; name: string; profileUrl: string | null; imdbId: string | null };
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
  const cachedSubject = createMetadataCache<Subject>();
  const cachedDetails = createMetadataCache<MovieInput>();
  const cachedSearch = createMetadataCache<MetadataSearchResult[]>();
  const cachedPoster = createMetadataCache<MetadataPoster>();
  const cachedPosters = createMetadataCache<MetadataPoster[]>();
  const cachedActor = createMetadataCache<DoubanActor>();
  const cachedFilmography = createMetadataCache<ActorFilmography>();
  const cachedImdbId = createMetadataCache<string | null>();
  let activeRequests = 0;

  async function request(path: string, params?: Record<string, string>, subjectId?: number): Promise<unknown> {
    if (activeRequests >= 4) throw new ApiException(429, "DOUBAN_BUSY", "豆瓣资料请求繁忙，请稍后重试。");
    activeRequests++;
    try {
      const url = new URL(`https://m.douban.com/rexxar/api/v2/${path}`);
      if (params) url.search = new URLSearchParams(params).toString();
      const referer = path === "search/movie"
        ? `https://m.douban.com/search/?${new URLSearchParams({ query: params?.q || "", type: "movie" })}`
        : path.startsWith("celebrity/") ? `https://m.douban.com/movie/celebrity/${path.split("/")[1]}/`
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

  function loadSubject(id: number, mediaType: MediaType): Promise<Subject> {
    checkId(id);
    return cachedSubject(`${mediaType}:${id}`, async () => {
      const parsed = subjectSchema.safeParse(await request(`${mediaType}/${id}`));
      if (!parsed.success || parsed.data.id !== id) invalidResponse();
      if (parsed.data.type !== mediaType) throw new ApiException(422, "DOUBAN_TYPE_MISMATCH", "豆瓣条目类型与所选作品类型不一致。");
      return parsed.data;
    });
  }

  function actor(personId: number): Promise<DoubanActor> {
    checkId(personId);
    return cachedActor(String(personId), async () => {
      const parsed = personSchema.safeParse(await request(`celebrity/${personId}`));
      if (!parsed.success) invalidResponse();
      const data = parsed.data;
      const name = data.title || data.name;
      if (!name) invalidResponse();
      const imdbIds = new Set((data.extra?.info || [])
        .filter(([key, value]) => (key === "IMDb编号" || key === "IMDb") && /^nm\d+$/.test(value))
        .map(([, value]) => value));
      // The celebrity endpoint now returns a different personage/subject ID. Keep the stable requested ID.
      return {
        doubanPersonId: personId, name,
        profileUrl: [data.cover?.normal?.url, data.avatar?.large, data.avatar?.normal].find(isDoubanActorImageSource) ?? null,
        imdbId: imdbIds.size === 1 ? [...imdbIds][0]! : null,
      };
    });
  }

  function actorFilmography(personId: number, mediaType: MediaType): Promise<ActorFilmography> {
    checkId(personId);
    return cachedFilmography(`${mediaType}:${personId}`, async () => {
      const person = await actor(personId);
      const movies = new Map<number, ActorFilmography["movies"][number]>();
      const characters = new Map<number, Set<string>>();
      let total: number | undefined;
      for (let start = 0; total === undefined || start < total; start += 10) {
        const parsed = worksPageSchema.safeParse(await request(`celebrity/${personId}/works`, { start: String(start), count: "10", sort: "time" }));
        if (!parsed.success) invalidResponse();
        const page = parsed.data;
        if (page.total > 1000) throw new ApiException(502, "DOUBAN_FILMOGRAPHY_TOO_LARGE", "豆瓣返回的演员作品超过完整读取上限，暂时无法提供完整作品列表。");
        if (page.start !== start || page.count !== 10 || (total !== undefined && total !== page.total)
          || page.works.length !== Math.min(10, Math.max(0, page.total - start))) invalidResponse();
        total = page.total;
        for (const entry of page.works) {
          const actingRoles = entry.roles.filter(role => /^演员(?:\s|$)/.test(role));
          if (!actingRoles.length) continue;
          if (entry.work && typeof entry.work === "object" && "type" in entry.work
            && typeof entry.work.type === "string" && !["movie", "tv"].includes(entry.work.type)) continue;
          const parsedWork = subjectSchema.safeParse(entry.work);
          if (!parsedWork.success) invalidResponse();
          const subject = parsedWork.data;
          if (subject.type !== mediaType) continue;
          const { externalId, ...metadata } = summary(subject);
          const roleNames = actingRoles.flatMap(role => {
            const match = /^演员\s*[（(]饰\s+(.+?)[）)]$/.exec(role);
            return match ? [match[1]!.trim()] : [];
          });
          if (!movies.has(externalId)) {
            movies.set(externalId, { ...metadata, tmdbId: null, doubanId: externalId, character: "" });
            characters.set(externalId, new Set());
          }
          for (const name of roleNames) characters.get(externalId)!.add(name);
          movies.get(externalId)!.character = [...characters.get(externalId)!].join(" / ");
        }
      }
      return {
        actor: { tmdbPersonId: null, doubanPersonId: personId, name: person.name, profileUrl: person.profileUrl },
        movies: [...movies.values()].sort((a, b) => {
          if (a.releaseDate !== b.releaseDate) {
            if (!a.releaseDate) return 1;
            if (!b.releaseDate) return -1;
            return b.releaseDate.localeCompare(a.releaseDate);
          }
          return b.doubanId! - a.doubanId!;
        }),
      };
    });
  }

  async function readInfoPage(id: number): Promise<string> {
    if (activeRequests >= 4) throw new ApiException(429, "DOUBAN_BUSY", "豆瓣资料请求繁忙，请稍后重试。");
    activeRequests++;
    try {
      const response = await fetcher(`https://www.douban.com/doubanapp/h5/movie/${id}/desc`, {
        headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 FilmShelf/1.0", Referer: `https://m.douban.com/movie/subject/${id}/` },
        credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10000),
      });
      if ([401, 403, 418].includes(response.status)) throw new ApiException(502, "DOUBAN_VERIFICATION_REQUIRED", "豆瓣需要人工验证，暂时无法匿名获取资料。");
      if (response.status === 429) throw new ApiException(429, "DOUBAN_RATE_LIMITED", "豆瓣请求过于频繁，请稍后重试。");
      if (!response.ok) throw new ApiException(502, "DOUBAN_UNAVAILABLE", "豆瓣暂时无法提供影片信息，请稍后重试。");
      if (response.redirected || !/^text\/html(?:\s*;|$)/i.test(response.headers.get("Content-Type") || "")) invalidResponse();
      const maximum = 262_144;
      if (Number(response.headers.get("Content-Length")) > maximum) invalidResponse();
      const reader = response.body?.getReader();
      if (!reader) invalidResponse();
      const decoder = new TextDecoder();
      let html = "";
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maximum) { await reader.cancel(); invalidResponse(); }
          html += decoder.decode(chunk.value, { stream: true });
        }
        return html + decoder.decode();
      } finally { reader.releaseLock(); }
    } catch (error) {
      if (error instanceof ApiException) throw error;
      if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new ApiException(504, "DOUBAN_TIMEOUT", "豆瓣请求超时，请稍后重试。");
      throw new ApiException(502, "DOUBAN_UNAVAILABLE", "读取豆瓣影片信息失败，请稍后重试。");
    } finally { activeRequests--; }
  }

  function imdbId(id: number, mediaType: MediaType): Promise<string | null> {
    checkId(id);
    return cachedImdbId(`${mediaType}:${id}`, async () => {
      const subject = await loadSubject(id, mediaType);
      if (!subject.info_url) return null;
      let url: URL;
      try { url = new URL(subject.info_url); } catch { invalidResponse(); }
      if (url.origin !== "https://www.douban.com" || url.username || url.password || url.search || url.hash
        || !new RegExp(`^/doubanapp/{1,2}h5/movie/${id}/desc$`).test(url.pathname)) invalidResponse();
      const html = await readInfoPage(id);
      const section = /<section\b[^>]*class=["'][^"']*\bsubject-desc\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/i.exec(html);
      if (!section || !/<h1\b[^>]*>\s*影片信息\s*<\/h1>/i.test(section[1]!)) invalidResponse();
      const ids = new Set<string>();
      for (const row of section[1]!.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cell[1]!.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/gi, " ").trim());
        if (cells[0] !== "IMDb") continue;
        if (cells.length !== 2 || !/^tt\d+$/.test(cells[1]!)) return null;
        ids.add(cells[1]!);
      }
      return ids.size === 1 ? [...ids][0]! : null;
    });
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
    actor,
    actorFilmography,
    imdbId,
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
        const subject = await loadSubject(id, mediaType);
        const result = summary(subject);
        const profiles: Array<{ name: string; profileUrl: string | null; doubanPersonId?: number }> = [];
        function matchedProfile(name: string) {
          const matches = profiles.filter(profile => profile.name === name);
          const identities = matches.filter(profile => profile.doubanPersonId !== undefined);
          if (identities.length) return identities.length === 1 ? identities[0] : undefined;
          return matches.length === 1 ? matches[0] : undefined;
        }
        if (subject.actors?.length) {
          // Anonymous credits sometimes return a subset with an unchanged total. Merge a bounded
          // number of normal same-URL reads without replacing earlier identities or masking conflicts.
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const credits = celebritiesSchema.parse(await request(`${mediaType}/${id}/celebrities`, { count: "100" }, id));
              let hasIdentities = false;
              for (const entry of credits.actors.slice(0, 200)) {
                const parsed = actorSchema.safeParse(entry);
                if (!parsed.success) continue;
                const { name, avatar } = parsed.data;
                const personId = idSchema.safeParse(parsed.data.id);
                const profileUrl = [avatar?.large, avatar?.normal].find(isDoubanActorImageSource) ?? null;
                const existing = profiles.find(profile => profile.name === name && (personId.success
                  ? profile.doubanPersonId === personId.data
                  : profile.doubanPersonId === undefined && profile.profileUrl === profileUrl));
                if (personId.success) hasIdentities = true;
                if (existing) existing.profileUrl ??= profileUrl;
                else profiles.push({ name, profileUrl, ...(personId.success ? { doubanPersonId: personId.data } : {}) });
              }
              if (!hasIdentities || subject.actors.every(actor => matchedProfile(actor.name)?.doubanPersonId !== undefined)) break;
            } catch {
              // Keep collected metadata available; do not retry verification, transport or format failures.
              break;
            }
          }
        }
        return {
          mediaType, doubanId: id, tmdbId: null,
          title: result.title, originalTitle: result.originalTitle, posterUrl: result.posterUrl,
          releaseDate: result.releaseDate, overview: result.overview,
          episodeCount: mediaType === "tv" ? subject.episodes_count || null : null,
          cast: (subject.actors || []).slice(0, 100).map(actor => {
            const matched = matchedProfile(actor.name);
            return { name: actor.name, character: "", profileUrl: matched?.profileUrl ?? null, ...(matched?.doubanPersonId ? { doubanPersonId: matched.doubanPersonId } : {}) };
          }),
        };
      });
    },
  };
}
