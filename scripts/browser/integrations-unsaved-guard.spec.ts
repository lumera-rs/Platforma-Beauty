/**
 * Admin integrations unsaved-changes guard — browser regression.
 *
 * The /admin/integracije page applies typed values, generated webhook
 * secrets, and toggled "Omogući integraciju" switches only after "Sačuvaj".
 * A leave-page guard (capture-phase anchor clicks + popstate + beforeunload)
 * must therefore confirm before any navigation while the form is dirty:
 *
 *  1. In-app link navigation with a freshly generated webhook secret shows
 *     the Serbian confirm; cancel stays on the page with the value intact,
 *     accept navigates away.
 *  2. Browser Back (same-document history traversal) shows the same confirm;
 *     cancel must keep the component mounted so the unsaved secret survives
 *     (the guard re-pushes the page URL in the same task as the popstate),
 *     accept leaves to the previous history entry.
 *  3. A toggled enabled switch alone counts as unsaved; reverting the toggle
 *     (or clearing typed values) removes the guard and navigation proceeds
 *     without any dialog.
 *
 * The spec never clicks "Sačuvaj", so shared development integration
 * settings are left untouched; the only fixture is a disposable admin user.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { inArray } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

const scrypt = promisify(scryptCallback);

const GUARD_MESSAGE_FRAGMENT = "Imate nesačuvane izmene";
const HEX_SECRET = /^[0-9a-f]{64}$/;

const suffix = randomUUID();
const password = "browser-integrations-guard-password";
const adminEmail = `browser-integrations-guard-admin-${suffix}@example.test`;
const createdUserIds: string[] = [];

async function hashPassword(value: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(value, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

test.beforeAll(async () => {
  const inserted = await db.insert(usersTable).values({
    firstName: "Browser",
    lastName: "Integrations Guard",
    email: adminEmail,
    passwordHash: await hashPassword(password),
    passwordSetAt: new Date(),
    role: "ADMIN",
  }).returning();
  if (inserted.length !== 1) throw new Error("The guard fixture could not create the admin.");
  createdUserIds.push(...inserted.map((user) => user.id));
});

test.afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

/**
 * One persistent dialog handler per page: every confirm is recorded and then
 * accepted or dismissed according to the current mode. Steps that expect no
 * dialog assert that the recorded count did not grow.
 */
function trackDialogs(page: Page) {
  const state = { messages: [] as string[], action: "dismiss" as "accept" | "dismiss" };
  page.on("dialog", (dialog) => {
    state.messages.push(dialog.message());
    void (state.action === "accept" ? dialog.accept() : dialog.dismiss());
  });
  return state;
}

async function openIntegrationsPage(page: Page) {
  const login = await page.request.post("/api/auth/login", {
    data: { email: adminEmail, password },
  });
  expect(login.ok(), "the guard admin must be able to sign in").toBe(true);
  await page.goto("/admin/integracije");
  await expect(page.getByRole("heading", { name: "Integracije i konektori" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "E-mail · Brevo" })).toBeVisible();
}

test("a generated secret guards in-app link navigation: cancel keeps the value, clearing lifts the guard, accept leaves", async ({ page }) => {
  test.setTimeout(120_000);
  const dialogs = trackDialogs(page);
  await openIntegrationsPage(page);

  // Generate an (unsaved) Brevo webhook secret.
  await page.getByTestId("generate-webhook-secret-brevo").click();
  const secretInput = page.getByTestId("input-webhook-secret-brevo");
  const generatedSecret = await secretInput.inputValue();
  expect(generatedSecret).toMatch(HEX_SECRET);

  // Cancelled link navigation stays on the page with the secret intact.
  dialogs.action = "dismiss";
  await page.getByTestId("admin-nav-saloni").click();
  await expect.poll(() => dialogs.messages.length, { message: "the leave confirm must appear" }).toBe(1);
  expect(dialogs.messages[0]).toContain(GUARD_MESSAGE_FRAGMENT);
  await expect(page).toHaveURL(/\/admin\/integracije$/);
  await expect(secretInput).toHaveValue(generatedSecret);

  // Clearing the field removes the guard: navigation proceeds silently.
  await secretInput.fill("");
  await page.getByTestId("admin-nav-saloni").click();
  await expect(page).toHaveURL(/\/admin\/saloni$/);
  expect(dialogs.messages, "no dialog may appear once the form is clean").toHaveLength(1);

  // Back on the page, an accepted confirm allows the navigation through.
  await page.getByTestId("admin-nav-integracije").click();
  await expect(page.getByRole("heading", { name: "E-mail · Brevo" })).toBeVisible();
  await page.getByTestId("generate-webhook-secret-brevo").click();
  await expect(secretInput).toHaveValue(HEX_SECRET);
  dialogs.action = "accept";
  await page.getByTestId("admin-nav-saloni").click();
  await expect(page).toHaveURL(/\/admin\/saloni$/);
  expect(dialogs.messages).toHaveLength(2);
  expect(dialogs.messages[1]).toContain(GUARD_MESSAGE_FRAGMENT);
});

