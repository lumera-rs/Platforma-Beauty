/**
 * Business Growth Phase 2 — /growth router
 *
 * Auth model:
 *   - SALON_OWNER routes: owner role + activeSalon ownership verification
 *   - SALON_EMPLOYEE routes: employee role, self-only reads
 *   - CUSTOMER routes: authenticated user, ownership strictly derived (no salonCustomerId from body)
 *   - ADMIN read-only: /growth/admin/summary
 */

import { Router } from "express";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  db,
  automationRulesTable,
  automationRunsTable,
  automationDeliveriesTable,
  treatmentPackagesTable,
  packageServiceLinksTable,
  packagePurchaseServiceLinksTable,
  customerPackagePurchasesTable,
  packageRedemptionsTable,
  employeeCommissionSettingsTable,
  employeesTable,
  appointmentsTable,
  salonCustomersTable,
  salonsTable,
  usersTable,
  servicesTable,
  reviewsTable,
} from "@workspace/db";
import {
  OwnerCreateAutomationBody,
  OwnerUpdateAutomationBody,
  OwnerCreateAutomationFromAiProposalBody,
  OwnerCreatePackageBody,
  OwnerUpdatePackageBody,
  CustomerRedeemPackageSessionBody,
  OwnerUpdateEmployeeCommissionBody,
  OwnerAskGrowthAiBody,
  CustomerPurchasePackageBody,
} from "@workspace/api-zod";
import { getCurrentUser } from "../lib/auth";
import { classifyRetention } from "../lib/retention-classification";
import { redeemPackageSession, reversePackageRedemption } from "../lib/package-entitlement";
import { getEmployeePerformance } from "../lib/employee-performance";
import { askGrowthAi } from "../lib/growth-ai-snapshot";
import { dryRunAutomationRule } from "../lib/automation-worker";

const router = Router();

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function requireSalonOwner(req: import("express").Request) {
  const user = await getCurrentUser(req);
  if (!user || user.role !== "SALON_OWNER") return null;

  const [ownerRow] = await db
    .select({ activeSalonId: usersTable.activeSalonId })
    .from(usersTable)
    .where(eq(usersTable.id, user.id))
    .limit(1);

  const activeSalonId = ownerRow?.activeSalonId;
  if (!activeSalonId) return null;

  const [salon] = await db
    .select()
    .from(salonsTable)
    .where(and(eq(salonsTable.id, activeSalonId), eq(salonsTable.ownerId, user.id)))
    .limit(1);

  if (!salon) return null;
  return { user, salon };
}

async function requireEmployee(req: import("express").Request) {
  const user = await getCurrentUser(req);
  if (!user || user.role !== "SALON_EMPLOYEE") return null;

  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.userId, user.id), eq(employeesTable.active, true)))
    .limit(1);

  if (!employee) return null;
  return { user, employee };
}

/** Resolves the authenticated user's salonCustomer record for a given salonId. */
async function requireCustomerRecord(req: import("express").Request, salonId: string) {
  const user = await getCurrentUser(req);
  if (!user) return null;

  const [record] = await db
    .select()
    .from(salonCustomersTable)
    .where(and(eq(salonCustomersTable.userId, user.id), eq(salonCustomersTable.salonId, salonId)))
    .limit(1);

  return record ? { user, salonCustomer: record } : null;
}

/** Normalize a phone number to the canonical stored form (mirrors marketplace). */
function normalizedPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "").replace(/^00/, "");
  if (!digits) return "";
  return digits.startsWith("0") ? `381${digits.slice(1)}` : digits;
}

/**
 * Resolve the authenticated user's salon_customers row for a salon, creating one
 * atomically from the user's own identity if none exists. Concurrency-safe via
 * the (salonId, userId) unique index: onConflictDoNothing + re-select on race.
 * Identity is only ever the authenticated user's — never body-supplied.
 */
async function resolveOrCreateSalonCustomer(
  user: typeof usersTable.$inferSelect,
  salonId: string,
): Promise<typeof salonCustomersTable.$inferSelect | null> {
  const existing = await db
    .select()
    .from(salonCustomersTable)
    .where(and(eq(salonCustomersTable.userId, user.id), eq(salonCustomersTable.salonId, salonId)))
    .limit(1);
  if (existing[0]) return existing[0];

  const phoneNorm = user.phone ? normalizedPhone(user.phone) || null : null;
  const [created] = await db
    .insert(salonCustomersTable)
    .values({
      salonId,
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      phoneNormalized: phoneNorm,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost the insert race (or conflicted on phone) — re-select the canonical row.
  const [after] = await db
    .select()
    .from(salonCustomersTable)
    .where(and(eq(salonCustomersTable.userId, user.id), eq(salonCustomersTable.salonId, salonId)))
    .limit(1);
  return after ?? null;
}

// ---------------------------------------------------------------------------
// RETENTION
// ---------------------------------------------------------------------------

router.get("/growth/retention", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const customers = await db
      .select()
      .from(salonCustomersTable)
      .where(eq(salonCustomersTable.salonId, ctx.salon.id));

    const allAppts = await db
      .select({
        salonCustomerId: appointmentsTable.salonCustomerId,
        date: appointmentsTable.date,
        status: appointmentsTable.status,
        price: appointmentsTable.price,
      })
      .from(appointmentsTable)
      .where(eq(appointmentsTable.salonId, ctx.salon.id));

    // Compute salon-wide median spend for VIP threshold
    const completedSpends = allAppts
      .filter((a) => a.status === "completed")
      .map((a) => a.price);
    completedSpends.sort((a, b) => a - b);
    const mid = Math.floor(completedSpends.length / 2);
    const salonMedianSpend = completedSpends.length
      ? completedSpends.length % 2 === 0
        ? ((completedSpends[mid - 1]! + completedSpends[mid]!) / 2)
        : completedSpends[mid]!
      : undefined;

    const apptsByCustomer = new Map<string, typeof allAppts>();
    for (const a of allAppts) {
      if (!a.salonCustomerId) continue;
      const arr = apptsByCustomer.get(a.salonCustomerId) ?? [];
      arr.push(a);
      apptsByCustomer.set(a.salonCustomerId, arr);
    }

    const result = customers.map((c) => {
      const appts = apptsByCustomer.get(c.id) ?? [];
      const r = classifyRetention({
        appointments: appts.map((a) => ({
          date: a.date,
          status: a.status as "pending" | "confirmed" | "completed" | "cancelled" | "no-show",
          price: a.price,
        })),
        salonMedianSpend,
      });
      return {
        salonCustomerId: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
        birthDate: c.birthDate ?? null,
        status: r.status,
        completedCount: r.completedCount,
        lastVisitDaysAgo: r.lastVisitDaysAgo,
        typicalIntervalDays: r.typicalIntervalDays,
        totalSpend: r.totalSpend,
        hasFutureAppointment: r.hasFutureAppointment,
        explanation: r.explanation,
        recommendedAction: r.recommendedAction,
      };
    });

    res.json(result);
  } catch (err) { next(err); }
});

