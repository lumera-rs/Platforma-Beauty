import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  aftercareCompletionEventsTable,
  aftercareDeliveriesTable,
  aftercareRecommendationAppointmentsTable,
  aftercareRecommendationLinesTable,
  aftercareRecommendationsTable,
  aftercareSettingsTable,
  appointmentsTable,
  db,
  productBundlesTable,
  productTreatmentMappingsTable,
  productsTable,
  retailCartsTable,
  retailOrderItemsTable,
  retailOrdersTable,
  salonCustomersTable,
  salonNotificationsTable,
  salonsTable,
  servicesTable,
  suppliersTable,
  treatmentTaxonomyTable,
  usersTable,
} from "@workspace/db";
import { enqueueAftercareCompletionDefault, normalizeTreatmentTaxonomyKey } from "./aftercare-domain";
import {
  deliverAftercareEmails,
  processAftercareCompletionEvents,
  reconcileAftercareConversions,
  reconcileAftercareProviderEvent,
  scheduleAftercareFollowups,
} from "./aftercare-worker";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";

const marker = `aftercare-worker-it-${randomUUID()}`;
const now = new Date("2032-05-20T10:00:00.000Z");
const ids = {
  users: [] as string[], salons: [] as string[], services: [] as string[], appointments: [] as string[],
  customers: [] as string[], products: [] as string[], bundles: [] as string[], carts: [] as string[],
  orders: [] as string[], taxonomies: [] as string[],
};
let supplierId: string | undefined;
let originalSettings: typeof aftercareSettingsTable.$inferSelect | undefined;
let insertedSettingsId: string | undefined;

async function user(role: "CUSTOMER" | "JOBSEEKER" | "SALON_OWNER" = "CUSTOMER") {
  const [created] = await db.insert(usersTable).values({
    firstName: "Aftercare", lastName: marker, email: `${role.toLowerCase()}-${randomUUID()}@example.test`,
    passwordHash: "test-only-password-hash", role,
  }).returning();
  assert.ok(created);
  ids.users.push(created.id);
  return created;
}

async function appointment(customerId: string | null, salonCustomerId: string | null, serviceId: string, date = "2032-05-20") {
  const [created] = await db.insert(appointmentsTable).values({
    salonId: ids.salons[0]!, customerId, salonCustomerId, serviceId, date,
    startTime: "10:00", endTime: "11:00", durationMinutes: 60, price: 1000, status: "completed",
  }).returning();
  assert.ok(created);
  ids.appointments.push(created.id);
  return created;
}

async function retailOrder(customerId: string, productId: string, input: {
  status?: "pending" | "delivered" | "cancelled"; paymentStatus?: "unpaid" | "pending" | "paid" | "refunded";
  paymentMethod?: "CARD" | "CASH_ON_DELIVERY"; createdAt?: Date; aftercareRecommendationId?: string | null;
} = {}) {
  const [cart] = await db.insert(retailCartsTable).values({
    tokenHash: `${marker}-cart-${randomUUID()}`, userId: customerId,
  }).returning();
  assert.ok(cart);
  ids.carts.push(cart.id);
  const [order] = await db.insert(retailOrdersTable).values({
    orderNumber: `${marker}-${randomUUID()}`, cartId: cart.id, userId: customerId,
    trackingTokenHash: `${marker}-tracking-${randomUUID()}`, idempotencyKey: `${marker}-${randomUUID()}`,
    status: input.status ?? "delivered", paymentStatus: input.paymentStatus ?? "paid",
    paymentMethod: input.paymentMethod ?? "CARD", subtotal: 1000, total: 1000,
    shippingName: "Aftercare Test", shippingAddress: "Test 1", shippingCity: "Novi Sad",
    shippingPostalCode: "21000", shippingPhone: "+381601234567", shippingEmail: "aftercare@example.test",
    createdAt: input.createdAt ?? now, updatedAt: input.createdAt ?? now,
  }).returning();
  assert.ok(order);
  ids.orders.push(order.id);
  const attributed = input.aftercareRecommendationId === undefined
    ? (await db.select({ id: aftercareRecommendationsTable.id }).from(aftercareRecommendationsTable)
      .where(eq(aftercareRecommendationsTable.customerUserId, customerId))
      .orderBy(desc(aftercareRecommendationsTable.createdAt)).limit(1))[0]?.id ?? null
    : input.aftercareRecommendationId;
  await db.insert(retailOrderItemsTable).values({
    orderId: order.id, productId, productName: "Aftercare product", productImageUrl: "/test.jpg",
    unitPrice: 1000, quantity: 1, supplierId: supplierId!, supplierName: "Aftercare supplier",
    supplierSlug: `${marker}-supplier`, lineSubtotal: 1000, lineTotal: 1000, aftercareRecommendationId: attributed,
  });
  return order;
}

