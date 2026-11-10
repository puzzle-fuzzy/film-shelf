import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDatabase, migrationsFolder } from "../src/db";

test("gallery migration preserves every movie field and backfills one primary row on repeated reopen", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "film-shelf-gallery-migration-"),
  );
  const path = join(directory, "library.sqlite");
  const legacyFolder = join(directory, "legacy");
  mkdirSync(join(legacyFolder, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"),
  );
  const entries = journal.entries.filter(
    (entry: { idx: number }) => entry.idx < 5,
  );
  writeFileSync(
    join(legacyFolder, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries }),
  );
  for (const entry of entries)
    copyFileSync(
      join(migrationsFolder, `${entry.tag}.sql`),
      join(legacyFolder, `${entry.tag}.sql`),
    );
  let original: unknown[];
  const legacy = new Database(path);
  try {
    migrate(drizzle({ client: legacy }), { migrationsFolder: legacyFolder });
    const insert = legacy.prepare(
      "INSERT INTO movies (id, tmdb_id, douban_id, media_type, title, title_search, original_title, original_title_search, poster_url, release_date, overview, cast, magnet_url, status, watched_at, watched_order, created_at, updated_at) VALUES (?, 100, ?, ?, '旧作品', '旧作品', 'Legacy', 'legacy', ?, '2001-02-03', '保留简介', ?, ?, 'watched', '2020-03-04T00:00:00.000Z', ?, '2019-01-01', '2020-03-04')",
    );
    insert.run(
      41,
      888,
      "movie",
      `/api/posters/${"a".repeat(64)}.jpg`,
      JSON.stringify([{ name: "演员", character: "主角", profileUrl: null }]),
      `magnet:?xt=urn:btih:${"b".repeat(40)}`,
      9,
    );
    insert.run(42, 889, "tv", null, "[]", null, 10);
    original = legacy.prepare("SELECT * FROM movies ORDER BY id").all();
  } finally {
    legacy.close(true);
  }
  let database = createDatabase(path);
  try {
    expect(
      database.sqlite.prepare("SELECT * FROM movies ORDER BY id").all(),
    ).toEqual(original!);
    const gallery = database.sqlite
      .prepare("SELECT * FROM movie_posters")
      .all();
    expect(gallery).toHaveLength(1);
    expect(gallery[0]).toMatchObject({
      movie_id: 41,
      url: `/api/posters/${"a".repeat(64)}.jpg`,
      source: null,
      source_id: null,
      width: null,
      height: null,
      created_at: "2019-01-01",
    });
    database.close();
    database = createDatabase(path);
    expect(
      database.sqlite.prepare("SELECT * FROM movies ORDER BY id").all(),
    ).toEqual(original!);
    expect(
      database.sqlite.prepare("SELECT * FROM movie_posters").all(),
    ).toEqual(gallery);
  } finally {
    database.close();
    if (dirname(resolve(directory)) !== resolve(tmpdir()))
      throw new Error("Invalid temporary directory");
    rmSync(directory, { recursive: true, force: true });
  }
});
