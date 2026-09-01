import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  courseEnrollmentsTable, coursesTable, db, educationCenterSubscriptionsTable,
  educationCentersTable, educationFinancialAuditLogTable, educationGraceNotesTable,
  educationPaymentObligationsTable, educationTrialClaimsTable, educationAccessExtensionsTable,
  educationPlatformSettingsTable, subscriptionPlansTable,
} from "@workspace/db";
import { getCurrentUser } from "../lib/auth";
import { addEducationBelgradeCalendarDays, educationBelgradeDateKey, educationIpsQrPayload } from "../lib/education-marketplace-domain";
import {
  addEducationBillingPeriod, educationCycleAmount, educationPaymentReference,
  educationUpgradeProration, hashTrialIdentifier, normalizeTrialEmail,
  normalizeTrialPhone, normalizeTrialPib, type EducationBillingCycle,
} from "../lib/education-subscription-domain";

const router: IRouter = Router();
const planBody = z.object({ planId: z.string().uuid(), billingCycle: z.enum(["monthly", "yearly"]).default("monthly") });
const reasonBody = z.object({ reason: z.string().trim().min(3).max(1000) });
const extendBody = z.object({ months: z.union([z.literal(1), z.literal(3), z.literal(6)]) });
const customContractBody = z.object({
  amountRsd: z.number().int().positive(),
  billingCycle: z.enum(["monthly", "yearly"]),
  contractEndsAt: z.string().datetime(),
  reason: z.string().trim().min(3).max(1000),
});
const addMonths = (date: Date, months: number) => {
  let result = date;
  for (let index = 0; index < months; index += 1) result = addEducationBillingPeriod(result, "monthly");
  return result;
};
const reference = educationPaymentReference;
const user = async (req: any, res: any) => {
  const current = await getCurrentUser(req);
  if (!current) { res.status(401).json({ error: "Prijava je obavezna." }); return null; }
  return current;
};
const ownerCenter = async (req: any, res: any) => {
  const current = await user(req, res);
  if (!current) return null;
  const [center] = await db.select().from(educationCentersTable).where(eq(educationCentersTable.ownerId, current.id)).limit(1);
  if (!center) { res.status(403).json({ error: "Education nalog nema aktivan centar." }); return null; }
  return { current, center };
};
const superAdmin = async (req: any, res: any) => {
  const current = await user(req, res);
  if (!current) return null;
  if (current.role !== "SUPER_ADMIN") { res.status(403).json({ error: "Ovu finansijsku radnju može izvršiti samo super administrator." }); return null; }
  return current;
};

router.get("/education/subscription/plans", async (_req, res) => {
  res.json(await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.active, true)).orderBy(asc(subscriptionPlansTable.price)));
});

router.get("/education/subscription/status", async (req, res) => {
  const access = await ownerCenter(req, res); if (!access) return;
  const [subscription] = await db.select({ subscription: educationCenterSubscriptionsTable, plan: subscriptionPlansTable })
    .from(educationCenterSubscriptionsTable).innerJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, educationCenterSubscriptionsTable.planId))
    .where(eq(educationCenterSubscriptionsTable.centerId, access.center.id)).limit(1);
  const now = new Date();
  const inGrace = subscription?.subscription.graceEndsAt ? subscription.subscription.graceEndsAt > now : false;
  const operational = Boolean(subscription && (subscription.subscription.status === "trial" || subscription.subscription.status === "active" || subscription.subscription.status === "free_via_loyalty" || inGrace));
  res.json({ center: { id: access.center.id, name: access.center.name, paymentReferenceNumber: access.center.paymentReferenceNumber }, subscription: subscription ?? null, inGrace, operational });
});

