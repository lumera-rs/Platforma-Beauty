/**
 * Restore already applied by another admin — no-op through conflict, browser
 * regression.
 *
 * If admin A tries to restore version N from a stale page while admin B
 * concurrently saves exactly version N's values, admin A's confirm is first
 * rejected with 409 (stale expectedVersion), and the re-confirm inside the
 * conflict dialog becomes a no-op restore: the server rejects it with code
 * NO_OP_RESTORE (checked inside the advisory lock, after the 409
 * precondition), so the append-only history never records a duplicate
 * "no values changed" version. The server side of this contract is covered by
 * artifacts/api-server/src/lib/retention-settings.test.ts; this spec proves
 * the browser end of the funnel:
 *
 *  1. Admin A opens the restore dialog for the older baseline version while
 *     admin B saves exactly the baseline thresholds through
 *     PUT /api/growth/admin/retention-settings.
 *  2. Confirming the restore is rejected with 409 and opens the conflict
 *     dialog, whose diff reports the pending values as identical to the new
 *     active version (the page refetched admin B's save).
 *  3. Re-confirming is rejected with 400 NO_OP_RESTORE: the conflict dialog
 *     closes, the "Vrednosti su identične…" info toast appears instead of an
 *     error, and no new version is recorded — the version badge, the API
 *     payload, and the history all stay at admin B's version.
 *
 * Cleanup follows scripts/browser/retention-restore-conflict.spec.ts: the max
 * version is captured before the test and every row above that watermark is
 * deleted afterwards, restoring the pre-test active settings exactly.
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
 * Deterministic baseline written as the first version of this run — the
 * version admin A later tries to restore, and the exact values admin B saves
 * concurrently (values match the platform defaults, so assertions never
 * depend on the shared development database).
 */
const BASELINE_THRESHOLDS = {
  newCustomerWindowDays: 45,
  defaultIntervalDays: 45,
  atRiskIntervalPercent: 150,
  lostIntervalPercent: 250,
  lostMinimumDays: 180,
  vipMinCompletedVisits: 5,
  vipSpendPercentOfMedian: 200,
};

/**
 * The value that makes the second version differ from the baseline, so the
 * baseline becomes a restorable (non-active, non-identical) older version
 * while admin A's page is loaded.
 */
const SECOND_VERSION_WINDOW_DAYS = 30;

const suffix = randomUUID();
const password = "browser-retention-restore-noop-password";
const adminA = { email: `browser-retention-noop-admin-a-${suffix}@example.test` };
const adminB = { email: `browser-retention-noop-admin-b-${suffix}@example.test` };

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
  // The version sequence and watermark cleanup are global to all retention
  // specs, so keep the advisory lock through this file's full test and cleanup.
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
      lastName: "Noop Restore Admin A",
      email: adminA.email,
      passwordHash,
      passwordSetAt: new Date(),
      role: "ADMIN",
    },
    {
      firstName: "Browser",
      lastName: "Noop Restore Admin B",
      email: adminB.email,
      passwordHash,
      passwordSetAt: new Date(),
      role: "ADMIN",
    },
  ]).returning();
  if (inserted.length !== 2) throw new Error("The no-op-restore fixture could not create both admins.");
  createdUserIds.push(...inserted.map((user) => user.id));
});

test.afterAll(async () => {
  try {
    // Remove only rows created by this run; earlier versions stay untouched, so
    // the pre-test active settings become the highest (active) version again.
    await db.delete(platformRetentionSettingsTable)
      .where(gt(platformRetentionSettingsTable.version, versionWatermark));
    if (createdUserIds.length > 0) {
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    }
  } finally {
    // Only hand the table to the next retention spec once cleanup restored the
    // pre-test state.
    await releaseRetentionSettingsLock?.();
  }
});

