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
import { db, usersTable } from "@workspace/db";

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
const createdUserIds: string[] = [];

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
});

test.afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
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

test("preview guidance is host-scoped and published webhook templates stay usable", async ({ page }) => {
  test.setTimeout(120_000);

  await openIntegrationsPage(page, developmentOrigin);

  await expect(page.getByTestId("development-preview-notice")).toBeVisible();
  await expect(page.getByTestId("oauth-redirect-development-warning")).toHaveCount(2);
  await expect(page.getByTestId("development-webhook-url-caveat-sms")).toBeVisible();
  await expect(page.getByTestId("development-webhook-url-caveat-brevo")).toBeVisible();

  await openIntegrationsPage(page, publishedOrigin);

  await expect(page.getByTestId("development-preview-notice")).toHaveCount(0);
  await expect(page.getByTestId("oauth-redirect-development-warning")).toHaveCount(0);
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
});