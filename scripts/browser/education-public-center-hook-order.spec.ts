/**
 * Task #9C: EducationPublicCenterPage Rules-of-Hooks regression.
 *
 * Root cause (traced, not blind-fixed): EducationPublicCenterPage
 * (education-marketplace.tsx) called useState(1) (review page) and
 * useListPublicEducationCenterReviews(...) AFTER two conditional early
 * returns (`if (isLoading) return ...`, `if (isError || !center) return
 * ...`). The first render of a cold navigation sees isLoading:true and
 * returns after only the hooks declared above those checks; once the
 * center query resolves, the next render passes both checks and reaches
 * two hooks React never saw on the previous render -- "Rendered more
 * hooks than during the previous render", caught by the app's
 * ErrorBoundary. The fix moves both hooks above the early returns
 * (unconditional on every render) and gates the actual network request
 * with `enabled: Boolean(center)` instead, so reviews are still only
 * fetched once center data exists.
 *
 * A second, narrower bug in the same component: the review `page` state
 * is not reset when navigating (via SPA route, not a full reload) from one
 * center's page directly to another's, since wouter reuses the same
 * component instance across a param-only route change. Fixed with a
 * `useEffect` keyed on centerId.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import {
  courseEnrollmentsTable, coursesTable, db, educationCenterReviewsTable,
  educationCenterSubscriptionsTable, educationCentersTable, subscriptionPlansTable, usersTable,
} from "@workspace/db";

const scrypt = promisify(scryptCallback);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

const HOOK_ORDER_ERROR = /Rendered (more|fewer) hooks than during the previous render/i;

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

/** Seeds a verified, subscribed education center with `reviewCount` published reviews. */
async function seedCenterWithReviews(marker: string, reviewCount: number) {
  const [owner] = await db.insert(usersTable).values({
    firstName: "Center", lastName: "Owner",
    email: `hook-order-owner-${marker}@example.test`,
    passwordHash: await hashPassword(`owner-${marker}`), passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR",
  }).returning();
  const [center] = await db.insert(educationCentersTable).values({
    ownerId: owner!.id,
    name: `Hook Order Center ${marker}`,
    city: "Beograd",
    description: "Seeded for Task #9C hook-order regression.",
    imageUrl: "/test-education-center.jpg",
    verificationStatus: "verified",
    verifiedAt: new Date(),
  }).returning();
  const [plan] = await db.insert(subscriptionPlansTable).values({
    name: `Hook Order Plan ${marker}`, price: 5000, audience: "education", active: true,
  }).returning();
  await db.insert(educationCenterSubscriptionsTable).values({
    centerId: center!.id, planId: plan!.id, status: "active",
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  const [course] = await db.insert(coursesTable).values({
    centerId: center!.id, title: `Hook Order Course ${marker}`, category: "Test",
    format: "online", price: 5000, duration: "2 nedelje", imageUrl: "/test.jpg",
    onlineAccessDays: 30, extensionPrice1Month: 1000, extensionPrice3Months: 2000, extensionPrice6Months: 3000,
  }).returning();

  const reviewerIds: string[] = [];
  const enrollmentIds: string[] = [];
  for (let i = 0; i < reviewCount; i++) {
    const [reviewer] = await db.insert(usersTable).values({
      firstName: "Reviewer", lastName: `${marker}${i}`,
      email: `hook-order-reviewer-${marker}-${i}@example.test`,
      passwordHash: await hashPassword(`reviewer-${marker}-${i}`), passwordSetAt: new Date(), role: "STUDENT",
    }).returning();
    reviewerIds.push(reviewer!.id);
    const [enrollment] = await db.insert(courseEnrollmentsTable).values({
      courseId: course!.id, userId: reviewer!.id, purchaserId: reviewer!.id,
      status: "completed", paymentStatus: "paid", completedAt: new Date(),
    }).returning();
    enrollmentIds.push(enrollment!.id);
    await db.insert(educationCenterReviewsTable).values({
      centerId: center!.id, enrollmentId: enrollment!.id, userId: reviewer!.id,
      rating: 5, comment: `Review ${i} for ${marker}`, status: "published",
    });
  }

  return {
    owner: owner!, center: center!, plan: plan!, course: course!, reviewerIds, enrollmentIds,
    async cleanup() {
      await db.delete(educationCenterReviewsTable).where(eq(educationCenterReviewsTable.centerId, center!.id));
      await db.delete(courseEnrollmentsTable).where(inArray(courseEnrollmentsTable.id, enrollmentIds));
      await db.delete(coursesTable).where(eq(coursesTable.id, course!.id));
      await db.delete(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, center!.id));
      await db.delete(educationCentersTable).where(eq(educationCentersTable.id, center!.id));
      await db.delete(usersTable).where(inArray(usersTable.id, [owner!.id, ...reviewerIds]));
      await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, plan!.id));
    },
  };
}

