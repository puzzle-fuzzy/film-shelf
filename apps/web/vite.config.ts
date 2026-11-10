import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, projectRoot, "");
  const apiPort = process.env.PORT || env.PORT || "3101";
  return {
    base: command === "build" ? "/app/" : "/",
    envDir: projectRoot,
    plugins: [react()],
    server: { proxy: { "/api": `http://127.0.0.1:${apiPort}` } },
  };
});
