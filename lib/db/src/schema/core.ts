import {
  boolean,
  check,
  date,
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

export const userRoleEnum = pgEnum("user_role", [
  "SUPER_ADMIN",
  "ADMIN",
  "SALON_OWNER",
  "SALON_EMPLOYEE",
  "EDUCATION_CENTER_OWNER",
  "INSTRUCTOR",
  "CUSTOMER",
  "STUDENT",
]);

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "pending",
  "confirmed",
  "completed",
  "cancelled",
  "no-show",
]);
export const leaveRequestStatusEnum = pgEnum("leave_request_status", ["pending", "approved", "rejected"]);

export const oauthProviderEnum = pgEnum("oauth_provider", ["google", "facebook"]);
export const emailDeliveryStatusEnum = pgEnum("email_delivery_status", ["queued", "processing", "sent", "failed", "skipped"]);
export const emailCampaignStatusEnum = pgEnum("email_campaign_status", ["draft", "scheduled", "sent", "failed"]);
export const smsDeliveryStatusEnum = pgEnum("sms_delivery_status", ["queued", "processing", "sent", "failed", "skipped"]);
export const smsMessageTypeEnum = pgEnum("sms_message_type", [
  "appointment_confirmation",
  "appointment_reminder",
  "education_session_reminder",
  "education_waitlist_offer",
  "education_session_cancelled",
  "automation",
  // Platform-level administrator alert (e.g. the delivery-report silence
  // fallback SMS when alert emails cannot be sent). Not tied to any salon.
  "admin_alert",
]);
export const integrationKeyEnum = pgEnum("integration_key", ["sms", "brevo", "google_oauth", "facebook_oauth"]);
export const imageAssetStatusEnum = pgEnum("image_asset_status", ["pending", "processing", "ready", "failed"]);

export type ImageAssetVariant = {
  objectPath: string;
  contentType: "image/avif" | "image/webp" | "image/jpeg" | "image/png";
  width: number;
  height: number;
  bytes: number;
};

export type ImageAssetVariantSet = {
  thumbnail: {
    avif: ImageAssetVariant;
    webp: ImageAssetVariant;
    fallback: ImageAssetVariant;
  };
  medium: {
    avif: ImageAssetVariant;
    webp: ImageAssetVariant;
    fallback: ImageAssetVariant;
  };
  large: {
    avif: ImageAssetVariant;
    webp: ImageAssetVariant;
    fallback: ImageAssetVariant;
  };
};

export const usersTable = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  phoneNormalized: text("phone_normalized"),
  activeSalonId: uuid("active_salon_id"),
  passwordHash: text("password_hash").notNull(),
  passwordSetAt: timestamp("password_set_at", { withTimezone: true }),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  role: userRoleEnum("role").notNull().default("CUSTOMER"),
  avatarUrl: text("avatar_url"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("users_phone_normalized_unique").on(table.phoneNormalized).where(sql`${table.phoneNormalized} is not null`),
]);

export const sessionsTable = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Covers the leading FK; also used for "all sessions for user" and expiry cleanup.
  index("sessions_user_expires_idx").on(table.userId, table.expiresAt),
]);

/**
 * Image bytes live in App Storage. PostgreSQL keeps only immutable object
 * paths and metadata needed to select the right responsive variant.
 */
export const imageAssetsTable = pgTable("image_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  originalFilename: text("original_filename").notNull(),
  sourceContentType: text("source_content_type").notNull(),
  sourceSize: integer("source_size").notNull(),
  stagingObjectPath: text("staging_object_path").notNull().unique(),
  originalObjectPath: text("original_object_path"),
  originalWidth: integer("original_width"),
  originalHeight: integer("original_height"),
  variants: jsonb("variants").$type<ImageAssetVariantSet>(),
  status: imageAssetStatusEnum("status").notNull().default("pending"),
  failureReason: text("failure_reason"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for uploadedByUserId; also useful for per-uploader listings.
  index("image_assets_uploader_created_idx").on(table.uploadedByUserId, table.createdAt),
  index("image_assets_status_expires_idx").on(table.status, table.expiresAt),
]);

export const oauthIdentitiesTable = pgTable("oauth_identities", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  provider: oauthProviderEnum("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  providerEmail: text("provider_email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("oauth_identities_provider_account_unique").on(table.provider, table.providerAccountId),
  // Leading FK coverage: look up all identities for a user.
  index("oauth_identities_user_idx").on(table.userId),
]);

