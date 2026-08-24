import { expect, test, type Page } from "@playwright/test";

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    errors.push(`request: ${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "failed"}`);
  });
  page.on("response", (response) => {
    if (response.request().resourceType() === "document" && response.status() >= 400) {
      errors.push(`navigation: ${response.status()} ${response.url()}`);
    }
  });
  return errors;
}

test("customer mobile menu closes with Escape and restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: null } }));
  await page.route("**/api/retail/cart-summary", (route) => route.fulfill({ json: { itemCount: 0 } }));

  const browserErrors = collectBrowserErrors(page);
  await page.goto("/recnik");

  const mobileMenuButton = page.getByTestId("button-mobile-menu");
  const mobileMenu = page.getByText("Saloni", { exact: true }).last();
  await expect(mobileMenuButton).toHaveAttribute("aria-label", "Otvori meni");

  await mobileMenuButton.focus();
  await mobileMenuButton.press("Enter");
  await expect(mobileMenuButton).toHaveAttribute("aria-label", "Zatvori meni");
  await expect(mobileMenu).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(mobileMenuButton).toHaveAttribute("aria-label", "Otvori meni");
  await expect(mobileMenu).toBeHidden();
  await expect(mobileMenuButton).toBeFocused();

  await mobileMenuButton.press("Enter");
  await expect(mobileMenuButton).toHaveAttribute("aria-label", "Zatvori meni");
  await mobileMenuButton.click();
  await expect(mobileMenuButton).toHaveAttribute("aria-label", "Otvori meni");
  await expect(mobileMenu).toBeHidden();
  await expect(mobileMenuButton).toBeFocused();

  expect(browserErrors, "The customer mobile navigation journey must not produce browser errors.").toEqual([]);
});