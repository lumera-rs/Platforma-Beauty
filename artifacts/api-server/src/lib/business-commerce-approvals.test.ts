import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { count, eq, inArray } from "drizzle-orm";
import {
  b2bInvoiceSequencesTable,
  couponRedemptionsTable,
  couponsTable,
  db,
  emailDeliveriesTable,
  employeesTable,
  loyaltyPointLedgerTable,
  orderApprovalRequestLinesTable,
  orderApprovalRequestsTable,
  orderItemsTable,
  ordersTable,
  productCategoriesTable,
  productsTable,
  salonInventoryMovementsTable,
  salonInventoryTable,
  salonsTable,
  sessionsTable,
  shopSettingsTable,
  shoppingCartItemsTable,
  shoppingCartsTable,
  suppliersTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";

const marker = `task-562-${randomUUID()}`;
const couponCode = `T562-${randomUUID().slice(0, 12)}`.toUpperCase();
const invoiceYear = new Date().getFullYear();
const sellerIdentity = {
  companyName: `Original seller ${marker}`,
  taxId: "101234567",
  registrationNumber: "20123456",
  address: "Seller street 1",
  city: "Beograd",
  postalCode: "11000",
  bankAccount: "100-123456789-10",
  contactEmail: `${marker}-seller@example.test`,
  contactPhone: "+381601234567",
};
let baseUrl = "";
let server: ReturnType<typeof app.listen> | undefined;
let ownerId = "";
let adminId = "";
let employeeUserId = "";
let employeeId = "";
let salonId = "";
let productIds: string[] = [];
let categoryId = "";
let supplierId = "";
let couponId = "";
let settingsBefore: typeof shopSettingsTable.$inferSelect | undefined;
let createdSettingsId: string | undefined;
let configuredSettingsVersion = 0;
let invoiceBefore: number | undefined;

function cookie(userId: string) {
  return createSession(userId).then((token) => `${sessionCookieName}=${token}`);
}

async function request(path: string, userId: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      cookie: await cookie(userId),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
}

async function countRows(table: any, column: any, value: string) {
  const [row] = await db.select({ value: count() }).from(table).where(eq(column, value));
  return row!.value;
}

test.before(async () => {
  // The rollout creates the approval/coupon/invoice objects used below. Do this
  // before constructing the Express harness, just like the other API tests.
  await ensureBusinessGrowthSchema();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  const passwordHash = await hashPassword(`Task562!${marker}`);
  const [owner] = await db.insert(usersTable).values({
    firstName: "Task", lastName: "Owner", email: `${marker}-owner@example.test`,
    passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER",
  }).returning();
  ownerId = owner!.id;
  const [employeeUser] = await db.insert(usersTable).values({
    firstName: "Task", lastName: "Employee", email: `${marker}-employee@example.test`,
    passwordHash, passwordSetAt: new Date(), role: "SALON_EMPLOYEE",
  }).returning();
  employeeUserId = employeeUser!.id;
  const [admin] = await db.insert(usersTable).values({
    firstName: "Task", lastName: "Admin", email: `${marker}-admin@example.test`,
    passwordHash, passwordSetAt: new Date(), role: "ADMIN",
  }).returning();
  adminId = admin!.id;
  const [salon] = await db.insert(salonsTable).values({
    ownerId, name: `Task 562 salon ${marker}`, slug: marker, city: "Beograd",
    municipality: "Vračar", address: "Test 562 1", postalCode: "11000",
    phone: "+381601112233", email: `${marker}-salon@example.test`,
    companyName: "Task 562 kupac", companyTaxId: "109999999",
    companyRegistrationNumber: "20999999", companyAddress: "Test 562 1",
    companyCity: "Beograd", companyPostalCode: "11000",
    shortDescription: "Task 562", description: "Task 562", imageUrl: "/task-562.jpg",
  }).returning();
  salonId = salon!.id;
  const [employee] = await db.insert(employeesTable).values({
    salonId, userId: employeeUserId, name: "Task Employee", role: "Stylist",
    bio: "Task 562", avatarUrl: "/task-562-employee.jpg", canOrderIndependently: false,
  }).returning();
  employeeId = employee!.id;
  const [supplier] = await db.insert(suppliersTable).values({
    name: `Task 562 supplier ${marker}`, slug: marker, scope: "B2B",
  }).returning();
  supplierId = supplier!.id;
  const [category] = await db.insert(productCategoriesTable).values({
    supplierId, name: `Task 562 category ${marker}`, slug: marker,
  }).returning();
  categoryId = category!.id;
  for (const [name, price] of [["Prvi", 1_000], ["Drugi", 600]] as const) {
    const [product] = await db.insert(productsTable).values({
      supplierId, categoryId, categoryName: category!.name, name: `${name} ${marker}`,
      description: "Task 562 fixture", imageUrl: "/task-562-product.jpg",
      price, professionalEnabled: true, retailEnabled: false, stock: 10,
      sku: `${marker}-${name}`, unit: "kom",
    }).returning();
    productIds.push(product!.id);
  }
  const [coupon] = await db.insert(couponsTable).values({
    code: couponCode, audience: "B2B", discountType: "FIXED_RSD",
    discountValue: 1_001, usageLimit: 1, perCustomerUsageLimit: 1,
  }).returning();
  couponId = coupon!.id;

  settingsBefore = (await db.select().from(shopSettingsTable).limit(1))[0];
  if (!settingsBefore) {
    const [created] = await db.insert(shopSettingsTable).values({}).returning();
    createdSettingsId = created!.id;
  }
  const settingsResponse = await request("/admin/shop-settings", adminId);
  assert.equal(settingsResponse.status, 200);
  const currentSettings = await settingsResponse.json() as {
    showLoyaltyPoints: boolean;
    pointsPer100Rsd: number;
    lowStockThreshold: number;
    defaultDeliveryBusinessDays: number;
    freeShippingThreshold: number;
    version: number;
  };
  const savedSettingsResponse = await request("/admin/shop-settings", adminId, {
    method: "PUT",
    body: JSON.stringify({
      showLoyaltyPoints: currentSettings.showLoyaltyPoints,
      pointsPer100Rsd: currentSettings.pointsPer100Rsd,
      lowStockThreshold: currentSettings.lowStockThreshold,
      defaultDeliveryBusinessDays: currentSettings.defaultDeliveryBusinessDays,
      freeShippingThreshold: currentSettings.freeShippingThreshold,
      version: currentSettings.version,
      seller: sellerIdentity,
    }),
  });
  assert.equal(savedSettingsResponse.status, 200);
  const configuredSettings = await savedSettingsResponse.json() as {
    version: number;
    seller: typeof sellerIdentity;
  };
  assert.deepEqual(configuredSettings.seller, sellerIdentity);
  configuredSettingsVersion = configuredSettings.version;
  invoiceBefore = (await db.select().from(b2bInvoiceSequencesTable)
    .where(eq(b2bInvoiceSequencesTable.year, invoiceYear)).limit(1))[0]?.lastNumber;
});

test.after(async () => {
  const orders = await db.select({ id: ordersTable.id }).from(ordersTable).where(eq(ordersTable.salonId, salonId));
  const orderIds = orders.map((order) => order.id);
  if (orderIds.length) {
    await db.delete(emailDeliveriesTable).where(inArray(
      emailDeliveriesTable.eventKey,
      orderIds.map((id) => `b2b-order:${id}:created`),
    ));
    await db.delete(couponRedemptionsTable).where(inArray(couponRedemptionsTable.orderId, orderIds));
    await db.delete(salonInventoryMovementsTable).where(inArray(salonInventoryMovementsTable.orderId, orderIds));
    await db.delete(loyaltyPointLedgerTable).where(inArray(loyaltyPointLedgerTable.orderId, orderIds));
    await db.delete(orderItemsTable).where(inArray(orderItemsTable.orderId, orderIds));
  }
  await db.delete(orderApprovalRequestLinesTable).where(inArray(
    orderApprovalRequestLinesTable.requestId,
    (await db.select({ id: orderApprovalRequestsTable.id }).from(orderApprovalRequestsTable)
      .where(eq(orderApprovalRequestsTable.salonId, salonId))).map((row) => row.id),
  ));
  await db.delete(orderApprovalRequestsTable).where(eq(orderApprovalRequestsTable.salonId, salonId));
  if (orderIds.length) await db.delete(ordersTable).where(inArray(ordersTable.id, orderIds));
  await db.delete(salonInventoryTable).where(eq(salonInventoryTable.salonId, salonId));
  await db.delete(shoppingCartsTable).where(eq(shoppingCartsTable.salonId, salonId));
  if (couponId) await db.delete(couponsTable).where(eq(couponsTable.id, couponId));
  if (productIds.length) await db.delete(productsTable).where(inArray(productsTable.id, productIds));
  if (categoryId) await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, categoryId));
  if (supplierId) await db.delete(suppliersTable).where(eq(suppliersTable.id, supplierId));
  await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
  await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
  await db.delete(sessionsTable).where(inArray(sessionsTable.userId, [ownerId, employeeUserId, adminId]));
  await db.delete(usersTable).where(inArray(usersTable.id, [ownerId, employeeUserId, adminId]));
  if (settingsBefore) await db.update(shopSettingsTable).set(settingsBefore).where(eq(shopSettingsTable.id, settingsBefore.id));
  else if (createdSettingsId) await db.delete(shopSettingsTable).where(eq(shopSettingsTable.id, createdSettingsId));
  if (invoiceBefore === undefined) await db.delete(b2bInvoiceSequencesTable).where(eq(b2bInvoiceSequencesTable.year, invoiceYear));
  else await db.update(b2bInvoiceSequencesTable).set({ lastNumber: invoiceBefore }).where(eq(b2bInvoiceSequencesTable.year, invoiceYear));
  await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
});

