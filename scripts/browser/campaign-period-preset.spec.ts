/**
 * Campaign overview date shortcut — browser regression.
 *
 * The date arithmetic for the shortcuts is covered by
 * artifacts/beauty-marketplace/src/lib/date-range-presets.test.ts. This spec
 * guards the wiring that unit tests cannot see: opening the custom-range
 * popover, clicking a shortcut, closing the popover, rendering the selected
 * range, and requesting the stats endpoint with the inclusive dates.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  automationDeliveriesTable,
  automationRulesTable,
  automationRunsTable,
  db,
  salonCustomersTable,
  salonsTable,
  usersTable,
} from "@workspace/db";

const scrypt = promisify(scryptCallback);
const FROZEN_NOW = new Date("2026-08-23T12:00:00.000Z");
const LAST_MONTH_FROM = new Date("2026-07-01T12:00:00.000Z");
const LAST_MONTH_TO = new Date("2026-07-31T12:00:00.000Z");
const BEFORE_LAST_MONTH = new Date("2026-06-30T12:00:00.000Z");

// The browser clock is intentionally fixed before the app renders. That makes
// the shortcut date math and fixture windows stable at every month boundary.
test.use({ timezoneId: "UTC" });

type Fixture = {
  ownerEmail: string;
  ownerPassword: string;
  ownerId: string;
  salonId: string;
  ruleId: string;
  ruleName: string;
};

/** Local calendar date → YYYY-MM-DD, matching the app's serialization. */
function toDateParam(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

/**
 * One delivery predates the selected shortcut window, while three fall inside
 * it. The initial all-time overview must show four sends and, after choosing
 * "Prošli mesec", must visibly drop to the three window-matching sends.
 */
async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const ownerEmail = `browser-period-preset-owner-${suffix}@example.test`;
  const ownerPassword = "browser-period-preset-password";
  const ruleName = `Browser preset kampanja ${suffix}`;
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
    if (!owner)
      throw new Error(
        "Period-preset browser fixture could not create its owner.",
      );
    ownerId = owner.id;

    const [salon] = await db
      .insert(salonsTable)
      .values({
        ownerId: owner.id,
        name: `Browser salon za preset ${suffix}`,
        slug: `browser-period-preset-${suffix}`,
        city: "Beograd",
        municipality: "Vračar",
        address: "Test 94",
        phone: "+381110000094",
        email: `browser-period-preset-salon-${suffix}@example.test`,
        shortDescription: "Izolovan salon za proveru prečica perioda kampanja.",
        description:
          "Salon je napravljen samo za browser regresioni test prečica perioda kampanja.",
        imageUrl: "/test-browser-period-preset.jpg",
      })
      .returning({ id: salonsTable.id });
    if (!salon)
      throw new Error(
        "Period-preset browser fixture could not create its salon.",
      );
    salonId = salon.id;

    await db
      .update(usersTable)
      .set({ activeSalonId: salon.id })
      .where(eq(usersTable.id, owner.id));

    const [rule] = await db
      .insert(automationRulesTable)
      .values({
        salonId: salon.id,
        name: ruleName,
        trigger: "inactive_days",
        triggerConfig: { inactiveDays: 30 },
        action: "send_email",
        emailSubject: "Test",
        emailBody: "Test",
        status: "active",
      })
      .returning({ id: automationRulesTable.id });
    if (!rule)
      throw new Error(
        "Period-preset browser fixture could not create its rule.",
      );

    const [customer] = await db
      .insert(salonCustomersTable)
      .values({
        salonId: salon.id,
        firstName: "Browser",
        lastName: "Klijent",
        email: `browser-period-preset-customer-${suffix}@example.test`,
        smsOptOut: false,
      })
      .returning({ id: salonCustomersTable.id });
    if (!customer)
      throw new Error(
        "Period-preset browser fixture could not create its customer.",
      );

    const sentAt = [
      BEFORE_LAST_MONTH,
      LAST_MONTH_FROM,
      new Date("2026-07-15T12:00:00.000Z"),
      LAST_MONTH_TO,
    ];
    const runs = await db
      .insert(automationRunsTable)
      .values(
        sentAt.map((timestamp, index) => ({
          eventKey: `browser-period-preset-run-${suffix}-${index}`,
          ruleId: rule.id,
          salonId: salon.id,
          salonCustomerId: customer.id,
          status: "sent" as const,
          executedAt: timestamp,
          sentAt: timestamp,
        })),
      )
      .returning({ id: automationRunsTable.id });
    if (runs.length !== sentAt.length)
      throw new Error(
        "Period-preset browser fixture could not create all campaign runs.",
      );

    await db.insert(automationDeliveriesTable).values(
      runs.map((run, index) => ({
        runId: run.id,
        salonId: salon.id,
        eventKey: `browser-period-preset-delivery-${suffix}-${index}`,
        channel: "email",
        recipientEmail: `browser-period-preset-customer-${suffix}@example.test`,
        status: "sent",
        sentAt: sentAt[index],
        deliveredAt: sentAt[index],
      })),
    );

    return {
      ownerEmail,
      ownerPassword,
      ownerId: owner.id,
      salonId: salon.id,
      ruleId: rule.id,
      ruleName,
    };
  } catch (error) {
    if (salonId)
      await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpFixture(fixture: Fixture): Promise<void> {
  // Salon delete cascades the automation rule.
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
}

async function signInAsFixtureOwner(
  page: Page,
  fixture: Fixture,
): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
  });
  expect(
    response,
    "The isolated salon owner fixture must be able to sign in.",
  ).toBeOK();
}

