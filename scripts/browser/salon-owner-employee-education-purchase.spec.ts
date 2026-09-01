import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  courseEnrollmentsTable,
  coursesTable,
  courseSessionsTable,
  db,
  educationCenterSubscriptionsTable,
  educationCentersTable,
  educationEscrowsTable,
  educationLedgerEntriesTable,
  educationPlatformSettingsTable,
  employeeLocationAssignmentsTable,
  employeesTable,
  pool,
  salonsTable,
  subscriptionPlansTable,
  usersTable,
} from "@workspace/db";
import { hashPassword } from "../../artifacts/api-server/src/lib/auth";

const SETTINGS_LOCK = "browser-salon-owner-education-ips-settings";
const COURSE_PRICE = 12_000;
const COMMISSION_PERCENT = 17;
const RESERVE_PERCENT = 8;

type IpsSettingsSnapshot = {
  id: string;
  commissionPercent: number;
  reservePercent: number;
  onlineRefundDays: number;
  liveAppealDays: number;
  featuredCoursePrice: number;
  ipsRecipientName: string | null;
  ipsRecipientAccount: string | null;
  ipsPurpose: string | null;
  updatedByUserId: string | null;
};

type Fixture = {
  adminEmail: string;
  adminPassword: string;
  centerEmail: string;
  centerPassword: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerId: string;
  employeeUserId: string;
  employeeId: string;
  salonId: string;
  centerId: string;
  courseId: string;
  sessionId: string;
  planId: string;
  courseTitle: string;
  employeeName: string;
};

async function lockIpsSettings(): Promise<() => Promise<void>> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [SETTINGS_LOCK]);
  } catch (error) {
    client.release();
    throw error;
  }
  return async () => {
    try {
      await client.query("select pg_advisory_unlock(hashtext($1))", [SETTINGS_LOCK]);
    } finally {
      client.release();
    }
  };
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const ownerPassword = "browser-owner-education-password";
  const employeePassword = "browser-employee-education-password";
  const centerPassword = "browser-center-education-password";
  const adminPassword = "browser-admin-education-password";
  const courseTitle = `Browser owner employee course ${suffix}`;
  const employeeName = `Browser employee ${suffix}`;

  const [owner] = await db.insert(usersTable).values({
    firstName: "Browser",
    lastName: "Salon owner",
    email: `browser-education-owner-${suffix}@example.test`,
    passwordHash: await hashPassword(ownerPassword),
    passwordSetAt: new Date(),
    role: "SALON_OWNER",
  }).returning();
  if (!owner) throw new Error("Could not create salon owner fixture.");
  const [employeeUser] = await db.insert(usersTable).values({
    firstName: "Browser",
    lastName: "Employee",
    email: `browser-education-employee-${suffix}@example.test`,
    passwordHash: await hashPassword(employeePassword),
    passwordSetAt: new Date(),
    role: "SALON_EMPLOYEE",
  }).returning();
  if (!employeeUser) throw new Error("Could not create linked employee user fixture.");
  const [centerOwner] = await db.insert(usersTable).values({
    firstName: "Browser",
    lastName: "Education center",
    email: `browser-education-center-${suffix}@example.test`,
    passwordHash: await hashPassword(centerPassword),
    passwordSetAt: new Date(),
    role: "EDUKATIVNI_CENTAR",
  }).returning();
  if (!centerOwner) throw new Error("Could not create education center owner fixture.");
  const [admin] = await db.insert(usersTable).values({
    firstName: "Browser",
    lastName: "Education admin",
    email: `browser-education-admin-${suffix}@example.test`,
    passwordHash: await hashPassword(adminPassword),
    passwordSetAt: new Date(),
    role: "ADMIN",
  }).returning();
  if (!admin) throw new Error("Could not create education admin fixture.");
  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner.id, name: `Browser education salon ${suffix}`, slug: `browser-education-salon-${suffix}`,
    city: "Beograd", municipality: "Vračar", address: "Test 1", postalCode: "11000",
    phone: "+381601234567", email: `browser-education-salon-${suffix}@example.test`,
    shortDescription: "Salon fixture.", description: "Salon fixture for education purchase.", imageUrl: "/browser-test.jpg",
  }).returning();
  if (!salon) throw new Error("Could not create salon fixture.");
  const [employee] = await db.insert(employeesTable).values({
    salonId: salon.id, userId: employeeUser.id, name: employeeName, role: "Stilist",
    bio: "Linked employee for browser education lifecycle.", avatarUrl: "/browser-employee.jpg", email: employeeUser.email,
  }).returning();
  if (!employee) throw new Error("Could not create employee fixture.");
  await db.insert(employeeLocationAssignmentsTable).values({
    employeeId: employee.id,
    salonId: salon.id,
    active: true,
    isDefault: true,
  });
  await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));
  const [center] = await db.insert(educationCentersTable).values({
    ownerId: centerOwner.id, name: `Browser education center ${suffix}`, city: "Beograd",
    description: "Verified browser education fixture.", imageUrl: "/browser-center.jpg",
    verificationStatus: "verified", verifiedAt: new Date(), verifiedByUserId: admin.id,
  }).returning();
  if (!center) throw new Error("Could not create education center fixture.");
  const [plan] = await db.insert(subscriptionPlansTable).values({
    name: `Browser education plan ${suffix}`, price: 0, features: [], limits: {},
  }).returning();
  if (!plan) throw new Error("Could not create subscription plan fixture.");
  await db.insert(educationCenterSubscriptionsTable).values({
    centerId: center.id, planId: plan.id, status: "active", dueAmount: 0,
    currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const [course] = await db.insert(coursesTable).values({
    centerId: center.id, title: courseTitle, description: "Published course for the owner employee purchase lifecycle.",
    category: "Browser test", format: "in-person", city: "Beograd", price: COURSE_PRICE,
    duration: "1 dan", certification: true, imageUrl: "/browser-course.jpg", published: true, paymentMode: "online_full",
  }).returning();
  if (!course) throw new Error("Could not create published course fixture.");
  const [session] = await db.insert(courseSessionsTable).values({
    courseId: course.id, startsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
    location: "Browser Beograd", capacity: 6,
  }).returning();
  if (!session) throw new Error("Could not create future course session fixture.");

  return {
    adminEmail: admin.email, adminPassword, centerEmail: centerOwner.email, centerPassword,
    ownerEmail: owner.email, ownerPassword, ownerId: owner.id, employeeUserId: employeeUser.id,
    employeeId: employee.id, salonId: salon.id, centerId: center.id, courseId: course.id,
    sessionId: session.id, planId: plan.id, courseTitle, employeeName,
  };
}

async function cleanupFixture(fixture: Fixture) {
  await db.delete(coursesTable).where(eq(coursesTable.id, fixture.courseId));
  await db.delete(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, fixture.centerId));
  await db.delete(educationCentersTable).where(eq(educationCentersTable.id, fixture.centerId));
  await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, fixture.planId));
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.employeeUserId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
  await db.delete(usersTable).where(eq(usersTable.email, fixture.centerEmail));
  await db.delete(usersTable).where(eq(usersTable.email, fixture.adminEmail));
}

