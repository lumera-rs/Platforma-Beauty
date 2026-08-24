/**
 * Restore-defaults-through-conflict on retention settings — browser regression.
 *
 * The second restore flavor, "Vrati podrazumevane vrednosti" (changeSource
 * restore_defaults), shares the single write path (performUpdate with
 * expectedVersion) with manual saves and version restores on /admin/retencija.
 * scripts/browser/retention-restore-conflict.spec.ts already proves the
 * conflict interplay for version restores; this spec proves the same contract
 * for the defaults restore:
 *
 *  1. Active settings differ from the platform defaults, so admin A can open
 *     the defaults-restore dialog (restore-retention-defaults) while admin B
 *     saves a different non-default value through
 *     PUT /api/growth/admin/retention-settings.
 *  2. Confirming the restore must be rejected with 409 and open the conflict
 *     dialog (retention-conflict-dialog) — not silently overwrite admin B's
 *     values and not fall back to a generic error toast.
 *  3. Re-confirming (confirm-retention-conflict) retries against the
 *     refreshed version and the new active version keeps its truthful
 *     defaults-restore audit label ("Vraćene podrazumevane vrednosti" /
 *     changeSource restore_defaults) on the active-settings badge, in the
 *     history, and in the API payload.
 *
 * Cleanup follows the sibling retention specs: the max version is captured
 * before the test and every row above that watermark is deleted afterwards,
 * restoring the pre-test active settings exactly.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, request, test } from "@playwright/test";
import { gt, inArray } from "drizzle-orm";
import { db, platformRetentionSettingsTable, usersTable } from "@workspace/db";
import { acquireRetentionSettingsLock } from "./retention-settings-lock";

const scrypt = promisify(scryptCallback);

const baseURL = process.env.LUMERA_WEB_BASE_URL ?? "http://localhost:80";
const settingsPath = "/api/growth/admin/retention-settings";

/**
 * The platform defaults the restore writes back. Kept in the spec so the
 * assertions are self-describing; the test cross-checks them against the
 * `defaults` object the API reports before relying on them, so a drift in
 * the platform defaults fails loudly instead of asserting the wrong values.
 */
const PLATFORM_DEFAULTS = {
  newCustomerWindowDays: 45,
  defaultIntervalDays: 45,
  atRiskIntervalPercent: 150,
  lostIntervalPercent: 250,
  lostMinimumDays: 180,
  vipMinCompletedVisits: 5,
  vipSpendPercentOfMedian: 200,
};

/**
 * The non-default value that makes the defaults-restore button appear for
 * admin A (active settings must differ from the defaults).
 */
const NON_DEFAULT_WINDOW_DAYS = 30;
/**
 * The different non-default value admin B saves while admin A's
 * defaults-restore dialog is open. Distinct from the default (45) so the
 * re-confirmed restore stays a real change (never a NO_OP_RESTORE), and
 * distinct from the first non-default value (30) so the conflict diff is
 * unambiguous about which value it crosses out.
 */
const ADMIN_B_WINDOW_DAYS = 21;
/** The second active value used to prove repeated polling stays current. */
const SECOND_ADMIN_B_WINDOW_DAYS = 18;
/** The value admin A types but must retain while the background poll runs. */
const UNSAVED_WINDOW_DAYS = 60;

const suffix = randomUUID();
const password = "browser-retention-defaults-conflict-password";
const adminA = { email: `browser-retention-defaults-admin-a-${suffix}@example.test` };
const adminB = { email: `browser-retention-defaults-admin-b-${suffix}@example.test` };

const createdUserIds: string[] = [];
let versionWatermark = 0;
let releaseRetentionSettingsLock: (() => Promise<void>) | undefined;

