import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  db,
  salonsTable,
  subscriptionPlansTable,
  subscriptionsTable,
  usersTable,
} from "@workspace/db";
import * as apiSchemas from "../../lib/api-zod/src/generated/api";
import { hashPassword } from "../../artifacts/api-server/src/lib/auth";
import { adminSummaryFixture, checkedApiFixture } from "../src/browser-api-fixtures";

const ADMIN_NAV = [
  { href: "/admin", testId: "admin-nav-dashboard" },
  { href: "/admin/saloni", testId: "admin-nav-saloni" },
  { href: "/admin/predlosci-usluga", testId: "admin-nav-predlosci-usluga" },
  { href: "/admin/korisnici", testId: "admin-nav-korisnici" },
  { href: "/admin/loyalty", testId: "admin-nav-loyalty" },
  { href: "/admin/pretplate", testId: "admin-nav-pretplate" },
  { href: "/admin/edukacije", testId: "admin-nav-edukacije" },
  { href: "/admin/recenzije", testId: "admin-nav-recenzije" },
  { href: "/admin/proizvodi", testId: "admin-nav-proizvodi" },
  { href: "/admin/porudzbine", testId: "admin-nav-porudzbine" },
  { href: "/admin/kategorije", testId: "admin-nav-kategorije" },
  { href: "/admin/brendovi", testId: "admin-nav-brendovi" },
  { href: "/admin/dostava", testId: "admin-nav-dostava" },
  { href: "/admin/email-marketing", testId: "admin-nav-email-marketing" },
  { href: "/admin/sms-evidencija", testId: "admin-nav-sms-evidencija" },
  { href: "/admin/integracije", testId: "admin-nav-integracije" },
];

const PROTECTED_ADMIN_ROUTES = [
  ...ADMIN_NAV.map(({ href }) => href),
  "/admin/saloni/00000000-0000-4000-8000-000000000001",
  "/admin/porudzbine/00000000-0000-4000-8000-000000000002",
];

const admin = {
  id: "00000000-0000-4000-8000-000000000071",
  firstName: "Test",
  lastName: "Administrator",
  email: "admin-regression@example.test",
  role: "ADMIN" as const,
  active: true,
  mustChangePassword: false,
};

const superAdmin = { ...admin, role: "SUPER_ADMIN" as const };
const salonId = "00000000-0000-4000-8000-000000000072";
const userId = "00000000-0000-4000-8000-000000000073";
const tierId = "00000000-0000-4000-8000-000000000074";
const planId = "00000000-0000-4000-8000-000000000075";
const reviewId = "00000000-0000-4000-8000-000000000076";

function adminSalon() {
  return {
    id: salonId,
    name: "Regresioni salon",
    slug: "regresioni-salon",
    city: "Beograd",
    active: true,
    featured: false,
    isVerified: true,
    topSalon: false,
    videoUrl: null,
    rating: 4.8,
    reviewCount: 12,
    subscriptionStatus: "active",
    subscriptionPlan: "LUMERA Pro",
    loyaltyTier: "Gold",
    loyaltySpend: 12000,
    createdAt: "2026-08-21T09:00:00.000Z",
  };
}

function adminUser() {
  return {
    id: userId,
    firstName: "Salon",
    lastName: "Vlasnik",
    email: "owner-regression@example.test",
    phone: null,
    role: "SALON_OWNER",
    active: true,
    createdAt: "2026-08-21T09:00:00.000Z",
  };
}

function loyaltyTier() {
  return {
    id: tierId,
    name: "Gold",
    sortOrder: 2,
    spendThreshold: 10000,
    period: "monthly",
    subscriptionDiscountPercent: 10,
    productDiscountPercent: 5,
    freeSubscription: false,
    premiumListing: true,
    freeShipping: true,
    benefits: ["Prioritetna podrška"],
    active: true,
  };
}

function subscriptionPlan() {
  return {
    id: planId,
    name: "LUMERA Pro",
    price: 4990,
    trialDays: 14,
    features: ["Neograničen kalendar"],
    limits: { employees: 10, services: 50 },
    active: true,
  };
}

function adminReview() {
  return {
    id: reviewId,
    salonId,
    salonName: "Regresioni salon",
    customerId: userId,
    customerName: "Salon Vlasnik",
    serviceName: "Regresioni tretman",
    rating: 5,
    text: "Odlična usluga.",
    visible: true,
    date: "2026-08-21T09:00:00.000Z",
  };
}

