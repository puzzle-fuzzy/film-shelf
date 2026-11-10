import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serveStatic } from "hono/bun";
import { createApp } from "./app";
import { createServerFetch } from "./http-server";
import { createDatabase, projectRoot } from "./db";
import { createPosterStore } from "./posters";
import { localizeExistingPosters } from "./localize-posters";
import { createHomeHtmlRenderer } from "./home-html";
import { backfillDoubanCastImages } from "./cast-images";
import { createDoubanProvider } from "./douban";

const database = createDatabase();
const posters = createPosterStore();
const cached = await localizeExistingPosters(database.db, posters);
if (cached.migrated) console.log(`Saved ${cached.migrated} existing movie posters locally.`);
const douban = createDoubanProvider();
void backfillDoubanCastImages(database.db, posters, douban).then(({ updated }) => {
  if (updated) console.log(`Saved cast photos for ${updated} existing library entries.`);
}).catch((error: unknown) => {
  console.warn("Could not complete cast photo backfill:", error instanceof Error ? error.name : "UnknownError");
});
const app = createApp({ db: database.db, posters, douban });

function serveHome(path: string, indexPath: string) {
  const html = readFileSync(indexPath, "utf8");
  const render = createHomeHtmlRenderer(html, database.db, posters);
  app.get(path, async (c) => {
    const search = new URL(c.req.url).searchParams;
    const page = await render(search).catch((error: unknown) => {
      console.warn("Could not preload home posters:", error instanceof Error ? error.name : "UnknownError");
      return html;
    });
    return c.html(page, 200, { "Cache-Control": "no-cache" });
  });
}

const publicIndex = resolve(projectRoot, "public/index.html");
if (existsSync(publicIndex)) serveHome("/__public-home", publicIndex);
const webDist = resolve(projectRoot, "apps/web/dist");
const webIndex = resolve(webDist, "index.html");
if (existsSync(webIndex)) {
  app.get("/app", (c) => c.redirect("/app/"));
  serveHome("/app/", webIndex);
  app.get("/app/*", serveStatic({ root: webDist, rewriteRequestPath: (path) => path.replace(/^\/app(?=\/)/, "") }));
  const webFallback = serveStatic({ root: webDist, path: "index.html" });
  app.get("/app/*", async (c, next) => {
    if (c.req.path.startsWith("/app/assets/") || /\.[^/]+$/.test(c.req.path)) return c.notFound();
    return webFallback(c, next);
  });
}
const adminDist = resolve(projectRoot, "apps/admin/dist");
if (existsSync(resolve(adminDist, "index.html"))) {
  app.get("*", serveStatic({ root: adminDist }));
  const spaFallback = serveStatic({ root: adminDist, path: "index.html" });
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/assets/") || /\.[^/]+$/.test(c.req.path)) return next();
    return spaFallback(c, next);
  });
} else {
  app.get("/", (c) => c.text("Film Shelf API is running. Open the admin dev server, or run bun run build first."));
}

const port = Number(process.env.PORT || 3101);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid port number.");

export default { hostname: "127.0.0.1", port, fetch: createServerFetch(app.fetch) };
