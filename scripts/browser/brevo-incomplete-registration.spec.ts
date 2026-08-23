/**
 * Incomplete Brevo registration — browser regression.
 *
 * The provider-side route reports the event groups that a matching production
 * webhook still misses. The integrations card must retain those exact repair
 * instructions after a fresh read instead of reducing the result to a generic
 * re-registration reminder.
 */
import { expect, test, type Page } from "@playwright/test";

const publishedHost = "lumera-published.example.test";
const developmentOrigin = new URL(process.env.LUMERA_WEB_BASE_URL ?? "http://localhost:80").origin;
const publishedOrigin = (() => {
  const url = new URL(developmentOrigin);
  url.hostname = publishedHost;
  return url.origin;
})();

const missingEvents = [
  "isporučeno (delivered)",
  "otvaranja (opened / uniqueOpened)",
  "trajno odbijeno (hardBounce)",
  "blokirano (blocked)",
  "greška u slanju (error)",
];

const admin = {
  id: "browser-brevo-incomplete-registration-admin",
  firstName: "Browser",
  lastName: "Brevo Coverage",
  email: "browser-brevo-incomplete-registration@example.test",
  role: "ADMIN",
  active: true,
  mustChangePassword: false,
};

function integrationsPayload(includeMissingEvents: boolean) {
  const emptyCard = { enabled: false, configuredInDatabase: false, complete: false, values: {} };
  return {
    integrations: {
      sms: emptyCard,
      brevo: {
        enabled: true,
        configuredInDatabase: true,
        complete: true,
        values: {},
        webhookSecretPendingReconfirmation: true,
        brevoRegistrationMissingEvents: includeMissingEvents ? missingEvents : [],
      },
      google_oauth: emptyCard,
      facebook_oauth: emptyCard,
    },
    redirectUris: { google: "https://example.test/google", facebook: "https://example.test/facebook" },
    smsReminder: { command: "pnpm run sms-reminders", active: false, instructions: [] },
  };
}

async function stubIncompleteProductionRegistration(page: Page) {
  let incompleteCoverageWasVerified = false;
  let integrationsReads = 0;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/auth/me") {
      await route.fulfill({ json: { user: admin } });
      return;
    }
    if (path === "/api/admin/integrations" && request.method() === "GET") {
      integrationsReads += 1;
      await route.fulfill({ json: integrationsPayload(incompleteCoverageWasVerified) });
      return;
    }
    if (path === "/api/admin/integrations/brevo/verify-registration" && request.method() === "POST") {
      incompleteCoverageWasVerified = true;
      await route.fulfill({
        status: 409,
        json: {
          code: "CONFLICT",
          error: `Webhook je registrovan na Brevo (https://lumera-published.example.test/api/webhooks/brevo/…), ali registracija ne prati sve potrebne događaje. Nedostaju: ${missingEvents.join(", ")}.`,
          missingEvents,
          staleWebhooks: [],
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

  return {
    integrationsReads: () => integrationsReads,
    didVerifyIncompleteCoverage: () => incompleteCoverageWasVerified,
  };
}

test("the Brevo card keeps missing production event coverage actionable after reopening", async ({ page }) => {
  const state = await stubIncompleteProductionRegistration(page);

  await page.goto(`${publishedOrigin}/admin/integracije`);
  await expect(page.getByRole("heading", { name: "Integracije i konektori" })).toBeVisible();
  await expect(page.getByTestId("brevo-missing-event-coverage")).toHaveCount(0);

  await page.getByRole("button", { name: "Proveri registraciju na Brevo", exact: true }).click();
  await expect.poll(state.didVerifyIncompleteCoverage).toBe(true);

  const warning = page.getByTestId("brevo-missing-event-coverage");
  await expect(warning).toContainText("ne prati sve potrebne događaje");
  for (const missingEvent of missingEvents) await expect(warning).toContainText(missingEvent);

  await page.reload();
  await expect(warning).toBeVisible();
  for (const missingEvent of missingEvents) await expect(warning).toContainText(missingEvent);
  await expect(page.getByText("Webhook tajna je promenjena — URL registrovan kod provajdera više ne važi.")).toBeVisible();
  expect(state.integrationsReads()).toBeGreaterThanOrEqual(2);
});