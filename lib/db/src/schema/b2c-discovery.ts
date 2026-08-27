import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./core";
import { productCategoriesTable, productsTable, suppliersTable } from "./commerce";
import { b2cNeedTagsTable } from "./b2c-catalog-taxonomy";

export const b2cBannerPlacementEnum = pgEnum("b2c_banner_placement", [
  "HERO",
  "BELOW_CATEGORIES",
  "IN_RESULTS",
]);
export const b2cBannerDestinationKindEnum = pgEnum("b2c_banner_destination_kind", [
  "CATEGORY",
  "PRODUCT",
  "FILTERED_LISTING",
  "CUSTOM_INTERNAL_PATH",
]);
export const b2cProductSortEnum = pgEnum("b2c_product_sort", [
  "RECOMMENDED",
  "PRICE_ASC",
  "PRICE_DESC",
  "NEWEST",
  "BEST_RATED",
  "MOST_POPULAR",
]);

/** Many-to-many product need/problem assignment used by search and facets. */
export const b2cProductNeedTagsTable = pgTable("b2c_product_need_tags", {
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  needTagId: uuid("need_tag_id").notNull().references(() => b2cNeedTagsTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("b2c_product_need_tags_product_tag_unique").on(table.productId, table.needTagId),
  index("b2c_product_need_tags_tag_product_idx").on(table.needTagId, table.productId),
]);

/**
 * Destination data stays normalized. filteredListing stores only validated,
 * public filter keys; customInternalPath is accepted only after route-level
 * same-origin path validation. Upload-ticket/private storage references are
 * never persisted in the public image URL columns.
 */
export const b2cPromotionalBannersTable = pgTable("b2c_promotional_banners", {
  id: uuid("id").defaultRandom().primaryKey(),
  internalName: text("internal_name").notNull(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "restrict" }),
  desktopImageUrl: text("desktop_image_url").notNull(),
  mobileImageUrl: text("mobile_image_url"),
  headline: text("headline").notNull(),
  text: text("text"),
  ctaLabel: text("cta_label"),
  destinationKind: b2cBannerDestinationKindEnum("destination_kind").notNull(),
  destinationCategoryId: uuid("destination_category_id").references(() => productCategoriesTable.id, { onDelete: "restrict" }),
  destinationProductId: uuid("destination_product_id").references(() => productsTable.id, { onDelete: "restrict" }),
  filteredListing: jsonb("filtered_listing").$type<Record<string, string | string[] | number>>(),
  customInternalPath: text("custom_internal_path"),
  placement: b2cBannerPlacementEnum("placement").notNull(),
  active: boolean("active").notNull().default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  sortOrder: integer("sort_order").notNull().default(0),
  version: integer("version").notNull().default(1),
  createdByUserId: uuid("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByUserId: uuid("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("b2c_banners_supplier_window_sort_idx").on(
    table.supplierId, table.active, table.placement, table.startsAt, table.endsAt, table.sortOrder, table.id,
  ),
  index("b2c_banners_category_idx").on(table.destinationCategoryId),
  index("b2c_banners_product_idx").on(table.destinationProductId),
  index("b2c_banners_created_by_idx").on(table.createdByUserId),
  index("b2c_banners_updated_by_idx").on(table.updatedByUserId),
  check("b2c_banners_version_check", sql`${table.version} >= 1`),
  check("b2c_banners_window_check", sql`${table.startsAt} IS NULL OR ${table.endsAt} IS NULL OR ${table.startsAt} < ${table.endsAt}`),
  check("b2c_banners_internal_path_check", sql`${table.customInternalPath} IS NULL OR (${table.customInternalPath} LIKE '/%' AND ${table.customInternalPath} NOT LIKE '//%')`),
  check("b2c_banners_destination_check", sql`
    (${table.destinationKind} = 'CATEGORY' AND num_nonnulls(${table.destinationCategoryId}, ${table.destinationProductId}, ${table.filteredListing}, ${table.customInternalPath}) = 1 AND ${table.destinationCategoryId} IS NOT NULL)
    OR (${table.destinationKind} = 'PRODUCT' AND num_nonnulls(${table.destinationCategoryId}, ${table.destinationProductId}, ${table.filteredListing}, ${table.customInternalPath}) = 1 AND ${table.destinationProductId} IS NOT NULL)
    OR (${table.destinationKind} = 'FILTERED_LISTING' AND num_nonnulls(${table.destinationCategoryId}, ${table.destinationProductId}, ${table.filteredListing}, ${table.customInternalPath}) = 1 AND ${table.filteredListing} IS NOT NULL)
    OR (${table.destinationKind} = 'CUSTOM_INTERNAL_PATH' AND num_nonnulls(${table.destinationCategoryId}, ${table.destinationProductId}, ${table.filteredListing}, ${table.customInternalPath}) = 1 AND ${table.customInternalPath} IS NOT NULL)
  `),
]);

/** Versioned singleton containing display-safe B2C behavior only. */
export const b2cDisplaySettingsTable = pgTable("b2c_display_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  defaultSort: b2cProductSortEnum("default_sort").notNull().default("RECOMMENDED"),
  enabledSortOptions: jsonb("enabled_sort_options").$type<Array<
    "RECOMMENDED" | "PRICE_ASC" | "PRICE_DESC" | "NEWEST" | "BEST_RATED" | "MOST_POPULAR"
  >>().notNull().default(["RECOMMENDED", "PRICE_ASC", "PRICE_DESC", "NEWEST", "BEST_RATED", "MOST_POPULAR"]),
  pageSize: integer("page_size").notNull().default(24),
  showOutOfStock: boolean("show_out_of_stock").notNull().default(true),
  recentlyViewedEnabled: boolean("recently_viewed_enabled").notNull().default(true),
  recentlyViewedMax: integer("recently_viewed_max").notNull().default(12),
  version: integer("version").notNull().default(1),
  updatedByUserId: uuid("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("b2c_display_settings_singleton_unique").on(sql`(true)`),
  index("b2c_display_settings_updated_by_idx").on(table.updatedByUserId),
  check("b2c_display_settings_values_check", sql`
    ${table.pageSize} BETWEEN 1 AND 100
    AND ${table.recentlyViewedMax} BETWEEN 1 AND 100
    AND ${table.version} >= 1
    AND jsonb_typeof(${table.enabledSortOptions}) = 'array'
  `),
]);

/**
 * A browsing identity is deliberately independent from a retail cart.  Guest
 * rows contain only a hash of an opaque browser cookie; account rows are
 * claimed on sign-in and are never selected by that cookie afterwards.
 */
export const b2cRecentlyViewedProductsTable = pgTable("b2c_recently_viewed_products", {
  id: uuid("id").defaultRandom().primaryKey(),
  viewerTokenHash: text("viewer_token_hash"),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("b2c_recent_views_product_idx").on(table.productId),
  index("b2c_recent_views_user_viewed_idx").on(table.userId, table.lastViewedAt),
  index("b2c_recent_views_viewer_viewed_idx").on(table.viewerTokenHash, table.lastViewedAt),
  uniqueIndex("b2c_recent_views_user_product_unique").on(table.userId, table.productId)
    .where(sql`${table.userId} IS NOT NULL`),
  uniqueIndex("b2c_recent_views_viewer_product_unique").on(table.viewerTokenHash, table.productId)
    .where(sql`${table.viewerTokenHash} IS NOT NULL`),
  check("b2c_recent_views_one_owner_check", sql`num_nonnulls(${table.viewerTokenHash}, ${table.userId}) = 1`),
]);