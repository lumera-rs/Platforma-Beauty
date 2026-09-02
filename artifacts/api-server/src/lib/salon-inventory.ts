import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  productsTable,
  salonInventoryTable,
  salonInventoryMovementsTable,
  salonNotificationsTable,
  serviceProductConsumptionsTable,
} from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Default low-stock threshold when the owner has not set one: 10% of the
 * highest stock level the item ever reached (at least 1 usage unit).
 */
export function effectiveLowStockThreshold(item: {
  lowStockThreshold: number | null;
  peakQuantity: number;
}): number {
  if (item.lowStockThreshold !== null) return item.lowStockThreshold;
  return Math.max(1, Math.round(item.peakQuantity * 0.1 * 100) / 100);
}

/**
 * Credits salon inventory for a placed B2B order, inside the checkout
 * transaction. One purchased piece credits `unit_content_amount` usage units
 * (default 1). Upserts the inventory row and appends purchase movements.
 * Never touches the platform catalog stock.
 */
export async function creditInventoryForOrderInTx(
  tx: Tx,
  input: {
    salonId: string;
    orderId: string;
    items: ReadonlyArray<{ productId: string; quantity: number }>;
  },
): Promise<void> {
  // Aggregate quantities per product (variants of one product share inventory).
  const perProduct = new Map<string, number>();
  for (const item of input.items) {
    if (item.quantity <= 0) continue;
    perProduct.set(item.productId, (perProduct.get(item.productId) ?? 0) + item.quantity);
  }
  for (const [productId, pieces] of perProduct) {
    const [inventory] = await tx.insert(salonInventoryTable).values({
      salonId: input.salonId,
      productId,
      quantity: 0,
      unitContentAmount: 1,
      peakQuantity: 0,
    }).onConflictDoNothing().returning();
    const row = inventory ?? (await tx.select().from(salonInventoryTable).where(and(
      eq(salonInventoryTable.salonId, input.salonId),
      eq(salonInventoryTable.productId, productId),
    )).limit(1))[0];
    if (!row) continue; // unreachable: upsert-or-select above
    const credit = pieces * row.unitContentAmount;
    await tx.update(salonInventoryTable).set({
      quantity: sql`${salonInventoryTable.quantity} + ${credit}`,
      peakQuantity: sql`GREATEST(${salonInventoryTable.peakQuantity}, ${salonInventoryTable.quantity} + ${credit})`,
      updatedAt: new Date(),
    }).where(eq(salonInventoryTable.id, row.id));
    await tx.insert(salonInventoryMovementsTable).values({
      salonId: input.salonId,
      inventoryId: row.id,
      productId,
      type: "purchase",
      quantityDelta: credit,
      orderId: input.orderId,
    });
  }
}

export type LowStockWarning = {
  productId: string;
  productName: string;
  quantity: number;
  threshold: number;
  unit: string;
};

/**
 * Consumes mapped product quantities when an appointment transitions INTO
 * `completed`. Runs inside the completion transaction. Idempotent: the partial
 * unique index on (appointment_id, product_id) WHERE type='consumption'
 * guarantees one debit per appointment/product even if the transition is
 * re-entered — a conflicting insert is skipped and nothing is decremented.
 *
 * Returns low-stock warnings for items that are AT or BELOW their threshold
 * after the debit, with a deduplicated salon notification inserted in the same
 * transaction (callers publish the SSE update after commit).
 */
