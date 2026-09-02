/**
 * Restore-through-conflict on retention settings — browser regression.
 *
 * Restores share the single write path (performUpdate with expectedVersion)
 * with manual saves on /admin/retencija, so a restore attempted from a stale
 * page must hit the same conflict dialog. The server side of this contract is
 * covered by artifacts/api-server/src/lib/retention-settings.test.ts; this
 * spec proves the browser interplay:
 *
 *  1. Admin A opens the restore dialog for an older version while admin B
 *     saves a newer version through PUT /api/growth/admin/retention-settings.
 *  2. Confirming the restore must be rejected with 409 and open the conflict
 *     dialog (retention-conflict-dialog) — not silently overwrite admin B's
 *     values and not fall back to a generic error toast.
 *  3. Re-confirming (confirm-retention-conflict) retries against the
 *     refreshed version and the new active version keeps its truthful restore
 *     audit label ("Vraćeno iz verzije N" / changeSource restore_version) on
 *     the active-settings badge, in the history, and in the API payload.
 *
 * Cleanup follows scripts/browser/retention-conflict.spec.ts: the max version
 * is captured before the test and every row above that watermark is deleted
 * afterwards, restoring the pre-test active settings exactly.
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
 * Deterministic baseline written as the first version of this run — this is
 * the "older version" admin A later restores (values match the platform
 * defaults, so assertions never depend on the shared development database).
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
 * baseline becomes a restorable (non-active, non-identical) older version.
 */
const SECOND_VERSION_WINDOW_DAYS = 30;
/**
 * The different value admin B saves while admin A's restore dialog is open.
 * Distinct from both the baseline (45) and the second version (30), so the
 * restore stays a real change (never a NO_OP_RESTORE) and the conflict diff
 * is unambiguous about which value it crosses out.
 */
const ADMIN_B_WINDOW_DAYS = 21;

const suffix = randomUUID();
const password = "browser-retention-restore-conflict-password";
const adminA = { email: `browser-retention-restore-admin-a-${suffix}@example.test` };
const adminB = { email: `browser-retention-restore-admin-b-${suffix}@example.test` };

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
      lastName: "Restore Admin A",
      email: adminA.email,
      passwordHash,
      passwordSetAt: new Date(),
      role: "ADMIN",
    },
    {
      firstName: "Browser",
      lastName: "Restore Admin B",
      email: adminB.email,
      passwordHash,
      passwordSetAt: new Date(),
      role: "ADMIN",
    },
  ]).returning();
  if (inserted.length !== 2) throw new Error("The restore-conflict fixture could not create both admins.");
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

