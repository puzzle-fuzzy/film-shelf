import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";
import { createPosterStore } from "../src/posters";

test("Douban imports persist actor photos and detail responses keep using local files offline", async () => {
  const directory = mkdtempSync(join(tmpdir(), "film-shelf-douban-actors-"));
  const database = createDatabase(":memory:");
  const photo = "https://img3.doubanio.com/view/personage/m/public/9857d63a35c38fdd324cd0f6af2d0f13.jpg";
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const downloads: string[] = [];
  const posters = createPosterStore({ directory, fetcher: async (input) => {
    downloads.push(String(input));
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  } });
  const douban = {
    configured: true,
    async search() { return []; },
    async details() {
      return { doubanId: 37335468, mediaType: "tv" as const, title: "努力克服自卑的我们", cast: [
        { name: "具教焕", character: "", profileUrl: photo },
        { name: "缺图演员", character: "", profileUrl: null },
      ] };
    },
  };
  try {
    const app = createApp({ db: database.db, posters, douban, tmdbToken: "" });
    const imported = await app.request("/api/movies/import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "douban", mediaType: "tv", externalId: 37335468 }),
    });
    expect(imported.status).toBe(201);
    const movie = (await imported.json()).movie;
    const local = movie.cast[0].profileUrl;
    expect(local).toMatch(/^\/api\/posters\/[a-f0-9]{64}\.png$/);
    expect(movie.cast[1].profileUrl).toBeNull();
    expect(downloads).toEqual([photo]);
    const offline = createApp({
      db: database.db, tmdbToken: "",
      posters: createPosterStore({ directory, fetcher: async () => { throw new Error("offline"); } }),
    });
    const detail = await (await offline.request(`/api/movies/${movie.id}`)).json();
    expect(detail.movie.cast).toEqual(movie.cast);
    expect(Buffer.from(await (await offline.request(local)).arrayBuffer())).toEqual(png);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Douban search previews are lazy, import persists the cover, and forged preview URLs never fetch", async () => {
  const directory = mkdtempSync(join(tmpdir(), "film-shelf-douban-flow-"));
  const database = createDatabase(":memory:");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const source = "https://img2.doubanio.com/view/photo/l/public/p2891113171.jpg";
  let downloads = 0;
  const posters = createPosterStore({ directory, fetcher: async () => { downloads++; return new Response(png, { headers: { "content-type": "image/png" } }); } });
  const app = createApp({ db: database.db, tmdbToken: "", posters, douban: {
    configured: true,
    async search() { return [{ provider: "douban", mediaType: "tv", externalId: 27602137, title: "我的大叔", originalTitle: "", posterUrl: source, overview: "", releaseDate: "2018-03-21" }]; },
    async details() { return { doubanId: 27602137, mediaType: "tv", title: "我的大叔", posterUrl: source, episodeCount: 16 }; },
  } });
  try {
    const results = (await (await app.request("/api/metadata/search?provider=douban&mediaType=tv&q=我的大叔")).json()).results;
    expect(downloads).toBe(0);
    expect(results[0].posterUrl.startsWith("/api/posters/douban/")).toBe(true);
    const preview = await app.request(results[0].posterUrl);
    expect(preview.status).toBe(200);
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(png);
    expect(downloads).toBe(1);
    const imported = await app.request("/api/movies/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "douban", mediaType: "tv", externalId: 27602137 }) });
    expect(imported.status).toBe(201);
    const movie = (await imported.json()).movie;
    expect(movie.posterUrl).toMatch(/^\/api\/posters\/[a-f0-9]{64}\.png$/);
    expect(downloads).toBe(1);
    const offlineStore = createPosterStore({ directory, fetcher: async () => { throw new Error("offline"); } });
    const saved = await offlineStore.respond(movie.posterUrl.split("/").at(-1));
    expect(saved.status).toBe(200);
    expect(Buffer.from(await saved.arrayBuffer())).toEqual(png);
    for (const remote of ["https://example.com/poster.jpg", "https://img2.doubanio.com.evil.test/view/photo/l/public/p1.jpg", "http://127.0.0.1/private"] ) {
      const forged = `/api/posters/douban/${Buffer.from(remote).toString("base64url")}`;
      expect((await app.request(forged)).status).toBe(400);
    }
    expect(downloads).toBe(1);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});