router.post("/education/subscription/select-plan", async (req, res) => {
  const access = await ownerCenter(req, res); if (!access) return;
  const parsed = planBody.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: "Plan i ciklus nisu ispravni." }); return; }
  const [plan] = await db.select().from(subscriptionPlansTable).where(and(eq(subscriptionPlansTable.id, parsed.data.planId), eq(subscriptionPlansTable.active, true))).limit(1);
  if (!plan) { res.status(404).json({ error: "Plan nije pronađen." }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      const now = new Date();
      const [existing] = await tx.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, access.center.id)).for("update").limit(1);
      const trialClaim = await tx.insert(educationTrialClaimsTable).values({
        normalizedEmailHash: hashTrialIdentifier(normalizeTrialEmail(access.current.email))!,
        normalizedPhoneHash: hashTrialIdentifier(normalizeTrialPhone(access.current.phone)),
        normalizedPibHash: hashTrialIdentifier(normalizeTrialPib(access.center.pib)),
        userId: access.current.id, centerId: access.center.id,
      }).onConflictDoNothing().returning();
      const trial = !existing && trialClaim.length > 0;
      const trialEndsAt = trial && plan.trialDays > 0 ? addEducationBelgradeCalendarDays(now, plan.trialDays) : null;
      const cycle = parsed.data.billingCycle;
      const amount = educationCycleAmount(plan.price, cycle);
      if (existing && (existing.status === "active" || existing.status === "trial") && existing.currentPeriodEnd) {
        if (existing.planId === plan.id && existing.billingCycle === cycle && !existing.pendingPlanId) {
          return { ...existing, payment: null, change: "unchanged" };
        }
        const [currentPlan] = await tx.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, existing.planId)).limit(1);
        if (!currentPlan) throw new Error("CURRENT_PLAN_MISSING");
        if (plan.price <= currentPlan.price) {
          await tx.update(educationPaymentObligationsTable).set({
            status: "cancelled", cancelledAt: now, cancelledByUserId: access.current.id,
          }).where(and(
            eq(educationPaymentObligationsTable.subscriptionId, existing.id),
            eq(educationPaymentObligationsTable.status, "pending"),
            inArray(educationPaymentObligationsTable.kind, ["subscription_renewal", "subscription_upgrade"]),
          ));
          const [paidFutureRenewal] = await tx.select({
            servicePeriodEnd: educationPaymentObligationsTable.servicePeriodEnd,
          }).from(educationPaymentObligationsTable).where(and(
            eq(educationPaymentObligationsTable.subscriptionId, existing.id),
            eq(educationPaymentObligationsTable.kind, "subscription_renewal"),
            eq(educationPaymentObligationsTable.status, "paid"),
            gt(educationPaymentObligationsTable.servicePeriodStart, now),
          )).orderBy(desc(educationPaymentObligationsTable.servicePeriodEnd)).limit(1);
          const effectiveAt = paidFutureRenewal?.servicePeriodEnd ?? existing.currentPeriodEnd;
          const [saved] = await tx.update(educationCenterSubscriptionsTable).set({
            pendingPlanId: plan.id, pendingBillingCycle: cycle,
            pendingPlanEffectiveAt: effectiveAt, updatedAt: now,
          }).where(eq(educationCenterSubscriptionsTable.id, existing.id)).returning();
          return { ...saved!, payment: null, change: "scheduled_downgrade" };
        }
        const periodStart = existing.currentPeriodStart ?? now;
        const prorated = educationUpgradeProration({
          currentMonthlyPrice: currentPlan.price, nextMonthlyPrice: plan.price, billingCycle: existing.billingCycle as EducationBillingCycle,
          periodStart, periodEnd: existing.currentPeriodEnd, now,
        });
        const [settings] = await tx.select().from(educationPlatformSettingsTable).orderBy(asc(educationPlatformSettingsTable.createdAt)).limit(1);
        if (!settings?.ipsRecipientName || !settings.ipsRecipientAccount) throw new Error("PLATFORM_PAYMENT_NOT_CONFIGURED");
        await tx.update(educationPaymentObligationsTable).set({
          status: "cancelled", cancelledAt: now, cancelledByUserId: access.current.id,
        }).where(and(
          eq(educationPaymentObligationsTable.subscriptionId, existing.id),
          eq(educationPaymentObligationsTable.kind, "subscription_renewal"),
          eq(educationPaymentObligationsTable.status, "pending"),
        ));
        const [pendingUpgrade] = await tx.select().from(educationPaymentObligationsTable).where(and(
          eq(educationPaymentObligationsTable.subscriptionId, existing.id),
          eq(educationPaymentObligationsTable.kind, "subscription_upgrade"),
          eq(educationPaymentObligationsTable.status, "pending"),
        )).limit(1);
        if (pendingUpgrade && existing.pendingPlanId === plan.id && existing.pendingBillingCycle === cycle) {
          return { ...existing, payment: pendingUpgrade, change: "upgrade_pending_payment" };
        }
        if (pendingUpgrade) {
          await tx.update(educationPaymentObligationsTable).set({
            status: "cancelled", cancelledAt: now, cancelledByUserId: access.current.id,
          }).where(eq(educationPaymentObligationsTable.id, pendingUpgrade.id));
        }
        const obligationId = randomUUID();
        const paymentReference = reference("UPG", obligationId);
        const [payment] = await tx.insert(educationPaymentObligationsTable).values({
          id: obligationId, centerId: access.center.id, subscriptionId: existing.id, kind: "subscription_upgrade",
           planIdSnapshot: plan.id,
          expectedAmount: prorated, recipientNameSnapshot: settings.ipsRecipientName, recipientAccountSnapshot: settings.ipsRecipientAccount,
          paymentCodeSnapshot: "221", purposeSnapshot: "Proporcionalna doplata za viši Education plan",
          referenceSnapshot: paymentReference, billingCycleSnapshot: existing.billingCycle,
          servicePeriodStart: now, servicePeriodEnd: existing.currentPeriodEnd,
          ipsPayloadSnapshot: JSON.stringify(educationIpsQrPayload({ recipientName: settings.ipsRecipientName, recipientAccount: settings.ipsRecipientAccount, purpose: "Proporcionalna doplata za viši Education plan", amount: prorated, reference: paymentReference })),
        }).returning();
        const [paidFutureRenewal] = cycle === existing.billingCycle ? [] : await tx.select({
          servicePeriodEnd: educationPaymentObligationsTable.servicePeriodEnd,
        }).from(educationPaymentObligationsTable).where(and(
          eq(educationPaymentObligationsTable.subscriptionId, existing.id),
          eq(educationPaymentObligationsTable.kind, "subscription_renewal"),
          eq(educationPaymentObligationsTable.status, "paid"),
          gt(educationPaymentObligationsTable.servicePeriodStart, now),
        )).orderBy(desc(educationPaymentObligationsTable.servicePeriodEnd)).limit(1);
        const pendingEffectiveAt = cycle === existing.billingCycle
          ? now
          : paidFutureRenewal?.servicePeriodEnd ?? existing.currentPeriodEnd;
        const [saved] = await tx.update(educationCenterSubscriptionsTable).set({
          pendingPlanId: plan.id, pendingBillingCycle: cycle, pendingPlanEffectiveAt: pendingEffectiveAt, updatedAt: now,
        }).where(eq(educationCenterSubscriptionsTable.id, existing.id)).returning();
        return { ...saved!, payment: payment!, change: "upgrade_pending_payment" };
      }
      const next = {
        planId: plan.id, status: trial ? "trial" as const : "past_due" as const,
        dueAmount: trial ? 0 : amount, billingCycle: cycle,
        trialStartedAt: trial ? now : existing?.trialStartedAt ?? null,
        trialEndsAt: trial ? trialEndsAt : existing?.trialEndsAt ?? null,
        currentPeriodStart: trial ? now : existing?.currentPeriodStart ?? null,
        currentPeriodEnd: trialEndsAt, graceEndsAt: null, deactivatedAt: null,
        pendingPlanId: null, pendingBillingCycle: null, pendingPlanEffectiveAt: null,
        updatedAt: now,
      };
      const [saved] = existing
        ? await tx.update(educationCenterSubscriptionsTable).set(next).where(eq(educationCenterSubscriptionsTable.id, existing.id)).returning()
        : await tx.insert(educationCenterSubscriptionsTable).values({ centerId: access.center.id, paymentMethod: "BANK_TRANSFER", ...next }).returning();
      if (!access.center.paymentReferenceNumber) {
        await tx.update(educationCentersTable).set({ paymentReferenceNumber: reference("EDU", access.center.id), updatedAt: now }).where(eq(educationCentersTable.id, access.center.id));
      }
      await tx.insert(educationFinancialAuditLogTable).values({
        actorUserId: access.current.id, action: "education_subscription_plan_selected",
        entityType: "education_center_subscription", entityId: saved!.id,
        oldValue: existing ? { planId: existing.planId, status: existing.status } : null,
        newValue: { planId: plan.id, status: next.status, trial },
        reason: trial ? "Prvi Education trial" : "Izbor ili promena plana",
      });
      return { ...saved!, payment: null, change: trial ? "trial_started" : "renewal_required" };
    });
    res.status(201).json(result);
  } catch (error) {
    req.log?.error({ err: error }, "Education subscription plan selection failed");
    res.status(409).json({ error: "Plan nije moguće aktivirati. Trial može biti iskorišćen samo jednom." });
  }
});

