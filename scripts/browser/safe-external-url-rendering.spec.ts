/**
 * Task #9B: safe external-URL scheme regression.
 *
 * Task #9's audit (reproduced by an earlier version of this file) confirmed
 * that education-marketplace.tsx's public education-center page rendered
 * `center.websiteUrl` / `center.instagramUrl` as a plain, native
 * `<a href={...}>` with no URL-scheme validation on either the frontend
 * render site or the backend write path (BusinessRegistrationInput's
 * websiteUrl/instagramUrl fields only validated with Zod's `.url()`, which
 * does NOT reject the `javascript:` scheme).
 *
 * The fix added a backend scheme allowlist (safe-external-url.ts,
 * isSafeExternalHttpUrl) to every write path for these fields, and a
 * frontend defense-in-depth <SafeExternalLink> component so that even a
 * legacy/unvalidated database value can never render as a clickable
 * unsafe link. This spec proves both halves against the real frontend,
 * real Express API, and a fresh disposable Postgres database:
 *
 *  1. a legacy DB row with javascript:/data: websiteUrl/instagramUrl no
 *     longer renders as a link at all (hidden, not "sanitized into a safe
 *     link" and not left clickable);
 *  2. a legacy/valid https:// websiteUrl/instagramUrl still renders and
 *     is a real, correctly-targeted link;
 *  3. submitting a javascript: websiteUrl through the real, multi-step
 *     registration form is rejected by the backend end-to-end -- no
 *     account or center is created, and the user is kept on the form
 *     with a visible error.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, educationCenterSubscriptionsTable, educationCentersTable, subscriptionPlansTable, usersTable } from "@workspace/db";

const scrypt = promisify(scryptCallback);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

/**
 * education-marketplace.tsx's public center page has a pre-existing,
 * unrelated rules-of-hooks bug (reported separately, not fixed here): a
 * cold navigation whose query resolves on a later render throws "Rendered
 * more hooks than during the previous render", caught by the app's
 * ErrorBoundary. Resetting the boundary in place (not a reload) lets the
 * next render pass see isLoading:false from its first render, avoiding
 * the same mismatch. Used here purely to reach the page under test.
 */
async function openPublicCenterPage(page: Page, centerId: string): Promise<void> {
  await page.goto(`/edukacije/centri/${centerId}`);
  const tryAgain = page.getByRole("button", { name: "Try again" });
  if (await tryAgain.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await tryAgain.click();
  }
}

