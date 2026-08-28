import {
  boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp,
  uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appointmentsTable, usersTable } from "./core";
import {
  productsTable, productBundlesTable, retailOrdersTable, treatmentTaxonomyTable,
} from "./commerce";

export const aftercareFirstTimingEnum = pgEnum("aftercare_first_timing", [
  "IMMEDIATE_AFTER_COMPLETION", "NEXT_DAY",
]);
export const aftercareRecommendationStatusEnum = pgEnum("aftercare_recommendation_status", [
  "PENDING", "ACTIVE", "CONVERTED", "EXPIRED", "CANCELLED",
]);
export const aftercareLineKindEnum = pgEnum("aftercare_line_kind", [
  "PRODUCT", "PREMADE_BUNDLE", "PERSONALIZED_BUNDLE",
]);
export const aftercareDeliveryKindEnum = pgEnum("aftercare_delivery_kind", [
  "FIRST", "SECOND", "REPLENISHMENT",
]);
export const aftercareDeliveryStatusEnum = pgEnum("aftercare_delivery_status", [
  "QUEUED", "PROCESSING", "SENT", "FAILED", "SKIPPED",
]);

/** Append-only versions; exactly one row is current. */
export const aftercareSettingsTable = pgTable("aftercare_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  version: integer("version").notNull(),
  isCurrent: boolean("is_current").notNull().default(true),
  firstTiming: aftercareFirstTimingEnum("first_timing").notNull().default("IMMEDIATE_AFTER_COMPLETION"),
  cooldownDays: integer("cooldown_days").notNull().default(30),
  secondReminderDelayDays: integer("second_reminder_delay_days").notNull().default(6),
  postTreatmentDiscountEnabled: boolean("post_treatment_discount_enabled").notNull().default(false),
  postTreatmentDiscountPercent: integer("post_treatment_discount_percent").notNull().default(0),
  postTreatmentDiscountValidityDays: integer("post_treatment_discount_validity_days").notNull().default(30),
  personalizedBundleDiscountPercent: integer("personalized_bundle_discount_percent").notNull().default(10),
  combinationWindowDays: integer("combination_window_days").notNull().default(30),
  createdByUserId: uuid("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aftercare_settings_version_unique").on(table.version),
  uniqueIndex("aftercare_settings_current_unique").on(table.isCurrent).where(sql`${table.isCurrent}`),
  index("aftercare_settings_created_by_user_idx").on(table.createdByUserId),
  check("aftercare_settings_positive_days_check", sql`${table.cooldownDays} > 0 AND ${table.secondReminderDelayDays} > 0 AND ${table.postTreatmentDiscountValidityDays} > 0 AND ${table.combinationWindowDays} > 0`),
  check("aftercare_settings_percent_check", sql`${table.postTreatmentDiscountPercent} BETWEEN 0 AND 100 AND ${table.personalizedBundleDiscountPercent} BETWEEN 1 AND 100`),
  check("aftercare_settings_discount_enabled_check", sql`NOT ${table.postTreatmentDiscountEnabled} OR ${table.postTreatmentDiscountPercent} > 0`),
]);

/** Durable platform-only wakeup. Never references salon notification tables. */
export const aftercareCompletionEventsTable = pgTable("aftercare_completion_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  appointmentId: uuid("appointment_id").notNull().references(() => appointmentsTable.id, { onDelete: "cascade" }),
  customerUserId: uuid("customer_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  transitionKey: text("transition_key").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  claimToken: text("claim_token"),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aftercare_completion_events_transition_unique").on(table.appointmentId, table.transitionKey),
  index("aftercare_completion_events_customer_user_idx").on(table.customerUserId),
  index("aftercare_completion_events_due_idx").on(table.processedAt, table.availableAt, table.claimExpiresAt),
  check("aftercare_completion_events_attempts_check", sql`${table.attempts} >= 0`),
]);

