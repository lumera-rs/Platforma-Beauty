/**
 * Regression coverage for GET /admin/summary.
 *
 * The endpoint aggregates global marketplace tables, so this fixture calculates
 * the expected response independently from the rows that exist after seeding.
 * Its category counts are intentionally larger than the pre-existing maximum:
 * that makes the six-fixture-category set deterministic while still proving
 * that the endpoint applies its top-five limit.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import {
  appointmentsTable,
  db,
  ordersTable,
  pool,
  reviewsTable,
  salonsTable,
  servicesTable,
  subscriptionPlansTable,
  subscriptionsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";

type Summary = {
  totalUsers: number;
  totalSalons: number;
  activeSalons: number;
  bookingsThisMonth: number;
  bookingsLastMonth: number;
  bookingsTrend: number;
  grossMerchandiseValue: number;
  newSalonsThisMonth: number;
  totalReviews: number;
  hiddenReviews: number;
  activeSubscriptions: number;
  schedulerJobs: Array<{
    job: string;
    state: "idle" | "running" | "retrying" | "failed";
    deferredCycles: number;
  }>;
  topCategories: Array<{ name: string; count: number }>;
};

function monthStart(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

async function run(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const now = new Date();
  const thisMonthStart = monthStart(now, 0);
  const lastMonthStart = monthStart(now, -1);
  const currentMonthCreatedAt = new Date(thisMonthStart.getTime() + 60_000);
  const previousMonthCreatedAt = new Date(thisMonthStart.getTime() - 60_000);
  const olderCreatedAt = new Date(lastMonthStart.getTime() - 60_000);
  const appointmentDate = now.toISOString().slice(0, 10);

  const existingAppointments = await db.select({
    serviceId: appointmentsTable.serviceId,
  }).from(appointmentsTable);
  const existingServices = await db.select({
    id: servicesTable.id,
    categoryName: servicesTable.categoryName,
  }).from(servicesTable);
  const serviceById = new Map(existingServices.map((service) => [service.id, service]));
  const existingCategoryCounts = new Map<string, number>();
  for (const appointment of existingAppointments) {
    const categoryName = serviceById.get(appointment.serviceId)?.categoryName;
    if (categoryName) existingCategoryCounts.set(categoryName, (existingCategoryCounts.get(categoryName) ?? 0) + 1);
  }
  const existingMaximumCategoryCount = Math.max(0, ...existingCategoryCounts.values());

  const fixture = {
    userIds: [] as string[],
    salonIds: [] as string[],
    serviceIds: [] as string[],
    appointmentIds: [] as string[],
    orderIds: [] as string[],
    reviewIds: [] as string[],
    subscriptionIds: [] as string[],
    planId: null as string | null,
  };

  const [admin] = await db.insert(usersTable).values({
    firstName: "Summary",
    lastName: "Admin",
    email: `admin-summary-admin-${suffix}@example.test`,
    passwordHash: await hashPassword(`admin-summary-${suffix}`),
    passwordSetAt: new Date(),
    role: "SUPER_ADMIN",
  }).returning();
  assert.ok(admin);
  fixture.userIds.push(admin.id);

  const [customerOne, customerTwo] = await db.insert(usersTable).values([
    {
      firstName: "Summary",
      lastName: "Customer One",
      email: `admin-summary-customer-one-${suffix}@example.test`,
      passwordHash: "test-only-password-hash",
      passwordSetAt: new Date(),
      role: "CUSTOMER",
    },
    {
      firstName: "Summary",
      lastName: "Customer Two",
      email: `admin-summary-customer-two-${suffix}@example.test`,
      passwordHash: "test-only-password-hash",
      passwordSetAt: new Date(),
      role: "CUSTOMER",
    },
  ]).returning();
  assert.ok(customerOne);
  assert.ok(customerTwo);
  fixture.userIds.push(customerOne.id, customerTwo.id);

  const [currentSalon, previousSalon] = await db.insert(salonsTable).values([
    {
      ownerId: admin.id,
      name: `Admin Summary Current ${suffix}`,
      slug: `admin-summary-current-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Summary 1",
      phone: "+381600000001",
      email: `admin-summary-current-${suffix}@example.test`,
      shortDescription: "Admin summary fixture",
      description: "Admin summary fixture",
      imageUrl: "",
      active: true,
      createdAt: currentMonthCreatedAt,
    },
    {
      ownerId: admin.id,
      name: `Admin Summary Previous ${suffix}`,
      slug: `admin-summary-previous-${suffix}`,
      city: "Novi Sad",
      municipality: "Stari grad",
      address: "Summary 2",
      phone: "+381600000002",
      email: `admin-summary-previous-${suffix}@example.test`,
      shortDescription: "Admin summary fixture",
      description: "Admin summary fixture",
      imageUrl: "",
      active: false,
      createdAt: previousMonthCreatedAt,
    },
  ]).returning();
  assert.ok(currentSalon);
  assert.ok(previousSalon);
  fixture.salonIds.push(currentSalon.id, previousSalon.id);

  const categoryCounts = [6, 5, 4, 3, 2, 1].map((count, index) => ({
    name: `Summary Category ${suffix} ${index + 1}`,
    count: existingMaximumCategoryCount + count,
  }));
  const insertedServices = await db.insert(servicesTable).values(categoryCounts.map((category, index) => ({
    salonId: currentSalon.id,
    categoryName: category.name,
    name: `Summary Service ${suffix} ${index + 1}`,
    description: "Admin summary fixture",
    durationMinutes: 60,
    price: 1000 + index,
    imageUrl: "",
  }))).returning();
  assert.equal(insertedServices.length, categoryCounts.length);
  fixture.serviceIds.push(...insertedServices.map((service) => service.id));

  let appointmentIndex = 0;
  for (const [categoryIndex, category] of categoryCounts.entries()) {
    const service = insertedServices[categoryIndex];
    assert.ok(service);
    const appointments = await db.insert(appointmentsTable).values(
      Array.from({ length: category.count }, (_, index) => {
        const createdAt = appointmentIndex++ % 3 === 0
          ? currentMonthCreatedAt
          : appointmentIndex % 3 === 0 ? previousMonthCreatedAt : olderCreatedAt;
        return {
          salonId: currentSalon.id,
          customerId: index % 2 === 0 ? customerOne.id : customerTwo.id,
          serviceId: service.id,
          date: appointmentDate,
          startTime: `${String(8 + (index % 8)).padStart(2, "0")}:00`,
          endTime: `${String(9 + (index % 8)).padStart(2, "0")}:00`,
          durationMinutes: 60,
          price: 1000 + categoryIndex,
          status: "completed" as const,
          createdAt,
        };
      }),
    ).returning();
    fixture.appointmentIds.push(...appointments.map((appointment) => appointment.id));
  }

  const [visibleReview, hiddenReview] = await db.insert(reviewsTable).values([
    {
      salonId: currentSalon.id,
      customerId: customerOne.id,
      serviceName: "Summary Service",
      rating: 5,
      text: "Visible summary review",
      visible: true,
    },
    {
      salonId: currentSalon.id,
      customerId: customerTwo.id,
      serviceName: "Summary Service",
      rating: 1,
      text: "Hidden summary review",
      visible: false,
    },
  ]).returning();
  assert.ok(visibleReview);
  assert.ok(hiddenReview);
  fixture.reviewIds.push(visibleReview.id, hiddenReview.id);

  const insertedOrders = await db.insert(ordersTable).values([
    {
      salonId: currentSalon.id,
      total: 1234,
      shippingName: "Summary Customer One",
      shippingAddress: "Summary Order 1",
      paymentMethod: "CASH_ON_DELIVERY",
    },
    {
      salonId: previousSalon.id,
      total: 2345,
      shippingName: "Summary Customer Two",
      shippingAddress: "Summary Order 2",
      paymentMethod: "BANK_TRANSFER",
    },
  ]).returning();
  fixture.orderIds.push(...insertedOrders.map((order) => order.id));

  const [plan] = await db.insert(subscriptionPlansTable).values({
    name: `Admin Summary Plan ${suffix}`,
    price: 1999,
  }).returning();
  assert.ok(plan);
  fixture.planId = plan.id;

  const insertedSubscriptions = await db.insert(subscriptionsTable).values([
    {
      salonId: currentSalon.id,
      planId: plan.id,
      status: "active",
      dueAmount: 1999,
    },
    {
      salonId: currentSalon.id,
      planId: plan.id,
      status: "free_via_loyalty",
      dueAmount: 0,
    },
    {
      salonId: previousSalon.id,
      planId: plan.id,
      status: "trial",
      dueAmount: 1999,
    },
  ]).returning();
  fixture.subscriptionIds.push(...insertedSubscriptions.map((subscription) => subscription.id));

  const cookie = `${sessionCookieName}=${await createSession(admin.id)}`;
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    const users = await db.select({ id: usersTable.id }).from(usersTable);
    const salons = await db.select({
      id: salonsTable.id,
      active: salonsTable.active,
      createdAt: salonsTable.createdAt,
    }).from(salonsTable);
    const appointments = await db.select({
      createdAt: appointmentsTable.createdAt,
      serviceId: appointmentsTable.serviceId,
    }).from(appointmentsTable);
    const orders = await db.select({ total: ordersTable.total }).from(ordersTable);
    const reviews = await db.select({ visible: reviewsTable.visible }).from(reviewsTable);
    const subscriptions = await db.select({ status: subscriptionsTable.status }).from(subscriptionsTable);
    const services = await db.select({
      id: servicesTable.id,
      categoryName: servicesTable.categoryName,
    }).from(servicesTable);
    const servicesById = new Map(services.map((service) => [service.id, service.categoryName]));
    const categoryTotals = new Map<string, number>();
    for (const appointment of appointments) {
      const categoryName = servicesById.get(appointment.serviceId);
      if (categoryName) categoryTotals.set(categoryName, (categoryTotals.get(categoryName) ?? 0) + 1);
    }
    const expectedTopCategories = [...categoryTotals.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
    const expectedThisMonth = appointments.filter((appointment) => appointment.createdAt >= thisMonthStart).length;
    const expectedLastMonth = appointments.filter((appointment) => (
      appointment.createdAt >= lastMonthStart && appointment.createdAt < thisMonthStart
    )).length;
    const expectedNewSalonsThisMonth = salons.filter((salon) => salon.createdAt >= thisMonthStart).length;

    const response = await fetch(`${baseUrl}/admin/summary`, { headers: { cookie } });
    const responseText = await response.text();
    assert.equal(response.status, 200, `GET /admin/summary: ${responseText.slice(0, 500)}`);
    const summary = JSON.parse(responseText) as Summary;

    assert.deepEqual({
      totalUsers: summary.totalUsers,
      totalSalons: summary.totalSalons,
      activeSalons: summary.activeSalons,
      bookingsThisMonth: summary.bookingsThisMonth,
      bookingsLastMonth: summary.bookingsLastMonth,
      bookingsTrend: summary.bookingsTrend,
      grossMerchandiseValue: summary.grossMerchandiseValue,
      newSalonsThisMonth: summary.newSalonsThisMonth,
      totalReviews: summary.totalReviews,
      hiddenReviews: summary.hiddenReviews,
      activeSubscriptions: summary.activeSubscriptions,
      topCategories: summary.topCategories,
    }, {
      totalUsers: users.length,
      totalSalons: salons.length,
      activeSalons: salons.filter((salon) => salon.active).length,
      bookingsThisMonth: expectedThisMonth,
      bookingsLastMonth: expectedLastMonth,
      bookingsTrend: expectedLastMonth > 0
        ? Math.round(((expectedThisMonth - expectedLastMonth) / expectedLastMonth) * 100)
        : 0,
      grossMerchandiseValue: orders.reduce((total, order) => total + order.total, 0),
      newSalonsThisMonth: expectedNewSalonsThisMonth,
      totalReviews: reviews.length,
      hiddenReviews: reviews.filter((review) => !review.visible).length,
      activeSubscriptions: subscriptions.filter((subscription) => (
        subscription.status === "active" || subscription.status === "free_via_loyalty"
      )).length,
      topCategories: expectedTopCategories,
    }, "GET /admin/summary must match independently calculated database totals");

    assert.equal(summary.topCategories.length, 5, "admin summary must return at most five categories");
    assert.ok(Array.isArray(summary.schedulerJobs), "admin summary must expose scheduler health");
    assert.ok(
      summary.schedulerJobs.every((job) => (
        typeof job.job === "string"
        && ["idle", "running", "retrying", "failed"].includes(job.state)
        && Number.isInteger(job.deferredCycles)
      )),
      "scheduler health must remain structured for the admin dashboard",
    );
    assert.ok(
      !summary.topCategories.some((category) => category.name === categoryCounts[5]?.name),
      "the sixth-ranked category must be excluded by the top-five limit",
    );
    process.stdout.write("✓ admin summary regression suite passed\n");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    if (fixture.reviewIds.length) {
      await db.delete(reviewsTable).where(inArray(reviewsTable.id, fixture.reviewIds));
    }
    if (fixture.appointmentIds.length) {
      await db.delete(appointmentsTable).where(inArray(appointmentsTable.id, fixture.appointmentIds));
    }
    if (fixture.orderIds.length) {
      await db.delete(ordersTable).where(inArray(ordersTable.id, fixture.orderIds));
    }
    if (fixture.subscriptionIds.length) {
      await db.delete(subscriptionsTable).where(inArray(subscriptionsTable.id, fixture.subscriptionIds));
    }
    if (fixture.serviceIds.length) {
      await db.delete(servicesTable).where(inArray(servicesTable.id, fixture.serviceIds));
    }
    if (fixture.salonIds.length) {
      await db.delete(salonsTable).where(inArray(salonsTable.id, fixture.salonIds));
    }
    if (fixture.planId) {
      await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, fixture.planId));
    }
    if (fixture.userIds.length) {
      await db.delete(usersTable).where(inArray(usersTable.id, fixture.userIds));
    }
    await pool.end();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});