router.post("/education/subscription/renewal-instructions", async (req, res) => {
  const access = await ownerCenter(req, res); if (!access) return;
  const result = await db.transaction(async (tx) => {
    const [subscriptionRow] = await tx.select().from(educationCenterSubscriptionsTable)
      .where(eq(educationCenterSubscriptionsTable.centerId, access.center.id)).for("update").limit(1);
    if (!subscriptionRow) return { error: "NOT_FOUND" as const };
    const [pendingUpgrade] = await tx.select({ id: educationPaymentObligationsTable.id }).from(educationPaymentObligationsTable).where(and(
      eq(educationPaymentObligationsTable.subscriptionId, subscriptionRow.id),
      eq(educationPaymentObligationsTable.kind, "subscription_upgrade"),
      eq(educationPaymentObligationsTable.status, "pending"),
    )).limit(1);
    if (pendingUpgrade) return { error: "UPGRADE_PENDING" as const };
    const [settings] = await tx.select().from(educationPlatformSettingsTable).orderBy(asc(educationPlatformSettingsTable.createdAt)).limit(1);
    if (!settings?.ipsRecipientName || !settings.ipsRecipientAccount) return { error: "SETTINGS" as const };
    const [pendingRenewal] = await tx.select().from(educationPaymentObligationsTable).where(and(
      eq(educationPaymentObligationsTable.subscriptionId, subscriptionRow.id),
      eq(educationPaymentObligationsTable.kind, "subscription_renewal"),
      eq(educationPaymentObligationsTable.status, "pending"),
    )).limit(1);
    if (pendingRenewal) return { obligation: pendingRenewal };
    const now = new Date();
    const periodStart = subscriptionRow.contractKind === "custom"
      ? subscriptionRow.currentPeriodStart ?? now
      : subscriptionRow.currentPeriodEnd && subscriptionRow.currentPeriodEnd > now ? subscriptionRow.currentPeriodEnd : now;
    const [existing] = await tx.select().from(educationPaymentObligationsTable).where(and(
      eq(educationPaymentObligationsTable.subscriptionId, subscriptionRow.id),
      eq(educationPaymentObligationsTable.kind, "subscription_renewal"),
      inArray(educationPaymentObligationsTable.status, ["pending", "paid"]),
      eq(educationPaymentObligationsTable.servicePeriodStart, periodStart),
    )).limit(1);
    if (existing) return { obligation: existing };
    const pendingChangeApplies = Boolean(subscriptionRow.pendingPlanId && subscriptionRow.pendingPlanEffectiveAt && subscriptionRow.pendingPlanEffectiveAt <= periodStart);
    const effectivePlanId = pendingChangeApplies ? subscriptionRow.pendingPlanId! : subscriptionRow.planId;
    const cycle = (pendingChangeApplies ? subscriptionRow.pendingBillingCycle ?? subscriptionRow.billingCycle : subscriptionRow.billingCycle) as EducationBillingCycle;
    const [plan] = await tx.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, effectivePlanId)).limit(1);
    if (!plan) return { error: "NOT_FOUND" as const };
    const amount = subscriptionRow.contractKind === "custom" ? subscriptionRow.dueAmount : educationCycleAmount(plan.price, cycle);
    const periodEnd = subscriptionRow.contractKind === "custom" && subscriptionRow.contractEndsAt
      ? subscriptionRow.contractEndsAt : addEducationBillingPeriod(periodStart, cycle);
    if (periodEnd <= periodStart) return { error: "CONTRACT_EXPIRED" as const };
    const obligationId = randomUUID();
    const paymentReference = reference("SUB", obligationId);
    const payload = educationIpsQrPayload({ recipientName: settings.ipsRecipientName, recipientAccount: settings.ipsRecipientAccount, purpose: "Pretplata za Education centar", amount, reference: paymentReference });
    const [created] = await tx.insert(educationPaymentObligationsTable).values({
      id: obligationId, centerId: access.center.id, subscriptionId: subscriptionRow.id, kind: "subscription_renewal",
      planIdSnapshot: effectivePlanId,
      expectedAmount: amount, recipientNameSnapshot: settings.ipsRecipientName, recipientAccountSnapshot: settings.ipsRecipientAccount,
      paymentCodeSnapshot: "221", purposeSnapshot: "Pretplata za Education centar", referenceSnapshot: paymentReference,
      ipsPayloadSnapshot: JSON.stringify(payload), billingCycleSnapshot: cycle, servicePeriodStart: periodStart, servicePeriodEnd: periodEnd,
    }).returning();
    return { obligation: created! };
  });
  if ("error" in result) {
    res.status(result.error === "NOT_FOUND" ? 404 : 409).json({ error: result.error === "SETTINGS" ? "Platforma nema podešen račun za pretplate." : result.error === "CONTRACT_EXPIRED" ? "Ugovor je istekao ili nema važeći period." : result.error === "UPGRADE_PENDING" ? "Najpre evidentirajte ili poništite otvorenu doplatu za viši plan." : "Pretplata nije pronađena." });
    return;
  }
  const obligation = result.obligation;
  res.json({ amount: obligation.expectedAmount, reference: obligation.referenceSnapshot, paymentCode: obligation.paymentCodeSnapshot, ips: obligation.ipsPayloadSnapshot ? JSON.parse(obligation.ipsPayloadSnapshot) : null, environment: process.env.NODE_ENV });
});