test.before(async () => {
  await ensureBusinessGrowthSchema();
  originalSettings = (await db.select().from(aftercareSettingsTable).where(eq(aftercareSettingsTable.isCurrent, true)).limit(1))[0];
  const settingValues = {
    version: originalSettings?.version ?? 90_000,
    isCurrent: true, firstTiming: "IMMEDIATE_AFTER_COMPLETION" as const, cooldownDays: 30,
    secondReminderDelayDays: 2, postTreatmentDiscountEnabled: true, postTreatmentDiscountPercent: 15,
    postTreatmentDiscountValidityDays: 30, personalizedBundleDiscountPercent: 10,
    combinationWindowDays: 30,
  };
  if (originalSettings) {
    await db.update(aftercareSettingsTable).set(settingValues).where(eq(aftercareSettingsTable.id, originalSettings.id));
  } else {
    const [settings] = await db.insert(aftercareSettingsTable).values(settingValues).returning();
    insertedSettingsId = settings!.id;
  }
  const owner = await user("SALON_OWNER");
  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner.id, name: `Aftercare ${marker}`, slug: `${marker}-salon`, city: "Novi Sad",
    municipality: "Novi Sad", address: "Test 1", phone: "+381601234567", email: "salon@example.test",
    shortDescription: "Aftercare integration fixture", description: "Aftercare integration fixture", imageUrl: "/test.jpg",
  }).returning();
  assert.ok(salon);
  ids.salons.push(salon.id);
  const [service] = await db.insert(servicesTable).values({
    salonId: salon.id, categoryName: `Nega ${marker}`, name: "Tretman lica",
    description: "Aftercare service", durationMinutes: 60, price: 1000, imageUrl: "/test.jpg", tags: ["nega"],
  }).returning();
  assert.ok(service);
  ids.services.push(service.id);
  const key = normalizeTreatmentTaxonomyKey(service.categoryName, service.name);
  const [taxonomy] = await db.insert(treatmentTaxonomyTable).values({
    taxonomyKey: key, categoryName: service.categoryName, treatmentName: service.name, searchTerms: ["nega"],
  }).returning();
  assert.ok(taxonomy);
  ids.taxonomies.push(taxonomy.id);
  const [supplier] = await db.insert(suppliersTable).values({
    name: "Aftercare supplier", slug: `${marker}-supplier`, scope: "BOTH",
  }).returning();
  supplierId = supplier!.id;
  for (const [name, duration] of [["Serum", 10], ["Krema", 20]] as const) {
    const [product] = await db.insert(productsTable).values({
      supplierId, categoryName: "Nega", name: `${name} ${marker}`, description: "Aftercare product",
      imageUrl: "/test.jpg", price: 1000, publicPrice: 1000, retailEnabled: true,
      professionalEnabled: false, stock: 5, sku: `${marker}-${name}`, unit: "kom", averageDurationDays: duration,
    }).returning();
    ids.products.push(product!.id);
    await db.insert(productTreatmentMappingsTable).values({ productId: product!.id, treatmentId: taxonomy.id });
  }
});

test.after(async () => {
  if (ids.orders.length) await db.delete(retailOrderItemsTable).where(inArray(retailOrderItemsTable.orderId, ids.orders));
  if (ids.orders.length) await db.delete(retailOrdersTable).where(inArray(retailOrdersTable.id, ids.orders));
  if (ids.carts.length) await db.delete(retailCartsTable).where(inArray(retailCartsTable.id, ids.carts));
  if (ids.users.length) await db.delete(aftercareRecommendationsTable)
    .where(inArray(aftercareRecommendationsTable.customerUserId, ids.users));
  if (ids.appointments.length) await db.delete(aftercareCompletionEventsTable).where(inArray(aftercareCompletionEventsTable.appointmentId, ids.appointments));
  if (ids.appointments.length) await db.delete(appointmentsTable).where(inArray(appointmentsTable.id, ids.appointments));
  if (ids.bundles.length) await db.delete(productBundlesTable).where(inArray(productBundlesTable.id, ids.bundles));
  if (ids.products.length) await db.delete(productsTable).where(inArray(productsTable.id, ids.products));
  if (ids.taxonomies.length) await db.delete(treatmentTaxonomyTable).where(inArray(treatmentTaxonomyTable.id, ids.taxonomies));
  if (supplierId) await db.delete(suppliersTable).where(eq(suppliersTable.id, supplierId));
  if (ids.services.length) await db.delete(servicesTable).where(inArray(servicesTable.id, ids.services));
  if (ids.customers.length) await db.delete(salonCustomersTable).where(inArray(salonCustomersTable.id, ids.customers));
  if (ids.salons.length) await db.delete(salonsTable).where(inArray(salonsTable.id, ids.salons));
  if (ids.users.length) await db.delete(usersTable).where(inArray(usersTable.id, ids.users));
  if (originalSettings) await db.update(aftercareSettingsTable).set(originalSettings).where(eq(aftercareSettingsTable.id, originalSettings.id));
  if (insertedSettingsId) await db.delete(aftercareSettingsTable).where(eq(aftercareSettingsTable.id, insertedSettingsId));
});