test("clicking a date shortcut closes the picker and refetches inclusive stats dates", async ({
  page,
}) => {
  const fixture = await createFixture();

  try {
    await page.clock.install({ time: FROZEN_NOW });
    await signInAsFixtureOwner(page, fixture);
    await page.goto("/vlasnik/automatizacije");

    const selector = page.getByTestId("overview-period-selector");
    await expect(selector).toBeVisible();
    const overviewRow = page.getByTestId(`overview-row-${fixture.ruleId}`);
    await expect(
      overviewRow,
      "The all-time overview must render every fixture delivery before filtering.",
    ).toContainText("Poslato: 4");

    // Clicking the custom-period trigger opens the popover and puts the page
    // into custom mode without changing the last complete stats request.
    await selector.getByTestId("period-custom").click();
    const presets = page.getByTestId("overview-range-presets");
    await expect(presets).toBeVisible();

    // The frozen browser date makes the shortcut's inclusive last-month
    // endpoints deterministic and matches the fixture's three current sends.
    const expectedFrom = LAST_MONTH_FROM;
    const expectedTo = LAST_MONTH_TO;
    const fromParam = toDateParam(expectedFrom);
    const toParam = toDateParam(expectedTo);

    const statsResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        url.pathname.endsWith("/growth/automation-stats") &&
        url.searchParams.get("from") === fromParam &&
        url.searchParams.get("to") === toParam &&
        !url.searchParams.has("period")
      );
    });

    await presets.getByTestId("range-preset-last-month").click();

    const response = await statsResponse;
    expect(response.status()).toBe(200);
    await expect(
      overviewRow,
      "The visible campaign overview must replace all-time counts with the selected range.",
    ).toContainText("Poslato: 3");
    await expect(overviewRow).not.toContainText("Poslato: 4");

    // The shortcut is an atomic choice: the popover closes and the trigger
    // shows the exact same inclusive endpoints sent to the stats endpoint.
    await expect(presets).toBeHidden();
    const customButton = selector.getByTestId("period-custom");
    await expect(customButton).toHaveAttribute("aria-pressed", "true");
    await expect(customButton).toHaveText(
      ` ${expectedFrom.toLocaleDateString("sr-RS")} – ${expectedTo.toLocaleDateString("sr-RS")}`,
    );
  } finally {
    await cleanUpFixture(fixture);
  }
});
