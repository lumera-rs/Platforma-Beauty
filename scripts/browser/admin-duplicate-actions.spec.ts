import { expect, test, type Locator, type Page } from "@playwright/test";

const admin = {
  id: "00000000-0000-4000-8000-000000000451",
  firstName: "Duplicate",
  lastName: "Guard",
  email: "duplicate-guard@example.test",
  role: "SUPER_ADMIN",
  active: true,
  mustChangePassword: false,
};

type MutationCounts = {
  campaign: number;
  integrationSave: number;
  integrationTest: number;
  brevoRegistration: number;
  brevoCleanup: number;
  settlement: number;
  educationSettings: number;
};

type MutationHarness = MutationCounts & {
  holdNextMutation: () => () => void;
  failNextBrevoRegistration: () => void;
  returnPartialBrevoRegistration: () => void;
  failNextBrevoCleanup: () => void;
};

async function mockAdminMutationPages(page: Page): Promise<MutationHarness> {
  const counts: MutationCounts = { campaign: 0, integrationSave: 0, integrationTest: 0, brevoRegistration: 0, brevoCleanup: 0, settlement: 0, educationSettings: 0 };
  const integrationCard = { enabled: true, configuredInDatabase: true, complete: true, values: {} };
  let nextMutationHold: Promise<void> | null = null;
  let shouldFailNextBrevoRegistration = false;
  let shouldReturnPartialBrevoRegistration = false;
  let shouldFailNextBrevoCleanup = false;
  const missingBrevoEvents = [
    "isporučeno (delivered)",
    "otvaranja (opened / uniqueOpened)",
    "trajno odbijeno (hardBounce)",
    "blokirano (blocked)",
    "greška u slanju (error)",
  ];
  const successfulBrevoRegistration = {
    message: "Brevo webhook je registrovan.",
    webhookVerifiedAt: "2026-08-24T12:34:56.000Z",
    webhookVerificationStale: false,
    staleWebhooks: [{ id: 702, maskedUrl: "https://retry.example.test/brevo/•••" }],
  };
  const partialBrevoRegistration = {
    code: "BREVO_REGISTRATION_INCOMPLETE",
    error: `Webhook je ažuriran na Brevo, ali ponovna provera i dalje prijavljuje problem: Webhook je registrovan na Brevo, ali registracija ne prati sve potrebne događaje. Nedostaju: ${missingBrevoEvents.join(", ")}.`,
    missingEvents: missingBrevoEvents,
    staleWebhooks: [],
  };

  const holdNextMutation = () => {
    let release = () => undefined;
    nextMutationHold = new Promise<void>((resolve) => { release = resolve; });
    return release;
  };
  const waitForHeldMutation = async () => {
    const hold = nextMutationHold;
    nextMutationHold = null;
    if (hold) await hold;
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();

    if (pathname === "/api/auth/me") {
      await route.fulfill({ json: { user: admin } });
      return;
    }
    if (pathname === "/api/admin/email-marketing/campaigns" && method === "GET") {
      await route.fulfill({ json: { campaigns: [] } });
      return;
    }
    if (pathname === "/api/admin/loyalty-tiers" && method === "GET") {
      await route.fulfill({ json: [] });
      return;
    }
    if (pathname === "/api/admin/email-marketing/campaigns" && method === "POST") {
      counts.campaign += 1;
      await waitForHeldMutation();
      await route.fulfill({ json: { id: "campaign-1", recipientCount: 1 } });
      return;
    }
    if (pathname === "/api/admin/integrations" && method === "GET") {
      await route.fulfill({
        json: {
          integrations: {
            sms: integrationCard,
            brevo: integrationCard,
            google_oauth: integrationCard,
            facebook_oauth: integrationCard,
            cloudflare: integrationCard,
          },
          redirectUris: { google: "https://example.test/google", facebook: "https://example.test/facebook" },
          smsReminder: { command: "pnpm run sms-reminders", active: false, instructions: [] },
        },
      });
      return;
    }
    if (pathname === "/api/admin/integrations/sms" && method === "PUT") {
      counts.integrationSave += 1;
      await waitForHeldMutation();
      await route.fulfill({ json: integrationCard });
      return;
    }
    if (pathname === "/api/admin/integrations/sms/test" && method === "POST") {
      counts.integrationTest += 1;
      await waitForHeldMutation();
      await route.fulfill({ json: { message: "Test SMS je poslat." } });
      return;
    }
    if (pathname === "/api/admin/integrations/brevo/stale-webhooks" && method === "GET") {
      await route.fulfill({ json: { staleWebhooks: [{ id: 701, maskedUrl: "https://old.example.test/brevo/•••" }] } });
      return;
    }
    if (pathname === "/api/admin/integrations/brevo/register-webhook" && method === "POST") {
      counts.brevoRegistration += 1;
      await waitForHeldMutation();
      if (shouldFailNextBrevoRegistration) {
        shouldFailNextBrevoRegistration = false;
        await route.fulfill({ status: 502, json: { error: "Brevo je odbio registraciju." } });
        return;
      }
      if (shouldReturnPartialBrevoRegistration) {
        shouldReturnPartialBrevoRegistration = false;
        await route.fulfill({ status: 502, json: partialBrevoRegistration });
        return;
      }
      await route.fulfill({ json: successfulBrevoRegistration });
      return;
    }
    if (pathname === "/api/admin/integrations/brevo/verify-registration" && method === "POST") {
      await route.fulfill({ status: 409, json: { ...partialBrevoRegistration, code: "CONFLICT" } });
      return;
    }
    if (pathname === "/api/admin/integrations/brevo/cleanup-webhooks" && method === "POST") {
      counts.brevoCleanup += 1;
      await waitForHeldMutation();
      if (shouldFailNextBrevoCleanup) {
        shouldFailNextBrevoCleanup = false;
        await route.fulfill({ status: 502, json: { error: "Brevo je odbio uklanjanje registracija." } });
        return;
      }
      await route.fulfill({ json: { message: "Zaostale registracije su uklonjene.", staleWebhooks: [] } });
      return;
    }
    if (pathname === "/api/admin/education/settings" && method === "GET") {
      await route.fulfill({
        json: { commissionPercent: 10, reservePercent: 5, onlineRefundDays: 14, liveAppealDays: 7, featuredCoursePrice: 5000 },
      });
      return;
    }
    if (pathname === "/api/admin/education/settings" && method === "PATCH") {
      counts.educationSettings += 1;
      await waitForHeldMutation();
      await route.fulfill({
        json: { commissionPercent: 10, reservePercent: 5, onlineRefundDays: 14, liveAppealDays: 7, featuredCoursePrice: 5000 },
      });
      return;
    }
    if (pathname === "/api/admin/education/centers" && method === "GET") {
      await route.fulfill({ json: [] });
      return;
    }
    if (pathname === "/api/admin/education/finance" && method === "GET") {
      await route.fulfill({
        json: {
          summary: {},
          escrows: [],
          pendingEnrollments: [{
            id: "enrollment-1",
            courseTitle: "Kurs za test",
            amount: 15000,
            createdAt: "2026-08-21T09:00:00.000Z",
          }],
          featuredCharges: [],
        },
      });
      return;
    }
    if (pathname === "/api/education/disputes" && method === "GET") {
      await route.fulfill({ json: [] });
      return;
    }
    if (pathname === "/api/admin/education/enrollments/enrollment-1/settle" && method === "POST") {
      counts.settlement += 1;
      await waitForHeldMutation();
      await route.fulfill({ json: { ok: true } });
      return;
    }

    await route.fallback();
  });

  return {
    ...counts,
    get campaign() { return counts.campaign; },
    get integrationSave() { return counts.integrationSave; },
    get integrationTest() { return counts.integrationTest; },
    get brevoRegistration() { return counts.brevoRegistration; },
    get brevoCleanup() { return counts.brevoCleanup; },
    get settlement() { return counts.settlement; },
    get educationSettings() { return counts.educationSettings; },
    holdNextMutation,
    failNextBrevoRegistration: () => { shouldFailNextBrevoRegistration = true; },
    returnPartialBrevoRegistration: () => { shouldReturnPartialBrevoRegistration = true; },
    failNextBrevoCleanup: () => { shouldFailNextBrevoCleanup = true; },
  };
}