test("completion retries are idempotent, combine thirty-day linked treatments, and skip an unlinked guest", async () => {
  const direct = await user();
  const linked = await user("JOBSEEKER");
  const [salonCustomer] = await db.insert(salonCustomersTable).values({
    salonId: ids.salons[0]!, userId: linked.id, firstName: "Linked", lastName: "Customer",
  }).returning();
  ids.customers.push(salonCustomer!.id);
  const directAppointment = await appointment(direct.id, null, ids.services[0]!);
  const linkedAppointment = await appointment(null, salonCustomer!.id, ids.services[0]!, "2032-05-10");
  const guestAppointment = await appointment(null, null, ids.services[0]!);
  assert.equal(await enqueueAftercareCompletionDefault({ appointmentId: directAppointment.id, transitionKey: `${marker}-direct`, completedAt: now }), true);
  assert.equal(await enqueueAftercareCompletionDefault({ appointmentId: directAppointment.id, transitionKey: `${marker}-direct`, completedAt: now }), false);
  assert.equal(await enqueueAftercareCompletionDefault({ appointmentId: linkedAppointment.id, transitionKey: `${marker}-linked`, completedAt: now }), true);
  assert.equal(await enqueueAftercareCompletionDefault({ appointmentId: guestAppointment.id, transitionKey: `${marker}-guest`, completedAt: now }), true);
  await processAftercareCompletionEvents({ now, batchSize: 10 });
  const directRecommendation = (await db.select().from(aftercareRecommendationsTable)
    .where(eq(aftercareRecommendationsTable.customerUserId, direct.id)))[0];
  const linkedRecommendation = (await db.select().from(aftercareRecommendationsTable)
    .where(eq(aftercareRecommendationsTable.customerUserId, linked.id)))[0];
  assert.ok(directRecommendation && linkedRecommendation);
  assert.equal((await db.select().from(aftercareRecommendationAppointmentsTable)
    .where(eq(aftercareRecommendationAppointmentsTable.recommendationId, linkedRecommendation.id))).length, 1);
  const [guestEvent] = await db.select().from(aftercareCompletionEventsTable)
    .where(eq(aftercareCompletionEventsTable.appointmentId, guestAppointment.id));
  const fixtureEvents = await db.select().from(aftercareCompletionEventsTable)
    .where(inArray(aftercareCompletionEventsTable.appointmentId, [
      directAppointment.id, linkedAppointment.id, guestAppointment.id,
    ]));
  assert.equal(fixtureEvents.filter((event) => event.processedAt !== null).length, 3);
  assert.equal(guestEvent?.lastError, "unlinked_customer");
});

test("settled B2C cooldown is per-product, prefers B2C bundles, and provider replay is idempotent", async () => {
  const customer = await user();
  await retailOrder(customer.id, ids.products[0]!, { createdAt: new Date(now.getTime() - 29 * 86_400_000) });
  for (const paymentStatus of ["pending", "refunded", "unpaid"] as const) {
    await retailOrder(customer.id, ids.products[1]!, { paymentStatus, createdAt: now });
  }
  const [bundle] = await db.insert(productBundlesTable).values({
    supplierId: supplierId!, name: `B2C bundle ${marker}`, market: "B2C", b2cPrice: 1500,
    linkedTreatmentId: ids.taxonomies[0]!,
  }).returning();
  ids.bundles.push(bundle!.id);
  const completed = await appointment(customer.id, null, ids.services[0]!);
  await enqueueAftercareCompletionDefault({ appointmentId: completed.id, transitionKey: `${marker}-cooldown`, completedAt: now });
  await processAftercareCompletionEvents({ now });
  const [recommendation] = await db.select().from(aftercareRecommendationsTable)
    .where(eq(aftercareRecommendationsTable.customerUserId, customer.id));
  assert.ok(recommendation);
  const [line] = await db.select().from(aftercareRecommendationLinesTable)
    .where(eq(aftercareRecommendationLinesTable.recommendationId, recommendation.id));
  assert.equal(line?.kind, "PREMADE_BUNDLE");
  assert.deepEqual(line?.coveredProductIds, [ids.products[1]], "paid product is cooled down but unpaid products remain eligible");
  const [firstDelivery] = await db.select().from(aftercareDeliveriesTable)
    .where(and(eq(aftercareDeliveriesTable.recommendationId, recommendation.id), eq(aftercareDeliveriesTable.kind, "FIRST")));
  assert.ok(firstDelivery);

  const calls: Array<{ key: string; href: string; to: string }> = [];
  const accepted = new Map<string, string>();
  let lastProviderKey = "";
  const transport = { send: async (message: { idempotencyKey: string; htmlContent: string; to: { email: string } }) => {
    lastProviderKey = message.idempotencyKey;
    calls.push({ key: message.idempotencyKey, href: message.htmlContent, to: message.to.email });
    return { messageId: accepted.get(message.idempotencyKey) ?? accepted.set(message.idempotencyKey, `fake-${accepted.size + 1}`).get(message.idempotencyKey)! };
  } };
  let crashOnce = true;
  await deliverAftercareEmails({
    now, transport, publicOrigin: "https://app.example.test",
    afterProviderAccepted: () => {
      if (crashOnce && lastProviderKey === firstDelivery.id) {
        crashOnce = false;
        throw new Error("crash after acceptance");
      }
    },
  });
  await deliverAftercareEmails({ now: new Date(now.getTime() + 1), transport, publicOrigin: "https://app.example.test" });
  const ownCalls = calls.filter((call) => call.key === firstDelivery.id);
  assert.equal(ownCalls.length, 2);
  assert.equal(new Set(ownCalls.map((call) => call.key)).size, 1);
  assert.match(ownCalls[0]!.href, /https:\/\/app\.example\.test\/moj-nalog\/nega-posle-tretmana\?recommendationId=/);
  assert.equal(ownCalls[0]!.to, customer.email);
});