test("a restore from a stale page opens the conflict dialog and re-confirm keeps the restore label", async ({ page }) => {
  test.setTimeout(120_000);

  // Admin B works through a separate API session, like a second browser.
  const apiB = await request.newContext({ baseURL });
  try {
    const loginB = await apiB.post("/api/auth/login", {
      data: { email: adminB.email, password },
    });
    expect(loginB.ok(), "admin B must be able to sign in").toBe(true);

    // Version 1 of this run: the restorable baseline.
    const before = await (await apiB.get(settingsPath)).json();
    const baselineResponse = await apiB.put(settingsPath, {
      data: { ...BASELINE_THRESHOLDS, expectedVersion: before.version },
    });
    expect(baselineResponse.ok(), "the baseline save must succeed").toBe(true);
    const baselineVersion = (await baselineResponse.json()).version as number;
    expect(baselineVersion).toBeGreaterThan(versionWatermark);

    // Version 2 of this run: makes the baseline an older, non-active version
    // whose values differ from the active ones (so restoring it is a change).
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

    // Admin A opens the restore dialog for the older baseline version. The
    // dialog's diff crosses out the currently active value (30 → 45).
    await page.getByTestId(`restore-retention-v${baselineVersion}`).click();
    const restoreDialog = page.getByTestId("restore-retention-dialog");
    await expect(restoreDialog).toBeVisible();
    await expect(restoreDialog.locator(".line-through")).toHaveText(String(SECOND_VERSION_WINDOW_DAYS));
    await expect(restoreDialog).toContainText(String(BASELINE_THRESHOLDS.newCustomerWindowDays));

    // While the dialog is open, admin B saves a different value first — the
    // active version moves on underneath admin A's page.
    const concurrentResponse = await apiB.put(settingsPath, {
      data: {
        ...BASELINE_THRESHOLDS,
        newCustomerWindowDays: ADMIN_B_WINDOW_DAYS,
        expectedVersion: secondVersion,
      },
    });
    expect(concurrentResponse.ok(), "admin B's concurrent save must succeed").toBe(true);
    expect((await concurrentResponse.json()).version).toBe(secondVersion + 1);

    // Admin A confirms the restore → the server answers 409 and the restore
    // dialog is replaced by the conflict dialog.
    const conflictSave = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && new URL(response.url()).pathname === settingsPath,
    );
    await page.getByTestId("confirm-restore-retention").click();
    expect((await conflictSave).status(), "the stale restore must be rejected with 409").toBe(409);

    const conflictDialog = page.getByTestId("retention-conflict-dialog");
    await expect(conflictDialog).toBeVisible();
    await expect(restoreDialog).not.toBeVisible();

    // The diff compares admin B's just-saved value with the pending restore
    // values (the page refetches the newer settings when the conflict hits).
    const conflictDiff = page.getByTestId("retention-conflict-diff");
    await expect(conflictDiff.locator(".line-through")).toHaveText(String(ADMIN_B_WINDOW_DAYS));
    await expect(conflictDiff).toContainText(String(BASELINE_THRESHOLDS.newCustomerWindowDays));

    // Nothing was silently overwritten: admin B's version is still active.
    const activeDuringConflict = await (await apiB.get(settingsPath)).json();
    expect(activeDuringConflict.version).toBe(secondVersion + 1);
    expect(activeDuringConflict.thresholds.newCustomerWindowDays).toBe(ADMIN_B_WINDOW_DAYS);

    // Re-confirm retries against the refreshed version and succeeds.
    const retriedSave = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && new URL(response.url()).pathname === settingsPath,
    );
    await page.getByTestId("confirm-retention-conflict").click();
    expect((await retriedSave).status(), "the re-confirmed restore must succeed").toBe(200);
    await expect(conflictDialog).not.toBeVisible();

    const finalVersion = secondVersion + 2;
    await expect(page.getByTestId("retention-settings-version")).toHaveText(`Verzija ${finalVersion}`);
    await expect(page.getByTestId("input-newCustomerWindowDays"))
      .toHaveValue(String(BASELINE_THRESHOLDS.newCustomerWindowDays));

    // The re-confirmed version keeps its truthful restore label — on the
    // active-settings badge and in the history entry for the new version.
    await expect(page.getByTestId("retention-settings-source"))
      .toHaveText(`Vraćeno iz verzije ${baselineVersion}`);
    await expect(page.getByTestId(`retention-source-v${finalVersion}`))
      .toHaveText(`Vraćeno iz verzije ${baselineVersion}`);
    await expect(page.getByTestId(`retention-active-v${finalVersion}`)).toBeVisible();

    // The API payload records the restore provenance, not a manual save.
    const activeAfterConfirm = await (await apiB.get(settingsPath)).json();
    expect(activeAfterConfirm.version).toBe(finalVersion);
    expect(activeAfterConfirm.changeSource).toBe("restore_version");
    expect(activeAfterConfirm.restoredFromVersion).toBe(baselineVersion);
    expect(activeAfterConfirm.thresholds.newCustomerWindowDays)
      .toBe(BASELINE_THRESHOLDS.newCustomerWindowDays);
  } finally {
    await apiB.dispose();
  }
});
