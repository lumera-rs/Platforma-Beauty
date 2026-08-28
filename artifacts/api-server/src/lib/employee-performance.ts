/**
 * Employee performance metrics service.
 *
 * Computes per-employee revenue, appointment counts, commission (both % and fixed),
 * average rating, and return/rebooking rate strictly within the requesting salon.
 *
 * Commission is calculated per completed appointment with per-service override
 * support. Override values follow the same numeric convention as the base setting:
 *   - percent_of_revenue  → override is a percentage (0–100)
 *   - fixed_per_treatment → override is a fixed dinars amount (≥ 0)
 *
 * For package-redemption appointments (price = 0), the revenue basis used for
 * percentage commission and revenue metrics is
 * package_redemptions.original_appointment_price, not the zeroed price column.
 */

import { and, eq, gte, inArray, lte, sql, isNotNull } from "drizzle-orm";
import {
  db,
  appointmentsTable,
  employeesTable,
  employeeLocationAssignmentsTable,
  employeeCommissionSettingsTable,
  packageRedemptionsTable,
  reviewsTable,
} from "@workspace/db";

export interface EmployeePerformanceMetrics {
  employeeId: string;
  employeeName: string;
  completedAppointments: number;
  totalRevenue: number;
  commissionType: "percent_of_revenue" | "fixed_per_treatment";
  commissionPercent: number;
  fixedAmountInDinars: number;
  /** Per-service overrides map (serviceId → numeric value per commissionType) */
  perServiceOverrides: Record<string, number>;
  estimatedCommission: number;
  noShowCount: number;
  cancelledCount: number;
  averageAppointmentValue: number;
  /** Average rating × 10 on 10–50 scale, 0 if no reviews */
  averageRating: number;
  reviewCount: number;
  /** Fraction of customers who booked again after their first visit (0–1) */
  rebookingRate: number;
}

export interface EmployeePerformanceInput {
  /** Kept for single-location callers; salonIds is used for owner-wide reads. */
  salonId?: string;
  salonIds?: string[];
  employeeId?: string;
  from?: string; // ISO YYYY-MM-DD
  to?: string;
}