async function hashPassword(value: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(value, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

test.beforeAll(async () => {
  // A sibling retention spec may hold the lock for its full test; wait it out.
  test.setTimeout(300_000);
  // Serialize with the sibling retention specs: the watermark below is only
  // safe while no other file writes retention versions concurrently.
  releaseRetentionSettingsLock = await acquireRetentionSettingsLock();

  // Watermark: versions recorded by this run are removed afterwards.
  const versions = await db
    .select({ version: platformRetentionSettingsTable.version })
    .from(platformRetentionSettingsTable);
  versionWatermark = versions.reduce((max, row) => Math.max(max, row.version), 0);

  const passwordHash = await hashPassword(password);
  const inserted = await db.insert(usersTable).values([
    {
      firstName: "Browser",
      lastName: "Defaults Admin A",
      email: adminA.email,
      passwordHash,
      passwordSetAt: new Date(),
      role: "ADMIN",
    },
    {
      firstName: "Browser",
      lastName: "Defaults Admin B",
      email: adminB.email,
      passwordHash,
      passwordSetAt: new Date(),
      role: "ADMIN",
    },
  ]).returning();
  if (inserted.length !== 2) throw new Error("The defaults-conflict fixture could not create both admins.");
  createdUserIds.push(...inserted.map((user) => user.id));
});

test.afterAll(async () => {
  try {
    // Remove only rows created by this run; earlier versions stay untouched,
    // so the pre-test active settings become the highest (active) version
    // again.
    await db.delete(platformRetentionSettingsTable)
      .where(gt(platformRetentionSettingsTable.version, versionWatermark));
    if (createdUserIds.length > 0) {
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    }
  } finally {
    // Only hand the table to the next retention spec once cleanup restored
    // the pre-test state.
    await releaseRetentionSettingsLock?.();
  }
});

test("a defaults restore from a stale page opens the conflict dialog and re-confirm keeps the defaults label", async ({ page }) => {
  test.setTimeout(120_000);

  // Admin B works through a separate API session, like a second browser.
  const apiB = await request.newContext({ baseURL });
  try {
    const loginB = await apiB.post("/api/auth/login", {
      data: { email: adminB.email, password },
    });
    expect(loginB.ok(), "admin B must be able to sign in").toBe(true);

    // Guard the hardcoded defaults against drift before asserting with them.
    const before = await (await apiB.get(settingsPath)).json();
    expect(before.defaults, "the platform defaults the spec assumes must match the API")
      .toEqual(PLATFORM_DEFAULTS);

    // Version 1 of this run: a non-default value, so the active settings
    // differ from the defaults and the restore-defaults button appears.
    const nonDefaultResponse = await apiB.put(settingsPath, {
      data: {
        ...PLATFORM_DEFAULTS,
        newCustomerWindowDays: NON_DEFAULT_WINDOW_DAYS,
        expectedVersion: before.version,
      },
    });
    expect(nonDefaultResponse.ok(), "the non-default save must succeed").toBe(true);
    const nonDefaultVersion = (await nonDefaultResponse.json()).version as number;
    expect(nonDefaultVersion).toBeGreaterThan(versionWatermark);

    // Admin A signs in and loads the settings page at the non-default version.
    const loginA = await page.request.post("/api/auth/login", {
      data: { email: adminA.email, password },
    });
    expect(loginA.ok(), "admin A must be able to sign in").toBe(true);
    await page.goto("/admin/retencija");

    await expect(page.getByTestId("retention-settings-version")).toHaveText(`Verzija ${nonDefaultVersion}`);
    await expect(page.getByTestId("input-newCustomerWindowDays"))
      .toHaveValue(String(NON_DEFAULT_WINDOW_DAYS));

    // Admin A opens the defaults-restore dialog. The dialog's diff crosses
    // out the currently active value (30 → 45).
    await page.getByTestId("restore-retention-defaults").click();
    const restoreDialog = page.getByTestId("restore-retention-dialog");
    await expect(restoreDialog).toBeVisible();
    await expect(restoreDialog).toContainText("Vrati podrazumevane vrednosti platforme?");
    await expect(restoreDialog.locator(".line-through")).toHaveText(String(NON_DEFAULT_WINDOW_DAYS));
    await expect(restoreDialog).toContainText(String(PLATFORM_DEFAULTS.newCustomerWindowDays));

    // While the dialog is open, admin B saves a different non-default value
    // first — the active version moves on underneath admin A's page. The
    // value stays non-default so the re-confirmed restore remains a real
    // change (never a NO_OP_RESTORE).
    const concurrentResponse = await apiB.put(settingsPath, {
      data: {
        ...PLATFORM_DEFAULTS,
        newCustomerWindowDays: ADMIN_B_WINDOW_DAYS,
        expectedVersion: nonDefaultVersion,
      },
    });
    expect(concurrentResponse.ok(), "admin B's concurrent save must succeed").toBe(true);
    expect((await concurrentResponse.json()).version).toBe(nonDefaultVersion + 1);

    // Admin A confirms the restore → the server answers 409 and the restore
    // dialog is replaced by the conflict dialog.
    const conflictSave = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && new URL(response.url()).pathname === settingsPath,
    );
    await page.getByTestId("confirm-restore-retention").click();
    expect((await conflictSave).status(), "the stale defaults restore must be rejected with 409").toBe(409);

    const conflictDialog = page.getByTestId("retention-conflict-dialog");
    await expect(conflictDialog).toBeVisible();
    await expect(restoreDialog).not.toBeVisible();

    // The diff compares admin B's just-saved value with the pending default
    // values (the page refetches the newer settings when the conflict hits).
    const conflictDiff = page.getByTestId("retention-conflict-diff");
    await expect(conflictDiff.locator(".line-through")).toHaveText(String(ADMIN_B_WINDOW_DAYS));
    await expect(conflictDiff).toContainText(String(PLATFORM_DEFAULTS.newCustomerWindowDays));

    // Nothing was silently overwritten: admin B's version is still active.
    const activeDuringConflict = await (await apiB.get(settingsPath)).json();
    expect(activeDuringConflict.version).toBe(nonDefaultVersion + 1);
    expect(activeDuringConflict.thresholds.newCustomerWindowDays).toBe(ADMIN_B_WINDOW_DAYS);

    // Re-confirm retries against the refreshed version and succeeds.
    const retriedSave = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && new URL(response.url()).pathname === settingsPath,
    );
    await page.getByTestId("confirm-retention-conflict").click();
    expect((await retriedSave).status(), "the re-confirmed defaults restore must succeed").toBe(200);
    await expect(conflictDialog).not.toBeVisible();

    const finalVersion = nonDefaultVersion + 2;
    await expect(page.getByTestId("retention-settings-version")).toHaveText(`Verzija ${finalVersion}`);
    await expect(page.getByTestId("input-newCustomerWindowDays"))
      .toHaveValue(String(PLATFORM_DEFAULTS.newCustomerWindowDays));

    // The re-confirmed version keeps its truthful defaults-restore label —
    // on the active-settings badge and in the history entry for the new
    // version.
    await expect(page.getByTestId("retention-settings-source"))
      .toHaveText("Vraćene podrazumevane vrednosti");
    await expect(page.getByTestId(`retention-source-v${finalVersion}`))
      .toHaveText("Vraćene podrazumevane vrednosti");
    await expect(page.getByTestId(`retention-active-v${finalVersion}`)).toBeVisible();

    // The active settings now equal the defaults, so the restore-defaults
    // button disappears (nothing left to restore).
    await expect(page.getByTestId("restore-retention-defaults")).not.toBeVisible();

    // The API payload records the defaults-restore provenance, not a manual
    // save and not a version restore.
    const activeAfterConfirm = await (await apiB.get(settingsPath)).json();
    expect(activeAfterConfirm.version).toBe(finalVersion);
    expect(activeAfterConfirm.changeSource).toBe("restore_defaults");
    expect(activeAfterConfirm.restoredFromVersion).toBeNull();
    expect(activeAfterConfirm.thresholds).toEqual(PLATFORM_DEFAULTS);
  } finally {
    await apiB.dispose();
  }
});

