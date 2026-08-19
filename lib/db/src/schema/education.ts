import {
  boolean,
  date,
  jsonb,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { employeesTable, salonsTable, usersTable } from "./core";

export const courseFormatEnum = pgEnum("course_format", ["online", "in-person", "hybrid"]);
export const educationEnrollmentStatusEnum = pgEnum("education_enrollment_status", ["pending", "active", "completed", "cancelled"]);
export const educationPaymentStatusEnum = pgEnum("education_payment_status", ["pending", "paid", "failed", "refunded"]);

export const educationCentersTable = pgTable("education_centers", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => usersTable.id),
  name: text("name").notNull(),
  city: text("city").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url").notNull(),
});

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
  categoryId: uuid("category_id").references(() => courseCategoriesTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull(),
  format: courseFormatEnum("format").notNull(),
  city: text("city"),
  price: integer("price").notNull(),
  duration: text("duration").notNull(),
  rating: integer("rating").notNull().default(0),
  certification: boolean("certification").notNull().default(false),
  imageUrl: text("image_url").notNull(),
  published: boolean("published").notNull().default(true),
  archived: boolean("archived").notNull().default(false),
  startDate: date("start_date", { mode: "string" }),
  endDate: date("end_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const courseSessionsTable = pgTable("course_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  location: text("location"),
  capacity: integer("capacity").notNull().default(20),
  reservedSeats: integer("reserved_seats").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const courseModulesTable = pgTable("course_modules", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const courseLessonsTable = pgTable("course_lessons", {
  id: uuid("id").defaultRandom().primaryKey(),
  moduleId: uuid("module_id").notNull().references(() => courseModulesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  content: text("content").notNull().default(""),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const courseEnrollmentsTable = pgTable("course_enrollments", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  salonId: uuid("salon_id").references(() => salonsTable.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").references(() => employeesTable.id, { onDelete: "set null" }),
  purchaserId: uuid("purchaser_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: educationEnrollmentStatusEnum("status").notNull().default("pending"),
  paymentStatus: educationPaymentStatusEnum("payment_status").notNull().default("pending"),
  progress: integer("progress").notNull().default(0),
  nextLesson: text("next_lesson"),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  auditData: jsonb("audit_data").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lessonProgressTable = pgTable("lesson_progress", {
  id: uuid("id").defaultRandom().primaryKey(),
  enrollmentId: uuid("enrollment_id").notNull().references(() => courseEnrollmentsTable.id, { onDelete: "cascade" }),
  lessonId: uuid("lesson_id").notNull().references(() => courseLessonsTable.id, { onDelete: "cascade" }),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  completedByUserId: uuid("completed_by_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
});