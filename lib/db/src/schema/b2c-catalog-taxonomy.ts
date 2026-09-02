import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./core";

/**
 * Global, normalized merchandising dictionaries. Slugs/keys are immutable
 * API identifiers; labels may be translated or renamed without invalidating
 * bookmarked filters. Referenced rows are RESTRICTed by their catalog FKs and
 * must be deactivated rather than deleted.
 */
export const b2cProductTypesTable = pgTable("b2c_product_types", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull(),
  label: text("label").notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  version: integer("version").notNull().default(1),
  createdByUserId: uuid("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByUserId: uuid("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("b2c_product_types_slug_unique").on(table.slug),
  index("b2c_product_types_active_sort_idx").on(table.active, table.sortOrder, table.id),
  index("b2c_product_types_created_by_idx").on(table.createdByUserId),
  index("b2c_product_types_updated_by_idx").on(table.updatedByUserId),
  check("b2c_product_types_slug_check", sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
  check("b2c_product_types_version_check", sql`${table.version} >= 1`),
]);

export const b2cNeedTagsTable = pgTable("b2c_need_tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  version: integer("version").notNull().default(1),
  createdByUserId: uuid("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByUserId: uuid("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("b2c_need_tags_key_unique").on(table.key),
  index("b2c_need_tags_active_sort_idx").on(table.active, table.sortOrder, table.id),
  index("b2c_need_tags_created_by_idx").on(table.createdByUserId),
  index("b2c_need_tags_updated_by_idx").on(table.updatedByUserId),
  check("b2c_need_tags_key_check", sql`${table.key} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
  check("b2c_need_tags_version_check", sql`${table.version} >= 1`),
]);