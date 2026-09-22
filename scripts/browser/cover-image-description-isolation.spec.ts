import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import {
  beautyJobCategoriesTable, beautyJobListingsTable, coursesTable, db,
  educationCentersTable, educationCenterSubscriptionsTable, productsTable,
  productCategoriesTable, suppliersTable, subscriptionPlansTable, salonsTable, usersTable,
} from "@workspace/db";
import { hashPassword } from "../../artifacts/api-server/src/lib/auth";
import { publicImageAlt } from "../../artifacts/beauty-marketplace/seo-text.mjs";

const suffix = randomUUID();
const mobileViewport = process.env.LUMERA_COVER_IMAGE_DESCRIPTION_MOBILE === "1";
const password = `cover-description-${suffix}`;
const emails = {
  owner: `cover-owner-${suffix}@example.test`,
  admin: `cover-admin-${suffix}@example.test`,
  educator: `cover-educator-${suffix}@example.test`,
  jobs: `cover-jobs-${suffix}@example.test`,
};
const ids = {
  users: [] as string[],
  salons: [] as string[],
  listings: [] as string[],
  jobCategories: [] as string[],
  products: [] as string[],
  productCategories: [] as string[],
  suppliers: [] as string[],
  courses: [] as string[],
  centers: [] as string[],
  plans: [] as string[],
};
const title = `Cover regression ${suffix.slice(0, 8)}`;
const names = {
  salon: `${title} salon`,
  product: `${title} product`,
  course: `${title} course`,
  listing: `${title} listing`,
  supplier: `${title} supplier`,
};

test.use(mobileViewport
  ? {
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    }
  : {});

test.beforeEach(async ({ page }) => {
  if (mobileViewport) {
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  }
});

async function login(context: BrowserContext, email: string, id: string) {
  const response = await context.request.post("/api/auth/login", { data: { email, password } });
  expect(response.ok()).toBe(true);
  expect((await (await context.request.get("/api/auth/me")).json()).user.id).toBe(id);
}

async function publicValue(context: BrowserContext, path: string) {
  const response = await context.request.get(path);
  expect(response.ok(), path).toBe(true);
  return (await response.json()).coverImageDescription;
}

async function expectSocialAlt(page: Page, path: string, expected: string) {
  await page.goto(path);
  await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute("content", expected);
  await expect(page.locator('meta[name="twitter:image:alt"]')).toHaveAttribute("content", expected);
}

async function saveAndWait(page: Page, path: string, buttonName: string | RegExp) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "PATCH" && url.pathname === path;
  });
  await page.getByRole("button", { name: buttonName }).last().click();
  const response = await responsePromise;
  expect(response.ok(), `${path} must save successfully`).toBe(true);
}

