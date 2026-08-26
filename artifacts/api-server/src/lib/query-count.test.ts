import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import {
  appointmentsTable,
  db,
  employeesTable,
  employeeServicesTable,
  orderItemsTable,
  ordersTable,
  pool,
  productsTable,
  salonCustomersTable,
  salonNotificationsTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureDemoData } from "./seed";

type QueryProbe = {
  path: string;
  maximumQueries: number;
  authenticated?: boolean;
};

const probes: QueryProbe[] = [
  { path: "/salons", maximumQueries: 10 },
  { path: "/shop/products", maximumQueries: 8, authenticated: true },
  { path: "/education/public/courses", maximumQueries: 15 },
];

async function run(): Promise<void> {
  await ensureDemoData();
  const suffix = randomUUID();
  const [owner] = await db.insert(usersTable).values({
    firstName: "Query",
    lastName: "Probe",
    email: `query-probe-${suffix}@example.test`,
    passwordHash: await hashPassword(`query-probe-${suffix}`),
    passwordSetAt: new Date(),
    role: "SALON_OWNER",
  }).returning();
  assert.ok(owner);
  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner.id,
    name: `Query Probe ${suffix}`,
    slug: `query-probe-${suffix}`,
    city: "Beograd",
    municipality: "Vračar",
    address: "Test 1",
    phone: "+381600000000",
    email: `query-probe-salon-${suffix}@example.test`,
    shortDescription: "Query count fixture",
    description: "Query count fixture",
    imageUrl: "",
  }).returning();
  assert.ok(salon);
  const cookie = `${sessionCookieName}=${await createSession(owner.id)}`;

  // Employee portal fixture: one linked employee with a bounded set of
  // appointments, plus a foreign employee to prove per-employee isolation.
  const shiftDate = (days: number): string => {
    const value = new Date();
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };
  const [employeeUser] = await db.insert(usersTable).values({
    firstName: "Portal",
    lastName: "Employee",
    email: `query-probe-employee-${suffix}@example.test`,
    passwordHash: await hashPassword(`query-probe-employee-${suffix}`),
    passwordSetAt: new Date(),
    role: "SALON_EMPLOYEE",
  }).returning();
  assert.ok(employeeUser);
  const [portalEmployee, foreignEmployee] = await db.insert(employeesTable).values([
    { salonId: salon.id, userId: employeeUser.id, name: "Portal zaposleni", role: "Stilist", bio: "", avatarUrl: "" },
    { salonId: salon.id, name: "Tuđi zaposleni", role: "Stilist", bio: "", avatarUrl: "" },
  ]).returning();
  assert.ok(portalEmployee && foreignEmployee);
  const [portalService] = await db.insert(servicesTable).values({
    salonId: salon.id,
    categoryName: "Test",
    name: "Query probe usluga",
    description: "Query probe usluga.",
    durationMinutes: 60,
    price: 1000,
    imageUrl: "/test.jpg",
  }).returning();
  assert.ok(portalService);
  await db.insert(employeeServicesTable).values({ employeeId: portalEmployee.id, serviceId: portalService.id });
  const [portalContact] = await db.insert(salonCustomersTable).values({
    salonId: salon.id,
    firstName: "Klijent",
    lastName: "Probe",
    phone: "+381600000111",
    phoneNormalized: "+381600000111",
  }).returning();
  assert.ok(portalContact);
  const appointmentBase = {
    salonId: salon.id,
    salonCustomerId: portalContact.id,
    serviceId: portalService.id,
    startTime: "09:00",
    endTime: "10:00",
    durationMinutes: 60,
    price: 1000,
  } as const;
  const inWindowAppointmentId = randomUUID();
  const foreignEmployeeAppointmentId = randomUUID();
  const farFutureAppointmentId = randomUUID();
  const farPastAppointmentId = randomUUID();
  await db.insert(appointmentsTable).values([
    { id: inWindowAppointmentId, ...appointmentBase, employeeId: portalEmployee.id, date: shiftDate(1), status: "confirmed" },
    { id: foreignEmployeeAppointmentId, ...appointmentBase, employeeId: foreignEmployee.id, date: shiftDate(1), status: "confirmed" },
    { id: farFutureAppointmentId, ...appointmentBase, employeeId: portalEmployee.id, date: shiftDate(400), status: "confirmed" },
    { id: farPastAppointmentId, ...appointmentBase, employeeId: portalEmployee.id, date: shiftDate(-400), status: "confirmed" },
  ]);
  const employeeCookie = `${sessionCookieName}=${await createSession(employeeUser.id)}`;

  // Owner CRM fixture: several contacts (so pagination is exercised) each with a
  // handful of appointments. The query count for /salon/customers must be constant
  // regardless of page size, and never scale with the total appointment count.
  const crmContactIds: string[] = [];
  const crmAppointmentIds: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const [crmContact] = await db.insert(salonCustomersTable).values({
      salonId: salon.id,
      firstName: `CRM${i}`,
      lastName: `Kontakt${i}`,
      phone: `+3816000002${i}0`,
      phoneNormalized: `+3816000002${i}0`,
    }).returning();
    assert.ok(crmContact);
    crmContactIds.push(crmContact.id);
    for (let j = 0; j < 3; j += 1) {
      const id = randomUUID();
      crmAppointmentIds.push(id);
      // Assign to the foreign employee on far dates so these rows never enter the
      // employee-portal operational window (keeping that probe's fixture stable),
      // while still counting toward CRM aggregates which span all salon appointments.
      await db.insert(appointmentsTable).values({
        id,
        salonId: salon.id,
        salonCustomerId: crmContact.id,
        serviceId: portalService.id,
        employeeId: foreignEmployee.id,
        startTime: "11:00",
        endTime: "12:00",
        durationMinutes: 60,
        price: 1000,
        date: shiftDate(500 + i * 3 + j),
        status: j === 0 ? "no-show" : j === 1 ? "completed" : "confirmed",
      });
    }
  }

  // Customer fixture: a signed-in customer with several own appointments across
  // past/upcoming dates and mixed statuses, so /appointments filters+pagination
  // are meaningful and the query count stays constant.
  const [customerUser] = await db.insert(usersTable).values({
    firstName: "Query",
    lastName: "Customer",
    email: `query-probe-customer-${suffix}@example.test`,
    passwordHash: await hashPassword(`query-probe-customer-${suffix}`),
    passwordSetAt: new Date(),
    role: "CUSTOMER",
  }).returning();
  assert.ok(customerUser);
  const customerAppointmentIds: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const id = randomUUID();
    customerAppointmentIds.push(id);
    // Assign to the foreign employee on far dates to keep the employee-portal
    // probe fixture stable; the customer /appointments endpoint is scoped by
    // customerId, not employee/date-window.
    await db.insert(appointmentsTable).values({
      id,
      salonId: salon.id,
      customerId: customerUser.id,
      serviceId: portalService.id,
      employeeId: foreignEmployee.id,
      startTime: "13:00",
      endTime: "14:00",
      durationMinutes: 60,
      price: 1000,
      date: shiftDate(i % 2 === 0 ? 600 + i : -(600 + i)),
      status: i % 2 === 0 ? "confirmed" : "completed",
    });
  }
  const customerCookie = `${sessionCookieName}=${await createSession(customerUser.id)}`;

  // Dashboard fixture: today-dated rows for the salon (so /salon/dashboard's
  // today list boundary is exercised) plus a bounded set for the customer's
  // upcoming/visit aggregates. A second bulk batch is inserted later to prove the
  // dashboards use a constant query count regardless of appointment volume.
  const todayIso = new Date().toISOString().slice(0, 10);
  const dashboardAppointmentIds: string[] = [];
  const insertDashboardBatch = async (batch: number): Promise<void> => {
    for (let i = 0; i < 8; i += 1) {
      const salonToday = randomUUID();
      const customerToday = randomUUID();
      dashboardAppointmentIds.push(salonToday, customerToday);
      await db.insert(appointmentsTable).values([
        {
          id: salonToday, salonId: salon.id, salonCustomerId: crmContactIds[i % crmContactIds.length],
          serviceId: portalService.id, employeeId: foreignEmployee.id,
          startTime: "09:00", endTime: "10:00", durationMinutes: 60, price: 1000,
          date: todayIso, status: i % 2 === 0 ? "completed" : "confirmed",
        },
        {
          id: customerToday, salonId: salon.id, customerId: customerUser.id,
          serviceId: portalService.id, employeeId: foreignEmployee.id,
          startTime: "15:00", endTime: "16:00", durationMinutes: 60, price: 1000,
          date: todayIso, status: batch === 0 && i === 0 ? "completed" : "confirmed",
        },
      ]);
    }
  };
  await insertDashboardBatch(0);

  // B2B history fixtures for the salon owner: a product referenced by every
  // order item, several orders (each with two items so the page-scoped item
  // fetch is exercised), and several notifications. Sizes are chosen so a
  // pageSize of 2 yields at least two full pages, proving page-2 reachability
  // and a constant query count across pages.
  const [b2bProduct] = await db.insert(productsTable).values({
    categoryName: "Test",
    name: `Query probe proizvod ${suffix}`,
    description: "Query probe proizvod.",
    imageUrl: "/test.jpg",
    price: 1000,
    sku: `qp-${suffix}`,
    unit: "kom",
  }).returning();
  assert.ok(b2bProduct);
  const orderRows = await db.insert(ordersTable).values(
    Array.from({ length: 5 }, (_unused, index) => ({
      salonId: salon.id,
      status: "paid" as const,
      total: 2000,
      shippingName: `Primalac ${index}`,
      shippingAddress: "Test 1",
      subtotal: 2000,
      paymentMethod: "BANK_TRANSFER" as const,
    })),
  ).returning();
  assert.equal(orderRows.length, 5);
  await db.insert(orderItemsTable).values(
    orderRows.flatMap((order) => [
      {
        orderId: order.id, productId: b2bProduct.id, productName: b2bProduct.name, quantity: 1, price: 1000,
        supplierId: b2bProduct.supplierId, supplierName: "LUMERA Legacy Catalog", supplierSlug: "lumera-legacy",
        productCatalogReference: b2bProduct.catalogReference, market: "B2B", currency: "RSD", unitPrice: 1000, lineSubtotal: 1000, lineTotal: 1000,
      },
      {
        orderId: order.id, productId: b2bProduct.id, productName: b2bProduct.name, quantity: 1, price: 1000,
        supplierId: b2bProduct.supplierId, supplierName: "LUMERA Legacy Catalog", supplierSlug: "lumera-legacy",
        productCatalogReference: b2bProduct.catalogReference, market: "B2B", currency: "RSD", unitPrice: 1000, lineSubtotal: 1000, lineTotal: 1000,
      },
    ]),
  );
  await db.insert(salonNotificationsTable).values(
    Array.from({ length: 5 }, (_unused, index) => ({
      salonId: salon.id,
      title: `Obaveštenje ${index}`,
      message: "Query probe obaveštenje.",
    })),
  );

  const originalQuery = pool.query.bind(pool);
  let queryCount = 0;
  pool.query = ((...args: Parameters<typeof pool.query>) => {
    queryCount += 1;
    return originalQuery(...args);
  }) as typeof pool.query;

  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    for (const probe of probes) {
      queryCount = 0;
      const response = await fetch(`http://127.0.0.1:${address.port}/api${probe.path}`, {
        headers: probe.authenticated ? { cookie } : undefined,
      });
      const responseText = await response.text();
      assert.equal(response.status, 200, `${probe.path}: ${responseText.slice(0, 500)}`);
      assert.ok(
        queryCount <= probe.maximumQueries,
        `${probe.path} used ${queryCount} queries; maximum is ${probe.maximumQueries}`,
      );
      process.stdout.write(`✓ ${probe.path}: ${queryCount} queries\n`);
    }

    // First-available is a global derived sort: PostgreSQL must rank the full
    // filtered directory before LIMIT/OFFSET. Adjacent pages must remain stable
    // and non-overlapping, and the emitted card slots must be nondecreasing.
    type FirstAvailableCard = { id: string; earliestSlot: string | null };
    const fetchFirstAvailablePage = async (page: number) => {
      queryCount = 0;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/salons?sort=first-available&page=${page}&pageSize=2`,
      );
      const text = await response.text();
      assert.equal(response.status, 200, `/salons first-available page ${page}: ${text.slice(0, 500)}`);
      return { items: JSON.parse(text) as FirstAvailableCard[], queries: queryCount };
    };
    const firstAvailablePage1 = await fetchFirstAvailablePage(1);
    const firstAvailablePage2 = await fetchFirstAvailablePage(2);
    assert.equal(firstAvailablePage1.queries, firstAvailablePage2.queries, "first-available query count must be page independent");
    assert.ok(firstAvailablePage1.queries <= 6, `first-available directory used ${firstAvailablePage1.queries} queries; maximum is 6`);
    const firstAvailableIds = new Set(firstAvailablePage1.items.map((item) => item.id));
    assert.equal(
      firstAvailablePage2.items.filter((item) => firstAvailableIds.has(item.id)).length,
      0,
      "first-available adjacent pages must not overlap",
    );
    const orderedSlots = [...firstAvailablePage1.items, ...firstAvailablePage2.items]
      .map((item) => item.earliestSlot)
      .filter((slot): slot is string => slot !== null);
    assert.deepEqual(orderedSlots, [...orderedSlots].sort(), "first-available pages must be globally ordered by earliest slot");
    process.stdout.write(`✓ /salons first-available: ${firstAvailablePage1.queries} queries/page (global SQL order)\n`);

    // B2B shop catalog: the paginated list must use a constant number of queries
    // regardless of which page is requested (category availability, counting,
    // ordering and paging all happen in SQL, and review aggregates are grouped
    // and scoped to only the returned product ids). It must also expose stable
    // pagination semantics so every product remains reachable.
    type ProductListBody = {
      items: { id: string }[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
    const fetchProductsPage = async (page: number): Promise<{ body: ProductListBody; queries: number }> => {
      queryCount = 0;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/shop/products?page=${page}&pageSize=2`,
        { headers: { cookie } },
      );
      const text = await response.text();
      assert.equal(response.status, 200, `/shop/products?page=${page}: ${text.slice(0, 500)}`);
      return { body: JSON.parse(text) as ProductListBody, queries: queryCount };
    };
    const firstPage = await fetchProductsPage(1);
    const secondPage = await fetchProductsPage(2);
    // Constant query count: paging deeper must not add queries.
    assert.equal(
      firstPage.queries,
      secondPage.queries,
      `/shop/products query count must be constant across pages; page 1 used ${firstPage.queries}, page 2 used ${secondPage.queries}`,
    );
    const maximumShopPaginatedQueries = 6;
    assert.ok(
      firstPage.queries <= maximumShopPaginatedQueries,
      `/shop/products used ${firstPage.queries} queries; maximum is ${maximumShopPaginatedQueries}`,
    );
    // Pagination semantics: bounded page size, consistent totals, and no overlap
    // between adjacent pages so no product is skipped or duplicated.
    assert.equal(firstPage.body.page, 1, "first page must report page 1");
    assert.equal(firstPage.body.pageSize, 2, "page size must be honored");
    assert.ok(firstPage.body.items.length <= 2, "page must not exceed the requested pageSize");
    assert.ok(firstPage.body.total >= firstPage.body.items.length, "total must cover the returned items");
    assert.equal(
      firstPage.body.totalPages,
      Math.max(1, Math.ceil(firstPage.body.total / firstPage.body.pageSize)),
      "totalPages must derive from total and pageSize",
    );
    if (firstPage.body.totalPages >= 2) {
      const firstIds = new Set(firstPage.body.items.map((item) => item.id));
      const overlap = secondPage.body.items.filter((item) => firstIds.has(item.id));
      assert.equal(overlap.length, 0, "adjacent pages must not overlap so every product stays reachable");
    }
    process.stdout.write(`✓ /shop/products pagination: ${firstPage.queries} queries/page, ${firstPage.body.total} total\n`);

    // Employee portal: bounded query count that does not scale per appointment,
    // scoped to the requesting employee and to the operational window.
    queryCount = 0;
    const portalResponse = await fetch(`http://127.0.0.1:${address.port}/api/employee/portal`, {
      headers: { cookie: employeeCookie },
    });
    const portalText = await portalResponse.text();
    assert.equal(portalResponse.status, 200, `/employee/portal: ${portalText.slice(0, 500)}`);
    const portalQueryCount = queryCount;
    const maximumPortalQueries = 12;
    assert.ok(
      portalQueryCount <= maximumPortalQueries,
      `/employee/portal used ${portalQueryCount} queries; maximum is ${maximumPortalQueries}`,
    );
    const portalBody = JSON.parse(portalText) as { appointments: { id: string }[] };
    const returnedIds = new Set(portalBody.appointments.map((appointment) => appointment.id));
    assert.ok(returnedIds.has(inWindowAppointmentId), "portal must return the employee's in-window appointment");
    assert.ok(returnedIds.has(farFutureAppointmentId), "portal must keep all upcoming appointments visible");
    assert.ok(!returnedIds.has(foreignEmployeeAppointmentId), "portal must not leak another employee's appointment");
    assert.ok(!returnedIds.has(farPastAppointmentId), "portal must bound the look-back operational window");
    process.stdout.write(`✓ /employee/portal: ${portalQueryCount} queries\n`);

    // Helper: run a GET request and return { status, body, queries } where
    // `queries` is the SQL query count consumed by that single request.
    const measure = async (path: string, cookieHeader: string): Promise<{ status: number; body: unknown; queries: number }> => {
      queryCount = 0;
      const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { headers: { cookie: cookieHeader } });
      const text = await response.text();
      const queries = queryCount;
      return { status: response.status, body: text ? JSON.parse(text) : null, queries };
    };

    // Task 131 regression: query count must be independent of page size AND of the
    // status/date/scope filters, because all filtering happens in SQL before a
    // stable bounded page (not after loading every row).

    // /salon/customers — page contacts first, then grouped aggregates + batch reads
    // scoped to the page's contact IDs. Same query count for small vs large pages.
    const customersSmall = await measure("/salon/customers?page=1&pageSize=2", cookie);
    const customersLarge = await measure("/salon/customers?page=1&pageSize=100", cookie);
    assert.equal(customersSmall.status, 200, `/salon/customers small: ${JSON.stringify(customersSmall.body).slice(0, 300)}`);
    assert.equal(customersLarge.status, 200, `/salon/customers large: ${JSON.stringify(customersLarge.body).slice(0, 300)}`);
    assert.ok(Array.isArray(customersSmall.body) && customersSmall.body.length === 2, "small page must return exactly pageSize contacts");
    assert.equal(
      customersSmall.queries,
      customersLarge.queries,
      `/salon/customers query count must be page-size independent (small=${customersSmall.queries}, large=${customersLarge.queries})`,
    );
    const customersMax = 8;
    assert.ok(customersSmall.queries <= customersMax, `/salon/customers used ${customersSmall.queries} queries; maximum is ${customersMax}`);
    process.stdout.write(`✓ /salon/customers: ${customersSmall.queries} queries (page-size independent)\n`);

    // /salon/appointments — status/date predicates fold into SQL before the page.
    // Query count is identical whether filters are present or not, and page-size
    // independent.
    const salonApptNoFilter = await measure("/salon/appointments?pageSize=1", cookie);
    const salonApptStatus = await measure("/salon/appointments?status=confirmed&pageSize=1", cookie);
    const salonApptLargePage = await measure("/salon/appointments?pageSize=100", cookie);
    assert.equal(salonApptNoFilter.status, 200, `/salon/appointments: ${JSON.stringify(salonApptNoFilter.body).slice(0, 300)}`);
    assert.equal(salonApptStatus.status, 200);
    assert.equal(salonApptLargePage.status, 200);
    assert.equal(
      salonApptNoFilter.queries,
      salonApptStatus.queries,
      `/salon/appointments query count must be filter independent (none=${salonApptNoFilter.queries}, status=${salonApptStatus.queries})`,
    );
    assert.equal(
      salonApptNoFilter.queries,
      salonApptLargePage.queries,
      `/salon/appointments query count must be page-size independent (small=${salonApptNoFilter.queries}, large=${salonApptLargePage.queries})`,
    );
    assert.ok(
      Array.isArray(salonApptStatus.body) && (salonApptStatus.body as { status: string }[]).every((a) => a.status === "confirmed"),
      "status filter must apply in SQL",
    );
    process.stdout.write(`✓ /salon/appointments: ${salonApptNoFilter.queries} queries (filter + page-size independent)\n`);

    // /appointments (customer) — status/scope predicates fold into SQL before the
    // page. Query count identical across filters and page sizes.
    const custApptAll = await measure("/appointments?pageSize=1", customerCookie);
    const custApptUpcoming = await measure("/appointments?scope=upcoming&pageSize=1", customerCookie);
    const custApptStatus = await measure("/appointments?status=completed&pageSize=1", customerCookie);
    const custApptLarge = await measure("/appointments?pageSize=100", customerCookie);
    assert.equal(custApptAll.status, 200, `/appointments: ${JSON.stringify(custApptAll.body).slice(0, 300)}`);
    assert.equal(custApptUpcoming.status, 200);
    assert.equal(custApptStatus.status, 200);
    assert.equal(custApptLarge.status, 200);
    assert.equal(custApptAll.queries, custApptUpcoming.queries, `/appointments query count must be scope-filter independent`);
    assert.equal(custApptAll.queries, custApptStatus.queries, `/appointments query count must be status-filter independent`);
    assert.equal(custApptAll.queries, custApptLarge.queries, `/appointments query count must be page-size independent`);
    assert.ok(
      Array.isArray(custApptUpcoming.body) && (custApptUpcoming.body as { date: string }[]).every((a) => a.date >= new Date().toISOString().slice(0, 10)),
      "scope=upcoming must apply in SQL",
    );
    process.stdout.write(`✓ /appointments: ${custApptAll.queries} queries (filter + page-size independent)\n`);

    // /salon/employees — counts are plan-bounded, but every related read (links,
    // service names, user accounts) is scoped with inArray to the returned IDs, so
    // the query count is small and constant.
    const employeesProbe = await measure("/salon/employees", cookie);
    assert.equal(employeesProbe.status, 200, `/salon/employees: ${JSON.stringify(employeesProbe.body).slice(0, 300)}`);
    const employeesMax = 6;
    assert.ok(employeesProbe.queries <= employeesMax, `/salon/employees used ${employeesProbe.queries} queries; maximum is ${employeesMax}`);
    process.stdout.write(`✓ /salon/employees: ${employeesProbe.queries} queries (scoped reads)\n`);

    // Task 131 regression: dashboards must NOT load complete appointment history.
    // The query count must be constant regardless of how many appointments exist,
    // and the payloads must respect the SQL-bounded limits (upcoming top 3, today
    // list top 5, today-only date predicate).
    type CustomerDashboard = {
      upcoming: { id: string; status: string; date: string }[];
      recentSalons: { id: string }[];
      recommendations: { id: string }[];
      favoriteCount: number;
      visitCount: number;
    };
    type SalonDashboard = {
      todayAppointments: { id: string; date: string }[];
      revenueThisMonth: number;
      bookingsThisMonth: number;
      newCustomers: number;
    };

    const customerDashBefore = await measure("/customer/dashboard", customerCookie);
    const salonDashBefore = await measure("/salon/dashboard", cookie);
    assert.equal(customerDashBefore.status, 200, `/customer/dashboard: ${JSON.stringify(customerDashBefore.body).slice(0, 300)}`);
    assert.equal(salonDashBefore.status, 200, `/salon/dashboard: ${JSON.stringify(salonDashBefore.body).slice(0, 300)}`);

    const customerDash = customerDashBefore.body as CustomerDashboard;
    const salonDash = salonDashBefore.body as SalonDashboard;

    // Boundaries: SQL order + limit must cap the display lists.
    assert.ok(customerDash.upcoming.length <= 3, "customer dashboard upcoming must be bounded to 3");
    assert.ok(customerDash.upcoming.every((a) => a.status !== "cancelled"), "upcoming must exclude cancelled appointments");
    assert.ok(salonDash.todayAppointments.length <= 5, "salon dashboard today list must be bounded to 5");
    assert.ok(salonDash.todayAppointments.every((a) => String(a.date).slice(0, 10) === todayIso), "salon dashboard today list must be today-only");
    assert.ok(salonDash.bookingsThisMonth >= salonDash.todayAppointments.length, "month bookings aggregate must cover today's rows");
    assert.ok(salonDash.revenueThisMonth > 0, "month revenue aggregate must sum completed appointments");

    // Insert a second bulk batch of appointments and re-measure: a correct
    // implementation reads via SQL predicates/aggregates, so the query count and
    // the bounded payload sizes must not change with appointment volume.
    await insertDashboardBatch(1);
    const customerDashAfter = await measure("/customer/dashboard", customerCookie);
    const salonDashAfter = await measure("/salon/dashboard", cookie);
    assert.equal(customerDashAfter.status, 200);
    assert.equal(salonDashAfter.status, 200);
    assert.equal(
      customerDashBefore.queries,
      customerDashAfter.queries,
      `/customer/dashboard query count must be constant regardless of appointment volume (before=${customerDashBefore.queries}, after=${customerDashAfter.queries})`,
    );
    assert.equal(
      salonDashBefore.queries,
      salonDashAfter.queries,
      `/salon/dashboard query count must be constant regardless of appointment volume (before=${salonDashBefore.queries}, after=${salonDashAfter.queries})`,
    );
    assert.ok((customerDashAfter.body as CustomerDashboard).upcoming.length <= 3, "upcoming stays bounded after volume grows");
    assert.ok((salonDashAfter.body as SalonDashboard).todayAppointments.length <= 5, "today list stays bounded after volume grows");
    // Absolute caps are generous (card assembly for recent + recommended salons
    // and loyalty status dominate); the load-bearing guarantee is the constant
    // query count above, which proves history is never fully scanned.
    const customerDashMax = 30;
    const salonDashMax = 20;
    assert.ok(customerDashBefore.queries <= customerDashMax, `/customer/dashboard used ${customerDashBefore.queries} queries; maximum is ${customerDashMax}`);
    assert.ok(salonDashBefore.queries <= salonDashMax, `/salon/dashboard used ${salonDashBefore.queries} queries; maximum is ${salonDashMax}`);
    process.stdout.write(`✓ /customer/dashboard: ${customerDashBefore.queries} queries (volume independent)\n`);
    process.stdout.write(`✓ /salon/dashboard: ${salonDashBefore.queries} queries (volume independent)\n`);

    // Task 131 regression: B2B owner history lists (/shop/orders and
    // /shop/notifications) must page in SQL with a constant query count across
    // pages, return a flat array bounded by pageSize, and keep every row
    // reachable via page 2 (createdAt desc, id desc — no overlap between pages).
    type OrderRow = { id: string; itemCount: number };
    const ordersPage1 = await measure("/shop/orders?page=1&pageSize=2", cookie);
    const ordersPage2 = await measure("/shop/orders?page=2&pageSize=2", cookie);
    assert.equal(ordersPage1.status, 200, `/shop/orders page 1: ${JSON.stringify(ordersPage1.body).slice(0, 300)}`);
    assert.equal(ordersPage2.status, 200, `/shop/orders page 2: ${JSON.stringify(ordersPage2.body).slice(0, 300)}`);
    assert.ok(Array.isArray(ordersPage1.body) && Array.isArray(ordersPage2.body), "/shop/orders must return a flat array");
    const ordersP1 = ordersPage1.body as OrderRow[];
    const ordersP2 = ordersPage2.body as OrderRow[];
    assert.equal(ordersP1.length, 2, "/shop/orders page 1 must return exactly pageSize orders");
    assert.ok(ordersP2.length >= 1, "/shop/orders page 2 must be reachable (page-2 regression)");
    assert.ok(ordersP1.every((o) => o.itemCount >= 1), "page-scoped order items must be grouped and counted");
    const ordersP1Ids = new Set(ordersP1.map((o) => o.id));
    assert.equal(ordersP2.filter((o) => ordersP1Ids.has(o.id)).length, 0, "adjacent order pages must not overlap");
    assert.equal(
      ordersPage1.queries,
      ordersPage2.queries,
      `/shop/orders query count must be constant across pages (page1=${ordersPage1.queries}, page2=${ordersPage2.queries})`,
    );
    const ordersMax = 6;
    assert.ok(ordersPage1.queries <= ordersMax, `/shop/orders used ${ordersPage1.queries} queries; maximum is ${ordersMax}`);
    process.stdout.write(`✓ /shop/orders: ${ordersPage1.queries} queries/page (page-2 reachable, constant)\n`);

    type NotificationRow = { id: string; readAt: string | null };
    const notifsPage1 = await measure("/shop/notifications?page=1&pageSize=2", cookie);
    const notifsPage2 = await measure("/shop/notifications?page=2&pageSize=2", cookie);
    assert.equal(notifsPage1.status, 200, `/shop/notifications page 1: ${JSON.stringify(notifsPage1.body).slice(0, 300)}`);
    assert.equal(notifsPage2.status, 200, `/shop/notifications page 2: ${JSON.stringify(notifsPage2.body).slice(0, 300)}`);
    assert.ok(Array.isArray(notifsPage1.body) && Array.isArray(notifsPage2.body), "/shop/notifications must return a flat array");
    const notifsP1 = notifsPage1.body as NotificationRow[];
    const notifsP2 = notifsPage2.body as NotificationRow[];
    assert.equal(notifsP1.length, 2, "/shop/notifications page 1 must return exactly pageSize rows");
    assert.ok(notifsP2.length >= 1, "/shop/notifications page 2 must be reachable (page-2 regression)");
    assert.ok(notifsP1.every((n) => Object.prototype.hasOwnProperty.call(n, "readAt")), "unread state (readAt) must survive pagination");
    const notifsP1Ids = new Set(notifsP1.map((n) => n.id));
    assert.equal(notifsP2.filter((n) => notifsP1Ids.has(n.id)).length, 0, "adjacent notification pages must not overlap");
    assert.equal(
      notifsPage1.queries,
      notifsPage2.queries,
      `/shop/notifications query count must be constant across pages (page1=${notifsPage1.queries}, page2=${notifsPage2.queries})`,
    );
    const notifsMax = 4;
    assert.ok(notifsPage1.queries <= notifsMax, `/shop/notifications used ${notifsPage1.queries} queries; maximum is ${notifsMax}`);
    process.stdout.write(`✓ /shop/notifications: ${notifsPage1.queries} queries/page (page-2 reachable, constant)\n`);
  } finally {
    pool.query = originalQuery as typeof pool.query;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await db.delete(appointmentsTable).where(inArray(appointmentsTable.id, [
      inWindowAppointmentId,
      foreignEmployeeAppointmentId,
      farFutureAppointmentId,
      farPastAppointmentId,
      ...crmAppointmentIds,
      ...customerAppointmentIds,
      ...dashboardAppointmentIds,
    ]));
    // Orders reference the salon without cascade; delete them (order items cascade
    // on orderId) before the salon so the salon delete does not hit an FK. The
    // product is not salon-scoped, so it is removed after its order items are gone.
    await db.delete(ordersTable).where(eq(ordersTable.salonId, salon.id));
    await db.delete(salonsTable).where(eq(salonsTable.id, salon.id));
    await db.delete(productsTable).where(eq(productsTable.id, b2bProduct.id));
    await db.delete(usersTable).where(inArray(usersTable.id, [owner.id, employeeUser.id, customerUser.id]));
    await pool.end();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});