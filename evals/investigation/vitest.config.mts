import { defineConfig } from "vitest/config";
export default defineConfig({
  root: new URL("../..", import.meta.url).pathname,
  resolve: { alias: { "@": new URL("../../src", import.meta.url).pathname, "server-only": new URL("../../tests/server-only.ts", import.meta.url).pathname } },
  test: { environment: "node", include: ["evals/investigation/*.live.ts"], testTimeout: 240_000, hookTimeout: 30_000, fileParallelism: false, reporters: ["default"] },
});
