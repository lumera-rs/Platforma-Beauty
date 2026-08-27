import {
  boolean, check, index, integer, jsonb, pgTable, text, timestamp,
  uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { mediaAssetsTable } from "./media";
import { salonsTable, usersTable } from "./core";
import {
  catalogSyncStatusEnum, orderItemsTable, ordersTable, priceInquiryStatusEnum,
  productsTable, retailOrderItemsTable, retailOrdersTable, rmaStatusEnum, shoppingCartsTable, suppliersTable,
} from "./commerce";

export type QuoteSellerSnapshot = {
  companyName: string; taxId?: string; registrationNumber?: string; address?: string;
  city?: string; postalCode?: string; bankAccount?: string; email?: string; phone?: string;
};
export type QuoteItemSnapshot = {
  productId: string | null; bundleId: string | null; productName: string; productImageUrl: string;
  variantValue: string | null; variantLabel: string | null; productSku: string | null;
  unitPrice: number; quantity: number; lineTotal: number;
};

/** Immutable B2B commercial evidence. Rendering must use snapshots, never catalog joins. */
export const b2bQuotesTable = pgTable("b2b_quotes", {
  id: uuid("id").defaultRandom().primaryKey(),
  publicId: text("public_id").notNull(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "restrict" }),
  sourceCartId: uuid("source_cart_id").references(() => shoppingCartsTable.id, { onDelete: "set null" }),
  customerCompanyName: text("customer_company_name"),
  sellerSnapshot: jsonb("seller_snapshot").$type<QuoteSellerSnapshot>().notNull(),
  itemSnapshots: jsonb("item_snapshots").$type<QuoteItemSnapshot[]>().notNull(),
  subtotalWithoutVat: integer("subtotal_without_vat").notNull(),
  vatAmount: integer("vat_amount").notNull(),
  totalWithVat: integer("total_with_vat").notNull(),
  currency: text("currency").notNull().default("RSD"),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("b2b_quotes_public_id_unique").on(t.publicId),
  index("b2b_quotes_salon_created_idx").on(t.salonId, t.createdAt),
  check("b2b_quotes_totals_check", sql`${t.subtotalWithoutVat} >= 0 AND ${t.vatAmount} >= 0 AND ${t.totalWithVat} = ${t.subtotalWithoutVat} + ${t.vatAmount}`),
]);

export const priceInquiriesTable = pgTable("price_inquiries", {
  id: uuid("id").defaultRandom().primaryKey(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "restrict" }),
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(), email: text("email").notNull(), phone: text("phone").notNull(),
  message: text("message").notNull(), status: priceInquiryStatusEnum("status").notNull().default("NEW"),
  internalNote: text("internal_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("price_inquiries_status_created_idx").on(t.status, t.createdAt),
  index("price_inquiries_product_created_idx").on(t.productId, t.createdAt),
]);

export const rmasTable = pgTable("rmas", {
  id: uuid("id").defaultRandom().primaryKey(),
  rmaNumber: text("rma_number").notNull(),
  orderId: uuid("order_id").references(() => ordersTable.id, { onDelete: "restrict" }),
  orderItemId: uuid("order_item_id").references(() => orderItemsTable.id, { onDelete: "restrict" }),
  retailOrderId: uuid("retail_order_id").references(() => retailOrdersTable.id, { onDelete: "restrict" }),
  retailOrderItemId: uuid("retail_order_item_id").references(() => retailOrderItemsTable.id, { onDelete: "restrict" }),
  requesterUserId: uuid("requester_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(), reason: text("reason").notNull(), description: text("description").notNull(),
  status: rmaStatusEnum("status").notNull().default("RECEIVED"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("rmas_number_unique").on(t.rmaNumber),
  index("rmas_order_created_idx").on(t.orderId, t.createdAt),
  index("rmas_retail_order_created_idx").on(t.retailOrderId, t.createdAt),
  index("rmas_status_created_idx").on(t.status, t.createdAt),
  check("rmas_quantity_check", sql`${t.quantity} > 0`),
  check("rmas_target_check", sql`num_nonnulls(${t.orderId}, ${t.retailOrderId}) = 1 AND num_nonnulls(${t.orderItemId}, ${t.retailOrderItemId}) = 1`),
]);

export const rmaAttachmentsTable = pgTable("rma_attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  rmaId: uuid("rma_id").notNull().references(() => rmasTable.id, { onDelete: "cascade" }),
  mediaAssetId: uuid("media_asset_id").notNull().references(() => mediaAssetsTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("rma_attachments_asset_unique").on(t.mediaAssetId), index("rma_attachments_rma_idx").on(t.rmaId)]);

export const rmaStatusHistoryTable = pgTable("rma_status_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  rmaId: uuid("rma_id").notNull().references(() => rmasTable.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  previousStatus: rmaStatusEnum("previous_status"), nextStatus: rmaStatusEnum("next_status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("rma_status_history_rma_created_idx").on(t.rmaId, t.createdAt)]);

/** The unique order key is the concurrency fence: only one reward can ever be issued. */
export const reviewRewardIssuancesTable = pgTable("review_reward_issuances", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => retailOrdersTable.id, { onDelete: "restrict" }),
  reviewId: uuid("review_id").notNull(),
  couponId: uuid("coupon_id").notNull(),
  percentSnapshot: integer("percent_snapshot").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("review_reward_issuances_order_unique").on(t.orderId),
  uniqueIndex("review_reward_issuances_review_unique").on(t.reviewId),
  check("review_reward_percent_check", sql`${t.percentSnapshot} BETWEEN 1 AND 100`),
]);

export const catalogSyncRunsTable = pgTable("catalog_sync_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: text("provider").notNull().default("META"),
  status: catalogSyncStatusEnum("status").notNull().default("NOT_CONNECTED"),
  itemCount: integer("item_count").notNull().default(0),
  validationErrors: jsonb("validation_errors").$type<string[]>().notNull().default([]),
  requestedByUserId: uuid("requested_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("catalog_sync_runs_provider_created_idx").on(t.provider, t.createdAt)]);