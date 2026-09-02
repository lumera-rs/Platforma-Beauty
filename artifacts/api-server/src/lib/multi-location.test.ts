import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  appointmentsTable,
  db,
  employeeLocationAssignmentsTable,
  employeeLocationSchedulesTable,
  employeesTable,
  employeeServicesTable,
  loyaltyPointLedgerTable,
  orderItemsTable,
  ordersTable,
  productCategoriesTable,
  productsTable,
  referralCodesTable,
  salonLoyaltyStatusesTable,
  salonNotificationsTable,
  salonsTable,
  servicesTable,
  shopSettingsTable,
  shoppingCartItemsTable,
  shoppingCartsTable,
  subscriptionPlansTable,
  subscriptionsTable,
  suppliersTable,
  usersTable,
  pool,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureDemoData } from "./seed";

type Json = Record<string, unknown>;

async function run(): Promise<void> {
  await ensureDemoData();
  const suffix = randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  const passwordHash = await hashPassword(`multi-location-${suffix}`);
  let server: ReturnType<typeof app.listen> | undefined;
  let ownerId: string | undefined;
  let otherOwnerId: string | undefined;
  let salonIds: string[] = [];
  let serviceIds: string[] = [];
  let planIds: string[] = [];
  let employeeId: string | undefined;
  let employeeUserId: string | undefined;
  let supplierId: string | undefined;
  let categoryId: string | undefined;
  let productId: string | undefined;
  let orderId: string | undefined;
  let shopSettingsBefore: typeof shopSettingsTable.$inferSelect | undefined;

  try {
    [shopSettingsBefore] = await db.select().from(shopSettingsTable).limit(1);
    assert.ok(shopSettingsBefore, "demo data must provide shop settings");
    await db.update(shopSettingsTable).set({
      sellerCompanyName: `Multi seller ${suffix}`,
      sellerTaxId: "101234567",
      sellerRegistrationNumber: "20123456",
      sellerAddress: "Prodavac 1",
      sellerCity: "Beograd",
      sellerPostalCode: "11000",
      sellerBankAccount: "100-123456789-10",
      sellerContactEmail: `multi-seller-${suffix}@example.test`,
      sellerContactPhone: "+381601234567",
      version: shopSettingsBefore.version + 1,
      updatedAt: new Date(),
    }).where(eq(shopSettingsTable.id, shopSettingsBefore.id));

    const [owner, otherOwner, employeeUser] = await db.insert(usersTable).values([
      {
        firstName: "Multi",
        lastName: "Owner",
        email: `multi-owner-${suffix}@example.test`,
        passwordHash,
        passwordSetAt: new Date(),
        role: "SALON_OWNER",
      },
      {
        firstName: "Foreign",
        lastName: "Owner",
        email: `multi-foreign-${suffix}@example.test`,
        passwordHash,
        passwordSetAt: new Date(),
        role: "SALON_OWNER",
      },
      {
        firstName: "Multi",
        lastName: "Employee",
        email: `multi-employee-${suffix}@example.test`,
        passwordHash,
        passwordSetAt: new Date(),
        role: "SALON_EMPLOYEE",
      },
    ]).returning();
    assert.ok(owner && otherOwner && employeeUser);
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;
    employeeUserId = employeeUser.id;

    const [first, second, foreign] = await db.insert(salonsTable).values([
      {
        ownerId: owner.id,
        name: `Prva lokacija ${suffix}`,
        slug: `multi-first-${suffix}`,
        city: "Beograd",
        municipality: "Vračar",
        address: "Test 1",
        postalCode: "11000",
        phone: "+381110000101",
        email: `multi-first-${suffix}@example.test`,
        companyName: `Multi firma ${suffix}`,
        companyTaxId: "100000001",
        companyRegistrationNumber: "20000001",
        companyAddress: "Poslovna 1",
        companyCity: "Beograd",
        companyPostalCode: "11000",
        shortDescription: "Prva test lokacija.",
        description: "Prva lokacija za proveru poslovanja na više lokacija.",
        imageUrl: "/test.jpg",
      },
      {
        ownerId: owner.id,
        name: `Druga lokacija ${suffix}`,
        slug: `multi-second-${suffix}`,
        city: "Novi Sad",
        municipality: "Centar",
        address: "Test 2",
        postalCode: "21000",
        phone: "+381110000102",
        email: `multi-second-${suffix}@example.test`,
        companyName: `Multi firma ogranak ${suffix}`,
        companyTaxId: "100000002",
        companyRegistrationNumber: "20000002",
        companyAddress: "Poslovna 2",
        companyCity: "Novi Sad",
        companyPostalCode: "21000",
        shortDescription: "Druga test lokacija.",
        description: "Druga lokacija za proveru poslovanja na više lokacija.",
        imageUrl: "/test.jpg",
      },
      {
        ownerId: otherOwner.id,
        name: `Tuđa lokacija ${suffix}`,
        slug: `multi-foreign-${suffix}`,
        city: "Niš",
        municipality: "Medijana",
        address: "Test 3",
        postalCode: "18000",
        phone: "+381110000103",
        email: `multi-foreign-${suffix}@example.test`,
        shortDescription: "Tuđa test lokacija.",
        description: "Lokacija koja nikada ne sme postati aktivna drugom vlasniku.",
        imageUrl: "/test.jpg",
      },
    ]).returning();
    assert.ok(first && second && foreign);
    salonIds = [first.id, second.id, foreign.id];
    await db.update(usersTable).set({ activeSalonId: first.id }).where(eq(usersTable.id, owner.id));

    const [firstService, secondService] = await db.insert(servicesTable).values([
      {
        salonId: first.id,
        categoryName: "Test",
        name: `Usluga prve lokacije ${suffix}`,
        description: "Usluga koja pripada isključivo prvoj lokaciji.",
        durationMinutes: 45,
        price: 1200,
        imageUrl: "/test.jpg",
      },
      {
        salonId: second.id,
        categoryName: "Test",
        name: `Usluga druge lokacije ${suffix}`,
        description: "Usluga koja pripada isključivo drugoj lokaciji.",
        durationMinutes: 45,
        price: 2400,
        imageUrl: "/test.jpg",
      },
    ]).returning();
    assert.ok(firstService && secondService);
    serviceIds = [firstService.id, secondService.id];
    const [employee] = await db.insert(employeesTable).values({
      salonId: first.id,
      userId: employeeUser.id,
      name: `Zaposleni ${suffix}`,
      role: "Stilista",
      bio: "",
      avatarUrl: "",
      canOrderIndependently: true,
    }).returning();
    assert.ok(employee);
    employeeId = employee.id;
    await db.insert(employeeLocationAssignmentsTable).values([
      { employeeId: employee.id, salonId: first.id, active: true, isDefault: true },
      { employeeId: employee.id, salonId: second.id, active: true, isDefault: false },
    ]);
    await db.insert(employeeServicesTable).values([
      { employeeId: employee.id, serviceId: firstService.id },
      { employeeId: employee.id, serviceId: secondService.id },
    ]);
    await db.insert(appointmentsTable).values([
      {
        salonId: first.id,
        serviceId: firstService.id,
        date: today,
        startTime: "10:00",
        endTime: "10:45",
        durationMinutes: 45,
        price: 1200,
        status: "completed",
      },
      {
        salonId: second.id,
        serviceId: secondService.id,
        date: today,
        startTime: "11:00",
        endTime: "11:45",
        durationMinutes: 45,
        price: 2400,
        status: "completed",
      },
    ]);

    await db.insert(salonLoyaltyStatusesTable).values([
      { salonId: first.id, currentPeriodSpend: 12000 },
      { salonId: second.id, currentPeriodSpend: 18000 },
    ]);
    const [activePlan, trialPlan] = await db.insert(subscriptionPlansTable).values([
      { name: `Multi active ${suffix}`, price: 4000, features: [], limits: {} },
      { name: `Multi trial ${suffix}`, price: 7000, features: [], limits: {} },
    ]).returning();
    assert.ok(activePlan && trialPlan);
    planIds = [activePlan.id, trialPlan.id];
    await db.insert(subscriptionsTable).values([
      { salonId: first.id, planId: activePlan.id, status: "active", dueAmount: activePlan.price },
      { salonId: second.id, planId: trialPlan.id, status: "active", dueAmount: 6500 },
    ]);

    const [supplier] = await db.insert(suppliersTable).values({
      name: `Multi supplier ${suffix}`,
      slug: `multi-supplier-${suffix}`,
      scope: "B2B",
    }).returning();
    assert.ok(supplier);
    supplierId = supplier.id;
    const [category] = await db.insert(productCategoriesTable).values({
      supplierId: supplier.id,
      name: `Multi category ${suffix}`,
      slug: `multi-category-${suffix}`,
    }).returning();
    assert.ok(category);
    categoryId = category.id;
    const [product] = await db.insert(productsTable).values({
      supplierId: supplier.id,
      categoryId: category.id,
      categoryName: category.name,
      name: `Multi product ${suffix}`,
      description: "Proizvod za proveru isporuke na drugu lokaciju.",
      imageUrl: "/test.jpg",
      price: 1500,
      professionalEnabled: true,
      retailEnabled: false,
      stock: 10,
      sku: `MULTI-${suffix}`,
      unit: "kom",
      weightGrams: 100,
    }).returning();
    assert.ok(product);
    productId = product.id;

    const session = await createSession(owner.id);
    const cookie = `${sessionCookieName}=${session}`;
    const employeeCookie = `${sessionCookieName}=${await createSession(employeeUser.id)}`;
    const otherOwnerCookie = `${sessionCookieName}=${await createSession(otherOwner.id)}`;
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const get = async (path: string) => {
      const response = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
      return { response, body: await response.json() as Json };
    };
    const put = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const locationDashboard = await get("/salon/dashboard");
    assert.equal(locationDashboard.response.status, 200);
    assert.equal(locationDashboard.body.scope, "location");
    assert.equal(locationDashboard.body.loyaltyScope, "owner", "loyalty must be explicitly account-wide");
    assert.equal(locationDashboard.body.revenueThisMonth, 1200, "active location must keep its own revenue");
    assert.equal(locationDashboard.body.bookingsThisMonth, 1, "active location must keep its own booking count");
    assert.equal((locationDashboard.body.locations as Json[]).length, 1, "location dashboard must not merge locations");

    const allDashboard = await get("/salon/dashboard?scope=all");
    assert.equal(allDashboard.response.status, 200);
    assert.equal(allDashboard.body.scope, "all");
    assert.equal(allDashboard.body.revenueThisMonth, 3600, "all-locations dashboard must sum completed revenue");
    assert.equal(allDashboard.body.bookingsThisMonth, 2, "all-locations dashboard must sum bookings");
    assert.equal((allDashboard.body.locations as Json[]).length, 2, "all-locations dashboard must list each owned location");

    const checkoutProfile = await get("/shop/checkout-profile");
    assert.equal(checkoutProfile.response.status, 200);
    assert.equal(checkoutProfile.body.activeSalonId, first.id);
    assert.equal(checkoutProfile.body.profileKey, `${owner.id}:${first.id}`, "checkout drafts must be isolated by account and active location");
    const deliverySalons = checkoutProfile.body.deliverySalons as Array<{
      id: string;
      address: { street: string; postalCode: string };
      addressComplete: boolean;
      billingComplete: boolean;
    }>;
    assert.deepEqual(
      deliverySalons.map((location) => location.id).sort(),
      [first.id, second.id].sort(),
      "checkout must expose only the owner's locations",
    );
    const deliverySalonsById = new Map(deliverySalons.map((location) => [location.id, location]));
    assert.deepEqual(
      [deliverySalonsById.get(first.id)?.address.street, deliverySalonsById.get(first.id)?.address.postalCode],
      ["Test 1", "11000"],
      "the first location must keep its own delivery address",
    );
    assert.deepEqual(
      [deliverySalonsById.get(second.id)?.address.street, deliverySalonsById.get(second.id)?.address.postalCode],
      ["Test 2", "21000"],
      "the second location must keep its own delivery address",
    );
    assert.ok(deliverySalons.every((location) => location.addressComplete && location.billingComplete));

    const addToCart = await fetch(`${baseUrl}/shop/cart/items`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ productId: product.id, quantity: 1 }),
    });
    assert.equal(addToCart.status, 200, await addToCart.text());

    const employeeCheckout = await fetch(`${baseUrl}/shop/checkout`, {
      method: "POST",
      headers: { cookie: employeeCookie, "content-type": "application/json" },
      body: JSON.stringify({
        useSalonAddress: true,
        deliverySalonId: second.id,
        deliveryMethod: "courier",
        paymentMethod: "BANK_TRANSFER",
        termsAccepted: true,
      }),
    });
    assert.equal(employeeCheckout.status, 403, "employees must not redirect an active salon's cart to a sibling location");

    const foreignOwnerCheckout = await fetch(`${baseUrl}/shop/checkout`, {
      method: "POST",
      headers: { cookie: otherOwnerCookie, "content-type": "application/json" },
      body: JSON.stringify({
        useSalonAddress: true,
        deliverySalonId: second.id,
        deliveryMethod: "courier",
        paymentMethod: "BANK_TRANSFER",
        termsAccepted: true,
      }),
    });
    assert.equal(foreignOwnerCheckout.status, 403, "another owner must not use the selected sibling delivery location");

    const foreignCheckout = await fetch(`${baseUrl}/shop/checkout`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        useSalonAddress: true,
        deliverySalonId: foreign.id,
        deliveryMethod: "courier",
        paymentMethod: "BANK_TRANSFER",
        termsAccepted: true,
      }),
    });
    assert.equal(foreignCheckout.status, 403, "checkout must reject another owner's location before accessing the active cart");

    const completedCheckout = await fetch(`${baseUrl}/shop/checkout`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        useSalonAddress: true,
        deliverySalonId: second.id,
        deliveryMethod: "courier",
        paymentMethod: "BANK_TRANSFER",
        termsAccepted: true,
      }),
    });
    const completedOrder = await completedCheckout.json() as Json;
    assert.equal(completedCheckout.status, 201, JSON.stringify(completedOrder));
    orderId = String(completedOrder.id);
    const [storedOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
    assert.ok(storedOrder);
    assert.equal(storedOrder.salonId, first.id, "the completed order must remain owned by the active salon");
    assert.deepEqual(
      {
        name: storedOrder.shippingName,
        address: storedOrder.shippingAddress,
        city: storedOrder.shippingCity,
        postalCode: storedOrder.shippingPostalCode,
        phone: storedOrder.shippingPhone,
        email: storedOrder.shippingEmail,
      },
      {
        name: second.name,
        address: second.address,
        city: second.city,
        postalCode: second.postalCode,
        phone: second.phone,
        email: second.email,
      },
      "the immutable delivery snapshot must contain only the selected sibling location",
    );

    const loyalty = await get("/loyalty/status");
    assert.equal(loyalty.response.status, 200);
    assert.equal(loyalty.body.monthlySpend, 30000, "loyalty spend must aggregate legacy location rows");
    const discount = Number(loyalty.body.subscriptionDiscountPercent ?? 0);
    assert.equal(
      loyalty.body.subscriptionDue,
      loyalty.body.freeSubscription ? 0 : Math.round(6500 * (1 - discount / 100)),
      "legacy active subscriptions must use the highest recorded due amount as one owner-wide contract",
    );

    const switched = await fetch(`${baseUrl}/salon/active-salon`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ salonId: second.id }),
    });
    assert.equal(switched.status, 200, "owner must switch to another owned location");
    const secondDashboard = await get("/salon/dashboard");
    assert.equal(secondDashboard.body.revenueThisMonth, 2400, "switch must refresh the active location context");

    const removedSecondLocationServices = await fetch(`${baseUrl}/salon/employees/${employee.id}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ serviceIds: [] }),
    });
    assert.equal(removedSecondLocationServices.status, 200);
    const remainingEmployeeServices = await db.select().from(employeeServicesTable)
      .where(eq(employeeServicesTable.employeeId, employee.id));
    assert.deepEqual(
      remainingEmployeeServices.map((link) => link.serviceId),
      [firstService.id],
      "saving B must preserve A mappings while honoring an explicit removal at B",
    );

    const [firstSchedule, secondSchedule] = await Promise.all([
      put(`/salon/employees/${employee.id}/locations/${first.id}/schedule`, {
        windows: [{ weekday: 1, startTime: "09:00", endTime: "13:00" }],
      }),
      put(`/salon/employees/${employee.id}/locations/${second.id}/schedule`, {
        windows: [{ weekday: 1, startTime: "11:00", endTime: "15:00" }],
      }),
    ]);
    assert.deepEqual(
      [firstSchedule.status, secondSchedule.status].sort(),
      [200, 409],
      "overlapping concurrent location writes must yield exactly one success and one conflict",
    );
    const finalSchedules = await db.select().from(employeeLocationSchedulesTable)
      .where(eq(employeeLocationSchedulesTable.employeeId, employee.id));
    assert.equal(finalSchedules.length, 1, "the rejected concurrent write must leave no overlapping final state");
    assert.ok(
      (finalSchedules[0]!.salonId === first.id
        && finalSchedules[0]!.startTime === "09:00"
        && finalSchedules[0]!.endTime === "13:00")
      || (finalSchedules[0]!.salonId === second.id
        && finalSchedules[0]!.startTime === "11:00"
        && finalSchedules[0]!.endTime === "15:00"),
      "the final schedule must be exactly the successful location's window",
    );

    const forbiddenSwitch = await fetch(`${baseUrl}/salon/active-salon`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ salonId: foreign.id }),
    });
    assert.equal(forbiddenSwitch.status, 404, "owner must never select another owner's location");
    const afterForbidden = await get("/salon/dashboard");
    assert.equal(afterForbidden.body.revenueThisMonth, 2400, "forbidden selection must leave the authorized location unchanged");

    await db.update(usersTable).set({ activeSalonId: foreign.id }).where(eq(usersTable.id, owner.id));
    const recoveredDashboard = await get("/salon/dashboard");
    const recoveredSalonId = (recoveredDashboard.body.salon as Json).id;
    assert.ok([first.id, second.id].includes(String(recoveredSalonId)), "an invalid saved selection must recover to an owned location");
    const [recoveredOwner] = await db.select({ activeSalonId: usersTable.activeSalonId }).from(usersTable).where(eq(usersTable.id, owner.id));
    assert.equal(recoveredOwner?.activeSalonId, recoveredSalonId, "recovered active location must be persisted for subsequent requests");

    const publicFirst = await fetch(`${baseUrl}/salons/${first.slug}`);
    const publicSecond = await fetch(`${baseUrl}/salons/${second.slug}`);
    assert.equal(publicFirst.status, 200);
    assert.equal(publicSecond.status, 200);
    const firstServices = (await publicFirst.json() as Json).services as Array<{ id: string }>;
    const secondServices = (await publicSecond.json() as Json).services as Array<{ id: string }>;
    assert.deepEqual(firstServices.map((service) => service.id), [firstService.id], "public profile must stay per-location");
    assert.deepEqual(secondServices.map((service) => service.id), [secondService.id], "public profile must not leak sibling services");
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    if (shopSettingsBefore) {
      await db.update(shopSettingsTable).set({
        showLoyaltyPoints: shopSettingsBefore.showLoyaltyPoints,
        pointsPer100Rsd: shopSettingsBefore.pointsPer100Rsd,
        lowStockThreshold: shopSettingsBefore.lowStockThreshold,
        defaultDeliveryBusinessDays: shopSettingsBefore.defaultDeliveryBusinessDays,
        sellerCompanyName: shopSettingsBefore.sellerCompanyName,
        sellerTaxId: shopSettingsBefore.sellerTaxId,
        sellerRegistrationNumber: shopSettingsBefore.sellerRegistrationNumber,
        sellerAddress: shopSettingsBefore.sellerAddress,
        sellerCity: shopSettingsBefore.sellerCity,
        sellerPostalCode: shopSettingsBefore.sellerPostalCode,
        sellerBankAccount: shopSettingsBefore.sellerBankAccount,
        sellerContactEmail: shopSettingsBefore.sellerContactEmail,
        sellerContactPhone: shopSettingsBefore.sellerContactPhone,
        retailCartReminderEnabled: shopSettingsBefore.retailCartReminderEnabled,
        retailCartReminderDelayHours: shopSettingsBefore.retailCartReminderDelayHours,
        retailCartReminderBrevoTemplateId: shopSettingsBefore.retailCartReminderBrevoTemplateId,
        quoteValidityDays: shopSettingsBefore.quoteValidityDays,
        reviewRewardsEnabled: shopSettingsBefore.reviewRewardsEnabled,
        reviewInvitationDelayDays: shopSettingsBefore.reviewInvitationDelayDays,
        reviewRewardPercent: shopSettingsBefore.reviewRewardPercent,
        reviewRewardValidityDays: shopSettingsBefore.reviewRewardValidityDays,
        version: shopSettingsBefore.version,
        updatedAt: shopSettingsBefore.updatedAt,
      }).where(eq(shopSettingsTable.id, shopSettingsBefore.id));
    }
    if (salonIds.length) {
      await db.update(usersTable).set({ activeSalonId: null }).where(inArray(usersTable.id, [ownerId, otherOwnerId, employeeUserId].filter((id): id is string => Boolean(id))));
      if (orderId) {
        await db.delete(loyaltyPointLedgerTable).where(eq(loyaltyPointLedgerTable.orderId, orderId));
        await db.delete(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
        await db.delete(ordersTable).where(eq(ordersTable.id, orderId));
      }
      await db.delete(salonNotificationsTable).where(inArray(salonNotificationsTable.salonId, salonIds));
      const carts = await db.select({ id: shoppingCartsTable.id }).from(shoppingCartsTable)
        .where(inArray(shoppingCartsTable.salonId, salonIds));
      if (carts.length) {
        await db.delete(shoppingCartItemsTable).where(inArray(shoppingCartItemsTable.cartId, carts.map((cart) => cart.id)));
        await db.delete(shoppingCartsTable).where(inArray(shoppingCartsTable.id, carts.map((cart) => cart.id)));
      }
      if (employeeId) await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
      await db.delete(subscriptionsTable).where(inArray(subscriptionsTable.salonId, salonIds));
      await db.delete(salonLoyaltyStatusesTable).where(inArray(salonLoyaltyStatusesTable.salonId, salonIds));
      await db.delete(appointmentsTable).where(inArray(appointmentsTable.salonId, salonIds));
      if (serviceIds.length) await db.delete(servicesTable).where(inArray(servicesTable.id, serviceIds));
      await db.delete(salonsTable).where(inArray(salonsTable.id, salonIds));
    }
    if (planIds.length) await db.delete(subscriptionPlansTable).where(inArray(subscriptionPlansTable.id, planIds));
    if (productId) await db.delete(productsTable).where(eq(productsTable.id, productId));
    if (categoryId) await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, categoryId));
    if (supplierId) await db.delete(suppliersTable).where(eq(suppliersTable.id, supplierId));
    const userIds = [ownerId, otherOwnerId, employeeUserId].filter((id): id is string => Boolean(id));
    // Referral codes intentionally restrict deletion of their referrer. Remove
    // fixture-owned codes before users so an unrelated referral-path assertion
    // cannot leave this multi-location fixture behind.
    if (userIds.length) await db.delete(referralCodesTable).where(inArray(referralCodesTable.referrerUserId, userIds));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    await pool.end();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});