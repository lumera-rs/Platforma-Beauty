import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  db,
  employeeLocationAssignmentsTable,
  employeeServicesTable,
  employeesTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";

const scrypt = promisify(scryptCallback);
const fixtureImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='%23f1e9df'/%3E%3C/svg%3E";

function futureDate(days: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

type BookingFixture = {
  customerEmail: string;
  customerPassword: string;
  customerId: string;
  ownerId: string;
  salonId: string;
  salonPath: string;
  salonName: string;
  serviceIds: [string, string];
  serviceNames: [string, string];
  employeeIds: [string, string];
  employeeNames: [string, string];
};

type Candidate = {
  date: string;
  startTime: string;
  treatments: Array<{
    serviceId: string;
    employeeId: string;
    date: string;
    startTime: string;
    endTime: string;
  }>;
};

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function createBookingFixture(): Promise<BookingFixture> {
  const suffix = randomUUID();
  const customerEmail = `browser-grouped-customer-${suffix}@example.test`;
  const customerPassword = "browser-grouped-customer-password";
  const ownerEmail = `browser-grouped-owner-${suffix}@example.test`;
  const phone = `+38161${suffix.replaceAll("-", "").slice(0, 8)}`;
  let customerId: string | undefined;
  let ownerId: string | undefined;
  let salonId: string | undefined;

  try {
    const [owner] = await db.insert(usersTable).values({
      firstName: "Browser",
      lastName: "Vlasnik",
      email: ownerEmail,
      passwordHash: await hashPassword("browser-grouped-owner-password"),
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    }).returning();
    if (!owner) throw new Error("Could not create booking owner fixture.");
    ownerId = owner.id;

    const [customer] = await db.insert(usersTable).values({
      firstName: "Browser",
      lastName: "Kupac",
      email: customerEmail,
      phone,
      phoneNormalized: phone,
      passwordHash: await hashPassword(customerPassword),
      passwordSetAt: new Date(),
      role: "CUSTOMER",
    }).returning();
    if (!customer) throw new Error("Could not create booking customer fixture.");
    customerId = customer.id;

    const salonName = `Browser grupni salon ${suffix}`;
    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id,
      name: salonName,
      slug: `browser-grouped-booking-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 95",
      phone: "+381110000095",
      email: `browser-grouped-salon-${suffix}@example.test`,
      shortDescription: "Izolovan salon za grupni booking browser test.",
      description: "Salon napravljen samo za proveru javnog grupnog booking toka.",
      imageUrl: fixtureImage,
      active: true,
      isVerified: true,
      instantBooking: true,
    }).returning();
    if (!salon) throw new Error("Could not create booking salon fixture.");
    salonId = salon.id;

    const insertedEmployeeNames = ["Browser Ana", "Browser Mila"] as const;
    const employees = await db.insert(employeesTable).values(insertedEmployeeNames.map((name) => ({
      salonId: salon.id,
      name,
      role: "Terapeut",
      bio: "Zaposleni za browser proveru grupne rezervacije.",
      avatarUrl: fixtureImage,
    }))).returning();
    if (employees.length !== 2) throw new Error("Could not create booking employee fixtures.");
    await db.insert(employeeLocationAssignmentsTable).values(employees.map((employee, index) => ({
      employeeId: employee.id,
      salonId: salon.id,
      active: true,
      isDefault: index === 0,
    })));

    const insertedServiceNames = ["Browser masaža", "Browser nega lica"] as const;
    const services = await db.insert(servicesTable).values(insertedServiceNames.map((name, index) => ({
      salonId: salon.id,
      categoryName: "Test",
      name,
      description: "Usluga za browser proveru grupne rezervacije.",
      durationMinutes: index === 0 ? 30 : 45,
      price: index === 0 ? 1200 : 1800,
      imageUrl: fixtureImage,
    }))).returning();
    if (services.length !== 2) throw new Error("Could not create booking service fixtures.");

    await db.insert(employeeServicesTable).values([
      { employeeId: employees[0]!.id, serviceId: services[0]!.id },
      { employeeId: employees[0]!.id, serviceId: services[1]!.id },
      { employeeId: employees[1]!.id, serviceId: services[0]!.id },
      { employeeId: employees[1]!.id, serviceId: services[1]!.id },
    ]);

    return {
      customerEmail,
      customerPassword,
      customerId: customer.id,
      ownerId: owner.id,
      salonId: salon.id,
      salonPath: `/saloni/${salon.slug}`,
      salonName,
      serviceIds: [services[0]!.id, services[1]!.id],
      serviceNames: [services[0]!.name, services[1]!.name],
      employeeIds: [employees[0]!.id, employees[1]!.id],
      employeeNames: [employees[0]!.name, employees[1]!.name],
    };
  } catch (error) {
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (customerId) await db.delete(usersTable).where(eq(usersTable.id, customerId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpFixture(fixture: BookingFixture) {
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.customerId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
}

async function signIn(page: Page, fixture: BookingFixture) {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.customerEmail, password: fixture.customerPassword },
  });
  expect(response).toBeOK();
}

function candidatesFor(fixture: BookingFixture): Candidate[] {
  const sameDay = futureDate(2);
  const firstMultiDay = futureDate(3);
  const secondMultiDay = futureDate(4);
  return [
    {
      date: sameDay,
      startTime: "09:00",
      treatments: [
        { serviceId: fixture.serviceIds[0], employeeId: fixture.employeeIds[0], date: sameDay, startTime: "09:00", endTime: "09:30" },
        { serviceId: fixture.serviceIds[1], employeeId: fixture.employeeIds[1], date: sameDay, startTime: "09:30", endTime: "10:15" },
      ],
    },
    {
      date: firstMultiDay,
      startTime: "14:00",
      treatments: [
        { serviceId: fixture.serviceIds[0], employeeId: fixture.employeeIds[0], date: firstMultiDay, startTime: "14:00", endTime: "14:30" },
        { serviceId: fixture.serviceIds[1], employeeId: fixture.employeeIds[1], date: secondMultiDay, startTime: "10:00", endTime: "10:45" },
      ],
    },
  ];
}

async function mockAvailability(route: Route, fixture: BookingFixture) {
  const body = route.request().postDataJSON() as { resultMode: "list" | "calendar"; allowMultipleDays: boolean };
  const candidates = candidatesFor(fixture).filter((_, index) => body.allowMultipleDays || index === 0);
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body.resultMode === "calendar"
      ? {
          candidates: [],
          calendarDays: candidates.map((candidate) => ({ date: candidate.date, candidates: [candidate] })),
        }
      : { candidates, calendarDays: [] }),
  });
}

async function mockFirstAvailable(route: Route, fixture: BookingFixture) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      salonId: fixture.salonId,
      generatedAt: new Date().toISOString(),
      services: [{
        serviceId: fixture.serviceIds[0],
        date: futureDate(2),
        startTime: "09:00",
        employeeId: fixture.employeeIds[0],
        employeeName: fixture.employeeNames[0],
      }],
    }),
  });
}

async function mockQuickAvailability(route: Route, fixture: BookingFixture, candidates?: Candidate[]) {
  const body = route.request().postDataJSON() as {
    treatments: Array<{ serviceId: string; employeeId?: string | null }>;
    fromDate: string;
    toDate: string;
  };
  if (body.fromDate !== body.toDate) {
    await mockAvailability(route, fixture);
    return;
  }
  expect(body).toMatchObject({
    treatments: [{ serviceId: fixture.serviceIds[0], employeeId: fixture.employeeIds[0] }],
    fromDate: futureDate(2),
    toDate: futureDate(2),
  });
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      candidates: candidates ?? [{
        date: futureDate(2),
        startTime: "09:00",
        treatments: [{
          serviceId: fixture.serviceIds[0],
          employeeId: fixture.employeeIds[0],
          date: futureDate(2),
          startTime: "09:00",
          endTime: "09:30",
        }],
      }],
      calendarDays: [],
    }),
  });
}

async function addServices(page: Page, fixture: BookingFixture, count = 2) {
  for (const serviceId of fixture.serviceIds.slice(0, count)) {
    await page.getByTestId(`salon-service-${serviceId}`).click();
  }
}

async function openDesktopBooking(page: Page, fixture: BookingFixture) {
  await page.goto(fixture.salonPath);
  await addServices(page, fixture);
  const widget = page.locator("#booking-widget");
  await expect(widget.getByRole("heading", { name: "Vaša korpa" })).toBeVisible();
  return widget;
}

async function reachAvailability(widget: Locator, fixture: BookingFixture) {
  await expect(widget.getByTestId("booking-cart-item-0")).toContainText(fixture.serviceNames[0]);
  await expect(widget.getByTestId("booking-cart-item-1")).toContainText(fixture.serviceNames[1]);
  await widget.getByRole("button", { name: /Nastavi na izbor zaposlenog/ }).click();
  await expect(widget.getByLabel(`${fixture.serviceNames[0]}: bilo koji zaposleni`)).toHaveAttribute("aria-pressed", "true");
  await widget.getByLabel(`${fixture.serviceNames[1]}: ${fixture.employeeNames[1]}`).click();
  await expect(widget.getByLabel(`${fixture.serviceNames[1]}: ${fixture.employeeNames[1]}`)).toHaveAttribute("aria-pressed", "true");
  await widget.getByRole("button", { name: /Izaberi vreme/ }).click();
  await expect(widget.getByLabel("Korak 3: TERMIN")).toHaveAttribute("aria-current", "step");
}

test("desktop salon booking covers cart, employee choices, list, calendar, and multi-day candidates", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createBookingFixture();
  try {
    await signIn(page, fixture);
    await page.route(`**/api/salons/${fixture.salonId}/grouped-availability`, (route) => mockAvailability(route, fixture));
    const widget = await openDesktopBooking(page, fixture);
    await reachAvailability(widget, fixture);
    const [sameDay, multiDay] = candidatesFor(fixture);

    await widget.getByTestId("booking-view-list").click();
    await expect(widget.getByLabel(`Izaberi raspored ${sameDay!.date} u 09:00`)).toBeVisible();

    await widget.getByTestId("booking-view-calendar").click();
    await expect(widget.getByTestId(`booking-calendar-day-${sameDay!.date}`)).toHaveAccessibleName(/ima slobodnih rasporeda/);
    await widget.getByTestId(`booking-calendar-candidate-${sameDay!.date}-09:00-0`).click();
    await expect(widget.getByRole("button", { name: "Zakaži" })).toBeEnabled();

    await widget.getByTestId("booking-multiday-toggle").click();
    await widget.getByTestId("booking-view-list").click();
    const multiDayCandidate = widget.getByLabel(`Izaberi raspored ${multiDay!.date} u 14:00`);
    await expect(multiDayCandidate).toContainText(candidatesFor(fixture)[1]!.treatments[1]!.date.slice(5).split("-").reverse().join(".") + ".");
    await multiDayCandidate.click();
    await expect(multiDayCandidate).toHaveAttribute("aria-pressed", "true");
  } finally {
    await cleanUpFixture(fixture);
  }
});

test("390x844 salon drawer keeps the grouped cart and supports candidate selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await createBookingFixture();
  try {
    await signIn(page, fixture);
    await page.route(`**/api/salons/${fixture.salonId}/grouped-availability`, (route) => mockAvailability(route, fixture));
    await page.goto(fixture.salonPath);
    await page.getByTestId(`salon-service-${fixture.serviceIds[0]}`).click();
    await page.getByTestId(`salon-service-${fixture.serviceIds[1]}`).dispatchEvent("click");

    const drawer = page.getByRole("dialog", { name: "Zakažite termin" });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAccessibleDescription("Izaberite uslugu, zaposlenog i slobodan termin.");
    await expect(drawer.getByTestId("booking-cart-item-0")).toBeVisible();
    await expect(drawer.getByTestId("booking-cart-item-1")).toBeVisible();
    await reachAvailability(drawer, fixture);
    await drawer.getByTestId("booking-view-list").click();
    await drawer.getByLabel(`Izaberi raspored ${candidatesFor(fixture)[0]!.date} u 09:00`).click();
    await expect(drawer.getByRole("button", { name: "Zakaži" })).toBeEnabled();
  } finally {
    await cleanUpFixture(fixture);
  }
});

test("the same service remains addable as independent treatments on desktop and mobile", async ({ page }) => {
  const fixture = await createBookingFixture();
  try {
    await signIn(page, fixture);
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.evaluate(
        (customerId) => localStorage.removeItem(`lumera:booking-draft:${customerId}`),
        fixture.customerId,
      );
      await page.goto(fixture.salonPath);
      const service = page.getByTestId(`salon-service-${fixture.serviceIds[0]}`);
      await service.click();
      const bookingSurface = viewport.width < 1024
        ? page.getByRole("dialog", { name: "Zakažite termin" })
        : page.locator("#booking-widget");
      if (viewport.width < 1024) {
        await service.dispatchEvent("click");
      } else {
        await service.click();
      }
      await expect(bookingSurface.getByTestId("booking-cart-item-0")).toContainText(fixture.serviceNames[0]);
      await expect(bookingSurface.getByTestId("booking-cart-item-1")).toContainText(fixture.serviceNames[0]);

      await bookingSurface.getByRole("button", { name: /Nastavi na izbor zaposlenog/ }).click();
      await expect(bookingSurface.getByTestId("booking-employee-any-0")).toHaveAttribute("aria-pressed", "true");
      await bookingSurface.getByTestId(`booking-employee-1-${fixture.employeeIds[1]}`).click();
      await expect(bookingSurface.getByTestId(`booking-employee-1-${fixture.employeeIds[1]}`)).toHaveAttribute("aria-pressed", "true");

      let availabilityTreatments: Array<{ serviceId: string; employeeId?: string | null }> = [];
      await page.route(`**/api/salons/${fixture.salonId}/grouped-availability`, async (route) => {
        const body = route.request().postDataJSON() as {
          treatments: Array<{ serviceId: string; employeeId?: string | null }>;
        };
        availabilityTreatments = body.treatments;
        const date = futureDate(2);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            candidates: [{
              date,
              startTime: "09:00",
              treatments: body.treatments.map((treatment, index) => ({
                serviceId: treatment.serviceId,
                employeeId: treatment.employeeId ?? fixture.employeeIds[0],
                date,
                startTime: index === 0 ? "09:00" : "09:30",
                endTime: index === 0 ? "09:30" : "10:00",
              })),
            }],
            calendarDays: [],
          }),
        });
      });
      await bookingSurface.getByRole("button", { name: /Izaberi vreme/ }).click();
      await expect.poll(() => availabilityTreatments.length).toBe(2);
      expect(availabilityTreatments.map((treatment) => treatment.serviceId)).toEqual([
        fixture.serviceIds[0],
        fixture.serviceIds[0],
      ]);
      expect(availabilityTreatments[0]).not.toHaveProperty("employeeId");
      expect(availabilityTreatments[1]).toMatchObject({
        serviceId: fixture.serviceIds[0],
        employeeId: fixture.employeeIds[1],
      });
      await bookingSurface.getByTestId("booking-view-list").click();
      await bookingSurface.getByLabel(`Izaberi raspored ${futureDate(2)} u 09:00`).click();

      let bookingTreatments: Array<{ serviceId: string; employeeId: string }> = [];
      await page.route("**/api/booking-groups", async (route) => {
        const body = route.request().postDataJSON() as {
          treatments: Array<{ serviceId: string; employeeId: string; date: string; startTime: string }>;
        };
        bookingTreatments = body.treatments;
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: randomUUID(),
            salonId: fixture.salonId,
            createdAt: new Date().toISOString(),
            appointments: body.treatments.map((treatment, index) => ({
              id: randomUUID(),
              bookingGroupId: randomUUID(),
              salonId: fixture.salonId,
              serviceId: treatment.serviceId,
              serviceName: fixture.serviceNames[0],
              employeeId: treatment.employeeId,
              employeeName: fixture.employeeNames[index],
              date: treatment.date,
              startTime: treatment.startTime,
              endTime: index === 0 ? "09:30" : "10:00",
              status: "confirmed",
              price: 1200,
            })),
          }),
        });
      });
      await bookingSurface.getByRole("button", { name: "Zakaži" }).click();
      await expect.poll(() => bookingTreatments.map((treatment) => treatment.serviceId)).toEqual([
        fixture.serviceIds[0],
        fixture.serviceIds[0],
      ]);
      await expect(bookingTreatments.map((treatment) => treatment.employeeId)).toEqual([
        fixture.employeeIds[0],
        fixture.employeeIds[1],
      ]);
      await expect(bookingSurface.getByRole("heading", { name: "Termin potvrđen" })).toBeVisible();
    }
  } finally {
    await cleanUpFixture(fixture);
  }
});

test("customer draft reload restores one cart item without multiplying it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createBookingFixture();
  try {
    await signIn(page, fixture);
    await page.goto(fixture.salonPath);
    await page.getByTestId(`salon-service-${fixture.serviceIds[0]}`).click();
    await expect(page.locator("#booking-widget").getByTestId("booking-cart-item-0")).toBeVisible();
    await expect.poll(() => page.evaluate(
      (customerId) => localStorage.getItem(`lumera:booking-draft:${customerId}`),
      fixture.customerId,
    )).not.toBeNull();

    await page.reload();
    const restoredItems = page.locator("#booking-widget").locator('[data-testid^="booking-cart-item-"]');
    await expect(restoredItems).toHaveCount(1);
    await expect(restoredItems.first()).toContainText(fixture.serviceNames[0]);
    await page.waitForTimeout(250);
    await expect(restoredItems).toHaveCount(1);
  } finally {
    await cleanUpFixture(fixture);
  }
});

test("successful salon booking posts a booking group and renders every appointment", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createBookingFixture();
  try {
    await signIn(page, fixture);
    await page.route(`**/api/salons/${fixture.salonId}/grouped-availability`, (route) => mockAvailability(route, fixture));
    const widget = await openDesktopBooking(page, fixture);
    await reachAvailability(widget, fixture);
    await widget.getByTestId("booking-view-list").click();
    await widget.getByLabel(`Izaberi raspored ${candidatesFor(fixture)[0]!.date} u 09:00`).click();

    const bookingRequest = page.waitForRequest((request) =>
      request.method() === "POST" && new URL(request.url()).pathname === "/api/booking-groups");
    await page.route("**/api/booking-groups", async (route) => {
      const data = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: randomUUID(),
          salonId: fixture.salonId,
          createdAt: new Date().toISOString(),
          appointments: candidatesFor(fixture)[0]!.treatments.map((treatment, index) => ({
            id: randomUUID(),
            bookingGroupId: randomUUID(),
            salonId: fixture.salonId,
            serviceId: treatment.serviceId,
            serviceName: fixture.serviceNames[index],
            employeeId: treatment.employeeId,
            employeeName: fixture.employeeNames[index],
            date: treatment.date,
            startTime: treatment.startTime,
            endTime: treatment.endTime,
            status: "confirmed",
            price: index === 0 ? 1200 : 1800,
          })),
        }),
      });
    });
    await widget.getByRole("button", { name: "Zakaži" }).click();

    const request = await bookingRequest;
    expect(request.postDataJSON()).toMatchObject({
      salonId: fixture.salonId,
      treatments: [
        { serviceId: fixture.serviceIds[0], employeeId: fixture.employeeIds[0], date: candidatesFor(fixture)[0]!.date, startTime: "09:00" },
        { serviceId: fixture.serviceIds[1], employeeId: fixture.employeeIds[1], date: candidatesFor(fixture)[0]!.date, startTime: "09:30" },
      ],
    });
    await expect(widget.getByRole("heading", { name: "Termin potvrđen" })).toBeVisible();
    await expect(widget.getByText(fixture.serviceNames[0], { exact: true })).toBeVisible();
    await expect(widget.getByText(fixture.serviceNames[1], { exact: true })).toBeVisible();
  } finally {
    await cleanUpFixture(fixture);
  }
});

test("booking conflict refreshes grouped availability and requires a new candidate", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createBookingFixture();
  let availabilityCalls = 0;
  try {
    await signIn(page, fixture);
    await page.route(`**/api/salons/${fixture.salonId}/grouped-availability`, async (route) => {
      availabilityCalls += 1;
      await mockAvailability(route, fixture);
    });
    const widget = await openDesktopBooking(page, fixture);
    await reachAvailability(widget, fixture);
    await widget.getByTestId("booking-view-list").click();
    const candidate = widget.getByLabel(`Izaberi raspored ${candidatesFor(fixture)[0]!.date} u 09:00`);
    await candidate.click();
    await page.route("**/api/booking-groups", (route) => route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ code: "BOOKING_GROUP_CONFLICT", error: "Jedan od termina više nije slobodan." }),
    }));

    await widget.getByRole("button", { name: "Zakaži" }).click();
    await expect(page.getByText("Osvežili smo dostupne rasporede. Izaberite drugi.")).toBeVisible();
    await expect.poll(() => availabilityCalls).toBeGreaterThan(1);
    await expect(widget.getByRole("button", { name: "Zakaži" })).toBeDisabled();
    await expect(candidate).toHaveAttribute("aria-pressed", "false");
  } finally {
    await cleanUpFixture(fixture);
  }
});

test("quick booking revalidates the displayed slot and waits for explicit confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createBookingFixture();
  let bookingCalls = 0;
  try {
    await signIn(page, fixture);
    await page.route(`**/api/salons/${fixture.salonId}/first-available`, (route) => mockFirstAvailable(route, fixture));
    await page.route(`**/api/salons/${fixture.salonId}/grouped-availability`, (route) => mockQuickAvailability(route, fixture));
    await page.route("**/api/booking-groups", async (route) => {
      bookingCalls += 1;
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: randomUUID(),
          salonId: fixture.salonId,
          createdAt: new Date().toISOString(),
          appointments: [{
            id: randomUUID(),
            bookingGroupId: randomUUID(),
            salonId: fixture.salonId,
            serviceId: fixture.serviceIds[0],
            serviceName: fixture.serviceNames[0],
            employeeId: fixture.employeeIds[0],
            employeeName: fixture.employeeNames[0],
            date: futureDate(2),
            startTime: "09:00",
            endTime: "09:30",
            status: "confirmed",
            price: 1200,
          }],
          request: body,
        }),
      });
    });
    await page.goto(fixture.salonPath);
    await page.getByTestId(`salon-service-${fixture.serviceIds[0]}`).getByRole("button", { name: "Brzo zakaži" }).click();

    const confirmation = page.locator("#booking-widget").getByTestId("quick-book-confirmation");
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(fixture.serviceNames[0]);
    await expect(confirmation).toContainText(fixture.employeeNames[0]);
    await expect(page.locator("#booking-widget").getByLabel(/Korak 2: ZAPOSLENI/)).toHaveCount(0);
    expect(bookingCalls).toBe(0);

    await confirmation.getByRole("button", { name: "Potvrdi zakazivanje" }).click();
    await expect.poll(() => bookingCalls).toBe(1);
    await expect(page.locator("#booking-widget").getByRole("heading", { name: "Termin potvrđen" })).toBeVisible();
  } finally {
    await cleanUpFixture(fixture);
  }
});

test("quick booking missing slot opens the standard datetime step", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createBookingFixture();
  try {
    await signIn(page, fixture);
    await page.route(`**/api/salons/${fixture.salonId}/first-available`, (route) => mockFirstAvailable(route, fixture));
    await page.route(`**/api/salons/${fixture.salonId}/grouped-availability`, (route) => mockQuickAvailability(route, fixture, []));
    await page.goto(fixture.salonPath);
    await page.getByTestId(`salon-service-${fixture.serviceIds[0]}`).getByRole("button", { name: "Brzo zakaži" }).click();
    const widget = page.locator("#booking-widget");
    await expect(widget.getByLabel("Korak 3: TERMIN")).toHaveAttribute("aria-current", "step");
    await expect(widget.getByRole("heading", { name: "Datum i vreme" })).toBeVisible();
  } finally {
    await cleanUpFixture(fixture);
  }
});

test("quick booking 409 refreshes availability and falls back to datetime selection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createBookingFixture();
  let availabilityCalls = 0;
  try {
    await signIn(page, fixture);
    await page.route(`**/api/salons/${fixture.salonId}/first-available`, (route) => mockFirstAvailable(route, fixture));
    await page.route(`**/api/salons/${fixture.salonId}/grouped-availability`, async (route) => {
      availabilityCalls += 1;
      await mockQuickAvailability(route, fixture);
    });
    await page.route("**/api/booking-groups", (route) => route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ code: "BOOKING_GROUP_CONFLICT", error: "Termin više nije slobodan." }),
    }));
    await page.goto(fixture.salonPath);
    await page.getByTestId(`salon-service-${fixture.serviceIds[0]}`).getByRole("button", { name: "Brzo zakaži" }).click();
    const widget = page.locator("#booking-widget");
    await widget.getByRole("button", { name: "Potvrdi zakazivanje" }).click();
    await expect(widget.getByLabel("Korak 3: TERMIN")).toHaveAttribute("aria-current", "step");
    await expect(page.getByText("Osvežili smo dostupne rasporede. Izaberite drugi.")).toBeVisible();
    await expect.poll(() => availabilityCalls).toBeGreaterThan(1);
  } finally {
    await cleanUpFixture(fixture);
  }
});

test("quick booking sends a guest to sign in only after confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createBookingFixture();
  let bookingCalls = 0;
  try {
    await page.route(`**/api/salons/${fixture.salonId}/first-available`, (route) => mockFirstAvailable(route, fixture));
    await page.route(`**/api/salons/${fixture.salonId}/grouped-availability`, (route) => mockQuickAvailability(route, fixture));
    await page.route("**/api/booking-groups", (route) => {
      bookingCalls += 1;
      return route.abort();
    });
    await page.goto(fixture.salonPath);
    await page.getByTestId(`salon-service-${fixture.serviceIds[0]}`).getByRole("button", { name: "Brzo zakaži" }).click();
    const confirmation = page.locator("#booking-widget").getByTestId("quick-book-confirmation");
    await expect(confirmation).toBeVisible();
    expect(bookingCalls).toBe(0);
    await confirmation.getByRole("button", { name: "Prijavite se za potvrdu" }).click();
    await expect(page).toHaveURL(/\/prijava\?returnTo=/);
    expect(bookingCalls).toBe(0);
  } finally {
    await cleanUpFixture(fixture);
  }
});

test("quick booking resumes after sign in and requires a second confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createBookingFixture();
  let availabilityCalls = 0;
  let bookingCalls = 0;
  try {
    await page.route(`**/api/salons/${fixture.salonId}/first-available`, (route) => mockFirstAvailable(route, fixture));
    await page.route(`**/api/salons/${fixture.salonId}/grouped-availability`, async (route) => {
      availabilityCalls += 1;
      await mockQuickAvailability(route, fixture);
    });
    await page.route("**/api/booking-groups", async (route) => {
      bookingCalls += 1;
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: randomUUID(),
          salonId: fixture.salonId,
          createdAt: new Date().toISOString(),
          appointments: [{
            id: randomUUID(),
            bookingGroupId: randomUUID(),
            salonId: fixture.salonId,
            serviceId: fixture.serviceIds[0],
            serviceName: fixture.serviceNames[0],
            employeeId: fixture.employeeIds[0],
            employeeName: fixture.employeeNames[0],
            date: futureDate(2),
            startTime: "09:00",
            endTime: "09:30",
            status: "confirmed",
            price: 1200,
          }],
          request: body,
        }),
      });
    });

    await page.goto(fixture.salonPath);
    await page.getByTestId(`salon-service-${fixture.serviceIds[0]}`).getByRole("button", { name: "Brzo zakaži" }).click();
    const widget = page.locator("#booking-widget");
    const firstConfirmation = widget.getByTestId("quick-book-confirmation");
    await expect(firstConfirmation).toBeVisible();
    await firstConfirmation.getByRole("button", { name: "Prijavite se za potvrdu" }).click();
    await expect(page).toHaveURL(/\/prijava\?returnTo=/);
    expect(bookingCalls).toBe(0);
    const callsBeforeSignIn = availabilityCalls;

    await page.getByLabel("Email").fill(fixture.customerEmail);
    await page.getByLabel("Lozinka").fill(fixture.customerPassword);
    await page.getByRole("button", { name: "Prijavi se", exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`${fixture.salonPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?`));
    await expect.poll(() => availabilityCalls).toBeGreaterThan(callsBeforeSignIn);
    const resumedConfirmation = widget.getByTestId("quick-book-confirmation");
    await expect(resumedConfirmation).toBeVisible();
    await expect(resumedConfirmation).toContainText(fixture.serviceNames[0]);
    await expect(resumedConfirmation).toContainText(fixture.employeeNames[0]);
    expect(bookingCalls).toBe(0);

    await resumedConfirmation.getByRole("button", { name: "Potvrdi zakazivanje" }).click();
    await expect.poll(() => bookingCalls).toBe(1);
    await expect(widget.getByRole("heading", { name: "Termin potvrđen" })).toBeVisible();
  } finally {
    await cleanUpFixture(fixture);
  }
});

test("390x844 quick booking confirmation has no horizontal overflow and can return to full scheduling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await createBookingFixture();
  try {
    await signIn(page, fixture);
    await page.route(`**/api/salons/${fixture.salonId}/first-available`, (route) => mockFirstAvailable(route, fixture));
    await page.route(`**/api/salons/${fixture.salonId}/grouped-availability`, (route) => mockQuickAvailability(route, fixture));
    await page.goto(fixture.salonPath);
    await page.getByTestId(`salon-service-${fixture.serviceIds[0]}`).getByRole("button", { name: "Brzo zakaži" }).click();
    const drawer = page.getByRole("dialog", { name: "Zakažite termin" });
    const confirmation = drawer.getByTestId("quick-book-confirmation");
    await expect(confirmation).toBeVisible();
    expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await confirmation.getByRole("button", { name: "Izaberi drugi termin" }).click();
    await expect(drawer.getByLabel("Korak 3: TERMIN")).toHaveAttribute("aria-current", "step");
  } finally {
    await cleanUpFixture(fixture);
  }
});

test("quick booking keeps an existing grouped cart intact through fallback", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createBookingFixture();
  try {
    await signIn(page, fixture);
    await page.route(`**/api/salons/${fixture.salonId}/first-available`, (route) => mockFirstAvailable(route, fixture));
    await page.route(`**/api/salons/${fixture.salonId}/grouped-availability`, (route) => mockQuickAvailability(route, fixture));
    await page.goto(fixture.salonPath);
    await addServices(page, fixture);
    const widget = page.locator("#booking-widget");
    await expect(widget.locator('[data-testid^="booking-cart-item-"]')).toHaveCount(2);

    await page.getByTestId(`salon-service-${fixture.serviceIds[0]}`).getByRole("button", { name: "Brzo zakaži" }).click();
    const confirmation = widget.getByTestId("quick-book-confirmation");
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Izaberi drugi termin" }).click();
    await expect(widget.getByLabel("Korak 3: TERMIN")).toHaveAttribute("aria-current", "step");
    await widget.getByRole("button", { name: "Moja korpa" }).click();

    await expect(widget.getByRole("heading", { name: "Vaša korpa" })).toBeVisible();
    await expect(widget.locator('[data-testid^="booking-cart-item-"]')).toHaveCount(2);
    await expect(widget.getByTestId("booking-cart-item-0")).toContainText(fixture.serviceNames[0]);
    await expect(widget.getByTestId("booking-cart-item-1")).toContainText(fixture.serviceNames[1]);
  } finally {
    await cleanUpFixture(fixture);
  }
});

test("guest standard wizard never collapses a grouped booking into quick sign-in state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createBookingFixture();
  let bookingTreatments: Array<{ serviceId: string }> = [];
  try {
    await page.route(`**/api/salons/${fixture.salonId}/grouped-availability`, (route) => mockAvailability(route, fixture));
    await page.route("**/api/booking-groups", async (route) => {
      bookingTreatments = route.request().postDataJSON().treatments;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ code: "UNAUTHORIZED", error: "Prijava je obavezna." }),
      });
    });
    const widget = await openDesktopBooking(page, fixture);
    await reachAvailability(widget, fixture);
    await widget.getByTestId("booking-view-list").click();
    await widget.getByLabel(`Izaberi raspored ${candidatesFor(fixture)[0]!.date} u 09:00`).click();
    await widget.getByRole("button", { name: "Zakaži" }).click();

    await expect.poll(() => bookingTreatments.map((item) => item.serviceId)).toEqual(fixture.serviceIds);
    await expect(page).toHaveURL(fixture.salonPath);
    await expect(widget.getByTestId("quick-book-confirmation")).toHaveCount(0);
  } finally {
    await cleanUpFixture(fixture);
  }
});

test("standalone widget retains its supported guest grouped booking surface", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await createBookingFixture();
  try {
    await page.goto(`/widget/${fixture.salonPath.split("/").at(-1)}`);
    await page.getByText(fixture.serviceNames[0], { exact: true }).click();
    await expect(page.getByText("Izabrano usluga: 1")).toBeVisible();
    await page.getByRole("button", { name: "Nastavi (1)" }).click();
    await expect(page.getByRole("heading", { name: "Željeni zaposleni" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Bilo ko (prvi dostupan)" })).toBeAttached();
  } finally {
    await cleanUpFixture(fixture);
  }
});