test.describe("Task #9B: safe external-URL scheme handling", () => {
  test("legacy javascript:/data: websiteUrl and instagramUrl do not render as links", async ({ page }) => {
    const suffix = randomUUID();
    const [owner] = await db.insert(usersTable).values({
      firstName: "Legacy", lastName: "Owner",
      email: `safe-url-legacy-${suffix}@example.test`,
      passwordHash: await hashPassword(`legacy-${suffix}`), passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR",
    }).returning();
    const [center] = await db.insert(educationCentersTable).values({
      ownerId: owner!.id,
      name: `Legacy Unsafe Center ${suffix}`,
      city: "Beograd",
      description: "Seeded directly to simulate a pre-existing unsafe database row.",
      imageUrl: "/test-education-center.jpg",
      websiteUrl: "javascript:document.title='pwned'",
      instagramUrl: "data:text/html,<script>document.title='pwned'</script>",
      verificationStatus: "verified",
      verifiedAt: new Date(),
    }).returning();
    const [plan] = await db.insert(subscriptionPlansTable).values({
      name: `Legacy Unsafe Plan ${suffix}`, price: 5000, audience: "education", active: true,
    }).returning();
    await db.insert(educationCenterSubscriptionsTable).values({
      centerId: center!.id, planId: plan!.id, status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    try {
      await openPublicCenterPage(page, center!.id);
      await expect(page.getByRole("heading", { name: center!.name })).toBeVisible();

      // <SafeExternalLink> renders nothing for an unsafe href -- the link
      // must be entirely absent, not present-but-disabled or rewritten.
      await expect(page.getByRole("link", { name: "Sajt centra" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Instagram" })).toHaveCount(0);
      await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
      await expect(page.locator('a[href^="data:"]')).toHaveCount(0);
    } finally {
      await db.delete(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, center!.id));
      await db.delete(educationCentersTable).where(eq(educationCentersTable.id, center!.id));
      await db.delete(usersTable).where(eq(usersTable.id, owner!.id));
      await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, plan!.id));
    }
  });

  test("valid https website/Instagram links render and target the stored URL", async ({ page }) => {
    const suffix = randomUUID();
    const [owner] = await db.insert(usersTable).values({
      firstName: "Safe", lastName: "Owner",
      email: `safe-url-valid-${suffix}@example.test`,
      passwordHash: await hashPassword(`safe-${suffix}`), passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR",
    }).returning();
    const websiteUrl = `https://example.com/${suffix}`;
    const instagramUrl = `https://instagram.com/${suffix}`;
    const [center] = await db.insert(educationCentersTable).values({
      ownerId: owner!.id,
      name: `Safe Link Center ${suffix}`,
      city: "Beograd",
      description: "Seeded directly with safe https links.",
      imageUrl: "/test-education-center.jpg",
      websiteUrl,
      instagramUrl,
      verificationStatus: "verified",
      verifiedAt: new Date(),
    }).returning();
    const [plan] = await db.insert(subscriptionPlansTable).values({
      name: `Safe Link Plan ${suffix}`, price: 5000, audience: "education", active: true,
    }).returning();
    await db.insert(educationCenterSubscriptionsTable).values({
      centerId: center!.id, planId: plan!.id, status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    try {
      await openPublicCenterPage(page, center!.id);
      await expect(page.getByRole("heading", { name: center!.name })).toBeVisible();

      const websiteLink = page.getByRole("link", { name: "Sajt centra" });
      await expect(websiteLink).toBeVisible();
      await expect(websiteLink).toHaveAttribute("href", websiteUrl);
      await expect(websiteLink).toHaveAttribute("target", "_blank");
      await expect(websiteLink).toHaveAttribute("rel", /noopener/);
      await expect(websiteLink).toHaveAttribute("rel", /noreferrer/);

      const instagramLink = page.getByRole("link", { name: "Instagram" });
      await expect(instagramLink).toBeVisible();
      await expect(instagramLink).toHaveAttribute("href", instagramUrl);
    } finally {
      await db.delete(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, center!.id));
      await db.delete(educationCentersTable).where(eq(educationCentersTable.id, center!.id));
      await db.delete(usersTable).where(eq(usersTable.id, owner!.id));
      await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, plan!.id));
    }
  });

  test("registration form: backend refuses a javascript: websiteUrl submission end-to-end", async ({ page }) => {
    const suffix = randomUUID();
    const email = `safe-url-reg-${suffix}@example.test`;
    const [plan] = await db.insert(subscriptionPlansTable).values({
      name: `Registration Plan ${suffix}`, price: 5000, audience: "education", active: true, trialDays: 14, courseLimit: 5,
    }).returning();

    try {
      await page.goto("/pridruzi-se-edukativni-centar");

      await page.getByLabel(/^Ime vlasnika\/menadžera/).fill("Test");
      await page.getByLabel(/^Prezime vlasnika\/menadžera/).fill(`Owner${suffix.slice(0, 6)}`);
      await page.getByLabel(/^Poslovna e-pošta/).fill(email);
      // The plan name (carrying the random suffix) is unique among
      // whatever demo/seed plans the isolated harness also loaded, so
      // match the <option> by its text and select by its actual value
      // rather than trying to reconstruct the option's full formatted
      // label text (price/locale formatting) here.
      const planSelect = page.getByLabel(/^Education plan/);
      const planOptionValue = await planSelect.locator("option", { hasText: plan!.name }).getAttribute("value");
      await planSelect.selectOption(planOptionValue!);
      await page.getByLabel(/^Kontakt telefon/).fill(`+3816${suffix.replace(/\D/g, "").slice(0, 8).padEnd(8, "1")}`);
      await page.getByLabel(/^Lozinka/).fill("StrongPass123!");
      await page.getByRole("button", { name: "Dalje" }).click();

      await expect(page.getByLabel(/^Zvanični naziv edukativnog centra/)).toBeVisible();
      await page.getByLabel(/^Zvanični naziv edukativnog centra/).fill(`Test Centar ${suffix}`);
      await page.getByLabel(/^PIB \(Poreski identifikacioni broj\)/).fill(suffix.replace(/\D/g, "").slice(0, 9).padEnd(9, "1"));
      await page.getByLabel(/^Matični broj/).fill(suffix.replace(/\D/g, "").slice(0, 8).padEnd(8, "2"));
      await page.getByLabel(/^Poslovni račun/).fill(suffix.replace(/\D/g, "").slice(0, 18).padEnd(18, "3"));
      await page.getByLabel(/^Grad/).fill("Beograd");
      await page.getByLabel(/^Opština/).fill("Vračar");
      await page.getByLabel(/^Adresa centra/).fill("Test 1");
      await page.getByLabel(/^Poštanski broj/).fill("11000");
      await page.getByLabel(/^Veb sajt \(opciono\)/).fill("javascript:alert(document.domain)");
      await page.getByLabel(/^Programi i sertifikacije/).fill(`Programi za test ${suffix}`);

      await page.getByRole("button", { name: "Završi registraciju" }).click();

      await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Registracija nije uspela" })).toBeVisible({ timeout: 10_000 });
      // Still on the registration form -- no redirect to the new business home.
      await expect(page).toHaveURL(/\/pridruzi-se-edukativni-centar/);

      const [createdUser] = await db.select().from(usersTable).where(eq(usersTable.email, email));
      expect(createdUser).toBeUndefined();
    } finally {
      await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, plan!.id));
    }
  });
});