export const oauthLoginStatesTable = pgTable("oauth_login_states", {
  id: uuid("id").defaultRandom().primaryKey(),
  state: text("state").notNull().unique(),
  provider: oauthProviderEnum("provider").notNull(),
  flow: text("flow").notNull(),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  codeVerifier: text("code_verifier"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for nullable userId.
  index("oauth_login_states_user_idx").on(table.userId),
]);

export const phoneVerificationCodesTable = pgTable("phone_verification_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  phoneNormalized: text("phone_normalized").notNull().unique(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  requestCount: integer("request_count").notNull().default(0),
  lastRequestedAt: timestamp("last_requested_at", { withTimezone: true }).notNull().defaultNow(),
  lastRequestIp: text("last_request_ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const integrationSettingsTable = pgTable("integration_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  integration: integrationKeyEnum("integration").notNull(),
  settingKey: text("setting_key").notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  updatedByUserId: uuid("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("integration_settings_integration_key_unique").on(table.integration, table.settingKey),
  // Leading FK coverage for updatedByUserId (audit trail lookup).
  index("integration_settings_updated_by_idx").on(table.updatedByUserId),
]);

export const emailDeliveriesTable = pgTable("email_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventKey: text("event_key").notNull().unique(),
  emailType: text("email_type").notNull(),
  salonId: uuid("salon_id").references(() => salonsTable.id, { onDelete: "set null" }),
  appointmentId: uuid("appointment_id").references(() => appointmentsTable.id, { onDelete: "set null" }),
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name"),
  subject: text("subject").notNull(),
  htmlContent: text("html_content"),
  status: emailDeliveryStatusEnum("status").notNull().default("queued"),
  providerMessageId: text("provider_message_id"),
  errorMessage: text("error_message"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  retryCount: integer("retry_count").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  processingToken: text("processing_token"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("email_deliveries_retry_index").on(table.status, table.nextRetryAt),
  // Leading FK coverage: deliveries for a salon, deliveries for an appointment.
  index("email_deliveries_salon_idx").on(table.salonId),
  index("email_deliveries_appointment_idx").on(table.appointmentId),
]);

export const emailCampaignsTable = pgTable("email_campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => usersTable.id),
  audience: text("audience").notNull(),
  loyaltyTierId: uuid("loyalty_tier_id"),
  title: text("title").notNull(),
  subject: text("subject").notNull(),
  htmlContent: text("html_content").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  status: emailCampaignStatusEnum("status").notNull().default("draft"),
  brevoCampaignId: integer("brevo_campaign_id"),
  recipientCount: integer("recipient_count").notNull().default(0),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for createdByUserId.
  index("email_campaigns_created_by_idx").on(table.createdByUserId),
]);

export const serviceCategoriesTable = pgTable("service_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull(),
  fallbackImageUrl: text("fallback_image_url"),
  active: boolean("active").notNull().default(true),
});

export const serviceTemplatesTable = pgTable("service_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  mainCategory: text("main_category").notNull(),
  subcategory: text("subcategory").notNull(),
  typicalDurationMinutes: integer("typical_duration_minutes").notNull(),
  priceMin: integer("price_min").notNull(),
  priceMax: integer("price_max").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("service_templates_category_name_unique").on(table.mainCategory, table.name),
  index("service_templates_category_subcategory_index").on(table.mainCategory, table.subcategory),
]);

