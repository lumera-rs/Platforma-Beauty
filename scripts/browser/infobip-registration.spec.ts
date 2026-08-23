/**
 * Infobip registration panel — browser regression.
 *
 * The route classifier and response contract are covered by
 * sms-webhook-registration.test.ts. This spec verifies the admin-facing
 * journey against a real API and frontend:
 *
 *  1. A real receipt after the saved secret is loaded as "Registracija
 *     potvrđena".
 *  2. With no qualifying SMS traffic, the check returns 200/verified:false,
 *     shows an informational toast, and refreshes the panel to "Još
 *     nepotvrđena".
 *  3. With a grace-aged SMS send and no receipt, the check returns 409,
 *     shows an error toast containing the guided URL, and refreshes the panel
 *     to "Verovatno nije registrovan".
 *
 * This file is intentionally run through the disposable browser harness. The
 * fixture changes provider receipt and automation-delivery evidence that the
 * shared development database may contain.
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  automationDeliveriesTable,
  automationRulesTable,
  automationRunsTable,
  db,
  providerWebhookReceiptsTable,
  salonCustomersTable,
  salonsTable,
  usersTable,
} from "@workspace/db";
import { hashPassword } from "../../artifacts/api-server/src/lib/auth";
import { saveIntegrationSettings } from "../../artifacts/api-server/src/lib/integrations";

const HOUR_MS = 60 * 60 * 1000;
const suffix = randomUUID();
const password = "browser-infobip-registration-password";
const adminEmail = `browser-infobip-registration-admin-${suffix}@example.test`;
const webhookSecret = `browser-infobip-registration-secret-${suffix}`;

let adminId = "";
let salonId = "";
let deliveryId = "";

test.beforeAll(async () => {
  const [admin] = await db.insert(usersTable).values({
    firstName: "Browser",
    lastName: "Infobip Registration",
    email: adminEmail,
    passwordHash: await hashPassword(password),
    passwordSetAt: new Date(),
    role: "ADMIN",
  }).returning();
  if (!admin) throw new Error("The Infobip registration fixture could not create its admin.");
  adminId = admin.id;

  const [salon] = await db.insert(salonsTable).values({
    ownerId: admin.id,
    name: `Infobip registration salon ${suffix}`,
    slug: `infobip-registration-${suffix}`,
    city: "Beograd",
    municipality: "Vračar",
    address: "Test 1",
    phone: "+381110000000",
    email: `infobip-registration-${suffix}@example.test`,
    shortDescription: "Salon za proveru Infobip registracije.",
    description: "Salon za browser regresiju Infobip registracije.",
    imageUrl: "/test-infobip-registration.jpg",
  }).returning();
  if (!salon) throw new Error("The Infobip registration fixture could not create its salon.");
  salonId = salon.id;

  const [customer] = await db.insert(salonCustomersTable).values({
    salonId: salon.id,
    firstName: "Infobip",
    lastName: "Test",
    email: `infobip-customer-${suffix}@example.test`,
  }).returning();
  if (!customer) throw new Error("The Infobip registration fixture could not create its customer.");

  const [rule] = await db.insert(automationRulesTable).values({
    salonId: salon.id,
    name: `Infobip registration rule ${suffix}`,
    trigger: "inactive_days",
    triggerConfig: { inactiveDays: 30 },
    action: "send_email_and_sms",
    status: "active",
  }).returning();
  if (!rule) throw new Error("The Infobip registration fixture could not create its rule.");

  const sentAt = new Date(Date.now() - 2 * HOUR_MS);
  const [run] = await db.insert(automationRunsTable).values({
    eventKey: `infobip-registration-run-${suffix}`,
    ruleId: rule.id,
    salonId: salon.id,
    salonCustomerId: customer.id,
    status: "sent",
    executedAt: sentAt,
    sentAt,
  }).returning();
  if (!run) throw new Error("The Infobip registration fixture could not create its run.");

  const [delivery] = await db.insert(automationDeliveriesTable).values({
    runId: run.id,
    salonId: salon.id,
    eventKey: `infobip-registration-run-${suffix}:sms`,
    channel: "sms",
    recipientPhone: "+381601234567",
    status: "sent",
    sentAt,
  }).returning();
  if (!delivery) throw new Error("The Infobip registration fixture could not create its SMS delivery.");
  deliveryId = delivery.id;

  await saveIntegrationSettings({
    integration: "sms",
    enabled: true,
    values: { webhookSecret: webhookSecret },
    updatedByUserId: admin.id,
  });

  // The aged send is deliberately inserted before this receipt. It exercises
  // the same precedence as the API fixture: a report after the secret save
  // confirms the current registration and suppresses the silence warning.
  await db.insert(providerWebhookReceiptsTable).values({
    provider: "infobip",
    lastEventAt: new Date(),
  });
});

test.afterAll(async () => {
  await db.delete(providerWebhookReceiptsTable)
    .where(eq(providerWebhookReceiptsTable.provider, "infobip"));
  if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
  if (adminId) await db.delete(usersTable).where(eq(usersTable.id, adminId));
});

test("the Infobip registration panel and check guide an admin through live verdicts", async ({ page }) => {
  test.setTimeout(120_000);

  const login = await page.request.post("/api/auth/login", {
    data: { email: adminEmail, password },
  });
  expect(login, "the fixture admin must be able to sign in").toBeOK();

  await page.goto("/admin/integracije");
  await expect(page.getByRole("heading", { name: "Integracije i konektori" })).toBeVisible();

  const panel = page.getByTestId("sms-webhook-registration-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Registracija na Infobip");
  await expect(panel).toContainText("Registracija potvrđena");
  await expect(panel).toContainText("Infobip zaista dostavlja izveštaje");

  const checkButton = page.getByRole("button", {
    name: "Proveri registraciju (Infobip)",
    exact: true,
  });

  // Make the saved delivery non-qualifying and remove the receipt. The check
  // must report "not enough evidence" as an informational 200, not an error.
  await db.update(automationDeliveriesTable)
    .set({ sentAt: new Date() })
    .where(eq(automationDeliveriesTable.id, deliveryId));
  await db.delete(providerWebhookReceiptsTable)
    .where(eq(providerWebhookReceiptsTable.provider, "infobip"));

  const noTrafficResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/admin/integrations/sms/verify-registration")
    && response.request().method() === "POST",
  );
  await checkButton.click();
  const noTrafficResponse = await noTrafficResponsePromise;
  expect(noTrafficResponse.status()).toBe(200);
  await expect(noTrafficResponse.json()).resolves.toMatchObject({
    verified: false,
    state: "unconfirmed",
  });

  const infoToast = page.locator("[data-sonner-toast]")
    .filter({ hasText: "registracija kod Infobip-a još nije potvrđena" });
  await expect(infoToast).toBeVisible();
  await expect(infoToast).toHaveAttribute("data-type", "info");
  await expect(panel).toContainText("Još nepotvrđena");
  await expect(panel).toContainText("Nema nedavnih automatskih SMS poruka");

  // Restore the aged send without a provider receipt. The second check must
  // surface the actionable 409 and refresh the already-mounted panel.
  await db.update(automationDeliveriesTable)
    .set({ sentAt: new Date(Date.now() - 2 * HOUR_MS) })
    .where(eq(automationDeliveriesTable.id, deliveryId));

  const misconfiguredResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/admin/integrations/sms/verify-registration")
    && response.request().method() === "POST",
  );
  await checkButton.click();
  const misconfiguredResponse = await misconfiguredResponsePromise;
  expect(misconfiguredResponse.status()).toBe(409);

  const errorToast = page.locator("[data-sonner-toast]")
    .filter({ hasText: "Webhook najverovatnije nije registrovan" });
  await expect(errorToast).toBeVisible();
  await expect(errorToast).toHaveAttribute("data-type", "error");
  await expect(errorToast).toContainText("/api/webhooks/infobip/<tajna>");
  await expect(panel).toContainText("Verovatno nije registrovan");
  await expect(panel).toContainText("Automatske SMS poruke se šalju");
});