async function mockAdminApi(page: Page, role: "ADMIN" | "SUPER_ADMIN", loggedIn = true) {
  let currentUser = role === "SUPER_ADMIN" ? superAdmin : admin;
  let isLoggedIn = loggedIn;
  let salon = adminSalon();
  let user = adminUser();
  let tier = loyaltyTier();
  let plan = subscriptionPlan();
  let review = adminReview();

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/auth/me") {
      await route.fulfill({
        json: checkedApiFixture("/api/auth/me", apiSchemas.GetCurrentUserResponse, {
          user: isLoggedIn ? currentUser : null,
        }),
      });
      return;
    }
    if (path === "/api/auth/login" && method === "POST") {
      isLoggedIn = true;
      currentUser = role === "SUPER_ADMIN" ? superAdmin : admin;
      await route.fulfill({ json: { user: currentUser, message: "Uspešno ste prijavljeni." } });
      return;
    }
    if (path === "/api/education/disputes" && method === "GET") {
      await route.fulfill({
        json: checkedApiFixture("/api/education/disputes", apiSchemas.ListEducationDisputesResponse, []),
      });
      return;
    }
    if (path === "/api/growth/admin/summary" && method === "GET") {
      await route.fulfill({
        json: checkedApiFixture("/api/growth/admin/summary", apiSchemas.AdminGetGrowthSummaryResponse, {
          automation: { totalRules: 4, activeRules: 2, byStatus: { active: 2, paused: 2 } },
          packages: { total: 3, active: 2 },
          purchases: { total: 5, active: 4, pendingPayment: 1 },
        }),
      });
      return;
    }

    if (path.startsWith("/api/admin/")) {
      if (path === "/api/admin/summary") {
        await route.fulfill({
          json: adminSummaryFixture(apiSchemas.GetAdminSummaryResponse),
        });
        return;
      }
      if (path === "/api/admin/salons" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/salons", apiSchemas.AdminListSalonsResponse, [salon]),
        });
        return;
      }
      if (path === `/api/admin/salons/${salonId}` && method === "GET") {
        const detail = {
            ...salon,
            address: "Test 1",
            postalCode: "11000",
            phone: "+381110000000",
            email: "salon@example.test",
            orderCount: 0,
            orderTotal: 0,
            orders: [],
        };
        await route.fulfill({
          json: checkedApiFixture(`/api/admin/salons/${salonId}`, apiSchemas.AdminGetSalonResponse, detail),
        });
        return;
      }
      if (path === `/api/admin/salons/${salonId}` && method === "PATCH") {
        salon = { ...salon, ...(request.postDataJSON() as Partial<typeof salon>) };
        await route.fulfill({
          json: checkedApiFixture(`/api/admin/salons/${salonId}`, apiSchemas.AdminUpdateSalonResponse, salon),
        });
        return;
      }
      if (path === "/api/admin/users" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/users", apiSchemas.AdminListUsersResponse, [user]),
        });
        return;
      }
      if (path === `/api/admin/users/${userId}` && method === "PATCH") {
        user = { ...user, ...(request.postDataJSON() as Partial<typeof user>) };
        await route.fulfill({
          json: checkedApiFixture(`/api/admin/users/${userId}`, apiSchemas.AdminUpdateUserResponse, user),
        });
        return;
      }
      if (path === "/api/admin/loyalty-tiers" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/loyalty-tiers", apiSchemas.AdminListLoyaltyTiersResponse, [tier]),
        });
        return;
      }
      if (path === `/api/admin/loyalty-tiers/${tierId}` && method === "PATCH") {
        tier = { ...tier, ...(request.postDataJSON() as Partial<typeof tier>) };
        await route.fulfill({
          json: checkedApiFixture(`/api/admin/loyalty-tiers/${tierId}`, apiSchemas.AdminUpdateLoyaltyTierResponse, tier),
        });
        return;
      }
      if (path === "/api/admin/loyalty-tiers" && method === "POST") {
        await route.fulfill({
          status: 201,
          json: checkedApiFixture("/api/admin/loyalty-tiers", apiSchemas.AdminCreateLoyaltyTierResponse, {
            ...tier,
            id: randomUUID(),
          }),
        });
        return;
      }
      if (path === `/api/admin/loyalty-tiers/${tierId}` && method === "DELETE") {
        await route.fulfill({
          json: checkedApiFixture(`/api/admin/loyalty-tiers/${tierId}`, apiSchemas.AdminDeleteLoyaltyTierResponse, {
            ...tier,
            active: false,
          }),
        });
        return;
      }
      if (path === "/api/admin/subscription-plans" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/subscription-plans", apiSchemas.AdminListSubscriptionPlansResponse, [plan]),
        });
        return;
      }
      if (path === `/api/admin/subscription-plans/${planId}` && method === "PATCH") {
        plan = { ...plan, ...(request.postDataJSON() as Partial<typeof plan>) };
        await route.fulfill({
          json: checkedApiFixture(`/api/admin/subscription-plans/${planId}`, apiSchemas.AdminUpdateSubscriptionPlanResponse, plan),
        });
        return;
      }
      if (path === "/api/admin/subscription-plans" && method === "POST") {
        await route.fulfill({
          status: 201,
          json: checkedApiFixture("/api/admin/subscription-plans", apiSchemas.AdminCreateSubscriptionPlanResponse, {
            ...plan,
            id: randomUUID(),
          }),
        });
        return;
      }
      if (path === `/api/admin/subscription-plans/${planId}` && method === "DELETE") {
        plan = { ...plan, active: false };
        await route.fulfill({
          json: checkedApiFixture(`/api/admin/subscription-plans/${planId}`, apiSchemas.AdminDeleteSubscriptionPlanResponse, plan),
        });
        return;
      }
      if (path === "/api/admin/reviews" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/reviews", apiSchemas.AdminListReviewsResponse, [review]),
        });
        return;
      }
      if (path === `/api/admin/reviews/${reviewId}` && method === "PATCH") {
        review = { ...review, ...(request.postDataJSON() as Partial<typeof review>) };
        await route.fulfill({
          json: checkedApiFixture(`/api/admin/reviews/${reviewId}`, apiSchemas.AdminUpdateReviewResponse, review),
        });
        return;
      }
      if (path === `/api/admin/reviews/${reviewId}` && method === "DELETE") {
        await route.fulfill({ status: 204 });
        return;
      }
      if (path === "/api/admin/shipping" && method === "GET") {
        const shipping = {
            freeShippingThreshold: 10000,
            tiers: [],
            personalDeliveryEnabled: false,
            personalDeliveryName: "Lična dostava u Beogradu",
            personalDeliveryPrice: 0,
            personalDeliveryDescription: "Dostava na adresu u Beogradu.",
            updatedAt: "2026-08-21T09:00:00.000Z",
        };
        await route.fulfill({
          json: checkedApiFixture("/api/admin/shipping", apiSchemas.AdminGetShippingConfigResponse, shipping),
        });
        return;
      }
      if (path === "/api/admin/courier-services" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/courier-services", apiSchemas.AdminListCourierServicesResponse, []),
        });
        return;
      }
      if (path === "/api/admin/email-marketing/campaigns" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/email-marketing/campaigns", apiSchemas.AdminListEmailCampaignsResponse, {
            campaigns: [],
          }),
        });
        return;
      }
      if (path === "/api/admin/integrations" && method === "GET") {
        const card = { enabled: false, configuredInDatabase: false, complete: false, values: {}, version: null };
        const webhookCard = {
          ...card,
          webhookSecretPendingReconfirmation: false,
          webhookVerifiedAt: null,
          webhookVerificationStale: false,
          webhookConfirmationMaxAgeDays: 7,
        };
        await route.fulfill({
          json: checkedApiFixture("/api/admin/integrations", apiSchemas.AdminGetIntegrationsResponse, {
            integrations: {
              sms: webhookCard,
              brevo: webhookCard,
              google_oauth: card,
              facebook_oauth: card,
              cloudflare: card,
            },
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
          }),
        });
        return;
      }
      if (path === "/api/admin/education/settings" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/education/settings", apiSchemas.GetAdminEducationSettingsResponse, {
            id: "00000000-0000-4000-8000-000000000077",
            commissionPercent: 10,
            reservePercent: 5,
            onlineRefundDays: 14,
            liveAppealDays: 7,
            featuredCoursePrice: 5000,
            updatedAt: "2026-08-21T09:00:00.000Z",
          }),
        });
        return;
      }
      if (path === "/api/admin/education/centers" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/education/centers", apiSchemas.ListAdminEducationCentersResponse, []),
        });
        return;
      }
      if (path === "/api/admin/education/finance" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/education/finance", apiSchemas.GetAdminEducationFinanceResponse, {
            summary: {},
            escrows: [],
            pendingEnrollments: [],
            featuredCharges: [],
            payouts: [],
          }),
        });
        return;
      }

      // The navigation test only needs these sections to resolve their initial
      // list requests. Individual action tests above provide complete fixtures.
      await route.fulfill({ json: [] });
      return;
    }

    await route.fallback();
  });
}

