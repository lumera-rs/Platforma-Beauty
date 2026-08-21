import { expect, test } from "@playwright/test";

test("the shared carousel renders discovery rows without a browser runtime crash", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: null } }));
  await page.route("**/api/platform/trust-stats", (route) =>
    route.fulfill({
      json: { activeSalons: 1, bookingsThisMonth: 1, customerAccounts: 1 },
    }),
  );
  await page.route("**/api/salons**", (route) => route.fulfill({ json: [] }));

  await page.goto("/");

  const carousel = page.getByRole("region", { name: "Popularne usluge" });
  await expect(carousel).toBeVisible();
  await expect(carousel.getByRole("group")).toHaveCount(6);

  const viewport = carousel.locator("[data-carousel-viewport]");
  const next = carousel.getByRole("button", { name: "Prikaži sledeće stavke" });
  await expect(next).toBeEnabled();
  await next.click();
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  expect(pageErrors, "The carousel must not trigger an ErrorBoundary or browser runtime error.").toEqual([]);
});