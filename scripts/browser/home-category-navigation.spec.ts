import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

type PublicCategory = {
  slug: string;
  path: string;
  apiCategory: string;
  label: string;
  h1: string;
};

const publicCategories = JSON.parse(
  readFileSync(new URL("../../artifacts/beauty-marketplace/src/lib/public-category-pages.json", import.meta.url), "utf8"),
) as PublicCategory[];

const nonSeoCategories = [
  "Kozmetički saloni",
  "Depilacija",
  "Wellness",
] as const;

test("homepage category choices navigate to the intended salon results", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: null } }));
  await page.route("**/api/platform/trust-stats", (route) =>
    route.fulfill({
      json: { activeSalons: 1, bookingsThisMonth: 1, customerAccounts: 1 },
    }),
  );
  await page.route("**/api/cities", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/discovery/home**", (route) =>
    route.fulfill({
      json: {
        popularServices: [],
        featuredSalons: [],
        discountedSalons: [],
        newSalons: [],
        popularSalons: [],
        topRatedSalons: [],
      },
    }),
  );
  await page.route("**/api/salons**", (route) => route.fulfill({ json: [] }));

  const selector = page.locator('select[aria-label="Izaberite kategoriju"]');
  const expectedCategories = [...publicCategories.map((category) => category.apiCategory), ...nonSeoCategories];

  await page.goto("/");
  await expect(selector).toBeVisible();
  await expect(selector.locator("option")).toHaveCount(expectedCategories.length + 1);

  for (const category of publicCategories) {
    await page.goto("/");
    await expect(selector).toBeVisible();
    await expect(selector.locator("option", { hasText: category.apiCategory })).toHaveCount(1);

    const salonRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return request.method() === "GET"
        && url.pathname === "/api/salons"
        && url.searchParams.get("category") === category.apiCategory;
    });

    await selector.selectOption({ label: category.apiCategory });
    await page.getByRole("button", { name: "Pronađi" }).click();

    await expect(page).toHaveURL(new URL(category.path, page.url()).toString());
    await expect(page.getByRole("heading", { name: category.h1 })).toBeVisible();
    await salonRequest;
  }

  for (const category of nonSeoCategories) {
    await page.goto("/");
    await expect(selector).toBeVisible();

    const salonRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return request.method() === "GET"
        && url.pathname === "/api/salons"
        && url.searchParams.get("category") === category;
    });

    await selector.selectOption({ label: category });
    await page.getByRole("button", { name: "Pronađi" }).click();

    await expect.poll(() => {
      const url = new URL(page.url());
      return url.pathname === "/saloni" && url.searchParams.get("category") === category;
    }).toBe(true);
    await expect(page.getByRole("heading", { name: "Istražite salone" })).toBeVisible();
    await salonRequest;
  }
});