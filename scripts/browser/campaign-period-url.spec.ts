/**
 * Campaign period URL restore — browser regression for the page wiring.
 *
 * The pure restore/fallback logic is unit-tested in
 * artifacts/beauty-marketplace/src/lib/campaign-period-url.test.ts. This spec
 * guards the wiring that unit tests cannot see: the initial and history reads
 * of window.location.search in owner/automations.tsx, the wouter-based
 * URL-sync effect, and the period selector actually reflecting the restored
 * value.
 * A regression there (e.g. the mount read moving after the selector
 * initializes) would silently break every shared/bookmarked period link.
 *
 * Scenarios:
 *  1. ?period=30d → "30 dana" is pre-selected, the overview stats request is
 *     sent with period=30d, and the URL keeps the param (no cleanup rewrite).
 *  2. ?from=&to= → the custom range button is pre-selected and shows the
 *     restored range; the stats request uses the exact from/to dates.
 *  3. ?period=eternity (invalid) → falls back to "Sve vreme", the stats
 *     request uses the default window, and the URL is cleaned in place.
 *  4. ?to= in the future → the calendar disables days after today, so the
 *     restored range is clamped to end today; the stats request and the
 *     rewritten URL both carry the clamped end date.
 *  5. Picking two dates in the calendar → the exact local from/to values are
 *     written without ?period=, and the custom button restores them after reload.
 *  6. Picking dates across a calendar-month transition → navigation preserves
 *     the pending start, writes the exact inclusive cross-month range without
 *     ?period=, and the closed/reloaded picker keeps displaying it.
 *  7. Keyboard-picking dates across a calendar-month transition → focused
 *     calendar controls and Enter preserve the exact inclusive range through
 *     close and reload.
 *  8. Browser Back/Forward → preset windows are restored in the overview and
 *     stats dialog without dropping an unrelated tracking parameter.
 *  9. Browser Back/Forward → valid custom windows are restored in the overview
 *     and stats dialog with their exact from/to values.
 *  10. A shared stats URL → the custom July window is restored in the stats
 *      dialog and both stats requests keep the restored from/to after reload.
 *  11. Accessibility labels → month navigation, focused dates, pending starts,
 *      and completed cross-month range days expose understandable names.
 *  12. Deleting the final campaign → a selected preset remains visibly selected
 *      after the owner page reloads.
 *  13. Deleting the final campaign → a complete custom range remains visible
 *      after reload without changing its URL.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page, type Response } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
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

/** Local calendar date → YYYY-MM-DD, mirroring the app's own serialization. */
function toDateParam(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Fixture = {
  ownerEmail: string;
  ownerPassword: string;
  ownerId: string;
  salonId: string;
  ruleId: string;
  secondSalonId: string;
  secondRuleId: string;
};

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

/**
 * Minimal fixture: the campaign overview (which hosts the period selector)
 * renders whenever the salon has at least one automation rule — the overview
 * stats endpoint returns one row per rule regardless of window activity, so
 * no runs/appointments are needed to exercise the period wiring.
 */
async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const ownerEmail = `browser-period-url-owner-${suffix}@example.test`;
  const ownerPassword = "browser-period-url-password";
  let ownerId: string | undefined;
  let salonIds: string[] = [];

  try {
    const [owner] = await db.insert(usersTable).values({
      firstName: "Browser",
      lastName: "Vlasnik",
      email: ownerEmail,
      passwordHash: await hashPassword(ownerPassword),
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    }).returning({ id: usersTable.id });
    if (!owner) throw new Error("Period-URL browser fixture could not create its owner.");
    ownerId = owner.id;

    const firstSalonName = `Browser salon za period URL ${suffix}`;
    const secondSalonName = `Browser druga lokacija za period URL ${suffix}`;
    const salons = await db.insert(salonsTable).values([
      {
        ownerId: owner.id,
        name: firstSalonName,
        slug: `browser-period-url-${suffix}`,
        city: "Beograd",
        municipality: "Vračar",
        address: "Test 93",
        phone: "+381110000093",
        email: `browser-period-url-salon-${suffix}@example.test`,
        shortDescription: "Izolovan salon za proveru URL perioda kampanja.",
        description: "Salon je napravljen samo za browser regresioni test deljivih linkova perioda.",
        imageUrl: "/test-browser-period-url.jpg",
      },
      {
        ownerId: owner.id,
        name: secondSalonName,
        slug: `browser-period-url-second-${suffix}`,
        city: "Novi Sad",
        municipality: "Centar",
        address: "Test 94",
        phone: "+381110000094",
        email: `browser-period-url-second-salon-${suffix}@example.test`,
        shortDescription: "Druga lokacija za proveru promene kampanja.",
        description: "Druga lokacija za browser proveru promene salona uz sačuvan period.",
        imageUrl: "/test-browser-period-url.jpg",
      },
    ]).returning({ id: salonsTable.id });
    if (salons.length !== 2) throw new Error("Period-URL browser fixture could not create both salons.");
    salonIds = salons.map((salon) => salon.id);
    const [salon, secondSalon] = salons;

    await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));

    const rules = await db.insert(automationRulesTable).values([
      {
        salonId: salon.id,
        name: `Browser period URL kampanja ${suffix}`,
        trigger: "inactive_days",
        triggerConfig: { inactiveDays: 30 },
        action: "send_email",
        emailSubject: "Test",
        emailBody: "Test",
        status: "active",
      },
      {
        salonId: secondSalon.id,
        name: `Browser druga period URL kampanja ${suffix}`,
        trigger: "inactive_days",
        triggerConfig: { inactiveDays: 30 },
        action: "send_email",
        emailSubject: "Test",
        emailBody: "Test",
        status: "active",
      },
    ]).returning({ id: automationRulesTable.id });
    if (rules.length !== 2) throw new Error("Period-URL browser fixture could not create both rules.");

    const [customer] = await db.insert(salonCustomersTable).values({
      salonId: salon.id,
      firstName: "Browser",
      lastName: "Klijent",
      email: `browser-period-url-customer-${suffix}@example.test`,
      smsOptOut: false,
    }).returning({ id: salonCustomersTable.id });
    if (!customer) throw new Error("Period-URL browser fixture could not create its customer.");

    const [service] = await db.insert(servicesTable).values({
      salonId: salon.id,
      categoryName: "Test",
      name: `Browser period URL usluga ${suffix}`,
      description: "Usluga za proveru spring-forward URL perioda.",
      durationMinutes: 60,
      price: 1200,
      imageUrl: "/test-browser-period-url.jpg",
      active: true,
    }).returning({ id: servicesTable.id });
    if (!service) throw new Error("Period-URL browser fixture could not create its service.");

    // Keep current and preceding totals deliberately different. If URL
    // restore shifts either boundary around the Europe/Belgrade spring-forward
    // transition, these counts and the rendered trend change.
    const springEvents = [
      { tag: "previous-first", at: new Date("2026-03-25T12:00:00.000Z"), date: "2026-03-25" },
      { tag: "previous-last", at: new Date("2026-03-27T12:00:00.000Z"), date: "2026-03-27" },
      { tag: "current-before-transition", at: new Date("2026-03-28T12:00:00.000Z"), date: "2026-03-28" },
      { tag: "current-transition-day", at: new Date("2026-03-29T01:30:00.000Z"), date: "2026-03-29" },
      { tag: "current-after-transition", at: new Date("2026-03-30T12:00:00.000Z"), date: "2026-03-30" },
    ] as const;
    // Keep a second, deliberately different window around the Europe/Belgrade
    // autumn rollback. Shared-link regressions must preserve this local
    // calendar range too, without weakening the existing spring coverage.
    const autumnEvents = [
      { tag: "autumn-previous-first", at: new Date("2026-10-21T12:00:00.000Z"), date: "2026-10-21" },
      { tag: "autumn-previous-last", at: new Date("2026-10-23T12:00:00.000Z"), date: "2026-10-23" },
      { tag: "autumn-current-before-transition", at: new Date("2026-10-24T12:00:00.000Z"), date: "2026-10-24" },
      { tag: "autumn-current-transition-day", at: new Date("2026-10-25T01:30:00.000Z"), date: "2026-10-25" },
      { tag: "autumn-current-after-transition", at: new Date("2026-10-26T12:00:00.000Z"), date: "2026-10-26" },
    ] as const;
    for (const event of [...springEvents, ...autumnEvents]) {
      const [appointment] = await db.insert(appointmentsTable).values({
        salonId: salon.id,
        salonCustomerId: customer.id,
        serviceId: service.id,
        date: event.date,
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        status: "completed",
        price: 1200,
        treatmentLocation: "salon",
      }).returning({ id: appointmentsTable.id });
      if (!appointment) throw new Error(`Period-URL browser fixture could not create ${event.tag} appointment.`);

      const [run] = await db.insert(automationRunsTable).values({
        eventKey: `browser-period-url-run-${suffix}-${event.tag}`,
        ruleId: rules[0]!.id,
        salonId: salon.id,
        salonCustomerId: customer.id,
        status: "sent",
        executedAt: event.at,
        sentAt: event.at,
        attributedAppointmentId: appointment.id,
      }).returning({ id: automationRunsTable.id });
      if (!run) throw new Error(`Period-URL browser fixture could not create ${event.tag} run.`);

      await db.insert(automationDeliveriesTable).values({
        runId: run.id,
        salonId: salon.id,
        eventKey: `browser-period-url-delivery-${suffix}-${event.tag}`,
        channel: "email",
        recipientEmail: `browser-period-url-recipient-${suffix}@example.test`,
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
      ruleId: rules[0]!.id,
      secondSalonId: secondSalon.id,
      secondRuleId: rules[1]!.id,
    };
  } catch (error) {
    if (salonIds.length) await db.delete(salonsTable).where(inArray(salonsTable.id, salonIds));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpFixture(fixture: Fixture): Promise<void> {
  // Salon delete cascades the automation rule.
  await db.update(usersTable).set({ activeSalonId: null }).where(eq(usersTable.id, fixture.ownerId));
  await db.delete(salonsTable).where(inArray(salonsTable.id, [fixture.salonId, fixture.secondSalonId]));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
}

async function signInAsFixtureOwner(page: Page, fixture: Fixture): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
  });
  expect(response, "The isolated salon owner fixture must be able to sign in.").toBeOK();
}

