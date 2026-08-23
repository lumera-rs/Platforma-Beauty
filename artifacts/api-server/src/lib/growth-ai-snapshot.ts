/**
 * AI Snapshot service for salon growth analysis.
 *
 * Builds a fresh, salon-only metric snapshot and passes it verbatim to the
 * AI system prompt. Never invents numbers. Never uses outside facts.
 * Provider failure is explicit — no fabricated fallback.
 */

import { and, eq, gte, lte, sql } from "drizzle-orm";
import {
  db,
  appointmentsTable,
  servicesTable,
  employeesTable,
  salonsTable,
  salonCustomersTable,
} from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";
import { classifyRetention } from "./retention-classification";

// ---------------------------------------------------------------------------
// Snapshot types
// ---------------------------------------------------------------------------

export interface SalonMetricSnapshot {
  salonId: string;
  salonName: string;
  periodFrom: string;
  periodTo: string;
  generatedAt: string;
  totalRevenue: number;
  totalBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  noShowBookings: number;
  retentionCounts: {
    NEW: number;
    ACTIVE: number;
    VIP: number;
    AT_RISK: number;
    LOST: number;
  };
  topServices: Array<{ serviceName: string; bookingCount: number; revenue: number }>;
  topEmployees: Array<{ employeeName: string; completedCount: number; revenue: number }>;
  totalCustomers: number;
}

export interface AiGrowthAnswer {
  answer: string;
  snapshot: SalonMetricSnapshot;
}

// ---------------------------------------------------------------------------
// Build snapshot
// ---------------------------------------------------------------------------

