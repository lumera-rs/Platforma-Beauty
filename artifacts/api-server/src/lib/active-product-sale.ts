import { sql, type SQL } from "drizzle-orm";
import { productsTable } from "@workspace/db";

export type ProductSaleChannel = "B2B" | "B2C";

type SaleFields = Pick<
  typeof productsTable.$inferSelect,
  "discountPrice" | "discountPriceEndsAt" | "publicDiscountPrice" | "publicDiscountPriceEndsAt"
>;

/**
 * The single application-level definition of an active catalog sale.
 * The end instant is exclusive. A null end retains the historical perpetual
 * discount behavior exactly.
 */
export function activeProductSale(
  product: SaleFields,
  channel: ProductSaleChannel,
  now: Date = new Date(),
): { price: number; endsAt: Date | null } | null {
  const price = channel === "B2B" ? product.discountPrice : product.publicDiscountPrice;
  const endsAt = channel === "B2B" ? product.discountPriceEndsAt : product.publicDiscountPriceEndsAt;
  return price != null && (endsAt == null || endsAt.getTime() > now.getTime())
    ? { price, endsAt }
    : null;
}

/** SQL equivalent of activeProductSale for filtering and ordering before paging. */
export function activeProductSalePriceSql(channel: ProductSaleChannel, now: SQL | Date = sql`CURRENT_TIMESTAMP`): SQL<number | null> {
  const price = channel === "B2B" ? productsTable.discountPrice : productsTable.publicDiscountPrice;
  const endsAt = channel === "B2B" ? productsTable.discountPriceEndsAt : productsTable.publicDiscountPriceEndsAt;
  return sql<number | null>`CASE WHEN ${price} IS NOT NULL AND (${endsAt} IS NULL OR ${endsAt} > ${now}) THEN ${price} ELSE NULL END`;
}

export function activeProductSaleConditionSql(channel: ProductSaleChannel, now: SQL | Date = sql`CURRENT_TIMESTAMP`): SQL<boolean> {
  const price = channel === "B2B" ? productsTable.discountPrice : productsTable.publicDiscountPrice;
  const endsAt = channel === "B2B" ? productsTable.discountPriceEndsAt : productsTable.publicDiscountPriceEndsAt;
  return sql<boolean>`${price} IS NOT NULL AND (${endsAt} IS NULL OR ${endsAt} > ${now})`;
}