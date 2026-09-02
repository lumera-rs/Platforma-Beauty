import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  courseEnrollmentsTable, coursesTable, db, educationCenterSubscriptionsTable,
  educationCustomPlanRequestsTable, educationOutboxTable,
  educationCentersTable, educationFinancialAuditLogTable, educationGraceNotesTable,
  educationPaymentObligationsTable, educationTrialClaimsTable, educationAccessExtensionsTable,
  educationPlatformSettingsTable, subscriptionPlansTable,
} from "@workspace/db";
import { getCurrentUser } from "../lib/auth";
import { addEducationBelgradeCalendarDays, educationBelgradeDateKey, educationIpsPaymentCode, educationIpsQrPayload, educationIpsRuntimeEnvironment } from "../lib/education-marketplace-domain";
import {
  addEducationBillingPeriod, educationCycleAmount, educationPaymentReference,
  educationUpgradeProrationQuote, hashTrialIdentifier, normalizeTrialEmail,
  normalizeTrialBankAccount, normalizeTrialPhone, normalizeTrialPib,
  normalizeTrialRegistrationNumber, type EducationBillingCycle,
} from "../lib/education-subscription-domain";
import { isOnlineEnrollmentSnapshot } from "../lib/education-entitlement";
import {
  educationCurrentCourseLimit,
  educationGraceDaysRemaining,
  educationReactivationState,
} from "../lib/education-subscription-reactivation";
import { getEducationBankReconciliationStatus } from "../lib/education-bank-reconciliation";
import { lockEducationBillingRules } from "../lib/education-billing";
import { settleEducationPaymentObligationInTransaction } from "../lib/education-payment-obligation-settlement";

const router: IRouter = Router();
const planBody = z.object({
  planId: z.string().uuid(),
  billingCycle: z.enum(["monthly", "yearly"]).default("monthly"),
  keepCourseIds: z.array(z.string().uuid()).max(1000).optional(),
});
const reasonBody = z.object({ reason: z.string().trim().min(3).max(1000) });
const reactivationSelectionBody = z.object({
  keepCourseIds: z.array(z.string().uuid()).max(1000),
}).refine((body) => new Set(body.keepCourseIds).size === body.keepCourseIds.length, {
  message: "Izbor kurseva ne sme sadržati duplikate.",
});
const extendBody = z.object({ months: z.union([z.literal(1), z.literal(3), z.literal(6)]) });
const customContractBody = z.object({
  amountRsd: z.number().int().positive(),
  billingCycle: z.enum(["monthly", "yearly"]),
  contractEndsAt: z.string().datetime(),
  courseLimit: z.number().int().positive(),
  autoRenew: z.boolean(),
  requestId: z.string().uuid().optional(),
  reason: z.string().trim().min(3).max(1000),
});
const educationPlanInput = z.object({
  name: z.string().trim().min(2).max(120),
  price: z.number().int().positive(),
  courseLimit: z.number().int().positive(),
  trialDays: z.literal(30).default(30),
  features: z.array(z.string().trim().min(1)).default([]),
  vatIncluded: z.boolean().default(true),
  priceCopy: z.string().trim().min(3).max(500),
  active: z.boolean().default(true),
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
  res.json(await db.select().from(subscriptionPlansTable).where(and(eq(subscriptionPlansTable.active, true), eq(subscriptionPlansTable.audience, "education"), gt(subscriptionPlansTable.price, 0))).orderBy(asc(subscriptionPlansTable.price)));
});

router.get("/admin/education/subscription-plans", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  res.json(await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.audience, "education")).orderBy(asc(subscriptionPlansTable.price)));
});

router.post("/admin/education/subscription-plans", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  const parsed = educationPlanInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Education plan mora imati naziv, celobrojnu RSD cenu, limit kurseva, 30 dana trial-a i VAT copy." }); return; }
  const [saved] = await db.insert(subscriptionPlansTable).values({ ...parsed.data, audience: "education", limits: { courses: parsed.data.courseLimit } }).returning();
  await db.insert(educationFinancialAuditLogTable).values({ actorUserId: actor.id, action: "education_plan_created", entityType: "subscription_plan", entityId: saved!.id, newValue: saved!, reason: "Education plan CRUD" });
  res.status(201).json(saved);
});

router.patch("/admin/education/subscription-plans/:planId", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  const parsed = educationPlanInput.partial().safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data).length) { res.status(400).json({ error: "Podaci Education plana nisu ispravni." }); return; }
  const [existing] = await db.select().from(subscriptionPlansTable).where(and(eq(subscriptionPlansTable.id, req.params.planId), eq(subscriptionPlansTable.audience, "education"))).limit(1);
  if (!existing) { res.status(404).json({ error: "Education plan nije pronađen." }); return; }
  if ((parsed.data.active ?? existing.active) && (parsed.data.price ?? existing.price) <= 0) {
    res.status(400).json({ error: "Aktivan Education plan mora imati pozitivnu cenu." }); return;
  }
  const [saved] = await db.update(subscriptionPlansTable).set({
    ...parsed.data,
    ...(parsed.data.courseLimit ? { limits: { ...existing.limits, courses: parsed.data.courseLimit } } : {}),
  }).where(eq(subscriptionPlansTable.id, existing.id)).returning();
  await db.insert(educationFinancialAuditLogTable).values({ actorUserId: actor.id, action: "education_plan_updated", entityType: "subscription_plan", entityId: existing.id, oldValue: existing, newValue: saved!, reason: "Education plan CRUD" });
  res.json(saved);
});

