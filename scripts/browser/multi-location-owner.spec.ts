import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db, salonsTable, usersTable } from "@workspace/db";

const scrypt = promisify(scryptCallback);

type Fixture = {
  ownerEmail: string;
  ownerPassword: string;
  ownerId: string;
  firstSalonId: string;
  secondSalonId: string;
  firstSalonName: string;
  secondSalonName: string;
};

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const ownerEmail = `browser-multi-location-${suffix}@example.test`;
  const ownerPassword = "browser-multi-location-password";
  const firstSalonName = `Mobilna prva lokacija ${suffix}`;
  const secondSalonName = `Mobilna druga lokacija ${suffix}`;
  const [owner] = await db.insert(usersTable).values({
    firstName: "Browser",
    lastName: "Vlasnik",
    email: ownerEmail,
    passwordHash: await hashPassword(ownerPassword),
    passwordSetAt: new Date(),
    role: "SALON_OWNER",
  }).returning({ id: usersTable.id });
  if (!owner) throw new Error("Multi-location browser fixture could not create an owner.");

  try {
    const [first, second] = await db.insert(salonsTable).values([
      {
        ownerId: owner.id, name: firstSalonName, slug: `browser-multi-first-${suffix}`,
        city: "Beograd", municipality: "Vračar", address: "Test 201", phone: "+381110000201",
        email: `browser-multi-first-${suffix}@example.test`, shortDescription: "Prva mobilna lokacija.",
        description: "Prva lokacija za proveru mobilnog izbora poslovnice.", imageUrl: "/test-browser-multi.jpg",
      },
      {
        ownerId: owner.id, name: secondSalonName, slug: `browser-multi-second-${suffix}`,
        city: "Novi Sad", municipality: "Centar", address: "Test 202", phone: "+381110000202",
        email: `browser-multi-second-${suffix}@example.test`, shortDescription: "Druga mobilna lokacija.",
        description: "Druga lokacija za proveru mobilnog izbora poslovnice.", imageUrl: "/test-browser-multi.jpg",
      },
    ]).returning({ id: salonsTable.id });
    if (!first || !second) throw new Error("Multi-location browser fixture could not create both salons.");
    await db.update(usersTable).set({ activeSalonId: first.id }).where(eq(usersTable.id, owner.id));
    return { ownerEmail, ownerPassword, ownerId: owner.id, firstSalonId: first.id, secondSalonId: second.id, firstSalonName, secondSalonName };
  } catch (error) {
    await db.delete(usersTable).where(eq(usersTable.id, owner.id));
    throw error;
  }
}

async function cleanUpFixture(fixture: Fixture): Promise<void> {
  await db.update(usersTable).set({ activeSalonId: null }).where(eq(usersTable.id, fixture.ownerId));
  await db.delete(salonsTable).where(inArray(salonsTable.id, [fixture.firstSalonId, fixture.secondSalonId]));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
}

async function signIn(page: Page, fixture: Fixture): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
  });
  expect(response).toBeOK();
}

test("owner can use the all-locations dashboard and switch location from mobile navigation", async ({ page }) => {
  const fixture = await createFixture();

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, fixture);
    await page.goto("/vlasnik");
    await expect(page.getByText(`${fixture.firstSalonName} - Pregled poslovanja`)).toBeVisible();

    await page.getByRole("button", { name: "Sve lokacije" }).click();
    await expect(page.getByText("Zbirni pregled za svih 2 lokacija")).toBeVisible();
    await expect(page.getByText("Učinak po lokaciji")).toBeVisible();
    await expect(page.getByRole("main").getByText(fixture.firstSalonName, { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText(fixture.secondSalonName, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Otvori meni" }).click();
    const mobileSalonSelect = page.getByLabel("Aktivni salon (mobilni)");
    await expect(mobileSalonSelect).toBeVisible();
    const switchResponse = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && new URL(response.url()).pathname === "/api/salon/active-salon",
    );
    await mobileSalonSelect.selectOption(fixture.secondSalonId);
    expect((await switchResponse).status()).toBe(200);
    await expect(page.getByText(`${fixture.secondSalonName} - Pregled poslovanja`)).toBeVisible();
  } finally {
    await cleanUpFixture(fixture);
  }
});