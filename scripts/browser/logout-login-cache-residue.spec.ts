/**
 * Task #9A: real-browser regression for cross-user TanStack Query cache
 * residue on logout/login.
 *
 * The audit (Task #9, finding #9-F1) found that customer and jobseeker
 * logout paths never called queryClient.clear(), while owner/education-
 * center/business logout paths already did. Since every "my data" query key
 * is session-agnostic (keyed by URL/params only, never by user id -- the
 * correct design for a cookie-authenticated API), an un-cleared cache could
 * keep rendering the previous identity's data after a different identity
 * logs in without a full page reload.
 *
 * This spec drives the REAL login/logout UI against the real Express API
 * and a fresh disposable Postgres database, and asserts on rendered DOM
 * content -- the actual, user-visible manifestation of the invariant --
 * rather than reaching into TanStack Query internals (window.__queryClient
 * is not exposed by the production app, and this spec intentionally does
 * not add such an exposure: DOM assertions across every affected identity-
 * bearing surface already give direct, convincing proof of "no User A data
 * is renderable").
 *
 * Navigation between pages in the SAME test uses `history.pushState`
 * directly (via page.evaluate) instead of page.goto(): page.goto() always
 * performs a genuine browser navigation (a full reload, a fresh JS
 * context, a brand-new QueryClient), which would trivially "solve" cache
 * residue by construction and make the test meaningless. wouter (this
 * app's router) monkey-patches history.pushState/replaceState to dispatch
 * a "pushState"/"replaceState" event on every call -- from anywhere,
 * including this test -- which is exactly what its own <Link>/setLocation
 * calls do internally, so this reproduces a real SPA-internal transition,
 * not a reload. The actual login/logout actions themselves are always
 * driven through the real form/button/menu UI, never an API call.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import {
  customerNotificationsTable,
  db,
  referralCodesTable,
  salonsTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";

const scrypt = promisify(scryptCallback);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

/** SPA-internal navigation -- see file header for why this is used instead of page.goto(). */
async function spaNavigate(page: Page, path: string): Promise<void> {
  await page.evaluate((target) => { window.history.pushState({}, "", target); }, path);
}

async function loginViaCustomerForm(page: Page, email: string, password: string): Promise<void> {
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
}

async function loginViaBusinessForm(page: Page, email: string, password: string): Promise<void> {
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Prijavi se u poslovni portal" }).click();
}

