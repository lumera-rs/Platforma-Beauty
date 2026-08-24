/**
 * Two-admin retention-settings conflict — browser regression.
 *
 * The server-side 409 optimistic-concurrency check is covered by
 * artifacts/api-server/src/lib/retention-settings.test.ts. This spec guards
 * the browser side of that contract on /admin/retencija:
 *
 *  1. Admin A edits a threshold while admin B saves a newer version through
 *     PUT /api/growth/admin/retention-settings (with expectedVersion).
 *  2. Admin A's save must open the conflict dialog (retention-conflict-dialog)
 *     instead of silently overwriting or falling back to a generic error toast,
 *     and the diff must compare the pending values against the values admin B
 *     just saved.
 *  3. Re-confirming (confirm-retention-conflict) retries with the refreshed
 *     version and records admin A's values as a new version.
 *  4. Cancelling (cancel-retention-conflict) keeps admin B's newer version
 *     active and replaces admin A's abandoned form values.
 *
 * Cleanup follows the existing suite's version-watermark pattern: the max
 * version is captured before the test and every row above it is deleted
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
 * Deterministic baseline written as the first version of this run, so the
 * assertions never depend on whatever thresholds the shared development
 * database happens to hold (values match the platform defaults; identical
 * manual saves are always allowed and still record a version).
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

/** The value admin A types into the form but has not saved yet. */
const ADMIN_A_WINDOW_DAYS = 60;
/** The different value admin B saves first, bumping the version under A. */
const ADMIN_B_WINDOW_DAYS = 21;

const suffix = randomUUID();
const password = "browser-retention-conflict-password";
const adminA = { email: `browser-retention-conflict-admin-a-${suffix}@example.test` };
const adminB = { email: `browser-retention-conflict-admin-b-${suffix}@example.test` };

const createdUserIds: string[] = [];
let versionWatermark = 0;
let releaseRetentionSettingsLock: (() => Promise<void>) | undefined;

async function hashPassword(value: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(value, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
      lastName: "Admin A",
      email: adminA.email,
      passwordHash,
      passwordSetAt: new Date(),
      role: "ADMIN",
    },
    {
      firstName: "Browser",
      lastName: "Admin B",
      email: adminB.email,
      passwordHash,
      passwordSetAt: new Date(),
      role: "ADMIN",
    },
  ]).returning();
  if (inserted.length !== 2) throw new Error("The conflict fixture could not create both admins.");
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

