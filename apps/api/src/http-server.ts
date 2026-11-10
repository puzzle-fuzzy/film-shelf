import type { Server } from "bun";

type HttpHandler = (request: Request) => Response | Promise<Response>;

export function createServerFetch(handler: HttpHandler) {
  return (
    request: Request,
    server: Server<unknown>,
  ): Response | Promise<Response> => {
    // Gallery imports can wait for several bounded provider/download batches.
    // Keep Bun's default idle deadline for every other request.
    if (
      request.method === "POST" &&
      /^\/api\/movies\/[1-9]\d*\/posters(?:\/sync)?$/.test(
        new URL(request.url).pathname,
      )
    ) {
      server.timeout(request, 120);
    }
    return handler(request);
  };
}