router.delete("/admin/education/subscription-plans/:planId", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  const [existing] = await db.select().from(subscriptionPlansTable).where(and(eq(subscriptionPlansTable.id, req.params.planId), eq(subscriptionPlansTable.audience, "education"))).limit(1);
  if (!existing) { res.status(404).json({ error: "Education plan nije pronađen." }); return; }
  const [saved] = await db.update(subscriptionPlansTable).set({ active: false }).where(eq(subscriptionPlansTable.id, existing.id)).returning();
  await db.insert(educationFinancialAuditLogTable).values({ actorUserId: actor.id, action: "education_plan_archived", entityType: "subscription_plan", entityId: existing.id, oldValue: existing, newValue: saved!, reason: "Plan history is retained" });
  res.json(saved);
});

router.post("/education/subscription/custom-plan-request", async (req, res) => {
  const access = await ownerCenter(req, res); if (!access) return;
  const parsed = z.object({ requestedCourseLimit: z.number().int().positive().max(100000), message: z.string().trim().min(10).max(2000) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Unesite željeni limit i opis potreba." }); return; }
  const created = await db.transaction(async (tx) => {
    const [request] = await tx.insert(educationCustomPlanRequestsTable).values({ centerId: access.center.id, requestedByUserId: access.current.id, ...parsed.data }).returning();
    await tx.insert(educationOutboxTable).values({ centerId: access.center.id, eventType: "education_custom_plan_requested", dedupeKey: `education-custom-plan-request:${request!.id}`, payload: { requestId: request!.id, centerId: access.center.id, requestedCourseLimit: parsed.data.requestedCourseLimit } });
    await tx.insert(educationFinancialAuditLogTable).values({ actorUserId: access.current.id, action: "education_custom_plan_requested", entityType: "education_custom_plan_request", entityId: request!.id, newValue: request!, reason: parsed.data.message });
    return request!;
  });
  res.status(201).json(created);
});

router.get("/admin/education/custom-plan-requests", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  res.json(await db.select().from(educationCustomPlanRequestsTable).orderBy(desc(educationCustomPlanRequestsTable.createdAt)));
});

router.patch("/admin/education/custom-plan-requests/:requestId", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  const parsed = z.object({ status: z.literal("rejected"), reason: z.string().trim().min(3).max(1000) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Razlog odbijanja je obavezan." }); return; }
  const [saved] = await db.update(educationCustomPlanRequestsTable).set({ status: "rejected", resolvedByUserId: actor.id, resolvedAt: new Date() })
    .where(and(eq(educationCustomPlanRequestsTable.id, req.params.requestId), eq(educationCustomPlanRequestsTable.status, "pending"))).returning();
  if (!saved) { res.status(404).json({ error: "Otvoren zahtev nije pronađen." }); return; }
  await db.insert(educationFinancialAuditLogTable).values({ actorUserId: actor.id, action: "education_custom_plan_request_rejected", entityType: "education_custom_plan_request", entityId: saved.id, oldValue: { status: "pending" }, newValue: { status: "rejected" }, reason: parsed.data.reason });
  res.json(saved);
});

router.get("/education/subscription/status", async (req, res) => {
  const access = await ownerCenter(req, res); if (!access) return;
  const [subscription] = await db.select({ subscription: educationCenterSubscriptionsTable, plan: subscriptionPlansTable })
    .from(educationCenterSubscriptionsTable).innerJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, educationCenterSubscriptionsTable.planId))
    .where(eq(educationCenterSubscriptionsTable.centerId, access.center.id)).limit(1);
  const courses = await db.select({
    id: coursesTable.id,
    title: coursesTable.title,
    published: coursesTable.published,
    subscriptionSuspended: coursesTable.subscriptionSuspended,
  }).from(coursesTable)
    .where(and(eq(coursesTable.centerId, access.center.id), eq(coursesTable.archived, false)))
    .orderBy(asc(coursesTable.createdAt));
  const now = new Date();
  const inGrace = subscription?.subscription.graceEndsAt ? subscription.subscription.graceEndsAt > now : false;
  const operational = Boolean(subscription && (subscription.subscription.status === "trial" || subscription.subscription.status === "active" || subscription.subscription.status === "free_via_loyalty" || inGrace));
  const reactivation = subscription
    ? educationReactivationState({ subscription: subscription.subscription, plan: subscription.plan, courses, now })
    : null;
  res.json({
    center: { id: access.center.id, name: access.center.name, paymentReferenceNumber: access.center.paymentReferenceNumber },
    subscription: subscription ? { ...subscription.subscription, plan: subscription.plan } : null,
    publishedCourses: courses.filter((course) => course.published).map(({ id, title }) => ({ id, title })),
    inGrace,
    graceDaysRemaining: educationGraceDaysRemaining(now, subscription?.subscription.graceEndsAt ?? null),
    operational,
    reactivation,
  });
});

