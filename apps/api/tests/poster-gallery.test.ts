import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";
import { ApiException } from "../src/errors";
import type { MetadataProvider } from "../src/metadata";
import type { PosterStore } from "../src/posters";
let database: ReturnType<typeof createDatabase>;
let app: ReturnType<typeof createApp>;
let calls = 0;
const local = (url: string) =>
  `/api/posters/${createHash("sha256").update(url).digest("hex")}.jpg`;
const candidate = (id: string) => ({
  source: "douban" as const,
  sourceId: id,
  url: `https://img1.doubanio.com/view/photo/l/public/p${id}.jpg`,
  width: 600,
  height: 900,
});
const provider = {
  configured: true,
  async search() {
    return [];
  },
  async details() {
    throw new Error("unused");
  },
  async posters() {
    calls++;
    return [candidate("11"), candidate("12"), candidate("13")];
  },
  async poster(_id: number, _type: string, photoId: number) {
    calls++;
    if (photoId === 99)
      throw new ApiException(400, "DOUBAN_PHOTO_MISMATCH", "照片不属于此作品");
    return candidate(String(photoId));
  },
} as MetadataProvider;
const store: PosterStore = {
  async save(url) {
    if (url?.includes("p13.jpg"))
      throw new ApiException(502, "POSTER_DOWNLOAD_FAILED", "下载失败");
    return url ? local(url) : null;
  },
  async ensureVariants() {},
  async variants() {
    return undefined;
  },
  async respond() {
    return new Response(null);
  },
};
const req = (path: string, body?: unknown, method = "POST") =>
  app.request(
    path,
    body === undefined
      ? undefined
      : {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
async function create(extra = {}) {
  return (
    await (
      await req("/api/movies", {
        title: "测试",
        doubanId: 1,
        posterUrl: "https://image.tmdb.org/t/p/w500/initial.jpg",
        ...extra,
      })
    ).json()
  ).movie;
}
beforeEach(() => {
  calls = 0;
  database = createDatabase(":memory:");
  app = createApp({
    db: database.db,
    douban: provider,
    posters: store,
    tmdbToken: "",
  });
});
afterEach(() => database.close());
test("new movie gallery reads its initial cover without external calls", async () => {
  const movie = await create();
  const response = await req(`/api/movies/${movie.id}/posters`);
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.posters).toHaveLength(1);
  expect(result.posters[0].url).toBe(movie.posterUrl);
  expect(result.primaryPosterId).toBe(result.posters[0].id);
  expect(calls).toBe(0);
});
test("sync retains successes, deduplicates and never changes current cover", async () => {
  const movie = await create();
  const response = await req(`/api/movies/${movie.id}/posters/sync`, {});
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.added).toBe(2);
  expect(result.failed).toBe(1);
  expect(result.posters).toHaveLength(3);
  expect(
    (await (await req(`/api/movies/${movie.id}`)).json()).movie.posterUrl,
  ).toBe(movie.posterUrl);
  expect(
    (await (await req(`/api/movies/${movie.id}/posters/sync`, {})).json())
      .added,
  ).toBe(0);
});
test("manual photos reject noncanonical urls and ownership errors", async () => {
  const movie = await create();
  for (const url of [
    "https://evil.com/a.jpg",
    "HTTPS://movie.douban.com/photos/photo/11/",
    "https://movie.douban.com/photos/photo/11/?x=1",
    "https://movie.douban.com/photos/photo/11/\n",
  ])
    expect(
      (await req(`/api/movies/${movie.id}/posters`, { photoUrls: [url] }))
        .status,
    ).toBe(400);
  expect(calls).toBe(0);
  expect(
    (
      await req(`/api/movies/${movie.id}/posters`, {
        photoUrls: ["https://movie.douban.com/photos/photo/99/"],
      })
    ).status,
  ).toBe(400);
  expect(
    (await (await req(`/api/movies/${movie.id}/posters`)).json()).posters,
  ).toHaveLength(1);
});
test("selection is scoped to the movie and preserves watched and magnet fields", async () => {
  const first = await create();
  const other = await create({ doubanId: 2 });
  const synced = await (
    await req(`/api/movies/${first.id}/posters/sync`, {})
  ).json();
  await req(`/api/movies/${first.id}/status`, { status: "watched" }, "PATCH");
  const before = (await (await req(`/api/movies/${first.id}`)).json()).movie;
  const selected = synced.posters[1];
  expect(
    (
      await req(
        `/api/movies/${other.id}/poster`,
        { posterId: selected.id },
        "PATCH",
      )
    ).status,
  ).toBe(404);
  const response = await req(
    `/api/movies/${first.id}/poster`,
    { posterId: selected.id },
    "PATCH",
  );
  expect(response.status).toBe(200);
  const after = (await response.json()).movie;
  expect(after.posterUrl).toBe(selected.url);
  expect(after.status).toBe(before.status);
  expect(after.watchedAt).toBe(before.watchedAt);
  expect(after.magnetUrl).toBe(before.magnetUrl);
});
test("all downloads failing surfaces an error and preserves the original cover", async () => {
  const movie = await create();
  const response = await req(`/api/movies/${movie.id}/posters`, {
    photoUrls: ["https://movie.douban.com/photos/photo/13/"],
  });
  expect(response.status).toBe(502);
  expect(
    (await (await req(`/api/movies/${movie.id}`)).json()).movie.posterUrl,
  ).toBe(movie.posterUrl);
});
test("missing movies, missing external identity and unsupported provider have explicit statuses", async () => {
  expect((await req("/api/movies/999/posters")).status).toBe(404);
  const movie = await create({ doubanId: null });
  expect(
    (
      await req(`/api/movies/${movie.id}/posters`, {
        photoUrls: ["https://movie.douban.com/photos/photo/11/"],
      })
    ).status,
  ).toBe(400);
  expect((await req(`/api/movies/${movie.id}/posters/sync`, {})).status).toBe(
    503,
  );
  expect(
    (await req(`/api/movies/${movie.id}/posters/sync`, { extra: true })).status,
  ).toBe(400);
});
test("gallery returns existing thumbnail variants", async () => {
  const movie = await create();
  app = createApp({
    db: database.db,
    posters: {
      ...store,
      async variants() {
        return [{ width: 185, url: "/api/posters/thumbnail.webp" }];
      },
    },
  });
  const result = await (await req(`/api/movies/${movie.id}/posters`)).json();
  expect(result.posters[0].posterVariants).toEqual([
    { width: 185, url: "/api/posters/thumbnail.webp" },
  ]);
});
test("manual provider must return the requested photo identity", async () => {
  const movie = await create();
  app = createApp({
    db: database.db,
    posters: store,
    douban: {
      ...provider,
      async poster() {
        return candidate("88");
      },
    },
  });
  expect(
    (
      await req(`/api/movies/${movie.id}/posters`, {
        photoUrls: ["https://movie.douban.com/photos/photo/11/"],
      })
    ).status,
  ).toBe(502);
});
test("same-movie sync excludes concurrent requests and limits download concurrency", async () => {
  const movie = await create();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let running = 0,
    maxRunning = 0;
  app = createApp({
    db: database.db,
    douban: {
      ...provider,
      async posters() {
        return Array.from({ length: 10 }, (_, i) => candidate(String(i + 20)));
      },
    },
    posters: {
      ...store,
      async save(url) {
        running++;
        maxRunning = Math.max(maxRunning, running);
        entered();
        await gate;
        running--;
        return local(url!);
      },
    },
  });
  const first = req(`/api/movies/${movie.id}/posters/sync`, {});
  await started;
  expect((await req(`/api/movies/${movie.id}/posters/sync`, {})).status).toBe(
    409,
  );
  release();
  expect((await first).status).toBe(200);
  expect(maxRunning).toBeLessThanOrEqual(3);
  expect(
    (await (await req(`/api/movies/${movie.id}/posters`)).json()).posters,
  ).toHaveLength(11);
});
test("sync reports the latest primary selection when an admin changes it during download", async () => {
  const movie = await create();
  await req(`/api/movies/${movie.id}/posters`, {
    photoUrls: ["https://movie.douban.com/photos/photo/11/"],
  });
  const existing = await (await req(`/api/movies/${movie.id}/posters`)).json();
  const selected = existing.posters[1];
  app = createApp({
    db: database.db,
    douban: provider,
    posters: {
      ...store,
      async save(url) {
        database.sqlite
          .prepare("UPDATE movies SET poster_url=? WHERE id=?")
          .run(selected.url, movie.id);
        return local(url!);
      },
    },
  });
  const result = await (
    await req(`/api/movies/${movie.id}/posters/sync`, {})
  ).json();
  expect(result.primaryPosterId).toBe(selected.id);
});
test("provider candidates sharing an image URL are downloaded only once", async () => {
  const movie = await create();
  let downloads = 0;
  app = createApp({
    db: database.db,
    douban: {
      ...provider,
      async posters() {
        return [
          candidate("11"),
          { ...candidate("12"), url: candidate("11").url },
        ];
      },
    },
    posters: {
      ...store,
      async save(url) {
        downloads++;
        return local(url!);
      },
    },
  });
  const result = await (
    await req(`/api/movies/${movie.id}/posters/sync`, {})
  ).json();
  expect(result.added).toBe(1);
  expect(downloads).toBe(1);
});
