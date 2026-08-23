/**
 * Campaign stats dialog — time-period switch browser regression.
 *
 * The server-side period filter (statsRunPeriodCondition applied to the
 * attributed-appointments endpoint so rows and total always agree) is covered
 * by API tests. This spec guards the browser side: the attributed-appointments
 * list accumulates pages via "Učitaj još", and picking a different time period
 * must reset that accumulation — the same reset effect as the Svi/Novi/Vraćeni
 * client filter (covered by campaign-client-filter.spec.ts). A regression that
 * drops the period from the reset, or keeps a stale offset, would silently mix
 * appointments attributed to sends outside the selected period into the list.
 *
 * Fixture: one rule with 60 attributed appointments whose RUNS fall in two
 * windows — 30 "recent" (executed ~5 days ago, inside a 30-day period) and 30
 * "old" (executed ~60 days ago, outside it) — with appointment dates
 * alternating between the groups so every unfiltered page mixes both:
 *  1. Open the stats dialog → 25 rows, counter "25 od 60"; load a second
 *     page → 50 rows, counter "50 od 60", both groups visible.
 *  2. Switch the period selector to "30 dana" → the accumulation collapses to
 *     a fresh first page: exactly 25 rows, every row from the recent group,
 *     zero rows from the old group, counter "25 od 30".
 *  3. Switch back to "Sve vreme" → counter restores the full "25 od 60" and
 *     both groups are visible again.
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
/** Per window; the recent group alone overflows one page so its counter is visible. */
const GROUP_SIZE = 30;
const TOTAL = GROUP_SIZE * 2;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Runs inside the 30-day preset window (with margin for test runtime). */
const RECENT_EXECUTED_AT = new Date(Date.now() - 5 * DAY_MS);
/** Runs outside the 30-day preset window (with margin for test runtime). */
const OLD_EXECUTED_AT = new Date(Date.now() - 60 * DAY_MS);

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

/**
 * Attributed-appointment date for index i: unique past days ending yesterday,
 * so date-desc ordering is deterministic and — because group membership
 * alternates by index parity — every 25-row page mixes recent-run and
 * old-run rows. The appointment date itself is NOT what the period filters
 * on (the run's executedAt is), which is exactly what this spec guards.
 */
