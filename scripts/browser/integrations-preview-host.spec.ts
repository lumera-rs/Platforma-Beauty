/**
 * Integration host-matrix browser regression.
 *
 * Preview-only guidance protects admins from registering a localhost or
 * .replit.dev webhook/redirect URL for production. The same page must stay
 * clean when opened through a published-style origin, while still displaying
 * a usable webhook URL template for that origin.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { inArray } from "drizzle-orm";
import { db, integrationSettingsTable, usersTable } from "@workspace/db";
import { saveIntegrationSettings } from "../../artifacts/api-server/src/lib/integrations";

const scrypt = promisify(scryptCallback);
const publishedHost = "lumera-published.example.test";
const developmentOrigin = new URL(process.env.LUMERA_WEB_BASE_URL ?? "http://localhost:80").origin;
const publishedOrigin = (() => {
  const url = new URL(developmentOrigin);
  url.hostname = publishedHost;
  return url.origin;
})();
const suffix = randomUUID();
const password = "browser-integrations-host-password";
const adminEmail = `browser-integrations-host-admin-${suffix}@example.test`;
const webhookSecrets = {
  sms: `browser-integrations-sms-secret-${suffix}`,
  brevo: `browser-integrations-brevo-secret-${suffix}`,
} as const;
const createdUserIds: string[] = [];
const priorIntegrationRows: Array<typeof integrationSettingsTable.$inferSelect> = [];

async function hashPassword(value: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(value, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

test.beforeAll(async () => {
  const inserted = await db.insert(usersTable).values({
    firstName: "Browser",
    lastName: "Integrations Host",
    email: adminEmail,
    passwordHash: await hashPassword(password),
    passwordSetAt: new Date(),
    role: "ADMIN",
  }).returning();
  if (inserted.length !== 1) throw new Error("The host-matrix fixture could not create the admin.");
  createdUserIds.push(...inserted.map((user) => user.id));

  const adminId = inserted[0]!.id;
  await Promise.all([
    saveIntegrationSettings({
      integration: "sms",
      enabled: true,
      values: { webhookSecret: webhookSecrets.sms },
      updatedByUserId: adminId,
    }),
    saveIntegrationSettings({
      integration: "brevo",
      enabled: true,
      values: { webhookSecret: webhookSecrets.brevo },
      updatedByUserId: adminId,
    }),
  ]);
});

test.afterAll(async () => {
  try {
    await db.delete(integrationSettingsTable)
      .where(inArray(integrationSettingsTable.integration, ["sms", "brevo"]));
    if (priorIntegrationRows.length > 0) {
      await db.insert(integrationSettingsTable).values(priorIntegrationRows);
    }
  } finally {
    if (createdUserIds.length > 0) {
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    }
  }
});

async function openIntegrationsPage(page: Page, origin: string) {
  const login = await page.request.post(`${developmentOrigin}/api/auth/login`, {
    data: { email: adminEmail, password },
  });
  expect(login.ok(), "the host-matrix admin must sign in").toBe(true);

  if (origin !== developmentOrigin) {
    // The browser can resolve the mapped published-style host, but the
    // Playwright Node request client cannot. Reuse the authenticated session
    // on the second host so the page still exercises the real admin route.
    const localhostCookies = await page.context().cookies(developmentOrigin);
    await page.context().addCookies(localhostCookies.map((cookie) => ({
      ...cookie,
      domain: publishedHost,
    })));
  }

  await page.goto(`${origin}/admin/integracije`);
  await expect(page.getByRole("heading", { name: "Integracije i konektori" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "E-mail · Brevo" })).toBeVisible();
}

async function stubStaleOAuthOriginWarning(page: Page) {
  const emptyCard = { enabled: false, configuredInDatabase: false, complete: false, values: {} };
  const admin = {
    id: "browser-oauth-domain-warning-admin",
    firstName: "Browser",
    lastName: "OAuth Domain",
    email: "browser-oauth-domain-warning@example.test",
    role: "ADMIN",
    active: true,
    mustChangePassword: false,
  };
  const staleWarning = "APP_BASE_URL je podešen na https://old-published.example.test, ali ovu stranicu otvarate sa https://new-published.example.test. Pre korišćenja novog domena ažurirajte APP_BASE_URL i Google/Facebook callback registracije na prikazane adrese — u suprotnom prijava društvenim nalozima može prestati da radi.";

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") {
      await route.fulfill({ json: { user: admin } });
      return;
    }
    if (path === "/api/admin/integrations" && request.method() === "GET") {
      await route.fulfill({
        json: {
          integrations: {
            sms: emptyCard,
            brevo: emptyCard,
            google_oauth: emptyCard,
            facebook_oauth: emptyCard,
          },
          redirectUris: {
            google: "https://new-published.example.test/api/auth/oauth/google/callback",
            facebook: "https://new-published.example.test/api/auth/oauth/facebook/callback",
          },
          redirectUriWarning: staleWarning,
          smsReminder: { command: "pnpm run sms-reminders", active: false, instructions: [] },
        },
      });
      return;
    }
    if (path === "/api/admin/integrations/brevo/stale-webhooks") {
      await route.fulfill({ json: { staleWebhooks: [] } });
      return;
    }
    await route.fulfill({ json: [] });
  });
}

test("preview guidance is host-scoped and published webhook templates stay usable", async ({ page }) => {
  test.setTimeout(120_000);
  // The published-style host is intentionally mapped over HTTP in this
  // regression, so Chromium does not expose navigator.clipboard as it would
  // on the real HTTPS published domain. Keep the app's copy handler intact
  // while providing the browser primitive needed to inspect its write.
  await page.addInitScript(() => {
    let clipboardText = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => { clipboardText = text; },
        readText: async () => clipboardText,
      },
    });
  });

  await openIntegrationsPage(page, developmentOrigin);

  await expect(page.getByTestId("development-preview-notice")).toBeVisible();
  await expect(page.getByTestId("oauth-redirect-origin-warning")).toHaveCount(2);
  await expect(page.getByTestId("development-webhook-url-caveat-sms")).toBeVisible();
  await expect(page.getByTestId("development-webhook-url-caveat-brevo")).toBeVisible();

  const copyWebhookUrl = async (
    heading: string,
    integration: "sms" | "brevo",
    origin: string,
  ) => {
    const card = page.locator("section").filter({
      has: page.getByRole("heading", { name: heading, exact: true }),
    });
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes(`/api/admin/integrations/${integration}/webhook-url`),
    );
    await card.getByRole("button", { name: "Kopiraj kompletan URL", exact: true }).click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const body = await response.json() as { url: string; warning?: string };
    expect(body.url).toBe(
      `${origin}/api/webhooks/${integration === "sms" ? "infobip" : "brevo"}/${encodeURIComponent(webhookSecrets[integration])}`,
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(body.url);
    return body;
  };

  const previewSms = await copyWebhookUrl("SMS · Infobip", "sms", developmentOrigin);
  expect(previewSms.warning).toContain("razvojnu adresu");
  const previewBrevo = await copyWebhookUrl("E-mail · Brevo", "brevo", developmentOrigin);
  expect(previewBrevo.warning).toContain("razvojnu adresu");

  await openIntegrationsPage(page, publishedOrigin);

  await expect(page.getByTestId("development-preview-notice")).toHaveCount(0);
  await expect(page.getByTestId("oauth-redirect-origin-warning")).toHaveCount(0);
  await expect(page.getByTestId("development-webhook-url-caveat-sms")).toHaveCount(0);
  await expect(page.getByTestId("development-webhook-url-caveat-brevo")).toHaveCount(0);
  await expect(page.locator("input[readonly]").first()).toHaveValue(
    `${publishedOrigin}/api/auth/oauth/google/callback`,
  );

  // The template remains directly usable: it carries the published origin,
  // the correct provider path, and the documented placeholder for the saved
  // secret that the copy action substitutes on demand.
  await expect(page.getByText(
    `${publishedOrigin}/api/webhooks/infobip/<tajna>`,
    { exact: true },
  )).toBeVisible();
  await expect(page.getByText(
    `${publishedOrigin}/api/webhooks/brevo/<tajna>`,
    { exact: true },
  )).toBeVisible();

  const publishedSms = await copyWebhookUrl("SMS · Infobip", "sms", publishedOrigin);
  expect(publishedSms.warning).toBeUndefined();
  const publishedBrevo = await copyWebhookUrl("E-mail · Brevo", "brevo", publishedOrigin);
  expect(publishedBrevo.warning).toBeUndefined();
});

test("a stale published OAuth origin warns in both social-login cards", async ({ page }) => {
  await stubStaleOAuthOriginWarning(page);
  await page.goto(`${publishedOrigin}/admin/integracije`);
  await expect(page.getByRole("heading", { name: "Integracije i konektori" })).toBeVisible();

  for (const provider of ["Google prijava", "Facebook prijava"]) {
    const card = page.getByRole("heading", { name: provider }).locator("xpath=ancestor::section");
    await expect(card.getByTestId("oauth-redirect-origin-warning")).toHaveText(/APP_BASE_URL/);
    await expect(card.getByTestId("oauth-redirect-origin-warning")).toContainText("Pre korišćenja novog domena");
    await expect(card.getByTestId("oauth-redirect-origin-warning")).toContainText("Google/Facebook callback registracije");
  }
});