test("a live refetch disables restore defaults after another admin saves the defaults", async ({ page }) => {
  test.setTimeout(120_000);

  const apiB = await request.newContext({ baseURL });
  try {
    const loginB = await apiB.post("/api/auth/login", {
      data: { email: adminB.email, password },
    });
    expect(loginB.ok(), "admin B must be able to sign in").toBe(true);

    // Start from a known non-default active version so the defaults restore
    // action is available and its dialog initially shows a real diff.
    const before = await (await apiB.get(settingsPath)).json();
    const nonDefaultResponse = await apiB.put(settingsPath, {
      data: {
        ...PLATFORM_DEFAULTS,
        newCustomerWindowDays: NON_DEFAULT_WINDOW_DAYS,
        expectedVersion: before.version,
      },
    });
    expect(nonDefaultResponse.ok(), "the non-default save must succeed").toBe(true);
    const nonDefaultVersion = (await nonDefaultResponse.json()).version as number;
    expect(nonDefaultVersion).toBeGreaterThan(versionWatermark);

    const loginA = await page.request.post("/api/auth/login", {
      data: { email: adminA.email, password },
    });
    expect(loginA.ok(), "admin A must be able to sign in").toBe(true);
    await page.goto("/admin/retencija");

    await expect(page.getByTestId("retention-settings-version"))
      .toHaveText(`Verzija ${nonDefaultVersion}`);
    await expect(page.getByTestId("input-newCustomerWindowDays"))
      .toHaveValue(String(NON_DEFAULT_WINDOW_DAYS));

    // Admin A opens the defaults dialog while the active thresholds differ
    // from the defaults.
    await page.getByTestId("restore-retention-defaults").click();
    const restoreDialog = page.getByTestId("restore-retention-dialog");
    await expect(restoreDialog).toBeVisible();
    await expect(restoreDialog.locator(".line-through"))
      .toHaveText(String(NON_DEFAULT_WINDOW_DAYS));
    await expect(page.getByTestId("restore-retention-noop-notice")).not.toBeVisible();
    await expect(page.getByTestId("confirm-restore-retention")).toBeEnabled();

    // While the dialog is open, admin B applies the exact defaults that
    // admin A was about to restore.
    const defaultsResponse = await apiB.put(settingsPath, {
      data: { ...PLATFORM_DEFAULTS, expectedVersion: nonDefaultVersion },
    });
    expect(defaultsResponse.ok(), "admin B's defaults save must succeed").toBe(true);
    const adminBVersion = (await defaultsResponse.json()).version as number;

    // The page's visibility/focus refetch must update the open dialog, not
    // leave the stale diff and enabled confirm action on screen.
    const settingsRefetch = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === settingsPath
      && response.status() === 200,
    );
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await settingsRefetch;

    await expect(page.getByTestId("retention-settings-version"))
      .toHaveText(`Verzija ${adminBVersion}`);
    await expect(page.getByTestId("restore-retention-noop-notice")).toBeVisible();
    await expect(restoreDialog.locator(".line-through")).toHaveCount(0);
    await expect(page.getByTestId("confirm-restore-retention")).toBeDisabled();

    // Closing the disabled dialog must not write another version or change
    // admin B's active defaults.
    await page.getByTestId("cancel-restore-retention").click();
    await expect(restoreDialog).not.toBeVisible();
    await expect(page.getByTestId("retention-settings-version"))
      .toHaveText(`Verzija ${adminBVersion}`);

    const historyAfterClose = await (await page.request.get(settingsPath + "/history")).json();
    expect(
      Math.max(...historyAfterClose.map((entry: { version: number }) => entry.version)),
      "closing the disabled defaults dialog must not append a version",
    ).toBe(adminBVersion);
    expect(historyAfterClose.some(
      (entry: { version: number }) => entry.version === adminBVersion,
    )).toBe(true);

    const activeAfterClose = await (await apiB.get(settingsPath)).json();
    expect(activeAfterClose.version).toBe(adminBVersion);
    expect(activeAfterClose.thresholds).toEqual(PLATFORM_DEFAULTS);
  } finally {
    await apiB.dispose();
  }
});

