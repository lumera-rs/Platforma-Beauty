import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  orderItemsTable,
  ordersTable,
  productCategoriesTable,
  productsTable,
  salonNotificationsTable,
  salonsTable,
  shoppingCartItemsTable,
  shoppingCartsTable,
  usersTable,
} from "@workspace/db";
import { hashPassword } from "../../artifacts/api-server/src/lib/auth";

type NotificationFixture = {
  ownerA: { email: string; password: string; id: string };
  ownerB: { email: string; password: string; id: string };
  salonAId: string;
  salonBId: string;
  notificationAId: string;
  notificationAHref: string;
  notificationBId: string;
  productId: string;
  categoryId: string;
  orderId?: string;
};

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a port for the secondary notification API process.");
  }
  return address.port;
}

async function waitForHttp(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`received ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Secondary notification API did not start${lastError instanceof Error ? `: ${lastError.message}` : "."}`);
}

async function startSecondaryApiProcess(): Promise<{ child: ChildProcess; baseUrl: string }> {
  const port = await findAvailablePort();
  const child = spawn(
    path.join(workspaceRoot, "scripts", "node_modules", ".bin", "tsx"),
    [path.join(workspaceRoot, "artifacts", "api-server", "src", "test-server.ts")],
    {
      cwd: workspaceRoot,
      env: { ...process.env, NODE_ENV: "test", PORT: String(port) },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHttp(`${baseUrl}/api/healthz`);
    return { child, baseUrl };
  } catch (error) {
    await stopSecondaryApiProcess(child);
    throw error;
  }
}

async function stopSecondaryApiProcess(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    once(child, "exit").then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

async function orderThroughApiProcess(baseUrl: string, page: Page, productId: string): Promise<string> {
  const session = (await page.context().cookies()).find((cookie) => cookie.name === "lumera_session");
  if (!session) throw new Error("The signed-in owner session cookie was not available.");
  const headers = {
    "content-type": "application/json",
    cookie: `lumera_session=${session.value}`,
  };
  const addToCart = await fetch(`${baseUrl}/api/shop/cart/items`, {
    method: "POST",
    headers,
    body: JSON.stringify({ productId, quantity: 1 }),
  });
  expect(addToCart.ok, "The secondary API process must add the order item.").toBe(true);

  const checkout = await fetch(`${baseUrl}/api/shop/checkout`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      useSalonAddress: true,
      deliveryMethod: "courier",
      paymentMethod: "BANK_TRANSFER",
      termsAccepted: true,
    }),
  });
  expect(checkout.status, "The secondary API process must create the order.").toBe(201);
  const order: unknown = await checkout.json();
  if (!order || typeof order !== "object" || !("id" in order) || typeof order.id !== "string") {
    throw new Error("The secondary API checkout response did not include an order ID.");
  }
  return order.id;
}