router.get("/admin/education/grace-centers", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  const rows = await db.select({ center: educationCentersTable, subscription: educationCenterSubscriptionsTable })
    .from(educationCenterSubscriptionsTable).innerJoin(educationCentersTable, eq(educationCentersTable.id, educationCenterSubscriptionsTable.centerId))
    .where(and(isNotNull(educationCenterSubscriptionsTable.graceEndsAt), gt(educationCenterSubscriptionsTable.graceEndsAt, new Date())))
    .orderBy(asc(educationCenterSubscriptionsTable.graceEndsAt));
  res.json(rows.map((row) => ({ ...row, daysRemaining: Math.max(0, Math.ceil((row.subscription.graceEndsAt!.getTime() - Date.now()) / 86400000)) })));
});

router.post("/admin/education/centers/:centerId/extend-grace", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  const parsed = reasonBody.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: "Razlog je obavezan." }); return; }
  const updated = await db.transaction(async (tx) => {
    const [subscription] = await tx.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, req.params.centerId)).for("update").limit(1);
    if (!subscription) throw new Error("NOT_FOUND");
    const now = new Date(); const base = subscription.graceEndsAt && subscription.graceEndsAt > now ? subscription.graceEndsAt : now;
    const graceEndsAt = new Date(base); graceEndsAt.setUTCDate(graceEndsAt.getUTCDate() + 5);
    const [saved] = await tx.update(educationCenterSubscriptionsTable).set({ status: "past_due", graceEndsAt, graceExtensionNote: parsed.data.reason, deactivatedAt: null, updatedAt: now }).where(eq(educationCenterSubscriptionsTable.id, subscription.id)).returning();
    await tx.insert(educationGraceNotesTable).values({ centerId: req.params.centerId, authorUserId: actor.id, note: parsed.data.reason });
    await tx.insert(educationFinancialAuditLogTable).values({ actorUserId: actor.id, action: "education_grace_extended", entityType: "education_center_subscription", entityId: subscription.id, oldValue: { graceEndsAt: subscription.graceEndsAt }, newValue: { graceEndsAt }, reason: parsed.data.reason });
    return saved;
  }).catch((error) => { if (error instanceof Error && error.message === "NOT_FOUND") return null; throw error; });
  if (!updated) { res.status(404).json({ error: "Pretplata nije pronađena." }); return; }
  res.json(updated);
});