test("employee approval is side-effect free, approval finalizes exactly once, and invoice seller is immutable", async () => {
  assert.equal((await request("/shop/cart", employeeUserId)).status, 200, "employees can access their salon cart");
  const direct = await request("/shop/checkout", employeeUserId, { method: "POST", body: "{}" });
  assert.equal(direct.status, 409);
  assert.equal((await direct.json() as { code: string }).code, "APPROVAL_REQUIRED");
  assert.equal((await request("/shop/cart/items", employeeUserId, {
    method: "POST", body: JSON.stringify({ productId: productIds[0], quantity: 1 }),
  })).status, 200);
  assert.equal((await request("/shop/cart/items", employeeUserId, {
    method: "POST", body: JSON.stringify({ productId: productIds[1], quantity: 1 }),
  })).status, 200);
  const restrictedCode = `B2B-FREE-${randomUUID().slice(0, 8)}`.toUpperCase();
  const [restrictedCoupon] = await db.insert(couponsTable).values({
    code: restrictedCode,
    audience: "B2B",
    discountType: "FIXED_RSD",
    discountValue: 1,
    freeShipping: true,
    includeProductIds: [randomUUID()],
  }).returning();
  const restrictedPreview = await request(
    `/shop/checkout-preview?couponCode=${encodeURIComponent(restrictedCode)}`,
    employeeUserId,
  );
  assert.equal(restrictedPreview.status, 409);
  assert.equal((await restrictedPreview.json() as { code: string }).code, "COUPON_APPLICABILITY");
  const restrictedApproval = await request("/shop/approval-requests", employeeUserId, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: `${marker}-restricted`, couponCode: restrictedCode }),
  });
  assert.equal(restrictedApproval.status, 409);
  assert.equal((await restrictedApproval.json() as { code: string }).code, "COUPON_APPLICABILITY");
  await db.delete(couponsTable).where(eq(couponsTable.id, restrictedCoupon!.id));
  const preview = await request(`/shop/checkout-preview?couponCode=${encodeURIComponent(couponCode)}`, employeeUserId);
  assert.equal(preview.status, 200);
  const previewBody = await preview.json() as { coupon: { code: string } | null; couponDiscountRsd: number };
  assert.equal(previewBody.coupon?.code, couponCode);
  assert.equal(previewBody.couponDiscountRsd, 1_001);

  const stockBefore = await db.select({ stock: productsTable.stock }).from(productsTable).where(eq(productsTable.id, productIds[0]!));
  const ordersBefore = await countRows(ordersTable, ordersTable.salonId, salonId);
  const redemptionBefore = await countRows(couponRedemptionsTable, couponRedemptionsTable.couponId, couponId);
  const inventoryBefore = await countRows(salonInventoryTable, salonInventoryTable.salonId, salonId);
  const loyaltyBefore = await countRows(loyaltyPointLedgerTable, loyaltyPointLedgerTable.salonId, salonId);
  const approval = await request("/shop/approval-requests", employeeUserId, {
    method: "POST", body: JSON.stringify({ idempotencyKey: `${marker}-approval`, couponCode }),
  });
  assert.equal(approval.status, 201);
  const approvalId = (await approval.json() as { id: string; status: string }).id;
  const [pending] = await db.select().from(orderApprovalRequestsTable).where(eq(orderApprovalRequestsTable.id, approvalId));
  assert.equal(pending?.status, "PENDING");
  assert.equal(await countRows(orderApprovalRequestLinesTable, orderApprovalRequestLinesTable.requestId, approvalId), 2);
  assert.equal(await countRows(ordersTable, ordersTable.salonId, salonId), ordersBefore);
  assert.equal((await db.select({ stock: productsTable.stock }).from(productsTable).where(eq(productsTable.id, productIds[0]!)))[0]!.stock, stockBefore[0]!.stock);
  assert.equal(await countRows(couponRedemptionsTable, couponRedemptionsTable.couponId, couponId), redemptionBefore);
  assert.equal(await countRows(salonInventoryTable, salonInventoryTable.salonId, salonId), inventoryBefore);
  assert.equal(await countRows(loyaltyPointLedgerTable, loyaltyPointLedgerTable.salonId, salonId), loyaltyBefore);
  assert.equal((await db.select().from(b2bInvoiceSequencesTable).where(eq(b2bInvoiceSequencesTable.year, invoiceYear)).limit(1))[0]?.lastNumber, invoiceBefore);

  const approvals = await Promise.all([
    request(`/shop/approval-requests/${approvalId}/approve`, ownerId, { method: "POST", body: "{}" }),
    request(`/shop/approval-requests/${approvalId}/approve`, ownerId, { method: "POST", body: "{}" }),
  ]);
  const approvalResults = await Promise.all(approvals.map(async (response) => ({
    status: response.status,
    body: await response.text(),
  })));
  assert.deepEqual(approvalResults.map((response) => response.status).sort(), [200, 201], JSON.stringify(approvalResults));
  const [savedRequest] = await db.select().from(orderApprovalRequestsTable).where(eq(orderApprovalRequestsTable.id, approvalId));
  assert.equal(savedRequest?.status, "APPROVED");
  assert.ok(savedRequest?.finalizedOrderId);
  assert.equal(await countRows(ordersTable, ordersTable.salonId, salonId), ordersBefore + 1);
  assert.equal(await countRows(couponRedemptionsTable, couponRedemptionsTable.couponId, couponId), redemptionBefore + 1);
  const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.id, couponId));
  assert.equal(coupon?.usageCount, 1);
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, savedRequest!.finalizedOrderId!));
  assert.equal(order?.couponDiscountRsd, 1_001);
  assert.equal(order?.referralCreditMerchandiseSubtotalRsd, 599);
  assert.equal(order?.referralCreditPreCreditPayableTotalRsd, 989);
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order!.id));
  assert.deepEqual(
    items.map((item) => item.couponDiscountRsd).sort((a, b) => a - b),
    [375, 626],
    "fixed coupons use deterministic largest-remainder allocation",
  );
  assert.equal((await db.select({ stock: productsTable.stock }).from(productsTable).where(eq(productsTable.id, productIds[0]!)))[0]!.stock, 9);
  assert.equal(await countRows(salonInventoryMovementsTable, salonInventoryMovementsTable.orderId, order!.id), 2);
  assert.equal((await db.select().from(b2bInvoiceSequencesTable).where(eq(b2bInvoiceSequencesTable.year, invoiceYear)).limit(1))[0]!.lastNumber, (invoiceBefore ?? 0) + 1);

  const repeated = await request(`/shop/approval-requests/${approvalId}/approve`, ownerId, { method: "POST", body: "{}" });
  assert.equal(repeated.status, 200);
  assert.equal(await countRows(ordersTable, ordersTable.salonId, salonId), ordersBefore + 1);
  const invoice = await request(`/shop/orders/${order!.id}/invoice.pdf`, ownerId);
  assert.equal(invoice.status, 200);
  assert.match(invoice.headers.get("content-type") ?? "", /^application\/pdf/);
  assert.equal(Buffer.from(await invoice.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
  const editedSettingsResponse = await request("/admin/shop-settings", adminId, {
    method: "PUT",
    body: JSON.stringify({
      showLoyaltyPoints: settingsBefore?.showLoyaltyPoints ?? true,
      pointsPer100Rsd: settingsBefore?.pointsPer100Rsd ?? 1,
      lowStockThreshold: settingsBefore?.lowStockThreshold ?? 5,
      defaultDeliveryBusinessDays: settingsBefore?.defaultDeliveryBusinessDays ?? 3,
      freeShippingThreshold: (await (await request("/admin/shop-settings", adminId)).json() as { freeShippingThreshold: number }).freeShippingThreshold,
      version: configuredSettingsVersion,
      seller: { ...sellerIdentity, companyName: `Edited seller ${marker}` },
    }),
  });
  assert.equal(editedSettingsResponse.status, 200);
  const [afterEdit] = await db.select().from(ordersTable).where(eq(ordersTable.id, order!.id));
  assert.equal((afterEdit!.sellerSnapshot as { companyName: string }).companyName, sellerIdentity.companyName);
  const cancelled = await request(`/admin/orders/${order!.id}`, adminId, {
    method: "PATCH",
    body: JSON.stringify({ status: "cancelled" }),
  });
  assert.equal(cancelled.status, 200);
  const [releasedRedemption] = await db.select().from(couponRedemptionsTable)
    .where(eq(couponRedemptionsTable.orderId, order!.id));
  assert.ok(releasedRedemption?.cancelledAt);
  assert.equal((await db.select().from(couponsTable).where(eq(couponsTable.id, couponId)))[0]?.usageCount, 0);
});