export async function buildSalonSnapshot(salonId: string, periodDays = 90): Promise<SalonMetricSnapshot> {
  const to = new Date();
  const from = new Date(to.getTime() - periodDays * 86_400_000);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  const [salon] = await db
    .select({ name: salonsTable.name })
    .from(salonsTable)
    .where(eq(salonsTable.id, salonId));

  const salonName = salon?.name ?? "Unknown";

  // Aggregate stats for this period
  const [stats] = await db
    .select({
      totalRevenue: sql<number>`coalesce(sum(case when ${appointmentsTable.status} = 'completed' then ${appointmentsTable.price} else 0 end), 0)::int`,
      totalBookings: sql<number>`count(*)::int`,
      completedBookings: sql<number>`coalesce(sum(case when ${appointmentsTable.status} = 'completed' then 1 else 0 end), 0)::int`,
      cancelledBookings: sql<number>`coalesce(sum(case when ${appointmentsTable.status} = 'cancelled' then 1 else 0 end), 0)::int`,
      noShowBookings: sql<number>`coalesce(sum(case when ${appointmentsTable.status} = 'no-show' then 1 else 0 end), 0)::int`,
    })
    .from(appointmentsTable)
    .where(
      and(
        eq(appointmentsTable.salonId, salonId),
        gte(appointmentsTable.date, fromStr),
        lte(appointmentsTable.date, toStr),
      ),
    );

  // Top services
  const topServiceRows = await db
    .select({
      serviceName: servicesTable.name,
      bookingCount: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(case when ${appointmentsTable.status} = 'completed' then ${appointmentsTable.price} else 0 end), 0)::int`,
    })
    .from(appointmentsTable)
    .innerJoin(servicesTable, eq(appointmentsTable.serviceId, servicesTable.id))
    .where(
      and(
        eq(appointmentsTable.salonId, salonId),
        gte(appointmentsTable.date, fromStr),
        lte(appointmentsTable.date, toStr),
      ),
    )
    .groupBy(servicesTable.name)
    .orderBy(sql`count(*) desc`)
    .limit(5);

  // Top employees
  const topEmployeeRows = await db
    .select({
      employeeName: employeesTable.name,
      completedCount: sql<number>`coalesce(sum(case when ${appointmentsTable.status} = 'completed' then 1 else 0 end), 0)::int`,
      revenue: sql<number>`coalesce(sum(case when ${appointmentsTable.status} = 'completed' then ${appointmentsTable.price} else 0 end), 0)::int`,
    })
    .from(appointmentsTable)
    .innerJoin(employeesTable, eq(appointmentsTable.employeeId, employeesTable.id))
    .where(
      and(
        eq(appointmentsTable.salonId, salonId),
        gte(appointmentsTable.date, fromStr),
        lte(appointmentsTable.date, toStr),
      ),
    )
    .groupBy(employeesTable.name)
    .orderBy(sql`sum(case when ${appointmentsTable.status} = 'completed' then ${appointmentsTable.price} else 0 end) desc`)
    .limit(5);

  // Retention counts: load all customers and their full history
  const allCustomers = await db
    .select({ id: salonCustomersTable.id })
    .from(salonCustomersTable)
    .where(eq(salonCustomersTable.salonId, salonId));

  const retentionCounts = { NEW: 0, ACTIVE: 0, VIP: 0, AT_RISK: 0, LOST: 0 };

  // Batch load appointments for all customers
  if (allCustomers.length > 0) {
    const allAppts = await db
      .select({
        salonCustomerId: appointmentsTable.salonCustomerId,
        date: appointmentsTable.date,
        status: appointmentsTable.status,
        price: appointmentsTable.price,
      })
      .from(appointmentsTable)
      .where(eq(appointmentsTable.salonId, salonId));

    const apptsByCustomer = new Map<string, typeof allAppts>();
    for (const appt of allAppts) {
      if (!appt.salonCustomerId) continue;
      const arr = apptsByCustomer.get(appt.salonCustomerId) ?? [];
      arr.push(appt);
      apptsByCustomer.set(appt.salonCustomerId, arr);
    }

    for (const customer of allCustomers) {
      const appts = apptsByCustomer.get(customer.id) ?? [];
      const result = classifyRetention({
        appointments: appts.map((a) => ({
          date: a.date,
          status: a.status as "pending" | "confirmed" | "completed" | "cancelled" | "no-show",
          price: a.price,
        })),
      });
      retentionCounts[result.status]++;
    }
  }

  return {
    salonId,
    salonName,
    periodFrom: fromStr,
    periodTo: toStr,
    generatedAt: to.toISOString(),
    totalRevenue: stats?.totalRevenue ?? 0,
    totalBookings: stats?.totalBookings ?? 0,
    completedBookings: stats?.completedBookings ?? 0,
    cancelledBookings: stats?.cancelledBookings ?? 0,
    noShowBookings: stats?.noShowBookings ?? 0,
    retentionCounts,
    topServices: topServiceRows,
    topEmployees: topEmployeeRows,
    totalCustomers: allCustomers.length,
  };
}

// ---------------------------------------------------------------------------
// AI Q&A
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT_PREFIX = `You are a business growth advisor for a beauty salon. 
You MUST answer only based on the provided salon data snapshot.
NEVER invent numbers. NEVER reference outside facts, benchmarks, or general statistics.
NEVER provide medical advice.
Be practical, specific, and grounded in the provided metrics only.
If the data is insufficient to answer, say so clearly.
Return analysis in the same language as the user's question.`;

export async function askGrowthAi(input: {
  salonId: string;
  question: string;
  snapshotPeriodDays?: number;
}): Promise<AiGrowthAnswer> {
  const snapshot = await buildSalonSnapshot(input.salonId, input.snapshotPeriodDays ?? 90);

  const snapshotText = JSON.stringify(snapshot, null, 2);

  const systemPrompt = `${SYSTEM_PROMPT_PREFIX}

SALON DATA SNAPSHOT (use ONLY these numbers in your response):
\`\`\`json
${snapshotText}
\`\`\``;

  // Provider call — explicit failure, no fabricated fallback
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      { role: "user", content: input.question },
    ],
  });

  const firstBlock = message.content[0];
  if (!firstBlock || firstBlock.type !== "text") {
    throw new Error("AI provider returned an unexpected response format.");
  }

  return {
    answer: firstBlock.text,
    snapshot,
  };
}