router.post("/admin/education/centers/:centerId/reactivate", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  const parsed = reasonBody.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: "Razlog je obavezan." }); return; }
  const updated = await db.transaction(async (tx) => {
    const [sub] = await tx.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, req.params.centerId)).for("update").limit(1);
    if (!sub) throw new Error("NOT_FOUND");
    if (!sub.paidAt || !sub.currentPeriodEnd || sub.currentPeriodEnd <= new Date()) throw new Error("PAYMENT_REQUIRED");
    const [saved] = await tx.update(educationCenterSubscriptionsTable).set({ status: "active", deactivatedAt: null, graceEndsAt: null, updatedAt: new Date() }).where(eq(educationCenterSubscriptionsTable.id, sub.id)).returning();
    await tx.insert(educationFinancialAuditLogTable).values({ actorUserId: actor.id, action: "education_center_reactivated", entityType: "education_center", entityId: req.params.centerId, oldValue: { status: sub.status }, newValue: { status: "active" }, reason: parsed.data.reason });
    return saved;
  }).catch((error) => { if (error instanceof Error && error.message === "NOT_FOUND") return null; if (error instanceof Error && error.message === "PAYMENT_REQUIRED") return false; throw error; });
  if (updated === null) { res.status(404).json({ error: "Pretplata nije pronađena." }); return; }
  if (updated === false) { res.status(409).json({ error: "Reaktivacija zahteva evidentiranu uplatu i važeći plaćeni period." }); return; }
  res.json(updated);
});

