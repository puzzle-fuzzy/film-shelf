import type { CastMember } from "@film-shelf/shared";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const movies = sqliteTable("movies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tmdbId: integer("tmdb_id"),
  mediaType: text("media_type", { enum: ["movie", "tv"] }).notNull().default("movie"),
  doubanId: integer("douban_id"),
  episodeCount: integer("episode_count"),
  title: text("title").notNull(),
  originalTitle: text("original_title").notNull().default(""),
  titleSearch: text("title_search").notNull().default(""),
  originalTitleSearch: text("original_title_search").notNull().default(""),
  posterUrl: text("poster_url"),
  releaseDate: text("release_date"),
  overview: text("overview").notNull().default(""),
  cast: text("cast", { mode: "json" }).$type<CastMember[]>().notNull().default(sql`'[]'`),
  magnetUrl: text("magnet_url"),
  status: text("status", { enum: ["recommended", "watched"] }).notNull().default("recommended"),
  watchedAt: text("watched_at"),
  watchedOrder: integer("watched_order"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("movies_media_tmdb_unique").on(table.mediaType, table.tmdbId),
  uniqueIndex("movies_douban_unique").on(table.doubanId),
  index("movies_status_created_idx").on(table.status, table.createdAt),
  index("movies_status_watched_order_idx").on(table.status, table.watchedOrder),
  check("movies_status_check", sql`${table.status} in ('recommended', 'watched')`),
  check("movies_watched_at_check", sql`(${table.status} = 'recommended' and ${table.watchedAt} is null) or (${table.status} = 'watched' and ${table.watchedAt} is not null)`),
]);

export const moviePosters = sqliteTable("movie_posters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  movieId: integer("movie_id").notNull().references(() => movies.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  source: text("source", { enum: ["tmdb", "douban"] }),
  sourceId: text("source_id"),
  width: integer("width"),
  height: integer("height"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("movie_posters_movie_url_unique").on(table.movieId, table.url),
  uniqueIndex("movie_posters_movie_source_unique").on(table.movieId, table.source, table.sourceId),
]);
