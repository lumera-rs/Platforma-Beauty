import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./core";
import { mediaAssetsTable } from "./media";
import { productsTable, retailOrderItemsTable } from "./commerce";

/** B2C review domain. This is deliberately separate from salon-owned B2B reviews. */
export const retailReviewModerationStatusEnum = pgEnum("retail_review_moderation_status", [
  "PUBLISHED", "REPORTED", "AUTO_FLAGGED", "REMOVED",
]);
export const retailReviewReportReasonEnum = pgEnum("retail_review_report_reason", [
  "SPAM", "ABUSE", "HATE", "PERSONAL_INFORMATION", "MISLEADING", "OTHER",
]);
export const retailReviewModerationActionEnum = pgEnum("retail_review_moderation_action", [
  "KEEP", "DISMISS_REPORTS", "REMOVE", "RESTORE",
]);

export const retailProductReviewsTable = pgTable("retail_product_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  /** Immutable qualifying retail line; eligibility must never use mutable catalog data. */
  orderItemId: uuid("order_item_id").notNull().references(() => retailOrderItemsTable.id, { onDelete: "restrict" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull(),
  moderationStatus: retailReviewModerationStatusEnum("moderation_status").notNull().default("PUBLISHED"),
  moderationReason: text("moderation_reason"),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // The product/user invariant is the public "one active review" invariant.
  uniqueIndex("retail_product_reviews_product_user_active_unique").on(table.productId, table.userId)
    .where(sql`${table.moderationStatus} <> 'REMOVED'`),
  index("retail_product_reviews_product_status_created_idx").on(table.productId, table.moderationStatus, table.createdAt),
  index("retail_product_reviews_user_idx").on(table.userId),
  index("retail_product_reviews_order_item_idx").on(table.orderItemId),
  check("retail_product_reviews_rating_check", sql`${table.rating} BETWEEN 1 AND 5`),
]);

export const retailProductReviewAttachmentsTable = pgTable("retail_product_review_attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  reviewId: uuid("review_id").notNull().references(() => retailProductReviewsTable.id, { onDelete: "cascade" }),
  mediaAssetId: uuid("media_asset_id").notNull().references(() => mediaAssetsTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("retail_product_review_attachments_asset_unique").on(table.mediaAssetId),
  index("retail_product_review_attachments_review_idx").on(table.reviewId),
]);

export const retailProductReviewReportsTable = pgTable("retail_product_review_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  reviewId: uuid("review_id").notNull().references(() => retailProductReviewsTable.id, { onDelete: "cascade" }),
  reporterUserId: uuid("reporter_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  reason: retailReviewReportReasonEnum("reason").notNull(),
  explanation: text("explanation"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("retail_review_reports_review_reporter_unique").on(table.reviewId, table.reporterUserId),
  index("retail_review_reports_review_created_idx").on(table.reviewId, table.createdAt),
  index("retail_review_reports_reporter_idx").on(table.reporterUserId),
]);

/** Append-only audit trail for every administrator moderation decision. */
export const retailProductReviewModerationAuditsTable = pgTable("retail_product_review_moderation_audits", {
  id: uuid("id").defaultRandom().primaryKey(),
  reviewId: uuid("review_id").notNull().references(() => retailProductReviewsTable.id, { onDelete: "cascade" }),
  moderatorUserId: uuid("moderator_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  action: retailReviewModerationActionEnum("action").notNull(),
  previousStatus: retailReviewModerationStatusEnum("previous_status"),
  nextStatus: retailReviewModerationStatusEnum("next_status").notNull(),
  reason: text("reason"),
  internalNote: text("internal_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("retail_review_moderation_audits_review_created_idx").on(table.reviewId, table.createdAt),
  index("retail_review_moderation_audits_moderator_created_idx").on(table.moderatorUserId, table.createdAt),
]);