import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./core";

export const customerPasswordSetupTokensTable = pgTable("customer_password_setup_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  issuedByUserId: uuid("issued_by_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("customer_password_setup_tokens_hash_unique").on(table.tokenHash),
  uniqueIndex("customer_password_setup_tokens_one_active_user")
    .on(table.userId)
    .where(sql`${table.consumedAt} is null and ${table.invalidatedAt} is null`),
  index("customer_password_setup_tokens_user_created_idx").on(table.userId, table.createdAt),
  index("customer_password_setup_tokens_issuer_created_idx").on(table.issuedByUserId, table.createdAt),
  index("customer_password_setup_tokens_expiry_idx").on(table.expiresAt),
  check("customer_password_setup_tokens_attempts_check", sql`${table.failedAttempts} >= 0 and ${table.maxAttempts} between 1 and 10`),
]);

export const customerPasswordSetupAuditsTable = pgTable("customer_password_setup_audits", {
  id: uuid("id").defaultRandom().primaryKey(),
  administratorUserId: uuid("administrator_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  targetUserId: uuid("target_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("customer_password_setup_audits_target_created_idx").on(table.targetUserId, table.createdAt),
  index("customer_password_setup_audits_admin_created_idx").on(table.administratorUserId, table.createdAt),
  check("customer_password_setup_audits_action_check", sql`${table.action} in ('CUSTOMER_CREATED', 'PASSWORD_SET')`),
]);

export const customerPasswordSetupRateLimitsTable = pgTable("customer_password_setup_rate_limits", {
  keyHash: text("key_hash").notNull(),
  action: text("action").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  requestCount: integer("request_count").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("customer_password_setup_rate_limits_key_action_unique").on(table.keyHash, table.action),
  index("customer_password_setup_rate_limits_updated_idx").on(table.updatedAt),
  check("customer_password_setup_rate_limits_count_check", sql`${table.requestCount} > 0`),
]);