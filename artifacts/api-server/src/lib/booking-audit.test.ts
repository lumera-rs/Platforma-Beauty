/**
 * BOOKING FINAL — adversarial audit probes.
 *
 * This suite is an AUDIT INSTRUMENT, not a release gate. Each probe drives the
 * real HTTP routes against a real PostgreSQL database and then reads the
 * resulting rows back, because an HTTP status is not evidence: only the
 * database state is. A probe that detects an invalid state prints a
 * `BOOKING-Fn` line and records the finding; the process still exits 0 so the
 * report can be produced in one run rather than stopping at the first defect.
 *
 * It deliberately changes no production behaviour. When a finding is later
 * fixed in its own task, the corresponding probe flips to "no finding" and the
 * suite can then be promoted into a release phase.
 */
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
  appointmentsTable,
  customerNotificationsTable,
  db,
  employeeLocationAssignmentsTable,
  employeeLeaveRequestsTable,
  employeeServicesTable,
  employeeTimeOffTable,
  employeesTable,
  pool,
  salonBookingSettingsTable,
  salonDateHoursTable,
  salonHoursTable,
  salonNotificationsTable,
  salonsTable,
  servicesTable,
  shiftSwapRequestsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureBookingCommandSchema } from "./booking-command-schema";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";

const suffix = randomUUID().slice(0, 8);
const AUDIT_DATE = "2099-12-07";

type Finding = {
  id: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "RELIABILITY" | "UX";
  title: string;
  evidence: string;
};

const findings: Finding[] = [];
const probes: { name: string; outcome: "clean" | "finding" | "error"; detail: string }[] = [];

/** Evidence a probe wants in the report even when the invariant held. */
const notes: string[] = [];
function note(line: string): void {
  notes.push(line);
  console.log(`  note    ${line}`);
}

function record(finding: Finding): void {
  findings.push(finding);
}

async function probe(name: string, body: () => Promise<string | null>): Promise<void> {
  try {
    const detail = await body();
    probes.push({ name, outcome: detail ? "finding" : "clean", detail: detail ?? "invariant held" });
    console.log(`${detail ? "FINDING" : "CLEAN  "}  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    probes.push({ name, outcome: "error", detail });
    console.log(`ERROR    ${name} — ${detail}`);
  }
}

/**
 * A Belgrade wall-clock slot a few hours from now, kept inside 09:00-19:00 and
 * rolled to the next day when it would fall outside. Probes that exercise a
 * deadline measured against the real clock need a genuinely near-future
 * appointment; a year-2099 date would never be "late".
 */
function nearFutureSlot(hoursAhead: number): { date: string; startTime: string } {
  const belgrade = new Date(new Date(Date.now() + hoursAhead * 60 * 60 * 1000)
    .toLocaleString("en-US", { timeZone: "Europe/Belgrade" }));
  if (belgrade.getHours() < 9 || belgrade.getHours() > 18) {
    belgrade.setDate(belgrade.getDate() + (belgrade.getHours() > 18 ? 1 : 0));
    belgrade.setHours(10, 0, 0, 0);
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${belgrade.getFullYear()}-${pad(belgrade.getMonth() + 1)}-${pad(belgrade.getDate())}`,
    startTime: `${pad(belgrade.getHours())}:00`,
  };
}

/**
 * Books the first near-future slot the API accepts, reporting every attempt.
 * Probes that need a real appointment on the real clock must not fail because
 * one particular hour happened to be taken.
 */
async function bookFirstFreeNearFutureSlot(input: {
  baseUrl: string; session: string; salonId: string; serviceId: string; employeeId: string;
}): Promise<{ id: string | null; date: string; startTime: string; attempts: string[] }> {
  const attempts: string[] = [];
  let last = { date: "", startTime: "" };
  for (const hoursAhead of [4, 5, 6, 7, 8, 26, 27, 28]) {
    const slot = nearFutureSlot(hoursAhead);
    last = slot;
    const response = await fetch(`${input.baseUrl}/api/appointments`, {
      method: "POST",
      headers: {
        "content-type": "application/json", "idempotency-key": randomUUID(),
        cookie: `${sessionCookieName}=${input.session}`,
      },
      body: JSON.stringify({
        salonId: input.salonId, serviceId: input.serviceId, employeeId: input.employeeId,
        date: slot.date, startTime: slot.startTime,
      }),
    });
    const body = await response.json() as { id?: string };
    attempts.push(`${slot.date} ${slot.startTime}=${response.status}`);
    if (body.id) return { id: body.id, date: slot.date, startTime: slot.startTime, attempts };
  }
  return { id: null, date: last.date, startTime: last.startTime, attempts };
}

function email(role: string): string {
  return `booking-audit-${role}-${suffix}@example.test`;
}

type Fixture = {
  ownerId: string;
  ownerSession: string;
  customerId: string;
  customerSession: string;
  intruderId: string;
  intruderSession: string;
  rivalOwnerSession: string;
  salonAId: string;
  salonBId: string;
  employeeEId: string;
  employeeFId: string;
  serviceAId: string;
  serviceBId: string;
  /** A location deliberately created WITHOUT any `salon_hours` rows. */
  salonCId: string;
  employeeGId: string;
  serviceCId: string;
};

async function buildFixture(): Promise<Fixture> {
  const passwordHash = await hashPassword("BookingAudit2099!");
  const [owner] = await db.insert(usersTable).values({
    firstName: "Audit", lastName: "Owner", email: email("owner"),
    passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER",
  }).returning();
  const [customer] = await db.insert(usersTable).values({
    firstName: "Audit", lastName: "Customer", email: email("customer"),
    passwordHash, passwordSetAt: new Date(), role: "CUSTOMER",
  }).returning();
  const [intruder] = await db.insert(usersTable).values({
    firstName: "Audit", lastName: "Intruder", email: email("intruder"),
    passwordHash, passwordSetAt: new Date(), role: "CUSTOMER",
  }).returning();
  const [rivalOwner] = await db.insert(usersTable).values({
    firstName: "Audit", lastName: "Rival", email: email("rival"),
    passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER",
  }).returning();

  const salonRows = await db.insert(salonsTable).values([
    {
      ownerId: owner!.id, name: `Audit Salon A ${suffix}`, slug: `audit-salon-a-${suffix}`,
      city: "Beograd", municipality: "Vračar", address: "Audit 1", phone: "+381110000901",
      email: email("salon-a"), shortDescription: "Audit A", description: "Audit salon A",
      imageUrl: "/audit-a.jpg",
    },
    {
      ownerId: owner!.id, name: `Audit Salon B ${suffix}`, slug: `audit-salon-b-${suffix}`,
      city: "Beograd", municipality: "Savski venac", address: "Audit 2", phone: "+381110000902",
      email: email("salon-b"), shortDescription: "Audit B", description: "Audit salon B",
      imageUrl: "/audit-b.jpg",
    },
  ]).returning();
  const salonA = salonRows[0]!;
  const salonB = salonRows[1]!;

  await db.update(usersTable).set({ activeSalonId: salonA.id }).where(eq(usersTable.id, owner!.id));

  const [rivalSalon] = await db.insert(salonsTable).values({
    ownerId: rivalOwner!.id, name: `Audit Rival ${suffix}`, slug: `audit-rival-${suffix}`,
    city: "Niš", municipality: "Medijana", address: "Audit 3", phone: "+381110000903",
    email: email("salon-rival"), shortDescription: "Rival", description: "Rival salon",
    imageUrl: "/audit-rival.jpg",
  }).returning();
  await db.update(usersTable).set({ activeSalonId: rivalSalon!.id }).where(eq(usersTable.id, rivalOwner!.id));

  // Both locations open all week so opening hours never mask a finding.
  await db.insert(salonHoursTable).values(
    [salonA.id, salonB.id].flatMap((salonId) =>
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        salonId, weekday, openTime: "08:00", closeTime: "20:00", closed: false,
      }))),
  );

  const employeeRows = await db.insert(employeesTable).values([
    { salonId: salonA.id, name: `Audit Employee E ${suffix}`, role: "Frizer", bio: "Audit E", avatarUrl: "/audit-e.jpg", active: true },
    { salonId: salonA.id, name: `Audit Employee F ${suffix}`, role: "Frizer", bio: "Audit F", avatarUrl: "/audit-f.jpg", active: true },
  ]).returning();
  const employeeE = employeeRows[0]!;
  const employeeF = employeeRows[1]!;

  // E is a single person working at BOTH locations; F only at A.
  await db.insert(employeeLocationAssignmentsTable).values([
    { employeeId: employeeE.id, salonId: salonA.id, active: true, isDefault: true },
    { employeeId: employeeE.id, salonId: salonB.id, active: true, isDefault: false },
    { employeeId: employeeF.id, salonId: salonA.id, active: true, isDefault: true },
  ]);

  const [serviceA] = await db.insert(servicesTable).values({
    salonId: salonA.id, name: `Audit Service ${suffix}`, categoryName: "Frizerske usluge",
    description: "Audit service", durationMinutes: 60, price: 2000, imageUrl: "/audit-service.jpg",
  }).returning();
  await db.insert(employeeServicesTable).values([
    { employeeId: employeeE.id, serviceId: serviceA!.id },
    { employeeId: employeeF.id, serviceId: serviceA!.id },
  ]);

  // Salon B needs its own service: booking salon A's service into salon B would
  // fabricate a cross-tenant row the API itself would never write.
  const [serviceB] = await db.insert(servicesTable).values({
    salonId: salonB.id, name: `Audit Service B ${suffix}`, categoryName: "Frizerske usluge",
    description: "Audit service B", durationMinutes: 60, price: 2500, imageUrl: "/audit-service-b.jpg",
  }).returning();
  await db.insert(employeeServicesTable).values(
    { employeeId: employeeE.id, serviceId: serviceB!.id },
  );

  // Salon C exists on purpose with NO `salon_hours` and NO employee schedule:
  // it is the shape a real salon has the moment it is created, since there is
  // no write API for weekly opening hours.
  const [salonC] = await db.insert(salonsTable).values({
    ownerId: owner!.id, name: `Audit Salon C ${suffix}`, slug: `audit-salon-c-${suffix}`,
    city: "Novi Sad", municipality: "Stari grad", address: "Audit 4", phone: "+381110000904",
    email: email("salon-c"), shortDescription: "C", description: "Salon without opening hours",
    imageUrl: "/audit-c.jpg",
  }).returning();
  const [employeeG] = await db.insert(employeesTable).values({
    salonId: salonC!.id, name: `Audit Employee G ${suffix}`, role: "Frizer",
    bio: "Audit G", avatarUrl: "/audit-g.jpg", active: true,
  }).returning();
  await db.insert(employeeLocationAssignmentsTable).values(
    { employeeId: employeeG!.id, salonId: salonC!.id, active: true, isDefault: true },
  );
  const [serviceC] = await db.insert(servicesTable).values({
    salonId: salonC!.id, name: `Audit Service C ${suffix}`, categoryName: "Frizerske usluge",
    description: "Audit service C", durationMinutes: 60, price: 3000, imageUrl: "/audit-service-c.jpg",
  }).returning();
  await db.insert(employeeServicesTable).values(
    { employeeId: employeeG!.id, serviceId: serviceC!.id },
  );

  return {
    serviceBId: serviceB!.id,
    salonCId: salonC!.id,
    employeeGId: employeeG!.id,
    serviceCId: serviceC!.id,
    ownerId: owner!.id,
    ownerSession: await createSession(owner!.id),
    customerId: customer!.id,
    customerSession: await createSession(customer!.id),
    intruderId: intruder!.id,
    intruderSession: await createSession(intruder!.id),
    rivalOwnerSession: await createSession(rivalOwner!.id),
    salonAId: salonA.id,
    salonBId: salonB.id,
    employeeEId: employeeE.id,
    employeeFId: employeeF.id,
    serviceAId: serviceA!.id,
  };
}