export async function getEmployeePerformance(
  input: EmployeePerformanceInput,
): Promise<EmployeePerformanceMetrics[]> {
  const salonIds = input.salonIds ?? (input.salonId ? [input.salonId] : []);
  if (!salonIds.length) return [];
  const salonScopeSql = sql.join(salonIds.map((salonId) => sql`${salonId}::uuid`), sql`, `);
  // Do not use employees.salonId as an ownership shortcut here: an employee may
  // be assigned to several locations. EXISTS avoids multiplying an employee
  // (and therefore their appointments) once for every assignment.
  const employeeFilter = and(
    eq(employeesTable.active, true),
    sql`exists (
      select 1 from ${employeeLocationAssignmentsTable} employee_location
      where employee_location.employee_id = ${employeesTable.id}
        and employee_location.salon_id in (${salonScopeSql})
        and employee_location.active = true
    )`,
    ...(input.employeeId ? [eq(employeesTable.id, input.employeeId)] : []),
  );

  const appointmentDateFilters = [
    ...(input.from ? [gte(appointmentsTable.date, input.from)] : []),
    ...(input.to ? [lte(appointmentsTable.date, input.to)] : []),
  ];

  // ── Appointment counts ────────────────────────────────────────────────────
  const countRows = await db
    .select({
      employeeId: employeesTable.id,
      employeeName: employeesTable.name,
      completedAppointments: sql<number>`coalesce(sum(case when ${appointmentsTable.status} = 'completed' then 1 else 0 end), 0)::int`,
      noShowCount: sql<number>`coalesce(sum(case when ${appointmentsTable.status} = 'no-show' then 1 else 0 end), 0)::int`,
      cancelledCount: sql<number>`coalesce(sum(case when ${appointmentsTable.status} = 'cancelled' then 1 else 0 end), 0)::int`,
    })
    .from(employeesTable)
    .leftJoin(
      appointmentsTable,
      and(
        eq(appointmentsTable.employeeId, employeesTable.id),
          inArray(appointmentsTable.salonId, salonIds),
        ...appointmentDateFilters,
      ),
    )
    .where(employeeFilter)
    .groupBy(employeesTable.id, employeesTable.name);

  // ── Per-appointment detail for commission computation ────────────────────
  // We need (serviceId, price) per completed appointment so we can apply
  // per-service overrides and use originalAppointmentPrice for package appts.
  //
  // Left-join package_redemptions to get originalAppointmentPrice when present.
  // Each appointment has at most one active (redeemed) redemption.
  // A package appointment has price = 0; the original price lives in
  // package_redemptions.original_appointment_price.
  const apptDetailFilter = and(
    inArray(appointmentsTable.salonId, salonIds),
    eq(appointmentsTable.status, "completed"),
    ...(input.employeeId ? [eq(appointmentsTable.employeeId, input.employeeId)] : []),
    ...appointmentDateFilters,
  );

  const apptDetails = await db
    .select({
      employeeId: appointmentsTable.employeeId,
      serviceId: appointmentsTable.serviceId,
      price: appointmentsTable.price,
      originalAppointmentPrice: packageRedemptionsTable.originalAppointmentPrice,
    })
    .from(appointmentsTable)
    .leftJoin(
      packageRedemptionsTable,
      and(
        eq(packageRedemptionsTable.appointmentId, appointmentsTable.id),
        eq(packageRedemptionsTable.status, "redeemed"),
      ),
    )
    .where(apptDetailFilter);

  // ── Commission settings ───────────────────────────────────────────────────
  const commissionSettings = await db
    .select()
    .from(employeeCommissionSettingsTable)
    .where(inArray(employeeCommissionSettingsTable.salonId, salonIds));
  const commissionMap = new Map(commissionSettings.map((cs) => [cs.employeeId, cs]));

  // ── Build per-employee revenue + commission maps ──────────────────────────
  const revenueMap = new Map<string, number>();
  const commissionEarnedMap = new Map<string, number>();

  for (const appt of apptDetails) {
    if (!appt.employeeId) continue;
    // Revenue basis: use original price if this is a package redemption (price = 0)
    const revenueBasis = appt.originalAppointmentPrice != null && appt.price === 0
      ? appt.originalAppointmentPrice
      : appt.price;

    revenueMap.set(appt.employeeId, (revenueMap.get(appt.employeeId) ?? 0) + revenueBasis);

    const cs = commissionMap.get(appt.employeeId);
    if (!cs) continue;

    const commissionType = cs.commissionType;
    // Per-service override takes precedence over employee base setting.
    const overrides = (cs.perServiceOverrides ?? {}) as Record<string, number>;
    const overrideValue = appt.serviceId ? overrides[appt.serviceId] : undefined;

    let apptCommission: number;
    if (commissionType === "fixed_per_treatment") {
      // Override is a fixed dinars amount; base is fixedAmountInDinars.
      const fixedDinars = overrideValue ?? cs.fixedAmountInDinars;
      apptCommission = fixedDinars;
    } else {
      // percent_of_revenue: override is a percent 0–100; base is commissionPercent.
      const percent = overrideValue ?? cs.commissionPercent;
      apptCommission = Math.round(revenueBasis * percent / 100);
    }

    commissionEarnedMap.set(appt.employeeId, (commissionEarnedMap.get(appt.employeeId) ?? 0) + apptCommission);
  }

  // ── Ratings ───────────────────────────────────────────────────────────────
  const ratingRows = await db
    .select({
      employeeId: reviewsTable.employeeId,
      avgRating: sql<number>`round(avg(${reviewsTable.rating}) * 10)::int`,
      cnt: sql<number>`count(*)::int`,
    })
    .from(reviewsTable)
    .where(and(
      inArray(reviewsTable.salonId, salonIds),
      eq(reviewsTable.visible, true),
      isNotNull(reviewsTable.employeeId),
      ...(input.employeeId ? [eq(reviewsTable.employeeId, input.employeeId)] : []),
    ))
    .groupBy(reviewsTable.employeeId);
  const ratingMap = new Map(ratingRows.map((r) => [r.employeeId!, { avg: r.avgRating, cnt: r.cnt }]));

  // ── Rebooking rate ────────────────────────────────────────────────────────
  const rebookData = await db.execute<{ employee_id: string; rebook_rate: number }>(
    sql`
      SELECT
        employee_id,
        COALESCE(
          count(distinct case when cnt >= 2 then salon_customer_id end)::float
            / NULLIF(count(distinct salon_customer_id), 0),
          0
        ) AS rebook_rate
      FROM (
        SELECT
          employee_id,
          salon_customer_id,
          count(*) AS cnt
        FROM appointments
        WHERE salon_id in (${salonScopeSql})
          AND status = 'completed'
          ${input.employeeId ? sql`AND employee_id = ${input.employeeId}` : sql``}
          ${input.from ? sql`AND appointment_date >= ${input.from}` : sql``}
          ${input.to ? sql`AND appointment_date <= ${input.to}` : sql``}
        GROUP BY employee_id, salon_customer_id
      ) sub
      GROUP BY employee_id
    `,
  );
  const rebookMap = new Map(
    rebookData.rows.map((r) => [r.employee_id, Number(r.rebook_rate)]),
  );

  // ── Assemble results ──────────────────────────────────────────────────────
  return countRows.map((row) => {
    const cs = commissionMap.get(row.employeeId);
    const commissionType = cs?.commissionType ?? "percent_of_revenue";
    const commissionPercent = cs?.commissionPercent ?? 0;
    const fixedAmountInDinars = cs?.fixedAmountInDinars ?? 0;
    const perServiceOverrides = (cs?.perServiceOverrides ?? {}) as Record<string, number>;

    const totalRevenue = revenueMap.get(row.employeeId) ?? 0;
    const estimatedCommission = commissionEarnedMap.get(row.employeeId) ?? 0;

    const averageAppointmentValue = row.completedAppointments > 0
      ? Math.round(totalRevenue / row.completedAppointments)
      : 0;

    const ratingInfo = ratingMap.get(row.employeeId);
    const rebookingRate = rebookMap.get(row.employeeId) ?? 0;

    return {
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      completedAppointments: row.completedAppointments,
      totalRevenue,
      commissionType,
      commissionPercent,
      fixedAmountInDinars,
      perServiceOverrides,
      estimatedCommission,
      noShowCount: row.noShowCount,
      cancelledCount: row.cancelledCount,
      averageAppointmentValue,
      averageRating: ratingInfo?.avg ?? 0,
      reviewCount: ratingInfo?.cnt ?? 0,
      rebookingRate: Math.round(rebookingRate * 100) / 100,
    };
  });
}
