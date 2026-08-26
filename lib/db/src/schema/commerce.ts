import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { salonsTable, usersTable } from "./core";

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "confirmed",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "CARD",
  "BANK_TRANSFER",
  "CASH_AT_SALON",
  "CASH_ON_DELIVERY",
  "FREE",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "unpaid",
  "pending",
  "paid",
  "refunded",
  "failed",
]);

export const deliveryMethodEnum = pgEnum("delivery_method", [
  "courier",
  "personal_belgrade",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trial",
  "active",
  "past_due",
  "cancelled",
  "suspended",
  "free_via_loyalty",
]);

export const productCategoriesTable = pgTable("product_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  parentId: uuid("parent_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  icon: text("icon"),
  imageUrl: text("image_url"),
  active: boolean("active").notNull().default(true),
}, (table) => [
  // Category tree navigation: children of a parent node.
  index("product_categories_parent_sort_idx").on(table.parentId, table.sortOrder),
  // Active category listing ordered by sortOrder.
  index("product_categories_active_sort_idx").on(table.active, table.sortOrder),
]);

export const productsTable = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  categoryId: uuid("category_id").references(() => productCategoriesTable.id, { onDelete: "set null" }),
  categoryName: text("category_name").notNull(),
  subcategoryName: text("subcategory_name"),
  name: text("name").notNull(),
  brand: text("brand"),
  description: text("description").notNull(),
  shortDescription: text("short_description"),
  imageUrl: text("image_url").notNull(),
  images: jsonb("images").$type<string[]>().notNull().default([]),
  price: integer("price").notNull(),
  discountPrice: integer("discount_price"),
  retailEnabled: boolean("retail_enabled").notNull().default(false),
  publicDescription: text("public_description"),
  publicPrice: integer("public_price"),
  publicDiscountPrice: integer("public_discount_price"),
  professionalEnabled: boolean("professional_enabled").notNull().default(true),
  stock: integer("stock").notNull().default(0),
  // Opaque customer-facing reference. Unlike SKU, this is never edited.
  catalogReference: text("catalog_reference").notNull()
    .default(sql`'LUM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))`),
  sku: text("sku").notNull().unique(),
  unit: text("unit").notNull(),
  weightGrams: integer("weight_grams"),
  isNew: boolean("is_new").notNull().default(false),
  isBestseller: boolean("is_bestseller").notNull().default(false),
  variantType: text("variant_type"),
  variants: jsonb("variants").$type<Array<{ label: string; value: string; priceAdjust?: number; price?: number; stock?: number; sku?: string }>>(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Product catalog: active listings by category, sorted by creation date or price.
  index("products_category_active_idx").on(table.categoryId, table.active),
  uniqueIndex("products_catalog_reference_unique").on(table.catalogReference),
  index("products_active_created_idx").on(table.active, table.createdAt),
  index("products_retail_active_created_idx").on(table.retailEnabled, table.active, table.createdAt),
  index("products_professional_active_created_idx").on(table.professionalEnabled, table.active, table.createdAt),
  index("products_brand_active_idx").on(table.brand, table.active),
]);

export const shippingRulesTable = pgTable("shipping_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  freeShippingThreshold: integer("free_shipping_threshold").notNull().default(0),
  tiers: jsonb("tiers")
    .$type<Array<{ maxWeightGrams: number; price: number; label: string }>>()
    .notNull()
    .default([]),
  personalDeliveryEnabled: boolean("personal_delivery_enabled").notNull().default(false),
  personalDeliveryName: text("personal_delivery_name").notNull().default("Lična dostava u Beogradu"),
  personalDeliveryPrice: integer("personal_delivery_price").notNull().default(0),
  personalDeliveryDescription: text("personal_delivery_description").notNull().default("Dostava na adresu u Beogradu."),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, () => [
  // This legacy table is a singleton. A constant-expression unique index
  // enforces that invariant without changing the existing row shape.
  uniqueIndex("shipping_rules_singleton_unique").on(sql`(true)`),
]);

export const courierServicesTable = pgTable("courier_services", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull().unique(),
  trackingUrlTemplate: text("tracking_url_template"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const loyaltyTiersTable = pgTable("loyalty_tiers", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull(),
  spendThreshold: integer("spend_threshold").notNull(),
  period: text("period").notNull().default("monthly"),
  subscriptionDiscountPercent: integer("subscription_discount_percent").notNull().default(0),
  productDiscountPercent: integer("product_discount_percent").notNull().default(0),
  freeSubscription: boolean("free_subscription").notNull().default(false),
  premiumListing: boolean("premium_listing").notNull().default(false),
  freeShipping: boolean("free_shipping").notNull().default(false),
  benefits: jsonb("benefits").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
});

export const salonLoyaltyStatusesTable = pgTable("salon_loyalty_statuses", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().unique().references(() => salonsTable.id, { onDelete: "cascade" }),
  tierId: uuid("tier_id").references(() => loyaltyTiersTable.id, { onDelete: "set null" }),
  currentPeriodSpend: integer("current_period_spend").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for tierId (e.g. "all salons on this tier").
  index("salon_loyalty_statuses_tier_idx").on(table.tierId),
]);

