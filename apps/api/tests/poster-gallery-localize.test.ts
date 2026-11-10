import { afterEach, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";
import { localizeExistingPosters } from "../src/localize-posters";
import type { PosterStore } from "../src/posters";
const database = createDatabase(":memory:");
afterEach(() => database.close());
test("localizing a legacy remote cover updates its gallery row without changing metadata", async () => {
  const remote = "https://image.tmdb.org/t/p/w500/old.jpg";
  const local = `/api/posters/${"a".repeat(64)}.jpg`;
  database.sqlite
    .prepare(
      "INSERT INTO movies(id,title,title_search,poster_url,created_at,updated_at) VALUES(1,'旧作品','旧作品',?,'old','old')",
    )
    .run(remote);
  database.sqlite
    .prepare(
      "INSERT INTO movie_posters(movie_id,url,created_at) VALUES(1,?,'old')",
    )
    .run(remote);
  const store: PosterStore = {
    async save() {
      return local;
    },
    async ensureVariants() {},
    async variants() {
      return undefined;
    },
    async respond() {
      return new Response(null);
    },
  };
  await localizeExistingPosters(database.db, store);
  const app = createApp({ db: database.db, posters: store, tmdbToken: "" });
  const result = await (await app.request("/api/movies/1/posters")).json();
  expect(result.posters).toHaveLength(1);
  expect(result.posters[0].url).toBe(local);
  expect(result.primaryPosterId).toBe(result.posters[0].id);
  expect(
    database.sqlite.prepare("SELECT updated_at FROM movies WHERE id=1").get(),
  ).toEqual({ updated_at: "old" });
});
