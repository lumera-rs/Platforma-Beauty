/**
 * Campaign stats dialog — Svi / Novi / Vraćeni client-type filter browser regression.
 *
 * The server-side clientType filter (total + rows always agree, same SQL
 * derivation as the per-row badge) is covered by
 * artifacts/api-server/src/lib/attributed-appointments-returning.test.ts.
 * This spec guards the browser side: the attributed-appointments list
 * accumulates pages via "Učitaj još", and switching the client-type segment
 * must reset that accumulation. A regression there would silently keep rows
 * from the previous segment mixed into the filtered list.
 *
 * Fixture: one rule with 60 attributed appointments (30 new + 30 returning
 * clients, alternating by appointment date) so BOTH segments overflow the
 * 25-row page:
 *  1. Open the stats dialog → 25 rows, counter "25 od 60"; load a second
 *     page → 50 rows, counter "50 od 60", with both badge kinds visible.
 *  2. Switch to "Novi" → exactly 25 rows, every badge "Nov klijent", zero
 *     "Vraćen klijent" badges, counter "25 od 30".
 *  3. Switch to "Vraćeni" → exactly 25 rows, every badge "Vraćen klijent",
 *     zero "Nov klijent" badges, counter "25 od 30".
 *  4. Switch back to "Svi" → counter restores the unfiltered "25 od 60".
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

/** Mirrors ATTRIBUTED_PAGE_SIZE in owner/automations.tsx and the API default limit. */
const PAGE_SIZE = 25;
/** Per segment; each segment alone overflows one page so its counter is visible. */
const SEGMENT_SIZE = 30;
const TOTAL = SEGMENT_SIZE * 2;

/** The campaign send moment every run anchors on (isReturning compares prior visits to this). */
const SENT_AT = new Date("2026-03-01T10:00:00Z");
/** Completed visit strictly before SENT_AT → makes a customer "returning". */
const PRIOR_VISIT_DATE = "2026-01-15";

type Fixture = {
  ownerEmail: string;
  ownerPassword: string;
  ownerId: string;
  salonId: string;
  ruleId: string;
  ruleName: string;
};

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

