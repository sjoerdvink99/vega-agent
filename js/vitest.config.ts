import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "node", include: ["test/**/*.test.ts"], exclude: ["test/embed.test.ts"], environment: "node" } },
      { test: { name: "dom", include: ["test/embed.test.ts"], environment: "jsdom", setupFiles: ["test/setup.ts"] } },
    ],
  },
});
