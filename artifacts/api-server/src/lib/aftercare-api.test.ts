import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import {
  aftercareCompletionEventsTable, aftercareDeliveriesTable, aftercareRecommendationAppointmentsTable,
  aftercareRecommendationLinesTable, aftercareRecommendationsTable, aftercareSettingsTable,
  appointmentsTable, db, employeesTable, productBundlesTable, productCategoriesTable, productTreatmentMappingsTable,
   productsTable, retailCartsTable, retailOrderItemsTable, retailOrdersTable, salonNotificationsTable, salonsTable, servicesTable, suppliersTable,
  treatmentTaxonomyTable, usersTable,
} from "@workspace/db";
import {
  AdminGetAftercareSettingsResponse, AdminGetAftercareStatisticsResponse,
  CustomerGetAftercareRecommendationResponse,
} from "@workspace/api-zod";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";

const marker = `aftercare-api-${randomUUID()}`;
const ids = { users: [] as string[], salons: [] as string[], products: [] as string[], bundles: [] as string[] };
let server: ReturnType<typeof app.listen> | undefined;
let baseUrl = "";
let admin = "", customer = "", otherCustomer = "", owner = "", manager = "", employee = "";
let adminCookie = "", customerCookie = "", otherCustomerCookie = "", ownerCookie = "", managerCookie = "", employeeCookie = "";
let salonId = "", serviceId = "", employeeId = "", productId = "", secondProductId = "", categoryId = "", supplierSlug = "", treatmentId = "", otherTreatmentId = "";
let settingsBefore: typeof aftercareSettingsTable.$inferSelect | undefined;

async function api(path: string, cookie = "", init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  });
}
async function user(role: "ADMIN" | "CUSTOMER" | "SALON_OWNER" | "SALON_EMPLOYEE") {
  const [row] = await db.insert(usersTable).values({
    firstName: "Aftercare", lastName: role, email: `${marker}-${role}-${ids.users.length}@example.test`,
    passwordHash: await hashPassword(marker), passwordSetAt: new Date(), role,
  }).returning();
  assert.ok(row); ids.users.push(row.id); return row;
}
async function appointment(employeeAssignment: string | null, status: "pending" | "confirmed" | "cancelled" = "confirmed") {
  const [row] = await db.insert(appointmentsTable).values({
    salonId, customerId: customer, serviceId, employeeId: employeeAssignment, date: "2099-01-02",
    startTime: `1${Math.floor(Math.random() * 10)}:00`, endTime: `1${Math.floor(Math.random() * 10)}:30`,
    durationMinutes: 30, price: 1000, status,
  }).returning();
  assert.ok(row); return row;
}
async function eventCount(appointmentId: string) {
  const [row] = await db.select({ count: count() }).from(aftercareCompletionEventsTable)
    .where(eq(aftercareCompletionEventsTable.appointmentId, appointmentId));
  return Number(row?.count ?? 0);
}