function attributedDate(index: number): string {
  return new Date(Date.now() - (TOTAL - index) * DAY_MS).toISOString().slice(0, 10);
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const ownerEmail = `browser-period-filter-owner-${suffix}@example.test`;
  const ownerPassword = "browser-period-filter-password";
  const ruleName = `Browser period kampanja ${suffix}`;
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
    if (!owner) throw new Error("Period-filter browser fixture could not create its owner.");
    ownerId = owner.id;

    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id,
      name: `Browser salon za period ${suffix}`,
      slug: `browser-period-filter-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 93",
      phone: "+381110000093",
      email: `browser-period-filter-salon-${suffix}@example.test`,
      shortDescription: "Izolovan salon za proveru filtera perioda.",
      description: "Salon je napravljen samo za browser regresioni test izbora perioda u statistici kampanje.",
      imageUrl: "/test-browser-period-filter.jpg",
    }).returning({ id: salonsTable.id });
    if (!salon) throw new Error("Period-filter browser fixture could not create its salon.");
    salonId = salon.id;

    await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));

    const [service] = await db.insert(servicesTable).values({
      salonId: salon.id,
      categoryName: "Test",
      name: `Browser period usluga ${suffix}`,
      description: "Usluga za browser proveru filtera perioda.",
      durationMinutes: 60,
      price: 2000,
      imageUrl: "/test-browser-period-filter.jpg",
      active: true,
    }).returning({ id: servicesTable.id });
    if (!service) throw new Error("Period-filter browser fixture could not create its service.");

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
    if (!rule) throw new Error("Period-filter browser fixture could not create its rule.");

    // Ids are generated client-side so group membership never depends on the
    // order RETURNING happens to yield rows in.
    // Even index → recent run (inside 30d), odd index → old run (outside 30d),
    // so appointment dates alternate groups and every unfiltered page mixes
    // both kinds. The customer's last name carries the group marker the
    // assertions look for in the rendered rows.
    const entries = Array.from({ length: TOTAL }, (_, index) => ({
      index,
      isOld: index % 2 === 1,
      customerId: randomUUID(),
      appointmentId: randomUUID(),
    }));

    await db.insert(salonCustomersTable).values(entries.map((entry) => ({
      id: entry.customerId,
      salonId: salon.id,
      firstName: "Klijent",
      lastName: `${entry.isOld ? "Stari" : "Skorasnji"} ${entry.index}`,
      email: `browser-period-filter-cust-${entry.index}-${suffix}@example.test`,
      smsOptOut: false,
    })));

    // The attributed appointments themselves (realized status). Their dates
    // interleave the two groups; only the run timestamps decide the period.
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

    await db.insert(automationRunsTable).values(entries.map((entry) => {
      const executedAt = entry.isOld ? OLD_EXECUTED_AT : RECENT_EXECUTED_AT;
      return {
        eventKey: `browser-period-filter-${suffix}-${entry.index}`,
        ruleId: rule.id,
        salonId: salon.id,
        salonCustomerId: entry.customerId,
        status: "sent" as const,
        executedAt,
        sentAt: executedAt,
        attributedAppointmentId: entry.appointmentId,
      };
    }));

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
 * given period, registered BEFORE the click that triggers it so earlier
 * responses can't satisfy it.
 */
function nextFirstPageResponse(page: Page, ruleId: string, period: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith(`/growth/automations/${ruleId}/attributed-appointments`)
      && url.searchParams.get("period") === period
      && url.searchParams.get("offset") === "0";
  });
}

test("switching the time period never leaves stale attributed rows in the list", async ({ page }) => {
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
    const recentRows = rows.filter({ hasText: "Klijent Skorasnji" });
    const oldRows = rows.filter({ hasText: "Klijent Stari" });
    const loadMore = dialog.getByTestId("button-load-more-attributed");

    // Page 1 of "Sve vreme": full page, unfiltered counter, both run windows present.
    await expect(rows).toHaveCount(PAGE_SIZE);
    await expect(loadMore).toContainText(`Učitaj još (${PAGE_SIZE} od ${TOTAL})`);
    expect(await recentRows.count(), "Unfiltered page 1 must contain recent-run rows.").toBeGreaterThan(0);
    expect(await oldRows.count(), "Unfiltered page 1 must contain old-run rows.").toBeGreaterThan(0);

    // Accumulate a second page.
    await loadMore.click();
    await expect(rows).toHaveCount(PAGE_SIZE * 2);
    await expect(loadMore).toContainText(`Učitaj još (${PAGE_SIZE * 2} od ${TOTAL})`);
    expect(await oldRows.count(), "Accumulated pages must contain old-run rows.").toBeGreaterThan(0);

    // Switch the period to "30 dana": the 50 accumulated rows must collapse
    // to one fresh first page whose counter uses the period-filtered total,
    // with zero rows attributed to runs outside the period.
    //
    // The stats dialog is modal, so its overlay intercepts real pointer input
    // to the period selector behind it. Dispatch the click event directly:
    // React's onClick still runs, while Radix (which dismisses only on real
    // pointerdown outside) keeps the dialog open. That produces exactly the
    // state combination this spec guards — the period changing while the
    // dialog still holds accumulated pages — without the statsRuleId
    // close/reopen reset masking a dropped period dependency.
    const thirtyResponse = nextFirstPageResponse(page, fixture.ruleId, "30d");
    await page.getByTestId("overview-period-selector").getByTestId("period-30d").dispatchEvent("click");
    expect((await thirtyResponse).status()).toBe(200);
    await expect(dialog, "The stats dialog must stay open across a period switch.").toBeVisible();
    await expect(rows).toHaveCount(PAGE_SIZE);
    await expect(recentRows).toHaveCount(PAGE_SIZE);
    await expect(oldRows).toHaveCount(0);
    await expect(loadMore).toContainText(`Učitaj još (${PAGE_SIZE} od ${GROUP_SIZE})`);

    // Back to "Sve vreme": the counter restores the unfiltered total and old
    // rows reappear.
    const allResponse = nextFirstPageResponse(page, fixture.ruleId, "all");
    await page.getByTestId("overview-period-selector").getByTestId("period-all").dispatchEvent("click");
    expect((await allResponse).status()).toBe(200);
    await expect(dialog).toBeVisible();
    await expect(rows).toHaveCount(PAGE_SIZE);
    await expect(loadMore).toContainText(`Učitaj još (${PAGE_SIZE} od ${TOTAL})`);
    expect(await recentRows.count(), "Restored unfiltered page must contain recent-run rows.").toBeGreaterThan(0);
    expect(await oldRows.count(), "Restored unfiltered page must contain old-run rows.").toBeGreaterThan(0);
  } finally {
    await cleanUpFixture(fixture);
  }
});