router.get("/growth/retention/:salonCustomerId", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const { salonCustomerId } = req.params;
    const [customer] = await db
      .select()
      .from(salonCustomersTable)
      .where(and(eq(salonCustomersTable.id, salonCustomerId!), eq(salonCustomersTable.salonId, ctx.salon.id)))
      .limit(1);

    if (!customer) { res.status(404).json({ error: "Customer not found.", code: "NOT_FOUND" }); return; }

    const appts = await db
      .select({
        id: appointmentsTable.id,
        date: appointmentsTable.date,
        status: appointmentsTable.status,
        price: appointmentsTable.price,
        serviceId: appointmentsTable.serviceId,
      })
      .from(appointmentsTable)
      .where(and(eq(appointmentsTable.salonId, ctx.salon.id), eq(appointmentsTable.salonCustomerId, salonCustomerId!)))
      .orderBy(desc(appointmentsTable.date))
      .limit(50);

    const serviceIds = [...new Set(appts.map((a) => a.serviceId))];
    const services = serviceIds.length > 0
      ? await db.select({ id: servicesTable.id, name: servicesTable.name }).from(servicesTable).where(inArray(servicesTable.id, serviceIds))
      : [];
    const serviceNameMap = new Map(services.map((s) => [s.id, s.name]));

    const r = classifyRetention({
      appointments: appts.map((a) => ({
        date: a.date,
        status: a.status as "pending" | "confirmed" | "completed" | "cancelled" | "no-show",
        price: a.price,
      })),
    });

    res.json({
      salonCustomerId: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
      birthDate: customer.birthDate ?? null,
      status: r.status,
      completedCount: r.completedCount,
      lastVisitDaysAgo: r.lastVisitDaysAgo,
      typicalIntervalDays: r.typicalIntervalDays,
      totalSpend: r.totalSpend,
      hasFutureAppointment: r.hasFutureAppointment,
      explanation: r.explanation,
      recommendedAction: r.recommendedAction,
      recentAppointments: appts.map((a) => ({
        id: a.id,
        date: a.date,
        status: a.status,
        price: a.price,
        serviceName: serviceNameMap.get(a.serviceId) ?? "Unknown",
      })),
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// AUTOMATIONS — CRUD
// ---------------------------------------------------------------------------

router.get("/growth/automations", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const rules = await db
      .select()
      .from(automationRulesTable)
      .where(eq(automationRulesTable.salonId, ctx.salon.id))
      .orderBy(desc(automationRulesTable.createdAt));

    res.json(rules);
  } catch (err) { next(err); }
});

router.post("/growth/automations", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const parsed = OwnerCreateAutomationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error.", code: "VALIDATION_ERROR", issues: parsed.error.issues });
      return;
    }
    const { name, trigger, triggerConfig, action, emailSubject, emailBody, smsBody, voucherCode } = parsed.data;

    const [rule] = await db.insert(automationRulesTable).values({
      salonId: ctx.salon.id,
      name,
      trigger: trigger as typeof automationRulesTable.$inferInsert["trigger"],
      triggerConfig: (triggerConfig as Record<string, unknown>) ?? {},
      action: action as typeof automationRulesTable.$inferInsert["action"],
      emailSubject: emailSubject ?? null,
      emailBody: emailBody ?? null,
      smsBody: smsBody ?? null,
      voucherCode: voucherCode ?? null,
      status: "draft",
    }).returning();

    res.status(201).json(rule);
  } catch (err) { next(err); }
});

router.get("/growth/automations/from-ai-proposal", async (_req, res) => {
  res.status(405).json({ error: "Use POST.", code: "METHOD_NOT_ALLOWED" });
});

router.post("/growth/automations/from-ai-proposal", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const parsed = OwnerCreateAutomationFromAiProposalBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error.", code: "VALIDATION_ERROR", issues: parsed.error.issues });
      return;
    }
    const { name, trigger, triggerConfig, action, emailSubject, emailBody, smsBody, voucherCode } = parsed.data;

    const [rule] = await db.insert(automationRulesTable).values({
      salonId: ctx.salon.id,
      name,
      trigger: trigger as typeof automationRulesTable.$inferInsert["trigger"],
      triggerConfig: (triggerConfig as Record<string, unknown>) ?? {},
      action: action as typeof automationRulesTable.$inferInsert["action"],
      emailSubject: emailSubject ?? null,
      emailBody: emailBody ?? null,
      smsBody: smsBody ?? null,
      voucherCode: voucherCode ?? null,
      status: "paused", // AI proposals start paused; owner must explicitly activate
      aiProposed: true,
    }).returning();

    res.status(201).json(rule);
  } catch (err) { next(err); }
});

