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
  ownerEmail: string;
  ownerPassword: string;
  ownerId: string;
  salonId: string;
  salonPath: string;
};

type PendingBookingFixtureOptions = {
  instantBooking?: boolean;
  homeServiceAvailable?: boolean;
};

function longAvailabilitySlots() {
  return Array.from({ length: 84 }, (_, index) => {
    const startMinutes = 9 * 60 + index * 5;
    const endMinutes = startMinutes + 5;
    const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

    return {
      start: toTime(startMinutes),
      end: toTime(endMinutes),
      employeeId: "browser-scroll-fixture-employee",
      employeeName: "Browser Terapeut",
    };
  });
}

async function wheelToLowerContent(page: Page, scrollArea: Locator, minimumScrollTop: number) {
  let previousScrollTop = -1;
  let scrollTop = 0;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await scrollArea.hover();
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(20);
    scrollTop = await scrollArea.evaluate((node) => node.scrollTop);
    if (scrollTop === previousScrollTop) break;
    previousScrollTop = scrollTop;
  }

  expect(scrollTop).toBeGreaterThan(minimumScrollTop);
  return scrollTop;
}

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
  const ownerEmail = `browser-pending-booking-owner-${suffix}@example.test`;
  const ownerPassword = "browser-pending-booking-owner-password";
  const customerPhone = `+38161${suffix.replaceAll("-", "").slice(0, 8)}`;
  let customerId: string | undefined;
  let ownerId: string | undefined;
  let salonId: string | undefined;

  try {
    const [owner] = await db.insert(usersTable).values({
      firstName: "Browser",
      lastName: "Vlasnik",
      email: ownerEmail,
      passwordHash: await hashPassword(ownerPassword),
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
      active: true,
      isVerified: true,
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
      ownerEmail,
      ownerPassword,
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

async function signInAsFixtureOwner(page: Page, fixture: PendingBookingFixture) {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
  });
  expect(response, "The pending-booking fixture owner must be able to sign in.").toBeOK();
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
  const fixture = await createPendingBookingFixture({ instantBooking: true });
  let appointmentId: string | undefined;
  try {
    await signInAsFixtureCustomer(page, fixture);
    await page.goto(fixture.salonPath);

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

    appointmentId = await completeBooking(page, drawer);
  } finally {
    if (appointmentId) await cleanUpAppointment(page, appointmentId);
    await cleanUpPendingBookingFixture(fixture);
  }
});

test("mobile booking scrolls to a lower slot and resets after date and step changes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await createPendingBookingFixture({ instantBooking: true });

  try {
    await page.route("**/api/**/availability**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(longAvailabilitySlots()),
      });
    });
    await signInAsFixtureCustomer(page, fixture);
    await page.goto(fixture.salonPath);

    await page.getByRole("button", { name: "Zakaži", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Zakažite termin" });
    const service = drawer.locator('[role="button"]:has(h5)').first();
    await service.click();
    await drawer.getByRole("button", { name: /Bilo koji zaposleni/ }).click();
    await expect(drawer.getByRole("button", { name: "Korak 3: Termin" })).toHaveAttribute("aria-current", "step");

    const scrollArea = drawer.getByTestId("mobile-booking-scroll-area");
    await expect.poll(() => scrollArea.evaluate((node) => node.scrollHeight > node.clientHeight)).toBeTruthy();
    const deepScrollTop = await wheelToLowerContent(page, scrollArea, 500);

    const calendar = drawer.getByTestId("booking-calendar");
    const selectedDay = calendar.getByRole("gridcell", { selected: true });
    const otherDay = selectedDay.locator("xpath=following::button[not(@disabled)][1]");
    await otherDay.dispatchEvent("click");
    await expect.poll(() => scrollArea.evaluate((node) => node.scrollTop)).toBeLessThan(deepScrollTop);

    await wheelToLowerContent(page, scrollArea, 700);

    const lowerSlot = drawer.getByRole("button", { name: "Izaberi termin u 15:30" });
    await expect.poll(() => lowerSlot.evaluate((node) => {
      const slot = node.getBoundingClientRect();
      const container = document.querySelector<HTMLElement>('[data-testid="mobile-booking-scroll-area"]')?.getBoundingClientRect();
      return Boolean(container && slot.top >= container.top && slot.bottom <= container.bottom);
    })).toBeTruthy();
    await lowerSlot.click();
    await expect(drawer.getByRole("button", { name: "Korak 4: Potvrda" })).toHaveAttribute("aria-current", "step");

    await drawer.getByRole("button", { name: "Nazad" }).click();
    await expect(drawer.getByRole("button", { name: "Korak 3: Termin" })).toHaveAttribute("aria-current", "step");
    await expect.poll(() => scrollArea.evaluate((node) => node.scrollTop)).toBeLessThan(2);
  } finally {
    await cleanUpPendingBookingFixture(fixture);
  }
});