test("the polling refetch disables restore defaults after another admin saves the defaults", async ({ page }) => {
  test.setTimeout(120_000);

  // Freeze browser timers so this test advances the configured 30-second
  // polling interval without waiting in real time or triggering visibility.
  await page.clock.install();

  const apiB = await request.newContext({ baseURL });
  try {
    const loginB = await apiB.post("/api/auth/login", {
      data: { email: adminB.email, password },
    });
    expect(loginB.ok(), "admin B must be able to sign in").toBe(true);

    // Start from a known non-default active version so the defaults restore
    // action is available and its dialog initially shows a real diff.
    const before = await (await apiB.get(settingsPath)).json();
    const nonDefaultResponse = await apiB.put(settingsPath, {
      data: {
        ...PLATFORM_DEFAULTS,
        newCustomerWindowDays: NON_DEFAULT_WINDOW_DAYS,
        expectedVersion: before.version,
      },
    });
    expect(nonDefaultResponse.ok(), "the non-default save must succeed").toBe(true);
    const nonDefaultVersion = (await nonDefaultResponse.json()).version as number;
    expect(nonDefaultVersion).toBeGreaterThan(versionWatermark);

    const loginA = await page.request.post("/api/auth/login", {
      data: { email: adminA.email, password },
    });
    expect(loginA.ok(), "admin A must be able to sign in").toBe(true);
    await page.goto("/admin/retencija");

    await expect(page.getByTestId("retention-settings-version"))
      .toHaveText(`Verzija ${nonDefaultVersion}`);
    await expect(page.getByTestId("input-newCustomerWindowDays"))
      .toHaveValue(String(NON_DEFAULT_WINDOW_DAYS));

    // Admin A opens the defaults dialog while the active thresholds differ
    // from the defaults.
    await page.getByTestId("restore-retention-defaults").click();
    const restoreDialog = page.getByTestId("restore-retention-dialog");
    await expect(restoreDialog).toBeVisible();
    await expect(restoreDialog.locator(".line-through"))
      .toHaveText(String(NON_DEFAULT_WINDOW_DAYS));
    await expect(page.getByTestId("restore-retention-noop-notice")).not.toBeVisible();
    await expect(page.getByTestId("confirm-restore-retention")).toBeEnabled();

    // While the dialog is open, admin B applies the exact defaults that
    // admin A was about to restore.
    const defaultsResponse = await apiB.put(settingsPath, {
      data: { ...PLATFORM_DEFAULTS, expectedVersion: nonDefaultVersion },
    });
    expect(defaultsResponse.ok(), "admin B's defaults save must succeed").toBe(true);
    const adminBVersion = (await defaultsResponse.json()).version as number;

    // Do not dispatch visibilitychange or move focus. Fast-forwarding one
    // configured polling interval must refetch the active settings and update
    // the already-open dialog.
    const settingsRefetch = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === settingsPath
      && response.status() === 200,
    );
    await page.clock.fastForward(30_000);
    await settingsRefetch;

    await expect(page.getByTestId("retention-settings-version"))
      .toHaveText(`Verzija ${adminBVersion}`);
    await expect(page.getByTestId("restore-retention-noop-notice")).toBeVisible();
    await expect(restoreDialog.locator(".line-through")).toHaveCount(0);
    await expect(page.getByTestId("confirm-restore-retention")).toBeDisabled();

    // Closing the disabled dialog must not write another version or change
    // admin B's active defaults.
    await page.getByTestId("cancel-restore-retention").click();
    await expect(restoreDialog).not.toBeVisible();
    await expect(page.getByTestId("retention-settings-version"))
      .toHaveText(`Verzija ${adminBVersion}`);

    const historyAfterClose = await (await page.request.get(settingsPath + "/history")).json();
    expect(
      Math.max(...historyAfterClose.map((entry: { version: number }) => entry.version)),
      "closing the disabled defaults dialog must not append a version",
    ).toBe(adminBVersion);
    expect(historyAfterClose.some(
      (entry: { version: number }) => entry.version === adminBVersion,
    )).toBe(true);

    const activeAfterClose = await (await apiB.get(settingsPath)).json();
    expect(activeAfterClose.version).toBe(adminBVersion);
    expect(activeAfterClose.thresholds).toEqual(PLATFORM_DEFAULTS);
  } finally {
    await apiB.dispose();
  }
});

