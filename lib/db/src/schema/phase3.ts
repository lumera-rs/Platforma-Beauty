import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  doublePrecision,
  timestamp,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  usersTable,
  salonsTable,
  employeesTable,
  servicesTable,
  salonCustomersTable,
  appointmentsTable,
} from "./core";
import { productsTable, ordersTable } from "./commerce";

// ---------------------------------------------------------------------------
// Phase 3 — treatment photos, salon inventory, time clock, shift swaps.
// Production does NOT run drizzle push: every table/enum/index here MUST be
// mirrored in the versioned bootstrap (business-growth-schema.ts).
// ---------------------------------------------------------------------------

export const treatmentPhotoKindEnum = pgEnum("treatment_photo_kind", ["before", "after"]);

/**
 * Before/after photos of a completed treatment. Uploaded by the employee who
 * performed the appointment, tied to the salon CRM profile (salon_customers)
 * and to the specific appointment. `mediaAssetId` points at the managed media
 * pipeline's media_assets row (created by ensureMediaSchema, outside drizzle),
 * so it is intentionally NOT a foreign key here.
 */
export const treatmentPhotosTable = pgTable("treatment_photos", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  salonCustomerId: uuid("salon_customer_id").notNull().references(() => salonCustomersTable.id, { onDelete: "cascade" }),
  appointmentId: uuid("appointment_id").notNull().references(() => appointmentsTable.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").references(() => employeesTable.id, { onDelete: "set null" }),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  kind: treatmentPhotoKindEnum("kind").notNull(),
  /** Managed media pipeline asset id (media_assets.id) — no cross-schema FK. */
  mediaAssetId: uuid("media_asset_id").notNull(),
  /** Employee confirmed the client's consent at upload time (required). */
  consentConfirmed: boolean("consent_confirmed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // CRM profile view: all photos for a client, chronological.
  index("treatment_photos_salon_customer_created_idx").on(table.salonCustomerId, table.createdAt),
  // Appointment view (employee/customer) + leading FK coverage.
  index("treatment_photos_appointment_idx").on(table.appointmentId),
  index("treatment_photos_salon_created_idx").on(table.salonId, table.createdAt),
  index("treatment_photos_employee_idx").on(table.employeeId),
  index("treatment_photos_uploaded_by_idx").on(table.uploadedByUserId),
  // One photo row per media asset — an asset is claimed exactly once.
  uniqueIndex("treatment_photos_media_asset_unique").on(table.mediaAssetId),
]);

/**
 * Consumption mapping: how much of a B2B product one completed treatment of a
 * service uses. Quantity is expressed in the inventory item's usage unit
 * (e.g. ml) — see salon_inventory.unit_content_amount.
 */
export const serviceProductConsumptionsTable = pgTable("service_product_consumptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").notNull().references(() => servicesTable.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  quantityPerUse: doublePrecision("quantity_per_use").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("service_product_consumptions_service_product_unique").on(table.serviceId, table.productId),
  index("service_product_consumptions_salon_idx").on(table.salonId),
  index("service_product_consumptions_product_idx").on(table.productId),
]);

/**
 * Salon-owned stock of products purchased through the B2B shop. Quantity is
 * tracked in usage units: a purchase of N pieces credits
 * N * unit_content_amount (default 1, owner-adjustable, e.g. 500 for a 500ml
 * bottle). Never touches the platform catalog stock.
 */
export const salonInventoryTable = pgTable("salon_inventory", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  /** Current stock in usage units; clamped at 0 on consumption. */
  quantity: doublePrecision("quantity").notNull().default(0),
  /** Usage units contained in one purchased piece (e.g. 500 for 500ml). */
  unitContentAmount: doublePrecision("unit_content_amount").notNull().default(1),
  /** Display unit for usage quantities (e.g. "ml"); falls back to product unit. */
  usageUnit: text("usage_unit"),
  /** Owner-set warning threshold; null → default of 10% of peak quantity. */
  lowStockThreshold: doublePrecision("low_stock_threshold"),
  /** Highest quantity ever reached — basis for the default threshold. */
  peakQuantity: doublePrecision("peak_quantity").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("salon_inventory_salon_product_unique").on(table.salonId, table.productId),
  index("salon_inventory_product_idx").on(table.productId),
]);