test.before(async () => {
  await ensureBusinessGrowthSchema();
  settingsBefore = (await db.select().from(aftercareSettingsTable).where(eq(aftercareSettingsTable.isCurrent, true)).limit(1))[0];
  const a = await user("ADMIN");
  const c = await user("CUSTOMER");
  const c2 = await user("CUSTOMER");
  const o = await user("SALON_OWNER");
  const m = await user("SALON_EMPLOYEE");
  const e = await user("SALON_EMPLOYEE");
  admin = a.id; customer = c.id; otherCustomer = c2.id; owner = o.id; manager = m.id; employee = e.id;
  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner, name: marker, slug: marker, city: "Beograd", municipality: "Vračar", address: "Test 1",
    postalCode: "11000", phone: "+381601234567", email: `${marker}@example.test`, shortDescription: marker,
    description: `${marker} aftercare integration fixture`, imageUrl: "/aftercare-test.jpg",
  }).returning();
  assert.ok(salon); salonId = salon.id; ids.salons.push(salonId);
  const [staff] = await db.insert(employeesTable).values({
    salonId, userId: employee, name: "Aftercare Employee", role: "employee", bio: marker, avatarUrl: "/aftercare-test.jpg",
  }).returning();
  assert.ok(staff); employeeId = staff.id;
  await db.insert(employeesTable).values({
    salonId, userId: manager, name: "Aftercare Manager", role: "manager", bio: marker, avatarUrl: "/aftercare-test.jpg",
  });
  const [service] = await db.insert(servicesTable).values({
    salonId, categoryName: "Nega kože", name: "Piling lica", description: marker, durationMinutes: 30,
    price: 1000, imageUrl: "/aftercare-test.jpg", tags: ["Piling lica", "Glow"],
  }).returning();
  assert.ok(service); serviceId = service.id;
  const [supplier] = await db.insert(suppliersTable).values({
    name: `${marker} supplier`, slug: `${marker}-supplier`, scope: "BOTH",
  }).returning();
  assert.ok(supplier); supplierSlug = supplier.slug;
  const [category] = await db.insert(productCategoriesTable).values({
    supplierId: supplier.id, name: marker, slug: marker,
  }).returning();
  assert.ok(category); categoryId = category.id;
  const [product] = await db.insert(productsTable).values({
    supplierId: supplier.id, categoryId, categoryName: marker, name: `${marker} cream`, description: marker,
    publicDescription: marker, imageUrl: "/aftercare-test.jpg", price: 1000, publicPrice: 1200,
    retailEnabled: true, professionalEnabled: true, stock: 20, sku: marker, unit: "kom",
  }).returning();
  assert.ok(product); productId = product.id; ids.products.push(productId);
  const [secondProduct] = await db.insert(productsTable).values({
    supplierId: supplier.id, categoryId, categoryName: marker, name: `${marker} cleanser`, description: marker,
    publicDescription: marker, imageUrl: "/aftercare-test.jpg", price: 1000, publicPrice: 1200,
    retailEnabled: true, professionalEnabled: true, stock: 20, sku: `${marker}-2`, unit: "kom",
  }).returning();
  assert.ok(secondProduct); secondProductId = secondProduct.id; ids.products.push(secondProductId);
  adminCookie = `${sessionCookieName}=${await createSession(admin)}`;
  customerCookie = `${sessionCookieName}=${await createSession(customer)}`;
  otherCustomerCookie = `${sessionCookieName}=${await createSession(otherCustomer)}`;
  ownerCookie = `${sessionCookieName}=${await createSession(owner)}`;
  managerCookie = `${sessionCookieName}=${await createSession(manager)}`;
  employeeCookie = `${sessionCookieName}=${await createSession(employee)}`;
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

test.after(async () => {
  try {
    if (server) { const done = new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve())); server.closeAllConnections(); await done; }
    // Restore the singleton rather than leaving a test administrator's setting current.
    if (settingsBefore) {
      await db.update(aftercareSettingsTable).set({ isCurrent: false }).where(eq(aftercareSettingsTable.isCurrent, true));
      await db.update(aftercareSettingsTable).set({ isCurrent: true }).where(eq(aftercareSettingsTable.id, settingsBefore.id));
    }
    await db.delete(aftercareSettingsTable).where(eq(aftercareSettingsTable.createdByUserId, admin));
    await db.delete(retailOrdersTable).where(eq(retailOrdersTable.userId, customer));
    await db.delete(retailCartsTable).where(eq(retailCartsTable.userId, customer));
    await db.delete(aftercareRecommendationsTable).where(inArray(aftercareRecommendationsTable.customerUserId, [customer, otherCustomer]));
    await db.delete(aftercareCompletionEventsTable).where(inArray(aftercareCompletionEventsTable.customerUserId, [customer, otherCustomer]));
    await db.delete(appointmentsTable).where(eq(appointmentsTable.salonId, salonId));
    await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (ids.bundles.length) await db.delete(productBundlesTable).where(inArray(productBundlesTable.id, ids.bundles));
    if (ids.products.length) await db.delete(productsTable).where(inArray(productsTable.id, ids.products));
    await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, categoryId));
    await db.delete(suppliersTable).where(eq(suppliersTable.slug, supplierSlug));
    await db.delete(treatmentTaxonomyTable).where(sql`${treatmentTaxonomyTable.categoryName} = ${marker}`);
    await db.delete(usersTable).where(inArray(usersTable.id, ids.users));
  } finally {}
});