test.describe("Task #9C: EducationPublicCenterPage hook-order regression", () => {
  test("scenario A+B: cold navigation and cold reload render without an ErrorBoundary crash; reviews paginate", async ({ page }) => {
    // Seeding 12 reviewers (each with its own scrypt password hash) plus a
    // cold navigation, a page-2 click, and a full reload comfortably
    // exceeds the default 30s test timeout in this sandbox.
    test.setTimeout(90_000);
    const marker = randomUUID().slice(0, 8);
    const seeded = await seedCenterWithReviews(marker, 12);
    const errors = trackConsoleErrors(page);
    const reviewRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes(`/api/education/public/centers/${seeded.center.id}/reviews`)) reviewRequests.push(req.url());
    });

    try {
      // Scenario A: cold direct navigation -- the initial API response is
      // not already synchronously cached because this is page.goto() into
      // a fresh browser context/JS runtime (a brand-new QueryClient).
      await page.goto(`/edukacije/centri/${seeded.center.id}`);
      await expect(page.getByRole("heading", { name: seeded.center.name })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Centar nije dostupan")).toHaveCount(0);
      await expect(page.getByText("Something went wrong")).toHaveCount(0);

      // Reviews: page 1 of 2 (12 reviews, pageSize 10).
      await expect(page.getByText("Review 11 for " + marker)).toBeVisible();
      const nextButton = page.getByRole("button", { name: "Sledeća" });
      await expect(nextButton).toBeVisible();
      await expect(page.getByRole("button", { name: "Prethodna" })).toBeDisabled();

      await nextButton.click();
      await expect(page.getByText("Review 0 for " + marker)).toBeVisible();
      await expect(nextButton).toBeDisabled();

      // Exactly one request per page shown -- the refactor (moving the
      // query above the early returns, gated by `enabled`) must not cause
      // a duplicate/extra fetch.
      expect(reviewRequests.filter((url) => url.includes("page=1"))).toHaveLength(1);
      expect(reviewRequests.filter((url) => url.includes("page=2"))).toHaveLength(1);

      // Scenario B: cold reload from a fresh/uncached state.
      reviewRequests.length = 0;
      await page.reload();
      await expect(page.getByRole("heading", { name: seeded.center.name })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
      // Reload resets React state, so pagination is back to page 1.
      await expect(page.getByText("Review 11 for " + marker)).toBeVisible();

      expect(errors.filter((e) => HOOK_ORDER_ERROR.test(e))).toEqual([]);
    } finally {
      await seeded.cleanup();
    }
  });

  test("scenario D: an invalid/nonexistent center ID renders the not-found UI without a hook-order crash", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto("/edukacije/centri/00000000-0000-0000-0000-000000000000");
    await expect(page.getByRole("heading", { name: "Centar nije dostupan" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    expect(errors.filter((e) => HOOK_ORDER_ERROR.test(e))).toEqual([]);
  });

  test("scenario C: SPA navigation between two centers does not crash and resets review pagination", async ({ page }) => {
    // Seeds two centers with 12 reviewers each (24 scrypt hashes total).
    test.setTimeout(90_000);
    const markerA = randomUUID().slice(0, 8);
    const markerB = randomUUID().slice(0, 8);
    const seededA = await seedCenterWithReviews(`spa-a-${markerA}`, 12);
    const seededB = await seedCenterWithReviews(`spa-b-${markerB}`, 12);
    const errors = trackConsoleErrors(page);
    const reviewRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/reviews") && url.includes("/education/public/centers/")) reviewRequests.push(url);
    });

    try {
      // Cold navigation to center A, advance to review page 2.
      await page.goto(`/edukacije/centri/${seededA.center.id}`);
      await expect(page.getByRole("heading", { name: seededA.center.name })).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Sledeća" }).click();
      await expect(page.getByRole("button", { name: "Prethodna" })).toBeEnabled();

      // SPA-internal navigation to center B: history.pushState, exactly
      // what wouter's own <Link>/setLocation does internally (see Task
      // #9A's spaNavigate rationale) -- a real client-side route change,
      // reusing the same EducationPublicCenterPage component instance
      // rather than a full reload with a fresh QueryClient.
      reviewRequests.length = 0;
      await page.evaluate((path) => { window.history.pushState({}, "", path); }, `/edukacije/centri/${seededB.center.id}`);

      await expect(page.getByRole("heading", { name: seededB.center.name })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Something went wrong")).toHaveCount(0);

      // Pagination must have reset for the new center: page 1's content
      // shows, and "Prethodna" is disabled again (page === 1), not
      // carried over as page 2 from center A.
      await expect(page.getByText("Review 11 for spa-b-" + markerB)).toBeVisible();
      await expect(page.getByRole("button", { name: "Prethodna" })).toBeDisabled();
      const centerBReviewRequests = reviewRequests.filter((url) => url.includes(seededB.center.id));
      expect(centerBReviewRequests.some((url) => url.includes("page=1"))).toBe(true);
      expect(centerBReviewRequests.some((url) => url.includes("page=2"))).toBe(false);

      expect(errors.filter((e) => HOOK_ORDER_ERROR.test(e))).toEqual([]);
    } finally {
      await seededA.cleanup();
      await seededB.cleanup();
    }
  });
});
