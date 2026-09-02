/**
 * Package entitlement and redemption service.
 *
 * Handles:
 *  - Atomic session decrement + appointment price zeroing in one transaction
 *  - Idempotent session restore + original price restore on reversal
 *  - Cross-salon boundary enforcement
 *  - Expiry enforcement
 *  - Concurrent safety via FOR UPDATE row locks
 *  - Auto-reversal when a redeemed appointment is cancelled
 */

import { and, eq, sql } from "drizzle-orm";
import {
  db,
  customerPackagePurchasesTable,
  packageRedemptionsTable,
  treatmentPackagesTable,
  packageServiceLinksTable,
  packagePurchaseServiceLinksTable,
  appointmentsTable,
  salonCustomersTable,
} from "@workspace/db";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Transaction type — a drizzle transaction OR the db handle.
// All core routines accept a caller-provided tx so booking and redemption can
// commit/rollback atomically.
// ---------------------------------------------------------------------------

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RedeemResult =
  | { ok: true; redemptionId: string; remainingSessions: number }
  | { ok: false; reason: "not_found" | "wrong_salon" | "wrong_customer" | "already_redeemed" | "no_sessions_left" | "expired" | "not_active" | "service_not_covered" | "appointment_not_eligible" };

export type ReverseResult =
  | { ok: true; remainingSessions: number }
  | { ok: false; reason: "not_found" | "already_reversed" | "wrong_salon" };
type RedeemFailureReason = Extract<RedeemResult, { ok: false }>["reason"];

function validatePackageEntitlement(
  purchase: typeof customerPackagePurchasesTable.$inferSelect,
  links: (typeof packagePurchaseServiceLinksTable.$inferSelect)[],
  input: { salonId: string; salonCustomerId: string; requiredByService: Map<string, number>; now?: Date },
): { ok: true; remainingSessions: number } | { ok: false; reason: RedeemFailureReason } {
  if (purchase.salonId !== input.salonId) return { ok: false, reason: "wrong_salon" };
  if (purchase.salonCustomerId !== input.salonCustomerId) return { ok: false, reason: "wrong_customer" };
  if (purchase.status !== "active") return { ok: false, reason: "not_active" };
  if (purchase.expiresAt <= (input.now ?? new Date())) return { ok: false, reason: "expired" };
  const required = [...input.requiredByService.values()].reduce((total, count) => total + count, 0);
  if (purchase.remainingSessions < required) return { ok: false, reason: "no_sessions_left" };
  const linksByService = new Map(links.map((link) => [link.serviceId, link]));
  for (const [serviceId, count] of input.requiredByService) {
    const link = linksByService.get(serviceId);
    if (!link) return { ok: false, reason: "service_not_covered" };
    if (purchase.quotaPolicy === "per_service" && link.remainingQuota < count) {
      return { ok: false, reason: "no_sessions_left" };
    }
  }
  return { ok: true, remainingSessions: purchase.remainingSessions };
}

/** Read-only entitlement check used by booking previews. Creation must still
 * call redeemPackageSessionInTx, which locks and revalidates this snapshot. */
export async function packageEntitlementForServices(
  store: DbOrTx,
  input: { purchaseId: string; salonId: string; salonCustomerId: string; requiredByService: Map<string, number>; now?: Date },
): Promise<{ ok: true; remainingSessions: number } | { ok: false; reason: RedeemFailureReason }> {
  const [purchase] = await store.select().from(customerPackagePurchasesTable)
    .where(eq(customerPackagePurchasesTable.id, input.purchaseId)).limit(1);
  if (!purchase) return { ok: false, reason: "not_found" };
  const links = await store.select().from(packagePurchaseServiceLinksTable)
    .where(eq(packagePurchaseServiceLinksTable.purchaseId, purchase.id));
  return validatePackageEntitlement(purchase, links, input);
}

/**
 * Creation-time entitlement snapshot. The purchase and all immutable service
 * snapshot rows remain locked until the caller's transaction commits, so an
 * exact-all-remaining booking cannot race a cancellation/reversal restore.
 */
export async function lockPackageEntitlementForServicesInTx(
  tx: Tx,
  input: { purchaseId: string; salonId: string; salonCustomerId: string; requiredByService: Map<string, number>; now?: Date },
): Promise<
  | {
      ok: true;
      remainingSessions: number;
      purchase: typeof customerPackagePurchasesTable.$inferSelect;
      links: (typeof packagePurchaseServiceLinksTable.$inferSelect)[];
    }
  | { ok: false; reason: RedeemFailureReason }
