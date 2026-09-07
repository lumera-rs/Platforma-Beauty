import { expect, test, type Page } from "@playwright/test";
import * as apiSchemas from "../../lib/api-zod/src/generated/api";
import { adminSummaryFixture, checkedApiFixture } from "../src/browser-api-fixtures";

const roles = ["ADMIN", "SUPER_ADMIN"] as const;

async function mockAuthenticatedAdmin(page: Page, role: (typeof roles)[number]) {
  let loggedIn = true;
  const user = {
    id: role === "ADMIN"
      ? "00000000-0000-4000-8000-000000000071"
      : "00000000-0000-4000-8000-000000000072",
    firstName: role === "ADMIN" ? "Admin" : "Super",
    lastName: "Navigation",
    email: `${role.toLowerCase().replace("_", "-")}-navigation@example.test`,
    phone: null,
    dateOfBirth: null,
    role,
    active: true,
    mustChangePassword: false,
    marketingEmailsEnabled: false,
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/auth/me") {
      await route.fulfill({
        json: checkedApiFixture("/api/auth/me", apiSchemas.GetCurrentUserResponse, {
          user: loggedIn ? user : null,
        }),
      });
      return;
    }
    if (path === "/api/auth/logout" && request.method() === "POST") {
      loggedIn = false;
      await route.fulfill({ status: 204 });
      return;
    }
    if (path === "/api/admin/summary") {
      await route.fulfill({
        json: adminSummaryFixture(apiSchemas.GetAdminSummaryResponse),
      });
      return;
    }
    if (path === "/api/growth/admin/summary") {
      await route.fulfill({
        json: checkedApiFixture(
          "/api/growth/admin/summary",
          apiSchemas.AdminGetGrowthSummaryResponse,
          {
            automation: { totalRules: 0, activeRules: 0, byStatus: {} },
            packages: { total: 0, active: 0 },
            purchases: { total: 0, active: 0, pendingPayment: 0 },
          },
        ),
      });
      return;
    }
    if (path === "/api/education/disputes") {
      await route.fulfill({
        json: checkedApiFixture(
          "/api/education/disputes",
          apiSchemas.ListEducationDisputesResponse,
          [],
        ),
      });
      return;
    }
    if (path === "/api/commerce/header-bar") {
      await route.fulfill({
        json: checkedApiFixture(
          "/api/commerce/header-bar",
          apiSchemas.GetCommerceHeaderBarResponse,
          { enabled: false, messages: [], intervalSeconds: 5 },
        ),
      });
      return;
    }

    throw new Error(`Unregistered admin navigation API fixture: ${request.method()} ${path}`);
  });
}

for (const role of roles) {
  test(`${role} sees one mobile admin menu with Admin, Market, Education, and logout actions`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockAuthenticatedAdmin(page, role);
    await page.goto("/admin");

    const menuTrigger = page.getByTestId("admin-mobile-menu-trigger");
    await expect(menuTrigger).toBeVisible();
    await expect(page.getByTestId("button-mobile-menu")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Otvori meni" })).toHaveCount(1);

    await menuTrigger.click();
    const mobileMenu = page.getByTestId("admin-mobile-menu");
    await expect(mobileMenu.getByTestId("admin-nav-dashboard")).toHaveAttribute("href", "/admin");
    await expect(mobileMenu.getByRole("link", { name: "Nazad na Market" })).toHaveAttribute("href", "/");
    await expect(mobileMenu.getByRole("link", { name: "Katalog edukacija" })).toHaveAttribute("href", "/biznis/edukacije");
    await expect(mobileMenu.getByRole("button", { name: "Odjavi se" })).toBeVisible();

    await mobileMenu.getByRole("link", { name: "Katalog edukacija" }).click();
    await expect(page).toHaveURL(/\/biznis\/edukacije$/);
    await page.goto("/admin");
    await page.getByTestId("admin-mobile-menu-trigger").click();
    await page.getByTestId("admin-mobile-menu").getByRole("button", { name: "Odjavi se" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test(`${role} sees one grouped desktop sidebar without global admin duplicates`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 844 });
    await mockAuthenticatedAdmin(page, role);
    await page.goto("/admin");

    const sidebar = page.locator("aside");
    await expect(sidebar.getByRole("navigation", { name: "Admin navigacija" })).toBeVisible();
    for (const group of [
      "Osnovno",
      "Edukacije i programi",
      "Katalog i prodavnica",
      "Porudžbine i podrška",
      "Marketing i sadržaj",
      "Podešavanja",
    ]) {
      await expect(sidebar.getByRole("heading", { name: group })).toBeVisible();
    }

    await expect(sidebar.getByTestId("admin-nav-dashboard")).toHaveCount(1);
    await expect(page.locator("nav.sticky").locator('a[href^="/admin"]:visible')).toHaveCount(0);
    await expect(page.getByTestId("admin-mobile-menu-trigger")).toBeHidden();
    await expect(page.getByTestId("button-mobile-menu")).toHaveCount(0);
  });
}