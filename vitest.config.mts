import { defineConfig } from "vitest/config";

export default defineConfig({
  root: process.cwd(),
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "server-only": new URL("./tests/server-only.ts", import.meta.url).pathname,
    },
  },
  test: {
    api: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    reporters: ["default"],
  },
});