router.get("/growth/automations/:automationId", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const [rule] = await db
      .select()
      .from(automationRulesTable)
      .where(and(eq(automationRulesTable.id, req.params["automationId"]!), eq(automationRulesTable.salonId, ctx.salon.id)))
      .limit(1);

    if (!rule) { res.status(404).json({ error: "Automation not found.", code: "NOT_FOUND" }); return; }
    res.json(rule);
  } catch (err) { next(err); }
});

router.patch("/growth/automations/:automationId", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const [existing] = await db
      .select()
      .from(automationRulesTable)
      .where(and(eq(automationRulesTable.id, req.params["automationId"]!), eq(automationRulesTable.salonId, ctx.salon.id)))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Automation not found.", code: "NOT_FOUND" }); return; }

    const parsed = OwnerUpdateAutomationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error.", code: "VALIDATION_ERROR", issues: parsed.error.issues });
      return;
    }

    const updates: Partial<typeof automationRulesTable.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.trigger !== undefined) updates.trigger = parsed.data.trigger as typeof automationRulesTable.$inferInsert["trigger"];
    if (parsed.data.triggerConfig !== undefined) updates.triggerConfig = parsed.data.triggerConfig as Record<string, unknown>;
    if (parsed.data.action !== undefined) updates.action = parsed.data.action as typeof automationRulesTable.$inferInsert["action"];
    if (parsed.data.emailSubject !== undefined) updates.emailSubject = parsed.data.emailSubject ?? null;
    if (parsed.data.emailBody !== undefined) updates.emailBody = parsed.data.emailBody ?? null;
    if (parsed.data.smsBody !== undefined) updates.smsBody = parsed.data.smsBody ?? null;
    if ("voucherCode" in parsed.data) updates.voucherCode = (parsed.data as { voucherCode?: string | null }).voucherCode ?? null;

    const [updated] = await db
      .update(automationRulesTable)
      .set(updates)
      .where(eq(automationRulesTable.id, existing.id))
      .returning();

    res.json(updated);
  } catch (err) { next(err); }
});

router.delete("/growth/automations/:automationId", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const [existing] = await db
      .select({ id: automationRulesTable.id })
      .from(automationRulesTable)
      .where(and(eq(automationRulesTable.id, req.params["automationId"]!), eq(automationRulesTable.salonId, ctx.salon.id)))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Automation not found.", code: "NOT_FOUND" }); return; }

    await db.delete(automationRulesTable).where(eq(automationRulesTable.id, existing.id));
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// AUTOMATIONS — Activate / Pause
// ---------------------------------------------------------------------------

router.post("/growth/automations/:automationId/activate", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const [updated] = await db
      .update(automationRulesTable)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(automationRulesTable.id, req.params["automationId"]!), eq(automationRulesTable.salonId, ctx.salon.id)))
      .returning();

    if (!updated) { res.status(404).json({ error: "Automation not found.", code: "NOT_FOUND" }); return; }
    res.json(updated);
  } catch (err) { next(err); }
});

