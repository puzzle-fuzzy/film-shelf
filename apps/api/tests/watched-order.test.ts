import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createApp } from "../src/app";
import { createDatabase, migrationsFolder } from "../src/db";

test("watched movies follow status reports, keep stable pagination, and ignore other edits", async () => {
  const database = createDatabase(":memory:");
  const app = createApp({ db: database.db, tmdbToken: "" });
  async function mutate(path: string, body: unknown, method = "POST") {
    const response = await app.request(path, {
      method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    expect(response.status).toBe(method === "POST" ? 201 : 200);
    const movie = (await response.json()).movie;
    expect(movie).not.toHaveProperty("watchedOrder");
    return movie;
  }
  async function watchedIds(query = "") {
    const response = await app.request(`/api/movies?status=watched${query}`);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.movies.every((movie: object) => !("watchedOrder" in movie))).toBe(true);
    return result.movies.map((movie: { id: number }) => movie.id);
  }
  const mark = (id: number, status = "watched") => mutate(`/api/movies/${id}/status`, { status }, "PATCH");
  try {
    const first = await mutate("/api/movies", { title: "Film A" });
    const second = await mutate("/api/movies", { title: "Film B" });
    const third = await mutate("/api/movies", { title: "Film C" });
    for (const movie of [first, second, third]) {
      database.sqlite.prepare("UPDATE movies SET created_at = ? WHERE id = ?").run(`2026-01-0${movie.id}T00:00:00.000Z`, movie.id);
    }
    await mark(second.id);
    const firstWatched = await mark(first.id);
    expect(await watchedIds()).toEqual([first.id, second.id]);
    const all = await (await app.request("/api/movies")).json();
    expect(all.movies.map((movie: { id: number }) => movie.id)).toEqual([third.id, second.id, first.id]);
    const recommended = await (await app.request("/api/movies?status=recommended")).json();
    expect(recommended.movies.map((movie: { id: number }) => movie.id)).toEqual([third.id]);

    const sequenceBefore = database.sqlite.prepare("SELECT watched_order FROM movies WHERE id = ?").get(first.id);
    const repeated = await mark(first.id);
    expect(repeated.watchedAt).toBe(firstWatched.watchedAt);
    expect(database.sqlite.prepare("SELECT watched_order FROM movies WHERE id = ?").get(first.id)).toEqual(sequenceBefore);
    await mutate(`/api/movies/${second.id}/magnet`, { magnetUrl: `magnet:?xt=urn:btih:${"a".repeat(40)}` }, "PATCH");
    expect(await watchedIds()).toEqual([first.id, second.id]);

    await mark(first.id, "recommended");
    expect(database.sqlite.prepare("SELECT watched_order, watched_at FROM movies WHERE id = ?").get(first.id)).toEqual({ watched_order: null, watched_at: null });
    await mark(third.id);
    await mark(first.id);
    expect(await watchedIds()).toEqual([first.id, third.id, second.id]);
    expect(await watchedIds("&pageSize=2&page=1")).toEqual([first.id, third.id]);
    expect(await watchedIds("&pageSize=2&page=2")).toEqual([second.id]);
    expect(await watchedIds("&q=Film")).toEqual([first.id, third.id, second.id]);
    const detail = await (await app.request(`/api/movies/${first.id}`)).json();
    expect(detail.movie).not.toHaveProperty("watchedOrder");
  } finally {
    database.close();
  }
});

test("watched order migration preserves the entire existing list and its metadata after reopening", async () => {
  const directory = mkdtempSync(join(tmpdir(), "film-shelf-watched-order-"));
  const legacyFolder = join(directory, "legacy-migrations");
  mkdirSync(join(legacyFolder, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"));
  const legacyEntries = journal.entries.filter((entry: { idx: number }) => entry.idx < 3);
  writeFileSync(join(legacyFolder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: legacyEntries }));
  for (const entry of legacyEntries) copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(legacyFolder, `${entry.tag}.sql`));
  const path = join(directory, "legacy.sqlite");
  const legacy = new Database(path);
  let original: Record<string, unknown>[];
  let previousIds: number[];
  try {
    migrate(drizzle({ client: legacy }), { migrationsFolder: legacyFolder });
    const insert = legacy.prepare("INSERT INTO movies (title, title_search, original_title, original_title_search, status, watched_at, created_at, updated_at, magnet_url) VALUES (?, ?, '', '', ?, ?, ?, ?, ?)");
    for (const [title, status, watchedAt, createdAt] of [
      ["First", "watched", "2026-08-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
      ["Second", "watched", "2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"],
      ["Third", "watched", "2026-01-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"],
      ["Recommended", "recommended", null, "2026-04-01T00:00:00.000Z"],
    ] as const) {
      insert.run(title, title.toLowerCase(), status, watchedAt, createdAt, createdAt, `magnet:?xt=urn:btih:${"b".repeat(40)}`);
    }
    original = legacy.prepare("SELECT * FROM movies ORDER BY id").all() as Record<string, unknown>[];
    previousIds = (legacy.prepare("SELECT id FROM movies WHERE status = 'watched' ORDER BY created_at DESC, id DESC").all() as { id: number }[]).map(row => row.id);
    expect(previousIds).toEqual([3, 2, 1]);
  } finally {
    legacy.close();
  }
  let upgraded = createDatabase(path);
  try {
    const rows = upgraded.sqlite.prepare("SELECT * FROM movies ORDER BY id").all() as Record<string, unknown>[];
    expect(rows.map(({ watched_order: _, ...row }) => row)).toEqual(original!);
    expect(rows.map(row => row.watched_order)).toEqual([1, 2, 3, null]);
    const reader = createApp({ db: upgraded.db, tmdbToken: "" });
    const result = await (await reader.request("/api/movies?status=watched")).json();
    expect(result.movies.map((movie: { id: number }) => movie.id)).toEqual(previousIds!);
    expect(result.movies.every((movie: object) => !("watchedOrder" in movie))).toBe(true);
    upgraded.close();
    upgraded = createDatabase(path);
    expect(upgraded.sqlite.prepare("SELECT id FROM movies WHERE status = 'watched' ORDER BY watched_order DESC").all()).toEqual(previousIds!.map(id => ({ id })));
    expect(upgraded.sqlite.prepare("SELECT * FROM movies ORDER BY id").all()).toEqual(rows);
  } finally {
    upgraded.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