router.post("/education/subscription/reactivation-selection", async (req, res) => {
  const access = await ownerCenter(req, res); if (!access) return;
  const parsed = reactivationSelectionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Izbor kurseva nije ispravan." }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      const [subscription] = await tx.select().from(educationCenterSubscriptionsTable)
        .where(eq(educationCenterSubscriptionsTable.centerId, access.center.id)).for("update").limit(1);
      if (!subscription) throw new Error("NOT_FOUND");
      if (subscription.status !== "suspended") throw new Error("INVALID_STATE");
      const [plan] = await tx.select().from(subscriptionPlansTable)
        .where(eq(subscriptionPlansTable.id, subscription.planId)).for("update").limit(1);
      if (!plan) throw new Error("NOT_FOUND");
      const courses = await tx.select({
        id: coursesTable.id,
        title: coursesTable.title,
        published: coursesTable.published,
        subscriptionSuspended: coursesTable.subscriptionSuspended,
      }).from(coursesTable)
        .where(and(eq(coursesTable.centerId, access.center.id), eq(coursesTable.archived, false)))
        .orderBy(asc(coursesTable.createdAt)).for("update");
      const now = new Date();
      const state = educationReactivationState({ subscription, plan, courses, now });
      if (!state.paymentReady) throw new Error("PAYMENT_REQUIRED");
      if (!state.selectionRequired) throw new Error("SELECTION_NOT_REQUIRED");
      if (parsed.data.keepCourseIds.length !== state.requiredKeepCount) throw new Error("SELECTION_COUNT");
      const candidateIds = new Set(state.candidateCourses.map((course) => course.id));
      if (!parsed.data.keepCourseIds.every((id) => candidateIds.has(id))) throw new Error("INVALID_COURSE");
      const [saved] = await tx.update(educationCenterSubscriptionsTable)
        .set({ pendingKeepCourseIds: parsed.data.keepCourseIds, updatedAt: now })
        .where(eq(educationCenterSubscriptionsTable.id, subscription.id)).returning();
      await tx.insert(educationFinancialAuditLogTable).values({
        actorUserId: access.current.id,
        action: "education_reactivation_courses_selected",
        entityType: "education_center_subscription",
        entityId: subscription.id,
        oldValue: { selectedCount: subscription.pendingKeepCourseIds?.length ?? 0 },
        newValue: { selectedCount: parsed.data.keepCourseIds.length, selectedCourseIds: parsed.data.keepCourseIds, courseLimit: state.courseLimit },
        reason: "Centar je izabrao kurseve koji ostaju aktivni nakon reaktivacije.",
      });
      return {
        subscription: saved!,
        reactivation: educationReactivationState({ subscription: saved!, plan, courses, now }),
      };
    });
    res.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "FAILED";
    const status = code === "NOT_FOUND" ? 404 : 409;
    const message = code === "PAYMENT_REQUIRED"
      ? "Izbor kurseva je dostupan tek nakon evidentirane uplate."
      : code === "SELECTION_NOT_REQUIRED"
        ? "Izbor nije potreban jer svi prethodno objavljeni kursevi staju u aktuelni limit."
        : code === "SELECTION_COUNT"
          ? "Izaberite tačan broj kurseva koji staje u aktuelni limit."
          : code === "INVALID_COURSE"
            ? "Izbor sadrži kurs koji ne pripada listi za reaktivaciju."
            : code === "INVALID_STATE"
              ? "Izbor je dostupan samo za deaktiviran centar."
              : "Pretplata ili plan nisu pronađeni.";
    res.status(status).json({ error: message, code });
  }
});

router.patch("/education/subscription/auto-renew", async (req, res) => {
  const access = await ownerCenter(req, res); if (!access) return;
  const parsed = z.object({ autoRenew: z.boolean() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "autoRenew mora biti boolean." }); return; }
  const [saved] = await db.update(educationCenterSubscriptionsTable)
    .set({ autoRenew: parsed.data.autoRenew, updatedAt: new Date() })
    .where(eq(educationCenterSubscriptionsTable.centerId, access.center.id)).returning();
  if (!saved) { res.status(404).json({ error: "Pretplata nije pronađena." }); return; }
  await db.insert(educationFinancialAuditLogTable).values({
    actorUserId: access.current.id, action: "education_subscription_auto_renew_changed",
    entityType: "education_center_subscription", entityId: saved.id,
    newValue: { autoRenew: parsed.data.autoRenew, refundCreated: false },
    reason: parsed.data.autoRenew ? "Automatska obnova uključena" : "Automatska obnova isključena; tekući plaćeni period ostaje nepromenjen i nema refundacije",
  });
  res.json(saved);
});

