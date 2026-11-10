import { afterEach, beforeEach, expect, test } from "bun:test";
import { homeGridLayouts, posterGridSizes } from "@film-shelf/shared/home-grid";
import type { MediaType } from "@film-shelf/shared";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db";
import { createHomeHtmlRenderer } from "../src/home-html";
import type { PosterStore } from "../src/posters";
import { movies } from "../src/schema";

const shell = '<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><div id="root"></div></body></html>';
const timestamp = "2026-01-02T03:04:05.000Z";
const original = (id: number) => `/api/posters/${id.toString(16).padStart(64, "0")}.jpg`;
const thumbnail = (width: number) => `/api/posters/${width.toString(16).padStart(64, "0")}.webp`;
const widths = [200, 360, 480];
const posters: PosterStore = {
  async variants(source) {
    return source === original(1) ? widths.map((width) => ({ width, url: thumbnail(width) })) : undefined;
  },
  async ensureVariants() {},
  async save() { throw new Error("Rendering the homepage must not write posters"); },
  async respond() { throw new Error("Rendering the homepage must not load poster bytes"); },
};

let database: ReturnType<typeof createDatabase>;
let render: ReturnType<typeof createHomeHtmlRenderer>;
beforeEach(() => {
  database = createDatabase(":memory:");
  render = createHomeHtmlRenderer(shell, database.db, posters);
});
afterEach(() => database.close());

function addMovie(id: number, posterUrl: string | null = original(id), mediaType: MediaType = "movie") {
  database.db.insert(movies).values({ id, title: `Movie ${id}`, posterUrl, mediaType, createdAt: timestamp, updatedAt: timestamp }).run();
}

interface Preload {
  href: string | null;
  srcset: string | null;
  sizes: string | null;
  media: string | null;
  priority: string | null;
}

async function preloads(search = "") {
  const links: Preload[] = [];
  const html = await render(new URLSearchParams(search));
  const rewriter = new HTMLRewriter().on('head link[rel="preload"][as="image"]', {
    element(element) {
      links.push({
        href: element.getAttribute("href"),
        srcset: element.getAttribute("imagesrcset"),
        sizes: element.getAttribute("imagesizes"),
        media: element.getAttribute("media")?.replaceAll("&gt;", ">").replaceAll("&lt;", "<") ?? null,
        priority: element.getAttribute("fetchpriority"),
      });
    },
  });
  await rewriter.transform(new Response(html)).text();
  return links;
}

test("preloads only safe posters and uses the responsive thumbnails without requesting the original", async () => {
  addMovie(1);
  addMovie(2);
  addMovie(3, null);
  addMovie(4, `${original(4)}" onload="alert(1)`);
  addMovie(5, "https://example.com/external-poster.jpg");
  const links = await preloads();
  expect(links).toHaveLength(2);
  expect(links.every((link) => link.priority === "high")).toBe(true);
  expect(links.find((link) => link.href === original(2))).toMatchObject({ srcset: null, sizes: null });
  expect(links.find((link) => link.srcset)).toMatchObject({
    href: null,
    srcset: widths.map((width) => `${thumbnail(width)} ${width}w`).join(", "),
    sizes: posterGridSizes,
  });
});

test("selects first-screen posters for the requested recommendation page and tracks library changes", async () => {
  for (let id = 2; id <= 19; id++) addMovie(id);
  const firstPage = await preloads();
  expect(firstPage.map(({ href }) => href).sort()).toEqual([14, 15, 16, 17, 18, 19].map(original));
  expect(firstPage.filter(({ media }) => !media).map(({ href }) => href).sort()).toEqual([17, 18, 19].map(original));

  const secondPage = await preloads("recommendedPage=2&watchedPage=3");
  expect(secondPage).toHaveLength(14);
  const expectedPosters = [[12, 13, 14, 15], [11, 12, 13], [8, 9, 10, 11], [2, 3, 4, 5, 6, 7]];
  for (const [index, { media }] of homeGridLayouts.entries()) {
    const activePosters = secondPage.filter((link) => link.media?.split(", ").includes(media)).map(({ href }) => href);
    expect(activePosters.sort()).toEqual(expectedPosters[index]!.map(original));
  }
  expect(await preloads("recommendedPage=1000")).toEqual([]);

  database.db.update(movies).set({ status: "watched", watchedAt: timestamp }).where(eq(movies.id, 19)).run();
  addMovie(20);
  expect((await preloads()).map(({ href }) => href).sort()).toEqual([14, 15, 16, 17, 18, 20].map(original));
});

test("media-filtered home preloads use the same type and page as the visible shelves", async () => {
  for (let id = 2; id <= 15; id++) addMovie(id, original(id), id % 2 === 0 ? "tv" : "movie");
  const shows = await preloads("mediaType=tv");
  expect(shows.map(({ href }) => href).sort()).toEqual([4, 6, 8, 10, 12, 14].map(original).sort());
  const films = await preloads("mediaType=movie");
  expect(films.map(({ href }) => href).sort()).toEqual([5, 7, 9, 11, 13, 15].map(original).sort());
  const second = await preloads("mediaType=tv&recommendedPage=2");
  const mobile = second.filter((link) => link.media?.split(", ").includes(homeGridLayouts[0].media));
  expect(mobile.map(({ href }) => href).sort()).toEqual([2, 4, 6].map(original).sort());
});
