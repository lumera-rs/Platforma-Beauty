import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { salonsTable } from "./core";

/**
 * Append-only terminal receipts for booking creation commands. The unique
 * scope deliberately does not include the route: one key identifies one
 * command for an actor in a salon, regardless of which creation surface saw it.
 */
export const bookingCommandReceiptsTable = pgTable("booking_command_receipts", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  commandType: text("command_type").notNull(),
  payloadFingerprint: text("payload_fingerprint").notNull(),
  responseStatus: integer("response_status").notNull(),
  responseBody: jsonb("response_body").$type<unknown>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("booking_command_receipts_scope_key_unique")
    .on(table.salonId, table.actorType, table.actorId, table.idempotencyKey),
  index("booking_command_receipts_actor_created_idx")
    .on(table.actorType, table.actorId, table.createdAt),
]);

export type BookingCommandReceipt = typeof bookingCommandReceiptsTable.$inferSelect;