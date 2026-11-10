import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiException } from "./errors";
import { createPosterVariantGenerator, findPosterVariants } from "./poster-variants";

export { posterVariantFilename, posterVariantWidths } from "./poster-variants";

export const defaultPostersDirectory = fileURLToPath(new URL("../../../data/posters/", import.meta.url));
export const maxImageBytes = 10 * 1024 * 1024;
export const LOCAL_POSTER_PATH_PATTERN = /^\/api\/posters\/([a-f0-9]{64}\.(?:jpg|png|webp))$/;
const tmdbImageBase = "https://image.tmdb.org/t/p/";
const tmdbPosterPath = "((?:w92|w154|w185|w342|w500|w780|original)/[A-Za-z0-9_-]+\\.(?:jpg|png|webp))";
const tmdbPosterSourcePattern = new RegExp(`^/t/p/${tmdbPosterPath}$`);
export const LOCAL_TMDB_POSTER_PATH_PATTERN = new RegExp(`^/api/posters/tmdb/${tmdbPosterPath}$`);
export const LOCAL_DOUBAN_POSTER_PATH_PATTERN = /^\/api\/posters\/douban\/([A-Za-z0-9_-]{1,2048})(?![\s\S])/;
const doubanStaticSourcePattern = /^https:\/\/img(?:1|2|3|9)\.doubanio\.com\/view\/photo\/(?:s_ratio_poster|m_ratio_poster|l|large|raw)\/public\/p[1-9][0-9]{0,19}\.(?:jpg|png|webp)$/;
const doubanSignedSourcePattern = /^https:\/\/qnmob[123]-sign\.doubanio\.com\/view\/photo\/large\/public\/p[1-9][0-9]{0,19}\.jpg\?sa_cv=[a-f0-9]{32}&sa_ct=[a-f0-9]{8}&imageView2\/0\/q\/80\/w\/9999\/h\/120\/format\/jpg$/;
const filenamePattern = /^[a-f0-9]{64}\.(jpg|png|webp)$/;
const types = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
type ImageExtension = keyof typeof types;
type PosterFetcher = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

function invalidSource() {
  return new ApiException(400, "POSTER_URL_INVALID", "海报地址必须是受信任的 TMDB、豆瓣图片地址或本地海报地址。");
}

function isDoubanSource(source: string): boolean {
  return source.length <= 1536 && !/[\s\\%]/.test(source)
    && (doubanStaticSourcePattern.test(source) || doubanSignedSourcePattern.test(source));
}

export function doubanPosterSource(localPath: string): string {
  const encoded = LOCAL_DOUBAN_POSTER_PATH_PATTERN.exec(localPath)?.[1];
  if (!encoded) throw invalidSource();
  const source = Buffer.from(encoded, "base64url").toString("utf8");
  // Buffer's decoder tolerates invalid encodings; only accept their canonical form.
  if (Buffer.from(source).toString("base64url") !== encoded || !isDoubanSource(source)) throw invalidSource();
  return source;
}