export const subscriptionPlansTable = pgTable("subscription_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  price: integer("price").notNull(),
  trialDays: integer("trial_days").notNull().default(0),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  limits: jsonb("limits").$type<Record<string, number>>().notNull().default({}),
  active: boolean("active").notNull().default(true),
});

export const subscriptionsTable = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => subscriptionPlansTable.id),
  status: subscriptionStatusEnum("status").notNull().default("trial"),
  dueAmount: integer("due_amount").notNull(),
  paymentMethod: paymentMethodEnum("payment_method").notNull().default("BANK_TRANSFER"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
}, (table) => [
  // Leading FK coverage for salonId (a salon's subscription).
  index("subscriptions_salon_idx").on(table.salonId),
  // Leading FK coverage for planId (all subscribers on a plan).
  index("subscriptions_plan_idx").on(table.planId),
]);

export const ordersTable = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id),
  status: orderStatusEnum("status").notNull().default("pending"),
  total: integer("total").notNull(),
  shippingCost: integer("shipping_cost").notNull().default(0),
  shippingName: text("shipping_name").notNull(),
  shippingAddress: text("shipping_address").notNull(),
  shippingPhone: text("shipping_phone"),
  shippingEmail: text("shipping_email"),
  shippingCity: text("shipping_city"),
  shippingPostalCode: text("shipping_postal_code"),
  shippingNote: text("shipping_note"),
  shippingIsSalonAddress: boolean("shipping_is_salon_address").notNull().default(true),
  billingCompanyName: text("billing_company_name"),
  billingTaxId: text("billing_tax_id"),
  billingRegistrationNumber: text("billing_registration_number"),
  billingAddress: text("billing_address"),
  billingCity: text("billing_city"),
  billingPostalCode: text("billing_postal_code"),
  subtotal: integer("subtotal").notNull().default(0),
  /** Immutable VAT-inclusive merchandise amount before referral credit. */
  referralCreditMerchandiseSubtotalRsd: integer("referral_credit_merchandise_subtotal_rsd").notNull().default(0),
  /** Immutable merchandise-plus-shipping amount before referral credit. */
  referralCreditPreCreditPayableTotalRsd: integer("referral_credit_pre_credit_payable_total_rsd").notNull().default(0),
  /** Immutable referral-credit accounting snapshot; never includes shipping. */
  referralCreditAppliedRsd: integer("referral_credit_applied_rsd").notNull().default(0),
  referralCreditRestoredAt: timestamp("referral_credit_restored_at", { withTimezone: true }),
  totalWeightGrams: integer("total_weight_grams").notNull().default(0),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  paymentStatus: paymentStatusEnum("payment_status").notNull().default("unpaid"),
  deliveryMethod: deliveryMethodEnum("delivery_method").notNull().default("courier"),
  courierServiceId: uuid("courier_service_id").references(() => courierServicesTable.id, { onDelete: "set null" }),
  courierService: text("courier_service"),
  trackingNumber: text("tracking_number"),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Order list: all orders for a salon, sorted by date; also filter by status.
  index("orders_salon_created_idx").on(table.salonId, table.createdAt),
  index("orders_salon_status_idx").on(table.salonId, table.status),
  index("orders_payment_status_idx").on(table.paymentStatus, table.createdAt),
  // Leading FK coverage for courierServiceId.
  index("orders_courier_service_idx").on(table.courierServiceId),
]);

export const orderStatusHistoryTable = pgTable("order_status_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id"),
  actorName: text("actor_name").notNull().default("Administrator"),
  field: text("field").notNull(),
  previousValue: text("previous_value"),
  nextValue: text("next_value"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for orderId (also ordered for timeline display).
  index("order_status_history_order_created_idx").on(table.orderId, table.createdAt),
]);

export const shoppingCartsTable = pgTable("shopping_carts", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().unique().references(() => salonsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shoppingCartItemsTable = pgTable("shopping_cart_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  cartId: uuid("cart_id").notNull().references(() => shoppingCartsTable.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  variantValue: text("variant_value"),
  productName: text("product_name").notNull(),
  productImageUrl: text("product_image_url").notNull(),
  variantLabel: text("variant_label"),
  productSku: text("product_sku"),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for both sides of the cart-items join.
  index("shopping_cart_items_cart_idx").on(table.cartId),
  index("shopping_cart_items_product_idx").on(table.productId),
]);

export const orderItemsTable = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => productsTable.id),
  productName: text("product_name").notNull(),
  variantValue: text("variant_value"),
  variantLabel: text("variant_label"),
  productSku: text("product_sku"),
  quantity: integer("quantity").notNull(),
  price: integer("price").notNull(),
}, (table) => [
  // Leading FK coverage for both sides.
  index("order_items_order_idx").on(table.orderId),
  index("order_items_product_idx").on(table.productId),
]);

export const productReviewsTable = pgTable("product_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Unique covers productId as leading column.
  uniqueIndex("product_reviews_product_salon_unique").on(table.productId, table.salonId),
  // Leading FK coverage for salonId (all reviews a salon has written).
  index("product_reviews_salon_idx").on(table.salonId),
]);

