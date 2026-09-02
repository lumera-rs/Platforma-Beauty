import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  courseEnrollmentsTable,
  coursesTable,
  db,
  educationCenterSubscriptionsTable,
  educationCentersTable,
  educationPaymentObligationsTable,
  employeeLocationAssignmentsTable,
  employeesTable,
  salonsTable,
  subscriptionPlansTable,
  usersTable,
} from "@workspace/db";
import { hashPassword } from "../../artifacts/api-server/src/lib/auth";
import { DIGITAL_CONTENT_CONSENT_TEXT } from "../../artifacts/beauty-marketplace/src/lib/education-consent";

const GROUP_CONSENT_HELP =
  "Jedna potvrda kupca čuva se kao zaseban dokaz uz prijavu svakog označenog polaznika.";

type Fixture = {
  ownerId: string;
  ownerEmail: string;
  ownerPassword: string;
  employeeUserIds: [string, string];
  employeeEmails: [string, string];
  employeeIds: [string, string];
  employeeNames: [string, string];
  foreignEmployeeUserId: string;
  foreignEmployeeId: string;
  unavailableEmployeeUserId: string;
  unavailableEmployeeId: string;
  salonId: string;
  foreignSalonId: string;
  centerId: string;
  centerOwnerId: string;
  adminId: string;
  planId: string;
  courseId: string;
  secondCourseId: string;
  internalCourseId: string;
};

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const ownerPassword = "browser-group-consent-password";
  const passwordHash = await hashPassword(ownerPassword);
  const employeeNames: [string, string] = [
    `Browser polaznik A ${suffix}`,
    `Browser polaznik B ${suffix}`,
  ];
  const [
    owner,
    firstEmployeeUser,
    secondEmployeeUser,
    foreignEmployeeUser,
    unavailableEmployeeUser,
    centerOwner,
    admin,
  ] = await db.insert(usersTable).values([
    {
      firstName: "Browser",
      lastName: "Group owner",
      email: `browser-group-owner-${suffix}@example.test`,
      passwordHash,
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    },
    {
      firstName: "Browser",
      lastName: "Group employee A",
      email: `browser-group-employee-a-${suffix}@example.test`,
      passwordHash,
      passwordSetAt: new Date(),
      role: "SALON_EMPLOYEE",
    },
    {
      firstName: "Browser",
      lastName: "Group employee B",
      email: `browser-group-employee-b-${suffix}@example.test`,
      passwordHash,
      passwordSetAt: new Date(),
      role: "SALON_EMPLOYEE",
    },
    {
      firstName: "Browser",
      lastName: "Foreign employee",
      email: `browser-group-foreign-employee-${suffix}@example.test`,
      passwordHash,
      passwordSetAt: new Date(),
      role: "SALON_EMPLOYEE",
    },
    {
      firstName: "Browser",
      lastName: "Unavailable employee",
      email: `browser-group-unavailable-employee-${suffix}@example.test`,
      passwordHash,
      passwordSetAt: new Date(),
      role: "SALON_EMPLOYEE",
    },
    {
      firstName: "Browser",
      lastName: "Group center",
      email: `browser-group-center-${suffix}@example.test`,
      passwordHash,
      passwordSetAt: new Date(),
      role: "EDUKATIVNI_CENTAR",
    },
    {
      firstName: "Browser",
      lastName: "Group admin",
      email: `browser-group-admin-${suffix}@example.test`,
      passwordHash,
      passwordSetAt: new Date(),
      role: "ADMIN",
    },
  ]).returning();
  if (!owner || !firstEmployeeUser || !secondEmployeeUser || !foreignEmployeeUser
    || !unavailableEmployeeUser || !centerOwner || !admin) {
    throw new Error("Could not create group consent users.");
  }

  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner.id,
    name: `Browser group salon ${suffix}`,
    slug: `browser-group-salon-${suffix}`,
    city: "Beograd",
    municipality: "Vračar",
    address: "Test 1",
    postalCode: "11000",
    phone: "+381601234567",
    email: `browser-group-salon-${suffix}@example.test`,
    shortDescription: "Group consent fixture.",
    description: "Isolated browser fixture for group online consent.",
    imageUrl: "/browser-test.jpg",
  }).returning();
  if (!salon) throw new Error("Could not create group consent salon.");

  const [foreignSalon] = await db.insert(salonsTable).values({
    ownerId: owner.id,
    name: `Browser foreign salon ${suffix}`,
    slug: `browser-foreign-salon-${suffix}`,
    city: "Beograd",
    municipality: "Zemun",
    address: "Test 2",
    postalCode: "11080",
    phone: "+381601234568",
    email: `browser-foreign-salon-${suffix}@example.test`,
    shortDescription: "Foreign salon fixture.",
    description: "Second salon context for employee enrollment authorization.",
    imageUrl: "/browser-test.jpg",
  }).returning();
  if (!foreignSalon) throw new Error("Could not create foreign salon context.");

  const employeeUsers = [firstEmployeeUser, secondEmployeeUser];
  const employees = await db.insert(employeesTable).values(employeeNames.map((name, index) => ({
    salonId: salon.id,
    userId: employeeUsers[index]!.id,
    name,
    role: "Stilist",
    bio: "Active employee for group consent browser fixture.",
    avatarUrl: "/browser-employee.jpg",
  }))).returning();
  if (employees.length !== 2 || !employees[0] || !employees[1]) {
    throw new Error("Could not create two group consent employees.");
  }
  await db.insert(employeeLocationAssignmentsTable).values(employees.map((employee, index) => ({
    employeeId: employee.id,
    salonId: salon.id,
    active: true,
    isDefault: index === 0,
  })));
  const [foreignEmployee, unavailableEmployee] = await db.insert(employeesTable).values([
    {
      salonId: foreignSalon.id,
      userId: foreignEmployeeUser.id,
      name: `Browser strani kolega ${suffix}`,
      role: "Stilist",
      bio: "Employee assigned to a different salon context.",
      avatarUrl: "/browser-employee.jpg",
    },
    {
      salonId: salon.id,
      userId: unavailableEmployeeUser.id,
      name: `Browser nedostupni kolega ${suffix}`,
      role: "Stilist",
      bio: "Employee without an active assignment at the selected salon.",
      avatarUrl: "/browser-employee.jpg",
    },
  ]).returning();
  if (!foreignEmployee || !unavailableEmployee) {
    throw new Error("Could not create unauthorized employee fixtures.");
  }
  await db.insert(employeeLocationAssignmentsTable).values([
    {
      employeeId: foreignEmployee.id,
      salonId: foreignSalon.id,
      active: true,
      isDefault: true,
    },
    {
      employeeId: unavailableEmployee.id,
      salonId: salon.id,
      active: false,
      isDefault: true,
    },
  ]);
  await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));
  await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, firstEmployeeUser.id));
  await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, secondEmployeeUser.id));

  const [center] = await db.insert(educationCentersTable).values({
    ownerId: centerOwner.id,
    name: `Browser group center ${suffix}`,
    city: "Beograd",
    description: "Verified group consent browser fixture.",
    imageUrl: "/browser-center.jpg",
    verificationStatus: "verified",
    verifiedAt: new Date(),
    verifiedByUserId: admin.id,
  }).returning();
  if (!center) throw new Error("Could not create group consent education center.");
  const [plan] = await db.insert(subscriptionPlansTable).values({
    name: `Browser group plan ${suffix}`,
    price: 0,
    features: [],
    limits: {},
  }).returning();
  if (!plan) throw new Error("Could not create group consent subscription plan.");
  await db.insert(educationCenterSubscriptionsTable).values({
    centerId: center.id,
    planId: plan.id,
    status: "active",
    dueAmount: 0,
    currentPeriodEnd: new Date(Date.now() + 86_400_000),
  });
  const [course] = await db.insert(coursesTable).values({
    centerId: center.id,
    title: `Browser online group course ${suffix}`,
    description: "Published online course for group consent browser coverage.",
    category: "Browser test",
    format: "online",
    city: "Beograd",
    price: 12_000,
    duration: "4 nedelje",
    certification: true,
    imageUrl: "/browser-course.jpg",
    published: true,
    onlineAccessDays: 45,
    extensionPrice1Month: 1_000,
    extensionPrice3Months: 2_500,
    extensionPrice6Months: 4_000,
    groupDiscountMinimum: 2,
    groupDiscountPercent: 10,
  }).returning();
  if (!course) throw new Error("Could not create published online group course.");
  const [secondCourse] = await db.insert(coursesTable).values({
    centerId: center.id,
    title: `Browser second online group course ${suffix}`,
    description: "Second published online course for stale consent regression coverage.",
    category: "Browser test",
    format: "online",
    city: "Beograd",
    price: 15_000,
    duration: "6 nedelja",
    certification: true,
    imageUrl: "/browser-course.jpg",
    published: true,
    onlineAccessDays: 60,
    groupDiscountMinimum: 2,
    groupDiscountPercent: 5,
  }).returning();
  if (!secondCourse) throw new Error("Could not create second published online group course.");
  const [internalCourse] = await db.insert(coursesTable).values({
    salonId: salon.id,
    title: `Browser internal employee course ${suffix}`,
    description: "Salon-owned online course for positive colleague enrollment coverage.",
    category: "Browser test",
    format: "online",
    city: "Beograd",
    price: 0,
    duration: "1 nedelja",
    certification: false,
    imageUrl: "/browser-course.jpg",
    published: true,
    onlineAccessDays: 30,
    extensionPrice1Month: 1_000,
    extensionPrice3Months: 2_500,
    extensionPrice6Months: 4_000,
  }).returning();
  if (!internalCourse) throw new Error("Could not create salon-owned employee course.");

  return {
    ownerId: owner.id,
    ownerEmail: owner.email,
    ownerPassword,
    employeeUserIds: [firstEmployeeUser.id, secondEmployeeUser.id],
    employeeEmails: [firstEmployeeUser.email, secondEmployeeUser.email],
    employeeIds: [employees[0].id, employees[1].id],
    employeeNames,
    foreignEmployeeUserId: foreignEmployeeUser.id,
    foreignEmployeeId: foreignEmployee.id,
    unavailableEmployeeUserId: unavailableEmployeeUser.id,
    unavailableEmployeeId: unavailableEmployee.id,
    salonId: salon.id,
    foreignSalonId: foreignSalon.id,
    centerId: center.id,
    centerOwnerId: centerOwner.id,
    adminId: admin.id,
    planId: plan.id,
    courseId: course.id,
    secondCourseId: secondCourse.id,
    internalCourseId: internalCourse.id,
  };
}



