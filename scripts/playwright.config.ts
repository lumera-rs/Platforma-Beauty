import { defineConfig } from "@playwright/test";

const chromiumExecutablePath = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const isolatedAdminBrowserTest = process.env.LUMERA_ISOLATED_ADMIN_BROWSER_TEST === "1";
const isolatedAdminFormResilienceBrowserTest =
  process.env.LUMERA_ISOLATED_ADMIN_FORM_RESILIENCE_BROWSER_TEST === "1";
const isolatedSalonNotificationBrowserTest =
  process.env.LUMERA_ISOLATED_SALON_NOTIFICATION_BROWSER_TEST === "1";
const releaseBrowserTest = process.env.LUMERA_RELEASE_BROWSER_TEST === "1";

function isHarnessDatabaseUrl(databaseUrl: string, databaseNamePattern: RegExp): boolean {
  try {
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    return databaseNamePattern.test(databaseName);
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

const isolatedBrowserTest =
  isolatedAdminBrowserTest
  || isolatedAdminFormResilienceBrowserTest
  || isolatedSalonNotificationBrowserTest;

if (
  [
    isolatedAdminBrowserTest,
    isolatedAdminFormResilienceBrowserTest,
    isolatedSalonNotificationBrowserTest,
  ].filter(Boolean).length > 1
) {
  throw new Error("Only one isolated browser suite may run in a harness process.");
}

if (isolatedBrowserTest) {
  const testDatabaseUrl = process.env.LUMERA_TEST_DATABASE_URL;
  const databaseNamePattern = isolatedAdminBrowserTest
    ? /^lumera_admin_browser_\d+_[a-f0-9]{32}$/
    : isolatedAdminFormResilienceBrowserTest
      ? /^lumera_form_browser_\d+_[a-f0-9]{32}$/
      : /^lumera_alert_browser_\d+_[a-f0-9]{32}$/;
  if (
    !testDatabaseUrl
    || process.env.DATABASE_URL !== testDatabaseUrl
    || !isHarnessDatabaseUrl(testDatabaseUrl, databaseNamePattern)
  ) {
    throw new Error("Isolated browser tests require the harness-generated disposable database.");
  }
  if (!process.env.LUMERA_WEB_BASE_URL || !isHarnessWebUrl(process.env.LUMERA_WEB_BASE_URL)) {
    throw new Error("Isolated browser tests require the harness-generated local frontend.");
  }
}

export default defineConfig({
  testDir: "./browser",
  globalSetup: "./src/browser-preflight.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: releaseBrowserTest ? 0 : process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.LUMERA_WEB_BASE_URL ?? "http://localhost:80",
    trace: "retain-on-failure",
    launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : undefined,
  },
});