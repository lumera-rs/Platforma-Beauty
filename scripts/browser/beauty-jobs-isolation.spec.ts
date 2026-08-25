import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import {
  beautyJobCategoriesTable,
  beautyJobListingsTable,
  db,
  salonsTable,
  usersTable,
} from "@workspace/db";
import { hashPassword } from "../../artifacts/api-server/src/lib/auth";
import { ensureBusinessGrowthSchema } from "../../artifacts/api-server/src/lib/business-growth-schema";

const suffix = randomUUID();
const marker = `Browser izolacija ${suffix}`;
const password = `browser-beauty-jobs-password-${suffix}`;
const fixtureEmails = {
  ownerA: `browser-beauty-jobs-owner-a-${suffix}@example.test`,
  ownerB: `browser-beauty-jobs-owner-b-${suffix}@example.test`,
  customer: `browser-beauty-jobs-customer-${suffix}@example.test`,
};
const titles = {
  ownEmployment: `${marker} sopstveni posao`,
  competingEmployment: `${marker} konkurentski posao`,
  freelance: `${marker} freelance`,
  rental: `${marker} iznajmljivanje`,
  seeking: `${marker} tražim posao`,
};
const fixtureUserIds: string[] = [];
const fixtureSalonIds: string[] = [];
const fixtureListingIds: string[] = [];

async function cleanUpFixtures(): Promise<void> {
  if (fixtureListingIds.length > 0) {
    await db.delete(beautyJobListingsTable).where(inArray(beautyJobListingsTable.id, fixtureListingIds));
  }
  if (fixtureSalonIds.length > 0) {
    await db.delete(salonsTable).where(inArray(salonsTable.id, fixtureSalonIds));
  }
  if (fixtureUserIds.length > 0) {
    await db.delete(usersTable).where(and(
      inArray(usersTable.id, fixtureUserIds),
      inArray(usersTable.email, Object.values(fixtureEmails)),
    ));
  }
}

async function signIn(context: BrowserContext, email: string, expectedUserId: string): Promise<void> {
  const login = await context.request.post("/api/auth/login", {
    data: { email, password },
  });
  expect(login.ok(), `${email} must be able to sign in`).toBe(true);
  const currentUser = await context.request.get("/api/auth/me");
  expect(currentUser.ok()).toBe(true);
  expect((await currentUser.json()).user.id).toBe(expectedUserId);
}

async function openCatalog(page: Page) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/beauty-jobs"
      && url.searchParams.get("query") === marker;
  });
  await page.goto(`/poslovi?query=${encodeURIComponent(marker)}`);
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{ items: Array<{ id: string; title: string }>; total: number }>;
}

test.afterAll(cleanUpFixtures);

