import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./core";

/**
 * Canonical metadata for an immutable image stored in Replit App Storage.
 * Resource tables keep stable `/api/media/:id?v=:hash` URLs for backwards
 * compatibility; private object paths never leave the server.
 */
export const mediaAssetsTable = pgTable("media_assets", {
  id: uuid("id").primaryKey(),
  ownerUserId: uuid("owner_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  scope: text("scope").notNull(),
  resourceId: uuid("resource_id"),
  visibility: text("visibility").notNull().default("public"),
  originalFileName: text("original_file_name").notNull(),
  originalContentType: text("original_content_type").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  contentHash: text("content_hash").notNull(),
  cleanupReservedAt: timestamp("cleanup_reserved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("media_assets_owner_created_idx").on(table.ownerUserId, table.createdAt),
  index("media_assets_scope_resource_idx").on(table.scope, table.resourceId),
  index("media_assets_content_hash_idx").on(table.contentHash),
  index("media_assets_cleanup_reservation_idx").on(table.resourceId, table.cleanupReservedAt),
]);

export const mediaVariantsTable = pgTable("media_variants", {
  id: uuid("id").defaultRandom().primaryKey(),
  assetId: uuid("asset_id").notNull().references(() => mediaAssetsTable.id, { onDelete: "cascade" }),
  sizeName: text("size_name").notNull(),
  format: text("format").notNull(),
  objectPath: text("object_path").notNull(),
  contentType: text("content_type").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  byteSize: integer("byte_size").notNull(),
  etag: text("etag").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("media_variants_asset_size_format_unique").on(table.assetId, table.sizeName, table.format),
  uniqueIndex("media_variants_object_path_unique").on(table.objectPath),
  index("media_variants_asset_idx").on(table.assetId),
]);

/**
 * Short-lived, owner-bound direct-upload intent. Finalization is idempotent:
 * `finalizedAssetId` is returned on every retry after a successful promotion.
 */
export const mediaUploadTicketsTable = pgTable("media_upload_tickets", {
  id: uuid("id").primaryKey(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  resourceId: uuid("resource_id"),
  stagingObjectPath: text("staging_object_path").notNull(),
  originalFileName: text("original_file_name").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  finalizedAssetId: uuid("finalized_asset_id").references(() => mediaAssetsTable.id, { onDelete: "set null" }),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  cleanupFailureCount: integer("cleanup_failure_count").notNull().default(0),
  lastCleanupFailureAt: timestamp("last_cleanup_failure_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("media_upload_tickets_staging_path_unique").on(table.stagingObjectPath),
  index("media_upload_tickets_owner_expires_idx").on(table.ownerUserId, table.expiresAt),
  index("media_upload_tickets_cleanup_idx").on(table.expiresAt, table.finalizedAt),
]);