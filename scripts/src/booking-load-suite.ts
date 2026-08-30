/* HTTP-only concurrency suite. It is intentionally run only by run-booking-load.ts. */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  appointmentsTable, bookingGroupsTable, db, employeeLocationAssignmentsTable, employeeServicesTable, employeesTable,
  salonDateHoursTable, salonsTable, servicesTable, sessionsTable, usersTable,
} from "@workspace/db";
import { classifyLoadSamples, evaluateLoadTargets, latencySummary, roundRobinServerIndex, type LoadSample, type LoadTargets } from "./booking-load-metrics";

const urls = (process.env.LUMERA_BOOKING_LOAD_URLS ?? "").split(",").filter((url) => /^http:\/\/127\.0\.0\.1:\d+$/.test(url));
const apiProcesses = Number(process.env.LUMERA_BOOKING_LOAD_API_PROCESSES ?? 2);
const expectedDeploymentProcesses = Number(process.env.LUMERA_BOOKING_LOAD_EXPECTED_DEPLOYMENT_PROCESSES ?? apiProcesses);
if (process.env.NODE_ENV !== "test" || process.env.LUMERA_BOOKING_LOAD !== "1" || urls.length !== apiProcesses || urls.length < 1) throw new Error("Booking load suite requires the configured loopback test API process count.");
const marker = `booking-load-${process.pid}`;
const sessionCookieName = "lumera_session";
const reportPath = path.resolve(import.meta.dirname, "..", "..", "reports", "booking-load");
const requestTimeoutMs = 30_000;
const reportName = process.env.LUMERA_BOOKING_LOAD_REPORT_NAME ?? "latest";
if (!/^[a-z0-9-]+$/.test(reportName)) throw new Error("Invalid booking load report name.");
const dbConnectionTimeoutMs = Number(process.env.DB_CONN_TIMEOUT_MS ?? 15_000);
const poolMaxPerProcess = Number(process.env.LUMERA_BOOKING_LOAD_API_POOL_MAX ?? 10);
const harnessPoolMax = Number(process.env.LUMERA_BOOKING_LOAD_HARNESS_POOL_MAX ?? 10);
const connectionReserve = Number(process.env.LUMERA_BOOKING_LOAD_CONNECTION_RESERVE ?? 5);
const databaseConnectionBudget = Number(process.env.LUMERA_BOOKING_LOAD_DB_CONNECTION_BUDGET ?? 35);
const bookingAdmissionPerProcess = Number(process.env.LUMERA_BOOKING_LOAD_ADMISSION_PER_PROCESS ?? 10_000);
const targets: Record<string, LoadTargets> = {
  "same-slot": { p95Ms: 5_000, p99Ms: 5_000, maxUnexpectedErrorRate: 0 },
  "1000-distinct": { p95Ms: 10_000, p99Ms: 10_000, maxUnexpectedErrorRate: 0.001 },
  "250-groups": { p95Ms: 5_000, p99Ms: 5_000, maxUnexpectedErrorRate: 0 },
  "mixed-1000": { p95Ms: 10_000, p99Ms: 10_000, maxUnexpectedErrorRate: 0.001 },
};
const operationalTargets: Record<string, { minimumThroughputPerSecond: number; maximumPeakWaitingPerProcess: number; maximumPeakLocks: number }> = {
  "same-slot": { minimumThroughputPerSecond: 50, maximumPeakWaitingPerProcess: 150, maximumPeakLocks: 500 },
  "1000-distinct": { minimumThroughputPerSecond: 60, maximumPeakWaitingPerProcess: 1_000, maximumPeakLocks: 1_000 },
  "250-groups": { minimumThroughputPerSecond: 50, maximumPeakWaitingPerProcess: 250, maximumPeakLocks: 1_200 },
  // Mixed requests include grouped creators that issue independent reads in
  // parallel, so the pg-pool waiter watermark may exceed the HTTP request count.
  "mixed-1000": { minimumThroughputPerSecond: 100, maximumPeakWaitingPerProcess: 1_250, maximumPeakLocks: 1_000 },
};
type Fixture = { salons: { id: string; employeeIds: string[]; serviceA: string; serviceB: string }[]; sessions: string[] };
type Request = { method: "POST"; path: string; cookie: string; body: unknown };
type ActivitySample = {
  states: Array<{ state: string; count: number }>;
  locks: Array<{ mode: string; count: number }>;
  apiPools: Array<{ total: number; idle: number; waiting: number; max: number } | null>;
};
const date = (day: number) => `2099-06-${String(day).padStart(2, "0")}`;
const time = (index: number) => `${String(8 + Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`;
const hourly = (index: number) => `${String(8 + index).padStart(2, "0")}:00`;