export const salonsTable = pgTable("salons", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => usersTable.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  city: text("city").notNull(),
  municipality: text("municipality").notNull(),
  address: text("address").notNull(),
  postalCode: text("postal_code"),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  companyName: text("company_name"),
  companyTaxId: text("company_tax_id"),
  companyRegistrationNumber: text("company_registration_number"),
  companyAddress: text("company_address"),
  companyCity: text("company_city"),
  companyPostalCode: text("company_postal_code"),
  shortDescription: text("short_description").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url").notNull(),
  gallery: jsonb("gallery").$type<string[]>().notNull().default([]),
  videoUrl: text("video_url"),
  rating: integer("rating").notNull().default(0),
  reviewCount: integer("review_count").notNull().default(0),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  homeService: boolean("home_service").notNull().default(false),
  homeServiceRadiusKm: integer("home_service_radius_km").notNull().default(10),
  featured: boolean("featured").notNull().default(false),
  isVerified: boolean("is_verified").notNull().default(false),
  topSalon: boolean("top_salon").notNull().default(false),
  acceptsCards: boolean("accepts_cards").notNull().default(false),
  instantBooking: boolean("instant_booking").notNull().default(false),
  servesMen: boolean("serves_men").notNull().default(false),
  servesMenManuallySet: boolean("serves_men_manually_set").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Salon list pages: filter by city/municipality + active, sort by rating or featured.
  index("salons_city_active_rating_idx").on(table.city, table.active, table.rating),
  index("salons_municipality_active_idx").on(table.municipality, table.active),
  index("salons_city_normalized_active_rating_idx").on(sql`lower(${table.city})`, table.active, table.rating),
  index("salons_municipality_normalized_active_idx").on(sql`lower(${table.municipality})`, table.active),
  index("salons_featured_active_idx").on(table.featured, table.active),
  // Leading FK coverage for ownerId.
  index("salons_owner_idx").on(table.ownerId),
]);

export const employeesTable = pgTable("employees", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  role: text("role").notNull(),
  bio: text("bio").notNull(),
  avatarUrl: text("avatar_url").notNull(),
  email: text("email"),
  specialties: jsonb("specialties").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
}, (table) => [
  // Leading FK coverage for salonId (also filters by active).
  index("employees_salon_active_idx").on(table.salonId, table.active),
  // Leading FK coverage for nullable userId (resolve linked user account).
  index("employees_user_idx").on(table.userId),
]);

export const employeeSchedulesTable = pgTable("employee_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  employeeId: uuid("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  breakStart: text("break_start"),
  breakEnd: text("break_end"),
}, (table) => [
  // Leading FK coverage: fetch full schedule for an employee.
  index("employee_schedules_employee_weekday_idx").on(table.employeeId, table.weekday),
]);

export const employeeTimeOffTable = pgTable("employee_time_off", {
  id: uuid("id").defaultRandom().primaryKey(),
  employeeId: uuid("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  reason: text("reason").notNull(),
}, (table) => [
  // Leading FK coverage: all time-off for an employee, ordered by date range.
  index("employee_time_off_employee_start_idx").on(table.employeeId, table.startDate),
]);

export const employeeLeaveRequestsTable = pgTable("employee_leave_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  employeeId: uuid("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  reason: text("reason").notNull(),
  status: leaveRequestStatusEnum("status").notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage: all leave requests for an employee, ordered by date.
  index("employee_leave_requests_employee_created_idx").on(table.employeeId, table.createdAt),
]);

export const servicesTable = pgTable("services", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").references(() => serviceCategoriesTable.id, { onDelete: "set null" }),
  categoryName: text("category_name").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  price: integer("price").notNull(),
  promoPrice: integer("promo_price"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  packageTreatments: integer("package_treatments"),
  imageUrl: text("image_url").notNull(),
  active: boolean("active").notNull().default(true),
  homeServiceAvailable: boolean("home_service_available").notNull().default(false),
  homeServiceFee: integer("home_service_fee").notNull().default(0),
  homeServiceMinimumOrder: integer("home_service_minimum_order"),
}, (table) => [
  // Service listing: all active services for a salon.
  index("services_salon_active_idx").on(table.salonId, table.active),
  // Leading FK coverage for categoryId (also covers services_salon_category query pattern).
  index("services_salon_category_idx").on(table.salonId, table.categoryId),
  // Leading FK coverage for categoryId alone (global category browse).
  index("services_category_idx").on(table.categoryId),
]);

export const productBrandsTable = pgTable("product_brands", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull(),
  logoUrl: text("logo_url"),
  active: boolean("active").notNull().default(true),
});

export const salonBrandsTable = pgTable("salon_brands", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id").notNull().references(() => productBrandsTable.id, { onDelete: "cascade" }),
}, (table) => [
  // Leading FK coverage for both sides of the join table.
  index("salon_brands_salon_idx").on(table.salonId),
  index("salon_brands_brand_idx").on(table.brandId),
]);

export const inspirationItemsTable = pgTable("inspiration_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").references(() => servicesTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  imageUrl: text("image_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage: all inspiration items for a salon, sorted by date.
  index("inspiration_items_salon_created_idx").on(table.salonId, table.createdAt),
  // Leading FK coverage for serviceId.
  index("inspiration_items_service_idx").on(table.serviceId),
]);

