import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

export const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
export const newestMovieOrder = [desc(schema.movies.createdAt), desc(schema.movies.id)];

export function normalizeSearchText(value: string) {
  return value.normalize("NFC").toLowerCase();
}

export function resolveDatabasePath(path = process.env.DATABASE_PATH || "./data/film-shelf.sqlite") {
  return path === ":memory:" || isAbsolute(path) ? path : resolve(projectRoot, path);
}

export function createDatabase(path?: string) {
  const filename = resolveDatabasePath(path);
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const sqlite = new Database(filename, { create: true, strict: true });
  try {
    sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    if (filename !== ":memory:") sqlite.exec("PRAGMA journal_mode = WAL;");
    const db = drizzle({ client: sqlite, schema });
    migrate(db, { migrationsFolder });
    // Backfill preexisting movies after the search-column migration. A valid title is never empty.
    const pendingSearch = db.select({ id: schema.movies.id, title: schema.movies.title, originalTitle: schema.movies.originalTitle })
      .from(schema.movies).where(eq(schema.movies.titleSearch, "")).all();
    if (pendingSearch.length) {
      db.transaction((transaction) => {
        for (const movie of pendingSearch) {
          transaction.update(schema.movies).set({
            titleSearch: normalizeSearchText(movie.title),
            originalTitleSearch: normalizeSearchText(movie.originalTitle),
          }).where(eq(schema.movies.id, movie.id)).run();
        }
      });
    }
    return { db, sqlite, close: () => sqlite.close(true) };
  } catch (error) {
    sqlite.close(true);
    throw error;
  }
}

export type MovieDatabase = ReturnType<typeof createDatabase>["db"];
