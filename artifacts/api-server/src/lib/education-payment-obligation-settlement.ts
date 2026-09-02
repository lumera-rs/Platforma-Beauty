import { and, asc, eq, inArray } from "drizzle-orm";
import {
  courseEnrollmentsTable,
  coursesTable,
  db,
  educationAccessExtensionsTable,
  educationCenterSubscriptionsTable,
  educationFinancialAuditLogTable,
  educationPaymentObligationsTable,
  subscriptionPlansTable,
} from "@workspace/db";
import { addEducationBillingPeriod, type EducationBillingCycle } from "./education-subscription-domain";

type EducationSettlementTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type EducationPaymentObligationSettlementFailure =
  | "NOT_FOUND"
  | "ALREADY_SETTLED"
  | "AMOUNT_MISMATCH";

export type EducationPaymentObligationSettlementResult =
  | { ok: true; obligation: typeof educationPaymentObligationsTable.$inferSelect }
  | { ok: false; code: EducationPaymentObligationSettlementFailure };

export type EducationPaymentObligationSettlementInput = {
  obligationId: string;
  confirmedAmountRsd: number;
  actorUserId: string | null;
  reason: string;
  source: "manual" | "bank_reconciliation";
  bankTransactionId?: string;
};

const addMonths = (date: Date, months: number) => {
  let result = date;
  for (let index = 0; index < months; index += 1) result = addEducationBillingPeriod(result, "monthly");
  return result;
};

/**
 * Sole settlement boundary for an Education payment obligation. Every caller
 * receives the same row locks, state checks, side effects and financial audit.
 */
