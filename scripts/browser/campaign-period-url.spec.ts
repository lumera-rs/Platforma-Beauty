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
 *  6. Browser Back/Forward → preset windows are restored in the overview and
 *     stats dialog without dropping an unrelated tracking parameter.
 *  7. Browser Back/Forward → valid custom windows are restored in the overview
 *     and stats dialog with their exact from/to values.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page, type Response } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  automationRulesTable,
  db,
  salonsTable,
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
    if (!owner) throw new Error("Period-URL browser fixture could not create its owner.");
    ownerId = owner.id;

    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id,
      name: `Browser salon za period URL ${suffix}`,
      slug: `browser-period-url-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 93",
      phone: "+381110000093",
      email: `browser-period-url-salon-${suffix}@example.test`,
      shortDescription: "Izolovan salon za proveru URL perioda kampanja.",
      description: "Salon je napravljen samo za browser regresioni test deljivih linkova perioda.",
      imageUrl: "/test-browser-period-url.jpg",
    }).returning({ id: salonsTable.id });
    if (!salon) throw new Error("Period-URL browser fixture could not create its salon.");
    salonId = salon.id;

    await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));

    const [rule] = await db.insert(automationRulesTable).values({
      salonId: salon.id,
      name: `Browser period URL kampanja ${suffix}`,
      trigger: "inactive_days",
      triggerConfig: { inactiveDays: 30 },
      action: "send_email",
      emailSubject: "Test",
      emailBody: "Test",
      status: "active",
    }).returning({ id: automationRulesTable.id });
    if (!rule) throw new Error("Period-URL browser fixture could not create its rule.");

    return { ownerEmail, ownerPassword, ownerId: owner.id, salonId: salon.id, ruleId: rule.id };
  } catch (error) {
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpFixture(fixture: Fixture): Promise<void> {
  // Salon delete cascades the automation rule.
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
});