async function createNotificationFixture(): Promise<NotificationFixture> {
  const suffix = randomUUID();
  const password = "browser-salon-notifications-password";
  const ownerAEmail = `browser-notifications-owner-a-${suffix}@example.test`;
  const ownerBEmail = `browser-notifications-owner-b-${suffix}@example.test`;
  const notificationAHref = `/vlasnik/porudzbine/${randomUUID()}`;
  const categoryName = `Browser kategorija obaveštenja ${suffix}`;
  const ownerIds: string[] = [];
  const salonIds: string[] = [];
  let categoryId: string | undefined;
  let productId: string | undefined;

  try {
    const [ownerA] = await db.insert(usersTable).values({
      firstName: "Prvi",
      lastName: "Vlasnik",
      email: ownerAEmail,
      passwordHash: await hashPassword(password),
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    }).returning({ id: usersTable.id });
    const [ownerB] = await db.insert(usersTable).values({
      firstName: "Drugi",
      lastName: "Vlasnik",
      email: ownerBEmail,
      passwordHash: await hashPassword(password),
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    }).returning({ id: usersTable.id });
    if (!ownerA || !ownerB) throw new Error("Notification browser fixture could not create its owners.");
    ownerIds.push(ownerA.id, ownerB.id);

    const [salonA] = await db.insert(salonsTable).values({
      ownerId: ownerA.id,
      name: `Browser salon obaveštenja A ${suffix}`,
      slug: `browser-notifications-a-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 101",
      postalCode: "11000",
      phone: "+381110000101",
      email: `browser-notifications-salon-a-${suffix}@example.test`,
      shortDescription: "Izolovan salon A za browser regresioni test.",
      description: "Salon A je napravljen samo za proveru izolacije obaveštenja.",
      imageUrl: "/test-browser-salon-notifications.jpg",
    }).returning({ id: salonsTable.id });
    const [salonB] = await db.insert(salonsTable).values({
      ownerId: ownerB.id,
      name: `Browser salon obaveštenja B ${suffix}`,
      slug: `browser-notifications-b-${suffix}`,
      city: "Beograd",
      municipality: "Novi Beograd",
      address: "Test 102",
      postalCode: "11000",
      phone: "+381110000102",
      email: `browser-notifications-salon-b-${suffix}@example.test`,
      shortDescription: "Izolovan salon B za browser regresioni test.",
      description: "Salon B je napravljen samo za proveru izolacije obaveštenja.",
      imageUrl: "/test-browser-salon-notifications.jpg",
    }).returning({ id: salonsTable.id });
    if (!salonA || !salonB) throw new Error("Notification browser fixture could not create its salons.");
    salonIds.push(salonA.id, salonB.id);

    await db.update(usersTable).set({ activeSalonId: salonA.id }).where(eq(usersTable.id, ownerA.id));
    await db.update(usersTable).set({ activeSalonId: salonB.id }).where(eq(usersTable.id, ownerB.id));

    const [notificationA] = await db.insert(salonNotificationsTable).values({
      salonId: salonA.id,
      title: "Potvrda salona A",
      message: `Poruka koja pripada samo salonu A ${suffix}.`,
      href: notificationAHref,
    }).returning({ id: salonNotificationsTable.id });
    const [notificationB] = await db.insert(salonNotificationsTable).values({
      salonId: salonB.id,
      title: "Potvrda salona B",
      message: `Poruka koja pripada samo salonu B ${suffix}.`,
      href: `/vlasnik/porudzbine/${randomUUID()}`,
    }).returning({ id: salonNotificationsTable.id });
    if (!notificationA || !notificationB) throw new Error("Notification browser fixture could not create its notifications.");

    const [category] = await db.insert(productCategoriesTable).values({
      name: categoryName,
      slug: `browser-notifications-category-${suffix}`,
      active: true,
    }).returning({ id: productCategoriesTable.id });
    if (!category) throw new Error("Notification browser fixture could not create its product category.");
    categoryId = category.id;

    const [product] = await db.insert(productsTable).values({
      categoryId: category.id,
      categoryName,
      name: `Browser proizvod obaveštenja ${suffix}`,
      description: "Proizvod za checkout regresioni test.",
      imageUrl: "/test-browser-salon-notifications.jpg",
      price: 1200,
      stock: 3,
      sku: `BROWSER-NOTIFICATIONS-${suffix}`,
      unit: "kom",
      active: true,
    }).returning({ id: productsTable.id });
    if (!product) throw new Error("Notification browser fixture could not create its product.");
    productId = product.id;

    return {
      ownerA: { email: ownerAEmail, password, id: ownerA.id },
      ownerB: { email: ownerBEmail, password, id: ownerB.id },
      salonAId: salonA.id,
      salonBId: salonB.id,
      notificationAId: notificationA.id,
      notificationAHref,
      notificationBId: notificationB.id,
      productId: product.id,
      categoryId: category.id,
    };
  } catch (error) {
    if (productId) await db.delete(productsTable).where(eq(productsTable.id, productId));
    if (categoryId) await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, categoryId));
    if (salonIds.length) await db.delete(salonsTable).where(inArray(salonsTable.id, salonIds));
    if (ownerIds.length) await db.delete(usersTable).where(inArray(usersTable.id, ownerIds));
    throw error;
  }
}

async function cleanUpNotificationFixture(fixture: NotificationFixture): Promise<void> {
  const orderIds = fixture.orderId
    ? [fixture.orderId]
    : (await db.select({ id: ordersTable.id }).from(ordersTable).where(inArray(ordersTable.salonId, [fixture.salonAId, fixture.salonBId]))).map((order) => order.id);
  if (orderIds.length) {
    await db.delete(orderItemsTable).where(inArray(orderItemsTable.orderId, orderIds));
    await db.delete(ordersTable).where(inArray(ordersTable.id, orderIds));
  }
  const carts = await db.select({ id: shoppingCartsTable.id }).from(shoppingCartsTable).where(inArray(shoppingCartsTable.salonId, [fixture.salonAId, fixture.salonBId]));
  if (carts.length) await db.delete(shoppingCartItemsTable).where(inArray(shoppingCartItemsTable.cartId, carts.map((cart) => cart.id)));
  await db.delete(salonNotificationsTable).where(inArray(salonNotificationsTable.salonId, [fixture.salonAId, fixture.salonBId]));
  await db.delete(salonsTable).where(inArray(salonsTable.id, [fixture.salonAId, fixture.salonBId]));
  await db.delete(productsTable).where(eq(productsTable.id, fixture.productId));
  await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, fixture.categoryId));
  await db.delete(usersTable).where(inArray(usersTable.id, [fixture.ownerA.id, fixture.ownerB.id]));
}

async function signIn(page: Page, credentials: NotificationFixture["ownerA"]): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: credentials.email, password: credentials.password },
  });
  expect(response, "The isolated salon owner fixture must be able to sign in.").toBeOK();
}

async function signInThroughBusinessForm(page: Page, credentials: NotificationFixture["ownerB"]): Promise<void> {
  await page.goto("/poslovna-prijava");
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Lozinka", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Prijavi se u poslovni portal" }).click();
  await expect(page).toHaveURL(/\/vlasnik$/);
}

test("salon owners only see and update their own notifications", async ({ page }) => {
  const fixture = await createNotificationFixture();

  try {
    await signIn(page, fixture.ownerA);
    await page.goto("/vlasnik/obavestenja");
    await expect(page.getByTestId(`text-notification-title-${fixture.notificationAId}`)).toHaveText("Potvrda salona A");
    await expect(page.getByTestId(`text-notification-message-${fixture.notificationAId}`)).toContainText("samo salonu A");
    await expect(page.getByTestId(`link-notification-target-${fixture.notificationAId}`)).toHaveAttribute("href", fixture.notificationAHref);
    await expect(page.getByTestId("status-unread-notification-count")).toHaveText("1");
    await expect(page.getByTestId(`notification-${fixture.notificationBId}`)).toHaveCount(0);

    await page.getByRole("button", { name: /Prvi/ }).click();
    await page.getByRole("menuitem", { name: "Odjavi se" }).click();
    await expect(page).toHaveURL(/\/$/);
    await signInThroughBusinessForm(page, fixture.ownerB);

    await page.goto("/vlasnik/obavestenja");
    await expect(page.getByTestId(`text-notification-title-${fixture.notificationBId}`)).toHaveText("Potvrda salona B");
    await expect(page.getByTestId(`text-notification-message-${fixture.notificationBId}`)).toContainText("samo salonu B");
    await expect(page.getByTestId(`text-notification-title-${fixture.notificationAId}`)).toHaveCount(0);
    await expect(page.getByText("samo salonu A", { exact: false })).toHaveCount(0);
    await expect(page.getByTestId(`link-notification-target-${fixture.notificationAId}`)).toHaveCount(0);
    await expect(page.getByTestId("status-unread-notification-count")).toHaveText("1");

    const crossSalonRead = await page.request.patch(`/api/shop/notifications/${fixture.notificationAId}/read`);
    expect(crossSalonRead.status()).toBe(404);
    const crossSalonBody = await crossSalonRead.text();
    expect(crossSalonBody).not.toContain("Potvrda salona A");
    expect(crossSalonBody).not.toContain("samo salonu A");
    expect(crossSalonBody).not.toContain(fixture.notificationAHref);

    const addToCart = await page.request.post("/api/shop/cart/items", {
      data: { productId: fixture.productId, quantity: 1 },
    });
    expect(addToCart, "The new order fixture must be addable to the active salon cart.").toBeOK();

    await page.goto("/vlasnik/prodavnica/korpa");
    await page.getByRole("link", { name: /Nastavi na dostavu/ }).click();
    await expect(page).toHaveURL(/\/vlasnik\/prodavnica\/dostava$/);
    await page.getByRole("button", { name: /Nastavi na pregled i plaćanje/ }).click();
    await expect(page).toHaveURL(/\/vlasnik\/prodavnica\/pregled$/);
    await page.getByRole("checkbox").last().check();
    const checkoutResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/shop/checkout",
    );
    await page.getByRole("button", { name: "Potvrdi porudžbinu" }).click();
    expect((await checkoutResponse).status(), "The checkout must create a new order and notification.").toBe(201);

    await expect(page).toHaveURL(/\/vlasnik\/prodavnica\/porudzbina\/.+\/potvrda$/);
    fixture.orderId = (await page.url()).match(/porudzbina\/([^/]+)\/potvrda$/)?.[1];
    await expect(page.getByRole("heading", { name: "Hvala vam na porudžbini!" })).toBeVisible();

    await page.goto("/vlasnik/obavestenja");
    await expect(page.getByTestId("status-unread-notification-count")).toHaveText("2");
  } finally {
    await cleanUpNotificationFixture(fixture);
  }
});

test("an order on another API process refreshes mobile and desktop notification badges", async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await createNotificationFixture();
  let desktopContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let secondaryApiProcess: ChildProcess | undefined;

  try {
    // Keep the fixture notification visible without letting it affect the
    // before/after unread count for the order created in this test.
    await db.update(salonNotificationsTable)
      .set({ readAt: new Date() })
      .where(eq(salonNotificationsTable.id, fixture.notificationAId));

    await signIn(page, fixture.ownerA);
    const mobileEventConnection = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === "/api/shop/notifications/events"
      && response.status() === 200,
    );
    await page.goto("/vlasnik");
    await page.getByTestId("button-mobile-menu").click();
    await expect(page.getByTestId("link-notifications-mobile")).toBeVisible();
    await expect(page.getByTestId("status-unread-notification-count-mobile")).toHaveCount(0);
    await mobileEventConnection;

    desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const desktopPage = await desktopContext.newPage();
    await signIn(desktopPage, fixture.ownerA);
    const desktopEventConnection = desktopPage.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === "/api/shop/notifications/events"
      && response.status() === 200,
    );
    await desktopPage.goto("/vlasnik");
    await expect(desktopPage.getByTestId("status-unread-notification-count")).toHaveCount(0);
    await desktopEventConnection;

    const secondaryApi = await startSecondaryApiProcess();
    secondaryApiProcess = secondaryApi.child;
    fixture.orderId = await orderThroughApiProcess(secondaryApi.baseUrl, page, fixture.productId);

    // The order was accepted by the secondary API process, while both event
    // streams remain connected to the primary API process. This must therefore
    // cross the shared broadcast layer before the five-second polling fallback.
    await expect(page.getByTestId("status-unread-notification-count-mobile")).toHaveText("1", { timeout: 3000 });
    await expect(desktopPage.getByTestId("status-unread-notification-count")).toHaveText("1", { timeout: 3000 });

    await desktopContext.setOffline(true);
    await page.getByTestId("link-notifications-mobile").click();
    await expect(page).toHaveURL(/\/vlasnik\/obavestenja$/);
    await page.getByRole("button", { name: "Označi kao pročitano" }).click();
    await expect(page.getByTestId("status-unread-notification-count-mobile")).toHaveCount(0);

    const desktopReconnect = desktopPage.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === "/api/shop/notifications/events"
      && response.status() === 200,
    );
    await desktopContext.setOffline(false);
    await desktopReconnect;
    await expect(desktopPage.getByTestId("status-unread-notification-count")).toHaveCount(0, { timeout: 3000 });
  } finally {
    await stopSecondaryApiProcess(secondaryApiProcess);
    await desktopContext?.close();
    await cleanUpNotificationFixture(fixture);
  }
});