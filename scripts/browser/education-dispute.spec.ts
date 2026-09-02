import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  courseEnrollmentsTable,
  coursesTable,
  db,
  educationCentersTable,
  educationDisputesTable,
  educationEscrowsTable,
  usersTable,
} from "@workspace/db";
import { buildValidOnlineEducationCourse } from "../../artifacts/api-server/src/lib/education-test-fixtures";

const scrypt = promisify(scryptCallback);

type EducationDisputeFixture = {
  customerEmail: string;
  customerPassword: string;
  customerId: string;
  ownerId: string;
  centerId: string;
  courseId: string;
  enrollmentId: string;
  disputeId: string;
  reportedAt: Date;
  reason: string;
  details: string;
};

type AnalyticsEvent = {
  name: string;
  data?: Record<string, unknown>;
};

async function captureAnalytics(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const events: AnalyticsEvent[] = [];
    Object.defineProperty(window, "__educationDisputeAnalytics", {
      configurable: true,
      value: events,
    });
    Object.defineProperty(window, "umami", {
      configurable: true,
      value: {
        track(name: string, data?: Record<string, unknown>) {
          events.push(data === undefined ? { name } : { name, data });
        },
      },
    });
  });
}

async function expectDisputeAnalytics(
  page: Page,
  outcome: "created" | "existing" | "error",
): Promise<void> {
  await expect.poll(() => page.evaluate(() => (
    (window as Window & { __educationDisputeAnalytics?: AnalyticsEvent[] })
      .__educationDisputeAnalytics ?? []
  ))).toEqual([
    { name: "education_dispute_form_opened" },
    { name: "education_dispute_submitted", data: { outcome } },
  ]);

  const serializedPayloads = await page.evaluate(() => JSON.stringify(
    ((window as Window & { __educationDisputeAnalytics?: AnalyticsEvent[] })
      .__educationDisputeAnalytics ?? []).map((event) => event.data ?? {}),
  ));
  expect(serializedPayloads).not.toMatch(/reason|details|description|enrollment|identifier|(^|["_])id(["_]|$)/i);
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function createEducationDisputeFixture(withExistingDispute = true): Promise<EducationDisputeFixture> {
  const suffix = randomUUID();
  const customerPassword = "browser-education-dispute-password";
  const customerEmail = `browser-education-dispute-customer-${suffix}@example.test`;
  const reportedAt = new Date("2026-08-20T12:34:00.000Z");
  const reason = "Kurs nije dostupan";
  const details = "Plaćeni kurs se ne otvara nakon kupovine. Molim proveru pristupa i povraćaj ako sadržaj nije moguće aktivirati.";
  let customerId: string | undefined;
  let ownerId: string | undefined;
  let centerId: string | undefined;
  let courseId: string | undefined;
  let enrollmentId: string | undefined;

  try {
    const [owner] = await db.insert(usersTable).values({
      firstName: "Browser",
      lastName: "Centar",
      email: `browser-education-dispute-owner-${suffix}@example.test`,
      passwordHash: await hashPassword("browser-education-dispute-owner-password"),
      passwordSetAt: new Date(),
      role: "EDUKATIVNI_CENTAR",
    }).returning();
    if (!owner) throw new Error("Education dispute browser fixture could not create its center owner.");
    ownerId = owner.id;

    const [customer] = await db.insert(usersTable).values({
      firstName: "Browser",
      lastName: "Kupac",
      email: customerEmail,
      passwordHash: await hashPassword(customerPassword),
      passwordSetAt: new Date(),
      role: "STUDENT",
    }).returning();
    if (!customer) throw new Error("Education dispute browser fixture could not create its customer.");
    customerId = customer.id;

    const [center] = await db.insert(educationCentersTable).values({
      ownerId: owner.id,
      name: `Browser dispute center ${suffix}`,
      city: "Beograd",
      description: "Izolovani centar za proveru prikaza aktivnog spora kupcu.",
      imageUrl: "/test-browser-education-dispute.jpg",
      verificationStatus: "verified",
      verifiedAt: new Date(),
      verifiedByUserId: owner.id,
    }).returning();
    if (!center) throw new Error("Education dispute browser fixture could not create its center.");
    centerId = center.id;

    const [course] = await db.insert(coursesTable).values(buildValidOnlineEducationCourse({
      centerId: center.id,
      title: `Browser kurs sa otvorenim sporom ${suffix}`,
      description: "Izolovani kurs za proveru oporavka od ponovljene prijave spora.",
      category: "Browser test",
      format: "online",
      city: "Beograd",
      price: 18000,
      duration: "2 nedelje",
      certification: true,
      imageUrl: "/test-browser-education-dispute.jpg",
      published: true,
    })).returning();
    if (!course) throw new Error("Education dispute browser fixture could not create its course.");
    courseId = course.id;

    const [enrollment] = await db.insert(courseEnrollmentsTable).values({
      courseId: course.id,
      userId: customer.id,
      purchaserId: customer.id,
      status: "active",
      paymentStatus: "paid",
      progress: 35,
      purchasedAt: new Date("2026-08-19T10:00:00.000Z"),
      accessGrantedAt: new Date("2026-08-19T10:00:00.000Z"),
    }).returning();
    if (!enrollment) throw new Error("Education dispute browser fixture could not create its paid enrollment.");
    enrollmentId = enrollment.id;

    const [escrow] = await db.insert(educationEscrowsTable).values({
      enrollmentId: enrollment.id,
      centerId: center.id,
      grossAmount: 18000,
      platformFee: 2700,
      reserveAmount: 1800,
      netAmount: 13500,
      releaseAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: withExistingDispute ? "frozen" : "held",
      paymentReference: `browser-dispute-${suffix}`,
      frozenAt: withExistingDispute ? reportedAt : null,
    }).returning();
    if (!escrow) throw new Error("Education dispute browser fixture could not create its frozen escrow.");

    const dispute = withExistingDispute
      ? (await db.insert(educationDisputesTable).values({
          enrollmentId: enrollment.id,
          openedByUserId: customer.id,
          reason,
          details,
          status: "open",
          createdAt: reportedAt,
          updatedAt: reportedAt,
        }).returning())[0]
      : null;
    if (withExistingDispute && !dispute) throw new Error("Education dispute browser fixture could not create its dispute.");

    return {
      customerEmail,
      customerPassword,
      customerId: customer.id,
      ownerId: owner.id,
      centerId: center.id,
      courseId: course.id,
      enrollmentId: enrollment.id,
      disputeId: dispute?.id ?? "",
      reportedAt,
      reason,
      details,
    };
  } catch (error) {
    if (courseId) await db.delete(coursesTable).where(eq(coursesTable.id, courseId));
    if (centerId) await db.delete(educationCentersTable).where(eq(educationCentersTable.id, centerId));
    if (customerId) await db.delete(usersTable).where(eq(usersTable.id, customerId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpEducationDisputeFixture(fixture: EducationDisputeFixture): Promise<void> {
  await db.delete(coursesTable).where(eq(coursesTable.id, fixture.courseId));
  await db.delete(educationCentersTable).where(eq(educationCentersTable.id, fixture.centerId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.customerId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
}

async function signInAsFixtureCustomer(page: Page, fixture: EducationDisputeFixture): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.customerEmail, password: fixture.customerPassword },
  });
  expect(response, "The education dispute fixture customer must be able to sign in.").toBeOK();
}

test("student reports a problem from an education card and sees it immediately", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await createEducationDisputeFixture(false);
  const reason = "Nedostaje deo materijala";
  const details = "Treći modul nema obećani radni materijal. Molim da sadržaj bude dopunjen.";

  try {
    await captureAnalytics(page);
    await signInAsFixtureCustomer(page, fixture);
    await page.goto("/student/edukacije");
    await expect(page.getByRole("heading", { name: /^Browser kurs sa otvorenim sporom/ })).toBeVisible();

    await page.getByRole("button", { name: "Prijavi problem" }).click();
    const dialog = page.getByRole("dialog", { name: "Prijavi problem" });
    await dialog.getByLabel("Razlog").fill(reason);
    await dialog.getByLabel("Opis").fill(details);
    await dialog.getByRole("button", { name: "Pošalji prijavu" }).click();

    await expect(dialog).toBeHidden();
    const disputeCard = page.getByTestId(`student-enrollment-dispute-${fixture.enrollmentId}`);
    await expect(disputeCard).toBeVisible();
    await expect(disputeCard).toHaveAttribute("data-dispute-id", /.+/);
    await expect(disputeCard.getByText("Otvoren", { exact: true })).toBeVisible();
    await expect(disputeCard.getByText(`Razlog: ${reason}`, { exact: true })).toBeVisible();
    await expect(disputeCard).toContainText("Prijavljeno");
    await expect(page.getByRole("button", { name: "Prijavi problem" })).toHaveCount(0);

    const disputes = await db.select().from(educationDisputesTable)
      .where(eq(educationDisputesTable.enrollmentId, fixture.enrollmentId));
    expect(disputes).toHaveLength(1);
    expect(disputes[0]).toMatchObject({ reason, details, status: "open" });
    await expectDisputeAnalytics(page, "created");
  } finally {
    await cleanUpEducationDisputeFixture(fixture);
  }
});

test("student duplicate response records only the existing outcome", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createEducationDisputeFixture(false);
  const existingDispute = {
    id: randomUUID(),
    enrollmentId: fixture.enrollmentId,
    reason: "Već prijavljen razlog",
    details: "Opis postojećeg spora koji server vraća uz konflikt.",
    status: "open",
    createdAt: new Date("2026-08-21T09:15:00.000Z").toISOString(),
  };

  try {
    await captureAnalytics(page);
    await signInAsFixtureCustomer(page, fixture);
    await page.route(`**/api/education/purchases/${fixture.enrollmentId}/disputes`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "Dispute already exists", dispute: existingDispute }),
      });
    });
    await page.goto("/student/edukacije");

    await page.getByRole("button", { name: "Prijavi problem" }).click();
    const dialog = page.getByRole("dialog", { name: "Prijavi problem" });
    await dialog.getByLabel("Razlog").fill("Ponovljeni privatni razlog");
    await dialog.getByLabel("Opis").fill("Ponovljeni privatni opis koji ne sme u analitiku.");
    await dialog.getByRole("button", { name: "Pošalji prijavu" }).click();

    await expect(dialog).toBeHidden();
    const disputeCard = page.getByTestId(`student-enrollment-dispute-${fixture.enrollmentId}`);
    await expect(disputeCard).toHaveAttribute("data-dispute-id", existingDispute.id);
    await expect(disputeCard.getByText(`Razlog: ${existingDispute.reason}`, { exact: true })).toBeVisible();
    await expect(page.getByText("Problem je već prijavljen", { exact: true })).toBeVisible();
    await expectDisputeAnalytics(page, "existing");
  } finally {
    await cleanUpEducationDisputeFixture(fixture);
  }
});