test("admin synchronizes normalized taxonomy, replaces product mappings, and maps bundles", async () => {
  const synced = await api(`/admin/aftercare/treatments?search=${encodeURIComponent("piling")}`, adminCookie);
  const syncedBody = await synced.text();
  assert.equal(synced.status, 200, syncedBody);
  const terms = JSON.parse(syncedBody) as Array<{ id: string; taxonomyKey: string; treatmentName: string }>;
  const term = terms.find((item) => item.treatmentName === "Piling lica");
  assert.ok(term); treatmentId = term.id;
  const [extra] = await db.insert(treatmentTaxonomyTable).values({
    taxonomyKey: `${marker.replace(/-/g, "")}-extra`, categoryName: marker, treatmentName: "Extra", searchTerms: ["Extra"],
  }).returning();
  assert.ok(extra); otherTreatmentId = extra.id;
  const duplicateSync = await api("/admin/aftercare/treatments?search=Piling", adminCookie);
  assert.equal(duplicateSync.status, 200);
  assert.equal((await db.select({ count: count() }).from(treatmentTaxonomyTable)
    .where(eq(treatmentTaxonomyTable.taxonomyKey, term.taxonomyKey)))[0]?.count, 1, "sync must dedupe taxonomy keys");
  const update = await api(`/admin/products/${productId}`, adminCookie, {
    method: "PATCH", body: JSON.stringify({ averageDurationDays: 21, treatmentTaxonomyIds: [treatmentId, otherTreatmentId] }),
  });
  const updateBody = await update.text();
  assert.equal(update.status, 200, updateBody);
  assert.deepEqual((JSON.parse(updateBody) as { treatmentTaxonomyIds: string[] }).treatmentTaxonomyIds.sort(), [treatmentId, otherTreatmentId].sort());
  const replace = await api(`/admin/products/${productId}`, adminCookie, {
    method: "PATCH", body: JSON.stringify({ treatmentTaxonomyIds: [otherTreatmentId] }),
  });
  assert.equal(replace.status, 200);
  const mappings = await db.select().from(productTreatmentMappingsTable).where(eq(productTreatmentMappingsTable.productId, productId));
  assert.deepEqual(mappings.map((item) => item.treatmentId), [otherTreatmentId]);
  const bundle = await api("/admin/bundles", adminCookie, {
    method: "POST", body: JSON.stringify({ supplierId: (await db.select({ id: productsTable.supplierId }).from(productsTable).where(eq(productsTable.id, productId)))[0]!.id,
      name: `${marker} bundle`, market: "B2C", b2bPrice: null, b2cPrice: 2000, components: [{ productId, quantity: 1 }, { productId: secondProductId, quantity: 1 }], aftercareTreatmentTaxonomyId: treatmentId }),
  });
  const bundleBody = await bundle.text();
  assert.equal(bundle.status, 201, bundleBody);
  const body = JSON.parse(bundleBody) as { id: string; aftercareTreatmentTaxonomyId: string | null };
  ids.bundles.push(body.id); assert.equal(body.aftercareTreatmentTaxonomyId, treatmentId);
});

test("settings preserve defaults, no-op version, and reject stale writes", async () => {
  const initial = await api("/admin/aftercare/settings", adminCookie);
  assert.equal(initial.status, 200); const settings = AdminGetAftercareSettingsResponse.parse(await initial.json());
  const { version: _version, ...settingValues } = settings;
  const noOp = await api("/admin/aftercare/settings", adminCookie, { method: "PUT", body: JSON.stringify({ ...settingValues, expectedVersion: settings.version }) });
  assert.equal(noOp.status, 200); assert.equal((await noOp.json() as { version: number }).version, settings.version);
  const changed = await api("/admin/aftercare/settings", adminCookie, { method: "PUT", body: JSON.stringify({
    ...settingValues, expectedVersion: settings.version, cooldownDays: settings.cooldownDays + 1,
  }) });
  assert.equal(changed.status, 200); assert.equal((await changed.json() as { version: number }).version, settings.version + 1);
  const stale = await api("/admin/aftercare/settings", adminCookie, { method: "PUT", body: JSON.stringify({ ...settingValues, expectedVersion: settings.version }) });
  assert.equal(stale.status, 409);
});