export const beautyGlossaryTable = pgTable("beauty_glossary", {
  id: uuid("id").defaultRandom().primaryKey(),
  term: text("term").notNull().unique(),
  slug: text("slug").notNull().unique(),
  definition: text("definition").notNull(),
  category: text("category").notNull(),
});

export const employeeServicesTable = pgTable("employee_services", {
  id: uuid("id").defaultRandom().primaryKey(),
  employeeId: uuid("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").notNull().references(() => servicesTable.id, { onDelete: "cascade" }),
}, (table) => [
  uniqueIndex("employee_services_employee_service_unique").on(table.employeeId, table.serviceId),
  // Leading FK coverage for serviceId (reverse lookup: which employees do this service).
  index("employee_services_service_idx").on(table.serviceId),
]);

export const favoriteEmployeesTable = pgTable("favorite_employees", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("favorite_employees_user_salon_unique").on(table.userId, table.salonId),
  // Leading FK coverage for salonId and employeeId (reverse lookups).
  index("favorite_employees_salon_idx").on(table.salonId),
  index("favorite_employees_employee_idx").on(table.employeeId),
]);

export const salonHoursTable = pgTable("salon_hours", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  openTime: text("open_time").notNull(),
  closeTime: text("close_time").notNull(),
  closed: boolean("closed").notNull().default(false),
}, (table) => [
  // Leading FK coverage: fetch all hours for a salon (also covers weekday filter).
  index("salon_hours_salon_weekday_idx").on(table.salonId, table.weekday),
]);

export const salonCustomersTable = pgTable("salon_customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  phoneNormalized: text("phone_normalized"),
  smsOptOut: boolean("sms_opt_out").notNull().default(false),
  /** Optional date-of-birth for birthday automation trigger (format: YYYY-MM-DD) */
  birthDate: date("birth_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("salon_customers_salon_user_unique").on(table.salonId, table.userId),
  uniqueIndex("salon_customers_salon_phone_normalized_unique").on(table.salonId, table.phoneNormalized),
  // Leading FK coverage for userId alone (find all salon records for a given user).
  index("salon_customers_user_idx").on(table.userId),
]);

export const appointmentSeriesTable = pgTable("appointment_series", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  salonCustomerId: uuid("salon_customer_id").references(() => salonCustomersTable.id, { onDelete: "set null" }),
  serviceId: uuid("service_id").notNull().references(() => servicesTable.id),
  employeeId: uuid("employee_id").references(() => employeesTable.id, { onDelete: "set null" }),
  totalAppointments: integer("total_appointments").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for salonId (all series for a salon).
  index("appointment_series_salon_created_idx").on(table.salonId, table.createdAt),
  // Leading FK coverage for remaining FKs.
  index("appointment_series_salon_customer_idx").on(table.salonCustomerId),
  index("appointment_series_service_idx").on(table.serviceId),
  index("appointment_series_employee_idx").on(table.employeeId),
  index("appointment_series_created_by_idx").on(table.createdByUserId),
]);

export const appointmentsTable = pgTable("appointments", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").references(() => usersTable.id),
  salonCustomerId: uuid("salon_customer_id").references(() => salonCustomersTable.id, { onDelete: "set null" }),
  employeeId: uuid("employee_id").references(() => employeesTable.id, { onDelete: "set null" }),
  serviceId: uuid("service_id").notNull().references(() => servicesTable.id),
  seriesId: uuid("series_id").references(() => appointmentSeriesTable.id, { onDelete: "set null" }),
  date: date("appointment_date", { mode: "string" }).notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  price: integer("price").notNull(),
  treatmentLocation: text("treatment_location").notNull().default("salon"),
  travelFee: integer("travel_fee").notNull().default(0),
  treatmentAddressLine1: text("treatment_address_line_1"),
  treatmentAddressCity: text("treatment_address_city"),
  treatmentAddressPostalCode: text("treatment_address_postal_code"),
  treatmentAddressDetails: text("treatment_address_details"),
  status: appointmentStatusEnum("status").notNull().default("pending"),
  notes: text("notes"),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Primary schedule query: salon day-view, optionally filtered by employee/status.
  index("appointments_schedule_lookup_index").on(table.salonId, table.date, table.employeeId, table.status),
  // Leading FK coverage for remaining FKs not covered as leading columns above.
  index("appointments_employee_idx").on(table.employeeId),
  index("appointments_customer_idx").on(table.customerId),
  index("appointments_salon_customer_idx").on(table.salonCustomerId),
  index("appointments_service_idx").on(table.serviceId),
  index("appointments_series_idx").on(table.seriesId),
]);