export async function settleEducationPaymentObligationInTransaction(
  tx: EducationSettlementTransaction,
  input: EducationPaymentObligationSettlementInput,
): Promise<EducationPaymentObligationSettlementResult> {
  const [obligationPreview] = await tx.select({
    id: educationPaymentObligationsTable.id,
    subscriptionId: educationPaymentObligationsTable.subscriptionId,
  }).from(educationPaymentObligationsTable)
    .where(eq(educationPaymentObligationsTable.id, input.obligationId))
    .limit(1);
  if (!obligationPreview) return { ok: false, code: "NOT_FOUND" };

  // Keep the historical subscription -> obligation order in one canonical
  // function so manual and automated confirmation cannot deadlock each other.
  const [lockedSubscription] = obligationPreview.subscriptionId
    ? await tx.select().from(educationCenterSubscriptionsTable)
      .where(eq(educationCenterSubscriptionsTable.id, obligationPreview.subscriptionId))
      .for("update")
      .limit(1)
    : [];
  if (obligationPreview.subscriptionId && !lockedSubscription) return { ok: false, code: "NOT_FOUND" };

  const [obligation] = await tx.select().from(educationPaymentObligationsTable)
    .where(eq(educationPaymentObligationsTable.id, input.obligationId))
    .for("update")
    .limit(1);
  if (!obligation) return { ok: false, code: "NOT_FOUND" };
  if (obligation.status !== "pending") return { ok: false, code: "ALREADY_SETTLED" };
  if (input.confirmedAmountRsd !== obligation.expectedAmount) return { ok: false, code: "AMOUNT_MISMATCH" };

  const settledAt = new Date();
  const [saved] = await tx.update(educationPaymentObligationsTable).set({
    status: "paid",
    confirmedAmount: input.confirmedAmountRsd,
    confirmedAt: settledAt,
    confirmedByUserId: input.actorUserId,
  }).where(and(
    eq(educationPaymentObligationsTable.id, obligation.id),
    eq(educationPaymentObligationsTable.status, "pending"),
  )).returning();
  if (!saved) return { ok: false, code: "ALREADY_SETTLED" };

  if (obligation.enrollmentId) {
    const [extension] = await tx.select().from(educationAccessExtensionsTable)
      .where(eq(educationAccessExtensionsTable.paymentObligationId, obligation.id))
      .for("update")
      .limit(1);
    if (extension) {
      const [enrollment] = await tx.select().from(courseEnrollmentsTable)
        .where(eq(courseEnrollmentsTable.id, obligation.enrollmentId))
        .for("update")
        .limit(1);
      if (!enrollment) throw new Error("Education enrollment disappeared during settlement.");
      const base = enrollment.accessExpiresAt && enrollment.accessExpiresAt > settledAt
        ? enrollment.accessExpiresAt
        : settledAt;
      const extendedAccessExpiresAt = addMonths(base, extension.months);
      await tx.update(educationAccessExtensionsTable).set({
        status: "settled",
        settledAt,
        previousAccessExpiresAt: base,
        extendedAccessExpiresAt,
      }).where(and(
        eq(educationAccessExtensionsTable.id, extension.id),
        eq(educationAccessExtensionsTable.status, "pending"),
      ));
      await tx.update(courseEnrollmentsTable).set({
        accessExpiresAt: extendedAccessExpiresAt,
        updatedAt: settledAt,
      }).where(eq(courseEnrollmentsTable.id, obligation.enrollmentId));
    }
  }

  if (obligation.subscriptionId) {
    const subscription = lockedSubscription;
    if (!subscription) throw new Error("Education subscription disappeared during settlement.");
    const upgrade = obligation.kind === "subscription_upgrade";
    const prepaidRenewal = obligation.kind === "subscription_renewal"
      && Boolean(obligation.servicePeriodStart && obligation.servicePeriodStart > settledAt);
    const scheduledPlanPaidByRenewal = obligation.kind === "subscription_renewal"
      && Boolean(
        subscription.pendingPlanId
        && subscription.pendingPlanEffectiveAt
        && obligation.servicePeriodStart
        && subscription.pendingPlanEffectiveAt <= obligation.servicePeriodStart,
      );
    const snapshotPlanId = obligation.planIdSnapshot ?? subscription.planId;
    const snapshotCycle = (obligation.billingCycleSnapshot ?? subscription.billingCycle) as EducationBillingCycle;
    const [snapshotPlan] = await tx.select().from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.id, snapshotPlanId))
      .limit(1);
    const payableCourseLimit = obligation.courseLimitSnapshot
      ?? (subscription.contractKind === "custom"
        ? subscription.courseLimitOverride ?? 0
        : snapshotPlan?.courseLimit ?? snapshotPlan?.limits["courses"] ?? 0);
    const deferredUpgradeCycle = upgrade
      && Boolean(
        subscription.pendingBillingCycle
        && subscription.pendingBillingCycle !== snapshotCycle
        && subscription.pendingPlanEffectiveAt
        && subscription.pendingPlanEffectiveAt > settledAt,
      );
    const applyUpgradeNow = upgrade && !deferredUpgradeCycle;
    const requiresManualReactivation = subscription.status === "suspended" || Boolean(subscription.deactivatedAt);
    await tx.update(educationCenterSubscriptionsTable).set(prepaidRenewal ? {
      paidAt: settledAt,
      updatedAt: settledAt,
    } : {
      ...(applyUpgradeNow || obligation.kind === "subscription_renewal"
        ? { planId: snapshotPlanId, billingCycle: snapshotCycle }
        : {}),
      ...(subscription.pendingPlanId && ((upgrade && !deferredUpgradeCycle) || scheduledPlanPaidByRenewal)
        ? { pendingPlanId: null, pendingBillingCycle: null, pendingPlanEffectiveAt: null }
        : {}),
      status: requiresManualReactivation ? "suspended" : "active",
      paidAt: settledAt,
      ...(!deferredUpgradeCycle ? {
        currentPriceSnapshot: obligation.planMonthlyPriceSnapshot ?? snapshotPlan?.price ?? subscription.currentPriceSnapshot,
        currentCourseLimitSnapshot: payableCourseLimit,
      } : {}),
      currentPeriodStart: upgrade ? subscription.currentPeriodStart : obligation.servicePeriodStart ?? settledAt,
      currentPeriodEnd: upgrade
        ? subscription.currentPeriodEnd
        : obligation.servicePeriodEnd ?? addEducationBillingPeriod(settledAt, snapshotCycle),
      graceEndsAt: null,
      deactivatedAt: requiresManualReactivation ? subscription.deactivatedAt ?? settledAt : null,
      ...(requiresManualReactivation ? { pendingKeepCourseIds: null } : {}),
      updatedAt: settledAt,
    }).where(eq(educationCenterSubscriptionsTable.id, obligation.subscriptionId));

    if (
      !requiresManualReactivation
      && !prepaidRenewal
      && !deferredUpgradeCycle
      && (obligation.kind === "subscription_renewal" || obligation.kind === "subscription_upgrade")
    ) {
      const publishedCourses = await tx.select({ id: coursesTable.id }).from(coursesTable)
        .where(and(
          eq(coursesTable.centerId, subscription.centerId),
          eq(coursesTable.published, true),
          eq(coursesTable.archived, false),
        ))
        .orderBy(asc(coursesTable.createdAt))
        .for("update");
      const selected = new Set(
        subscription.pendingKeepCourseIds
        ?? publishedCourses.slice(0, payableCourseLimit).map((row) => row.id),
      );
      const extras = publishedCourses
        .filter((row) => !selected.has(row.id) || selected.size > payableCourseLimit)
        .map((row) => row.id);
      if (extras.length) {
        await tx.update(coursesTable).set({
          published: false,
          subscriptionSuspended: true,
          updatedAt: settledAt,
        }).where(inArray(coursesTable.id, extras));
      }
      const remaining = Math.max(0, payableCourseLimit - (publishedCourses.length - extras.length));
      if (remaining > 0) {
        const eligible = await tx.select({ id: coursesTable.id }).from(coursesTable)
          .where(and(
            eq(coursesTable.centerId, subscription.centerId),
            eq(coursesTable.published, false),
            eq(coursesTable.subscriptionSuspended, true),
            eq(coursesTable.archived, false),
          ))
          .orderBy(asc(coursesTable.createdAt))
          .limit(remaining)
          .for("update");
        if (eligible.length) {
          await tx.update(coursesTable).set({
            published: true,
            subscriptionSuspended: false,
            updatedAt: settledAt,
          }).where(inArray(coursesTable.id, eligible.map((row) => row.id)));
        }
      }
      await tx.update(educationCenterSubscriptionsTable).set({ pendingKeepCourseIds: null })
        .where(eq(educationCenterSubscriptionsTable.id, subscription.id));
    }
  }

  await tx.insert(educationFinancialAuditLogTable).values({
    actorUserId: input.actorUserId,
    action: "education_payment_obligation_settled",
    entityType: "education_payment_obligation",
    entityId: obligation.id,
    oldValue: { status: obligation.status, expectedAmount: obligation.expectedAmount },
    newValue: {
      status: "paid",
      confirmedAmount: input.confirmedAmountRsd,
      ...(input.source === "bank_reconciliation"
        ? { settlementSource: input.source, bankTransactionId: input.bankTransactionId }
        : {}),
    },
    reason: input.reason,
  });
  return { ok: true, obligation: saved };
}