import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createApp } from "../src/app";
import { createDatabase, migrationsFolder } from "../src/db";
import type { MovieMetadataProvider } from "../src/tmdb";

const firstMagnet = `magnet:?xt=urn:btih:${"a".repeat(40)}&dn=Movie%20One&tr=udp%3A%2F%2Ftracker.example%3A80%2Fannounce`;
const secondMagnet = `magnet:?xt=urn:btih:${"b".repeat(40)}&dn=Movie%20Two`;
const provider: MovieMetadataProvider = {
  configured: true,
  async search() { return []; },
  async details(tmdbId) { return { tmdbId, title: "TMDB 电影", overview: "已获取的电影资料" }; },
};

let database: ReturnType<typeof createDatabase>;
let app: ReturnType<typeof createApp>;
const request = (path: string, body?: unknown, method = "POST") => app.request(path, body === undefined ? undefined : {
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  database = createDatabase(":memory:");
  app = createApp({ db: database.db, tmdb: provider });
});
afterEach(() => database.close());

describe("movie magnet links", () => {
  test("creates, exposes, updates and clears a link while preserving watched status", async () => {
    const created = await request("/api/movies", { title: "电影", magnetUrl: `  ${firstMagnet}  ` });
    expect(created.status).toBe(201);
    const movie = (await created.json()).movie;
    expect(movie.magnetUrl).toBe(firstMagnet);
    const list = await (await request("/api/movies")).json();
    expect(list.movies[0].magnetUrl).toBe(firstMagnet);
    const watchedResponse = await request(`/api/movies/${movie.id}/status`, { status: "watched" }, "PATCH");
    const watched = (await watchedResponse.json()).movie;
    expect(watched.magnetUrl).toBe(firstMagnet);
    const editedResponse = await request(`/api/movies/${movie.id}/magnet`, { magnetUrl: secondMagnet }, "PATCH");
    expect(editedResponse.status).toBe(200);
    const edited = (await editedResponse.json()).movie;
    expect(edited).toMatchObject({ magnetUrl: secondMagnet, status: "watched", watchedAt: watched.watchedAt });
    const same = await request(`/api/movies/${movie.id}/magnet`, { magnetUrl: secondMagnet }, "PATCH");
    expect((await same.json()).movie.updatedAt).toBe(edited.updatedAt);
    const detail = await (await request(`/api/movies/${movie.id}`)).json();
    expect(detail.movie.magnetUrl).toBe(secondMagnet);
    for (const value of [" \n ", null]) {
      const cleared = await request(`/api/movies/${movie.id}/magnet`, { magnetUrl: value }, "PATCH");
      expect(cleared.status).toBe(200);
      expect((await cleared.json()).movie).toMatchObject({ magnetUrl: null, status: "watched", watchedAt: watched.watchedAt });
    }
  });

  test("imports a link with TMDB metadata without replacing links on duplicate import", async () => {
    const imported = await request("/api/movies/import", { tmdbId: 550, magnetUrl: firstMagnet });
    expect(imported.status).toBe(201);
    const movie = (await imported.json()).movie;
    expect(movie).toMatchObject({ tmdbId: 550, title: "TMDB 电影", magnetUrl: firstMagnet, status: "recommended" });
    const duplicate = await request("/api/movies/import", { tmdbId: 550, magnetUrl: secondMagnet });
    expect(duplicate.status).toBe(409);
    expect((await (await request(`/api/movies/${movie.id}`)).json()).movie.magnetUrl).toBe(firstMagnet);
    const withoutMagnet = await request("/api/movies/import", { tmdbId: 551 });
    expect(withoutMagnet.status).toBe(201);
    expect((await withoutMagnet.json()).movie.magnetUrl).toBeNull();
  });

  test("accepts hex, base32 and v2 hashes and preserves display-name and tracker parameters", async () => {
    const links = [
      firstMagnet,
      "magnet:?xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&dn=Base32",
      `magnet:?xt=urn:btmh:1220${"a1".repeat(32)}&dn=V2`,
      `MAGNET:?xt=urn:btih:${"A".repeat(40)}&dn=Uppercase`,
    ];
    for (const magnetUrl of links) {
      const response = await request("/api/movies", { title: "电影", magnetUrl });
      expect(response.status).toBe(201);
      expect((await response.json()).movie.magnetUrl).toBe(new URL(magnetUrl).href);
    }
  });

  test("rejects invalid links on create, import and edit without modifying the movie", async () => {
    const created = await request("/api/movies", { title: "原有电影", magnetUrl: firstMagnet });
    const original = (await created.json()).movie;
    const invalid = [
      "javascript:alert(1)",
      "https://example.com/movie.torrent",
      "magnet:?dn=missing-hash",
      `magnet:?xt=urn:btih:${"a".repeat(39)}`,
      `magnet:?xt=urn:btih:${"g".repeat(40)}`,
      `magnet:?xt=urn:btmh:1220${"a".repeat(63)}`,
      `magnet://example.com?xt=urn:btih:${"a".repeat(40)}`,
      `${firstMagnet}#fragment`,
      `${firstMagnet}&dn=bad\nname`,
      `${firstMagnet}&dn=${"a".repeat(16000)}`,
    ];
    for (const magnetUrl of invalid) {
      expect((await request("/api/movies", { title: "无效电影", magnetUrl })).status).toBe(400);
      expect((await request("/api/movies/import", { tmdbId: 550, magnetUrl })).status).toBe(400);
      const edited = await request(`/api/movies/${original.id}/magnet`, { magnetUrl }, "PATCH");
      expect(edited.status).toBe(400);
      expect((await edited.json()).error.message).toBeTruthy();
    }
    const unchanged = (await (await request(`/api/movies/${original.id}`)).json()).movie;
    expect(unchanged).toEqual(original);
    expect((await (await request("/api/movies")).json()).total).toBe(1);
    expect((await request(`/api/movies/${original.id}/magnet`, {}, "PATCH")).status).toBe(400);
    expect((await request(`/api/movies/${original.id}/magnet`, { magnetUrl: firstMagnet, extra: true }, "PATCH")).status).toBe(400);
    expect((await request("/api/movies/999/magnet", { magnetUrl: firstMagnet }, "PATCH")).status).toBe(404);
  });
});