> {
  const [purchase] = await tx.select().from(customerPackagePurchasesTable)
    .where(eq(customerPackagePurchasesTable.id, input.purchaseId)).for("update");
  if (!purchase) return { ok: false, reason: "not_found" };
  const links = await tx.select().from(packagePurchaseServiceLinksTable)
    .where(eq(packagePurchaseServiceLinksTable.purchaseId, purchase.id))
    .for("update");
  const validation = validatePackageEntitlement(purchase, links, input);
  if (!validation.ok) return validation;
  return { ...validation, purchase, links };
}

// ---------------------------------------------------------------------------
// Core redeem logic — operates within a caller-supplied transaction.
// Never opens its own transaction; the caller controls commit/rollback so
// appointment creation + redemption can be fully atomic.
// ---------------------------------------------------------------------------

export async function redeemPackageSessionInTx(
  tx: Tx,
  input: {
    purchaseId: string;
    appointmentId: string;
    salonId: string;
    requestingCustomerId: string; // salonCustomerId
    now?: Date;
  },
): Promise<RedeemResult> {
  const now = input.now ?? new Date();

  {
    // Lock purchase row for the duration of this transaction
    const [purchase] = await tx
      .select()
      .from(customerPackagePurchasesTable)
      .where(eq(customerPackagePurchasesTable.id, input.purchaseId))
      .for("update");

    if (!purchase) return { ok: false, reason: "not_found" };
    if (purchase.salonId !== input.salonId) return { ok: false, reason: "wrong_salon" };
    if (purchase.salonCustomerId !== input.requestingCustomerId) return { ok: false, reason: "wrong_customer" };
    if (purchase.status !== "active") return { ok: false, reason: "not_active" };
    if (purchase.expiresAt <= now) return { ok: false, reason: "expired" };
    if (purchase.remainingSessions <= 0) return { ok: false, reason: "no_sessions_left" };

    // Lock the appointment row too
    const [appt] = await tx
      .select()
      .from(appointmentsTable)
      .where(eq(appointmentsTable.id, input.appointmentId))
      .for("update");

    if (!appt) return { ok: false, reason: "not_found" };
    if (appt.salonId !== input.salonId) return { ok: false, reason: "wrong_salon" };
    if (appt.salonCustomerId !== input.requestingCustomerId) return { ok: false, reason: "wrong_customer" };

    // Lifecycle guard: only PENDING or CONFIRMED appointments may consume a
    // package session. Cancelled/completed/no-show appointments must never
    // trigger a decrement, price zeroing, or redemption insert — otherwise a
    // package session could be silently burned against an appointment that was
    // already settled, cancelled, or missed. Enforced in the core so every
    // caller (direct redeem endpoint and any future callers) is protected;
    // the atomic booking path is unaffected because it always creates a
    // freshly-inserted pending/confirmed appointment.
    if (appt.status !== "pending" && appt.status !== "confirmed") {
      return { ok: false, reason: "appointment_not_eligible" };
    }

    // Check the appointment's service is covered by the PURCHASE SNAPSHOT.
    // The snapshot (package_purchase_service_links) is populated transactionally
    // at purchase creation and is immutable — it reflects the services that were
    // covered when the customer bought the package, independent of any subsequent
    // edits to the package definition.
    // If the snapshot is empty (should not happen for valid purchases, but handled
    // fail-safe) we reject rather than broadening access.
    const [snapshotLink] = await tx
      .select({
        id: packagePurchaseServiceLinksTable.id,
        serviceId: packagePurchaseServiceLinksTable.serviceId,
        remainingQuota: packagePurchaseServiceLinksTable.remainingQuota,
      })
      .from(packagePurchaseServiceLinksTable)
      .where(and(
        eq(packagePurchaseServiceLinksTable.purchaseId, input.purchaseId),
        eq(packagePurchaseServiceLinksTable.serviceId, appt.serviceId),
      ))
      .limit(1);
    if (!snapshotLink) return { ok: false, reason: "service_not_covered" };
    if (purchase.quotaPolicy === "per_service" && snapshotLink.remainingQuota <= 0) {
      return { ok: false, reason: "no_sessions_left" };
    }

    // Idempotency: check for existing active redemption
    const [existing] = await tx
      .select({ id: packageRedemptionsTable.id, status: packageRedemptionsTable.status })
      .from(packageRedemptionsTable)
      .where(and(
        eq(packageRedemptionsTable.purchaseId, input.purchaseId),
        eq(packageRedemptionsTable.appointmentId, input.appointmentId),
      ))
      .limit(1);
    if (existing?.status === "redeemed") return { ok: false, reason: "already_redeemed" };

    // Per-service purchases consume the immutable service snapshot balance as
    // well as the legacy aggregate compatibility balance. The purchase row lock
    // serializes aggregate changes; this guarded update makes the service cap
    // independently fail closed if an out-of-band writer races us.
    if (purchase.quotaPolicy === "per_service") {
      const decremented = await tx
        .update(packagePurchaseServiceLinksTable)
        .set({ remainingQuota: sql`${packagePurchaseServiceLinksTable.remainingQuota} - 1` })
        .where(and(
          eq(packagePurchaseServiceLinksTable.id, snapshotLink.id),
          sql`${packagePurchaseServiceLinksTable.remainingQuota} > 0`,
        ))
        .returning({ id: packagePurchaseServiceLinksTable.id });
      if (!decremented.length) return { ok: false, reason: "no_sessions_left" };
    }

    // Atomic aggregate decrement — retained for backwards compatibility.
    const [updatedPurchase] = await tx
      .update(customerPackagePurchasesTable)
      .set({
        remainingSessions: sql`${customerPackagePurchasesTable.remainingSessions} - 1`,
        updatedAt: now,
      })
      .where(and(
        eq(customerPackagePurchasesTable.id, input.purchaseId),
        sql`${customerPackagePurchasesTable.remainingSessions} > 0`,
      ))
      .returning();
    if (!updatedPurchase) return { ok: false, reason: "no_sessions_left" };

    // Zero out appointment price (package is the payment instrument)
    const originalPrice = appt.price;
    await tx
      .update(appointmentsTable)
      .set({ price: 0 })
      .where(eq(appointmentsTable.id, input.appointmentId));

    // Insert redemption record with original price snapshot
    const [redemption] = await tx
      .insert(packageRedemptionsTable)
      .values({
        purchaseId: input.purchaseId,
        salonId: input.salonId,
        appointmentId: input.appointmentId,
        salonCustomerId: input.requestingCustomerId,
        purchaseServiceLinkId: snapshotLink.id,
        serviceId: snapshotLink.serviceId,
        status: "redeemed",
        originalAppointmentPrice: originalPrice,
        redeemedAt: now,
      })
      .returning();

    if (!redemption) {
      logger.error({ purchaseId: input.purchaseId, appointmentId: input.appointmentId }, "Redemption insert failed after decrement");
      throw new Error("Redemption insert failed");
    }

    // Mark purchase as completed when no sessions remain
    if (updatedPurchase.remainingSessions <= 0) {
      await tx
        .update(customerPackagePurchasesTable)
        .set({ status: "completed", updatedAt: now })
        .where(eq(customerPackagePurchasesTable.id, input.purchaseId));
    }

    return { ok: true, redemptionId: redemption.id, remainingSessions: updatedPurchase.remainingSessions };
  }
}