export const smsDeliveriesTable = pgTable("sms_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventKey: text("event_key").notNull().unique(),
  salonId: uuid("salon_id").references(() => salonsTable.id, { onDelete: "set null" }),
  appointmentId: uuid("appointment_id").references(() => appointmentsTable.id, { onDelete: "set null" }),
  messageType: smsMessageTypeEnum("message_type").notNull(),
  recipientPhone: text("recipient_phone").notNull(),
  body: text("body").notNull(),
  /**
   * queued     — inserted, not yet attempted
   * processing — claimed by a sender under a lease; reclaimable once
   *              claimExpiresAt has passed (crash/restart recovery)
   * sent       — provider accepted the message (terminal / deduplicated)
   * skipped    — intentionally not sent (opt-out, integration off, no key) (terminal)
   * failed     — provider error; reclaimable for retry
   */
  status: smsDeliveryStatusEnum("status").notNull().default("queued"),
  /** Set when a sender claims this delivery row for provider dispatch. */
  processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
  /**
   * Set (while holding the CAS lease) IMMEDIATELY BEFORE the provider HTTP
   * request is issued. Its presence marks an "unknown outcome" — the provider
   * may or may not have accepted the message. A later claim MUST reconcile by
   * this row's stable id (used as the provider messageId) before any resend,
   * rather than blindly re-submitting. It is never cleared on retry, so a
   * provider-success-then-local-crash is recoverable. NULL means no provider
   * request was ever started (safe to send on the next claim).
   */
  submissionStartedAt: timestamp("submission_started_at", { withTimezone: true }),
  /**
   * Lease expiry. A delivery stuck in processing past this timestamp can be
   * reclaimed by another sender (crash after claim but before/around the
   * provider call). Typically NOW + 5min.
   */
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  providerMessageId: text("provider_message_id"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  retryCount: integer("retry_count").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("sms_deliveries_retry_index").on(table.status, table.nextRetryAt),
  index("sms_deliveries_retention_idx")
    .on(table.createdAt)
    .where(sql`${table.status} in ('sent', 'skipped')`),
  /** Stale-claim recovery scan: find processing rows whose lease has expired. */
  index("sms_deliveries_claim_expiry_idx").on(table.status, table.claimExpiresAt),
  // Leading FK coverage for salonId and appointmentId.
  index("sms_deliveries_salon_idx").on(table.salonId),
  index("sms_deliveries_appointment_idx").on(table.appointmentId),
]);

export const appointmentStatusHistoryTable = pgTable("appointment_status_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  appointmentId: uuid("appointment_id").notNull().references(() => appointmentsTable.id, { onDelete: "cascade" }),
  status: appointmentStatusEnum("status").notNull(),
  changedByUserId: uuid("changed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for appointmentId (also ordered for timeline display).
  index("appointment_status_history_appt_created_idx").on(table.appointmentId, table.createdAt),
  // Leading FK coverage for changedByUserId (audit trail by actor).
  index("appointment_status_history_changed_by_idx").on(table.changedByUserId),
]);

export const reviewsTable = pgTable("reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => usersTable.id),
  /** Nullable — set from the reviewer's latest completed appointment at this salon */
  employeeId: uuid("employee_id").references(() => employeesTable.id, { onDelete: "set null" }),
  serviceName: text("service_name").notNull(),
  rating: integer("rating").notNull(),
  text: text("text").notNull(),
  visible: boolean("visible").notNull().default(true),
  showProfilePhoto: boolean("show_profile_photo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Unique constraint also covers the FK for customerId as leading column.
  uniqueIndex("reviews_customer_salon_unique").on(table.customerId, table.salonId),
  // Salon review listing ordered by date, filtered by visible.
  index("reviews_salon_visible_created_idx").on(table.salonId, table.visible, table.createdAt),
  // Employee rating aggregate scan.
  index("reviews_employee_visible_idx").on(table.employeeId, table.visible),
]);