test.beforeAll(async () => {
  const passwordHash = await hashPassword(password);
  const users = await db.insert(usersTable).values([
    { firstName: "Cover", lastName: "Salon Owner", email: emails.owner, passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER" },
    { firstName: "Cover", lastName: "Administrator", email: emails.admin, passwordHash, passwordSetAt: new Date(), role: "ADMIN" },
    { firstName: "Cover", lastName: "Educator", email: emails.educator, passwordHash, passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR" },
    { firstName: "Cover", lastName: "Jobs Owner", email: emails.jobs, passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER" },
  ]).returning({ id: usersTable.id, email: usersTable.email });
  ids.users.push(...users.map((u) => u.id));
  const owner = users.find((u) => u.email === emails.owner)!;
  const jobsOwner = users.find((u) => u.email === emails.jobs)!;
  const salons = await db.insert(salonsTable).values([
    { ownerId: owner.id, name: names.salon, slug: `cover-regression-${suffix}`, city: "Beograd", municipality: "Vračar", address: "Test 1", postalCode: "11000", phone: "+381111234567", email: emails.owner, shortDescription: title, description: title, imageUrl: "/test.jpg" },
    { ownerId: jobsOwner.id, name: `${title} jobs salon`, slug: `cover-regression-jobs-${suffix}`, city: "Beograd", municipality: "Vračar", address: "Test 2", postalCode: "11000", phone: "+381111234568", email: emails.jobs, shortDescription: title, description: title, imageUrl: "/test.jpg" },
  ]).returning({ id: salonsTable.id, ownerId: salonsTable.ownerId });
  ids.salons.push(...salons.map((s) => s.id));
  await Promise.all(salons.map((s) => db.update(usersTable).set({ activeSalonId: s.id }).where(eq(usersTable.id, s.ownerId))));
  const [category] = await db.insert(beautyJobCategoriesTable).values({
    slug: `cover-regression-${suffix}`,
    name: `${title} category`,
  }).returning({ id: beautyJobCategoriesTable.id });
  ids.jobCategories.push(category!.id);
  const [listing] = await db.insert(beautyJobListingsTable).values({
    categoryId: category!.id, salonId: salons[1]!.id, postedByType: "salon", type: "job", title: names.listing,
    description: title, city: "Beograd", region: "Vračar", status: "active", moderationStatus: "approved",
    expiresAt: new Date(Date.now() + 86400000), photos: ["/test.jpg"],
  }).returning({ id: beautyJobListingsTable.id });
  ids.listings.push(listing!.id);
  const [supplier] = await db.insert(suppliersTable).values({
    name: names.supplier,
    slug: `cover-regression-${suffix}`,
    scope: "BOTH",
  }).returning({ id: suppliersTable.id, slug: suppliersTable.slug });
  ids.suppliers.push(supplier!.id);
  const [categoryRow] = await db.insert(productCategoriesTable).values({
    supplierId: supplier!.id,
    name: `${title} products`,
    slug: `cover-products-${suffix}`,
  }).returning({ id: productCategoriesTable.id, name: productCategoriesTable.name });
  ids.productCategories.push(categoryRow!.id);
  const [product] = await db.insert(productsTable).values({
    supplierId: supplier!.id, categoryId: categoryRow!.id, categoryName: categoryRow!.name,
    name: names.product, description: title, imageUrl: "/test.jpg", images: ["/test.jpg"], price: 1000,
    sku: `COVER-${suffix.slice(0, 10)}`, unit: "kom", retailEnabled: true, publicPrice: 1000,
    stock: 5, weightGrams: 500,
  }).returning({ id: productsTable.id });
  ids.products.push(product!.id);
  const [center] = await db.insert(educationCentersTable).values({
    ownerId: (users.find((u) => u.email === emails.educator)!).id,
    name: `${title} center`, city: "Beograd", description: title, imageUrl: "/test.jpg",
    verificationStatus: "verified", verifiedAt: new Date(),
  }).returning({ id: educationCentersTable.id });
  ids.centers.push(center!.id);
  const [plan] = await db.insert(subscriptionPlansTable).values({
    name: `${title} plan`,
    price: 0,
    audience: "education",
    courseLimit: 10,
  }).returning({ id: subscriptionPlansTable.id });
  ids.plans.push(plan!.id);
  await db.insert(educationCenterSubscriptionsTable).values({
    centerId: center!.id,
    planId: plan!.id,
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 86400000),
  });
  const [course] = await db.insert(coursesTable).values({
    centerId: center!.id, title: names.course, description: title, category: "Ostalo",
    format: "online", price: 1000, duration: "1 dan", imageUrl: "/test.jpg", published: true,
  }).returning({ id: coursesTable.id });
  ids.courses.push(course!.id);
});

test.afterAll(async () => {
  if (ids.listings.length) await db.delete(beautyJobListingsTable).where(inArray(beautyJobListingsTable.id, ids.listings));
  if (ids.jobCategories.length) await db.delete(beautyJobCategoriesTable).where(inArray(beautyJobCategoriesTable.id, ids.jobCategories));
  if (ids.courses.length) await db.delete(coursesTable).where(inArray(coursesTable.id, ids.courses));
  if (ids.products.length) await db.delete(productsTable).where(inArray(productsTable.id, ids.products));
  if (ids.productCategories.length) await db.delete(productCategoriesTable).where(inArray(productCategoriesTable.id, ids.productCategories));
  if (ids.suppliers.length) await db.delete(suppliersTable).where(inArray(suppliersTable.id, ids.suppliers));
  if (ids.centers.length) await db.delete(educationCentersTable).where(inArray(educationCentersTable.id, ids.centers));
  if (ids.plans.length) await db.delete(subscriptionPlansTable).where(inArray(subscriptionPlansTable.id, ids.plans));
  if (ids.salons.length) await db.delete(salonsTable).where(inArray(salonsTable.id, ids.salons));
  if (ids.users.length) await db.delete(usersTable).where(and(inArray(usersTable.id, ids.users), inArray(usersTable.email, Object.values(emails))));
});

test("salon owner cover description survives save, reload, clear, and public metadata fallback", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const owner = (await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, emails.owner)))[0]!;
    await login(context, emails.owner, owner.id);
    const page = await context.newPage();
    await page.goto("/vlasnik/profil");
    const field = page.locator("#salon-cover-description");
    await field.fill(`${title} owner description`);
    await saveAndWait(page, "/api/salon/profile", /sačuv/i);
    await expect(field).toHaveValue(`${title} owner description`);
    await page.reload();
    await expect(page.locator("#salon-cover-description")).toHaveValue(`${title} owner description`);
    await field.fill("");
    await saveAndWait(page, "/api/salon/profile", /sačuv/i);
    const salon = (await db.select({ slug: salonsTable.slug }).from(salonsTable).where(eq(salonsTable.ownerId, owner.id)))[0]!;
    expect(await publicValue(context, `/api/salons/${salon.slug}`)).toBeNull();
    await expectSocialAlt(page, `/saloni/${salon.slug}`, publicImageAlt({ name: names.salon, city: "Beograd" }));
  } finally { await context.close(); }
});