test("background polling preserves unsaved edits until newer values are loaded explicitly", async ({ page }) => {
  test.setTimeout(120_000);
  const historyPath = `${settingsPath}/history`;

  // Install the clock before navigation so the query's interval is controlled
  // from the moment the settings page mounts. No visibility or focus event is
  // used: this specifically covers the background polling path.
  await page.clock.install();

  const apiB = await request.newContext({ baseURL });
  try {
    const loginB = await apiB.post("/api/auth/login", {
      data: { email: adminB.email, password },
    });
    expect(loginB.ok(), "admin B must be able to sign in").toBe(true);

    // Start from a deterministic active version before admin A opens the page.
    const before = await (await apiB.get(settingsPath)).json();
    const baselineResponse = await apiB.put(settingsPath, {
      data: {
        ...PLATFORM_DEFAULTS,
        newCustomerWindowDays: NON_DEFAULT_WINDOW_DAYS,
        expectedVersion: before.version,
      },
    });
    expect(baselineResponse.ok(), "the baseline save must succeed").toBe(true);
    const baselineVersion = (await baselineResponse.json()).version as number;
    expect(baselineVersion).toBeGreaterThan(versionWatermark);

    const loginA = await page.request.post("/api/auth/login", {
      data: { email: adminA.email, password },
    });
    expect(loginA.ok(), "admin A must be able to sign in").toBe(true);
    await page.goto("/admin/retencija");

    const windowInput = page.getByTestId("input-newCustomerWindowDays");
    await expect(page.getByTestId("retention-settings-version"))
      .toHaveText(`Verzija ${baselineVersion}`);
    await expect(windowInput).toHaveValue(String(NON_DEFAULT_WINDOW_DAYS));
    await expect(page.getByTestId(`retention-history-v${baselineVersion}`)).toBeVisible();

    // Admin A edits a threshold but leaves the value unsaved.
    await windowInput.fill(String(UNSAVED_WINDOW_DAYS));

    // Admin B saves a different active version while A's draft is still open.
    const concurrentResponse = await apiB.put(settingsPath, {
      data: {
        ...PLATFORM_DEFAULTS,
        newCustomerWindowDays: ADMIN_B_WINDOW_DAYS,
        expectedVersion: baselineVersion,
      },
    });
    expect(concurrentResponse.ok(), "admin B's concurrent save must succeed").toBe(true);
    const adminBVersion = (await concurrentResponse.json()).version as number;

    const settingsRefetch = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === settingsPath
      && response.status() === 200,
    );
    const historyRefetch = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === historyPath
      && response.status() === 200,
    );
    await page.clock.fastForward(30_000);
    await settingsRefetch;
    await historyRefetch;

    // Polling exposes the newer active version without overwriting A's draft.
    await expect(page.getByTestId("retention-settings-version"))
      .toHaveText(`Verzija ${adminBVersion}`);
    await expect(windowInput).toHaveValue(String(UNSAVED_WINDOW_DAYS));
    await expect(page.getByTestId(`retention-history-v${adminBVersion}`)).toBeVisible();
    await expect(page.getByTestId("retention-stale-banner")).toBeVisible();
    await expect(page.getByTestId("retention-stale-banner"))
      .toContainText(`Verzija ${adminBVersion} je u međuvremenu aktivirana`);

    // A second remote save must refresh the timeline again even though the
    // page was already stale; only the explicit action may replace the draft.
    const secondConcurrentResponse = await apiB.put(settingsPath, {
      data: {
        ...PLATFORM_DEFAULTS,
        newCustomerWindowDays: SECOND_ADMIN_B_WINDOW_DAYS,
        expectedVersion: adminBVersion,
      },
    });
    expect(secondConcurrentResponse.ok(), "the second concurrent save must succeed").toBe(true);
    const secondAdminBVersion = (await secondConcurrentResponse.json()).version as number;

    const secondSettingsRefetch = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === settingsPath
      && response.status() === 200,
    );
    const secondHistoryRefetch = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === historyPath
      && response.status() === 200,
    );
    await page.clock.fastForward(30_000);
    await secondSettingsRefetch;
    await secondHistoryRefetch;

    await expect(page.getByTestId("retention-settings-version"))
      .toHaveText(`Verzija ${secondAdminBVersion}`);
    await expect(page.getByTestId(`retention-history-v${secondAdminBVersion}`)).toBeVisible();
    await expect(windowInput).toHaveValue(String(UNSAVED_WINDOW_DAYS));

    // Only the explicit action may replace the in-progress values.
    await page.getByTestId("load-stale-retention-settings").click();
    await expect(windowInput).toHaveValue(String(SECOND_ADMIN_B_WINDOW_DAYS));
    await expect(page.getByTestId("retention-stale-banner")).not.toBeVisible();
    await expect(page.getByTestId("retention-settings-version"))
      .toHaveText(`Verzija ${secondAdminBVersion}`);
  } finally {
    await apiB.dispose();
  }
});

