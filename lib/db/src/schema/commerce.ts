import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { salonsTable } from "./core";

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
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
});

export const productsTable = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  categoryId: uuid("category_id").references(() => productCategoriesTable.id, { onDelete: "set null" }),
  categoryName: text("category_name").notNull(),
  subcategoryName: text("subcategory_name"),
  name: text("name").notNull(),
  brand: text("brand"),
  description: text("description").notNull(),
  imageUrl: text("image_url").notNull(),
  price: integer("price").notNull(),
  discountPrice: integer("discount_price"),
  stock: integer("stock").notNull().default(0),
  sku: text("sku").notNull().unique(),
  unit: text("unit").notNull(),
  isNew: boolean("is_new").notNull().default(false),
  isBestseller: boolean("is_bestseller").notNull().default(false),
  variants: jsonb("variants").$type<Array<{ label: string; value: string; priceAdjust?: number }>>(),
  active: boolean("active").notNull().default(true),
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
});

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
});

export const ordersTable = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id),
  status: orderStatusEnum("status").notNull().default("pending"),
  total: integer("total").notNull(),
  shippingName: text("shipping_name").notNull(),
  shippingAddress: text("shipping_address").notNull(),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderItemsTable = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => productsTable.id),
  productName: text("product_name").notNull(),
  quantity: integer("quantity").notNull(),
  price: integer("price").notNull(),
});