function remoteSource(source: string) {
  if (isDoubanSource(source)) return source;
  let url: URL;
  try { url = new URL(source); } catch { throw invalidSource(); }
  const rawPath = source.match(/^https:\/\/[^/]+(\/[^?#]*)/i)?.[1];
  if (url.protocol !== "https:" || url.hostname !== "image.tmdb.org" || url.username || url.password || url.port || url.search || url.hash
    || /[\\\s%]/.test(source) || rawPath !== url.pathname
    || !tmdbPosterSourcePattern.test(url.pathname)) {
    throw invalidSource();
  }
  return url.href;
}

export function localPosterUrl(source: string | null | undefined): string | null {
  if (source && /[\u0000-\u001f\u007f]/.test(source)) return null;
  const path = source?.trim();
  if (!path) return null;
  if (LOCAL_POSTER_PATH_PATTERN.test(path) || LOCAL_TMDB_POSTER_PATH_PATTERN.test(path)) return path;
  try {
    if (path.startsWith("/api/posters/douban/")) {
      doubanPosterSource(path);
      return path;
    }
    const remote = remoteSource(path);
    if (isDoubanSource(remote)) return `/api/posters/douban/${Buffer.from(remote).toString("base64url")}`;
    return `/api/posters/tmdb/${remote.slice(tmdbImageBase.length)}`;
  } catch {
    return null;
  }
}

function imageExtension(bytes: Uint8Array): ImageExtension | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return "png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "webp";
  return null;
}

function unavailablePoster() {
  return new Response("海报不存在。", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}

export function createPosterStore({ directory = defaultPostersDirectory, fetcher = fetch }: { directory?: string; fetcher?: PosterFetcher } = {}) {
  const inFlight = new Map<string, Promise<string>>();
  const variantJobs = new Map<string, Promise<void>>();
  const generateVariants = createPosterVariantGenerator();

  async function readPoster(filename: string): Promise<Uint8Array<ArrayBuffer> | null> {
    if (!filenamePattern.test(filename)) return null;
    try {
      const path = join(directory, filename);
      const info = await lstat(path);
      if (!info.isFile() || info.size === 0 || info.size > maxImageBytes) return null;
      const bytes = new Uint8Array(await readFile(path));
      const extension = filename.split(".").at(-1) as ImageExtension;
      return imageExtension(bytes) === extension ? bytes : null;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function download(source: string, hash: string): Promise<string> {
    for (const extension of Object.keys(types) as ImageExtension[]) {
      const filename = `${hash}.${extension}`;
      if (await readPoster(filename)) return `/api/posters/${filename}`;
    }
    let response: Response | undefined;
    let bytes: Uint8Array<ArrayBuffer>;
    let extension: ImageExtension;
    try {
      response = await fetcher(source, {
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: "image/jpeg, image/png, image/webp", ...(isDoubanSource(source) ? { Referer: "https://movie.douban.com/" } : {}) },
      });
      if (!response.ok) throw new ApiException(502, "POSTER_DOWNLOAD_FAILED", "海报下载失败，请稍后重试。");
      const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      const expected = (Object.keys(types) as ImageExtension[]).find((key) => types[key] === mime);
      if (!expected || !response.body) throw new ApiException(502, "POSTER_INVALID_IMAGE", "海报服务器返回了无效的图片。");
      if (Number(response.headers.get("content-length")) > maxImageBytes) throw new ApiException(502, "POSTER_TOO_LARGE", "海报图片超过 10 MB，无法保存。");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maxImageBytes) throw new ApiException(502, "POSTER_TOO_LARGE", "海报图片超过 10 MB，无法保存。");
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (imageExtension(bytes) !== expected) throw new ApiException(502, "POSTER_INVALID_IMAGE", "海报图片内容与格式不符，无法保存。");
      extension = expected;
    } catch (error) {
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      if (error instanceof ApiException) throw error;
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new ApiException(504, "POSTER_TIMEOUT", "海报下载超时，请稍后重试。");
      throw new ApiException(502, "POSTER_DOWNLOAD_FAILED", "暂时无法下载海报，请检查网络后重试。");
    }
    const filename = `${hash}.${extension}`;
    const temporary = join(directory, `.${hash}.${randomUUID()}.tmp`);
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, join(directory, filename));
    } catch {
      throw new ApiException(500, "POSTER_SAVE_FAILED", "无法保存海报文件，请检查本地存储后重试。");
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
    return `/api/posters/${filename}`;
  }

  return {
    async variants(source: string | null) {
      const original = source && LOCAL_POSTER_PATH_PATTERN.exec(source)?.[1];
      return original ? findPosterVariants(original, directory, maxImageBytes) : undefined;
    },
    async ensureVariants(source: string | null): Promise<void> {
      const original = source && LOCAL_POSTER_PATH_PATTERN.exec(source)?.[1];
      if (!original || !generateVariants) return;
      const active = variantJobs.get(original);
      if (active) return active;
      const pending = generateVariants(original, directory, directory, maxImageBytes)
        .then(() => undefined)
        .catch((error: unknown) => console.warn(`Could not generate poster variants for ${original}:`, error))
        .finally(() => variantJobs.delete(original));
      variantJobs.set(original, pending);
      return pending;
    },
    async save(source: string | null | undefined): Promise<string | null> {
      if (source == null) return null;
      if (/[\u0000-\u001f\u007f]/.test(source)) throw invalidSource();
      const text = source.trim();
      const local = LOCAL_POSTER_PATH_PATTERN.exec(text);
      if (local) {
        if (!await readPoster(local[1]!)) throw new ApiException(404, "POSTER_NOT_FOUND", "本地海报文件不存在，请重新导入电影资料。");
        return text;
      }
      const preview = LOCAL_TMDB_POSTER_PATH_PATTERN.exec(text);
      const remote = preview ? `${tmdbImageBase}${preview[1]}`
        : text.startsWith("/api/posters/douban/") ? doubanPosterSource(text) : remoteSource(text);
      const hash = createHash("sha256").update(remote).digest("hex");
      const active = inFlight.get(hash);
      if (active) return active;
      const pending = download(remote, hash);
      inFlight.set(hash, pending);
      try { return await pending; } finally { if (inFlight.get(hash) === pending) inFlight.delete(hash); }
    },
    async respond(filename: string): Promise<Response> {
      const bytes = await readPoster(filename);
      if (!bytes) return unavailablePoster();
      const extension = filename.split(".").at(-1) as ImageExtension;
      return new Response(bytes, { headers: {
        "Content-Type": types[extension],
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      } });
    },
  };
}

export type PosterStore = ReturnType<typeof createPosterStore>;
