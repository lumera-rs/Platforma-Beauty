/**
 * One-day campaign comparison — owner dashboard browser regression.
 *
 * The API boundary suite proves that adjacent midnights are classified into
 * separate windows. This spec guards the owner-facing wiring: selecting the
 * same calendar day twice must complete an inclusive one-day custom range,
 * request compare=previous, and keep the current and previous attribution and
 * delivery totals aligned in both stats surfaces.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page, type Response } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  appointmentsTable,
  automationDeliveriesTable,
  automationRulesTable,
  automationRunsTable,
  db,
  salonCustomersTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";

const scrypt = promisify(scryptCallback);
const PREVIOUS_MIDNIGHT = new Date("2026-04-06T00:00:00.000Z");
const CURRENT_MIDNIGHT = new Date("2026-04-07T00:00:00.000Z");
const NEXT_MIDNIGHT = new Date("2026-04-08T00:00:00.000Z");

test.use({ timezoneId: "UTC" });

type Fixture = {
  ownerEmail: string;
  ownerPassword: string;
  ownerId: string;
  salonId: string;
  ruleId: string;
  ruleName: string;
};

function toDateParam(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const ownerEmail = `browser-one-day-owner-${suffix}@example.test`;
  const ownerPassword = "browser-one-day-password";
  const ruleName = `Browser jednodnevna kampanja ${suffix}`;
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
    if (!owner) throw new Error("One-day comparison fixture could not create its owner.");
    ownerId = owner.id;

    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id,
      name: `Browser salon za jednodnevno poređenje ${suffix}`,
      slug: `browser-one-day-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 466",
      phone: "+38111000466",
      email: `browser-one-day-salon-${suffix}@example.test`,
      shortDescription: "Izolovan salon za proveru jednodnevnog poređenja kampanja.",
      description: "Salon je napravljen samo za browser regresioni test poređenja kampanja.",
      imageUrl: "/test-browser-one-day.jpg",
    }).returning({ id: salonsTable.id });
    if (!salon) throw new Error("One-day comparison fixture could not create its salon.");
    salonId = salon.id;

    await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));

    const [service] = await db.insert(servicesTable).values({
      salonId: salon.id,
      categoryName: "Test",
      name: `Browser jednodnevna usluga ${suffix}`,
      description: "Usluga za browser proveru jednodnevnog poređenja.",
      durationMinutes: 60,
      price: 1200,
      imageUrl: "/test-browser-one-day.jpg",
      active: true,
    }).returning({ id: servicesTable.id });
    if (!service) throw new Error("One-day comparison fixture could not create its service.");

    const [customer] = await db.insert(salonCustomersTable).values({
      salonId: salon.id,
      firstName: "Browser",
      lastName: "Klijent",
      email: `browser-one-day-customer-${suffix}@example.test`,
      smsOptOut: false,
    }).returning({ id: salonCustomersTable.id });
    if (!customer) throw new Error("One-day comparison fixture could not create its customer.");

    const [rule] = await db.insert(automationRulesTable).values({
      salonId: salon.id,
      name: ruleName,
      trigger: "inactive_days",
      triggerConfig: { inactiveDays: 30 },
      action: "send_email",
      emailSubject: "Test",
      emailBody: "Test",
      status: "active",
    }).returning({ id: automationRulesTable.id });
    if (!rule) throw new Error("One-day comparison fixture could not create its rule.");

    const events = [
      { tag: "previous-midnight", at: PREVIOUS_MIDNIGHT },
      { tag: "current-midnight", at: CURRENT_MIDNIGHT },
      { tag: "next-midnight", at: NEXT_MIDNIGHT },
    ];
    for (const event of events) {
      const [appointment] = await db.insert(appointmentsTable).values({
        salonId: salon.id,
        salonCustomerId: customer.id,
        serviceId: service.id,
        date: "2026-04-07",
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        status: "completed",
        price: 1200,
        treatmentLocation: "salon",
      }).returning({ id: appointmentsTable.id });
      if (!appointment) throw new Error(`One-day comparison fixture could not create ${event.tag} appointment.`);

      const [run] = await db.insert(automationRunsTable).values({
        eventKey: `browser-one-day-run-${suffix}-${event.tag}`,
        ruleId: rule.id,
        salonId: salon.id,
        salonCustomerId: customer.id,
        status: "sent",
        executedAt: event.at,
        sentAt: event.at,
        attributedAppointmentId: appointment.id,
      }).returning({ id: automationRunsTable.id });
      if (!run) throw new Error(`One-day comparison fixture could not create ${event.tag} run.`);

      await db.insert(automationDeliveriesTable).values({
        runId: run.id,
        salonId: salon.id,
        eventKey: `browser-one-day-delivery-${suffix}-${event.tag}`,
        channel: "email",
        recipientEmail: `browser-one-day-recipient-${suffix}@example.test`,
        status: "sent",
        sentAt: event.at,
        deliveredAt: event.at,
      });
    }

    return {
      ownerEmail,
      ownerPassword,
      ownerId: owner.id,
      salonId: salon.id,
      ruleId: rule.id,
      ruleName,
    };
  } catch (error) {
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpFixture(fixture: Fixture): Promise<void> {
  await db.update(usersTable).set({ activeSalonId: null }).where(eq(usersTable.id, fixture.ownerId));
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
}

async function signInAsFixtureOwner(page: Page, fixture: Fixture): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
  });
  expect(response, "The isolated salon owner fixture must be able to sign in.").toBeOK();
}

function nextStatsResponse(
  page: Page,
  path: string,
  fixture: Fixture,
): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname.endsWith(path)
      && url.searchParams.get("from") === toDateParam(CURRENT_MIDNIGHT)
      && url.searchParams.get("to") === toDateParam(CURRENT_MIDNIGHT)
      && url.searchParams.get("compare") === "previous"
      && !url.searchParams.has("period")
      && (path === "/growth/automation-stats" || url.pathname.endsWith(`/growth/automations/${fixture.ruleId}/stats`));
  });
}

test("same-day custom campaign comparison keeps current and previous totals separate", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-04-08T12:00:00.000Z") });
  const fixture = await createFixture();

  try {
    await signInAsFixtureOwner(page, fixture);
    await page.goto("/vlasnik/automatizacije");

    const overviewRow = page.getByTestId(`overview-row-${fixture.ruleId}`);
    await expect(overviewRow).toContainText("Poslato: 3");

    const selector = page.getByTestId("overview-period-selector");
    await selector.getByTestId("period-custom").click();
    const calendar = page.getByTestId("overview-period-selector-range-calendar");
    await expect(calendar).toBeVisible();

    const sameDay = calendar.locator(`button[data-day="${CURRENT_MIDNIGHT.toLocaleDateString()}"]`);
    await expect(sameDay).toHaveCount(1);
    await sameDay.click();
    await expect(page.getByTestId("overview-period-selector-range-status"))
      .toContainText("Početak perioda");
    await expect(calendar).toBeVisible();

    const overviewResponse = nextStatsResponse(page, "/growth/automation-stats", fixture);
    await sameDay.click();

    const overviewPayload = await overviewResponse;
    expect(overviewPayload.status()).toBe(200);
    const overviewItems = await overviewPayload.json() as Array<Record<string, any>>;
    const overviewItem = overviewItems.find((item) => item.ruleId === fixture.ruleId);
    expect(overviewItem).toMatchObject({
      totalRuns: 1,
      attributedAppointments: 1,
      emailSentCount: 1,
      emailDeliveredCount: 1,
      previous: {
        attributedAppointments: 1,
        emailDeliveredCount: 1,
      },
    });

    await expect(page).toHaveURL(
      `/vlasnik/automatizacije?from=${toDateParam(CURRENT_MIDNIGHT)}&to=${toDateParam(CURRENT_MIDNIGHT)}`,
    );
    await expect(selector.getByTestId("period-custom")).toHaveText(
      ` ${CURRENT_MIDNIGHT.toLocaleDateString("sr-RS")} – ${CURRENT_MIDNIGHT.toLocaleDateString("sr-RS")}`,
    );
    await expect(overviewRow.locator("td").nth(1)).toContainText("Poslato: 1");
    await expect(overviewRow.locator("td").nth(1)).toContainText("Isporučeno: 1");
    await expect(overviewRow.locator("td").nth(3)).toContainText("1");
    await expect(overviewRow.getByTestId(`trend-email-delivered-${fixture.ruleId}`)).toContainText("bez promene");
    await expect(overviewRow.getByTestId(`trend-appointments-${fixture.ruleId}`)).toContainText("bez promene");

    const detailResponse = nextStatsResponse(
      page,
      `/growth/automations/${fixture.ruleId}/stats`,
      fixture,
    );
    await overviewRow.getByRole("button", { name: fixture.ruleName }).click();
    const detailPayload = await detailResponse;
    expect(detailPayload.status()).toBe(200);
    expect(await detailPayload.json()).toMatchObject({
      totalRuns: 1,
      attributedAppointments: 1,
      emailSentCount: 1,
      emailDeliveredCount: 1,
      previous: {
        attributedAppointments: 1,
        emailDeliveredCount: 1,
      },
    });

    const dialog = page.getByRole("dialog", { name: "Statistika automatizacije" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Prihodovani termini").locator("..")).toContainText("1");
    await expect(dialog.getByTestId("funnel-email")).toContainText("Isporučeno: 1");
    await expect(dialog.getByTestId("stats-trend-appointments")).toContainText("bez promene");
    await expect(dialog.getByTestId("stats-trend-email-delivered")).toContainText("bez promene");
  } finally {
    await cleanUpFixture(fixture);
  }
});