// Retail checkout is intentionally separate from the salon-owned B2B cart and
// order model. This keeps guest identity, delivery snapshots, and inventory
// reservations out of fulfillment code that assumes a salon.
export const retailCartsTable = pgTable("retail_carts", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("retail_carts_user_idx").on(table.userId),
]);

export const retailCartItemsTable = pgTable("retail_cart_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  cartId: uuid("cart_id").notNull().references(() => retailCartsTable.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  variantValue: text("variant_value"),
  productName: text("product_name").notNull(),
  productImageUrl: text("product_image_url").notNull(),
  productCatalogReference: text("product_catalog_reference"),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
  weightGrams: integer("weight_grams").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("retail_cart_items_cart_product_variant_unique")
    .on(table.cartId, table.productId, table.variantValue)
    .nullsNotDistinct(),
  index("retail_cart_items_cart_idx").on(table.cartId),
  index("retail_cart_items_product_idx").on(table.productId),
]);

export const retailOrdersTable = pgTable("retail_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  cartId: uuid("cart_id").notNull().references(() => retailCartsTable.id, { onDelete: "restrict" }),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  trackingTokenHash: text("tracking_token_hash").notNull().unique(),
  trackingTokenRevokedAt: timestamp("tracking_token_revoked_at", { withTimezone: true }),
  idempotencyKey: text("idempotency_key").notNull(),
  status: orderStatusEnum("status").notNull().default("pending"),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  paymentStatus: paymentStatusEnum("payment_status").notNull().default("unpaid"),
  deliveryMethod: deliveryMethodEnum("delivery_method").notNull().default("courier"),
  subtotal: integer("subtotal").notNull(),
  /** Immutable VAT-inclusive merchandise amount before referral credit. */
  referralCreditMerchandiseSubtotalRsd: integer("referral_credit_merchandise_subtotal_rsd").notNull().default(0),
  /** Immutable merchandise-plus-shipping amount before referral credit. */
  referralCreditPreCreditPayableTotalRsd: integer("referral_credit_pre_credit_payable_total_rsd").notNull().default(0),
  /** Immutable referral-credit accounting snapshot; never includes shipping. */
  referralCreditAppliedRsd: integer("referral_credit_applied_rsd").notNull().default(0),
  referralCreditRestoredAt: timestamp("referral_credit_restored_at", { withTimezone: true }),
  shippingCost: integer("shipping_cost").notNull().default(0),
  total: integer("total").notNull(),
  shippingName: text("shipping_name").notNull(),
  shippingAddress: text("shipping_address").notNull(),
  shippingCity: text("shipping_city").notNull(),
  shippingPostalCode: text("shipping_postal_code").notNull(),
  shippingPhone: text("shipping_phone").notNull(),
  shippingEmail: text("shipping_email").notNull(),
  shippingNote: text("shipping_note"),
  trackingNumber: text("tracking_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("retail_orders_cart_idempotency_unique").on(table.cartId, table.idempotencyKey),
  index("retail_orders_user_created_idx").on(table.userId, table.createdAt),
  index("retail_orders_status_created_idx").on(table.status, table.createdAt),
]);

export const retailOrderItemsTable = pgTable("retail_order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => retailOrdersTable.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => productsTable.id),
  productName: text("product_name").notNull(),
  productImageUrl: text("product_image_url").notNull(),
  productCatalogReference: text("product_catalog_reference"),
  variantValue: text("variant_value"),
  variantLabel: text("variant_label"),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
}, (table) => [
  index("retail_order_items_order_idx").on(table.orderId),
  index("retail_order_items_product_idx").on(table.productId),
  index("retail_order_items_catalog_reference_order_idx").on(table.productCatalogReference, table.orderId),
]);

export const retailProductReviewsTable = pgTable("retail_product_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  orderItemId: uuid("order_item_id").notNull().references(() => retailOrderItemsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("retail_product_reviews_item_user_unique").on(table.orderItemId, table.userId),
  index("retail_product_reviews_product_idx").on(table.productId),
  index("retail_product_reviews_user_idx").on(table.userId),
]);

export const salonNotificationsTable = pgTable("salon_notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  message: text("message").notNull(),
  href: text("href"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for salonId (notification inbox, newest-first).
  index("salon_notifications_salon_created_at_idx").on(table.salonId, table.createdAt),
  index("salon_notifications_retention_idx")
    .on(table.createdAt)
    .where(sql`${table.readAt} is not null`),
]);

// ---------------------------------------------------------------------------
// Salon notification archive.
// Immutable copy of salon_notifications rows as they leave the live table,
// keyed by the originating notification id (sourceId).
// ---------------------------------------------------------------------------
export const salonNotificationArchivesTable = pgTable("salon_notification_archives", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Stable reference back to salon_notifications.id. */
  sourceId: text("source_id").notNull().unique(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  originalCreatedAt: timestamp("original_created_at", { withTimezone: true }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("salon_notification_archives_archived_at_idx").on(table.archivedAt),
]);
