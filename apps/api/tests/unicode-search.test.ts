import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createApp } from "../src/app";
import { createDatabase, migrationsFolder } from "../src/db";

let database: ReturnType<typeof createDatabase>;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  database = createDatabase(":memory:");
  app = createApp({ db: database.db, tmdbToken: "" });
});

afterEach(() => database.close());

async function addMovie(title: string, originalTitle = "") {
  const response = await app.request("/api/movies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, originalTitle }),
  });
  expect(response.status).toBe(201);
  const movie = (await response.json()).movie;
  expect(movie).not.toHaveProperty("titleSearch");
  expect(movie).not.toHaveProperty("originalTitleSearch");
  return movie;
}

async function search(query: string) {
  const response = await app.request(`/api/movies?q=${encodeURIComponent(query)}`);
  expect(response.status).toBe(200);
  return response.json();
}

describe("Unicode-aware movie search", () => {
  test("finds exact and lowercase queries for uppercase accented titles and original titles", async () => {
    const movie = await addMovie("85年盛夏", "Été 85");
    const accentedTitle = await addMovie("À BOUT DE SOUFFLE");
    for (const query of ["Été 85", "été 85", "ÉTÉ 85"]) {
      const result = await search(query);
      expect(result.total).toBe(1);
      expect(result.movies[0].id).toBe(movie.id);
    }
    expect((await search("à bout de souffle")).movies[0].id).toBe(accentedTitle.id);
  });

  test("matches composed and decomposed Unicode in either stored text or query", async () => {
    await addMovie("Été");
    await addMovie("E\u0301te\u0301");
    for (const query of ["Été", "été", "E\u0301te\u0301", "e\u0301te\u0301"]) {
      expect((await search(query)).total).toBe(2);
    }
  });

  test("preserves Chinese substring search and case-insensitive English search", async () => {
    const movie = await addMovie("搏击俱乐部", "Fight Club");
    for (const query of ["搏击", "FIGHT CLUB", "fight club", "Fight Club"]) {
      const result = await search(query);
      expect(result.total).toBe(1);
      expect(result.movies[0].id).toBe(movie.id);
    }
  });

  test("treats percent and underscore as literal characters", async () => {
    const percentMovie = await addMovie("100% Movie");
    const underscoreMovie = await addMovie("Movie_One");
    await addMovie("Some Other Movie");
    const percent = await search("%");
    expect(percent.total).toBe(1);
    expect(percent.movies[0].id).toBe(percentMovie.id);
    const underscore = await search("_");
    expect(underscore.total).toBe(1);
    expect(underscore.movies[0].id).toBe(underscoreMovie.id);
  });

  test("migrates and backfills an existing movie without exposing search columns or changing its status", async () => {
    const directory = mkdtempSync(join(tmpdir(), "film-shelf-search-migration-"));
    const legacyFolder = join(directory, "legacy-migrations");
    mkdirSync(join(legacyFolder, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"));
    const initialMigration = journal.entries[0];
    writeFileSync(join(legacyFolder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: [initialMigration] }));
    copyFileSync(join(migrationsFolder, `${initialMigration.tag}.sql`), join(legacyFolder, `${initialMigration.tag}.sql`));
    const path = join(directory, "existing.sqlite");
    const original = new Database(path);
    try {
      migrate(drizzle({ client: original }), { migrationsFolder: legacyFolder });
      original.prepare("INSERT INTO movies (title, original_title, status, watched_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("85年盛夏", "E\u0301te\u0301 85", "watched", "2026-01-01T00:00:00.000Z", "2025-12-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    } finally {
      original.close();
    }
    const upgraded = createDatabase(path);
    try {
      const upgradedApp = createApp({ db: upgraded.db, tmdbToken: "" });
      const response = await upgradedApp.request(`/api/movies?q=${encodeURIComponent("ÉTÉ 85")}`);
      const list = await response.json();
      expect(response.status).toBe(200);
      expect(list.total).toBe(1);
      expect(list.movies[0]).toMatchObject({ title: "85年盛夏", status: "watched", watchedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
      expect(list.movies[0]).not.toHaveProperty("titleSearch");
      expect(list.movies[0]).not.toHaveProperty("originalTitleSearch");
      const detail = await (await upgradedApp.request(`/api/movies/${list.movies[0].id}`)).json();
      expect(detail.movie).not.toHaveProperty("titleSearch");
      const changed = await (await upgradedApp.request(`/api/movies/${list.movies[0].id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "recommended" }),
      })).json();
      expect(changed.movie).not.toHaveProperty("titleSearch");
      expect(changed.movie).not.toHaveProperty("originalTitleSearch");
    } finally {
      upgraded.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