test("a concurrent admin save opens the conflict dialog and re-confirm records a new version", async ({ page }) => {
  test.setTimeout(120_000);

  // Admin B works through a separate API session, like a second browser.
  const apiB = await request.newContext({ baseURL });
  try {
    const loginB = await apiB.post("/api/auth/login", {
      data: { email: adminB.email, password },
    });
    expect(loginB.ok(), "admin B must be able to sign in").toBe(true);

    // Establish a known baseline version for deterministic assertions.
    const before = await (await apiB.get(settingsPath)).json();
    const baselineResponse = await apiB.put(settingsPath, {
      data: { ...BASELINE_THRESHOLDS, expectedVersion: before.version },
    });
    expect(baselineResponse.ok(), "the baseline save must succeed").toBe(true);
    const baselineVersion = (await baselineResponse.json()).version as number;
    expect(baselineVersion).toBeGreaterThan(versionWatermark);

    // Admin A signs in and loads the settings page at the baseline version.
    const loginA = await page.request.post("/api/auth/login", {
      data: { email: adminA.email, password },
    });
    expect(loginA.ok(), "admin A must be able to sign in").toBe(true);
    await page.goto("/admin/retencija");

    const windowInput = page.getByTestId("input-newCustomerWindowDays");
    await expect(windowInput).toHaveValue(String(BASELINE_THRESHOLDS.newCustomerWindowDays));
    await expect(page.getByTestId("retention-settings-version")).toHaveText(`Verzija ${baselineVersion}`);

    // Admin A edits a threshold but has not saved yet.
    await windowInput.fill(String(ADMIN_A_WINDOW_DAYS));

    // Admin B saves a different value first — the active version moves on.
    const concurrentResponse = await apiB.put(settingsPath, {
      data: {
        ...BASELINE_THRESHOLDS,
        newCustomerWindowDays: ADMIN_B_WINDOW_DAYS,
        expectedVersion: baselineVersion,
      },
    });
    expect(concurrentResponse.ok(), "admin B's concurrent save must succeed").toBe(true);
    expect((await concurrentResponse.json()).version).toBe(baselineVersion + 1);

    // Admin A saves → the server answers 409 and the conflict dialog opens.
    const conflictSave = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && new URL(response.url()).pathname === settingsPath,
    );
    await page.getByTestId("save-retention-settings").click();
    expect((await conflictSave).status(), "the stale save must be rejected with 409").toBe(409);

    const conflictDialog = page.getByTestId("retention-conflict-dialog");
    await expect(conflictDialog).toBeVisible();

    // The diff compares admin B's just-saved value with admin A's pending one
    // (the page refetches the newer settings when the conflict is detected).
    const conflictDiff = page.getByTestId("retention-conflict-diff");
    await expect(conflictDiff.locator(".line-through")).toHaveText(String(ADMIN_B_WINDOW_DAYS));
    await expect(conflictDiff).toContainText(String(ADMIN_A_WINDOW_DAYS));

    // Nothing was silently overwritten: admin B's version is still active.
    const activeDuringConflict = await (await apiB.get(settingsPath)).json();
    expect(activeDuringConflict.version).toBe(baselineVersion + 1);
    expect(activeDuringConflict.thresholds.newCustomerWindowDays).toBe(ADMIN_B_WINDOW_DAYS);

    // Re-confirm retries against the refreshed version and succeeds.
    const retriedSave = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && new URL(response.url()).pathname === settingsPath,
    );
    await page.getByTestId("confirm-retention-conflict").click();
    expect((await retriedSave).status(), "the re-confirmed save must succeed").toBe(200);
    await expect(conflictDialog).not.toBeVisible();

    // Admin A's values are now the active version, one above admin B's.
    await expect(page.getByTestId("retention-settings-version")).toHaveText(`Verzija ${baselineVersion + 2}`);
    await expect(windowInput).toHaveValue(String(ADMIN_A_WINDOW_DAYS));

    const activeAfterConfirm = await (await apiB.get(settingsPath)).json();
    expect(activeAfterConfirm.version).toBe(baselineVersion + 2);
    expect(activeAfterConfirm.thresholds.newCustomerWindowDays).toBe(ADMIN_A_WINDOW_DAYS);
  } finally {
    await apiB.dispose();
  }
});

test("cancelling the conflict keeps the newer version and resets the form", async ({ page }) => {
  test.setTimeout(120_000);

  // Admin B works through a separate API session, like a second browser.
  const apiB = await request.newContext({ baseURL });
  try {
    const loginB = await apiB.post("/api/auth/login", {
      data: { email: adminB.email, password },
    });
    expect(loginB.ok(), "admin B must be able to sign in").toBe(true);

    // Establish a known baseline version for deterministic assertions.
    const before = await (await apiB.get(settingsPath)).json();
    const baselineResponse = await apiB.put(settingsPath, {
      data: { ...BASELINE_THRESHOLDS, expectedVersion: before.version },
    });
    expect(baselineResponse.ok(), "the baseline save must succeed").toBe(true);
    const baselineVersion = (await baselineResponse.json()).version as number;
    expect(baselineVersion).toBeGreaterThan(versionWatermark);

    // Admin A signs in and loads the settings page at the baseline version.
    const loginA = await page.request.post("/api/auth/login", {
      data: { email: adminA.email, password },
    });
    expect(loginA.ok(), "admin A must be able to sign in").toBe(true);
    await page.goto("/admin/retencija");

    const windowInput = page.getByTestId("input-newCustomerWindowDays");
    await expect(windowInput).toHaveValue(String(BASELINE_THRESHOLDS.newCustomerWindowDays));
    await expect(page.getByTestId("retention-settings-version")).toHaveText(`Verzija ${baselineVersion}`);

    // Admin A edits a threshold but has not saved yet.
    await windowInput.fill(String(ADMIN_A_WINDOW_DAYS));

    // Admin B saves a different value first — the active version moves on.
    const concurrentResponse = await apiB.put(settingsPath, {
      data: {
        ...BASELINE_THRESHOLDS,
        newCustomerWindowDays: ADMIN_B_WINDOW_DAYS,
        expectedVersion: baselineVersion,
      },
    });
    expect(concurrentResponse.ok(), "admin B's concurrent save must succeed").toBe(true);
    expect((await concurrentResponse.json()).version).toBe(baselineVersion + 1);

    // Admin A saves → the server answers 409 and the conflict dialog opens.
    const conflictSave = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && new URL(response.url()).pathname === settingsPath,
    );
    await page.getByTestId("save-retention-settings").click();
    expect((await conflictSave).status(), "the stale save must be rejected with 409").toBe(409);

    const conflictDialog = page.getByTestId("retention-conflict-dialog");
    await expect(conflictDialog).toBeVisible();

    // Wait for the conflict refresh before exercising the ordinary cancel
    // path; this makes the post-close assertion independent of request timing.
    await expect(page.getByTestId("retention-settings-version")).toHaveText(`Verzija ${baselineVersion + 1}`);
    await expect(windowInput).toHaveValue(String(ADMIN_B_WINDOW_DAYS));

    // Backing out must discard admin A's pending value without writing it.
    await page.getByTestId("cancel-retention-conflict").click();
    await expect(conflictDialog).not.toBeVisible();

    // The active version is still exactly admin B's version: cancelling did
    // not record another settings version.
    const activeAfterCancel = await (await apiB.get(settingsPath)).json();
    expect(activeAfterCancel.version).toBe(baselineVersion + 1);
    expect(activeAfterCancel.thresholds).toEqual({
      ...BASELINE_THRESHOLDS,
      newCustomerWindowDays: ADMIN_B_WINDOW_DAYS,
    });

    // The form follows the active settings after the conflict closes rather
    // than showing admin A's abandoned value.
    await expect(page.getByTestId("retention-settings-version")).toHaveText(`Verzija ${baselineVersion + 1}`);
    await expect(windowInput).toHaveValue(String(ADMIN_B_WINDOW_DAYS));
  } finally {
    await apiB.dispose();
  }
});

