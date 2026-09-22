import { defineConfig } from "@playwright/test";

// Public API fixtures only: no database, credentials, or destructive-test guard
// overrides. A dedicated Vite process prevents borrowing another test's app.
export default defineConfig({
  testDir: "./browser",
  testMatch: "client-seo-navigation.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:4197",
    headless: true,
    launchOptions: {
      executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
  },
  webServer: {
    command: "pnpm --filter @workspace/beauty-marketplace exec vite --host 127.0.0.1 --port 4197 --strictPort",
    cwd: "..",
    url: "http://127.0.0.1:4197",
    reuseExistingServer: false,
    env: { SITE_INDEXABLE: "false", PUBLIC_SITE_URL: "https://lumera.example", BASE_PATH: "/" },
    timeout: 90_000,
  },
});