test("follow-up is delayed, a delivered purchase converts and replenishment reschedules from its newest purchase", async () => {
  const customer = await user();
  const completed = await appointment(customer.id, null, ids.services[0]!);
  await enqueueAftercareCompletionDefault({ appointmentId: completed.id, transitionKey: `${marker}-followup`, completedAt: now });
  await processAftercareCompletionEvents({ now });
  const [recommendation] = await db.select().from(aftercareRecommendationsTable).where(eq(aftercareRecommendationsTable.customerUserId, customer.id));
  assert.ok(recommendation);
  const fake = { send: async () => ({ messageId: "followup-fake" }) };
  await deliverAftercareEmails({ now, transport: fake, publicOrigin: "https://app.example.test" });
  await scheduleAftercareFollowups(new Date(now.getTime() + 86_400_000));
  assert.equal((await db.select().from(aftercareDeliveriesTable).where(and(
    eq(aftercareDeliveriesTable.recommendationId, recommendation.id), eq(aftercareDeliveriesTable.kind, "SECOND"),
  ))).length, 0);
  await scheduleAftercareFollowups(new Date(now.getTime() + 2 * 86_400_000));
  assert.equal((await db.select().from(aftercareDeliveriesTable).where(and(
    eq(aftercareDeliveriesTable.recommendationId, recommendation.id), eq(aftercareDeliveriesTable.kind, "SECOND"),
  ))).length, 1);
  const order = await retailOrder(customer.id, ids.products[0]!, { createdAt: new Date(now.getTime() + 3 * 86_400_000) });
  const reconciliation = await reconcileAftercareConversions(new Date(now.getTime() + 3 * 86_400_000));
  assert.ok(reconciliation.converted >= 1, "the fixture's delivered order must be reconciled");
  const [converted] = await db.select().from(aftercareRecommendationsTable).where(eq(aftercareRecommendationsTable.id, recommendation.id));
  assert.equal(converted?.status, "CONVERTED");
  await reconcileAftercareConversions(new Date(now.getTime() + 5 * 86_400_000));
  const [line] = await db.select().from(aftercareRecommendationLinesTable).where(eq(aftercareRecommendationLinesTable.recommendationId, recommendation.id));
  assert.equal(line?.purchasedOrderId, order.id);
  assert.equal(line?.replenishmentDueAt?.toISOString(), new Date(now.getTime() + 13 * 86_400_000).toISOString());
});

test("NEXT_DAY schedules 08:00 UTC while immediate activation is exact, without salon notifications", async () => {
  const notificationCount = Number((await db.execute<{ count: string }>(
    sql`SELECT count(*)::text count FROM salon_notifications`,
  )).rows[0]!.count);
  const current = (await db.select().from(aftercareSettingsTable)
    .where(eq(aftercareSettingsTable.isCurrent, true)).limit(1))[0]!;
  const immediateCustomer = await user();
  const immediateAppointment = await appointment(immediateCustomer.id, null, ids.services[0]!);
  await enqueueAftercareCompletionDefault({ appointmentId: immediateAppointment.id, transitionKey: `${marker}-immediate`, completedAt: now });
  await processAftercareCompletionEvents({ now });
  const [immediate] = await db.select().from(aftercareRecommendationsTable)
    .where(eq(aftercareRecommendationsTable.customerUserId, immediateCustomer.id));
  assert.equal(immediate?.activatesAt.toISOString(), now.toISOString());
  const [immediateDelivery] = await db.select().from(aftercareDeliveriesTable)
    .where(eq(aftercareDeliveriesTable.recommendationId, immediate!.id));
  assert.equal(immediateDelivery?.scheduledAt.toISOString(), now.toISOString());

  await db.update(aftercareSettingsTable).set({ firstTiming: "NEXT_DAY" }).where(eq(aftercareSettingsTable.id, current.id));
  try {
    const nextCustomer = await user();
    const nextAppointment = await appointment(nextCustomer.id, null, ids.services[0]!);
    await enqueueAftercareCompletionDefault({ appointmentId: nextAppointment.id, transitionKey: `${marker}-next-day`, completedAt: now });
    await processAftercareCompletionEvents({ now });
    const [next] = await db.select().from(aftercareRecommendationsTable)
      .where(eq(aftercareRecommendationsTable.customerUserId, nextCustomer.id));
    assert.equal(next?.activatesAt.toISOString(), "2032-05-21T08:00:00.000Z");
    const [delivery] = await db.select().from(aftercareDeliveriesTable)
      .where(eq(aftercareDeliveriesTable.recommendationId, next!.id));
    assert.equal(delivery?.scheduledAt.toISOString(), "2032-05-21T08:00:00.000Z");
  } finally {
    await db.update(aftercareSettingsTable).set({ firstTiming: "IMMEDIATE_AFTER_COMPLETION" })
      .where(eq(aftercareSettingsTable.id, current.id));
  }
  const afterCount = Number((await db.execute<{ count: string }>(
    sql`SELECT count(*)::text count FROM salon_notifications`,
  )).rows[0]!.count);
  assert.equal(afterCount, notificationCount);
});