test("salon owner purchases one employee's verified center course through IPS settlement", async ({ page }) => {
  test.setTimeout(90_000);
  const releaseLock = await lockIpsSettings();
  let fixture: Fixture | undefined;
  let settingsSnapshot: IpsSettingsSnapshot | undefined;
  let createdSettingsId: string | undefined;
  try {
    const [existing] = await db.select().from(educationPlatformSettingsTable)
      .orderBy(asc(educationPlatformSettingsTable.createdAt)).limit(1);
    if (existing) {
      settingsSnapshot = existing;
      await db.update(educationPlatformSettingsTable).set({
        commissionPercent: COMMISSION_PERCENT, reservePercent: RESERVE_PERCENT,
        ipsRecipientName: "LUMERA Browser IPS", ipsRecipientAccount: "160000000000000000", ipsPurpose: "Edukacija",
      }).where(eq(educationPlatformSettingsTable.id, existing.id));
    } else {
      const [created] = await db.insert(educationPlatformSettingsTable).values({
        commissionPercent: COMMISSION_PERCENT, reservePercent: RESERVE_PERCENT,
        ipsRecipientName: "LUMERA Browser IPS", ipsRecipientAccount: "160000000000000000", ipsPurpose: "Edukacija",
      }).returning();
      if (!created) throw new Error("Could not create canonical education IPS settings.");
      createdSettingsId = created.id;
    }

    fixture = await createFixture();
    expect((await page.request.post("/api/auth/login", { data: { email: fixture.ownerEmail, password: fixture.ownerPassword } })).ok()).toBeTruthy();

    await page.goto("/edukacije");
    await expect(page.getByText(fixture.courseTitle, { exact: true }).first()).toBeVisible();
    await page.getByText(fixture.courseTitle, { exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/edukacije/${fixture.courseId}`));
    await expect(page.getByText(fixture.courseTitle, { exact: true }).first()).toBeVisible();

    await page.goto(`/biznis/edukacije/${fixture.courseId}`);
    const learnerSelect = page.getByRole("combobox", { name: "Polaznik" });
    await expect(learnerSelect).toBeVisible();
    await learnerSelect.click();
    await page.getByRole("option", { name: fixture.employeeName, exact: true }).click();
    await page.getByTestId("select-enrollment-session").click();
    await page.getByRole("option", { name: /6 mesta/ }).click();
    await page.getByTestId("button-submit-employee-enrollment").click();
    await expect(page.getByTestId("status-enrollment-payment-pending")).toContainText("Prijava čeka ručnu potvrdu uplate");
    await expect(page.getByTestId("status-enrollment-payment-pending")).toContainText("LUMERA Browser IPS");

    const pending = await db.select().from(courseEnrollmentsTable).where(and(
      eq(courseEnrollmentsTable.courseId, fixture.courseId),
      eq(courseEnrollmentsTable.purchaserId, fixture.ownerId),
      eq(courseEnrollmentsTable.employeeId, fixture.employeeId),
    ));
    expect(pending).toHaveLength(1);
    const enrollment = pending[0]!;
    expect(enrollment).toMatchObject({
      userId: fixture.ownerId, purchaserId: fixture.ownerId, salonId: fixture.salonId,
      employeeId: fixture.employeeId, sessionId: fixture.sessionId, status: "pending", paymentStatus: "pending",
    });

    expect((await page.request.post("/api/auth/login", { data: { email: fixture.adminEmail, password: fixture.adminPassword } })).ok()).toBeTruthy();
    await page.goto("/admin/edukacije");
    const pendingCard = page.getByText(fixture.courseTitle, { exact: true })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-xl')][1]");
    await expect(pendingCard).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await pendingCard.getByRole("button", { name: "Potvrdi uplatu", exact: true }).click();
    await expect(page.getByText("Uplata je potvrđena.")).toBeVisible();

    expect((await page.request.post("/api/auth/login", { data: { email: fixture.ownerEmail, password: fixture.ownerPassword } })).ok()).toBeTruthy();
    await page.goto("/vlasnik/edukacije");
    await expect(page.getByText(fixture.courseTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(fixture.employeeName, { exact: true })).toBeVisible();
    await expect(page.getByText("Aktivna", { exact: true })).toBeVisible();
    await expect(page.getByText("Uplata potvrđena", { exact: true })).toBeVisible();

    expect((await page.request.post("/api/auth/login", { data: { email: fixture.centerEmail, password: fixture.centerPassword } })).ok()).toBeTruthy();
    await page.goto("/biznis/polaznici");
    await expect(page.getByTestId(`text-crm-participant-${fixture.employeeUserId}`)).toHaveText(fixture.employeeName);

    const settled = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, enrollment.id));
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({
      userId: fixture.ownerId, purchaserId: fixture.ownerId, salonId: fixture.salonId,
      employeeId: fixture.employeeId, sessionId: fixture.sessionId, status: "active", paymentStatus: "paid",
    });
    const escrows = await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.enrollmentId, enrollment.id));
    expect(escrows).toHaveLength(1);
    expect(escrows[0]).toMatchObject({
      centerId: fixture.centerId, grossAmount: COURSE_PRICE,
      platformFee: Math.floor(COURSE_PRICE * COMMISSION_PERCENT / 100),
      reserveAmount: Math.floor(COURSE_PRICE * RESERVE_PERCENT / 100),
    });
    const ledger = await db.select().from(educationLedgerEntriesTable).where(eq(educationLedgerEntriesTable.enrollmentId, enrollment.id));
    expect(ledger).toHaveLength(3);
    expect(ledger.map((entry) => [entry.type, entry.amount]).sort()).toEqual([
      ["charge", COURSE_PRICE],
      ["platform_fee", -Math.floor(COURSE_PRICE * COMMISSION_PERCENT / 100)],
      ["reserve_hold", -Math.floor(COURSE_PRICE * RESERVE_PERCENT / 100)],
    ].sort());
  } finally {
    try {
      if (fixture) await cleanupFixture(fixture);
    } finally {
      try {
        if (createdSettingsId) await db.delete(educationPlatformSettingsTable).where(eq(educationPlatformSettingsTable.id, createdSettingsId));
        if (settingsSnapshot) await db.update(educationPlatformSettingsTable).set(settingsSnapshot).where(eq(educationPlatformSettingsTable.id, settingsSnapshot.id));
      } finally {
        await releaseLock();
      }
    }
  }
});