async function openAdminPage(page: Page, path: string, role: "ADMIN" | "SUPER_ADMIN" = "SUPER_ADMIN") {
  await mockAdminApi(page, role);
  await page.goto(path);
  await expect(page.locator("aside").getByRole("heading", { name: "Admin Panel" })).toBeVisible();
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText;
    if (request.resourceType() === "eventsource" && failure === "net::ERR_ABORTED") return;
    errors.push(`request: ${request.method()} ${request.url()} — ${failure ?? "failed"}`);
  });
  page.on("response", (response) => {
    if (response.request().resourceType() === "document" && response.status() >= 400) {
      errors.push(`navigation: ${response.status()} ${response.url()}`);
    }
  });
  return errors;
}

test("an admin can sign in and reach every admin section on desktop", async ({ page }) => {
  await mockAdminApi(page, "ADMIN", false);
  await page.goto("/poslovna-prijava");
  await page.getByLabel("Email").fill("admin-regression@example.test");
  await page.getByLabel("Lozinka").fill("regression-password");
  await page.getByRole("button", { name: "Prijavi se u poslovni portal" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator("aside").getByRole("heading", { name: "Admin Panel" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aktivnost novih modula" })).toBeVisible();

  for (const [index, link] of ADMIN_NAV.entries()) {
    if (index > 0) {
      await page.getByTestId(link.testId).click();
      await expect(page).toHaveURL(new RegExp(`${link.href.replaceAll("/", "\\/")}$`));
    }
    await expect(page.getByTestId(link.testId)).toBeVisible();
  }
});

test("a super administrator receives growth data on the dashboard without a forbidden response", async ({ page }) => {
  const growthResponses: number[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/growth/admin/summary") {
      growthResponses.push(response.status());
    }
  });

  await openAdminPage(page, "/admin", "SUPER_ADMIN");

  await expect(page.getByRole("heading", { name: "Aktivnost novih modula" })).toBeVisible();
  await expect(page.getByText("Automatizacije (Kampanje)")).toBeVisible();
  await expect.poll(() => growthResponses).toEqual([200]);
});

test("an admin can reach every admin section from the mobile menu", async ({ page }) => {
  await openAdminPage(page, "/admin");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("admin-mobile-menu-trigger")).toBeVisible();

  await expect(page.locator("main")).toBeVisible();
  for (const link of ADMIN_NAV.slice(1)) {
    await page.getByTestId("admin-mobile-menu-trigger").click();
    await expect(page.getByTestId(link.testId).first()).toBeVisible();
    await page.getByTestId(link.testId).first().click();
    await expect(page).toHaveURL(new RegExp(`${link.href.replaceAll("/", "\\/")}$`));
  }
});

test("admin mobile navigation traps keyboard focus and restores the toggle on escape", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await openAdminPage(page, "/admin");
  await page.setViewportSize({ width: 390, height: 844 });

  const mobileMenuButton = page.getByTestId("admin-mobile-menu-trigger");
  await mobileMenuButton.focus();
  await expect(mobileMenuButton).toBeFocused();
  await mobileMenuButton.press("Enter");

  const mobileMenu = page.getByTestId("admin-mobile-menu");
  await expect(mobileMenu).toBeVisible();
  const focusableMenuControls = mobileMenu.locator(
    'a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  const focusableMenuControlCount = await focusableMenuControls.count();
  expect(focusableMenuControlCount, "The open admin mobile menu must contain focusable controls.").toBeGreaterThan(1);

  const firstMenuControl = focusableMenuControls.first();
  const lastMenuControl = focusableMenuControls.last();
  await firstMenuControl.focus();
  await expect(firstMenuControl).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(lastMenuControl, "Shift+Tab from the first admin-menu control must wrap to the last.").toBeFocused();
  await page.keyboard.press("Tab");
  await expect(firstMenuControl, "Tab from the last admin-menu control must wrap to the first.").toBeFocused();

  await page.keyboard.press("Escape");
  await expect(mobileMenu).toHaveCount(0);
  await expect(mobileMenuButton, "Escape must restore focus to the admin-menu toggle.").toBeFocused();
  expect(browserErrors, "The admin mobile keyboard journey must not produce browser errors.").toEqual([]);
});

test("a customer is redirected from every admin route without admin requests", async ({ page }) => {
  const customer = { ...admin, role: "CUSTOMER" as const };
  const adminRequests: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/admin/")) adminRequests.push(path);
    if (path === "/api/auth/me") {
      await route.fulfill({ json: { user: customer } });
      return;
    }
    await route.fulfill({ json: [] });
  });

  for (const path of PROTECTED_ADMIN_ROUTES) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/moj-nalog$/);
  }
  expect(adminRequests).toEqual([]);
});