router.post("/education/subscription/select-plan", async (req, res) => {
  const access = await ownerCenter(req, res); if (!access) return;
  const parsed = planBody.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: "Plan i ciklus nisu ispravni." }); return; }
  const [plan] = await db.select().from(subscriptionPlansTable).where(and(eq(subscriptionPlansTable.id, parsed.data.planId), eq(subscriptionPlansTable.active, true), eq(subscriptionPlansTable.audience, "education"), gt(subscriptionPlansTable.price, 0))).limit(1);
  if (!plan) { res.status(404).json({ error: "Plan nije pronađen." }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      const now = new Date();
      const [lockedPlan] = await tx.select({ id: subscriptionPlansTable.id }).from(subscriptionPlansTable)
        .where(and(eq(subscriptionPlansTable.id, plan.id), eq(subscriptionPlansTable.active, true), eq(subscriptionPlansTable.audience, "education"), gt(subscriptionPlansTable.price, 0)))
        .for("update").limit(1);
      if (!lockedPlan) throw new Error("PLAN_UNAVAILABLE");
      const [existing] = await tx.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, access.center.id)).for("update").limit(1);
      const trialClaim = await tx.insert(educationTrialClaimsTable).values({
        normalizedEmailHash: hashTrialIdentifier(normalizeTrialEmail(access.current.email))!,
        normalizedPhoneHash: hashTrialIdentifier(normalizeTrialPhone(access.current.phone)),
        normalizedPibHash: hashTrialIdentifier(normalizeTrialPib(access.center.pib)),
        normalizedRegistrationNumberHash: hashTrialIdentifier(normalizeTrialRegistrationNumber(access.center.registrationNumber)),
        normalizedBankAccountHash: hashTrialIdentifier(normalizeTrialBankAccount(access.center.bankAccount)),
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
        const frozenCurrentMonthlyPrice = existing.currentPriceSnapshot ?? currentPlan.price;
        const targetLimit = plan.courseLimit ?? plan.limits["courses"] ?? 0;
        const currentLimit = existing.currentCourseLimitSnapshot ?? currentPlan.courseLimit ?? currentPlan.limits["courses"] ?? 0;
        const published = await tx.select({ id: coursesTable.id }).from(coursesTable).where(and(eq(coursesTable.centerId, access.center.id), eq(coursesTable.published, true), eq(coursesTable.archived, false))).for("update");
        const limitReduction = targetLimit < currentLimit || published.length > targetLimit;
        const requiredKeepCount = Math.min(targetLimit, published.length);
        const keep = [...new Set(parsed.data.keepCourseIds ?? [])];
        const publishedIds = new Set(published.map((row) => row.id));
        if (limitReduction && (keep.length !== requiredKeepCount || keep.some((id) => !publishedIds.has(id)))) throw new Error("KEEP_COURSES_REQUIRED");
        if (plan.price <= frozenCurrentMonthlyPrice) {
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
            pendingPlanEffectiveAt: effectiveAt, pendingKeepCourseIds: parsed.data.keepCourseIds ?? null, updatedAt: now,
          }).where(eq(educationCenterSubscriptionsTable.id, existing.id)).returning();
          return { ...saved!, payment: null, change: "scheduled_downgrade" };
        }
        const periodStart = existing.currentPeriodStart ?? now;
        const proration = educationUpgradeProrationQuote({
          currentMonthlyPrice: frozenCurrentMonthlyPrice, nextMonthlyPrice: plan.price, billingCycle: existing.billingCycle as EducationBillingCycle,
          periodStart, periodEnd: existing.currentPeriodEnd, now,
        });
        const prorated = proration.payableWholeRsd;
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
           planMonthlyPriceSnapshot: plan.price, courseLimitSnapshot: plan.courseLimit ?? plan.limits["courses"] ?? null,
          expectedAmount: prorated, recipientNameSnapshot: settings.ipsRecipientName, recipientAccountSnapshot: settings.ipsRecipientAccount,
           calculationPolicySnapshot: proration,
          paymentCodeSnapshot: educationIpsPaymentCode("platform"), purposeSnapshot: "Proporcionalna doplata za viši Education plan",
          referenceSnapshot: paymentReference, billingCycleSnapshot: existing.billingCycle,
          servicePeriodStart: now, servicePeriodEnd: existing.currentPeriodEnd,
          ipsPayloadSnapshot: JSON.stringify(educationIpsQrPayload({ recipientName: settings.ipsRecipientName, recipientAccount: settings.ipsRecipientAccount, purpose: "Proporcionalna doplata za viši Education plan", amount: prorated, reference: paymentReference, recipientType: "platform", transactionType: "subscription", accountEnvironment: settings.ipsAccountEnvironment as "production" | "test", runtimeEnvironment: educationIpsRuntimeEnvironment() })),
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
          pendingPlanId: plan.id, pendingBillingCycle: cycle, pendingPlanEffectiveAt: pendingEffectiveAt,
          pendingKeepCourseIds: limitReduction ? keep : null, updatedAt: now,
        }).where(eq(educationCenterSubscriptionsTable.id, existing.id)).returning();
        return { ...saved!, payment: payment!, change: "upgrade_pending_payment" };
      }
      let replacementKeepCourseIds: string[] | null = null;
      if (existing) {
        const [currentPlan] = await tx.select().from(subscriptionPlansTable)
          .where(eq(subscriptionPlansTable.id, existing.planId)).limit(1);
        const targetLimit = plan.courseLimit ?? plan.limits["courses"] ?? 0;
        const currentLimit = existing.currentCourseLimitSnapshot
          ?? currentPlan?.courseLimit ?? currentPlan?.limits["courses"] ?? 0;
        const published = await tx.select({ id: coursesTable.id }).from(coursesTable)
          .where(and(eq(coursesTable.centerId, access.center.id), eq(coursesTable.published, true), eq(coursesTable.archived, false)))
          .for("update");
        const limitReduction = targetLimit < currentLimit || published.length > targetLimit;
        const requiredKeepCount = Math.min(targetLimit, published.length);
        const keep = [...new Set(parsed.data.keepCourseIds ?? [])];
        const publishedIds = new Set(published.map((row) => row.id));
        if (limitReduction && (keep.length !== requiredKeepCount || keep.some((id) => !publishedIds.has(id)))) {
          throw new Error("KEEP_COURSES_REQUIRED");
        }
        replacementKeepCourseIds = limitReduction ? keep : null;
      }
      const next = {
        planId: plan.id, status: trial ? "trial" as const : "past_due" as const,
        dueAmount: trial ? 0 : amount, billingCycle: cycle,
        trialStartedAt: trial ? now : existing?.trialStartedAt ?? null,
        trialEndsAt: trial ? trialEndsAt : existing?.trialEndsAt ?? null,
        currentPeriodStart: trial ? now : existing?.currentPeriodStart ?? null,
        currentPeriodEnd: trialEndsAt, graceEndsAt: null, deactivatedAt: null,
        pendingPlanId: null, pendingBillingCycle: null, pendingPlanEffectiveAt: null,
        pendingKeepCourseIds: replacementKeepCourseIds,
        currentPriceSnapshot: trial ? plan.price : existing?.currentPriceSnapshot ?? null,
        currentCourseLimitSnapshot: trial ? (plan.courseLimit ?? plan.limits["courses"] ?? null) : existing?.currentCourseLimitSnapshot ?? null,
        updatedAt: now,
      };
      const [saved] = existing
        ? await tx.update(educationCenterSubscriptionsTable).set(next).where(eq(educationCenterSubscriptionsTable.id, existing.id)).returning()
        : await tx.insert(educationCenterSubscriptionsTable).values({ centerId: access.center.id, paymentMethod: "BANK_TRANSFER", ...next }).returning();
      await tx.insert(educationFinancialAuditLogTable).values({
        actorUserId: access.current.id, action: "education_subscription_plan_selected",
        entityType: "education_center_subscription", entityId: saved!.id,
        oldValue: existing ? { planId: existing.planId, status: existing.status } : null,
        newValue: { planId: plan.id, status: next.status, trial },
        reason: trial ? "Prvi Education trial" : "Izbor ili promena plana",
      });
      return { ...saved!, payment: null, change: trial ? "trial_started" : "renewal_required" };
    });
    const [resultPlan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, result.planId)).limit(1);
    res.status(201).json({ ...result, plan: resultPlan });
  } catch (error) {
    req.log?.error({ err: error }, "Education subscription plan selection failed");
    res.status(409).json({ error: error instanceof Error && error.message === "KEEP_COURSES_REQUIRED" ? "Za plan sa nižim limitom morate izabrati tačno kurseve koji ostaju objavljeni (keepCourseIds)." : "Plan nije moguće aktivirati. Trial može biti iskorišćen samo jednom." });
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
    if (pendingRenewal) return pendingRenewal.expectedAmount > 0 ? { obligation: pendingRenewal } : { error: "PLAN_UNAVAILABLE" as const };
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
    if (subscriptionRow.contractKind !== "custom" && (!plan.active || plan.audience !== "education" || plan.price <= 0)) {
      return { error: "PLAN_UNAVAILABLE" as const };
    }
    const amount = subscriptionRow.contractKind === "custom" ? subscriptionRow.dueAmount : educationCycleAmount(plan.price, cycle);
    const periodEnd = subscriptionRow.contractKind === "custom" && subscriptionRow.contractEndsAt
      ? subscriptionRow.contractEndsAt : addEducationBillingPeriod(periodStart, cycle);
    if (periodEnd <= periodStart) return { error: "CONTRACT_EXPIRED" as const };
    const obligationId = randomUUID();
    const paymentReference = reference("SUB", obligationId);
    const payload = educationIpsQrPayload({ recipientName: settings.ipsRecipientName, recipientAccount: settings.ipsRecipientAccount, purpose: "Pretplata za Education centar", amount, reference: paymentReference, recipientType: "platform", transactionType: "subscription", accountEnvironment: settings.ipsAccountEnvironment as "production" | "test", runtimeEnvironment: educationIpsRuntimeEnvironment() });
    const [created] = await tx.insert(educationPaymentObligationsTable).values({
      id: obligationId, centerId: access.center.id, subscriptionId: subscriptionRow.id, kind: "subscription_renewal",
      planIdSnapshot: effectivePlanId,
       planMonthlyPriceSnapshot: plan.price,
       courseLimitSnapshot: subscriptionRow.contractKind === "custom" ? subscriptionRow.courseLimitOverride : plan.courseLimit ?? plan.limits["courses"] ?? null,
      expectedAmount: amount, recipientNameSnapshot: settings.ipsRecipientName, recipientAccountSnapshot: settings.ipsRecipientAccount,
      paymentCodeSnapshot: educationIpsPaymentCode("platform"), purposeSnapshot: "Pretplata za Education centar", referenceSnapshot: paymentReference,
      ipsPayloadSnapshot: JSON.stringify(payload), billingCycleSnapshot: cycle, servicePeriodStart: periodStart, servicePeriodEnd: periodEnd,
    }).returning();
    return { obligation: created! };
  });
  if ("error" in result) {
    res.status(result.error === "NOT_FOUND" ? 404 : 409).json({ error: result.error === "SETTINGS" ? "Platforma nema podešen račun za pretplate." : result.error === "CONTRACT_EXPIRED" ? "Ugovor je istekao ili nema važeći period." : result.error === "PLAN_UNAVAILABLE" ? "Plan mora biti aktivan i imati pozitivnu cenu pre obnove." : result.error === "UPGRADE_PENDING" ? "Najpre evidentirajte ili poništite otvorenu doplatu za viši plan." : "Pretplata nije pronađena." });
    return;
  }
  const obligation = result.obligation;
  res.json({ amount: obligation.expectedAmount, reference: obligation.referenceSnapshot, paymentCode: obligation.paymentCodeSnapshot, ips: obligation.ipsPayloadSnapshot ? JSON.parse(obligation.ipsPayloadSnapshot) : null });
});