test("dynamic fallback ignores B2B bundles and snapshots every deduplicated required product", async () => {
  if (ids.bundles.length) {
    await db.update(productBundlesTable).set({ active: false }).where(inArray(productBundlesTable.id, ids.bundles));
  }
  const [b2b] = await db.insert(productBundlesTable).values({
    supplierId: supplierId!, name: `B2B only ${marker}`, market: "B2B", b2bPrice: 1200,
    linkedTreatmentId: ids.taxonomies[0]!,
  }).returning();
  ids.bundles.push(b2b!.id);
  const customer = await user();
  const completed = await appointment(customer.id, null, ids.services[0]!);
  await enqueueAftercareCompletionDefault({ appointmentId: completed.id, transitionKey: `${marker}-dynamic`, completedAt: now });
  await processAftercareCompletionEvents({ now });
  const [recommendation] = await db.select().from(aftercareRecommendationsTable)
    .where(eq(aftercareRecommendationsTable.customerUserId, customer.id));
  const lines = await db.select().from(aftercareRecommendationLinesTable)
    .where(eq(aftercareRecommendationLinesTable.recommendationId, recommendation!.id));
  assert.equal(lines.length, 1, "required products form one all-or-nothing offer");
  assert.equal(lines[0]!.kind, "PERSONALIZED_BUNDLE");
  assert.equal(lines[0]!.bundleId, null);
  assert.deepEqual(new Set(lines[0]!.coveredProductIds), new Set(ids.products));
  const snapshot = lines[0]!.catalogSnapshot as { products: Array<{ id: string }> };
  assert.deepEqual(new Set(snapshot.products.map((product) => product.id)), new Set(ids.products));
});

test("cooldown applies only to settled delivered paid or unpaid COD purchases", async () => {
  const qualifyingCases = [
    { paymentStatus: "paid" as const, paymentMethod: "CARD" as const },
    { paymentStatus: "unpaid" as const, paymentMethod: "CASH_ON_DELIVERY" as const },
  ];
  for (const [index, settled] of qualifyingCases.entries()) {
    const customer = await user();
    await retailOrder(customer.id, ids.products[0]!, { ...settled, createdAt: now });
    await retailOrder(customer.id, ids.products[1]!, {
      status: index ? "cancelled" : "pending",
      paymentStatus: index ? "refunded" : "paid",
      paymentMethod: index ? "CARD" : "CASH_ON_DELIVERY",
      createdAt: now,
    });
    const completed = await appointment(customer.id, null, ids.services[0]!);
    await enqueueAftercareCompletionDefault({ appointmentId: completed.id, transitionKey: `${marker}-settled-${index}`, completedAt: now });
    await processAftercareCompletionEvents({ now });
    const [recommendation] = await db.select().from(aftercareRecommendationsTable)
      .where(eq(aftercareRecommendationsTable.customerUserId, customer.id));
    const [line] = await db.select().from(aftercareRecommendationLinesTable)
      .where(eq(aftercareRecommendationLinesTable.recommendationId, recommendation!.id));
    assert.deepEqual(line!.coveredProductIds, [ids.products[1]]);
  }
});

test("refund/cancellation removes mutable conversion attribution but preserves immutable evidence", async () => {
  const customer = await user();
  const completed = await appointment(customer.id, null, ids.services[0]!);
  await enqueueAftercareCompletionDefault({ appointmentId: completed.id, transitionKey: `${marker}-refund`, completedAt: now });
  await processAftercareCompletionEvents({ now });
  const [recommendation] = await db.select().from(aftercareRecommendationsTable)
    .where(eq(aftercareRecommendationsTable.customerUserId, customer.id));
  const [lineBefore] = await db.select().from(aftercareRecommendationLinesTable)
    .where(eq(aftercareRecommendationLinesTable.recommendationId, recommendation!.id));
  const immutable = JSON.stringify({
    settings: recommendation!.settingsSnapshot, treatments: recommendation!.treatmentSnapshot,
    catalog: lineBefore!.catalogSnapshot, pricing: lineBefore!.pricingSnapshot,
  });
  const order = await retailOrder(customer.id, ids.products[0]!, { createdAt: new Date(now.getTime() + 1000) });
  await reconcileAftercareConversions(new Date(now.getTime() + 2000));
  await db.update(retailOrdersTable).set({ status: "cancelled", paymentStatus: "refunded" })
    .where(eq(retailOrdersTable.id, order.id));
  await reconcileAftercareConversions(new Date(now.getTime() + 3000));
  const [after] = await db.select().from(aftercareRecommendationsTable).where(eq(aftercareRecommendationsTable.id, recommendation!.id));
  const [lineAfter] = await db.select().from(aftercareRecommendationLinesTable)
    .where(eq(aftercareRecommendationLinesTable.recommendationId, recommendation!.id));
  assert.equal(after!.status, "PENDING");
  assert.equal(after!.convertedAt, null);
  assert.equal(after!.convertedOrderId, null);
  assert.equal(lineAfter!.purchasedAt, null);
  assert.equal(lineAfter!.purchasedOrderId, null);
  assert.equal(JSON.stringify({
    settings: after!.settingsSnapshot, treatments: after!.treatmentSnapshot,
    catalog: lineAfter!.catalogSnapshot, pricing: lineAfter!.pricingSnapshot,
  }), immutable);
});

