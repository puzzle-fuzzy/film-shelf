import { Database } from "bun:sqlite";
import { resolveDatabasePath } from "./db";
import { createPosterVariantGenerator } from "./poster-variants";
import { defaultPostersDirectory, LOCAL_POSTER_PATH_PATTERN, maxImageBytes } from "./posters";

const [outputDirectory, databasePath, sourceDirectory = defaultPostersDirectory] = Bun.argv.slice(2);
if (!outputDirectory) throw new Error("Usage: bun apps/api/src/generate-poster-variants.ts <output-dir> [database] [source-poster-dir]");
const generate = createPosterVariantGenerator();
if (!generate) throw new Error("Install cwebp and ffprobe to generate poster variants.");

const db = new Database(resolveDatabasePath(databasePath), { readonly: true });
const posters = db.query<{ poster_url: string }, []>("SELECT DISTINCT poster_url FROM movies WHERE poster_url IS NOT NULL").all();
db.close();
const counts = { generated: 0, unchanged: 0, skipped: 0 };
for (const { poster_url } of posters) {
  const original = LOCAL_POSTER_PATH_PATTERN.exec(poster_url)?.[1];
  if (!original) {
    counts.skipped++;
    continue;
  }
  try {
    counts[await generate(original, sourceDirectory, outputDirectory, maxImageBytes)]++;
  } catch (error) {
    console.error(`Could not generate variants for ${original}:`, error);
    process.exitCode = 1;
  }
}
console.log(`${counts.generated} poster sets generated, ${counts.unchanged} already present, ${counts.skipped} skipped.`);