/** Rows that put one employee in two places at the same wall-clock time. */
async function overlappingActiveAppointments(employeeId: string, date: string) {
  const rows = await db.select({
    id: appointmentsTable.id,
    salonId: appointmentsTable.salonId,
    startTime: appointmentsTable.startTime,
    endTime: appointmentsTable.endTime,
    status: appointmentsTable.status,
  }).from(appointmentsTable).where(and(
    eq(appointmentsTable.employeeId, employeeId),
    eq(appointmentsTable.date, date),
    ne(appointmentsTable.status, "cancelled"),
  ));
  const clashes: string[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i]!;
      const b = rows[j]!;
      if (a.startTime < b.endTime && a.endTime > b.startTime) {
        clashes.push(`${a.startTime}-${a.endTime}@${a.salonId.slice(0, 8)} vs ${b.startTime}-${b.endTime}@${b.salonId.slice(0, 8)}`);
      }
    }
  }
  return { rows, clashes };
}

async function run(): Promise<void> {
  await ensureBusinessGrowthSchema();
  await ensureBookingCommandSchema();

  const server = app.listen(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const fixture = await buildFixture();

    // ── A1 — shift-swap approval reassigns employees without the employee lock ──
    await probe("A1 shift-swap approval double-books an employee across locations", async () => {
      // Pre-existing state reachable through the normal flow: E is already
      // booked at salon B, and F is booked at salon A, at the same hour.
      await db.insert(appointmentsTable).values([
        {
          salonId: fixture.salonBId, customerId: fixture.customerId, employeeId: fixture.employeeEId,
          serviceId: fixture.serviceBId, date: AUDIT_DATE, startTime: "10:00", endTime: "11:00",
          durationMinutes: 60, price: 2500, status: "confirmed",
        },
        {
          salonId: fixture.salonAId, customerId: fixture.customerId, employeeId: fixture.employeeFId,
          serviceId: fixture.serviceAId, date: AUDIT_DATE, startTime: "10:00", endTime: "11:00",
          durationMinutes: 60, price: 2000, status: "confirmed",
        },
      ]);

      const before = await overlappingActiveAppointments(fixture.employeeEId, AUDIT_DATE);
      if (before.clashes.length) return `fixture already invalid: ${before.clashes.join("; ")}`;

      const [swap] = await db.insert(shiftSwapRequestsTable).values({
        salonId: fixture.salonAId,
        requesterEmployeeId: fixture.employeeFId,
        targetEmployeeId: fixture.employeeEId,
        swapDate: AUDIT_DATE,
        status: "pending_owner",
        colleagueRespondedAt: new Date(),
      }).returning();

      const response = await fetch(`${baseUrl}/api/salon/shift-swaps/${swap!.id}/review`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${sessionCookieName}=${fixture.ownerSession}`,
        },
        body: JSON.stringify({ approve: true }),
      });

      const after = await overlappingActiveAppointments(fixture.employeeEId, AUDIT_DATE);
      if (!after.clashes.length) return null;

      record({
        id: "BOOKING-F1",
        severity: "HIGH",
        title: "Shift-swap approval reassigns a salon-day without the employee lock or any revalidation",
        evidence:
          `POST /api/salon/shift-swaps/:id/review -> ${response.status}; employee ${fixture.employeeEId.slice(0, 8)} `
          + `now holds ${after.rows.length} active appointments on ${AUDIT_DATE}, overlapping: ${after.clashes.join("; ")}`,
      });
      return `HTTP ${response.status}; overlaps: ${after.clashes.join("; ")}`;
    });

    // ── A2 — a customer may hold two overlapping appointments ──
    await probe("A2 one customer can hold two overlapping appointments", async () => {
      const date = "2099-12-08";
      const created: string[] = [];
      for (const employeeId of [fixture.employeeEId, fixture.employeeFId]) {
        const response = await fetch(`${baseUrl}/api/appointments`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": randomUUID(),
            cookie: `${sessionCookieName}=${fixture.customerSession}`,
          },
          body: JSON.stringify({
            salonId: fixture.salonAId, serviceId: fixture.serviceAId, employeeId,
            date, startTime: "12:00",
          }),
        });
        created.push(String(response.status));
      }

      const rows = await db.select({
        id: appointmentsTable.id, startTime: appointmentsTable.startTime, endTime: appointmentsTable.endTime,
      }).from(appointmentsTable).where(and(
        eq(appointmentsTable.customerId, fixture.customerId),
        eq(appointmentsTable.date, date),
        ne(appointmentsTable.status, "cancelled"),
      ));
      const overlapping = rows.length > 1
        && rows.some((a) => rows.some((b) => a.id !== b.id && a.startTime < b.endTime && a.endTime > b.startTime));
      if (!overlapping) return null;

      record({
        id: "BOOKING-F2",
        severity: "MEDIUM",
        title: "No client-side occupancy check: one customer can be booked twice at the same time",
        evidence:
          `POST /api/appointments statuses ${created.join(",")}; customer ${fixture.customerId.slice(0, 8)} holds `
          + `${rows.length} overlapping appointments on ${date} at ${rows.map((row) => `${row.startTime}-${row.endTime}`).join(", ")}`,
      });
      return `${rows.length} overlapping rows for one customer`;
    });

    // ── A3 — customer reschedule notifies only once, ever ──
    await probe("A3 repeated customer reschedule stops notifying after the first move", async () => {
      const date = "2099-12-09";
      const create = await fetch(`${baseUrl}/api/appointments`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
          cookie: `${sessionCookieName}=${fixture.customerSession}`,
        },
        body: JSON.stringify({
          salonId: fixture.salonAId, serviceId: fixture.serviceAId, employeeId: fixture.employeeEId,
          date, startTime: "09:00",
        }),
      });
      if (create.status !== 201) return `setup failed: create returned ${create.status}`;
      const created = await create.json() as { id?: string; appointment?: { id?: string } };
      const appointmentId = created.id ?? created.appointment?.id;
      if (!appointmentId) return "setup failed: no appointment id in create response";

      for (const startTime of ["13:00", "14:00", "15:00"]) {
        await fetch(`${baseUrl}/api/appointments/${appointmentId}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            cookie: `${sessionCookieName}=${fixture.customerSession}`,
          },
          body: JSON.stringify({ startTime }),
        });
      }

      const [counted] = await db.select({ total: sql<number>`count(*)::int` })
        .from(customerNotificationsTable)
        .where(and(
          eq(customerNotificationsTable.userId, fixture.customerId),
          sql`${customerNotificationsTable.eventKey} like ${`appointment:${appointmentId}:updated:%`}`,
        ));
      const notifications = counted?.total ?? 0;
      const [current] = await db.select({ startTime: appointmentsTable.startTime })
        .from(appointmentsTable).where(eq(appointmentsTable.id, appointmentId));
      if (notifications >= 3) return null;

      record({
        id: "BOOKING-F3",
        severity: "MEDIUM",
        title: "Customer reschedule notifies only on the first move because updatedAt never changes",
        evidence:
          `3 successful reschedules of appointment ${appointmentId.slice(0, 8)} (now at ${current?.startTime}) produced `
          + `${notifications} customer notification(s); the event key embeds appointments.updated_at, which the `
          + `reschedule UPDATE never sets, so onConflictDoNothing swallows every later move`,
      });
      return `${notifications} notifications for 3 reschedules`;
    });

    // ── A4 — another customer attacking someone else's appointment ──
    await probe("A4 a stranger cannot read, move or cancel another customer's appointment", async () => {
      const date = "2099-12-10";
      const create = await fetch(`${baseUrl}/api/appointments`, {
        method: "POST",
        headers: {
          "content-type": "application/json", "idempotency-key": randomUUID(),
          cookie: `${sessionCookieName}=${fixture.customerSession}`,
        },
        body: JSON.stringify({
          salonId: fixture.salonAId, serviceId: fixture.serviceAId, employeeId: fixture.employeeEId,
          date, startTime: "09:00",
        }),
      });
      const victimId = (await create.json() as { id?: string }).id;
      if (!victimId) return `setup failed: create returned ${create.status}`;

      const before = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, victimId));
      const attacks: string[] = [];
      const move = await fetch(`${baseUrl}/api/appointments/${victimId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: `${sessionCookieName}=${fixture.intruderSession}` },
        body: JSON.stringify({ startTime: "17:00" }),
      });
      attacks.push(`PATCH=${move.status}`);
      const cancel = await fetch(`${baseUrl}/api/appointments/${victimId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${sessionCookieName}=${fixture.intruderSession}` },
        body: JSON.stringify({}),
      });
      attacks.push(`CANCEL=${cancel.status}`);
      const rival = await fetch(`${baseUrl}/api/salon/appointments/${victimId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: `${sessionCookieName}=${fixture.rivalOwnerSession}` },
        body: JSON.stringify({ notes: "owned by a rival salon" }),
      });
      attacks.push(`RIVAL_OWNER_PATCH=${rival.status}`);

      const after = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, victimId));
      const changed = JSON.stringify({ ...before[0], updatedAt: null }) !== JSON.stringify({ ...after[0], updatedAt: null });
      if (!changed) {
        note(`A4 rejections: ${attacks.join(", ")}`);
        return null;
      }

      record({
        id: "BOOKING-F13",
        severity: "HIGH",
        title: "Another actor mutated an appointment they do not own",
        evidence: `attacks ${attacks.join(", ")}; row changed from ${JSON.stringify(before[0])} to ${JSON.stringify(after[0])}`,
      });
      return `row mutated by a non-owner (${attacks.join(", ")})`;
    });

    // ── A5 — mass assignment and price/duration authority ──
    await probe("A5 client cannot dictate price, duration, status or ownership", async () => {
      const date = "2099-12-11";
      const response = await fetch(`${baseUrl}/api/appointments`, {
        method: "POST",
        headers: {
          "content-type": "application/json", "idempotency-key": randomUUID(),
          cookie: `${sessionCookieName}=${fixture.customerSession}`,
        },
        body: JSON.stringify({
          salonId: fixture.salonAId, serviceId: fixture.serviceAId, employeeId: fixture.employeeEId,
          date, startTime: "10:00",
          // none of these are in CreateAppointmentBody
          price: 1, durationMinutes: 5, duration: 5, status: "completed",
          customerId: fixture.intruderId, salonCustomerId: null,
          travelFee: 99999, createdAt: "2000-01-01T00:00:00.000Z",
        }),
      });
      const createdId = (await response.json() as { id?: string }).id;
      if (!createdId) return `create rejected with ${response.status} (nothing persisted)`;

      const [row] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, createdId));
      const [service] = await db.select().from(servicesTable).where(eq(servicesTable.id, fixture.serviceAId));
      const violations: string[] = [];
      if (row!.price !== service!.price) violations.push(`price ${row!.price} != service ${service!.price}`);
      if (row!.durationMinutes !== service!.durationMinutes) violations.push(`duration ${row!.durationMinutes} != service ${service!.durationMinutes}`);
      if (row!.status === "completed") violations.push("status accepted from the client");
      if (row!.customerId !== fixture.customerId) violations.push("customerId accepted from the client");
      if (row!.travelFee === 99999) violations.push("travelFee accepted from the client");
      if (!violations.length) {
        note(`A5 persisted price=${row!.price} duration=${row!.durationMinutes} status=${row!.status} `
          + `customer=${row!.customerId === fixture.customerId ? "session owner" : "CLIENT SUPPLIED"} travelFee=${row!.travelFee}`);
        return null;
      }

      record({
        id: "BOOKING-F14",
        severity: "HIGH",
        title: "Booking payload accepts scheduling- or money-critical fields from the client",
        evidence: `POST /api/appointments -> ${response.status}; persisted row violates: ${violations.join("; ")}`,
      });
      return violations.join("; ");
    });

    // ── A6 — idempotency key reuse with a different payload ──
    await probe("A6 same idempotency key with a changed payload must not replay", async () => {
      const key = randomUUID();
      const date = "2099-12-12";
      const send = (startTime: string) => fetch(`${baseUrl}/api/appointments`, {
        method: "POST",
        headers: {
          "content-type": "application/json", "idempotency-key": key,
          cookie: `${sessionCookieName}=${fixture.customerSession}`,
        },
        body: JSON.stringify({
          salonId: fixture.salonAId, serviceId: fixture.serviceAId, employeeId: fixture.employeeEId,
          date, startTime,
        }),
      });
      const first = await send("11:00");
      const firstBody = await first.json() as { id?: string };
      const second = await send("16:00");

      const rows = await db.select({ id: appointmentsTable.id, startTime: appointmentsTable.startTime })
        .from(appointmentsTable).where(and(
          eq(appointmentsTable.customerId, fixture.customerId),
          eq(appointmentsTable.date, date),
        ));
      const replayedAsIdentical = second.status >= 200 && second.status < 300
        && (await Promise.resolve((second.headers.get("idempotency-replayed") ?? "").toLowerCase())) === "true";
      if (second.status === 409 || (!replayedAsIdentical && rows.length <= 1)) {
        note(`A6 first=${first.status} second=${second.status} rows=${rows.length} `
          + `(${rows.map((row) => row.startTime).join(", ")})`);
        return rows.length === 1 ? null : `unexpected row count ${rows.length}`;
      }

      record({
        id: "BOOKING-F15",
        severity: "HIGH",
        title: "Idempotency key reuse with a different payload is treated as a retry",
        evidence: `first=${first.status} (${firstBody.id?.slice(0, 8)}), second=${second.status}, `
          + `replayed-header=${second.headers.get("idempotency-replayed")}, rows on ${date}: `
          + rows.map((row) => `${row.startTime}`).join(", "),
      });
      return `second=${second.status}, rows=${rows.length}`;
    });

    // ── A7 — the same raw key used by two different customers ──
    // Receipts are scoped by (salon, actorType, actorId, key), so a shared raw
    // key must not make one customer's request collide with another's. The two
    // requests deliberately ask for DIFFERENT slots, otherwise a plain slot
    // conflict would mask the idempotency behaviour being probed.
    await probe("A7 one raw idempotency key used by two customers must not collide", async () => {
      const key = randomUUID();
      const date = "2099-12-13";
      const book = (session: string, startTime: string) => fetch(`${baseUrl}/api/appointments`, {
        method: "POST",
        headers: {
          "content-type": "application/json", "idempotency-key": key,
          cookie: `${sessionCookieName}=${session}`,
        },
        body: JSON.stringify({
          salonId: fixture.salonAId, serviceId: fixture.serviceAId, employeeId: fixture.employeeFId,
          date, startTime,
        }),
      });
      const mine = await book(fixture.customerSession, "13:00");
      const theirs = await book(fixture.intruderSession, "15:00");
      const theirsReplayed = (theirs.headers.get("idempotency-replayed") ?? "").toLowerCase() === "true";
      const rows = await db.select({
        customerId: appointmentsTable.customerId,
        startTime: appointmentsTable.startTime,
      }).from(appointmentsTable).where(eq(appointmentsTable.date, date));
      const owner = (id: string | null) => (id === fixture.customerId ? "customer"
        : id === fixture.intruderId ? "intruder" : "other");
      const layout = rows.map((row) => `${row.startTime}:${owner(row.customerId)}`).sort().join(", ");

      const intruderGotTheirOwn = rows.some((row) =>
        row.customerId === fixture.intruderId && row.startTime === "15:00");
      if (theirs.status >= 200 && theirs.status < 300 && !theirsReplayed && intruderGotTheirOwn) {
        note(`A7 customer=${mine.status} intruder=${theirs.status}; rows on ${date}: ${layout}`);
        return null;
      }

      record({
        id: "BOOKING-F16",
        severity: theirsReplayed ? "HIGH" : "MEDIUM",
        title: theirsReplayed
          ? "Cross-actor idempotency replay returns another customer's appointment"
          : "A raw idempotency key already used by another customer blocks a legitimate booking",
        evidence: `POST /api/appointments customer=${mine.status}, intruder=${theirs.status} `
          + `replayed=${theirs.headers.get("idempotency-replayed")}; rows on ${date}: ${layout}`,
      });
      return `intruder=${theirs.status} replayed=${theirsReplayed}; rows: ${layout}`;
    });

    // ── C1 — a salon that has never had opening hours written ──
    await probe("C1 a salon with no opening hours must not be bookable around the clock", async () => {
      const date = "2099-12-14";
      const attempts: string[] = [];
      // 03:00 and 23:00 fall outside the fallback too, so they prove nothing on
      // their own; 10:00 is the one that lands inside the hard-coded window.
      for (const startTime of ["03:00", "10:00", "23:00"]) {
        const response = await fetch(`${baseUrl}/api/appointments`, {
          method: "POST",
          headers: {
            "content-type": "application/json", "idempotency-key": randomUUID(),
            cookie: `${sessionCookieName}=${fixture.customerSession}`,
          },
          body: JSON.stringify({
            salonId: fixture.salonCId, serviceId: fixture.serviceCId,
            employeeId: fixture.employeeGId, date, startTime,
          }),
        });
        attempts.push(`${startTime}=${response.status}`);
      }
      const rows = await db.select({ startTime: appointmentsTable.startTime })
        .from(appointmentsTable).where(and(
          eq(appointmentsTable.salonId, fixture.salonCId),
          eq(appointmentsTable.date, date),
        ));
      if (!rows.length) {
        note(`C1 salon without salon_hours rejected out-of-hours bookings (${attempts.join(", ")})`);
        return null;
      }

      record({
        id: "BOOKING-F5",
        severity: "MEDIUM",
        title: "A salon with no opening hours falls back to a hard-coded 09:00-18:00 window instead of being closed",
        evidence: `salon ${fixture.salonCId} has zero salon_hours rows and there is no write API to add any; `
          + `locationWindows() (availability-engine.ts:110) returns [09:00-18:00] when none exist. `
          + `POST /api/appointments ${attempts.join(", ")}; `
          + `persisted start times on ${date}: ${rows.map((row) => row.startTime).join(", ")}`,
      });
      return `${rows.length} booking(s) accepted outside any configured hours (${attempts.join(", ")})`;
    });

    // ── C2 — an employee who has no working schedule at all ──
    await probe("C2 an employee with no schedule must not be treated as always available", async () => {
      const date = "2099-12-15";
      const response = await fetch(`${baseUrl}/api/appointments`, {
        method: "POST",
        headers: {
          "content-type": "application/json", "idempotency-key": randomUUID(),
          cookie: `${sessionCookieName}=${fixture.customerSession}`,
        },
        body: JSON.stringify({
          salonId: fixture.salonAId, serviceId: fixture.serviceAId,
          employeeId: fixture.employeeFId, date, startTime: "08:00",
        }),
      });
      const rows = await db.select({ id: appointmentsTable.id }).from(appointmentsTable).where(and(
        eq(appointmentsTable.employeeId, fixture.employeeFId),
        eq(appointmentsTable.date, date),
      ));
      if (!rows.length) {
        note(`C2 employee without a schedule was not bookable (HTTP ${response.status})`);
        return null;
      }

      record({
        id: "BOOKING-F6",
        severity: "MEDIUM",
        title: "An employee with no working schedule is bookable for the whole salon opening window",
        evidence: `employee ${fixture.employeeFId} has no employee_schedules rows for ${date}; `
          + `POST /api/appointments -> ${response.status}; ${rows.length} row(s) persisted`,
      });
      return `HTTP ${response.status}; employee availability defaults to open`;
    });

    // ── C3 — minimum lead time ──
    await probe("C3 minimum lead time must reject a booking made too close to the start", async () => {
      await db.insert(salonBookingSettingsTable)
        .values({ salonId: fixture.salonAId, minimumLeadTimeMinutes: 1440 })
        .onConflictDoUpdate({
          target: salonBookingSettingsTable.salonId,
          set: { minimumLeadTimeMinutes: 1440 },
        });
      // A few hours out is always inside a 24 h lead-time window.
      const { date, startTime } = nearFutureSlot(4);
      const response = await fetch(`${baseUrl}/api/appointments`, {
        method: "POST",
        headers: {
          "content-type": "application/json", "idempotency-key": randomUUID(),
          cookie: `${sessionCookieName}=${fixture.customerSession}`,
        },
        body: JSON.stringify({
          salonId: fixture.salonAId, serviceId: fixture.serviceAId,
          employeeId: fixture.employeeFId, date, startTime,
        }),
      });
      // Scoped to this fixture's employee: the seeded demo data owns unrelated
      // rows on the same calendar date.
      const rows = await db.select({ id: appointmentsTable.id }).from(appointmentsTable).where(and(
        eq(appointmentsTable.employeeId, fixture.employeeFId),
        eq(appointmentsTable.date, date),
      ));
      await db.update(salonBookingSettingsTable).set({ minimumLeadTimeMinutes: 0 })
        .where(eq(salonBookingSettingsTable.salonId, fixture.salonAId));
      if (!rows.length) {
        note(`C3 lead time 1440 rejected a booking for ${date} ${startTime} (HTTP ${response.status})`);
        return null;
      }

      record({
        id: "BOOKING-F17",
        severity: "HIGH",
        title: "minimum_lead_time_minutes is not enforced on the booking endpoint",
        evidence: `salon_booking_settings.minimum_lead_time_minutes = 1440; `
          + `POST /api/appointments for ${date} ${startTime} -> ${response.status}; ${rows.length} row(s) persisted`,
      });
      return `HTTP ${response.status} with ${rows.length} row(s) inside the lead-time window`;
    });

    // ── C4 — a stored cancellation deadline of 0 ──
    await probe("C4 a stored cancellation deadline of 0 must mean no deadline", async () => {
      await db.insert(salonBookingSettingsTable)
        .values({ salonId: fixture.salonAId, cancellationDeadlineMinutes: 0 })
        .onConflictDoUpdate({
          target: salonBookingSettingsTable.salonId,
          set: { cancellationDeadlineMinutes: 0 },
        });
      const booked = await bookFirstFreeNearFutureSlot({
        baseUrl, session: fixture.customerSession, salonId: fixture.salonAId,
        serviceId: fixture.serviceAId, employeeId: fixture.employeeFId,
      });
      const { id: bookingId, date, startTime } = booked;
      if (!bookingId) return `setup failed: no near-future slot was bookable (${booked.attempts.join(", ")})`;
      const before = await db.select({ id: salonNotificationsTable.id }).from(salonNotificationsTable)
        .where(eq(salonNotificationsTable.salonId, fixture.salonAId));
      const cancel = await fetch(`${baseUrl}/api/appointments/${bookingId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${sessionCookieName}=${fixture.customerSession}` },
        body: JSON.stringify({}),
      });
      const after = await db.select({ title: salonNotificationsTable.title }).from(salonNotificationsTable)
        .where(eq(salonNotificationsTable.salonId, fixture.salonAId));
      const lateFlags = after.filter((row) => row.title.includes("Kasno otkazivanje")).length;
      const [row] = await db.select({ status: appointmentsTable.status })
        .from(appointmentsTable).where(eq(appointmentsTable.id, bookingId));
      note(`C4 cancel=${cancel.status}, status=${row?.status}, salon notifications ${before.length} -> ${after.length}`);
      if (!lateFlags) return null;

      record({
        id: "BOOKING-F7",
        severity: "MEDIUM",
        title: "cancellation_deadline_minutes = 0 is silently read as 1440",
        evidence: `stored deadline 0 (also the column default); supportedCancellationDeadline() only accepts `
          + `{720, 1440, 2880} and falls back to 1440, so cancelling ${date} ${startTime} raised `
          + `${lateFlags} "Kasno otkazivanje" salon notification(s) on a salon that configured no deadline`,
      });
      return `${lateFlags} late-cancellation notification(s) despite a stored deadline of 0`;
    });

    // ── C5 — does the deadline block anything at all? ──
    await probe("C5 the cancellation deadline is enforced, not merely reported", async () => {
      await db.insert(salonBookingSettingsTable)
        .values({ salonId: fixture.salonAId, cancellationDeadlineMinutes: 2880 })
        .onConflictDoUpdate({
          target: salonBookingSettingsTable.salonId,
          set: { cancellationDeadlineMinutes: 2880 },
        });
      const booked = await bookFirstFreeNearFutureSlot({
        baseUrl, session: fixture.customerSession, salonId: fixture.salonAId,
        serviceId: fixture.serviceAId, employeeId: fixture.employeeEId,
      });
      const { id: bookingId, date, startTime } = booked;
      if (!bookingId) return `setup failed: no near-future slot was bookable (${booked.attempts.join(", ")})`;
      const cancel = await fetch(`${baseUrl}/api/appointments/${bookingId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${sessionCookieName}=${fixture.customerSession}` },
        body: JSON.stringify({}),
      });
      const [row] = await db.select({ status: appointmentsTable.status })
        .from(appointmentsTable).where(eq(appointmentsTable.id, bookingId));
      await db.update(salonBookingSettingsTable).set({ cancellationDeadlineMinutes: 0 })
        .where(eq(salonBookingSettingsTable.salonId, fixture.salonAId));
      if (row?.status !== "cancelled") {
        note(`C5 cancel inside a 48 h deadline -> ${cancel.status}, status=${row?.status}`);
        return null;
      }
      note(`C5 appointment ${date} ${startTime}, deadline 2880 min, cancel -> ${cancel.status}`);

      record({
        id: "BOOKING-F10",
        severity: "LOW",
        title: "cancellation_deadline_minutes never blocks a cancellation; it only files a salon notification",
        evidence: `deadline 2880 minutes, appointment ${date} ${startTime} (hours away, well inside it); `
          + `POST /appointments/:id/cancel -> ${cancel.status} and the row is ${row?.status}`,
      });
      return `cancel inside the deadline succeeded (HTTP ${cancel.status}, status ${row?.status})`;
    });

    // ── C6 — replacing booking settings ──
    await probe("C6 saving booking settings must not silently delete unrelated date exceptions", async () => {
      await db.delete(salonDateHoursTable).where(eq(salonDateHoursTable.salonId, fixture.salonAId));
      await db.insert(salonDateHoursTable).values({
        salonId: fixture.salonAId, date: "2099-12-25", closed: true,
        openTime: null, closeTime: null, reason: "Božić",
      });
      const settings = await fetch(`${baseUrl}/api/salon/booking-settings`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: `${sessionCookieName}=${fixture.ownerSession}` },
        body: JSON.stringify({
          slotGranularityMinutes: 15, minimumLeadTimeMinutes: 0, cancellationDeadlineMinutes: 1440,
          reminderOffsetsMinutes: [], reminderChannels: [], maxVisitGapMinutes: 0,
          minimumUsefulLateTreatmentMinutes: 0, dateHours: [], resourceDowntime: [],
        }),
      });
      const remaining = await db.select({ date: salonDateHoursTable.date })
        .from(salonDateHoursTable).where(eq(salonDateHoursTable.salonId, fixture.salonAId));
      if (remaining.length) {
        note(`C6 date exceptions survived a settings save (HTTP ${settings.status}): ${remaining.map((row) => row.date).join(", ")}`);
        return null;
      }

      record({
        id: "BOOKING-F8",
        severity: "MEDIUM",
        title: "PUT /api/salon/booking-settings deletes every date exception the request does not resend",
        evidence: `salon_date_hours held 2099-12-25 (closed); a settings save with dateHours: [] `
          + `-> HTTP ${settings.status} and 0 rows remain. The handler runs `
          + `DELETE FROM salon_date_hours WHERE salon_id = ... then re-inserts only the payload`,
      });
      return `a settings save with an empty dateHours array wiped the stored exception (HTTP ${settings.status})`;
    });

    // ── C7 — service edits after a booking ──
    await probe("C7 editing a service must not retroactively change booked appointments", async () => {
      const date = "2099-12-16";
      const create = await fetch(`${baseUrl}/api/appointments`, {
        method: "POST",
        headers: {
          "content-type": "application/json", "idempotency-key": randomUUID(),
          cookie: `${sessionCookieName}=${fixture.customerSession}`,
        },
        body: JSON.stringify({
          salonId: fixture.salonAId, serviceId: fixture.serviceAId,
          employeeId: fixture.employeeFId, date, startTime: "12:00",
        }),
      });
      const bookingId = (await create.json() as { id?: string }).id;
      if (!bookingId) return `setup failed: create returned ${create.status}`;
      const [before] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, bookingId));
      await db.update(servicesTable).set({ durationMinutes: 180, price: 99000 })
        .where(eq(servicesTable.id, fixture.serviceAId));
      const [after] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, bookingId));
      await db.update(servicesTable).set({ durationMinutes: 60, price: 2000 })
        .where(eq(servicesTable.id, fixture.serviceAId));
      const drifted = before!.price !== after!.price
        || before!.durationMinutes !== after!.durationMinutes
        || before!.endTime !== after!.endTime;
      if (!drifted) {
        note(`C7 booked snapshot held: price=${after!.price} duration=${after!.durationMinutes} `
          + `window=${after!.startTime}-${after!.endTime} after the service changed to 180 min / 99000`);
        return null;
      }

      record({
        id: "BOOKING-F18",
        severity: "HIGH",
        title: "Editing a service rewrites appointments that were already booked",
        evidence: `before ${JSON.stringify({ price: before!.price, duration: before!.durationMinutes, end: before!.endTime })} `
          + `after ${JSON.stringify({ price: after!.price, duration: after!.durationMinutes, end: after!.endTime })}`,
      });
      return "the stored appointment followed the edited service";
    });

    // ── D1 — the marketplace "first available" card vs the booking endpoint ──
    // The salon directory advertises a slot from computeFirstAvailableServiceSlots
    // (marketplace.ts:1732), a second availability implementation that walks a
    // hard-coded `for (hour = 9; hour < 18)` loop. It never reads salon_hours.
    await probe("D1 the advertised first-available slot must be bookable", async () => {
      // Salon B trades only 12:00-14:00, which the canonical engine honours.
      await db.delete(salonHoursTable).where(eq(salonHoursTable.salonId, fixture.salonBId));
      await db.insert(salonHoursTable).values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        salonId: fixture.salonBId, weekday, openTime: "12:00", closeTime: "14:00", closed: false,
      })));
      const advertised = await fetch(`${baseUrl}/api/salons/${fixture.salonBId}/first-available`);
      const payload = await advertised.json() as {
        services?: Array<{ serviceId: string; date: string | null; startTime: string | null }>;
      };
      const offer = payload.services?.find((entry) => entry.serviceId === fixture.serviceBId);
      if (!offer?.date || !offer.startTime) {
        note(`D1 no slot advertised for the 12:00-14:00 salon (HTTP ${advertised.status})`);
        return null;
      }

      const booking = await fetch(`${baseUrl}/api/appointments`, {
        method: "POST",
        headers: {
          "content-type": "application/json", "idempotency-key": randomUUID(),
          cookie: `${sessionCookieName}=${fixture.customerSession}`,
        },
        body: JSON.stringify({
          salonId: fixture.salonBId, serviceId: fixture.serviceBId, employeeId: fixture.employeeEId,
          date: offer.date, startTime: offer.startTime,
        }),
      });
      const insideHours = offer.startTime >= "12:00" && offer.startTime < "14:00";
      if (booking.status >= 200 && booking.status < 300 && insideHours) {
        note(`D1 advertised ${offer.date} ${offer.startTime} and it booked (HTTP ${booking.status})`);
        return null;
      }

      record({
        id: "BOOKING-F4",
        severity: "HIGH",
        title: "The salon directory advertises slots from a second availability implementation that ignores opening hours",
        evidence: `salon_hours for this location are 12:00-14:00 every day; `
          + `GET /api/salons/:id/first-available advertised ${offer.date} ${offer.startTime} `
          + `(${insideHours ? "inside" : "OUTSIDE"} the configured window) and `
          + `POST /api/appointments for that exact slot returned ${booking.status}. `
          + `computeFirstAvailableServiceSlots() scans a fixed 09:00-18:00 hourly grid and reads `
          + `neither salon_hours nor salon_date_hours, buffers, lead time or slot granularity`,
      });
      return `advertised ${offer.date} ${offer.startTime}, booking it returned ${booking.status}`;
    });

    // ── D2 — canonical availability vs what the booking endpoint accepts ──
    await probe("D2 every slot the availability API returns must be bookable", async () => {
      const date = "2099-12-18";
      const listed = await fetch(`${baseUrl}/api/salons/${fixture.salonAId}/availability`
        + `?serviceId=${fixture.serviceAId}&date=${date}&employeeId=${fixture.employeeFId}`);
      const slots = await listed.json() as Array<{ start: string; end: string; employeeId: string | null }>;
      if (!Array.isArray(slots) || !slots.length) {
        return `availability returned no slots (HTTP ${listed.status})`;
      }
      const rejected: string[] = [];
      // Probe the first, middle and last offered slot rather than all of them.
      for (const slot of [slots[0]!, slots[Math.floor(slots.length / 2)]!, slots[slots.length - 1]!]) {
        const booking = await fetch(`${baseUrl}/api/appointments`, {
          method: "POST",
          headers: {
            "content-type": "application/json", "idempotency-key": randomUUID(),
            cookie: `${sessionCookieName}=${fixture.customerSession}`,
          },
          body: JSON.stringify({
            salonId: fixture.salonAId, serviceId: fixture.serviceAId,
            employeeId: fixture.employeeFId, date, startTime: slot.start,
          }),
        });
        if (booking.status < 200 || booking.status >= 300) rejected.push(`${slot.start}=${booking.status}`);
      }
      if (!rejected.length) {
        note(`D2 ${slots.length} slots offered for ${date}; the sampled first/middle/last all booked`);
        return null;
      }

      record({
        id: "BOOKING-F19",
        severity: "HIGH",
        title: "The availability API offers slots the booking endpoint then refuses",
        evidence: `GET /api/salons/:id/availability for ${date} returned ${slots.length} slots `
          + `(${slots.map((slot) => slot.start).join(", ")}); POST /api/appointments rejected ${rejected.join(", ")}`,
      });
      return `offered slots rejected on booking: ${rejected.join(", ")}`;
    });

    // ── D3 — the employee shown in the preview vs the one who gets the work ──
    await probe("D3 the previewed employee must be the one actually booked", async () => {
      const date = "2099-12-19";
      const listed = await fetch(`${baseUrl}/api/salons/${fixture.salonAId}/availability`
        + `?serviceId=${fixture.serviceAId}&date=${date}`);
      const slots = await listed.json() as Array<{ start: string; employeeId: string | null; employeeName: string | null }>;
      const preview = slots?.[0];
      if (!preview?.employeeId) return `availability returned no attributed slot (HTTP ${listed.status})`;

      // Book without naming an employee, exactly as the preview implies.
      const booking = await fetch(`${baseUrl}/api/appointments`, {
        method: "POST",
        headers: {
          "content-type": "application/json", "idempotency-key": randomUUID(),
          cookie: `${sessionCookieName}=${fixture.customerSession}`,
        },
        body: JSON.stringify({
          salonId: fixture.salonAId, serviceId: fixture.serviceAId,
          date, startTime: preview.start,
        }),
      });
      const bookingId = (await booking.json() as { id?: string }).id;
      if (!bookingId) return `setup failed: booking the previewed slot returned ${booking.status}`;
      const [row] = await db.select({ employeeId: appointmentsTable.employeeId })
        .from(appointmentsTable).where(eq(appointmentsTable.id, bookingId));
      if (row?.employeeId === preview.employeeId) {
        note(`D3 preview and booking agree on employee ${preview.employeeId.slice(0, 8)} for ${date} ${preview.start}`);
        return null;
      }

      record({
        id: "BOOKING-F20",
        severity: "MEDIUM",
        title: "The employee named in the availability preview is not the one the booking assigns",
        evidence: `GET /api/salons/:id/availability offered ${date} ${preview.start} with `
          + `employee ${preview.employeeId} (${preview.employeeName}); booking that slot without naming an `
          + `employee persisted employee ${row?.employeeId}`,
      });
      return `preview ${preview.employeeId?.slice(0, 8)} vs booked ${row?.employeeId?.slice(0, 8)}`;
    });

    // ── E1 — approving leave over a day that already has customers booked ──
    await probe("E1 approving leave must not silently strand booked appointments", async () => {
      const date = "2099-12-20";
      const booked: string[] = [];
      for (const startTime of ["09:00", "11:00"]) {
        const response = await fetch(`${baseUrl}/api/appointments`, {
          method: "POST",
          headers: {
            "content-type": "application/json", "idempotency-key": randomUUID(),
            cookie: `${sessionCookieName}=${fixture.customerSession}`,
          },
          body: JSON.stringify({
            salonId: fixture.salonAId, serviceId: fixture.serviceAId,
            employeeId: fixture.employeeFId, date, startTime,
          }),
        });
        const id = (await response.json() as { id?: string }).id;
        if (id) booked.push(id);
      }
      if (booked.length !== 2) return `setup failed: only ${booked.length} of 2 appointments were booked`;

      const [request] = await db.insert(employeeLeaveRequestsTable).values({
        employeeId: fixture.employeeFId, startDate: date, endDate: date, reason: "Audit leave",
      }).returning();
      const review = await fetch(`${baseUrl}/api/salon/leave-requests/${request!.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: `${sessionCookieName}=${fixture.ownerSession}` },
        body: JSON.stringify({ status: "approved" }),
      });
      const stranded = await db.select({ id: appointmentsTable.id, status: appointmentsTable.status })
        .from(appointmentsTable).where(and(
          inArray(appointmentsTable.id, booked),
          inArray(appointmentsTable.status, ["pending", "confirmed"]),
        ));
      const [timeOff] = await db.select().from(employeeTimeOffTable)
        .where(and(
          eq(employeeTimeOffTable.employeeId, fixture.employeeFId),
          eq(employeeTimeOffTable.startDate, date),
        ));
      if (review.status < 200 || review.status >= 300 || !timeOff) {
        note(`E1 leave approval refused while appointments existed (HTTP ${review.status})`);
        return null;
      }
      if (!stranded.length) {
        note(`E1 leave approved (HTTP ${review.status}) and the day's appointments were handled`);
        return null;
      }

      record({
        id: "BOOKING-F9",
        severity: "MEDIUM",
        title: "Approving employee leave neither checks nor releases the appointments already booked that day",
        evidence: `employee ${fixture.employeeFId} had ${booked.length} active appointments on ${date}; `
          + `PATCH /api/salon/leave-requests/:id {status:"approved"} -> ${review.status} inserted an `
          + `employee_time_off row for that date and left ${stranded.length} appointment(s) `
          + `(${stranded.map((row) => row.status).join(", ")}) on an employee who is now off. `
          + `The handler (marketplace.ts:11561) only writes the time-off row. The time-off row also `
          + `carries no salon_id, so the block applies to every location the employee serves`,
      });
      return `${stranded.length} appointment(s) still active on an employee now marked off`;
    });

    // ── Final integrity scan across everything this run created ──
    await probe("Z1 no employee holds overlapping active appointments", async () => {
      const result = await db.execute(sql`
        select count(*)::int as clashes
        from appointments a
        join appointments b
          on a.employee_id = b.employee_id
         and a.appointment_date = b.appointment_date
         and a.id < b.id
         and a.start_time < b.end_time
         and a.end_time > b.start_time
        where a.status <> 'cancelled' and b.status <> 'cancelled'
          and a.employee_id is not null
      `);
      const clashes = Number((result.rows[0] as { clashes?: number } | undefined)?.clashes ?? 0);
      return clashes === 0 ? null : `${clashes} overlapping employee appointment pairs in the whole database`;
    });

    // ── Z2 — every "impossible state" query, expected 0 ──
    // Two scopes on purpose. `ensureDemoData()` inserts demo appointments
    // straight into the table without going through the booking path, so a
    // whole-database count says nothing about booking correctness. The findings
    // below are raised only from rows this run actually booked over HTTP; the
    // whole-database numbers are reported as context.
    await probe("Z2 no appointment booked through the API is in an impossible state", async () => {
      // `created_by_user_id` is written only by insertInitializedAppointmentInTx,
      // so this excludes both the demo seeder and the probes' own direct inserts.
      const auditRows = sql`select 1 from users u where u.id = a.customer_id
        and u.email like 'booking-audit-%' and a.created_by_user_id is not null`;
      const scans: Array<{ name: string; predicate: ReturnType<typeof sql> }> = [
        { name: "end_time <= start_time", predicate: sql`a.end_time <= a.start_time` },
        {
          name: "duration disagrees with the booked window",
          predicate: sql`a.duration_minutes <> (
            (split_part(a.end_time, ':', 1)::int * 60 + split_part(a.end_time, ':', 2)::int)
            - (split_part(a.start_time, ':', 1)::int * 60 + split_part(a.start_time, ':', 2)::int))`,
        },
        { name: "negative price or travel fee", predicate: sql`a.price < 0 or a.travel_fee < 0` },
        {
          name: "service belongs to another salon",
          predicate: sql`exists (select 1 from services s where s.id = a.service_id and s.salon_id <> a.salon_id)`,
        },
        {
          name: "employee not assigned to that location",
          predicate: sql`a.employee_id is not null and a.status <> 'cancelled'
            and not exists (select 1 from employee_location_assignments l
              where l.employee_id = a.employee_id and l.salon_id = a.salon_id and l.active)`,
        },
      ];
      // Counted and reported, never raised: probe E1 creates exactly this state
      // on purpose to demonstrate BOOKING-F18, so a second finding would double-count it.
      const attributedScans: Array<{ name: string; predicate: ReturnType<typeof sql> }> = [
        {
          name: "active appointment overlapping approved time off (expected from E1 / BOOKING-F18)",
          predicate: sql`a.status <> 'cancelled' and exists (
            select 1 from employee_time_off t where t.employee_id = a.employee_id
              and a.appointment_date between t.start_date and t.end_date
              and (t.start_time is null or (a.start_time < t.end_time and a.end_time > t.start_time)))`,
        },
      ];

      const bookedCounts: string[] = [];
      const wholeDbCounts: string[] = [];
      const breaches: string[] = [];
      for (const scan of scans) {
        const booked = await db.execute(
          sql`select count(*)::int as n from appointments a where (${scan.predicate}) and exists (${auditRows})`,
        );
        const all = await db.execute(sql`select count(*)::int as n from appointments a where ${scan.predicate}`);
        const bookedCount = Number((booked.rows[0] as { n?: number } | undefined)?.n ?? 0);
        const allCount = Number((all.rows[0] as { n?: number } | undefined)?.n ?? 0);
        bookedCounts.push(`${scan.name}=${bookedCount}`);
        wholeDbCounts.push(`${scan.name}=${allCount}`);
        if (bookedCount > 0) breaches.push(`${scan.name}: ${bookedCount}`);
      }
      for (const scan of attributedScans) {
        const all = await db.execute(sql`select count(*)::int as n from appointments a where ${scan.predicate}`);
        const allCount = Number((all.rows[0] as { n?: number } | undefined)?.n ?? 0);
        bookedCounts.push(`${scan.name}=${allCount}`);
      }

      // Structural scans that do not hang off a single appointment row.
      const orphans = await db.execute(sql`select count(*)::int as n from appointment_resource_allocations r
        where not exists (select 1 from appointments a where a.id = r.appointment_id)`);
      const duplicateReceipts = await db.execute(sql`select coalesce(sum(extra), 0)::int as n from (
        select count(*) - 1 as extra from booking_command_receipts
        group by salon_id, actor_type, actor_id, idempotency_key having count(*) > 1) d`);
      const orphanCount = Number((orphans.rows[0] as { n?: number } | undefined)?.n ?? 0);
      const duplicateCount = Number((duplicateReceipts.rows[0] as { n?: number } | undefined)?.n ?? 0);
      bookedCounts.push(`orphan resource allocation=${orphanCount}`, `duplicate receipt per scope=${duplicateCount}`);
      if (orphanCount > 0) breaches.push(`orphan resource allocation: ${orphanCount}`);
      if (duplicateCount > 0) breaches.push(`duplicate receipt per scope: ${duplicateCount}`);

      note(`Z2 booked-over-HTTP scope — ${bookedCounts.join("; ")}`);
      note(`Z2 whole database (includes ensureDemoData rows inserted outside the booking path) — ${wholeDbCounts.join("; ")}`);
      if (!breaches.length) return null;

      record({
        id: "BOOKING-F21",
        severity: "HIGH",
        title: "An appointment booked through the API is in a state the booking rules should make impossible",
        evidence: `scan restricted to rows this audit booked over HTTP: ${breaches.join("; ")}`,
      });
      return breaches.join("; ");
    });

    // ── Z3 — the demo seeder writes rows the booking path could never produce ──
    await probe("Z3 seeded demo appointments are internally consistent", async () => {
      const result = await db.execute(sql`select count(*)::int as n from appointments a
        where a.duration_minutes <> (
          (split_part(a.end_time, ':', 1)::int * 60 + split_part(a.end_time, ':', 2)::int)
          - (split_part(a.start_time, ':', 1)::int * 60 + split_part(a.start_time, ':', 2)::int))`);
      const mismatched = Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0);
      if (!mismatched) return null;

      record({
        id: "BOOKING-F12",
        severity: "LOW",
        title: "ensureDemoData() inserts appointments whose duration_minutes contradicts their own start/end window",
        evidence: `${mismatched} seeded rows carry e.g. 09:00-10:00 with duration_minutes = 45. `
          + `These are written straight to the table, bypassing the booking path, so availability and `
          + `any duration-based reporting disagree with the row itself. Not a booking-path defect, but `
          + `ensureDemoData() runs against whatever database it is pointed at`,
      });
      return `${mismatched} seeded rows disagree with their own window`;
    });

    // ── Z4 — the audit trail of a booking that is still pending ──
    await probe("Z4 every booking leaves an audit-trail row from the moment it is created", async () => {
      const result = await db.execute(sql`select count(*)::int as n from appointments a
        where a.created_by_user_id is not null
          and exists (select 1 from users u where u.id = a.customer_id and u.email like 'booking-audit-%')
          and not exists (select 1 from appointment_status_history h where h.appointment_id = a.id)`);
      const missing = Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0);
      if (!missing) return null;

      record({
        id: "BOOKING-F11",
        severity: "LOW",
        title: "A booking created as pending gets no appointment_status_history row",
        evidence: `${missing} appointment(s) booked over HTTP in this run have zero status-history rows. `
          + `insertInitializedAppointmentInTx (marketplace.ts:2129) writes history only when the initial `
          + `status is "confirmed", so a salon that reviews requests has no record of when a booking `
          + `entered "pending" or who created it until someone changes its status`,
      });
      return `${missing} API-booked appointment(s) with no status history`;
    });

    console.log("\n──────── BOOKING AUDIT SUMMARY ────────");
    for (const entry of probes) {
      console.log(`${entry.outcome.toUpperCase().padEnd(7)} ${entry.name}`);
    }
    console.log(`\nfindings: ${findings.length}`);
    for (const finding of findings) {
      console.log(`\n${finding.id} [${finding.severity}] ${finding.title}\n  evidence: ${finding.evidence}`);
    }
    console.log("\nBOOKING_AUDIT_FINDINGS_JSON=" + JSON.stringify(findings));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await db.delete(appointmentsTable).where(inArray(appointmentsTable.date, [AUDIT_DATE, "2099-12-08", "2099-12-09", "2099-12-10", "2099-12-11", "2099-12-12", "2099-12-13", "2099-12-18", "2099-12-19", "2099-12-20"]));
    await pool.end();
  }
}

void run();
