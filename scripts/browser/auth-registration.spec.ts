import { randomInt, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, phoneVerificationCodesTable, usersTable } from "@workspace/db";

const suffix = randomUUID();
const email = `browser-auth-registration-${suffix}@example.test`;
const phone = `+38164${randomInt(1_000_000, 10_000_000)}`;
const phoneNormalized = phone.replace(/\D/g, "");

test.afterAll(async () => {
  await db.delete(phoneVerificationCodesTable)
    .where(eq(phoneVerificationCodesTable.phoneNormalized, phoneNormalized));
  await db.delete(usersTable).where(eq(usersTable.email, email));
});

test("customer registration submits the SMS code populated by the form", async ({ page }) => {
  await page.goto("/prijava?tab=register");

  await page.locator('input[name="firstName"]').fill("Browser");
  await page.locator('input[name="lastName"]').fill("Registracija");
  await page.locator('input[name="email"]').last().fill(email);
  await page.locator('input[name="phone"]').fill(phone);
  await page.locator('input[name="password"]').last().fill("browser-registration-password");

  const verificationResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/auth/phone-verification/request")
    && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Pošalji kod" }).click();
  expect((await verificationResponsePromise).ok(), "the SMS verification request must succeed").toBe(true);

  const codeInput = page.locator('input[name="phoneVerificationCode"]');
  await expect(codeInput, "the development SMS code must remain in the controlled form").toHaveValue(/^\d{6}$/);
  const phoneVerificationCode = await codeInput.inputValue();

  const registerRequestPromise = page.waitForRequest((request) =>
    new URL(request.url()).pathname === "/api/auth/register"
    && request.method() === "POST",
  );
  const registerResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/auth/register"
    && response.request().method() === "POST",
  );

  await page.getByRole("button", { name: "Registruj se" }).click();

  const registerRequest = await registerRequestPromise;
  expect(registerRequest.postDataJSON()).toMatchObject({
    email,
    phone,
    phoneVerificationCode,
  });
  expect((await registerResponsePromise).ok(), "standard form submission must create the customer").toBe(true);
  await expect(page).toHaveURL(/\/moj-nalog$/);
});