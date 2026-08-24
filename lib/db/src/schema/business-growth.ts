import {
  boolean,
  date,
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
import { salonsTable, employeesTable, servicesTable, appointmentsTable, salonCustomersTable, usersTable, reviewsTable } from "./core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const automationTriggerEnum = pgEnum("automation_trigger", [
  "inactive_days",
  "birthday",
  "visit_count",
  "first_visit_completed",
  "package_completed",
  "appointment_cancelled",
  "expected_return_overdue",
]);

export const automationActionEnum = pgEnum("automation_action", [
  "send_email",
  "send_sms",
  "send_email_and_sms",
]);

export const automationStatusEnum = pgEnum("automation_status", [
  "active",
  "paused",
  "draft",
]);

export const automationRunStatusEnum = pgEnum("automation_run_status", [
  "pending",
  "sent",
  "skipped",
  "failed",
]);

export const customerRetentionStatusEnum = pgEnum("customer_retention_status", [
  "NEW",
  "ACTIVE",
  "VIP",
  "AT_RISK",
  "LOST",
]);

export const packagePurchaseStatusEnum = pgEnum("package_purchase_status", [
  "pending_payment",
  "active",
  "completed",
  "expired",
  "cancelled",
]);

export const packageRedemptionStatusEnum = pgEnum("package_redemption_status", [
  "redeemed",
  "reversed",
]);

export const commissionTypeEnum = pgEnum("commission_type", [
  "percent_of_revenue",
  "fixed_per_treatment",
]);

export const packagePaymentMethodEnum = pgEnum("package_payment_method", [
  "pay_at_salon",
  "bank_transfer",
]);

export const platformRetentionSettingsTable = pgTable("platform_retention_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Monotonically increasing version; highest version is the active one. */
  version: integer("version").notNull(),
  /** A single completed visit within this many days still counts as NEW. */
  newCustomerWindowDays: integer("new_customer_window_days").notNull(),
  /** Assumed visit interval (days) when a customer has < 2 completed visits. */
  defaultIntervalDays: integer("default_interval_days").notNull(),
  /** AT_RISK when overdue beyond typicalInterval × this percent (150 = 1.5×). */
  atRiskIntervalPercent: integer("at_risk_interval_percent").notNull(),
  /** LOST when overdue beyond typicalInterval × this percent (250 = 2.5×). */
  lostIntervalPercent: integer("lost_interval_percent").notNull(),
  /** LOST never triggers before this many days since the last visit. */
  lostMinimumDays: integer("lost_minimum_days").notNull(),
  /** VIP when the customer has at least this many completed visits. */
  vipMinCompletedVisits: integer("vip_min_completed_visits").notNull(),
  /** VIP when total spend exceeds salon median × this percent (200 = 2×). */
  vipSpendPercentOfMedian: integer("vip_spend_percent_of_median").notNull(),
  changedByUserId: uuid("changed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  /** How the version came to be: 'manual' | 'restore_version' | 'restore_defaults'. */
  changeSource: text("change_source").notNull().default("manual"),
  /** Version whose values were restored; only set when changeSource = 'restore_version'. */
  restoredFromVersion: integer("restored_from_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  /** One row per version; concurrent updates serialize on this constraint. */
  uniqueIndex("platform_retention_settings_version_unique").on(table.version),
  /** Leading FK coverage: changedByUserId (audit by changing admin). */
  index("platform_retention_settings_changed_by_idx").on(table.changedByUserId),
]);
export const automationRulesTable = pgTable("automation_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  trigger: automationTriggerEnum("trigger").notNull(),
  /** Trigger-specific config: e.g. { inactiveDays: 30 } or { visitCount: 5 } */
  triggerConfig: jsonb("trigger_config").$type<Record<string, unknown>>().notNull().default({}),
  action: automationActionEnum("action").notNull(),
  emailSubject: text("email_subject"),
  /** Supports {{firstName}}, {{lastName}}, {{salonName}}, {{voucherCode}} placeholders */
  emailBody: text("email_body"),
  /** Supports {{firstName}}, {{lastName}}, {{salonName}}, {{voucherCode}} placeholders */
  smsBody: text("sms_body"),
  /** Optional discount/voucher code the owner defines; substituted into templates */
  voucherCode: text("voucher_code"),
  status: automationStatusEnum("status").notNull().default("draft"),
  /** Created from an AI proposal; starts paused until owner explicitly activates */
  aiProposed: boolean("ai_proposed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("automation_rules_salon_status_idx").on(table.salonId, table.status),
]);

// ---------------------------------------------------------------------------
// Automation runs (per-customer evaluation records)
// ---------------------------------------------------------------------------

export const automationRunsTable = pgTable("automation_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Idempotency key: unique per rule+customer+epoch; prevents duplicate sends */
  eventKey: text("event_key").notNull().unique(),
  ruleId: uuid("rule_id").notNull().references(() => automationRulesTable.id, { onDelete: "cascade" }),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  salonCustomerId: uuid("salon_customer_id").notNull().references(() => salonCustomersTable.id, { onDelete: "cascade" }),
  status: automationRunStatusEnum("status").notNull().default("pending"),
  skipReason: text("skip_reason"),
  errorMessage: text("error_message"),
  /** Attribution: appointment created within 14 days of this run by the same customer */
  attributedAppointmentId: uuid("attributed_appointment_id").references(() => appointmentsTable.id, { onDelete: "set null" }),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  /**
   * Authoritative confirmed-send timestamp. Set ONLY when a run transitions to
   * status='sent' (at least one channel actually delivered). This is the anchor
   * for the true rolling 14-day cooldown — unlike executedAt, it is never reset
   * by a retry and never set by a skipped/failed attempt.
   */
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("automation_runs_rule_customer_idx").on(table.ruleId, table.salonCustomerId),
  index("automation_runs_salon_created_idx").on(table.salonId, table.createdAt),
  /** Attribution scan: find unattributed sent runs by salon/customer */
  index("automation_runs_attribution_idx").on(table.salonId, table.salonCustomerId, table.status),
  /** Rolling-cooldown scan: latest confirmed sent run per rule+customer. */
  index("automation_runs_cooldown_idx").on(table.ruleId, table.salonCustomerId, table.sentAt),
  /** Leading FK coverage: attributedAppointmentId (reverse lookup / cascade). */
  index("automation_runs_attributed_appointment_idx").on(table.attributedAppointmentId),
  /** Leading FK coverage: salonCustomerId (existing composite leads with ruleId/salonId). */
  index("automation_runs_salon_customer_idx").on(table.salonCustomerId),
]);