async function fixture(): Promise<Fixture> {
  // users.email is non-null in the production schema; deliberately invalid
  // identifiers mean these fixtures have no deliverable email or phone.
  const [owner] = await db.insert(usersTable).values({ firstName: marker, lastName: "owner", email: `${marker}-owner`, passwordHash: "test", role: "SALON_OWNER" }).returning();
  const salons: Fixture["salons"] = [];
  for (let i = 0; i < 5; i++) {
    const [salon] = await db.insert(salonsTable).values({ ownerId: owner!.id, name: `${marker} salon ${i}`, slug: `${marker}-s${i}`, city: "Beograd", municipality: "Test", address: "Load 1", postalCode: "11000", phone: "", email: `${marker}-salon-${i}`, latitude: 44.8, longitude: 20.4, shortDescription: marker, description: marker, imageUrl: "/test.jpg", instantBooking: true }).returning();
    const services = await db.insert(servicesTable).values([
      { salonId: salon!.id, categoryName: marker, name: `${marker} a ${i}`, description: marker, imageUrl: "/test.jpg", durationMinutes: 60, price: 100 },
      { salonId: salon!.id, categoryName: marker, name: `${marker} b ${i}`, description: marker, imageUrl: "/test.jpg", durationMinutes: 60, price: 100 },
    ]).returning();
    const employeeIds: string[] = [];
    for (let employeeIndex = 0; employeeIndex < 5; employeeIndex++) {
      const [employee] = await db.insert(employeesTable).values({ salonId: salon!.id, name: `${marker} employee ${i}-${employeeIndex}`, role: "tester", bio: "", avatarUrl: "" }).returning();
      employeeIds.push(employee!.id);
      await db.insert(employeeLocationAssignmentsTable).values({ employeeId: employee!.id, salonId: salon!.id, active: true, isDefault: true });
      await db.insert(employeeServicesTable).values([{ employeeId: employee!.id, serviceId: services[0]!.id }, { employeeId: employee!.id, serviceId: services[1]!.id }]);
    }
    await db.insert(salonDateHoursTable).values(Array.from({ length: 30 }, (_, d) => ({ salonId: salon!.id, date: date(d + 1), openTime: "08:00", closeTime: "20:00", closed: false })));
    salons.push({ id: salon!.id, employeeIds, serviceA: services[0]!.id, serviceB: services[1]!.id });
  }
  const customers = [];
  for (let i = 0; i < 1_100; i++) customers.push({ firstName: marker, lastName: String(i), email: `${marker}-customer-${i}`, passwordHash: "test", role: "CUSTOMER" as const });
  const inserted = [];
  for (let i = 0; i < customers.length; i += 100) inserted.push(...await db.insert(usersTable).values(customers.slice(i, i + 100)).returning());
  const sessions: string[] = [];
  for (let i = 0; i < inserted.length; i += 25) sessions.push(...await Promise.all(inserted.slice(i, i + 25).map(async (user) => {
    const token = randomBytes(32).toString("base64url");
    await db.insert(sessionsTable).values({ userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date("2100-01-01T00:00:00Z") });
    return token;
  })));
  return { salons, sessions };
}
type HttpLoadSample = LoadSample & { body?: unknown; error?: string; server: number };