test.describe("Task #9A: logout/login cache residue", () => {
  test("customer A logout -> anonymous -> customer B login shows no User A residue", async ({ page }) => {
    const suffix = randomUUID();
    const passwordA = `CacheAuditA-${suffix}`;
    const passwordB = `CacheAuditB-${suffix}`;
    const userIds: string[] = [];
    const [customerA, customerB] = await db.insert(usersTable).values([
      { firstName: `AliceCache${suffix.slice(0, 6)}`, lastName: "Residue", email: `cache-audit-a-${suffix}@example.test`, passwordHash: await hashPassword(passwordA), passwordSetAt: new Date(), role: "CUSTOMER" },
      { firstName: `BobCache${suffix.slice(0, 6)}`, lastName: "Residue", email: `cache-audit-b-${suffix}@example.test`, passwordHash: await hashPassword(passwordB), passwordSetAt: new Date(), role: "CUSTOMER" },
    ]).returning();
    userIds.push(customerA!.id, customerB!.id);

    const notificationTitleA = `NotifyMarkerA-${suffix.slice(0, 8)}`;
    const notificationTitleB = `NotifyMarkerB-${suffix.slice(0, 8)}`;
    await db.insert(customerNotificationsTable).values([
      { eventKey: `cache-audit-a-${suffix}`, userId: customerA!.id, category: "system", title: notificationTitleA, body: "Test notification for user A." },
      { eventKey: `cache-audit-b-${suffix}`, userId: customerB!.id, category: "system", title: notificationTitleB, body: "Test notification for user B." },
    ]);

    try {
      await page.goto("/prijava");

      // --- User A logs in (real form submit), and both /auth/me-derived
      // identity and a private "my data" resource (notifications) get
      // cached, all within this one continuous SPA session.
      await loginViaCustomerForm(page, customerA!.email, passwordA);
      await expect(page.getByText(customerA!.firstName, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
      await page.getByRole("tab", { name: "Obaveštenja" }).click();
      await expect(page.getByText(notificationTitleA)).toBeVisible({ timeout: 10_000 });

      // --- User A logs out through the real navbar UI (the exact path
      // fixed in this task) -- no reload, no direct API call.
      await page.getByRole("button").filter({ hasText: customerA!.firstName }).first().click();
      await page.getByRole("menuitem", { name: "Odjavi se" }).click();

      // --- Intermediate anonymous state: no trace of A's identity or data.
      await expect(page.getByRole("link", { name: "Prijavi se" }).first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(customerA!.firstName, { exact: false })).toHaveCount(0);
      await expect(page.getByText(notificationTitleA)).toHaveCount(0);

      // --- User B logs in, in the SAME page/process (no reload).
      await spaNavigate(page, "/prijava");
      await loginViaCustomerForm(page, customerB!.email, passwordB);
      await expect(page.getByText(customerB!.firstName, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
      // A's name must never be renderable anywhere in the tree once B's
      // authenticated transition has completed.
      await expect(page.getByText(customerA!.firstName, { exact: false })).toHaveCount(0);

      // --- The notifications query must show B's data, never A's stale
      // cached notification.
      await page.getByRole("tab", { name: "Obaveštenja" }).click();
      await expect(page.getByText(notificationTitleB)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(notificationTitleA)).toHaveCount(0);
    } finally {
      await db.delete(customerNotificationsTable).where(inArray(customerNotificationsTable.userId, userIds));
      await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
  });

  test("jobseeker A logout (dashboard sidebar) -> jobseeker B login shows no residue", async ({ page }) => {
    const suffix = randomUUID();
    const passwordA = `CacheAuditJobA-${suffix}`;
    const passwordB = `CacheAuditJobB-${suffix}`;
    const userIds: string[] = [];
    const [jobseekerA, jobseekerB] = await db.insert(usersTable).values([
      { firstName: `AliceJob${suffix.slice(0, 6)}`, lastName: "Residue", email: `cache-audit-job-a-${suffix}@example.test`, passwordHash: await hashPassword(passwordA), passwordSetAt: new Date(), role: "JOBSEEKER" },
      { firstName: `BobJob${suffix.slice(0, 6)}`, lastName: "Residue", email: `cache-audit-job-b-${suffix}@example.test`, passwordHash: await hashPassword(passwordB), passwordSetAt: new Date(), role: "JOBSEEKER" },
    ]).returning();
    userIds.push(jobseekerA!.id, jobseekerB!.id);

    try {
      await page.goto("/prijava");
      await loginViaCustomerForm(page, jobseekerA!.email, passwordA);
      await expect(page.getByText(`${jobseekerA!.firstName} ${jobseekerA!.lastName}`)).toBeVisible({ timeout: 10_000 });

      // Logout via the jobseeker dashboard's own sidebar button (a distinct
      // logout site from the navbar's, fixed separately in this task).
      await page.getByRole("button", { name: "Odjavi se" }).click();
      await expect(page.getByRole("link", { name: "Prijavi se" }).first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(`${jobseekerA!.firstName} ${jobseekerA!.lastName}`)).toHaveCount(0);

      await spaNavigate(page, "/prijava");
      await loginViaCustomerForm(page, jobseekerB!.email, passwordB);
      await expect(page.getByText(`${jobseekerB!.firstName} ${jobseekerB!.lastName}`)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(`${jobseekerA!.firstName} ${jobseekerA!.lastName}`)).toHaveCount(0);
    } finally {
      await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
  });

  test("owner logout (already-correct pattern) -> owner B login: regression control", async ({ page }) => {
    const suffix = randomUUID();
    const passwordA = `CacheAuditOwnerA-${suffix}`;
    const passwordB = `CacheAuditOwnerB-${suffix}`;
    const userIds: string[] = [];
    const salonIds: string[] = [];
    const [ownerA, ownerB] = await db.insert(usersTable).values([
      { firstName: "OwnerCacheA", lastName: suffix.slice(0, 8), email: `cache-audit-owner-a-${suffix}@example.test`, passwordHash: await hashPassword(passwordA), passwordSetAt: new Date(), role: "SALON_OWNER" },
      { firstName: "OwnerCacheB", lastName: suffix.slice(0, 8), email: `cache-audit-owner-b-${suffix}@example.test`, passwordHash: await hashPassword(passwordB), passwordSetAt: new Date(), role: "SALON_OWNER" },
    ]).returning();
    userIds.push(ownerA!.id, ownerB!.id);

    const salonNameA = `SalonCacheA-${suffix.slice(0, 8)}`;
    const salonNameB = `SalonCacheB-${suffix.slice(0, 8)}`;
    const [salonA, salonB] = await db.insert(salonsTable).values([
      { ownerId: ownerA!.id, name: salonNameA, slug: `cache-audit-salon-a-${suffix}`, city: "Beograd", municipality: "Vračar", address: "Test 1", phone: "+381110000501", email: `cache-audit-salon-a-${suffix}@example.test`, shortDescription: "Salon A.", description: "Salon za proveru cache residue-a.", imageUrl: "/test-cache-audit.jpg" },
      { ownerId: ownerB!.id, name: salonNameB, slug: `cache-audit-salon-b-${suffix}`, city: "Novi Sad", municipality: "Centar", address: "Test 2", phone: "+381110000502", email: `cache-audit-salon-b-${suffix}@example.test`, shortDescription: "Salon B.", description: "Salon za proveru cache residue-a.", imageUrl: "/test-cache-audit.jpg" },
    ]).returning();
    salonIds.push(salonA!.id, salonB!.id);
    await db.update(usersTable).set({ activeSalonId: salonA!.id }).where(eq(usersTable.id, ownerA!.id));
    await db.update(usersTable).set({ activeSalonId: salonB!.id }).where(eq(usersTable.id, ownerB!.id));

    try {
      await page.goto("/poslovna-prijava");
      await loginViaBusinessForm(page, ownerA!.email, passwordA);
      await expect(page.getByText(salonNameA, { exact: false })).toBeVisible({ timeout: 10_000 });

      await page.getByTestId("owner-navigation-logout").click();
      await expect(page.getByRole("link", { name: "Prijavi se" }).first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(salonNameA, { exact: false })).toHaveCount(0);

      await spaNavigate(page, "/poslovna-prijava");
      await loginViaBusinessForm(page, ownerB!.email, passwordB);
      await expect(page.getByText(salonNameB, { exact: false })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(salonNameA, { exact: false })).toHaveCount(0);
    } finally {
      await db.delete(salonsTable).where(inArray(salonsTable.id, salonIds));
      await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
      // Business registration mints a referral code owned by the new
      // account; it must go before the user row (referrer_user_id is
      // ON DELETE RESTRICT).
      await db.delete(referralCodesTable).where(inArray(referralCodesTable.referrerUserId, userIds));
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
  });

  test("multi-tab: a second tab cannot keep mutating after server-side logout in the first tab", async ({ browser }) => {
    // A second tab's first navigation in this sandbox can trigger the Vite
    // dev server's on-demand dependency (re-)optimization, which holds the
    // response until esbuild finishes -- slow under this environment's
    // constrained CPU, but not a characteristic of the production build
    // this test is otherwise exercising. Give this specific test more room
    // than the default 30s so that cold-compile latency doesn't masquerade
    // as a navigation failure.
    test.setTimeout(90_000);
    const suffix = randomUUID();
    const password = `CacheAuditMultiTab-${suffix}`;
    const [customer] = await db.insert(usersTable).values({
      firstName: `MultiTab${suffix.slice(0, 6)}`, lastName: "Residue",
      email: `cache-audit-multitab-${suffix}@example.test`,
      passwordHash: await hashPassword(password), passwordSetAt: new Date(), role: "CUSTOMER",
    }).returning();

    const context = await browser.newContext();
    try {
      const tabA = await context.newPage();
      const tabB = await context.newPage();

      await tabA.goto("/prijava");
      await loginViaCustomerForm(tabA, customer!.email, password);
      await expect(tabA.getByText(customer!.firstName, { exact: false }).first()).toBeVisible({ timeout: 10_000 });

      // Tab B shares the same cookie jar (same browser context) and is
      // authenticated too, without its own explicit login. Per the task's
      // own priorities for this scenario, server-side rejection is the
      // success criterion and stale UI is out of scope -- so tab B loads
      // the lightweight home route (not the heavy /moj-nalog dashboard,
      // which fans out ~9 concurrent API calls and was observed to make
      // this navigation hang past the test timeout under this sandbox's
      // constrained resources) purely to get a same-origin document that
      // relative fetch() calls can resolve against, then proves it is
      // authenticated via the API directly.
      await tabB.goto("/", { waitUntil: "domcontentloaded" });
      const preLogoutStatus = await tabB.evaluate(async () => {
        const response = await fetch("/api/auth/me", { credentials: "include" });
        return response.status;
      });
      expect(preLogoutStatus).toBe(200);

      // Tab A logs out through the real UI.
      await tabA.getByRole("button").filter({ hasText: customer!.firstName }).first().click();
      await tabA.getByRole("menuitem", { name: "Odjavi se" }).click();
      await expect(tabA.getByRole("link", { name: "Prijavi se" }).first()).toBeVisible({ timeout: 10_000 });

      // Tab B, still showing its own (now stale) UI, must no longer be able
      // to perform an authenticated mutation -- the server-side session is
      // gone regardless of what tab B's own frontend cache still displays.
      const mutationStatus = await tabB.evaluate(async () => {
        const response = await fetch("/api/auth/email-preferences", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ marketingEmailsEnabled: false }),
        });
        return response.status;
      });
      expect(mutationStatus).toBe(401);
    } finally {
      await context.close();
      await db.delete(sessionsTable).where(eq(sessionsTable.userId, customer!.id));
      await db.delete(usersTable).where(eq(usersTable.id, customer!.id));
    }
  });
});