// ---------------------------------------------------------------------------
// Automation delivery tracking (email/SMS per run)
// ---------------------------------------------------------------------------

export const automationDeliveriesTable = pgTable("automation_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").notNull().references(() => automationRunsTable.id, { onDelete: "cascade" }),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  /** Idempotency: one delivery per run per channel */
  eventKey: text("event_key").notNull().unique(),
  channel: text("channel").notNull(), // "email" | "sms"
  recipientEmail: text("recipient_email"),
  recipientPhone: text("recipient_phone"),
  /**
   * queued    — inserted, not yet attempted
   * processing — claimed by a worker; terminal if claimExpiresAt has not passed
   * sent      — provider accepted the message (terminal / no resend)
   * skipped   — intentionally not sent (no address, opted out, etc.) (terminal)
   * failed    — provider error; reclaimable for retry
   */
  status: text("status").notNull().default("queued"),
  /** Set when a worker claims this delivery for sending. */
  processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
  /**
   * Lease expiry. A delivery stuck in processing past this timestamp can be
   * reclaimed by another worker (crash/restart recovery). Typically NOW + 5min.
   */
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  providerMessageId: text("provider_message_id"),
  errorMessage: text("error_message"),
  /** Populated from provider webhooks/polling when available */
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  /**
   * Provider-reported terminal delivery failure (bounce, undeliverable, …),
   * populated from verified provider webhooks. Deliberately separate from
   * `status` — webhooks must never flip `status` back to a claimable state,
   * or the automation worker could resend an already-accepted message.
   * A later delivered/opened event clears it (delivery confirmation wins).
   */
  failedAt: timestamp("failed_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("automation_deliveries_run_idx").on(table.runId),
  index("automation_deliveries_salon_created_idx").on(table.salonId, table.createdAt),
  /** Stale-claim recovery scan: find processing rows whose lease has expired */
  index("automation_deliveries_claim_expiry_idx").on(table.status, table.claimExpiresAt),
]);