test("admin product editor persists and clears its cover description", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const admin = (await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, emails.admin)))[0]!;
    await login(context, emails.admin, admin.id);
    const page = await context.newPage();
    await page.goto("/admin/proizvodi");
    await page.getByTestId(`btn-edit-product-${ids.products[0]}`).click();
    const field = page.locator("#product-cover-description");
    await field.fill(`${title} product description`);
    await saveAndWait(page, `/api/admin/products/${ids.products[0]}`, /sačuv/i);
    await page.reload();
    await page.getByTestId(`btn-edit-product-${ids.products[0]}`).click();
    await expect(page.locator("#product-cover-description")).toHaveValue(`${title} product description`);
    await page.locator("#product-cover-description").fill("");
    await saveAndWait(page, `/api/admin/products/${ids.products[0]}`, /sačuv/i);
    const response = await context.request.get(`/api/shop/public/products/${ids.products[0]}`);
    expect(response.ok()).toBe(true);
    expect((await response.json()).coverImageDescription).toBeNull();
    await expectSocialAlt(
      page,
      `/shop/cover-regression-${suffix}/proizvod/${ids.products[0]}`,
      publicImageAlt({ name: names.product, category: `${title} products` }),
    );
  } finally { await context.close(); }
});

test("education course editor exposes cover description and persists clearing", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const educator = (await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, emails.educator)))[0]!;
    await login(context, emails.educator, educator.id);
    const page = await context.newPage();
    await page.goto(`/biznis/edukacije/${ids.courses[0]}`);
    await page.getByRole("button", { name: "Izmeni podatke kursa" }).click();
    const field = page.locator("#education-cover-description");
    await field.fill(`${title} course description`);
    await saveAndWait(page, `/api/education/courses/${ids.courses[0]}`, "Sačuvaj izmene");
    await page.reload();
    await page.getByRole("button", { name: "Izmeni podatke kursa" }).click();
    await expect(page.locator("#education-cover-description")).toHaveValue(`${title} course description`);
    await page.locator("#education-cover-description").fill("");
    await saveAndWait(page, `/api/education/courses/${ids.courses[0]}`, "Sačuvaj izmene");
    const response = await context.request.get(`/api/education/public/courses/${ids.courses[0]}`);
    expect(response.ok()).toBe(true);
    expect((await response.json()).coverImageDescription).toBeNull();
    await expectSocialAlt(page, `/edukacije/${ids.courses[0]}`, publicImageAlt({ name: names.course, category: "Ostalo", city: "Beograd" }));
  } finally { await context.close(); }
});

test("salon owner Beauty Jobs form persists and clears its cover description", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const owner = (await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, emails.jobs)))[0]!;
    await login(context, emails.jobs, owner.id);
    const page = await context.newPage();
    await page.goto("/biznis/poslovi");
    await page.getByTestId(`action-edit-${ids.listings[0]}`).click();
    const field = page.getByPlaceholder("Kratko opišite šta se vidi na prvoj slici");
    await field.fill(`${title} jobs description`);
    await saveAndWait(page, `/api/beauty-jobs/${ids.listings[0]}`, "Sačuvaj izmene");
    await page.reload();
    await page.getByTestId(`action-edit-${ids.listings[0]}`).click();
    await expect(page.getByPlaceholder("Kratko opišite šta se vidi na prvoj slici")).toHaveValue(`${title} jobs description`);
    await page.getByPlaceholder("Kratko opišite šta se vidi na prvoj slici").fill("");
    await saveAndWait(page, `/api/beauty-jobs/${ids.listings[0]}`, "Sačuvaj izmene");
    const listing = ids.listings[0]!;
    expect(await publicValue(context, `/api/beauty-jobs/${listing}`)).toBeNull();
    await expectSocialAlt(page, `/poslovi/cover-regression/${listing}`, publicImageAlt({ name: names.listing, category: `${title} category`, city: "Beograd" }));
  } finally { await context.close(); }
});