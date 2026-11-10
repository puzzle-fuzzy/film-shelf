import { expect, test } from "bun:test";
import { createServerFetch } from "../src/http-server";

test("bounded metadata and gallery requests survive the server idle deadline while ordinary requests retain it", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 1,
    fetch: createServerFetch(async () => {
      await Bun.sleep(6500);
      return Response.json({ completed: true });
    }),
  });
  try {
    const cases = [
      ["POST", "/api/movies/12/posters"],
      ["POST", "/api/movies/12/posters/sync"],
      ["GET", "/api/actors/12/movies?provider=douban&mediaType=tv"],
      ["GET", "/api/catalog/douban/movies/12"],
      ["GET", "/api/catalog/douban/tv/12"],
      ["POST", "/api/movies/import"],
      ["POST", "/api/movies"],
      ["PATCH", "/api/movies/12/status"],
    ] as const;
    const results = await Promise.allSettled(cases.map(([method, path]) =>
      fetch(new URL(path, server.url), {
        method,
        headers: { Connection: "close" },
        signal: AbortSignal.timeout(12000),
      }).then((response) => response.json()),
    ));
    for (const result of results.slice(0, -1)) expect(result).toEqual({
      status: "fulfilled", value: { completed: true },
    });
    expect(results.at(-1)?.status).toBe("rejected");
  } finally {
    await server.stop(true);
  }
}, 15000);

test("only exact bounded metadata and gallery paths receive a 120 second deadline", async () => {
  const applied: Array<{ request: Request; seconds: number }> = [];
  const server = {
    timeout(request: Request, seconds: number) {
      applied.push({ request, seconds });
    },
  } as Bun.Server<unknown>;
  const received: Request[] = [];
  const handler = createServerFetch((request) => {
    received.push(request);
    return new Response("ok");
  });
  const cases = [
    ["POST", "/api/movies/1/posters", true],
    ["POST", "/api/movies/25/posters/sync?retry=1", true],
    ["GET", "/api/actors/12/movies?provider=douban&mediaType=tv", true],
    ["GET", "/api/actors/12/movies", true],
    ["GET", "/api/catalog/douban/movies/12", true],
    ["GET", "/api/catalog/douban/tv/12", true],
    ["POST", "/api/movies/import", true],
    ["POST", "/api/movies", true],
    ["GET", "/api/movies/1/posters", false],
    ["PATCH", "/api/movies/1/poster", false],
    ["POST", "/api/movies/1/status", false],
    ["POST", "/api/movies/1/posters/sync/extra", false],
    ["POST", "/api/movies/0/posters", false],
    ["GET", "/api/movies/import", false],
    ["GET", "/api/movies", false],
    ["GET", "/api/catalog/tv/12", false],
    ["GET", "/api/catalog/douban/tv/0", false],
    ["GET", "/api/catalog/douban/tv/12/extra", false],
    ["GET", "/api/actors/0/movies", false],
    ["GET", "/api/actors/12/movies/extra", false],
    ["POST", "/api/actors/12/movies", false],
    ["POST", "/api/movies/import/extra", false],
  ] as const;
  for (const [method, path, extended] of cases) {
    applied.length = 0;
    const request = new Request(`http://localhost${path}`, { method });
    const response = await handler(request, server);
    expect(await response.text()).toBe("ok");
    expect(received.at(-1)).toBe(request);
    expect(applied).toEqual(extended ? [{ request, seconds: 120 }] : []);
  }
});