/**
 * Last accepted verified webhook event and recent malformed-payload signal per
 * delivery-report provider.
 *
 * One row per provider ("brevo" | "infobip"), updated whenever a webhook
 * request passes token verification. Accepted events and rejected payloads
 * have separate fields so malformed requests never move the accepted-event
 * freshness watermark.
 * Powers the admin integrations page warning when automation messages were
 * sent recently but no delivery reports have arrived — a misconfigured or
 * disabled provider webhook otherwise fails silently (counts just stop
 * updating). Monitoring metadata only: it never influences webhook
 * authentication or delivery-state transitions.
 */
export const providerWebhookReceiptsTable = pgTable("provider_webhook_receipts", {
  /** Delivery-report provider key: "brevo" (email) or "infobip" (SMS). */
  provider: text("provider").primaryKey(),
  /** Server receipt time of the most recent accepted verified event batch. */
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  /** Number of malformed authenticated payloads in the current bounded window. */
  rejectedPayloadCount: integer("rejected_payload_count").notNull().default(0),
  /**
   * Capped server timestamps for authenticated malformed batches. This contains
   * no request data and lets monitoring count an actual rolling time window.
   */
  rejectedPayloadTimes: jsonb("rejected_payload_times").$type<string[]>().notNull().default([]),
  /** Server receipt time of the most recent malformed authenticated payload. */
  lastRejectedAt: timestamp("last_rejected_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const treatmentPackagesTable = pgTable("treatment_packages", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  priceInDinars: integer("price_in_dinars").notNull(),
  sessionCount: integer("session_count").notNull(),
  validityDays: integer("validity_days").notNull().default(365),
  /** Soft-delete: deactivated packages are hidden but purchases remain valid */
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("treatment_packages_salon_active_idx").on(table.salonId, table.active),
]);

// ---------------------------------------------------------------------------
// Package → service links (which services can be redeemed)
// ---------------------------------------------------------------------------

export const packageServiceLinksTable = pgTable("package_service_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  packageId: uuid("package_id").notNull().references(() => treatmentPackagesTable.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").notNull().references(() => servicesTable.id, { onDelete: "cascade" }),
}, (table) => [
  uniqueIndex("package_service_links_unique").on(table.packageId, table.serviceId),
  index("package_service_links_service_idx").on(table.serviceId),
]);

// ---------------------------------------------------------------------------
// Purchase-time snapshot of covered services (immutable after purchase)
//
// Package definitions may change (add/remove services) for future sales.
// Existing purchases must always redeem against the service set that was active
// when the customer bought the package. Populated transactionally at purchase
// creation; never mutated thereafter.
// ---------------------------------------------------------------------------

export const packagePurchaseServiceLinksTable = pgTable("package_purchase_service_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  purchaseId: uuid("purchase_id").notNull().references(() => customerPackagePurchasesTable.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").notNull().references(() => servicesTable.id, { onDelete: "cascade" }),
}, (table) => [
  uniqueIndex("package_purchase_service_links_unique").on(table.purchaseId, table.serviceId),
  index("package_purchase_service_links_purchase_idx").on(table.purchaseId),
  /** Leading FK coverage: serviceId (existing unique/index lead with purchaseId). */
  index("package_purchase_service_links_service_idx").on(table.serviceId),
]);

// ---------------------------------------------------------------------------
// Customer package purchases
// ---------------------------------------------------------------------------

