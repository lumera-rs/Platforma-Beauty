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
import { and, desc, eq, gte, inArray, isNull, lte, ne, notInArray, sql, type SQL } from "drizzle-orm";
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
  AdminUpdateRetentionSettingsBody,
  AdminPreviewRetentionSettingsBody,
} from "@workspace/api-zod";
import { getCurrentUser, isAdmin } from "../lib/auth";
import {
  classifyRetention,
  computeSalonMedianSpend,
  DEFAULT_RETENTION_THRESHOLDS,
} from "../lib/retention-classification";
import {
  getActiveRetentionSettings,
  getRetentionSettingsHistory,
  previewRetentionThresholds,
  RetentionNoOpRestoreError,
  RetentionRestoreError,
  updateRetentionSettings,
  validateRetentionThresholds,
} from "../lib/retention-settings";
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
    const salonMedianSpend = computeSalonMedianSpend(
      allAppts.filter((a) => a.status === "completed").map((a) => a.price),
    );

    const apptsByCustomer = new Map<string, typeof allAppts>();
    for (const a of allAppts) {
      if (!a.salonCustomerId) continue;
      const arr = apptsByCustomer.get(a.salonCustomerId) ?? [];
      arr.push(a);
      apptsByCustomer.set(a.salonCustomerId, arr);
    }

    const activeSettings = await getActiveRetentionSettings();

    const result = customers.map((c) => {
      const appts = apptsByCustomer.get(c.id) ?? [];
      const r = classifyRetention({
        appointments: appts.map((a) => ({
          date: a.date,
          status: a.status as "pending" | "confirmed" | "completed" | "cancelled" | "no-show",
          price: a.price,
        })),
        salonMedianSpend,
        thresholds: activeSettings.thresholds,
      });
      return {
        thresholdVersion: activeSettings.version,
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
      .orderBy(desc(appointmentsTable.date));

    // Classification must see the FULL history (matching the list endpoint);
    // only the appointments returned to the UI are capped.
    const recentAppts = appts.slice(0, 50);

    const serviceIds = [...new Set(recentAppts.map((a) => a.serviceId))];
    const services = serviceIds.length > 0
      ? await db.select({ id: servicesTable.id, name: servicesTable.name }).from(servicesTable).where(inArray(servicesTable.id, serviceIds))
      : [];
    const serviceNameMap = new Map(services.map((s) => [s.id, s.name]));

    // Same salon-wide median as the retention LIST endpoint, so list and
    // detail always agree on VIP-by-spend classification.
    const salonSpendRows = await db
      .select({ price: appointmentsTable.price })
      .from(appointmentsTable)
      .where(and(eq(appointmentsTable.salonId, ctx.salon.id), eq(appointmentsTable.status, "completed")));
    const salonMedianSpend = computeSalonMedianSpend(salonSpendRows.map((row) => row.price));

    const activeSettings = await getActiveRetentionSettings();
    const r = classifyRetention({
      appointments: appts.map((a) => ({
        date: a.date,
        status: a.status as "pending" | "confirmed" | "completed" | "cancelled" | "no-show",
        price: a.price,
      })),
      salonMedianSpend,
      thresholds: activeSettings.thresholds,
    });

    res.json({
      thresholdVersion: activeSettings.version,
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
      recentAppointments: recentAppts.map((a) => ({
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

const STATS_PERIOD_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

const STATS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Time window for stats aggregation. `start` is inclusive, `end` exclusive;
 * either may be null for an open-ended side. Both null = all time.
 */
type StatsWindow = { start: Date | null; end: Date | null };

function parseStatsDate(raw: string): Date | null {
  if (!STATS_DATE_RE.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  // V8 rolls over impossible calendar dates (2026-02-30 → March 2), so a
  // round-trip comparison is required to reject them explicitly.
  return date.toISOString().slice(0, 10) === raw ? date : null;
}

/**
 * Parse the optional ?period= / ?from= / ?to= window for stats endpoints.
 * - `period` selects a rolling window (7d/30d/90d) or all time.
 * - `from`/`to` (YYYY-MM-DD, inclusive) select an exact calendar range; either
 *   side may be omitted for an open-ended range.
 * Combining `period` with `from`/`to` is ambiguous and rejected explicitly,
 * as are malformed dates and inverted ranges (from > to).
 * Returns the window, or an error message for a 400 response.
 */
function parseStatsWindow(query: Record<string, unknown>): { window: StatsWindow } | { error: string } {
  const period = query["period"];
  const from = query["from"];
  const to = query["to"];
  const hasRange = from !== undefined || to !== undefined;

  if (hasRange) {
    if (period !== undefined) {
      return { error: "Cannot combine period with from/to. Use either a preset period or a custom date range." };
    }
    if (from !== undefined && (typeof from !== "string" || parseStatsDate(from) === null)) {
      return { error: "Invalid from date. Expected YYYY-MM-DD." };
    }
    if (to !== undefined && (typeof to !== "string" || parseStatsDate(to) === null)) {
      return { error: "Invalid to date. Expected YYYY-MM-DD." };
    }
    const start = from !== undefined ? parseStatsDate(from as string) : null;
    const toDate = to !== undefined ? parseStatsDate(to as string) : null;
    if (start && toDate && start.getTime() > toDate.getTime()) {
      return { error: "Invalid range: from must be on or before to." };
    }
    // `to` is inclusive → exclusive end is the start of the following day.
    const end = toDate ? new Date(toDate.getTime() + 24 * 60 * 60 * 1000) : null;
    return { window: { start, end } };
  }

  if (period === undefined || period === "all") return { window: { start: null, end: null } };
  if (typeof period !== "string" || STATS_PERIOD_DAYS[period] === undefined) {
    return { error: "Invalid period. Expected one of: 7d, 30d, 90d, all." };
  }
  return { window: { start: new Date(Date.now() - STATS_PERIOD_DAYS[period]! * 24 * 60 * 60 * 1000), end: null } };
}

/**
 * Window filters for stats aggregation. Runs are windowed on executedAt and
 * deliveries on sentAt; both fall back to createdAt so pending/queued/failed
 * rows (which never got their execution/send timestamp) stay attributable to
 * the window in which they were created instead of silently disappearing.
 * Returns undefined for an all-time window (drizzle's and() drops it).
 */
function statsWindowCondition(timestamp: SQL, window: StatsWindow) {
  const parts: SQL[] = [];
  if (window.start) parts.push(sql`${timestamp} >= ${window.start}`);
  if (window.end) parts.push(sql`${timestamp} < ${window.end}`);
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : and(...parts);
}
function statsRunPeriodCondition(window: StatsWindow) {
  return statsWindowCondition(sql`coalesce(${automationRunsTable.executedAt}, ${automationRunsTable.createdAt})`, window);
}
function statsDeliveryPeriodCondition(window: StatsWindow) {
  return statsWindowCondition(sql`coalesce(${automationDeliveriesTable.sentAt}, ${automationDeliveriesTable.createdAt})`, window);
}

/**
 * Half-open range variants of the period conditions, used for the preceding
 * comparison window (compare=previous): [from, to) so the previous window
 * never overlaps the current one.
 */
function statsRunPeriodRangeCondition(from: Date, to: Date) {
  const ts = sql`coalesce(${automationRunsTable.executedAt}, ${automationRunsTable.createdAt})`;
  return sql`${ts} >= ${from} and ${ts} < ${to}`;
}
function statsDeliveryPeriodRangeCondition(from: Date, to: Date) {
  const ts = sql`coalesce(${automationDeliveriesTable.sentAt}, ${automationDeliveriesTable.createdAt})`;
  return sql`${ts} >= ${from} and ${ts} < ${to}`;
}

/**
 * Aggregate campaign overview: one row per automation rule of the active
 * salon, with run counts and per-channel delivery/open counts sourced from
 * the same verified provider-event data as the per-rule stats endpoint.
 */
router.get("/growth/automation-stats", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const parsedWindow = parseStatsWindow(req.query);
    if ("error" in parsedWindow) {
      res.status(400).json({ error: parsedWindow.error, code: "VALIDATION" });
      return;
    }
    const { window } = parsedWindow;

    const compareRaw = req.query["compare"];
    if (compareRaw !== undefined && compareRaw !== "previous") {
      res.status(400).json({ error: "Invalid compare. Expected: previous.", code: "VALIDATION" });
      return;
    }
    // The preceding comparison window is only defined for the rolling presets;
    // custom from/to ranges and all-time have no canonical "previous" window yet.
    const periodDays = typeof req.query["period"] === "string" ? STATS_PERIOD_DAYS[req.query["period"]] : undefined;
    if (compareRaw === "previous" && (periodDays === undefined || !window.start)) {
      res.status(400).json({ error: "compare=previous requires a bounded period (7d, 30d, 90d).", code: "VALIDATION" });
      return;
    }
    const prevCutoff = compareRaw === "previous" && window.start && periodDays !== undefined
      ? new Date(window.start.getTime() - periodDays * 24 * 60 * 60 * 1000)
      : null;

    const rules = await db
      .select({
        id: automationRulesTable.id,
        name: automationRulesTable.name,
        status: automationRulesTable.status,
        action: automationRulesTable.action,
      })
      .from(automationRulesTable)
      .where(eq(automationRulesTable.salonId, ctx.salon.id))
      .orderBy(desc(automationRulesTable.createdAt));

    if (rules.length === 0) { res.json([]); return; }
    const ruleIds = rules.map((r) => r.id);

    const runAgg = await db
      .select({
        ruleId: automationRunsTable.ruleId,
        totalRuns: sql<number>`count(*)::int`,
        sentCount: sql<number>`sum(case when ${automationRunsTable.status} = 'sent' then 1 else 0 end)::int`,
        skippedCount: sql<number>`sum(case when ${automationRunsTable.status} = 'skipped' then 1 else 0 end)::int`,
        failedCount: sql<number>`sum(case when ${automationRunsTable.status} = 'failed' then 1 else 0 end)::int`,
        // Realized attribution only: the join below excludes cancelled and
        // no-show appointments (neither is money earned or still expected),
        // so both the count and the revenue derive from the same joined row.
        attributedAppointments: sql<number>`sum(case when ${appointmentsTable.id} is not null then 1 else 0 end)::int`,
        attributedRevenue: sql<number>`coalesce(sum(${appointmentsTable.price}), 0)::int`,
        // Completed vs upcoming split of the same joined rows. "Upcoming" is
        // the complement (joined but not completed — i.e. pending/confirmed,
        // since cancelled and no-show never join), so the two buckets always
        // sum exactly to the attributed totals above.
        completedAppointments: sql<number>`sum(case when ${appointmentsTable.status} = 'completed' then 1 else 0 end)::int`,
        completedRevenue: sql<number>`coalesce(sum(case when ${appointmentsTable.status} = 'completed' then ${appointmentsTable.price} end), 0)::int`,
        upcomingAppointments: sql<number>`sum(case when ${appointmentsTable.id} is not null and ${appointmentsTable.status} <> 'completed' then 1 else 0 end)::int`,
        upcomingRevenue: sql<number>`coalesce(sum(case when ${appointmentsTable.status} <> 'completed' then ${appointmentsTable.price} end), 0)::int`,
        lastRunAt: sql<string | null>`max(${automationRunsTable.executedAt})`,
      })
      .from(automationRunsTable)
      .leftJoin(appointmentsTable, and(
        eq(appointmentsTable.id, automationRunsTable.attributedAppointmentId),
        notInArray(appointmentsTable.status, ["cancelled", "no-show"]),
      ))
      .where(and(inArray(automationRunsTable.ruleId, ruleIds), statsRunPeriodCondition(window)))
      .groupBy(automationRunsTable.ruleId);

    const emailChannel = sql`${automationDeliveriesTable.channel} = 'email'`;
    const smsChannel = sql`${automationDeliveriesTable.channel} = 'sms'`;
    const deliveryAgg = await db
      .select({
        ruleId: automationRunsTable.ruleId,
        emailSentCount: sql<number>`sum(case when ${emailChannel} and ${automationDeliveriesTable.status} = 'sent' then 1 else 0 end)::int`,
        emailDeliveredCount: sql<number>`sum(case when ${emailChannel} and ${automationDeliveriesTable.deliveredAt} is not null then 1 else 0 end)::int`,
        emailOpenedCount: sql<number>`sum(case when ${emailChannel} and ${automationDeliveriesTable.openedAt} is not null then 1 else 0 end)::int`,
        emailFailedCount: sql<number>`sum(case when ${emailChannel} and ${automationDeliveriesTable.failedAt} is not null then 1 else 0 end)::int`,
        smsSentCount: sql<number>`sum(case when ${smsChannel} and ${automationDeliveriesTable.status} = 'sent' then 1 else 0 end)::int`,
        smsDeliveredCount: sql<number>`sum(case when ${smsChannel} and ${automationDeliveriesTable.deliveredAt} is not null then 1 else 0 end)::int`,
        smsFailedCount: sql<number>`sum(case when ${smsChannel} and ${automationDeliveriesTable.failedAt} is not null then 1 else 0 end)::int`,
      })
      .from(automationDeliveriesTable)
      .innerJoin(automationRunsTable, eq(automationRunsTable.id, automationDeliveriesTable.runId))
      .where(and(inArray(automationRunsTable.ruleId, ruleIds), statsDeliveryPeriodCondition(window)))
      .groupBy(automationRunsTable.ruleId);

    // Preceding window of the same length (compare=previous): only the counts
    // the overview renders trends for — delivered, opened, and attributed
    // appointments — aggregated over [prevCutoff, window.start).
    let prevRunsByRule: Map<string, { attributedAppointments: number }> | null = null;
    let prevDeliveriesByRule: Map<string, { emailDeliveredCount: number; emailOpenedCount: number; smsDeliveredCount: number }> | null = null;
    if (prevCutoff && window.start) {
      // Same non-cancelled join as the current-period aggregate: a cancelled
      // appointment is not campaign-earned, so it must not count in either
      // window or the trend direction would be wrong.
      const prevRunAgg = await db
        .select({
          ruleId: automationRunsTable.ruleId,
          // Same realized-attribution semantics as the current window: the
          // join excludes cancelled appointments so trend arrows compare
          // like-for-like counts.
          attributedAppointments: sql<number>`sum(case when ${appointmentsTable.id} is not null then 1 else 0 end)::int`,
        })
        .from(automationRunsTable)
        .leftJoin(appointmentsTable, and(
          eq(appointmentsTable.id, automationRunsTable.attributedAppointmentId),
          ne(appointmentsTable.status, "cancelled"),
        ))
        .where(and(inArray(automationRunsTable.ruleId, ruleIds), statsRunPeriodRangeCondition(prevCutoff, window.start)))
        .groupBy(automationRunsTable.ruleId);

      const prevDeliveryAgg = await db
        .select({
          ruleId: automationRunsTable.ruleId,
          emailDeliveredCount: sql<number>`sum(case when ${emailChannel} and ${automationDeliveriesTable.deliveredAt} is not null then 1 else 0 end)::int`,
          emailOpenedCount: sql<number>`sum(case when ${emailChannel} and ${automationDeliveriesTable.openedAt} is not null then 1 else 0 end)::int`,
          smsDeliveredCount: sql<number>`sum(case when ${smsChannel} and ${automationDeliveriesTable.deliveredAt} is not null then 1 else 0 end)::int`,
        })
        .from(automationDeliveriesTable)
        .innerJoin(automationRunsTable, eq(automationRunsTable.id, automationDeliveriesTable.runId))
        .where(and(inArray(automationRunsTable.ruleId, ruleIds), statsDeliveryPeriodRangeCondition(prevCutoff, window.start)))
        .groupBy(automationRunsTable.ruleId);

      prevRunsByRule = new Map(prevRunAgg.map((r) => [r.ruleId, { attributedAppointments: r.attributedAppointments }]));
      prevDeliveriesByRule = new Map(prevDeliveryAgg.map((d) => [d.ruleId, {
        emailDeliveredCount: d.emailDeliveredCount,
        emailOpenedCount: d.emailOpenedCount,
        smsDeliveredCount: d.smsDeliveredCount,
      }]));
    }

    const runsByRule = new Map(runAgg.map((r) => [r.ruleId, r]));
    const deliveriesByRule = new Map(deliveryAgg.map((d) => [d.ruleId, d]));

    res.json(rules.map((rule) => {
      const runs = runsByRule.get(rule.id);
      const deliveries = deliveriesByRule.get(rule.id);
      const previous = prevRunsByRule && prevDeliveriesByRule
        ? {
            attributedAppointments: prevRunsByRule.get(rule.id)?.attributedAppointments ?? 0,
            emailDeliveredCount: prevDeliveriesByRule.get(rule.id)?.emailDeliveredCount ?? 0,
            emailOpenedCount: prevDeliveriesByRule.get(rule.id)?.emailOpenedCount ?? 0,
            smsDeliveredCount: prevDeliveriesByRule.get(rule.id)?.smsDeliveredCount ?? 0,
          }
        : undefined;
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleStatus: rule.status,
        action: rule.action,
        totalRuns: runs?.totalRuns ?? 0,
        sentCount: runs?.sentCount ?? 0,
        skippedCount: runs?.skippedCount ?? 0,
        failedCount: runs?.failedCount ?? 0,
        attributedAppointments: runs?.attributedAppointments ?? 0,
        attributedRevenue: runs?.attributedRevenue ?? 0,
        completedAppointments: runs?.completedAppointments ?? 0,
        completedRevenue: runs?.completedRevenue ?? 0,
        upcomingAppointments: runs?.upcomingAppointments ?? 0,
        upcomingRevenue: runs?.upcomingRevenue ?? 0,
        emailSentCount: deliveries?.emailSentCount ?? 0,
        emailDeliveredCount: deliveries?.emailDeliveredCount ?? 0,
        emailOpenedCount: deliveries?.emailOpenedCount ?? 0,
        emailFailedCount: deliveries?.emailFailedCount ?? 0,
        smsSentCount: deliveries?.smsSentCount ?? 0,
        smsDeliveredCount: deliveries?.smsDeliveredCount ?? 0,
        smsFailedCount: deliveries?.smsFailedCount ?? 0,
        lastRunAt: runs?.lastRunAt ?? null,
        ...(previous ? { previous } : {}),
      };
    }));
  } catch (err) { next(err); }
});

router.get("/growth/automations/:automationId/stats", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const parsedWindow = parseStatsWindow(req.query);
    if ("error" in parsedWindow) {
      res.status(400).json({ error: parsedWindow.error, code: "VALIDATION" });
      return;
    }
    const { window } = parsedWindow;

    // Same compare semantics as the overview endpoint: only "previous" is
    // accepted, and only together with a bounded period ("all" has no
    // preceding window of equal length to compare against).
    const compareRaw = req.query["compare"];
    if (compareRaw !== undefined && compareRaw !== "previous") {
      res.status(400).json({ error: "Invalid compare. Expected: previous.", code: "VALIDATION" });
      return;
    }
    // The preceding comparison window is only defined for the rolling presets;
    // custom from/to ranges and all-time have no canonical "previous" window yet.
    const periodDays = typeof req.query["period"] === "string" ? STATS_PERIOD_DAYS[req.query["period"]] : undefined;
    if (compareRaw === "previous" && (periodDays === undefined || !window.start)) {
      res.status(400).json({ error: "compare=previous requires a bounded period (7d, 30d, 90d).", code: "VALIDATION" });
      return;
    }
    const prevCutoff = compareRaw === "previous" && window.start && periodDays !== undefined
      ? new Date(window.start.getTime() - periodDays * 24 * 60 * 60 * 1000)
      : null;

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
        // Realized attribution only: cancelled and no-show appointments are
        // excluded via the join condition (neither is money earned or still
        // expected) so count and revenue share the same filter.
        attributedAppointments: sql<number>`sum(case when ${appointmentsTable.id} is not null then 1 else 0 end)::int`,
        attributedRevenue: sql<number>`coalesce(sum(${appointmentsTable.price}), 0)::int`,
        // Completed vs upcoming split of the same joined rows. "Upcoming" is
        // the complement (joined but not completed — i.e. pending/confirmed,
        // since cancelled and no-show never join), so the two buckets always
        // sum exactly to the attributed totals above.
        completedAppointments: sql<number>`sum(case when ${appointmentsTable.status} = 'completed' then 1 else 0 end)::int`,
        completedRevenue: sql<number>`coalesce(sum(case when ${appointmentsTable.status} = 'completed' then ${appointmentsTable.price} end), 0)::int`,
        upcomingAppointments: sql<number>`sum(case when ${appointmentsTable.id} is not null and ${appointmentsTable.status} <> 'completed' then 1 else 0 end)::int`,
        upcomingRevenue: sql<number>`coalesce(sum(case when ${appointmentsTable.status} <> 'completed' then ${appointmentsTable.price} end), 0)::int`,
        lastRunAt: sql<string | null>`max(${automationRunsTable.executedAt})`,
      })
      .from(automationRunsTable)
      .leftJoin(appointmentsTable, and(
        eq(appointmentsTable.id, automationRunsTable.attributedAppointmentId),
        notInArray(appointmentsTable.status, ["cancelled", "no-show"]),
      ))
      .where(and(eq(automationRunsTable.ruleId, rule.id), statsRunPeriodCondition(window)));

    // Delivery stats (delivered / opened / provider-failed, updated from
    // verified provider webhooks). Broken down per channel so the UI can show
    // a real funnel and handle providers without open tracking (SMS).
    const emailChannel = sql`${automationDeliveriesTable.channel} = 'email'`;
    const smsChannel = sql`${automationDeliveriesTable.channel} = 'sms'`;
    const [deliveryStats] = await db
      .select({
        deliveredCount: sql<number>`sum(case when ${automationDeliveriesTable.deliveredAt} is not null then 1 else 0 end)::int`,
        openedCount: sql<number>`sum(case when ${automationDeliveriesTable.openedAt} is not null then 1 else 0 end)::int`,
        emailSentCount: sql<number>`sum(case when ${emailChannel} and ${automationDeliveriesTable.status} = 'sent' then 1 else 0 end)::int`,
        emailDeliveredCount: sql<number>`sum(case when ${emailChannel} and ${automationDeliveriesTable.deliveredAt} is not null then 1 else 0 end)::int`,
        emailOpenedCount: sql<number>`sum(case when ${emailChannel} and ${automationDeliveriesTable.openedAt} is not null then 1 else 0 end)::int`,
        emailFailedCount: sql<number>`sum(case when ${emailChannel} and ${automationDeliveriesTable.failedAt} is not null then 1 else 0 end)::int`,
        smsSentCount: sql<number>`sum(case when ${smsChannel} and ${automationDeliveriesTable.status} = 'sent' then 1 else 0 end)::int`,
        smsDeliveredCount: sql<number>`sum(case when ${smsChannel} and ${automationDeliveriesTable.deliveredAt} is not null then 1 else 0 end)::int`,
        smsFailedCount: sql<number>`sum(case when ${smsChannel} and ${automationDeliveriesTable.failedAt} is not null then 1 else 0 end)::int`,
      })
      .from(automationDeliveriesTable)
      .innerJoin(automationRunsTable, eq(automationRunsTable.id, automationDeliveriesTable.runId))
      .where(and(eq(automationRunsTable.ruleId, rule.id), statsDeliveryPeriodCondition(window)));

    // Preceding window of the same length (compare=previous): only the counts
    // the stats dialog renders trends for — delivered, opened, and attributed
    // appointments — aggregated over [prevCutoff, cutoff). Same shape as the
    // overview endpoint's `previous` block so the UI trends stay consistent.
    let previous:
      | { attributedAppointments: number; emailDeliveredCount: number; emailOpenedCount: number; smsDeliveredCount: number }
      | undefined;
    if (prevCutoff && window.start) {
      // Same non-cancelled join as the current-period aggregate: a cancelled
      // appointment is not campaign-earned, so it must not count in either
      // window or the trend direction would be wrong.
      const [prevRuns] = await db
        .select({
          attributedAppointments: sql<number>`sum(case when ${appointmentsTable.id} is not null then 1 else 0 end)::int`,
        })
        .from(automationRunsTable)
        .leftJoin(appointmentsTable, and(
          eq(appointmentsTable.id, automationRunsTable.attributedAppointmentId),
          ne(appointmentsTable.status, "cancelled"),
        ))
        .where(and(eq(automationRunsTable.ruleId, rule.id), statsRunPeriodRangeCondition(prevCutoff, window.start)));

      const [prevDeliveries] = await db
        .select({
          emailDeliveredCount: sql<number>`sum(case when ${emailChannel} and ${automationDeliveriesTable.deliveredAt} is not null then 1 else 0 end)::int`,
          emailOpenedCount: sql<number>`sum(case when ${emailChannel} and ${automationDeliveriesTable.openedAt} is not null then 1 else 0 end)::int`,
          smsDeliveredCount: sql<number>`sum(case when ${smsChannel} and ${automationDeliveriesTable.deliveredAt} is not null then 1 else 0 end)::int`,
        })
        .from(automationDeliveriesTable)
        .innerJoin(automationRunsTable, eq(automationRunsTable.id, automationDeliveriesTable.runId))
        .where(and(eq(automationRunsTable.ruleId, rule.id), statsDeliveryPeriodRangeCondition(prevCutoff, window.start)));

      previous = {
        attributedAppointments: prevRuns?.attributedAppointments ?? 0,
        emailDeliveredCount: prevDeliveries?.emailDeliveredCount ?? 0,
        emailOpenedCount: prevDeliveries?.emailOpenedCount ?? 0,
        smsDeliveredCount: prevDeliveries?.smsDeliveredCount ?? 0,
      };
    }

    res.json({
      ruleId: rule.id,
      totalRuns: stats?.totalRuns ?? 0,
      sentCount: stats?.sentCount ?? 0,
      skippedCount: stats?.skippedCount ?? 0,
      failedCount: stats?.failedCount ?? 0,
      attributedAppointments: stats?.attributedAppointments ?? 0,
      attributedRevenue: stats?.attributedRevenue ?? 0,
      completedAppointments: stats?.completedAppointments ?? 0,
      completedRevenue: stats?.completedRevenue ?? 0,
      upcomingAppointments: stats?.upcomingAppointments ?? 0,
      upcomingRevenue: stats?.upcomingRevenue ?? 0,
      deliveredCount: deliveryStats?.deliveredCount ?? 0,
      openedCount: deliveryStats?.openedCount ?? 0,
      emailSentCount: deliveryStats?.emailSentCount ?? 0,
      emailDeliveredCount: deliveryStats?.emailDeliveredCount ?? 0,
      emailOpenedCount: deliveryStats?.emailOpenedCount ?? 0,
      emailFailedCount: deliveryStats?.emailFailedCount ?? 0,
      smsSentCount: deliveryStats?.smsSentCount ?? 0,
      smsDeliveredCount: deliveryStats?.smsDeliveredCount ?? 0,
      smsFailedCount: deliveryStats?.smsFailedCount ?? 0,
      lastRunAt: stats?.lastRunAt ?? null,
      ...(previous ? { previous } : {}),
    });
  } catch (err) { next(err); }
});

/**
 * GET /growth/automations/:automationId/attributed-appointments
 * Drill-down list of the concrete appointments attributed to a rule:
 * date, service name, and price (RSD). Owner-scoped; joins
 * automation_runs.attributed_appointment_id → appointments → services.
 *
 * Paginated (limit/offset) so long-running campaigns with hundreds of
 * attributed appointments stay cheap to open: the dialog fetches one page
 * at a time and shows a "load more" control. `total` is the full count so
 * the client can tell when everything is loaded.
 *
 * Accepts the same `period` filter as the stats endpoints (applied to the
 * run via statsRunPeriodCondition) so the paginated total always matches
 * the attributedAppointments count shown above the list in the dialog.
 */
const ATTRIBUTED_APPOINTMENTS_DEFAULT_LIMIT = 25;
const ATTRIBUTED_APPOINTMENTS_MAX_LIMIT = 100;

router.get("/growth/automations/:automationId/attributed-appointments", async (req, res, next) => {
  try {
    const ctx = await requireSalonOwner(req);
    if (!ctx) { res.status(403).json({ error: "Salon owner required.", code: "FORBIDDEN" }); return; }

    const parsedWindow = parseStatsWindow(req.query);
    if ("error" in parsedWindow) {
      res.status(400).json({ error: parsedWindow.error, code: "VALIDATION" });
      return;
    }
    const { window } = parsedWindow;

    let limit = ATTRIBUTED_APPOINTMENTS_DEFAULT_LIMIT;
    if (req.query["limit"] !== undefined) {
      const parsed = Number(req.query["limit"]);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > ATTRIBUTED_APPOINTMENTS_MAX_LIMIT) {
        res.status(400).json({
          error: `Invalid limit. Expected an integer between 1 and ${ATTRIBUTED_APPOINTMENTS_MAX_LIMIT}.`,
          code: "VALIDATION",
        });
        return;
      }
      limit = parsed;
    }
    let offset = 0;
    if (req.query["offset"] !== undefined) {
      const parsed = Number(req.query["offset"]);
      if (!Number.isInteger(parsed) || parsed < 0) {
        res.status(400).json({ error: "Invalid offset. Expected a non-negative integer.", code: "VALIDATION" });
        return;
      }
      offset = parsed;
    }

    const [rule] = await db
      .select({ id: automationRulesTable.id })
      .from(automationRulesTable)
      .where(and(eq(automationRulesTable.id, req.params["automationId"]!), eq(automationRulesTable.salonId, ctx.salon.id)))
      .limit(1);
    if (!rule) { res.status(404).json({ error: "Automation not found.", code: "NOT_FOUND" }); return; }

    // Inner joins drop runs without an attributed appointment, and cancelled
    // appointments are excluded exactly like the stats endpoints, so `total`
    // matches the attributedAppointments count shown above the list.
    // salon_customers is left-joined: walk-in/legacy appointments may have a
    // null salonCustomerId, in which case the client name fields stay null.
    const attributedAppointmentJoin = and(
      eq(appointmentsTable.id, automationRunsTable.attributedAppointmentId),
      ne(appointmentsTable.status, "cancelled"),
    );
    // Same run-window filter as the stats endpoints, so the paginated total
    // agrees with the attributedAppointments count for every period choice
    // (statsRunPeriodCondition returns undefined for all-time; and() drops it).
    const runScope = and(eq(automationRunsTable.ruleId, rule.id), statsRunPeriodCondition(window));

    const [countRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(automationRunsTable)
      .innerJoin(appointmentsTable, attributedAppointmentJoin)
      .innerJoin(servicesTable, eq(servicesTable.id, appointmentsTable.serviceId))
      .where(runScope);

    // Deterministic ordering (id as final tiebreaker) so limit/offset pages
    // never overlap or skip rows when appointments share a date and time.
    const items = await db
      .select({
        appointmentId: appointmentsTable.id,
        date: appointmentsTable.date,
        serviceName: servicesTable.name,
        price: appointmentsTable.price,
        clientFirstName: salonCustomersTable.firstName,
        clientLastName: salonCustomersTable.lastName,
      })
      .from(automationRunsTable)
      .innerJoin(appointmentsTable, attributedAppointmentJoin)
      .innerJoin(servicesTable, eq(servicesTable.id, appointmentsTable.serviceId))
      .leftJoin(salonCustomersTable, eq(salonCustomersTable.id, appointmentsTable.salonCustomerId))
      .where(runScope)
      .orderBy(desc(appointmentsTable.date), desc(appointmentsTable.startTime), desc(appointmentsTable.id))
      .limit(limit)
      .offset(offset);

    res.json({ items, total: countRow?.total ?? 0, limit, offset });
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

// ---------------------------------------------------------------------------
// ADMIN — PLATFORM RETENTION SETTINGS (versioned, audited)
// ---------------------------------------------------------------------------

function settingsView(s: Awaited<ReturnType<typeof getActiveRetentionSettings>>) {
  return {
    version: s.version,
    thresholds: s.thresholds,
    changedByUserId: s.changedByUserId,
    changedAt: s.changedAt ? s.changedAt.toISOString() : null,
    isDefault: s.version === 0,
    defaults: { ...DEFAULT_RETENTION_THRESHOLDS },
    changeSource: s.changeSource,
    restoredFromVersion: s.restoredFromVersion,
  };
}

router.get("/growth/admin/retention-settings", async (req, res, next) => {
  try {
    const user = await getCurrentUser(req);
    if (!user || !isAdmin(user)) {
      res.status(403).json({ error: "Admin access required.", code: "FORBIDDEN" }); return;
    }
    res.json(settingsView(await getActiveRetentionSettings()));
  } catch (err) { next(err); }
});

router.put("/growth/admin/retention-settings", async (req, res, next) => {
  try {
    const user = await getCurrentUser(req);
    if (!user || !isAdmin(user)) {
      res.status(403).json({ error: "Admin access required.", code: "FORBIDDEN" }); return;
    }

    const parsed = AdminUpdateRetentionSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error.", code: "VALIDATION_ERROR", issues: parsed.error.issues });
      return;
    }

    const { changeSource, restoredFromVersion, expectedVersion, ...thresholds } = parsed.data;
    const problems = validateRetentionThresholds(thresholds);
    if (problems.length > 0) {
      res.status(400).json({ error: problems.join(" "), code: "VALIDATION_ERROR", problems });
      return;
    }

    try {
      const result = await updateRetentionSettings(user.id, thresholds, expectedVersion, {
        changeSource: changeSource ?? "manual",
        restoredFromVersion,
      });
      if (!result.ok) {
        // Another admin recorded a newer version since this client loaded the
        // settings — surface the conflict instead of silently overwriting.
        res.status(409).json({
          error: "Podešavanja je u međuvremenu izmenio drugi administrator. Osvežite vrednosti i potvrdite ponovo.",
          code: "VERSION_CONFLICT",
          expectedVersion: result.conflict.expectedVersion,
          activeVersion: result.conflict.activeVersion,
        });
        return;
      }
      res.json(settingsView(result.settings));
    } catch (err) {
      if (err instanceof RetentionNoOpRestoreError) {
        // Distinct code so the client can explain why nothing was recorded.
        res.status(400).json({ error: err.message, code: "NO_OP_RESTORE" });
        return;
      }
      if (err instanceof RetentionRestoreError) {
        res.status(400).json({ error: err.message, code: "VALIDATION_ERROR" });
        return;
      }
      throw err;
    }
  } catch (err) { next(err); }
});

// Dry-run: classify all customers under current vs. candidate thresholds.
// Strictly read-only — never records a settings version.
router.post("/growth/admin/retention-settings/preview", async (req, res, next) => {
  try {
    const user = await getCurrentUser(req);
    if (!user || !isAdmin(user)) {
      res.status(403).json({ error: "Admin access required.", code: "FORBIDDEN" }); return;
    }

    const parsed = AdminPreviewRetentionSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error.", code: "VALIDATION_ERROR", issues: parsed.error.issues });
      return;
    }

    const problems = validateRetentionThresholds(parsed.data);
    if (problems.length > 0) {
      res.status(400).json({ error: problems.join(" "), code: "VALIDATION_ERROR", problems });
      return;
    }

    res.json(await previewRetentionThresholds(parsed.data));
  } catch (err) { next(err); }
});

router.get("/growth/admin/retention-settings/history", async (req, res, next) => {
  try {
    const user = await getCurrentUser(req);
    if (!user || !isAdmin(user)) {
      res.status(403).json({ error: "Admin access required.", code: "FORBIDDEN" }); return;
    }
    const history = await getRetentionSettingsHistory();
    res.json(history.map((h) => ({
      version: h.version,
      thresholds: h.thresholds,
      previousThresholds: h.previousThresholds,
      changedByUserId: h.changedByUserId,
      changedByName: h.changedByName,
      changedAt: h.changedAt.toISOString(),
      changeSource: h.changeSource,
      restoredFromVersion: h.restoredFromVersion,
    })));
  } catch (err) { next(err); }
});

export default router;