test("browser Back with an unsaved secret: cancel preserves the form without remounting, accept leaves", async ({ page }) => {
  test.setTimeout(120_000);
  const dialogs = trackDialogs(page);
  await openIntegrationsPage(page);

  // Build same-document history so Back is a popstate traversal, not a
  // cross-document load: integracije → saloni → integracije.
  await page.getByTestId("admin-nav-saloni").click();
  await expect(page).toHaveURL(/\/admin\/saloni$/);
  await page.getByTestId("admin-nav-integracije").click();
  await expect(page.getByRole("heading", { name: "E-mail · Brevo" })).toBeVisible();

  await page.getByTestId("generate-webhook-secret-brevo").click();
  const secretInput = page.getByTestId("input-webhook-secret-brevo");
  const generatedSecret = await secretInput.inputValue();
  expect(generatedSecret).toMatch(HEX_SECRET);

  // Cancelled Back: the guard re-pushes the page URL, so the component never
  // unmounts — URL and the unsaved secret must both survive.
  dialogs.action = "dismiss";
  await page.evaluate(() => window.history.back());
  await expect.poll(() => dialogs.messages.length, { message: "the Back confirm must appear" }).toBe(1);
  expect(dialogs.messages[0]).toContain(GUARD_MESSAGE_FRAGMENT);
  await expect(page).toHaveURL(/\/admin\/integracije$/);
  await expect(secretInput).toHaveValue(generatedSecret);

  // Accepted Back leaves to the previous same-document entry.
  dialogs.action = "accept";
  await page.evaluate(() => window.history.back());
  await expect.poll(() => dialogs.messages.length).toBe(2);
  expect(dialogs.messages[1]).toContain(GUARD_MESSAGE_FRAGMENT);
  await expect(page).toHaveURL(/\/admin\/saloni$/);
});

test("a toggled enabled switch alone is unsaved: navigation confirms, reverting the toggle lifts the guard", async ({ page }) => {
  test.setTimeout(120_000);
  const dialogs = trackDialogs(page);
  await openIntegrationsPage(page);

  const facebookToggle = page.getByTestId("toggle-enabled-facebook_oauth");
  const initiallyChecked = await facebookToggle.isChecked();

  // Flip the switch without saving — that alone must arm the guard.
  await facebookToggle.setChecked(!initiallyChecked);
  dialogs.action = "dismiss";
  await page.getByTestId("admin-nav-saloni").click();
  await expect.poll(() => dialogs.messages.length, { message: "the toggle-only confirm must appear" }).toBe(1);
  expect(dialogs.messages[0]).toContain(GUARD_MESSAGE_FRAGMENT);
  await expect(page).toHaveURL(/\/admin\/integracije$/);
  // The cancelled navigation kept the pending (unsaved) toggle state.
  expect(await facebookToggle.isChecked()).toBe(!initiallyChecked);

  // Reverting to the loaded baseline disarms the guard.
  await facebookToggle.setChecked(initiallyChecked);
  await page.getByTestId("admin-nav-saloni").click();
  await expect(page).toHaveURL(/\/admin\/saloni$/);
  expect(dialogs.messages, "no dialog may appear after the toggle is reverted").toHaveLength(1);
});
