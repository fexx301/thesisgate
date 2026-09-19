import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3101";
const installedChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? (existsSync(installedChrome) ? installedChrome : undefined);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },
        isMobile: true,
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run start -- --hostname 127.0.0.1 --port 3101",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          THESIS_LLM_ENABLED: "false",
          THESIS_PUBLIC_ORIGINS: baseURL,
          THESIS_RECOMPUTE_SIGNING_SECRET: "local-browser-test-signing-secret-not-for-deployment",
        },
      },
});