test("keeps competing employment out of an owner's catalog without hiding public listing types", async ({ browser }) => {
  await ensureBusinessGrowthSchema();
  const passwordHash = await hashPassword(password);
  const createdUsers = await db.insert(usersTable).values([
    {
      firstName: "Owner A",
      lastName: "Beauty Poslovi",
      email: fixtureEmails.ownerA,
      passwordHash,
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    },
    {
      firstName: "Owner B",
      lastName: "Beauty Poslovi",
      email: fixtureEmails.ownerB,
      passwordHash,
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    },
    {
      firstName: "Customer",
      lastName: "Beauty Poslovi",
      email: fixtureEmails.customer,
      passwordHash,
      passwordSetAt: new Date(),
      role: "CUSTOMER",
    },
  ]).returning({ id: usersTable.id, email: usersTable.email });
  fixtureUserIds.push(...createdUsers.map((user) => user.id));
  const ownerA = createdUsers.find((user) => user.email === fixtureEmails.ownerA)!;
  const ownerB = createdUsers.find((user) => user.email === fixtureEmails.ownerB)!;
  const customer = createdUsers.find((user) => user.email === fixtureEmails.customer)!;

  const createdSalons = await db.insert(salonsTable).values([
    {
      ownerId: ownerA.id,
      name: `Browser salon A ${suffix}`,
      slug: `browser-beauty-jobs-a-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 1",
      postalCode: "11000",
      phone: "+381111234567",
      email: `salon-a-${suffix}@example.test`,
      shortDescription: "Izolovani browser salon A",
      description: "Izolovani browser salon A",
      imageUrl: "/test.jpg",
    },
    {
      ownerId: ownerB.id,
      name: `Browser salon B ${suffix}`,
      slug: `browser-beauty-jobs-b-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 2",
      postalCode: "11000",
      phone: "+381111234568",
      email: `salon-b-${suffix}@example.test`,
      shortDescription: "Izolovani browser salon B",
      description: "Izolovani browser salon B",
      imageUrl: "/test.jpg",
    },
  ]).returning({ id: salonsTable.id, ownerId: salonsTable.ownerId });
  fixtureSalonIds.push(...createdSalons.map((salon) => salon.id));
  const salonA = createdSalons.find((salon) => salon.ownerId === ownerA.id)!;
  const salonB = createdSalons.find((salon) => salon.ownerId === ownerB.id)!;
  await Promise.all([
    db.update(usersTable).set({ activeSalonId: salonA.id }).where(eq(usersTable.id, ownerA.id)),
    db.update(usersTable).set({ activeSalonId: salonB.id }).where(eq(usersTable.id, ownerB.id)),
  ]);

  const [category] = await db.select({ id: beautyJobCategoriesTable.id })
    .from(beautyJobCategoriesTable)
    .where(eq(beautyJobCategoriesTable.slug, "frizeri"))
    .limit(1);
  expect(category, "the Beauty Poslovi seed must provide a public category").toBeTruthy();

  const baseListing = {
    categoryId: category!.id,
    postedByType: "salon" as const,
    description: `Izolovani browser sadržaj ${suffix}`,
    city: "Beograd",
    region: "Vračar",
    priceAmount: 1000,
    pricePeriod: "month" as const,
    status: "active" as const,
    moderationStatus: "approved" as const,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
  const createdListings = await db.insert(beautyJobListingsTable).values([
    { ...baseListing, salonId: salonA.id, type: "job", intent: "offering", title: titles.ownEmployment },
    { ...baseListing, salonId: salonB.id, type: "job", intent: "offering", title: titles.competingEmployment },
    { ...baseListing, salonId: salonB.id, type: "freelance", intent: "offering", title: titles.freelance },
    { ...baseListing, salonId: salonB.id, type: "space_rental", intent: "offering", title: titles.rental },
    { ...baseListing, salonId: salonB.id, type: "job", intent: "seeking", title: titles.seeking },
  ]).returning({ id: beautyJobListingsTable.id, title: beautyJobListingsTable.title });
  fixtureListingIds.push(...createdListings.map((listing) => listing.id));

  const ownerAContext = await browser.newContext();
  const ownerBContext = await browser.newContext();
  const customerContext = await browser.newContext();
  const guestContext = await browser.newContext();
  try {
    await Promise.all([
      signIn(ownerAContext, fixtureEmails.ownerA, ownerA.id),
      signIn(ownerBContext, fixtureEmails.ownerB, ownerB.id),
      signIn(customerContext, fixtureEmails.customer, customer.id),
    ]);

    const ownerPage = await ownerAContext.newPage();
    const ownerCatalog = await openCatalog(ownerPage);
    expect(ownerCatalog.total).toBe(4);
    expect(ownerCatalog.items.map((item) => item.title).sort()).toEqual([
      titles.freelance,
      titles.ownEmployment,
      titles.rental,
      titles.seeking,
    ].sort());
    await expect(ownerPage.getByText(titles.competingEmployment, { exact: true })).toHaveCount(0);
    for (const visibleTitle of [titles.ownEmployment, titles.freelance, titles.rental, titles.seeking]) {
      await expect(ownerPage.getByText(visibleTitle, { exact: true })).toBeVisible();
    }
    await expect(ownerPage.getByText("Prikazano 4 oglasa", { exact: true })).toBeVisible();

    for (const context of [customerContext, guestContext]) {
      const audiencePage = await context.newPage();
      const audienceCatalog = await openCatalog(audiencePage);
      expect(audienceCatalog.total).toBe(5);
      expect(audienceCatalog.items.some((item) => item.title === titles.competingEmployment)).toBe(true);
      await expect(audiencePage.getByText(titles.competingEmployment, { exact: true })).toBeVisible();
      await expect(audiencePage.getByText("Prikazano 5 oglasa", { exact: true })).toBeVisible();
    }
  } finally {
    await Promise.all([
      ownerAContext.close(),
      ownerBContext.close(),
      customerContext.close(),
      guestContext.close(),
    ]);
  }
});