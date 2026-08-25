import {
  boolean,
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
import { paymentMethodEnum, subscriptionStatusEnum, subscriptionPlansTable } from "./commerce";

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
  websiteUrl: text("website_url"),
  instagramUrl: text("instagram_url"),
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
]);

export const educationCenterSubscriptionsTable = pgTable("education_center_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  centerId: uuid("center_id").notNull().unique().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => subscriptionPlansTable.id),
  status: subscriptionStatusEnum("status").notNull().default("trial"),
  dueAmount: integer("due_amount").notNull().default(0),
  paymentMethod: paymentMethodEnum("payment_method").notNull().default("BANK_TRANSFER"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for planId (all education centers on a plan).
  index("education_center_subscriptions_plan_idx").on(table.planId),
]);

export const educationPlatformSettingsTable = pgTable("education_platform_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  commissionPercent: integer("commission_percent").notNull().default(15),
  reservePercent: integer("reserve_percent").notNull().default(10),
  onlineRefundDays: integer("online_refund_days").notNull().default(14),
  liveAppealDays: integer("live_appeal_days").notNull().default(7),
  featuredCoursePrice: integer("featured_course_price").notNull().default(0),
  updatedByUserId: uuid("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for updatedByUserId (audit trail).
  index("education_platform_settings_updated_by_idx").on(table.updatedByUserId),
]);

export const courseCategoriesTable = pgTable("course_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
});

export const coursesTable = pgTable("courses", {
  id: uuid("id").defaultRandom().primaryKey(),
  centerId: uuid("center_id").references(() => educationCentersTable.id, { onDelete: "cascade" }),
  salonId: uuid("salon_id").references(() => salonsTable.id, { onDelete: "cascade" }),
  instructorId: uuid("instructor_id").references(() => usersTable.id, { onDelete: "set null" }),
  instructorProfileId: uuid("instructor_profile_id").references((): any => educationInstructorsTable.id, { onDelete: "set null" }),
  categoryId: uuid("category_id").references(() => courseCategoriesTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull(),
  format: courseFormatEnum("format").notNull(),
  city: text("city"),
  price: integer("price").notNull(),
  duration: text("duration").notNull(),
  level: educationCourseLevelEnum("level").notNull().default("all-levels"),
  learningOutcomes: jsonb("learning_outcomes").$type<string[]>().notNull().default([]),
  includedItems: jsonb("included_items").$type<string[]>().notNull().default([]),
  requirements: text("requirements").notNull().default(""),
  rating: integer("rating").notNull().default(0),
  certification: boolean("certification").notNull().default(false),
  imageUrl: text("image_url").notNull(),
  isTest: boolean("is_test").notNull().default(false),
  published: boolean("published").notNull().default(true),
  archived: boolean("archived").notNull().default(false),
  isFeatured: boolean("is_featured").notNull().default(false),
  featuredUntil: timestamp("featured_until", { withTimezone: true }),
  featuredActivatedAt: timestamp("featured_activated_at", { withTimezone: true }),
  featuredFee: integer("featured_fee").notNull().default(0),
  refundPolicy: text("refund_policy").notNull().default("Povraćaj je moguć do isteka roka zaštite kupovine. Ako centar otkaže termin, kupovina se refundira u celosti."),
  groupDiscountMinimum: integer("group_discount_minimum"),
  groupDiscountPercent: integer("group_discount_percent"),
  startDate: date("start_date", { mode: "string" }),
  endDate: date("end_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Course catalog: published/active courses by center, category, format, city.
  index("courses_center_published_idx").on(table.centerId, table.published, table.archived),
  index("courses_category_published_idx").on(table.categoryId, table.published, table.archived),
  index("courses_format_city_published_idx").on(table.format, table.city, table.published),
  index("courses_featured_until_idx").on(table.isFeatured, table.featuredUntil),
  // Directory ORDER BY created_at (published/active courses sorted by newest).
  index("courses_published_archived_created_idx").on(table.published, table.archived, table.createdAt),
  // Leading FK coverage for salonId, instructorId, instructorProfileId.
  index("courses_salon_idx").on(table.salonId),
  index("courses_instructor_idx").on(table.instructorId),
  index("courses_instructor_profile_idx").on(table.instructorProfileId),
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
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
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
  completedAt: timestamp("completed_at", { withTimezone: true }),
  certificateIssuedAt: timestamp("certificate_issued_at", { withTimezone: true }),
  certificateNumber: text("certificate_number"),
  certificatePath: text("certificate_path"),
  auditData: jsonb("audit_data").$type<Record<string, unknown>>().notNull().default({}),
  idempotencyKey: text("idempotency_key"),
  idempotencyFingerprint: text("idempotency_fingerprint"),
  participantKey: text("participant_key").generatedAlwaysAs(
    sql`coalesce(employee_id::text, '00000000-0000-0000-0000-000000000000')`,
  ),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // courseId is leading in the unique index — covers FK.
  uniqueIndex("course_enrollments_course_purchaser_participant_unique")
    .on(table.courseId, table.purchaserId, table.participantKey)
    .where(sql`${table.status} <> 'cancelled'`),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for centerId and userId.
  index("education_instructors_center_idx").on(table.centerId),
  index("education_instructors_user_idx").on(table.userId),
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
