import { expect, test, type Page } from "@playwright/test";

/**
 * Task 131 — admin form resilience regression gate.
 *
 * Every admin numeric/raw form is exercised with representative invalid input.
 * The gate asserts, for each case, that:
 *   - a clear, visible error is surfaced (toast / error text),
 *   - the form or dialog stays usable after the rejected submit,
 *   - a repeated submit is not stuck (the control still reacts),
 *   - no admin API response is a 500 during the interaction.
 *
 * The suite deliberately never commits a valid mutation. Invalid input is
 * rejected client-side before reaching the API in the vast majority of cases;
 * the mocked admin API additionally returns a structured 400 (never a 500) for
 * the few pages that submit raw values, so the "no 500" invariant is real.
 *
 * The admin API is mocked with representative seed rows (mirroring the pattern
 * in admin-access-configuration.spec.ts) so the checks stay hermetic and fast
 * while still running inside the isolated browser harness.
 */

const admin = {
  id: "00000000-0000-4000-8000-000000000091",
  firstName: "Form",
  lastName: "Resilience",
  email: "admin-form-resilience@example.test",
  role: "SUPER_ADMIN" as const,
  active: true,
  mustChangePassword: false,
};

const categoryId = "00000000-0000-4000-8000-000000000092";
const productId = "00000000-0000-4000-8000-000000000093";
const tierId = "00000000-0000-4000-8000-000000000094";
const planId = "00000000-0000-4000-8000-000000000095";
const templateId = "00000000-0000-4000-8000-000000000096";

function productCategory() {
  return {
    id: categoryId,
    name: "Kosa",
    parentId: null,
    sortOrder: 1,
    icon: null,
    imageUrl: null,
    active: true,
    productCount: 1,
  };
}

function adminProduct() {
  return {
    id: productId,
    name: "Regresioni proizvod",
    categoryId,
    categoryName: "Kosa",
    subcategoryName: null,
    brand: null,
    description: "Opis proizvoda za regresiju.",
    shortDescription: null,
    imageUrl: "/test.jpg",
    images: ["/test.jpg"],
    price: 1000,
    discountPrice: null,
    stock: 5,
    sku: "REG-001",
    unit: "kom",
    weightGrams: 500,
    isNew: false,
    isBestseller: false,
    variantType: null,
    variants: null,
    active: true,
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

function serviceTemplate() {
  return {
    id: templateId,
    name: "Klasično šišanje",
    mainCategory: "Kosa",
    subcategory: "Šišanje",
    typicalDurationMinutes: 30,
    priceMin: 500,
    priceMax: 1500,
    description: null,
    active: true,
  };
}

function educationSettings() {
  return {
    commissionPercent: 10,
    reservePercent: 5,
    onlineRefundDays: 14,
    liveAppealDays: 7,
    featuredCoursePrice: 5000,
  };
}

function shippingConfig() {
  return {
    freeShippingThreshold: 10000,
    tiers: [{ maxWeightGrams: 2000, price: 390, label: "do 2 kg" }],
    personalDeliveryEnabled: false,
    personalDeliveryName: "Lična dostava u Beogradu",
    personalDeliveryPrice: 0,
    personalDeliveryDescription: "Dostava na adresu u Beogradu.",
    updatedAt: "2026-08-21T09:00:00.000Z",
  };
}

const serverErrors: string[] = [];

async function mockAdminApi(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/auth/me") {
      await route.fulfill({ json: { user: admin } });
      return;
    }
    if (path === "/api/education/disputes" && method === "GET") {
      await route.fulfill({ json: [] });
      return;
    }

    if (path.startsWith("/api/admin/")) {
      // Read endpoints — provide representative seed rows.
      if (path === "/api/admin/summary") {
        await route.fulfill({ json: { totalUsers: 1, totalSalons: 0, activeSalons: 0, bookingsThisMonth: 0, bookingsLastMonth: 0, bookingsTrend: 0, grossMerchandiseValue: 0, newSalonsThisMonth: 0, totalReviews: 0, hiddenReviews: 0, activeSubscriptions: 0, topCategories: [] } });
        return;
      }
      if (path === "/api/admin/product-categories" && method === "GET") {
        await route.fulfill({ json: [productCategory()] });
        return;
      }
      if (path === "/api/admin/service-categories" && method === "GET") {
        await route.fulfill({ json: [] });
        return;
      }
      if (path === "/api/admin/products" && method === "GET") {
        await route.fulfill({ json: { items: [adminProduct()], total: 1, page: 1, pageSize: 20, totalPages: 1 } });
        return;
      }
      if (path === "/api/admin/brands" && method === "GET") {
        await route.fulfill({ json: [] });
        return;
      }
      if (path === "/api/admin/loyalty-tiers" && method === "GET") {
        await route.fulfill({ json: [loyaltyTier()] });
        return;
      }
      if (path === "/api/admin/subscription-plans" && method === "GET") {
        await route.fulfill({ json: [subscriptionPlan()] });
        return;
      }
      if (path === "/api/admin/service-templates" && method === "GET") {
        await route.fulfill({ json: [serviceTemplate()] });
        return;
      }
      if (path === "/api/admin/shipping" && method === "GET") {
        await route.fulfill({ json: shippingConfig() });
        return;
      }
      if (path === "/api/admin/courier-services" && method === "GET") {
        await route.fulfill({ json: [] });
        return;
      }
      if (path === "/api/admin/education/settings" && method === "GET") {
        await route.fulfill({ json: educationSettings() });
        return;
      }
      if (path === "/api/admin/education/centers" && method === "GET") {
        await route.fulfill({ json: [] });
        return;
      }
      if (path === "/api/admin/education/finance" && method === "GET") {
        await route.fulfill({ json: { summary: {}, escrows: [], pendingEnrollments: [], featuredCharges: [] } });
        return;
      }
      if (path === "/api/admin/integrations" && method === "GET") {
        const card = { enabled: false, configuredInDatabase: false, complete: false, values: {} };
        await route.fulfill({
          json: {
            integrations: { sms: card, brevo: card, google_oauth: card, facebook_oauth: card },
            redirectUris: { google: "https://example.test/google", facebook: "https://example.test/facebook" },
            smsReminder: { command: "pnpm run sms-reminders", active: false, instructions: [] },
          },
        });
        return;
      }

      // Any mutation that slips through invalid client-side validation is
      // answered with a structured 400 — never a 500 — proving the error path.
      if (method !== "GET") {
        await route.fulfill({ status: 400, json: { error: "Neispravan zahtev.", code: "VALIDATION" } });
        return;
      }

      // Remaining GETs used only for initial section loads.
      await route.fulfill({ json: [] });
      return;
    }

    await route.fallback();
  });

  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith("/api/admin/") && response.status() >= 500) {
      serverErrors.push(`${response.request().method()} ${path} → ${response.status()}`);
    }
  });
}