router.post("/admin/education/centers/:centerId/custom-contract", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  const parsed = customContractBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Iznos, ciklus, datum isteka i razlog ugovora su obavezni." }); return; }
  const contractEndsAt = new Date(parsed.data.contractEndsAt);
  if (contractEndsAt <= new Date()) { res.status(400).json({ error: "Datum isteka ugovora mora biti u budućnosti." }); return; }
  const updated = await db.transaction(async (tx) => {
    const [subscription] = await tx.select().from(educationCenterSubscriptionsTable)
      .where(eq(educationCenterSubscriptionsTable.centerId, req.params.centerId)).for("update").limit(1);
    if (!subscription) return null;
    const now = new Date();
    const [paidPeriod] = await tx.select({ id: educationPaymentObligationsTable.id }).from(educationPaymentObligationsTable).where(and(
      eq(educationPaymentObligationsTable.subscriptionId, subscription.id),
      eq(educationPaymentObligationsTable.kind, "subscription_renewal"),
      eq(educationPaymentObligationsTable.status, "paid"),
      gt(educationPaymentObligationsTable.servicePeriodEnd, now),
    )).limit(1);
    if ((subscription.status === "active" && subscription.currentPeriodEnd && subscription.currentPeriodEnd > now) || paidPeriod) return false;
    await tx.update(educationPaymentObligationsTable).set({
      status: "cancelled", cancelledAt: now, cancelledByUserId: actor.id,
    }).where(and(
      eq(educationPaymentObligationsTable.subscriptionId, subscription.id),
      eq(educationPaymentObligationsTable.status, "pending"),
      inArray(educationPaymentObligationsTable.kind, ["subscription_renewal", "subscription_upgrade"]),
    ));
    const [saved] = await tx.update(educationCenterSubscriptionsTable).set({
      contractKind: "custom", contractEndsAt, billingCycle: parsed.data.billingCycle,
      dueAmount: parsed.data.amountRsd, status: "past_due", graceEndsAt: null, deactivatedAt: null,
      currentPeriodStart: null, currentPeriodEnd: null,
      pendingPlanId: null, pendingBillingCycle: null, pendingPlanEffectiveAt: null, updatedAt: now,
    }).where(eq(educationCenterSubscriptionsTable.id, subscription.id)).returning();
    await tx.insert(educationFinancialAuditLogTable).values({
      actorUserId: actor.id, action: "education_custom_contract_configured",
      entityType: "education_center_subscription", entityId: subscription.id,
      oldValue: { contractKind: subscription.contractKind, contractEndsAt: subscription.contractEndsAt, dueAmount: subscription.dueAmount },
      newValue: { contractKind: "custom", contractEndsAt, dueAmount: parsed.data.amountRsd, billingCycle: parsed.data.billingCycle },
      reason: parsed.data.reason,
    });
    return saved!;
  });
  if (updated === null) { res.status(404).json({ error: "Pretplata nije pronađena." }); return; }
  if (updated === false) { res.status(409).json({ error: "Poseban ugovor može početi tek kada se završe svi već plaćeni periodi." }); return; }
  res.json(updated);
});

