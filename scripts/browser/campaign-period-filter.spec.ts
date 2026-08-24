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
  automationDeliveriesTable,
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

/** Local calendar date → YYYY-MM-DD, matching the app's serialization. */
function toDateParam(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
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
      runId: randomUUID(),
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
        id: entry.runId,
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

    // Keep one current-window delivery alongside the attributed appointments.
    // There are deliberately no deliveries in the preceding comparison window,
    // so the UI must render a zero-to-positive delivery trend rather than
    // treating the comparison as unavailable.
    await db.insert(automationDeliveriesTable).values({
      runId: entries[0]!.runId,
      salonId: salon.id,
      eventKey: `browser-period-filter-delivery-${suffix}`,
      channel: "email",
      recipientEmail: `browser-period-filter-cust-0-${suffix}@example.test`,
      status: "sent",
      sentAt: RECENT_EXECUTED_AT,
      deliveredAt: RECENT_EXECUTED_AT,
    });

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

function nextStatsResponse(page: Page, ruleId: string, period: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "GET"
      && url.pathname.endsWith(`/growth/automations/${ruleId}/stats`)
      && url.searchParams.get("period") === period
      && url.searchParams.get("compare") === "previous"
    );
  });
}

test("overview period selection announces the active window without disturbing the table", async ({ page }) => {
  const fixture = await createFixture();

    const overview = page.getByTestId("campaign-overview");

  try {
    await signInAsFixtureOwner(page, fixture);
    await page.goto("/vlasnik/automatizacije");

    await page.getByTestId(`overview-row-${fixture.ruleId}`)
      .getByRole("button", { name: fixture.ruleName })
      .click();
    const dialog = page.getByRole("dialog", { name: "Statistika automatizacije" });
    await expect(dialog).toBeVisible();

    const rows = dialog.locator('[data-testid="attributed-appointments-list"] > div');
    const recentRows = rows.filter({ hasText: "Klijent Skorasnji" });
    const oldRows = rows.filter({ hasText: "Klijent Stari" });
    const loadMore = dialog.getByTestId("button-load-more-attributed");
    const overviewRow = page.getByTestId(`overview-row-${fixture.ruleId}`);
    const status = dialog.getByTestId("stats-period-status");

    // Page 1 of "Sve vreme": full page, unfiltered counter, both run windows present.
    await expect(rows).toHaveCount(PAGE_SIZE);
    await expect(dialog.getByTestId("stats-attributed-revenue")).toBeVisible();
    // "Sve vreme" does not request a comparison window, so no trend marker
    // should be rendered even though the campaign has current activity.
    await expect(overviewRow.getByTestId(`trend-email-delivered-${fixture.ruleId}`)).toHaveCount(0);
    await expect(overviewRow.getByTestId(`trend-appointments-${fixture.ruleId}`)).toHaveCount(0);
    await expect(dialog.getByTestId("stats-trend-email-delivered")).toHaveCount(0);
    await expect(dialog.getByTestId("stats-trend-appointments")).toHaveCount(0);
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
    // The in-dialog selector must keep the accumulated stats dialog open while
    // changing the period, so the period dependency cannot be masked by a
    // close/reopen reset.
    const thirtyResponse = nextFirstPageResponse(page, fixture.ruleId, "30d");

    const thirtyStatsResponse = nextStatsResponse(page, fixture.ruleId, "30d");
    const thirtyOverviewResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET"
        && url.pathname.endsWith("/growth/automation-stats")
        && url.searchParams.get("period") === "30d"
        && url.searchParams.get("compare") === "previous"
      );
    });
    await dialog.getByTestId("stats-period-selector").getByTestId("period-30d").click();
    expect((await thirtyResponse).status()).toBe(200);
    const [thirtyStats, thirtyOverview] = await Promise.all([
      thirtyStatsResponse.then((response) => response.json()),
      thirtyOverviewResponse.then((response) => response.json()),
    ]) as [
      Record<string, unknown>,
      Array<Record<string, unknown>>,
    ];
    expect(thirtyStats.previous).toMatchObject({
      attributedAppointments: 0,
      emailDeliveredCount: 0,
      emailOpenedCount: 0,
      smsDeliveredCount: 0,
    });
    const thirtyOverviewItem = thirtyOverview.find((item) => item.ruleId === fixture.ruleId);
    expect(thirtyOverviewItem?.previous).toMatchObject({
      attributedAppointments: 0,
      emailDeliveredCount: 0,
      emailOpenedCount: 0,
      smsDeliveredCount: 0,
    });
    await expect(dialog, "The stats dialog must stay open across a period switch.").toBeVisible();
    await expect(status).toHaveText("Izabran period: poslednjih 30 dana");
    await expect(page.getByTestId("overview-period-selector").getByTestId("period-30d")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => new URL(page.url()).searchParams.get("period")).toBe("30d");
    await expect(rows).toHaveCount(PAGE_SIZE);
    await expect(recentRows).toHaveCount(PAGE_SIZE);
    await expect(oldRows).toHaveCount(0);
    await expect(loadMore).toContainText(`Učitaj još (${PAGE_SIZE} od ${GROUP_SIZE})`);
    await expect(overviewRow).toContainText("Poslato: 1");
    await expect(overviewRow.getByTestId(`trend-email-delivered-${fixture.ruleId}`))
      .toContainText("novo");
    await expect(overviewRow.getByTestId(`trend-appointments-${fixture.ruleId}`))
      .toContainText("novo");
    await expect(dialog.getByTestId("stats-trend-email-delivered")).toContainText("novo");
    await expect(dialog.getByTestId("stats-trend-appointments")).toContainText("novo");

    // Back to "Sve vreme": the counter restores the unfiltered total and old
    // rows reappear.
    const allResponse = nextFirstPageResponse(page, fixture.ruleId, "all");
    await dialog.getByTestId("stats-period-selector").getByTestId("period-all").click();
    expect((await allResponse).status()).toBe(200);
    await expect(dialog).toBeVisible();
    await expect(status).toHaveText("Izabran period: sve vreme");
    await expect(page.getByTestId("overview-period-selector").getByTestId("period-all")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => new URL(page.url()).searchParams.get("period")).toBeNull();
    await expect(rows).toHaveCount(PAGE_SIZE);
    await expect(loadMore).toContainText(`Učitaj još (${PAGE_SIZE} od ${TOTAL})`);
    expect(await recentRows.count(), "Restored unfiltered page must contain recent-run rows.").toBeGreaterThan(0);
    expect(await oldRows.count(), "Restored unfiltered page must contain old-run rows.").toBeGreaterThan(0);
  } finally {
    await cleanUpFixture(fixture);
  }
});
test("mobile stats period controls stay visible and keep the dialog open", async ({ page }) => {
  const fixture = await createFixture();

    const overview = page.getByTestId("campaign-overview");

  try {
    await signInAsFixtureOwner(page, fixture);
    await page.goto("/vlasnik/automatizacije");

    await page.getByTestId(`overview-row-${fixture.ruleId}`)
      .getByRole("button", { name: fixture.ruleName })
      .click();
    const dialog = page.getByRole("dialog", { name: "Statistika automatizacije" });
    await expect(dialog).toBeVisible();

    const selector = dialog.getByTestId("stats-period-selector");

    const status = dialog.getByTestId("stats-period-status");
    await expect(selector).toBeVisible();
    for (const [period, label] of [
      ["7d", "7 dana"],
      ["30d", "30 dana"],
      ["90d", "90 dana"],
      ["all", "Sve vreme"],
    ] as const) {
      const button = selector.getByTestId(`period-${period}`);
      await expect(button).toHaveText(label);
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box, `${period} period button must have a tappable box on mobile.`).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }

    const customButton = selector.getByTestId("period-custom");
    await expect(customButton).toBeVisible();
    const customBox = await customButton.boundingBox();
    expect(customBox, "The custom period button must remain tappable on mobile.").not.toBeNull();
    expect(customBox!.x).toBeGreaterThanOrEqual(0);
    expect(customBox!.x + customBox!.width).toBeLessThanOrEqual(390);

    await customButton.click();
    const rangePresets = page.getByTestId("stats-period-selector-range-presets");

    const last14Days = rangePresets.getByTestId("range-preset-last-14d");
    await expect(rangePresets).toBeVisible();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(rangePresets).toBeHidden();
    await expect(dialog).toBeVisible();

    const rows = dialog.locator('[data-testid="attributed-appointments-list"] > div');
    const recentRows = rows.filter({ hasText: "Klijent Skorasnji" });
    const oldRows = rows.filter({ hasText: "Klijent Stari" });
    const thirtyResponse = nextFirstPageResponse(page, fixture.ruleId, "30d");

    await selector.getByTestId("period-30d").click();
    expect((await thirtyResponse).status()).toBe(200);

    await expect(dialog, "Switching period on mobile must not close the stats dialog.").toBeVisible();
    await expect(status).toHaveText("Izabran period: poslednjih 30 dana");
    await expect(selector.getByTestId("period-30d")).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(PAGE_SIZE);
    await expect(recentRows).toHaveCount(PAGE_SIZE);
    await expect(oldRows).toHaveCount(0);
  } finally {
    await cleanUpFixture(fixture);
  }
});

