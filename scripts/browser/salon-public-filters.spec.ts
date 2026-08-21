import { expect, test } from "@playwright/test";

const publicFilters = [
  { label: "Samo popusti", parameter: "discountsOnly" },
  { label: "Otvoren nedeljom", parameter: "openSunday" },
  { label: "Top Salon", parameter: "topSalon" },
  { label: "Istaknuti saloni", parameter: "featured" },
] as const;

test("public salon filters send their boolean query parameters", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: null } }));
  await page.route("**/api/salons**", (route) => route.fulfill({ json: [] }));

  await page.goto("/saloni");

  const filters = page.locator("aside");
  await expect(filters).toBeVisible();

  for (const { label, parameter } of publicFilters) {
    const checkbox = filters.locator("label").filter({ hasText: label }).locator('input[type="checkbox"]');
    await expect(checkbox).toHaveCount(1);

    const filteredRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return request.method() === "GET"
        && url.pathname === "/api/salons"
        && url.searchParams.get(parameter) === "true";
    });
    await checkbox.check();

    const request = await filteredRequest;
    expect(new URL(request.url()).searchParams.get(parameter)).toBe("true");
    await expect(checkbox).toBeChecked();
  }
});