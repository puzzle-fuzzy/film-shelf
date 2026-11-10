import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CastMember, MovieInput } from "@film-shelf/shared";
import { createApp } from "../src/app";
import { actorImageSource, localActorImageUrl } from "../src/actor-images";
import { createDatabase } from "../src/db";
import { createPosterStore } from "../src/posters";
import { movies } from "../src/schema";
import type { MovieMetadataProvider } from "../src/tmdb";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const remote = "https://image.tmdb.org/t/p/w185/actor-photo.jpg";
const local = "/api/actors/image/actor-photo.jpg";
const originalCast: CastMember[] = [
  { name: "演员一", character: "角色一", profileUrl: remote },
  { name: "演员二", character: "角色二", profileUrl: null },
  { name: "演员三", character: "角色三", profileUrl: "https://example.com/external.jpg" },
];
const input: MovieInput = { title: "演员照片测试电影", cast: originalCast };
const provider: MovieMetadataProvider = {
  configured: true,
  async search() { return []; },
  async details(tmdbId) { return { ...input, tmdbId }; },
};

let directory: string;
let database: ReturnType<typeof createDatabase>;
let posters: ReturnType<typeof createPosterStore>;
let app: ReturnType<typeof createApp>;
let downloads: string[];
let offline: boolean;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "film-shelf-actors-"));
  database = createDatabase(":memory:");
  downloads = [];
  offline = false;
  posters = createPosterStore({ directory, fetcher: async (url) => {
    downloads.push(String(url));
    if (offline) throw new TypeError("Offline test image host");
    return new Response(png, { headers: { "content-type": "image/png" } });
  } });
  app = createApp({ db: database.db, tmdb: provider, posters });
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

function request(path: string, body?: unknown, method = "POST") {
  return app.request(path, body === undefined ? undefined : {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

function expectLocalCast(cast: CastMember[]) {
  expect(cast).toEqual([
    { ...originalCast[0]!, profileUrl: local },
    { ...originalCast[1]!, profileUrl: null },
    { ...originalCast[2]!, profileUrl: null },
  ]);
}

describe("persistent actor images", () => {
  test("maps only trusted exact image sources and preserves valid local references", () => {
    expect(localActorImageUrl(remote)).toBe(local);
    expect(localActorImageUrl(local)).toBe(local);
    expect(localActorImageUrl(`/api/posters/${"a".repeat(64)}.webp`)).toBe(`/api/posters/${"a".repeat(64)}.webp`);
    expect(localActorImageUrl(null)).toBeNull();
    for (const value of [
      "http://image.tmdb.org/t/p/w185/actor-photo.jpg",
      "https://example.com/t/p/w185/actor-photo.jpg",
      "https://image.tmdb.org:443/t/p/w185/actor-photo.jpg",
      "https://user@image.tmdb.org/t/p/w185/actor-photo.jpg",
      "https://image.tmdb.org/t/p/w500/actor-photo.jpg",
      "https://image.tmdb.org/t/p/w185/../actor-photo.jpg",
      "https://image.tmdb.org/t/p/w185/%2e%2e%2factor-photo.jpg",
      "https://image.tmdb.org/t/p/w185/actor-photo.jpg?url=https://example.com",
      "https://image.tmdb.org/t/p/w185/actor-photo.jpg#fragment",
      "https://image.tmdb.org/t/p/w185/actor-photo.jpg ",
      "/api/actors/image/../actor-photo.jpg",
      "/api/posters/invalid.jpg",
      "javascript:alert(1)",
    ]) expect(localActorImageUrl(value)).toBeNull();
    expect(actorImageSource("actor-photo.jpg")).toBe(remote);
    for (const value of ["", "../actor.jpg", "actor.gif", "%2Fetc%2Fpasswd", "actor.jpg?query=1", "actor\\photo.jpg"]) {
      expect(() => actorImageSource(value)).toThrow();
    }
    expect(downloads).toHaveLength(0);
  });

  test("all movie responses expose local image URLs without altering stored cast metadata or downloading eagerly", async () => {
    const createdResponse = await request("/api/movies", { ...input, tmdbId: 101 });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()).movie;
    expectLocalCast(created.cast);
    const importedResponse = await request("/api/movies/import", { tmdbId: 102 });
    expect(importedResponse.status).toBe(201);
    expectLocalCast((await importedResponse.json()).movie.cast);
    const list = await (await request("/api/movies")).json();
    expect(list.movies).toHaveLength(2);
    for (const movie of list.movies) expectLocalCast(movie.cast);
    expectLocalCast((await (await request(`/api/movies/${created.id}`)).json()).movie.cast);
    for (const body of [{ status: "watched" }, { status: "watched" }]) {
      const response = await request(`/api/movies/${created.id}/status`, body, "PATCH");
      expect(response.status).toBe(200);
      expectLocalCast((await response.json()).movie.cast);
    }
    const magnetUrl = `magnet:?xt=urn:btih:${"a".repeat(40)}`;
    for (const body of [{ magnetUrl }, { magnetUrl }]) {
      const response = await request(`/api/movies/${created.id}/magnet`, body, "PATCH");
      expect(response.status).toBe(200);
      expectLocalCast((await response.json()).movie.cast);
    }
    for (const movie of database.db.select().from(movies).all()) expect(movie.cast).toEqual(originalCast);
    expect(downloads).toHaveLength(0);
  });

  test("caches an actor image on first access and serves actual image MIME after offline store recreation", async () => {
    await request("/api/movies", input);
    const response = await request(local);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(downloads).toEqual([remote]);
    expect(readdirSync(directory).filter(name => name.endsWith(".png"))).toHaveLength(1);
    offline = true;
    const cached = await request(local);
    expect(cached.status).toBe(200);
    expect(Buffer.from(await cached.arrayBuffer())).toEqual(png);
    expect(downloads).toEqual([remote]);
    app = createApp({ db: database.db, tmdb: provider, posters: createPosterStore({ directory, fetcher: async () => { throw new TypeError("No external network after restart"); } }) });
    const reopened = await request(local);
    expect(reopened.status).toBe(200);
    expect(Buffer.from(await reopened.arrayBuffer())).toEqual(png);
    expect(database.db.select().from(movies).get()!.cast).toEqual(originalCast);
  });

  test("deduplicates concurrent image requests", async () => {
    const responses = await Promise.all([request(local), request(local), request(local)]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    }
    expect(downloads).toEqual([remote]);
  });

  test("rejects malformed local image paths without remote requests", async () => {
    for (const path of [
      "/api/actors/image/actor.gif", "/api/actors/image/actor.svg", "/api/actors/image/.env",
      "/api/actors/image/%2e%2e%2fsecret.jpg", "/api/actors/image/actor%5cphoto.jpg",
      "/api/actors/image/https%3A%2F%2Fexample.com%2Fevil.jpg",
    ]) expect((await request(path)).status).toBe(404);
    expect(downloads).toHaveLength(0);
    expect(readdirSync(directory)).toHaveLength(0);
  });

  test("reports download failure without writing files or changing movie records", async () => {
    await request("/api/movies", input);
    const before = database.db.select().from(movies).get()!;
    offline = true;
    const response = await request(local);
    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toBeTruthy();
    expect(readdirSync(directory)).toHaveLength(0);
    expect(database.db.select().from(movies).get()).toEqual(before);
  });
});