test("student server failure records only the error outcome and keeps the form open", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await createEducationDisputeFixture(false);

  try {
    await captureAnalytics(page);
    await signInAsFixtureCustomer(page, fixture);
    await page.route(`**/api/education/purchases/${fixture.enrollmentId}/disputes`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Privatna serverska greška" }),
      });
    });
    await page.goto("/student/edukacije");

    await page.getByRole("button", { name: "Prijavi problem" }).click();
    const dialog = page.getByRole("dialog", { name: "Prijavi problem" });
    await dialog.getByLabel("Razlog").fill("Privatni razlog neuspele prijave");
    await dialog.getByLabel("Opis").fill("Privatni opis neuspele prijave koji ne sme u analitiku.");
    await dialog.getByRole("button", { name: "Pošalji prijavu" }).click();

    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Razlog")).toHaveValue("Privatni razlog neuspele prijave");
    await expect(dialog.getByLabel("Opis")).toHaveValue("Privatni opis neuspele prijave koji ne sme u analitiku.");
    await expect(page.getByText("Problem nije prijavljen", { exact: true })).toBeVisible();
    await expect(page.getByTestId(`student-enrollment-dispute-${fixture.enrollmentId}`)).toHaveCount(0);
    await expectDisputeAnalytics(page, "error");
  } finally {
    await cleanUpEducationDisputeFixture(fixture);
  }
});