test("public booking widget scrolls to a lower slot before contact details", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await createPendingBookingFixture({ instantBooking: true });

  try {
    await page.route("**/api/**/availability**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(longAvailabilitySlots()),
      });
    });
    await page.goto(`/widget/${fixture.salonPath.split("/").at(-1)}`);

    await page.locator('[data-testid^="service-select-"]').first().click();
    await page.getByTestId("employee-select-any").click();
    await expect(page.getByRole("heading", { name: "Kada želite termin?" })).toBeVisible();

    const scrollArea = page.locator('[data-testid="widget-booking-scroll-area"] [data-radix-scroll-area-viewport]');
    await expect.poll(() => scrollArea.evaluate((node) => node.scrollHeight > node.clientHeight)).toBeTruthy();
    await wheelToLowerContent(page, scrollArea, 400);

    await page.getByTestId("slot-15:30").click();
    await expect(page.getByRole("heading", { name: "Vaši podaci" })).toBeVisible();

    await page.getByRole("button", { name: "Nazad" }).click();
    await expect(page.getByRole("heading", { name: "Kada želite termin?" })).toBeVisible();
    await expect.poll(() => scrollArea.evaluate((node) => node.scrollTop)).toBeLessThan(2);
  } finally {
    await cleanUpPendingBookingFixture(fixture);
  }
});

test("customer can complete the desktop salon booking journey", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createPendingBookingFixture({ instantBooking: true });
  let appointmentId: string | undefined;
  try {
    await signInAsFixtureCustomer(page, fixture);
    await page.goto(fixture.salonPath);

    const widget = page.locator("#booking-widget");
    await expect(widget).toBeVisible();
    appointmentId = await completeBooking(page, widget);
  } finally {
    if (appointmentId) await cleanUpAppointment(page, appointmentId);
    await cleanUpPendingBookingFixture(fixture);
  }
});

test("a booking conflict returns the customer to refreshed available slots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createPendingBookingFixture({ instantBooking: true });
  try {
    await signInAsFixtureCustomer(page, fixture);
    await page.goto(fixture.salonPath);

    const widget = page.locator("#booking-widget");
    await expect(widget).toBeVisible();
    await reachBookingConfirmation(page, widget);

    await page.route("**/api/appointments", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Termin više nije slobodan. Osvežite dostupnost i izaberite drugi termin.",
        }),
      });
    });

    const refreshedAvailability = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return request.method() === "GET" && url.pathname.includes("/availability");
    });
    await widget.getByRole("button", { name: "Potvrdi rezervaciju" }).click();

    await expect(page.getByText("Osvežili smo slobodne termine. Izaberite drugi termin.")).toBeVisible();
    await expect(widget.getByRole("button", { name: "Korak 3: Termin" })).toHaveAttribute("aria-current", "step");
    await expect(widget.getByText("Pregled rezervacije")).toHaveCount(0);
    await expect(widget.getByRole("button", { name: "Dalje" })).toBeDisabled();
    await refreshedAvailability;

    const refreshedSlot = widget.getByRole("button", { name: /Izaberi termin u/ }).first();
    await expect(refreshedSlot).toBeVisible();
    await refreshedSlot.click();
    await expect(widget.getByRole("button", { name: "Korak 4: Potvrda" })).toHaveAttribute("aria-current", "step");
  } finally {
    await cleanUpPendingBookingFixture(fixture);
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
  const fixture = await createPendingBookingFixture();

  try {
    await signInAsFixtureOwner(page, fixture);
    await page.goto(fixture.salonPath);

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
  } finally {
    await cleanUpPendingBookingFixture(fixture);
  }
});

test("returning to a booking draft preserves the any-employee choice", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await createPendingBookingFixture();

  try {
    await signInAsFixtureCustomer(page, fixture);
    await page.goto(fixture.salonPath);

    const widget = page.locator("#booking-widget");
    const service = widget.locator('[role="button"]:has(h5)').first();
    const anyEmployeeAvailabilityRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return request.method() === "GET"
        && url.pathname.includes("/availability")
        && !url.searchParams.has("employeeId");
    });
    await service.click();
    await expect(widget.getByRole("button", { name: "Korak 2: Zaposleni" })).toHaveAttribute("aria-current", "step");
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
  } finally {
    await cleanUpPendingBookingFixture(fixture);
  }
});