/**
 * Identical manual retention save — browser regression.
 *
 * The server permits a manual save whose thresholds match the active version,
 * because an administrator may intentionally re-confirm the current values.
 * The page must still make that audit consequence explicit:
 *
 *  1. Saving unchanged values opens identical-retention-save-dialog without
 *     recording a version immediately.
 *  2. Cancelling leaves the active version and history unchanged.
 *  3. Confirming records a new version whose history entry says the values did
 *     not change.
 *  4. Changing a threshold skips the identical-save dialog and saves directly.
 *
 * Cleanup follows the other retention browser specs: the max version is
 * captured before the test and every row above that watermark is deleted
 * afterwards, restoring the pre-test active settings exactly.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { gt, inArray } from "drizzle-orm";
import { db, platformRetentionSettingsTable, usersTable } from "@workspace/db";
import { acquireRetentionSettingsLock } from "./retention-settings-lock";

const scrypt = promisify(scryptCallback);

const baseURL = process.env.LUMERA_WEB_BASE_URL ?? "http://localhost:80";
const settingsPath = "/api/growth/admin/retention-settings";
const historyPath = `${settingsPath}/history`;

const BASELINE_THRESHOLDS = {
  newCustomerWindowDays: 45,
  defaultIntervalDays: 45,
  atRiskIntervalPercent: 150,
  lostIntervalPercent: 250,
  lostMinimumDays: 180,
  vipMinCompletedVisits: 5,
  vipSpendPercentOfMedian: 200,
};

const CHANGED_WINDOW_DAYS = 60;
const suffix = randomUUID();
const password = "browser-retention-identical-save-password";
const admin = {
  email: `browser-retention-identical-save-admin-${suffix}@example.test`,
};

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
  releaseRetentionSettingsLock = await acquireRetentionSettingsLock();

  const versions = await db
    .select({ version: platformRetentionSettingsTable.version })
    .from(platformRetentionSettingsTable);
  versionWatermark = versions.reduce((max, row) => Math.max(max, row.version), 0);

  const passwordHash = await hashPassword(password);
  const inserted = await db.insert(usersTable).values({
    firstName: "Browser",
    lastName: "Identical Save Admin",
    email: admin.email,
    passwordHash,
    passwordSetAt: new Date(),
    role: "ADMIN",
  }).returning();
  if (inserted.length !== 1) throw new Error("The identical-save fixture could not create an admin.");
  createdUserIds.push(inserted[0].id);
});

test.afterAll(async () => {
  try {
    await db.delete(platformRetentionSettingsTable)
      .where(gt(platformRetentionSettingsTable.version, versionWatermark));
    if (createdUserIds.length > 0) {
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    }
  } finally {
    await releaseRetentionSettingsLock?.();
  }
});

test("identical save asks before recording history, while changed save is direct", async ({ page }) => {
  test.setTimeout(120_000);

  const login = await page.request.post("/api/auth/login", {
    data: { email: admin.email, password },
  });
  expect(login.ok(), "the fixture admin must be able to sign in").toBe(true);

  // Establish a known active version so neither the shared database state nor
  // the existing history affects the assertions below.
  const before = await (await page.request.get(settingsPath)).json();
  const baselineResponse = await page.request.put(settingsPath, {
    data: { ...BASELINE_THRESHOLDS, expectedVersion: before.version },
  });
  expect(baselineResponse.ok(), "the baseline save must succeed").toBe(true);
  const baselineVersion = (await baselineResponse.json()).version as number;
  expect(baselineVersion).toBeGreaterThan(versionWatermark);

  await page.goto("/admin/retencija");
  await expect(page.getByTestId("retention-settings-version"))
    .toHaveText(`Verzija ${baselineVersion}`);

  const identicalDialog = page.getByTestId("identical-retention-save-dialog");
  const historyBeforeCancel = await (await page.request.get(historyPath)).json();

  // All inputs are already equal to the active thresholds. The first save
  // must pause for confirmation instead of writing a version immediately.
  await page.getByTestId("save-retention-settings").click();
  await expect(identicalDialog).toBeVisible();
  const activeAfterDialog = await (await page.request.get(settingsPath)).json();
  expect(activeAfterDialog.version).toBe(baselineVersion);

  // Cancelling must not add an audit entry or change the active version.
  await page.getByTestId("cancel-identical-retention-save").click();
  await expect(identicalDialog).not.toBeVisible();
  await expect(page.getByTestId("retention-settings-version"))
    .toHaveText(`Verzija ${baselineVersion}`);
  const historyAfterCancel = await (await page.request.get(historyPath)).json();
  expect(historyAfterCancel).toEqual(historyBeforeCancel);
  await expect(page.getByTestId(`retention-history-v${baselineVersion}`)).toBeVisible();
  await expect(page.getByTestId(`retention-history-v${baselineVersion + 1}`)).toHaveCount(0);

  // Repeating the unchanged save and confirming it is the deliberate path
  // that creates a new "Bez promene vrednosti" history version.
  await page.getByTestId("save-retention-settings").click();
  await expect(identicalDialog).toBeVisible();
  let releaseIdenticalSave!: () => void;
  let identicalSaveStarted!: () => void;
  let identicalSaveRequestCount = 0;
  const identicalSaveRequestStarted = new Promise<void>((resolve) => {
    identicalSaveStarted = resolve;
  });
  const identicalSaveRequestRelease = new Promise<void>((resolve) => {
    releaseIdenticalSave = resolve;
  });
  await page.route(`**${settingsPath}`, async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    identicalSaveRequestCount += 1;
    identicalSaveStarted();
    if (identicalSaveRequestCount === 1) {
      await identicalSaveRequestRelease;
    }
    await route.continue();
  });
  const identicalSave = page.waitForResponse((response) =>
    response.request().method() === "PUT"
    && new URL(response.url()).pathname === settingsPath,
  );
  const confirmIdenticalSave = page.getByTestId("confirm-identical-retention-save");
  await confirmIdenticalSave.dispatchEvent("click");
  await confirmIdenticalSave.dispatchEvent("click");
  await identicalSaveRequestStarted;
  expect(identicalSaveRequestCount, "rapid confirmation must issue one update request").toBe(1);
  await expect(confirmIdenticalSave).toBeDisabled();
  await expect(page.getByTestId("cancel-identical-retention-save")).toBeDisabled();
  releaseIdenticalSave();
  expect((await identicalSave).status(), "the confirmed identical save must succeed").toBe(200);
  await page.unroute(`**${settingsPath}`);
  await expect(identicalDialog).not.toBeVisible();
  await expect(page.getByTestId("retention-settings-version"))
    .toHaveText(`Verzija ${baselineVersion + 1}`);
  await expect(page.getByTestId(`retention-history-v${baselineVersion + 1}`))
    .toContainText("Bez promene vrednosti.");
  await expect(page.getByTestId(`retention-active-v${baselineVersion + 1}`)).toBeVisible();

  const activeAfterIdenticalConfirm = await (await page.request.get(settingsPath)).json();
  expect(activeAfterIdenticalConfirm.version).toBe(baselineVersion + 1);
  expect(activeAfterIdenticalConfirm.thresholds).toEqual(BASELINE_THRESHOLDS);
  const historyAfterIdenticalConfirm = await (await page.request.get(historyPath)).json();
  expect(
    historyAfterIdenticalConfirm.filter((entry: { version: number }) => entry.version === baselineVersion + 1),
  ).toHaveLength(1);

  // A real edit bypasses the identical-value warning and writes directly.
  await page.getByTestId("input-newCustomerWindowDays").fill(String(CHANGED_WINDOW_DAYS));
  await expect(identicalDialog).not.toBeVisible();
  const changedSave = page.waitForResponse((response) =>
    response.request().method() === "PUT"
    && new URL(response.url()).pathname === settingsPath,
  );
  await page.getByTestId("save-retention-settings").click();
  expect((await changedSave).status(), "the changed save must succeed directly").toBe(200);
  await expect(identicalDialog).not.toBeVisible();
  await expect(page.getByTestId("retention-settings-version"))
    .toHaveText(`Verzija ${baselineVersion + 2}`);
  await expect(page.getByTestId("input-newCustomerWindowDays"))
    .toHaveValue(String(CHANGED_WINDOW_DAYS));
});