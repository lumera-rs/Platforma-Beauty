import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { appointmentsTable, db, salonsTable, servicesTable, usersTable } from "@workspace/db";

const salonPath = process.env.LUMERA_BOOKING_TEST_SALON_PATH ?? "/saloni/lotos-rituals";
const scrypt = promisify(scryptCallback);

type ReviewFixture = {
  customerEmail: string;
  customerPassword: string;
  customerId: string;
  moderatorEmail: string;
  moderatorPassword: string;
  moderatorId: string;
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
  const moderatorEmail = `browser-review-moderator-${suffix}@example.test`;
  const moderatorPassword = "browser-review-moderator-password";
  const serviceName = "Browser test tretman";
  const reviewText = "Recenzija koja mora nestati nakon potvrde.";
  let moderatorId: string | undefined;
  let customerId: string | undefined;
  let salonId: string | undefined;
  try {
    const [moderator] = await db.insert(usersTable).values({
      firstName: "Browser",
      lastName: "Moderator",
      email: moderatorEmail,
      passwordHash: await hashPassword(moderatorPassword),
      passwordSetAt: new Date(),
      role: "ADMIN",
    }).returning();
    if (!moderator) throw new Error("Review browser fixture could not create its moderator.");
    moderatorId = moderator.id;

    const [customer] = await db.insert(usersTable).values({
      firstName: "Browser",
      lastName: "Kupac",
      email: customerEmail,
      passwordHash: await hashPassword(customerPassword),
      passwordSetAt: new Date(),
      role: "CUSTOMER",
    }).returning();
    if (!customer) throw new Error("Review browser fixture could not create its customer.");
    customerId = customer.id;

    const [salon] = await db.insert(salonsTable).values({
      ownerId: moderator.id,
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
      moderatorEmail,
      moderatorPassword,
      moderatorId: moderator.id,
      salonId: salon.id,
      salonPath: `/saloni/${salon.slug}`,
      serviceName,
      reviewText,
    };
  } catch (error) {
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (customerId) await db.delete(usersTable).where(eq(usersTable.id, customerId));
    if (moderatorId) await db.delete(usersTable).where(eq(usersTable.id, moderatorId));
    throw error;
  }
}

async function cleanUpReviewFixture(fixture: ReviewFixture): Promise<void> {
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.customerId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.moderatorId));
}

async function signIn(request: APIRequestContext, email: string, password: string, accountName: string) {
  const response = await request.post("/api/auth/login", {
    data: { email, password },
  });
  expect(response, `The review fixture ${accountName} must be able to sign in.`).toBeOK();
}

async function signInAsFixtureCustomer(request: APIRequestContext, fixture: ReviewFixture) {
  await signIn(request, fixture.customerEmail, fixture.customerPassword, "customer");
}

async function signInAsFixtureModerator(request: APIRequestContext, fixture: ReviewFixture) {
  await signIn(request, fixture.moderatorEmail, fixture.moderatorPassword, "moderator");
}

type PublicSalonResponse = {
  rating: number;
  reviewCount: number;
  reviews: Array<{ id: string; text: string }>;
};

async function expectRestoredSalonMatchesServer(
  request: APIRequestContext,
  page: Page,
  fixture: ReviewFixture,
) {
  const response = await request.get(`/api/salons/${fixture.salonPath.split("/").pop()}`);
  expect(response, "The restored salon must have a readable public server response.").toBeOK();
  const salon = await response.json() as PublicSalonResponse;

  expect(salon.reviews.some((review) => review.text === fixture.reviewText), "A moderator-deleted review must stay out of the public API.").toBe(false);
  await expect(page.locator("#reviews").getByText(fixture.reviewText)).toHaveCount(0);
  await expect(page.getByText(salon.rating.toFixed(1), { exact: true })).toBeVisible();
  await expect(page.getByText(`(${salon.reviewCount} recenzija)`, { exact: true })).toBeVisible();
}

