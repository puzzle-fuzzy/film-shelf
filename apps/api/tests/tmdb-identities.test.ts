import { expect, test } from "bun:test";
import { createTmdbProvider } from "../src/tmdb";

test("resolves unique IMDb identities by resource and caches successful lookups", async () => {
  const calls: string[] = [];
  const provider = createTmdbProvider("private-token", (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    expect(url.origin).toBe("https://api.themoviedb.org");
    expect(url.searchParams.get("external_source")).toBe("imdb_id");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer private-token");
    return Response.json({ person_results: [{ id: 42 }], tv_results: [{ id: 77 }], movie_results: [{ id: 88 }] });
  }) as unknown as typeof fetch);
  expect(await provider.findByImdb!("nm12345", "person")).toBe(42);
  expect(await provider.findByImdb!("nm12345", "person")).toBe(42);
  expect(await provider.findByImdb!("tt12345", "tv")).toBe(77);
  expect(await provider.findByImdb!("tt12345", "movie")).toBe(88);
  expect(calls).toEqual(["/3/find/nm12345", "/3/find/tt12345", "/3/find/tt12345"]);
});

test("never guesses ambiguous identities or sends invalid IMDb identifiers upstream", async () => {
  let calls = 0;
  const provider = createTmdbProvider("test", (async () => {
    calls++;
    return Response.json({ person_results: [{ id: 42 }, { id: 43 }], movie_results: [], tv_results: [] });
  }) as unknown as typeof fetch);
  expect(await provider.findByImdb!("nm12345", "person")).toBeNull();
  expect(await provider.findByImdb!("tt12345", "tv")).toBeNull();
  for (const id of ["../secret", " nm12345", "nm12345?x=1", "tt12345"]) {
    await expect(provider.findByImdb!(id, "person")).rejects.toMatchObject({ status: 400 });
  }
  expect(calls).toBe(2);
});

test("can use the alternate TMDB API host while keeping credentials on a fixed trusted origin", async () => {
  const provider = createTmdbProvider("private-token", (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://api.tmdb.org");
    expect(url.pathname).toBe("/3/find/nm12345");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer private-token");
    return Response.json({ person_results: [{ id: 42 }] });
  }) as unknown as typeof fetch, "api.tmdb.org");
  expect(await provider.findByImdb!("nm12345", "person")).toBe(42);
  for (const host of ["api.tmdb.org.evil.test", "https://api.tmdb.org", "api.tmdb.org/path", "127.0.0.1"]) {
    expect(() => createTmdbProvider("private-token", fetch, host)).toThrow("TMDB_API_HOST");
  }
});
