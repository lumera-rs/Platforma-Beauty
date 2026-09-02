import {
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
import {
  deliveryMethodEnum,
  paymentMethodEnum,
  productsTable,
  retailOrdersTable,
} from "./commerce";
import { usersTable } from "./core";

/** Customer physical-product replenishment cadence; unrelated to salon plans. */
export const retailSubscriptionFrequencyEnum = pgEnum("retail_subscription_frequency", [
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "EVERY_TWO_MONTHS",
]);

export const retailSubscriptionStatusEnum = pgEnum("retail_subscription_status", [
  "ACTIVE",
  "PAUSED",
  "CANCELLED",
]);

/** A durable result for one logical due cycle, including bounded stock retries. */
export const retailSubscriptionAttemptStatusEnum = pgEnum("retail_subscription_attempt_status", [
  "PROCESSING",
  "CREATED",
  "INSUFFICIENT_STOCK",
  "SKIPPED",
]);

export const retailProductSubscriptionsTable = pgTable("retail_product_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  frequency: retailSubscriptionFrequencyEnum("frequency").notNull(),
  status: retailSubscriptionStatusEnum("status").notNull().default("ACTIVE"),
  /** Agreed at creation; price is always recalculated from current public base. */
  discountPercentSnapshot: integer("discount_percent_snapshot").notNull(),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  deliveryMethod: deliveryMethodEnum("delivery_method").notNull(),
  contactSnapshot: jsonb("contact_snapshot").$type<Record<string, string>>().notNull(),
  deliverySnapshot: jsonb("delivery_snapshot").$type<Record<string, unknown>>().notNull(),
  /** Original day-of-month, retained when a shorter month temporarily clamps it. */
  anchorDay: integer("anchor_day").notNull(),
  nextDueAt: timestamp("next_due_at", { withTimezone: true }).notNull(),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("retail_product_subscriptions_user_created_idx").on(table.userId, table.createdAt),
  index("retail_product_subscriptions_product_idx").on(table.productId),
  // The worker's due scan always begins with status and time.
  index("retail_product_subscriptions_due_claim_idx").on(table.status, table.nextDueAt),
  check("retail_product_subscriptions_quantity_check", sql`${table.quantity} > 0`),
  check("retail_product_subscriptions_anchor_day_check", sql`${table.anchorDay} BETWEEN 1 AND 31`),
  check("retail_product_subscriptions_discount_percent_check", sql`${table.discountPercentSnapshot} BETWEEN 0 AND 100`),
]);

export const retailProductSubscriptionAttemptsTable = pgTable("retail_product_subscription_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  subscriptionId: uuid("subscription_id").notNull()
    .references(() => retailProductSubscriptionsTable.id, { onDelete: "cascade" }),
  /** The unmodified scheduled instant: unique idempotency key for this cycle. */
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  status: retailSubscriptionAttemptStatusEnum("status").notNull().default("PROCESSING"),
  retryCount: integer("retry_count").notNull().default(0),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  claimToken: uuid("claim_token").notNull(),
  orderId: uuid("order_id").references(() => retailOrdersTable.id, { onDelete: "restrict" }),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("retail_subscription_attempts_subscription_due_unique").on(table.subscriptionId, table.dueAt),
  index("retail_subscription_attempts_order_idx").on(table.orderId),
  index("retail_subscription_attempts_status_claimed_idx").on(table.status, table.claimedAt),
  check("retail_subscription_attempts_retry_count_check", sql`${table.retryCount} >= 0`),
]);