test("a moderator-deleted public review stays gone after browser history restoration", async ({ page, request }) => {
  const fixture = await createReviewFixture();

  try {
    await signInAsFixtureCustomer(page.request, fixture);
    const created = await page.request.put(`/api/customer/reviews/${fixture.salonId}`, {
      data: {
        serviceName: fixture.serviceName,
        rating: 5,
        text: fixture.reviewText,
        showProfilePhoto: false,
      },
  });
    expect(created, "The fixture customer must be able to publish a public review.").toBeOK();
    const review = await created.json() as { id: string };

    await page.goto(fixture.salonPath);
    await expect(page.locator("#reviews").getByText(fixture.reviewText)).toBeVisible();
    await expect(page.getByText("5.0", { exact: true })).toBeVisible();
    await expect(page.getByText("(1 recenzija)", { exact: true })).toBeVisible();

    await signInAsFixtureModerator(request, fixture);
    const deleted = await request.delete(`/api/admin/reviews/${review.id}`);
    expect(deleted.status(), "The moderator must be able to permanently remove the fixture review.").toBe(204);

    const beforeRestore = await request.get(`/api/salons/${fixture.salonPath.split("/").pop()}`);
    expect(beforeRestore).toBeOK();
    const serverSalon = await beforeRestore.json() as PublicSalonResponse;
    expect(serverSalon.reviews.some((item) => item.id === review.id)).toBe(false);
    expect(serverSalon.rating).toBe(0);
    expect(serverSalon.reviewCount).toBe(0);

    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${fixture.salonPath}$`));
    await expectRestoredSalonMatchesServer(request, page, fixture);
    await expect(page.getByRole("button", { name: "Ostavite recenziju" })).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/\/$/);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${fixture.salonPath}$`));
    await expectRestoredSalonMatchesServer(request, page, fixture);
    await expect(page.getByRole("button", { name: "Ostavite recenziju" })).toBeVisible();
  } finally {
    await cleanUpReviewFixture(fixture);
  }
});

test("a moderator hiding or restoring a review keeps public salon metrics accurate", async ({ page, request }) => {
  const fixture = await createReviewFixture();

  try {
    await signInAsFixtureCustomer(page.request, fixture);
    const created = await page.request.put(`/api/customer/reviews/${fixture.salonId}`, {
      data: {
        serviceName: fixture.serviceName,
        rating: 5,
        text: fixture.reviewText,
        showProfilePhoto: false,
      },
    });
    expect(created, "The fixture customer must be able to publish a public review.").toBeOK();
    const review = await created.json() as { id: string };

    await page.goto(fixture.salonPath);
    await expect(page.locator("#reviews").getByText(fixture.reviewText)).toBeVisible();
    await expect(page.getByText("5.0", { exact: true })).toBeVisible();
    await expect(page.getByText("(1 recenzija)", { exact: true })).toBeVisible();

    await signInAsFixtureModerator(request, fixture);
    const hidden = await request.patch(`/api/admin/reviews/${review.id}`, { data: { visible: false } });
    expect(hidden, "A moderator must be able to hide the fixture review.").toBeOK();

    const afterHide = await request.get(`/api/salons/${fixture.salonPath.split("/").pop()}`);
    expect(afterHide, "The public salon must remain readable after moderation.").toBeOK();
    const hiddenSalon = await afterHide.json() as PublicSalonResponse;
    expect(hiddenSalon.reviews.some((item) => item.id === review.id)).toBe(false);
    expect(hiddenSalon.rating).toBe(0);
    expect(hiddenSalon.reviewCount).toBe(0);

    await page.reload();
    await expect(page.locator("#reviews").getByText(fixture.reviewText)).toHaveCount(0);
    await expect(page.getByText("0.0", { exact: true })).toBeVisible();
    await expect(page.getByText("(0 recenzija)", { exact: true })).toBeVisible();

    const restored = await request.patch(`/api/admin/reviews/${review.id}`, { data: { visible: true } });
    expect(restored, "A moderator must be able to restore the fixture review.").toBeOK();

    const afterRestore = await request.get(`/api/salons/${fixture.salonPath.split("/").pop()}`);
    expect(afterRestore, "The public salon must remain readable after restoration.").toBeOK();
    const restoredSalon = await afterRestore.json() as PublicSalonResponse;
    expect(restoredSalon.reviews.some((item) => item.id === review.id)).toBe(true);
    expect(restoredSalon.rating).toBe(5);
    expect(restoredSalon.reviewCount).toBe(1);

    await page.reload();
    await expect(page.locator("#reviews").getByText(fixture.reviewText)).toBeVisible();
    await expect(page.getByText("5.0", { exact: true })).toBeVisible();
    await expect(page.getByText("(1 recenzija)", { exact: true })).toBeVisible();
  } finally {
    await cleanUpReviewFixture(fixture);
  }
});

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
    await signInAsFixtureCustomer(page.request, fixture);
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
    await signInAsFixtureCustomer(page.request, fixture);
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