async function cleanupFixture(fixture: Fixture) {
  await db.delete(coursesTable).where(
    and(
      eq(coursesTable.centerId, fixture.centerId),
      eq(coursesTable.category, "Browser test"),
    ),
  );
  await db.delete(educationCenterSubscriptionsTable)
    .where(eq(educationCenterSubscriptionsTable.centerId, fixture.centerId));
  await db.delete(educationCentersTable).where(eq(educationCentersTable.id, fixture.centerId));
  await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, fixture.planId));
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.foreignSalonId));
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.foreignEmployeeUserId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.unavailableEmployeeUserId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.employeeUserIds[0]));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.employeeUserIds[1]));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.centerOwnerId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.adminId));
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`online group consent gates enrollment and remains accessible on ${viewport.name}`, async ({ page }) => {
    test.setTimeout(60_000);
    const fixture = await createFixture();
    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      expect((await page.request.post("/api/auth/login", {
        data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
      })).ok()).toBeTruthy();
      await page.goto(`/biznis/edukacije/${fixture.courseId}`);

      await page.getByRole("button", { name: "Grupna prijava" }).click();
      const firstEmployee = page.getByRole("checkbox", { name: fixture.employeeNames[0], exact: true });
      const secondEmployee = page.getByRole("checkbox", { name: fixture.employeeNames[1], exact: true });
      await firstEmployee.click();
      await secondEmployee.click();
      await expect(firstEmployee).toBeChecked();
      await expect(secondEmployee).toBeChecked();

      const submit = page.getByRole("button", { name: "Prijavi 2 polaznika" });
      const consent = page.getByRole("checkbox", { name: DIGITAL_CONTENT_CONSENT_TEXT });
      const help = page.locator("#education-group-digital-consent-help");
      await expect(submit).toBeDisabled();
      await expect(consent).toHaveAttribute("aria-describedby", "education-group-digital-consent-help");
      await expect(page.getByText(DIGITAL_CONTENT_CONSENT_TEXT, { exact: true })).toBeVisible();
      await expect(help).toContainText(GROUP_CONSENT_HELP);

      await page.getByText(DIGITAL_CONTENT_CONSENT_TEXT, { exact: true }).click();
      await expect(consent).toBeChecked();
      await expect(submit).toBeEnabled();

      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

      await submit.click();
      await expect(page.getByText(/Grupna prijava za 2 polaznika je primljena\./)).toBeVisible();

      const enrollments = await db.select({ id: courseEnrollmentsTable.id })
        .from(courseEnrollmentsTable)
        .where(and(
          eq(courseEnrollmentsTable.courseId, fixture.courseId),
          eq(courseEnrollmentsTable.purchaserId, fixture.ownerId),
        ));
      expect(enrollments).toHaveLength(2);

      const persisted = await db.select().from(courseEnrollmentsTable)
        .where(and(
          eq(courseEnrollmentsTable.courseId, fixture.courseId),
          eq(courseEnrollmentsTable.purchaserId, fixture.ownerId),
        ));
      expect(persisted.map((enrollment) => enrollment.employeeId).sort())
        .toEqual([...fixture.employeeIds].sort());
      for (const enrollment of persisted) {
        expect(enrollment).toMatchObject({
          purchaserId: fixture.ownerId,
          salonId: fixture.salonId,
          status: "pending",
          paymentStatus: "pending",
          accessGrantedAt: null,
          accessExpiresAt: null,
          accessDaysSnapshot: 45,
          digitalContentConsentUserId: fixture.ownerId,
          digitalContentConsentTextSnapshot: DIGITAL_CONTENT_CONSENT_TEXT,
          extensionPricesSnapshot: {
            oneMonth: 1_000,
            threeMonths: 2_500,
            sixMonths: 4_000,
          },
        });
        expect(enrollment.digitalContentConsentAt).toBeInstanceOf(Date);
        expect(enrollment.digitalContentConsentVersionSnapshot).toBeTruthy();
      }
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test(`online group consent resets across courses and group-mode reopening on ${viewport.name}`, async ({ page }) => {
    test.setTimeout(60_000);
    const fixture = await createFixture();
    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      expect((await page.request.post("/api/auth/login", {
        data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
      })).ok()).toBeTruthy();
      await page.goto(`/biznis/edukacije/${fixture.courseId}`);

      await page.getByRole("button", { name: "Grupna prijava" }).click();
      await page.getByRole("checkbox", { name: fixture.employeeNames[0], exact: true }).click();
      await page.getByRole("checkbox", { name: fixture.employeeNames[1], exact: true }).click();
      const consent = page.getByRole("checkbox", { name: DIGITAL_CONTENT_CONSENT_TEXT });
      await consent.click();
      await expect(consent).toBeChecked();
      await expect(page.getByRole("button", { name: "Prijavi 2 polaznika" })).toBeEnabled();

      await page.getByRole("link", { name: "Nazad na katalog" }).click();
      await page.locator(`a[href="/biznis/edukacije/${fixture.secondCourseId}"]`).click();
      await page.getByRole("button", { name: "Grupna prijava" }).click();
      await page.getByRole("checkbox", { name: fixture.employeeNames[0], exact: true }).click();
      await page.getByRole("checkbox", { name: fixture.employeeNames[1], exact: true }).click();
      await expect(page.getByRole("checkbox", { name: DIGITAL_CONTENT_CONSENT_TEXT })).not.toBeChecked();
      await expect(page.getByRole("button", { name: "Prijavi 2 polaznika" })).toBeDisabled();

      await page.getByRole("button", { name: "Odustani" }).click();
      await page.getByRole("button", { name: "Grupna prijava" }).click();
      await page.getByRole("checkbox", { name: fixture.employeeNames[0], exact: true }).click();
      await page.getByRole("checkbox", { name: fixture.employeeNames[1], exact: true }).click();
      await expect(page.getByRole("checkbox", { name: DIGITAL_CONTENT_CONSENT_TEXT })).not.toBeChecked();
      await expect(page.getByRole("button", { name: "Prijavi 2 polaznika" })).toBeDisabled();

      const enrollments = await db.select({ id: courseEnrollmentsTable.id })
        .from(courseEnrollmentsTable)
        .where(eq(courseEnrollmentsTable.purchaserId, fixture.ownerId));
      expect(enrollments).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test(`individual online consent resets across learners and courses on ${viewport.name}`, async ({ page }) => {
    test.setTimeout(60_000);
    const fixture = await createFixture();
    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      expect((await page.request.post("/api/auth/login", {
        data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
      })).ok()).toBeTruthy();
      await page.goto(`/biznis/edukacije/${fixture.courseId}`);

      const learner = page.getByRole("combobox", { name: "Polaznik" });
      const consent = page.getByRole("checkbox", { name: DIGITAL_CONTENT_CONSENT_TEXT });
      const submit = page.getByRole("button", { name: "Rezerviši mesto" });

      await learner.click();
      await page.getByRole("option", { name: fixture.employeeNames[0], exact: true }).click();
      await consent.click();
      await expect(consent).toBeChecked();
      await expect(submit).toBeEnabled();

      await learner.click();
      await page.getByRole("option", { name: fixture.employeeNames[1], exact: true }).click();
      await expect(consent).not.toBeChecked();
      await expect(submit).toBeDisabled();

      await consent.click();
      await expect(consent).toBeChecked();
      await expect(submit).toBeEnabled();

      await page.getByRole("link", { name: "Nazad na katalog" }).click();
      await page.locator(`a[href="/biznis/edukacije/${fixture.secondCourseId}"]`).click();
      await expect(page.getByRole("checkbox", { name: DIGITAL_CONTENT_CONSENT_TEXT })).not.toBeChecked();
      await expect(page.getByRole("button", { name: "Rezerviši mesto" })).toBeDisabled();

      const enrollments = await db.select({ id: courseEnrollmentsTable.id })
        .from(courseEnrollmentsTable)
        .where(eq(courseEnrollmentsTable.purchaserId, fixture.ownerId));
      expect(enrollments).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test(`employee consent and colleague salon guard work on ${viewport.name}`, async ({ page }) => {
    test.setTimeout(60_000);
    const fixture = await createFixture();
    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      expect((await page.request.post("/api/auth/login", {
        data: { email: fixture.employeeEmails[0], password: fixture.ownerPassword },
      })).ok()).toBeTruthy();
      await page.goto(`/biznis/edukacije/${fixture.courseId}`);

      const learner = page.getByRole("combobox", { name: "Polaznik" });
      const consent = page.getByRole("checkbox", { name: DIGITAL_CONTENT_CONSENT_TEXT });
      const submit = page.getByRole("button", { name: "Rezerviši mesto" });

      await expect(learner).toContainText("Ja lično");
      await consent.click();
      await expect(consent).toBeChecked();
      await expect(submit).toBeEnabled();

      await learner.click();
      await page.getByRole("option", { name: fixture.employeeNames[1], exact: true }).click();
      await expect(consent).not.toBeChecked();
      await expect(submit).toBeDisabled();

      for (const employeeId of [fixture.foreignEmployeeId, fixture.unavailableEmployeeId]) {
        const response = await page.request.post(`/api/education/courses/${fixture.courseId}/enrollments`, {
          headers: { "idempotency-key": randomUUID() },
          data: { employeeId, digitalContentConsent: true },
        });
        expect(response.status()).toBe(403);

        const rejectedEnrollments = await db.select({ id: courseEnrollmentsTable.id })
          .from(courseEnrollmentsTable)
          .where(and(
            eq(courseEnrollmentsTable.courseId, fixture.courseId),
            eq(courseEnrollmentsTable.purchaserId, fixture.employeeUserIds[0]),
          ));
        expect(rejectedEnrollments).toHaveLength(0);

        const rejectedPaymentObligations = await db.select({ id: educationPaymentObligationsTable.id })
          .from(educationPaymentObligationsTable)
          .where(eq(educationPaymentObligationsTable.centerId, fixture.centerId));
        expect(rejectedPaymentObligations).toHaveLength(0);
      }

      const validResponse = await page.request.post(`/api/education/courses/${fixture.internalCourseId}/enrollments`, {
        headers: { "idempotency-key": randomUUID() },
        data: { employeeId: fixture.employeeIds[1], digitalContentConsent: true },
      });
      expect(validResponse.status()).toBe(201);

      const enrollments = await db.select().from(courseEnrollmentsTable)
        .where(and(
          eq(courseEnrollmentsTable.courseId, fixture.internalCourseId),
          eq(courseEnrollmentsTable.purchaserId, fixture.employeeUserIds[0]),
        ));
      expect(enrollments).toHaveLength(1);
      expect(enrollments[0]).toMatchObject({
        employeeId: fixture.employeeIds[1],
        salonId: fixture.salonId,
        status: "active",
        paymentStatus: "paid",
      });

      const paymentObligations = await db.select({ id: educationPaymentObligationsTable.id })
        .from(educationPaymentObligationsTable)
        .where(eq(educationPaymentObligationsTable.centerId, fixture.centerId));
      expect(paymentObligations).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });
}