router.post("/growth/automations/:automationId/pause", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const [updated] = await db
      .update(automationRulesTable)
      .set({ status: "paused", updatedAt: new Date() })
      .where(and(eq(automationRulesTable.id, req.params["automationId"]!), eq(automationRulesTable.salonId, ctx.salon.id)))
      .returning();

    if (!updated) { res.status(404).json({ error: "Automation not found.", code: "NOT_FOUND" }); return; }
    res.json(updated);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// AUTOMATIONS — Stats
// ---------------------------------------------------------------------------

router.get("/growth/automations/:automationId/stats", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const [rule] = await db
      .select({ id: automationRulesTable.id })
      .from(automationRulesTable)
      .where(and(eq(automationRulesTable.id, req.params["automationId"]!), eq(automationRulesTable.salonId, ctx.salon.id)))
      .limit(1);
    if (!rule) { res.status(404).json({ error: "Automation not found.", code: "NOT_FOUND" }); return; }

    const [stats] = await db
      .select({
        totalRuns: sql<number>`count(*)::int`,
        sentCount: sql<number>`sum(case when ${automationRunsTable.status} = 'sent' then 1 else 0 end)::int`,
        skippedCount: sql<number>`sum(case when ${automationRunsTable.status} = 'skipped' then 1 else 0 end)::int`,
        failedCount: sql<number>`sum(case when ${automationRunsTable.status} = 'failed' then 1 else 0 end)::int`,
        attributedAppointments: sql<number>`sum(case when ${automationRunsTable.attributedAppointmentId} is not null then 1 else 0 end)::int`,
        lastRunAt: sql<string | null>`max(${automationRunsTable.executedAt})`,
      })
      .from(automationRunsTable)
      .where(eq(automationRunsTable.ruleId, rule.id));

    // Delivery stats (delivered / opened from provider webhooks)
    const [deliveryStats] = await db
      .select({
        deliveredCount: sql<number>`sum(case when ${automationDeliveriesTable.deliveredAt} is not null then 1 else 0 end)::int`,
        openedCount: sql<number>`sum(case when ${automationDeliveriesTable.openedAt} is not null then 1 else 0 end)::int`,
      })
      .from(automationDeliveriesTable)
      .innerJoin(automationRunsTable, eq(automationRunsTable.id, automationDeliveriesTable.runId))
      .where(eq(automationRunsTable.ruleId, rule.id));

    res.json({
      ruleId: rule.id,
      totalRuns: stats?.totalRuns ?? 0,
      sentCount: stats?.sentCount ?? 0,
      skippedCount: stats?.skippedCount ?? 0,
      failedCount: stats?.failedCount ?? 0,
      attributedAppointments: stats?.attributedAppointments ?? 0,
      deliveredCount: deliveryStats?.deliveredCount ?? 0,
      openedCount: deliveryStats?.openedCount ?? 0,
      lastRunAt: stats?.lastRunAt ?? null,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// AUTOMATIONS — Real dry-run (uses actual trigger evaluator)
// ---------------------------------------------------------------------------

router.post("/growth/automations/:automationId/test-run", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const [rule] = await db
      .select()
      .from(automationRulesTable)
      .where(and(eq(automationRulesTable.id, req.params["automationId"]!), eq(automationRulesTable.salonId, ctx.salon.id)))
      .limit(1);
    if (!rule) { res.status(404).json({ error: "Automation not found.", code: "NOT_FOUND" }); return; }

    const result = await dryRunAutomationRule(rule);
    res.json(result);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PACKAGES — Owner CRUD
// ---------------------------------------------------------------------------

async function loadPackageWithServiceIds(packageId: string): Promise<{
  id: string; salonId: string; name: string; description: string;
  priceInDinars: number; sessionCount: number; validityDays: number;
  active: boolean; serviceIds: string[]; createdAt: Date; updatedAt: Date;
} | null> {
  const [pkg] = await db
    .select()
    .from(treatmentPackagesTable)
    .where(eq(treatmentPackagesTable.id, packageId))
    .limit(1);
  if (!pkg) return null;

  const links = await db
    .select({ serviceId: packageServiceLinksTable.serviceId })
    .from(packageServiceLinksTable)
    .where(eq(packageServiceLinksTable.packageId, packageId));

  return { ...pkg, serviceIds: links.map((l) => l.serviceId) };
}

router.get("/growth/packages", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const packages = await db
      .select()
      .from(treatmentPackagesTable)
      .where(eq(treatmentPackagesTable.salonId, ctx.salon.id))
      .orderBy(desc(treatmentPackagesTable.createdAt));

    const result = await Promise.all(
      packages.map(async (pkg) => {
        const links = await db
          .select({ serviceId: packageServiceLinksTable.serviceId })
          .from(packageServiceLinksTable)
          .where(eq(packageServiceLinksTable.packageId, pkg.id));
        return { ...pkg, serviceIds: links.map((l) => l.serviceId) };
      }),
    );

    res.json(result);
  } catch (err) { next(err); }
});

router.post("/growth/packages", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const parsed = OwnerCreatePackageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error.", code: "VALIDATION_ERROR", issues: parsed.error.issues });
      return;
    }
    const { name, description, priceInDinars, sessionCount, validityDays, active, serviceIds } = parsed.data;

    // Atomically validate all service IDs BEFORE inserting the package
    if (serviceIds && serviceIds.length > 0) {
      const validServices = await db
        .select({ id: servicesTable.id })
        .from(servicesTable)
        .where(and(inArray(servicesTable.id, serviceIds), eq(servicesTable.salonId, ctx.salon.id)));
      const validIds = new Set(validServices.map((s) => s.id));
      const invalid = serviceIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        res.status(400).json({
          error: "Some service IDs are invalid or do not belong to this salon.",
          code: "INVALID_SERVICE_IDS",
          invalidIds: invalid,
        });
        return;
      }
    }

    const result = await db.transaction(async (tx) => {
      const [pkg] = await tx.insert(treatmentPackagesTable).values({
        salonId: ctx.salon.id,
        name,
        description: description ?? "",
        priceInDinars,
        sessionCount,
        validityDays: validityDays ?? 365,
        active: active ?? true,
      }).returning();

      if (!pkg) throw new Error("Package insert failed");

      if (serviceIds && serviceIds.length > 0) {
        await tx.insert(packageServiceLinksTable).values(
          serviceIds.map((serviceId) => ({ packageId: pkg.id, serviceId })),
        );
      }

      return pkg;
    });

    const full = await loadPackageWithServiceIds(result.id);
    res.status(201).json(full);
  } catch (err) { next(err); }
});

router.get("/growth/packages/public", async (req, res, next) => {
  try {
    const { salonId } = req.query as { salonId?: string };
    if (!salonId) { res.status(400).json({ error: "salonId required.", code: "VALIDATION_ERROR" }); return; }

    const packages = await db
      .select()
      .from(treatmentPackagesTable)
      .where(and(eq(treatmentPackagesTable.salonId, salonId), eq(treatmentPackagesTable.active, true)));

    const result = await Promise.all(
      packages.map(async (pkg) => {
        const links = await db
          .select({ serviceId: packageServiceLinksTable.serviceId })
          .from(packageServiceLinksTable)
          .where(eq(packageServiceLinksTable.packageId, pkg.id));
        return {
          id: pkg.id,
          salonId: pkg.salonId,
          name: pkg.name,
          description: pkg.description,
          priceInDinars: pkg.priceInDinars,
          sessionCount: pkg.sessionCount,
          validityDays: pkg.validityDays,
          serviceIds: links.map((l) => l.serviceId),
        };
      }),
    );

    res.json(result);
  } catch (err) { next(err); }
});

router.get("/growth/packages/:packageId", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const pkg = await loadPackageWithServiceIds(req.params["packageId"]!);
    if (!pkg || pkg.salonId !== ctx.salon.id) {
      res.status(404).json({ error: "Package not found.", code: "NOT_FOUND" }); return;
    }
    res.json(pkg);
  } catch (err) { next(err); }
});

