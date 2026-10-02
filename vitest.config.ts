import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup-env.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // PGlite instances and ffmpeg renders are heavy; keep files isolated but not too parallel.
    maxWorkers: 4,
  },
});
