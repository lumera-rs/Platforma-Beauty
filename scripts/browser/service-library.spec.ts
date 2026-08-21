import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { appointmentsTable, db, serviceTemplatesTable, servicesTable } from "@workspace/db";

const credentials = {
  admin: {
    email: process.env.LUMERA_ADMIN_TEST_EMAIL ?? "admin@lumera.local",
    password: process.env.LUMERA_ADMIN_TEST_PASSWORD ?? "LumeraDemo2026!",
  },
  owner: {
    email: process.env.LUMERA_OWNER_TEST_EMAIL ?? "salon@lumera.local",
    password: process.env.LUMERA_OWNER_TEST_PASSWORD ?? "LumeraDemo2026!",
  },
};

type ServiceTemplate = {
  id: string;
  name: string;
  mainCategory: string;
  subcategory: string;
  typicalDurationMinutes: number;
  priceMin: number;
  priceMax: number;
  description: string | null;
  active: boolean;
};

type SalonService = {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
};

type ManagedSalonProfile = {
  id: string;
  slug: string;
};

async function signIn(page: Page, role: keyof typeof credentials) {
  const response = await page.request.post("/api/auth/login", { data: credentials[role] });
  expect(response, `The ${role} browser test account must be able to sign in.`).toBeOK();
}

function templateFixture(prefix: string) {
  const suffix = randomUUID().slice(0, 8);
  return {
    name: `${prefix} ${suffix}`,
    mainCategory: `E2E kategorija ${suffix}`,
    subcategory: "Automatski test",
    typicalDurationMinutes: 45,
    priceMin: 1200,
    priceMax: 1800,
    description: "Privremeni predložak za proveru biblioteke usluga.",
    active: true,
  };
}

async function createTemplateFixture(page: Page, fixture: Omit<ServiceTemplate, "id">) {
  await signIn(page, "admin");
  const response = await page.request.post("/api/admin/service-templates", { data: fixture });
  expect(response.status(), "The owner test fixture must be created by an administrator.").toBe(201);
  return await response.json() as ServiceTemplate;
}

function salonServiceFixture(prefix: string) {
  const suffix = randomUUID().slice(0, 8);
  return {
    category: "E2E kategorija",
    name: `${prefix} ${suffix}`,
    description: "Privremena usluga za proveru brisanja iz vlasničkog cenovnika.",
    durationMinutes: 45,
    price: 2460,
    imageUrl: "https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=200",
    active: true,
    homeServiceAvailable: false,
    homeServiceFee: 0,
    homeServiceMinimumOrder: null,
  };
}

async function createSalonServiceFixture(page: Page, fixture: ReturnType<typeof salonServiceFixture>) {
  const response = await page.request.post("/api/salon/services", { data: fixture });
  expect(response.status(), "The owner must be able to create a service fixture.").toBe(201);
  return await response.json() as SalonService;
}

async function managedSalonProfile(page: Page) {
  const response = await page.request.get("/api/salon/profile");
  expect(response.status(), "The owner test account must have a managed salon.").toBe(200);
  return await response.json() as ManagedSalonProfile;
}