test("dismissing the conflict with Escape keeps the newer version and resets the form", async ({ page }) => {
  test.setTimeout(120_000);

  // Admin B works through a separate API session, like a second browser.
  const apiB = await request.newContext({ baseURL });
  try {
    const loginB = await apiB.post("/api/auth/login", {
      data: { email: adminB.email, password },
    });
    expect(loginB.ok(), "admin B must be able to sign in").toBe(true);

    // Establish a known baseline version for deterministic assertions.
    const before = await (await apiB.get(settingsPath)).json();
    const baselineResponse = await apiB.put(settingsPath, {
      data: { ...BASELINE_THRESHOLDS, expectedVersion: before.version },
    });
    expect(baselineResponse.ok(), "the baseline save must succeed").toBe(true);
    const baselineVersion = (await baselineResponse.json()).version as number;
    expect(baselineVersion).toBeGreaterThan(versionWatermark);

    // Admin A signs in and loads the settings page at the baseline version.
    const loginA = await page.request.post("/api/auth/login", {
      data: { email: adminA.email, password },
    });
    expect(loginA.ok(), "admin A must be able to sign in").toBe(true);
    await page.goto("/admin/retencija");

    const windowInput = page.getByTestId("input-newCustomerWindowDays");
    await expect(windowInput).toHaveValue(String(BASELINE_THRESHOLDS.newCustomerWindowDays));
    await expect(page.getByTestId("retention-settings-version")).toHaveText(`Verzija ${baselineVersion}`);

    // Admin A edits a threshold but has not saved yet.
    await windowInput.fill(String(ADMIN_A_WINDOW_DAYS));

    // Admin B saves a different value first — the active version moves on.
    const concurrentResponse = await apiB.put(settingsPath, {
      data: {
        ...BASELINE_THRESHOLDS,
        newCustomerWindowDays: ADMIN_B_WINDOW_DAYS,
        expectedVersion: baselineVersion,
      },
    });
    expect(concurrentResponse.ok(), "admin B's concurrent save must succeed").toBe(true);
    expect((await concurrentResponse.json()).version).toBe(baselineVersion + 1);

    // Admin A saves → the server answers 409 and the conflict dialog opens.
    const conflictSave = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && new URL(response.url()).pathname === settingsPath,
    );
    await page.getByTestId("save-retention-settings").click();
    expect((await conflictSave).status(), "the stale save must be rejected with 409").toBe(409);

    const conflictDialog = page.getByTestId("retention-conflict-dialog");
    await expect(conflictDialog).toBeVisible();

    // Escape must take the same safe cancellation path as the explicit
    // button: wait for the active settings read before closing.
    await page.keyboard.press("Escape");
    await expect(conflictDialog).not.toBeVisible();

    const activeAfterEscape = await (await apiB.get(settingsPath)).json();
    expect(activeAfterEscape.version).toBe(baselineVersion + 1);
    expect(activeAfterEscape.thresholds).toEqual({
      ...BASELINE_THRESHOLDS,
      newCustomerWindowDays: ADMIN_B_WINDOW_DAYS,
    });

    // The form follows admin B's active settings rather than retaining admin
    // A's abandoned value after keyboard dismissal.
    await expect(page.getByTestId("retention-settings-version")).toHaveText(`Verzija ${baselineVersion + 1}`);
    await expect(windowInput).toHaveValue(String(ADMIN_B_WINDOW_DAYS));
    for (const [key, value] of Object.entries(activeAfterEscape.thresholds)) {
      await expect(page.getByTestId(`input-${key}`)).toHaveValue(String(value));
    }
  } finally {
    await apiB.dispose();
  }
});