test("failed background refresh shows a retry warning and preserves unsaved edits", async ({ page }) => {
  test.setTimeout(120_000);

  let failSettingsRefresh = false;
  let allowSettingsRefresh = false;
  await page.route(`**${settingsPath}`, async (route) => {
    if (
      failSettingsRefresh
      && !allowSettingsRefresh
      && route.request().method() === "GET"
    ) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Privremeno nedostupno" }),
      });
      return;
    }
    await route.continue();
  });

  // Install the clock before navigation so the query's interval is controlled
  // from the moment the settings page mounts.
  await page.clock.install();

  const apiB = await request.newContext({ baseURL });
  try {
    const loginB = await apiB.post("/api/auth/login", {
      data: { email: adminB.email, password },
    });
    expect(loginB.ok(), "admin B must be able to sign in").toBe(true);

    const before = await (await apiB.get(settingsPath)).json();
    const baselineResponse = await apiB.put(settingsPath, {
      data: {
        ...PLATFORM_DEFAULTS,
        newCustomerWindowDays: NON_DEFAULT_WINDOW_DAYS,
        expectedVersion: before.version,
      },
    });
    expect(baselineResponse.ok(), "the baseline save must succeed").toBe(true);
    const baselineVersion = (await baselineResponse.json()).version as number;
    expect(baselineVersion).toBeGreaterThan(versionWatermark);

    const loginA = await page.request.post("/api/auth/login", {
      data: { email: adminA.email, password },
    });
    expect(loginA.ok(), "admin A must be able to sign in").toBe(true);
    await page.goto("/admin/retencija");

    const windowInput = page.getByTestId("input-newCustomerWindowDays");
    await expect(page.getByTestId("retention-settings-version"))
      .toHaveText(`Verzija ${baselineVersion}`);
    await windowInput.fill(String(UNSAVED_WINDOW_DAYS));

    // Move the active version forward, then make every background refresh
    // attempt fail so React Query surfaces its refetch error state.
    const concurrentResponse = await apiB.put(settingsPath, {
      data: {
        ...PLATFORM_DEFAULTS,
        newCustomerWindowDays: ADMIN_B_WINDOW_DAYS,
        expectedVersion: baselineVersion,
      },
    });
    expect(concurrentResponse.ok(), "the concurrent save must succeed").toBe(true);
    const adminBVersion = (await concurrentResponse.json()).version as number;
    failSettingsRefresh = true;

    // TanStack Query retries three times after the first failed poll. Advance
    // through the initial interval and each backoff so the page reaches its
    // visible recovery state instead of stopping at a transient retry.
    for (const delay of [30_000, 1_000, 2_000, 4_000]) {
      const failedRefresh = page.waitForResponse((response) =>
        response.request().method() === "GET"
        && new URL(response.url()).pathname === settingsPath
        && response.status() === 503,
      );
      await page.clock.fastForward(delay);
      await failedRefresh;
    }

    const refreshError = page.getByTestId("retention-refresh-error");
    await expect(refreshError).toBeVisible();
    await expect(refreshError).toContainText("Osvežavanje pragova retencije nije uspelo");
    await expect(refreshError).toContainText("nesačuvane izmene ostaju nepromenjene");
    await expect(windowInput).toHaveValue(String(UNSAVED_WINDOW_DAYS));
    await expect(page.getByTestId("retention-settings-version"))
      .toHaveText(`Verzija ${baselineVersion}`);

    // Let the explicit retry through. The newer response must clear the
    // recovery warning and enter the normal stale-version state without
    // replacing the in-progress draft.
    allowSettingsRefresh = true;
    const retriedRefresh = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === settingsPath
      && response.status() === 200,
    );
    await page.getByTestId("retry-retention-refresh").click();
    await retriedRefresh;

    await expect(refreshError).not.toBeVisible();
    await expect(page.getByTestId("retention-stale-banner")).toBeVisible();
    await expect(page.getByTestId("retention-stale-banner"))
      .toContainText(`Verzija ${adminBVersion} je u međuvremenu aktivirana`);
    await expect(page.getByTestId("retention-settings-version"))
      .toHaveText(`Verzija ${adminBVersion}`);
    await expect(windowInput).toHaveValue(String(UNSAVED_WINDOW_DAYS));
  } finally {
    await apiB.dispose();
  }
});