test("admin salon, user, loyalty, subscription, and review actions show success", async ({ page }) => {
  await openAdminPage(page, "/admin/saloni");
  const salonToggle = page.getByTestId(`toggle-featured-${salonId}`);
  await salonToggle.click();
  await expect(page.getByText("Salon uspešno ažuriran", { exact: true })).toBeVisible();

  await page.goto("/admin/korisnici");
  await page.getByTestId(`toggle-active-${userId}`).click();
  await expect(page.getByText("Korisnik ažuriran", { exact: true })).toBeVisible();
  await page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId(`select-role-${userId}`).selectOption("ADMIN");
  await expect(page.getByText("Uloga promenjena", { exact: true })).toBeVisible();

  await page.goto("/admin/loyalty");
  await page.getByTestId(`btn-edit-${tierId}`).click();
  await page.getByRole("button", { name: "Sačuvaj" }).click();
  await expect(page.getByText("Sačuvano", { exact: true })).toBeVisible();

  await page.goto("/admin/pretplate");
  await page.getByTestId(`btn-edit-${planId}`).click();
  await page.getByRole("button", { name: "Sačuvaj" }).click();
  await expect(page.getByText("Sačuvano", { exact: true })).toBeVisible();

  await page.goto("/admin/recenzije");
  await page.getByTestId(`toggle-visibility-${reviewId}`).click();
  await expect(page.getByText("Recenzija ažurirana", { exact: true })).toBeVisible();
});

