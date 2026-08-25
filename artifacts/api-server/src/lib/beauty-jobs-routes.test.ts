import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { eq, inArray, like, sql } from "drizzle-orm";
import {
  beautyJobApplicationActionsTable, beautyJobCategoriesTable, beautyJobContactsTable, beautyJobListingAvailabilityTable, beautyJobListingsTable,
  beautyJobModerationAuditTable, beautyJobNotificationsTable, beautyJobPlatformSettingsTable,
  beautyJobReportsTable, beautyJobSavedListingsTable, db, emailDeliveriesTable, jobseekerProfilesTable,
  educationCentersTable, employeeServicesTable, employeesTable, pool, salonsTable, servicesTable, smsDeliveriesTable, usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";
import {
  sendBeautyJobEmail,
  setBeautyJobEmailTransportForTests,
} from "./beauty-jobs-email";
import {
  retryFailedRetryableEmails,
  type TransactionalEmailTransport,
} from "./brevo";
import {
  BEAUTY_JOB_DELIVERY_ALERT_COOLDOWN_MS,
  runBeautyJobDeliveryFailureAlerts,
} from "./beauty-jobs-delivery-monitor";
import type { SmsProvider } from "./sms";

const suffix = randomUUID();
const createdUsers: string[] = [];
const createdListingIds: string[] = [];
let server: ReturnType<typeof app.listen> | undefined;

type Result = { status: number; body: any };
const cookie = (token?: string) => token ? { cookie: `${sessionCookieName}=${token}` } : {};
async function request(base: string, path: string, token?: string, method = "GET", body?: unknown): Promise<Result> {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...cookie(token) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function user(role: "ADMIN" | "CUSTOMER" | "EDUKATIVNI_CENTAR" | "INSTRUCTOR" | "JOBSEEKER" | "SALON_EMPLOYEE" | "SALON_OWNER" | "STUDENT", label: string) {
  const passwordHash = await hashPassword(`beauty-${suffix}`);
  const [created] = await db.insert(usersTable).values({
    firstName: label, lastName: "Beauty HTTP", email: `${label}-${suffix}@example.test`,
    passwordHash, passwordSetAt: new Date(), role,
  }).returning();
  assert.ok(created);
  createdUsers.push(created.id);
  return { user: created, token: await createSession(created.id) };
}

async function owner(label: string) {
  const result = await user("SALON_OWNER", label);
  const [salon] = await db.insert(salonsTable).values({
    ownerId: result.user.id, name: `${label} salon ${suffix}`, slug: `${label}-beauty-${suffix}`,
    city: "Beograd", municipality: "Vračar", address: "Test 1", postalCode: "11000",
    phone: "+381111234567", email: `${label}-salon-${suffix}@example.test`,
    shortDescription: "Test salon", description: "Test salon", imageUrl: "/test.jpg",
  }).returning();
  assert.ok(salon);
  await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, result.user.id));
  return { ...result, salon };
}

function body(categoryId: string, title: string, overrides: Record<string, unknown> = {}) {
  return { categoryId, type: "job", intent: "offering", title, description: `Opis ${title} koji je dovoljno dug.`,
    city: "Beograd", region: "Vračar", priceAmount: 1000, pricePeriod: "month", ...overrides };
}

async function insertApproved(categoryId: string, authorId: string, title: string, values: Record<string, any> = {}) {
  const [listing] = await db.insert(beautyJobListingsTable).values({
    categoryId, userId: authorId, postedByType: "user", type: "job", intent: "offering",
    title, description: `Izolovani opis ${title}`, city: "Beograd", region: "Vračar",
    priceAmount: 1000, pricePeriod: "month", status: "active", moderationStatus: "approved",
    expiresAt: new Date(Date.now() + 86400000), ...values,
  }).returning();
  assert.ok(listing);
  createdListingIds.push(listing.id);
  return listing;
}

