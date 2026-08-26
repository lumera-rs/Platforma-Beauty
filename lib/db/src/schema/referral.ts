import {
  boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp,
  uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable, salonsTable, appointmentsTable } from "./core";
import { educationCentersTable, courseEnrollmentsTable } from "./education";
import { ordersTable, retailOrdersTable } from "./commerce";

export const referralChannelEnum = pgEnum("referral_channel", ["A", "B1", "B2", "C", "D"]);
export const referralAttributionStatusEnum = pgEnum("referral_attribution_status", ["attributed", "rejected", "under_review", "expired"]);
export const referralQualificationStatusEnum = pgEnum("referral_qualification_status", ["pending_verification", "tracking", "qualified", "held", "available", "reversed", "rejected"]);
export const referralReviewStatusEnum = pgEnum("referral_review_status", ["open", "approved", "rejected", "dismissed"]);
export const referralCreditEntryTypeEnum = pgEnum("referral_credit_entry_type", ["held", "available", "redeemed", "expired", "reversed", "negative_offset", "restored"]);
export const referralWalletKindEnum = pgEnum("referral_wallet_kind", ["B2B", "B2C"]);
export const referralMilestoneKindEnum = pgEnum("referral_milestone_kind", ["salon_subscription_reduction", "education_commission_reduction"]);