router.patch("/growth/packages/:packageId", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const [existing] = await db
      .select()
      .from(treatmentPackagesTable)
      .where(and(eq(treatmentPackagesTable.id, req.params["packageId"]!), eq(treatmentPackagesTable.salonId, ctx.salon.id)))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Package not found.", code: "NOT_FOUND" }); return; }

    const parsed = OwnerUpdatePackageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error.", code: "VALIDATION_ERROR", issues: parsed.error.issues });
      return;
    }

    // Validate service IDs before any mutations
    if (parsed.data.serviceIds !== undefined && parsed.data.serviceIds.length > 0) {
      const validServices = await db
        .select({ id: servicesTable.id })
        .from(servicesTable)
        .where(and(inArray(servicesTable.id, parsed.data.serviceIds), eq(servicesTable.salonId, ctx.salon.id)));
      const validIds = new Set(validServices.map((s) => s.id));
      const invalid = parsed.data.serviceIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        res.status(400).json({
          error: "Some service IDs are invalid or do not belong to this salon.",
          code: "INVALID_SERVICE_IDS",
          invalidIds: invalid,
        });
        return;
      }
    }

    const updates: Partial<typeof treatmentPackagesTable.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description ?? "";
    if (parsed.data.priceInDinars !== undefined) updates.priceInDinars = parsed.data.priceInDinars;
    if (parsed.data.sessionCount !== undefined) updates.sessionCount = parsed.data.sessionCount;
    if (parsed.data.validityDays !== undefined) updates.validityDays = parsed.data.validityDays;
    if (parsed.data.active !== undefined) updates.active = parsed.data.active;

    await db.transaction(async (tx) => {
      // Acquire the SAME package row lock a concurrent purchase snapshot takes,
      // so a serviceIds replacement cannot interleave with a purchase read.
      // The purchase transaction will observe either the old or the new link
      // set in full — never a mixed/stale coverage set.
      await tx
        .select({ id: treatmentPackagesTable.id })
        .from(treatmentPackagesTable)
        .where(eq(treatmentPackagesTable.id, existing.id))
        .for("update")
        .limit(1);

      await tx.update(treatmentPackagesTable).set(updates).where(eq(treatmentPackagesTable.id, existing.id));

      if (parsed.data.serviceIds !== undefined) {
        await tx.delete(packageServiceLinksTable).where(eq(packageServiceLinksTable.packageId, existing.id));
        if (parsed.data.serviceIds.length > 0) {
          await tx.insert(packageServiceLinksTable).values(
            parsed.data.serviceIds.map((serviceId) => ({ packageId: existing.id, serviceId })),
          );
        }
      }
    });

    const result = await loadPackageWithServiceIds(existing.id);
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * DELETE /growth/packages/:packageId
 * Soft-deactivates the package rather than hard-deleting, preserving purchase history.
 */
router.delete("/growth/packages/:packageId", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const [updated] = await db
      .update(treatmentPackagesTable)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(treatmentPackagesTable.id, req.params["packageId"]!), eq(treatmentPackagesTable.salonId, ctx.salon.id)))
      .returning({ id: treatmentPackagesTable.id });

    if (!updated) { res.status(404).json({ error: "Package not found.", code: "NOT_FOUND" }); return; }
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PACKAGES — Purchase (customer, strict IDOR protection)
// ---------------------------------------------------------------------------

/**
 * POST /growth/packages/:packageId/purchases
 * CUSTOMER role only. salonCustomerId is NEVER accepted from body —
 * it is always derived from the authenticated user's own salonCustomer record.
 */