test("failed history refresh shows its retry warning and preserves settings edits", async ({ page }) => {
  test.setTimeout(120_000);

  const historyPath = `${settingsPath}/history`;
  let failHistoryRefresh = false;
  let allowHistoryRefresh = false;
  await page.route(`**${historyPath}`, async (route) => {
    if (
      failHistoryRefresh
      && !allowHistoryRefresh
      && route.request().method() === "GET"
    ) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Privremeno nedostupno" }),
      });
      return;
    }
    await route.continue();
  });

  await page.clock.install();

  const apiB = await request.newContext({ baseURL });
  try {
    const loginB = await apiB.post("/api/auth/login", {
      data: { email: adminB.email, password },
    });
    expect(loginB.ok(), "admin B must be able to sign in").toBe(true);

    const before = await (await apiB.get(settingsPath)).json();
    const baselineResponse = await apiB.put(settingsPath, {
      data: {
        ...PLATFORM_DEFAULTS,
        newCustomerWindowDays: NON_DEFAULT_WINDOW_DAYS,
        expectedVersion: before.version,
      },
    });
    expect(baselineResponse.ok(), "the baseline save must succeed").toBe(true);
    const baselineVersion = (await baselineResponse.json()).version as number;
    expect(baselineVersion).toBeGreaterThan(versionWatermark);

    const loginA = await page.request.post("/api/auth/login", {
      data: { email: adminA.email, password },
    });
    expect(loginA.ok(), "admin A must be able to sign in").toBe(true);
    await page.goto("/admin/retencija");

    const windowInput = page.getByTestId("input-newCustomerWindowDays");
    await expect(page.getByTestId("retention-settings-version"))
      .toHaveText(`Verzija ${baselineVersion}`);
    await expect(windowInput).toHaveValue(String(NON_DEFAULT_WINDOW_DAYS));
    await expect(page.getByTestId(`retention-history-v${baselineVersion}`)).toBeVisible();
    await windowInput.fill(String(UNSAVED_WINDOW_DAYS));

    const concurrentResponse = await apiB.put(settingsPath, {
      data: {
        ...PLATFORM_DEFAULTS,
        newCustomerWindowDays: ADMIN_B_WINDOW_DAYS,
        expectedVersion: baselineVersion,
      },
    });
    expect(concurrentResponse.ok(), "the concurrent save must succeed").toBe(true);
    const adminBVersion = (await concurrentResponse.json()).version as number;
    failHistoryRefresh = true;

    const settingsRefetch = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === settingsPath
      && response.status() === 200,
    );
    const initialHistoryRefreshFailure = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === historyPath
      && response.status() === 503,
    );
    await page.clock.fastForward(30_000);
    await settingsRefetch;
    await initialHistoryRefreshFailure;

    // The automatic history refresh retries three times before exposing the
    // same visible recovery state as an initial history-load failure.
    for (const delay of [1_000, 2_000, 4_000]) {
      const failedRetry = page.waitForResponse((response) =>
        response.request().method() === "GET"
        && new URL(response.url()).pathname === historyPath
        && response.status() === 503,
      );
      await page.clock.fastForward(delay);
      await failedRetry;
    }

    const historyError = page.getByTestId("retention-history-error");
    await expect(historyError).toBeVisible();
    await expect(historyError).toContainText("Istorija izmena nije mogla da se učita");
    await expect(historyError).toContainText("Privremeno nedostupno");
    await expect(page.getByTestId("retention-settings-version"))
      .toHaveText(`Verzija ${adminBVersion}`);
    await expect(windowInput).toHaveValue(String(UNSAVED_WINDOW_DAYS));

    allowHistoryRefresh = true;
    const retriedHistoryRefresh = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === historyPath
      && response.status() === 200,
    );
    await page.getByTestId("retry-retention-history").click();
    await retriedHistoryRefresh;

    await expect(historyError).not.toBeVisible();
    await expect(page.getByTestId(`retention-history-v${adminBVersion}`)).toBeVisible();
    await expect(windowInput).toHaveValue(String(UNSAVED_WINDOW_DAYS));
  } finally {
    await apiB.dispose();
  }
});