export async function consumeInventoryForAppointmentInTx(
  tx: Tx,
  appointment: { id: string; salonId: string; serviceId: string },
): Promise<LowStockWarning[]> {
  const consumptions = await tx.select({
    productId: serviceProductConsumptionsTable.productId,
    quantityPerUse: serviceProductConsumptionsTable.quantityPerUse,
    productName: productsTable.name,
    productUnit: productsTable.unit,
  }).from(serviceProductConsumptionsTable)
    .innerJoin(productsTable, eq(productsTable.id, serviceProductConsumptionsTable.productId))
    .where(and(
      eq(serviceProductConsumptionsTable.serviceId, appointment.serviceId),
      eq(serviceProductConsumptionsTable.salonId, appointment.salonId),
    ));
  if (!consumptions.length) return [];

  const warnings: LowStockWarning[] = [];
  for (const consumption of consumptions) {
    if (consumption.quantityPerUse <= 0) continue;
    const [inventory] = await tx.insert(salonInventoryTable).values({
      salonId: appointment.salonId,
      productId: consumption.productId,
      quantity: 0,
      unitContentAmount: 1,
      peakQuantity: 0,
    }).onConflictDoNothing().returning();
    const row = inventory ?? (await tx.select().from(salonInventoryTable).where(and(
      eq(salonInventoryTable.salonId, appointment.salonId),
      eq(salonInventoryTable.productId, consumption.productId),
    )).limit(1))[0];
    if (!row) continue;

    // Idempotency gate: only the first completion transition records the
    // movement; a skipped insert means the debit already happened.
    const inserted = await tx.insert(salonInventoryMovementsTable).values({
      salonId: appointment.salonId,
      inventoryId: row.id,
      productId: consumption.productId,
      type: "consumption",
      quantityDelta: -consumption.quantityPerUse,
      appointmentId: appointment.id,
      serviceId: appointment.serviceId,
    }).onConflictDoNothing().returning({ id: salonInventoryMovementsTable.id });
    if (!inserted.length) continue;

    const [updated] = await tx.update(salonInventoryTable).set({
      quantity: sql`GREATEST(0, ${salonInventoryTable.quantity} - ${consumption.quantityPerUse})`,
      updatedAt: new Date(),
    }).where(eq(salonInventoryTable.id, row.id)).returning();
    if (!updated) continue;

    const threshold = effectiveLowStockThreshold(updated);
    if (updated.quantity <= threshold) {
      const unit = updated.usageUnit ?? consumption.productUnit;
      warnings.push({
        productId: consumption.productId,
        productName: consumption.productName,
        quantity: updated.quantity,
        threshold,
        unit,
      });
      // Deduplicate: skip if an UNREAD low-stock notification for this product
      // is already in the inbox (href carries the product marker).
      const href = `/vlasnik/inventar?proizvod=${consumption.productId}`;
      const [existing] = await tx.select({ id: salonNotificationsTable.id })
        .from(salonNotificationsTable)
        .where(and(
          eq(salonNotificationsTable.salonId, appointment.salonId),
          eq(salonNotificationsTable.href, href),
          isNull(salonNotificationsTable.readAt),
        )).limit(1);
      if (!existing) {
        await tx.insert(salonNotificationsTable).values({
          salonId: appointment.salonId,
          title: "Zalihe pri kraju",
          message: `Proizvod "${consumption.productName}" je pri kraju: preostalo ${formatQuantity(updated.quantity)} ${unit} (prag ${formatQuantity(threshold)} ${unit}).`,
          href,
        });
      }
    }
  }
  return warnings;
}

export function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Owner-facing inventory listing with product identity, effective threshold
 * and low-stock flag.
 */
export async function listSalonInventory(salonId: string) {
  const rows = await db.select({
    inventory: salonInventoryTable,
    productName: productsTable.name,
    productUnit: productsTable.unit,
    productImageUrl: productsTable.imageUrl,
    productSku: productsTable.sku,
  }).from(salonInventoryTable)
    .innerJoin(productsTable, eq(productsTable.id, salonInventoryTable.productId))
    .where(eq(salonInventoryTable.salonId, salonId));
  return rows.map((row) => {
    const threshold = effectiveLowStockThreshold(row.inventory);
    return {
      productId: row.inventory.productId,
      productName: row.productName,
      productSku: row.productSku,
      productImageUrl: row.productImageUrl,
      quantity: row.inventory.quantity,
      unit: row.inventory.usageUnit ?? row.productUnit,
      unitContentAmount: row.inventory.unitContentAmount,
      usageUnit: row.inventory.usageUnit,
      lowStockThreshold: row.inventory.lowStockThreshold,
      effectiveThreshold: threshold,
      lowStock: row.inventory.quantity <= threshold,
      updatedAt: row.inventory.updatedAt.toISOString(),
    };
  }).sort((a, b) => Number(b.lowStock) - Number(a.lowStock) || a.productName.localeCompare(b.productName, "sr"));
}

/**
 * Consumption mappings for a set of services, with product identity — used by
 * the owner services UI.
 */
export async function listServiceConsumptions(salonId: string, serviceIds?: readonly string[]) {
  const where = serviceIds
    ? and(eq(serviceProductConsumptionsTable.salonId, salonId), inArray(serviceProductConsumptionsTable.serviceId, [...serviceIds]))
    : eq(serviceProductConsumptionsTable.salonId, salonId);
  return db.select({
    serviceId: serviceProductConsumptionsTable.serviceId,
    productId: serviceProductConsumptionsTable.productId,
    quantityPerUse: serviceProductConsumptionsTable.quantityPerUse,
    productName: productsTable.name,
    productUnit: productsTable.unit,
  }).from(serviceProductConsumptionsTable)
    .innerJoin(productsTable, eq(productsTable.id, serviceProductConsumptionsTable.productId))
    .where(where);
}
