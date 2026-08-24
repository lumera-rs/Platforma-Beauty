/**
 * Brevo stale webhook cleanup selection — browser regression.
 *
 * A stale LUMERA-format registration can belong to another environment, so
 * an administrator may deliberately leave it unchecked. If a selected
 * deletion fails and Brevo returns the full stale list again, retrying must
 * retain that choice rather than silently reselecting every registration.
 */
import { expect, test, type Page } from "@playwright/test";
import * as apiSchemas from "../../lib/api-zod/src/generated/api";
import { checkedApiFixture } from "../src/browser-api-fixtures";

const admin = {
  id: "00000000-0000-4000-8000-000000000081",
  firstName: "Test",
  lastName: "Administrator",
  email: "brevo-cleanup-selection@example.test",
  role: "ADMIN" as const,
  active: true,
  mustChangePassword: false,
};

const staleWebhooks = [
  { id: 101, maskedUrl: "https://sta***.example.test/api/webhooks/brevo/***" },
  { id: 202, maskedUrl: "https://pro***.example.test/api/webhooks/brevo/***" },
];

function integrationsPayload() {
  const card = { enabled: false, configuredInDatabase: false, complete: false, values: {} };
  const webhookCard = {
    ...card,
    webhookSecretPendingReconfirmation: false,
    webhookVerifiedAt: null,
    webhookVerificationStale: false,
    webhookConfirmationMaxAgeDays: 7,
  };
  return checkedApiFixture("/api/admin/integrations", apiSchemas.AdminGetIntegrationsResponse, {
    integrations: { sms: webhookCard, brevo: webhookCard, google_oauth: card, facebook_oauth: card, cloudflare: card },
    deliveryReports: {
      providers: {
        brevo: { lastEventAt: null, lastAutomationSentAt: null, recentSendCount: 0, warning: false },
        infobip: { lastEventAt: null, lastAutomationSentAt: null, recentSendCount: 0, warning: false },
      },
      windowHours: 24,
      graceMinutes: 30,
    },
    smsFallback: { reachableAdminCount: 0, reachableAdmins: [] },
    smsWebhookRegistration: { state: "unconfirmed", secretSavedAt: null, lastReportAt: null },
    redirectUris: { google: "https://example.test/google", facebook: "https://example.test/facebook" },
    smsReminder: { command: "pnpm run sms-reminders", active: false, instructions: [] },
  });
}

async function mockIntegrationsApi(page: Page) {
  const cleanupRequests: number[][] = [];
  let cleanupAttempts = 0;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === "/api/auth/me") {
      await route.fulfill({ json: { user: admin } });
      return;
    }
    if (path === "/api/admin/integrations" && method === "GET") {
      await route.fulfill({ json: integrationsPayload() });
      return;
    }
    if (path === "/api/admin/integrations/brevo/register-webhook" && method === "POST") {
      await route.fulfill({ json: { message: "Webhook je registrovan.", staleWebhooks } });
      return;
    }
    if (path === "/api/admin/integrations/brevo/cleanup-webhooks" && method === "POST") {
      cleanupRequests.push((request.postDataJSON() as { ids: number[] }).ids);
      cleanupAttempts += 1;
      if (cleanupAttempts === 1) {
        await route.fulfill({
          status: 500,
          json: { error: "Brevo nije uklonio registraciju.", staleWebhooks },
        });
        return;
      }
      await route.fulfill({
        json: { message: "Izabrana registracija je uklonjena.", staleWebhooks: [staleWebhooks[1]] },
      });
      return;
    }

    await route.fulfill({ json: [] });
  });

  return { cleanupRequests };
}

test("a failed selected cleanup keeps unchecked Brevo registrations excluded on retry", async ({ page }) => {
  const { cleanupRequests } = await mockIntegrationsApi(page);
  const confirmMessages: string[] = [];
  page.on("dialog", (dialog) => {
    confirmMessages.push(dialog.message());
    void dialog.accept();
  });

  await page.goto("/admin/integracije");
  await expect(page.getByRole("heading", { name: "Integracije i konektori" })).toBeVisible();

  await page.getByRole("button", { name: "Registruj webhook" }).click();
  const selected = page.getByTestId("stale-brevo-webhook-checkbox-101");
  const retained = page.getByTestId("stale-brevo-webhook-checkbox-202");
  await expect(selected).toBeChecked();
  await expect(retained).toBeChecked();

  await retained.uncheck();
  await expect(retained).not.toBeChecked();

  const cleanup = page.getByRole("button", { name: "Ukloni zaostale registracije" });
  await cleanup.click();
  await expect.poll(() => cleanupRequests.length).toBe(1);

  // Brevo's failed response repeats both stale registrations. The selected
  // item remains eligible to retry, but the deliberately retained item stays
  // unchecked and therefore cannot enter the retry payload.
  await expect(selected).toBeChecked();
  await expect(retained).not.toBeChecked();
  await cleanup.click();
  await expect.poll(() => cleanupRequests.length).toBe(2);

  expect(cleanupRequests).toEqual([[101], [101]]);
  expect(confirmMessages).toHaveLength(2);
  expect(confirmMessages.every((message) => message.includes("(1)") && message.includes("Neoznačene registracije ostaju registrovane."))).toBe(true);

  await expect(page.getByTestId("stale-brevo-webhook-checkbox-101")).toHaveCount(0);
  await expect(retained).toBeVisible();
  await expect(retained).not.toBeChecked();
  await expect(cleanup).toBeDisabled();
});