import {
  boolean,
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
export const smsDeliveryStatusEnum = pgEnum("sms_delivery_status", ["queued", "sent", "failed", "skipped"]);
export const smsMessageTypeEnum = pgEnum("sms_message_type", ["appointment_confirmation", "appointment_reminder"]);
export const integrationKeyEnum = pgEnum("integration_key", ["sms", "brevo", "google_oauth", "facebook_oauth"]);

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
});

export const oauthIdentitiesTable = pgTable("oauth_identities", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  provider: oauthProviderEnum("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  providerEmail: text("provider_email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("oauth_identities_provider_account_unique").on(table.provider, table.providerAccountId),
]);

export const oauthLoginStatesTable = pgTable("oauth_login_states", {
  id: uuid("id").defaultRandom().primaryKey(),
  state: text("state").notNull().unique(),
  provider: oauthProviderEnum("provider").notNull(),
  flow: text("flow").notNull(),
  codeVerifier: text("code_verifier"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
});

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
});

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
});

export const employeeSchedulesTable = pgTable("employee_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  employeeId: uuid("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  breakStart: text("break_start"),
  breakEnd: text("break_end"),
});

export const employeeTimeOffTable = pgTable("employee_time_off", {
  id: uuid("id").defaultRandom().primaryKey(),
  employeeId: uuid("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  reason: text("reason").notNull(),
});

export const employeeLeaveRequestsTable = pgTable("employee_leave_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  employeeId: uuid("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  reason: text("reason").notNull(),
  status: leaveRequestStatusEnum("status").notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
});

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
});

export const inspirationItemsTable = pgTable("inspiration_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").references(() => servicesTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  imageUrl: text("image_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
]);

export const favoriteEmployeesTable = pgTable("favorite_employees", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("favorite_employees_user_salon_unique").on(table.userId, table.salonId),
]);

export const salonHoursTable = pgTable("salon_hours", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  openTime: text("open_time").notNull(),
  closeTime: text("close_time").notNull(),
  closed: boolean("closed").notNull().default(false),
});

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("salon_customers_salon_user_unique").on(table.salonId, table.userId),
  uniqueIndex("salon_customers_salon_phone_normalized_unique").on(table.salonId, table.phoneNormalized),
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
});

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
  index("appointments_schedule_lookup_index").on(table.salonId, table.date, table.employeeId, table.status),
]);

export const smsDeliveriesTable = pgTable("sms_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventKey: text("event_key").notNull().unique(),
  salonId: uuid("salon_id").references(() => salonsTable.id, { onDelete: "set null" }),
  appointmentId: uuid("appointment_id").references(() => appointmentsTable.id, { onDelete: "set null" }),
  messageType: smsMessageTypeEnum("message_type").notNull(),
  recipientPhone: text("recipient_phone").notNull(),
  body: text("body").notNull(),
  status: smsDeliveryStatusEnum("status").notNull().default("queued"),
  providerMessageId: text("provider_message_id"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  retryCount: integer("retry_count").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("sms_deliveries_retry_index").on(table.status, table.nextRetryAt),
]);

export const appointmentStatusHistoryTable = pgTable("appointment_status_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  appointmentId: uuid("appointment_id").notNull().references(() => appointmentsTable.id, { onDelete: "cascade" }),
  status: appointmentStatusEnum("status").notNull(),
  changedByUserId: uuid("changed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviewsTable = pgTable("reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => usersTable.id),
  serviceName: text("service_name").notNull(),
  rating: integer("rating").notNull(),
  text: text("text").notNull(),
  visible: boolean("visible").notNull().default(true),
  showProfilePhoto: boolean("show_profile_photo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("reviews_customer_salon_unique").on(table.customerId, table.salonId),
]);

export const favoritesTable = pgTable("favorites", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customerNotesTable = pgTable("customer_notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
