import {
  boolean, check, index, integer, jsonb, pgTable, text, timestamp,
  uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { employeesTable, salonsTable, usersTable } from "./core";
import {
  approvalRequestStatusEnum, commerceAudienceEnum, couponDiscountTypeEnum,
  ordersTable, productBundlesTable, productCategoriesTable, productsTable,
  retailOrdersTable, shoppingCartsTable,
} from "./commerce";

/** Platform-admin managed, normalized-code promotion policy. */
export const couponsTable = pgTable("coupons", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  active: boolean("active").notNull().default(true),
  audience: commerceAudienceEnum("audience"),
  discountType: couponDiscountTypeEnum("discount_type").notNull(),
  discountValue: integer("discount_value").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  minimumSpendRsd: integer("minimum_spend_rsd").notNull().default(0),
  maximumSpendRsd: integer("maximum_spend_rsd"),
  freeShipping: boolean("free_shipping").notNull().default(false),
  includeProductIds: jsonb("include_product_ids").$type<string[]>().notNull().default([]),
  excludeProductIds: jsonb("exclude_product_ids").$type<string[]>().notNull().default([]),
  includeCategoryIds: jsonb("include_category_ids").$type<string[]>().notNull().default([]),
  excludeCategoryIds: jsonb("exclude_category_ids").$type<string[]>().notNull().default([]),
  includeBundleIds: jsonb("include_bundle_ids").$type<string[]>().notNull().default([]),
  excludeBundleIds: jsonb("exclude_bundle_ids").$type<string[]>().notNull().default([]),
  usageLimit: integer("usage_limit"),
  perCustomerUsageLimit: integer("per_customer_usage_limit"),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("coupons_active_dates_idx").on(table.active, table.startsAt, table.endsAt),
  check("coupons_discount_check", sql`(${table.discountType} = 'PERCENTAGE' AND ${table.discountValue} BETWEEN 1 AND 100) OR (${table.discountType} = 'FIXED_RSD' AND ${table.discountValue} > 0)`),
  check("coupons_spend_check", sql`${table.minimumSpendRsd} >= 0 AND (${table.maximumSpendRsd} IS NULL OR ${table.maximumSpendRsd} >= ${table.minimumSpendRsd})`),
  check("coupons_dates_check", sql`${table.endsAt} IS NULL OR ${table.startsAt} IS NULL OR ${table.endsAt} > ${table.startsAt}`),
  check("coupons_limits_check", sql`(${table.usageLimit} IS NULL OR ${table.usageLimit} > 0) AND (${table.perCustomerUsageLimit} IS NULL OR ${table.perCustomerUsageLimit} > 0)`),
]);

/** Immutable, idempotent use evidence; cancelledAt releases the use exactly once. */
export const couponRedemptionsTable = pgTable("coupon_redemptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  couponId: uuid("coupon_id").notNull().references(() => couponsTable.id, { onDelete: "restrict" }),
  audience: commerceAudienceEnum("audience").notNull(),
  orderId: uuid("order_id").references(() => ordersTable.id, { onDelete: "restrict" }),
  retailOrderId: uuid("retail_order_id").references(() => retailOrdersTable.id, { onDelete: "restrict" }),
  salonId: uuid("salon_id").references(() => salonsTable.id, { onDelete: "restrict" }),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "restrict" }),
  guestEmailNormalized: text("guest_email_normalized"),
  codeSnapshot: text("code_snapshot").notNull(),
  discountRsd: integer("discount_rsd").notNull().default(0),
  freeShipping: boolean("free_shipping").notNull().default(false),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("coupon_redemptions_order_unique").on(table.orderId).where(sql`${table.orderId} IS NOT NULL`),
  uniqueIndex("coupon_redemptions_retail_order_unique").on(table.retailOrderId).where(sql`${table.retailOrderId} IS NOT NULL`),
  index("coupon_redemptions_coupon_customer_idx").on(table.couponId, table.userId, table.salonId),
  check("coupon_redemptions_order_check", sql`num_nonnulls(${table.orderId}, ${table.retailOrderId}) = 1`),
  check("coupon_redemptions_customer_check", sql`num_nonnulls(${table.salonId}, ${table.userId}, ${table.guestEmailNormalized}) = 1`),
]);

export const b2bInvoiceSequencesTable = pgTable("b2b_invoice_sequences", {
  year: integer("year").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("b2b_invoice_sequences_number_check", sql`${table.lastNumber} >= 0`)]);

/** Pending requests are commercial snapshots only and have no stock/ledger effect. */
export const orderApprovalRequestsTable = pgTable("order_approval_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "restrict" }),
  employeeId: uuid("employee_id").notNull().references(() => employeesTable.id, { onDelete: "restrict" }),
  submittedByUserId: uuid("submitted_by_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  cartId: uuid("cart_id").notNull().references(() => shoppingCartsTable.id, { onDelete: "restrict" }),
  status: approvalRequestStatusEnum("status").notNull().default("PENDING"),
  idempotencyKey: text("idempotency_key").notNull(),
  quoteVersion: text("quote_version").notNull(),
  quoteSnapshot: jsonb("quote_snapshot").$type<Record<string, unknown>>().notNull(),
  couponCode: text("coupon_code"),
  referralCreditIntentRsd: integer("referral_credit_intent_rsd").notNull().default(0),
  reviewerUserId: uuid("reviewer_user_id").references(() => usersTable.id, { onDelete: "restrict" }),
  reviewerReason: text("reviewer_reason"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  finalizedOrderId: uuid("finalized_order_id").references(() => ordersTable.id, { onDelete: "restrict" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("order_approval_requests_salon_key_unique").on(table.salonId, table.idempotencyKey),
  index("order_approval_requests_salon_status_created_idx").on(table.salonId, table.status, table.createdAt),
  index("order_approval_requests_employee_created_idx").on(table.employeeId, table.createdAt),
  uniqueIndex("order_approval_requests_finalized_order_unique").on(table.finalizedOrderId).where(sql`${table.finalizedOrderId} IS NOT NULL`),
]);

export const orderApprovalRequestLinesTable = pgTable("order_approval_request_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: uuid("request_id").notNull().references(() => orderApprovalRequestsTable.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => productsTable.id, { onDelete: "restrict" }),
  bundleId: uuid("bundle_id").references(() => productBundlesTable.id, { onDelete: "restrict" }),
  productName: text("product_name").notNull(),
  productSkuSnapshot: text("product_sku_snapshot"),
  quantity: integer("quantity").notNull(),
  catalogSnapshot: jsonb("catalog_snapshot").$type<Record<string, unknown>>().notNull(),
}, (table) => [
  index("order_approval_request_lines_request_idx").on(table.requestId),
  check("order_approval_request_lines_target_check", sql`num_nonnulls(${table.productId}, ${table.bundleId}) = 1`),
  check("order_approval_request_lines_quantity_check", sql`${table.quantity} > 0`),
]);