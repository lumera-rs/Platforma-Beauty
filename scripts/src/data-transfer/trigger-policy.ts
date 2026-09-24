import type { DatabaseClient } from "../backend-standards-database";
import { relation, identifier } from "./catalog";

/** Closed canonical list. Validation functions reject only; none assign NEW or emit effects. */
export const validatingTriggers = [
  "aftercare_recommendation_lines.protect_aftercare_recommendation_line_evidence",
  "aftercare_recommendations.protect_aftercare_recommendation_evidence",
  "b2c_promotional_banners.b2c_banners_validate_destination",
  "education_bundle_purchases.education_bundle_purchases_payment_reference_immutable",
  "education_gift_vouchers.education_gift_vouchers_snapshot_immutable",
  "order_bundle_components.order_bundle_components_immutable",
  "order_items.order_items_commercial_snapshot_immutable",
  "order_items.order_items_coupon_snapshot_immutable",
  "order_items.order_items_g2_snapshot_immutable",
  "orders.orders_invoice_snapshot_immutable",
  "orders.orders_promotion_snapshot_immutable",
  "product_bundle_components.product_bundle_components_validate",
  "product_categories.product_categories_supplier_ownership",
  "products.products_supplier_ownership",
  "referral_attributions.referral_attributions_append_only",
  "referral_credit_ledger.referral_credit_ledger_append_only",
  "referral_credit_redemptions.referral_credit_redemptions_append_only",
  "retail_order_items.retail_order_items_commercial_snapshot_immutable",
  "retail_order_items.retail_order_items_coupon_snapshot_immutable",
  "retail_order_items.retail_order_items_g2_snapshot_immutable",
  "retail_orders.retail_orders_promotion_snapshot_immutable",
] as const;
export const mutatingTriggers = [
  { key: "education_centers.education_centers_immutable_payment_reference", reason: "Assigns a reference on INSERT; verify reference is present, preserve existing references." },
  { key: "salons.salons_immutable_payment_reference", reason: "Assigns a reference on INSERT; verify reference is present, preserve existing references." },
  { key: "products.products_enqueue_restocked_waitlist", reason: "Enqueues external notifications on stock UPDATE; no transfer invariant: historical restock events must not be replayed." },
] as const;
export async function inspectTriggerPolicy(client: DatabaseClient, fixtureMutating: readonly string[] = [], fixtureValidating: readonly string[] = []): Promise<string[]> {
  const result = await client.query(`SELECT c.relname,t.tgname,t.tgenabled FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`);
  const disabled: string[] = [];
  for (const row of result.rows) {
    const key = `${String(row.relname)}.${String(row.tgname)}`;
    if (row.tgenabled !== "O" || (!validatingTriggers.some(x => x === key) && !mutatingTriggers.some(x => x.key === key)
      && !fixtureMutating.includes(key) && !fixtureValidating.includes(key))) {
      throw Object.assign(new Error("UNCLASSIFIED_TRIGGER"), { code: "UNCLASSIFIED_TRIGGER" });
    }
    if (mutatingTriggers.some(x => x.key === key) || fixtureMutating.includes(key)) disabled.push(key);
  }
  return disabled;
}
export async function setMutatingTriggers(client: DatabaseClient, keys: string[], enabled: boolean): Promise<void> {
  for (const key of keys) {
    const [table, trigger] = key.split(".");
    await client.query(`ALTER TABLE ${relation(`public.${table}`)} ${enabled ? "ENABLE" : "DISABLE"} TRIGGER ${identifier(trigger!)}`);
  }
}
export async function verifyDisabledTriggerInvariants(client: DatabaseClient, keys: string[]): Promise<void> {
  for (const key of keys.filter(k => k.endsWith("_immutable_payment_reference"))) {
    const table = key.split(".")[0]!;
    const result = await client.query(`SELECT count(*)::text AS count FROM ${relation(`public.${table}`)} WHERE payment_reference_number IS NULL`);
    if (Number(result.rows[0]?.count)) throw Object.assign(new Error("TRIGGER_INVARIANT_VIOLATION"), { code: "TRIGGER_INVARIANT_VIOLATION" });
  }
}