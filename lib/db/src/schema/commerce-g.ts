import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { mediaAssetsTable } from "./media";
import { productsTable } from "./commerce";
import { usersTable } from "./core";

export type ProductCharacteristic = { name: string; value: string };
export type HeaderBarMessage = { text: string; backgroundColor: string; textColor: string };

export const productDocumentsTable = pgTable("product_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  mediaAssetId: uuid("media_asset_id").notNull().references(() => mediaAssetsTable.id, { onDelete: "restrict" }),
  displayName: text("display_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("product_documents_product_asset_unique").on(t.productId, t.mediaAssetId),
  index("product_documents_product_sort_idx").on(t.productId, t.sortOrder, t.id),
  index("product_documents_asset_idx").on(t.mediaAssetId),
]);

export const commerceExperienceSettingsTable = pgTable("commerce_experience_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  headerEnabled: boolean("header_enabled").notNull().default(false),
  headerMessages: jsonb("header_messages").$type<HeaderBarMessage[]>().notNull().default([]),
  headerIntervalSeconds: integer("header_interval_seconds").notNull().default(5),
  smartSearchMode: text("smart_search_mode").notNull().default("AUTOMATIC"),
  smartSearchProductIds: jsonb("smart_search_product_ids").$type<string[]>().notNull().default([]),
  bestsellerPeriodDays: integer("bestseller_period_days").notNull().default(30),
  version: integer("version").notNull().default(1),
  updatedByUserId: uuid("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("commerce_experience_settings_singleton_unique").on(sql`(true)`),
  check("commerce_experience_settings_values_check", sql`
    ${t.headerIntervalSeconds} BETWEEN 2 AND 60
    AND ${t.smartSearchMode} IN ('AUTOMATIC', 'MANUAL')
    AND jsonb_array_length(${t.smartSearchProductIds}) <= 5
    AND ${t.bestsellerPeriodDays} IN (30, 60)
    AND ${t.version} >= 1
  `),
]);