/**
 * Campaign cancellation warning browser regression.
 *
 * The warning is intentionally derived from both realized and cancelled
 * attributed appointments. This fixture keeps period-sensitive boundary cases
 * next to each other so the overview cannot accidentally retain a warning from
 * another period, flag every row with cancellations, or lose the icon/amber
 * treatment when the analytics shape changes.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  appointmentsTable,
  automationRulesTable,
  automationRunsTable,
  db,
  salonCustomersTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";

const scrypt = promisify(scryptCallback);
const DAY_MS = 24 * 60 * 60 * 1000;
test.use({ timezoneId: "UTC" });

type Fixture = {
  ownerEmail: string;
  ownerPassword: string;
  ownerId: string;
  salonId: string;
  flaggedRuleId: string;
  flaggedRuleName: string;
  recentFlaggedRuleId: string;
  recentFlaggedRuleName: string;
  lowVolumeRuleId: string;
  lowVolumeRuleName: string;
  customBoundaryRuleId: string;
  customBoundaryRuleName: string;
  customRangeFrom: string;
  customRangeTo: string;
  browserNow: Date;
};

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const browserNow = new Date();
  const ownerEmail = `browser-cancellation-warning-owner-${suffix}@example.test`;
  const ownerPassword = "browser-cancellation-warning-password";
  const flaggedRuleName = `Browser 2 realna 1 otkazana ${suffix}`;
  const recentFlaggedRuleName = `Browser 4 realna 1 otkazana ${suffix}`;
  const lowVolumeRuleName = `Browser manje od 3 termina ${suffix}`;
  const customBoundaryRuleName = `Browser granica prilagođenog perioda ${suffix}`;
  const customRangeFrom = new Date(browserNow.getTime() - 7 * DAY_MS);
  const customRangeTo = new Date(browserNow.getTime() - 5 * DAY_MS);
  const dateDaysAgo = (days: number) =>
    new Date(browserNow.getTime() - days * DAY_MS).toISOString().slice(0, 10);
  let ownerId: string | undefined;
  let salonId: string | undefined;

  try {
    const [owner] = await db
      .insert(usersTable)
      .values({
        firstName: "Browser",
        lastName: "Vlasnik",
        email: ownerEmail,
        passwordHash: await hashPassword(ownerPassword),
        passwordSetAt: new Date(),
        role: "SALON_OWNER",
      })
      .returning({ id: usersTable.id });
    if (!owner) {
      throw new Error("Cancellation-warning browser fixture could not create its owner.");
    }
    ownerId = owner.id;

    const [salon] = await db
      .insert(salonsTable)
      .values({
        ownerId: owner.id,
        name: `Browser salon za otkazivanja ${suffix}`,
        slug: `browser-cancellation-warning-${suffix}`,
        city: "Beograd",
        municipality: "Vračar",
        address: "Test 95",
        phone: "+381110000095",
        email: `browser-cancellation-warning-salon-${suffix}@example.test`,
        shortDescription: "Izolovan salon za proveru upozorenja otkazanih termina.",
        description: "Salon je napravljen samo za browser regresioni test upozorenja kampanja.",
        imageUrl: "/test-browser-cancellation-warning.jpg",
      })
      .returning({ id: salonsTable.id });
    if (!salon) {
      throw new Error("Cancellation-warning browser fixture could not create its salon.");
    }
    salonId = salon.id;

    await db
      .update(usersTable)
      .set({ activeSalonId: salon.id })
      .where(eq(usersTable.id, owner.id));

    const [service] = await db
      .insert(servicesTable)
      .values({
        salonId: salon.id,
        categoryName: "Test",
        name: `Browser usluga za kampanje ${suffix}`,
        description: "Usluga za browser proveru upozorenja otkazanih termina.",
        durationMinutes: 60,
        price: 2500,
        imageUrl: "/test-browser-cancellation-warning.jpg",
        active: true,
      })
      .returning({ id: servicesTable.id });
    if (!service) {
      throw new Error("Cancellation-warning browser fixture could not create its service.");
    }

    const [customer] = await db
      .insert(salonCustomersTable)
      .values({
        salonId: salon.id,
        firstName: "Browser",
        lastName: "Klijent",
        email: `browser-cancellation-warning-customer-${suffix}@example.test`,
        smsOptOut: false,
      })
      .returning({ id: salonCustomersTable.id });
    if (!customer) {
      throw new Error("Cancellation-warning browser fixture could not create its customer.");
    }

    const rules = await db
      .insert(automationRulesTable)
      .values([
        {
          salonId: salon.id,
          name: flaggedRuleName,
          trigger: "inactive_days",
          triggerConfig: { inactiveDays: 30 },
          action: "send_email",
          emailSubject: "Test",
          emailBody: "Test",
          status: "active",
        },
        {
          salonId: salon.id,
          name: recentFlaggedRuleName,
          trigger: "inactive_days",
          triggerConfig: { inactiveDays: 30 },
          action: "send_email",
          emailSubject: "Test",
          emailBody: "Test",
          status: "active",
        },
        {
          salonId: salon.id,
          name: lowVolumeRuleName,
          trigger: "inactive_days",
          triggerConfig: { inactiveDays: 30 },
          action: "send_email",
          emailSubject: "Test",
          emailBody: "Test",
          status: "active",
        },
        {
          salonId: salon.id,
          name: customBoundaryRuleName,
          trigger: "inactive_days",
          triggerConfig: { inactiveDays: 30 },
          action: "send_email",
          emailSubject: "Test",
          emailBody: "Test",
          status: "active",
        },
      ])
      .returning({ id: automationRulesTable.id, name: automationRulesTable.name });
    if (rules.length !== 4) {
      throw new Error("Cancellation-warning browser fixture could not create all campaign rules.");
    }

    const ruleByName = new Map(rules.map((rule) => [rule.name, rule.id]));
    const flaggedRuleId = ruleByName.get(flaggedRuleName);
    const recentFlaggedRuleId = ruleByName.get(recentFlaggedRuleName);
    const lowVolumeRuleId = ruleByName.get(lowVolumeRuleName);
    const customBoundaryRuleId = ruleByName.get(customBoundaryRuleName);
    if (!flaggedRuleId || !recentFlaggedRuleId || !lowVolumeRuleId || !customBoundaryRuleId) {
      throw new Error("Cancellation-warning browser fixture returned incomplete campaign rules.");
    }

    const cases = [
      {
        ruleId: flaggedRuleId,
        entries: [
          { daysAgo: 5, cancelled: false },
          { daysAgo: 5, cancelled: false },
          { daysAgo: 60, cancelled: true },
        ],
      },
      {
        ruleId: recentFlaggedRuleId,
        entries: [
          { daysAgo: 3, cancelled: false },
          { daysAgo: 3, cancelled: false },
          { daysAgo: 3, cancelled: true },
          { daysAgo: 60, cancelled: false },
          { daysAgo: 60, cancelled: false },
        ],
      },
      {
        ruleId: lowVolumeRuleId,
        entries: [
          { daysAgo: 5, cancelled: false },
          { daysAgo: 5, cancelled: true },
        ],
      },
      {
        ruleId: customBoundaryRuleId,
        entries: [
          // Both the start and inclusive end dates belong to the custom
          // window: one realized appointment starts the volume, while the
          // cancellation on the end date must still be counted.
          { daysAgo: 7, cancelled: false },
          { daysAgo: 5, cancelled: false },
          { daysAgo: 5, cancelled: true },
          // These two rows sit immediately outside the selected window and
          // must not change its warning ratio.
          { daysAgo: 8, cancelled: true },
          { daysAgo: 4, cancelled: false },
        ],
      },
    ];
    const appointmentRows = cases.flatMap(({ entries }) =>
      entries.map((entry) => ({
        id: randomUUID(),
        daysAgo: entry.daysAgo,
        cancelled: entry.cancelled,
      })),
    );
    await db.insert(appointmentsTable).values(
      appointmentRows.map((appointment, index) => ({
        id: appointment.id,
        salonId: salon.id,
        salonCustomerId: customer.id,
        serviceId: service.id,
        date: dateDaysAgo(appointment.daysAgo),
        startTime: `${String(9 + index).padStart(2, "0")}:00`,
        endTime: `${String(10 + index).padStart(2, "0")}:00`,
        durationMinutes: 60,
        status: appointment.cancelled ? ("cancelled" as const) : ("completed" as const),
        price: 2500,
        treatmentLocation: "salon",
      })),
    );

    let appointmentOffset = 0;
    await db.insert(automationRunsTable).values(
      cases.flatMap(({ ruleId, entries }) => {
        const ruleAppointments = appointmentRows.slice(
          appointmentOffset,
          appointmentOffset + entries.length,
        );
        appointmentOffset += entries.length;
        return ruleAppointments.map((appointment, index) => ({
          eventKey: `browser-cancellation-warning-${suffix}-${ruleId}-${index}`,
          ruleId,
          salonId: salon.id,
          salonCustomerId: customer.id,
          status: "sent" as const,
          attributedAppointmentId: appointment.id,
          executedAt: new Date(browserNow.getTime() - appointment.daysAgo * DAY_MS),
          sentAt: new Date(browserNow.getTime() - appointment.daysAgo * DAY_MS),
        }));
      }),
    );

    return {
      ownerEmail,
      ownerPassword,
      ownerId: owner.id,
      salonId: salon.id,
      flaggedRuleId,
      flaggedRuleName,
      recentFlaggedRuleId,
      recentFlaggedRuleName,
      lowVolumeRuleId,
      lowVolumeRuleName,
      customBoundaryRuleId,
      customBoundaryRuleName,
      customRangeFrom: customRangeFrom.toISOString().slice(0, 10),
      customRangeTo: customRangeTo.toISOString().slice(0, 10),
      browserNow,
    };
  } catch (error) {
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpFixture(fixture: Fixture): Promise<void> {
  // Salon deletion cascades its rules, runs, appointments, and customer.
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
}

async function signInAsFixtureOwner(page: Page, fixture: Fixture): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
  });
  expect(response, "The isolated cancellation-warning owner must be able to sign in.").toBeOK();
}

function nextOverviewStatsResponse(page: Page, period: string | null) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/growth/automation-stats")
      && (period === null
        ? url.searchParams.get("period") === "all" || !url.searchParams.has("period")
        : url.searchParams.get("period") === period);
  });
}

function nextCustomOverviewStatsResponse(page: Page, from: string, to: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/growth/automation-stats")
      && url.searchParams.get("from") === from
      && url.searchParams.get("to") === to
      && !url.searchParams.has("period");
  });
}

test("campaign cancellation warnings follow the selected overview period", async ({ page }) => {
  const fixture = await createFixture();

  try {
    await page.clock.install({ time: fixture.browserNow });
    await signInAsFixtureOwner(page, fixture);
    await page.goto("/vlasnik/automatizacije");

    const flaggedRow = page.getByTestId(`overview-row-${fixture.flaggedRuleId}`);
    const recentFlaggedRow = page.getByTestId(`overview-row-${fixture.recentFlaggedRuleId}`);
    const lowVolumeRow = page.getByTestId(`overview-row-${fixture.lowVolumeRuleId}`);
    const customBoundaryRow = page.getByTestId(`overview-row-${fixture.customBoundaryRuleId}`);
    await expect(flaggedRow).toContainText(fixture.flaggedRuleName);
    await expect(recentFlaggedRow).toContainText(fixture.recentFlaggedRuleName);
    await expect(lowVolumeRow).toContainText(fixture.lowVolumeRuleName);
    await expect(customBoundaryRow).toContainText(fixture.customBoundaryRuleName);

    const flaggedWarning = page.getByTestId(`overview-cancellation-flag-${fixture.flaggedRuleId}`);
    const recentFlaggedWarning = page.getByTestId(`overview-cancellation-flag-${fixture.recentFlaggedRuleId}`);
    const lowVolumeWarning = page.getByTestId(`overview-cancellation-flag-${fixture.lowVolumeRuleId}`);
    const customBoundaryWarning = page.getByTestId(`overview-cancellation-flag-${fixture.customBoundaryRuleId}`);
    await expect(flaggedWarning).toHaveCount(1);
    await expect(recentFlaggedWarning).toHaveCount(0);
    await expect(lowVolumeWarning).toHaveCount(0);
    await expect(customBoundaryWarning).toHaveCount(1);
    await expect(flaggedRow).toHaveClass(/bg-amber-50\/70/);
    await expect(recentFlaggedRow).not.toHaveClass(/bg-amber-50\/70/);
    await expect(lowVolumeRow).not.toHaveClass(/bg-amber-50\/70/);
    await expect(customBoundaryRow).toHaveClass(/bg-amber-50\/70/);

    // The all-time row has two recent realized appointments and one old
    // cancellation, so its Serbian warning must describe exactly 1 of 3.
    await flaggedWarning.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toHaveCount(1);
    await expect(tooltip).toContainText("33%");
    await expect(tooltip).toContainText("1 od 3");

    // In the 30-day window, the first row loses its old cancellation and must
    // clear both the icon and amber treatment. The second row has exactly two
    // realized appointments and one cancellation in this window, so it must
    // become the only flagged row. The third row remains below the minimum
    // volume despite having one cancellation.
    const thirtyDayResponse = nextOverviewStatsResponse(page, "30d");
    await page.getByTestId("overview-period-selector").getByTestId("period-30d").click();
    expect((await thirtyDayResponse).status()).toBe(200);
    await expect(page.getByTestId("overview-period-selector").getByTestId("period-30d")).toHaveAttribute("aria-pressed", "true");
    await expect(flaggedWarning).toHaveCount(0);
    await expect(recentFlaggedWarning).toHaveCount(1);
    await expect(lowVolumeWarning).toHaveCount(0);
    await expect(flaggedRow).not.toHaveClass(/bg-amber-50\/70/);
    await expect(recentFlaggedRow).toHaveClass(/bg-amber-50\/70/);
    await expect(lowVolumeRow).not.toHaveClass(/bg-amber-50\/70/);

    await recentFlaggedWarning.hover();
    await expect(tooltip).toHaveCount(1);
    await expect(tooltip).toContainText("33%");
    await expect(tooltip).toContainText("1 od 3");

    // Returning to all time restores the original warning state rather than
    // leaving the period-scoped second-row warning in the overview.
    const allTimeResponse = nextOverviewStatsResponse(page, null);
    await page.getByTestId("overview-period-selector").getByTestId("period-all").click();
    expect((await allTimeResponse).status()).toBe(200);
    await expect(page.getByTestId("overview-period-selector").getByTestId("period-all")).toHaveAttribute("aria-pressed", "true");
    await expect(flaggedWarning).toHaveCount(1);
    await expect(recentFlaggedWarning).toHaveCount(0);
    await expect(lowVolumeWarning).toHaveCount(0);
    await expect(customBoundaryWarning).toHaveCount(1);
    await expect(flaggedRow).toHaveClass(/bg-amber-50\/70/);
    await expect(recentFlaggedRow).not.toHaveClass(/bg-amber-50\/70/);
    await expect(lowVolumeRow).not.toHaveClass(/bg-amber-50\/70/);

    // The custom window contains the realized appointment on its start date,
    // the realized appointment and cancellation on its inclusive end date,
    // and excludes one cancellation immediately before and one realized
    // appointment immediately after it.
    const selector = page.getByTestId("overview-period-selector");
    await selector.getByTestId("period-custom").click();
    const calendar = page.getByTestId("overview-period-selector-range-calendar");
    await expect(calendar).toBeVisible();

    const fromDate = new Date(`${fixture.customRangeFrom}T12:00:00.000Z`);
    const toDate = new Date(`${fixture.customRangeTo}T12:00:00.000Z`);
    const fromDay = calendar.getByRole("gridcell").locator("button").filter({ hasText: new RegExp(`^${fromDate.getUTCDate()}$`) });
    const toDay = calendar.getByRole("gridcell").locator("button").filter({ hasText: new RegExp(`^${toDate.getUTCDate()}$`) });
    await expect(fromDay).toHaveCount(1);
    await expect(toDay).toHaveCount(1);
    await fromDay.click();
    const customResponse = nextCustomOverviewStatsResponse(
      page,
      fixture.customRangeFrom,
      fixture.customRangeTo,
    );
    await toDay.click();

    expect((await customResponse).status()).toBe(200);
    await expect(selector.getByTestId("period-custom")).toHaveAttribute("aria-pressed", "true");
    await expect(customBoundaryWarning).toHaveCount(1);
    await expect(customBoundaryRow).toHaveClass(/bg-amber-50\/70/);
    await expect(customBoundaryWarning).toHaveAttribute(
      "aria-label",
      expect.stringContaining("33%"),
    );
    await expect(customBoundaryWarning).toHaveAttribute(
      "aria-label",
      expect.stringContaining("1 od 3"),
    );

    // The other campaigns remain period-scoped as well: the old cancellation
    // for the first row is outside this exact range, while the recent row's
    // three appointments are on a different day.
    await expect(flaggedWarning).toHaveCount(0);
    await expect(recentFlaggedWarning).toHaveCount(0);
    await expect(lowVolumeWarning).toHaveCount(0);
    await expect(flaggedRow).not.toHaveClass(/bg-amber-50\/70/);
    await expect(recentFlaggedRow).not.toHaveClass(/bg-amber-50\/70/);
    await expect(lowVolumeRow).not.toHaveClass(/bg-amber-50\/70/);

    await customBoundaryWarning.hover();
    await expect(page.getByRole("tooltip")).toContainText("33%");
    await expect(page.getByRole("tooltip")).toContainText("1 od 3");
  } finally {
    await cleanUpFixture(fixture);
  }
});