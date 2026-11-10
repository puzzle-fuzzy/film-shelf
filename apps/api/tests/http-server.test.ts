import { expect, test } from "bun:test";
import { createServerFetch } from "../src/http-server";

test("gallery POST requests survive the server idle deadline while ordinary requests retain it", async () => {
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
    const options = {
      method: "POST",
      headers: { Connection: "close" },
      signal: AbortSignal.timeout(12000),
    };
    const results = await Promise.allSettled([
      fetch(new URL("/api/movies/12/posters", server.url), options).then(
        (response) => response.json(),
      ),
      fetch(new URL("/api/movies/12/posters/sync", server.url), options).then(
        (response) => response.json(),
      ),
      fetch(new URL("/api/movies/12/status", server.url), options).then(
        (response) => response.json(),
      ),
    ]);
    expect(results[0]).toEqual({
      status: "fulfilled",
      value: { completed: true },
    });
    expect(results[1]).toEqual({
      status: "fulfilled",
      value: { completed: true },
    });
    expect(results[2]?.status).toBe("rejected");
  } finally {
    await server.stop(true);
  }
}, 15000);

test("only the exact gallery POST paths receive a 120 second deadline", async () => {
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
    ["GET", "/api/movies/1/posters", false],
    ["PATCH", "/api/movies/1/poster", false],
    ["POST", "/api/movies/1/status", false],
    ["POST", "/api/movies/1/posters/sync/extra", false],
    ["POST", "/api/movies/0/posters", false],
    ["POST", "/api/movies/import", false],
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