test("owner can filter templates, price one, and find the saved service after reload", async ({ page }) => {
  const fixture = templateFixture("E2E vlasnička usluga");
  let templateId: string | undefined;
  let serviceId: string | undefined;

  try {
    const template = await createTemplateFixture(page, fixture);
    templateId = template.id;

    await signIn(page, "owner");
    await page.goto("/vlasnik/usluge");

    await page.getByRole("tab", { name: "Biblioteka šablona" }).click();
    const librarySearch = page.getByPlaceholder("Pretraži biblioteku šablona...");
    await librarySearch.fill(template.name);
    await expect(page.getByText(template.name, { exact: true })).toBeVisible();

    await page.getByText(template.name, { exact: true }).click();
    await page.getByRole("button", { name: "Konfiguriši i dodaj (1)" }).click();

    const configurationDialog = page.getByRole("dialog");
    await expect(configurationDialog.getByText(template.name, { exact: true })).toBeVisible();
    await configurationDialog.locator('input[type="number"]').first().fill("2460");

    const createResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/salon/services/from-templates",
    );
    await configurationDialog.getByRole("button", { name: "Dodaj usluge (1)" }).click();

    const created = await createResponse;
    expect(created.status(), "A priced template must create a salon service.").toBe(201);
    const result = await created.json() as { created: Array<{ id: string; name: string; price: number }>; skipped: string[] };
    expect(result.skipped).toEqual([]);
    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toMatchObject({ name: template.name, price: 2460 });
    serviceId = result.created[0]?.id;

    await expect(page.getByRole("tab", { name: "Moje usluge" })).toHaveAttribute("data-state", "active");
    await expect(page.getByText(template.name, { exact: true })).toBeVisible();
    await expect(page.getByText("2460 RSD", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText(template.name, { exact: true })).toBeVisible();
    await expect(page.getByText("2460 RSD", { exact: true })).toBeVisible();
  } finally {
    if (serviceId) await db.delete(servicesTable).where(eq(servicesTable.id, serviceId));
    if (templateId) await db.delete(serviceTemplatesTable).where(eq(serviceTemplatesTable.id, templateId));
  }
});

test("owner confirms removal of an unused service and it disappears from the public profile", async ({ page }) => {
  const fixture = salonServiceFixture("E2E brisanje usluge");
  let serviceId: string | undefined;

  try {
    await signIn(page, "owner");
    const [service, salon] = await Promise.all([
      createSalonServiceFixture(page, fixture),
      managedSalonProfile(page),
    ]);
    serviceId = service.id;

    await page.goto("/vlasnik/usluge");
    const serviceRow = page.locator(".divide-y > div").filter({ hasText: fixture.name });
    await expect(serviceRow).toHaveCount(1);

    await serviceRow.getByRole("button", { name: `Obriši uslugu ${fixture.name}` }).click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText("Trajno obrišite uslugu?");
    await expect(confirmation).toContainText(fixture.name);
    await expect(confirmation).toContainText("javnog profila");

    const deleteResponse = page.waitForResponse((response) =>
      response.request().method() === "DELETE"
      && new URL(response.url()).pathname === `/api/salon/services/${service.id}`,
    );
    await confirmation.getByRole("button", { name: "Obriši uslugu" }).click();
    expect((await deleteResponse).status(), "An unused service must be deleted.").toBe(204);
    await expect(serviceRow).toHaveCount(0);

    const publicProfile = await page.request.get(`/api/salons/${salon.slug}`);
    expect(publicProfile.status(), "The public salon profile must load after service removal.").toBe(200);
    const publicServices = (await publicProfile.json() as { services: Array<{ id: string }> }).services;
    expect(publicServices.some((item) => item.id === service.id), "A deleted service must not remain on the public salon profile.").toBe(false);
    serviceId = undefined;
  } finally {
    if (serviceId) await db.delete(servicesTable).where(eq(servicesTable.id, serviceId));
  }
});

test("owner sees why a service with appointments cannot be removed", async ({ page }) => {
  const fixture = salonServiceFixture("E2E zaštićena usluga");
  let serviceId: string | undefined;
  let appointmentId: string | undefined;

  try {
    await signIn(page, "owner");
    const [service, salon] = await Promise.all([
      createSalonServiceFixture(page, fixture),
      managedSalonProfile(page),
    ]);
    serviceId = service.id;
    const [appointment] = await db.insert(appointmentsTable).values({
      salonId: salon.id,
      serviceId: service.id,
      date: "2099-12-20",
      startTime: "10:00",
      endTime: "10:45",
      durationMinutes: service.durationMinutes,
      price: service.price,
      status: "confirmed",
    }).returning({ id: appointmentsTable.id });
    appointmentId = appointment!.id;

    await page.goto("/vlasnik/usluge");
    const serviceRow = page.locator(".divide-y > div").filter({ hasText: fixture.name });
    await expect(serviceRow).toHaveCount(1);
    await serviceRow.getByRole("button", { name: `Obriši uslugu ${fixture.name}` }).click();

    const deleteResponse = page.waitForResponse((response) =>
      response.request().method() === "DELETE"
      && new URL(response.url()).pathname === `/api/salon/services/${service.id}`,
    );
    await page.getByRole("alertdialog").getByRole("button", { name: "Obriši uslugu" }).click();
    expect((await deleteResponse).status(), "A booked service must be protected from deletion.").toBe(409);
    await expect(page.getByText("Usluga ne može da se obriše jer je povezana sa postojećim terminima.", { exact: true })).toBeVisible();
    await expect(serviceRow).toHaveCount(1);
  } finally {
    if (appointmentId) await db.delete(appointmentsTable).where(eq(appointmentsTable.id, appointmentId));
    if (serviceId) await db.delete(servicesTable).where(eq(servicesTable.id, serviceId));
  }
});

