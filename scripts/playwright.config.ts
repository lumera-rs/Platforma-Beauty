import { defineConfig } from "@playwright/test";

const chromiumExecutablePath = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const isolatedAdminBrowserTest = process.env.LUMERA_ISOLATED_ADMIN_BROWSER_TEST === "1";

function isHarnessDatabaseUrl(databaseUrl: string): boolean {
  try {
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    return /^lumera_admin_browser_\d+_[a-f0-9]{32}$/.test(databaseName);
  } catch {
    return false;
  }
}

function isHarnessWebUrl(webUrl: string): boolean {
  try {
    const url = new URL(webUrl);
    const port = Number(url.port);
    return url.protocol === "http:"
      && url.hostname === "127.0.0.1"
      && Number.isInteger(port)
      && port >= 1024;
  } catch {
    return false;
  }
}

if (isolatedAdminBrowserTest) {
  const testDatabaseUrl = process.env.LUMERA_TEST_DATABASE_URL;
  if (!testDatabaseUrl || process.env.DATABASE_URL !== testDatabaseUrl || !isHarnessDatabaseUrl(testDatabaseUrl)) {
    throw new Error("Isolated admin browser tests require the harness-generated disposable database.");
  }
  if (!process.env.LUMERA_WEB_BASE_URL || !isHarnessWebUrl(process.env.LUMERA_WEB_BASE_URL)) {
    throw new Error("Isolated admin browser tests require the harness-generated local frontend.");
  }
}

export default defineConfig({
  testDir: "./browser",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.LUMERA_WEB_BASE_URL ?? "http://localhost:80",
    trace: "retain-on-failure",
    launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : undefined,
  },
});