/** One row per legal subject, globally keyed by normalized PIB. */
export const legalEntitiesTable = pgTable("legal_entities", {
  id: uuid("id").defaultRandom().primaryKey(),
  normalizedPib: text("normalized_pib").notNull(),
  legalName: text("legal_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("legal_entities_normalized_pib_unique").on(table.normalizedPib)]);

/**
 * A legal entity can own a salon and an education centre.  The pair of nullable
 * FKs deliberately replaces unsafe separate PIB uniqueness on either business.
 */
export const legalEntityBusinessesTable = pgTable("legal_entity_businesses", {
  id: uuid("id").defaultRandom().primaryKey(),
  legalEntityId: uuid("legal_entity_id").notNull().references(() => legalEntitiesTable.id, { onDelete: "restrict" }),
  ownerUserId: uuid("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  salonId: uuid("salon_id").references(() => salonsTable.id, { onDelete: "cascade" }),
  educationCenterId: uuid("education_center_id").references(() => educationCentersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("legal_entity_businesses_salon_unique").on(table.salonId).where(sql`${table.salonId} is not null`),
  uniqueIndex("legal_entity_businesses_center_unique").on(table.educationCenterId).where(sql`${table.educationCenterId} is not null`),
  index("legal_entity_businesses_entity_owner_idx").on(table.legalEntityId, table.ownerUserId),
  check("legal_entity_businesses_one_business_check", sql`num_nonnulls(${table.salonId}, ${table.educationCenterId}) = 1`),
]);

export const businessVerificationAuditsTable = pgTable("business_verification_audits", {
  id: uuid("id").defaultRandom().primaryKey(),
  legalEntityBusinessId: uuid("legal_entity_business_id").notNull().references(() => legalEntityBusinessesTable.id, { onDelete: "cascade" }),
  previousStatus: text("previous_status"),
  nextStatus: text("next_status").notNull(),
  reason: text("reason"),
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("business_verification_audits_business_created_idx").on(table.legalEntityBusinessId, table.createdAt)]);

export const referralCodesTable = pgTable("referral_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull(),
  channel: referralChannelEnum("channel").notNull(),
  referrerUserId: uuid("referrer_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  referrerSalonId: uuid("referrer_salon_id").references(() => salonsTable.id, { onDelete: "cascade" }),
  referrerEducationCenterId: uuid("referrer_education_center_id").references(() => educationCentersTable.id, { onDelete: "cascade" }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("referral_codes_code_unique").on(table.code),
  // A/C/D are issued by a concrete source business; B1/B2 remain personal.
  uniqueIndex("referral_codes_salon_channel_unique").on(table.referrerSalonId, table.channel)
    .where(sql`${table.referrerSalonId} is not null`),
  uniqueIndex("referral_codes_center_channel_unique").on(table.referrerEducationCenterId, table.channel)
    .where(sql`${table.referrerEducationCenterId} is not null`),
  uniqueIndex("referral_codes_user_channel_unique").on(table.referrerUserId, table.channel)
    .where(sql`${table.referrerSalonId} is null and ${table.referrerEducationCenterId} is null`),
  index("referral_codes_salon_channel_idx").on(table.referrerSalonId, table.channel),
  index("referral_codes_center_channel_idx").on(table.referrerEducationCenterId, table.channel),
  check("referral_codes_source_channel_check", sql`
    (${table.channel} in ('B1', 'B2') and num_nonnulls(${table.referrerSalonId}, ${table.referrerEducationCenterId}) = 0)
    or (${table.channel} = 'C' and ${table.referrerEducationCenterId} is not null and ${table.referrerSalonId} is null)
    or (${table.channel} = 'D' and ${table.referrerSalonId} is not null and ${table.referrerEducationCenterId} is null)
    or (${table.channel} = 'A' and num_nonnulls(${table.referrerSalonId}, ${table.referrerEducationCenterId}) = 1)`),
]);

/** First-touch identity is immutable; only status and its audit reason may transition. */
export const referralAttributionsTable = pgTable("referral_attributions", {
  id: uuid("id").defaultRandom().primaryKey(),
  referralCodeId: uuid("referral_code_id").notNull().references(() => referralCodesTable.id, { onDelete: "restrict" }),
  channel: referralChannelEnum("channel").notNull(),
  referrerUserId: uuid("referrer_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  referredUserId: uuid("referred_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  /** A/B1 business signups retain their target after ownership approval. */
  referredSalonId: uuid("referred_salon_id").references(() => salonsTable.id, { onDelete: "restrict" }),
  referredEducationCenterId: uuid("referred_education_center_id").references(() => educationCentersTable.id, { onDelete: "restrict" }),
  status: referralAttributionStatusEnum("status").notNull().default("attributed"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
  rejectionReason: text("rejection_reason"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("referral_attributions_referred_user_unique").on(table.referredUserId),
  uniqueIndex("referral_attributions_idempotency_unique").on(table.idempotencyKey),
  index("referral_attributions_referrer_channel_created_idx").on(table.referrerUserId, table.channel, table.createdAt),
  index("referral_attributions_referred_salon_idx").on(table.referredSalonId),
  index("referral_attributions_referred_center_idx").on(table.referredEducationCenterId),
  check("referral_attributions_target_business_check", sql`
    (num_nonnulls(${table.referredSalonId}, ${table.referredEducationCenterId}) = 0)
    or (${table.channel} in ('A', 'B1') and num_nonnulls(${table.referredSalonId}, ${table.referredEducationCenterId}) = 1)`),
]);

export const referralQualificationsTable = pgTable("referral_qualifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  attributionId: uuid("attribution_id").notNull().unique().references(() => referralAttributionsTable.id, { onDelete: "restrict" }),
  referredSalonId: uuid("referred_salon_id").references(() => salonsTable.id, { onDelete: "restrict" }),
  referredEducationCenterId: uuid("referred_education_center_id").references(() => educationCentersTable.id, { onDelete: "restrict" }),
  status: referralQualificationStatusEnum("status").notNull().default("pending_verification"),
  requiredEvidenceCount: integer("required_evidence_count").notNull(),
  /** Fixed qualification-window start set by the first A/B1 admin approval. */
  trackingStartedAt: timestamp("tracking_started_at", { withTimezone: true }),
  qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
  holdUntil: timestamp("hold_until", { withTimezone: true }),
  availableAt: timestamp("available_at", { withTimezone: true }),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("referral_qualifications_status_hold_idx").on(table.status, table.holdUntil),
  check("referral_qualifications_target_business_check", sql`num_nonnulls(${table.referredSalonId}, ${table.referredEducationCenterId}) <= 1`),
]);

export const referralQualificationEvidenceTable = pgTable("referral_qualification_evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  qualificationId: uuid("qualification_id").notNull().references(() => referralQualificationsTable.id, { onDelete: "cascade" }),
  appointmentId: uuid("appointment_id").references(() => appointmentsTable.id, { onDelete: "restrict" }),
  enrollmentId: uuid("enrollment_id").references(() => courseEnrollmentsTable.id, { onDelete: "restrict" }),
  eligibleAt: timestamp("eligible_at", { withTimezone: true }).notNull(),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  invalidationReason: text("invalidation_reason"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("referral_qualification_evidence_idempotency_unique").on(table.idempotencyKey),
  uniqueIndex("referral_qualification_evidence_appointment_unique").on(table.qualificationId, table.appointmentId).where(sql`${table.appointmentId} is not null`),
  uniqueIndex("referral_qualification_evidence_enrollment_unique").on(table.qualificationId, table.enrollmentId).where(sql`${table.enrollmentId} is not null`),
  check("referral_qualification_evidence_one_source_check", sql`num_nonnulls(${table.appointmentId}, ${table.enrollmentId}) = 1`),
]);

export const referralReviewsTable = pgTable("referral_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  attributionId: uuid("attribution_id").references(() => referralAttributionsTable.id, { onDelete: "cascade" }),
  qualificationId: uuid("qualification_id").references(() => referralQualificationsTable.id, { onDelete: "cascade" }),
  status: referralReviewStatusEnum("status").notNull().default("open"),
  reasonCode: text("reason_code").notNull(),
  detail: text("detail"),
  score: integer("score"),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("referral_reviews_status_created_idx").on(table.status, table.createdAt)]);

export const referralCreditLedgerTable = pgTable("referral_credit_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  walletKind: referralWalletKindEnum("wallet_kind").notNull(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  salonId: uuid("salon_id").references(() => salonsTable.id, { onDelete: "restrict" }),
  educationCenterId: uuid("education_center_id").references(() => educationCentersTable.id, { onDelete: "restrict" }),
  referralAttributionId: uuid("referral_attribution_id").references(() => referralAttributionsTable.id, { onDelete: "restrict" }),
  type: referralCreditEntryTypeEnum("type").notNull(),
  /** Integer Serbian dinars, matching commerce subtotal/total/price fields. */
  amountRsd: integer("amount_rsd").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("referral_credit_ledger_idempotency_unique").on(table.idempotencyKey),
  index("referral_credit_ledger_owner_wallet_effective_idx").on(table.ownerUserId, table.walletKind, table.effectiveAt),
  index("referral_credit_ledger_salon_effective_idx").on(table.salonId, table.effectiveAt),
  index("referral_credit_ledger_center_effective_idx").on(table.educationCenterId, table.effectiveAt),
  check(
    "referral_credit_ledger_wallet_business_check",
    sql`(${table.walletKind} = 'B2C' AND ${table.salonId} is null AND ${table.educationCenterId} is null)
      OR (${table.walletKind} = 'B2B' AND num_nonnulls(${table.salonId}, ${table.educationCenterId}) = 1)`,
  ),
]);

export const referralCreditRedemptionsTable = pgTable("referral_credit_redemptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  ledgerEntryId: uuid("ledger_entry_id").notNull().references(() => referralCreditLedgerTable.id, { onDelete: "restrict" }),
  orderId: uuid("order_id").references(() => ordersTable.id, { onDelete: "restrict" }),
  retailOrderId: uuid("retail_order_id").references(() => retailOrdersTable.id, { onDelete: "restrict" }),
  /** Integer Serbian dinars, matching the order subtotal snapshot convention. */
  amountRsd: integer("amount_rsd").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("referral_credit_redemptions_idempotency_unique").on(table.idempotencyKey),
  // One checkout can consume several earned entries, but never consume the
  // same source entry twice. The idempotency key additionally makes a replay
  // of the entire checkout allocation exact.
  uniqueIndex("referral_credit_redemptions_order_ledger_unique").on(table.orderId, table.ledgerEntryId)
    .where(sql`${table.orderId} is not null`),
  uniqueIndex("referral_credit_redemptions_retail_order_ledger_unique").on(table.retailOrderId, table.ledgerEntryId)
    .where(sql`${table.retailOrderId} is not null`),
  check("referral_credit_redemptions_one_order_check", sql`num_nonnulls(${table.orderId}, ${table.retailOrderId}) = 1`),
  check("referral_credit_redemptions_positive_amount_check", sql`${table.amountRsd} > 0`),
]);

export const referralMilestoneBenefitsTable = pgTable("referral_milestone_benefits", {
  id: uuid("id").defaultRandom().primaryKey(),
  referrerUserId: uuid("referrer_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  channel: referralChannelEnum("channel").notNull(),
  benefitSalonId: uuid("benefit_salon_id").references(() => salonsTable.id, { onDelete: "restrict" }),
  benefitEducationCenterId: uuid("benefit_education_center_id").references(() => educationCentersTable.id, { onDelete: "restrict" }),
  qualifyingCount: integer("qualifying_count").notNull(),
  kind: referralMilestoneKindEnum("kind").notNull(),
  billingCycleStart: timestamp("billing_cycle_start", { withTimezone: true }),
  billingCycleEnd: timestamp("billing_cycle_end", { withTimezone: true }),
  discountPercent: integer("discount_percent"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  /** A late fraud rejection preserves the earned fact but makes an unapplied benefit unusable. */
  neutralizedAt: timestamp("neutralized_at", { withTimezone: true }),
  neutralizedByUserId: uuid("neutralized_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  neutralizationReason: text("neutralization_reason"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("referral_milestone_benefits_salon_channel_count_unique").on(table.benefitSalonId, table.channel, table.qualifyingCount)
    .where(sql`${table.benefitSalonId} is not null`),
  uniqueIndex("referral_milestone_benefits_center_channel_count_unique").on(table.benefitEducationCenterId, table.channel, table.qualifyingCount)
    .where(sql`${table.benefitEducationCenterId} is not null`),
  uniqueIndex("referral_milestone_benefits_idempotency_unique").on(table.idempotencyKey),
  index("referral_milestone_benefits_pending_idx").on(table.channel, table.billingCycleStart).where(sql`${table.appliedAt} is null`),
  check("referral_milestone_benefits_discount_percent_check", sql`${table.discountPercent} is null or (${table.discountPercent} > 0 and ${table.discountPercent} <= 100)`),
  check("referral_milestone_benefits_business_check", sql`
    (${table.channel} = 'A' and ${table.kind} = 'salon_subscription_reduction' and ${table.benefitSalonId} is not null and ${table.benefitEducationCenterId} is null)
    or (${table.channel} in ('A', 'C') and ${table.kind} = 'education_commission_reduction' and ${table.benefitEducationCenterId} is not null and ${table.benefitSalonId} is null)`),
]);