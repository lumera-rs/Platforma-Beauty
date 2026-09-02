import { expect, test } from "@playwright/test";

const listingId = "browser-beauty-jobs-listing";
const contactId = "browser-beauty-jobs-contact";
const target = `/moji-oglasi?listingId=${listingId}&contactId=${contactId}#conversation`;

test("customer and business social buttons preserve the Beauty Poslovi return target", async ({ page }) => {
  const starts: URL[] = [];
  await page.route("**/api/auth/oauth/*/start**", async (route) => {
    starts.push(new URL(route.request().url()));
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>provider test double</title>",
    });
  });

  await page.goto(`/prijava?returnTo=${encodeURIComponent(target)}`);
  await page.getByRole("button", { name: "Nastavite preko Google naloga" }).click();
  await expect.poll(() => starts.length).toBe(1);
  expect(starts[0]!.pathname).toBe("/api/auth/oauth/google/start");
  expect(starts[0]!.searchParams.get("flow")).toBe("customer");
  expect(starts[0]!.searchParams.get("returnTo")).toBe(target);

  await page.goto(`/poslovna-prijava?returnTo=${encodeURIComponent(target)}`);
  await page.getByRole("button", { name: "Facebook" }).click();
  await expect.poll(() => starts.length).toBe(2);
  expect(starts[1]!.pathname).toBe("/api/auth/oauth/facebook/start");
  expect(starts[1]!.searchParams.get("flow")).toBe("business");
  expect(starts[1]!.searchParams.get("returnTo")).toBe(target);
});