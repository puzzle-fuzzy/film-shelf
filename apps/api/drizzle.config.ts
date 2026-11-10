import { defineConfig } from "drizzle-kit";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  dialect: "sqlite",
  schema: resolve(apiRoot, "src/schema.ts"),
  out: relative(process.cwd(), resolve(apiRoot, "drizzle")),
});