router.post("/education/enrollments/:enrollmentId/extension", async (req, res) => {
  const access = await user(req, res); if (!access) return;
  const parsed = extendBody.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: "Trajanje produženja mora biti 1, 3 ili 6 meseci." }); return; }
  const result = await db.transaction(async (tx) => {
    const [enrollment] = await tx.select({ enrollment: courseEnrollmentsTable, course: coursesTable, center: educationCentersTable })
      .from(courseEnrollmentsTable).innerJoin(coursesTable, eq(coursesTable.id, courseEnrollmentsTable.courseId)).innerJoin(educationCentersTable, eq(educationCentersTable.id, coursesTable.centerId))
      .where(and(eq(courseEnrollmentsTable.id, req.params.enrollmentId), eq(courseEnrollmentsTable.userId, access.id))).for("update").limit(1);
    if (!enrollment || !enrollment.enrollment.accessExpiresAt || !enrollment.center.bankAccount) throw new Error("NOT_FOUND");
    const price = parsed.data.months === 1 ? enrollment.enrollment.extensionPricesSnapshot?.oneMonth ?? enrollment.course.extensionPrice1Month : parsed.data.months === 3 ? enrollment.enrollment.extensionPricesSnapshot?.threeMonths ?? enrollment.course.extensionPrice3Months : enrollment.enrollment.extensionPricesSnapshot?.sixMonths ?? enrollment.course.extensionPrice6Months;
    if (price == null) throw new Error("PRICE");
    const extended = addMonths(enrollment.enrollment.accessExpiresAt, parsed.data.months);
    const obligation = await tx.insert(educationPaymentObligationsTable).values({ centerId: enrollment.center.id, enrollmentId: enrollment.enrollment.id, kind: "course_extension", expectedAmount: price, recipientNameSnapshot: enrollment.center.name, recipientAccountSnapshot: enrollment.center.bankAccount, paymentCodeSnapshot: enrollment.center.legalEntityType === "individual" ? "289" : "221", purposeSnapshot: "Produženje pristupa online kursu", referenceSnapshot: reference("EXT", req.params.enrollmentId), ipsPayloadSnapshot: JSON.stringify(educationIpsQrPayload({ recipientName: enrollment.center.name, recipientAccount: enrollment.center.bankAccount, purpose: "Produženje pristupa online kursu", amount: price, reference: reference("EXT", req.params.enrollmentId) })) }).returning();
    await tx.insert(educationAccessExtensionsTable).values({
      enrollmentId: enrollment.enrollment.id,
      purchaserId: access.id,
      months: parsed.data.months,
      amount: price,
      previousAccessExpiresAt: enrollment.enrollment.accessExpiresAt,
      extendedAccessExpiresAt: extended,
      paymentObligationId: obligation[0]!.id,
    });
    res.json({ extension: { months: parsed.data.months, amount: price, previousAccessExpiresAt: enrollment.enrollment.accessExpiresAt, extendedAccessExpiresAt: extended }, payment: obligation[0] });
    return true;
  }).catch((error) => { if (error instanceof Error && error.message === "NOT_FOUND") return false; if (error instanceof Error && error.message === "PRICE") return null; throw error; });
  if (result === false) res.status(404).json({ error: "Aktivan pristup ili centar nije pronađen." });
  else if (result === null) res.status(409).json({ error: "Centar nije podesio cene produženja." });
});

router.get("/admin/education/payment-obligations", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  res.json(await db.select().from(educationPaymentObligationsTable).orderBy(desc(educationPaymentObligationsTable.issuedAt)));
});