// ---------------------------------------------------------------------------
// Redeem a session against an appointment (opens its own transaction)
// ---------------------------------------------------------------------------

export async function redeemPackageSession(input: {
  purchaseId: string;
  appointmentId: string;
  salonId: string;
  requestingCustomerId: string; // salonCustomerId
  now?: Date;
}): Promise<RedeemResult> {
  return await db.transaction(async (tx) => redeemPackageSessionInTx(tx, input));
}

// ---------------------------------------------------------------------------
// Core reverse logic — operates within a caller-supplied transaction.
// Idempotent: reversing an already-reversed redemption returns already_reversed
// without double-restoring session count or price.
// ---------------------------------------------------------------------------

export async function reversePackageRedemptionInTx(
  tx: Tx,
  input: {
    redemptionId: string;
    salonId: string;
    reversedByUserId?: string | null;
    now?: Date;
  },
): Promise<ReverseResult> {
  const now = input.now ?? new Date();

  {
    const [redemption] = await tx
      .select()
      .from(packageRedemptionsTable)
      .where(eq(packageRedemptionsTable.id, input.redemptionId))
      .for("update");

    if (!redemption) return { ok: false, reason: "not_found" };
    if (redemption.salonId !== input.salonId) return { ok: false, reason: "wrong_salon" };
    if (redemption.status === "reversed") return { ok: false, reason: "already_reversed" };

    const [purchase] = await tx
      .select()
      .from(customerPackagePurchasesTable)
      .where(eq(customerPackagePurchasesTable.id, redemption.purchaseId))
      .for("update");
    if (!purchase) return { ok: false, reason: "not_found" };

    // Mark reversed — conditional on still being 'redeemed' so exactly one
    // caller performs the restore even under concurrent reversal attempts.
    const marked = await tx
      .update(packageRedemptionsTable)
      .set({ status: "reversed", reversedAt: now, reversedByUserId: input.reversedByUserId ?? null })
      .where(and(
        eq(packageRedemptionsTable.id, input.redemptionId),
        eq(packageRedemptionsTable.status, "redeemed"),
      ))
      .returning({ id: packageRedemptionsTable.id });
    if (!marked.length) return { ok: false, reason: "already_reversed" };

    // Restore exactly the snapshot balance consumed by this redemption. Legacy
    // rows have no snapshot link and intentionally remain aggregate-only.
    if (purchase.quotaPolicy === "per_service") {
      if (!redemption.purchaseServiceLinkId) {
        throw new Error("Per-service redemption is missing its service snapshot link");
      }
      const restoredLink = await tx
        .update(packagePurchaseServiceLinksTable)
        .set({ remainingQuota: sql`${packagePurchaseServiceLinksTable.remainingQuota} + 1` })
        .where(eq(packagePurchaseServiceLinksTable.id, redemption.purchaseServiceLinkId))
        .returning({ id: packagePurchaseServiceLinksTable.id });
      if (!restoredLink.length) {
        throw new Error("Per-service redemption snapshot link is missing");
      }
    }

    // Restore aggregate session count
    const [updatedPurchase] = await tx
      .update(customerPackagePurchasesTable)
      .set({
        remainingSessions: sql`${customerPackagePurchasesTable.remainingSessions} + 1`,
        // Re-activate if was completed
        status: purchase.status === "completed" ? "active" : purchase.status,
        updatedAt: now,
      })
      .where(eq(customerPackagePurchasesTable.id, redemption.purchaseId))
      .returning();

    // Restore original appointment price
    if (redemption.originalAppointmentPrice > 0) {
      await tx
        .update(appointmentsTable)
        .set({ price: redemption.originalAppointmentPrice })
        .where(eq(appointmentsTable.id, redemption.appointmentId));
    }

    return { ok: true, remainingSessions: updatedPurchase?.remainingSessions ?? purchase.remainingSessions + 1 };
  }
}