router.get("/admin/education/grace-centers", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  const rows = await db.select({ center: educationCentersTable, subscription: educationCenterSubscriptionsTable })
    .from(educationCenterSubscriptionsTable).innerJoin(educationCentersTable, eq(educationCentersTable.id, educationCenterSubscriptionsTable.centerId))
    .where(and(isNotNull(educationCenterSubscriptionsTable.graceEndsAt), gt(educationCenterSubscriptionsTable.graceEndsAt, new Date())))
    .orderBy(asc(educationCenterSubscriptionsTable.graceEndsAt));
  const now = new Date();
  res.json(rows.map((row) => ({ ...row, daysRemaining: educationGraceDaysRemaining(now, row.subscription.graceEndsAt) ?? 0 })));
});

router.post("/admin/education/centers/:centerId/extend-grace", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  const parsed = reasonBody.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: "Razlog je obavezan." }); return; }
  const updated = await db.transaction(async (tx) => {
    const [subscription] = await tx.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, req.params.centerId)).for("update").limit(1);
    if (!subscription) throw new Error("NOT_FOUND");
    if (subscription.status === "suspended") throw new Error("REACTIVATION_REQUIRED");
    const now = new Date(); const base = subscription.graceEndsAt && subscription.graceEndsAt > now ? subscription.graceEndsAt : now;
    const graceEndsAt = addEducationBelgradeCalendarDays(base, 5);
    const [saved] = await tx.update(educationCenterSubscriptionsTable).set({ status: "past_due", graceEndsAt, graceExtensionNote: parsed.data.reason, deactivatedAt: null, updatedAt: now }).where(eq(educationCenterSubscriptionsTable.id, subscription.id)).returning();
    await tx.insert(educationGraceNotesTable).values({ centerId: req.params.centerId, authorUserId: actor.id, note: parsed.data.reason });
    await tx.insert(educationFinancialAuditLogTable).values({ actorUserId: actor.id, action: "education_grace_extended", entityType: "education_center_subscription", entityId: subscription.id, oldValue: { graceEndsAt: subscription.graceEndsAt }, newValue: { graceEndsAt }, reason: parsed.data.reason });
    return saved;
  }).catch((error) => {
    if (error instanceof Error && error.message === "NOT_FOUND") return null;
    if (error instanceof Error && error.message === "REACTIVATION_REQUIRED") return false;
    throw error;
  });
  if (updated === false) { res.status(409).json({ error: "Deaktiviran centar mora proći kontrolisanu reaktivaciju; grace period se ne može ponovo otvoriti." }); return; }
  if (updated === null) { res.status(404).json({ error: "Pretplata nije pronađena." }); return; }
  res.json(updated);
});

