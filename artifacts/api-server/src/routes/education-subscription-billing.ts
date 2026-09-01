import { createHash } from "node:crypto";
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

const router: IRouter = Router();
const planBody = z.object({ planId: z.string().uuid(), billingCycle: z.enum(["monthly", "yearly"]).default("monthly") });
const reasonBody = z.object({ reason: z.string().trim().min(3).max(1000) });
const extendBody = z.object({ months: z.union([z.literal(1), z.literal(3), z.literal(6)]) });
const belgradeMonth = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return { year: Number(parts.find((p) => p.type === "year")?.value), month: Number(parts.find((p) => p.type === "month")?.value), day: Number(parts.find((p) => p.type === "day")?.value) };
};
const addMonths = (date: Date, months: number) => {
  const p = belgradeMonth(date);
  return new Date(Date.UTC(p.year, p.month - 1 + months, p.day, 12));
};
const hash = (value: string | null | undefined) => value ? createHash("sha256").update(value.trim().toLowerCase()).digest("hex") : null;
const reference = (prefix: string, id: string) => `${prefix}${createHash("sha256").update(id).digest("hex").replace(/\D/g, "").padStart(18, "0").slice(0, 18)}`;
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
        normalizedEmailHash: hash(access.current.email)!, userId: access.current.id, centerId: access.center.id,
      }).onConflictDoNothing().returning();
      const trial = !existing && trialClaim.length > 0;
      const trialEndsAt = trial ? addMonths(now, 1) : null;
      const next = {
        planId: plan.id, status: trial ? "trial" as const : "past_due" as const,
        dueAmount: trial ? 0 : plan.price, billingCycle: parsed.data.billingCycle,
        trialStartedAt: trial ? now : existing?.trialStartedAt ?? null,
        trialEndsAt: trial ? trialEndsAt : existing?.trialEndsAt ?? null,
        currentPeriodEnd: trialEndsAt, graceEndsAt: null, deactivatedAt: null,
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
      return saved;
    });
    res.status(201).json(result);
  } catch { res.status(409).json({ error: "Plan nije moguće aktivirati. Trial može biti iskorišćen samo jednom." }); }
});

router.post("/education/subscription/renewal-instructions", async (req, res) => {
  const access = await ownerCenter(req, res); if (!access) return;
  const [subscription] = await db.select({ subscription: educationCenterSubscriptionsTable, plan: subscriptionPlansTable })
    .from(educationCenterSubscriptionsTable).innerJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, educationCenterSubscriptionsTable.planId))
    .where(eq(educationCenterSubscriptionsTable.centerId, access.center.id)).limit(1);
  if (!subscription) { res.status(404).json({ error: "Pretplata nije pronađena." }); return; }
  if (!access.center.bankAccount || !access.center.paymentReferenceNumber) { res.status(409).json({ error: "Centar nema podešen validan račun i referentni broj." }); return; }
  const id = `SUB-${subscription.subscription.id}-${Date.now()}`;
  const amount = subscription.subscription.dueAmount || subscription.plan.price;
  const payload = educationIpsQrPayload({
    recipientName: access.center.name, recipientAccount: access.center.bankAccount,
    purpose: "Pretplata za Education centar", amount, reference: access.center.paymentReferenceNumber,
  });
  res.json({ amount, reference: access.center.paymentReferenceNumber, paymentCode: "221", ips: payload, environment: process.env.NODE_ENV });
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
    const [saved] = await tx.update(educationCenterSubscriptionsTable).set({ status: "active", deactivatedAt: null, graceEndsAt: null, currentPeriodEnd: addMonths(new Date(), 1), updatedAt: new Date() }).where(eq(educationCenterSubscriptionsTable.id, sub.id)).returning();
    await tx.insert(educationFinancialAuditLogTable).values({ actorUserId: actor.id, action: "education_center_reactivated", entityType: "education_center", entityId: req.params.centerId, oldValue: { status: sub.status }, newValue: { status: "active" }, reason: parsed.data.reason });
    return saved;
  }).catch((error) => { if (error instanceof Error && error.message === "NOT_FOUND") return null; throw error; });
  if (!updated) { res.status(404).json({ error: "Pretplata nije pronađena." }); return; }
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
        await tx.update(educationCenterSubscriptionsTable).set({ status: "active", paidAt: new Date(), currentPeriodEnd: addMonths(new Date(), 1), graceEndsAt: null, deactivatedAt: null, updatedAt: new Date() }).where(eq(educationCenterSubscriptionsTable.id, obligation.subscriptionId));
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