test("stats period controls follow keyboard order and preserve the dialog", async ({ page }) => {
  const fixture = await createFixture();

    const overview = page.getByTestId("campaign-overview");

  try {
    await signInAsFixtureOwner(page, fixture);
    await page.goto("/vlasnik/automatizacije");

    await page.getByTestId(`overview-row-${fixture.ruleId}`)
      .getByRole("button", { name: fixture.ruleName })
      .click();
    const dialog = page.getByRole("dialog", { name: "Statistika automatizacije" });
    await expect(dialog).toBeVisible();

    const selector = dialog.getByTestId("stats-period-selector");

    const status = dialog.getByTestId("stats-period-status");
    const periodButtons = ["7d", "30d", "90d", "all"].map((period) =>
      selector.getByTestId(`period-${period}`),
    );
    const customButton = selector.getByTestId("period-custom");

    // The five period controls are one contiguous keyboard sequence in the
    // same order as their visual labels.
    await periodButtons[0].focus();
    for (const button of periodButtons.slice(1)) {
      await page.keyboard.press("Tab");
      await expect(button).toBeFocused();
    }
    await page.keyboard.press("Tab");
    await expect(customButton).toBeFocused();

    // Both standard keyboard activation keys update the period without
    // closing the stats dialog.
    const sevenDayResponse = nextFirstPageResponse(page, fixture.ruleId, "7d");
    await periodButtons[0].focus();
    await page.keyboard.press("Enter");
    expect((await sevenDayResponse).status()).toBe(200);
    await expect(periodButtons[0]).toHaveAttribute("aria-pressed", "true");
    await expect(status).toHaveText("Izabran period: poslednjih 7 dana");
    await expect(dialog).toBeVisible();

    const thirtyDayResponse = nextFirstPageResponse(page, fixture.ruleId, "30d");

    const thirtyDayButton = selector.getByTestId("period-30d");
    await periodButtons[1].focus();
    await page.keyboard.press("Space");
    expect((await thirtyDayResponse).status()).toBe(200);
    await expect(periodButtons[1]).toHaveAttribute("aria-pressed", "true");
    await expect(status).toHaveText("Izabran period: poslednjih 30 dana");
    await expect(dialog).toBeVisible();

    // Opening the custom picker with Enter and Space must keep it inside the
    // dialog's interaction. Choosing a preset must announce its exact date
    // range before Escape dismisses a later open picker and returns focus to
    // the trigger.
    const now = new Date();
    const customFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13);
    const customTo = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const customLabel = `${customFrom.toLocaleDateString("sr-RS")} – ${customTo.toLocaleDateString("sr-RS")}`;
    await customButton.focus();
    await page.keyboard.press("Enter");
    const rangePresets = page.getByTestId("stats-period-selector-range-presets");

    const last14Days = rangePresets.getByTestId("range-preset-last-14d");
    await expect(rangePresets).toBeVisible();
    await expect(dialog).toBeVisible();
    const customResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith(`/growth/automations/${fixture.ruleId}/attributed-appointments`)
        && url.searchParams.get("from") === toDateParam(customFrom)
        && url.searchParams.get("to") === toDateParam(customTo)
        && url.searchParams.get("offset") === "0";
    });
    await rangePresets.getByTestId("range-preset-last-14d").click();
    expect((await customResponse).status()).toBe(200);
    await expect(status).toHaveText(`Izabran period: ${customLabel}`);
    await expect(selector.getByTestId("period-custom")).toHaveAttribute("aria-pressed", "true");
    await expect(dialog).toBeVisible();
    await expect(customButton).toBeFocused();

    await page.keyboard.press("Space");
    await expect(rangePresets).toBeVisible();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(rangePresets).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(customButton).toBeFocused();
  } finally {
    await cleanUpFixture(fixture);
  }
});