router.post("/admin/education/centers/:centerId/reactivate", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  const parsed = reasonBody.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: "Razlog je obavezan." }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      const [subscription] = await tx.select().from(educationCenterSubscriptionsTable)
        .where(eq(educationCenterSubscriptionsTable.centerId, req.params.centerId)).for("update").limit(1);
      if (!subscription) throw new Error("NOT_FOUND");
      if (subscription.status !== "suspended") throw new Error(subscription.status === "active" ? "ALREADY_ACTIVE" : "INVALID_STATE");
      const [plan] = await tx.select().from(subscriptionPlansTable)
        .where(eq(subscriptionPlansTable.id, subscription.planId)).for("update").limit(1);
      if (!plan) throw new Error("NOT_FOUND");
      const courses = await tx.select({
        id: coursesTable.id,
        title: coursesTable.title,
        published: coursesTable.published,
        subscriptionSuspended: coursesTable.subscriptionSuspended,
      }).from(coursesTable)
        .where(and(eq(coursesTable.centerId, req.params.centerId), eq(coursesTable.archived, false)))
        .orderBy(asc(coursesTable.createdAt)).for("update");
      const now = new Date();
      const state = educationReactivationState({ subscription, plan, courses, now });
      if (!state.paymentReady) throw new Error("PAYMENT_REQUIRED");
      if (state.selectionRequired && !state.selectionComplete) throw new Error("COURSE_SELECTION_REQUIRED");
      const selectedCourseIds = state.selectionRequired
        ? state.selectedKeepCourseIds
        : state.candidateCourses.slice(0, state.requiredKeepCount).map((course) => course.id);
      if (selectedCourseIds.length) {
        await tx.update(coursesTable).set({
          published: true,
          subscriptionSuspended: false,
          updatedAt: now,
        }).where(and(
          eq(coursesTable.centerId, req.params.centerId),
          eq(coursesTable.archived, false),
          eq(coursesTable.published, false),
          eq(coursesTable.subscriptionSuspended, true),
          inArray(coursesTable.id, selectedCourseIds),
        ));
      }
      const [saved] = await tx.update(educationCenterSubscriptionsTable).set({
        status: "active",
        deactivatedAt: null,
        graceEndsAt: null,
        pendingKeepCourseIds: null,
        updatedAt: now,
      }).where(and(
        eq(educationCenterSubscriptionsTable.id, subscription.id),
        eq(educationCenterSubscriptionsTable.status, "suspended"),
      )).returning();
      if (!saved) throw new Error("STALE_STATE");
      await tx.insert(educationFinancialAuditLogTable).values({
        actorUserId: actor.id,
        action: "education_center_reactivated",
        entityType: "education_center",
        entityId: req.params.centerId,
        oldValue: {
          status: subscription.status,
          deactivatedAt: subscription.deactivatedAt,
          suspendedCourseCount: state.candidateCourses.length,
        },
        newValue: {
          status: "active",
          courseLimit: state.courseLimit,
          reactivatedCourseCount: selectedCourseIds.length,
          reactivatedCourseIds: selectedCourseIds,
        },
        reason: parsed.data.reason,
      });
      return { subscription: { ...saved, plan }, reactivatedCourseIds: selectedCourseIds, courseLimit: state.courseLimit };
    });
    res.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "FAILED";
    const status = code === "NOT_FOUND" ? 404 : 409;
    const message = code === "PAYMENT_REQUIRED"
      ? "Reaktivacija zahteva evidentiranu uplatu i važeći plaćeni period."
      : code === "COURSE_SELECTION_REQUIRED"
        ? "Centar mora prvo izabrati kurseve koji ostaju aktivni u okviru aktuelnog limita."
        : code === "ALREADY_ACTIVE"
          ? "Centar je već reaktiviran."
          : code === "INVALID_STATE"
            ? "Reaktivacija je dostupna samo za deaktiviran centar."
            : code === "STALE_STATE"
              ? "Status centra je u međuvremenu promenjen. Osvežite podatke."
              : "Pretplata ili plan nisu pronađeni.";
    res.status(status).json({ error: message, code });
  }
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
      autoRenew: parsed.data.autoRenew, courseLimitOverride: parsed.data.courseLimit,
      dueAmount: parsed.data.amountRsd,
      status: subscription.status === "suspended" ? "suspended" : "past_due",
      graceEndsAt: null,
      deactivatedAt: subscription.status === "suspended" ? subscription.deactivatedAt ?? now : null,
      currentPeriodStart: null, currentPeriodEnd: null,
      currentPriceSnapshot: null, currentCourseLimitSnapshot: null,
      pendingPlanId: null, pendingBillingCycle: null, pendingPlanEffectiveAt: null,
      pendingKeepCourseIds: null,
      updatedAt: now,
    }).where(eq(educationCenterSubscriptionsTable.id, subscription.id)).returning();
    await tx.insert(educationFinancialAuditLogTable).values({
      actorUserId: actor.id, action: "education_custom_contract_configured",
      entityType: "education_center_subscription", entityId: subscription.id,
      oldValue: { contractKind: subscription.contractKind, contractEndsAt: subscription.contractEndsAt, dueAmount: subscription.dueAmount },
       newValue: { contractKind: "custom", contractEndsAt, dueAmount: parsed.data.amountRsd, billingCycle: parsed.data.billingCycle, courseLimit: parsed.data.courseLimit, autoRenew: parsed.data.autoRenew },
      reason: parsed.data.reason,
    });
    if (parsed.data.requestId) {
      const [request] = await tx.update(educationCustomPlanRequestsTable).set({ status: "approved", resolvedByUserId: actor.id, resolvedAt: now })
        .where(and(eq(educationCustomPlanRequestsTable.id, parsed.data.requestId), eq(educationCustomPlanRequestsTable.centerId, req.params.centerId), eq(educationCustomPlanRequestsTable.status, "pending"))).returning();
      if (!request) throw new Error("REQUEST_NOT_FOUND");
    }
    return saved!;
  }).catch((error) => {
    if (error instanceof Error && error.message === "REQUEST_NOT_FOUND") return "REQUEST_NOT_FOUND" as const;
    throw error;
  });
  if (updated === "REQUEST_NOT_FOUND") { res.status(404).json({ error: "Otvoren zahtev za ovaj centar nije pronađen." }); return; }
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
    if (!enrollment || !isOnlineEnrollmentSnapshot(enrollment.enrollment)
      || !enrollment.enrollment.accessExpiresAt || !enrollment.center.bankAccount) throw new Error("NOT_FOUND");
    const price = parsed.data.months === 1 ? enrollment.enrollment.extensionPricesSnapshot?.oneMonth : parsed.data.months === 3 ? enrollment.enrollment.extensionPricesSnapshot?.threeMonths : enrollment.enrollment.extensionPricesSnapshot?.sixMonths;
    if (price == null || price <= 0) throw new Error("PRICE");
    const [openExtension] = await tx.select({ id: educationAccessExtensionsTable.id }).from(educationAccessExtensionsTable)
      .where(and(eq(educationAccessExtensionsTable.enrollmentId, enrollment.enrollment.id), eq(educationAccessExtensionsTable.status, "pending"))).for("update").limit(1);
    if (openExtension) throw new Error("PENDING");
    const extended = addMonths(enrollment.enrollment.accessExpiresAt, parsed.data.months);
    const recipientType = enrollment.center.legalEntityType === "individual" ? "education_center_individual" as const : "education_center_legal" as const;
    const paymentReference = reference("EXT", randomUUID());
    const ips = educationIpsQrPayload({ recipientName: enrollment.center.name, recipientAccount: enrollment.center.bankAccount, purpose: "Produženje pristupa online kursu", amount: price, reference: paymentReference, recipientType, transactionType: "course_extension", accountEnvironment: enrollment.center.bankAccountEnvironment as "production" | "test", runtimeEnvironment: educationIpsRuntimeEnvironment() });
    const obligation = await tx.insert(educationPaymentObligationsTable).values({ centerId: enrollment.center.id, enrollmentId: enrollment.enrollment.id, kind: "course_extension", expectedAmount: price, recipientNameSnapshot: enrollment.center.name, recipientAccountSnapshot: enrollment.center.bankAccount, paymentCodeSnapshot: ips.paymentCode, purposeSnapshot: "Produženje pristupa online kursu", referenceSnapshot: paymentReference, ipsPayloadSnapshot: JSON.stringify(ips) }).returning();
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
  }).catch((error) => { if (error instanceof Error && error.message === "NOT_FOUND") return false; if (error instanceof Error && error.message === "PRICE") return null; if (error instanceof Error && error.message === "PENDING") return "PENDING" as const; throw error; });
  if (result === false) res.status(404).json({ error: "Aktivan pristup ili centar nije pronađen." });
  else if (result === null) res.status(409).json({ error: "Centar nije podesio cene produženja." });
  else if (result === "PENDING") res.status(409).json({ error: "Već postoji otvoren zahtev za produženje pristupa." });
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
    const settlement = await db.transaction((tx) => settleEducationPaymentObligationInTransaction(tx, {
      obligationId: req.params.obligationId,
      confirmedAmountRsd: parsed.data.confirmedAmountRsd,
      actorUserId: actor.id,
      reason: parsed.data.reason,
      source: "manual",
    }));
    if (!settlement.ok) {
      const status = settlement.code === "NOT_FOUND" ? 404 : 409;
      res.status(status).json({
        error: settlement.code === "AMOUNT_MISMATCH"
          ? "Potvrđeni iznos mora biti jednak očekivanom iznosu."
          : settlement.code === "ALREADY_SETTLED"
            ? "Ova uplata je već evidentirana."
            : "Obaveza nije pronađena.",
      });
      return;
    }
    res.json(settlement.obligation);
  } catch (error) {
    req.log?.error({ err: error }, "Education payment-obligation settlement failed");
    res.status(500).json({ error: "Uplata trenutno nije mogla biti evidentirana." });
  }
});