export const favoritesTable = pgTable("favorites", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for both sides.
  index("favorites_user_idx").on(table.userId),
  index("favorites_salon_idx").on(table.salonId),
]);

export const customerNotesTable = pgTable("customer_notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Leading FK coverage for salonId (salon CRM view); customerId covered as second column.
  index("customer_notes_salon_customer_idx").on(table.salonId, table.customerId),
  // Leading FK coverage for customerId alone (customer history view).
  index("customer_notes_customer_idx").on(table.customerId),
]);

// ---------------------------------------------------------------------------
// Salon resources (chairs, booths, beds, equipment, rooms, etc.)
// A resource belongs to exactly one salon. capacity is the number of
// simultaneous appointments that may use the resource at the same time.
// ---------------------------------------------------------------------------
export const salonResourceTypeEnum = pgEnum("salon_resource_type", [
  "chair",
  "booth",
  "bed",
  "room",
  "equipment",
  "other",
]);

export const salonResourcesTable = pgTable("salon_resources", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: salonResourceTypeEnum("type").notNull().default("other"),
  capacity: integer("capacity").notNull().default(1),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Enforce capacity >= 1 at DB level.
  check("salon_resources_capacity_positive", sql`${table.capacity} >= 1`),
  // Unique resource name per salon.
  uniqueIndex("salon_resources_salon_name_unique").on(table.salonId, table.name),
  // All resources for a salon, filtered by active.
  index("salon_resources_salon_active_idx").on(table.salonId, table.active),
]);

// ---------------------------------------------------------------------------
// Service → resource requirements.
// Captures how many units of a given resource a service needs.
// A service with no rows here has no resource requirements.
// ---------------------------------------------------------------------------
export const serviceResourceRequirementsTable = pgTable("service_resource_requirements", {
  id: uuid("id").defaultRandom().primaryKey(),
  serviceId: uuid("service_id").notNull().references(() => servicesTable.id, { onDelete: "cascade" }),
  resourceId: uuid("resource_id").notNull().references(() => salonResourcesTable.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Enforce quantity >= 1 at DB level.
  check("service_resource_requirements_quantity_positive", sql`${table.quantity} >= 1`),
  // One requirement row per (service, resource) pair.
  uniqueIndex("service_resource_requirements_service_resource_unique").on(table.serviceId, table.resourceId),
  // Reverse lookup: which services require a given resource.
  index("service_resource_requirements_resource_idx").on(table.resourceId),
]);

// ---------------------------------------------------------------------------
// Appointment → resource allocations.
// Records which resources (and how many units) were consumed by each
// appointment. Rows persist after cancellation for historical auditing;
// capacity checks skip cancelled appointments via a status filter.
// ---------------------------------------------------------------------------
export const appointmentResourceAllocationsTable = pgTable("appointment_resource_allocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  appointmentId: uuid("appointment_id").notNull().references(() => appointmentsTable.id, { onDelete: "cascade" }),
  resourceId: uuid("resource_id").notNull().references(() => salonResourcesTable.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Enforce quantity >= 1 at DB level.
  check("appointment_resource_allocations_quantity_positive", sql`${table.quantity} >= 1`),
  // One allocation row per (appointment, resource) pair.
  uniqueIndex("appointment_resource_allocations_appt_resource_unique").on(table.appointmentId, table.resourceId),
  // Reverse lookup: all appointments for a resource (capacity check query).
  index("appointment_resource_allocations_resource_idx").on(table.resourceId),
  // Leading FK coverage for appointmentId.
  index("appointment_resource_allocations_appointment_idx").on(table.appointmentId),
]);

// ---------------------------------------------------------------------------
// SMS delivery snapshot archive.
// Provides a cheap, immutable record of every outbound SMS as it leaves the
// live delivery queue — useful for auditing, dispute resolution, and GDPR
// erasure bookkeeping without touching the hot sms_deliveries table.
// ---------------------------------------------------------------------------
export const smsDeliveryArchivesTable = pgTable("sms_delivery_archives", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Stable reference back to the original sms_deliveries.event_key. */
  sourceId: text("source_id").notNull().unique(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  originalCreatedAt: timestamp("original_created_at", { withTimezone: true }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("sms_delivery_archives_archived_at_idx").on(table.archivedAt),
]);