test("expired leases recover once and provider events remain monotonic", async () => {
  const customer = await user();
  const completed = await appointment(customer.id, null, ids.services[0]!);
  await enqueueAftercareCompletionDefault({ appointmentId: completed.id, transitionKey: `${marker}-lease`, completedAt: now });
  await processAftercareCompletionEvents({ now });
  const [recommendation] = await db.select().from(aftercareRecommendationsTable)
    .where(eq(aftercareRecommendationsTable.customerUserId, customer.id));
  const [delivery] = await db.select().from(aftercareDeliveriesTable)
    .where(eq(aftercareDeliveriesTable.recommendationId, recommendation!.id));
  await db.update(aftercareDeliveriesTable).set({
    status: "PROCESSING", claimToken: `${marker}-dead-worker`,
    claimExpiresAt: new Date(now.getTime() - 1), scheduledAt: new Date("2000-01-01T00:00:00Z"),
  }).where(eq(aftercareDeliveriesTable.id, delivery!.id));
  const accepted = new Set<string>();
  const transport = { send: async (message: { idempotencyKey: string }) => {
    accepted.add(message.idempotencyKey);
    return { messageId: `${marker}-provider-message` };
  } };
  assert.equal((await deliverAftercareEmails({ now, batchSize: 1, transport, publicOrigin: "https://app.example.test" })).sent, 1);
  assert.deepEqual([...accepted], [delivery!.id]);
  const newest = new Date(now.getTime() + 5000);
  assert.equal((await reconcileAftercareProviderEvent({
    providerMessageId: `${marker}-provider-message`, providerStatus: "delivered", eventAt: newest,
  })).reconciled, 1);
  await reconcileAftercareProviderEvent({
    providerMessageId: `${marker}-provider-message`, providerStatus: "deferred", eventAt: new Date(now.getTime() + 4000),
  });
  const [afterOld] = await db.select().from(aftercareDeliveriesTable).where(eq(aftercareDeliveriesTable.id, delivery!.id));
  assert.equal(afterOld!.providerStatus, "delivered");
  assert.equal(afterOld!.providerEventAt?.toISOString(), newest.toISOString());
  const latest = new Date(now.getTime() + 6000);
  await reconcileAftercareProviderEvent({
    providerMessageId: `${marker}-provider-message`, providerStatus: "opened", eventAt: latest,
  });
  const [afterNew] = await db.select().from(aftercareDeliveriesTable).where(eq(aftercareDeliveriesTable.id, delivery!.id));
  assert.equal(afterNew!.providerStatus, "opened");
  assert.equal(afterNew!.providerEventAt?.toISOString(), latest.toISOString());
});

test("a newer settled purchase supersedes queued replenishment and schedules from the new depletion date", async () => {
  const customer = await user();
  const completed = await appointment(customer.id, null, ids.services[0]!);
  await enqueueAftercareCompletionDefault({ appointmentId: completed.id, transitionKey: `${marker}-reschedule`, completedAt: now });
  await processAftercareCompletionEvents({ now });
  const [recommendation] = await db.select().from(aftercareRecommendationsTable)
    .where(eq(aftercareRecommendationsTable.customerUserId, customer.id));
  const firstPurchase = new Date(now.getTime() + 86_400_000);
  await retailOrder(customer.id, ids.products[0]!, { createdAt: firstPurchase });
  await reconcileAftercareConversions(new Date(firstPurchase.getTime() + 1));
  await scheduleAftercareFollowups(new Date(firstPurchase.getTime() + 7 * 86_400_000));
  const [lineBefore] = await db.select().from(aftercareRecommendationLinesTable)
    .where(eq(aftercareRecommendationLinesTable.recommendationId, recommendation!.id));
  const [oldDelivery] = await db.select().from(aftercareDeliveriesTable).where(and(
    eq(aftercareDeliveriesTable.lineId, lineBefore!.id), eq(aftercareDeliveriesTable.kind, "REPLENISHMENT"),
  ));
  assert.ok(oldDelivery);
  const secondPurchase = new Date(now.getTime() + 5 * 86_400_000);
  const newer = await retailOrder(customer.id, ids.products[0]!, { createdAt: secondPurchase });
  await reconcileAftercareConversions(new Date(secondPurchase.getTime() + 1));
  const [lineAfter] = await db.select().from(aftercareRecommendationLinesTable).where(eq(aftercareRecommendationLinesTable.id, lineBefore!.id));
  assert.equal(lineAfter!.purchasedOrderId, newer.id);
  assert.equal(lineAfter!.replenishmentDueAt?.toISOString(), new Date(secondPurchase.getTime() + 10 * 86_400_000).toISOString());
  const [superseded] = await db.select().from(aftercareDeliveriesTable).where(eq(aftercareDeliveriesTable.id, oldDelivery.id));
  assert.equal(superseded!.status, "SKIPPED");
  await scheduleAftercareFollowups(new Date(secondPurchase.getTime() + 7 * 86_400_000));
  const replenishments = await db.select().from(aftercareDeliveriesTable).where(and(
    eq(aftercareDeliveriesTable.lineId, lineBefore!.id), eq(aftercareDeliveriesTable.kind, "REPLENISHMENT"),
  ));
  assert.equal(replenishments.length, 1, "the line-kind uniqueness fence reuses its durable delivery");
  assert.equal(replenishments[0]!.status, "QUEUED");
  assert.ok(replenishments[0]!.eventKey.endsWith(lineAfter!.replenishmentDueAt!.toISOString().slice(0, 10)));
});

