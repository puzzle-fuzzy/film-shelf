import { createHash } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PosterVariant } from "@film-shelf/shared";

const widths = [200, 360, 480] as const;
const encoderVersion = "1.6.0";
const encoderOptions = ["-q", "78", "-m", "5"] as const;

export { widths as posterVariantWidths };

export function posterVariantFilename(original: string, width: number) {
  const recipe = ["cwebp", encoderVersion, ...encoderOptions, "-resize", width, 0];
  const hash = createHash("sha256").update(JSON.stringify([original, ...recipe])).digest("hex");
  return `${hash}.webp`;
}

function variantFiles(original: string, directory: string) {
  return widths.map((width) => {
    const filename = posterVariantFilename(original, width);
    return { width, filename, path: join(directory, filename) };
  });
}

export async function findPosterVariants(original: string, directory: string, maxImageBytes: number): Promise<PosterVariant[] | undefined> {
  const variants = await Promise.all(variantFiles(original, directory).map(async ({ width, filename, path }) => {
    const info = await lstat(path).catch(() => null);
    if (!info?.isFile() || info.size === 0 || info.size > maxImageBytes) return null;
    return { url: `/api/posters/${filename}`, width };
  }));
  return variants.every((variant) => variant !== null) ? variants : undefined;
}

async function run(command: string[]) {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe", timeout: 8_000, killSignal: "SIGKILL" });
  const [code, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(error.trim() || `${command[0]} exited with code ${code}`);
  return output.trim();
}

export function createPosterVariantGenerator() {
  const cwebp = Bun.which(process.env.FILM_SHELF_CWEBP || "cwebp");
  const ffprobe = Bun.which("ffprobe");
  if (!cwebp || !ffprobe) return null;
  let version: Promise<string> | undefined;

  return async (original: string, sourceDirectory: string, outputDirectory: string, maxImageBytes: number) => {
    if (await findPosterVariants(original, outputDirectory, maxImageBytes)) return "unchanged";

    const source = join(sourceDirectory, original);
    const sourceInfo = await lstat(source);
    if (!sourceInfo.isFile() || !sourceInfo.size || sourceInfo.size > maxImageBytes) throw new Error("Invalid source image file");
    if ((await (version ??= run([cwebp, "-version"]))).split(/\s/)[0] !== encoderVersion) {
      throw new Error(`Poster variants require cwebp ${encoderVersion}.`);
    }
    const width = Number(await run([ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", source]));
    if (!Number.isSafeInteger(width) || width <= 0) throw new Error("Could not determine poster width");
    if (width < widths[widths.length - 1]!) return "skipped";

    await mkdir(outputDirectory, { recursive: true });
    const temporary = await mkdtemp(join(outputDirectory, ".variants-"));
    try {
      const outputs = [];
      for (const file of variantFiles(original, outputDirectory)) {
        const path = join(temporary, file.filename);
        await run([cwebp, ...encoderOptions, "-resize", String(file.width), "0", "-quiet", source, "-o", path]);
        const info = await lstat(path);
        if (!info.size || info.size >= sourceInfo.size) return "skipped";
        outputs.push({ path, destination: file.path });
      }
      for (const { path, destination } of outputs) {
        try { await link(path, destination); }
        catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        }
      }
      return "generated";
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  };
}
