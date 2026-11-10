import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";
import { createPosterStore } from "../src/posters";

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