test("a restore another admin already applied ends in an info toast and records no duplicate version", async ({ page }) => {
  test.setTimeout(120_000);

  // Admin B works through a separate API session, like a second browser.
  const apiB = await request.newContext({ baseURL });
  try {
    const loginB = await apiB.post("/api/auth/login", {
      data: { email: adminB.email, password },
    });
    expect(loginB.ok(), "admin B must be able to sign in").toBe(true);

    // Version 1 of this run: the baseline admin A will try to restore.
    const before = await (await apiB.get(settingsPath)).json();
    const baselineResponse = await apiB.put(settingsPath, {
      data: { ...BASELINE_THRESHOLDS, expectedVersion: before.version },
    });
    expect(baselineResponse.ok(), "the baseline save must succeed").toBe(true);
    const baselineVersion = (await baselineResponse.json()).version as number;
    expect(baselineVersion).toBeGreaterThan(versionWatermark);

    // Version 2 of this run: makes the baseline an older, non-active version
    // whose values differ from the active ones (so its restore dialog shows a
    // real diff, not the disabled no-op notice).
    const secondResponse = await apiB.put(settingsPath, {
      data: {
        ...BASELINE_THRESHOLDS,
        newCustomerWindowDays: SECOND_VERSION_WINDOW_DAYS,
        expectedVersion: baselineVersion,
      },
    });
    expect(secondResponse.ok(), "the second save must succeed").toBe(true);
    const secondVersion = (await secondResponse.json()).version as number;
    expect(secondVersion).toBe(baselineVersion + 1);

    // Admin A signs in and loads the settings page at the second version.
    const loginA = await page.request.post("/api/auth/login", {
      data: { email: adminA.email, password },
    });
    expect(loginA.ok(), "admin A must be able to sign in").toBe(true);
    await page.goto("/admin/retencija");

    await expect(page.getByTestId("retention-settings-version")).toHaveText(`Verzija ${secondVersion}`);
    await expect(page.getByTestId("input-newCustomerWindowDays"))
      .toHaveValue(String(SECOND_VERSION_WINDOW_DAYS));

    // Admin A opens the restore dialog for the older baseline version — at
    // this moment it is still a real change (30 → 45), so the confirm button
    // is enabled and no no-op notice is shown.
    await page.getByTestId(`restore-retention-v${baselineVersion}`).click();
    const restoreDialog = page.getByTestId("restore-retention-dialog");
    await expect(restoreDialog).toBeVisible();
    await expect(restoreDialog.locator(".line-through")).toHaveText(String(SECOND_VERSION_WINDOW_DAYS));
    await expect(page.getByTestId("restore-retention-noop-notice")).not.toBeVisible();
    await expect(page.getByTestId("confirm-restore-retention")).toBeEnabled();

    // While the dialog is open, admin B saves exactly the baseline values —
    // the restore admin A is about to confirm has already been applied.
    const concurrentResponse = await apiB.put(settingsPath, {
      data: { ...BASELINE_THRESHOLDS, expectedVersion: secondVersion },
    });
    expect(concurrentResponse.ok(), "admin B's concurrent save must succeed").toBe(true);
    const adminBVersion = (await concurrentResponse.json()).version as number;
    expect(adminBVersion).toBe(secondVersion + 1);

    // Admin A confirms the restore → the stale expectedVersion is rejected
    // with 409 first (the no-op verdict must not mask the conflict), and the
    // restore dialog is replaced by the conflict dialog.
    const conflictSave = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && new URL(response.url()).pathname === settingsPath,
    );
    await page.getByTestId("confirm-restore-retention").click();
    expect((await conflictSave).status(), "the stale restore must be rejected with 409").toBe(409);

    const conflictDialog = page.getByTestId("retention-conflict-dialog");
    await expect(conflictDialog).toBeVisible();
    await expect(restoreDialog).not.toBeVisible();

    // The page refetched admin B's save, so the conflict diff reports the
    // pending restore values as identical to the new active version (this
    // also guarantees the retry below is based on the refreshed version).
    await expect(conflictDialog).toContainText(`verzija ${adminBVersion}`);
    await expect(page.getByTestId("retention-conflict-diff"))
      .toContainText("Vaše vrednosti su identične novoj aktivnoj verziji");

    // Admin A re-confirms anyway → the retry against the refreshed version is
    // a no-op restore, rejected with 400 NO_OP_RESTORE.
    const retriedSave = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && new URL(response.url()).pathname === settingsPath,
    );
    await page.getByTestId("confirm-retention-conflict").click();
    const retried = await retriedSave;
    expect(retried.status(), "the no-op restore must be rejected with 400").toBe(400);
    expect((await retried.json()).code).toBe("NO_OP_RESTORE");

    // The conflict dialog closes and the info toast explains why nothing was
    // recorded — not the generic save-error toast.
    await expect(conflictDialog).not.toBeVisible();
    const infoToast = page.locator("[data-sonner-toast]")
      .filter({ hasText: "nova verzija nije zabeležena" });
    await expect(infoToast).toBeVisible();
    await expect(infoToast).toHaveAttribute("data-type", "info");
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Greška" }))
      .toHaveCount(0);

    // No new version was recorded: the badge stays at admin B's version, the
    // form shows the (identical) restored values, and no restore label
    // appears on the active-settings badge.
    await expect(page.getByTestId("retention-settings-version")).toHaveText(`Verzija ${adminBVersion}`);
    await expect(page.getByTestId("input-newCustomerWindowDays"))
      .toHaveValue(String(BASELINE_THRESHOLDS.newCustomerWindowDays));
    await expect(page.getByTestId("retention-settings-source")).toHaveCount(0);

    // The history gains no entry above admin B's version — its entry is still
    // the active one, and no "no values changed" row was appended.
    await expect(page.getByTestId(`retention-history-v${adminBVersion}`)).toBeVisible();
    await expect(page.getByTestId(`retention-active-v${adminBVersion}`)).toBeVisible();
    await expect(page.getByTestId(`retention-history-v${adminBVersion + 1}`)).toHaveCount(0);

    // The API agrees: admin B's manual save is still active, unchanged.
    const activeAfterNoOp = await (await apiB.get(settingsPath)).json();
    expect(activeAfterNoOp.version).toBe(adminBVersion);
    expect(activeAfterNoOp.changeSource).toBe("manual");
    expect(activeAfterNoOp.restoredFromVersion).toBeNull();
    expect(activeAfterNoOp.thresholds).toEqual(BASELINE_THRESHOLDS);
  } finally {
    await apiB.dispose();
  }
});