test("customer inbox ownership and salon-role authorization are closed", async () => {
  const now = new Date();
  const [recommendation] = await db.insert(aftercareRecommendationsTable).values({
    customerUserId: customer, settingsVersion: 1, status: "ACTIVE", entitlementTokenHash: randomUUID().replace(/-/g, ""),
    windowStartedAt: now, windowEndsAt: new Date(+now + 86400_000), activatesAt: now, entitlementExpiresAt: new Date(+now + 86400_000),
    settingsSnapshot: {}, treatmentSnapshot: [{ id: treatmentId, key: "fixture", category: marker, name: "Fixture" }],
  }).returning();
  assert.ok(recommendation);
  const inbox = await api("/customer/aftercare/recommendations", customerCookie); assert.equal(inbox.status, 200);
  assert.ok((await inbox.json() as Array<{ id: string }>).some((item) => item.id === recommendation.id));
  const detail = await api(`/customer/aftercare/recommendations/${recommendation.id}`, customerCookie);
  assert.equal(detail.status, 200); CustomerGetAftercareRecommendationResponse.parse(await detail.json());
  assert.equal((await api(`/customer/aftercare/recommendations/${recommendation.id}`, otherCustomerCookie)).status, 404);
  assert.equal((await api(`/customer/aftercare/recommendations/${recommendation.id}/read`, customerCookie, { method: "POST" })).status, 200);
  for (const cookie of [ownerCookie, managerCookie, employeeCookie]) {
    assert.ok([401, 403].includes((await api("/admin/aftercare/settings", cookie)).status));
    assert.ok([401, 403].includes((await api("/customer/aftercare/recommendations", cookie)).status));
  }
});

