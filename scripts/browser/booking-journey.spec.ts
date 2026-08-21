import { expect, test, type Locator, type Page } from "@playwright/test";

const customer = {
  email: process.env.LUMERA_BOOKING_TEST_EMAIL ?? "kupac@lumera.local",
  password: process.env.LUMERA_BOOKING_TEST_PASSWORD ?? "LumeraDemo2026!",
};
const salonPath = process.env.LUMERA_BOOKING_TEST_SALON_PATH ?? "/saloni/lotos-rituals";

async function signInAsCustomer(page: Page) {
  const response = await page.request.post("/api/auth/login", { data: customer });
  expect(response, "The browser test account must be able to sign in.").toBeOK();
}

async function cleanUpAppointment(page: Page, appointmentId: string) {
  const cancellation = await page.request.post(`/api/appointments/${appointmentId}/cancel`);
  expect(cancellation, "The booking fixture must be cancellable during cleanup.").toBeOK();

  const dashboard = await page.request.get("/api/customer/dashboard");
  expect(dashboard, "The customer dashboard must be available after cleanup.").toBeOK();
  const data = await dashboard.json() as { upcoming: Array<{ id: string }> };
  expect(data.upcoming.some((appointment) => appointment.id === appointmentId)).toBeFalsy();
}

async function completeBooking(page: Page, widget: Locator) {
  const service = widget.locator('[role="button"]:has(h5)').first();
  await expect(service).toBeVisible();
  const serviceName = (await service.locator("h5").innerText()).trim();
  await service.click();

  await expect(widget.getByRole("button", { name: "Korak 2: Zaposleni" })).toHaveAttribute("aria-current", "step");
  await widget.getByRole("button", { name: /Bilo koji zaposleni/ }).click();

  await expect(widget.getByRole("button", { name: "Korak 3: Termin" })).toHaveAttribute("aria-current", "step");
  const firstSlot = widget.getByRole("button", { name: /Izaberi termin u/ }).first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.click();

  await expect(widget.getByRole("button", { name: "Korak 4: Potvrda" })).toHaveAttribute("aria-current", "step");
  await expect(widget.getByText("Pregled rezervacije")).toBeVisible();

  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/appointments",
  );
  await widget.getByRole("button", { name: "Potvrdi rezervaciju" }).click();
  const response = await responsePromise;
  expect(response.status(), "Booking confirmation must create an appointment.").toBe(201);
  const appointment = await response.json() as { id: string };
  expect(appointment.id).toBeTruthy();

  await expect(widget.getByRole("heading", { name: "Termin potvrđen" })).toBeVisible();
  await expect(widget.getByText("Vidimo se u salonu!")).toBeVisible();
  await expect(widget.getByText(serviceName, { exact: true })).toBeVisible();

  return appointment.id;
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