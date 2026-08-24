import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import {
  beautyJobCategoriesTable, beautyJobListingAvailabilityTable, beautyJobListingsTable,
  beautyJobPlatformSettingsTable, db, pool, salonsTable, usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";

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

async function user(role: "ADMIN" | "CUSTOMER" | "SALON_EMPLOYEE" | "SALON_OWNER", label: string) {
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
  try {
    const [settings] = await db.select().from(beautyJobPlatformSettingsTable).limit(1);
    originalSettings = settings;
    const admin = await user("ADMIN", "admin");
    const customer = await user("CUSTOMER", "customer");
    const applicant = await user("CUSTOMER", "applicant");
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

    const approveCustomer = await request(base, `/admin/beauty-jobs/${customerListing.id}/moderation`, admin.token, "POST", { action: "approve" });
    assert.equal(approveCustomer.status, 200);
    const edited = await request(base, `/beauty-jobs/${customerListing.id}`, customer.token, "PATCH", { title: `Edited ${suffix}` });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.moderationStatus, "pending", "editing must re-enter moderation");
    await request(base, `/admin/beauty-jobs/${customerListing.id}/moderation`, admin.token, "POST", { action: "approve" });

    assert.equal((await request(base, "/beauty-jobs", customer.token, "POST", body(rentalCategory.id, "Wrong rental"))).status, 400);
    assert.equal((await request(base, "/beauty-jobs", customer.token, "POST", body(rentalCategory.id, "No availability", { type: "equipment_rental" }))).status, 400);
    assert.equal((await request(base, "/beauty-jobs", customer.token, "POST", body(rentalCategory.id, "Coordinates", { type: "equipment_rental", availabilityPattern: "Pon-Pet", latitude: 44.8, longitude: 20.4 }))).status, 400);
    const rentalCreate = await request(base, "/beauty-jobs", customer.token, "POST", body(rentalCategory.id, `Rental ${suffix}`, { type: "equipment_rental", availabilityPattern: "Pon-Pet", dayLabels: ["Ponedeljak"] }));
    assert.equal(rentalCreate.status, 201);
    createdListingIds.push(rentalCreate.body.id);
    assert.equal(rentalCreate.body.latitude, null);
    assert.equal((await request(base, `/beauty-jobs/${rentalCreate.body.id}`, customer.token, "PATCH", { latitude: 44.8, longitude: 20.4 })).status, 400, "rental updates must reject exact coordinates");

    // Individually identifiable approved fixtures keep every public filter deterministic.
    const filterJob = await insertApproved(hairCategory.id, customer.user.id, `query-token-${suffix}`, { city: `QueryCity${suffix}`, region: `QueryRegion${suffix}`, priceAmount: 111, latitude: 44.8, longitude: 20.4 });
    const filterRental = await insertApproved(rentalCategory.id, customer.user.id, `rental-token-${suffix}`, { type: "equipment_rental", intent: "seeking", city: `RentalCity${suffix}`, region: `RentalRegion${suffix}`, priceAmount: 999 });
    await db.insert(beautyJobListingAvailabilityTable).values({ listingId: filterRental.id, availabilityPattern: `Availability-${suffix}`, dayLabels: [] });
    const filters: Array<[string, string]> = [
      [`query=query-token-${suffix}`, filterJob.id], ["type=equipment_rental", filterRental.id],
      ["intent=seeking", filterRental.id], ["category=frizeri", filterJob.id],
      [`city=QueryCity${suffix}`, filterJob.id], [`region=QueryRegion${suffix}`, filterJob.id],
      ["minPrice=900", filterRental.id], ["maxPrice=200", filterJob.id],
      [`availability=Availability-${suffix}`, filterRental.id], ["sort=price_asc", filterJob.id],
      ["sort=oldest", publicListing.id], ["sort=nearest&latitude=44.8&longitude=20.4", filterJob.id],
    ];
    for (const [query, expected] of filters) {
      const result = await request(base, `/beauty-jobs?${query}`);
      assert.equal(result.status, 200, `filter ${query} must succeed`);
      assert.ok(result.body.items.some((item: any) => item.id === expected), `filter ${query} must include isolated fixture`);
    }
    const priceDesc = await request(base, "/beauty-jobs?sort=price_desc");
    assert.ok(priceDesc.body.items.findIndex((x: any) => x.id === filterRental.id) < priceDesc.body.items.findIndex((x: any) => x.id === filterJob.id), "price_desc must order fixtures");

    const save = await request(base, `/beauty-jobs/${customerListing.id}/save`, applicant.token, "POST");
    assert.equal(save.status, 200); assert.equal(save.body.saved, true);
    assert.equal((await request(base, "/beauty-jobs/saved", applicant.token)).body.items.some((x: any) => x.id === customerListing.id), true);
    const contact = await request(base, `/beauty-jobs/${customerListing.id}/contact`, applicant.token, "POST", { message: "Želim da se prijavim." });
    assert.equal(contact.status, 201);
    assert.equal((await request(base, "/beauty-jobs/inbox", customer.token)).body.contacts.some((x: any) => x.id === contact.body.id), true);
    assert.equal((await request(base, `/beauty-jobs/contacts/${contact.body.id}`, otherOwner.token, "PATCH", { authorReply: "Neovlašćeno" })).status, 404);
    assert.equal((await request(base, `/beauty-jobs/contacts/${contact.body.id}`, customer.token, "PATCH", { authorReply: "Hvala" })).status, 200);

    const report = await request(base, `/beauty-jobs/${customerListing.id}/report`, undefined, "POST", { reason: "Anonimna prijava" });
    assert.equal(report.status, 201); assert.equal(report.body.reporterUserId, null);
    const queue = await request(base, "/admin/beauty-jobs/queue", admin.token);
    assert.equal(queue.status, 200); assert.ok(queue.body.reports.some((x: any) => x.id === report.body.id));
    assert.equal((await request(base, `/admin/beauty-jobs/reports/${report.body.id}/resolve`, admin.token, "POST", { status: "resolved", resolutionNote: "Uklonjeno" })).status, 200);
    assert.equal((await request(base, `/beauty-jobs/${customerListing.id}`)).status, 404, "resolved report must hide listing");

    assert.equal((await request(base, "/admin/beauty-jobs/settings", admin.token)).status, 200);
    assert.equal((await request(base, "/admin/beauty-jobs/settings", admin.token, "PATCH", { listingExpiryDays: 2, hourlyPostingLimit: 1 })).status, 200);
    const expired = await insertApproved(hairCategory.id, customer.user.id, `Expired ${suffix}`, { expiresAt: new Date(Date.now() - 1000) });
    assert.equal((await request(base, "/admin/beauty-jobs/expiry-sweep", admin.token, "POST")).status, 200);
    const [expiredAfterSweep] = await db.select({ status: beautyJobListingsTable.status }).from(beautyJobListingsTable).where(eq(beautyJobListingsTable.id, expired.id));
    assert.equal(expiredAfterSweep?.status, "expired", "expiry sweep must expire past-due listings");
    assert.equal((await request(base, `/beauty-jobs/${expired.id}/renew`, customer.token, "POST")).status, 200);

    // A fresh author proves the advisory-lock hourly limit under concurrent requests.
    const limiter = await user("CUSTOMER", "limiter");
    const concurrent = await Promise.all([
      request(base, "/beauty-jobs", limiter.token, "POST", body(hairCategory.id, `Limit A ${suffix}`)),
      request(base, "/beauty-jobs", limiter.token, "POST", body(hairCategory.id, `Limit B ${suffix}`)),
    ]);
    assert.deepEqual(concurrent.map((x) => x.status).sort(), [201, 429], "one concurrent create must be rate limited");
    for (const result of concurrent) if (result.status === 201) createdListingIds.push(result.body.id);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    if (originalSettings) await db.update(beautyJobPlatformSettingsTable).set({
      listingExpiryDays: originalSettings.listingExpiryDays, hourlyPostingLimit: originalSettings.hourlyPostingLimit,
      updatedByUserId: originalSettings.updatedByUserId, updatedAt: originalSettings.updatedAt,
    }).where(eq(beautyJobPlatformSettingsTable.id, originalSettings.id));
    else await db.delete(beautyJobPlatformSettingsTable);
    if (createdListingIds.length) await db.delete(beautyJobListingsTable).where(inArray(beautyJobListingsTable.id, createdListingIds));
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