/** Attributed-appointment date for index i: unique days after SENT_AT (2026-03-02 + i). */
function attributedDate(index: number): string {
  const day = new Date(Date.UTC(2026, 2, 2));
  day.setUTCDate(day.getUTCDate() + index);
  return day.toISOString().slice(0, 10);
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const ownerEmail = `browser-client-filter-owner-${suffix}@example.test`;
  const ownerPassword = "browser-client-filter-password";
  const ruleName = `Browser filter kampanja ${suffix}`;
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
    if (!owner) throw new Error("Client-filter browser fixture could not create its owner.");
    ownerId = owner.id;

    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id,
      name: `Browser salon za filter ${suffix}`,
      slug: `browser-client-filter-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 92",
      phone: "+381110000092",
      email: `browser-client-filter-salon-${suffix}@example.test`,
      shortDescription: "Izolovan salon za proveru filtera tipa klijenta.",
      description: "Salon je napravljen samo za browser regresioni test filtera Svi/Novi/Vraćeni.",
      imageUrl: "/test-browser-client-filter.jpg",
    }).returning({ id: salonsTable.id });
    if (!salon) throw new Error("Client-filter browser fixture could not create its salon.");
    salonId = salon.id;

    await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));

    const [service] = await db.insert(servicesTable).values({
      salonId: salon.id,
      categoryName: "Test",
      name: `Browser filter usluga ${suffix}`,
      description: "Usluga za browser proveru filtera tipa klijenta.",
      durationMinutes: 60,
      price: 2000,
      imageUrl: "/test-browser-client-filter.jpg",
      active: true,
    }).returning({ id: servicesTable.id });
    if (!service) throw new Error("Client-filter browser fixture could not create its service.");

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
    if (!rule) throw new Error("Client-filter browser fixture could not create its rule.");

    // Ids are generated client-side so segment membership never depends on
    // the order RETURNING happens to yield rows in.
    // Even index → new client, odd index → returning client, so appointment
    // dates alternate segments and every unfiltered page mixes both kinds.
    const entries = Array.from({ length: TOTAL }, (_, index) => ({
      index,
      isReturning: index % 2 === 1,
      customerId: randomUUID(),
      appointmentId: randomUUID(),
    }));

    await db.insert(salonCustomersTable).values(entries.map((entry) => ({
      id: entry.customerId,
      salonId: salon.id,
      firstName: "Klijent",
      lastName: `${entry.isReturning ? "Vraceni" : "Novi"} ${entry.index}`,
      email: `browser-client-filter-cust-${entry.index}-${suffix}@example.test`,
      smsOptOut: false,
    })));

    // Prior completed visit strictly before SENT_AT for the returning half.
    await db.insert(appointmentsTable).values(entries.filter((entry) => entry.isReturning).map((entry) => ({
      salonId: salon.id,
      salonCustomerId: entry.customerId,
      serviceId: service.id,
      date: PRIOR_VISIT_DATE,
      startTime: "09:00",
      endTime: "10:00",
      durationMinutes: 60,
      status: "completed" as const,
      price: 2000,
      treatmentLocation: "salon",
    })));

    // The attributed appointments themselves (realized status, after the send).
    await db.insert(appointmentsTable).values(entries.map((entry) => ({
      id: entry.appointmentId,
      salonId: salon.id,
      salonCustomerId: entry.customerId,
      serviceId: service.id,
      date: attributedDate(entry.index),
      startTime: "10:00",
      endTime: "11:00",
      durationMinutes: 60,
      status: "confirmed" as const,
      price: 2000,
      treatmentLocation: "salon",
    })));

    await db.insert(automationRunsTable).values(entries.map((entry) => ({
      eventKey: `browser-client-filter-${suffix}-${entry.index}`,
      ruleId: rule.id,
      salonId: salon.id,
      salonCustomerId: entry.customerId,
      status: "sent" as const,
      executedAt: SENT_AT,
      sentAt: SENT_AT,
      attributedAppointmentId: entry.appointmentId,
    })));

    return { ownerEmail, ownerPassword, ownerId: owner.id, salonId: salon.id, ruleId: rule.id, ruleName };
  } catch (error) {
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpFixture(fixture: Fixture): Promise<void> {
  // Salon delete cascades customers, services, appointments, the rule and its runs.
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
}

async function signInAsFixtureOwner(page: Page, fixture: Fixture): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
  });
  expect(response, "The isolated salon owner fixture must be able to sign in.").toBeOK();
}

/**
 * Resolves with the next attributed-appointments page-1 response for the
 * given segment, registered BEFORE the click that triggers it so earlier
 * responses can't satisfy it.
 */
function nextFirstPageResponse(page: Page, ruleId: string, clientType: "new" | "returning" | null) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith(`/growth/automations/${ruleId}/attributed-appointments`)
      && url.searchParams.get("clientType") === clientType
      && url.searchParams.get("offset") === "0";
  });
}

test("switching the client-type filter never shows mixed or stale attributed rows", async ({ page }) => {
  const fixture = await createFixture();

  try {
    await signInAsFixtureOwner(page, fixture);
    await page.goto("/vlasnik/automatizacije");

    // Open the stats dialog from the campaign overview row for this rule.
    await page.getByTestId(`overview-row-${fixture.ruleId}`)
      .getByRole("button", { name: fixture.ruleName })
      .click();
    const dialog = page.getByRole("dialog", { name: "Statistika automatizacije" });
    await expect(dialog).toBeVisible();

    const rows = dialog.locator('[data-testid="attributed-appointments-list"] > div');
    const badges = dialog.locator('[data-testid^="attributed-appointment-client-type-"]');
    const newBadges = badges.filter({ hasText: "Nov klijent" });
    const returningBadges = badges.filter({ hasText: "Vraćen klijent" });
    const loadMore = dialog.getByTestId("button-load-more-attributed");

    // Page 1 of "Svi": full page, unfiltered counter, both segments present.
    await expect(rows).toHaveCount(PAGE_SIZE);
    await expect(loadMore).toContainText(`Učitaj još (${PAGE_SIZE} od ${TOTAL})`);
    expect(await newBadges.count(), "Unfiltered page 1 must contain new-client rows.").toBeGreaterThan(0);
    expect(await returningBadges.count(), "Unfiltered page 1 must contain returning-client rows.").toBeGreaterThan(0);

    // Accumulate a second page.
    await loadMore.click();
    await expect(rows).toHaveCount(PAGE_SIZE * 2);
    await expect(loadMore).toContainText(`Učitaj još (${PAGE_SIZE * 2} od ${TOTAL})`);
    expect(await newBadges.count(), "Accumulated pages must contain new-client rows.").toBeGreaterThan(0);
    expect(await returningBadges.count(), "Accumulated pages must contain returning-client rows.").toBeGreaterThan(0);

    // Switch to "Novi": the 50 accumulated rows must collapse to one fresh
    // page where every badge is "Nov klijent" and the counter uses the
    // filtered total.
    const newResponse = nextFirstPageResponse(page, fixture.ruleId, "new");
    await dialog.getByTestId("client-type-new").click();
    expect((await newResponse).status()).toBe(200);
    await expect(rows).toHaveCount(PAGE_SIZE);
    await expect(newBadges).toHaveCount(PAGE_SIZE);
    await expect(returningBadges).toHaveCount(0);
    await expect(loadMore).toContainText(`Učitaj još (${PAGE_SIZE} od ${SEGMENT_SIZE})`);

    // Switch to "Vraćeni": same shape, opposite badge on every row.
    const returningResponse = nextFirstPageResponse(page, fixture.ruleId, "returning");
    await dialog.getByTestId("client-type-returning").click();
    expect((await returningResponse).status()).toBe(200);
    await expect(rows).toHaveCount(PAGE_SIZE);
    await expect(returningBadges).toHaveCount(PAGE_SIZE);
    await expect(newBadges).toHaveCount(0);
    await expect(loadMore).toContainText(`Učitaj još (${PAGE_SIZE} od ${SEGMENT_SIZE})`);

    // Back to "Svi": the counter restores the unfiltered total.
    const allResponse = nextFirstPageResponse(page, fixture.ruleId, null);
    await dialog.getByTestId("client-type-all").click();
    expect((await allResponse).status()).toBe(200);
    await expect(rows).toHaveCount(PAGE_SIZE);
    await expect(loadMore).toContainText(`Učitaj još (${PAGE_SIZE} od ${TOTAL})`);
    expect(await newBadges.count(), "Restored unfiltered page must contain new-client rows.").toBeGreaterThan(0);
    expect(await returningBadges.count(), "Restored unfiltered page must contain returning-client rows.").toBeGreaterThan(0);
  } finally {
    await cleanUpFixture(fixture);
  }
});

test("shared campaign links preserve tracking tags while filtering and closing", async ({ page }) => {
  const fixture = await createFixture();

  try {
    await signInAsFixtureOwner(page, fixture);
    await page.goto(`/vlasnik/automatizacije?utm_source=instagram&rule=${fixture.ruleId}&clients=returning`);

    const dialog = page.getByRole("dialog", { name: "Statistika automatizacije" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("client-type-returning")).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByTestId("client-type-all")).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => {
      const params = new URL(page.url()).searchParams;
      return {
        tracking: params.get("utm_source"),
        rule: params.get("rule"),
        clients: params.get("clients"),
      };
    }).toEqual({
      tracking: "instagram",
      rule: fixture.ruleId,
      clients: "returning",
    });

    await dialog.getByTestId("client-type-new").click();
    await expect.poll(() => {
      const params = new URL(page.url()).searchParams;
      return {
        tracking: params.get("utm_source"),
        rule: params.get("rule"),
        clients: params.get("clients"),
      };
    }).toEqual({
      tracking: "instagram",
      rule: fixture.ruleId,
      clients: "new",
    });
    await expect(dialog.getByTestId("client-type-new")).toHaveAttribute("aria-pressed", "true");

    await dialog.getByTestId("client-type-all").click();
    await expect.poll(() => {
      const params = new URL(page.url()).searchParams;
      return {
        tracking: params.get("utm_source"),
        rule: params.get("rule"),
        clients: params.get("clients"),
      };
    }).toEqual({
      tracking: "instagram",
      rule: fixture.ruleId,
      clients: null,
    });
    await expect(dialog.getByTestId("client-type-all")).toHaveAttribute("aria-pressed", "true");

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => {
      const params = new URL(page.url()).searchParams;
      return {
        tracking: params.get("utm_source"),
        rule: params.get("rule"),
        clients: params.get("clients"),
      };
    }).toEqual({
      tracking: "instagram",
      rule: null,
      clients: null,
    });

    await page.goto(`/vlasnik/automatizacije?utm_source=instagram&rule=${fixture.ruleId}&clients=bogus`);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("client-type-all")).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByTestId("client-type-returning")).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => {
      const params = new URL(page.url()).searchParams;
      return {
        tracking: params.get("utm_source"),
        rule: params.get("rule"),
        clients: params.get("clients"),
      };
    }).toEqual({
      tracking: "instagram",
      rule: fixture.ruleId,
      clients: null,
    });
  } finally {
    await cleanUpFixture(fixture);
  }
});
