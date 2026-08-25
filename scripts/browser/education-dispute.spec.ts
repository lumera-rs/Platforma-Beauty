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

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function createEducationDisputeFixture(): Promise<EducationDisputeFixture> {
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
      role: "CUSTOMER",
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

    const [course] = await db.insert(coursesTable).values({
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
    }).returning();
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
      releaseAt: new Date("2026-09-03T12:34:00.000Z"),
      status: "frozen",
      paymentReference: `browser-dispute-${suffix}`,
      frozenAt: reportedAt,
    }).returning();
    if (!escrow) throw new Error("Education dispute browser fixture could not create its frozen escrow.");

    const [dispute] = await db.insert(educationDisputesTable).values({
      enrollmentId: enrollment.id,
      openedByUserId: customer.id,
      reason,
      details,
      status: "open",
      createdAt: reportedAt,
      updatedAt: reportedAt,
    }).returning();
    if (!dispute) throw new Error("Education dispute browser fixture could not create its dispute.");

    return {
      customerEmail,
      customerPassword,
      customerId: customer.id,
      ownerId: owner.id,
      centerId: center.id,
      courseId: course.id,
      enrollmentId: enrollment.id,
      disputeId: dispute.id,
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

test("customer sees the original dispute after retrying a duplicate submission", async ({ page }) => {
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

    await page.goto("/moj-nalog?tab=education");

    const disputeCard = page.getByTestId(`purchase-dispute-${fixture.enrollmentId}`);
    await expect(disputeCard).toBeVisible();
    await expect(disputeCard).toHaveAttribute("data-dispute-id", fixture.disputeId);
    await expect(disputeCard.getByText("Prijavljeni problem", { exact: true })).toBeVisible();
    await expect(disputeCard.getByText("Otvoren", { exact: true })).toBeVisible();
    await expect(disputeCard.locator("p").filter({ hasText: `Razlog: ${fixture.reason}` })).toBeVisible();
    await expect(disputeCard.locator("p").filter({ hasText: `Opis: ${fixture.details}` })).toBeVisible();
    await expect(disputeCard).toContainText(fixture.reportedAt.toLocaleDateString("sr-RS"));
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

    await page.reload();
    const recoveredDisputeCard = page.getByTestId(`purchase-dispute-${fixture.enrollmentId}`);
    await expect(recoveredDisputeCard).toBeVisible();
    await expect(recoveredDisputeCard).toHaveAttribute("data-dispute-id", fixture.disputeId);
    await expect(recoveredDisputeCard.locator("p").filter({ hasText: `Razlog: ${fixture.reason}` })).toBeVisible();
    await expect(recoveredDisputeCard.locator("p").filter({ hasText: `Opis: ${fixture.details}` })).toBeVisible();
    await expect(recoveredDisputeCard).toContainText(fixture.reportedAt.toLocaleDateString("sr-RS"));
  } finally {
    await cleanUpEducationDisputeFixture(fixture);
  }
});