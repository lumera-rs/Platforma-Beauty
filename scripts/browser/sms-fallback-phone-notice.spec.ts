/**
 * Emergency-SMS fallback zero-phone notice — browser regression.
 *
 * The API contract (GET /api/admin/integrations reporting
 * smsFallback.reachableAdminCount via the exact send-path audience predicate)
 * is covered by artifacts/api-server/src/lib/sms-fallback-admin-phone-notice.test.ts.
 * This spec guards the rendering side on /admin/integracije:
 *
 *  1. With every active admin phone cleared (the reachableAdminCount = 0
 *     state), the standing warning (sms-fallback-no-admin-phone) must be
 *     visible after the page loads.
 *  2. Its direct profile link must lead to the verified phone controls.
 *  3. After the signed-in admin verifies a phone there and returns to the
 *     integrations page, the warning must be gone — while the rest of the
 *     page (the integration cards) still renders, proving absence is not just
 *     "data never loaded".
 *
 * State setup mirrors the API suite: the users table is global, so the
 * phone columns of every active admin are snapshotted up front, cleared for
 * the zero state, and restored to their exact prior values afterwards. The
 * only created fixture is a disposable admin used both to sign in and as the
 * admin who later receives the phone number.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

const scrypt = promisify(scryptCallback);

const suffix = randomUUID();
const password = "browser-sms-fallback-notice-password";
const adminEmail = `browser-sms-fallback-notice-admin-${suffix}@example.test`;
const ADMIN_PHONE = `+3816${String(Date.now()).slice(-8)}`;

const createdUserIds: string[] = [];
let adminId = "";
let priorPhones: Array<{ id: string; phone: string | null; phoneNormalized: string | null }> = [];

async function hashPassword(value: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(value, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

test.beforeAll(async () => {
  // Snapshot every active admin's phone columns for exact restoration, then
  // clear them so the run starts from the deterministic zero-phone state
  // (same pattern as the API regression suite).
  priorPhones = await db.select({
    id: usersTable.id,
    phone: usersTable.phone,
    phoneNormalized: usersTable.phoneNormalized,
  }).from(usersTable).where(and(
    eq(usersTable.active, true),
    inArray(usersTable.role, ["ADMIN", "SUPER_ADMIN"]),
    isNotNull(usersTable.phone),
  ));
  if (priorPhones.length > 0) {
    await db.update(usersTable).set({ phone: null, phoneNormalized: null })
      .where(inArray(usersTable.id, priorPhones.map((row) => row.id)));
  }

  const inserted = await db.insert(usersTable).values({
    firstName: "Browser",
    lastName: "SmsFallback Notice",
    email: adminEmail,
    passwordHash: await hashPassword(password),
    passwordSetAt: new Date(),
    role: "ADMIN",
  }).returning();
  if (inserted.length !== 1) throw new Error("The notice fixture could not create the admin.");
  createdUserIds.push(...inserted.map((user) => user.id));
  adminId = inserted[0]!.id;
});

test.afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  // Restore the exact prior phone values of the real admins.
  for (const row of priorPhones) {
    await db.update(usersTable)
      .set({ phone: row.phone, phoneNormalized: row.phoneNormalized })
      .where(eq(usersTable.id, row.id));
  }
});

test("the zero-phone warning shows on /admin/integracije and disappears once an admin has a phone", async ({ page }) => {
  test.setTimeout(120_000);

  const login = await page.request.post("/api/auth/login", {
    data: { email: adminEmail, password },
  });
  expect(login.ok(), "the fixture admin must be able to sign in").toBe(true);

  // ── 1. Zero state: no active admin has a phone → the warning is visible ──
  await page.goto("/admin/integracije");

  const banner = page.getByTestId("sms-fallback-no-admin-phone");
  await expect(banner, "with reachableAdminCount = 0 the standing warning must render").toBeVisible();
  await expect(banner).toContainText("Hitna SMS upozorenja trenutno ne mogu nikoga da dosegnu");
  await expect(banner).toHaveAttribute("role", "alert");
  const audience = page.getByTestId("sms-fallback-audience");
  await expect(audience).toBeVisible();
  await expect(page.getByTestId("sms-fallback-audience-count")).toHaveText("0");
  await expect(page.getByTestId("sms-fallback-audience-empty")).toContainText("Trenutno nema aktivnog administratora");
  const profileLink = page.getByTestId("sms-fallback-no-admin-phone-link");
  await expect(profileLink).toBeVisible();
  await expect(profileLink).toContainText("Dodajte broj telefona u svom profilu");
  await expect(profileLink).toHaveAttribute("href", "/admin/profil");
  await profileLink.click();
  await expect(page).toHaveURL(/\/admin\/profil$/);
  await expect(page.getByTestId("admin-profile-phone")).toBeVisible();
  await expect(page.getByTestId("admin-profile-phone-code")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pošalji kod" })).toBeVisible();
  await page.getByTestId("admin-profile-phone").fill(ADMIN_PHONE);
  await page.getByRole("button", { name: "Pošalji kod" }).click();
  const codeInput = page.getByTestId("admin-profile-phone-code");
  await expect(codeInput).toHaveValue(/^\d{6}$/);
  const confirmResponse = page.waitForResponse((response) =>
    response.url().includes("/api/auth/phone-verification/confirm")
    && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Potvrdi broj" }).click();
  expect((await confirmResponse).ok(), "the admin profile must accept the verified phone number").toBe(true);

  // ── 2. One admin verifies a phone → after returning, the warning is gone ─
  await page.goto("/admin/integracije");

  // Wait until the integrations payload has rendered, so the banner's absence
  // proves the notice cleared rather than that data never arrived.
  await expect(page.getByTestId("toggle-enabled-brevo")).toBeVisible();
  await expect(banner, "with a reachable admin the warning must not render").toHaveCount(0);
  await expect(page.getByTestId("sms-fallback-single-admin-phone"),
    "with exactly one reachable admin, the coverage warning must remain visible").toBeVisible();
  await expect(page.getByTestId("sms-fallback-audience-count")).toHaveText("1");
  await expect(page.getByTestId("sms-fallback-audience-list")).toContainText("Browser SmsFallback Notice");
});
