/**
 * Campaign cancellation warning browser regression.
 *
 * The warning is intentionally derived from both realized and cancelled
 * attributed appointments. This fixture keeps the three boundary cases next
 * to each other so the overview cannot accidentally flag every row with
 * cancellations, or lose the icon/amber treatment when the analytics shape
 * changes.
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

type Fixture = {
  ownerEmail: string;
  ownerPassword: string;
  ownerId: string;
  salonId: string;
  flaggedRuleId: string;
  flaggedRuleName: string;
  noCancellationRuleId: string;
  noCancellationRuleName: string;
  lowVolumeRuleId: string;
  lowVolumeRuleName: string;
};

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const ownerEmail = `browser-cancellation-warning-owner-${suffix}@example.test`;
  const ownerPassword = "browser-cancellation-warning-password";
  const flaggedRuleName = `Browser 2 realna 1 otkazana ${suffix}`;
  const noCancellationRuleName = `Browser 3 realna 0 otkazanih ${suffix}`;
  const lowVolumeRuleName = `Browser manje od 3 termina ${suffix}`;
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
          name: noCancellationRuleName,
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
      ])
      .returning({ id: automationRulesTable.id, name: automationRulesTable.name });
    if (rules.length !== 3) {
      throw new Error("Cancellation-warning browser fixture could not create all campaign rules.");
    }

    const ruleByName = new Map(rules.map((rule) => [rule.name, rule.id]));
    const flaggedRuleId = ruleByName.get(flaggedRuleName);
    const noCancellationRuleId = ruleByName.get(noCancellationRuleName);
    const lowVolumeRuleId = ruleByName.get(lowVolumeRuleName);
    if (!flaggedRuleId || !noCancellationRuleId || !lowVolumeRuleId) {
      throw new Error("Cancellation-warning browser fixture returned incomplete campaign rules.");
    }

    const cases = [
      { ruleId: flaggedRuleId, count: 3, cancelledIndexes: new Set([2]) },
      { ruleId: noCancellationRuleId, count: 3, cancelledIndexes: new Set<number>() },
      { ruleId: lowVolumeRuleId, count: 2, cancelledIndexes: new Set<number>() },
    ];
    const appointmentRows = cases.flatMap(({ count, cancelledIndexes }) =>
      Array.from({ length: count }, (_, index) => ({
        id: randomUUID(),
        cancelled: cancelledIndexes.has(index),
      })),
    );
    await db.insert(appointmentsTable).values(
      appointmentRows.map((appointment, index) => ({
        id: appointment.id,
        salonId: salon.id,
        salonCustomerId: customer.id,
        serviceId: service.id,
        date: "2026-08-20",
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
      cases.flatMap(({ ruleId, count }) => {
        const ruleAppointments = appointmentRows.slice(
          appointmentOffset,
          appointmentOffset + count,
        );
        appointmentOffset += count;
        return ruleAppointments.map((appointment, index) => ({
          eventKey: `browser-cancellation-warning-${suffix}-${ruleId}-${index}`,
          ruleId,
          salonId: salon.id,
          salonCustomerId: customer.id,
          status: "sent" as const,
          attributedAppointmentId: appointment.id,
          executedAt: new Date("2026-08-19T12:00:00.000Z"),
          sentAt: new Date("2026-08-19T12:00:00.000Z"),
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
      noCancellationRuleId,
      noCancellationRuleName,
      lowVolumeRuleId,
      lowVolumeRuleName,
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

test("only one-in-three campaign cancellations show the synchronized warning", async ({ page }) => {
  const fixture = await createFixture();

  try {
    await signInAsFixtureOwner(page, fixture);
    await page.goto("/vlasnik/automatizacije");

    const flaggedRow = page.getByTestId(`overview-row-${fixture.flaggedRuleId}`);
    const noCancellationRow = page.getByTestId(`overview-row-${fixture.noCancellationRuleId}`);
    const lowVolumeRow = page.getByTestId(`overview-row-${fixture.lowVolumeRuleId}`);
    await expect(flaggedRow).toContainText(fixture.flaggedRuleName);
    await expect(noCancellationRow).toContainText(fixture.noCancellationRuleName);
    await expect(lowVolumeRow).toContainText(fixture.lowVolumeRuleName);

    const flag = page.getByTestId(`overview-cancellation-flag-${fixture.flaggedRuleId}`);
    await expect(flag).toHaveCount(1);
    await expect(flaggedRow).toHaveClass(/bg-amber-50\/70/);
    await expect(noCancellationRow.getByTestId(`overview-cancellation-flag-${fixture.noCancellationRuleId}`)).toHaveCount(0);
    await expect(lowVolumeRow.getByTestId(`overview-cancellation-flag-${fixture.lowVolumeRuleId}`)).toHaveCount(0);
    await expect(noCancellationRow).not.toHaveClass(/bg-amber-50\/70/);
    await expect(lowVolumeRow).not.toHaveClass(/bg-amber-50\/70/);

    // Radix exposes the same single tooltip for pointer hover and keyboard
    // focus. Check both paths because the warning must remain accessible.
    await flag.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toHaveCount(1);
    await expect(tooltip).toContainText("33%");
    await expect(tooltip).toContainText("1 od 3");

    // Focus the same trigger as a keyboard user would. The pointer tooltip
    // may remain open while the pointer is over the trigger, but focus must
    // not create a second tooltip.
    await flag.focus();
    await expect(flag).toBeFocused();
    await expect(tooltip).toHaveCount(1);
    await expect(tooltip).toContainText("33%");
    await expect(tooltip).toContainText("1 od 3");
  } finally {
    await cleanUpFixture(fixture);
  }
});