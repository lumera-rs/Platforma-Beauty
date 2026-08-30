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
import { classifyLoadSamples, latencySummary, type LoadSample } from "./booking-load-metrics";

const urls = (process.env.LUMERA_BOOKING_LOAD_URLS ?? "").split(",").filter((url) => /^http:\/\/127\.0\.0\.1:\d+$/.test(url));
if (process.env.NODE_ENV !== "test" || process.env.LUMERA_BOOKING_LOAD !== "1" || urls.length !== 2) throw new Error("Booking load suite requires two loopback test APIs.");
const marker = `booking-load-${process.pid}`;
const sessionCookieName = "lumera_session";
const reportPath = path.resolve(import.meta.dirname, "..", "..", "reports", "booking-load");
const requestTimeoutMs = 30_000;
const reportName = process.env.LUMERA_BOOKING_LOAD_REPORT_NAME ?? "latest";
if (!/^[a-z0-9-]+$/.test(reportName)) throw new Error("Invalid booking load report name.");
const dbConnectionTimeoutMs = Number(process.env.DB_CONN_TIMEOUT_MS ?? 15_000);
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
  try {
    const response = await fetch(`${urls[index % 2]}${request.path}`, { method: request.method, headers: { "content-type": "application/json", cookie: `${sessionCookieName}=${request.cookie}`, connection: "keep-alive" }, body: JSON.stringify(request.body), signal: controller.signal });
    const body = await response.json().catch(() => undefined);
    return { status: response.status, code: (body as { code?: string } | undefined)?.code, body, milliseconds: performance.now() - started, server: index % 2 };
  } catch (error) {
    return {
      timeout: error instanceof DOMException && error.name === "AbortError",
      code: "NETWORK",
      milliseconds: performance.now() - started,
      server: index % 2,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally { clearTimeout(timeout); }
}
async function scenario(name: string, requests: Request[]) {
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
  const unexpected = results.filter((result) => !result.status || result.status >= 500);
  return {
    name,
    count: results.length,
    throughputPerSecond: results.length / (elapsed / 1_000),
    ...classified,
    unexpectedErrors: unexpected.length,
    unexpectedSamples: unexpected.slice(0, 10).map(({ status, code, body, error, server }) => ({ status, code, body, error, server })),
    latency: latencySummary(results),
    dbActivity: summarizeActivity(samples, samplingErrors),
    results,
  };
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
  const report: any = {
    environment: "Development/test-only measurement on one disposable database and two loopback API processes; fixture/bootstrap time is excluded and results are not production capacity planning.",
    requestTimeoutMs,
    configuration: { apiProcesses: 2, poolMaxPerProcess: 10, dbConnectionTimeoutMs },
    marker,
    scenarios: [],
    integrity: {},
    plans: [],
    optimization: baseline ? {
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
    assert.equal(distinct.statuses["201"], 1000); assert.equal(distinct.unexpectedErrors, 0); assert.equal(distinct.timeouts, 0);
    const distinctAudit = await db.execute(sql`select count(*)::int as total, count(distinct customer_id)::int as customers from appointments where notes=${marker} and booking_group_id is null and appointment_date between ${date(2)} and ${date(6)}`);
    assert.equal(Number(distinctAudit.rows[0]?.total), 1000, "distinct-booking audit must find 1000 persisted appointments");
    assert.equal(Number(distinctAudit.rows[0]?.customers), 1000, "distinct-booking audit must find 1000 customers");
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
      report.optimizationDecision = "Applied only the measured pool-acquisition timeout fix. The complete 30-second run then passed without timeout, 5xx, duplicate active slots, partial groups, or cross-customer leakage. Pool size remains unchanged because increasing database connections without a connection budget would be unsafe.";
    } else {
      report.optimizationDecision = "This standalone configuration run completed without an optimization comparison.";
    }
  } catch (error) {
    failure = error;
    report.failure = error instanceof Error ? error.message : String(error);
    report.optimizationDecision = "No production optimization applied because the baseline did not complete; correctness assertions were not weakened.";
  }
  finally {
    await mkdir(reportPath, { recursive: true });
    await writeFile(path.join(reportPath, `${reportName}.json`), JSON.stringify(report, null, 2) + "\n");
    await writeFile(path.join(reportPath, `${reportName}.md`), `# Booking load report\n\n${report.environment}\n\nConfiguration: \`${JSON.stringify(report.configuration)}\`; request timeout: ${report.requestTimeoutMs} ms.\n\n${report.scenarios.map((s: any) => `## ${s.name}\n\n- Requests: ${s.count}; throughput: ${s.throughputPerSecond.toFixed(1)} req/s\n- Statuses: \`${JSON.stringify(s.statuses)}\`; codes: \`${JSON.stringify(s.codes)}\`\n- Expected 409: ${s.statuses["409"] ?? 0}; unexpected errors: ${s.unexpectedErrors}; timeouts: ${s.timeouts}\n- Latency ms: avg ${s.latency.average.toFixed(2)}, p50 ${s.latency.p50.toFixed(2)}, p95 ${s.latency.p95.toFixed(2)}, p99 ${s.latency.p99.toFixed(2)}, max ${s.latency.max.toFixed(2)}\n- DB activity peaks: \`${JSON.stringify(s.dbActivity.pg)}\`\n- API pool peaks: \`${JSON.stringify(s.dbActivity.apiPools)}\` (${s.dbActivity.sampleCount} samples; ${s.dbActivity.samplingErrors} discarded)`).join("\n\n")}\n\n## Integrity\n\n\`${JSON.stringify(report.integrity)}\`\n\n## Query plans\n\n${report.plans.map((p: any) => `- ${p.query}: \`${JSON.stringify(p.summary)}\``).join("\n")}\n\n## Optimization\n\n${report.optimization ? `- Change: ${report.optimization.change}\n- Before: \`${JSON.stringify(report.optimization.evidenceBefore)}\`\n${report.optimization.evidenceAfter ? `- After: \`${JSON.stringify(report.optimization.evidenceAfter)}\`\n` : ""}` : ""}\n${report.optimizationDecision}\n${report.failure ? `\n## Failure\n\n${report.failure}\n` : ""}`);
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
function planSummary(query: string, row: any) {
  const plan = Object.values(row)[0] as any; const root = Array.isArray(plan) ? plan[0] : plan;
  const node = root?.Plan ?? {}; return { query, summary: { planningMs: root?.["Planning Time"], executionMs: root?.["Execution Time"], node: node["Node Type"], index: node["Index Name"] ?? null, actualRows: node["Actual Rows"], sharedHitBlocks: node["Shared Hit Blocks"] ?? 0, sharedReadBlocks: node["Shared Read Blocks"] ?? 0 }, raw: row };
}
void main();