router.post("/growth/packages/:packageId/purchases", async (req, res, next) => {
  try {
    const user = await getCurrentUser(req);
    if (!user) { res.status(401).json({ error: "Authentication required.", code: "UNAUTHORIZED" }); return; }

    // CUSTOMER role only. Enforce BEFORE any CRM identity resolution or purchase
    // creation so a salon owner/employee/admin/education owner can never create
    // a salon_customer or purchase row by hitting this endpoint.
    if (user.role !== "CUSTOMER") {
      res.status(403).json({ error: "Only customers can purchase packages.", code: "FORBIDDEN" });
      return;
    }

    // Read the package outside the tx only for existence/salon resolution and
    // body validation ordering; the authoritative snapshot is taken under a row
    // lock inside the transaction below.
    const [pkgPreview] = await db
      .select({ salonId: treatmentPackagesTable.salonId })
      .from(treatmentPackagesTable)
      .where(eq(treatmentPackagesTable.id, req.params["packageId"]!))
      .limit(1);
    if (!pkgPreview) { res.status(404).json({ error: "Package not found.", code: "NOT_FOUND" }); return; }

    // Resolve the authenticated user's salonCustomer record — creating one from
    // their own identity if none exists. Identity is NEVER taken from the body.
    const salonCustomer = await resolveOrCreateSalonCustomer(user, pkgPreview.salonId);
    if (!salonCustomer) {
      res.status(500).json({ error: "Could not resolve customer record.", code: "INTERNAL" });
      return;
    }

    const parsed = CustomerPurchasePackageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error.", code: "VALIDATION_ERROR", issues: parsed.error.issues });
      return;
    }

    const paymentMethod = (parsed.data as { paymentMethod?: string }).paymentMethod ?? "pay_at_salon";

    // Serialize the snapshot with concurrent package definition edits: open the
    // transaction first, lock the package row FOR UPDATE, verify it is still
    // active, read the current service links under the same lock, then insert
    // the purchase + snapshot. A concurrent definition update that acquires the
    // SAME row lock cannot interleave, so the snapshot is always a coherent
    // old-or-new coverage set — never mixed/stale.
    const result = await db.transaction(async (tx) => {
      const [pkg] = await tx
        .select()
        .from(treatmentPackagesTable)
        .where(eq(treatmentPackagesTable.id, req.params["packageId"]!))
        .for("update")
        .limit(1);
      if (!pkg) return { error: "not_found" as const };
      if (!pkg.active) return { error: "inactive" as const };

      // Read covered services under the same row lock.
      const currentServiceLinks = await tx
        .select({ serviceId: packageServiceLinksTable.serviceId })
        .from(packageServiceLinksTable)
        .where(eq(packageServiceLinksTable.packageId, pkg.id));

      const expiresAt = new Date(Date.now() + pkg.validityDays * 86_400_000);

      const [p] = await tx.insert(customerPackagePurchasesTable).values({
        salonId: pkg.salonId,
        packageId: pkg.id,
        salonCustomerId: salonCustomer.id, // always from auth, never from body
        totalSessions: pkg.sessionCount,
        remainingSessions: pkg.sessionCount,
        priceInDinars: pkg.priceInDinars,
        paymentMethod: paymentMethod as typeof customerPackagePurchasesTable.$inferInsert["paymentMethod"],
        status: "pending_payment",
        expiresAt,
        notes: (parsed.data as { notes?: string }).notes ?? null,
      }).returning();
      if (!p) throw new Error("Purchase insert returned no row");

      // Snapshot: copy covered services for this purchase. Empty is allowed
      // (but redemption will fail service_not_covered — fail-safe).
      if (currentServiceLinks.length > 0) {
        await tx.insert(packagePurchaseServiceLinksTable).values(
          currentServiceLinks.map((l) => ({ purchaseId: p.id, serviceId: l.serviceId })),
        );
      }

      return { purchase: p, packageName: pkg.name };
    });

    if ("error" in result) {
      if (result.error === "not_found") { res.status(404).json({ error: "Package not found.", code: "NOT_FOUND" }); return; }
      res.status(409).json({ error: "Package is no longer available for purchase.", code: "PACKAGE_INACTIVE" }); return;
    }

    res.status(201).json({ ...result.purchase, packageName: result.packageName });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PACKAGES — Confirm payment (owner, idempotent)
// ---------------------------------------------------------------------------

router.post("/growth/packages/:packageId/purchases/:purchaseId/confirm-payment", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const [purchase] = await db
      .select()
      .from(customerPackagePurchasesTable)
      .where(and(
        eq(customerPackagePurchasesTable.id, req.params["purchaseId"]!),
        eq(customerPackagePurchasesTable.packageId, req.params["packageId"]!),
        eq(customerPackagePurchasesTable.salonId, ctx.salon.id),
      ))
      .limit(1);

    if (!purchase) { res.status(404).json({ error: "Purchase not found.", code: "NOT_FOUND" }); return; }

    // Idempotent: already confirmed → return as-is
    if (purchase.status === "active") {
      const [pkg] = await db.select({ name: treatmentPackagesTable.name }).from(treatmentPackagesTable).where(eq(treatmentPackagesTable.id, purchase.packageId)).limit(1);
      res.json({ ...purchase, packageName: pkg?.name ?? "" });
      return;
    }

    if (purchase.status !== "pending_payment") {
      res.status(400).json({ error: `Purchase status is '${purchase.status}', cannot confirm.`, code: "INVALID_STATUS" });
      return;
    }

    const [updated] = await db
      .update(customerPackagePurchasesTable)
      .set({ status: "active", paymentConfirmedAt: new Date(), paymentConfirmedByUserId: ctx.user.id, updatedAt: new Date() })
      .where(eq(customerPackagePurchasesTable.id, purchase.id))
      .returning();

    const [pkg] = await db.select({ name: treatmentPackagesTable.name }).from(treatmentPackagesTable).where(eq(treatmentPackagesTable.id, purchase.packageId)).limit(1);
    res.json({ ...updated, packageName: pkg?.name ?? "" });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PACKAGES — Customer purchases (list own)
// ---------------------------------------------------------------------------

router.get("/growth/my-purchases", async (req, res, next) => {
  try {
    const user = await getCurrentUser(req);
    if (!user) { res.status(401).json({ error: "Authentication required.", code: "UNAUTHORIZED" }); return; }

    const customerRecords = await db
      .select({ id: salonCustomersTable.id })
      .from(salonCustomersTable)
      .where(eq(salonCustomersTable.userId, user.id));

    if (!customerRecords.length) { res.json([]); return; }

    const customerIds = customerRecords.map((c) => c.id);
    const purchases = await db
      .select()
      .from(customerPackagePurchasesTable)
      .where(inArray(customerPackagePurchasesTable.salonCustomerId, customerIds))
      .orderBy(desc(customerPackagePurchasesTable.createdAt));

    const packageIds = [...new Set(purchases.map((p) => p.packageId))];
    const packages = packageIds.length > 0
      ? await db.select({ id: treatmentPackagesTable.id, name: treatmentPackagesTable.name }).from(treatmentPackagesTable).where(inArray(treatmentPackagesTable.id, packageIds))
      : [];
    const packageNameMap = new Map(packages.map((p) => [p.id, p.name]));

    res.json(purchases.map((p) => ({ ...p, packageName: packageNameMap.get(p.packageId) ?? "" })));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PACKAGES — Redeem session (customer, derives salonCustomerId from auth)
// ---------------------------------------------------------------------------

router.post("/growth/my-purchases/:purchaseId/redeem", async (req, res, next) => {
  try {
    const user = await getCurrentUser(req);
    if (!user) { res.status(401).json({ error: "Authentication required.", code: "UNAUTHORIZED" }); return; }

    const parsed = CustomerRedeemPackageSessionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error.", code: "VALIDATION_ERROR", issues: parsed.error.issues });
      return;
    }

    const [purchase] = await db
      .select()
      .from(customerPackagePurchasesTable)
      .where(eq(customerPackagePurchasesTable.id, req.params["purchaseId"]!))
      .limit(1);
    if (!purchase) { res.status(404).json({ error: "Purchase not found.", code: "NOT_FOUND" }); return; }

    // Strict ownership: the purchase's salonCustomer must belong to the authenticated user
    const [customerRecord] = await db
      .select({ id: salonCustomersTable.id })
      .from(salonCustomersTable)
      .where(and(eq(salonCustomersTable.id, purchase.salonCustomerId), eq(salonCustomersTable.userId, user.id)))
      .limit(1);
    if (!customerRecord) { res.status(403).json({ error: "Access denied.", code: "FORBIDDEN" }); return; }

    const result = await redeemPackageSession({
      purchaseId: purchase.id,
      appointmentId: parsed.data.appointmentId,
      salonId: purchase.salonId,
      requestingCustomerId: purchase.salonCustomerId,
    });

    if (!result.ok) {
      // Stable package-error contract, consistent with appointment creation:
      // { code:'PACKAGE_ERROR', reason:<RedeemResult reason>, error:<localized> }.
      const messages: Record<string, string> = {
        not_found: "Izabrani paket nije pronađen.",
        wrong_salon: "Paket ne pripada ovom salonu.",
        wrong_customer: "Paket ne pripada vama.",
        already_redeemed: "Ovaj termin je već iskorišćen iz paketa.",
        no_sessions_left: "Paket nema više dostupnih tretmana.",
        expired: "Paket je istekao.",
        not_active: "Paket nije aktivan.",
        service_not_covered: "Izabrana usluga nije obuhvaćena ovim paketom.",
        appointment_not_eligible: "Termin nije prihvatljiv za iskorišćavanje paketa.",
      };
      // Ownership/existence failures keep their specific 4xx status; all other
      // redemption failures (including lifecycle ineligibility) are 409.
      const statusMap: Record<string, number> = {
        not_found: 404, wrong_salon: 403, wrong_customer: 403,
        already_redeemed: 409, no_sessions_left: 409, expired: 409,
        not_active: 409, service_not_covered: 409, appointment_not_eligible: 409,
      };
      res.status(statusMap[result.reason] ?? 409).json({
        code: "PACKAGE_ERROR",
        reason: result.reason,
        error: messages[result.reason] ?? "Iskorišćavanje paketa nije uspelo.",
      });
      return;
    }

    res.json({ redemptionId: result.redemptionId, remainingSessions: result.remainingSessions, purchaseId: purchase.id });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PACKAGES — Owner: reverse a redemption
// ---------------------------------------------------------------------------

router.post("/growth/redemptions/:redemptionId/reverse", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const result = await reversePackageRedemption({
      redemptionId: req.params["redemptionId"]!,
      salonId: ctx.salon.id,
      reversedByUserId: ctx.user.id,
    });

    if (!result.ok) {
      const statusMap: Record<string, number> = { not_found: 404, wrong_salon: 403, already_reversed: 409 };
      res.status(statusMap[result.reason] ?? 400).json({ error: result.reason, code: result.reason.toUpperCase() });
      return;
    }

    res.json({ remainingSessions: result.remainingSessions });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PACKAGES — Owner: list customer packages
// ---------------------------------------------------------------------------

router.get("/growth/salon-customer-packages", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const { salonCustomerId, status } = req.query as { salonCustomerId?: string; status?: string };

    const conditions: ReturnType<typeof eq>[] = [eq(customerPackagePurchasesTable.salonId, ctx.salon.id) as ReturnType<typeof eq>];
    if (salonCustomerId) conditions.push(eq(customerPackagePurchasesTable.salonCustomerId, salonCustomerId) as ReturnType<typeof eq>);
    if (status) conditions.push(eq(customerPackagePurchasesTable.status, status as typeof customerPackagePurchasesTable.$inferSelect["status"]) as ReturnType<typeof eq>);

    const purchases = await db
      .select()
      .from(customerPackagePurchasesTable)
      .where(and(...conditions))
      .orderBy(desc(customerPackagePurchasesTable.createdAt));

    const packageIds = [...new Set(purchases.map((p) => p.packageId))];
    const packages = packageIds.length > 0
      ? await db.select({ id: treatmentPackagesTable.id, name: treatmentPackagesTable.name }).from(treatmentPackagesTable).where(inArray(treatmentPackagesTable.id, packageIds))
      : [];
    const packageNameMap = new Map(packages.map((p) => [p.id, p.name]));

    res.json(purchases.map((p) => ({ ...p, packageName: packageNameMap.get(p.packageId) ?? "" })));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// EMPLOYEE PERFORMANCE
// ---------------------------------------------------------------------------

/** GET /growth/employees/performance — Owner sees all active employees */
router.get("/growth/employees/performance", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const { from, to } = req.query as { from?: string; to?: string };
    const metrics = await getEmployeePerformance({ salonId: ctx.salon.id, from, to });
    res.json(metrics);
  } catch (err) { next(err); }
});

/** PATCH /growth/employees/:employeeId/commission — Owner sets commission for any employee */
router.patch("/growth/employees/:employeeId/commission", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const parsed = OwnerUpdateEmployeeCommissionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error.", code: "VALIDATION_ERROR", issues: parsed.error.issues });
      return;
    }

    const [employee] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(and(eq(employeesTable.id, req.params["employeeId"]!), eq(employeesTable.salonId, ctx.salon.id)))
      .limit(1);
    if (!employee) { res.status(404).json({ error: "Employee not found.", code: "NOT_FOUND" }); return; }

    const data = parsed.data as {
      commissionType?: string;
      commissionPercent?: number;
      fixedAmountInDinars?: number;
      perServiceOverrides?: Record<string, number>;
    };

    const commissionType = (data.commissionType ?? "percent_of_revenue") as typeof employeeCommissionSettingsTable.$inferInsert["commissionType"];
    const commissionPercent = data.commissionPercent ?? 0;
    const fixedAmountInDinars = data.fixedAmountInDinars ?? 0;

    if (commissionType === "percent_of_revenue" && (commissionPercent < 0 || commissionPercent > 100)) {
      res.status(400).json({ error: "commissionPercent must be 0–100.", code: "VALIDATION_ERROR" }); return;
    }
    if (commissionType === "fixed_per_treatment" && fixedAmountInDinars < 0) {
      res.status(400).json({ error: "fixedAmountInDinars must be ≥ 0.", code: "VALIDATION_ERROR" }); return;
    }

    // Validate perServiceOverrides: each value must satisfy the same numeric
    // constraint as the base setting (0–100 for percent, ≥ 0 for fixed).
    const overrides = (data.perServiceOverrides ?? {}) as Record<string, number>;
    for (const [svcId, val] of Object.entries(overrides)) {
      if (typeof val !== "number" || !isFinite(val)) {
        res.status(400).json({ error: `perServiceOverrides["${svcId}"] must be a finite number.`, code: "VALIDATION_ERROR" }); return;
      }
      if (commissionType === "percent_of_revenue" && (val < 0 || val > 100)) {
        res.status(400).json({ error: `perServiceOverrides["${svcId}"] must be 0–100 for percent_of_revenue.`, code: "VALIDATION_ERROR" }); return;
      }
      if (commissionType === "fixed_per_treatment" && val < 0) {
        res.status(400).json({ error: `perServiceOverrides["${svcId}"] must be ≥ 0 for fixed_per_treatment.`, code: "VALIDATION_ERROR" }); return;
      }
    }

    const [result] = await db
      .insert(employeeCommissionSettingsTable)
      .values({
        salonId: ctx.salon.id,
        employeeId: employee.id,
        commissionType,
        commissionPercent,
        fixedAmountInDinars,
        perServiceOverrides: overrides,
        updatedByUserId: ctx.user.id,
      })
      .onConflictDoUpdate({
        target: [employeeCommissionSettingsTable.employeeId],
        set: {
          commissionType,
          commissionPercent,
          fixedAmountInDinars,
          perServiceOverrides: overrides,
          updatedByUserId: ctx.user.id,
          updatedAt: new Date(),
        },
      })
      .returning();

    res.json(result);
  } catch (err) { next(err); }
});

/** GET /growth/my-performance — Employee sees only their own data */
router.get("/growth/my-performance", async (req, res, next) => {
  try {
    const ctx = await requireEmployee(req);
    if (!ctx) { res.status(403).json({ error: "Employee access required.", code: "FORBIDDEN" }); return; }

    const { from, to } = req.query as { from?: string; to?: string };
    const [metrics] = await getEmployeePerformance({
      salonId: ctx.employee.salonId,
      employeeId: ctx.employee.id,
      from,
      to,
    });

    if (!metrics) { res.status(404).json({ error: "Employee performance not found.", code: "NOT_FOUND" }); return; }
    res.json(metrics);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// AI GROWTH ADVISOR
// ---------------------------------------------------------------------------

router.post("/growth/ai/ask", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const parsed = OwnerAskGrowthAiBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error.", code: "VALIDATION_ERROR", issues: parsed.error.issues });
      return;
    }

    try {
      const result = await askGrowthAi({
        salonId: ctx.salon.id,
        question: parsed.data.question,
        snapshotPeriodDays: parsed.data.snapshotPeriodDays ?? undefined,
      });
      res.json(result);
    } catch (aiErr) {
      req.log.error({ err: aiErr }, "AI growth advisor call failed");
      res.status(502).json({ error: "AI provider unavailable. Please try again later.", code: "AI_PROVIDER_ERROR" });
    }
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// ADMIN READ-ONLY SUMMARY
// ---------------------------------------------------------------------------

router.get("/growth/admin/summary", async (req, res, next) => {
  try {
    const user = await getCurrentUser(req);
    if (!user || user.role !== "ADMIN") {
      res.status(403).json({ error: "Admin access required.", code: "FORBIDDEN" }); return;
    }

    const [automationStats] = await db
      .select({
        totalRules: sql<number>`count(*)::int`,
        activeRules: sql<number>`sum(case when ${automationRulesTable.status} = 'active' then 1 else 0 end)::int`,
      })
      .from(automationRulesTable);

    const [packageStats] = await db
      .select({
        totalPackages: sql<number>`count(*)::int`,
        activePackages: sql<number>`sum(case when ${treatmentPackagesTable.active} = true then 1 else 0 end)::int`,
      })
      .from(treatmentPackagesTable);

    const [purchaseStats] = await db
      .select({
        totalPurchases: sql<number>`count(*)::int`,
        activePurchases: sql<number>`sum(case when ${customerPackagePurchasesTable.status} = 'active' then 1 else 0 end)::int`,
        pendingPurchases: sql<number>`sum(case when ${customerPackagePurchasesTable.status} = 'pending_payment' then 1 else 0 end)::int`,
      })
      .from(customerPackagePurchasesTable);

    const byStatus = await db
      .select({
        status: automationRulesTable.status,
        cnt: sql<number>`count(*)::int`,
      })
      .from(automationRulesTable)
      .groupBy(automationRulesTable.status);

    res.json({
      automation: {
        totalRules: automationStats?.totalRules ?? 0,
        activeRules: automationStats?.activeRules ?? 0,
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.cnt])),
      },
      packages: {
        total: packageStats?.totalPackages ?? 0,
        active: packageStats?.activePackages ?? 0,
      },
      purchases: {
        total: purchaseStats?.totalPurchases ?? 0,
        active: purchaseStats?.activePurchases ?? 0,
        pendingPayment: purchaseStats?.pendingPurchases ?? 0,
      },
    });
  } catch (err) { next(err); }
});

export default router;
