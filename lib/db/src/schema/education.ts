import {
  boolean,
  check,
  date,
  index,
  jsonb,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { employeesTable, salonsTable, usersTable } from "./core";
import { paymentMethodEnum, subscriptionStatusEnum, subscriptionPlansTable, productsTable } from "./commerce";

export const courseFormatEnum = pgEnum("course_format", ["online", "in-person", "hybrid"]);
export const educationEnrollmentStatusEnum = pgEnum("education_enrollment_status", ["pending", "active", "completed", "cancelled"]);
export const educationPaymentStatusEnum = pgEnum("education_payment_status", ["pending", "paid", "failed", "refunded"]);
export const educationCenterVerificationStatusEnum = pgEnum("education_center_verification_status", ["pending", "verified", "rejected", "suspended"]);
export const educationEscrowStatusEnum = pgEnum("education_escrow_status", ["held", "ready_for_payout", "frozen", "paid_out", "refunded", "partially_refunded"]);
export const educationLedgerEntryTypeEnum = pgEnum("education_ledger_entry_type", ["charge", "platform_fee", "reserve_hold", "release", "payout", "refund", "adjustment"]);
export const educationPayoutStatusEnum = pgEnum("education_payout_status", ["pending", "paid", "cancelled"]);
export const educationDisputeStatusEnum = pgEnum("education_dispute_status", ["open", "under_review", "resolved_refund", "resolved_payout", "rejected", "cancelled"]);
export const educationThreadStatusEnum = pgEnum("education_thread_status", ["open", "closed"]);
export const educationWaitlistStatusEnum = pgEnum("education_waitlist_status", ["waiting", "offered", "expired", "enrolled", "cancelled"]);
export const educationCourseLevelEnum = pgEnum("education_course_level", ["beginner", "intermediate", "advanced", "all-levels"]);
export const educationReviewStatusEnum = pgEnum("education_review_status", ["pending", "published", "rejected"]);
export const educationCourseTypeStatusEnum = pgEnum("education_course_type_status", ["approved", "pending", "rejected"]);
export const educationPaymentModeEnum = pgEnum("education_payment_mode", ["online_full", "live_deposit", "live_off_platform"]);
/** Shared paid placement products across the salon and education marketplaces. */
export const educationPlacementKindEnum = pgEnum("education_placement_kind", ["featured_salon", "featured_center", "special_offer"]);
export const educationPlacementScopeEnum = pgEnum("education_placement_scope", ["home", "category", "subcategory"]);
export const educationPlacementStatusEnum = pgEnum("education_placement_status", ["pending_payment", "active", "expired", "cancelled", "rejected"]);
export const educationGiftVoucherStatusEnum = pgEnum("education_gift_voucher_status", ["pending_payment", "active", "redeemed", "refunded", "cancelled"]);
/** Operational scheduling is intentionally separate from the legacy format. */
export const educationSchedulingModeEnum = pgEnum("education_scheduling_mode", ["fixed_group", "individual_calendar"]);
export const educationStaffRoleEnum = pgEnum("education_staff_role", ["owner_admin", "manager_reception", "educator"]);
export const educationDepositDispositionEnum = pgEnum("education_deposit_disposition", ["refund", "forfeit", "transfer"]);
export const educationBookingGroupStatusEnum = pgEnum("education_booking_group_status", ["pending", "active", "waitlisted", "cancelled"]);
export const educationParticipantStatusEnum = pgEnum("education_participant_status", ["reserved", "waitlisted", "cancelled"]);
export const educationAttendanceStatusEnum = pgEnum("education_attendance_status", ["present", "absent", "excused"]);
export const educationInstallmentStatusEnum = pgEnum("education_installment_status", ["pending", "settled", "refunded", "cancelled"]);
export const educationOutboxStatusEnum = pgEnum("education_outbox_status", ["pending", "processing", "sent", "failed"]);
// A bundle is paid once.  Its individual course rows are access projections,
// never independently billable enrollments.
export const educationBundlePurchaseStatusEnum = pgEnum("education_bundle_purchase_status", ["pending_payment", "settled", "cancelled", "refunded"]);
export const educationBundlePurchaseTargetEnum = pgEnum("education_bundle_purchase_target", ["individual", "salon_employee"]);

export const educationCentersTable = pgTable("education_centers", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => usersTable.id),
  name: text("name").notNull(),
  city: text("city").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url").notNull(),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  contactAddress: text("contact_address"),
  pib: text("pib"),
  websiteUrl: text("website_url"),
  instagramUrl: text("instagram_url"),
  paymentReferenceNumber: text("payment_reference_number").unique(),
  legalEntityType: text("legal_entity_type").notNull().default("legal_entity"),
  bankAccount: text("bank_account"),
  commissionPercentOverride: integer("commission_percent_override"),
  reservePercentOverride: integer("reserve_percent_override"),
  onlineRefundDaysOverride: integer("online_refund_days_override"),
  liveAppealDaysOverride: integer("live_appeal_days_override"),
  featuredCoursePriceOverride: integer("featured_course_price_override"),
  verificationStatus: educationCenterVerificationStatusEnum("verification_status").notNull().default("pending"),
  verificationNote: text("verification_note"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedByUserId: uuid("verified_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for ownerId and verifiedByUserId.
  index("education_centers_owner_idx").on(table.ownerId),
  index("education_centers_verified_by_idx").on(table.verifiedByUserId),
  check("education_centers_commission_override_check", sql`${table.commissionPercentOverride} between 0 and 100`),
  check("education_centers_reserve_override_check", sql`${table.reservePercentOverride} between 0 and 100`),
  check("education_centers_online_refund_override_check", sql`${table.onlineRefundDaysOverride} between 0 and 365`),
  check("education_centers_live_appeal_override_check", sql`${table.liveAppealDaysOverride} between 0 and 365`),
  check("education_centers_featured_price_override_check", sql`${table.featuredCoursePriceOverride} >= 0`),
  check("education_centers_legal_entity_type_check", sql`${table.legalEntityType} in ('individual','legal_entity')`),
  check("education_centers_bank_account_check", sql`${table.bankAccount} is null or ${table.bankAccount} ~ '^[0-9]{18}$'`),
]);

export const educationCenterSubscriptionsTable = pgTable("education_center_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  centerId: uuid("center_id").notNull().unique().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => subscriptionPlansTable.id),
  status: subscriptionStatusEnum("status").notNull().default("trial"),
  dueAmount: integer("due_amount").notNull().default(0),
  paymentMethod: paymentMethodEnum("payment_method").notNull().default("BANK_TRANSFER"),
  billingCycle: text("billing_cycle").notNull().default("monthly"),
  paymentReference: text("payment_reference").unique(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  autoRenew: boolean("auto_renew").notNull().default(true),
  contractKind: text("contract_kind").notNull().default("standard"),
  contractEndsAt: timestamp("contract_ends_at", { withTimezone: true }),
  courseLimitOverride: integer("course_limit_override"),
  pendingPlanId: uuid("pending_plan_id").references(() => subscriptionPlansTable.id),
  pendingBillingCycle: text("pending_billing_cycle"),
  pendingPlanEffectiveAt: timestamp("pending_plan_effective_at", { withTimezone: true }),
  graceExtensionNote: text("grace_extension_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for planId (all education centers on a plan).
  index("education_center_subscriptions_plan_idx").on(table.planId),
  index("education_center_subscriptions_pending_plan_idx").on(table.pendingPlanId),
  index("education_center_subscriptions_grace_idx").on(table.status, table.graceEndsAt),
  check("education_center_subscriptions_billing_cycle_check", sql`${table.billingCycle} in ('monthly', 'yearly')`),
  check("education_center_subscriptions_pending_billing_cycle_check", sql`${table.pendingBillingCycle} is null or ${table.pendingBillingCycle} in ('monthly', 'yearly')`),
  check("education_center_subscriptions_contract_kind_check", sql`${table.contractKind} in ('standard','custom')`),
  check("education_center_subscriptions_course_limit_override_check", sql`${table.courseLimitOverride} is null or ${table.courseLimitOverride} >= 0`),
]);

export const educationTrialClaimsTable = pgTable("education_trial_claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  normalizedEmailHash: text("normalized_email_hash").notNull(),
  normalizedPhoneHash: text("normalized_phone_hash"),
  normalizedPibHash: text("normalized_pib_hash"),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  centerId: uuid("center_id").references(() => educationCentersTable.id, { onDelete: "set null" }),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("education_trial_claims_user_idx").on(table.userId),
  index("education_trial_claims_center_idx").on(table.centerId),
  uniqueIndex("education_trial_claims_email_unique").on(table.normalizedEmailHash),
  uniqueIndex("education_trial_claims_phone_unique").on(table.normalizedPhoneHash).where(sql`${table.normalizedPhoneHash} is not null`),
  uniqueIndex("education_trial_claims_pib_unique").on(table.normalizedPibHash).where(sql`${table.normalizedPibHash} is not null`),
]);

export const educationFinancialAuditLogTable = pgTable("education_financial_audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  oldValue: jsonb("old_value").$type<Record<string, unknown> | null>(),
  newValue: jsonb("new_value").$type<Record<string, unknown> | null>(),
  reason: text("reason"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  timeZone: text("time_zone").notNull().default("Europe/Belgrade"),
}, (table) => [
  index("education_financial_audit_actor_idx").on(table.actorUserId),
  index("education_financial_audit_entity_idx").on(table.entityType, table.entityId, table.occurredAt),
  check("education_financial_audit_timezone_check", sql`${table.timeZone} = 'Europe/Belgrade'`),
]);

export const educationPaymentObligationsTable = pgTable("education_payment_obligations", {
  id: uuid("id").defaultRandom().primaryKey(),
  centerId: uuid("center_id").references(() => educationCentersTable.id, { onDelete: "restrict" }),
  salonId: uuid("salon_id").references(() => salonsTable.id, { onDelete: "restrict" }),
  enrollmentId: uuid("enrollment_id").references((): any => courseEnrollmentsTable.id, { onDelete: "restrict" }),
  subscriptionId: uuid("subscription_id").references(() => educationCenterSubscriptionsTable.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("pending"),
  expectedAmount: integer("expected_amount").notNull(),
  confirmedAmount: integer("confirmed_amount"),
  recipientNameSnapshot: text("recipient_name_snapshot").notNull(),
  recipientAccountSnapshot: text("recipient_account_snapshot").notNull(),
  paymentCodeSnapshot: text("payment_code_snapshot").notNull(),
  purposeSnapshot: text("purpose_snapshot").notNull(),
  referenceSnapshot: text("reference_snapshot").notNull().unique(),
  ipsPayloadSnapshot: text("ips_payload_snapshot"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  billingCycleSnapshot: text("billing_cycle_snapshot"),
  servicePeriodStart: timestamp("service_period_start", { withTimezone: true }),
  servicePeriodEnd: timestamp("service_period_end", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedByUserId: uuid("confirmed_by_user_id").references(() => usersTable.id, { onDelete: "restrict" }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledByUserId: uuid("cancelled_by_user_id").references(() => usersTable.id, { onDelete: "restrict" }),
}, (table) => [
  index("education_payment_obligations_center_status_idx").on(table.centerId, table.status, table.dueAt),
  index("education_payment_obligations_salon_idx").on(table.salonId),
  index("education_payment_obligations_enrollment_idx").on(table.enrollmentId),
  index("education_payment_obligations_subscription_idx").on(table.subscriptionId),
  index("education_payment_obligations_confirmed_by_idx").on(table.confirmedByUserId),
  index("education_payment_obligations_cancelled_by_idx").on(table.cancelledByUserId),
  check("education_payment_obligations_target_check", sql`num_nonnulls(${table.centerId}, ${table.salonId}) >= 1`),
  check("education_payment_obligations_status_check", sql`${table.status} in ('pending','paid','cancelled')`),
  check("education_payment_obligations_amount_check", sql`${table.expectedAmount} > 0 and (${table.confirmedAmount} is null or ${table.confirmedAmount} >= 0)`),
  check("education_payment_obligations_account_check", sql`${table.recipientAccountSnapshot} ~ '^[0-9]{18}$'`),
  check("education_payment_obligations_code_check", sql`${table.paymentCodeSnapshot} in ('221','289')`),
  check("education_payment_obligations_cycle_check", sql`${table.billingCycleSnapshot} is null or ${table.billingCycleSnapshot} in ('monthly','yearly')`),
]);

export const educationGraceNotesTable = pgTable("education_grace_notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("education_grace_notes_center_created_idx").on(table.centerId, table.createdAt),
  index("education_grace_notes_author_idx").on(table.authorUserId),
]);

export const educationPlatformSettingsTable = pgTable("education_platform_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  commissionPercent: integer("commission_percent").notNull().default(15),
  reservePercent: integer("reserve_percent").notNull().default(10),
  onlineRefundDays: integer("online_refund_days").notNull().default(14),
  liveAppealDays: integer("live_appeal_days").notNull().default(7),
  featuredCoursePrice: integer("featured_course_price").notNull().default(0),
  /** Public payment instructions, set by an administrator; never infer these. */
  ipsRecipientName: text("ips_recipient_name"),
  ipsRecipientAccount: text("ips_recipient_account"),
  ipsPurpose: text("ips_purpose"),
  bankReconciliationEnabled: boolean("bank_reconciliation_enabled").notNull().default(false),
  updatedByUserId: uuid("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for updatedByUserId (audit trail).
  index("education_platform_settings_updated_by_idx").on(table.updatedByUserId),
]);

export const educationSectionsTable = pgTable("education_sections", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("education_sections_active_sort_idx").on(table.active, table.sortOrder),
]);

export const courseCategoriesTable = pgTable("course_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  sectionId: uuid("section_id").references(() => educationSectionsTable.id, { onDelete: "set null" }),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("course_categories_section_sort_idx").on(table.sectionId, table.sortOrder),
]);

export const educationSubcategoriesTable = pgTable("education_subcategories", {
  id: uuid("id").defaultRandom().primaryKey(),
  categoryId: uuid("category_id").notNull().references(() => courseCategoriesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("education_subcategories_category_slug_unique").on(table.categoryId, table.slug),
  index("education_subcategories_category_active_sort_idx").on(table.categoryId, table.active, table.sortOrder),
]);

export const educationCourseTypesTable = pgTable("education_course_types", {
  id: uuid("id").defaultRandom().primaryKey(),
  subcategoryId: uuid("subcategory_id").notNull().references(() => educationSubcategoriesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  status: educationCourseTypeStatusEnum("status").notNull().default("pending"),
  proposedByCenterId: uuid("proposed_by_center_id").references(() => educationCentersTable.id, { onDelete: "set null" }),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  reviewNote: text("review_note"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("education_course_types_subcategory_normalized_unique").on(table.subcategoryId, table.normalizedName),
  index("education_course_types_status_idx").on(table.status, table.active, table.sortOrder),
  index("education_course_types_proposed_by_idx").on(table.proposedByCenterId),
  index("education_course_types_reviewed_by_idx").on(table.reviewedByUserId),
]);

export const coursesTable = pgTable("courses", {
  id: uuid("id").defaultRandom().primaryKey(),
  centerId: uuid("center_id").references(() => educationCentersTable.id, { onDelete: "cascade" }),
  salonId: uuid("salon_id").references(() => salonsTable.id, { onDelete: "cascade" }),
  instructorId: uuid("instructor_id").references(() => usersTable.id, { onDelete: "set null" }),
  instructorProfileId: uuid("instructor_profile_id").references((): any => educationInstructorsTable.id, { onDelete: "set null" }),
  categoryId: uuid("category_id").references(() => courseCategoriesTable.id, { onDelete: "set null" }),
  subcategoryId: uuid("subcategory_id").references(() => educationSubcategoriesTable.id, { onDelete: "set null" }),
  courseTypeId: uuid("course_type_id").references(() => educationCourseTypesTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull(),
  format: courseFormatEnum("format").notNull(),
  city: text("city"),
  price: integer("price").notNull(),
  duration: text("duration").notNull(),
  durationMinutes: integer("duration_minutes"),
  theoryHours: integer("theory_hours"),
  practicalHours: integer("practical_hours"),
  level: educationCourseLevelEnum("level").notNull().default("all-levels"),
  learningOutcomes: jsonb("learning_outcomes").$type<string[]>().notNull().default([]),
  includedItems: jsonb("included_items").$type<string[]>().notNull().default([]),
  requirements: text("requirements").notNull().default(""),
  rating: integer("rating").notNull().default(0),
  certification: boolean("certification").notNull().default(false),
  certificateName: text("certificate_name"),
  accredited: boolean("accredited").notNull().default(false),
  language: text("language").default("Srpski"),
  trailerUrl: text("trailer_url"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  faq: jsonb("faq").$type<Array<{ question: string; answer: string }>>().notNull().default([]),
  paymentMode: educationPaymentModeEnum("payment_mode").notNull().default("online_full"),
  depositAmount: integer("deposit_amount"),
  imageUrl: text("image_url").notNull(),
  isTest: boolean("is_test").notNull().default(false),
  published: boolean("published").notNull().default(true),
  archived: boolean("archived").notNull().default(false),
  isFeatured: boolean("is_featured").notNull().default(false),
  featuredUntil: timestamp("featured_until", { withTimezone: true }),
  featuredActivatedAt: timestamp("featured_activated_at", { withTimezone: true }),
  featuredFee: integer("featured_fee").notNull().default(0),
  refundPolicy: text("refund_policy").notNull().default("Povraćaj je moguć do isteka roka zaštite kupovine. Ako centar otkaže termin, kupovina se refundira u celosti."),
  giftVoucherEligible: boolean("gift_voucher_eligible").notNull().default(false),
  groupDiscountMinimum: integer("group_discount_minimum"),
  groupDiscountPercent: integer("group_discount_percent"),
  schedulingMode: educationSchedulingModeEnum("scheduling_mode").notNull().default("fixed_group"),
  /** All operational date/time fields are canonical Europe/Belgrade wall clock. */
  operationalTimeZone: text("operational_time_zone").notNull().default("Europe/Belgrade"),
  cancellationDeadlineHours: integer("cancellation_deadline_hours").notNull().default(0),
  depositDisposition: educationDepositDispositionEnum("deposit_disposition").notNull().default("refund"),
  minimumEnrollmentRiskDeadline: timestamp("minimum_enrollment_risk_deadline", { withTimezone: true }),
  earlyBirdPrice: integer("early_bird_price"),
  earlyBirdCutoff: timestamp("early_bird_cutoff", { withTimezone: true }),
  installmentCount: integer("installment_count").notNull().default(1),
  startDate: date("start_date", { mode: "string" }),
  endDate: date("end_date", { mode: "string" }),
  onlineAccessDays: integer("online_access_days"),
  extensionPrice1Month: integer("extension_price_1_month"),
  extensionPrice3Months: integer("extension_price_3_months"),
  extensionPrice6Months: integer("extension_price_6_months"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Course catalog: published/active courses by center, category, format, city.
  index("courses_center_published_idx").on(table.centerId, table.published, table.archived),
  index("courses_category_published_idx").on(table.categoryId, table.published, table.archived),
  index("courses_subcategory_published_idx").on(table.subcategoryId, table.published, table.archived),
  index("courses_course_type_published_idx").on(table.courseTypeId, table.published, table.archived),
  index("courses_format_city_published_idx").on(table.format, table.city, table.published),
  index("courses_featured_until_idx").on(table.isFeatured, table.featuredUntil),
  // Directory ORDER BY created_at (published/active courses sorted by newest).
  index("courses_published_archived_created_idx").on(table.published, table.archived, table.createdAt),
  // Leading FK coverage for salonId, instructorId, instructorProfileId.
  index("courses_salon_idx").on(table.salonId),
  index("courses_instructor_idx").on(table.instructorId),
  index("courses_instructor_profile_idx").on(table.instructorProfileId),
  check("courses_theory_hours_nonnegative_check", sql`${table.theoryHours} is null or ${table.theoryHours} >= 0`),
  check("courses_practical_hours_nonnegative_check", sql`${table.practicalHours} is null or ${table.practicalHours} >= 0`),
  check("courses_duration_minutes_check", sql`${table.durationMinutes} is null or ${table.durationMinutes} > 0`),
  check("courses_deposit_amount_nonnegative_check", sql`${table.depositAmount} is null or ${table.depositAmount} >= 0`),
  check("courses_live_deposit_check", sql`${table.paymentMode} <> 'live_deposit' or (${table.format} in ('in-person', 'hybrid') and ${table.depositAmount} > 0)`),
  check("courses_live_off_platform_check", sql`${table.paymentMode} <> 'live_off_platform' or ${table.format} in ('in-person', 'hybrid')`),
  check("courses_non_deposit_amount_check", sql`${table.paymentMode} = 'live_deposit' or ${table.depositAmount} is null`),
  check("courses_published_live_deposit_refund_policy_check", sql`not (${table.published} and ${table.paymentMode} = 'live_deposit') or length(btrim(${table.refundPolicy})) > 0`),
  check("courses_operational_timezone_check", sql`${table.operationalTimeZone} = 'Europe/Belgrade'`),
  check("courses_cancellation_deadline_check", sql`${table.cancellationDeadlineHours} >= 0 and ${table.cancellationDeadlineHours} <= 8760`),
  check("courses_early_bird_check", sql`(${table.earlyBirdPrice} is null and ${table.earlyBirdCutoff} is null) or (${table.earlyBirdPrice} >= 0 and ${table.earlyBirdPrice} <= ${table.price} and ${table.earlyBirdCutoff} is not null)`),
  check("courses_installment_count_check", sql`${table.installmentCount} in (1, 2, 3)`),
  check("courses_online_access_check", sql`${table.format} <> 'online' or ${table.onlineAccessDays} > 0`),
  check("courses_extension_prices_check", sql`
    (${table.extensionPrice1Month} is null or ${table.extensionPrice1Month} >= 0)
    and (${table.extensionPrice3Months} is null or ${table.extensionPrice3Months} >= 0)
    and (${table.extensionPrice6Months} is null or ${table.extensionPrice6Months} >= 0)
  `),
]);

export const educationInquiriesTable = pgTable("education_inquiries", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("open"),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("education_inquiries_course_created_idx").on(table.courseId, table.createdAt),
  index("education_inquiries_center_status_created_idx").on(table.centerId, table.status, table.createdAt),
  index("education_inquiries_user_created_idx").on(table.userId, table.createdAt),
]);

export const educationCourseMetricEventsTable = pgTable("education_course_metric_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  dedupeKey: text("dedupe_key"),
}, (table) => [
  uniqueIndex("education_course_metric_events_dedupe_unique").on(table.dedupeKey).where(sql`${table.dedupeKey} is not null`),
  index("education_course_metric_events_course_30d_idx").on(table.courseId, table.eventType, table.occurredAt),
  index("education_course_metric_events_center_90d_idx").on(table.centerId, table.eventType, table.occurredAt),
  index("education_course_metric_events_actor_idx").on(table.actorUserId),
  check("education_course_metric_events_type_check", sql`${table.eventType} in ('view', 'inquiry')`),
]);

export const educationPlacementSettingsTable = pgTable("education_placement_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: educationPlacementKindEnum("kind").notNull(),
  scope: educationPlacementScopeEnum("scope").notNull(),
  price: integer("price").notNull(),
  slotCount: integer("slot_count").notNull(),
  durationDays: integer("duration_days").notNull(),
  updatedByUserId: uuid("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("education_placement_settings_kind_scope_unique").on(table.kind, table.scope),
  index("education_placement_settings_updated_by_idx").on(table.updatedByUserId),
  check("education_placement_settings_price_check", sql`${table.price} >= 0`),
  check("education_placement_settings_slot_count_check", sql`${table.slotCount} > 0`),
  check("education_placement_settings_duration_days_check", sql`${table.durationDays} > 0`),
]);

export const educationPlacementsTable = pgTable("education_placements", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: educationPlacementKindEnum("kind").notNull(),
  scope: educationPlacementScopeEnum("scope").notNull(),
  scopeCategoryId: uuid("scope_category_id").references(() => courseCategoriesTable.id, { onDelete: "cascade" }),
  scopeSubcategoryId: uuid("scope_subcategory_id").references(() => educationSubcategoriesTable.id, { onDelete: "cascade" }),
  scopeKey: text("scope_key").generatedAlwaysAs(
    sql`coalesce(scope_category_id::text, scope_subcategory_id::text, 'home')`,
  ),
  centerId: uuid("center_id").references(() => educationCentersTable.id, { onDelete: "cascade" }),
  salonId: uuid("salon_id").references(() => salonsTable.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }),
  slotNumber: integer("slot_number").notNull(),
  priceSnapshot: integer("price_snapshot").notNull(),
  durationDaysSnapshot: integer("duration_days_snapshot").notNull(),
  status: educationPlacementStatusEnum("status").notNull().default("pending_payment"),
  paymentReference: text("payment_reference").unique(),
  paymentIpsPayloadSnapshot: text("payment_ips_payload_snapshot"),
  paymentRecipientNameSnapshot: text("payment_recipient_name_snapshot"),
  paymentRecipientAccountSnapshot: text("payment_recipient_account_snapshot"),
  paymentPurposeSnapshot: text("payment_purpose_snapshot"),
  paymentCurrencySnapshot: text("payment_currency_snapshot"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  rotationSeed: integer("rotation_seed").notNull().default(0),
  settledByUserId: uuid("settled_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("education_placements_scope_status_dates_idx").on(table.kind, table.scope, table.status, table.startsAt, table.endsAt),
  index("education_placements_pending_created_idx").on(table.status, table.createdAt),
  index("education_placements_category_slot_idx").on(table.scopeCategoryId, table.slotNumber, table.status),
  index("education_placements_subcategory_slot_idx").on(table.scopeSubcategoryId, table.slotNumber, table.status),
  index("education_placements_center_idx").on(table.centerId),
  index("education_placements_salon_idx").on(table.salonId),
  index("education_placements_course_idx").on(table.courseId),
  index("education_placements_settled_by_idx").on(table.settledByUserId),
  check("education_placements_target_check", sql`(${table.kind} = 'featured_salon' and ${table.salonId} is not null and ${table.centerId} is null and ${table.courseId} is null) or (${table.kind} = 'featured_center' and ${table.centerId} is not null and ${table.salonId} is null and ${table.courseId} is null) or (${table.kind} = 'special_offer' and ${table.courseId} is not null and ${table.centerId} is null and ${table.salonId} is null)`),
  check("education_placements_scope_check", sql`(${table.scope} = 'home' and ${table.scopeCategoryId} is null and ${table.scopeSubcategoryId} is null) or (${table.scope} = 'category' and ${table.scopeCategoryId} is not null and ${table.scopeSubcategoryId} is null) or (${table.scope} = 'subcategory' and ${table.scopeCategoryId} is null and ${table.scopeSubcategoryId} is not null)`),
  check("education_placements_dates_check", sql`(${table.startsAt} is null and ${table.endsAt} is null) or (${table.startsAt} is not null and ${table.endsAt} is not null and ${table.endsAt} > ${table.startsAt})`),
  check("education_placements_slot_check", sql`${table.slotNumber} > 0`),
  check("education_placements_price_check", sql`${table.priceSnapshot} >= 0`),
  check("education_placements_duration_days_check", sql`${table.durationDaysSnapshot} > 0`),
]);

/**
 * Public course itinerary. The program deliberately contains no venue/address:
 * exact live-session logistics stay behind the paid-enrollment access check.
 */
export const courseDaysTable = pgTable("course_days", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  dayNumber: integer("day_number").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  durationMinutes: integer("duration_minutes"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  uniqueIndex("course_days_course_day_unique").on(table.courseId, table.dayNumber),
  index("course_days_course_sort_idx").on(table.courseId, table.sortOrder),
]);

/**
 * Only an App Storage object path (or a vetted legacy HTTP URL) is persisted.
 * The route layer turns private object paths into short-lived serving URLs.
 */
export const educationMediaTable = pgTable("education_media", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }),
  centerId: uuid("center_id").references(() => educationCentersTable.id, { onDelete: "cascade" }),
  objectPath: text("object_path").notNull(),
  altText: text("alt_text").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Both FK columns are leading in their respective composites.
  index("education_media_course_sort_idx").on(table.courseId, table.sortOrder),
  index("education_media_center_sort_idx").on(table.centerId, table.sortOrder),
]);

/**
 * A short-lived, owner-scoped authorization record for a direct App Storage
 * upload. The browser receives its ID but never an object path.
 */
export const educationMediaUploadsTable = pgTable("education_media_uploads", {
  id: uuid("id").primaryKey(),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  objectPath: text("object_path").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attachedAt: timestamp("attached_at", { withTimezone: true }),
  cleanupFailureCount: integer("cleanup_failure_count").notNull().default(0),
  lastCleanupFailureAt: timestamp("last_cleanup_failure_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("education_media_uploads_object_path_unique").on(table.objectPath),
  // courseId is leading in this composite — covers the FK.
  index("education_media_uploads_course_expires_idx").on(table.courseId, table.expiresAt),
  index("education_media_uploads_cleanup_idx").on(table.expiresAt, table.attachedAt),
  index("education_media_uploads_cleanup_failures_idx").on(table.cleanupFailureCount, table.createdAt),
  // Leading FK coverage for centerId.
  index("education_media_uploads_center_idx").on(table.centerId),
]);

export const courseReviewsTable = pgTable("course_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  enrollmentId: uuid("enrollment_id").notNull().unique().references(() => courseEnrollmentsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull().default(""),
  status: educationReviewStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // courseId is leading — covers FK.
  index("course_reviews_course_status_created_idx").on(table.courseId, table.status, table.createdAt),
  // Leading FK coverage for userId (all reviews written by a user).
  index("course_reviews_user_idx").on(table.userId),
]);

/** A canonical center review is tied to a completed enrollment and is published separately from a course review. */
export const educationCenterReviewsTable = pgTable("education_center_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  enrollmentId: uuid("enrollment_id").notNull().unique().references(() => courseEnrollmentsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull().default(""),
  status: educationReviewStatusEnum("status").notNull().default("pending"),
  adminNote: text("admin_note"),
  moderatedAt: timestamp("moderated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("education_center_reviews_center_status_created_idx").on(table.centerId, table.status, table.createdAt),
  index("education_center_reviews_user_idx").on(table.userId),
  check("education_center_reviews_rating_check", sql`${table.rating} between 1 and 5`),
]);

export const educationWishlistsTable = pgTable("education_wishlists", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("education_wishlists_user_course_unique").on(table.userId, table.courseId),
  index("education_wishlists_user_created_idx").on(table.userId, table.createdAt, table.id),
  index("education_wishlists_course_idx").on(table.courseId),
]);

export const educationFeaturedChargeStatusEnum = pgEnum("education_featured_charge_status", ["pending", "paid", "cancelled", "refunded"]);

export const educationFeaturedChargesTable = pgTable("education_featured_charges", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  centerId: uuid("center_id").references(() => educationCentersTable.id, { onDelete: "cascade" }),
  salonId: uuid("salon_id").references(() => salonsTable.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  status: educationFeaturedChargeStatusEnum("status").notNull().default("pending"),
  paymentMethod: paymentMethodEnum("payment_method").notNull().default("BANK_TRANSFER"),
  paymentReference: text("payment_reference"),
  activatedByUserId: uuid("activated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  settledByUserId: uuid("settled_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  note: text("note"),
  activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // courseId is leading — covers FK.
  index("education_featured_charges_course_created_idx").on(table.courseId, table.createdAt),
  index("education_featured_charges_status_idx").on(table.status, table.createdAt),
  // Leading FK coverage for centerId, salonId, and actor FKs.
  index("education_featured_charges_center_idx").on(table.centerId),
  index("education_featured_charges_salon_idx").on(table.salonId),
  index("education_featured_charges_activated_by_idx").on(table.activatedByUserId),
  index("education_featured_charges_settled_by_idx").on(table.settledByUserId),
]);

export const courseSessionsTable = pgTable("course_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  location: text("location"),
  capacity: integer("capacity").notNull().default(20),
  reservedSeats: integer("reserved_seats").notNull().default(0),
  minimumEnrollments: integer("minimum_enrollments"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Session schedule: all upcoming sessions for a course ordered by start time.
  // courseId is leading — covers FK.
  index("course_sessions_course_starts_at_idx").on(table.courseId, table.startsAt),
]);

export const courseModulesTable = pgTable("course_modules", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  // courseId is leading — covers FK.
  index("course_modules_course_sort_idx").on(table.courseId, table.sortOrder),
]);

export const courseLessonsTable = pgTable("course_lessons", {
  id: uuid("id").defaultRandom().primaryKey(),
  moduleId: uuid("module_id").notNull().references(() => courseModulesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  content: text("content").notNull().default(""),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  // moduleId is leading — covers FK.
  index("course_lessons_module_sort_idx").on(table.moduleId, table.sortOrder),
]);

export const courseEnrollmentsTable = pgTable("course_enrollments", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  // Guest operational attendees have no account; participantId is mandatory
  // for those rows and preserves attendance/certificate identity.
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  salonId: uuid("salon_id").references(() => salonsTable.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").references(() => employeesTable.id, { onDelete: "set null" }),
  sessionId: uuid("session_id").references(() => courseSessionsTable.id, { onDelete: "set null" }),
  purchaserId: uuid("purchaser_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: educationEnrollmentStatusEnum("status").notNull().default("pending"),
  paymentStatus: educationPaymentStatusEnum("payment_status").notNull().default("pending"),
  // Amount actually charged to the purchaser for this seat, in minor units.
  // Captured at request time so group discounts survive into settlement,
  // escrow, ledger and refunds. Null means "fall back to the course price".
  chargedAmount: integer("charged_amount"),
  progress: integer("progress").notNull().default(0),
  nextLesson: text("next_lesson"),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
  accessGrantedAt: timestamp("access_granted_at", { withTimezone: true }),
  accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
  accessDaysSnapshot: integer("access_days_snapshot"),
  coursePriceSnapshot: integer("course_price_snapshot"),
  extensionPricesSnapshot: jsonb("extension_prices_snapshot").$type<{ oneMonth: number | null; threeMonths: number | null; sixMonths: number | null }>(),
  digitalContentConsentAt: timestamp("digital_content_consent_at", { withTimezone: true }),
  digitalContentConsentUserId: uuid("digital_content_consent_user_id").references(() => usersTable.id, { onDelete: "restrict" }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  certificateIssuedAt: timestamp("certificate_issued_at", { withTimezone: true }),
  certificateNumber: text("certificate_number"),
  certificatePath: text("certificate_path"),
  auditData: jsonb("audit_data").$type<Record<string, unknown>>().notNull().default({}),
  idempotencyKey: text("idempotency_key"),
  idempotencyFingerprint: text("idempotency_fingerprint"),
  // Set only by the bundle settlement transaction.  A non-null value means
  // financial responsibility belongs exclusively to education_bundle_purchases.
  bundlePurchaseId: uuid("bundle_purchase_id").references((): any => educationBundlePurchasesTable.id, { onDelete: "restrict" }),
  bookingGroupId: uuid("booking_group_id").references((): any => educationBookingGroupsTable.id, { onDelete: "set null" }),
  participantId: uuid("participant_id").references((): any => educationBookingParticipantsTable.id, { onDelete: "set null" }),
  participantKey: text("participant_key").generatedAlwaysAs(
    sql`coalesce(employee_id::text, '00000000-0000-0000-0000-000000000000')`,
  ),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // courseId is leading in the unique index — covers FK.
  uniqueIndex("course_enrollments_course_purchaser_participant_unique")
    .on(table.courseId, table.purchaserId, table.participantKey)
    .where(sql`${table.participantId} is null and ${table.status} <> 'cancelled'`),
  // purchaserId is leading in idempotency unique — covers purchaser FK.
  uniqueIndex("course_enrollments_purchaser_idempotency_unique")
    .on(table.purchaserId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} is not null`),
  // sessionId is leading — covers FK.
  index("course_enrollments_session_status_idx").on(table.sessionId, table.status),
  // Leading FK coverage for userId, salonId, employeeId.
  index("course_enrollments_user_status_idx").on(table.userId, table.status),
  index("course_enrollments_salon_idx").on(table.salonId),
  index("course_enrollments_employee_idx").on(table.employeeId),
  index("course_enrollments_booking_group_idx").on(table.bookingGroupId),
  index("course_enrollments_bundle_purchase_idx").on(table.bundlePurchaseId),
  index("course_enrollments_access_expiry_idx").on(table.userId, table.accessExpiresAt),
  index("course_enrollments_digital_consent_user_idx").on(table.digitalContentConsentUserId),
  uniqueIndex("course_enrollments_participant_active_unique").on(table.participantId).where(sql`${table.participantId} is not null and ${table.status} <> 'cancelled'`),
  check("course_enrollments_operational_user_check", sql`${table.userId} is not null or ${table.participantId} is not null`),
]);

export const educationAccessExtensionsTable = pgTable("education_access_extensions", {
  id: uuid("id").defaultRandom().primaryKey(),
  enrollmentId: uuid("enrollment_id").notNull().references(() => courseEnrollmentsTable.id, { onDelete: "restrict" }),
  purchaserId: uuid("purchaser_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  months: integer("months").notNull(),
  amount: integer("amount").notNull(),
  status: text("status").notNull().default("pending"),
  previousAccessExpiresAt: timestamp("previous_access_expires_at", { withTimezone: true }).notNull(),
  extendedAccessExpiresAt: timestamp("extended_access_expires_at", { withTimezone: true }).notNull(),
  paymentObligationId: uuid("payment_obligation_id").references(() => educationPaymentObligationsTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
}, (table) => [
  index("education_access_extensions_enrollment_idx").on(table.enrollmentId, table.createdAt),
  index("education_access_extensions_purchaser_idx").on(table.purchaserId),
  index("education_access_extensions_payment_obligation_idx").on(table.paymentObligationId),
  check("education_access_extensions_months_check", sql`${table.months} in (1,3,6)`),
  check("education_access_extensions_amount_check", sql`${table.amount} >= 0`),
  check("education_access_extensions_status_check", sql`${table.status} in ('pending','settled','cancelled')`),
]);

/**
 * Gift vouchers use a SHA-256 lookup digest, never the redeemable plaintext.
 * Course identity, title, price, center and purchaser/recipient are immutable purchase snapshots.
 */
export const educationGiftVouchersTable = pgTable("education_gift_vouchers", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "restrict" }),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "restrict" }),
  purchaserId: uuid("purchaser_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  recipientUserId: uuid("recipient_user_id").references(() => usersTable.id, { onDelete: "restrict" }),
  recipientEmail: text("recipient_email"),
  recipientNameSnapshot: text("recipient_name_snapshot"),
  giftMessageSnapshot: text("gift_message_snapshot"),
  courseTitleSnapshot: text("course_title_snapshot").notNull(),
  courseImageUrlSnapshot: text("course_image_url_snapshot").notNull(),
  amountSnapshot: integer("amount_snapshot").notNull(),
  currencySnapshot: text("currency_snapshot").notNull().default("RSD"),
  codeHash: text("code_hash").notNull().unique(),
  codeLast4: text("code_last4").notNull(),
  status: educationGiftVoucherStatusEnum("status").notNull().default("pending_payment"),
  paymentReference: text("payment_reference").notNull().unique(),
  idempotencyKey: text("idempotency_key"),
  settledByUserId: uuid("settled_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  redeemedByUserId: uuid("redeemed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  redeemedEnrollmentId: uuid("redeemed_enrollment_id").unique().references(() => courseEnrollmentsTable.id, { onDelete: "restrict" }),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  refundedByUserId: uuid("refunded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  refundNote: text("refund_note"),
  disputeId: uuid("dispute_id").references(() => educationDisputesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("education_gift_vouchers_purchaser_idempotency_unique").on(table.purchaserId, table.idempotencyKey).where(sql`${table.idempotencyKey} is not null`),
  index("education_gift_vouchers_purchaser_created_idx").on(table.purchaserId, table.createdAt, table.id),
  index("education_gift_vouchers_recipient_created_idx").on(table.recipientUserId, table.createdAt, table.id),
  index("education_gift_vouchers_center_status_idx").on(table.centerId, table.status, table.createdAt),
  index("education_gift_vouchers_course_idx").on(table.courseId),
  index("education_gift_vouchers_settled_by_idx").on(table.settledByUserId),
  index("education_gift_vouchers_redeemed_by_idx").on(table.redeemedByUserId),
  index("education_gift_vouchers_refunded_by_idx").on(table.refundedByUserId),
  index("education_gift_vouchers_dispute_idx").on(table.disputeId),
  check("education_gift_vouchers_amount_check", sql`${table.amountSnapshot} >= 0`),
  check("education_gift_vouchers_recipient_check", sql`num_nonnulls(${table.recipientUserId}, ${table.recipientEmail}) >= 1`),
]);

export const educationWaitlistTable = pgTable("education_waitlist", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => courseSessionsTable.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  purchaserId: uuid("purchaser_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").references(() => employeesTable.id, { onDelete: "set null" }),
  position: integer("position").notNull(),
  status: educationWaitlistStatusEnum("status").notNull().default("waiting"),
  offeredAt: timestamp("offered_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // sessionId is leading in both uniques — covers that FK.
  uniqueIndex("education_waitlist_session_user_unique").on(table.sessionId, table.userId).where(sql`${table.status} in ('waiting', 'offered')`),
  uniqueIndex("education_waitlist_session_position_unique").on(table.sessionId, table.position).where(sql`${table.status} in ('waiting', 'offered')`),
  index("education_waitlist_session_status_idx").on(table.sessionId, table.status, table.position),
  // Leading FK coverage for courseId, userId, purchaserId, employeeId.
  index("education_waitlist_course_idx").on(table.courseId),
  index("education_waitlist_user_idx").on(table.userId),
  index("education_waitlist_purchaser_idx").on(table.purchaserId),
  index("education_waitlist_employee_idx").on(table.employeeId),
]);

export const educationInstructorsTable = pgTable("education_instructors", {
  id: uuid("id").defaultRandom().primaryKey(),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  fullName: text("full_name").notNull(),
  photoUrl: text("photo_url"),
  biography: text("biography").notNull().default(""),
  industryYears: integer("industry_years").notNull().default(0),
  experienceYears: integer("experience_years").notNull().default(0),
  specializations: jsonb("specializations").$type<string[]>().notNull().default([]),
  qualifications: jsonb("qualifications").$type<string[]>().notNull().default([]),
  portfolioMedia: jsonb("portfolio_media").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for centerId and userId.
  index("education_instructors_center_idx").on(table.centerId),
  index("education_instructors_user_idx").on(table.userId),
]);

/**
 * Tenant authorization source for operational Education routes. A partial
 * unique index is the database backstop for the single-active-center educator
 * invariant; owner/manager memberships may legitimately span centers.
 */
export const educationCenterStaffTable = pgTable("education_center_staff", {
  id: uuid("id").defaultRandom().primaryKey(),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  instructorProfileId: uuid("instructor_profile_id").references(() => educationInstructorsTable.id, { onDelete: "set null" }),
  role: educationStaffRoleEnum("role").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("education_center_staff_center_user_unique").on(table.centerId, table.userId),
  uniqueIndex("education_center_staff_one_active_educator_center_unique")
    .on(table.userId).where(sql`${table.role} = 'educator' and ${table.active}`),
  index("education_center_staff_center_role_active_idx").on(table.centerId, table.role, table.active),
  index("education_center_staff_instructor_profile_idx").on(table.instructorProfileId),
]);

export const educationEducatorWeeklyAvailabilityTable = pgTable("education_educator_weekly_availability", {
  id: uuid("id").defaultRandom().primaryKey(),
  staffId: uuid("staff_id").notNull().references(() => educationCenterStaffTable.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("education_educator_weekly_availability_unique").on(table.staffId, table.weekday, table.startTime, table.endTime),
  check("education_educator_weekly_availability_weekday_check", sql`${table.weekday} between 1 and 7`),
  check("education_educator_weekly_availability_interval_check", sql`${table.startTime} < ${table.endTime}`),
]);

export const educationEducatorAbsencesTable = pgTable("education_educator_absences", {
  id: uuid("id").defaultRandom().primaryKey(),
  staffId: uuid("staff_id").notNull().references(() => educationCenterStaffTable.id, { onDelete: "cascade" }),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  startTime: text("start_time"),
  endTime: text("end_time"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("education_educator_absences_staff_dates_idx").on(table.staffId, table.startDate, table.endDate),
  check("education_educator_absences_date_check", sql`${table.endDate} >= ${table.startDate}`),
  check("education_educator_absences_time_check", sql`(${table.startTime} is null and ${table.endTime} is null) or (${table.startTime} is not null and ${table.endTime} is not null and ${table.startTime} < ${table.endTime})`),
]);

/** Assigns both fixed-group meetings and generated individual slots. */
export const educationSessionEducatorsTable = pgTable("education_session_educators", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().unique().references(() => courseSessionsTable.id, { onDelete: "cascade" }),
  staffId: uuid("staff_id").notNull().references(() => educationCenterStaffTable.id, { onDelete: "restrict" }),
  assignedByUserId: uuid("assigned_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("education_session_educators_staff_idx").on(table.staffId),
  index("education_session_educators_assigned_by_idx").on(table.assignedByUserId),
]);

/** Durable receipt for an atomic individual-calendar recurrence command. */
export const educationRecurrenceCommandsTable = pgTable("education_recurrence_commands", {
  id: uuid("id").defaultRandom().primaryKey(),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  responseSnapshot: jsonb("response_snapshot").$type<{ sessionIds: string[]; replayed: boolean }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("education_recurrence_commands_actor_key_unique").on(table.actorUserId, table.idempotencyKey),
  index("education_recurrence_commands_center_created_idx").on(table.centerId, table.createdAt),
  check("education_recurrence_commands_key_check", sql`length(btrim(${table.idempotencyKey})) > 0`),
  check("education_recurrence_commands_fingerprint_check", sql`length(${table.requestFingerprint}) = 64`),
]);

export const educationBookingGroupsTable = pgTable("education_booking_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => courseSessionsTable.id, { onDelete: "set null" }),
  purchaserId: uuid("purchaser_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByUserId: uuid("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  status: educationBookingGroupStatusEnum("status").notNull().default("pending"),
  idempotencyKey: text("idempotency_key").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("education_booking_groups_actor_idempotency_unique").on(table.createdByUserId, table.idempotencyKey),
  index("education_booking_groups_center_session_status_idx").on(table.centerId, table.sessionId, table.status),
  index("education_booking_groups_course_idx").on(table.courseId),
  index("education_booking_groups_session_idx").on(table.sessionId),
  index("education_booking_groups_purchaser_idx").on(table.purchaserId),
]);

export const educationBookingParticipantsTable = pgTable("education_booking_participants", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingGroupId: uuid("booking_group_id").notNull().references(() => educationBookingGroupsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  fullName: text("full_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  status: educationParticipantStatusEnum("status").notNull().default("reserved"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("education_booking_participants_group_status_idx").on(table.bookingGroupId, table.status),
  index("education_booking_participants_user_idx").on(table.userId),
  check("education_booking_participants_contact_check", sql`${table.userId} is not null or ${table.email} is not null or ${table.phone} is not null`),
]);

export const educationAttendanceTable = pgTable("education_attendance", {
  id: uuid("id").defaultRandom().primaryKey(),
  participantId: uuid("participant_id").notNull().references(() => educationBookingParticipantsTable.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => courseSessionsTable.id, { onDelete: "cascade" }),
  status: educationAttendanceStatusEnum("status").notNull(),
  recordedByUserId: uuid("recorded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("education_attendance_participant_session_unique").on(table.participantId, table.sessionId),
  index("education_attendance_session_idx").on(table.sessionId),
  index("education_attendance_recorded_by_idx").on(table.recordedByUserId),
]);

export const educationPriceSnapshotsTable = pgTable("education_price_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingGroupId: uuid("booking_group_id").notNull().unique().references(() => educationBookingGroupsTable.id, { onDelete: "restrict" }),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "restrict" }),
  grossAmount: integer("gross_amount").notNull(),
  platformFee: integer("platform_fee").notNull(),
  reserveAmount: integer("reserve_amount").notNull(),
  netAmount: integer("net_amount").notNull(),
  earlyBirdApplied: boolean("early_bird_applied").notNull().default(false),
  /** Immutable commercial basis; course edits must not reinterpret this quote. */
  discountReason: text("discount_reason").notNull().default("none"),
  earlyBirdCutoffSnapshot: timestamp("early_bird_cutoff_snapshot", { withTimezone: true }),
  installmentCount: integer("installment_count").notNull(),
  depositDisposition: educationDepositDispositionEnum("deposit_disposition").notNull(),
  /** Immutable absolute cutoff derived from the selected session at booking. */
  cancellationDeadlineAt: timestamp("cancellation_deadline_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("education_price_snapshots_course_idx").on(table.courseId),
  check("education_price_snapshots_amounts_check", sql`${table.grossAmount} >= 0 and ${table.platformFee} >= 0 and ${table.reserveAmount} >= 0 and ${table.netAmount} >= 0 and ${table.grossAmount} = ${table.platformFee} + ${table.reserveAmount} + ${table.netAmount}`),
  check("education_price_snapshots_installments_check", sql`${table.installmentCount} in (1, 2, 3)`),
  check("education_price_snapshots_discount_reason_check", sql`${table.discountReason} in ('none', 'early_bird', 'group', 'early_bird_and_group')`),
]);

export const educationInstallmentsTable = pgTable("education_installments", {
  id: uuid("id").defaultRandom().primaryKey(),
  priceSnapshotId: uuid("price_snapshot_id").notNull().references(() => educationPriceSnapshotsTable.id, { onDelete: "restrict" }),
  installmentNumber: integer("installment_number").notNull(),
  amount: integer("amount").notNull(),
  status: educationInstallmentStatusEnum("status").notNull().default("pending"),
  paymentReference: text("payment_reference").notNull().unique(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  settledByUserId: uuid("settled_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  refundedAmount: integer("refunded_amount").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("education_installments_snapshot_number_unique").on(table.priceSnapshotId, table.installmentNumber),
  index("education_installments_settled_by_idx").on(table.settledByUserId),
  check("education_installments_amount_check", sql`${table.amount} > 0 and ${table.refundedAmount} >= 0 and ${table.refundedAmount} <= ${table.amount}`),
]);

/** Durable receipt prevents a retry from creating a second captured slice. */
export const educationInstallmentSettlementCommandsTable = pgTable("education_installment_settlement_commands", {
  id: uuid("id").defaultRandom().primaryKey(),
  installmentId: uuid("installment_id").notNull().references(() => educationInstallmentsTable.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  responseSnapshot: jsonb("response_snapshot").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("education_installment_settlement_command_actor_key_unique").on(table.actorUserId, table.idempotencyKey),
  index("education_installment_settlement_command_installment_idx").on(table.installmentId),
  check("education_installment_settlement_command_key_check", sql`length(btrim(${table.idempotencyKey})) > 0`),
  check("education_installment_settlement_command_fingerprint_check", sql`length(${table.requestFingerprint}) = 64`),
]);

/** Durable delivery work; workers lease and retry it outside request transactions. */
export const educationOutboxTable = pgTable("education_outbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => courseSessionsTable.id, { onDelete: "cascade" }),
  participantId: uuid("participant_id").references(() => educationBookingParticipantsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: educationOutboxStatusEnum("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leasedAt: timestamp("leased_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("education_outbox_delivery_idx").on(table.status, table.availableAt),
  index("education_outbox_center_idx").on(table.centerId),
  index("education_outbox_session_idx").on(table.sessionId),
  index("education_outbox_participant_idx").on(table.participantId),
]);

export const educationNotificationsTable = pgTable("education_notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  enrollmentId: uuid("enrollment_id").references(() => courseEnrollmentsTable.id, { onDelete: "cascade" }),
  waitlistId: uuid("waitlist_id").references(() => educationWaitlistTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  actionUrl: text("action_url"),
  eventKey: text("event_key").notNull().unique(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // userId is leading — covers FK and is the primary inbox query.
  index("education_notifications_user_created_idx").on(table.userId, table.createdAt),
  // Leading FK coverage for enrollmentId and waitlistId.
  index("education_notifications_enrollment_idx").on(table.enrollmentId),
  index("education_notifications_waitlist_idx").on(table.waitlistId),
  index("education_notifications_retention_idx")
    .on(table.createdAt)
    .where(sql`${table.readAt} is not null`),
]);

export const educationEscrowsTable = pgTable("education_escrows", {
  id: uuid("id").defaultRandom().primaryKey(),
  enrollmentId: uuid("enrollment_id").notNull().unique().references(() => courseEnrollmentsTable.id, { onDelete: "cascade" }),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  grossAmount: integer("gross_amount").notNull(),
  platformFee: integer("platform_fee").notNull(),
  reserveAmount: integer("reserve_amount").notNull(),
  netAmount: integer("net_amount").notNull(),
  releaseAt: timestamp("release_at", { withTimezone: true }).notNull(),
  status: educationEscrowStatusEnum("status").notNull().default("held"),
  paymentReference: text("payment_reference"),
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  netPaidAt: timestamp("net_paid_at", { withTimezone: true }),
  reservePaidAt: timestamp("reserve_paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // centerId is leading — covers FK.
  index("education_escrows_center_status_idx").on(table.centerId, table.status),
  index("education_escrows_release_idx").on(table.status, table.releaseAt),
]);

export const educationLedgerEntriesTable = pgTable("education_ledger_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  escrowId: uuid("escrow_id").notNull().references(() => educationEscrowsTable.id, { onDelete: "cascade" }),
  enrollmentId: uuid("enrollment_id").notNull().references(() => courseEnrollmentsTable.id, { onDelete: "cascade" }),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  type: educationLedgerEntryTypeEnum("type").notNull(),
  amount: integer("amount").notNull(),
  note: text("note"),
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  idempotencyKey: text("idempotency_key").unique(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // centerId is leading — covers FK.
  index("education_ledger_center_created_idx").on(table.centerId, table.createdAt),
  // enrollmentId is leading — covers FK.
  index("education_ledger_enrollment_created_idx").on(table.enrollmentId, table.createdAt),
  // escrowId is leading in both partial uniques — covers FK.
  uniqueIndex("education_ledger_release_per_escrow_unique")
    .on(table.escrowId)
    .where(sql`${table.type} = 'release'`),
  uniqueIndex("education_ledger_refund_per_escrow_unique")
    .on(table.escrowId)
    .where(sql`${table.type} = 'refund'`),
  // Leading FK coverage for actorUserId.
  index("education_ledger_actor_idx").on(table.actorUserId),
]);

export const educationPayoutsTable = pgTable("education_payouts", {
  id: uuid("id").defaultRandom().primaryKey(),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  periodStart: date("period_start", { mode: "string" }).notNull(),
  periodEnd: date("period_end", { mode: "string" }).notNull(),
  status: educationPayoutStatusEnum("status").notNull().default("pending"),
  reference: text("reference"),
  note: text("note"),
  createdByUserId: uuid("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for centerId and createdByUserId.
  index("education_payouts_center_created_idx").on(table.centerId, table.createdAt),
  index("education_payouts_created_by_idx").on(table.createdByUserId),
]);

export const educationFinancialEventsTable = pgTable("education_financial_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  escrowId: uuid("escrow_id").references(() => educationEscrowsTable.id, { onDelete: "cascade" }),
  enrollmentId: uuid("enrollment_id").references(() => courseEnrollmentsTable.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  previousStatus: text("previous_status"),
  nextStatus: text("next_status"),
  amount: integer("amount"),
  note: text("note"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // escrowId is leading — covers FK.
  index("education_financial_events_escrow_created_idx").on(table.escrowId, table.createdAt),
  uniqueIndex("education_financial_events_release_per_escrow_unique")
    .on(table.escrowId)
    .where(sql`${table.eventType} = 'escrow_released'`),
  // Leading FK coverage for enrollmentId and actorUserId.
  index("education_financial_events_enrollment_idx").on(table.enrollmentId),
  index("education_financial_events_actor_idx").on(table.actorUserId),
]);

/** Globally configured, automatically selected education-center B2B benefit. */
export const educationB2bDiscountTiersTable = pgTable("education_b2b_discount_tiers", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  minSpendRsd: integer("min_spend_rsd").notNull(),
  maxSpendRsd: integer("max_spend_rsd"),
  discountPercent: integer("discount_percent").notNull(),
  sortOrder: integer("sort_order").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("education_b2b_discount_tiers_sort_unique").on(table.sortOrder),
  check("education_b2b_discount_tiers_range_check", sql`${table.minSpendRsd} >= 0 and (${table.maxSpendRsd} is null or ${table.maxSpendRsd} >= ${table.minSpendRsd})`),
  check("education_b2b_discount_tiers_percent_check", sql`${table.discountPercent} between 0 and 100`),
]);

export const educationB2bDiscountSettingsTable = pgTable("education_b2b_discount_settings", {
  id: boolean("id").primaryKey().default(true),
  version: integer("version").notNull().default(1),
  updatedByUserId: uuid("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("education_b2b_discount_settings_updated_by_idx").on(table.updatedByUserId),
]);

export const educationB2bDiscountAuditsTable = pgTable("education_b2b_discount_audits", {
  id: uuid("id").defaultRandom().primaryKey(),
  version: integer("version").notNull(),
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  tiersSnapshot: jsonb("tiers_snapshot").$type<unknown[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("education_b2b_discount_audits_actor_idx").on(table.actorUserId),
]);

/** Immutable quote/checkout evidence, separate from salon orders. */
export const educationB2bOrdersTable = pgTable("education_b2b_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "restrict" }),
  purchaserUserId: uuid("purchaser_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  linesSnapshot: jsonb("lines_snapshot").$type<Array<{ productId: string; name: string; quantity: number; unitPriceRsd: number }>>().notNull(),
  subtotalRsd: integer("subtotal_rsd").notNull(),
  discountRsd: integer("discount_rsd").notNull(),
  totalRsd: integer("total_rsd").notNull(),
  benefitSnapshot: jsonb("benefit_snapshot").$type<Record<string, unknown>>().notNull(),
  paymentStatus: text("payment_status").notNull().default("pending"),
  fulfillmentStatus: text("fulfillment_status").notNull().default("RECEIVED"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  refundedAmountRsd: integer("refunded_amount_rsd").notNull().default(0),
  settledByUserId: uuid("settled_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("education_b2b_orders_center_created_idx").on(table.centerId, table.createdAt),
  index("education_b2b_orders_purchaser_idx").on(table.purchaserUserId),
  index("education_b2b_orders_settled_by_idx").on(table.settledByUserId),
  index("education_b2b_orders_qualified_spend_idx").on(table.centerId, table.paymentStatus, table.fulfillmentStatus, table.completedAt),
  check("education_b2b_orders_payment_status_check", sql`${table.paymentStatus} in ('pending','paid','refunded','cancelled')`),
  check("education_b2b_orders_fulfillment_status_check", sql`${table.fulfillmentStatus} in ('RECEIVED','PREPARING','PACKING','SHIPPED','COMPLETED','CANCELLED')`),
  check("education_b2b_orders_refund_check", sql`${table.refundedAmountRsd} >= 0 and ${table.refundedAmountRsd} <= ${table.totalRsd}`),
]);

export const educationB2bOrderItemsTable = pgTable("education_b2b_order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => educationB2bOrdersTable.id, { onDelete: "restrict" }),
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  unitPriceRsd: integer("unit_price_rsd").notNull(),
  lineTotalRsd: integer("line_total_rsd").notNull(),
}, (table) => [
  index("education_b2b_order_items_order_idx").on(table.orderId),
  index("education_b2b_order_items_product_idx").on(table.productId),
]);

// Center operations are deliberately separate from salon stock and scheduling.
export const educationResourcesTable = pgTable("education_resources", {
  id: uuid("id").defaultRandom().primaryKey(), centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), name: text("name").notNull(), capacity: integer("capacity"), active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("education_resources_center_kind_idx").on(t.centerId, t.kind), check("education_resources_kind_check", sql`${t.kind} in ('room','equipment')`)]);
export const educationSessionResourcesTable = pgTable("education_session_resources", {
  id: uuid("id").defaultRandom().primaryKey(), resourceId: uuid("resource_id").notNull().references(() => educationResourcesTable.id, { onDelete: "restrict" }),
  sessionId: uuid("session_id").notNull().references(() => courseSessionsTable.id, { onDelete: "cascade" }), quantity: integer("quantity").notNull().default(1),
}, (t) => [
  uniqueIndex("education_session_resources_unique").on(t.resourceId, t.sessionId),
  index("education_session_resources_session_idx").on(t.sessionId),
  check("education_session_resources_quantity_check", sql`${t.quantity} > 0`),
]);
export const educationInventoryItemsTable = pgTable("education_inventory_items", {
  id: uuid("id").defaultRandom().primaryKey(), centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => productsTable.id, { onDelete: "restrict" }), name: text("name").notNull(), quantityOnHand: integer("quantity_on_hand").notNull().default(0),
  reorderLevel: integer("reorder_level").notNull().default(0), active: boolean("active").notNull().default(true), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("education_inventory_center_idx").on(t.centerId),
  index("education_inventory_product_idx").on(t.productId),
  check("education_inventory_nonnegative_check", sql`${t.quantityOnHand} >= 0 and ${t.reorderLevel} >= 0`),
]);
export const educationInventoryMovementsTable = pgTable("education_inventory_movements", {
  id: uuid("id").defaultRandom().primaryKey(), itemId: uuid("item_id").notNull().references(() => educationInventoryItemsTable.id, { onDelete: "restrict" }),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "restrict" }), delta: integer("delta").notNull(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "set null" }), sessionId: uuid("session_id").references(() => courseSessionsTable.id, { onDelete: "set null" }),
  note: text("note").notNull(), actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("education_inventory_movements_item_created_idx").on(t.itemId, t.createdAt),
  index("education_inventory_movements_center_idx").on(t.centerId),
  index("education_inventory_movements_course_idx").on(t.courseId),
  index("education_inventory_movements_session_idx").on(t.sessionId),
  index("education_inventory_movements_actor_idx").on(t.actorUserId),
  check("education_inventory_movements_delta_check", sql`${t.delta} <> 0`),
]);
export const educationBundlesTable = pgTable("education_bundles", {
  id: uuid("id").defaultRandom().primaryKey(), centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(), description: text("description").notNull().default(""), price: integer("price").notNull(), active: boolean("active").notNull().default(true),
  published: boolean("published").notNull().default(false), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("education_bundles_center_published_idx").on(t.centerId, t.published), check("education_bundles_price_check", sql`${t.price} >= 0`)]);
export const educationBundleCoursesTable = pgTable("education_bundle_courses", {
  bundleId: uuid("bundle_id").notNull().references(() => educationBundlesTable.id, { onDelete: "cascade" }), courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "restrict" }), sortOrder: integer("sort_order").notNull(),
}, (t) => [
  uniqueIndex("education_bundle_courses_unique").on(t.bundleId, t.courseId),
  uniqueIndex("education_bundle_courses_order_unique").on(t.bundleId, t.sortOrder),
  index("education_bundle_courses_course_idx").on(t.courseId),
]);

/**
 * Immutable commercial boundary for an education package.  Do not add an
 * enrollment-level escrow for rows linked to this record: settlement creates
 * one parent escrow and its ledger entries, then materializes child access.
 */
export const educationBundlePurchasesTable = pgTable("education_bundle_purchases", {
  id: uuid("id").defaultRandom().primaryKey(),
  bundleId: uuid("bundle_id").notNull().references(() => educationBundlesTable.id, { onDelete: "restrict" }),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "restrict" }),
  purchaserId: uuid("purchaser_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  targetType: educationBundlePurchaseTargetEnum("target_type").notNull(),
  learnerUserId: uuid("learner_user_id").references(() => usersTable.id, { onDelete: "restrict" }),
  salonId: uuid("salon_id").references(() => salonsTable.id, { onDelete: "restrict" }),
  employeeId: uuid("employee_id").references(() => employeesTable.id, { onDelete: "restrict" }),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("RSD"),
  status: educationBundlePurchaseStatusEnum("status").notNull().default("pending_payment"),
  paymentMethod: paymentMethodEnum("payment_method"),
  paymentInstructions: jsonb("payment_instructions").$type<Record<string, unknown>>().notNull().default({}),
  idempotencyKey: text("idempotency_key").notNull(),
  idempotencyFingerprint: text("idempotency_fingerprint").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  settledByUserId: uuid("settled_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  auditData: jsonb("audit_data").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("education_bundle_purchases_purchaser_idempotency_unique").on(t.purchaserId, t.idempotencyKey),
  index("education_bundle_purchases_center_status_idx").on(t.centerId, t.status),
  index("education_bundle_purchases_purchaser_requested_idx").on(t.purchaserId, t.requestedAt),
  index("education_bundle_purchases_bundle_idx").on(t.bundleId),
  index("education_bundle_purchases_learner_idx").on(t.learnerUserId),
  index("education_bundle_purchases_salon_idx").on(t.salonId),
  index("education_bundle_purchases_employee_idx").on(t.employeeId),
  index("education_bundle_purchases_settled_by_idx").on(t.settledByUserId),
  check("education_bundle_purchases_amount_check", sql`${t.amount} >= 0`),
  check("education_bundle_purchases_target_check", sql`(${t.targetType} = 'individual' and ${t.learnerUserId} is not null and ${t.salonId} is null and ${t.employeeId} is null) or (${t.targetType} = 'salon_employee' and ${t.learnerUserId} is not null and ${t.salonId} is not null and ${t.employeeId} is not null)`),
]);

/** Course and terms as they were when the parent purchase was requested. */
export const educationBundlePurchaseItemsTable = pgTable("education_bundle_purchase_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  purchaseId: uuid("purchase_id").notNull().references(() => educationBundlePurchasesTable.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "restrict" }),
  courseTitle: text("course_title").notNull(),
  courseTerms: jsonb("course_terms").$type<Record<string, unknown>>().notNull().default({}),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("education_bundle_purchase_items_course_unique").on(t.purchaseId, t.courseId),
  uniqueIndex("education_bundle_purchase_items_order_unique").on(t.purchaseId, t.sortOrder),
  index("education_bundle_purchase_items_course_idx").on(t.courseId),
]);

/** One and only one escrow for the bundle purchase's full financial amount. */
export const educationBundlePurchaseEscrowsTable = pgTable("education_bundle_purchase_escrows", {
  id: uuid("id").defaultRandom().primaryKey(),
  purchaseId: uuid("purchase_id").notNull().unique().references(() => educationBundlePurchasesTable.id, { onDelete: "cascade" }),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "restrict" }),
  grossAmount: integer("gross_amount").notNull(),
  platformFeeAmount: integer("platform_fee_amount").notNull().default(0),
  reserveAmount: integer("reserve_amount").notNull().default(0),
  netAmount: integer("net_amount").notNull(),
  status: educationEscrowStatusEnum("status").notNull().default("held"),
  releaseAt: timestamp("release_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("education_bundle_purchase_escrows_center_status_idx").on(t.centerId, t.status),
  check("education_bundle_purchase_escrows_amounts_check", sql`${t.grossAmount} >= 0 and ${t.platformFeeAmount} >= 0 and ${t.reserveAmount} >= 0 and ${t.netAmount} >= 0 and ${t.platformFeeAmount} + ${t.reserveAmount} <= ${t.grossAmount} and ${t.netAmount} = ${t.grossAmount} - ${t.platformFeeAmount} - ${t.reserveAmount}`),
]);

/** Parent-only accounting entries.  Child enrollment projections have none. */
export const educationBundlePurchaseLedgerEntriesTable = pgTable("education_bundle_purchase_ledger_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  escrowId: uuid("escrow_id").notNull().references(() => educationBundlePurchaseEscrowsTable.id, { onDelete: "cascade" }),
  entryType: educationLedgerEntryTypeEnum("entry_type").notNull(),
  amount: integer("amount").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [
  index("education_bundle_purchase_ledger_escrow_created_idx").on(t.escrowId, t.createdAt),
  uniqueIndex("education_bundle_purchase_ledger_charge_unique").on(t.escrowId).where(sql`${t.entryType} = 'charge'`),
  uniqueIndex("education_bundle_purchase_ledger_fee_unique").on(t.escrowId).where(sql`${t.entryType} = 'platform_fee'`),
  uniqueIndex("education_bundle_purchase_ledger_reserve_unique").on(t.escrowId).where(sql`${t.entryType} = 'reserve_hold'`),
]);
export const educationContactHistoryTable = pgTable("education_contact_history", {
  id: uuid("id").defaultRandom().primaryKey(), centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  learnerUserId: uuid("learner_user_id").references(() => usersTable.id, { onDelete: "set null" }), enrollmentId: uuid("enrollment_id").references(() => courseEnrollmentsTable.id, { onDelete: "set null" }),
  channel: text("channel").notNull(), note: text("note").notNull(), actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("education_contact_history_center_learner_idx").on(t.centerId, t.learnerUserId, t.createdAt),
  index("education_contact_history_learner_idx").on(t.learnerUserId),
  index("education_contact_history_enrollment_idx").on(t.enrollmentId),
  index("education_contact_history_actor_idx").on(t.actorUserId),
]);

export const educationDisputesTable = pgTable("education_disputes", {
  id: uuid("id").defaultRandom().primaryKey(),
  enrollmentId: uuid("enrollment_id").notNull().references(() => courseEnrollmentsTable.id, { onDelete: "cascade" }),
  openedByUserId: uuid("opened_by_user_id").notNull().references(() => usersTable.id),
  reason: text("reason").notNull(),
  details: text("details").notNull(),
  status: educationDisputeStatusEnum("status").notNull().default("open"),
  resolutionNote: text("resolution_note"),
  resolvedByUserId: uuid("resolved_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("education_disputes_status_created_idx").on(table.status, table.createdAt),
  // enrollmentId is leading in partial unique — covers FK.
  uniqueIndex("education_disputes_one_active_per_enrollment_unique")
    .on(table.enrollmentId)
    .where(sql`${table.status} in ('open', 'under_review')`),
  // Leading FK coverage for openedByUserId and resolvedByUserId.
  index("education_disputes_opened_by_idx").on(table.openedByUserId),
  index("education_disputes_resolved_by_idx").on(table.resolvedByUserId),
]);

export const educationThreadsTable = pgTable("education_threads", {
  id: uuid("id").defaultRandom().primaryKey(),
  enrollmentId: uuid("enrollment_id").notNull().unique().references(() => courseEnrollmentsTable.id, { onDelete: "cascade" }),
  purchaserId: uuid("purchaser_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  status: educationThreadStatusEnum("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for purchaserId and centerId.
  index("education_threads_purchaser_idx").on(table.purchaserId),
  index("education_threads_center_idx").on(table.centerId),
]);

export const educationMessagesTable = pgTable("education_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  threadId: uuid("thread_id").notNull().references(() => educationThreadsTable.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // threadId is leading — covers FK.
  index("education_messages_thread_created_idx").on(table.threadId, table.createdAt),
  // Leading FK coverage for senderId.
  index("education_messages_sender_idx").on(table.senderId),
]);

export const lessonProgressTable = pgTable("lesson_progress", {
  id: uuid("id").defaultRandom().primaryKey(),
  enrollmentId: uuid("enrollment_id").notNull().references(() => courseEnrollmentsTable.id, { onDelete: "cascade" }),
  lessonId: uuid("lesson_id").notNull().references(() => courseLessonsTable.id, { onDelete: "cascade" }),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  completedByUserId: uuid("completed_by_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
}, (table) => [
  // enrollmentId is leading in unique — covers FK.
  uniqueIndex("lesson_progress_enrollment_lesson_unique").on(table.enrollmentId, table.lessonId),
  index("lesson_progress_enrollment_idx").on(table.enrollmentId),
  // Leading FK coverage for lessonId and completedByUserId.
  index("lesson_progress_lesson_idx").on(table.lessonId),
  index("lesson_progress_completed_by_idx").on(table.completedByUserId),
]);

// ---------------------------------------------------------------------------
// Education notification archive.
// Immutable copy of education_notifications rows, keyed by the originating
// notification id (sourceId = education_notifications.event_key).
// ---------------------------------------------------------------------------
export const educationNotificationArchivesTable = pgTable("education_notification_archives", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Stable reference back to education_notifications.event_key. */
  sourceId: text("source_id").notNull().unique(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  originalCreatedAt: timestamp("original_created_at", { withTimezone: true }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("education_notification_archives_archived_at_idx").on(table.archivedAt),
]);
