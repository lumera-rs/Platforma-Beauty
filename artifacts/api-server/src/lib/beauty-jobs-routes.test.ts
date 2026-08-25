import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import {
  beautyJobCategoriesTable, beautyJobListingAvailabilityTable, beautyJobListingsTable,
  beautyJobNotificationsTable, beautyJobPlatformSettingsTable, db, emailDeliveriesTable,
  pool, salonsTable, usersTable,
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
import { runBeautyJobDeliveryFailureAlerts } from "./beauty-jobs-delivery-monitor";

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

async function user(role: "ADMIN" | "CUSTOMER" | "INSTRUCTOR" | "SALON_EMPLOYEE" | "SALON_OWNER" | "STUDENT", label: string) {
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
    const customer = await user("CUSTOMER", "customer");
    const applicant = await user("CUSTOMER", "applicant");
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
    const publicCategories = await request(base, "/beauty-jobs/categories");
    assert.equal(publicCategories.status, 200);
    for (const slug of ["barberi", "kozmeticari", "lash-brow", "masaza-terapeuti", "sminkeri", "pmu", "estetika-anti-aging", "pomocno-osoblje", "tattoo-piercing"]) {
      assert.ok(publicCategories.body.categories.some((category: { slug: string }) => category.slug === slug), `${slug} is an active Beauty Poslovi filter`);
    }

    // Employees are denied even on the otherwise-public Beauty Poslovi module.
    for (const path of ["/beauty-jobs/categories", "/beauty-jobs", `/beauty-jobs/${publicListing.id}`, `/beauty-jobs/${publicListing.id}/report`]) {
      const r = await request(base, path, employee.token, path.endsWith("/report") ? "POST" : "GET", path.endsWith("/report") ? { reason: "Neprimeren sadržaj" } : undefined);
      assert.equal(r.status, 403, `employee must be denied ${path}`);
    }
    for (const path of ["/beauty-jobs", "/beauty-jobs/mine", `/beauty-jobs/${publicListing.id}/save`, `/beauty-jobs/${publicListing.id}/contact`, "/beauty-jobs/inbox"]) {
      const r = await request(base, path, employee.token, path === "/beauty-jobs/mine" || path === "/beauty-jobs/inbox" ? "GET" : "POST", path === "/beauty-jobs" ? body(hairCategory.id, "Employee blocked") : path.endsWith("/contact") ? { message: "Pozdrav" } : undefined);
      assert.equal(r.status, 403, `employee must be denied protected ${path}`);
    }

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
    assert.equal(pendingAdminPreview.body.id, customerListing.id);
    assert.equal(pendingAdminPreview.body.moderationStatus, "pending");
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
        `https://beauty-links.example.test/moji-oglasi?tab=my-jobs&amp;listingId=${customerListing.id}`,
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
    assert.equal(typeof rejectedRecord?.moderatedAt, "string", "rejected listing review exposes its decision time");
    assert.equal((await request(base, "/admin/beauty-jobs/rejected?period=custom&from=not-a-date&to=2026-01-01", admin.token)).status, 400);
    const initialModerationNotifications = await db.select().from(beautyJobNotificationsTable)
      .where(eq(beautyJobNotificationsTable.listingId, customerListing.id));
    assert.equal(
      initialModerationNotifications.filter((item) => item.type === "moderation").length,
      1,
      "concurrent identical moderation emits one in-app notification",
    );
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
    await db.insert(beautyJobListingAvailabilityTable).values({ listingId: filterRental.id, availabilityPattern: `Availability-${suffix}`, dayLabels: [] });
    const filters: Array<[string, string]> = [
      [`query=query-token-${suffix}`, filterJob.id], ["type=equipment_rental", filterRental.id],
       ["intent=seeking", filterSeeking.id], ["listingMode=offering", filterJob.id], ["listingMode=rental", filterRental.id], ["listingMode=seeking", filterSeeking.id], ["category=frizeri", filterJob.id],
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
    const priceDesc = await request(base, `/beauty-jobs?sort=price_desc&city=PriceCity${suffix}`);
    assert.ok(priceDesc.body.items.findIndex((x: any) => x.id === filterRental.id) < priceDesc.body.items.findIndex((x: any) => x.id === filterJob.id), "price_desc must order fixtures");

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
        `https://beauty-links.example.test/moji-oglasi?tab=inbox&amp;contactId=${contact.body.id}`,
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
        `https://beauty-links.example.test/moji-oglasi?tab=inbox&amp;contactId=${contact.body.id}`,
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
    const studentContact = await request(base, `/beauty-jobs/${customerListing.id}/contact`, student.token, "POST", {
      message: "Studentski kontakt za proveru povratne putanje.",
    });
    assert.equal(studentContact.status, 201);
    assert.equal(
      (await request(base, `/beauty-jobs/contacts/${studentContact.body.id}`, customer.token, "PATCH", {
        authorReply: "Odgovor za studentski nalog.",
      })).status,
      200,
    );
    assert.ok(
      sentEmails.find((email) => email.email === student.user.email.toLowerCase()
        && email.subject.includes("Dobili ste odgovor"))?.htmlContent.includes(
        `https://beauty-links.example.test/moji-oglasi?tab=inbox&amp;contactId=${studentContact.body.id}`,
      ),
      "author-reply email uses the permitted customer inbox route for a student",
    );
    assert.equal(
      (await request(base, "/beauty-jobs/inbox", student.token)).body.contacts.some(
        (item: any) => item.id === studentContact.body.id && item.authorReply,
      ),
      true,
      "the student recipient can read the conversation reached from email",
    );
    const instructorContact = await request(base, `/beauty-jobs/${customerListing.id}/contact`, instructor.token, "POST", {
      message: "Instruktorski kontakt za proveru poslovne povratne putanje.",
    });
    assert.equal(instructorContact.status, 201);
    assert.equal(
      (await request(base, `/beauty-jobs/contacts/${instructorContact.body.id}`, customer.token, "PATCH", {
        authorReply: "Odgovor za instruktorski nalog.",
      })).status,
      200,
    );
    assert.ok(
      sentEmails.find((email) => email.email === instructor.user.email.toLowerCase()
        && email.subject.includes("Dobili ste odgovor"))?.htmlContent.includes(
        `https://beauty-links.example.test/biznis/poslovi?tab=inbox&amp;contactId=${instructorContact.body.id}`,
      ),
      "author-reply email uses the permitted business inbox route for an instructor",
    );
    assert.equal(
      (await request(base, "/beauty-jobs/inbox", instructor.token)).body.contacts.some(
        (item: any) => item.id === instructorContact.body.id && item.authorReply,
      ),
      true,
      "the instructor recipient can read the conversation reached from email",
    );
    const replyNotifications = await db.select().from(beautyJobNotificationsTable)
      .where(eq(beautyJobNotificationsTable.contactId, contact.body.id));
    assert.equal(
      replyNotifications.filter((item) => item.type === "author_reply").length,
      1,
      "concurrent first replies emit one in-app notification",
    );

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

    const report = await request(base, `/beauty-jobs/${customerListing.id}/report`, undefined, "POST", { reason: "Anonimna prijava" });
    assert.equal(report.status, 201); assert.equal(report.body.reporterUserId, null);
    const queue = await request(base, "/admin/beauty-jobs/queue", admin.token);
    assert.equal(queue.status, 200); assert.ok(queue.body.reports.some((x: any) => x.id === report.body.id));
    assert.equal((await request(base, `/admin/beauty-jobs/reports/${report.body.id}/resolve`, admin.token, "POST", { status: "resolved", resolutionNote: "Uklonjeno" })).status, 200);
    assert.equal((await request(base, `/beauty-jobs/${customerListing.id}`)).status, 404, "resolved report must hide listing");

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
        `https://beauty-links.example.test/moji-oglasi?tab=my-jobs&amp;listingId=${warning.id}`,
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
    const limiter = await user("CUSTOMER", "limiter");
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
    if (createdListingIds.length) await db.delete(beautyJobListingsTable).where(inArray(beautyJobListingsTable.id, createdListingIds));
    if (monitorAlertEventKeys.length) {
      await db.delete(emailDeliveriesTable).where(inArray(emailDeliveriesTable.eventKey, monitorAlertEventKeys));
    }
    await db.delete(emailDeliveriesTable).where(like(emailDeliveriesTable.recipientEmail, `%${suffix}%`));
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