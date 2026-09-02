import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  emailDeliveriesTable,
  productCategoriesTable,
  productsTable,
  retailCartItemsTable,
  retailCartsTable,
  shopSettingsTable,
  suppliersTable,
  usersTable,
} from "@workspace/db";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";
import { runRetailCartReminderSweep } from "./retail-cart-reminders";

const ids = { carts: [] as string[], users: [] as string[], events: [] as string[], supplier: "", category: "", product: "" };
let previousSettings: typeof shopSettingsTable.$inferSelect | undefined;
const now = new Date("2026-01-20T12:00:00.000Z");

async function cart(input: { ageHours: number; email?: string; userId?: string; activityVersion?: number; completedActivityVersion?: number; item?: boolean }) {
  const [created] = await db.insert(retailCartsTable).values({
    tokenHash: `reminder-${randomUUID()}`,
    userId: input.userId ?? null,
    contactEmail: input.email ?? null,
    activityVersion: input.activityVersion ?? 1,
    completedActivityVersion: input.completedActivityVersion ?? null,
    updatedAt: new Date(now.getTime() - input.ageHours * 60 * 60_000),
  }).returning();
  assert.ok(created);
  ids.carts.push(created.id);
  if (input.item !== false) {
    await db.insert(retailCartItemsTable).values({
      cartId: created.id, productId: ids.product, productName: "Reminder product",
      productImageUrl: "/test.jpg", unitPrice: 1000, quantity: 1, weightGrams: 1,
    });
  }
  return created;
}

async function deliveryFor(cartId: string, version: number) {
  const key = `retail-cart-reminder:${cartId}:activity:${version}`;
  ids.events.push(key);
  return (await db.select().from(emailDeliveriesTable).where(eq(emailDeliveriesTable.eventKey, key)).limit(1))[0];
}

test.before(async () => {
  await ensureBusinessGrowthSchema();
  previousSettings = (await db.select().from(shopSettingsTable).limit(1))[0];
  assert.ok(previousSettings);
  await db.update(shopSettingsTable).set({
    retailCartReminderEnabled: true,
    retailCartReminderDelayHours: 24,
    retailCartReminderBrevoTemplateId: 12345,
  }).where(eq(shopSettingsTable.id, previousSettings.id));
  const suffix = randomUUID();
  const [supplier] = await db.insert(suppliersTable).values({ name: `Reminder ${suffix}`, slug: `reminder-${suffix}`, scope: "B2C" }).returning();
  const [category] = await db.insert(productCategoriesTable).values({ supplierId: supplier!.id, name: `Reminder ${suffix}`, slug: `reminder-${suffix}` }).returning();
  const [product] = await db.insert(productsTable).values({
    supplierId: supplier!.id, categoryId: category!.id, categoryName: category!.name,
    name: "Reminder product", description: "Test", imageUrl: "/test.jpg", price: 1000,
    publicDescription: "Test", publicPrice: 1000, retailEnabled: true, professionalEnabled: false, stock: 99, sku: `reminder-${suffix}`, unit: "kom",
  }).returning();
  ids.supplier = supplier!.id; ids.category = category!.id; ids.product = product!.id;
});

test.after(async () => {
  if (ids.events.length) await db.delete(emailDeliveriesTable).where(inArray(emailDeliveriesTable.eventKey, ids.events));
  if (ids.carts.length) await db.delete(retailCartsTable).where(inArray(retailCartsTable.id, ids.carts));
  if (ids.users.length) await db.delete(usersTable).where(inArray(usersTable.id, ids.users));
  if (ids.product) await db.delete(productsTable).where(eq(productsTable.id, ids.product));
  if (ids.category) await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, ids.category));
  if (ids.supplier) await db.delete(suppliersTable).where(eq(suppliersTable.id, ids.supplier));
  if (previousSettings) await db.update(shopSettingsTable).set({
    retailCartReminderEnabled: previousSettings.retailCartReminderEnabled,
    retailCartReminderDelayHours: previousSettings.retailCartReminderDelayHours,
    retailCartReminderBrevoTemplateId: previousSettings.retailCartReminderBrevoTemplateId,
  }).where(eq(shopSettingsTable.id, previousSettings.id));
});

test("retail cart reminder sweep enforces eligibility and atomically claims activity", async (t) => {
  await t.test("delay boundary is strict", async () => {
    const atBoundary = await cart({ ageHours: 24, email: "boundary@example.test" });
    const older = await cart({ ageHours: 24.01, email: "older@example.test" });
    await runRetailCartReminderSweep(now);
    assert.equal(await deliveryFor(atBoundary.id, 1), undefined);
    const delivery = await deliveryFor(older.id, 1);
    assert.equal(delivery?.emailType, "retail_cart_reminder");
    assert.equal(delivery?.status, "queued", "sweep only writes the outbox; it does not call Brevo");
    assert.equal(delivery?.metadata.activityVersion, 1);
    assert.equal(delivery?.metadata.brevoTemplateId, 12345);
  });

  await t.test("empty carts, missing recipients, and completed activity do not enqueue", async () => {
    const empty = await cart({ ageHours: 25, email: "empty@example.test", item: false });
    const noRecipient = await cart({ ageHours: 25 });
    const completed = await cart({ ageHours: 25, email: "done@example.test", completedActivityVersion: 1 });
    const result = await runRetailCartReminderSweep(now);
    assert.ok(result.considered >= 3);
    assert.equal(await deliveryFor(empty.id, 1), undefined);
    assert.equal(await deliveryFor(noRecipient.id, 1), undefined);
    assert.equal(await deliveryFor(completed.id, 1), undefined);
  });

  await t.test("concurrent sweeps produce one deterministic outbox event per activity", async () => {
    const candidate = await cart({ ageHours: 25, email: "concurrent@example.test" });
    await Promise.all([runRetailCartReminderSweep(now), runRetailCartReminderSweep(now)]);
    const rows = await db.select().from(emailDeliveriesTable)
      .where(eq(emailDeliveriesTable.eventKey, `retail-cart-reminder:${candidate.id}:activity:1`));
    assert.equal(rows.length, 1);
  });

  await t.test("a later activity version qualifies again", async () => {
    const candidate = await cart({ ageHours: 25, email: "again@example.test" });
    await runRetailCartReminderSweep(now);
    assert.ok(await deliveryFor(candidate.id, 1));
    await db.update(retailCartsTable).set({
      activityVersion: 2,
      updatedAt: new Date(now.getTime() - 25 * 60 * 60_000),
    }).where(eq(retailCartsTable.id, candidate.id));
    await runRetailCartReminderSweep(now);
    assert.ok(await deliveryFor(candidate.id, 2));
  });
});