async function run(): Promise<void> {
  await ensureBusinessGrowthSchema();
  let originalSettings: typeof beautyJobPlatformSettingsTable.$inferSelect | undefined;
  const originalAppBaseUrl = process.env["APP_BASE_URL"];
  process.env["APP_BASE_URL"] = "https://beauty-links.example.test/";
  const monitorAlertEventKeys: string[] = [];
  const monitorSmsEventKeys: string[] = [];
  const sentEmails: Array<{ email: string; subject: string; idempotencyKey: string; htmlContent: string }> = [];
  const routeTransport: TransactionalEmailTransport = {
    async send(input) {
      sentEmails.push({
        email: input.to.email,
        subject: input.subject,
        idempotencyKey: input.idempotencyKey,
          htmlContent: input.htmlContent,
      });
      return { messageId: `beauty-jobs-test-${sentEmails.length}` };
    },
  };
  setBeautyJobEmailTransportForTests(routeTransport);
  try {
    const [settings] = await db.select().from(beautyJobPlatformSettingsTable).limit(1);
    originalSettings = settings;
    const admin = await user("ADMIN", "admin");
    // Keep the established individual-author fixture name while moving its
    // role to the new account boundary; blockedCustomer proves the old role is
    // rejected without rewriting the rest of this broad regression suite.
    const customer = await user("JOBSEEKER", "jobseeker-author");
    const blockedCustomer = await user("CUSTOMER", "customer");
    const jobseeker = await user("JOBSEEKER", "jobseeker");
    const otherJobseeker = await user("JOBSEEKER", "other-jobseeker");
    const applicant = await user("JOBSEEKER", "applicant");
    const student = await user("STUDENT", "student-applicant");
    const instructor = await user("INSTRUCTOR", "instructor-applicant");
    const employee = await user("SALON_EMPLOYEE", "employee");
    const salonOwner = await owner("owner");
    const otherOwner = await owner("other-owner");
    const [hair, rental] = await Promise.all([
      db.select().from(beautyJobCategoriesTable).where(eq(beautyJobCategoriesTable.slug, "frizeri")).limit(1),
      db.select().from(beautyJobCategoriesTable).where(eq(beautyJobCategoriesTable.slug, "iznajmljivanje-opreme")).limit(1),
    ]);
    const hairCategory = hair[0], rentalCategory = rental[0];
    assert.ok(hairCategory && rentalCategory, "Beauty Poslovi categories must be installed");

    const publicListing = await insertApproved(hairCategory.id, customer.user.id, `Employee visible ${suffix}`);
    await db.update(beautyJobPlatformSettingsTable).set({ hourlyPostingLimit: 30 }).where(eq(beautyJobPlatformSettingsTable.id, originalSettings!.id));
    server = app.listen(0);
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const invalidEducationEmail = `invalid-center-${suffix}@example.test`;
    const invalidEducationRegistration = await request(base, "/auth/business-register", undefined, "POST", {
      firstName: "Milica",
      lastName: "Edukator",
      email: invalidEducationEmail,
      password: `Education-${suffix}`,
      phone: "+381641234567",
      businessType: "EDUCATION_CENTER",
      businessName: `Nevažeći centar ${suffix.slice(0, 8)}`,
      city: "Beograd",
      address: "Njegoševa 10",
      description: "Prekratko",
    });
    assert.equal(invalidEducationRegistration.status, 400, "education-center description is required and validated");
    assert.equal(
      (await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, invalidEducationEmail))).length,
      0,
      "a rejected registration leaves no user row behind",
    );

    const missingPibEmail = `missing-pib-center-${suffix}@example.test`;
    const missingPibRegistration = await request(base, "/auth/business-register", undefined, "POST", {
      firstName: "Milica",
      lastName: "Edukator",
      email: missingPibEmail,
      password: `Education-${suffix}`,
      phone: "+381641234567",
      businessType: "EDUCATION_CENTER",
      businessName: `Centar bez PIB-a ${suffix.slice(0, 8)}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Njegoševa 10",
      postalCode: "11000",
      description: "Stručne beauty edukacije sa dovoljno dugim opisom za validaciju registracije.",
    });
    assert.equal(missingPibRegistration.status, 400, "new education-center registration requires PIB");
    assert.equal(
      (await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, missingPibEmail))).length,
      0,
      "missing PIB rejects the complete registration transaction",
    );

    const educationPassword = `Education-${suffix}`;
    const educationRegistration = await request(base, "/auth/business-register", undefined, "POST", {
      firstName: "Milica",
      lastName: "Edukator",
      email: `registered-center-${suffix}@example.test`,
      password: educationPassword,
      phone: "+381641234567",
      businessType: "EDUCATION_CENTER",
      businessName: `Akademija ${suffix.slice(0, 8)}`,
      pib: "109876543",
      city: "Beograd",
      municipality: "Vračar",
      address: "Njegoševa 10",
      postalCode: "11000",
      contactEmail: `education-contact-${suffix}@example.test`,
      contactPhone: "+381641234568",
      contactAddress: "Njegoševa 10, Beograd",
      websiteUrl: "https://education.example.test",
      instagramUrl: "https://instagram.com/lumera_education_test",
      description: "Stručne beauty edukacije, praktični programi i sertifikacije za profesionalce.",
    });
    assert.equal(educationRegistration.status, 201, "education-center business registration succeeds");
    assert.equal(educationRegistration.body.user.role, "EDUKATIVNI_CENTAR", "education registration assigns the canonical role");
    createdUsers.push(educationRegistration.body.user.id);
    const [registeredEducationUser] = await db.select().from(usersTable)
      .where(eq(usersTable.id, educationRegistration.body.user.id)).limit(1);
    const [registeredEducationSalon] = await db.select().from(salonsTable)
      .where(eq(salonsTable.ownerId, educationRegistration.body.user.id)).limit(1);
    const [registeredEducationCenter] = await db.select().from(educationCentersTable)
      .where(eq(educationCentersTable.ownerId, educationRegistration.body.user.id)).limit(1);
    assert.ok(registeredEducationUser?.activeSalonId, "education registration sets an active salon workspace");
    assert.equal(registeredEducationUser.activeSalonId, registeredEducationSalon?.id, "active salon points to the created workspace");
    assert.equal(registeredEducationSalon?.active, false, "new operational workspace is private until onboarding completes");
    assert.equal(registeredEducationCenter?.description, "Stručne beauty edukacije, praktični programi i sertifikacije za profesionalce.");
    assert.equal(registeredEducationCenter?.pib, "109876543");
    assert.equal(registeredEducationCenter?.contactEmail, `education-contact-${suffix}@example.test`);
    assert.equal(registeredEducationCenter?.websiteUrl, "https://education.example.test");
    const educationToken = await createSession(educationRegistration.body.user.id);
    assert.equal((await request(base, "/salon/profile", educationToken)).status, 200, "education center can access salon-owner workspace APIs");
    const educationListing = await request(
      base,
      "/beauty-jobs",
      educationToken,
      "POST",
      body(hairCategory.id, `Instruktor edukacija ${suffix}`),
    );
    assert.equal(educationListing.status, 201, "education center can post a Beauty Poslovi listing");
    createdListingIds.push(educationListing.body.id);

    const registrationDigits = suffix.replace(/\D/g, "").slice(0, 6).padEnd(6, "7");
    const registrationPhone = `+38164${registrationDigits}`;
    const codeResponse = await request(base, "/auth/phone-verification/request", undefined, "POST", { phone: registrationPhone });
    assert.equal(codeResponse.status, 200, "JOBSEEKER registration can request phone verification");
    assert.match(codeResponse.body.developmentCode, /^\d{6}$/, "test registration returns a development phone code");
    const registrationInput = {
      firstName: "Novi", lastName: "Profesionalac", email: `registered-${suffix}@example.test`,
      phone: registrationPhone, phoneVerificationCode: codeResponse.body.developmentCode,
      password: `Jobseeker-${suffix}`, dateOfBirth: "1995-05-12",
      role: "ADMIN",
    };
    assert.equal(
      (await request(base, "/auth/jobseeker-register", undefined, "POST", { ...registrationInput, dateOfBirth: "2026-02-30" })).status,
      400,
      "JOBSEEKER registration rejects impossible calendar dates",
    );
    assert.equal(
      (await request(base, "/auth/jobseeker-register", undefined, "POST", { ...registrationInput, dateOfBirth: "2999-01-01" })).status,
      400,
      "JOBSEEKER registration rejects future birth dates",
    );
    const registered = await request(base, "/auth/jobseeker-register", undefined, "POST", registrationInput);
    assert.equal(registered.status, 201, "JOBSEEKER registration succeeds with a verified phone and DOB");
    createdUsers.push(registered.body.user.id);
    assert.equal(registered.body.user.role, "JOBSEEKER", "browser-supplied role cannot change the registration role");
    assert.equal(registered.body.user.dateOfBirth, "1995-05-12", "registration preserves the calendar-only date of birth");

    assert.equal((await request(base, "/jobseeker/profile", jobseeker.token)).status, 404, "new JOBSEEKER starts without a completed professional profile");
    assert.equal((await request(base, "/jobseeker/profile", blockedCustomer.token)).status, 403, "CUSTOMER cannot read a JOBSEEKER profile");
    await db.insert(jobseekerProfilesTable).values({
      userId: otherJobseeker.user.id,
      bio: "Migrirani profesionalni profil",
      portfolioMedia: [
        "/api/media/10000000-0000-4000-8000-000000000001",
        "/api/media/10000000-0000-4000-8000-000000000002",
        "/api/media/10000000-0000-4000-8000-000000000003",
      ],
      skillTags: ["Masaža"],
      categoryTags: ["estetika-masaza"],
    });
    const migratedProfile = await request(base, "/jobseeker/profile", otherJobseeker.token);
    assert.equal(migratedProfile.status, 200, "migrated JOBSEEKER without a historical DOB can still use the professional profile");
    assert.equal(migratedProfile.body.dateOfBirth, null, "legacy missing DOB remains explicit instead of failing response serialization");
    assert.equal(
      (await request(base, "/jobseeker/profile", jobseeker.token, "PUT", {
        bio: "Profesionalni profil", portfolioMedia: ["/api/media/00000000-0000-4000-8000-000000000001", "/api/media/00000000-0000-4000-8000-000000000002", "/api/media/00000000-0000-4000-8000-000000000003"],
        skillTags: ["Balayage"], categoryTags: ["frizeri"],
      })).status,
      400,
      "JOBSEEKER cannot claim portfolio media it does not own",
    );
    assert.equal(
      (await request(base, "/jobseeker/salon-interests", jobseeker.token, "PUT", { salonIds: [salonOwner.salon.id] })).status,
      200,
      "JOBSEEKER may record salon interests",
    );
    assert.deepEqual((await request(base, "/jobseeker/salon-interests", jobseeker.token)).body, [salonOwner.salon.id], "JOBSEEKER reads only own salon interests");
    assert.deepEqual((await request(base, "/jobseeker/salon-interests", otherJobseeker.token)).body, [], "salon interests are isolated between JOBSEEKER accounts");
    assert.equal((await request(base, "/jobseeker/salon-interests", blockedCustomer.token)).status, 403, "CUSTOMER cannot use JOBSEEKER salon interests");
    for (const path of ["/customer/favorites", `/customer/reviews/${salonOwner.salon.id}`, "/loyalty/status", "/retail/cart", "/retail/cart-summary"]) {
      assert.equal((await request(base, path, jobseeker.token)).status, 403, `JOBSEEKER is blocked from ${path}`);
    }

    // Widget bookings remain guest/customer-only even though the widget itself
    // is publicly embedded.  A real eligible employee/service pair keeps this
    // assertion on the allocation route rather than on validation.
    await db.update(salonsTable).set({ isVerified: true }).where(eq(salonsTable.id, salonOwner.salon.id));
    const [widgetEmployee] = await db.insert(employeesTable).values({
      salonId: salonOwner.salon.id, name: `Widget employee ${suffix}`, role: "Stylist",
      bio: "Widget test employee", avatarUrl: "/widget-test.jpg",
    }).returning();
    const [widgetService] = await db.insert(servicesTable).values({
      salonId: salonOwner.salon.id, categoryName: "Test", name: `Widget service ${suffix}`,
      description: "Widget booking regression service", durationMinutes: 30, price: 1000, imageUrl: "/widget-test.jpg",
    }).returning();
    assert.ok(widgetEmployee && widgetService);
    await db.insert(employeeServicesTable).values({ employeeId: widgetEmployee.id, serviceId: widgetService.id });
    const widgetDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const widgetBooking = (startTime: string) => ({
      serviceId: widgetService.id, date: widgetDate, startTime,
      firstName: "Widget", lastName: "Booking", phone: "+381641234567",
    });
    assert.equal(
      (await request(base, `/widget/salons/${salonOwner.salon.slug}/appointments`, undefined, "POST", widgetBooking("09:00"))).status,
      201,
      "guest widget booking remains available",
    );
    assert.equal(
      (await request(base, `/widget/salons/${salonOwner.salon.slug}/appointments`, blockedCustomer.token, "POST", widgetBooking("10:00"))).status,
      201,
      "CUSTOMER widget booking remains available",
    );
    assert.equal(
      (await request(base, `/widget/salons/${salonOwner.salon.slug}/appointments`, jobseeker.token, "POST", widgetBooking("11:00"))).status,
      403,
      "authenticated JOBSEEKER is blocked from widget booking",
    );
    const publicCategories = await request(base, "/beauty-jobs/categories");
    assert.equal(publicCategories.status, 200);
    for (const slug of ["barberi", "kozmeticari", "lash-brow", "masaza-terapeuti", "sminkeri", "pmu", "estetika-anti-aging", "pomocno-osoblje", "tattoo-piercing"]) {
      assert.ok(publicCategories.body.categories.some((category: { slug: string }) => category.slug === slug), `${slug} is an active Beauty Poslovi filter`);
    }

    assert.equal((await request(base, "/beauty-jobs/categories", employee.token)).status, 200, "public categories remain available to the employee applicant-management filter");
    // Employees remain denied on the public listing module outside their
    // narrow salon-applicant management capability.
    for (const path of ["/beauty-jobs", `/beauty-jobs/${publicListing.id}`, `/beauty-jobs/${publicListing.id}/report`]) {
      const r = await request(base, path, employee.token, path.endsWith("/report") ? "POST" : "GET", path.endsWith("/report") ? { reason: "Neprimeren sadržaj" } : undefined);
      assert.equal(r.status, 403, `employee must be denied ${path}`);
    }
    for (const path of ["/beauty-jobs", "/beauty-jobs/mine", `/beauty-jobs/${publicListing.id}/save`, `/beauty-jobs/${publicListing.id}/contact`, "/beauty-jobs/inbox"]) {
      const r = await request(base, path, employee.token, path === "/beauty-jobs/mine" || path === "/beauty-jobs/inbox" ? "GET" : "POST", path === "/beauty-jobs" ? body(hairCategory.id, "Employee blocked") : path.endsWith("/contact") ? { message: "Pozdrav" } : undefined);
      assert.equal(r.status, 403, `employee must be denied protected ${path}`);
    }

    // JOBSEEKER is the sole individual marketplace role.  The legacy customer
    // and student account types must never inherit individual job-board access.
    const jobseekerCreate = await request(base, "/beauty-jobs", jobseeker.token, "POST", body(hairCategory.id, `Jobseeker ${suffix}`));
    assert.equal(jobseekerCreate.status, 201, "JOBSEEKER may create an individual listing");
    createdListingIds.push(jobseekerCreate.body.id);
    assert.equal((await request(base, "/beauty-jobs/mine", jobseeker.token)).status, 200, "JOBSEEKER may manage own listings");
    assert.equal((await request(base, `/beauty-jobs/${publicListing.id}/save`, jobseeker.token, "POST")).status, 200, "JOBSEEKER may save listings");
    for (const blocked of [blockedCustomer, student]) {
      assert.equal((await request(base, "/beauty-jobs", blocked.token, "POST", body(hairCategory.id, `Blocked ${blocked.user.id}`))).status, 403, `${blocked.user.role} cannot create individual listings`);
      assert.equal((await request(base, "/beauty-jobs/mine", blocked.token)).status, 403, `${blocked.user.role} cannot manage individual listings`);
      assert.equal((await request(base, `/beauty-jobs/${publicListing.id}/save`, blocked.token, "POST")).status, 403, `${blocked.user.role} cannot save listings`);
      assert.equal((await request(base, `/beauty-jobs/${publicListing.id}/contact`, blocked.token, "POST", { message: "Nedozvoljeno" })).status, 403, `${blocked.user.role} cannot contact authors`);
    }
    assert.equal((await request(base, `/beauty-jobs/${jobseekerCreate.body.id}`, otherJobseeker.token, "PATCH", { title: "cross-account" })).status, 403, "JOBSEEKER cannot manage another JOBSEEKER's listing");
    assert.equal(
      (await request(base, "/beauty-jobs", jobseeker.token, "POST", body(hairCategory.id, `Urgent non-freelance ${suffix}`, { isUrgent: true }))).status,
      400,
      "the HTTP API rejects urgent non-freelance listings",
    );
    const urgentFreelance = await request(base, "/beauty-jobs", jobseeker.token, "POST", body(hairCategory.id, `Urgent freelance ${suffix}`, {
      type: "freelance", isUrgent: true,
    }));
    assert.equal(urgentFreelance.status, 201, "JOBSEEKER may create an urgent freelance listing");
    createdListingIds.push(urgentFreelance.body.id);

    // Course enrollment is intentionally separate from the job-board boundary:
    // STUDENT remains a learner, JOBSEEKER is accepted, and CUSTOMER is denied
    // before any course lookup.  A syntactically valid absent id isolates roles.
    const absentCourseId = randomUUID();
    assert.equal((await request(base, `/education/courses/${absentCourseId}/enrollments`, jobseeker.token, "POST", {})).status, 404, "JOBSEEKER passes education role gate");
    assert.equal((await request(base, `/education/courses/${absentCourseId}/enrollments`, student.token, "POST", {})).status, 404, "STUDENT remains eligible for education");
    assert.equal((await request(base, `/education/courses/${absentCourseId}/enrollments`, blockedCustomer.token, "POST", {})).status, 403, "CUSTOMER is denied education enrollment");

    const customerCreate = await request(base, "/beauty-jobs", customer.token, "POST", body(hairCategory.id, `Customer ${suffix}`));
    assert.equal(customerCreate.status, 201);
    const customerListing = customerCreate.body;
    createdListingIds.push(customerListing.id);
    assert.equal(customerListing.moderationStatus, "pending");
    assert.equal((await request(base, `/beauty-jobs/${customerListing.id}`)).status, 404, "pending listing remains private");
    assert.equal((await request(base, `/admin/beauty-jobs/${customerListing.id}/preview`)).status, 401, "admin preview requires authentication");
    assert.equal((await request(base, `/admin/beauty-jobs/${customerListing.id}/preview`, customer.token)).status, 403, "admin preview rejects non-admin users");
    const pendingAdminPreview = await request(base, `/admin/beauty-jobs/${customerListing.id}/preview`, admin.token);
    assert.equal(pendingAdminPreview.status, 200, "admin can privately preview a pending listing");
    assert.equal(pendingAdminPreview.body.listing.id, customerListing.id);
    assert.equal(pendingAdminPreview.body.listing.moderationStatus, "pending");
    await db.update(beautyJobListingsTable)
      .set({ expiresAt: sql`now() + interval '3 days'` })
      .where(eq(beautyJobListingsTable.id, customerListing.id));
    const pendingExpiringQueue = await request(base, "/admin/beauty-jobs/queue?status=expiring", admin.token);
    assert.equal(pendingExpiringQueue.status, 200);
    assert.equal(
      pendingExpiringQueue.body.listings.some((item: any) => item.id === customerListing.id),
      false,
      "an unapproved pending listing must not appear in the expiring queue",
    );
    const ownerCreate = await request(base, "/beauty-jobs", salonOwner.token, "POST", body(hairCategory.id, `Owner ${suffix}`));
    assert.equal(ownerCreate.status, 201);
    const ownerListing = ownerCreate.body;
    createdListingIds.push(ownerListing.id);
    assert.equal(ownerListing.postedByType, "salon");
    const customerMine = await request(base, "/beauty-jobs/mine", customer.token);
    const ownerMine = await request(base, "/beauty-jobs/mine", salonOwner.token);
    assert.ok(customerMine.body.items.some((x: any) => x.id === customerListing.id) && !customerMine.body.items.some((x: any) => x.id === ownerListing.id), "customer scope must exclude salon-author listings");
    assert.ok(ownerMine.body.items.some((x: any) => x.id === ownerListing.id) && !ownerMine.body.items.some((x: any) => x.id === customerListing.id), "owner scope must exclude customer-author listings");
    assert.equal((await request(base, `/beauty-jobs/${customerListing.id}`, otherOwner.token, "PATCH", { title: "steal" })).status, 403);

    const concurrentApprovals = await Promise.all([
      request(base, `/admin/beauty-jobs/${customerListing.id}/moderation`, admin.token, "POST", { action: "approve" }),
      request(base, `/admin/beauty-jobs/${customerListing.id}/moderation`, admin.token, "POST", { action: "approve" }),
    ]);
    assert.deepEqual(concurrentApprovals.map((result) => result.status), [200, 200]);
    assert.equal((await request(base, `/beauty-jobs/${customerListing.id}`)).status, 200, "approved listing becomes publicly visible");
    assert.equal(
      sentEmails.filter((email) => email.subject.includes("Oglas je odobren")).length,
      1,
      "concurrent identical moderation emits one email",
    );
    assert.ok(
      sentEmails.find((email) => email.subject.includes("Oglas je odobren"))?.htmlContent.includes(
        `https://beauty-links.example.test/poslovi/nalog/oglasi?tab=my-jobs&amp;listingId=${customerListing.id}`,
      ),
      "moderation email links to the exact customer listing management screen",
    );
    assert.equal(
      (await request(base, `/admin/beauty-jobs/${ownerListing.id}/moderation`, admin.token, "POST", { action: "approve" })).status,
      200,
    );
    assert.ok(
      sentEmails.find((email) => email.email === salonOwner.user.email.toLowerCase()
        && email.subject.includes("Oglas je odobren"))?.htmlContent.includes(
        `https://beauty-links.example.test/biznis/poslovi?tab=my-jobs&amp;listingId=${ownerListing.id}`,
      ),
      "moderation email uses the business management route for a salon owner",
    );
    const rejectedReason = `Nedostaje obavezna informacija ${suffix}`;
    const rejectedOwner = await request(base, `/admin/beauty-jobs/${ownerListing.id}/moderation`, admin.token, "POST", {
      action: "reject",
      reason: rejectedReason,
      internalNote: `Privatna napomena ${suffix}`,
    });
    assert.equal(rejectedOwner.status, 200);
    assert.equal(rejectedOwner.body.moderationStatus, "rejected");
    assert.equal(rejectedOwner.body.moderationReason, rejectedReason, "the moderation response preserves the rejection reason");
    const pendingQueue = await request(base, "/admin/beauty-jobs/queue", admin.token);
    assert.equal(pendingQueue.status, 200);
    assert.equal(pendingQueue.body.listings.some((item: any) => item.id === ownerListing.id), false, "rejected listings must leave the pending moderation queue");
    const rejectedQueue = await request(base, "/admin/beauty-jobs/rejected?period=all", admin.token);
    assert.equal(rejectedQueue.status, 200);
    const rejectedRecord = rejectedQueue.body.items.find((item: any) => item.id === ownerListing.id);
    assert.equal(rejectedRecord?.moderationReason, rejectedReason, "rejected listing review exposes the saved moderation reason");
    assert.equal(rejectedRecord?.internalNote, `Privatna napomena ${suffix}`, "rejected history exposes the administrator-only note");
    assert.equal(typeof rejectedRecord?.moderatedAt, "string", "rejected listing review exposes its decision time");
    const ownerAudit = await db.select().from(beautyJobModerationAuditTable).where(eq(beautyJobModerationAuditTable.listingId, ownerListing.id));
    assert.ok(ownerAudit.some((entry) => entry.action === "reject" && entry.publicReason === rejectedReason && entry.internalNote === `Privatna napomena ${suffix}`), "individual rejection has an immutable audit row");
    const adminPreview = await request(base, `/admin/beauty-jobs/${ownerListing.id}/preview`, admin.token);
    assert.equal(adminPreview.status, 200);
    assert.equal(adminPreview.body.listing.id, ownerListing.id);
    assert.deepEqual(
      adminPreview.body.moderationHistory.map((entry: any) => entry.action),
      ["approve", "reject"],
      "admin preview returns the complete append-only history in decision order",
    );
    assert.ok(
      adminPreview.body.moderationHistory.every((entry: any) => entry.administratorDisplayName === `${admin.user.firstName} ${admin.user.lastName}`),
      "every moderation event identifies its administrator",
    );
    assert.equal(adminPreview.body.moderationHistory[1].publicReason, rejectedReason);
    assert.equal(adminPreview.body.moderationHistory[1].internalNote, `Privatna napomena ${suffix}`);
    assert.equal(typeof adminPreview.body.moderationHistory[1].createdAt, "string");
    assert.equal((await request(base, "/admin/beauty-jobs/rejected?period=custom&from=not-a-date&to=2026-01-01", admin.token)).status, 400);
    const initialModerationNotifications = await db.select().from(beautyJobNotificationsTable)
      .where(eq(beautyJobNotificationsTable.listingId, customerListing.id));
    assert.equal(
      initialModerationNotifications.filter((item) => item.type === "moderation").length,
      1,
      "concurrent identical moderation emits one in-app notification",
    );
    // Bulk moderation validates the complete request, records every decision,
    // and must not notify again when the same decision is retried.
    const bulkApprove = await request(base, "/beauty-jobs", customer.token, "POST", body(hairCategory.id, `Bulk approve ${suffix}`));
    const bulkReject = await request(base, "/beauty-jobs", customer.token, "POST", body(hairCategory.id, `Bulk reject ${suffix}`));
    assert.equal(bulkApprove.status, 201); assert.equal(bulkReject.status, 201);
    createdListingIds.push(bulkApprove.body.id, bulkReject.body.id);
    assert.equal((await request(base, "/admin/beauty-jobs/bulk-moderation", admin.token, "POST", {
      listingIds: [bulkReject.body.id], action: "reject",
    })).status, 400, "bulk rejection requires a public reason");
    assert.equal((await request(base, "/admin/beauty-jobs/bulk-moderation", admin.token, "POST", {
      listingIds: [bulkApprove.body.id, bulkApprove.body.id], action: "approve",
    })).status, 400, "bulk ids must be unique");
    assert.equal((await request(base, "/admin/beauty-jobs/bulk-moderation", admin.token, "POST", {
      listingIds: [bulkReject.body.id], action: "reject", reason: "x".repeat(1001),
    })).status, 400, "bulk rejection reason enforces the API contract maximum");
    const closedBulk = await request(base, "/beauty-jobs", customer.token, "POST", body(hairCategory.id, `Bulk closed ${suffix}`));
    const expiredBulk = await request(base, "/beauty-jobs", customer.token, "POST", body(hairCategory.id, `Bulk expired ${suffix}`));
    assert.equal(closedBulk.status, 201); assert.equal(expiredBulk.status, 201);
    createdListingIds.push(closedBulk.body.id, expiredBulk.body.id);
    await db.update(beautyJobListingsTable).set({ status: "closed" }).where(eq(beautyJobListingsTable.id, closedBulk.body.id));
    await db.update(beautyJobListingsTable).set({ status: "expired" }).where(eq(beautyJobListingsTable.id, expiredBulk.body.id));
    assert.equal((await request(base, "/admin/beauty-jobs/bulk-moderation", admin.token, "POST", {
      listingIds: [closedBulk.body.id, expiredBulk.body.id], action: "approve",
    })).status, 409, "bulk approval must not reopen closed or expired listings");
    const lifecycleRows = await db.select({ id: beautyJobListingsTable.id, status: beautyJobListingsTable.status })
      .from(beautyJobListingsTable)
      .where(inArray(beautyJobListingsTable.id, [closedBulk.body.id, expiredBulk.body.id]));
    assert.equal(lifecycleRows.find((row) => row.id === closedBulk.body.id)?.status, "closed");
    assert.equal(lifecycleRows.find((row) => row.id === expiredBulk.body.id)?.status, "expired");
    const bulkEmailBefore = sentEmails.length;
    const bulkResult = await request(base, "/admin/beauty-jobs/bulk-moderation", admin.token, "POST", {
      listingIds: [bulkApprove.body.id, bulkReject.body.id], action: "reject",
      reason: `Bulk public ${suffix}`, internalNote: `Bulk private ${suffix}`,
    });
    assert.equal(bulkResult.status, 200); assert.equal(bulkResult.body.processed, 2);
    assert.equal((await request(base, "/admin/beauty-jobs/bulk-moderation", admin.token, "POST", {
      listingIds: [bulkApprove.body.id, bulkReject.body.id], action: "reject",
      reason: `Bulk public ${suffix}`, internalNote: `Bulk private ${suffix}`,
    })).status, 200);
    assert.equal(sentEmails.length, bulkEmailBefore + 2, "repeated identical bulk moderation emits no duplicate email");
    const bulkAudits = await db.select().from(beautyJobModerationAuditTable)
      .where(inArray(beautyJobModerationAuditTable.listingId, [bulkApprove.body.id, bulkReject.body.id]));
    assert.equal(bulkAudits.filter((entry) => entry.action === "bulk_reject").length, 4, "each bulk request remains append-only audited per listing");
    assert.ok(bulkAudits.every((entry) => entry.publicReason === `Bulk public ${suffix}` && entry.internalNote === `Bulk private ${suffix}`));
    await db.delete(beautyJobListingsTable).where(eq(beautyJobListingsTable.id, bulkReject.body.id));
    const retainedAudit = await db.select().from(beautyJobModerationAuditTable)
      .where(eq(beautyJobModerationAuditTable.listingId, bulkReject.body.id));
    assert.equal(retainedAudit.length, 2, "moderation audit history must survive physical listing removal");
    const edited = await request(base, `/beauty-jobs/${customerListing.id}`, customer.token, "PATCH", { title: `Edited ${suffix}` });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.moderationStatus, "pending", "editing must re-enter moderation");
    await request(base, `/admin/beauty-jobs/${customerListing.id}/moderation`, admin.token, "POST", { action: "approve" });
    assert.equal((await request(base, `/beauty-jobs/${customerListing.id}`, customer.token, "PATCH", {
      categoryId: rentalCategory.id, type: "equipment_rental", intent: "offering", availabilityPattern: "Po dogovoru",
    })).status, 400, "converting to an offering rental requires a concrete slot");
    const raceCreate = await request(base, "/beauty-jobs", customer.token, "POST", body(hairCategory.id, `Race ${suffix}`));
    assert.equal(raceCreate.status, 201);
    createdListingIds.push(raceCreate.body.id);
    const raceStartsAt = new Date(Date.now() + 5 * 86400000).toISOString();
    const raceEndsAt = new Date(Date.now() + 5 * 86400000 + 3600000).toISOString();
    const lockClient = await pool.connect();
    try {
      await lockClient.query("select pg_advisory_lock(hashtext($1))", [`beauty-job-rental-listing:${raceCreate.body.id}`]);
      const conversion = request(base, `/beauty-jobs/${raceCreate.body.id}`, customer.token, "PATCH", {
        categoryId: rentalCategory.id, type: "equipment_rental", intent: "offering", availabilityPattern: "Po dogovoru",
        availableSlots: [{ startsAt: raceStartsAt, endsAt: raceEndsAt }],
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      const staleTitleUpdate = request(base, `/beauty-jobs/${raceCreate.body.id}`, customer.token, "PATCH", { title: `Race edited ${suffix}` });
      await new Promise((resolve) => setTimeout(resolve, 25));
      await lockClient.query("select pg_advisory_unlock(hashtext($1))", [`beauty-job-rental-listing:${raceCreate.body.id}`]);
      const raceResults = await Promise.all([conversion, staleTitleUpdate]);
      assert.deepEqual(raceResults.map((result) => result.status), [200, 200]);
    } finally {
      await lockClient.query("select pg_advisory_unlock(hashtext($1))", [`beauty-job-rental-listing:${raceCreate.body.id}`]).catch(() => {});
      lockClient.release();
    }
    const raceMine = await request(base, "/beauty-jobs/mine", customer.token);
    const raceAfter = raceMine.body.items.find((item: any) => item.id === raceCreate.body.id);
    assert.equal(raceAfter?.type, "equipment_rental");
    assert.equal(raceAfter?.availableSlots.length, 1, "a stale concurrent PATCH must preserve the converted rental slot");
    assert.equal(raceAfter?.availabilityPattern, "Po dogovoru");

    assert.equal((await request(base, "/beauty-jobs", customer.token, "POST", body(rentalCategory.id, "Wrong rental"))).status, 400);
    assert.equal((await request(base, "/beauty-jobs", customer.token, "POST", body(rentalCategory.id, "No availability", { type: "equipment_rental" }))).status, 400);
    assert.equal((await request(base, "/beauty-jobs", customer.token, "POST", body(rentalCategory.id, "Coordinates", { type: "equipment_rental", availabilityPattern: "Pon-Pet", latitude: 44.8, longitude: 20.4 }))).status, 400);
    const rentalStartsAt = new Date(Date.now() + 2 * 86400000).toISOString();
    const rentalEndsAt = new Date(Date.now() + 2 * 86400000 + 2 * 3600000).toISOString();
    const secondRentalStartsAt = new Date(Date.now() + 3 * 86400000).toISOString();
    const secondRentalEndsAt = new Date(Date.now() + 3 * 86400000 + 2 * 3600000).toISOString();
    const rentalCreate = await request(base, "/beauty-jobs", customer.token, "POST", body(rentalCategory.id, `Rental ${suffix}`, {
      type: "equipment_rental", availabilityPattern: "Pon-Pet", dayLabels: ["Ponedeljak"],
      availableSlots: [
        { startsAt: rentalStartsAt, endsAt: rentalEndsAt },
        { startsAt: secondRentalStartsAt, endsAt: secondRentalEndsAt },
      ],
    }));
    assert.equal(rentalCreate.status, 201);
    createdListingIds.push(rentalCreate.body.id);
    assert.equal(rentalCreate.body.latitude, null);
    assert.equal(rentalCreate.body.availableSlots.length, 2);
    assert.equal((await request(base, `/beauty-jobs/${rentalCreate.body.id}`, customer.token, "PATCH", { latitude: 44.8, longitude: 20.4 })).status, 400, "rental updates must reject exact coordinates");
    assert.equal((await request(base, `/admin/beauty-jobs/${rentalCreate.body.id}/moderation`, admin.token, "POST", { action: "approve" })).status, 200);
    const rentalSlotId = rentalCreate.body.availableSlots[0].id;
    const secondRentalSlotId = rentalCreate.body.availableSlots[1].id;
    assert.equal(
      (await request(base, `/beauty-jobs/${rentalCreate.body.id}/rental-requests`, jobseeker.token, "POST", { slotId: secondRentalSlotId, message: "JOBSEEKER zahtev" })).status,
      201,
      "JOBSEEKER may request a rental slot",
    );
    for (const blocked of [customer, student]) {
      assert.equal(
        (await request(base, `/beauty-jobs/${rentalCreate.body.id}/rental-requests`, blocked.token, "POST", { slotId: secondRentalSlotId })).status,
        403,
        `${blocked.user.role} cannot request a rental slot`,
      );
    }
    const firstRentalRequest = await request(base, `/beauty-jobs/${rentalCreate.body.id}/rental-requests`, applicant.token, "POST", { slotId: rentalSlotId, message: "Prvi zahtev" });
    const secondRentalRequest = await request(base, `/beauty-jobs/${rentalCreate.body.id}/rental-requests`, salonOwner.token, "POST", { slotId: rentalSlotId, message: "Drugi zahtev" });
    assert.equal(firstRentalRequest.status, 201);
    assert.equal(secondRentalRequest.status, 201);
    const rentalInbox = await request(base, "/beauty-jobs/rental-requests/inbox", customer.token);
    const applicantRentals = await request(base, "/beauty-jobs/rental-requests/mine", applicant.token);
    assert.ok(rentalInbox.body.requests.some((item: any) => item.id === firstRentalRequest.body.id));
    assert.ok(applicantRentals.body.requests.some((item: any) => item.id === firstRentalRequest.body.id));
    const competingAccepts = await Promise.all([
      request(base, `/beauty-jobs/rental-requests/${firstRentalRequest.body.id}`, customer.token, "PATCH", { status: "accepted" }),
      request(base, `/beauty-jobs/rental-requests/${secondRentalRequest.body.id}`, customer.token, "PATCH", { status: "accepted" }),
    ]);
    assert.deepEqual(competingAccepts.map((item) => item.status).sort(), [200, 409], "only one competing request may reserve a slot");
    const bookedRental = await request(base, `/beauty-jobs/${rentalCreate.body.id}`, applicant.token);
    assert.equal(bookedRental.body.availableSlots[0].available, false);
    const overlapUpdate = await request(base, `/beauty-jobs/${rentalCreate.body.id}`, customer.token, "PATCH", {
      availableSlots: [
        { id: rentalSlotId, startsAt: rentalStartsAt, endsAt: rentalEndsAt },
        { id: secondRentalSlotId, startsAt: secondRentalStartsAt, endsAt: secondRentalEndsAt },
        { startsAt: new Date(Date.parse(rentalStartsAt) + 30 * 60000).toISOString(), endsAt: new Date(Date.parse(rentalEndsAt) + 30 * 60000).toISOString() },
      ],
    });
    assert.equal(overlapUpdate.status, 400, "new slots may not overlap a retained accepted slot");
    const lateRequest = await request(base, `/beauty-jobs/${rentalCreate.body.id}/rental-requests`, applicant.token, "POST", { slotId: secondRentalSlotId });
    assert.equal(lateRequest.status, 201);
    const deleteRequestedSlot = await request(base, `/beauty-jobs/${rentalCreate.body.id}`, customer.token, "PATCH", {
      availableSlots: [{ id: rentalSlotId, startsAt: rentalStartsAt, endsAt: rentalEndsAt }],
    });
    assert.equal(deleteRequestedSlot.status, 409, "a future slot with request history cannot be deleted");
    assert.equal((await request(base, `/beauty-jobs/${rentalCreate.body.id}/close`, customer.token, "POST")).status, 200);
    assert.equal((await request(base, `/beauty-jobs/rental-requests/${lateRequest.body.id}`, customer.token, "PATCH", { status: "accepted" })).status, 409, "closed listings cannot accept rental requests");
    const applicantNotifications = await request(base, "/beauty-jobs/notifications", applicant.token);
    const ownerApplicantNotifications = await request(base, "/beauty-jobs/notifications", salonOwner.token);
    assert.ok(applicantNotifications.body.notifications.some((item: any) => item.listingId === rentalCreate.body.id && item.type.startsWith("rental_request_")));
    assert.ok(ownerApplicantNotifications.body.notifications.some((item: any) => item.listingId === rentalCreate.body.id && item.type.startsWith("rental_request_")));

    // Individually identifiable approved fixtures keep every public filter deterministic.
    const filterJob = await insertApproved(hairCategory.id, customer.user.id, `query-token-${suffix}`, { city: `PriceCity${suffix}`, region: `QueryRegion${suffix}`, priceAmount: 111, latitude: 44.8, longitude: 20.4 });
    const filterRental = await insertApproved(rentalCategory.id, customer.user.id, `rental-token-${suffix}`, { type: "equipment_rental", intent: "offering", city: `PriceCity${suffix}`, region: `RentalRegion${suffix}`, priceAmount: 999 });
    const filterSeeking = await insertApproved(hairCategory.id, customer.user.id, `seeking-token-${suffix}`, { intent: "seeking", city: `SeekingCity${suffix}`, region: `SeekingRegion${suffix}`, priceAmount: 555 });
    const filterSeekingRental = await insertApproved(rentalCategory.id, customer.user.id, `seeking-rental-token-${suffix}`, { type: "equipment_rental", intent: "seeking", city: `SeekingRentalCity${suffix}`, region: `SeekingRentalRegion${suffix}`, priceAmount: 777 });
    await db.insert(beautyJobListingAvailabilityTable).values({ listingId: filterRental.id, availabilityPattern: `Availability-${suffix}`, dayLabels: [] });
    const filters: Array<[string, string]> = [
      [`query=query-token-${suffix}`, filterJob.id], ["type=equipment_rental", filterRental.id],
       ["intent=seeking", filterSeeking.id], ["listingMode=offering", filterJob.id], ["listingMode=rental", filterRental.id], ["listingMode=seeking", filterSeeking.id],
       ["listingMode=seeking_work", filterSeeking.id], ["listingMode=seeking_rental", filterSeekingRental.id], ["category=frizeri", filterJob.id],
       [`city=PriceCity${suffix}`, filterJob.id], [`region=QueryRegion${suffix}`, filterJob.id],
      ["minPrice=900", filterRental.id], ["maxPrice=200", filterJob.id],
      [`availability=Availability-${suffix}`, filterRental.id], ["sort=price_asc", filterJob.id],
       [`query=query-token-${suffix}&sort=oldest`, filterJob.id], ["sort=nearest&latitude=44.8&longitude=20.4", filterJob.id],
    ];
    for (const [query, expected] of filters) {
      const result = await request(base, `/beauty-jobs?${query}`);
      assert.equal(result.status, 200, `filter ${query} must succeed`);
      assert.ok(result.body.items.some((item: any) => item.id === expected), `filter ${query} must include isolated fixture`);
    }
    const seekingWork = await request(base, "/beauty-jobs?listingMode=seeking_work");
    assert.ok(seekingWork.body.items.some((item: any) => item.id === filterSeeking.id));
    assert.ok(!seekingWork.body.items.some((item: any) => item.id === filterSeekingRental.id), "seeking_work must exclude rental/resource requests");
    const seekingRental = await request(base, "/beauty-jobs?listingMode=seeking_rental");
    assert.ok(seekingRental.body.items.some((item: any) => item.id === filterSeekingRental.id));
    assert.ok(!seekingRental.body.items.some((item: any) => item.id === filterSeeking.id), "seeking_rental must exclude work/service requests");
    const legacySeeking = await request(base, "/beauty-jobs?listingMode=seeking");
    assert.ok(legacySeeking.body.items.some((item: any) => item.id === filterSeeking.id));
    assert.ok(legacySeeking.body.items.some((item: any) => item.id === filterSeekingRental.id), "legacy seeking remains a broad backward-compatible alias");
    const priceDesc = await request(base, `/beauty-jobs?sort=price_desc&city=PriceCity${suffix}`);
    assert.ok(priceDesc.body.items.findIndex((x: any) => x.id === filterRental.id) < priceDesc.body.items.findIndex((x: any) => x.id === filterJob.id), "price_desc must order fixtures");

    // A salon owner must not discover a competing salon's employment offer,
    // including through totals or direct detail views. Other listing modes
    // remain deliberately visible to salon owners.
    const insertSalonFixture = async (title: string, values: Record<string, any> = {}) => {
      const [listing] = await db.insert(beautyJobListingsTable).values({
        categoryId: hairCategory.id, salonId: otherOwner.salon.id, postedByType: "salon",
        type: "job", intent: "offering", title, description: `Salon visibility ${title}`,
        city: "Beograd", region: "Vračar", status: "active", moderationStatus: "approved",
        expiresAt: new Date(Date.now() + 86400000), ...values,
      }).returning();
      assert.ok(listing); createdListingIds.push(listing!.id); return listing!;
    };
    const competingJob = await insertSalonFixture(`Foreign employment ${suffix}`);
    const foreignFreelance = await insertSalonFixture(`Foreign freelance ${suffix}`, { type: "freelance" });
    const foreignSeeking = await insertSalonFixture(`Foreign seeking ${suffix}`, { intent: "seeking" });
    const foreignRental = await insertSalonFixture(`Foreign rental ${suffix}`, {
      categoryId: rentalCategory.id, type: "equipment_rental",
    });
    const ownSalonJob = await db.insert(beautyJobListingsTable).values({
      categoryId: hairCategory.id, salonId: salonOwner.salon.id, postedByType: "salon",
      type: "job", intent: "offering", title: `Own employment ${suffix}`, description: "Vlasnikov vidljivi oglas",
      city: "Beograd", region: "Vračar", status: "active", moderationStatus: "approved", expiresAt: new Date(Date.now() + 86400000),
    }).returning();
    assert.ok(ownSalonJob[0]); createdListingIds.push(ownSalonJob[0]!.id);
    const [hiddenLegacyContact, visibleLegacyContact] = await db.insert(beautyJobContactsTable).values([
      {
        listingId: competingJob.id,
        applicantUserId: salonOwner.user.id,
        applicantMessage: "Istorijski kontakt koji mora ostati skriven",
      },
      {
        listingId: foreignFreelance.id,
        applicantUserId: salonOwner.user.id,
        applicantMessage: "Vidljivi kontrolni istorijski kontakt",
      },
    ]).returning();
    assert.ok(hiddenLegacyContact && visibleLegacyContact);
    const [hiddenLegacyNotification, visibleLegacyNotification] = await db.insert(beautyJobNotificationsTable).values([
      {
        recipientUserId: salonOwner.user.id,
        listingId: competingJob.id,
        contactId: hiddenLegacyContact.id,
        type: "author_reply",
        title: "Skriveno istorijsko obaveštenje",
        body: competingJob.title,
      },
      {
        recipientUserId: salonOwner.user.id,
        listingId: foreignFreelance.id,
        contactId: visibleLegacyContact.id,
        type: "author_reply",
        title: "Vidljivo kontrolno obaveštenje",
        body: foreignFreelance.title,
      },
    ]).returning();
    assert.ok(hiddenLegacyNotification && visibleLegacyNotification);
    const ownerPublic = await request(base, `/beauty-jobs?query=${encodeURIComponent(suffix)}`, salonOwner.token);
    assert.equal(ownerPublic.status, 200);
    assert.equal(ownerPublic.body.items.some((item: any) => item.id === competingJob.id), false);
    assert.equal(ownerPublic.body.total, ownerPublic.body.items.length, "hidden competitor rows cannot leak through a public total");
    for (const listing of [foreignFreelance, foreignSeeking, foreignRental, ownSalonJob[0]!]) {
      assert.ok(ownerPublic.body.items.some((item: any) => item.id === listing.id), `${listing.title} remains visible to a salon owner`);
      assert.equal((await request(base, `/beauty-jobs/${listing.id}`, salonOwner.token)).status, 200);
    }
    const competingViewsBefore = competingJob.viewCount;
    assert.equal((await request(base, `/beauty-jobs/${competingJob.id}`, salonOwner.token)).status, 404);
    const [competingAfterHiddenDetail] = await db.select().from(beautyJobListingsTable).where(eq(beautyJobListingsTable.id, competingJob.id));
    assert.equal(competingAfterHiddenDetail?.viewCount, competingViewsBefore, "hidden detail must not increment views");
    assert.equal(
      (await request(base, `/beauty-jobs/${competingJob.id}/save`, salonOwner.token, "POST")).status,
      404,
      "a hidden competing employment listing cannot be saved by id",
    );
    assert.equal(
      (await request(base, `/beauty-jobs/${competingJob.id}/contact`, salonOwner.token, "POST", { message: "Neovlašćen kontakt" })).status,
      404,
      "a hidden competing employment listing cannot be contacted by id",
    );
    assert.equal(
      (await request(base, `/beauty-jobs/${competingJob.id}/report`, salonOwner.token, "POST", { reason: "Neovlašćena prijava" })).status,
      404,
      "a hidden competing employment listing cannot be reported by id",
    );
    await db.insert(beautyJobSavedListingsTable).values({
      userId: salonOwner.user.id,
      listingId: competingJob.id,
    });
    const ownerSaved = await request(base, "/beauty-jobs/saved", salonOwner.token);
    assert.equal(ownerSaved.status, 200);
    assert.equal(
      ownerSaved.body.items.some((item: any) => item.id === competingJob.id),
      false,
      "legacy saved rows cannot expose a hidden competing employment listing",
    );
    const ownerInbox = await request(base, "/beauty-jobs/inbox", salonOwner.token);
    assert.equal(ownerInbox.status, 200);
    assert.equal(ownerInbox.body.contacts.some((item: any) => item.id === hiddenLegacyContact.id), false);
    assert.equal(ownerInbox.body.contacts.some((item: any) => item.id === visibleLegacyContact.id), true);
    const ownerNotifications = await request(base, "/beauty-jobs/notifications", salonOwner.token);
    assert.equal(ownerNotifications.status, 200);
    assert.equal(ownerNotifications.body.notifications.some((item: any) => item.id === hiddenLegacyNotification.id), false);
    assert.equal(ownerNotifications.body.notifications.some((item: any) => item.id === visibleLegacyNotification.id), true);
    assert.equal(
      (await request(base, `/beauty-jobs/notifications/${hiddenLegacyNotification.id}/read`, salonOwner.token, "POST")).status,
      404,
      "a known hidden notification id cannot reveal competing listing data",
    );
    assert.equal(
      (await request(base, `/beauty-jobs/notifications/${visibleLegacyNotification.id}/read`, salonOwner.token, "POST")).status,
      200,
      "a visible freelance notification remains readable",
    );
    for (const token of [undefined, customer.token, admin.token]) {
      assert.equal((await request(base, `/beauty-jobs/${competingJob.id}`, token)).status, 200, "non-salon audiences retain employment visibility");
    }

    // Queue filters are authorized, paginated, deterministically sortable,
    // and include report counts without relying on shared fixture ordering.
    const queueA = await request(base, "/beauty-jobs", customer.token, "POST", body(hairCategory.id, `Queue alpha ${suffix}`));
    const queueB = await request(base, "/beauty-jobs", customer.token, "POST", body(hairCategory.id, `Queue beta ${suffix}`));
    assert.equal(queueA.status, 201); assert.equal(queueB.status, 201);
    const [queueSeekingWork] = await db.insert(beautyJobListingsTable).values({
      categoryId: hairCategory.id, userId: customer.user.id, postedByType: "user",
      type: "job", intent: "seeking", title: `Queue seeking work ${suffix}`,
      description: `Pending work request ${suffix}`, city: "Beograd", region: "Vračar",
      status: "active", moderationStatus: "pending", expiresAt: new Date(Date.now() + 86400000),
    }).returning();
    const [queueSeekingRental] = await db.insert(beautyJobListingsTable).values({
      categoryId: rentalCategory.id, userId: customer.user.id, postedByType: "user",
      type: "equipment_rental", intent: "seeking", title: `Queue seeking rental ${suffix}`,
      description: `Pending rental request ${suffix}`, city: "Beograd", region: "Vračar",
      status: "active", moderationStatus: "pending", expiresAt: new Date(Date.now() + 86400000),
    }).returning();
    assert.ok(queueSeekingWork); assert.ok(queueSeekingRental);
    createdListingIds.push(queueA.body.id, queueB.body.id, queueSeekingWork.id, queueSeekingRental.id);
    await db.insert(beautyJobReportsTable).values({ listingId: queueA.body.id, reason: `Queue report ${suffix}` });
    assert.equal((await request(base, `/admin/beauty-jobs/queue?reportedOnly=true`, customer.token)).status, 403);
    const reportedQueue = await request(base, `/admin/beauty-jobs/queue?status=pending&reportedOnly=true&search=${encodeURIComponent(`Queue alpha ${suffix}`)}&sort=oldest&page=1&pageSize=1`, admin.token);
    assert.equal(reportedQueue.status, 200); assert.equal(reportedQueue.body.total, 1);
    assert.equal(reportedQueue.body.page, 1); assert.equal(reportedQueue.body.pageSize, 1);
    assert.equal(reportedQueue.body.listings.length, 1); assert.equal(reportedQueue.body.listings[0].id, queueA.body.id);
    assert.equal(reportedQueue.body.listings[0].reportCount, 1);
    const queueWorkMode = await request(base, `/admin/beauty-jobs/queue?status=pending&listingMode=seeking_work&search=${encodeURIComponent(suffix)}`, admin.token);
    assert.equal(queueWorkMode.status, 200, "moderation queue accepts seeking_work");
    assert.ok(queueWorkMode.body.listings.some((item: any) => item.id === queueSeekingWork.id));
    assert.ok(!queueWorkMode.body.listings.some((item: any) => item.id === queueSeekingRental.id), "moderation seeking_work excludes rental/resource requests");
    const queueRentalMode = await request(base, `/admin/beauty-jobs/queue?status=pending&listingMode=seeking_rental&search=${encodeURIComponent(suffix)}`, admin.token);
    assert.equal(queueRentalMode.status, 200, "moderation queue accepts seeking_rental");
    assert.ok(queueRentalMode.body.listings.some((item: any) => item.id === queueSeekingRental.id));
    assert.ok(!queueRentalMode.body.listings.some((item: any) => item.id === queueSeekingWork.id), "moderation seeking_rental excludes work/service requests");
    for (const query of ["type=invalid", "listingMode=invalid", "postedBy=invalid", "reportedOnly=maybe", "sort=invalid", "period=custom&from=2026-02-30&to=2026-03-01"]) {
      assert.equal((await request(base, `/admin/beauty-jobs/queue?${query}`, admin.token)).status, 400, `queue rejects unsupported or impossible ${query}`);
    }
    const unreported = await request(base, "/admin/beauty-jobs/queue?status=pending&sort=newest&page=2&pageSize=1", admin.token);
    assert.equal(unreported.status, 200); assert.ok(unreported.body.total > 1);
    assert.equal(unreported.body.listings.length, 1, "queue pagination applies after filtering");
    assert.equal((await request(base, `/beauty-jobs/${queueB.body.id}`, admin.token, "PATCH", { title: `Queue beta edited ${suffix}` })).status, 200);
    const adminEditAudit = await db.select().from(beautyJobModerationAuditTable)
      .where(eq(beautyJobModerationAuditTable.listingId, queueB.body.id));
    assert.ok(adminEditAudit.some((entry) => entry.action === "edit" && entry.actingAdminUserId === admin.user.id), "administrator PATCH has an audit record");
    const expiringSixDays = await insertApproved(hairCategory.id, customer.user.id, `Six days ${suffix}`, { expiresAt: new Date(Date.now() + 6 * 86400000) });
    const expiringQueue = await request(base, `/admin/beauty-jobs/queue?status=expiring&search=${encodeURIComponent(`Six days ${suffix}`)}`, admin.token);
    assert.equal(expiringQueue.status, 200);
    assert.equal(expiringQueue.body.total, 0, "expiring queue means the next five days, not seven");
    const activityLow = await request(base, "/beauty-jobs", customer.token, "POST", body(hairCategory.id, `Activity ${suffix} low`));
    const activityHigh = await request(base, "/beauty-jobs", customer.token, "POST", body(hairCategory.id, `Activity ${suffix} high`));
    assert.equal(activityLow.status, 201); assert.equal(activityHigh.status, 201);
    createdListingIds.push(activityLow.body.id, activityHigh.body.id);
    await db.insert(beautyJobReportsTable).values([
      { listingId: activityHigh.body.id, reason: `Activity one ${suffix}` },
      { listingId: activityHigh.body.id, reason: `Activity two ${suffix}` },
    ]);
    const activityQueue = await request(
      base,
      `/admin/beauty-jobs/queue?status=pending&sort=activity&pageSize=100&search=${encodeURIComponent(`Activity ${suffix}`)}`,
      admin.token,
    );
    assert.equal(activityQueue.status, 200);
    assert.equal(activityQueue.body.listings[0]?.id, activityHigh.body.id, "activity sort uses report/contact activity rather than listing update time");

    const save = await request(base, `/beauty-jobs/${customerListing.id}/save`, applicant.token, "POST");
    assert.equal(save.status, 200); assert.equal(save.body.saved, true);
    assert.equal((await request(base, "/beauty-jobs/saved", applicant.token)).body.items.some((x: any) => x.id === customerListing.id), true);
    const preference = await request(base, "/auth/email-preferences", customer.token, "PATCH", { marketingEmailsEnabled: false });
    assert.equal(preference.status, 200);
    assert.equal(preference.body.marketingEmailsEnabled, false);
    const contact = await request(base, `/beauty-jobs/${customerListing.id}/contact`, applicant.token, "POST", { message: "Želim da se prijavim." });
    assert.equal(contact.status, 201);
    const contactEmails = sentEmails.filter((email) => email.subject.includes("Novi kontakt za vaš oglas"));
    assert.equal(contactEmails.length, 1, "new contact sends exactly one email");
    assert.equal(contactEmails[0]!.email, customer.user.email.toLowerCase(), "contact email is isolated to listing author");
    assert.notEqual(contactEmails[0]!.email, applicant.user.email.toLowerCase(), "contact email is never sent back to applicant");
    assert.ok(
      contactEmails[0]!.htmlContent.includes(
        `https://beauty-links.example.test/poslovi/nalog/oglasi?tab=inbox&amp;contactId=${contact.body.id}`,
      ),
      "new-contact email links to the exact inbox conversation",
    );
    assert.equal((await request(base, "/beauty-jobs/inbox", customer.token)).body.contacts.some((x: any) => x.id === contact.body.id), true);
    assert.equal((await request(base, `/beauty-jobs/contacts/${contact.body.id}`, otherOwner.token, "PATCH", { authorReply: "Neovlašćeno" })).status, 404);
    const concurrentReplies = await Promise.all([
      request(base, `/beauty-jobs/contacts/${contact.body.id}`, customer.token, "PATCH", { authorReply: "Hvala" }),
      request(base, `/beauty-jobs/contacts/${contact.body.id}`, customer.token, "PATCH", { authorReply: "Javljamo se uskoro" }),
    ]);
    assert.deepEqual(concurrentReplies.map((result) => result.status), [200, 200]);
    assert.equal((await request(base, `/beauty-jobs/contacts/${contact.body.id}`, customer.token, "PATCH", { authorReply: "Dopuna" })).status, 200);
    const replyEmails = sentEmails.filter((email) => email.subject.includes("Dobili ste odgovor"));
    assert.equal(replyEmails.length, 1, "editing an existing reply does not duplicate the reply email");
    assert.equal(replyEmails[0]!.email, applicant.user.email.toLowerCase(), "reply email is isolated to the applicant");
    assert.ok(
      replyEmails[0]!.htmlContent.includes(
        `https://beauty-links.example.test/poslovi/nalog/oglasi?tab=inbox&amp;contactId=${contact.body.id}`,
      ),
      "author-reply email links to the applicant's exact inbox conversation",
    );
    const applicantInbox = await request(base, "/beauty-jobs/inbox", applicant.token);
    assert.equal(
      applicantInbox.body.contacts.some((item: any) => item.id === contact.body.id && item.authorReply),
      true,
      "the applicant can read the replied conversation reached from email",
    );
    const unrelatedInbox = await request(base, "/beauty-jobs/inbox", otherOwner.token);
    assert.equal(
      unrelatedInbox.body.contacts.some((item: any) => item.id === contact.body.id),
      false,
      "an unrelated user cannot read the conversation reached from email",
    );
    for (const blocked of [student, instructor]) {
      assert.equal(
        (await request(base, `/beauty-jobs/${customerListing.id}/contact`, blocked.token, "POST", {
          message: "Nedozvoljen kontakt.",
        })).status,
        403,
        `${blocked.user.role} cannot contact a Beauty Poslovi author`,
      );
      assert.equal((await request(base, "/beauty-jobs/inbox", blocked.token)).status, 403);
    }
    const replyNotifications = await db.select().from(beautyJobNotificationsTable)
      .where(eq(beautyJobNotificationsTable.contactId, contact.body.id));
    assert.equal(
      replyNotifications.filter((item) => item.type === "author_reply").length,
      1,
      "concurrent first replies emit one in-app notification",
    );

    // Owner management is deliberately a separate, salon-scoped view. Seed
    // directly so every lifecycle/moderation boundary is independently named.
    const ownerFixture = async (title: string, values: Record<string, unknown> = {}) => {
      const [listing] = await db.insert(beautyJobListingsTable).values({
        categoryId: hairCategory.id, salonId: salonOwner.salon.id, userId: null, postedByType: "salon",
        type: "job", intent: "offering", title, description: `Owner filter ${title}`,
        city: "Beograd", region: "Vračar", status: "active", moderationStatus: "approved",
        expiresAt: new Date(Date.now() + 10 * 86400000), ...values,
      }).returning();
      assert.ok(listing); createdListingIds.push(listing.id); return listing;
    };
    const mineActive = await ownerFixture(`mine-active ${suffix}`);
    const mineExpiring = await ownerFixture(`mine-expiring ${suffix}`, { expiresAt: new Date(Date.now() + 3 * 86400000) });
    const minePending = await ownerFixture(`mine-pending ${suffix}`, { moderationStatus: "pending" });
    const mineUnapprovedExpiring = await ownerFixture(`mine-unapproved-expiring ${suffix}`, { moderationStatus: "pending", expiresAt: new Date(Date.now() + 3 * 86400000) });
    const mineRental = await ownerFixture(`mine-rental ${suffix}`, { type: "equipment_rental" });
    const mineSeekingWork = await ownerFixture(`mine-seeking-work ${suffix}`, { intent: "seeking" });
    const mineSeekingRental = await ownerFixture(`mine-seeking-rental ${suffix}`, { type: "space_rental", intent: "seeking" });
    const titleOnly = await ownerFixture(`title-only-${suffix}`, { description: `description-only-${suffix}` });
    const descriptionOnly = await ownerFixture(`unrelated-${suffix}`, { description: `title-only-${suffix}` });
    await db.update(beautyJobListingsTable).set({ contactCount: 1 }).where(eq(beautyJobListingsTable.id, mineActive.id));
    await db.update(beautyJobListingsTable).set({ contactCount: 9 }).where(eq(beautyJobListingsTable.id, mineRental.id));
    for (const [query, present, absent] of [
      ["status=active", mineActive.id, mineExpiring.id],
      ["status=expiring", mineExpiring.id, mineUnapprovedExpiring.id],
      ["status=pending", minePending.id, mineActive.id],
      ["type=rental", mineRental.id, mineActive.id],
      ["listingMode=offering", mineActive.id, mineSeekingWork.id],
      ["listingMode=rental", mineRental.id, mineSeekingWork.id],
      ["listingMode=seeking", mineSeekingWork.id, mineActive.id],
      ["listingMode=seeking_work", mineSeekingWork.id, mineSeekingRental.id],
      ["listingMode=seeking_rental", mineSeekingRental.id, mineSeekingWork.id],
      [`query=title-only-${suffix}`, titleOnly.id, descriptionOnly.id],
    ] as Array<[string, string, string]>) {
      const response = await request(base, `/beauty-jobs/mine?${query}&pageSize=100`, salonOwner.token);
      assert.equal(response.status, 200, `owner mine accepts ${query}`);
      assert.ok(response.body.items.some((item: any) => item.id === present), `${query} includes matching listing`);
      assert.ok(!response.body.items.some((item: any) => item.id === absent), `${query} excludes nonmatching listing`);
    }
    const activeMine = await request(base, "/beauty-jobs/mine?status=active&pageSize=100", salonOwner.token);
    assert.ok(!activeMine.body.items.some((item: any) => item.id === minePending.id), "active owner listings require approved moderation");
    const activityMine = await request(base, `/beauty-jobs/mine?sort=activity&pageSize=100`, salonOwner.token);
    assert.equal(activityMine.status, 200);
    assert.ok(
      activityMine.body.items.findIndex((item: any) => item.id === mineRental.id)
        < activityMine.body.items.findIndex((item: any) => item.id === mineActive.id),
      "owner activity sorting uses contactCount descending",
    );
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const monday = new Date(midnight); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const inMondayWeek = await ownerFixture(`mine-monday ${suffix}`, { createdAt: new Date(monday.getTime() + 3600000) });
    const beforeMonday = await ownerFixture(`mine-before-monday ${suffix}`, { createdAt: new Date(monday.getTime() - 3600000) });
    const weekMine = await request(base, `/beauty-jobs/mine?posted=week&pageSize=100`, salonOwner.token);
    assert.ok(weekMine.body.items.some((item: any) => item.id === inMondayWeek.id));
    assert.ok(!weekMine.body.items.some((item: any) => item.id === beforeMonday.id), "week starts Monday, not Sunday");
    assert.equal((await request(base, "/beauty-jobs/mine?posted=custom&from=2026-02-30&to=2026-03-01", salonOwner.token)).status, 400);

    // Applicant decisions are only available to the owning salon and its active
    // employees; all IDs are prevalidated before any mutable decision occurs.
    const applicantListing = await ownerFixture(`applicant-job ${suffix}`);
    const nonJobListing = await ownerFixture(`applicant-rental ${suffix}`, { type: "equipment_rental" });
    const [firstApplication, foreignApplication] = await db.insert(beautyJobContactsTable).values([
      { listingId: applicantListing.id, applicantUserId: applicant.user.id, applicantMessage: "Prva prijava" },
      { listingId: mineActive.id, applicantUserId: applicant.user.id, applicantMessage: "Strana prijava" },
    ]).returning();
    assert.ok(firstApplication && foreignApplication);
    assert.equal((await request(base, `/beauty-jobs/${applicantListing.id}/applicants`, employee.token)).status, 403, "employee without membership remains blocked");
    await db.insert(employeesTable).values({
      salonId: salonOwner.salon.id, userId: employee.user.id, name: "Applicant employee", role: "staff",
      bio: "Applicant access test", avatarUrl: "/employee.jpg", active: true,
    });
    const employeeApplicants = await request(base, `/beauty-jobs/${applicantListing.id}/applicants`, employee.token);
    assert.equal(employeeApplicants.status, 200, "active employee can read own salon applicants");
    assert.equal((await request(base, "/beauty-jobs/categories", employee.token)).status, 200, "employee applicant filters can load public categories");
    assert.equal((await request(base, `/beauty-jobs/${applicantListing.id}/applicants`, otherOwner.token)).status, 409, "other salon tenant is isolated");
    assert.equal((await request(base, `/beauty-jobs/${nonJobListing.id}/applicants`, salonOwner.token)).status, 409, "non-job listings cannot expose applicant management");
    const atomicForeign = await request(base, `/beauty-jobs/${applicantListing.id}/applicants/decision`, salonOwner.token, "POST", {
      contactIds: [firstApplication.id, foreignApplication.id], action: "approve",
    });
    assert.equal(atomicForeign.status, 409, "foreign contact makes the full batch stale");
    const [stillPending] = await db.select().from(beautyJobContactsTable).where(eq(beautyJobContactsTable.id, firstApplication.id));
    assert.equal(stillPending?.authorStatus, "pending", "foreign batch leaves valid contact untouched");
    const decision = await request(base, `/beauty-jobs/${applicantListing.id}/applicants/decision`, employee.token, "POST", {
      contactIds: [firstApplication.id], action: "reject", internalNote: `Private ${suffix}`,
    });
    assert.equal(decision.status, 200);
    assert.equal(decision.body.applicants[0].rejectionNote, `Private ${suffix}`);
    const [afterDecision] = await db.select().from(beautyJobContactsTable).where(eq(beautyJobContactsTable.id, firstApplication.id));
    assert.equal(afterDecision?.decisionActorUserId, employee.user.id);
    assert.ok(afterDecision?.decisionAt);
    const actionRows = await db.select().from(beautyJobApplicationActionsTable).where(eq(beautyJobApplicationActionsTable.contactId, firstApplication.id));
    assert.equal(actionRows.length, 1); assert.equal(actionRows[0]?.actorUserId, employee.user.id);
    const [listingAfterDecision] = await db.select().from(beautyJobListingsTable).where(eq(beautyJobListingsTable.id, applicantListing.id));
    assert.equal(listingAfterDecision?.moderationStatus, "approved");
    assert.equal(listingAfterDecision?.status, "active", "candidate decision never changes listing lifecycle");
    assert.equal((await request(base, `/beauty-jobs/${applicantListing.id}/applicants/decision`, salonOwner.token, "POST", {
      contactIds: [firstApplication.id], action: "reject", internalNote: `Private ${suffix}`,
    })).status, 200, "exact decision retry is idempotent");
    assert.equal((await db.select().from(beautyJobApplicationActionsTable).where(eq(beautyJobApplicationActionsTable.contactId, firstApplication.id))).length, 1);
    assert.equal((await request(base, `/beauty-jobs/${applicantListing.id}/applicants/decision`, salonOwner.token, "POST", {
      contactIds: [firstApplication.id], action: "approve",
    })).status, 409, "opposite stale decision is rejected");
    const privateApplicantInbox = await request(base, "/beauty-jobs/inbox", applicant.token);
    const applicantContact = privateApplicantInbox.body.contacts.find((item: any) => item.id === firstApplication.id);
    assert.equal(applicantContact?.rejectionNote, undefined, "ordinary applicant inbox never leaks private rejection note");
    assert.equal(applicantContact?.decisionActorUserId, undefined, "ordinary applicant inbox never leaks decision actor");
    const ordinaryContactResponse = await request(base, `/beauty-jobs/contacts/${firstApplication.id}`, salonOwner.token, "PATCH", {
      authorReply: "Primljeno.",
    });
    assert.equal(ordinaryContactResponse.status, 200);
    assert.equal(ordinaryContactResponse.body.rejectionNote, undefined, "ordinary contact response never leaks private rejection note");
    assert.equal(ordinaryContactResponse.body.decisionActorUserId, undefined, "ordinary contact response never leaks decision actor");
    const [afterTerminalReply] = await db.select().from(beautyJobContactsTable).where(eq(beautyJobContactsTable.id, firstApplication.id));
    assert.equal(afterTerminalReply?.authorStatus, "declined", "replying after a terminal decision preserves the decision status");
    assert.equal(afterTerminalReply?.rejectionNote, `Private ${suffix}`, "replying after rejection preserves the private note");
    assert.equal((await db.select().from(beautyJobApplicationActionsTable).where(eq(beautyJobApplicationActionsTable.contactId, firstApplication.id))).length, 1, "terminal reply does not duplicate decision audit");
    assert.equal((await request(base, `/beauty-jobs/contacts/${firstApplication.id}`, salonOwner.token, "PATCH", {
      authorStatus: "replied",
    })).status, 409, "legacy reply endpoint cannot reopen a terminal decision");
    assert.equal((await request(base, `/beauty-jobs/contacts/${firstApplication.id}`, salonOwner.token, "PATCH", {
      authorStatus: "accepted",
    })).status, 409, "legacy reply endpoint cannot reverse a terminal decision");

    const retryEventKey = `beauty-job:test-retry:${suffix}`;
    let failureCalls = 0;
    const temporaryFailure: TransactionalEmailTransport = {
      async send() {
        failureCalls += 1;
        throw new Error("Brevo 503: temporarily unavailable");
      },
    };
    const firstRetryAttempt = await sendBeautyJobEmail({
      eventKey: retryEventKey,
      emailType: "beauty_job_new_contact",
      recipientUserId: customer.user.id,
      subject: "Retry test",
      title: "Retry test",
      content: "Prolazni kvar mora ostati u outbox redu.",
      listingId: customerListing.id,
      contactId: contact.body.id,
    }, temporaryFailure);
    assert.deepEqual(firstRetryAttempt, { failed: true });
    assert.equal(failureCalls, 1);
    const [queuedRetry] = await db.select().from(emailDeliveriesTable)
      .where(eq(emailDeliveriesTable.eventKey, retryEventKey)).limit(1);
    assert.equal(queuedRetry?.status, "queued", "temporary Beauty Poslovi failure remains queued");
    assert.ok(queuedRetry?.nextRetryAt, "temporary Beauty Poslovi failure receives a retry timestamp");
    const retriedRecipients: string[] = [];
    const retrySuccess: TransactionalEmailTransport = {
      async send(input) {
        retriedRecipients.push(input.to.email);
        return { messageId: `retry-success-${suffix}` };
      },
    };
    await retryFailedRetryableEmails(new Date(queuedRetry!.nextRetryAt!.getTime() + 1), retrySuccess);
    const [sentRetry] = await db.select().from(emailDeliveriesTable)
      .where(eq(emailDeliveriesTable.eventKey, retryEventKey)).limit(1);
    assert.equal(sentRetry?.status, "sent", "retry worker sends the queued Beauty Poslovi email");
    assert.deepEqual(retriedRecipients, [customer.user.email.toLowerCase()], "retry preserves the isolated recipient");
    assert.equal(sentRetry?.retryCount, 1);

    // Admin delivery visibility is intentionally privacy-safe and limited to
    // delayed/terminal Beauty Poslovi messages. Manual retry is exposed only
    // for a terminal provider failure that was classified as temporary.
    const exhaustedEventKey = `beauty-job:delivery-retryable:${suffix}`;
    const exhaustedFailureTransport: TransactionalEmailTransport = {
      async send() {
        throw new Error("Brevo 503: temporary delivery fixture");
      },
    };
    await sendBeautyJobEmail({
      eventKey: exhaustedEventKey,
      emailType: "beauty_job_author_reply",
      recipientUserId: customer.user.id,
      subject: `PRIVATE SUBJECT ${suffix}`,
      title: "Retry classification",
      content: `PRIVATE BODY ${suffix}`,
      listingId: customerListing.id,
      contactId: contact.body.id,
    }, exhaustedFailureTransport);
    let [retryableIssue] = await db.select().from(emailDeliveriesTable)
      .where(eq(emailDeliveriesTable.eventKey, exhaustedEventKey)).limit(1);
    for (let attempt = 0; retryableIssue?.status === "queued" && attempt < 6; attempt += 1) {
      assert.ok(retryableIssue.nextRetryAt);
      await retryFailedRetryableEmails(
        new Date(retryableIssue.nextRetryAt.getTime() + 1),
        exhaustedFailureTransport,
      );
      [retryableIssue] = await db.select().from(emailDeliveriesTable)
        .where(eq(emailDeliveriesTable.eventKey, exhaustedEventKey)).limit(1);
    }
    assert.equal(retryableIssue?.status, "failed", "temporary provider errors become terminal after retries are exhausted");
    assert.equal(retryableIssue?.retryableFailure, true, "exhausted temporary failure becomes eligible for manual retry");

    const issueRecipient = `private-delivery-${suffix}@example.test`;
    const issueRows = await db.insert(emailDeliveriesTable).values([
      {
        eventKey: `beauty-job:delivery-delayed:${suffix}`,
        emailType: "beauty_job_new_contact",
        recipientEmail: issueRecipient,
        subject: `PRIVATE SUBJECT ${suffix}`,
        htmlContent: `<p>PRIVATE BODY ${suffix}</p>`,
        errorMessage: `PRIVATE ERROR ${suffix}`,
        status: "queued",
        nextRetryAt: new Date(Date.now() - 60_000),
        createdAt: new Date(Date.now() - 31 * 60_000),
      },
      {
        eventKey: `beauty-job:delivery-permanent:${suffix}`,
        emailType: "beauty_job_moderation",
        recipientEmail: issueRecipient,
        subject: `PRIVATE SUBJECT ${suffix}`,
        htmlContent: `<p>PRIVATE BODY ${suffix}</p>`,
        errorMessage: `PRIVATE ERROR ${suffix}`,
        status: "failed",
        retryCount: 1,
        retryableFailure: false,
      },
      {
        eventKey: `beauty-job:delivery-skipped:${suffix}`,
        emailType: "beauty_job_expiry_warning",
        recipientEmail: issueRecipient,
        subject: `PRIVATE SUBJECT ${suffix}`,
        htmlContent: `<p>PRIVATE BODY ${suffix}</p>`,
        errorMessage: `PRIVATE ERROR ${suffix}`,
        status: "skipped",
      },
    ]).returning();
    const skippedIssue = issueRows.find((row) => row.eventKey.includes("skipped"))!;

    assert.equal(
      (await request(base, "/admin/beauty-jobs/email-deliveries")).status,
      401,
      "delivery issues require authentication",
    );
    assert.equal(
      (await request(base, "/admin/beauty-jobs/email-deliveries", customer.token)).status,
      403,
      "delivery issues require an administrator",
    );
    const issues = await request(base, "/admin/beauty-jobs/email-deliveries", admin.token);
    assert.equal(issues.status, 200);
    for (const issue of [...issueRows, retryableIssue!]) {
      assert.ok(
        issues.body.deliveries.some((delivery: any) => delivery.id === issue.id),
        `admin response includes isolated issue ${issue.eventKey}`,
      );
    }
    const serializedIssues = JSON.stringify(issues.body);
    for (const privateValue of [
      issueRecipient,
      customer.user.email,
      `PRIVATE SUBJECT ${suffix}`,
      `PRIVATE BODY ${suffix}`,
      `PRIVATE ERROR ${suffix}`,
    ]) {
      assert.equal(
        serializedIssues.includes(privateValue),
        false,
        `admin delivery response must not reveal ${privateValue.split(" ")[0]}`,
      );
    }
    assert.equal(
      issues.body.deliveries.find((delivery: any) => delivery.id === retryableIssue.id)?.retryAvailable,
      true,
    );
    assert.equal(
      issues.body.deliveries.find((delivery: any) => delivery.id === skippedIssue.id)?.retryAvailable,
      false,
    );
    assert.equal(
      (await request(base, `/admin/beauty-jobs/email-deliveries/${skippedIssue.id}/retry`, admin.token, "POST")).status,
      409,
      "skipped delivery cannot be retried manually",
    );
    const concurrentManualRetries = await Promise.all([
      request(base, `/admin/beauty-jobs/email-deliveries/${retryableIssue.id}/retry`, admin.token, "POST"),
      request(base, `/admin/beauty-jobs/email-deliveries/${retryableIssue.id}/retry`, admin.token, "POST"),
    ]);
    assert.deepEqual(
      concurrentManualRetries.map((result) => result.status).sort(),
      [200, 409],
      "concurrent administrator retries result in one provider attempt",
    );
    const [manuallyRetried] = await db.select().from(emailDeliveriesTable)
      .where(eq(emailDeliveriesTable.id, retryableIssue.id)).limit(1);
    assert.equal(manuallyRetried?.status, "sent");

    // Five terminal rows trigger the administrator monitor. A second run
    // inside the six-hour cooldown must not send another alert.
    await db.insert(emailDeliveriesTable).values([0, 1, 2].map((index) => ({
      eventKey: `beauty-job:delivery-monitor:${suffix}:${index}`,
      emailType: "beauty_job_moderation",
      recipientEmail: issueRecipient,
      subject: "Monitoring fixture",
      htmlContent: "<p>Monitoring fixture</p>",
      status: "failed" as const,
      errorMessage: "Brevo 400 fixture",
      retryableFailure: false,
    })));
    const alertRecipients: string[] = [];
    const alertTransport: TransactionalEmailTransport = {
      async send(input) {
        alertRecipients.push(input.to.email.toLowerCase());
        return { messageId: `beauty-job-alert-${alertRecipients.length}` };
      },
    };
    const alertAt = new Date();
    const firstAlert = await runBeautyJobDeliveryFailureAlerts(alertAt, alertTransport);
    monitorAlertEventKeys.push(...firstAlert.attemptedEventKeys);
    assert.ok(firstAlert.summary.terminalIssueCount >= 5, "monitor observes the configured terminal threshold");
    assert.ok(alertRecipients.includes(admin.user.email.toLowerCase()), "monitor emails active administrators");
    const currentAdminAlertCount = alertRecipients.filter(
      (email) => email === admin.user.email.toLowerCase(),
    ).length;
    const secondAlert = await runBeautyJobDeliveryFailureAlerts(
      new Date(alertAt.getTime() + 60_000),
      alertTransport,
    );
    monitorAlertEventKeys.push(...secondAlert.attemptedEventKeys);
    assert.equal(
      alertRecipients.filter((email) => email === admin.user.email.toLowerCase()).length,
      currentAdminAlertCount,
      "cooldown suppresses a repeated alert for the same administrator",
    );

    // A total Brevo outage must still page administrators through the
    // independent SMS channel. The SMS event key includes the primary alert
    // sequence, so a repeated scheduler tick cannot create a duplicate.
    const adminPhone = "+381601112223";
    await db.update(usersTable).set({ phone: adminPhone }).where(eq(usersTable.id, admin.user.id));
    const outageEmailTransport: TransactionalEmailTransport = {
      async send() {
        throw new Error("Brevo 503: send API unavailable");
      },
    };
    const outageSmsCalls: Array<{ to: string; text: string }> = [];
    const outageSmsProvider: SmsProvider = {
      async send(input) {
        outageSmsCalls.push({ to: input.to, text: input.text });
        return { messageId: `beauty-job-alert-sms-${outageSmsCalls.length}` };
      },
    };
    const outageAt = new Date(alertAt.getTime() + BEAUTY_JOB_DELIVERY_ALERT_COOLDOWN_MS + 1);
    const outageAlert = await runBeautyJobDeliveryFailureAlerts(
      outageAt,
      outageEmailTransport,
      outageSmsProvider,
    );
    monitorAlertEventKeys.push(...outageAlert.attemptedEventKeys);
    monitorSmsEventKeys.push(...outageAlert.smsFallback.attemptedEventKeys);
    assert.equal(
      outageAlert.failedDeliveryCount,
      outageAlert.attemptedEventKeys.length,
      "Brevo outage must fail every attempted monitoring email",
    );
    assert.equal(outageAlert.smsFallback.triggered, true, "total Brevo outage triggers the SMS fallback");
    assert.ok(outageAlert.smsFallback.attemptedEventKeys.length >= 1, "fallback creates SMS outbox work");
    assert.ok(outageSmsCalls.some((call) => call.to === adminPhone), "active admin receives the fallback SMS");
    assert.ok(
      outageSmsCalls.find((call) => call.to === adminPhone)?.text.includes("Beauty Poslovi"),
      "fallback SMS identifies the affected monitoring alert",
    );
    const fallbackRows = await db.select().from(smsDeliveriesTable)
      .where(inArray(smsDeliveriesTable.eventKey, outageAlert.smsFallback.attemptedEventKeys));
    assert.equal(
      fallbackRows.length,
      outageAlert.smsFallback.attemptedEventKeys.length,
      "fallback SMS is persisted in the durable outbox",
    );
    assert.ok(fallbackRows.every((row) => row.messageType === "admin_alert" && row.status === "sent"));

    const duplicateSmsCalls: Array<{ to: string }> = [];
    const duplicateSmsProvider: SmsProvider = {
      async send(input) {
        duplicateSmsCalls.push({ to: input.to });
        return { messageId: "should-not-be-sent" };
      },
    };
    const duplicateOutageAlert = await runBeautyJobDeliveryFailureAlerts(
      outageAt,
      outageEmailTransport,
      duplicateSmsProvider,
    );
    assert.equal(duplicateOutageAlert.attemptedEventKeys.length, 0, "cooldown suppresses duplicate monitoring email attempts");
    assert.equal(duplicateOutageAlert.smsFallback.triggered, false, "suppressed email attempts never trigger the fallback");
    assert.equal(duplicateSmsCalls.length, 0, "repeated outage tick sends no duplicate fallback SMS");

    const report = await request(base, `/beauty-jobs/${customerListing.id}/report`, undefined, "POST", { reason: "Anonimna prijava" });
    assert.equal(report.status, 201); assert.equal(report.body.reporterUserId, null);
    const queue = await request(base, "/admin/beauty-jobs/queue", admin.token);
    assert.equal(queue.status, 200); assert.ok(queue.body.reports.some((x: any) => x.id === report.body.id));
    assert.equal((await request(base, `/admin/beauty-jobs/reports/${report.body.id}/resolve`, admin.token, "POST", { status: "resolved", resolutionNote: "Uklonjeno" })).status, 200);
    assert.equal((await request(base, `/beauty-jobs/${customerListing.id}`)).status, 404, "resolved report must hide listing");
    const reportAudit = await db.select().from(beautyJobModerationAuditTable)
      .where(eq(beautyJobModerationAuditTable.listingId, customerListing.id));
    assert.ok(reportAudit.some((entry) => entry.action === "report_reject" && entry.publicReason === "Uklonjeno" && entry.internalNote === "Uklonjeno"), "report-driven rejection keeps its private audit trail");

    assert.equal((await request(base, "/admin/beauty-jobs/settings", admin.token)).status, 200);
    assert.equal((await request(base, "/admin/beauty-jobs/settings", admin.token, "PATCH", { listingExpiryDays: 2, hourlyPostingLimit: 1 })).status, 200);
    const expired = await insertApproved(hairCategory.id, customer.user.id, `Expired ${suffix}`, { expiresAt: new Date(Date.now() - 1000) });
    const warning = await insertApproved(hairCategory.id, customer.user.id, `Warning ${suffix}`, { expiresAt: new Date(Date.now() + 2 * 86400000) });
    assert.equal((await request(base, "/admin/beauty-jobs/expiry-sweep", admin.token, "POST")).status, 200);
    assert.equal((await request(base, "/admin/beauty-jobs/expiry-sweep", admin.token, "POST")).status, 200);
    const [expiredAfterSweep] = await db.select({ status: beautyJobListingsTable.status }).from(beautyJobListingsTable).where(eq(beautyJobListingsTable.id, expired.id));
    assert.equal(expiredAfterSweep?.status, "expired", "expiry sweep must expire past-due listings");
    const warningDeliveries = await db.select().from(emailDeliveriesTable)
      .where(eq(emailDeliveriesTable.eventKey, `beauty-job:expiry-warning:${warning.id}:recipient:${customer.user.id}`));
    assert.equal(warningDeliveries.length, 1, "repeated expiry sweeps keep one durable email delivery");
    assert.ok(
      warningDeliveries[0]?.htmlContent?.includes(
        `https://beauty-links.example.test/poslovi/nalog/oglasi?tab=my-jobs&amp;listingId=${warning.id}`,
      ),
      "expiry warning links to the exact listing management screen",
    );
    const warningNotifications = await db.select().from(beautyJobNotificationsTable)
      .where(eq(beautyJobNotificationsTable.listingId, warning.id));
    assert.equal(
      warningNotifications.filter((item) => item.type === "expiry_warning").length,
      1,
      "repeated expiry sweeps keep one in-app warning",
    );
    assert.equal((await request(base, `/beauty-jobs/${expired.id}/renew`, customer.token, "POST")).status, 200);

    // A fresh author proves the advisory-lock hourly limit under concurrent requests.
    const limiter = await user("JOBSEEKER", "limiter");
    const concurrent = await Promise.all([
      request(base, "/beauty-jobs", limiter.token, "POST", body(hairCategory.id, `Limit A ${suffix}`)),
      request(base, "/beauty-jobs", limiter.token, "POST", body(hairCategory.id, `Limit B ${suffix}`)),
    ]);
    assert.deepEqual(concurrent.map((x) => x.status).sort(), [201, 429], "one concurrent create must be rate limited");
    for (const result of concurrent) if (result.status === 201) createdListingIds.push(result.body.id);

    delete process.env["APP_BASE_URL"];
    await assert.rejects(
      sendBeautyJobEmail({
        eventKey: `beauty-job:missing-base-url:${suffix}`,
        emailType: "beauty_job_moderation",
        recipientUserId: customer.user.id,
        subject: "Test konfiguracije",
        title: "Test konfiguracije",
        content: "Ovaj mejl ne sme ostati bez CTA linka.",
        listingId: customerListing.id,
      }),
      /APP_BASE_URL/,
      "missing production base URL must fail visibly instead of sending an email without a CTA",
    );
    process.env["APP_BASE_URL"] = "https://beauty-links.example.test/";
  } finally {
    if (originalAppBaseUrl === undefined) delete process.env["APP_BASE_URL"];
    else process.env["APP_BASE_URL"] = originalAppBaseUrl;
    setBeautyJobEmailTransportForTests(undefined);
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    if (originalSettings) await db.update(beautyJobPlatformSettingsTable).set({
      listingExpiryDays: originalSettings.listingExpiryDays, hourlyPostingLimit: originalSettings.hourlyPostingLimit,
      updatedByUserId: originalSettings.updatedByUserId, updatedAt: originalSettings.updatedAt,
    }).where(eq(beautyJobPlatformSettingsTable.id, originalSettings.id));
    else await db.delete(beautyJobPlatformSettingsTable);
    if (createdListingIds.length) {
      await db.delete(beautyJobModerationAuditTable).where(inArray(beautyJobModerationAuditTable.listingId, createdListingIds));
      await db.delete(beautyJobListingsTable).where(inArray(beautyJobListingsTable.id, createdListingIds));
    }
    if (monitorAlertEventKeys.length) {
      await db.delete(emailDeliveriesTable).where(inArray(emailDeliveriesTable.eventKey, monitorAlertEventKeys));
    }
    if (monitorSmsEventKeys.length) {
      await db.delete(smsDeliveriesTable).where(inArray(smsDeliveriesTable.eventKey, monitorSmsEventKeys));
    }
    await db.delete(emailDeliveriesTable).where(like(emailDeliveriesTable.recipientEmail, `%${suffix}%`));
    await db.delete(educationCentersTable).where(inArray(educationCentersTable.ownerId, createdUsers));
    await db.delete(salonsTable).where(inArray(salonsTable.ownerId, createdUsers));
    if (createdUsers.length) await db.delete(usersTable).where(inArray(usersTable.id, createdUsers));
  }
}

try {
  await run();
  console.log("Beauty Poslovi HTTP integration test passed.");
} finally {
  await pool.end();
}