export const aftercareRecommendationsTable = pgTable("aftercare_recommendations", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerUserId: uuid("customer_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  settingsVersion: integer("settings_version").notNull(),
  status: aftercareRecommendationStatusEnum("status").notNull().default("PENDING"),
  entitlementTokenHash: text("entitlement_token_hash").notNull().unique(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  windowEndsAt: timestamp("window_ends_at", { withTimezone: true }).notNull(),
  activatesAt: timestamp("activates_at", { withTimezone: true }).notNull(),
  entitlementExpiresAt: timestamp("entitlement_expires_at", { withTimezone: true }).notNull(),
  settingsSnapshot: jsonb("settings_snapshot").$type<Record<string, unknown>>().notNull(),
  treatmentSnapshot: jsonb("treatment_snapshot").$type<Array<{ id: string; key: string; category: string; name: string }>>().notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  firstSentAt: timestamp("first_sent_at", { withTimezone: true }),
  secondSentAt: timestamp("second_sent_at", { withTimezone: true }),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  convertedOrderId: uuid("converted_order_id").references(() => retailOrdersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("aftercare_recommendations_customer_created_idx").on(table.customerUserId, table.createdAt),
  index("aftercare_recommendations_stats_idx").on(table.createdAt, table.status, table.convertedAt),
  index("aftercare_recommendations_conversion_order_idx").on(table.convertedOrderId),
  check("aftercare_recommendations_window_check", sql`${table.windowEndsAt} > ${table.windowStartedAt} AND ${table.entitlementExpiresAt} > ${table.activatesAt}`),
]);

export const aftercareRecommendationAppointmentsTable = pgTable("aftercare_recommendation_appointments", {
  recommendationId: uuid("recommendation_id").notNull().references(() => aftercareRecommendationsTable.id, { onDelete: "cascade" }),
  appointmentId: uuid("appointment_id").notNull().references(() => appointmentsTable.id, { onDelete: "restrict" }),
  treatmentId: uuid("treatment_id").notNull().references(() => treatmentTaxonomyTable.id, { onDelete: "restrict" }),
  appointmentSnapshot: jsonb("appointment_snapshot").$type<Record<string, unknown>>().notNull(),
}, (table) => [
  uniqueIndex("aftercare_recommendation_appointments_appointment_unique").on(table.appointmentId),
  index("aftercare_recommendation_appointments_recommendation_idx").on(table.recommendationId),
  index("aftercare_recommendation_appointments_treatment_idx").on(table.treatmentId),
]);

export const aftercareRecommendationLinesTable = pgTable("aftercare_recommendation_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  recommendationId: uuid("recommendation_id").notNull().references(() => aftercareRecommendationsTable.id, { onDelete: "cascade" }),
  kind: aftercareLineKindEnum("kind").notNull(),
  productId: uuid("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  bundleId: uuid("bundle_id").references(() => productBundlesTable.id, { onDelete: "set null" }),
  treatmentIds: jsonb("treatment_ids").$type<string[]>().notNull(),
  coveredProductIds: jsonb("covered_product_ids").$type<string[]>().notNull(),
  catalogSnapshot: jsonb("catalog_snapshot").$type<Record<string, unknown>>().notNull(),
  pricingSnapshot: jsonb("pricing_snapshot").$type<Record<string, unknown>>().notNull(),
  discountKind: text("discount_kind").notNull(),
  discountPercent: integer("discount_percent").notNull(),
  discountAllocationSnapshot: jsonb("discount_allocation_snapshot").$type<Record<string, number>>().notNull().default({}),
  replenishmentDueAt: timestamp("replenishment_due_at", { withTimezone: true }),
  replenishmentSentAt: timestamp("replenishment_sent_at", { withTimezone: true }),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }),
  purchasedOrderId: uuid("purchased_order_id").references(() => retailOrdersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aftercare_recommendation_lines_product_unique").on(table.recommendationId, table.productId)
    .where(sql`${table.kind} = 'PRODUCT'`),
  uniqueIndex("aftercare_recommendation_lines_bundle_unique").on(table.recommendationId, table.bundleId)
    .where(sql`${table.kind} = 'PREMADE_BUNDLE'`),
  uniqueIndex("aftercare_recommendation_lines_personalized_unique").on(table.recommendationId)
    .where(sql`${table.kind} = 'PERSONALIZED_BUNDLE'`),
  index("aftercare_recommendation_lines_product_cooldown_idx").on(table.productId, table.purchasedAt),
  index("aftercare_recommendation_lines_bundle_idx").on(table.bundleId),
  index("aftercare_recommendation_lines_purchased_order_idx").on(table.purchasedOrderId),
  index("aftercare_recommendation_lines_replenishment_idx").on(table.replenishmentSentAt, table.replenishmentDueAt),
  index("aftercare_recommendation_lines_stats_idx").on(table.productId, table.createdAt),
  check("aftercare_recommendation_lines_shape_check", sql`
    (${table.kind} = 'PRODUCT' AND ${table.productId} IS NOT NULL AND ${table.bundleId} IS NULL)
    OR (${table.kind} = 'PREMADE_BUNDLE' AND ${table.productId} IS NULL AND ${table.bundleId} IS NOT NULL)
    OR (${table.kind} = 'PERSONALIZED_BUNDLE' AND ${table.productId} IS NULL AND ${table.bundleId} IS NULL)
  `),
  check("aftercare_recommendation_lines_discount_check", sql`${table.discountPercent} BETWEEN 0 AND 100`),
  check("aftercare_recommendation_lines_coverage_check", sql`jsonb_array_length(${table.treatmentIds}) > 0 AND jsonb_array_length(${table.coveredProductIds}) > 0`),
]);

export const aftercareDeliveriesTable = pgTable("aftercare_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  recommendationId: uuid("recommendation_id").notNull().references(() => aftercareRecommendationsTable.id, { onDelete: "cascade" }),
  lineId: uuid("line_id").references(() => aftercareRecommendationLinesTable.id, { onDelete: "cascade" }),
  kind: aftercareDeliveryKindEnum("kind").notNull(),
  status: aftercareDeliveryStatusEnum("status").notNull().default("QUEUED"),
  eventKey: text("event_key").notNull().unique(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  claimToken: text("claim_token"),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  providerMessageId: text("provider_message_id"),
  providerStatus: text("provider_status"),
  providerEventAt: timestamp("provider_event_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  lastError: text("last_error"),
  payloadSnapshot: jsonb("payload_snapshot").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aftercare_deliveries_campaign_kind_unique").on(table.recommendationId, table.kind)
    .where(sql`${table.lineId} IS NULL`),
  uniqueIndex("aftercare_deliveries_line_kind_unique").on(table.recommendationId, table.lineId, table.kind)
    .where(sql`${table.lineId} IS NOT NULL`),
  index("aftercare_deliveries_line_idx").on(table.lineId),
  index("aftercare_deliveries_due_claim_idx").on(table.status, table.scheduledAt, table.claimExpiresAt),
  index("aftercare_deliveries_provider_idx").on(table.providerMessageId),
  check("aftercare_deliveries_attempts_check", sql`${table.attempts} >= 0`),
  check("aftercare_deliveries_replenishment_line_check", sql`${table.kind} <> 'REPLENISHMENT' OR ${table.lineId} IS NOT NULL`),
]);