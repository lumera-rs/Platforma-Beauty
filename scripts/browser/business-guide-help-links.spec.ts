/**
 * Business guide help-link browser regression.
 *
 * The guide-link release check verifies IDs statically, but only a browser
 * journey proves that the rendered shortcut preserves its hash and that the
 * asynchronously loaded guide renders the matching anchor.
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db, employeesTable, salonsTable, usersTable } from "@workspace/db";

const scrypt = promisify(scryptCallback);

const OWNER_HELP_IDS = [
  "vl-dashboard",
  "vl-kalendar",
  "vl-usluge",
  "vl-resursi",
  "vl-profil",
  "vl-zaposleni",
  "vl-klijenti",
  "vl-inventar",
  "vl-radno-vreme",
  "vl-automatizacije",
  "vl-paketi",
  "vl-performanse",
  "vl-ai",
  "vl-shop",
  "vl-porudzbine",
  "vl-obavestenja",
  "vl-loyalty",
  "vl-edukacije",
] as const;

const EMPLOYEE_HELP_IDS = [
  "za-performanse",
  "za-radno-vreme",
  "za-zamene",
  "za-profil",
  "za-zakazivanje",
  "za-portal",
  "za-termini",
  "za-odsustva",
  "za-ostalo",
  "za-ostalo",
  "za-odsustva",
] as const;

const OWNER_MOBILE_NAV_HELP_IDS = [
  "vl-dashboard",
  "vl-kalendar",
  "vl-usluge",
  "vl-zaposleni",
  "vl-radno-vreme",
  "vl-inventar",
  "vl-shop",
  "vl-porudzbine",
  "vl-obavestenja",
  "vl-edukacije",
] as const;

const EMPLOYEE_MOBILE_NAV_HELP_IDS = [
  "za-portal",
  "za-ostalo",
] as const;

type GuideHelpFixture = {
  owner: { email: string; password: string; id: string };
  employee: { email: string; password: string; id: string };
  salonId: string;
};

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function createGuideHelpFixture(): Promise<GuideHelpFixture> {
  const suffix = randomUUID();
  const ownerPassword = "browser-guide-help-owner-password";
  const employeePassword = "browser-guide-help-employee-password";
  const ownerEmail = `browser-guide-help-owner-${suffix}@example.test`;
  const employeeEmail = `browser-guide-help-employee-${suffix}@example.test`;
  const passwordHash = await hashPassword(ownerPassword);
  const employeePasswordHash = await hashPassword(employeePassword);
  let ownerId: string | undefined;
  let employeeUserId: string | undefined;
  let salonId: string | undefined;

  try {
    const [owner] = await db.insert(usersTable).values({
      firstName: "Browser",
      lastName: "Vlasnik",
      email: ownerEmail,
      passwordHash,
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    }).returning({ id: usersTable.id });
    if (!owner) throw new Error("Guide-help browser fixture could not create its owner.");
    ownerId = owner.id;

    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id,
      name: `Browser salon za vodič ${suffix}`,
      slug: `browser-guide-help-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 301",
      phone: "+38111000301",
      email: `browser-guide-help-salon-${suffix}@example.test`,
      shortDescription: "Izolovan salon za browser proveru linkova vodiča.",
      description: "Salon je napravljen samo za browser regresioni test linkova vodiča.",
      imageUrl: "/test-browser-guide-help.jpg",
    }).returning({ id: salonsTable.id });
    if (!salon) throw new Error("Guide-help browser fixture could not create its salon.");
    salonId = salon.id;

    const [employeeUser] = await db.insert(usersTable).values({
      firstName: "Browser",
      lastName: "Zaposleni",
      email: employeeEmail,
      activeSalonId: salon.id,
      passwordHash: employeePasswordHash,
      passwordSetAt: new Date(),
      role: "SALON_EMPLOYEE",
    }).returning({ id: usersTable.id });
    if (!employeeUser) throw new Error("Guide-help browser fixture could not create its employee account.");
    employeeUserId = employeeUser.id;

    const [employee] = await db.insert(employeesTable).values({
      salonId: salon.id,
      userId: employeeUser.id,
      name: "Browser Zaposleni",
      role: "Terapeut",
      bio: "Zaposleni za browser proveru linkova vodiča.",
      avatarUrl: "/test-browser-guide-help.jpg",
      email: employeeEmail,
    }).returning({ id: employeesTable.id });
    if (!employee) throw new Error("Guide-help browser fixture could not create its employee profile.");
    await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));

    return {
      owner: { email: ownerEmail, password: ownerPassword, id: owner.id },
      employee: { email: employeeEmail, password: employeePassword, id: employeeUser.id },
      salonId: salon.id,
    };
  } catch (error) {
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    const userIds = [ownerId, employeeUserId].filter((id): id is string => Boolean(id));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    throw error;
  }
}

async function cleanUpGuideHelpFixture(fixture: GuideHelpFixture): Promise<void> {
  await db.delete(salonsTable).where(eq(salonsTable.id, fixture.salonId));
  await db.delete(usersTable).where(inArray(usersTable.id, [fixture.owner.id, fixture.employee.id]));
}

async function signIn(page: Page, account: { email: string; password: string }): Promise<void> {
  const response = await page.request.post("/api/auth/login", { data: account });
  expect(response, `The guide-help ${account.email} fixture must be able to sign in.`).toBeOK();
}

async function assertVisibleHelpLinksReachSections(
  page: Page,
  startPath: string,
  expectedIds: readonly string[],
  options: {
    mobileMenu?: boolean;
    keyboard?: boolean;
    assertFocusIndicator?: boolean;
    darkTheme?: boolean;
  } = {},
): Promise<void> {
  await page.goto(startPath);
  await expect(page.locator("body")).not.toContainText("404");
  if (options.darkTheme) {
    await page.evaluate(() => document.documentElement.classList.add("dark"));
  }

  if (options.mobileMenu) {
    const mobileMenuButton = page.getByTestId("button-mobile-menu");
    const mobileMenuShortcuts = page.locator("nav").locator('[data-testid^="guide-help-"]');
    await expect(mobileMenuButton).toBeVisible();
    if (options.keyboard) {
      await mobileMenuButton.focus();
      await expect(mobileMenuButton).toBeFocused();
      if (options.assertFocusIndicator) {
        const focusIndicator = await mobileMenuButton.evaluate((element) => {
          const styles = window.getComputedStyle(element);
          const outlineWidth = Number.parseFloat(styles.outlineWidth);
          const shadowDimensions = styles.boxShadow.match(/-?\d*\.?\d+px/g)?.map(Number) ?? [];

          return {
            hasVisibleOutline: styles.outlineStyle !== "none"
              && Number.isFinite(outlineWidth)
              && outlineWidth > 0,
            hasVisibleShadow: styles.boxShadow !== "none"
              && shadowDimensions.some((dimension) => dimension !== 0),
            outlineStyle: styles.outlineStyle,
            outlineWidth: styles.outlineWidth,
            boxShadow: styles.boxShadow,
          };
        });
        expect(
          focusIndicator.hasVisibleOutline || focusIndicator.hasVisibleShadow,
          "The mobile business-menu toggle must expose a visible focus outline or ring with non-zero geometry.",
        ).toBeTruthy();
      }
      await mobileMenuButton.press("Enter");
      await expect(mobileMenuShortcuts).toHaveCount(expectedIds.length);
      await page.keyboard.press("Escape");
      await expect(mobileMenuShortcuts).toHaveCount(0);
      await expect(mobileMenuButton).toBeFocused();
      await mobileMenuButton.press("Enter");
      await expect(mobileMenuShortcuts).toHaveCount(expectedIds.length);

      const mobileMenu = page.getByTestId("business-mobile-menu");
      const focusableMenuControls = mobileMenu.locator(
        'a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const focusableMenuControlCount = await focusableMenuControls.count();
      expect(focusableMenuControlCount, "The open business mobile menu must contain focusable controls.").toBeGreaterThan(1);
      const firstMenuControl = focusableMenuControls.first();
      const lastMenuControl = focusableMenuControls.last();

      await firstMenuControl.focus();
      await expect(firstMenuControl).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(lastMenuControl, "Shift+Tab from the first business-menu control must wrap to the last.").toBeFocused();
      await page.keyboard.press("Tab");
      await expect(firstMenuControl, "Tab from the last business-menu control must wrap to the first.").toBeFocused();

      await mobileMenuButton.press("Enter");
      await expect(mobileMenuShortcuts).toHaveCount(0);
      await expect(mobileMenuButton).toBeFocused();
      await mobileMenuButton.press("Enter");
    } else {
      await mobileMenuButton.click();
    }
    // Establish keyboard modality before focusing shortcuts so :focus-visible
    // reflects the keyboard journey.
    await page.keyboard.press("Tab");
  }

  const shortcuts = options.mobileMenu
    ? page.locator("nav").locator('[data-testid^="guide-help-"]:visible')
    : page.locator('[data-testid^="guide-help-"]:visible');
  await expect(shortcuts, `${startPath} must render every expected visible help shortcut.`)
    .toHaveCount(expectedIds.length);
  const sectionIds = await shortcuts.evaluateAll((elements) => elements.map((element) => {
    const testId = element.getAttribute("data-testid");
    if (!testId) throw new Error("Visible guide shortcut is missing its test id.");
    return testId.replace("guide-help-", "");
  }));
  expect([...sectionIds].sort()).toEqual([...expectedIds].sort());

  for (let index = 0; index < sectionIds.length; index += 1) {
    const sectionId = sectionIds[index]!;
    const shortcut = shortcuts.nth(index);
    await expect(shortcut).toHaveAttribute("href", `/biznis/vodic#${sectionId}`);

    const navigation = page.waitForURL((url) => url.pathname === "/biznis/vodic" && url.hash === `#${sectionId}`);
    if (options.keyboard) {
      await shortcut.focus();
      await expect(shortcut).toBeFocused();
      if (options.assertFocusIndicator) {
        const focusIndicator = await shortcut.evaluate((element) => {
          const styles = window.getComputedStyle(element);
          const outlineWidth = Number.parseFloat(styles.outlineWidth);
          const shadowDimensions = styles.boxShadow.match(/-?\d*\.?\d+px/g)?.map(Number) ?? [];

          return {
            hasVisibleOutline: styles.outlineStyle !== "none"
              && Number.isFinite(outlineWidth)
              && outlineWidth > 0,
            hasVisibleShadow: styles.boxShadow !== "none"
              && shadowDimensions.some((dimension) => dimension !== 0),
            outlineStyle: styles.outlineStyle,
            outlineWidth: styles.outlineWidth,
            boxShadow: styles.boxShadow,
          };
        });
        expect(
          focusIndicator.hasVisibleOutline || focusIndicator.hasVisibleShadow,
          `${sectionId} must expose a visible focus outline or ring with non-zero geometry.`,
        ).toBeTruthy();
      }
      await Promise.all([navigation, shortcut.press("Enter")]);
    } else {
      await Promise.all([navigation, shortcut.click()]);
    }

    const section = page.locator(`article#${sectionId}`);
    await expect(section, `The guide must contain the ${sectionId} destination.`).toHaveCount(1);
    await expect(section.locator("h3")).toBeVisible();

    await page.goto(startPath);
    if (options.darkTheme) {
      await page.evaluate(() => document.documentElement.classList.add("dark"));
    }
    if (options.mobileMenu) {
      const mobileMenuButton = page.getByTestId("button-mobile-menu");
      if (options.keyboard) {
        await mobileMenuButton.focus();
        await expect(mobileMenuButton).toBeFocused();
        await mobileMenuButton.press("Enter");
      } else {
        await mobileMenuButton.click();
      }
      await page.keyboard.press("Tab");
    }
    await expect(shortcuts).toHaveCount(expectedIds.length);
  }
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText;
    // The owner navbar deliberately closes its EventSource whenever a route
    // changes; Chromium reports that normal teardown as an aborted request.
    if (request.resourceType() === "eventsource" && failure === "net::ERR_ABORTED") return;
    errors.push(`request: ${request.method()} ${request.url()} — ${failure ?? "failed"}`);
  });
  page.on("response", (response) => {
    if (response.request().resourceType() === "document" && response.status() >= 400) {
      errors.push(`navigation: ${response.status()} ${response.url()}`);
    }
  });
  return errors;
}

test("owner help shortcuts open their matching guide sections", async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await createGuideHelpFixture();
  const browserErrors = collectBrowserErrors(page);

  try {
    await signIn(page, fixture.owner);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await assertVisibleHelpLinksReachSections(page, "/vlasnik", OWNER_HELP_IDS);
    expect(browserErrors, "The owner guide journey must not produce browser errors.").toEqual([]);
  } finally {
    await cleanUpGuideHelpFixture(fixture);
  }
});

test("employee portal help shortcuts open their matching guide sections", async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await createGuideHelpFixture();
  const browserErrors = collectBrowserErrors(page);

  try {
    await signIn(page, fixture.employee);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await assertVisibleHelpLinksReachSections(page, "/zaposleni", EMPLOYEE_HELP_IDS);
    expect(browserErrors, "The employee guide journey must not produce browser errors.").toEqual([]);
  } finally {
    await cleanUpGuideHelpFixture(fixture);
  }
});

test("owner desktop help shortcuts open their matching guide sections from the keyboard", async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await createGuideHelpFixture();
  const browserErrors = collectBrowserErrors(page);

  try {
    await signIn(page, fixture.owner);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await assertVisibleHelpLinksReachSections(page, "/vlasnik", OWNER_HELP_IDS, {
      keyboard: true,
      assertFocusIndicator: true,
      darkTheme: true,
    });
    expect(browserErrors, "The owner desktop keyboard guide journey must not produce browser errors.").toEqual([]);
  } finally {
    await cleanUpGuideHelpFixture(fixture);
  }
});

test("employee desktop help shortcuts open their matching guide sections from the keyboard", async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await createGuideHelpFixture();
  const browserErrors = collectBrowserErrors(page);

  try {
    await signIn(page, fixture.employee);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await assertVisibleHelpLinksReachSections(page, "/zaposleni", EMPLOYEE_HELP_IDS, {
      keyboard: true,
      assertFocusIndicator: true,
      darkTheme: true,
    });
    expect(browserErrors, "The employee desktop keyboard guide journey must not produce browser errors.").toEqual([]);
  } finally {
    await cleanUpGuideHelpFixture(fixture);
  }
});

test("owner mobile business-menu help shortcuts open their matching guide sections", async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await createGuideHelpFixture();
  const browserErrors = collectBrowserErrors(page);

  try {
    await signIn(page, fixture.owner);
    await page.setViewportSize({ width: 390, height: 844 });
    await assertVisibleHelpLinksReachSections(page, "/vlasnik", OWNER_MOBILE_NAV_HELP_IDS, {
      mobileMenu: true,
      keyboard: true,
      assertFocusIndicator: true,
      darkTheme: true,
    });
    expect(browserErrors, "The owner mobile guide journey must not produce browser errors.").toEqual([]);
  } finally {
    await cleanUpGuideHelpFixture(fixture);
  }
});

test("employee mobile business-menu help shortcuts open their matching guide sections", async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await createGuideHelpFixture();
  const browserErrors = collectBrowserErrors(page);

  try {
    await signIn(page, fixture.employee);
    await page.setViewportSize({ width: 390, height: 844 });
    await assertVisibleHelpLinksReachSections(page, "/zaposleni", EMPLOYEE_MOBILE_NAV_HELP_IDS, {
      mobileMenu: true,
      keyboard: true,
      assertFocusIndicator: true,
      darkTheme: true,
    });
    expect(browserErrors, "The employee mobile guide journey must not produce browser errors.").toEqual([]);
  } finally {
    await cleanUpGuideHelpFixture(fixture);
  }
});