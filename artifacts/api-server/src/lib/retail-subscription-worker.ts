import { createHash, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "./logger";

const MAX_STOCK_RETRIES = 3;

export function nextRetailSubscriptionDueAt(due: Date, frequency: string, anchorDay = due.getUTCDate()): Date {
  const next = new Date(due);
  if (frequency === "WEEKLY") next.setUTCDate(next.getUTCDate() + 7);
  else if (frequency === "BIWEEKLY") next.setUTCDate(next.getUTCDate() + 14);
  else {
    // Set day 1 before changing month: native setUTCMonth on Jan 31 otherwise
    // overflows into March. Restore the original calendar anchor, clamped only
    // for this target month, while retaining the due instant's time of day.
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + (frequency === "MONTHLY" ? 1 : 2));
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(anchorDay, lastDay));
  }
  return next;
}

/** Processes due customer replenishments. Row locks and the unique
 * (subscription_id, due_at) attempt make simultaneous application nodes safe. */
export async function runRetailSubscriptionWorker(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const claimed = await client.query<{
      id: string; user_id: string; product_id: string; quantity: number; frequency: string; anchor_day: number;
      discount_percent_snapshot: number; payment_method: string; delivery_method: string;
      contact_snapshot: Record<string, string>; delivery_snapshot: Record<string, unknown>; next_due_at: Date;
    }>(`select * from retail_product_subscriptions
      where status = 'ACTIVE' and next_due_at <= now() and (blocked_until is null or blocked_until <= now())
      order by next_due_at asc for update skip locked limit 25`);
    for (const subscription of claimed.rows) {
      const claimToken = randomUUID();
      const [attempt] = (await client.query<{ retry_count: number }>(
        `insert into retail_product_subscription_attempts
          (subscription_id, due_at, status, retry_count, claim_token)
         values ($1,$2,'PROCESSING',0,$3)
         on conflict (subscription_id,due_at) do update set
           status = case when retail_product_subscription_attempts.status = 'INSUFFICIENT_STOCK'
             then 'PROCESSING' else retail_product_subscription_attempts.status end,
           claim_token = excluded.claim_token, claimed_at = now(), updated_at = now()
         where retail_product_subscription_attempts.status = 'INSUFFICIENT_STOCK'
         returning retry_count`,
        [subscription.id, subscription.next_due_at, claimToken],
      )).rows;
      // Existing successful/in-flight attempt owns this logical cycle.
      if (!attempt) continue;
      const user = (await client.query<{ active: boolean; role: string }>(
        "select active, role from users where id=$1 for update", [subscription.user_id],
      )).rows[0];
      const product = (await client.query<{
        id: string; name: string; image_url: string; public_price: number | null; stock: number;
        sku: string; catalog_reference: string; supplier_id: string; supplier_name: string; supplier_slug: string; supplier_active: boolean;
        retail_enabled: boolean; active: boolean; subscription_allowed: boolean; minimum_order_quantity: number;
      }>(`select p.*, s.name supplier_name, s.slug supplier_slug, s.active supplier_active from products p
          join suppliers s on s.id=p.supplier_id where p.id=$1 for update`, [subscription.product_id])).rows[0];
      const retryCount = attempt.retry_count + 1;
      if (!user || !user.active || user.role !== "CUSTOMER" || !product || !product.active || !product.supplier_active || !product.retail_enabled || !product.subscription_allowed || !product.public_price
        || subscription.quantity < 1 || product.minimum_order_quantity > subscription.quantity || product.stock < subscription.quantity) {
        const exhausted = retryCount >= MAX_STOCK_RETRIES;
        await client.query(`update retail_product_subscription_attempts set status='INSUFFICIENT_STOCK',
          retry_count=$2, failure_reason=$3, updated_at=now() where subscription_id=$1 and due_at=$4`,
          [subscription.id, retryCount, product ? "INSUFFICIENT_STOCK" : "PRODUCT_UNAVAILABLE", subscription.next_due_at]);
        await client.query(`update retail_product_subscriptions set blocked_until=$2, last_attempt_at=now(),
          next_due_at=case when $3 then $4 else next_due_at end, updated_at=now() where id=$1`,
          [subscription.id, exhausted ? null : new Date(Date.now() + 60 * 60_000), exhausted, nextRetailSubscriptionDueAt(subscription.next_due_at, subscription.frequency, subscription.anchor_day)]);
        continue;
      }
      const contact = subscription.contact_snapshot;
      const delivery = subscription.delivery_snapshot;
      const base = product.public_price;
      const unitPrice = Math.floor(base * (100 - subscription.discount_percent_snapshot) / 100);
      const subtotal = unitPrice * subscription.quantity;
      const shippingCost = Number(delivery.shippingCost ?? 0);
      const orderNumber = `SUB-${subscription.id.slice(0, 8).toUpperCase()}-${subscription.next_due_at.getTime()}`;
      const tokenHash = createHash("sha256").update(`subscription:${subscription.id}:${subscription.next_due_at.toISOString()}`).digest("hex");
      const [cart] = (await client.query<{ id: string }>(
        "insert into retail_carts (token_hash,user_id) values ($1,$2) returning id",
        [createHash("sha256").update(randomUUID()).digest("hex"), subscription.user_id],
      )).rows;
      const [order] = (await client.query<{ id: string }>(`insert into retail_orders
        (order_number,cart_id,user_id,tracking_token_hash,idempotency_key,status,payment_method,payment_status,delivery_method,
         subtotal,shipping_cost,total,shipping_name,shipping_address,shipping_city,shipping_postal_code,shipping_phone,shipping_email,shipping_note)
        values ($1,$2,$3,$4,$5,'pending',$6,'pending',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
        [orderNumber, cart!.id, subscription.user_id, tokenHash, `subscription:${subscription.id}:${subscription.next_due_at.toISOString()}`,
          subscription.payment_method, subscription.delivery_method, subtotal, shippingCost, subtotal + shippingCost,
          `${contact.firstName} ${contact.lastName}`.trim(), String(delivery.street), String(delivery.city),
          String(delivery.postalCode), contact.phone, contact.email, delivery.note ?? null])).rows;
      await client.query(`insert into retail_order_items
        (order_id,product_id,product_name,product_image_url,product_catalog_reference,unit_price,quantity,supplier_id,supplier_name,supplier_slug,
         product_sku_snapshot,line_subtotal,line_total,base_unit_price,effective_unit_price,price_source,line_discount,discount_snapshot)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$6,'FULL_PRICE',$14,$15)`,
        [order!.id, product.id, product.name, product.image_url, product.catalog_reference, unitPrice, subscription.quantity,
          product.supplier_id, product.supplier_name, product.supplier_slug, product.sku, subtotal, base,
          (base - unitPrice) * subscription.quantity, subscription.discount_percent_snapshot]);
      const decremented = await client.query("update products set stock=stock-$2 where id=$1 and stock >= $2", [product.id, subscription.quantity]);
      if (decremented.rowCount !== 1) throw new Error("Subscription stock changed while locked");
      await client.query(`update retail_product_subscription_attempts set status='CREATED',order_id=$3,updated_at=now()
        where subscription_id=$1 and due_at=$2`, [subscription.id, subscription.next_due_at, order!.id]);
      await client.query(`update retail_product_subscriptions set next_due_at=$2,blocked_until=null,last_attempt_at=now(),updated_at=now() where id=$1`,
        [subscription.id, nextRetailSubscriptionDueAt(subscription.next_due_at, subscription.frequency, subscription.anchor_day)]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    logger.error({ err: error }, "Retail subscription worker failed");
    throw error;
  } finally { client.release(); }
}