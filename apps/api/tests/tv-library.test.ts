import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDatabase, migrationsFolder } from "../src/db";

test("TV migration preserves every legacy field and ID, permits same-number TMDB identities, and reopens unchanged", () => {
  const directory = mkdtempSync(join(tmpdir(), "film-shelf-tv-migration-"));
  const path = join(directory, "library.sqlite");
  const legacyFolder = join(directory, "legacy");
  mkdirSync(join(legacyFolder, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"));
  const entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 4);
  writeFileSync(join(legacyFolder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const entry of entries) copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(legacyFolder, `${entry.tag}.sql`));
  const legacy = new Database(path);
  let original: Record<string, unknown>;
  try {
    migrate(drizzle({ client: legacy }), { migrationsFolder: legacyFolder });
    legacy.prepare("INSERT INTO movies (id, tmdb_id, title, title_search, original_title, original_title_search, poster_url, release_date, overview, cast, magnet_url, status, watched_at, watched_order, created_at, updated_at) VALUES (41, 100, '旧电影', '旧电影', 'Legacy', 'legacy', ?, '2001-02-03', '保留简介', ?, ?, 'watched', '2020-03-04T00:00:00.000Z', 9, '2019-01-01', '2020-03-04')")
      .run(`/api/posters/${"a".repeat(64)}.jpg`, JSON.stringify([{ name: "演员", character: "主角", profileUrl: null }]), `magnet:?xt=urn:btih:${"b".repeat(40)}`);
    original = legacy.prepare("SELECT * FROM movies").get() as Record<string, unknown>;
  } finally { legacy.close(true); }
  let database = createDatabase(path);
  try {
    const row = database.sqlite.prepare("SELECT * FROM movies WHERE id = 41").get() as Record<string, unknown>;
    const { media_type, douban_id, episode_count, ...oldFields } = row;
    expect(oldFields).toEqual({ ...original!, personal_review: null });
    expect({ media_type, douban_id, episode_count }).toEqual({ media_type: "movie", douban_id: null, episode_count: null });
    const insert = database.sqlite.prepare("INSERT INTO movies (tmdb_id, douban_id, media_type, title, title_search, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'now', 'now')");
    insert.run(100, null, "tv", "同号电视剧", "同号电视剧");
    insert.run(null, 27602137, "tv", "我的大叔", "我的大叔");
    insert.run(null, null, "movie", "手动电影", "手动电影");
    insert.run(null, null, "tv", "手动电视剧", "手动电视剧");
    expect(() => insert.run(100, null, "tv", "重复", "重复")).toThrow();
    expect(() => insert.run(null, 27602137, "tv", "重复豆瓣", "重复豆瓣")).toThrow();
    const rows = database.sqlite.prepare("SELECT * FROM movies ORDER BY id").all();
    expect((rows.at(-1) as { id: number }).id).toBeGreaterThan(41);
    database.close();
    database = createDatabase(path);
    expect(database.sqlite.prepare("SELECT * FROM movies ORDER BY id").all()).toEqual(rows);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});