// ---------------------------------------------------------------------------
// Reverse a redemption (opens its own transaction)
// ---------------------------------------------------------------------------

export async function reversePackageRedemption(input: {
  redemptionId: string;
  salonId: string;
  reversedByUserId?: string | null;
  now?: Date;
}): Promise<ReverseResult> {
  return await db.transaction(async (tx) => reversePackageRedemptionInTx(tx, input));
}

// ---------------------------------------------------------------------------
// Auto-reversal: called when an appointment is cancelled
// ---------------------------------------------------------------------------

export async function handleAppointmentCancellationReversalsInTx(
  tx: Tx,
  appointmentId: string,
  salonId: string,
  now = new Date(),
): Promise<number> {
  // Find all active redemptions for this appointment. Lock them so a concurrent
  // reversal (e.g. owner endpoint) cannot double-restore.
  const redemptions = await tx
    .select({ id: packageRedemptionsTable.id })
    .from(packageRedemptionsTable)
    .where(and(
      eq(packageRedemptionsTable.appointmentId, appointmentId),
      eq(packageRedemptionsTable.status, "redeemed"),
    ))
    .for("update");

  let reversed = 0;
  for (const r of redemptions) {
    const result = await reversePackageRedemptionInTx(tx, {
      redemptionId: r.id,
      salonId,
      reversedByUserId: null,
      now,
    });
    if (result.ok) reversed++;
    else if (result.reason !== "already_reversed") {
      logger.warn({ redemptionId: r.id, reason: result.reason }, "Auto-reversal failed");
    }
  }
  return reversed;
}

/**
 * Auto-reversal entrypoint — opens its own transaction. Used by reconciliation /
 * out-of-band callers. Transaction-aware callers should use the InTx variant so
 * the status transition and reversals commit atomically.
 */
export async function handleAppointmentCancellationReversals(
  appointmentId: string,
  salonId: string,
  now = new Date(),
): Promise<number> {
  return await db.transaction(async (tx) =>
    handleAppointmentCancellationReversalsInTx(tx, appointmentId, salonId, now),
  );
}
