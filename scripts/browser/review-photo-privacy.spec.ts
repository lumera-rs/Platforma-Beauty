import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { appointmentsTable, db, salonsTable, servicesTable, usersTable } from "@workspace/db";

const salonPath = process.env.LUMERA_BOOKING_TEST_SALON_PATH ?? "/saloni/lotos-rituals";
const scrypt = promisify(scryptCallback);

type ReviewFixture = {
  customerEmail: string;
  customerPassword: string;
  customerId: string;
  salonId: string;
  salonPath: string;
  serviceName: string;
  reviewText: string;
};

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function createReviewFixture(): Promise<ReviewFixture> {
  const suffix = randomUUID();
  const customerEmail = `browser-review-${suffix}@example.test`;
  const customerPassword = "browser-review-test-password";
  const serviceName = "Browser test tretman";
  const reviewText = "Recenzija koja mora nestati nakon potvrde.";
  const [owner] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "SUPER_ADMIN"))
    .limit(1);
  if (!owner) throw new Error("Review browser fixture requires a seeded administrator.");

  const [customer] = await db.insert(usersTable).values({
    firstName: "Browser",
    lastName: "Kupac",
    email: customerEmail,
    passwordHash: await hashPassword(customerPassword),
    passwordSetAt: new Date(),
    role: "CUSTOMER",
  }).returning();
  if (!customer) throw new Error("Review browser fixture could not create its customer.");

  let salonId: string | undefined;
  try {
    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id,
      name: `Browser review salon ${suffix}`,
      slug: `browser-review-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 43",
      phone: "+381110000043",
      email: `browser-review-salon-${suffix}@example.test`,
      shortDescription: "Izolovan salon za proveru brisanja recenzije.",
      description: "Salon je napravljen samo za browser regresioni test.",
      imageUrl: "/test-browser-review.jpg",
    }).returning();
    if (!salon) throw new Error("Review browser fixture could not create its salon.");
    salonId = salon.id;

    const [service] = await db.insert(servicesTable).values({
      salonId: salon.id,
      categoryName: "Test",
      name: serviceName,
      description: "Usluga za browser proveru brisanja recenzije.",
      durationMinutes: 60,
      price: 1000,
      imageUrl: "/test-browser-review.jpg",
    }).returning();
    if (!service) throw new Error("Review browser fixture could not create its service.");

    await db.insert(appointmentsTable).values({
      salonId: salon.id,
      customerId: customer.id,
      serviceId: service.id,
      date: "2024-01-10",
      startTime: "10:00",
      endTime: "11:00",
      durationMinutes: 60,
      price: 1000,
      status: "completed",
    });

    return {
      customerEmail,
      customerPassword,
      customerId: customer.id,
      salonId: salon.id,
      salonPath: `/saloni/${salon.slug}`,
      serviceName,
      reviewText,
    };
  } catch (error) {
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    await db.delete(usersTable).where(eq(usersTable.id, customer.id));
    throw error;
  }
}

async function cleanUpReviewFixture(fixture: ReviewFixture): Promise<void> {
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.customerId));
}

async function signInAsFixtureCustomer(page: Page, fixture: ReviewFixture) {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.customerEmail, password: fixture.customerPassword },
  });
  expect(response, "The review fixture customer must be able to sign in.").toBeOK();
}

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

test("customer can publish and revise a review for a completed service on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await createReviewFixture();
  const initialReviewText = `Odličan tretman za browser proveru ${fixture.customerId.slice(0, 8)}`;
  const revisedReviewText = `Izmenjeno iskustvo za browser proveru ${fixture.customerId.slice(0, 8)}`;

  try {
    await signInAsFixtureCustomer(page, fixture);
    await page.goto(fixture.salonPath);

    const reviews = page.locator("#reviews");
    const leaveReview = page.getByRole("button", { name: "Ostavite recenziju" });
    await expect(leaveReview).toBeVisible();
    await leaveReview.click();

    const editor = page.getByRole("dialog", { name: "Podelite svoje iskustvo" });
    await expect(editor).toBeVisible();
    await expect(editor.locator("#review-service")).toContainText(fixture.serviceName);
    await editor.getByRole("button", { name: "4 od 5 zvezdica" }).click();
    await editor.locator("#review-text").fill(initialReviewText);

    const createResponse = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/customer/reviews/${fixture.salonId}`,
    );
    await editor.getByRole("button", { name: "Sačuvaj recenziju" }).click();
    expect((await createResponse).status(), "An eligible customer must be able to publish a review.").toBe(200);

    await expect(editor).toBeHidden();
    await expect(reviews.getByText(initialReviewText)).toBeVisible();
    await expect(page.getByText("4.0", { exact: true })).toBeVisible();
    await expect(page.getByText("(1 recenzija)", { exact: true })).toBeVisible();

    const editReview = page.getByRole("button", { name: "Izmeni recenziju" });
    await expect(editReview).toBeVisible();
    await editReview.click();

    const revisionEditor = page.getByRole("dialog", { name: "Izmenite recenziju" });
    await expect(revisionEditor).toBeVisible();
    await expect(revisionEditor.locator("#review-text")).toHaveValue(initialReviewText);
    await revisionEditor.getByRole("button", { name: "2 od 5 zvezdica" }).click();
    await revisionEditor.locator("#review-text").fill(revisedReviewText);

    const updateResponse = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/customer/reviews/${fixture.salonId}`,
    );
    await revisionEditor.getByRole("button", { name: "Sačuvaj recenziju" }).click();
    expect((await updateResponse).status(), "A customer must be able to revise an existing review.").toBe(200);

    await expect(revisionEditor).toBeHidden();
    await expect(reviews.getByText(revisedReviewText)).toBeVisible();
    await expect(reviews.getByText(initialReviewText)).toHaveCount(0);
    await expect(page.getByText("2.0", { exact: true })).toBeVisible();
    await expect(page.getByText("(1 recenzija)", { exact: true })).toBeVisible();
  } finally {
    await cleanUpReviewFixture(fixture);
  }
});

test("customer can cancel or confirm withdrawing a public review on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await createReviewFixture();

  try {
    await signInAsFixtureCustomer(page, fixture);
    const createReview = await page.request.put(`/api/customer/reviews/${fixture.salonId}`, {
      data: {
        serviceName: fixture.serviceName,
        rating: 5,
        text: fixture.reviewText,
        showProfilePhoto: false,
      },
    });
    expect(createReview, "The fixture's completed visit must be eligible for a review.").toBeOK();

    await page.goto(fixture.salonPath);
    const reviews = page.locator("#reviews");
    await expect(reviews.getByText(fixture.reviewText)).toBeVisible();
    await expect(page.getByText("5.0", { exact: true })).toBeVisible();
    await expect(page.getByText("(1 recenzija)", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Izmeni recenziju" }).click();
    const editor = page.getByRole("dialog", { name: "Izmenite recenziju" });
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "Obriši recenziju", exact: true }).click();

    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation.getByRole("heading", { name: "Obrisati recenziju?" })).toBeVisible();
    await expect(confirmation).toContainText("trajno uklanja vašu recenziju");

    await confirmation.getByRole("button", { name: "Zadrži recenziju" }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(editor.getByRole("button", { name: "Obriši recenziju", exact: true })).toBeVisible();
    await expect(reviews.getByText(fixture.reviewText)).toBeVisible();

    await editor.getByRole("button", { name: "Obriši recenziju", exact: true }).click();
    const deleteResponse = page.waitForResponse((response) =>
      response.request().method() === "DELETE"
      && new URL(response.url()).pathname === `/api/customer/reviews/${fixture.salonId}`,
    );
    await page.getByRole("alertdialog").getByRole("button", { name: "Obriši recenziju", exact: true }).click();
    expect((await deleteResponse).status(), "Confirming review deletion must remove the review.").toBe(204);

    await expect(reviews.getByText(fixture.reviewText)).toHaveCount(0);
    await expect(page.getByText("0.0", { exact: true })).toBeVisible();
    await expect(page.getByText("(0 recenzija)", { exact: true })).toBeVisible();
    const leaveReview = page.getByRole("button", { name: "Ostavite recenziju" });
    await expect(leaveReview).toBeVisible();
    await leaveReview.click();

    const eligibleEditor = page.getByRole("dialog", { name: "Podelite svoje iskustvo" });
    await expect(eligibleEditor).toBeVisible();
    await expect(eligibleEditor.locator("#review-service")).toContainText(fixture.serviceName);

    await eligibleEditor.getByRole("button", { name: "Otkaži" }).click();
    await expect(eligibleEditor).toBeHidden();

    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${fixture.salonPath}$`));
    const restoredReviews = page.locator("#reviews");
    await expect(restoredReviews.getByText(fixture.reviewText)).toHaveCount(0);
    await expect(page.getByText("0.0", { exact: true })).toBeVisible();
    await expect(page.getByText("(0 recenzija)", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ostavite recenziju" })).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/\/$/);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${fixture.salonPath}$`));

    const restoredAgainReviews = page.locator("#reviews");
    await expect(restoredAgainReviews.getByText(fixture.reviewText)).toHaveCount(0);
    await expect(page.getByText("0.0", { exact: true })).toBeVisible();
    await expect(page.getByText("(0 recenzija)", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ostavite recenziju" })).toBeVisible();
  } finally {
    await cleanUpReviewFixture(fixture);
  }
});