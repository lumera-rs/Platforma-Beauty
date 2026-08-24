/**
 * Admin integrations response-contract browser regression.
 *
 * A successful HTTP status is not enough for this page: a malformed payload
 * must not leave an administrator looking at partial integration health or
 * repair controls. The first read uses the shared generated-contract fixture
 * to prove the normal page path, then the reload supplies a malformed 200.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import * as apiSchemas from "../../lib/api-zod/src/generated/api";
import { adminIntegrationsFixture } from "../src/browser-api-fixtures";

const scrypt = promisify(scryptCallback);
const suffix = randomUUID();
const password = "browser-integrations-response-validation-password";
const adminEmail = `browser-integrations-response-validation-${suffix}@example.test`;
const createdUserIds: string[] = [];

async function hashPassword(value: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(value, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

test.beforeAll(async () => {
  const inserted = await db.insert(usersTable).values({
    firstName: "Browser",
    lastName: "Response Validation",
    email: adminEmail,
    passwordHash: await hashPassword(password),
    passwordSetAt: new Date(),
    role: "ADMIN",
  }).returning();
  if (inserted.length !== 1) throw new Error("The integrations response fixture could not create the admin.");
  createdUserIds.push(...inserted.map((user) => user.id));
});

test.afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(usersTable).where(eq(usersTable.id, createdUserIds[0]!));
  }
});

test("rejects a malformed successful integrations response without rendering partial cards", async ({ page }) => {
  const validPayload = adminIntegrationsFixture(apiSchemas.AdminGetIntegrationsResponse);
  const malformedPayload: unknown = {
    ...validPayload,
    integrations: {
      ...validPayload.integrations,
      brevo: {
        ...validPayload.integrations.brevo,
        complete: "nije-bool",
      },
    },
  };
  let serveMalformedPayload = false;

  await page.route("**/api/admin/integrations", async (route) => {
    await route.fulfill({ status: 200, json: serveMalformedPayload ? malformedPayload : validPayload });
  });

  const login = await page.request.post("/api/auth/login", {
    data: { email: adminEmail, password },
  });
  expect(login).toBeOK();

  await page.goto("/admin/integracije");
  await expect(page.getByRole("heading", { name: "Integracije i konektori" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "E-mail · Brevo", exact: true })).toBeVisible();

  serveMalformedPayload = true;
  await page.reload();

  const validationError = page.getByText(/integrations\.brevo\.complete/);
  await expect(validationError).toBeVisible();
  await expect(validationError).toContainText("Odgovor servera za integracije nije validan");
  for (const title of [
    "SMS · Infobip",
    "E-mail · Brevo",
    "Google prijava",
    "Facebook prijava",
    "CDN keš · Cloudflare",
  ]) {
    await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
  }
});