test("limited admins see protected user, loyalty, and subscription controls", async ({ page }) => {
  await openAdminPage(page, "/admin/korisnici", "ADMIN");
  await expect(page.getByTestId(`select-role-${userId}`)).toBeDisabled();
  await expect(page.getByTestId(`toggle-active-${userId}`)).toBeDisabled();

  await page.goto("/admin/loyalty");
  await expect(page.getByTestId("btn-new-tier")).toBeDisabled();
  await expect(page.getByTestId(`btn-edit-${tierId}`)).toBeDisabled();
  await expect(page.getByTestId(`btn-delete-${tierId}`)).toBeDisabled();

  await page.goto("/admin/pretplate");
  await expect(page.getByTestId("btn-new-plan")).toBeDisabled();
  await expect(page.getByTestId(`btn-edit-${planId}`)).toBeDisabled();
  await expect(page.getByTestId(`btn-delete-${planId}`)).toBeDisabled();
});

type UserFixture = {
  id: string;
  email: string;
  password: string;
};

const runsAgainstDisposableDatabase = process.env.LUMERA_ISOLATED_ADMIN_BROWSER_TEST === "1";

async function createUser(role: "SUPER_ADMIN" | "CUSTOMER", suffix: string): Promise<UserFixture> {
  const password = `admin-regression-${suffix}-password`;
  const [user] = await db.insert(usersTable).values({
    firstName: "Admin",
    lastName: "Regression",
    email: `admin-regression-${suffix}-${randomUUID()}@example.test`,
    passwordHash: await hashPassword(password),
    passwordSetAt: new Date(),
    role,
  }).returning();
  if (!user) throw new Error(`Could not create ${role} fixture.`);
  return { id: user.id, email: user.email, password };
}

async function login(page: Page, fixture: UserFixture) {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.email, password: fixture.password },
  });
  expect(response).toBeOK();
}