test("admin statistics uses immutable delivery, treatment, item, and conversion evidence exactly", async () => {
  const now = new Date();
  const statsAppointment = await appointment(null);
  const [sourceProduct] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
  assert.ok(sourceProduct);
  const [statsProduct] = await db.insert(productsTable).values({
    supplierId: sourceProduct.supplierId, categoryId: sourceProduct.categoryId, categoryName: sourceProduct.categoryName,
    name: `${marker} statistics product`, description: marker, publicDescription: marker, imageUrl: "/aftercare-test.jpg",
    price: 1000, publicPrice: 1200, retailEnabled: true, professionalEnabled: true, stock: 20, sku: `${marker}-statistics`, unit: "kom",
  }).returning();
  assert.ok(statsProduct); ids.products.push(statsProduct.id);
  const [statsBundle] = await db.insert(productBundlesTable).values({
    supplierId: statsProduct.supplierId, name: `${marker} statistics bundle`, market: "B2C", b2bPrice: null, b2cPrice: 2000,
  }).returning();
  assert.ok(statsBundle); ids.bundles.push(statsBundle.id);
  const [statsTreatment] = await db.insert(treatmentTaxonomyTable).values({
    taxonomyKey: `${marker.replace(/-/g, "")}-statistics`, categoryName: marker, treatmentName: "Statistics", searchTerms: ["Statistics"],
  }).returning();
  assert.ok(statsTreatment);
  const [cart] = await db.insert(retailCartsTable).values({ tokenHash: randomUUID().replace(/-/g, ""), userId: customer }).returning();
  assert.ok(cart);
  const [order] = await db.insert(retailOrdersTable).values({
    orderNumber: `${marker}-stats`, cartId: cart.id, userId: customer, trackingTokenHash: randomUUID().replace(/-/g, ""),
    idempotencyKey: `${marker}-stats`, status: "delivered", fulfillmentStatus: "COMPLETED", paymentMethod: "CARD", paymentStatus: "paid", deliveryMethod: "courier",
    subtotal: 4321, total: 4321, shippingName: "Aftercare Stats", shippingAddress: "Test 1", shippingCity: "Beograd",
    shippingPostalCode: "11000", shippingPhone: "+381601234567", shippingEmail: `${marker}@example.test`,
  }).returning();
  assert.ok(order);
  const [recommendation] = await db.insert(aftercareRecommendationsTable).values({
    customerUserId: customer, settingsVersion: 1, status: "CONVERTED", entitlementTokenHash: randomUUID().replace(/-/g, ""),
    windowStartedAt: now, windowEndsAt: new Date(+now + 86_400_000), activatesAt: now,
    entitlementExpiresAt: new Date(+now + 86_400_000), convertedAt: now, convertedOrderId: order.id,
    settingsSnapshot: { source: marker }, treatmentSnapshot: [{ id: statsTreatment.id, key: "stats", category: marker, name: "Stats" }],
  }).returning();
  assert.ok(recommendation);
  await db.insert(aftercareRecommendationAppointmentsTable).values({
    recommendationId: recommendation.id, appointmentId: statsAppointment.id, treatmentId: statsTreatment.id,
    appointmentSnapshot: { fixture: marker },
  });
  const [productLine, bundleLine, personalizedLine] = await db.insert(aftercareRecommendationLinesTable).values([
    { recommendationId: recommendation.id, kind: "PRODUCT", productId: statsProduct.id, treatmentIds: [statsTreatment.id], coveredProductIds: [statsProduct.id],
      catalogSnapshot: { name: "Stats product" }, pricingSnapshot: {}, discountKind: "NONE", discountPercent: 0 },
    { recommendationId: recommendation.id, kind: "PREMADE_BUNDLE", bundleId: statsBundle.id, treatmentIds: [statsTreatment.id], coveredProductIds: [statsProduct.id],
      catalogSnapshot: { name: "Stats bundle" }, pricingSnapshot: {}, discountKind: "NONE", discountPercent: 0 },
    { recommendationId: recommendation.id, kind: "PERSONALIZED_BUNDLE", treatmentIds: [statsTreatment.id], coveredProductIds: [statsProduct.id],
      catalogSnapshot: { name: "Stats personalized" }, pricingSnapshot: {}, discountKind: "NONE", discountPercent: 0 },
  ]).returning();
  assert.ok(productLine && bundleLine && personalizedLine);
  await db.insert(retailOrderItemsTable).values({
    orderId: order.id, productId: statsProduct.id, productName: "Stats product", productImageUrl: "/aftercare-test.jpg",
    productCatalogReference: statsProduct.catalogReference, unitPrice: 4321, quantity: 1,
    supplierId: statsProduct.supplierId,
    supplierName: `${marker} supplier`, supplierSlug, market: "B2C", currency: "RSD",
    lineSubtotal: 4321, lineTotal: 4321, realizedRevenueRsd: 4321, baseUnitPrice: 4321,
    effectiveUnitPrice: 4321, aftercareRecommendationId: recommendation.id, postTreatmentRecommendationDiscountRsd: 1,
  });
  await db.insert(aftercareDeliveriesTable).values([
    { recommendationId: recommendation.id, lineId: null, kind: "FIRST", status: "SENT", eventKey: `${marker}-first`, scheduledAt: now, payloadSnapshot: {} },
    { recommendationId: recommendation.id, lineId: null, kind: "SECOND", status: "SENT", eventKey: `${marker}-second`, scheduledAt: now, payloadSnapshot: {} },
    { recommendationId: recommendation.id, lineId: productLine.id, kind: "REPLENISHMENT", status: "SENT", eventKey: `${marker}-replenish`, scheduledAt: now, payloadSnapshot: {} },
    { recommendationId: recommendation.id, lineId: productLine.id, kind: "FIRST", status: "SENT", eventKey: `${marker}-product`, scheduledAt: now, payloadSnapshot: {} },
    { recommendationId: recommendation.id, lineId: bundleLine.id, kind: "FIRST", status: "SENT", eventKey: `${marker}-bundle`, scheduledAt: now, payloadSnapshot: {} },
    { recommendationId: recommendation.id, lineId: personalizedLine.id, kind: "FIRST", status: "SENT", eventKey: `${marker}-personal`, scheduledAt: now, payloadSnapshot: {} },
  ]);
  const day = now.toISOString().slice(0, 10);
  const response = await api(`/admin/aftercare/statistics?from=${day}&to=${day}&treatmentId=${statsTreatment.id}`, adminCookie);
  const raw = await response.text(); assert.equal(response.status, 200, raw);
  const stats = AdminGetAftercareStatisticsResponse.parse(JSON.parse(raw));
  assert.deepEqual(stats.kpis, {
    recommendationsCreated: 1, firstSent: 4, secondSent: 1, replenishmentSent: 1,
    convertedRecommendations: 1, conversionRevenueRsd: 4321, conversionRatePercent: 100,
  });
  assert.deepEqual(stats.timeSeries, [{ date: day, recommendationsCreated: 1, firstSent: 4, secondSent: 1, replenishmentSent: 1, convertedRecommendations: 1, conversionRevenueRsd: 4321 }]);
  assert.deepEqual(stats.byTreatment.map((item) => [item.treatmentId, item.recommendationsCreated, item.sent, item.convertedRecommendations, item.conversionRevenueRsd]),
    [[statsTreatment.id, 1, 6, 1, 4321]]);
  assert.deepEqual(stats.byItem.map((item) => [item.kind, item.itemId, item.sent, item.convertedRecommendations, item.conversionRevenueRsd]).sort(),
    [["PERSONALIZED_BUNDLE", null, 1, 0, 0], ["PREMADE_BUNDLE", statsBundle.id, 1, 0, 0], ["PRODUCT", statsProduct.id, 2, 1, 4321]].sort());
  for (const filter of [
    `productId=${statsProduct.id}`,
    `bundleId=${statsBundle.id}`,
    `productId=${statsProduct.id}&kind=PERSONALIZED_BUNDLE`,
  ]) {
    const filtered = await api(`/admin/aftercare/statistics?from=${day}&to=${day}&${filter}`, adminCookie);
    assert.equal(filtered.status, 200); assert.equal((await filtered.json() as { kpis: { recommendationsCreated: number } }).kpis.recommendationsCreated, 1);
  }
  assert.equal((await api(`/admin/aftercare/statistics?from=${day}&to=2000-01-01`, adminCookie)).status, 400);
  assert.equal((await api(`/admin/aftercare/statistics?from=2020-01-01&to=2022-01-02`, adminCookie)).status, 400);
  assert.equal((await api(`/admin/aftercare/statistics?from=${day}&to=${day}`, ownerCookie)).status, 403);
});

