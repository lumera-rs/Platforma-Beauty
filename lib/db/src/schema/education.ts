import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./core";

export const courseFormatEnum = pgEnum("course_format", ["online", "in-person", "hybrid"]);

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
  centerId: uuid("center_id").notNull().references(() => educationCentersTable.id, { onDelete: "cascade" }),
  instructorId: uuid("instructor_id").references(() => usersTable.id, { onDelete: "set null" }),
  categoryId: uuid("category_id").references(() => courseCategoriesTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  category: text("category").notNull(),
  format: courseFormatEnum("format").notNull(),
  city: text("city"),
  price: integer("price").notNull(),
  duration: text("duration").notNull(),
  rating: integer("rating").notNull().default(0),
  certification: boolean("certification").notNull().default(false),
  imageUrl: text("image_url").notNull(),
  published: boolean("published").notNull().default(true),
});

export const courseEnrollmentsTable = pgTable("course_enrollments", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  progress: integer("progress").notNull().default(0),
  nextLesson: text("next_lesson"),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
});