async function hit(request: Request, index: number): Promise<HttpLoadSample> {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const started = performance.now();
  const server = roundRobinServerIndex(index, urls.length);
  try {
    const response = await fetch(`${urls[server]}${request.path}`, { method: request.method, headers: { "content-type": "application/json", cookie: `${sessionCookieName}=${request.cookie}`, connection: "keep-alive" }, body: JSON.stringify(request.body), signal: controller.signal });
    const body = await response.json().catch(() => undefined);
    return { status: response.status, code: (body as { code?: string } | undefined)?.code, body, milliseconds: performance.now() - started, server };
  } catch (error) {
    return {
      timeout: error instanceof DOMException && error.name === "AbortError",
      code: "NETWORK",
      milliseconds: performance.now() - started,
      server,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally { clearTimeout(timeout); }
}
async function scenario(name: string, requests: Request[]) {
  const statementsBefore = await databaseStatementTotals();
  const samples: ActivitySample[] = [];
  let samplingErrors = 0;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      try { samples.push(await activity()); } catch { samplingErrors++; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  const workers = requests.map(async (request, index) => { await gate; return hit(request, index); });
  const started = performance.now(); release(); const results = await Promise.all(workers);
  sampling = false;
  await sampler;
  try { samples.push(await activity()); } catch { samplingErrors++; }
  const elapsed = performance.now() - started; const classified = classifyLoadSamples(results);
  const statementsAfter = await databaseStatementTotals();
  const statementDeltas = statementsAfter.map((total, index) => total - statementsBefore[index]!);
  const databaseStatements = {
    scope: "Drizzle-logged database round trips executed by the isolated API processes during this scenario, including transaction BEGIN/COMMIT/ROLLBACK statements.",
    perProcess: statementDeltas,
    total: statementDeltas.reduce((sum, count) => sum + count, 0),
    perRequest: statementDeltas.reduce((sum, count) => sum + count, 0) / results.length,
  };
  const unexpected = results.filter((result) =>
    !result.status || result.status >= 500 || result.code === "BOOKING_CAPACITY"
  );
  const result = {
    name,
    count: results.length,
    throughputPerSecond: results.length / (elapsed / 1_000),
    ...classified,
    unexpectedErrors: unexpected.length,
    unexpectedSamples: unexpected.slice(0, 10).map(({ status, code, body, error, server }) => ({ status, code, body, error, server })),
    latency: latencySummary(results),
    databaseStatements,
    dbActivity: summarizeActivity(samples, samplingErrors),
    results,
  };
  const target = operationalTargets[name]!;
  const peakWaitingPerProcess = result.dbActivity.apiPools.map((pool) => pool.peakWaiting);
  const peakLocks = Object.values(result.dbActivity.pg.lockPeaks).reduce((sum, count) => sum + count, 0);
  const operationalChecks = {
    throughput: result.throughputPerSecond >= target.minimumThroughputPerSecond,
    poolWaiting: peakWaitingPerProcess.every((waiting) => waiting <= target.maximumPeakWaitingPerProcess),
    locks: peakLocks <= target.maximumPeakLocks,
  };
  return {
    ...result,
    objective: evaluateLoadTargets(result, targets[name]!),
    operationalObjective: {
      targets: target,
      observed: { throughputPerSecond: result.throughputPerSecond, peakWaitingPerProcess, peakLocks },
      checks: operationalChecks,
      passed: Object.values(operationalChecks).every(Boolean),
    },
  };
}
async function databaseStatementTotals() {
  return Promise.all(urls.map(async (url) => {
    const response = await fetch(`${url}/api/healthz`, { signal: AbortSignal.timeout(1_000) });
    const raw = response.headers.get("x-lumera-database-statements");
    assert.match(raw ?? "", /^\d+$/, "load-test API health must expose a cumulative database statement count");
    return Number(raw);
  }));
}
async function activity() {
  const [states, locks, apiPools] = await Promise.all([
    db.execute(sql`select state, count(*)::int as count from pg_stat_activity where datname = current_database() group by state`),
    db.execute(sql`select mode, count(*)::int as count from pg_locks where pid in (select pid from pg_stat_activity where datname = current_database()) group by mode`),
    Promise.all(urls.map(async (url) => {
      try {
        const response = await fetch(`${url}/api/healthz`, { signal: AbortSignal.timeout(1_000) });
        const body = await response.json() as { databasePool?: { total: number; idle: number; waiting: number; max: number } };
        return body.databasePool ?? null;
      } catch { return null; }
    })),
  ]);
  return {
    states: states.rows.map((row) => ({ state: String(row.state), count: Number(row.count) })),
    locks: locks.rows.map((row) => ({ mode: String(row.mode), count: Number(row.count) })),
    apiPools,
  };
}
function group(f: Fixture["salons"][number], day: string, slot: number, cookie: string, employeeId = f.employeeIds[0]!): Request {
  return { method: "POST", path: "/api/booking-groups", cookie, body: { salonId: f.id, date: day, treatments: [{ serviceId: f.serviceA, employeeId, startTime: time(slot) }, { serviceId: f.serviceB, employeeId, startTime: time(slot + 4) }], notes: marker } };
}
async function main() {
  const baseline = reportName === "latest" ? await readBaselineReport() : null;
  const allAdmitted = reportName === "staging-capacity" ? await readAllAdmittedReport() : null;
  const maxConnectionsResult = await db.execute(sql`show max_connections`);
  const databaseMaxConnections = Number(maxConnectionsResult.rows[0]?.max_connections);
  assert.ok(Number.isInteger(databaseMaxConnections) && databaseMaxConnections > 0, "staging database must report max_connections");
  assert.ok(databaseConnectionBudget <= databaseMaxConnections, `documented connection budget ${databaseConnectionBudget} exceeds database max_connections ${databaseMaxConnections}`);
  const report: any = {
    environment: "Isolated staging capacity measurement on one disposable database and the configured deployment-like API process topology; fixture/bootstrap time is excluded. Never point this destructive harness at live customer data.",
    requestTimeoutMs,
    configuration: {
      profile: process.env.LUMERA_BOOKING_LOAD_PROFILE ?? "development",
      serverMode: "isolated Express app without unrelated schedulers/workers",
      apiProcesses,
      expectedDeploymentProcesses,
      topologyMatched: apiProcesses === expectedDeploymentProcesses,
      poolMaxPerProcess,
      harnessPoolMax,
      connectionReserve,
      databaseConnectionBudget,
      databaseMaxConnections,
      plannedConnections: apiProcesses * poolMaxPerProcess + harnessPoolMax + connectionReserve,
      dbConnectionTimeoutMs,
      bookingAdmissionPerProcess,
      productionAdmissionDefaultPerProcess: 0,
    },
    objectives: {
      rationale: "Peak-spike objectives cap both p95 and p99 at 10 seconds across 1,000 simultaneous distinct booking arrivals, with no approved capacity-rejection budget. BOOKING_CAPACITY responses count against the error objective. Production admission remains disabled by default.",
      scenarios: targets,
      operationalScenarios: operationalTargets,
    },
    marker,
    scenarios: [],
    integrity: {},
    plans: [],
    optimization: reportName === "staging-capacity" ? {
      change: "Reduced the all-admitted booking path by reusing locked facts, combining eligibility/policy reads, skipping irrelevant resource queries, returning known allocations, and transactionally batching durable communication outbox writes before worker-based delivery.",
      evidenceBefore: allAdmitted ?? {
        report: "staging-capacity.json (previous verified profile)",
        scenario: "1000-distinct",
        databaseStatementsPerRequest: 43.94,
        throughputPerSecond: 64.77178448584051,
        p95Ms: 15342.842133000002,
        p99Ms: 15345.600534999998,
        unexpectedErrors: 0,
      },
      motivation: "Both API pools saturated while individually indexed queries remained below 50 ms. The successful path repeated transaction-scoped locks and configuration reads, while synchronous provider delivery consumed response-path capacity. Required outbox records now commit atomically with each booking and provider delivery runs asynchronously. The salon-wide lock remains mandatory because resource configuration writes use it as their synchronization boundary.",
    } : baseline ? {
      change: "Raised the default pg-pool connection/acquisition timeout from 5,000 ms to 15,000 ms without increasing either API process's 10-connection pool.",
      evidenceBefore: baseline,
      motivation: "The captured 5,000 ms baseline produced INTERNAL_ERROR responses while both pool acquisition queues were saturated; API stderr identified `timeout exceeded when trying to connect`.",
    } : null,
    optimizationDecision: "Pending completion of all baseline scenarios.",
  };
  let failure: unknown;
  try {
    const f = await fixture(); const first = f.salons[0]!;
    const collision = await scenario("same-slot", Array.from({ length: 200 }, (_, i) => group(first, date(1), 0, f.sessions[i]!)));
    report.scenarios.push(strip(collision)); assert.equal(collision.statuses["201"], 1); assert.equal(collision.statuses["409"], 199);
    const collisionRows = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.salonId, first.id), eq(appointmentsTable.date, date(1)), eq(appointmentsTable.startTime, "08:00")));
    assert.equal(collisionRows.length, 1, "same-slot audit must find one active appointment");
    const distinctRequests = Array.from({ length: 1000 }, (_, i): Request => {
      const s = f.salons[i % 5]!; const sequence = Math.floor(i / 5); const withinDay = sequence % 40;
      return { method: "POST", path: "/api/appointments", cookie: f.sessions[i]!, body: { salonId: s.id, serviceId: s.serviceA, employeeId: s.employeeIds[Math.floor(withinDay / 12)]!, date: date(2 + Math.floor(sequence / 40)), startTime: hourly(withinDay % 12), notes: marker } };
    });
    const distinct = await scenario("1000-distinct", distinctRequests); report.scenarios.push(strip(distinct));
    const expectedDistinctAccepted = Math.min(1000, bookingAdmissionPerProcess * apiProcesses);
    assert.equal(distinct.statuses["201"], expectedDistinctAccepted);
    assert.equal(distinct.statuses["429"] ?? 0, 1000 - expectedDistinctAccepted);
    assert.equal(distinct.codes["BOOKING_CAPACITY"] ?? 0, 1000 - expectedDistinctAccepted);
    assert.equal(distinct.unexpectedErrors, 0); assert.equal(distinct.timeouts, 0);
    const distinctAudit = await db.execute(sql`select count(*)::int as total, count(distinct customer_id)::int as customers from appointments where notes=${marker} and booking_group_id is null and appointment_date between ${date(2)} and ${date(6)}`);
    assert.equal(Number(distinctAudit.rows[0]?.total), expectedDistinctAccepted, "distinct-booking audit must find every admitted appointment");
    assert.equal(Number(distinctAudit.rows[0]?.customers), expectedDistinctAccepted, "distinct-booking audit must find every admitted customer");
    assert.equal(await activeMarkerOverlapCount(), 0, "distinct bookings must not overlap");
    // First 125 are distinct two-treatment layouts; the second 125 replay each
    // layout with another customer, so every latter request is a documented 409.
    const groups = await scenario("250-groups", Array.from({ length: 250 }, (_, i) => {
      const layout = i % 125;
      return group(f.salons[layout % 5]!, date(10 + Math.floor(layout / 25)), (Math.floor(layout / 5) % 5) * 8, f.sessions[1000 + (i % 100)]!);
    }));
    report.scenarios.push(strip(groups)); assert.equal((groups.statuses["201"] ?? 0) + (groups.statuses["409"] ?? 0), 250); assert.ok((groups.statuses["409"] ?? 0) >= 100, "controlled group conflicts expected");
    const partial = await db.execute(sql`select g.id from booking_groups g left join appointments a on a.booking_group_id=g.id where g.notes=${marker} group by g.id having count(a.id) <> 2`);
    assert.equal(partial.rows.length, 0, "every marker group must be atomic");
    const crossCustomer = await db.execute(sql`select g.id from booking_groups g join appointments a on a.booking_group_id=g.id where g.notes=${marker} and a.customer_id is distinct from g.customer_id`);
    assert.equal(crossCustomer.rows.length, 0, "group appointments must never belong to another customer");
    const groupAudit = await db.execute(sql`select count(*)::int as total from booking_groups where notes=${marker}`);
    assert.equal(Number(groupAudit.rows[0]?.total), 126, "group audit must find collision winner plus 125 controlled winners");
    assert.equal(await activeMarkerOverlapCount(), 0, "successful groups must not overlap");
    const created = distinct.results.filter((r) => r.status === 201).slice(0, 250);
    const createdIds = created.map(appointmentResponseId);
    const mixed: Request[] = [];
    for (let i = 0; i < 250; i++) { const s = f.salons[i % 5]!; const sequence = Math.floor(i / 5); const employeeId = s.employeeIds[Math.floor((sequence % 60) / 12)]!; mixed.push({ method: "POST", path: "/api/appointments", cookie: f.sessions[i]!, body: { salonId: s.id, serviceId: s.serviceA, employeeId, date: date(25), startTime: hourly(sequence % 12), notes: marker } }); mixed.push(group(s, date(26), (i % 5) * 8, f.sessions[250 + i]!)); mixed.push({ method: "POST", path: `/api/appointments/${createdIds[i]}/cancel`, cookie: f.sessions[i]!, body: {} }); mixed.push({ method: "POST", path: `/api/salons/${s.id}/grouped-availability`, cookie: f.sessions[i]!, body: { treatments: [{ serviceId: s.serviceA, employeeId }, { serviceId: s.serviceB, employeeId }], fromDate: date(27), toDate: date(27), allowMultipleDays: false } }); }
    const mixedResult = await scenario("mixed-1000", mixed); report.scenarios.push(strip(mixedResult)); assert.equal(mixedResult.unexpectedErrors, 0); assert.equal(mixedResult.timeouts, 0);
    const mixedStatuses = mixedResult.results;
    assert.equal(mixedStatuses.filter((_: any, index: number) => index % 4 === 0 && _.status === 201).length, 250, "mixed single bookings must succeed");
    assert.equal(mixedStatuses.filter((_: any, index: number) => index % 4 === 2 && _.status === 200).length, 250, "mixed customer cancellations must succeed");
    assert.equal(mixedStatuses.filter((_: any, index: number) => index % 4 === 3 && _.status === 200).length, 250, "mixed availability reads must succeed");
    assert.equal(mixedStatuses.filter((_: any, index: number) => index % 4 === 1 && _.status === 201).length, 5, "mixed groups must persist exactly one winner per salon");
    assert.equal(mixedStatuses.filter((_: any, index: number) => index % 4 === 1 && _.status === 409).length, 245, "mixed groups must reject every duplicate layout");
    const cancelledRows = await db.select({ id: appointmentsTable.id, status: appointmentsTable.status }).from(appointmentsTable).where(inArray(appointmentsTable.id, createdIds));
    assert.equal(cancelledRows.length, 250, "mixed cancellation audit must find every target");
    assert.ok(cancelledRows.every((row) => row.status === "cancelled"), "mixed cancellation targets must all be cancelled");
    const mixedSingles = await db.execute(sql`select count(*)::int as total from appointments where notes=${marker} and booking_group_id is null and appointment_date=${date(25)}`);
    assert.equal(Number(mixedSingles.rows[0]?.total), 250, "mixed single-booking audit must find 250 rows");
    const finalPartial = await db.execute(sql`select g.id from booking_groups g left join appointments a on a.booking_group_id=g.id where g.notes=${marker} group by g.id having count(a.id) <> 2`);
    const finalCrossCustomer = await db.execute(sql`select g.id from booking_groups g join appointments a on a.booking_group_id=g.id where g.notes=${marker} and a.customer_id is distinct from g.customer_id`);
    const finalGroups = await db.execute(sql`select count(*)::int as total from booking_groups where notes=${marker}`);
    assert.equal(finalPartial.rows.length, 0, "mixed load must not create partial groups");
    assert.equal(finalCrossCustomer.rows.length, 0, "mixed load must not leak appointments across customers");
    assert.equal(Number(finalGroups.rows[0]?.total), 131, "final group audit must find every expected winner");
    assert.equal(await activeMarkerOverlapCount(), 0, "mixed load must not create active overlaps");
    const plans = await db.execute(sql`explain (analyze, buffers, format json) select * from appointments where salon_id=${first.id} and appointment_date=${date(2)} and employee_id=${first.employeeIds[0]} and status in ('pending','confirmed') and start_time < '10:00' and end_time > '09:00'`);
    const availabilityPlan = await db.execute(sql`explain (analyze, buffers, format json) select employee_id, start_time, end_time from appointments where salon_id=${first.id} and appointment_date between ${date(2)} and ${date(5)} and status in ('pending','confirmed') order by employee_id, appointment_date`);
    report.plans.push(planSummary("appointment overlap", plans.rows[0]), planSummary("availability loaded appointments", availabilityPlan.rows[0]));
    report.planAssessment = {
      target: "Both booking overlap and availability reads use an index-backed plan with execution time <= 50 ms.",
      passed: report.plans.every((plan: any) => plan.summary.executionMs <= 50 && plan.summary.indexes.length > 0 && !plan.summary.nodes.includes("Seq Scan")),
    };
    const missedCustomerObjectives = report.scenarios.filter((item: any) => !item.objective.passed).map((item: any) => item.name);
    const missedOperationalObjectives = report.scenarios.filter((item: any) => !item.operationalObjective.passed).map((item: any) => item.name);
    const missedScenarios = report.scenarios.filter((item: any) => !item.objective.passed || !item.operationalObjective.passed);
    report.bottleneckAssessments = missedScenarios.map((item: any) => bottleneckAssessment(item, report.planAssessment.passed));
    report.integrity = {
      sameSlotActive: collisionRows.length,
      distinctAppointments: Number(distinctAudit.rows[0]?.total),
      distinctCustomers: Number(distinctAudit.rows[0]?.customers),
      cancelledAppointments: cancelledRows.filter((row) => row.status === "cancelled").length,
      mixedSingleAppointments: Number(mixedSingles.rows[0]?.total),
      successfulBookingGroups: Number(finalGroups.rows[0]?.total),
      partialGroups: finalPartial.rows.length,
      crossCustomerRows: finalCrossCustomer.rows.length,
      activeOverlaps: await activeMarkerOverlapCount(),
      markerOwned: true,
    };
    if (report.optimization) {
      report.optimization.evidenceAfter = {
        report: `${reportName}.json`,
        marker,
        configuration: report.configuration,
        scenario: "1000-distinct",
        statuses: distinct.statuses,
        codes: distinct.codes,
        timeouts: distinct.timeouts,
        unexpectedErrors: distinct.unexpectedErrors,
        latency: distinct.latency,
        poolPeaks: distinct.dbActivity.apiPools,
      };
      if (reportName === "staging-capacity") {
        const admitted = distinct.statuses["201"] ?? 0;
        const rejected = distinct.statuses["429"] ?? 0;
        report.admissionAssessment = {
          configuredMaximumInFlightPerProcess: bookingAdmissionPerProcess,
          admitted,
          rejected,
          overloadStatus: 429,
          overloadCode: "BOOKING_CAPACITY",
          approvedMaximumRejections: 0,
          productionEnabledByDefault: false,
          availabilityCheckPassed: rejected === 0,
          admittedDatabaseStatementsPerBooking: distinct.databaseStatements.total / admitted,
          conclusion: distinct.objective.passed && rejected === 0
            ? "All 1,000 arrivals were admitted and completed within the latency and error objectives; production admission remains disabled because it is no longer required for this profile."
            : rejected
              ? "Capacity rejections exceed the approved budget of zero and therefore fail the customer objective."
              : "The all-admitted profile is still too slow to guarantee the 10-second response target.",
        };
        report.optimizationDecision = distinct.objective.passed && rejected === 0
          ? "The optimized all-admitted path completed every arrival below the p95/p99 limits with zero unexpected errors and no increase to the 35-connection budget. Admission remains disabled by default."
          : rejected
            ? `The profile rejected ${rejected} arrivals, exceeding the approved rejection budget of zero.`
            : "The all-admitted profile did not meet the 10-second objective.";
      } else {
        report.optimizationDecision = "Applied only the measured pool-acquisition timeout fix. The complete 30-second run then passed without timeout, 5xx, duplicate active slots, partial groups, or cross-customer leakage. Pool size remains unchanged because increasing database connections without a connection budget would be unsafe.";
      }
    } else {
      const missed = missedScenarios.map((item: any) => item.name);
      report.optimizationDecision = missed.length
        ? `Targets missed for ${missed.join(", ")}. ${report.bottleneckAssessments.map((item: any) => item.verdict).join(" ")}`
        : "All latency and error objectives passed. Query plans were index-backed, so no query reduction, bounded admission control, or database connection increase is justified by this run.";
    }
    assert.deepEqual(missedCustomerObjectives, [], `customer latency/error objectives missed: ${missedCustomerObjectives.join(", ")}`);
    assert.deepEqual(missedOperationalObjectives, [], `throughput/pool/lock objectives missed: ${missedOperationalObjectives.join(", ")}`);
    assert.equal(report.planAssessment.passed, true, "booking and availability query plans must remain index-backed and within budget");
  } catch (error) {
    failure = error;
    report.failure = error instanceof Error ? error.message : String(error);
    report.optimizationDecision = report.scenarios.some((item: any) => item.objective && !item.objective.passed)
      ? "A customer objective was missed. No production change is allowed until controlled query-reduction and bounded-admission variants identify the bottleneck without violating the error target."
      : "No production optimization applied because the baseline did not complete; correctness assertions were not weakened.";
  }
  finally {
    await mkdir(reportPath, { recursive: true });
    await writeFile(path.join(reportPath, `${reportName}.json`), JSON.stringify(report, null, 2) + "\n");
    await writeFile(path.join(reportPath, `${reportName}.md`), `# Booking load report\n\n${report.environment}\n\nConfiguration and connection budget: \`${JSON.stringify(report.configuration)}\`; request timeout: ${report.requestTimeoutMs} ms.\n\n## Objectives\n\n${report.objectives.rationale}\n\nCustomer objectives: \`${JSON.stringify(report.objectives.scenarios)}\`\n\nOperational objectives: \`${JSON.stringify(report.objectives.operationalScenarios)}\`\n\n${report.scenarios.map((s: any) => `## ${s.name}\n\n- Requests: ${s.count}; throughput: ${s.throughputPerSecond.toFixed(1)} req/s\n- Statuses: \`${JSON.stringify(s.statuses)}\`; codes: \`${JSON.stringify(s.codes)}\`\n- Expected 409: ${s.statuses["409"] ?? 0}; unexpected errors: ${s.unexpectedErrors}; timeouts: ${s.timeouts}\n- Latency ms: avg ${s.latency.average.toFixed(2)}, p50 ${s.latency.p50.toFixed(2)}, p95 ${s.latency.p95.toFixed(2)}, p99 ${s.latency.p99.toFixed(2)}, max ${s.latency.max.toFixed(2)}\n- Database statements: ${s.databaseStatements.total} total; ${s.databaseStatements.perRequest.toFixed(2)} per request; per API process \`${JSON.stringify(s.databaseStatements.perProcess)}\`\n- Customer objective: **${s.objective.passed ? "PASS" : "FAIL"}** \`${JSON.stringify(s.objective)}\`\n- Operational objective: **${s.operationalObjective.passed ? "PASS" : "FAIL"}** \`${JSON.stringify(s.operationalObjective)}\`\n- DB activity peaks: \`${JSON.stringify(s.dbActivity.pg)}\`\n- API pool peaks: \`${JSON.stringify(s.dbActivity.apiPools)}\` (${s.dbActivity.sampleCount} samples; ${s.dbActivity.samplingErrors} discarded)`).join("\n\n")}\n\n## Integrity\n\n\`${JSON.stringify(report.integrity)}\`\n\n## Query plans\n\n${report.plans.map((p: any) => `- ${p.query}: \`${JSON.stringify(p.summary)}\``).join("\n")}\n\nPlan assessment: **${report.planAssessment?.passed ? "PASS" : "FAIL"}** — ${report.planAssessment?.target ?? "not completed"}\n\n## Bottleneck assessments\n\n\`${JSON.stringify(report.bottleneckAssessments)}\`\n\n## Optimization decision\n\n${report.optimization ? `- Change: ${report.optimization.change}\n- Before: \`${JSON.stringify(report.optimization.evidenceBefore)}\`\n${report.optimization.evidenceAfter ? `- After: \`${JSON.stringify(report.optimization.evidenceAfter)}\`\n` : ""}` : ""}\n${report.optimizationDecision}\n${report.failure ? `\n## Failure\n\n${report.failure}\n` : ""}`);
  }
  if (failure) throw failure;
}
function strip(result: any) { const { results, ...summary } = result; return summary; }
function appointmentResponseId(sample: HttpLoadSample): string {
  assert.ok(sample.body && typeof sample.body === "object" && "id" in sample.body && typeof sample.body.id === "string", "appointment response must contain an id");
  return sample.body.id;
}
async function activeMarkerOverlapCount() {
  const result = await db.execute(sql`
    select count(*)::int as total
    from appointments a
    join appointments b on a.id < b.id
      and a.salon_id = b.salon_id
      and a.employee_id = b.employee_id
      and a.appointment_date = b.appointment_date
      and a.start_time < b.end_time
      and a.end_time > b.start_time
    where a.notes=${marker} and b.notes=${marker}
      and a.status in ('pending', 'confirmed')
      and b.status in ('pending', 'confirmed')
  `);
  return Number(result.rows[0]?.total ?? 0);
}
function summarizeActivity(samples: ActivitySample[], samplingErrors: number) {
  const statePeaks: Record<string, number> = {};
  const lockPeaks: Record<string, number> = {};
  for (const sample of samples) {
    for (const state of sample.states) statePeaks[state.state] = Math.max(statePeaks[state.state] ?? 0, state.count);
    for (const lock of sample.locks) lockPeaks[lock.mode] = Math.max(lockPeaks[lock.mode] ?? 0, lock.count);
  }
  return {
    sampleCount: samples.length,
    samplingErrors,
    pg: {
      scope: "All connections and locks for the disposable database, including the harness sampler.",
      activityStateTelemetry: Object.keys(statePeaks).every((state) => state === "disabled") ? "unavailable: managed PostgreSQL reported state tracking as disabled" : "available",
      statePeaks,
      lockPeaks,
    },
    apiPools: urls.map((_, index) => {
      const values = samples.map((sample) => sample.apiPools[index]).filter((value): value is NonNullable<typeof value> => value !== null);
      return {
        observedSamples: values.length,
        configuredMax: Math.max(0, ...values.map((value) => value.max)),
        peakTotal: Math.max(0, ...values.map((value) => value.total)),
        peakWaiting: Math.max(0, ...values.map((value) => value.waiting)),
        minimumIdle: values.length ? Math.min(...values.map((value) => value.idle)) : null,
      };
    }),
  };
}
async function readBaselineReport() {
  try {
    const baseline = JSON.parse(await readFile(path.join(reportPath, "baseline-pool-timeout.json"), "utf8")) as {
      marker?: string;
      failure?: string;
      configuration?: { dbConnectionTimeoutMs?: number };
      scenarios?: Array<{
        name?: string;
        statuses?: Record<string, number>;
        codes?: Record<string, number>;
        timeouts?: number;
        unexpectedErrors?: number;
        latency?: unknown;
        dbActivity?: { apiPools?: unknown };
      }>;
    };
    const distinct = baseline.scenarios?.find((scenario) => scenario.name === "1000-distinct");
    if (!baseline.failure || baseline.configuration?.dbConnectionTimeoutMs !== 5_000 || !distinct || !distinct.unexpectedErrors) return null;
    return {
      report: "baseline-pool-timeout.json",
      marker: baseline.marker,
      configuration: baseline.configuration,
      scenario: distinct.name,
      statuses: distinct.statuses,
      codes: distinct.codes,
      timeouts: distinct.timeouts,
      unexpectedErrors: distinct.unexpectedErrors,
      latency: distinct.latency,
      poolPeaks: distinct.dbActivity?.apiPools,
    };
  } catch {
    return null;
  }
}
async function readAllAdmittedReport() {
  try {
    const report = JSON.parse(await readFile(path.join(reportPath, "staging-all-admitted.json"), "utf8")) as {
      configuration?: unknown;
      scenarios?: Array<{
        name?: string;
        statuses?: Record<string, number>;
        latency?: unknown;
        unexpectedErrors?: number;
        databaseStatements?: unknown;
        objective?: { passed?: boolean };
      }>;
      integrity?: unknown;
    };
    const distinct = report.scenarios?.find((scenario) => scenario.name === "1000-distinct");
    if (!distinct || distinct.statuses?.["201"] !== 1_000 || distinct.objective?.passed !== false) return null;
    return {
      report: "staging-all-admitted.json",
      configuration: report.configuration,
      scenario: distinct.name,
      statuses: distinct.statuses,
      latency: distinct.latency,
      unexpectedErrors: distinct.unexpectedErrors,
      databaseStatements: distinct.databaseStatements,
      integrity: report.integrity,
    };
  } catch {
    return null;
  }
}
function planSummary(query: string, row: any) {
  const plan = Object.values(row)[0] as any; const root = Array.isArray(plan) ? plan[0] : plan;
  const node = root?.Plan ?? {};
  const nodes: string[] = [];
  const indexes: string[] = [];
  const visit = (item: any) => {
    if (!item || typeof item !== "object") return;
    if (typeof item["Node Type"] === "string") nodes.push(item["Node Type"]);
    if (typeof item["Index Name"] === "string") indexes.push(item["Index Name"]);
    for (const child of item.Plans ?? []) visit(child);
  };
  visit(node);
  return { query, summary: { planningMs: root?.["Planning Time"], executionMs: root?.["Execution Time"], node: node["Node Type"], index: node["Index Name"] ?? null, nodes, indexes, actualRows: node["Actual Rows"], sharedHitBlocks: node["Shared Hit Blocks"] ?? 0, sharedReadBlocks: node["Shared Read Blocks"] ?? 0 }, raw: row };
}

function bottleneckAssessment(result: any, plansPassed: boolean) {
  const objective = targets[result.name]!;
  const requiredP95Throughput = result.count * 0.95 / (objective.p95Ms / 1_000);
  const requiredP99Throughput = result.count * 0.99 / (objective.p99Ms / 1_000);
  const requiredThroughput = Math.max(requiredP95Throughput, requiredP99Throughput);
  const maximumAllowedRejectedRequests = Math.floor(result.count * objective.maxUnexpectedErrorRate);
  const minimumRejectedToReachP95AtObservedThroughput = Math.max(0, Math.ceil(result.count * 0.95 - result.throughputPerSecond * (objective.p95Ms / 1_000)));
  const poolsSaturated = result.dbActivity.apiPools.every((pool: any) => pool.minimumIdle === 0 && pool.peakWaiting > 0);
  const admissionCanMeetErrorTarget = minimumRejectedToReachP95AtObservedThroughput <= maximumAllowedRejectedRequests;
  const queryReductionUpliftPercent = Math.max(0, (requiredThroughput / result.throughputPerSecond - 1) * 100);
  return {
    scenario: result.name,
    evidence: {
      observedThroughputPerSecond: result.throughputPerSecond,
      requiredP95ThroughputPerSecond: requiredP95Throughput,
      requiredP99ThroughputPerSecond: requiredP99Throughput,
      queryReductionUpliftPercent,
      poolsSaturated,
      plansIndexBackedAndFast: plansPassed,
      maximumAllowedRejectedRequests,
      minimumRejectedToReachP95AtObservedThroughput,
    },
    boundedAdmission: admissionCanMeetErrorTarget
      ? "could meet the latency objective within the error budget"
      : "cannot meet the latency objective by rejecting excess work without violating the error budget; queueing alone cannot increase throughput",
    queryReduction: poolsSaturated && plansPassed && result.throughputPerSecond < requiredThroughput
      ? "is the first bottleneck fix to test because service throughput must rise while indexed plans are individually fast and both pools are saturated"
      : "is not proven as the first bottleneck fix by this run",
    verdict: !admissionCanMeetErrorTarget && poolsSaturated && plansPassed && result.throughputPerSecond < requiredThroughput
      ? `Bounded admission is not a valid fix within the error target. Test query-count/round-trip reduction first; it needs at least ${queryReductionUpliftPercent.toFixed(1)}% throughput uplift before any production query change.`
      : "No bottleneck fix is proven; collect another controlled comparison before changing production behavior.",
  };
}
void main();