test("upgrades existing movies with null magnet links and persists added links after reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "film-shelf-magnet-migration-"));
  const legacyFolder = join(directory, "legacy-migrations");
  mkdirSync(join(legacyFolder, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"));
  const magnetMigration = journal.entries.findIndex((entry: { tag: string }) => entry.tag === "0002_dusty_mariko_yashida");
  const legacyEntries = journal.entries.slice(0, magnetMigration);
  writeFileSync(join(legacyFolder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: legacyEntries }));
  for (const entry of legacyEntries) copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(legacyFolder, `${entry.tag}.sql`));
  const path = join(directory, "existing.sqlite");
  const legacy = new Database(path);
  try {
    migrate(drizzle({ client: legacy }), { migrationsFolder: legacyFolder });
    legacy.prepare("INSERT INTO movies (title, original_title, status, watched_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("原有电影", "Original Movie", "watched", "2026-01-01T00:00:00.000Z", "2025-12-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  } finally {
    legacy.close(true);
  }
  let upgraded = createDatabase(path);
  try {
    const upgradedApp = createApp({ db: upgraded.db, tmdbToken: "" });
    const before = await (await upgradedApp.request("/api/movies")).json();
    expect(before.movies[0]).toMatchObject({ title: "原有电影", magnetUrl: null, status: "watched", watchedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    const response = await upgradedApp.request(`/api/movies/${before.movies[0].id}/magnet`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ magnetUrl: firstMagnet }),
    });
    expect(response.status).toBe(200);
    upgraded.close();
    upgraded = createDatabase(path);
    const reopenedApp = createApp({ db: upgraded.db, tmdbToken: "" });
    const after = await (await reopenedApp.request("/api/movies")).json();
    expect(after.movies[0]).toMatchObject({ magnetUrl: firstMagnet, status: "watched", watchedAt: "2026-01-01T00:00:00.000Z" });
  } finally {
    upgraded.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
