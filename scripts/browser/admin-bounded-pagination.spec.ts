import { expect, test, type Page } from "@playwright/test";

const admin = {
  id: "00000000-0000-4000-8000-000000000811",
  firstName: "Admin",
  lastName: "Pagination",
  email: "admin-pagination@example.test",
  phone: null,
  dateOfBirth: null,
  role: "SUPER_ADMIN",
  active: true,
  mustChangePassword: false,
  marketingEmailsEnabled: false,
};

const order = (index: number) => ({
  id: `order-${index}`,
  status: "pending",
  fulfillmentStatus: "RECEIVED",
  paymentStatus: "unpaid",
  deliveryMethod: "courier",
  courierServiceId: null,
  courierService: null,
  trackingNumber: null,
  trackingUrl: null,
  total: 1000,
  subtotal: 1000,
  shippingCost: 0,
  totalWeightGrams: 100,
  couponCode: null,
  couponDiscountRsd: 0,
  couponFreeShipping: false,
  referralCreditMerchandiseSubtotalRsd: 0,
  referralCreditPreCreditPayableTotalRsd: 0,
  referralCreditAppliedRsd: 0,
  invoice: null,
  itemCount: 1,
  createdAt: "2026-09-03T08:00:00.000Z",
  updatedAt: "2026-09-03T08:00:00.000Z",
  salon: { id: `salon-${index}`, name: `Salon ${index}`, phone: "0600000000", email: "salon@example.test", address: "Test 1", city: "Beograd", postalCode: "11000" },
  delivery: { recipientName: "Primalac", address: "Test 1", city: "Beograd", postalCode: "11000", phone: "0600000000", note: null, usesSalonAddress: true },
  billing: null,
  items: [{ productId: `product-${index}`, bundleId: null, productName: "Proizvod", variantValue: null, variantLabel: null, productSku: `SKU-${index}`, quantity: 1, price: 1000 }],
  adminNote: null,
  history: [],
});

const user = (index: number) => ({
  id: `user-${index}`,
  firstName: "Korisnik",
  lastName: String(index),
  email: `user-${index}@example.test`,
  phone: null,
  role: "CUSTOMER",
  active: true,
  passwordSetAt: null,
  createdAt: "2026-09-03T08:00:00.000Z",
});

const salon = (index: number) => ({
  id: `salon-${index}`,
  name: `Salon ${index}`,
  slug: `salon-${index}`,
  city: "Beograd",
  active: true,
  featured: false,
  isVerified: false,
  topSalon: false,
  videoUrl: null,
  rating: 0,
  reviewCount: 0,
  subscriptionStatus: null,
  subscriptionPlan: null,
  loyaltyTier: null,
  loyaltySpend: 0,
  createdAt: "2026-09-03T08:00:00.000Z",
});

async function mockBoundedList(
  page: Page,
  endpoint: string,
  itemFactory: (index: number) => object,
) {
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: admin } }));
  await page.route(`**${endpoint}**`, async (route) => {
    const url = new URL(route.request().url());
    const requestedPage = Number(url.searchParams.get("page") ?? "1");
    await route.fulfill({
      json: {
        items: Array.from({ length: 50 }, (_, index) => itemFactory((requestedPage - 1) * 50 + index)),
        page: requestedPage,
        pageSize: 50,
        hasNext: requestedPage === 1,
      },
    });
  });
}

const cases = [
  { name: "orders", path: "/admin/porudzbine", endpoint: "/api/admin/orders/page", search: "input[placeholder='Salon, primalac, broj']", filter: "button:has-text('Svi statusi')", option: "Potvrđeno", filterParam: "status", filterValue: "confirmed", itemFactory: order },
  { name: "users", path: "/admin/korisnici", endpoint: "/api/admin/users/page", search: "[data-testid='input-search-users']", filter: "[data-testid='select-role-filter']", option: "Klijent", filterParam: "role", filterValue: "CUSTOMER", itemFactory: user },
  { name: "salons", path: "/admin/saloni", endpoint: "/api/admin/salons/page", search: "[data-testid='input-search-salons']", filter: "[data-testid='select-active-filter']", option: "Aktivni", filterParam: "active", filterValue: "true", itemFactory: salon },
] as const;

for (const testCase of cases) {
  test(`${testCase.name} trusts hasNext and resets pagination after search changes`, async ({ page }) => {
    await mockBoundedList(page, testCase.endpoint, testCase.itemFactory);
    await page.goto(testCase.path);

    const next = page.getByTestId("btn-next-page");
    await expect(next).toBeEnabled();
    await next.click();
    await expect(page.getByText("Strana 2", { exact: true })).toBeVisible();
    await expect(next).toBeDisabled();

    const firstPageRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname === testCase.endpoint
        && url.searchParams.get("page") === "1"
        && url.searchParams.get("search") === "novi filter";
    });
    await page.locator(testCase.search).fill("novi filter");
    await firstPageRequest;
    await expect(page.getByText("Strana 1", { exact: true })).toBeVisible();

    await next.click();
    await expect(page.getByText("Strana 2", { exact: true })).toBeVisible();
    const filteredFirstPageRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname === testCase.endpoint
        && url.searchParams.get("page") === "1"
        && url.searchParams.get(testCase.filterParam) === testCase.filterValue;
    });
    await page.locator(testCase.filter).click();
    await page.getByRole("option", { name: testCase.option, exact: true }).click();
    await filteredFirstPageRequest;
    await expect(page.getByText("Strana 1", { exact: true })).toBeVisible();
  });
}