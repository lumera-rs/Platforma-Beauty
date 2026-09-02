import {
  boolean,
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
import { usersTable } from "./core";

export const systemPushDeliveryStatusEnum = pgEnum("system_push_delivery_status", [
  "queued",
  "processing",
  "sent",
  "failed",
]);

export type SystemPushPayload = {
  title: string;
  body: string;
  deepLink: string | null;
  tag: string;
  data?: Record<string, unknown>;
};

export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  enabled: boolean("enabled").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  disabledReason: text("disabled_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint),
  index("push_subscriptions_user_enabled_idx").on(table.userId, table.enabled),
]);

export const systemPushDeliveriesTable = pgTable("system_push_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventKey: text("event_key").notNull(),
  subscriptionId: uuid("subscription_id").notNull().references(() => pushSubscriptionsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  payload: jsonb("payload").$type<SystemPushPayload>().notNull(),
  status: systemPushDeliveryStatusEnum("status").notNull().default("queued"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  claimToken: text("claim_token"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastHttpStatus: integer("last_http_status"),
  lastError: text("last_error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("system_push_deliveries_event_subscription_unique").on(table.eventKey, table.subscriptionId),
  index("system_push_deliveries_subscription_idx").on(table.subscriptionId),
  index("system_push_deliveries_ready_idx").on(table.status, table.nextAttemptAt),
  index("system_push_deliveries_claim_expiry_idx").on(table.claimExpiresAt),
  index("system_push_deliveries_user_idx").on(table.userId),
]);