router.post("/admin/education/payment-obligations/:obligationId/settle", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  const parsed = z.object({ confirmedAmountRsd: z.number().int().nonnegative(), reason: z.string().trim().min(3).max(1000) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Potvrđeni iznos i razlog su obavezni." }); return; }
  try {
    const settled = await db.transaction(async (tx) => {
      const [obligation] = await tx.select().from(educationPaymentObligationsTable)
        .where(eq(educationPaymentObligationsTable.id, req.params.obligationId)).for("update").limit(1);
      if (!obligation) throw new Error("NOT_FOUND");
      if (obligation.status !== "pending") throw new Error("ALREADY_SETTLED");
      if (parsed.data.confirmedAmountRsd !== obligation.expectedAmount) throw new Error("AMOUNT_MISMATCH");
      const [saved] = await tx.update(educationPaymentObligationsTable).set({
        status: "paid", confirmedAmount: parsed.data.confirmedAmountRsd,
        confirmedAt: new Date(), confirmedByUserId: actor.id,
      }).where(and(eq(educationPaymentObligationsTable.id, obligation.id), eq(educationPaymentObligationsTable.status, "pending"))).returning();
      if (!saved) throw new Error("ALREADY_SETTLED");
      if (obligation.enrollmentId) {
        const [extension] = await tx.select().from(educationAccessExtensionsTable)
          .where(eq(educationAccessExtensionsTable.paymentObligationId, obligation.id)).for("update").limit(1);
        if (extension) {
          await tx.update(educationAccessExtensionsTable).set({ status: "settled", settledAt: new Date() }).where(eq(educationAccessExtensionsTable.id, extension.id));
          await tx.update(courseEnrollmentsTable).set({ accessExpiresAt: extension.extendedAccessExpiresAt, updatedAt: new Date() }).where(eq(courseEnrollmentsTable.id, obligation.enrollmentId));
        }
      }
      if (obligation.subscriptionId) {
        const [subscription] = await tx.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.id, obligation.subscriptionId)).for("update").limit(1);
        if (!subscription) throw new Error("NOT_FOUND");
        const upgrade = obligation.kind === "subscription_upgrade";
        const now = new Date();
        const prepaidRenewal = obligation.kind === "subscription_renewal"
          && Boolean(obligation.servicePeriodStart && obligation.servicePeriodStart > now);
        const scheduledPlanPaidByRenewal = obligation.kind === "subscription_renewal"
          && Boolean(subscription.pendingPlanId && subscription.pendingPlanEffectiveAt && obligation.servicePeriodStart
            && subscription.pendingPlanEffectiveAt <= obligation.servicePeriodStart);
        const snapshotPlanId = obligation.planIdSnapshot ?? subscription.planId;
        const snapshotCycle = (obligation.billingCycleSnapshot ?? subscription.billingCycle) as EducationBillingCycle;
        const deferredUpgradeCycle = upgrade
          && Boolean(subscription.pendingBillingCycle && subscription.pendingBillingCycle !== snapshotCycle
            && subscription.pendingPlanEffectiveAt && subscription.pendingPlanEffectiveAt > now);
        await tx.update(educationCenterSubscriptionsTable).set(prepaidRenewal ? {
          paidAt: now, updatedAt: now,
        } : {
          ...(upgrade || obligation.kind === "subscription_renewal"
            ? { planId: snapshotPlanId, billingCycle: snapshotCycle }
            : {}),
          ...(subscription.pendingPlanId && ((upgrade && !deferredUpgradeCycle) || scheduledPlanPaidByRenewal)
            ? { pendingPlanId: null, pendingBillingCycle: null, pendingPlanEffectiveAt: null }
            : {}),
          status: "active", paidAt: now,
          currentPeriodStart: upgrade ? subscription.currentPeriodStart : obligation.servicePeriodStart ?? now,
          currentPeriodEnd: upgrade ? subscription.currentPeriodEnd : obligation.servicePeriodEnd ?? addEducationBillingPeriod(now, snapshotCycle),
          graceEndsAt: null, deactivatedAt: null, updatedAt: now,
        }).where(eq(educationCenterSubscriptionsTable.id, obligation.subscriptionId));
      }
      await tx.insert(educationFinancialAuditLogTable).values({
        actorUserId: actor.id, action: "education_payment_obligation_settled",
        entityType: "education_payment_obligation", entityId: obligation.id,
        oldValue: { status: obligation.status, expectedAmount: obligation.expectedAmount },
        newValue: { status: "paid", confirmedAmount: parsed.data.confirmedAmountRsd },
        reason: parsed.data.reason,
      });
      return saved;
    });
    res.json(settled);
  } catch (error) {
    const code = error instanceof Error ? error.message : "FAILED";
    const status = code === "NOT_FOUND" ? 404 : 409;
    res.status(status).json({ error: code === "AMOUNT_MISMATCH" ? "Potvrđeni iznos mora biti jednak očekivanom iznosu." : code === "ALREADY_SETTLED" ? "Ova uplata je već evidentirana." : "Obaveza nije pronađena." });
  }
});

router.patch("/admin/education/bank-reconciliation", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  const enabled = req.body?.enabled;
  if (typeof enabled !== "boolean") { res.status(400).json({ error: "Vrednost prekidača mora biti true ili false." }); return; }
  const [settings] = await db.select().from(educationPlatformSettingsTable).orderBy(asc(educationPlatformSettingsTable.createdAt)).limit(1);
  const saved = settings
    ? (await db.update(educationPlatformSettingsTable).set({ bankReconciliationEnabled: enabled, updatedByUserId: actor.id, updatedAt: new Date() }).where(eq(educationPlatformSettingsTable.id, settings.id)).returning())[0]
    : (await db.insert(educationPlatformSettingsTable).values({ bankReconciliationEnabled: enabled, updatedByUserId: actor.id }).returning())[0];
  await db.insert(educationFinancialAuditLogTable).values({ actorUserId: actor.id, action: "bank_reconciliation_toggled", entityType: "education_platform_settings", entityId: saved!.id, oldValue: { enabled: !enabled }, newValue: { enabled }, reason: "Ručno uključivanje ili isključivanje buduće bankovne integracije." });
  res.json({ enabled: saved!.bankReconciliationEnabled });
});

export default router;