import { expect, test } from "@playwright/test";

const publicFilters = [
  { label: "Samo popusti", parameter: "discountsOnly", value: "true" },
  { label: "Saloni za muškarce", parameter: "gender", value: "men" },
  { label: "Prima platne kartice", parameter: "acceptsCards", value: "true" },
  { label: "Otvoren nedeljom", parameter: "openSunday", value: "true" },
  { label: "Instant zakazivanje", parameter: "instantBooking", value: "true" },
  { label: "Dolazak na adresu", parameter: "homeService", value: "true" },
  { label: "Top Salon", parameter: "topSalon", value: "true" },
  { label: "Istaknuti saloni", parameter: "featured", value: "true" },
] as const;

test("clearing public salon filters omits only the cleared parameter", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: null } }));
  await page.route("**/api/salons**", (route) => route.fulfill({ json: [] }));

  await page.goto("/saloni");

  const filters = page.locator("aside");
  await expect(filters).toBeVisible();

  const requestMatchesFilters = (url: URL, enabledParameters: ReadonlyMap<string, string>) =>
    url.pathname === "/api/salons"
    && publicFilters.every(({ parameter, value }) =>
      enabledParameters.has(parameter)
        ? url.searchParams.get(parameter) === value
        : !url.searchParams.has(parameter),
    );

  const waitForSalonResponse = (enabledParameters: ReadonlyMap<string, string>) =>
    page.waitForResponse((response) => {
      const request = response.request();
      return request.method() === "GET"
        && requestMatchesFilters(new URL(response.url()), enabledParameters);
    });

  const enabledParameters = new Map<string, string>();

  for (const { label, parameter, value } of publicFilters) {
    const checkbox = filters.locator("label").filter({ hasText: label }).locator('input[type="checkbox"]');
    await expect(checkbox).toHaveCount(1);

    enabledParameters.set(parameter, value);
    const filteredResponse = waitForSalonResponse(enabledParameters);
    await checkbox.check();

    expect((await filteredResponse).ok()).toBeTruthy();
    await expect(checkbox).toBeChecked();
  }

  for (const { label, parameter } of publicFilters) {
    const checkbox = filters.locator("label").filter({ hasText: label }).locator('input[type="checkbox"]');
    enabledParameters.delete(parameter);
    const clearedResponse = waitForSalonResponse(enabledParameters);
    await checkbox.uncheck();

    expect((await clearedResponse).ok()).toBeTruthy();
    await expect(checkbox).not.toBeChecked();
    await expect(page.getByText("Nema rezultata", { exact: true })).toBeVisible();
  }
});