export const salonInventoryMovementTypeEnum = pgEnum("salon_inventory_movement_type", [
  "purchase",
  "consumption",
  "adjustment",
]);

/**
 * Append-only inventory ledger. The partial unique index on
 * (appointment_id, product_id) for consumption rows makes the
 * completion-transition stock decrement idempotent: a re-entered completion
 * cannot debit the same appointment twice.
 */
export const salonInventoryMovementsTable = pgTable("salon_inventory_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  inventoryId: uuid("inventory_id").notNull().references(() => salonInventoryTable.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  type: salonInventoryMovementTypeEnum("type").notNull(),
  /** Positive credit (purchase/adjustment up), negative debit (consumption/adjustment down), in usage units. */
  quantityDelta: doublePrecision("quantity_delta").notNull(),
  appointmentId: uuid("appointment_id").references(() => appointmentsTable.id, { onDelete: "set null" }),
  serviceId: uuid("service_id").references(() => servicesTable.id, { onDelete: "set null" }),
  orderId: uuid("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("salon_inventory_movements_salon_created_idx").on(table.salonId, table.createdAt),
  index("salon_inventory_movements_inventory_created_idx").on(table.inventoryId, table.createdAt),
  index("salon_inventory_movements_product_idx").on(table.productId),
  index("salon_inventory_movements_appointment_idx").on(table.appointmentId),
  index("salon_inventory_movements_service_idx").on(table.serviceId),
  index("salon_inventory_movements_order_idx").on(table.orderId),
  // Idempotency guard: one consumption per (appointment, product).
  uniqueIndex("salon_inventory_movements_consumption_unique")
    .on(table.appointmentId, table.productId)
    .where(sql`${table.type} = 'consumption'`),
]);

/**
 * Employee time clock. One open entry (clock_out_at IS NULL) per employee at a
 * time, enforced by a partial unique index.
 */
export const employeeClockEntriesTable = pgTable("employee_clock_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  clockInAt: timestamp("clock_in_at", { withTimezone: true }).notNull(),
  clockOutAt: timestamp("clock_out_at", { withTimezone: true }),
  /** True when the owner manually corrected/closed the entry. */
  editedByOwner: boolean("edited_by_owner").notNull().default(false),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("employee_clock_entries_salon_in_idx").on(table.salonId, table.clockInAt),
  index("employee_clock_entries_employee_in_idx").on(table.employeeId, table.clockInAt),
  uniqueIndex("employee_clock_entries_one_open_per_employee")
    .on(table.employeeId)
    .where(sql`${table.clockOutAt} is null`),
]);

export const shiftSwapStatusEnum = pgEnum("shift_swap_status", [
  "pending_colleague",
  "colleague_declined",
  "pending_owner",
  "owner_declined",
  "approved",
  "cancelled",
]);

/**
 * Shift swap flow: requester proposes swapping a working day with a colleague
 * from the same salon → colleague accepts/declines → owner approves/declines.
 * Only on owner approval are the two employees' pending/confirmed appointments
 * for that date swapped (in one transaction under the salon-day lock).
 */
export const shiftSwapRequestsTable = pgTable("shift_swap_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  salonId: uuid("salon_id").notNull().references(() => salonsTable.id, { onDelete: "cascade" }),
  requesterEmployeeId: uuid("requester_employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  targetEmployeeId: uuid("target_employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  swapDate: date("swap_date", { mode: "string" }).notNull(),
  note: text("note"),
  status: shiftSwapStatusEnum("status").notNull().default("pending_colleague"),
  colleagueRespondedAt: timestamp("colleague_responded_at", { withTimezone: true }),
  ownerReviewedAt: timestamp("owner_reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("shift_swap_requests_salon_status_idx").on(table.salonId, table.status, table.createdAt),
  index("shift_swap_requests_requester_idx").on(table.requesterEmployeeId, table.createdAt),
  index("shift_swap_requests_target_idx").on(table.targetEmployeeId, table.createdAt),
]);