async function clickTwiceInTheSameTurn(button: Locator) {
  await button.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

test("email campaign send reaches the API once after rapid clicks", async ({ page }) => {
  const mutations = await mockAdminMutationPages(page);
  await page.goto("/admin/email-marketing");
  await expect(page.getByText("Nova kampanja")).toBeVisible();

  const send = page.getByRole("button", { name: "Pošalji kampanju" });
  const release = mutations.holdNextMutation();
  await clickTwiceInTheSameTurn(send);
  await expect.poll(() => mutations.campaign).toBe(1);
  await expect(send).toBeDisabled();
  release();
});

test("integration save and test sends reach the API once each after rapid clicks", async ({ page }) => {
  const mutations = await mockAdminMutationPages(page);
  await page.goto("/admin/integracije");
  const save = page.getByRole("button", { name: "Sačuvaj" }).first();
  const testSms = page.getByRole("button", { name: "Pošalji test SMS" });
  await expect(save).toBeVisible();
  await expect(testSms).toBeVisible();

  let release = mutations.holdNextMutation();
  await clickTwiceInTheSameTurn(save);
  await expect.poll(() => mutations.integrationSave).toBe(1);
  await expect(save).toBeDisabled();
  release();

  await page.getByPlaceholder("+381...").fill("+381601234567");
  release = mutations.holdNextMutation();
  await clickTwiceInTheSameTurn(testSms);
  await expect.poll(() => mutations.integrationTest).toBe(1);
  await expect(testSms).toBeDisabled();
  release();
});

test("Brevo webhook registration reaches the API once after rapid clicks", async ({ page }) => {
  const mutations = await mockAdminMutationPages(page);
  await page.goto("/admin/integracije");
  const register = page.getByRole("button", { name: "Registruj webhook" });
  await expect(register).toBeVisible();

  const release = mutations.holdNextMutation();
  await clickTwiceInTheSameTurn(register);
  await expect.poll(() => mutations.brevoRegistration).toBe(1);
  await expect(page.getByRole("button", { name: "Registrujem…" })).toBeDisabled();
  release();
});

test("failed Brevo webhook registration releases its guard for one deliberate retry", async ({ page }) => {
  const mutations = await mockAdminMutationPages(page);
  await page.goto("/admin/integracije");
  const register = page.getByRole("button", { name: "Registruj webhook" });
  await expect(register).toBeVisible();

  mutations.failNextBrevoRegistration();
  const release = mutations.holdNextMutation();
  await clickTwiceInTheSameTurn(register);
  await expect.poll(() => mutations.brevoRegistration).toBe(1);
  await expect(page.getByRole("button", { name: "Registrujem…" })).toBeDisabled();
  release();

  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Brevo je odbio registraciju." })).toBeVisible();
  await expect(register).toBeEnabled();
  await register.click();
  await expect.poll(() => mutations.brevoRegistration).toBe(2);
  await expect(page.getByTestId("webhook-confirmation-status-brevo")).toContainText("sveža potvrda");
  await expect(page.getByText("https://old.example.test/brevo/•••")).toHaveCount(0);
  await expect(page.getByText("https://retry.example.test/brevo/•••")).toBeVisible();
});

test("partial Brevo webhook repair keeps missing event guidance visible for repair and re-check", async ({ page }) => {
  const mutations = await mockAdminMutationPages(page);
  await page.goto("/admin/integracije");
  const register = page.getByRole("button", { name: "Registruj webhook" });
  await expect(register).toBeVisible();

  mutations.returnPartialBrevoRegistration();
  await register.click();

  const warning = page.getByTestId("brevo-missing-event-coverage");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("ne prati sve potrebne događaje");
  for (const missingEvent of [
    "isporučeno (delivered)",
    "otvaranja (opened / uniqueOpened)",
    "trajno odbijeno (hardBounce)",
    "blokirano (blocked)",
    "greška u slanju (error)",
  ]) await expect(warning).toContainText(missingEvent);

  await page.getByRole("button", { name: "Proveri registraciju na Brevo", exact: true }).click();
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("Ažurirajte registraciju u Brevo");
});

test("Brevo stale webhook cleanup reaches the API once after rapid confirmation", async ({ page }) => {
  const mutations = await mockAdminMutationPages(page);
  await page.goto("/admin/integracije");
  const cleanup = page.getByRole("button", { name: "Ukloni zaostale registracije" });
  await expect(cleanup).toBeVisible();

  page.on("dialog", (dialog) => dialog.accept());
  const release = mutations.holdNextMutation();
  await clickTwiceInTheSameTurn(cleanup);
  await expect.poll(() => mutations.brevoCleanup).toBe(1);
  await expect(page.getByRole("button", { name: "Uklanjam…" })).toBeDisabled();
  release();
});

test("failed Brevo stale webhook cleanup releases its guard for one deliberate retry", async ({ page }) => {
  const mutations = await mockAdminMutationPages(page);
  await page.goto("/admin/integracije");
  const cleanup = page.getByRole("button", { name: "Ukloni zaostale registracije" });
  await expect(cleanup).toBeVisible();

  page.on("dialog", (dialog) => dialog.accept());
  mutations.failNextBrevoCleanup();
  const release = mutations.holdNextMutation();
  await clickTwiceInTheSameTurn(cleanup);
  await expect.poll(() => mutations.brevoCleanup).toBe(1);
  await expect(page.getByRole("button", { name: "Uklanjam…" })).toBeDisabled();
  release();

  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Brevo je odbio uklanjanje registracija." })).toBeVisible();
  await expect(cleanup).toBeEnabled();
  await cleanup.click();
  await expect.poll(() => mutations.brevoCleanup).toBe(2);
  await expect(page.getByTestId("stale-brevo-webhook-checkbox-701")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ukloni zaostale registracije" })).toHaveCount(0);
});

test("manual education settlement reaches the API once after rapid confirmation", async ({ page }) => {
  const mutations = await mockAdminMutationPages(page);
  await page.goto("/admin/edukacije");
  const settlement = page.getByRole("button", { name: "Potvrdi uplatu" }).first();
  await expect(settlement).toBeVisible();

  page.on("dialog", (dialog) => dialog.accept());
  const release = mutations.holdNextMutation();
  await clickTwiceInTheSameTurn(settlement);
  await expect.poll(() => mutations.settlement).toBe(1);
  await expect(settlement).toBeDisabled();
  release();
});

test("education settings save reaches the API once after rapid clicks", async ({ page }) => {
  const mutations = await mockAdminMutationPages(page);
  await page.goto("/admin/edukacije");
  const save = page.getByRole("button", { name: "Sačuvaj" });
  await expect(save).toBeVisible();

  const release = mutations.holdNextMutation();
  await clickTwiceInTheSameTurn(save);
  await expect.poll(() => mutations.educationSettings).toBe(1);
  await expect(save).toBeDisabled();
  release();
});