router.get("/admin/education/bank-reconciliation", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  res.json(await getEducationBankReconciliationStatus());
});

router.patch("/admin/education/bank-reconciliation", async (req, res) => {
  const actor = await superAdmin(req, res); if (!actor) return;
  const enabled = req.body?.enabled;
  if (typeof enabled !== "boolean") { res.status(400).json({ error: "Vrednost prekidača mora biti true ili false." }); return; }
  await db.transaction(async (tx) => {
    await lockEducationBillingRules(tx, "exclusive");
    const [settings] = await tx.select().from(educationPlatformSettingsTable)
      .orderBy(asc(educationPlatformSettingsTable.createdAt), asc(educationPlatformSettingsTable.id))
      .for("update")
      .limit(1);
    const saved = settings
      ? (await tx.update(educationPlatformSettingsTable).set({
        bankReconciliationEnabled: enabled,
        updatedByUserId: actor.id,
        updatedAt: new Date(),
      }).where(eq(educationPlatformSettingsTable.id, settings.id)).returning())[0]
      : (await tx.insert(educationPlatformSettingsTable).values({
        bankReconciliationEnabled: enabled,
        updatedByUserId: actor.id,
      }).returning())[0];
    if (!saved) throw new Error("Education reconciliation settings were not saved.");
    if (settings?.bankReconciliationEnabled !== enabled) {
      await tx.insert(educationFinancialAuditLogTable).values({
        actorUserId: actor.id,
        action: "bank_reconciliation_toggled",
        entityType: "education_platform_settings",
        entityId: saved.id,
        oldValue: { enabled: settings?.bankReconciliationEnabled ?? false },
        newValue: { enabled },
        reason: "Administrator je promenio status internog reconciliation engine-a; bankovna veza nije konfigurisana.",
      });
    }
  });
  res.json(await getEducationBankReconciliationStatus());
});

export default router;