test("public retail, supplier, and salon DTOs never expose aftercare internals", async () => {
  const responses = await Promise.all([
    api(`/shop/public/products/${productId}`),
    api(`/suppliers/${supplierSlug}/products/${productId}`, ownerCookie),
    api(`/salons/${marker}`),
  ]);
  for (const response of responses) {
    const rawText = await response.text();
    assert.equal(response.status, 200, rawText);
    const raw = JSON.parse(rawText) as Record<string, unknown>;
    for (const forbidden of ["averageDurationDays", "treatmentTaxonomyIds", "aftercareTreatmentTaxonomyId"]) {
      assert.equal(JSON.stringify(raw).includes(`"${forbidden}"`), false, `DTO leaked ${forbidden}`);
    }
  }
});

test("both completion transitions enqueue once, while replay, no-show, cancellation and notifications do not", async () => {
  const notifications = await db.select({ count: count() }).from(salonNotificationsTable).where(eq(salonNotificationsTable.salonId, salonId));
  const ownerAppointment = await appointment(null);
  let response = await api(`/salon/appointments/${ownerAppointment.id}`, ownerCookie, { method: "PATCH", body: JSON.stringify({ status: "completed" }) });
  assert.equal(response.status, 200, await response.text()); assert.equal(await eventCount(ownerAppointment.id), 1);
  response = await api(`/salon/appointments/${ownerAppointment.id}`, ownerCookie, { method: "PATCH", body: JSON.stringify({ status: "completed" }) });
  assert.ok([200, 409].includes(response.status)); assert.equal(await eventCount(ownerAppointment.id), 1);
  const employeeAppointment = await appointment(employeeId);
  response = await api(`/employee/appointments/${employeeAppointment.id}`, employeeCookie, { method: "PATCH", body: JSON.stringify({ status: "completed" }) });
  assert.equal(response.status, 200, await response.text()); assert.equal(await eventCount(employeeAppointment.id), 1);
  const noShow = await appointment(employeeId);
  assert.equal((await api(`/employee/appointments/${noShow.id}`, employeeCookie, { method: "PATCH", body: JSON.stringify({ status: "no-show" }) })).status, 200);
  assert.equal(await eventCount(noShow.id), 0);
  const cancelled = await appointment(null, "cancelled");
  assert.equal(await eventCount(cancelled.id), 0);
  const after = await db.select({ count: count() }).from(salonNotificationsTable).where(eq(salonNotificationsTable.salonId, salonId));
  assert.equal(after[0]?.count, notifications[0]?.count, "aftercare completion must not create salon notifications");
});