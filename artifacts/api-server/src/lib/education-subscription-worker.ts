import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, isNotNull, lte, or } from "drizzle-orm";
import {
  coursesTable, db, educationCenterSubscriptionsTable, educationCentersTable,
  educationPaymentObligationsTable, educationPlatformSettingsTable, subscriptionPlansTable, usersTable,
} from "@workspace/db";
import { enqueueTransactionalEmail, lumeraEmailHtml } from "./brevo";
import { educationIpsQrPayload } from "./education-marketplace-domain";
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
      and(eq(educationCenterSubscriptionsTable.status, "past_due"), isNotNull(educationCenterSubscriptionsTable.graceEndsAt), lte(educationCenterSubscriptionsTable.graceEndsAt, now)),
    ));
  let reminders = 0;
  let transitioned = 0;
  for (const row of rows) {
    const due = row.subscription.trialEndsAt ?? row.subscription.currentPeriodEnd;
    if (due && due > now) {
      const days = Math.ceil((due.getTime() - now.getTime()) / DAY);
      const bucket = [2, 5, 7].find((value) => days <= value && days > value - 1);
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
      if ((locked.status === "trial" || locked.status === "active") && (locked.trialEndsAt ?? locked.currentPeriodEnd)?.getTime()! <= now.getTime()) {
        const [prepaidRenewal] = await tx.select().from(educationPaymentObligationsTable).where(and(
          eq(educationPaymentObligationsTable.subscriptionId, locked.id),
          eq(educationPaymentObligationsTable.kind, "subscription_renewal"),
          eq(educationPaymentObligationsTable.status, "paid"),
          lte(educationPaymentObligationsTable.servicePeriodStart, now),
          gt(educationPaymentObligationsTable.servicePeriodEnd, now),
        )).limit(1);
        if (prepaidRenewal?.servicePeriodStart && prepaidRenewal.servicePeriodEnd) {
          const applyPendingPlan = Boolean(locked.pendingPlanId && locked.pendingPlanEffectiveAt && locked.pendingPlanEffectiveAt <= prepaidRenewal.servicePeriodStart);
          await tx.update(educationCenterSubscriptionsTable).set({
            ...(applyPendingPlan ? {
              planId: locked.pendingPlanId!, billingCycle: locked.pendingBillingCycle ?? locked.billingCycle,
              pendingPlanId: null, pendingBillingCycle: null, pendingPlanEffectiveAt: null,
            } : {}),
            status: "active", currentPeriodStart: prepaidRenewal.servicePeriodStart,
            currentPeriodEnd: prepaidRenewal.servicePeriodEnd, graceEndsAt: null, deactivatedAt: null, updatedAt: now,
          }).where(eq(educationCenterSubscriptionsTable.id, locked.id));
          transitioned += 1;
          return;
        }
        const graceEndsAt = new Date(now.getTime() + 5 * DAY);
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
        const periodStart = locked.currentPeriodEnd ?? now;
        const periodEnd = locked.contractKind === "custom" && locked.contractEndsAt ? locked.contractEndsAt : addEducationBillingPeriod(periodStart, nextCycle);
        await tx.update(educationCenterSubscriptionsTable).set({
          planId: nextPlanId, billingCycle: nextCycle, status: "past_due", dueAmount: amount,
          pendingPlanId: null, pendingBillingCycle: null, pendingPlanEffectiveAt: null,
          graceEndsAt, updatedAt: now,
        }).where(eq(educationCenterSubscriptionsTable.id, locked.id));
        const [existingPayment] = await tx.select({ id: educationPaymentObligationsTable.id }).from(educationPaymentObligationsTable)
          .where(and(eq(educationPaymentObligationsTable.subscriptionId, locked.id), eq(educationPaymentObligationsTable.kind, "subscription_renewal"), eq(educationPaymentObligationsTable.status, "pending"))).limit(1);
        if (!existingPayment && periodEnd > periodStart) {
          const [settings] = await tx.select().from(educationPlatformSettingsTable).orderBy(asc(educationPlatformSettingsTable.createdAt)).limit(1);
          if (settings?.ipsRecipientName && settings.ipsRecipientAccount) {
            const obligationId = randomUUID();
            const reference = educationPaymentReference("SUB", obligationId);
            const purpose = "Pretplata za Education centar";
            await tx.insert(educationPaymentObligationsTable).values({
              id: obligationId, centerId: locked.centerId, subscriptionId: locked.id, kind: "subscription_renewal",
              expectedAmount: amount, recipientNameSnapshot: settings.ipsRecipientName, recipientAccountSnapshot: settings.ipsRecipientAccount,
              paymentCodeSnapshot: "221", purposeSnapshot: purpose, referenceSnapshot: reference,
              billingCycleSnapshot: nextCycle, servicePeriodStart: periodStart, servicePeriodEnd: periodEnd,
              ipsPayloadSnapshot: JSON.stringify(educationIpsQrPayload({ recipientName: settings.ipsRecipientName, recipientAccount: settings.ipsRecipientAccount, purpose, amount, reference })),
            });
          }
        }
        transitioned += 1;
      } else if (locked.status === "past_due" && locked.graceEndsAt && locked.graceEndsAt <= now) {
        await tx.update(educationCenterSubscriptionsTable).set({ status: "suspended", deactivatedAt: now, updatedAt: now }).where(eq(educationCenterSubscriptionsTable.id, locked.id));
        await tx.update(coursesTable).set({ published: false, updatedAt: now }).where(eq(coursesTable.centerId, locked.centerId));
        transitioned += 1;
      }
    });
  }
  return { reminders, transitioned };
}

function educationDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}