test("read, converted, and already-sent recommendations never schedule a SECOND reminder", async () => {
  const cases = [
    { suffix: "read", patch: { readAt: now } },
    { suffix: "converted", patch: { status: "CONVERTED" as const, convertedAt: now } },
    { suffix: "second-sent", patch: { secondSentAt: now } },
  ];
  for (const scenario of cases) {
    const customer = await user();
    const completed = await appointment(customer.id, null, ids.services[0]!);
    await enqueueAftercareCompletionDefault({
      appointmentId: completed.id, transitionKey: `${marker}-second-schedule-${scenario.suffix}`, completedAt: now,
    });
    await processAftercareCompletionEvents({ now });
    const [recommendation] = await db.select().from(aftercareRecommendationsTable)
      .where(eq(aftercareRecommendationsTable.customerUserId, customer.id));
    assert.ok(recommendation);
    await db.update(aftercareRecommendationsTable).set({
      firstSentAt: now,
      ...scenario.patch,
    }).where(eq(aftercareRecommendationsTable.id, recommendation.id));
    await scheduleAftercareFollowups(new Date(now.getTime() + 2 * 86_400_000));
    assert.equal((await db.select().from(aftercareDeliveriesTable).where(and(
      eq(aftercareDeliveriesTable.recommendationId, recommendation.id),
      eq(aftercareDeliveriesTable.kind, "SECOND"),
    ))).length, 0, `${scenario.suffix} guard must prevent a second-reminder delivery`);
  }
});

test("a read recommendation skips an already claimed SECOND before provider dispatch", async () => {
  const customer = await user();
  const completed = await appointment(customer.id, null, ids.services[0]!);
  await enqueueAftercareCompletionDefault({
    appointmentId: completed.id, transitionKey: `${marker}-second-read-race`, completedAt: now,
  });
  await processAftercareCompletionEvents({ now });
  const [recommendation] = await db.select().from(aftercareRecommendationsTable)
    .where(eq(aftercareRecommendationsTable.customerUserId, customer.id));
  assert.ok(recommendation);
  await db.update(aftercareRecommendationsTable).set({ firstSentAt: now })
    .where(eq(aftercareRecommendationsTable.id, recommendation.id));
  await scheduleAftercareFollowups(new Date(now.getTime() + 2 * 86_400_000));
  const [second] = await db.select().from(aftercareDeliveriesTable).where(and(
    eq(aftercareDeliveriesTable.recommendationId, recommendation.id),
    eq(aftercareDeliveriesTable.kind, "SECOND"),
  ));
  assert.ok(second);
  // Model a crashed claimant. The worker must reclaim it, then see the read
  // state before the fake provider can be called.
  await db.update(aftercareDeliveriesTable).set({
    status: "PROCESSING", claimToken: `${marker}-second-dead-claim`,
    claimExpiresAt: new Date(now.getTime() - 1), scheduledAt: new Date("1999-01-01T00:00:00Z"),
  }).where(eq(aftercareDeliveriesTable.id, second.id));
  await db.update(aftercareRecommendationsTable).set({ readAt: now })
    .where(eq(aftercareRecommendationsTable.id, recommendation.id));
  let sends = 0;
  const transport = { send: async () => {
    sends += 1;
    return { messageId: "must-not-send" };
  } };
  const result = await deliverAftercareEmails({
    now, batchSize: 1, transport, publicOrigin: "https://app.example.test",
  });
  assert.deepEqual(result, { sent: 0, skipped: 1 });
  assert.equal(sends, 0);
  const [skipped] = await db.select().from(aftercareDeliveriesTable).where(eq(aftercareDeliveriesTable.id, second.id));
  assert.equal(skipped!.status, "SKIPPED");
  assert.equal(skipped!.lastError, "second_reminder_no_longer_eligible");
  assert.equal(skipped!.claimToken, null);
  assert.equal(skipped!.claimExpiresAt, null);
});

