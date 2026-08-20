import {
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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

export const oauthProviderEnum = pgEnum("oauth_provider", ["google", "facebook"]);
export const emailDeliveryStatusEnum = pgEnum("email_delivery_status", ["queued", "sent", "failed", "skipped"]);
export const emailCampaignStatusEnum = pgEnum("email_campaign_status", ["draft", "scheduled", "sent", "failed"]);

export const usersTable = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("CUSTOMER"),
  avatarUrl: text("avatar_url"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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

export const emailDeliveriesTable = pgTable("email_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventKey: text("event_key").notNull().unique(),
  emailType: text("email_type").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name"),
  subject: text("subject").notNull(),
  status: emailDeliveryStatusEnum("status").notNull().default("queued"),
  providerMessageId: text("provider_message_id"),
  errorMessage: text("error_message"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  active: boolean("active").notNull().default(true),
});

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
  rating: integer("rating").notNull().default(0),
  reviewCount: integer("review_count").notNull().default(0),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  homeService: boolean("home_service").notNull().default(false),
  featured: boolean("featured").notNull().default(false),
  topSalon: boolean("top_salon").notNull().default(false),
  acceptsCards: boolean("accepts_cards").notNull().default(false),
  instantBooking: boolean("instant_booking").notNull().default(false),
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
});

export const salonHoursTable = pgTable("salon_hours", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  openTime: text("open_time").notNull(),
  closeTime: text("close_time").notNull(),
  closed: boolean("closed").notNull().default(false),
});

export const appointmentsTable = pgTable("appointments", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => usersTable.id),
  employeeId: uuid("employee_id").references(() => employeesTable.id, { onDelete: "set null" }),
  serviceId: uuid("service_id").notNull().references(() => servicesTable.id),
  date: date("appointment_date", { mode: "string" }).notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  price: integer("price").notNull(),
  status: appointmentStatusEnum("status").notNull().default("pending"),
  notes: text("notes"),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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