test("admin can create, edit, and delete a unique service template", async ({ page }) => {
  const fixture = templateFixture("E2E admin predložak");
  const updatedName = `${fixture.name} izmenjen`;
  let templateId: string | undefined;

  try {
    await signIn(page, "admin");
    await page.goto("/admin/predlosci-usluga");

    await page.getByRole("button", { name: "Novi predložak" }).click();
    const editor = page.getByRole("dialog");
    const inputs = editor.locator("input");
    await inputs.nth(0).fill(fixture.name);
    await inputs.nth(1).fill(fixture.mainCategory);
    await inputs.nth(2).fill(fixture.subcategory);
    await inputs.nth(3).fill(String(fixture.typicalDurationMinutes));
    await inputs.nth(4).fill(String(fixture.priceMin));
    await inputs.nth(5).fill(String(fixture.priceMax));
    await editor.locator("textarea").fill(fixture.description ?? "");

    const createResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/service-templates",
    );
    await editor.getByRole("button", { name: "Sačuvaj" }).click();
    const created = await createResponse;
    expect(created.status(), "The admin form must create its unique template.").toBe(201);
    templateId = (await created.json() as ServiceTemplate).id;

    const search = page.getByPlaceholder("Pretraži predloške...");
    await search.fill(fixture.name);
    const templateRow = page.locator(".divide-y > div").filter({ hasText: fixture.name });
    await expect(templateRow).toHaveCount(1);
    await expect(templateRow).toContainText("1200 - 1800 RSD");

    await templateRow.getByRole("button").first().click();
    const editDialog = page.getByRole("dialog");
    await editDialog.locator("input").first().fill(updatedName);
    await editDialog.locator("textarea").fill("Izmenjen opis predloška za E2E proveru.");

    const updateResponse = page.waitForResponse((response) =>
      response.request().method() === "PATCH"
      && new URL(response.url()).pathname === `/api/admin/service-templates/${templateId}`,
    );
    await editDialog.getByRole("button", { name: "Sačuvaj" }).click();
    const updated = await updateResponse;
    expect(updated.status(), "The admin form must persist template edits.").toBe(200);
    expect(await updated.json()).toMatchObject({ id: templateId, name: updatedName });

    await search.fill(updatedName);
    const updatedRow = page.locator(".divide-y > div").filter({ hasText: updatedName });
    await expect(updatedRow).toHaveCount(1);

    await updatedRow.getByRole("button").nth(1).click();
    const deleteDialog = page.getByRole("dialog");
    await expect(deleteDialog).toContainText(updatedName);
    const deleteResponse = page.waitForResponse((response) =>
      response.request().method() === "DELETE"
      && new URL(response.url()).pathname === `/api/admin/service-templates/${templateId}`,
    );
    await deleteDialog.getByRole("button", { name: "Obriši" }).click();
    const deleted = await deleteResponse;
    expect(deleted.status(), "The administrator must be able to remove the test template.").toBe(200);
    await expect(updatedRow).toHaveCount(0);
    templateId = undefined;
  } finally {
    if (templateId) await db.delete(serviceTemplatesTable).where(eq(serviceTemplatesTable.id, templateId));
  }
});