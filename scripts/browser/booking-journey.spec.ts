import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, employeeServicesTable, employeesTable, salonsTable, servicesTable, usersTable } from "@workspace/db";

const scrypt = promisify(scryptCallback);

const customer = {
  email: process.env.LUMERA_BOOKING_TEST_EMAIL ?? "kupac@lumera.local",
  password: process.env.LUMERA_BOOKING_TEST_PASSWORD ?? "LumeraDemo2026!",
};
const salonOwner = {
  email: process.env.LUMERA_OWNER_TEST_EMAIL ?? "salon@lumera.local",
  password: process.env.LUMERA_OWNER_TEST_PASSWORD ?? "LumeraDemo2026!",
};
const salonPath = process.env.LUMERA_BOOKING_TEST_SALON_PATH ?? "/saloni/lotos-rituals";

type PendingBookingFixture = {
  customerEmail: string;
  customerPassword: string;
  customerId: string;
  ownerId: string;
  salonId: string;
  salonPath: string;
};

type PendingBookingFixtureOptions = {
  instantBooking?: boolean;
  homeServiceAvailable?: boolean;
};

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function createPendingBookingFixture({
  instantBooking = false,
  homeServiceAvailable = false,
}: PendingBookingFixtureOptions = {}): Promise<PendingBookingFixture> {
  const suffix = randomUUID();
  const customerEmail = `browser-pending-booking-customer-${suffix}@example.test`;
  const customerPassword = "browser-pending-booking-customer-password";
  const customerPhone = `+38161${suffix.replaceAll("-", "").slice(0, 8)}`;
  let customerId: string | undefined;
  let ownerId: string | undefined;
  let salonId: string | undefined;

  try {
    const [owner] = await db.insert(usersTable).values({
      firstName: "Browser",
      lastName: "Vlasnik",
      email: `browser-pending-booking-owner-${suffix}@example.test`,
      passwordHash: await hashPassword("browser-pending-booking-owner-password"),
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    }).returning();
    if (!owner) throw new Error("Pending-booking browser fixture could not create its salon owner.");
    ownerId = owner.id;

    const [customerUser] = await db.insert(usersTable).values({
      firstName: "Browser",
      lastName: "Kupac",
      email: customerEmail,
      phone: customerPhone,
      phoneNormalized: customerPhone,
      passwordHash: await hashPassword(customerPassword),
      passwordSetAt: new Date(),
      role: "CUSTOMER",
    }).returning();
    if (!customerUser) throw new Error("Pending-booking browser fixture could not create its customer.");
    customerId = customerUser.id;

    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id,
      name: `Browser salon bez instant potvrde ${suffix}`,
      slug: `browser-pending-booking-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 83",
      phone: "+381110000083",
      email: `browser-pending-booking-salon-${suffix}@example.test`,
      shortDescription: "Izolovan salon za proveru zahteva za termin.",
      description: "Salon je napravljen samo za browser regresioni test zahteva za termin.",
      imageUrl: "/test-browser-pending-booking.jpg",
      instantBooking,
      homeService: homeServiceAvailable,
    }).returning();
    if (!salon) throw new Error("Pending-booking browser fixture could not create its salon.");
    salonId = salon.id;

    const [employee] = await db.insert(employeesTable).values({
      salonId: salon.id,
      name: "Browser Terapeut",
      role: "Terapeut",
      bio: "Zaposleni za browser proveru rezervacije.",
      avatarUrl: "/test-browser-pending-booking.jpg",
    }).returning();
    if (!employee) throw new Error("Pending-booking browser fixture could not create its employee.");

    const [service] = await db.insert(servicesTable).values({
      salonId: salon.id,
      categoryName: "Test",
      name: "Browser tretman sa potvrdom",
      description: "Usluga za browser proveru zahteva koji salon mora da potvrdi.",
      durationMinutes: 60,
      price: 1000,
      imageUrl: "/test-browser-pending-booking.jpg",
      homeServiceAvailable,
      homeServiceFee: homeServiceAvailable ? 300 : 0,
    }).returning();
    if (!service) throw new Error("Pending-booking browser fixture could not create its service.");

    await db.insert(employeeServicesTable).values({ employeeId: employee.id, serviceId: service.id });

    return {
      customerEmail,
      customerPassword,
      customerId: customerUser.id,
      ownerId: owner.id,
      salonId: salon.id,
      salonPath: `/saloni/${salon.slug}`,
    };
  } catch (error) {
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (customerId) await db.delete(usersTable).where(eq(usersTable.id, customerId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpPendingBookingFixture(fixture: PendingBookingFixture) {
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.customerId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
}

async function signInAsCustomer(page: Page) {
  const response = await page.request.post("/api/auth/login", { data: customer });
  expect(response, "The browser test account must be able to sign in.").toBeOK();
}

async function signInAsFixtureCustomer(page: Page, fixture: PendingBookingFixture) {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.customerEmail, password: fixture.customerPassword },
  });
  expect(response, "The pending-booking fixture customer must be able to sign in.").toBeOK();
}

async function signInAsSalonOwner(page: Page) {
  const response = await page.request.post("/api/auth/login", { data: salonOwner });
  expect(response, "The non-customer browser test account must be able to sign in.").toBeOK();
}

async function cleanUpAppointment(page: Page, appointmentId: string) {
  const cancellation = await page.request.post(`/api/appointments/${appointmentId}/cancel`);
  expect(cancellation, "The booking fixture must be cancellable during cleanup.").toBeOK();

  const dashboard = await page.request.get("/api/customer/dashboard");
  expect(dashboard, "The customer dashboard must be available after cleanup.").toBeOK();
  const data = await dashboard.json() as { upcoming: Array<{ id: string }> };
  expect(data.upcoming.some((appointment) => appointment.id === appointmentId)).toBeFalsy();
}

async function reachBookingConfirmation(page: Page, widget: Locator) {
  const service = widget.locator('[role="button"]:has(h5)').first();
  await expect(service).toBeVisible();
  const anyEmployeeAvailabilityRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === "GET"
      && url.pathname.includes("/availability")
      && !url.searchParams.has("employeeId");
  });
  const serviceName = (await service.locator("h5").innerText()).trim();
  await service.click();

  await expect(widget.getByRole("button", { name: "Korak 2: Zaposleni" })).toHaveAttribute("aria-current", "step");
  await widget.getByRole("button", { name: /Bilo koji zaposleni/ }).click();
  await anyEmployeeAvailabilityRequest;

  await expect(widget.getByRole("button", { name: "Korak 3: Termin" })).toHaveAttribute("aria-current", "step");
  const firstSlot = widget.getByRole("button", { name: /Izaberi termin u/ }).first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.click();

  await expect(widget.getByRole("button", { name: "Korak 4: Potvrda" })).toHaveAttribute("aria-current", "step");
  await expect(widget.getByText("Pregled rezervacije")).toBeVisible();
  await expect(widget.getByText("Bilo koji zaposleni", { exact: true }).first()).toBeVisible();
  await expect(widget.getByText("Sistem bira slobodnog člana tima.")).toBeVisible();

  return serviceName;
}

async function completeBooking(page: Page, widget: Locator, expectedStatus: "confirmed" | "pending" = "confirmed") {
  const serviceName = await reachBookingConfirmation(page, widget);
  const bookingRequestPromise = page.waitForRequest((request) =>
    request.method() === "POST"
    && new URL(request.url()).pathname === "/api/appointments",
  );
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/appointments",
  );
  await widget.getByRole("button", { name: "Potvrdi rezervaciju" }).click();
  const bookingRequest = await bookingRequestPromise;
  expect(bookingRequest.postDataJSON()).not.toHaveProperty("employeeId");
  const response = await responsePromise;
  expect(response.status(), "Booking confirmation must create an appointment.").toBe(201);
  const appointment = await response.json() as { id: string; status: "confirmed" | "pending" };
  expect(appointment.id).toBeTruthy();
  expect(appointment.status, "The appointment status must match the salon's confirmation policy.").toBe(expectedStatus);

  const successCopy = expectedStatus === "confirmed"
    ? { heading: "Termin potvrđen", detail: "Vidimo se u salonu!" }
    : { heading: "Zahtev za termin je poslat", detail: "Salon će uskoro potvrditi vaš termin." };
  await expect(widget.getByRole("heading", { name: successCopy.heading })).toBeVisible();
  await expect(widget.getByText(successCopy.detail)).toBeVisible();
  if (expectedStatus === "pending") {
    await expect(widget.getByText("Termin potvrđen", { exact: true })).toHaveCount(0);
  }
  await expect(widget.getByText(serviceName, { exact: true })).toBeVisible();

  return appointment.id;
}

async function completeHomeVisitBooking(page: Page, widget: Locator) {
  const serviceName = await reachBookingConfirmation(page, widget);
  await widget.getByRole("button", { name: "Potvrdi rezervaciju" }).click();

  const locationDialog = page.getByRole("dialog", { name: "Gde želite tretman?" });
  await expect(locationDialog).toBeVisible();
  await locationDialog.getByRole("button", { name: "Na mojoj adresi" }).click();
  await locationDialog.locator("#home-address").fill("Test adresa 84");
  await locationDialog.locator("#home-city").fill("Beograd");

  const bookingRequestPromise = page.waitForRequest((request) =>
    request.method() === "POST"
    && new URL(request.url()).pathname === "/api/appointments",
  );
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/appointments",
  );
  await locationDialog.getByRole("button", { name: "Pošalji zahtev za dolazak" }).click();

  const bookingRequest = await bookingRequestPromise;
  expect(bookingRequest.postDataJSON()).toMatchObject({
    treatmentLocation: "home",
    treatmentAddress: { line1: "Test adresa 84", city: "Beograd" },
  });
  expect(bookingRequest.postDataJSON()).not.toHaveProperty("employeeId");

  const response = await responsePromise;
  expect(response.status(), "A home-visit request must create an appointment.").toBe(201);
  const appointment = await response.json() as { id: string; status: "confirmed" | "pending" };
  expect(appointment.id).toBeTruthy();
  expect(appointment.status, "Home-visit bookings must remain pending even for instant-booking salons.").toBe("pending");

  await expect(widget.getByRole("heading", { name: "Zahtev za termin je poslat" })).toBeVisible();
  await expect(widget.getByText("Salon će uskoro potvrditi vaš termin.")).toBeVisible();
  await expect(widget.getByText("Termin potvrđen", { exact: true })).toHaveCount(0);
  await expect(widget.getByText(serviceName, { exact: true })).toBeVisible();

  return appointment.id;
}

async function reachBookingConfirmationAsNonCustomer(page: Page, widget: Locator) {
  const service = widget.locator('[role="button"]:has(h5)').first();
  await expect(service).toBeVisible();
  await service.click();

  await expect(widget.getByRole("button", { name: "Korak 2: Zaposleni" })).toHaveAttribute("aria-current", "step");
  await widget.getByRole("button", { name: /Bilo koji zaposleni/ }).click();

  await expect(widget.getByRole("button", { name: "Korak 3: Termin" })).toHaveAttribute("aria-current", "step");
  const firstSlot = widget.getByRole("button", { name: /Izaberi termin u/ }).first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.click();

  await expect(widget.getByRole("button", { name: "Korak 4: Potvrda" })).toHaveAttribute("aria-current", "step");
  await expect(widget.getByText("Pregled rezervacije")).toBeVisible();
}

test("customer can book from the mobile sticky trigger and the drawer remains accessible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsCustomer(page);
  await page.goto(salonPath);

  const stickyTrigger = page.getByRole("button", { name: "Zakaži", exact: true });
  await expect(stickyTrigger).toBeVisible();
  await stickyTrigger.click();

  const drawer = page.getByRole("dialog");
  await expect(drawer).toHaveAccessibleName("Zakažite termin");
  await expect(drawer).toHaveAccessibleDescription("Izaberite uslugu, zaposlenog i slobodan termin.");
  await expect(drawer.getByRole("button", { name: "Korak 1: Usluga" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Korak 2: Zaposleni" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Korak 3: Termin" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Korak 4: Potvrda" })).toBeVisible();

  let appointmentId: string | undefined;
  try {
    appointmentId = await completeBooking(page, drawer);
  } finally {
    if (appointmentId) await cleanUpAppointment(page, appointmentId);
  }
});

test("customer can complete the desktop salon booking journey", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInAsCustomer(page);
  await page.goto(salonPath);

  const widget = page.locator("#booking-widget");
  await expect(widget).toBeVisible();

  let appointmentId: string | undefined;
  try {
    appointmentId = await completeBooking(page, widget);
  } finally {
    if (appointmentId) await cleanUpAppointment(page, appointmentId);
  }
});

test("customer sees a sent request when the salon must approve an in-salon booking", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createPendingBookingFixture();
  let appointmentId: string | undefined;

  try {
    await signInAsFixtureCustomer(page, fixture);
    await page.goto(fixture.salonPath);

    const widget = page.locator("#booking-widget");
    await expect(widget).toBeVisible();
    appointmentId = await completeBooking(page, widget, "pending");
  } finally {
    try {
      if (appointmentId) await cleanUpAppointment(page, appointmentId);
    } finally {
      await cleanUpPendingBookingFixture(fixture);
    }
  }
});

test("customer sees a sent request for a home visit even when the salon instantly books in-salon appointments", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createPendingBookingFixture({ instantBooking: true, homeServiceAvailable: true });
  let appointmentId: string | undefined;

  try {
    await signInAsFixtureCustomer(page, fixture);
    await page.goto(fixture.salonPath);

    const widget = page.locator("#booking-widget");
    await expect(widget).toBeVisible();
    appointmentId = await completeHomeVisitBooking(page, widget);
  } finally {
    try {
      if (appointmentId) await cleanUpAppointment(page, appointmentId);
    } finally {
      await cleanUpPendingBookingFixture(fixture);
    }
  }
});

test("customer sees a sent request for a home visit from the mobile booking drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await createPendingBookingFixture({ instantBooking: true, homeServiceAvailable: true });
  let appointmentId: string | undefined;

  try {
    await signInAsFixtureCustomer(page, fixture);
    await page.goto(fixture.salonPath);

    const stickyTrigger = page.getByRole("button", { name: "Zakaži", exact: true });
    await expect(stickyTrigger).toBeVisible();
    await stickyTrigger.click();

    const drawer = page.getByRole("dialog", { name: "Zakažite termin" });
    await expect(drawer).toBeVisible();
    appointmentId = await completeHomeVisitBooking(page, drawer);
  } finally {
    try {
      if (appointmentId) await cleanUpAppointment(page, appointmentId);
    } finally {
      await cleanUpPendingBookingFixture(fixture);
    }
  }
});

test("a non-customer is guided to use a client account before an appointment request", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInAsSalonOwner(page);
  await page.goto(salonPath);

  const widget = page.locator("#booking-widget");
  await expect(widget).toBeVisible();
  await reachBookingConfirmationAsNonCustomer(page, widget);

  let appointmentPostCount = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/appointments") {
      appointmentPostCount += 1;
    }
  });

  await widget.getByRole("button", { name: "Potvrdi rezervaciju" }).click();
  await expect(page.getByText("Za zakazivanje termina prijavite se klijentskim nalogom.")).toBeVisible();
  await page.waitForTimeout(250);
  expect(appointmentPostCount, "A non-customer must be stopped before the appointment API is called.").toBe(0);
});

test("returning to a booking draft preserves the any-employee choice", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInAsCustomer(page);
  await page.goto(salonPath);

  const widget = page.locator("#booking-widget");
  const service = widget.locator('[role="button"]:has(h5)').first();
  await service.click();
  await expect(widget.getByRole("button", { name: "Korak 2: Zaposleni" })).toHaveAttribute("aria-current", "step");
  const anyEmployeeAvailabilityRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === "GET"
      && url.pathname.includes("/availability")
      && !url.searchParams.has("employeeId");
  });
  await widget.getByRole("button", { name: /Bilo koji zaposleni/ }).click();
  await anyEmployeeAvailabilityRequest;

  const reentryAvailabilityRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === "GET"
      && url.pathname.includes("/availability")
      && !url.searchParams.has("employeeId");
  });
  await page.reload();
  await reentryAvailabilityRequest;

  await expect(widget.getByRole("button", { name: "Korak 3: Termin" })).toHaveAttribute("aria-current", "step");
  await expect(widget.getByText("Bilo koji zaposleni", { exact: true }).first()).toBeVisible();
});