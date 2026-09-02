import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, lte, or } from "drizzle-orm";
import {
  coursesTable, db, educationCenterSubscriptionsTable, educationCentersTable,
  educationPaymentObligationsTable, educationPlatformSettingsTable, subscriptionPlansTable, usersTable,
} from "@workspace/db";
import { enqueueTransactionalEmail, lumeraEmailHtml } from "./brevo";
import { addEducationBelgradeCalendarDays, educationIpsPaymentCode, educationIpsQrPayload, educationIpsRuntimeEnvironment } from "./education-marketplace-domain";
import { addEducationBillingPeriod, educationCycleAmount, educationPaymentReference, type EducationBillingCycle } from "./education-subscription-domain";

const DAY = 24 * 60 * 60 * 1000;

export async function runEducationSubscriptionLifecycle() {
  const now = new Date();
  const rows = await db.select({ subscription: educationCenterSubscriptionsTable, center: educationCentersTable, plan: subscriptionPlansTable, owner: usersTable })
    .from(educationCenterSubscriptionsTable)
    .innerJoin(educationCentersTable, eq(educationCentersTable.id, educationCenterSubscriptionsTable.centerId))
    .innerJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, educationCenterSubscriptionsTable.planId))
    .innerJoin(usersTable, eq(usersTable.id, educationCentersTable.ownerId))
    .where(or(
      and(eq(educationCenterSubscriptionsTable.status, "trial"), isNotNull(educationCenterSubscriptionsTable.trialEndsAt), lte(educationCenterSubscriptionsTable.trialEndsAt, new Date(now.getTime() + 7 * DAY))),
      and(eq(educationCenterSubscriptionsTable.status, "active"), isNotNull(educationCenterSubscriptionsTable.currentPeriodEnd), lte(educationCenterSubscriptionsTable.currentPeriodEnd, new Date(now.getTime() + 7 * DAY))),
      and(eq(educationCenterSubscriptionsTable.status, "active"), eq(educationCenterSubscriptionsTable.contractKind, "custom"), isNotNull(educationCenterSubscriptionsTable.contractEndsAt), lte(educationCenterSubscriptionsTable.contractEndsAt, new Date(now.getTime() + 14 * DAY))),
      and(eq(educationCenterSubscriptionsTable.status, "past_due"), isNotNull(educationCenterSubscriptionsTable.graceEndsAt), lte(educationCenterSubscriptionsTable.graceEndsAt, now)),
    ));
  let reminders = 0;
  let transitioned = 0;
  for (const row of rows) {
    const due = row.subscription.contractKind === "custom"
      ? row.subscription.contractEndsAt ?? row.subscription.currentPeriodEnd
      : row.subscription.trialEndsAt ?? row.subscription.currentPeriodEnd;
    if (due && due > now) {
      const days = Math.ceil((due.getTime() - now.getTime()) / DAY);
      const buckets = row.subscription.contractKind === "custom" ? [2, 5, 7, 14] : [2, 5, 7];
      const bucket = buckets.find((value) => days <= value && days > value - 1);
      if (bucket && row.owner.email) {
        const delivery = await enqueueTransactionalEmail(db, {
          eventKey: `education-subscription-expiry:${row.subscription.id}:${educationDateKey(due)}:${bucket}`,
          emailType: "education_subscription_expiry",
          to: { email: row.owner.email, name: `${row.owner.firstName} ${row.owner.lastName}` },
          subject: `Pretplata Education centra ističe za ${bucket} dana`,
          htmlContent: lumeraEmailHtml("Podsetnik za pretplatu", `<p>Vaš plan „${row.plan.name}” ističe za ${bucket} dana.</p><p>Obnovite pretplatu na vreme da bi kursevi ostali javno dostupni.</p>`),
          metadata: { centerId: row.center.id, daysRemaining: bucket },
        });
        if (delivery) reminders += 1;
      }
      continue;
    }
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(educationCenterSubscriptionsTable)
        .where(eq(educationCenterSubscriptionsTable.id, row.subscription.id)).for("update").limit(1);
      if (!locked) return;
      const lockedDue = locked.contractKind === "custom"
        ? locked.contractEndsAt ?? locked.currentPeriodEnd
        : locked.trialEndsAt ?? locked.currentPeriodEnd;
      if ((locked.status === "trial" || locked.status === "active") && lockedDue && lockedDue.getTime() <= now.getTime()) {
        if (!locked.autoRenew) {
          // Cancellation disables charging, not the existing grace/deactivation
          // safety path. No renewal is issued; access then follows grace.
          await tx.update(educationCenterSubscriptionsTable).set({ status: "past_due", graceEndsAt: addEducationBelgradeCalendarDays(now, 5), updatedAt: now })
            .where(eq(educationCenterSubscriptionsTable.id, locked.id));
          transitioned += 1;
          return;
        }
        const pendingChangeDue = Boolean(
          locked.pendingPlanId
          && locked.pendingPlanEffectiveAt
          && locked.pendingPlanEffectiveAt <= now,
        );
        const [settledPendingUpgrade] = pendingChangeDue ? await tx.select().from(educationPaymentObligationsTable).where(and(
          eq(educationPaymentObligationsTable.subscriptionId, locked.id),
          eq(educationPaymentObligationsTable.kind, "subscription_upgrade"),
          eq(educationPaymentObligationsTable.status, "paid"),
          eq(educationPaymentObligationsTable.planIdSnapshot, locked.pendingPlanId!),
        )).orderBy(desc(educationPaymentObligationsTable.confirmedAt)).limit(1) : [];
        const [prepaidRenewal] = await tx.select().from(educationPaymentObligationsTable).where(and(
          eq(educationPaymentObligationsTable.subscriptionId, locked.id),
          eq(educationPaymentObligationsTable.kind, "subscription_renewal"),
          eq(educationPaymentObligationsTable.status, "paid"),
          lte(educationPaymentObligationsTable.servicePeriodStart, now),
          gt(educationPaymentObligationsTable.servicePeriodEnd, now),
        )).limit(1);
        if (prepaidRenewal?.servicePeriodStart && prepaidRenewal.servicePeriodEnd) {
          const applyPendingPlan = Boolean(locked.pendingPlanId && locked.pendingPlanEffectiveAt && locked.pendingPlanEffectiveAt <= prepaidRenewal.servicePeriodStart);
          const appliedPlanId = applyPendingPlan ? locked.pendingPlanId! : prepaidRenewal.planIdSnapshot ?? locked.planId;
          const appliedCycle = applyPendingPlan
            ? locked.pendingBillingCycle ?? prepaidRenewal.billingCycleSnapshot ?? locked.billingCycle
            : prepaidRenewal.billingCycleSnapshot ?? locked.billingCycle;
          const appliedSnapshot = applyPendingPlan && settledPendingUpgrade ? settledPendingUpgrade : prepaidRenewal;
          await tx.update(educationCenterSubscriptionsTable).set({
            planId: appliedPlanId,
            billingCycle: appliedCycle,
            ...(applyPendingPlan ? {
              pendingPlanId: null, pendingBillingCycle: null, pendingPlanEffectiveAt: null,
            } : {}),
            status: "active", currentPeriodStart: prepaidRenewal.servicePeriodStart,
            currentPeriodEnd: prepaidRenewal.servicePeriodEnd, graceEndsAt: null, deactivatedAt: null, updatedAt: now,
            currentPriceSnapshot: appliedSnapshot.planMonthlyPriceSnapshot ?? locked.currentPriceSnapshot,
          }).where(eq(educationCenterSubscriptionsTable.id, locked.id));
          const [paidPlan] = await tx.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, appliedPlanId)).limit(1);
          const courseLimit = appliedSnapshot.courseLimitSnapshot ?? (locked.contractKind === "custom" ? locked.courseLimitOverride ?? 0 : paidPlan?.courseLimit ?? paidPlan?.limits["courses"] ?? 0);
          await tx.update(educationCenterSubscriptionsTable).set({ currentCourseLimitSnapshot: courseLimit, pendingKeepCourseIds: null }).where(eq(educationCenterSubscriptionsTable.id, locked.id));
          const published = await tx.select({ id: coursesTable.id }).from(coursesTable)
            .where(and(eq(coursesTable.centerId, locked.centerId), eq(coursesTable.published, true), eq(coursesTable.archived, false)))
            .orderBy(coursesTable.createdAt).for("update");
          const keep = new Set(applyPendingPlan ? locked.pendingKeepCourseIds ?? published.slice(0, courseLimit).map((course) => course.id) : published.slice(0, courseLimit).map((course) => course.id));
          const extras = published.filter((course) => !keep.has(course.id)).map((course) => course.id);
          if (extras.length) await tx.update(coursesTable).set({ published: false, subscriptionSuspended: true, updatedAt: now }).where(inArray(coursesTable.id, extras));
          const available = Math.max(0, courseLimit - (published.length - extras.length));
          if (available) {
            const drafts = await tx.select({ id: coursesTable.id }).from(coursesTable)
              .where(and(eq(coursesTable.centerId, locked.centerId), eq(coursesTable.published, false), eq(coursesTable.subscriptionSuspended, true), eq(coursesTable.archived, false)))
              .orderBy(coursesTable.createdAt).limit(available).for("update");
            if (drafts.length) await tx.update(coursesTable).set({ published: true, subscriptionSuspended: false, updatedAt: now }).where(inArray(coursesTable.id, drafts.map((course) => course.id)));
          }
          transitioned += 1;
          return;
        }
        const graceEndsAt = addEducationBelgradeCalendarDays(now, 5);
         const [pendingUpgrade] = await tx.select({ id: educationPaymentObligationsTable.id }).from(educationPaymentObligationsTable)
           .where(and(eq(educationPaymentObligationsTable.subscriptionId, locked.id), eq(educationPaymentObligationsTable.kind, "subscription_upgrade"), eq(educationPaymentObligationsTable.status, "pending"))).limit(1);
         if (pendingUpgrade) {
           await tx.update(educationPaymentObligationsTable).set({ status: "cancelled", cancelledAt: now })
             .where(eq(educationPaymentObligationsTable.id, pendingUpgrade.id));
         }
          const nextPlanId = pendingUpgrade ? locked.planId : (locked.pendingPlanId ?? locked.planId);
          const nextCycle = (pendingUpgrade ? locked.billingCycle : (locked.pendingBillingCycle ?? locked.billingCycle)) as EducationBillingCycle;
        const [nextPlan] = nextPlanId === row.plan.id ? [row.plan] : await tx.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, nextPlanId)).limit(1);
        if (!nextPlan) return;
        const amount = locked.contractKind === "custom" ? locked.dueAmount : educationCycleAmount(nextPlan.price, nextCycle);
         const effectiveCourseLimit = settledPendingUpgrade?.courseLimitSnapshot
           ?? (locked.contractKind === "custom" ? locked.courseLimitOverride ?? 0 : nextPlan.courseLimit ?? nextPlan.limits["courses"] ?? 0);
        const periodStart = locked.currentPeriodEnd && locked.currentPeriodEnd > now ? locked.currentPeriodEnd : now;
        const periodEnd = locked.contractKind === "custom" && locked.contractEndsAt ? locked.contractEndsAt : addEducationBillingPeriod(periodStart, nextCycle);
        await tx.update(educationCenterSubscriptionsTable).set({
          planId: nextPlanId, billingCycle: nextCycle, status: "past_due", dueAmount: amount,
          pendingPlanId: null, pendingBillingCycle: null, pendingPlanEffectiveAt: null,
           ...(pendingChangeDue && settledPendingUpgrade ? {
             currentPriceSnapshot: settledPendingUpgrade.planMonthlyPriceSnapshot ?? nextPlan.price,
             currentCourseLimitSnapshot: effectiveCourseLimit,
           } : {}),
          graceEndsAt, updatedAt: now,
        }).where(eq(educationCenterSubscriptionsTable.id, locked.id));
         if (pendingChangeDue && settledPendingUpgrade) {
           const published = await tx.select({ id: coursesTable.id }).from(coursesTable)
             .where(and(eq(coursesTable.centerId, locked.centerId), eq(coursesTable.published, true), eq(coursesTable.archived, false)))
             .orderBy(asc(coursesTable.createdAt)).for("update");
           const keep = new Set(locked.pendingKeepCourseIds ?? published.slice(0, effectiveCourseLimit).map((course) => course.id));
           const extras = published.filter((course) => !keep.has(course.id)).map((course) => course.id);
           if (extras.length) await tx.update(coursesTable).set({ published: false, subscriptionSuspended: true, updatedAt: now }).where(inArray(coursesTable.id, extras));
           const available = Math.max(0, effectiveCourseLimit - (published.length - extras.length));
           if (available) {
             const drafts = await tx.select({ id: coursesTable.id }).from(coursesTable)
               .where(and(eq(coursesTable.centerId, locked.centerId), eq(coursesTable.published, false), eq(coursesTable.subscriptionSuspended, true), eq(coursesTable.archived, false)))
               .orderBy(asc(coursesTable.createdAt)).limit(available).for("update");
             if (drafts.length) await tx.update(coursesTable).set({ published: true, subscriptionSuspended: false, updatedAt: now }).where(inArray(coursesTable.id, drafts.map((course) => course.id)));
           }
         }
        const [existingPayment] = await tx.select({ id: educationPaymentObligationsTable.id }).from(educationPaymentObligationsTable)
          .where(and(eq(educationPaymentObligationsTable.subscriptionId, locked.id), eq(educationPaymentObligationsTable.kind, "subscription_renewal"), eq(educationPaymentObligationsTable.status, "pending"))).limit(1);
         if (!existingPayment && periodEnd > periodStart && amount > 0
             && (locked.contractKind === "custom" || (nextPlan.active && nextPlan.audience === "education" && nextPlan.price > 0))) {
          const [settings] = await tx.select().from(educationPlatformSettingsTable).orderBy(asc(educationPlatformSettingsTable.createdAt)).limit(1);
          if (settings?.ipsRecipientName && settings.ipsRecipientAccount) {
            const obligationId = randomUUID();
            const reference = educationPaymentReference("SUB", obligationId);
            const purpose = "Pretplata za Education centar";
            await tx.insert(educationPaymentObligationsTable).values({
              id: obligationId, centerId: locked.centerId, subscriptionId: locked.id, kind: "subscription_renewal",
               planIdSnapshot: nextPlanId,
               planMonthlyPriceSnapshot: nextPlan.price,
               courseLimitSnapshot: locked.contractKind === "custom" ? locked.courseLimitOverride : nextPlan.courseLimit ?? nextPlan.limits["courses"] ?? null,
              expectedAmount: amount, recipientNameSnapshot: settings.ipsRecipientName, recipientAccountSnapshot: settings.ipsRecipientAccount,
              paymentCodeSnapshot: educationIpsPaymentCode("platform"), purposeSnapshot: purpose, referenceSnapshot: reference,
              billingCycleSnapshot: nextCycle, servicePeriodStart: periodStart, servicePeriodEnd: periodEnd,
              ipsPayloadSnapshot: JSON.stringify(educationIpsQrPayload({ recipientName: settings.ipsRecipientName, recipientAccount: settings.ipsRecipientAccount, purpose, amount, reference, recipientType: "platform", transactionType: "subscription", accountEnvironment: settings.ipsAccountEnvironment as "production" | "test", runtimeEnvironment: educationIpsRuntimeEnvironment() })),
            });
          }
        }
        transitioned += 1;
      } else if (locked.status === "past_due" && locked.graceEndsAt && locked.graceEndsAt <= now) {
        await tx.update(educationCenterSubscriptionsTable).set({ status: "suspended", deactivatedAt: now, updatedAt: now }).where(eq(educationCenterSubscriptionsTable.id, locked.id));
        await tx.update(coursesTable).set({ published: false, subscriptionSuspended: true, updatedAt: now }).where(and(eq(coursesTable.centerId, locked.centerId), eq(coursesTable.published, true)));
        transitioned += 1;
      }
    });
  }
  return { reminders, transitioned };
}

function educationDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}