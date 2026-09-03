import { expect, test, type Page } from "@playwright/test";

const admin = {
  id: "00000000-0000-4000-8000-000000000071",
  firstName: "Test",
  lastName: "Administrator",
  email: "admin-salon-designations@example.test",
  role: "ADMIN",
  active: true,
  mustChangePassword: false,
};

const salonId = "00000000-0000-4000-8000-000000000072";

async function mockAdminSalonScreen(page: Page) {
  let patchCount = 0;
  let nextPatchHold: Promise<void> | null = null;
  let salon = {
    id: salonId,
    name: "Izolovani test salon",
    slug: "izolovani-test-salon",
    city: "Beograd",
    active: true,
    featured: false,
    isVerified: true,
    topSalon: false,
    videoUrl: null,
    rating: 4.8,
    reviewCount: 12,
    subscriptionStatus: null,
    subscriptionPlan: null,
    loyaltyTier: null,
    loyaltySpend: 0,
    createdAt: "2026-08-21T09:00:00.000Z",
  };

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({ json: { user: admin } });
  });

  await page.route("**/api/admin/salons**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ json: [salon] });
      return;
    }

    if (request.method() === "PATCH") {
      patchCount += 1;
      const hold = nextPatchHold;
      nextPatchHold = null;
      if (hold) await hold;
      salon = { ...salon, ...request.postDataJSON() };
      await route.fulfill({ json: salon });
      return;
    }

    await route.fallback();
  });

  await page.goto("/admin/saloni");
  return {
    getPatchCount: () => patchCount,
    holdNextPatch: () => {
      let release: () => void = () => undefined;
      nextPatchHold = new Promise<void>((resolve) => { release = resolve; });
      return release;
    },
  };
}

test("featured and Top Salon controls update their own fields", async ({ page }) => {
  await mockAdminSalonScreen(page);

  const featuredToggle = page.getByTestId(`toggle-featured-${salonId}`);
  const topSalonToggle = page.getByTestId(`toggle-top-salon-${salonId}`);
  await expect(featuredToggle).toHaveAttribute("data-state", "unchecked");
  await expect(topSalonToggle).toHaveAttribute("data-state", "unchecked");

  const featureRequest = page.waitForRequest((request) =>
    request.method() === "PATCH"
    && new URL(request.url()).pathname === `/api/admin/salons/${salonId}`,
  );
  await featuredToggle.click();
  expect((await featureRequest).postDataJSON()).toEqual({ featured: true });
  await expect(featuredToggle).toHaveAttribute("data-state", "checked");
  await expect(topSalonToggle).toHaveAttribute("data-state", "unchecked");

  const topSalonRequest = page.waitForRequest((request) =>
    request.method() === "PATCH"
    && new URL(request.url()).pathname === `/api/admin/salons/${salonId}`,
  );
  await topSalonToggle.click();
  expect((await topSalonRequest).postDataJSON()).toEqual({ topSalon: true });
  await expect(featuredToggle).toHaveAttribute("data-state", "checked");
  await expect(topSalonToggle).toHaveAttribute("data-state", "checked");
});

test("a rapid featured toggle sends one update and stays disabled while pending", async ({ page }) => {
  const screen = await mockAdminSalonScreen(page);
  const featuredToggle = page.getByTestId(`toggle-featured-${salonId}`);
  const release = screen.holdNextPatch();

  await featuredToggle.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

  await expect.poll(screen.getPatchCount).toBe(1);
  await expect(featuredToggle).toBeDisabled();
  release();
});