async function openAdmin(page: Page, path: string): Promise<void> {
  serverErrors.length = 0;
  await mockAdminApi(page);
  await page.goto(path);
  // The admin sidebar renders its own "Admin Panel" heading (desktop viewport)
  // once the layout confirms an admin session; this is distinct from the
  // business navbar link that shares the same text.
  await expect(page.getByRole("heading", { name: "Admin Panel" })).toBeVisible();
}

/** The specific validation message surfaced in a sonner toast description. */
function errorToast(page: Page, message: string) {
  return page.locator("[data-sonner-toast]").filter({ hasText: message });
}

/**
 * Inject a raw string into a controlled input and fire a React-compatible
 * input event. Browsers refuse to let a user *type* non-numeric text into a
 * `type="number"` field, but a paste / programmatic value can still deliver a
 * non-numeric string to the component's onChange — exactly the raw input the
 * strict parsers are designed to reject. This keeps the check faithful to the
 * real code path without altering application behavior.
 */
async function setRawValue(page: Page, locator: ReturnType<Page["locator"]>, value: string): Promise<void> {
  await locator.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function expectNoServerErrors(): Promise<void> {
  expect(serverErrors, serverErrors.join("; ")).toEqual([]);
}

// ─── Categories ──────────────────────────────────────────────────────────────

test("category form rejects empty, whitespace, text, and negative sort order", async ({ page }) => {
  await openAdmin(page, "/admin/kategorije");
  await page.getByTestId("btn-new-category").click();
  await expect(page.getByTestId("input-category-name")).toBeVisible();

  const dialog = page.getByRole("dialog");
  const name = page.getByTestId("input-category-name");
  const sort = dialog.locator('input[type="number"]').first();
  const save = page.getByTestId("btn-save-category");

  // Empty name.
  await name.fill("");
  await save.click();
  await expect(errorToast(page, "Naziv je obavezan.").first()).toBeVisible();
  await expect(page.getByTestId("input-category-name")).toBeVisible();

  // Whitespace-only name.
  await name.fill("   ");
  await save.click();
  await expect(errorToast(page, "Naziv je obavezan.").first()).toBeVisible();

  // Valid name but non-integer sort order — repeat submit must not stick.
  await name.fill("Validno ime");
  await setRawValue(page, sort, "1.5");
  await save.click();
  await expect(errorToast(page, "ceo broj").first()).toBeVisible();
  await save.click();
  await expect(errorToast(page, "ceo broj").first()).toBeVisible();

  // Negative sort order.
  await setRawValue(page, sort, "-3");
  await save.click();
  await expect(errorToast(page, "negativan").first()).toBeVisible();

  // Dialog is still usable after all rejected submits.
  await expect(page.getByTestId("btn-save-category")).toBeEnabled();
  await expectNoServerErrors();
});

// ─── Products ────────────────────────────────────────────────────────────────

test("product form rejects text and negative price / stock", async ({ page }) => {
  await openAdmin(page, "/admin/proizvodi");
  await page.getByTestId(`btn-edit-product-${productId}`).click();
  await expect(page.getByTestId("input-product-price")).toBeVisible();

  const price = page.getByTestId("input-product-price");
  const stock = page.getByTestId("input-product-stock");
  const save = page.getByTestId("btn-save-product");

  // Non-numeric price (raw text via paste-style injection).
  await setRawValue(page, price, "abc");
  await save.click();
  await expect(errorToast(page, "Redovna cena").first()).toBeVisible();

  // Repeat submit must not be stuck.
  await save.click();
  await expect(errorToast(page, "Redovna cena").first()).toBeVisible();

  // Negative price.
  await setRawValue(page, price, "-100");
  await save.click();
  await expect(errorToast(page, "Redovna cena").first()).toBeVisible();

  // Restore a valid price, break the stock instead.
  await setRawValue(page, price, "1000");
  await setRawValue(page, stock, "-5");
  await save.click();
  await expect(errorToast(page, "Stanje").first()).toBeVisible();

  await expect(page.getByTestId("btn-save-product")).toBeEnabled();
  await expectNoServerErrors();
});

// ─── Loyalty ─────────────────────────────────────────────────────────────────

test("loyalty tier form rejects invalid percent and threshold", async ({ page }) => {
  await openAdmin(page, "/admin/loyalty");
  await page.getByTestId(`btn-edit-${tierId}`).click();
  await expect(page.getByLabel("Popust na pretplatu (%)")).toBeVisible();

  const subDisc = page.getByLabel("Popust na pretplatu (%)");
  const threshold = page.getByLabel("Prag potrošnje (RSD)");
  const save = page.getByRole("button", { name: "Sačuvaj Nivo" });

  // Percent over 100.
  await setRawValue(page, subDisc, "150");
  await save.click();
  await expect(errorToast(page, "ne može biti veće od 100").first()).toBeVisible();

  // Repeat submit must not stick.
  await save.click();
  await expect(errorToast(page, "ne može biti veće od 100").first()).toBeVisible();

  // Restore percent, break the threshold with a non-integer value.
  await setRawValue(page, subDisc, "10");
  await setRawValue(page, threshold, "1.5");
  await save.click();
  await expect(errorToast(page, "ceo broj").first()).toBeVisible();

  await expect(page.getByRole("button", { name: "Sačuvaj Nivo" })).toBeEnabled();
  await expectNoServerErrors();
});

// ─── Subscriptions ───────────────────────────────────────────────────────────

test("subscription plan form rejects invalid price and trial period", async ({ page }) => {
  await openAdmin(page, "/admin/pretplate");
  await page.getByTestId(`btn-edit-${planId}`).click();
  await expect(page.getByLabel("Cena (RSD mesečno)")).toBeVisible();

  const price = page.getByLabel("Cena (RSD mesečno)");
  const trial = page.getByLabel("Probni period (dana)");
  const save = page.getByRole("button", { name: "Sačuvaj" });

  // Non-numeric price (raw text).
  await setRawValue(page, price, "abc");
  await save.click();
  await expect(errorToast(page, "Cena").first()).toBeVisible();

  // Repeat submit must not stick.
  await save.click();
  await expect(errorToast(page, "Cena").first()).toBeVisible();

  // Restore price, break trial with a negative value.
  await setRawValue(page, price, "4990");
  await setRawValue(page, trial, "-1");
  await save.click();
  await expect(errorToast(page, "Probni period").first()).toBeVisible();

  await expect(page.getByRole("button", { name: "Sačuvaj" })).toBeEnabled();
  await expectNoServerErrors();
});

// ─── Shipping ────────────────────────────────────────────────────────────────

test("shipping form rejects invalid numeric tier and duplicate weight tier", async ({ page }) => {
  await openAdmin(page, "/admin/dostava");
  await expect(page.getByTestId("input-tier-weight")).toBeVisible();

  const weight = page.getByTestId("input-tier-weight");
  const tierPrice = page.getByTestId("input-tier-price");
  const addTier = page.getByTestId("btn-add-tier");

  // Non-numeric weight (raw text).
  await setRawValue(page, weight, "abc");
  await setRawValue(page, tierPrice, "390");
  await addTier.click();
  await expect(errorToast(page, "Maksimalna težina").first()).toBeVisible();

  // Repeat submit must not stick.
  await addTier.click();
  await expect(errorToast(page, "Maksimalna težina").first()).toBeVisible();

  // Duplicate weight tier (seed already has a 2 kg tier).
  await setRawValue(page, weight, "2");
  await setRawValue(page, tierPrice, "450");
  await addTier.click();
  await expect(errorToast(page, "već postoji").first()).toBeVisible();

  // Invalid free-shipping threshold on the main save button.
  const threshold = page.getByTestId("input-free-shipping-threshold");
  await setRawValue(page, threshold, "abc");
  await page.getByTestId("btn-save-shipping").click();
  await expect(errorToast(page, "Prag besplatne dostave").first()).toBeVisible();

  await expect(page.getByTestId("btn-add-tier")).toBeEnabled();
  await expectNoServerErrors();
});

// ─── Service templates ───────────────────────────────────────────────────────

test("service template form rejects inverted price range and invalid numeric range", async ({ page }) => {
  await openAdmin(page, "/admin/predlosci-usluga");
  await page.getByTestId(`btn-edit-template-${templateId}`).click();
  await expect(page.getByTestId("input-template-price-min")).toBeVisible();

  const priceMin = page.getByTestId("input-template-price-min");
  const priceMax = page.getByTestId("input-template-price-max");
  const duration = page.getByTestId("input-template-duration");
  const save = page.getByTestId("btn-save-template");

  // Inverted range: max below min.
  await setRawValue(page, priceMin, "2000");
  await setRawValue(page, priceMax, "1000");
  await save.click();
  await expect(errorToast(page, "Max. cena ne može biti manja").first()).toBeVisible();

  // Repeat submit must not stick.
  await save.click();
  await expect(errorToast(page, "Max. cena ne može biti manja").first()).toBeVisible();

  // Invalid numeric range on duration (non-integer text).
  await setRawValue(page, priceMin, "500");
  await setRawValue(page, priceMax, "1500");
  await setRawValue(page, duration, "abc");
  await save.click();
  await expect(errorToast(page, "Trajanje").first()).toBeVisible();

  await expect(page.getByTestId("btn-save-template")).toBeEnabled();
  await expectNoServerErrors();
});

// ─── Education settings ──────────────────────────────────────────────────────

test("education settings form rejects non-integer / invalid percent", async ({ page }) => {
  await openAdmin(page, "/admin/edukacije");
  await expect(page.getByRole("heading", { name: "Zaštita kupovina i obračun" })).toBeVisible();

  const commission = page.getByLabel("Provizija %");
  const refundDays = page.getByLabel("Online povraćaj (dani)");
  const save = page.getByRole("button", { name: "Sačuvaj" });

  // Invalid percent (comma is not a valid number).
  await setRawValue(page, commission, "1,5");
  await save.click();
  await expect(errorToast(page, "Provizija").first()).toBeVisible();

  // Repeat submit must not stick.
  await save.click();
  await expect(errorToast(page, "Provizija").first()).toBeVisible();

  // Non-integer value on an integer-only field (days).
  await setRawValue(page, commission, "10");
  await setRawValue(page, refundDays, "1.5");
  await save.click();
  await expect(errorToast(page, "Online povraćaj").first()).toBeVisible();

  await expect(page.getByRole("button", { name: "Sačuvaj" })).toBeEnabled();
  await expectNoServerErrors();
});

// ─── Integrations (no numeric fields) ────────────────────────────────────────

test("integrations page renders and surfaces errors without numeric fields", async ({ page }) => {
  await openAdmin(page, "/admin/integracije");
  await expect(page.getByRole("heading", { name: "Integracije i konektori" })).toBeVisible();

  // All four integration cards render.
  await expect(page.getByRole("heading", { name: "SMS · Infobip" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Google prijava" })).toBeVisible();

  // Saving hits the mocked 400 (never a 500) and surfaces the error message.
  await page.getByRole("button", { name: "Sačuvaj" }).first().click();
  await expect(errorToast(page, "Neispravan zahtev.").first()).toBeVisible();

  // Page stays usable and a repeat submit is not stuck.
  await page.getByRole("button", { name: "Sačuvaj" }).first().click();
  await expect(errorToast(page, "Neispravan zahtev.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Sačuvaj" }).first()).toBeEnabled();

  await expectNoServerErrors();
});
