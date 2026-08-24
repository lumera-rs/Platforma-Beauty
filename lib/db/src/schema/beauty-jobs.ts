import {
  boolean,
  check,
  doublePrecision,
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
import { salonsTable, usersTable } from "./core";

/** Beauty Poslovi is deliberately separate from the service taxonomy. */
export const beautyJobListingTypeEnum = pgEnum("beauty_job_listing_type", [
  "job", "equipment_rental", "space_rental", "freelance",
]);
export const beautyJobListingIntentEnum = pgEnum("beauty_job_listing_intent", ["offering", "seeking"]);
export const beautyJobListingStatusEnum = pgEnum("beauty_job_listing_status", [
  "active", "expired", "closed", "rejected",
]);
export const beautyJobModerationStatusEnum = pgEnum("beauty_job_moderation_status", [
  "pending", "approved", "rejected",
]);
export const beautyJobPostedByTypeEnum = pgEnum("beauty_job_posted_by_type", ["salon", "user"]);
export const beautyJobPricePeriodEnum = pgEnum("beauty_job_price_period", [
  "hour", "day", "week", "month", "project", "fixed",
]);
export const beautyJobContactStatusEnum = pgEnum("beauty_job_contact_status", [
  "pending", "viewed", "accepted", "declined", "replied",
]);
export const beautyJobReportStatusEnum = pgEnum("beauty_job_report_status", [
  "pending", "resolved", "dismissed",
]);

export const beautyJobCategoriesTable = pgTable("beauty_job_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull().unique(),
  subtypeLabels: jsonb("subtype_labels").$type<string[]>().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  featureFlag: text("feature_flag"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const beautyJobPlatformSettingsTable = pgTable("beauty_job_platform_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  listingExpiryDays: integer("listing_expiry_days").notNull().default(30),
  hourlyPostingLimit: integer("hourly_posting_limit").notNull().default(5),
  updatedByUserId: uuid("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("beauty_job_platform_settings_updated_by_idx").on(table.updatedByUserId),
  check("beauty_job_platform_settings_expiry_positive", sql`${table.listingExpiryDays} > 0`),
  check("beauty_job_platform_settings_limit_positive", sql`${table.hourlyPostingLimit} > 0`),
]);

export const beautyJobListingsTable = pgTable("beauty_job_listings", {
  id: uuid("id").defaultRandom().primaryKey(),
  categoryId: uuid("category_id").notNull().references(() => beautyJobCategoriesTable.id, { onDelete: "restrict" }),
  salonId: uuid("salon_id").references(() => salonsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  postedByType: beautyJobPostedByTypeEnum("posted_by_type").notNull(),
  type: beautyJobListingTypeEnum("type").notNull(),
  intent: beautyJobListingIntentEnum("intent").notNull().default("offering"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  city: text("city").notNull(),
  region: text("region").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  priceAmount: integer("price_amount"),
  pricePeriod: beautyJobPricePeriodEnum("price_period"),
  negotiable: boolean("negotiable").notNull().default(false),
  photos: jsonb("photos").$type<string[]>().notNull().default([]),
  status: beautyJobListingStatusEnum("status").notNull().default("active"),
  moderationStatus: beautyJobModerationStatusEnum("moderation_status").notNull().default("pending"),
  contactCount: integer("contact_count").notNull().default(0),
  viewCount: integer("view_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("beauty_job_listings_category_visibility_created_idx").on(table.categoryId, table.intent, table.status, table.moderationStatus, table.createdAt),
  index("beauty_job_listings_city_region_idx").on(table.city, table.region),
  index("beauty_job_listings_salon_created_idx").on(table.salonId, table.createdAt),
  index("beauty_job_listings_user_created_idx").on(table.userId, table.createdAt),
  index("beauty_job_listings_expiry_idx").on(table.status, table.expiresAt),
  check("beauty_job_listings_exactly_one_author", sql`((${table.salonId} is not null)::integer + (${table.userId} is not null)::integer) = 1`),
  check("beauty_job_listings_posted_by_matches_author", sql`(${table.postedByType} = 'salon' and ${table.salonId} is not null and ${table.userId} is null) or (${table.postedByType} = 'user' and ${table.userId} is not null and ${table.salonId} is null)`),
  check("beauty_job_listings_price_nonnegative", sql`${table.priceAmount} is null or ${table.priceAmount} >= 0`),
  check("beauty_job_listings_coordinates_pair", sql`(${table.latitude} is null) = (${table.longitude} is null)`),
]);

/** No address column by design: rental privacy is a schema-level invariant. */
export const beautyJobListingAvailabilityTable = pgTable("beauty_job_listing_availability", {
  listingId: uuid("listing_id").primaryKey().references(() => beautyJobListingsTable.id, { onDelete: "cascade" }),
  availabilityPattern: text("availability_pattern").notNull(),
  dayLabels: jsonb("day_labels").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const beautyJobContactsTable = pgTable("beauty_job_contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  listingId: uuid("listing_id").notNull().references(() => beautyJobListingsTable.id, { onDelete: "cascade" }),
  applicantUserId: uuid("applicant_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  applicantMessage: text("applicant_message").notNull(),
  applicantStatus: beautyJobContactStatusEnum("applicant_status").notNull().default("pending"),
  authorReply: text("author_reply"),
  authorStatus: beautyJobContactStatusEnum("author_status").notNull().default("pending"),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("beauty_job_contacts_listing_created_idx").on(table.listingId, table.createdAt),
  index("beauty_job_contacts_applicant_created_idx").on(table.applicantUserId, table.createdAt),
]);

export const beautyJobSavedListingsTable = pgTable("beauty_job_saved_listings", {
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  listingId: uuid("listing_id").notNull().references(() => beautyJobListingsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("beauty_job_saved_listings_user_listing_unique").on(table.userId, table.listingId),
  index("beauty_job_saved_listings_listing_idx").on(table.listingId),
]);

export const beautyJobReportsTable = pgTable("beauty_job_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  listingId: uuid("listing_id").notNull().references(() => beautyJobListingsTable.id, { onDelete: "cascade" }),
  reporterUserId: uuid("reporter_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  status: beautyJobReportStatusEnum("status").notNull().default("pending"),
  resolvedByUserId: uuid("resolved_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  resolutionNote: text("resolution_note"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("beauty_job_reports_listing_status_idx").on(table.listingId, table.status),
  index("beauty_job_reports_reporter_idx").on(table.reporterUserId),
  index("beauty_job_reports_resolved_by_idx").on(table.resolvedByUserId),
]);

export const beautyJobNotificationsTable = pgTable("beauty_job_notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  recipientUserId: uuid("recipient_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  listingId: uuid("listing_id").references(() => beautyJobListingsTable.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => beautyJobContactsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("beauty_job_notifications_recipient_created_idx").on(table.recipientUserId, table.createdAt),
  index("beauty_job_notifications_listing_idx").on(table.listingId),
  index("beauty_job_notifications_contact_idx").on(table.contactId),
]);

export type BeautyJobListing = typeof beautyJobListingsTable.$inferSelect;
export type NewBeautyJobListing = typeof beautyJobListingsTable.$inferInsert;