test("a customer cannot retrieve admin API data", async ({ page }) => {
  const customer = await createUser("CUSTOMER", "api-customer");
  try {
    await login(page, customer);
    for (const path of [
      "/api/admin/summary",
      "/api/admin/salons",
      "/api/admin/users",
      "/api/admin/loyalty-tiers",
      "/api/admin/subscription-plans",
      "/api/admin/reviews",
    ]) {
      expect((await page.request.get(path)).status(), path).toBe(403);
    }
  } finally {
    await db.delete(usersTable).where(eq(usersTable.id, customer.id));
  }
});

test.describe("admin checks requiring disposable data", () => {
  test.skip(!runsAgainstDisposableDatabase, "This safety check must only run through the isolated admin browser test harness.");

  test("the last active super administrator cannot be removed", async ({ page }) => {
    let first: UserFixture | undefined;
    let second: UserFixture | undefined;

    try {
      first = await createUser("SUPER_ADMIN", "first");
      second = await createUser("SUPER_ADMIN", "second");

      await login(page, first);
      const deactivateSecond = await page.request.patch(`/api/admin/users/${second.id}`, { data: { active: false } });
      expect(deactivateSecond.status()).toBe(200);

      const deactivateLast = await page.request.patch(`/api/admin/users/${first.id}`, { data: { active: false } });
      expect(deactivateLast.status()).toBe(409);
      await expect(deactivateLast.json()).resolves.toMatchObject({
        error: "Nije moguće ukloniti ili deaktivirati poslednjeg aktivnog super administratora.",
      });

      const demoteLast = await page.request.patch(`/api/admin/users/${first.id}`, { data: { role: "ADMIN" } });
      expect(demoteLast.status()).toBe(409);
    } finally {
      if (second) await db.delete(usersTable).where(eq(usersTable.id, second.id));
      if (first) await db.delete(usersTable).where(eq(usersTable.id, first.id));
    }
  });

  test("referenced subscription plans are archived instead of deleted", async ({ page }) => {
    let adminFixture: UserFixture | undefined;
    let owner: UserFixture | undefined;
    let salonIdForTest: string | undefined;
    let planIdForTest: string | undefined;
    try {
      adminFixture = await createUser("SUPER_ADMIN", "plan-owner");
      owner = await createUser("CUSTOMER", "salon-owner");

      const [salon] = await db.insert(salonsTable).values({
        ownerId: owner.id,
        name: `Admin plan regression ${randomUUID()}`,
        slug: `admin-plan-regression-${randomUUID()}`,
        city: "Beograd",
        municipality: "Vračar",
        address: "Test 1",
        phone: "+381110000001",
        email: `admin-plan-salon-${randomUUID()}@example.test`,
        shortDescription: "Test salon.",
        description: "Test salon for plan archival.",
        imageUrl: "/test.jpg",
      }).returning();
      if (!salon) throw new Error("Could not create salon fixture.");
      salonIdForTest = salon.id;

      const [plan] = await db.insert(subscriptionPlansTable).values({
        name: `Admin plan ${randomUUID()}`,
        price: 2500,
        trialDays: 7,
        features: ["Istorija"],
        limits: { employees: 3 },
      }).returning();
      if (!plan) throw new Error("Could not create plan fixture.");
      planIdForTest = plan.id;

      await db.insert(subscriptionsTable).values({
        salonId: salon.id,
        planId: plan.id,
        status: "active",
        dueAmount: 2500,
        paymentMethod: "BANK_TRANSFER",
      });

      await login(page, adminFixture);
      const response = await page.request.delete(`/api/admin/subscription-plans/${plan.id}`);
      expect(response.status()).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: plan.id, active: false });

      const [persisted] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, plan.id));
      expect(persisted?.active).toBe(false);
      const [history] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.planId, plan.id));
      expect(history?.id).toBeDefined();
    } finally {
      if (salonIdForTest) await db.delete(subscriptionsTable).where(eq(subscriptionsTable.salonId, salonIdForTest));
      if (planIdForTest) await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planIdForTest));
      if (salonIdForTest) await db.delete(salonsTable).where(eq(salonsTable.id, salonIdForTest));
      if (owner) await db.delete(usersTable).where(eq(usersTable.id, owner.id));
      if (adminFixture) await db.delete(usersTable).where(eq(usersTable.id, adminFixture.id));
    }
  });
});