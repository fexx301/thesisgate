import { defineConfig } from "vitest/config";

// Separate config so the paid comparison never runs with the normal test suite.
export default defineConfig({
  root: new URL("../..", import.meta.url).pathname,
  resolve: {
    alias: {
      "@": new URL("../../src", import.meta.url).pathname,
      "server-only": new URL("../../tests/server-only.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    include: ["evals/e2e/**/*.e2e.ts"],
    testTimeout: 0,
    reporters: ["default"],
  },
});