export const customerPackagePurchasesTable = pgTable("customer_package_purchases", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  packageId: uuid("package_id").notNull().references(() => treatmentPackagesTable.id, { onDelete: "restrict" }),
  salonCustomerId: uuid("salon_customer_id").notNull().references(() => salonCustomersTable.id, { onDelete: "cascade" }),
  /** Snapshot of total sessions at purchase time */
  totalSessions: integer("total_sessions").notNull(),
  /** Remaining balance — atomically decremented on redemption, incremented on reversal */
  remainingSessions: integer("remaining_sessions").notNull(),
  priceInDinars: integer("price_in_dinars").notNull(),
  /** How the customer will pay; default is pay_at_salon */
  paymentMethod: packagePaymentMethodEnum("payment_method").notNull().default("pay_at_salon"),
  status: packagePurchaseStatusEnum("status").notNull().default("pending_payment"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /** Owner confirms payment manually; idempotent — repeated calls are no-ops */
  paymentConfirmedAt: timestamp("payment_confirmed_at", { withTimezone: true }),
  paymentConfirmedByUserId: uuid("payment_confirmed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("customer_package_purchases_salon_customer_idx").on(table.salonId, table.salonCustomerId),
  index("customer_package_purchases_package_idx").on(table.packageId),
  index("customer_package_purchases_status_idx").on(table.status, table.expiresAt),
  /** Leading FK coverage: paymentConfirmedByUserId (audit by confirming user). */
  index("customer_package_purchases_payment_confirmed_by_idx").on(table.paymentConfirmedByUserId),
  /** Leading FK coverage: salonCustomerId (existing composite leads with salonId). */
  index("customer_package_purchases_customer_idx").on(table.salonCustomerId),
]);

// ---------------------------------------------------------------------------
// Package redemptions (per-appointment session deductions)
// ---------------------------------------------------------------------------

export const packageRedemptionsTable = pgTable("package_redemptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  purchaseId: uuid("purchase_id").notNull().references(() => customerPackagePurchasesTable.id, { onDelete: "cascade" }),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  appointmentId: uuid("appointment_id").notNull().references(() => appointmentsTable.id, { onDelete: "restrict" }),
  salonCustomerId: uuid("salon_customer_id").notNull().references(() => salonCustomersTable.id, { onDelete: "cascade" }),
  status: packageRedemptionStatusEnum("status").notNull().default("redeemed"),
  /** Original appointment price at redemption time — restored when reversed */
  originalAppointmentPrice: integer("original_appointment_price").notNull().default(0),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
  reversedByUserId: uuid("reversed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  /** Idempotency: only one active redemption per purchase per appointment */
  uniqueIndex("package_redemptions_purchase_appointment_unique").on(table.purchaseId, table.appointmentId),
  index("package_redemptions_purchase_idx").on(table.purchaseId),
  index("package_redemptions_salon_customer_idx").on(table.salonId, table.salonCustomerId),
  index("package_redemptions_appointment_idx").on(table.appointmentId),
  /** Leading FK coverage: reversedByUserId (audit by reversing user). */
  index("package_redemptions_reversed_by_idx").on(table.reversedByUserId),
  /** Leading FK coverage: salonCustomerId (existing composite leads with salonId). */
  index("package_redemptions_customer_idx").on(table.salonCustomerId),
]);

// ---------------------------------------------------------------------------
// Employee commission settings
// ---------------------------------------------------------------------------

export const employeeCommissionSettingsTable = pgTable("employee_commission_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  /** Commission type: percentage of revenue or fixed amount per completed treatment */
  commissionType: commissionTypeEnum("commission_type").notNull().default("percent_of_revenue"),
  /** Percentage (0–100) used when commissionType = percent_of_revenue */
  commissionPercent: integer("commission_percent").notNull().default(0),
  /** Fixed amount in dinars per treatment, used when commissionType = fixed_per_treatment */
  fixedAmountInDinars: integer("fixed_amount_in_dinars").notNull().default(0),
  /** Optional per-service override: { serviceId: percent } */
  perServiceOverrides: jsonb("per_service_overrides").$type<Record<string, number>>().notNull().default({}),
  updatedByUserId: uuid("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("employee_commission_settings_employee_unique").on(table.employeeId),
  index("employee_commission_settings_salon_idx").on(table.salonId),
  /** Leading FK coverage: updatedByUserId (audit by updating user). */
  index("employee_commission_settings_updated_by_idx").on(table.updatedByUserId),
]);

// ---------------------------------------------------------------------------
// Employee ratings aggregate (populated from reviewsTable.employeeId)
// ---------------------------------------------------------------------------
export const employeeRatingsTable = pgTable("employee_ratings", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  /** Aggregated average rating × 10 (same scale as salonsTable.rating) */
  averageRating: integer("average_rating").notNull().default(0),
  reviewCount: integer("review_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("employee_ratings_employee_unique").on(table.employeeId),
  index("employee_ratings_salon_idx").on(table.salonId),
]);
