import { expect, test, type Page } from "@playwright/test";

const instructorId = "00000000-0000-4000-8000-000000000621";
const portfolioMedia = [
  "https://images.example.test/portfolio-one.jpg",
  "https://images.example.test/portfolio-two.jpg",
];

async function mockAnonymousInstructorProfile(page: Page) {
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: null } }));
  await page.route(`**/api/education/instructors/${instructorId}/public`, (route) => route.fulfill({
    json: {
      id: instructorId,
      name: "Ana Edukator",
      photoUrl: null,
      biography: "Profesionalna edukatorka.",
      industryYears: 10,
      experienceYears: 6,
      specializations: ["Nail art"],
      qualifications: ["Master sertifikat"],
      portfolioMedia,
      rating: 4.5,
      reviewCount: 2,
      ratingSource: "published_course_reviews",
      participantCount: 18,
      courses: [],
    },
  }));
}

async function assertPublicInstructorProfile(page: Page) {
  await expect(page.getByRole("heading", { name: "Ana Edukator" })).toBeVisible();
  await expect(page.getByText("4.5 (2 recenzije)")).toBeVisible();
  await expect(page.getByText("Ocena je izračunata iz objavljenih recenzija javnih kurseva ovog instruktora.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  const portfolioLinks = page.getByRole("link", { name: /Otvori portfolio rad/ });
  await expect(portfolioLinks).toHaveCount(portfolioMedia.length);
  await expect(portfolioLinks.nth(0)).toHaveAttribute("href", portfolioMedia[0]);
  await expect(portfolioLinks.nth(1)).toHaveAttribute("href", portfolioMedia[1]);
}

test("anonymous desktop visitor sees the complete instructor portfolio and honest rating source", async ({ page }) => {
  await mockAnonymousInstructorProfile(page);
  await page.goto(`/edukacije/instruktori/${instructorId}`);
  await assertPublicInstructorProfile(page);
});

test("anonymous mobile visitor sees the complete instructor portfolio and honest rating source", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAnonymousInstructorProfile(page);
  await page.goto(`/edukacije/instruktori/${instructorId}`);
  await assertPublicInstructorProfile(page);
});