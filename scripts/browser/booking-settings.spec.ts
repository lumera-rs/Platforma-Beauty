import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, salonBookingSettingsTable, salonsTable, usersTable } from "@workspace/db";

const scrypt = promisify(scryptCallback);

type BookingSettingsFixture = {
  ownerEmail: string;
  ownerPassword: string;
  ownerId: string;
  salonId: string;
};

const closedDate = "2027-01-01";
const customHoursDate = "2027-01-02";

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function createBookingSettingsFixture(): Promise<BookingSettingsFixture> {
  const suffix = randomUUID();
  const ownerEmail = `browser-booking-settings-owner-${suffix}@example.test`;
  const ownerPassword = "browser-booking-settings-password";
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
    }).returning({ id: usersTable.id });
    if (!owner) throw new Error("Booking-settings browser fixture could not create its owner.");
    ownerId = owner.id;

    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id,
      name: `Browser salon za podešavanja ${suffix}`,
      slug: `browser-booking-settings-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 590",
      phone: "+381110000590",
      email: `browser-booking-settings-salon-${suffix}@example.test`,
      shortDescription: "Izolovan salon za proveru podešavanja rezervacija.",
      description: "Salon je napravljen samo za browser regresioni test podešavanja rezervacija.",
      imageUrl: "/test-browser-booking-settings.jpg",
      homeService: false,
    }).returning({ id: salonsTable.id });
    if (!salon) throw new Error("Booking-settings browser fixture could not create its salon.");
    salonId = salon.id;

    await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));
    return { ownerEmail, ownerPassword, ownerId: owner.id, salonId: salon.id };
  } catch (error) {
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpBookingSettingsFixture(fixture: BookingSettingsFixture): Promise<void> {
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
}

async function signInAsFixtureOwner(page: Page, fixture: BookingSettingsFixture): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
  });
  expect(response, "The isolated salon owner fixture must be able to sign in.").toBeOK();
}

function bookingSettingsPayload() {
  return {
    slotGranularityMinutes: 15,
    minimumLeadTimeMinutes: 60,
    cancellationDeadlineMinutes: 2880,
    reminderOffsetsMinutes: [120, 720],
    reminderChannels: ["sms", "email", "push"],
    maxVisitGapMinutes: 60,
    minimumUsefulLateTreatmentMinutes: 15,
    dateHours: [
      { date: closedDate, closed: true, openTime: null, closeTime: null, reason: "Nova godina" },
      { date: customHoursDate, closed: false, openTime: "10:00", closeTime: "14:00", reason: "Praznično radno vreme" },
    ],
    resourceDowntime: [],
  };
}

test("owner booking settings accept only supported policies and persist calendar exceptions", async ({ page }) => {
  const fixture = await createBookingSettingsFixture();

  try {
    await signInAsFixtureOwner(page, fixture);

    await db.insert(salonBookingSettingsTable).values({
      salonId: fixture.salonId,
      cancellationDeadlineMinutes: 60,
      reminderOffsetsMinutes: [60, 120],
      reminderChannels: [],
    });
    const defaultsResponse = await page.request.get("/api/salon/booking-settings");
    expect(defaultsResponse, "A signed-in owner can load normalized booking settings.").toBeOK();
    await expect(defaultsResponse.json()).resolves.toMatchObject({
      salonId: fixture.salonId,
      slotGranularityMinutes: 15,
      minimumLeadTimeMinutes: 0,
      cancellationDeadlineMinutes: 1440,
      reminderOffsetsMinutes: [120],
      reminderChannels: [],
      maxVisitGapMinutes: 0,
      minimumUsefulLateTreatmentMinutes: 0,
      dateHours: [],
      resourceDowntime: [],
    });

    const unsupportedCancellation = await page.request.put("/api/salon/booking-settings", {
      data: { ...bookingSettingsPayload(), cancellationDeadlineMinutes: 60 },
    });
    expect(unsupportedCancellation.status(), "Unsupported cancellation policies must be rejected.").toBe(400);

    const unsupportedReminder = await page.request.put("/api/salon/booking-settings", {
      data: { ...bookingSettingsPayload(), reminderOffsetsMinutes: [60] },
    });
    expect(unsupportedReminder.status(), "Unsupported reminder policies must be rejected.").toBe(400);

    const saveResponse = await page.request.put("/api/salon/booking-settings", { data: bookingSettingsPayload() });
    expect(saveResponse, "The supported booking-settings policy must save.").toBeOK();

    const persistedResponse = await page.request.get("/api/salon/booking-settings");
    expect(persistedResponse).toBeOK();
    await expect(persistedResponse.json()).resolves.toMatchObject({
      cancellationDeadlineMinutes: 2880,
      reminderOffsetsMinutes: [120, 720],
      reminderChannels: ["sms", "email", "push"],
      dateHours: [
        { date: expect.stringContaining(closedDate), closed: true, openTime: null, closeTime: null, reason: "Nova godina" },
        { date: expect.stringContaining(customHoursDate), closed: false, openTime: "10:00", closeTime: "14:00", reason: "Praznično radno vreme" },
      ],
    });

    const dateWarnings: string[] = [];
    page.on("console", message => {
      if (message.type() === "warning" && /yyyy-MM-dd/i.test(message.text())) dateWarnings.push(message.text());
    });

    await page.goto("/vlasnik/kalendar");
    await page.getByRole("button", { name: "Podešavanja rezervacija" }).click();
    const dialog = page.getByRole("dialog", { name: "Podešavanja rezervacija" });
    await expect(dialog).toBeVisible();

    const cancellationOptions = dialog.locator('[data-testid="select-cancellation-deadline"] option');
    await expect(cancellationOptions).toHaveCount(3);
    await expect(cancellationOptions).toHaveText(["12 sati", "24 sata", "48 sati"]);
    await expect(dialog.getByTestId("select-cancellation-deadline")).toHaveValue("2880");

    for (const offset of [120, 720, 1440]) {
      const checkbox = dialog.getByTestId(`checkbox-reminder-offset-${offset}`);
      await expect(checkbox).toBeVisible();
      await expect(checkbox).toHaveAttribute("data-state", offset === 1440 ? "unchecked" : "checked");
    }
    for (const channel of ["sms", "email", "push"]) {
      await expect(dialog.getByTestId(`checkbox-reminder-channel-${channel}`)).toHaveAttribute("data-state", "checked");
    }

    await expect(dialog.getByTestId("input-date-override-0")).toHaveValue(closedDate);
    await expect(dialog.getByTestId("radio-date-closed-0")).toBeChecked();
    await expect(dialog.getByTestId("input-date-reason-0")).toHaveValue("Nova godina");
    await expect(dialog.getByTestId("input-date-override-1")).toHaveValue(customHoursDate);
    await expect(dialog.getByTestId("radio-date-custom-hours-1")).toBeChecked();
    await expect(dialog.getByTestId("input-date-open-1")).toHaveValue("10:00");
    await expect(dialog.getByTestId("input-date-close-1")).toHaveValue("14:00");
    await expect(dialog.getByTestId("input-date-reason-1")).toHaveValue("Praznično radno vreme");

    await page.reload();
    await page.getByRole("button", { name: "Podešavanja rezervacija" }).click();
    await expect(dialog).toBeVisible();
    expect(dateWarnings, "Reloading persisted date overrides must not assign invalid date input values.").toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth, "The mobile booking-settings dialog must not create horizontal page overflow.")
      .toBeLessThanOrEqual(dimensions.clientWidth);
  } finally {
    await cleanUpBookingSettingsFixture(fixture);
  }
});