/**
 * Resolves with the next campaign-overview stats response whose query window
 * matches `expected` exactly (null = the param must be absent). Register it
 * BEFORE the navigation that triggers the request.
 */
function nextOverviewStatsResponse(
  page: Page,
  expected: { period: string | null; from: string | null; to: string | null },
): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/growth/automation-stats")
      && url.searchParams.get("period") === expected.period
      && url.searchParams.get("from") === expected.from
      && url.searchParams.get("to") === expected.to;
  });
}

function nextAutomationStatsResponse(
  page: Page,
  automationId: string,
  expected: { period: string | null; from: string | null; to: string | null },
): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith(`/growth/automations/${automationId}/stats`)
      && url.searchParams.get("period") === expected.period
      && url.searchParams.get("from") === expected.from
      && url.searchParams.get("to") === expected.to;
  });
}

async function resetFixtureActiveSalon(fixture: Fixture, salonId: string): Promise<void> {
  await db.update(usersTable).set({ activeSalonId: salonId }).where(eq(usersTable.id, fixture.ownerId));
}

test.describe("shared campaign period links restore the picked window", () => {
  let fixture: Fixture;

  test.beforeAll(async () => {
    fixture = await createFixture();
  });

  test.afterAll(async () => {
    await cleanUpFixture(fixture);
  });

  test("?period=30d pre-selects '30 dana' and the stats request uses period=30d", async ({ page }) => {
    await signInAsFixtureOwner(page, fixture);

    // Bounded presets request the previous window too (compare=previous) so
    // the overview can render trends — the restored 30d selection must carry
    // that through exactly like a manual click would.
    const statsResponse = nextOverviewStatsResponse(page, { period: "30d", from: null, to: null });
    await page.goto("/vlasnik/automatizacije?period=30d");

    const response = await statsResponse;
    expect(response.status()).toBe(200);
    expect(new URL(response.url()).searchParams.get("compare")).toBe("previous");

    const selector = page.getByTestId("overview-period-selector");
    await expect(selector).toBeVisible();
    await expect(selector.getByTestId("period-30d")).toHaveAttribute("aria-pressed", "true");
    await expect(selector.getByTestId("period-all")).toHaveAttribute("aria-pressed", "false");
    await expect(selector.getByTestId("period-30d")).toHaveText("30 dana");

    // The valid param round-trips: the URL-sync effect must NOT rewrite it.
    await expect(page).toHaveURL(/\/vlasnik\/automatizacije\?period=30d$/);
  });

  test("?from/&to pre-selects the custom range and the stats request uses those dates", async ({ page }) => {
    await signInAsFixtureOwner(page, fixture);

    const statsResponse = nextOverviewStatsResponse(page, { period: null, from: "2026-03-01", to: "2026-03-31" });
    await page.goto("/vlasnik/automatizacije?from=2026-03-01&to=2026-03-31");

    expect((await statsResponse).status()).toBe(200);

    const selector = page.getByTestId("overview-period-selector");
    await expect(selector).toBeVisible();
    const customButton = selector.getByTestId("period-custom");
    await expect(customButton).toHaveAttribute("aria-pressed", "true");
    await expect(selector.getByTestId("period-all")).toHaveAttribute("aria-pressed", "false");
    // The button shows the restored range instead of the "Izaberi datume"
    // placeholder (exact formatting is locale-dependent, so match the parts).
    await expect(customButton).not.toContainText("Izaberi datume");
    await expect(customButton).toContainText("2026");
    await expect(customButton).toContainText("–");

    // A complete valid custom range round-trips unchanged.
    await expect(page).toHaveURL(/\/vlasnik\/automatizacije\?from=2026-03-01&to=2026-03-31$/);
  });

  test("Back and Forward restore preset periods in the overview and stats dialog", async ({ page }) => {
    await signInAsFixtureOwner(page, fixture);

    await page.goto("/vlasnik/automatizacije?period=7d&utm_source=history-preset");
    await expect(page.getByTestId("overview-period-selector").getByTestId("period-7d"))
      .toHaveAttribute("aria-pressed", "true");

    await page.goto("/vlasnik/automatizacije?period=30d&utm_source=history-preset");
    const overview = page.getByTestId("overview-period-selector");
    await expect(overview.getByTestId("period-30d")).toHaveAttribute("aria-pressed", "true");

    await page.goBack();
    await expect(page).toHaveURL(/\/vlasnik\/automatizacije\?.*history-preset/);
    expect(await page.evaluate(() => {
      const params = new URLSearchParams(window.location.search);
      return { period: params.get("period"), tracking: params.get("utm_source") };
    })).toEqual({ period: "7d", tracking: "history-preset" });
    await expect(overview.getByTestId("period-7d")).toHaveAttribute("aria-pressed", "true");
    await expect(overview.getByTestId("period-30d")).toHaveAttribute("aria-pressed", "false");

    await page.getByRole("button", { name: "Statistika" }).first().click();
    const statsSelector = page.getByTestId("stats-period-selector");
    await expect(statsSelector).toBeVisible();
    await expect(statsSelector.getByTestId("period-7d")).toHaveAttribute("aria-pressed", "true");
    await expect(statsSelector.getByTestId("period-30d")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");

    await page.goForward();
    await expect(page).toHaveURL(/\/vlasnik\/automatizacije\?.*history-preset/);
    await expect(overview.getByTestId("period-30d")).toHaveAttribute("aria-pressed", "true");
    await expect(overview.getByTestId("period-7d")).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => {
      const params = new URLSearchParams(window.location.search);
      return { period: params.get("period"), tracking: params.get("utm_source") };
    })).toEqual({ period: "30d", tracking: "history-preset" });
  });

  test("Back and Forward restore valid custom ranges in the overview and stats dialog", async ({ page }) => {
    await signInAsFixtureOwner(page, fixture);

    await page.goto("/vlasnik/automatizacije?from=2026-03-01&to=2026-03-31&utm_source=history-custom");
    await expect(page.getByTestId("overview-period-selector").getByTestId("period-custom"))
      .toContainText("2026");

    await page.goto("/vlasnik/automatizacije?from=2026-04-01&to=2026-04-30&utm_source=history-custom");
    const overview = page.getByTestId("overview-period-selector");
    const customButton = overview.getByTestId("period-custom");
    await expect(customButton).toHaveAttribute("aria-pressed", "true");
    await expect(customButton).toHaveText(/1\.\s*4\.\s*2026\.\s*–\s*30\.\s*4\.\s*2026\./);

    await page.goBack();
    await expect(page).toHaveURL(/\/vlasnik\/automatizacije\?.*history-custom/);
    await expect(customButton).toHaveAttribute("aria-pressed", "true");
    await expect(customButton).toHaveText(/1\.\s*3\.\s*2026\.\s*–\s*31\.\s*3\.\s*2026\./);
    expect(await page.evaluate(() => {
      const params = new URLSearchParams(window.location.search);
      return { from: params.get("from"), to: params.get("to"), tracking: params.get("utm_source") };
    })).toEqual({ from: "2026-03-01", to: "2026-03-31", tracking: "history-custom" });

    await page.getByRole("button", { name: "Statistika" }).first().click();
    const statsSelector = page.getByTestId("stats-period-selector");
    await expect(statsSelector).toBeVisible();
    await expect(statsSelector.getByTestId("period-custom")).toHaveAttribute("aria-pressed", "true");
    await expect(statsSelector.getByTestId("period-custom"))
      .toHaveText(/1\.\s*3\.\s*2026\.\s*–\s*31\.\s*3\.\s*2026\./);
    await page.keyboard.press("Escape");

    await page.goForward();
    await expect(page).toHaveURL(/\/vlasnik\/automatizacije\?.*history-custom/);
    await expect(customButton).toHaveText(/1\.\s*4\.\s*2026\.\s*–\s*30\.\s*4\.\s*2026\./);
    expect(await page.evaluate(() => {
      const params = new URLSearchParams(window.location.search);
      return { from: params.get("from"), to: params.get("to"), tracking: params.get("utm_source") };
    })).toEqual({ from: "2026-04-01", to: "2026-04-30", tracking: "history-custom" });
  });

  test("clicking last month writes exact dates and restores them after reload", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-08-23T12:00:00.000Z") });
    await signInAsFixtureOwner(page, fixture);

    await page.goto("/vlasnik/automatizacije?period=30d");

    const selector = page.getByTestId("overview-period-selector");
    await expect(selector).toBeVisible();
    await selector.getByTestId("period-custom").click();

    const statsResponse = nextOverviewStatsResponse(page, {
      period: null,
      from: "2026-07-01",
      to: "2026-07-31",
    });
    const presets = page.getByTestId("overview-period-selector-range-presets");
    await expect(presets).toBeVisible();
    // The Radix portal can place this preset just beyond the fixed browser
    // viewport even though it is visible. Exercise its real click handler
    // directly rather than letting geometry hide this URL regression.
    await presets.getByTestId("range-preset-last-month").dispatchEvent("click");

    expect((await statsResponse).status()).toBe(200);
    await expect(page).toHaveURL(/\/vlasnik\/automatizacije\?from=2026-07-01&to=2026-07-31$/);

    const expectedFrom = new Date("2026-07-01T12:00:00.000Z");
    const expectedTo = new Date("2026-07-31T12:00:00.000Z");
    const expectedRangeLabel = ` ${expectedFrom.toLocaleDateString("sr-RS")} – ${expectedTo.toLocaleDateString("sr-RS")}`;
    const customButton = selector.getByTestId("period-custom");
    await expect(customButton).toHaveAttribute("aria-pressed", "true");
    await expect(customButton).toHaveText(expectedRangeLabel);

    const reloadStatsResponse = nextOverviewStatsResponse(page, {
      period: null,
      from: "2026-07-01",
      to: "2026-07-31",
    });
    await page.reload();

    expect((await reloadStatsResponse).status()).toBe(200);
    const reloadedCustomButton = page.getByTestId("overview-period-selector")
      .getByTestId("period-custom");
    await expect(reloadedCustomButton).toHaveAttribute("aria-pressed", "true");
    await expect(reloadedCustomButton).toHaveText(expectedRangeLabel);
  });

  test("a shared stats link restores the July custom period in the dialog after reload", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-08-23T12:00:00.000Z") });
    await signInAsFixtureOwner(page, fixture);

    const expected = { period: null, from: "2026-07-01", to: "2026-07-31" };
    const sharedStatsUrl = `/vlasnik/automatizacije?from=${expected.from}&to=${expected.to}&rule=${fixture.ruleId}`;
    const overviewResponse = nextOverviewStatsResponse(page, expected);
    const detailResponse = nextAutomationStatsResponse(page, fixture.ruleId, expected);
    await page.goto(sharedStatsUrl);

    expect((await overviewResponse).status()).toBe(200);
    expect((await detailResponse).status()).toBe(200);

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const selector = dialog.getByTestId("stats-period-selector");
    const customButton = selector.getByTestId("period-custom");
    const expectedRangeLabel = ` ${new Date(2026, 6, 1).toLocaleDateString("sr-RS")} – ${new Date(2026, 6, 31).toLocaleDateString("sr-RS")}`;
    await expect(customButton).toHaveAttribute("aria-pressed", "true");
    await expect(customButton).toHaveText(expectedRangeLabel);
    await expect(dialog.getByTestId("stats-period-status")).toContainText(expectedRangeLabel.trim());
    expect(await page.evaluate(() => {
      const params = new URLSearchParams(window.location.search);
      return { from: params.get("from"), to: params.get("to"), rule: params.get("rule"), period: params.get("period") };
    })).toEqual({ from: expected.from, to: expected.to, rule: fixture.ruleId, period: null });

    const reloadedOverviewResponse = nextOverviewStatsResponse(page, expected);
    const reloadedDetailResponse = nextAutomationStatsResponse(page, fixture.ruleId, expected);
    await page.reload();

    expect((await reloadedOverviewResponse).status()).toBe(200);
    expect((await reloadedDetailResponse).status()).toBe(200);
    const reloadedDialog = page.getByRole("dialog");
    await expect(reloadedDialog).toBeVisible();
    const reloadedCustomButton = reloadedDialog.getByTestId("stats-period-selector")
      .getByTestId("period-custom");
    await expect(reloadedCustomButton).toHaveAttribute("aria-pressed", "true");
    await expect(reloadedCustomButton).toHaveText(expectedRangeLabel);
    await expect(reloadedDialog.getByTestId("stats-period-status")).toContainText(expectedRangeLabel.trim());
  });

  test.describe("Europe/Belgrade spring-forward shared links", () => {
    test.use({ timezoneId: "Europe/Belgrade" });

    test("restores the exact custom range and current/previous totals after reload", async ({ page }) => {
      await page.clock.install({ time: new Date("2026-03-31T12:00:00.000Z") });
      await signInAsFixtureOwner(page, fixture);

      const expected = { period: null, from: "2026-03-28", to: "2026-03-30" };
      const sharedStatsUrl = `/vlasnik/automatizacije?from=${expected.from}&to=${expected.to}&rule=${fixture.ruleId}`;
      const expectedPayload = {
        totalRuns: 3,
        attributedAppointments: 3,
        emailSentCount: 3,
        emailDeliveredCount: 3,
        previous: {
          attributedAppointments: 2,
          emailDeliveredCount: 2,
        },
      };

      const overviewResponse = nextOverviewStatsResponse(page, expected);
      const detailResponse = nextAutomationStatsResponse(page, fixture.ruleId, expected);
      await page.goto(sharedStatsUrl);

      const overviewResponseValue = await overviewResponse;
      expect(overviewResponseValue.status()).toBe(200);
      expect(new URL(overviewResponseValue.url()).searchParams.get("compare")).toBe("previous");
      const overviewPayload = await overviewResponseValue.json() as Array<Record<string, any>>;
      expect(overviewPayload.find((item) => item.ruleId === fixture.ruleId)).toMatchObject(expectedPayload);
      const detailResponseValue = await detailResponse;
      expect(new URL(detailResponseValue.url()).searchParams.get("compare")).toBe("previous");
      expect(await detailResponseValue.json()).toMatchObject(expectedPayload);

      const expectedRangeLabel = /28\.\s*3\.\s*2026\.\s*–\s*30\.\s*3\.\s*2026\./;
      const assertRestoredView = async () => {
        await expect(page).toHaveURL(
          `/vlasnik/automatizacije?from=${expected.from}&to=${expected.to}&rule=${fixture.ruleId}`,
        );
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(page.getByTestId("overview-period-selector").getByTestId("period-custom"))
          .toHaveText(expectedRangeLabel);
        await expect(dialog.getByTestId("stats-period-selector").getByTestId("period-custom"))
          .toHaveText(expectedRangeLabel);
        await expect(dialog.getByTestId("stats-period-status")).toContainText("28. 3. 2026.");
        await expect(dialog.getByTestId("stats-period-status")).toContainText("30. 3. 2026.");
        await expect(page.getByTestId(`overview-row-${fixture.ruleId}`).locator("td").nth(1))
          .toContainText("Poslato: 3");
        await expect(page.getByTestId(`overview-row-${fixture.ruleId}`).locator("td").nth(1))
          .toContainText("Isporučeno: 3");
        await expect(dialog.getByTestId("funnel-email")).toContainText("Isporučeno: 3");
        await expect(dialog.getByTestId("stats-trend-appointments")).toContainText("+50%");
        await expect(dialog.getByTestId("stats-trend-email-delivered")).toContainText("+50%");
      };
      await assertRestoredView();

      const reloadedOverviewResponse = nextOverviewStatsResponse(page, expected);
      const reloadedDetailResponse = nextAutomationStatsResponse(page, fixture.ruleId, expected);
      await page.reload();

      const reloadedOverviewResponseValue = await reloadedOverviewResponse;
      expect(reloadedOverviewResponseValue.status()).toBe(200);
      expect(new URL(reloadedOverviewResponseValue.url()).searchParams.get("compare")).toBe("previous");
      const reloadedOverviewPayload = await reloadedOverviewResponseValue.json() as Array<Record<string, any>>;
      expect(reloadedOverviewPayload.find((item) => item.ruleId === fixture.ruleId)).toMatchObject(expectedPayload);
      const reloadedDetailResponseValue = await reloadedDetailResponse;
      expect(new URL(reloadedDetailResponseValue.url()).searchParams.get("compare")).toBe("previous");
      expect(await reloadedDetailResponseValue.json()).toMatchObject(expectedPayload);
      await assertRestoredView();
    });
  });

  test.describe("Europe/Belgrade autumn-rollback shared links", () => {
    test.use({ timezoneId: "Europe/Belgrade" });

    test("restores the exact custom range and current/previous totals after reload", async ({ page }) => {
      await page.clock.install({ time: new Date("2026-10-27T12:00:00.000Z") });
      await signInAsFixtureOwner(page, fixture);

      const expected = { period: null, from: "2026-10-24", to: "2026-10-26" };
      const sharedStatsUrl = `/vlasnik/automatizacije?from=${expected.from}&to=${expected.to}&rule=${fixture.ruleId}`;
      const expectedPayload = {
        totalRuns: 3,
        attributedAppointments: 3,
        emailSentCount: 3,
        emailDeliveredCount: 3,
        previous: {
          attributedAppointments: 2,
          emailDeliveredCount: 2,
        },
      };

      const overviewResponse = nextOverviewStatsResponse(page, expected);
      const detailResponse = nextAutomationStatsResponse(page, fixture.ruleId, expected);
      await page.goto(sharedStatsUrl);

      const overviewResponseValue = await overviewResponse;
      expect(overviewResponseValue.status()).toBe(200);
      expect(new URL(overviewResponseValue.url()).searchParams.get("compare")).toBe("previous");
      const overviewPayload = await overviewResponseValue.json() as Array<Record<string, any>>;
      expect(overviewPayload.find((item) => item.ruleId === fixture.ruleId)).toMatchObject(expectedPayload);
      const detailResponseValue = await detailResponse;
      expect(detailResponseValue.status()).toBe(200);
      expect(new URL(detailResponseValue.url()).searchParams.get("compare")).toBe("previous");
      expect(await detailResponseValue.json()).toMatchObject(expectedPayload);

      const expectedRangeLabel = /24\.\s*10\.\s*2026\.\s*–\s*26\.\s*10\.\s*2026\./;
      const assertRestoredView = async () => {
        await expect(page).toHaveURL(
          `/vlasnik/automatizacije?from=${expected.from}&to=${expected.to}&rule=${fixture.ruleId}`,
        );
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(page.getByTestId("overview-period-selector").getByTestId("period-custom"))
          .toHaveText(expectedRangeLabel);
        await expect(dialog.getByTestId("stats-period-selector").getByTestId("period-custom"))
          .toHaveText(expectedRangeLabel);
        await expect(dialog.getByTestId("stats-period-status")).toContainText("24. 10. 2026.");
        await expect(dialog.getByTestId("stats-period-status")).toContainText("26. 10. 2026.");
        await expect(page.getByTestId(`overview-row-${fixture.ruleId}`).locator("td").nth(1))
          .toContainText("Poslato: 3");
        await expect(page.getByTestId(`overview-row-${fixture.ruleId}`).locator("td").nth(1))
          .toContainText("Isporučeno: 3");
        await expect(dialog.getByTestId("funnel-email")).toContainText("Isporučeno: 3");
        await expect(dialog.getByTestId("stats-trend-appointments")).toContainText("+50%");
        await expect(dialog.getByTestId("stats-trend-email-delivered")).toContainText("+50%");
      };
      await assertRestoredView();

      const reloadedOverviewResponse = nextOverviewStatsResponse(page, expected);
      const reloadedDetailResponse = nextAutomationStatsResponse(page, fixture.ruleId, expected);
      await page.reload();

      const reloadedOverviewResponseValue = await reloadedOverviewResponse;
      expect(reloadedOverviewResponseValue.status()).toBe(200);
      expect(new URL(reloadedOverviewResponseValue.url()).searchParams.get("compare")).toBe("previous");
      const reloadedOverviewPayload = await reloadedOverviewResponseValue.json() as Array<Record<string, any>>;
      expect(reloadedOverviewPayload.find((item) => item.ruleId === fixture.ruleId)).toMatchObject(expectedPayload);
      const reloadedDetailResponseValue = await reloadedDetailResponse;
      expect(reloadedDetailResponseValue.status()).toBe(200);
      expect(new URL(reloadedDetailResponseValue.url()).searchParams.get("compare")).toBe("previous");
      expect(await reloadedDetailResponseValue.json()).toMatchObject(expectedPayload);
      await assertRestoredView();
    });
  });

  test("manually picking two dates writes exact dates and restores them after reload", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-08-23T12:00:00.000Z") });
    await signInAsFixtureOwner(page, fixture);

    await page.goto("/vlasnik/automatizacije?period=30d");

    const selector = page.getByTestId("overview-period-selector");
    await expect(selector).toBeVisible();
    await selector.getByTestId("period-custom").click();

    const calendar = page.getByTestId("overview-period-selector-range-calendar");
    await expect(calendar).toBeVisible();
    const fromDate = new Date(2026, 7, 10);
    const toDate = new Date(2026, 7, 18);
    const fromDay = calendar.getByRole("gridcell").locator("button").filter({ hasText: /^10$/ });
    const toDay = calendar.getByRole("gridcell").locator("button").filter({ hasText: /^18$/ });
    await expect(fromDay).toHaveCount(1);
    await expect(toDay).toHaveCount(1);

    await fromDay.click();
    const statsResponse = nextOverviewStatsResponse(page, {
      period: null,
      from: toDateParam(fromDate),
      to: toDateParam(toDate),
    });
    await toDay.click();

    expect((await statsResponse).status()).toBe(200);
    await expect(page).toHaveURL(
      new RegExp(`/vlasnik/automatizacije\\?from=${toDateParam(fromDate)}&to=${toDateParam(toDate)}$`),
    );
    expect(new URL(page.url()).searchParams.get("period")).toBeNull();

    const expectedRangeLabel = ` ${fromDate.toLocaleDateString("sr-RS")} – ${toDate.toLocaleDateString("sr-RS")}`;
    const customButton = selector.getByTestId("period-custom");
    await expect(customButton).toHaveAttribute("aria-pressed", "true");
    await expect(customButton).toHaveText(expectedRangeLabel);

    const reloadStatsResponse = nextOverviewStatsResponse(page, {
      period: null,
      from: toDateParam(fromDate),
      to: toDateParam(toDate),
    });
    await page.reload();

    expect((await reloadStatsResponse).status()).toBe(200);
    const reloadedCustomButton = page.getByTestId("overview-period-selector")
      .getByTestId("period-custom");
    await expect(reloadedCustomButton).toHaveAttribute("aria-pressed", "true");
    await expect(reloadedCustomButton).toHaveText(expectedRangeLabel);
  });

  test("manually picking dates across calendar months keeps the inclusive range after close and reload", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-08-23T12:00:00.000Z") });
    await signInAsFixtureOwner(page, fixture);

    await page.goto("/vlasnik/automatizacije?period=30d");

    const selector = page.getByTestId("overview-period-selector");
    await expect(selector).toBeVisible();
    await selector.getByTestId("period-custom").click();

    const calendar = page.getByTestId("overview-period-selector-range-calendar");
    await expect(calendar).toBeVisible();

    // The calendar opens on the current month. Move to July, pick the last
    // day shown there, then move to August and pick an earlier day. This
    // exercises the pending-start state across a real month transition.
    const previousMonth = calendar.getByRole("button", { name: /prethodni mesec/i });
    const nextMonth = calendar.getByRole("button", { name: /sledeći mesec/i });
    await expect(previousMonth).toBeVisible();
    await previousMonth.click();

    const fromDate = new Date(2026, 6, 31);
    const toDate = new Date(2026, 7, 3);
    const fromDay = calendar.getByRole("gridcell").locator("button").filter({ hasText: /^31$/ });
    await expect(fromDay).toHaveCount(1);
    await fromDay.click();

    await nextMonth.click();
    // Outside days are visible, so text alone can match July 3 as well as
    // August 3. The Calendar wrapper exposes each button's local date marker;
    // use it to target the day in the displayed month precisely.
    const toDay = calendar.locator(`button[data-day="${toDate.toLocaleDateString()}"]`);
    await expect(toDay).toHaveCount(1);

    const statsResponse = nextOverviewStatsResponse(page, {
      period: null,
      from: toDateParam(fromDate),
      to: toDateParam(toDate),
    });
    await toDay.click();

    expect((await statsResponse).status()).toBe(200);
    await expect(page).toHaveURL(
      new RegExp(`/vlasnik/automatizacije\\?from=${toDateParam(fromDate)}&to=${toDateParam(toDate)}$`),
    );
    expect(new URL(page.url()).searchParams.get("period")).toBeNull();

    const expectedRangeLabel = ` ${fromDate.toLocaleDateString("sr-RS")} – ${toDate.toLocaleDateString("sr-RS")}`;
    const customButton = selector.getByTestId("period-custom");
    await expect(customButton).toHaveAttribute("aria-pressed", "true");
    await expect(customButton).toHaveText(expectedRangeLabel);
    await expect(calendar).toBeHidden();

    const reloadStatsResponse = nextOverviewStatsResponse(page, {
      period: null,
      from: toDateParam(fromDate),
      to: toDateParam(toDate),
    });
    await page.reload();

    expect((await reloadStatsResponse).status()).toBe(200);
    const reloadedCustomButton = page.getByTestId("overview-period-selector")
      .getByTestId("period-custom");
    await expect(reloadedCustomButton).toHaveAttribute("aria-pressed", "true");
    await expect(reloadedCustomButton).toHaveText(expectedRangeLabel);
  });

  test("keyboard-picking dates across calendar months keeps the inclusive range after close and reload", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-08-23T12:00:00.000Z") });
    await signInAsFixtureOwner(page, fixture);

    await page.goto("/vlasnik/automatizacije?period=30d");

    const selector = page.getByTestId("overview-period-selector");
    await expect(selector).toBeVisible();
    const customTrigger = selector.getByTestId("period-custom");
    await customTrigger.focus();
    await expect(customTrigger).toBeFocused();
    await page.keyboard.press("Enter");

    const calendar = page.getByTestId("overview-period-selector-range-calendar");
    await expect(calendar).toBeVisible();

    // Use the actual keyboard focus path for both month navigation and date
    // selection. The start must survive the month transition before the
    // second Enter completes the range.
    const previousMonth = calendar.getByRole("button", { name: /prethodni mesec/i });
    await previousMonth.focus();
    await expect(previousMonth).toBeFocused();
    await page.keyboard.press("Enter");

    const fromDate = new Date(2026, 6, 31);
    const toDate = new Date(2026, 7, 3);
    const fromDay = calendar.locator(`button[data-day="${fromDate.toLocaleDateString()}"]`);
    await expect(fromDay).toHaveCount(1);
    await fromDay.focus();
    await expect(fromDay).toBeFocused();
    await page.keyboard.press("Enter");

    const nextMonth = calendar.getByRole("button", { name: /sledeći mesec/i });
    await nextMonth.focus();
    await expect(nextMonth).toBeFocused();
    await page.keyboard.press("Enter");

    const toDay = calendar.locator(`button[data-day="${toDate.toLocaleDateString()}"]`);
    await expect(toDay).toHaveCount(1);
    await toDay.focus();
    await expect(toDay).toBeFocused();

    const statsResponse = nextOverviewStatsResponse(page, {
      period: null,
      from: toDateParam(fromDate),
      to: toDateParam(toDate),
    });
    await page.keyboard.press("Enter");

    expect((await statsResponse).status()).toBe(200);
    await expect(page).toHaveURL(
      new RegExp(`/vlasnik/automatizacije\\?from=${toDateParam(fromDate)}&to=${toDateParam(toDate)}$`),
    );
    expect(new URL(page.url()).searchParams.get("period")).toBeNull();

    const expectedRangeLabel = ` ${fromDate.toLocaleDateString("sr-RS")} – ${toDate.toLocaleDateString("sr-RS")}`;
    const customButton = selector.getByTestId("period-custom");
    await expect(customButton).toHaveAttribute("aria-pressed", "true");
    await expect(customButton).toHaveText(expectedRangeLabel);
    await expect(calendar).toBeHidden();
    await expect(customButton).toBeFocused();

    const reloadStatsResponse = nextOverviewStatsResponse(page, {
      period: null,
      from: toDateParam(fromDate),
      to: toDateParam(toDate),
    });
    await page.reload();

    expect((await reloadStatsResponse).status()).toBe(200);
    const reloadedCustomButton = page.getByTestId("overview-period-selector")
      .getByTestId("period-custom");
    await expect(reloadedCustomButton).toHaveAttribute("aria-pressed", "true");
    await expect(reloadedCustomButton).toHaveText(expectedRangeLabel);
  });

  test("campaign date picker exposes understandable month, focus, and range labels", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-08-23T12:00:00.000Z") });
    await signInAsFixtureOwner(page, fixture);

    await page.goto("/vlasnik/automatizacije?period=30d");

    const selector = page.getByTestId("overview-period-selector");
    await expect(selector).toBeVisible();
    const customTrigger = selector.getByTestId("period-custom");
    await customTrigger.click();

    const calendar = page.getByTestId("overview-period-selector-range-calendar");
    await expect(calendar).toBeVisible();
    await expect(calendar.getByRole("button", { name: "Prethodni mesec" })).toHaveAttribute(
      "aria-label",
      "Prethodni mesec",
    );
    await expect(calendar.getByRole("button", { name: "Sledeći mesec" })).toHaveAttribute(
      "aria-label",
      "Sledeći mesec",
    );
    await expect(calendar.getByRole("grid")).toHaveAttribute("aria-label", /2026/);

    const focusedDate = new Date(2026, 7, 10);
    const focusedDay = calendar.locator(`button[data-day="${focusedDate.toLocaleDateString()}"]`);
    await focusedDay.focus();
    await expect(focusedDay).toBeFocused();
    await expect(focusedDay).toHaveAttribute("aria-label", /10.*2026/);

    const previousMonth = calendar.getByRole("button", { name: "Prethodni mesec" });
    await previousMonth.click();
    const fromDate = new Date(2026, 6, 31);
    const fromDay = calendar.locator(`button[data-day="${fromDate.toLocaleDateString()}"]`);
    await expect(fromDay).toHaveAttribute("aria-label", /31.*2026/);
    await fromDay.click();

    const rangeStatus = page.getByTestId("overview-period-selector-range-status");
    await expect(rangeStatus).toContainText("Početak perioda");
    await expect(rangeStatus).toContainText("Izaberite krajnji datum");
    await expect(fromDay).toHaveAttribute("aria-label", /početak perioda.*izaberite krajnji datum/i);

    const nextMonth = calendar.getByRole("button", { name: "Sledeći mesec" });
    await nextMonth.click();
    const toDate = new Date(2026, 7, 3);
    const toDay = calendar.locator(`button[data-day="${toDate.toLocaleDateString()}"]`);
    await expect(toDay).toHaveAttribute("aria-label", /3.*2026/);

    const statsResponse = nextOverviewStatsResponse(page, {
      period: null,
      from: toDateParam(fromDate),
      to: toDateParam(toDate),
    });
    await toDay.click();
    expect((await statsResponse).status()).toBe(200);
    await expect(calendar).toBeHidden();
    await expect(customTrigger).toHaveAttribute(
      "aria-label",
      /izabran period od.*31.*2026.*3.*2026/i,
    );

    // Reopen the completed range to inspect the inclusive middle days too.
    await customTrigger.click();
    await expect(calendar).toBeVisible();
    const completedFromDay = calendar.locator(`button[data-day="${fromDate.toLocaleDateString()}"]`);
    await expect(completedFromDay).toHaveAttribute("aria-label", /početak izabranog perioda/i);

    await calendar.getByRole("button", { name: "Sledeći mesec" }).click();
    const middleDate = new Date(2026, 7, 1);
    const middleDay = calendar.locator(`button[data-day="${middleDate.toLocaleDateString()}"]`);
    await expect(middleDay).toHaveAttribute("aria-label", /u izabranom periodu/i);
    await expect(calendar.locator(`button[data-day="${toDate.toLocaleDateString()}"]`))
      .toHaveAttribute("aria-label", /kraj izabranog perioda/i);
  });

  test("an invalid ?period falls back to 'Sve vreme' and the URL is cleaned", async ({ page }) => {
    await signInAsFixtureOwner(page, fixture);

    // The fallback default requests the all-time window, never the raw
    // invalid value.
    const statsResponse = nextOverviewStatsResponse(page, { period: "all", from: null, to: null });
    await page.goto("/vlasnik/automatizacije?period=eternity");

    expect((await statsResponse).status()).toBe(200);

    const selector = page.getByTestId("overview-period-selector");
    await expect(selector).toBeVisible();
    await expect(selector.getByTestId("period-all")).toHaveAttribute("aria-pressed", "true");
    await expect(selector.getByTestId("period-all")).toHaveText("Sve vreme");

    // The URL-sync effect strips the invalid param in place (replace, not a
    // new history entry — going shared-link → cleaned URL must not add steps).
    await expect(page).toHaveURL(/\/vlasnik\/automatizacije$/);
  });

  test("a ?to in the future is clamped to today, and the URL reflects the clamp", async ({ page }) => {
    await signInAsFixtureOwner(page, fixture);

    // Dates are computed relative to the test run so they stay past/future
    // forever: from = first day of last month, to = one year from now.
    const now = new Date();
    const fromParam = toDateParam(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const futureToParam = toDateParam(new Date(now.getFullYear() + 1, now.getMonth(), 1));
    const todayParam = toDateParam(now);

    // The stats request must already use the clamped end date — never the
    // future one the link carried (the calendar disables days after today).
    const statsResponse = nextOverviewStatsResponse(page, { period: null, from: fromParam, to: todayParam });
    await page.goto(`/vlasnik/automatizacije?from=${fromParam}&to=${futureToParam}`);

    expect((await statsResponse).status()).toBe(200);

    const selector = page.getByTestId("overview-period-selector");
    await expect(selector).toBeVisible();
    const customButton = selector.getByTestId("period-custom");
    await expect(customButton).toHaveAttribute("aria-pressed", "true");
    await expect(customButton).not.toContainText("Izaberi datume");

    // The URL-sync effect rewrites the shared link to the clamped range, so
    // what the owner re-shares matches what is actually shown.
    await expect(page).toHaveURL(
      new RegExp(`/vlasnik/automatizacije\\?from=${fromParam}&to=${todayParam}$`),
    );
  });

  test("switching salons preserves a preset for overview and campaign detail", async ({ page }) => {
    await resetFixtureActiveSalon(fixture, fixture.salonId);
    await signInAsFixtureOwner(page, fixture);

    const initialOverview = nextOverviewStatsResponse(page, { period: "30d", from: null, to: null });
    await page.goto("/vlasnik/automatizacije?period=30d");
    expect((await initialOverview).status()).toBe(200);
    await expect(page.getByTestId(`overview-row-${fixture.ruleId}`)).toBeVisible();

    const salonSelect = page.getByLabel("Aktivni salon");
    await expect(salonSelect).toHaveValue(fixture.salonId);
    const switchResponse = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && new URL(response.url()).pathname === "/api/salon/active-salon",
    );
    const switchedOverview = nextOverviewStatsResponse(page, { period: "30d", from: null, to: null });
    await salonSelect.selectOption(fixture.secondSalonId);

    expect((await switchResponse).status()).toBe(200);
    expect((await switchedOverview).status()).toBe(200);
    await expect(page).toHaveURL(/\/vlasnik\/automatizacije\?period=30d$/);
    await expect(page.getByLabel("Aktivni salon")).toHaveValue(fixture.secondSalonId);
    await expect(page.getByTestId(`overview-row-${fixture.secondRuleId}`)).toBeVisible();
    await expect(page.getByTestId(`overview-row-${fixture.ruleId}`)).toHaveCount(0);

    const detailStats = nextAutomationStatsResponse(page, fixture.secondRuleId, { period: "30d", from: null, to: null });
    await page.getByTestId(`overview-row-${fixture.secondRuleId}`).getByRole("button").click();
    expect((await detailStats).status()).toBe(200);
    await expect(page.getByTestId("stats-period-selector").getByTestId("period-30d"))
      .toHaveAttribute("aria-pressed", "true");
  });

  test("switching salons preserves a custom range for overview and campaign detail", async ({ page }) => {
    await resetFixtureActiveSalon(fixture, fixture.salonId);
    await signInAsFixtureOwner(page, fixture);

    const expected = { period: null, from: "2026-03-01", to: "2026-03-31" };
    const initialOverview = nextOverviewStatsResponse(page, expected);
    await page.goto("/vlasnik/automatizacije?from=2026-03-01&to=2026-03-31");
    expect((await initialOverview).status()).toBe(200);
    await expect(page.getByTestId("overview-period-selector").getByTestId("period-custom"))
      .toContainText("2026");

    const salonSelect = page.getByLabel("Aktivni salon");
    const switchResponse = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && new URL(response.url()).pathname === "/api/salon/active-salon",
    );
    const switchedOverview = nextOverviewStatsResponse(page, expected);
    await salonSelect.selectOption(fixture.secondSalonId);

    expect((await switchResponse).status()).toBe(200);
    expect((await switchedOverview).status()).toBe(200);
    await expect(page).toHaveURL(/\/vlasnik\/automatizacije\?from=2026-03-01&to=2026-03-31$/);
    await expect(page.getByLabel("Aktivni salon")).toHaveValue(fixture.secondSalonId);
    await expect(page.getByTestId("overview-period-selector").getByTestId("period-custom"))
      .toContainText("2026");

    const detailStats = nextAutomationStatsResponse(page, fixture.secondRuleId, expected);
    await page.getByTestId(`overview-row-${fixture.secondRuleId}`).getByRole("button").click();
    expect((await detailStats).status()).toBe(200);
    await expect(page.getByTestId("stats-period-selector").getByTestId("period-custom"))
      .toContainText("2026");
  });

  test("keeps a selected preset visible after the last campaign is deleted and the page reloads", async ({ page }) => {
    // This regression gets its own fixture because deletion is intentionally
    // destructive and must not affect the shared period-link scenarios.
    const deletionFixture = await createFixture();
    try {
      await resetFixtureActiveSalon(deletionFixture, deletionFixture.salonId);
      await signInAsFixtureOwner(page, deletionFixture);

      const expected = { period: "30d", from: null, to: null };
      const overviewResponse = nextOverviewStatsResponse(page, expected);
      await page.goto("/vlasnik/automatizacije?period=30d");
      expect((await overviewResponse).status()).toBe(200);

      const selector = page.getByTestId("overview-period-selector");
      await expect(selector.getByTestId("period-30d")).toHaveAttribute("aria-pressed", "true");

      page.once("dialog", (dialog) => dialog.accept());
      const deleteResponse = page.waitForResponse((response) =>
        response.request().method() === "DELETE"
        && new URL(response.url()).pathname.endsWith(`/automations/${deletionFixture.ruleId}`),
      );
      const campaignCard = page.getByText("Browser period URL kampanja").last()
        .locator("xpath=ancestor::div[contains(@class, 'rounded-xl')][1]");
      await campaignCard.getByRole("button").last().click();
      expect((await deleteResponse).status()).toBe(204);

      await expect(page.getByTestId(`overview-row-${deletionFixture.ruleId}`)).toHaveCount(0);
      await expect(selector.getByTestId("period-30d")).toHaveAttribute("aria-pressed", "true");
      await expect(page).toHaveURL("/vlasnik/automatizacije?period=30d");

      const reloadResponse = nextOverviewStatsResponse(page, expected);
      await page.reload();
      expect((await reloadResponse).status()).toBe(200);
      await expect(page.getByTestId("campaign-overview-empty")).toBeVisible();
      await expect(page.getByTestId("overview-period-selector").getByTestId("period-30d"))
        .toHaveAttribute("aria-pressed", "true");
      await expect(page).toHaveURL("/vlasnik/automatizacije?period=30d");
    } finally {
      await cleanUpFixture(deletionFixture);
    }
  });

  test("keeps a complete custom range visible after the last campaign is deleted and the page reloads", async ({ page }) => {
    // Keep this fixture separate from the preset deletion test as both remove
    // their final campaign.
    const deletionFixture = await createFixture();
    try {
      await resetFixtureActiveSalon(deletionFixture, deletionFixture.salonId);
      await signInAsFixtureOwner(page, deletionFixture);

      const expected = { period: null, from: "2026-03-01", to: "2026-03-31" };
      const expectedUrl = `/vlasnik/automatizacije?from=${expected.from}&to=${expected.to}`;
      const overviewResponse = nextOverviewStatsResponse(page, expected);
      await page.goto(expectedUrl);
      expect((await overviewResponse).status()).toBe(200);

      const selector = page.getByTestId("overview-period-selector");
      const customButton = selector.getByTestId("period-custom");
      await expect(customButton).toHaveAttribute("aria-pressed", "true");
      await expect(customButton).toContainText("2026");

      page.once("dialog", (dialog) => dialog.accept());
      const deleteResponse = page.waitForResponse((response) =>
        response.request().method() === "DELETE"
        && new URL(response.url()).pathname.endsWith(`/automations/${deletionFixture.ruleId}`),
      );
      const campaignCard = page.getByText("Browser period URL kampanja").last()
        .locator("xpath=ancestor::div[contains(@class, 'rounded-xl')][1]");
      await campaignCard.getByRole("button").last().click();
      expect((await deleteResponse).status()).toBe(204);

      await expect(page.getByTestId(`overview-row-${deletionFixture.ruleId}`)).toHaveCount(0);
      await expect(customButton).toHaveAttribute("aria-pressed", "true");
      await expect(customButton).toContainText("1. 3. 2026.");
      await expect(customButton).toContainText("31. 3. 2026.");
      await expect(page).toHaveURL(expectedUrl);

      const reloadResponse = nextOverviewStatsResponse(page, expected);
      await page.reload();
      expect((await reloadResponse).status()).toBe(200);
      const reloadedCustomButton = page.getByTestId("overview-period-selector")
        .getByTestId("period-custom");
      await expect(page.getByTestId("campaign-overview-empty")).toBeVisible();
      await expect(reloadedCustomButton).toHaveAttribute("aria-pressed", "true");
      await expect(reloadedCustomButton).toContainText("1. 3. 2026.");
      await expect(reloadedCustomButton).toContainText("31. 3. 2026.");
      await expect(page).toHaveURL(expectedUrl);
    } finally {
      await cleanUpFixture(deletionFixture);
    }
  });
});
