import { defineConfig } from "vite";

export default defineConfig({
  server: { fs: { allow: ["..", "../../js"] } },
  build: { target: "es2022", chunkSizeWarningLimit: 4096 },
});
