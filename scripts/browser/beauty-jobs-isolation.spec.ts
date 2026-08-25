import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import {
  beautyJobCategoriesTable,
  beautyJobListingsTable,
  db,
  usersTable,
} from "@workspace/db";
import { hashPassword } from "../../artifacts/api-server/src/lib/auth";
import { ensureBusinessGrowthSchema } from "../../artifacts/api-server/src/lib/business-growth-schema";

const suffix = randomUUID();
const email = `browser-beauty-jobs-${suffix}@example.test`;
const password = `browser-beauty-jobs-password-${suffix}`;
const title = `Browser testni oglas ${suffix}`;
let fixtureUserId: string | undefined;
let fixtureListingId: string | undefined;

async function cleanUpFixture(): Promise<void> {
  if (!fixtureUserId) return;

  // Confirm both the generated id and email before deleting anything. This
  // keeps cleanup tied to the fixture identity, never to a title or marker
  // that ordinary user content could contain.
  const [fixtureUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, fixtureUserId), eq(usersTable.email, email)))
    .limit(1);
  if (!fixtureUser) return;

  if (fixtureListingId) {
    await db.delete(beautyJobListingsTable).where(and(
      eq(beautyJobListingsTable.id, fixtureListingId),
      eq(beautyJobListingsTable.userId, fixtureUser.id),
    ));
  }
  await db.delete(beautyJobListingsTable).where(eq(beautyJobListingsTable.userId, fixtureUser.id));
  await db.delete(usersTable).where(and(eq(usersTable.id, fixtureUser.id), eq(usersTable.email, email)));
}

test.afterAll(cleanUpFixture);

test("removes a browser-created Beauty Poslovi listing before the public catalog can retain it", async ({ page }) => {
  await ensureBusinessGrowthSchema();
  const passwordHash = await hashPassword(password);
  const [fixtureUser] = await db.insert(usersTable).values({
    firstName: "Browser",
    lastName: "Beauty Poslovi",
    email,
    passwordHash,
    passwordSetAt: new Date(),
    role: "CUSTOMER",
  }).returning({ id: usersTable.id });
  expect(fixtureUser).toBeTruthy();
  fixtureUserId = fixtureUser!.id;

  const login = await page.request.post("/api/auth/login", {
    data: { email, password },
  });
  expect(login.ok(), "the fixture identity must be able to sign in").toBe(true);
  const loggedInUser = await page.request.get("/api/auth/me");
  expect(loggedInUser.ok()).toBe(true);
  expect((await loggedInUser.json()).user.id).toBe(fixtureUserId);

  const [category] = await db.select({ id: beautyJobCategoriesTable.id })
    .from(beautyJobCategoriesTable)
    .where(eq(beautyJobCategoriesTable.slug, "frizeri"))
    .limit(1);
  expect(category, "the Beauty Poslovi seed must provide a public category").toBeTruthy();

  const [fixtureListing] = await db.insert(beautyJobListingsTable).values({
    categoryId: category!.id,
    userId: fixtureUserId,
    postedByType: "user",
    type: "job",
    intent: "offering",
    title,
    description: `Sadržaj browser oglasa ${suffix}`,
    city: "Beograd",
    region: "Vračar",
    priceAmount: 1000,
    pricePeriod: "month",
    status: "active",
    moderationStatus: "approved",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }).returning({ id: beautyJobListingsTable.id });
  expect(fixtureListing).toBeTruthy();
  fixtureListingId = fixtureListing!.id;

  const publicQuery = `/poslovi?query=${encodeURIComponent(title)}`;
  const visibleResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "GET"
      && new URL(response.url()).pathname === "/api/beauty-jobs"
      && new URL(response.url()).searchParams.get("query") === title;
  });
  await page.goto(publicQuery);
  const visibleResponse = await visibleResponsePromise;
  expect(visibleResponse.ok()).toBe(true);
  expect((await visibleResponse.json()).items.some((item: { id: string }) => item.id === fixtureListingId)).toBe(true);
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  await cleanUpFixture();

  const hiddenResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "GET"
      && new URL(response.url()).pathname === "/api/beauty-jobs"
      && new URL(response.url()).searchParams.get("query") === title;
  });
  await page.reload();
  const hiddenResponse = await hiddenResponsePromise;
  expect(hiddenResponse.ok()).toBe(true);
  expect((await hiddenResponse.json()).items.some((item: { id: string }) => item.id === fixtureListingId)).toBe(false);
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
});