test("conversion reconciliation attributes only retail items carrying exact recommendation evidence", async () => {
  const customer = await user();
  const otherCustomer = await user();
  const createRecommendation = async (userId: string, key: string) => {
    const completed = await appointment(userId, null, ids.services[0]!);
    await enqueueAftercareCompletionDefault({ appointmentId: completed.id, transitionKey: key, completedAt: now });
    await processAftercareCompletionEvents({ now });
    const [recommendation] = await db.select().from(aftercareRecommendationsTable)
      .where(eq(aftercareRecommendationsTable.customerUserId, userId))
      .orderBy(desc(aftercareRecommendationsTable.createdAt)).limit(1);
    assert.ok(recommendation);
    await db.update(aftercareRecommendationsTable).set({ status: "ACTIVE", firstSentAt: now })
      .where(eq(aftercareRecommendationsTable.id, recommendation.id));
    return recommendation;
  };
  const original = await createRecommendation(customer.id, `${marker}-exact-evidence`);
  const different = await createRecommendation(otherCustomer.id, `${marker}-different-evidence`);
  const [originalLine] = await db.select().from(aftercareRecommendationLinesTable)
    .where(eq(aftercareRecommendationLinesTable.recommendationId, original.id));
  const [differentLine] = await db.select().from(aftercareRecommendationLinesTable)
    .where(eq(aftercareRecommendationLinesTable.recommendationId, different.id));
  assert.ok(originalLine && differentLine);

  await retailOrder(customer.id, ids.products[0]!, {
    aftercareRecommendationId: null, createdAt: new Date(now.getTime() + 1000),
  });
  await reconcileAftercareConversions(new Date(now.getTime() + 2000));
  let [unchanged] = await db.select().from(aftercareRecommendationsTable)
    .where(eq(aftercareRecommendationsTable.id, original.id));
  let [unchangedLine] = await db.select().from(aftercareRecommendationLinesTable)
    .where(eq(aftercareRecommendationLinesTable.id, originalLine.id));
  assert.equal(unchanged!.status, "ACTIVE");
  assert.equal(unchanged!.convertedOrderId, null);
  assert.equal(unchanged!.convertedAt, null);
  assert.equal(unchangedLine!.purchasedOrderId, null);
  assert.equal(unchangedLine!.replenishmentDueAt, null);

  await retailOrder(customer.id, ids.products[0]!, {
    aftercareRecommendationId: different.id, createdAt: new Date(now.getTime() + 3000),
  });
  await reconcileAftercareConversions(new Date(now.getTime() + 4000));
  [unchanged] = await db.select().from(aftercareRecommendationsTable)
    .where(eq(aftercareRecommendationsTable.id, original.id));
  [unchangedLine] = await db.select().from(aftercareRecommendationLinesTable)
    .where(eq(aftercareRecommendationLinesTable.id, originalLine.id));
  assert.equal(unchanged!.status, "ACTIVE");
  assert.equal(unchanged!.convertedOrderId, null);
  assert.equal(unchanged!.convertedAt, null);
  assert.equal(unchangedLine!.purchasedOrderId, null);
  assert.equal(unchangedLine!.replenishmentDueAt, null);
  const [differentUntouched] = await db.select().from(aftercareRecommendationLinesTable)
    .where(eq(aftercareRecommendationLinesTable.id, differentLine.id));
  assert.equal(differentUntouched!.purchasedOrderId, null, "foreign evidence cannot update its referenced recommendation for another customer");

  const exactOrder = await retailOrder(customer.id, ids.products[0]!, {
    aftercareRecommendationId: original.id, createdAt: new Date(now.getTime() + 5000),
  });
  await reconcileAftercareConversions(new Date(now.getTime() + 6000));
  const [converted] = await db.select().from(aftercareRecommendationsTable)
    .where(eq(aftercareRecommendationsTable.id, original.id));
  const [attributedLine] = await db.select().from(aftercareRecommendationLinesTable)
    .where(eq(aftercareRecommendationLinesTable.id, originalLine.id));
  assert.equal(converted!.status, "CONVERTED");
  assert.equal(converted!.convertedOrderId, exactOrder.id);
  assert.equal(attributedLine!.purchasedOrderId, exactOrder.id);
  assert.ok(attributedLine!.replenishmentDueAt);
  const immutableEvidence = JSON.stringify({
    settings: converted!.settingsSnapshot, treatments: converted!.treatmentSnapshot,
    catalog: attributedLine!.catalogSnapshot, pricing: attributedLine!.pricingSnapshot,
  });

  await db.update(retailOrdersTable).set({ status: "cancelled", paymentStatus: "refunded" })
    .where(eq(retailOrdersTable.id, exactOrder.id));
  await reconcileAftercareConversions(new Date(now.getTime() + 7000));
  const [reversed] = await db.select().from(aftercareRecommendationsTable)
    .where(eq(aftercareRecommendationsTable.id, original.id));
  const [reversedLine] = await db.select().from(aftercareRecommendationLinesTable)
    .where(eq(aftercareRecommendationLinesTable.id, originalLine.id));
  const [persistedItem] = await db.select().from(retailOrderItemsTable)
    .where(eq(retailOrderItemsTable.orderId, exactOrder.id));
  assert.equal(reversed!.status, "ACTIVE");
  assert.equal(reversed!.convertedOrderId, null);
  assert.equal(reversed!.convertedAt, null);
  assert.equal(reversedLine!.purchasedOrderId, null);
  assert.equal(reversedLine!.replenishmentDueAt, null);
  assert.equal(persistedItem!.aftercareRecommendationId, original.id, "order-item evidence is immutable through reversal");
  assert.equal(JSON.stringify({
    settings: reversed!.settingsSnapshot, treatments: reversed!.treatmentSnapshot,
    catalog: reversedLine!.catalogSnapshot, pricing: reversedLine!.pricingSnapshot,
  }), immutableEvidence);
});