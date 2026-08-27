import {
  commerceCustomerNotificationsTable,
  db,
  productWaitlistNotificationOutboxTable,
  salonNotificationsTable,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { publishSalonNotificationUpdate } from "./salon-notification-events";

/**
 * Delivers rows created by the database's 0 -> positive-stock trigger.
 *
 * A row is claimed and its in-app notification is written in one transaction.
 * The outbox row is only marked processed after that write, so retries are
 * naturally idempotent.  FOR UPDATE SKIP LOCKED permits several app processes
 * to drain the same durable queue safely.
 */
export async function runProductWaitlistNotificationWorker(batchSize = 100) {
  const result = { processed: 0 };
  for (let index = 0; index < batchSize; index += 1) {
    const delivered = await db.transaction(async (tx) => {
      const locked = await tx.execute<{
        id: string; waitlist_id: string; audience: "B2B" | "B2C"; salon_id: string | null;
        user_id: string | null; product_id: string;
      }>(sql`
        SELECT id, waitlist_id, audience, salon_id, user_id, product_id
        FROM product_waitlist_notification_outbox
        WHERE processed_at IS NULL
        ORDER BY created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const row = locked.rows[0];
      if (!row) return null;
      const href = row.audience === "B2B" ? `/shop/products/${row.product_id}` : `/shop/public/products/${row.product_id}`;
      if (row.audience === "B2B") {
        if (!row.salon_id) throw new Error(`Invalid B2B waitlist outbox row ${row.id}`);
        const [notification] = await tx.insert(salonNotificationsTable).values({
          salonId: row.salon_id,
          title: "Proizvod je ponovo dostupan",
          message: "Proizvod za koji ste tražili obaveštenje ponovo je na stanju.",
          href,
        }).returning({ id: salonNotificationsTable.id, salonId: salonNotificationsTable.salonId });
        await tx.update(productWaitlistNotificationOutboxTable).set({ processedAt: new Date() })
          .where(and(eq(productWaitlistNotificationOutboxTable.id, row.id), isNull(productWaitlistNotificationOutboxTable.processedAt)));
        return notification!;
      }
      if (!row.user_id) throw new Error(`Invalid B2C waitlist outbox row ${row.id}`);
      await tx.insert(commerceCustomerNotificationsTable).values({
        userId: row.user_id,
        // An outbox row is unique per waitlist entry; the notification's own
        // unique waitlist key makes an accidental replay safe as well.
        waitlistId: row.waitlist_id,
        title: "Proizvod je ponovo dostupan",
        message: "Proizvod za koji ste tražili obaveštenje ponovo je na stanju.",
        href,
      }).onConflictDoNothing();
      await tx.update(productWaitlistNotificationOutboxTable).set({ processedAt: new Date() })
        .where(and(eq(productWaitlistNotificationOutboxTable.id, row.id), isNull(productWaitlistNotificationOutboxTable.processedAt)));
      return { id: "", salonId: null };
    });
    if (!delivered) break;
    result.processed += 1;
    if (delivered.salonId) void publishSalonNotificationUpdate(delivered.salonId);
  }
  return result;
}