test("failed history load shows a retry warning and preserves settings edits", async ({ page }) => {
  test.setTimeout(120_000);

  const historyPath = `${settingsPath}/history`;
  let allowHistoryLoad = false;
  await page.route(`**${historyPath}`, async (route) => {
    if (
      !allowHistoryLoad
      && route.request().method() === "GET"
    ) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Privremeno nedostupno" }),
      });
      return;
    }
    await route.continue();
  });

  // Install the clock before navigation so the history query's retry backoff
  // can be advanced without waiting in real time.
  await page.clock.install();

  const apiB = await request.newContext({ baseURL });
  try {
    const loginB = await apiB.post("/api/auth/login", {
      data: { email: adminB.email, password },
    });
    expect(loginB.ok(), "admin B must be able to sign in").toBe(true);

    const before = await (await apiB.get(settingsPath)).json();
    const baselineResponse = await apiB.put(settingsPath, {
      data: {
        ...PLATFORM_DEFAULTS,
        newCustomerWindowDays: NON_DEFAULT_WINDOW_DAYS,
        expectedVersion: before.version,
      },
    });
    expect(baselineResponse.ok(), "the baseline save must succeed").toBe(true);
    const baselineVersion = (await baselineResponse.json()).version as number;
    expect(baselineVersion).toBeGreaterThan(versionWatermark);

    const loginA = await page.request.post("/api/auth/login", {
      data: { email: adminA.email, password },
    });
    expect(loginA.ok(), "admin A must be able to sign in").toBe(true);

    const initialHistoryFailure = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === historyPath
      && response.status() === 503,
    );
    await page.goto("/admin/retencija");
    await initialHistoryFailure;

    // TanStack Query retries three times after the first failed request.
    for (const delay of [1_000, 2_000, 4_000]) {
      const failedRetry = page.waitForResponse((response) =>
        response.request().method() === "GET"
        && new URL(response.url()).pathname === historyPath
        && response.status() === 503,
      );
      await page.clock.fastForward(delay);
      await failedRetry;
    }

    const windowInput = page.getByTestId("input-newCustomerWindowDays");
    await expect(windowInput).toHaveValue(String(NON_DEFAULT_WINDOW_DAYS));
    await windowInput.fill(String(UNSAVED_WINDOW_DAYS));

    const historyError = page.getByTestId("retention-history-error");
    await expect(historyError).toBeVisible();
    await expect(historyError).toContainText("Istorija izmena nije mogla da se učita");
    await expect(historyError).toContainText("Privremeno nedostupno");
    await expect(page.getByTestId(`retention-history-v${baselineVersion}`)).toHaveCount(0);

    allowHistoryLoad = true;
    const retriedHistoryLoad = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === historyPath
      && response.status() === 200,
    );
    await page.getByTestId("retry-retention-history").click();
    await retriedHistoryLoad;

    await expect(historyError).not.toBeVisible();
    await expect(page.getByTestId(`retention-history-v${baselineVersion}`)).toBeVisible();
    await expect(windowInput).toHaveValue(String(UNSAVED_WINDOW_DAYS));
    await expect(page.getByTestId("retention-settings-version"))
      .toHaveText(`Verzija ${baselineVersion}`);
  } finally {
    await apiB.dispose();
  }
});

test("failed initial settings load offers recovery and enables editing after retry", async ({ page }) => {
  test.setTimeout(120_000);

  let allowInitialSettingsLoad = false;
  await page.route(`**${settingsPath}`, async (route) => {
    if (
      !allowInitialSettingsLoad
      && route.request().method() === "GET"
    ) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Privremeno nedostupno" }),
      });
      return;
    }
    await route.continue();
  });

  // Install the clock before navigation so the query's initial retry backoff
  // can be advanced without waiting in real time.
  await page.clock.install();

  const apiB = await request.newContext({ baseURL });
  try {
    const loginB = await apiB.post("/api/auth/login", {
      data: { email: adminB.email, password },
    });
    expect(loginB.ok(), "admin B must be able to sign in").toBe(true);
    const activeSettings = await (await apiB.get(settingsPath)).json();

    const loginA = await page.request.post("/api/auth/login", {
      data: { email: adminA.email, password },
    });
    expect(loginA.ok(), "admin A must be able to sign in").toBe(true);

    const initialFailure = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === settingsPath
      && response.status() === 503,
    );
    await page.goto("/admin/retencija");
    await initialFailure;

    // TanStack Query retries three times after the first failed request.
    for (const delay of [1_000, 2_000, 4_000]) {
      const failedRetry = page.waitForResponse((response) =>
        response.request().method() === "GET"
        && new URL(response.url()).pathname === settingsPath
        && response.status() === 503,
      );
      await page.clock.fastForward(delay);
      await failedRetry;
    }

    const initialLoadError = page.getByTestId("retention-initial-load-error");
    await expect(initialLoadError).toBeVisible();
    await expect(initialLoadError).toContainText("Pragovi retencije nisu mogli da se učitaju");
    await expect(initialLoadError).toContainText("Privremeno nedostupno");
    await expect(page.getByTestId("retry-retention-settings")).toBeEnabled();
    await expect(page.getByTestId("input-newCustomerWindowDays")).toHaveCount(0);

    allowInitialSettingsLoad = true;
    const retriedSettingsLoad = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === settingsPath
      && response.status() === 200,
    );
    await page.getByTestId("retry-retention-settings").click();
    await retriedSettingsLoad;

    await expect(initialLoadError).not.toBeVisible();
    await expect(page.getByTestId("retention-settings-version")).toHaveText(
      activeSettings.isDefault ? "Podrazumevano (v0)" : `Verzija ${activeSettings.version}`,
    );
    const windowInput = page.getByTestId("input-newCustomerWindowDays");
    await expect(windowInput).toHaveValue(String(activeSettings.thresholds.newCustomerWindowDays));
    await expect(windowInput).toBeEnabled();
    await windowInput.fill(String(activeSettings.thresholds.newCustomerWindowDays + 1));
    await expect(windowInput).toHaveValue(String(activeSettings.thresholds.newCustomerWindowDays + 1));
  } finally {
    await apiB.dispose();
  }
});
