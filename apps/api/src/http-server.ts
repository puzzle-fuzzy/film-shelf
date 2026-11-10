import type { Server } from "bun";

type HttpHandler = (request: Request) => Response | Promise<Response>;

export function createServerFetch(handler: HttpHandler) {
  return (
    request: Request,
    server: Server<unknown>,
  ): Response | Promise<Response> => {
    // Metadata imports, full actor credits and Douban cast photos can require
    // several bounded provider/download batches before the first response byte.
    const path = new URL(request.url).pathname;
    const slowPost = request.method === "POST" && (
      /^\/api\/movies\/[1-9]\d*\/posters(?:\/sync)?$/.test(path) ||
      path === "/api/movies/import" || path === "/api/movies"
    );
    const slowGet = request.method === "GET" && (
      /^\/api\/actors\/[1-9]\d*\/movies$/.test(path) ||
      /^\/api\/catalog\/douban\/(?:movies|tv)\/[1-9]\d*$/.test(path)
    );
    if (slowPost || slowGet) {
      server.timeout(request, 120);
    }
    return handler(request);
  };
}