test("immediately cancelling a conflict waits for newer settings before closing", async ({ page }) => {
  test.setTimeout(120_000);

  // Hold the conflict refresh and the cancellation fetch independently. This
  // proves cancellation cannot close the dialog until its own confirmed read
  // returns, even if the original refresh is still in transit.
  const conflictRefreshStarted = createDeferred();
  const releaseConflictRefresh = createDeferred();
  const cancellationFetchStarted = createDeferred();
  const releaseCancellationFetch = createDeferred();
  let gateSettingsRequests = false;
  let gatedGetCount = 0;
  await page.route(`**${settingsPath}`, async (route) => {
    if (gateSettingsRequests && route.request().method() === "GET") {
      gatedGetCount += 1;
      if (gatedGetCount === 1) {
        conflictRefreshStarted.resolve();
        await releaseConflictRefresh.promise;
      } else if (gatedGetCount === 2) {
        cancellationFetchStarted.resolve();
        await releaseCancellationFetch.promise;
      }
    }
    await route.continue();
  });

  const apiB = await request.newContext({ baseURL });
  try {
    const loginB = await apiB.post("/api/auth/login", {
      data: { email: adminB.email, password },
    });
    expect(loginB.ok(), "admin B must be able to sign in").toBe(true);

    const before = await (await apiB.get(settingsPath)).json();
    const baselineResponse = await apiB.put(settingsPath, {
      data: { ...BASELINE_THRESHOLDS, expectedVersion: before.version },
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
    await expect(windowInput).toHaveValue(String(BASELINE_THRESHOLDS.newCustomerWindowDays));
    await windowInput.fill(String(ADMIN_A_WINDOW_DAYS));

    const concurrentResponse = await apiB.put(settingsPath, {
      data: {
        ...BASELINE_THRESHOLDS,
        newCustomerWindowDays: ADMIN_B_WINDOW_DAYS,
        expectedVersion: baselineVersion,
      },
    });
    expect(concurrentResponse.ok(), "admin B's concurrent save must succeed").toBe(true);

    gateSettingsRequests = true;
    const conflictSave = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && new URL(response.url()).pathname === settingsPath,
    );
    await page.getByTestId("save-retention-settings").click();
    expect((await conflictSave).status(), "the stale save must be rejected with 409").toBe(409);

    const conflictDialog = page.getByTestId("retention-conflict-dialog");
    await expect(conflictDialog).toBeVisible();
    await conflictRefreshStarted.promise;

    // Cancel while the original refresh is held. Its own request must start,
    // and the dialog must stay open until that request gets a response.
    await page.getByTestId("cancel-retention-conflict").click();
    await cancellationFetchStarted.promise;
    await expect(conflictDialog).toBeVisible();
    await expect(page.getByTestId("cancel-retention-conflict")).toBeDisabled();

    // Releasing the aborted original refresh cannot close the dialog or
    // replace the cancellation read's eventual cache value.
    releaseConflictRefresh.resolve();
    await expect(conflictDialog).toBeVisible();
    releaseCancellationFetch.resolve();
    await expect(conflictDialog).not.toBeVisible();

    const activeAfterImmediateCancel = await (await apiB.get(settingsPath)).json();
    expect(activeAfterImmediateCancel.version).toBe(baselineVersion + 1);
    expect(activeAfterImmediateCancel.thresholds).toEqual({
      ...BASELINE_THRESHOLDS,
      newCustomerWindowDays: ADMIN_B_WINDOW_DAYS,
    });
    await expect(page.getByTestId("retention-settings-version")).toHaveText(`Verzija ${baselineVersion + 1}`);
    await expect(windowInput).toHaveValue(String(ADMIN_B_WINDOW_DAYS));
  } finally {
    await apiB.dispose();
  }
});
