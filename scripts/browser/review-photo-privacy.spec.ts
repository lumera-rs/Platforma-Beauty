import { expect, test } from "@playwright/test";

const salonPath = process.env.LUMERA_BOOKING_TEST_SALON_PATH ?? "/saloni/lotos-rituals";

test("salon review falls back to reviewer initials when the public API omits an avatar", async ({ page }) => {
  await page.route(`**/api/salons/${salonPath.split("/").pop()}`, async (route) => {
    const response = await route.fetch();
    const salon = await response.json() as { reviews?: unknown[] };
    await route.fulfill({
      response,
      json: {
        ...salon,
        reviews: [{
          id: "privacy-review-initials",
          authorName: "Pavle Privatni",
          avatarUrl: null,
          verifiedBooking: true,
          rating: 5,
          text: "Fotografija ostaje privatna.",
          date: "2024-01-10",
          serviceName: "Privatni tretman",
        }],
      },
    });
  });

  await page.goto(salonPath);

  const reviews = page.locator("#reviews");
  const privateReview = reviews.getByText("Fotografija ostaje privatna.").locator("..");
  await expect(privateReview).toContainText("Pavle Privatni");
  await expect(privateReview.getByText("PP", { exact: true })).toBeVisible();
  await expect(privateReview.locator("img")).toHaveCount(0);
});