test("student keeps the original dispute after retrying a duplicate submission", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createEducationDisputeFixture();

  try {
    await signInAsFixtureCustomer(page, fixture);
    const purchaseResponse = await page.request.get("/api/education/purchases");
    expect(purchaseResponse).toBeOK();
    const purchases = await purchaseResponse.json() as Array<{
      id: string;
      dispute: { id: string; status: string; reason: string; details: string; createdAt: string } | null;
    }>;
    const purchase = purchases.find((item) => item.id === fixture.enrollmentId);
    expect(purchase?.dispute?.id).toBe(fixture.disputeId);
    expect(purchase?.dispute?.status).toBe("open");

    await page.goto("/student/edukacije");
    await expect(page.getByRole("heading", { name: "Moje edukacije" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Browser kurs sa otvorenim sporom/ })).toBeVisible();
    const disputeCard = page.getByTestId(`student-enrollment-dispute-${fixture.enrollmentId}`);
    await expect(disputeCard).toHaveAttribute("data-dispute-id", fixture.disputeId);
    await expect(disputeCard.getByText("Otvoren", { exact: true })).toBeVisible();
    await expect(disputeCard.getByText(`Razlog: ${fixture.reason}`, { exact: true })).toBeVisible();
    await expect(disputeCard).toContainText("20. 8. 2026.");
    await expect(disputeCard).toContainText("Escrow je zamrznut dok se spor obrađuje.");

    const duplicateResponse = await page.request.post(
      `/api/education/purchases/${fixture.enrollmentId}/disputes`,
      { data: { reason: "Ponovljeni razlog", details: "Ponovljeni opis nakon ponovnog slanja." } },
    );
    expect(duplicateResponse.status()).toBe(409);
    const duplicateBody = await duplicateResponse.json() as {
      dispute: { id: string; enrollmentId: string; status: string; reason: string; details: string; createdAt: string };
    };
    expect(duplicateBody.dispute).toMatchObject({
      id: fixture.disputeId,
      enrollmentId: fixture.enrollmentId,
      status: "open",
      reason: fixture.reason,
      details: fixture.details,
      createdAt: fixture.reportedAt.toISOString(),
    });

    const recoveredPurchaseResponse = await page.request.get("/api/education/purchases");
    expect(recoveredPurchaseResponse).toBeOK();
    const recoveredPurchases = await recoveredPurchaseResponse.json() as Array<{
      id: string;
      dispute: { id: string; status: string; reason: string; details: string; createdAt: string } | null;
    }>;
    expect(recoveredPurchases.find((item) => item.id === fixture.enrollmentId)?.dispute).toMatchObject({
      id: fixture.disputeId,
      status: "open",
      reason: fixture.reason,
      details: fixture.details,
      createdAt: fixture.reportedAt.toISOString(),
    });

    await page.reload();
    await expect(page.getByRole("heading", { name: /^Browser kurs sa otvorenim sporom/ })).toBeVisible();
    const recoveredDisputeCard = page.getByTestId(`student-enrollment-dispute-${fixture.enrollmentId}`);
    await expect(recoveredDisputeCard).toHaveAttribute("data-dispute-id", fixture.disputeId);
    await expect(recoveredDisputeCard.getByText("Otvoren", { exact: true })).toBeVisible();
    await expect(recoveredDisputeCard.getByText(`Razlog: ${fixture.reason}`, { exact: true })).toBeVisible();
    await expect(recoveredDisputeCard).toContainText("20. 8. 2026.");
    await expect(recoveredDisputeCard).toContainText("Escrow je zamrznut dok se spor obrađuje.");
  } finally {
    await cleanUpEducationDisputeFixture(fixture);
  }
});