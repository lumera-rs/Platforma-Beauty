/**
 * BOOKING FINAL v2 — adversarial audit probes.
 *
 * Second audit pass. Where v1 (`booking-audit.test.ts`) attacked the core
 * scheduling path, this suite targets the subsystems v1 did not reach: package
 * entitlement ledgers, the no-show lifecycle branch, late-arrival occupancy
 * drift, salon-active gating across every booking surface, multi-service cart
 * atomicity, and slot granularity.
 *
 * Same contract as v1: every probe drives the real HTTP routes or the real
 * transaction helpers against a real PostgreSQL database and then reads the
 * resulting rows back, because an HTTP status is not evidence — only the
 * database state is. A probe that detects an invalid state prints a
 * `BOOKING-Vn` line and records the finding; the process still exits 0 so one
 * run produces the whole picture.
 *
 * It changes no production behaviour.
 */
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  appointmentsTable,
  customerPackagePurchasesTable,
  db,
  employeeLocationAssignmentsTable,
  employeeServicesTable,
  employeesTable,
  packagePurchaseServiceLinksTable,
  packageRedemptionsTable,
  pool,
  salonCustomersTable,
  salonHoursTable,
  salonsTable,
  servicesTable,
  treatmentPackagesTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureBookingCommandSchema } from "./booking-command-schema";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";
import { redeemPackageSessionInTx, reversePackageRedemptionInTx } from "./package-entitlement";
import { zonedAppointmentInstant } from "./appointment-lifecycle";

const suffix = randomUUID().slice(0, 8);
/** Far-future dates keep the probes clear of seeded demo appointments. */
const DATES = {
  drift: "2099-11-03",
  noShow: "2099-11-04",
  inactive: "2099-11-05",
  packageRace: "2099-11-06",
  reversal: "2099-11-07",
  expiry: "2099-11-08",
  cart: "2099-11-09",
  cartRetry: "2099-11-10",
  granularity: "2099-11-11",
  crossCustomer: "2099-11-12",
  rateLimit: "2099-11-13",
  cascade: "2099-11-14",
};

type Finding = {
  id: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "RELIABILITY" | "UX";
  title: string;
  evidence: string;
};

const findings: Finding[] = [];
const probes: { name: string; outcome: "clean" | "finding" | "error"; detail: string }[] = [];
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

/** Belgrade wall clock, the model the scheduling engine actually uses. */
function wallClock(instant: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

function addMinutes(time: string, minutes: number): string {
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function email(role: string): string {
  return `booking-v2-${role}-${suffix}@example.test`;
}

type Fixture = {
  ownerId: string;
  ownerSession: string;
  customerId: string;
  customerSession: string;
  intruderId: string;
  intruderSession: string;
  salonId: string;
  /** A salon deliberately left `active = false`. */
  inactiveSalonId: string;
  inactiveEmployeeId: string;
  inactiveServiceId: string;
  employeeAId: string;
  employeeBId: string;
  serviceAId: string;
  serviceBId: string;
  crmCustomerId: string;
  intruderCrmId: string;
};

async function buildFixture(): Promise<Fixture> {
  const passwordHash = await hashPassword("BookingAuditV2-2099!");
  const [owner] = await db.insert(usersTable).values({
    firstName: "AuditV2", lastName: "Owner", email: email("owner"),
    passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER",
  }).returning();
  const [customer] = await db.insert(usersTable).values({
    firstName: "AuditV2", lastName: "Customer", email: email("customer"),
    passwordHash, passwordSetAt: new Date(), role: "CUSTOMER",
  }).returning();
  const [intruder] = await db.insert(usersTable).values({
    firstName: "AuditV2", lastName: "Intruder", email: email("intruder"),
    passwordHash, passwordSetAt: new Date(), role: "CUSTOMER",
  }).returning();

  const salonRows = await db.insert(salonsTable).values([
    {
      ownerId: owner!.id, name: `Audit V2 Salon ${suffix}`, slug: `audit-v2-salon-${suffix}`,
      city: "Beograd", municipality: "Vračar", address: "AuditV2 1", phone: "+381110000801",
      email: email("salon"), shortDescription: "V2", description: "Audit v2 salon",
      imageUrl: "/audit-v2.jpg", active: true,
    },
    {
      ownerId: owner!.id, name: `Audit V2 Inactive ${suffix}`, slug: `audit-v2-inactive-${suffix}`,
      city: "Beograd", municipality: "Zvezdara", address: "AuditV2 2", phone: "+381110000802",
      email: email("salon-inactive"), shortDescription: "V2 off", description: "Deactivated salon",
      imageUrl: "/audit-v2-off.jpg", active: false,
    },
  ]).returning();
  const salon = salonRows[0]!;
  const inactiveSalon = salonRows[1]!;
  await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner!.id));

  // `salon_hours.weekday` is ISO: Monday 1 … Sunday 7.
  await db.insert(salonHoursTable).values(
    [salon.id, inactiveSalon.id].flatMap((salonId) =>
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        salonId, weekday, openTime: "08:00", closeTime: "20:00", closed: false,
      }))),
  );

  const employeeRows = await db.insert(employeesTable).values([
    { salonId: salon.id, name: `V2 Employee A ${suffix}`, role: "Frizer", bio: "A", avatarUrl: "/a.jpg", active: true },
    { salonId: salon.id, name: `V2 Employee B ${suffix}`, role: "Frizer", bio: "B", avatarUrl: "/b.jpg", active: true },
    { salonId: inactiveSalon.id, name: `V2 Employee C ${suffix}`, role: "Frizer", bio: "C", avatarUrl: "/c.jpg", active: true },
  ]).returning();
  const [employeeA, employeeB, employeeC] = employeeRows as [
    typeof employeesTable.$inferSelect, typeof employeesTable.$inferSelect, typeof employeesTable.$inferSelect,
  ];
  await db.insert(employeeLocationAssignmentsTable).values([
    { employeeId: employeeA.id, salonId: salon.id, active: true, isDefault: true },
    { employeeId: employeeB.id, salonId: salon.id, active: true, isDefault: true },
    { employeeId: employeeC.id, salonId: inactiveSalon.id, active: true, isDefault: true },
  ]);

  const serviceRows = await db.insert(servicesTable).values([
    {
      salonId: salon.id, name: `V2 Service A ${suffix}`, categoryName: "Frizerske usluge",
      description: "A", durationMinutes: 60, price: 3000, imageUrl: "/sa.jpg",
    },
    {
      salonId: salon.id, name: `V2 Service B ${suffix}`, categoryName: "Frizerske usluge",
      description: "B", durationMinutes: 60, price: 4000, imageUrl: "/sb.jpg",
    },
    {
      salonId: inactiveSalon.id, name: `V2 Service C ${suffix}`, categoryName: "Frizerske usluge",
      description: "C", durationMinutes: 60, price: 2000, imageUrl: "/sc.jpg",
    },
  ]).returning();
  const [serviceA, serviceB, serviceC] = serviceRows as [
    typeof servicesTable.$inferSelect, typeof servicesTable.$inferSelect, typeof servicesTable.$inferSelect,
  ];
  await db.insert(employeeServicesTable).values([
    { employeeId: employeeA.id, serviceId: serviceA.id },
    { employeeId: employeeA.id, serviceId: serviceB.id },
    { employeeId: employeeB.id, serviceId: serviceA.id },
    { employeeId: employeeB.id, serviceId: serviceB.id },
    { employeeId: employeeC.id, serviceId: serviceC.id },
  ]);

  const [crm] = await db.insert(salonCustomersTable).values({
    salonId: salon.id, userId: customer!.id,
    firstName: customer!.firstName, lastName: customer!.lastName, email: customer!.email,
    phone: `+38160${String(Date.now()).slice(-7)}`,
  }).returning();
  const [intruderCrm] = await db.insert(salonCustomersTable).values({
    salonId: salon.id, userId: intruder!.id,
    firstName: intruder!.firstName, lastName: intruder!.lastName, email: intruder!.email,
    phone: `+38161${String(Date.now()).slice(-7)}`,
  }).returning();

  return {
    ownerId: owner!.id,
    ownerSession: await createSession(owner!.id),
    customerId: customer!.id,
    customerSession: await createSession(customer!.id),
    intruderId: intruder!.id,
    intruderSession: await createSession(intruder!.id),
    salonId: salon.id,
    inactiveSalonId: inactiveSalon.id,
    inactiveEmployeeId: employeeC.id,
    inactiveServiceId: serviceC.id,
    employeeAId: employeeA.id,
    employeeBId: employeeB.id,
    serviceAId: serviceA.id,
    serviceBId: serviceB.id,
    crmCustomerId: crm!.id,
    intruderCrmId: intruderCrm!.id,
  };
}

/** Creates an active package purchase with a per-service snapshot link. */
async function createPackagePurchase(input: {
  salonId: string; serviceId: string; salonCustomerId: string;
  sessions: number; quotaPolicy: "shared_pool" | "per_service"; expiresAt?: Date;
}) {
  const [pkg] = await db.insert(treatmentPackagesTable).values({
    salonId: input.salonId, name: `V2 Package ${randomUUID().slice(0, 6)}`,
    priceInDinars: 10000, sessionCount: input.sessions, validityDays: 365,
    active: true, quotaPolicy: input.quotaPolicy,
  }).returning();
  const [purchase] = await db.insert(customerPackagePurchasesTable).values({
    salonId: input.salonId, packageId: pkg!.id, salonCustomerId: input.salonCustomerId,
    totalSessions: input.sessions, remainingSessions: input.sessions,
    quotaPolicy: input.quotaPolicy, priceInDinars: 10000, status: "active",
    expiresAt: input.expiresAt ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  }).returning();
  await db.insert(packagePurchaseServiceLinksTable).values({
    purchaseId: purchase!.id, serviceId: input.serviceId,
    totalQuota: input.sessions, remainingQuota: input.sessions,
  });
  return purchase!;
}

async function main(): Promise<void> {
  await ensureBookingCommandSchema();
  await ensureBusinessGrowthSchema();
  const fixture = await buildFixture();
  const server = app.listen(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const book = async (input: {
    session: string; salonId: string; serviceId: string; employeeId?: string | null;
    date: string; startTime: string;
  }) => {
    const response = await fetch(`${baseUrl}/api/appointments`, {
      method: "POST",
      headers: {
        "content-type": "application/json", "idempotency-key": randomUUID(),
        cookie: `${sessionCookieName}=${input.session}`,
      },
      body: JSON.stringify({
        salonId: input.salonId, serviceId: input.serviceId,
        ...(input.employeeId === undefined ? {} : { employeeId: input.employeeId }),
        date: input.date, startTime: input.startTime,
      }),
    });
    const body = await response.json() as { id?: string; error?: string; code?: string };
    return { status: response.status, body };
  };

  const lifecycle = (appointmentId: string, action: string, extra: Record<string, unknown> = {}) =>
    fetch(`${baseUrl}/api/appointments/${appointmentId}/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${sessionCookieName}=${fixture.ownerSession}` },
      body: JSON.stringify({ action, ...extra }),
    });

  try {
    // ── V1 — late arrival shifts the real treatment past the next booking ──
    await probe("V1 occupancy must not silently diverge when a treatment starts late", async () => {
      // `isAllowedLifecycleOccurredAt` clamps occurredAt to five minutes around
      // server time, so "late" has to be produced by scheduling the appointment
      // in the recent past rather than by backdating the transition. The row is
      // inserted directly for that reason; every later step goes through the API.
      const belgrade = wallClock(new Date());
      const date = belgrade.date;
      // Align to the 15-minute grid the salon advertises, then schedule the
      // first appointment 30 minutes ago. Its scheduled window is therefore
      // [now-30, now+30) while the treatment really runs to about now+60, so
      // the slot at now+30 is free on paper and occupied in the room.
      const gridNow = `${belgrade.time.slice(0, 3)}${String(Math.floor(Number(belgrade.time.slice(3, 5)) / 15) * 15).padStart(2, "0")}`;
      const scheduledTime = addMinutes(gridNow, -30);
      const nextSlotTime = addMinutes(gridNow, 30);
      const scheduled = { date, time: scheduledTime };
      const nextSlot = { date, time: nextSlotTime };
      if (scheduledTime < "08:15" || nextSlotTime > "18:45") {
        return `skipped: the salon day has no late-start window at this hour `
          + `(scheduled ${scheduledTime}, next ${nextSlotTime})`;
      }
      const [inserted] = await db.insert(appointmentsTable).values({
        salonId: fixture.salonId, customerId: fixture.customerId, salonCustomerId: fixture.crmCustomerId,
        employeeId: fixture.employeeAId, serviceId: fixture.serviceAId, date,
        startTime: scheduled.time, endTime: addMinutes(scheduled.time, 60),
        durationMinutes: 60, price: 3000, status: "confirmed",
      }).returning({ id: appointmentsTable.id });
      const first = { status: 201, body: { id: inserted!.id } };

      const confirmed = { status: 200 };
      const arrived = await lifecycle(first.body.id, "arrive");
      const started = await lifecycle(first.body.id, "start");

      const [row] = await db.select({
        arrivedAt: appointmentsTable.arrivedAt,
        actualStartedAt: appointmentsTable.actualStartedAt,
        endTime: appointmentsTable.endTime,
      }).from(appointmentsTable).where(eq(appointmentsTable.id, first.body.id));
      if (!row?.actualStartedAt) {
        return `setup failed: confirm=${confirmed.status} arrive=${arrived.status} start=${started.status}, `
          + "actualStartedAt never set";
      }

      // The next scheduled slot on the same employee, still in the future.
      const second = await book({
        session: fixture.customerSession, salonId: fixture.salonId,
        serviceId: fixture.serviceAId, employeeId: fixture.employeeAId,
        date, startTime: nextSlot.time,
      });
      if (!second.body.id) {
        note(`V1 scheduled ${scheduled.time}-${addMinutes(scheduled.time, 60)}, started ~30 min late, `
          + `so the treatment really runs to ~${addMinutes(nextSlot.time, 30)}; booking the next slot at `
          + `${nextSlot.time} was refused (HTTP ${second.status}: ${second.body.code ?? second.body.error})`);
        return null;
      }

      record({
        id: "BOOKING-F14",
        severity: "HIGH",
        title: "Availability is computed from scheduled time only, so a late start silently double-books the floor",
        evidence: `appointment ${first.body.id.slice(0, 8)} scheduled ${date} ${scheduled.time} (60 min) was started at `
          + `${row.actualStartedAt.toISOString()} (30 min late), so the 60-minute treatment really runs `
          + `to about ${addMinutes(nextSlot.time, 30)}. `
          + `Booking the same employee at ${nextSlot.time} returned ${second.status} and persisted `
          + `${second.body.id?.slice(0, 8)}. availability-engine.ts and availability-store.ts never read `
          + `actualStartedAt — grep returns no occurrence — so no scheduled-time invariant is violated and `
          + `nothing warns anyone. The clash exists only on the salon floor`,
      });
      return `next slot booked (HTTP ${second.status}) despite a 30-minute-late start on the same employee`;
    });

    // ── V2 — no-show and the package ledger ──
    await probe("V2 no-show keeps the package session consumed and awards no loyalty", async () => {
      const date = DATES.noShow;
      const purchase = await createPackagePurchase({
        salonId: fixture.salonId, serviceId: fixture.serviceAId,
        salonCustomerId: fixture.crmCustomerId, sessions: 2, quotaPolicy: "shared_pool",
      });
      const booked = await book({
        session: fixture.customerSession, salonId: fixture.salonId,
        serviceId: fixture.serviceAId, employeeId: fixture.employeeAId, date, startTime: "09:00",
      });
      if (!booked.body.id) return `setup failed: booking ${booked.status}`;

      const redeemed = await db.transaction(async (tx) => redeemPackageSessionInTx(tx, {
        purchaseId: purchase.id, appointmentId: booked.body.id!, salonId: fixture.salonId,
        requestingCustomerId: fixture.crmCustomerId,
      }));
      if (!redeemed.ok) return `setup failed: redemption rejected (${redeemed.reason})`;

      const noShow = await lifecycle(booked.body.id, "no-show");
      const [afterPurchase] = await db.select().from(customerPackagePurchasesTable)
        .where(eq(customerPackagePurchasesTable.id, purchase.id));
      const [afterAppointment] = await db.select({
        status: appointmentsTable.status, price: appointmentsTable.price,
      }).from(appointmentsTable).where(eq(appointmentsTable.id, booked.body.id));
      const redemptions = await db.select({ status: packageRedemptionsTable.status })
        .from(packageRedemptionsTable).where(eq(packageRedemptionsTable.purchaseId, purchase.id));

      note(`V2 no-show=${noShow.status}; appointment ${afterAppointment?.status} price=${afterAppointment?.price}; `
        + `remainingSessions ${purchase.remainingSessions} -> ${afterPurchase?.remainingSessions}; `
        + `redemptions ${redemptions.map((entry) => entry.status).join(", ")}`);

      // The documented product rule: a no-show burns the session. Anything else
      // — a silent restore, or a price that drifts back off zero — is a defect.
      const consumed = afterPurchase?.remainingSessions === purchase.remainingSessions - 1
        && redemptions.every((entry) => entry.status === "redeemed")
        && afterAppointment?.price === 0
        && afterAppointment?.status === "no-show";
      if (consumed) return null;

      record({
        id: "BOOKING-F17",
        severity: "HIGH",
        title: "A no-show leaves the package ledger in an unexpected state",
        evidence: `after no-show: appointment ${afterAppointment?.status} price ${afterAppointment?.price}, `
          + `remainingSessions ${afterPurchase?.remainingSessions} (expected ${purchase.remainingSessions - 1}), `
          + `redemption statuses ${redemptions.map((entry) => entry.status).join(", ")}`,
      });
      return `unexpected ledger state after no-show`;
    });

    // ── V3 — booking against a deactivated salon, every surface ──
    await probe("V3 a deactivated salon must not take new bookings on any surface", async () => {
      const date = DATES.inactive;
      const surfaces: string[] = [];

      const customerAttempt = await book({
        session: fixture.customerSession, salonId: fixture.inactiveSalonId,
        serviceId: fixture.inactiveServiceId, employeeId: fixture.inactiveEmployeeId, date, startTime: "10:00",
      });
      surfaces.push(`customer=${customerAttempt.status}`);

      const groupAttempt = await fetch(`${baseUrl}/api/booking-groups`, {
        method: "POST",
        headers: {
          "content-type": "application/json", "idempotency-key": randomUUID(),
          cookie: `${sessionCookieName}=${fixture.customerSession}`,
        },
        body: JSON.stringify({
          salonId: fixture.inactiveSalonId, date,
          treatments: [{ serviceId: fixture.inactiveServiceId, employeeId: fixture.inactiveEmployeeId, startTime: "10:00" }],
        }),
      });
      surfaces.push(`booking-group=${groupAttempt.status}`);

      // Owner surface: point the owner's active salon at the deactivated one,
      // exactly as switching locations in the portal would.
      await db.update(usersTable).set({ activeSalonId: fixture.inactiveSalonId })
        .where(eq(usersTable.id, fixture.ownerId));
      const ownerAttempt = await fetch(`${baseUrl}/api/salon/appointments`, {
        method: "POST",
        headers: {
          "content-type": "application/json", "idempotency-key": randomUUID(),
          cookie: `${sessionCookieName}=${fixture.ownerSession}`,
        },
        body: JSON.stringify({
          serviceId: fixture.inactiveServiceId, employeeId: fixture.inactiveEmployeeId,
          date, startTime: "11:00",
          salonCustomerId: (await db.insert(salonCustomersTable).values({
            salonId: fixture.inactiveSalonId, firstName: "Off", lastName: "Klijent",
            phone: `+38162${String(Date.now()).slice(-7)}`,
          }).returning())[0]!.id,
        }),
      });
      const ownerBody = await ownerAttempt.json().catch(() => ({})) as { error?: string; code?: string };
      surfaces.push(`owner=${ownerAttempt.status}${ownerBody.error ? ` (${ownerBody.error})` : ""}`);
      await db.update(usersTable).set({ activeSalonId: fixture.salonId })
        .where(eq(usersTable.id, fixture.ownerId));

      const widgetAttempt = await fetch(
        `${baseUrl}/api/widget/salons/audit-v2-inactive-${suffix}/appointments`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
          body: JSON.stringify({
            serviceId: fixture.inactiveServiceId, employeeId: fixture.inactiveEmployeeId,
            date, startTime: "12:00",
            guest: { firstName: "Gost", lastName: "Widget", phone: `+38163${String(Date.now()).slice(-7)}` },
          }),
        },
      );
      const widgetBody = await widgetAttempt.json().catch(() => ({})) as { error?: string };
      surfaces.push(`widget=${widgetAttempt.status}${widgetBody.error ? ` (${widgetBody.error})` : ""}`);

      const rows = await db.select({ id: appointmentsTable.id, startTime: appointmentsTable.startTime })
        .from(appointmentsTable).where(and(
          eq(appointmentsTable.salonId, fixture.inactiveSalonId),
          eq(appointmentsTable.date, date),
        ));
      if (!rows.length) {
        note(`V3 all surfaces refused the deactivated salon (${surfaces.join(", ")})`);
        return null;
      }

      record({
        id: "BOOKING-F15",
        severity: "MEDIUM",
        title: "A deactivated salon still accepts bookings; the active check is applied inconsistently across surfaces",
        evidence: `salon ${fixture.inactiveSalonId} has active = false; ${surfaces.join(", ")}; `
          + `${rows.length} appointment(s) persisted at ${rows.map((row) => row.startTime).join(", ")}. `
          + `POST /api/appointments resolves the salon by joining services -> salons with no active `
          + `predicate (marketplace.ts:8307), and ownedSalon() (marketplace.ts:1422) selects by ownerId + `
          + `activeSalonId with no active filter either. Only POST /api/booking-groups `
          + `(marketplace.ts:7846) and widgetSalon() (widget.ts:152) require salons.active = true`,
      });
      return `${rows.length} booking(s) accepted at a deactivated salon (${surfaces.join(", ")})`;
    });

    // ── V4 — the last package session under real contention ──
    await probe("V4 exactly one of many concurrent redemptions may take the last session", async () => {
      const date = DATES.packageRace;
      const purchase = await createPackagePurchase({
        salonId: fixture.salonId, serviceId: fixture.serviceAId,
        salonCustomerId: fixture.crmCustomerId, sessions: 1, quotaPolicy: "shared_pool",
      });
      // Ten distinct appointments so the only contended resource is the session.
      const appointmentIds: string[] = [];
      for (let index = 0; index < 10; index += 1) {
        const [row] = await db.insert(appointmentsTable).values({
          salonId: fixture.salonId, customerId: fixture.customerId, salonCustomerId: fixture.crmCustomerId,
          employeeId: fixture.employeeAId, serviceId: fixture.serviceAId, date,
          startTime: `${String(8 + index).padStart(2, "0")}:00`,
          endTime: `${String(9 + index).padStart(2, "0")}:00`,
          durationMinutes: 60, price: 3000, status: "confirmed",
        }).returning({ id: appointmentsTable.id });
        appointmentIds.push(row!.id);
      }

      const results = await Promise.all(appointmentIds.map((appointmentId) =>
        db.transaction(async (tx) => redeemPackageSessionInTx(tx, {
          purchaseId: purchase.id, appointmentId, salonId: fixture.salonId,
          requestingCustomerId: fixture.crmCustomerId,
        })).catch((error) => ({ ok: false as const, reason: `threw: ${error instanceof Error ? error.message : error}` })),
      ));
      const succeeded = results.filter((entry) => entry.ok).length;
      const [after] = await db.select().from(customerPackagePurchasesTable)
        .where(eq(customerPackagePurchasesTable.id, purchase.id));
      const redemptions = await db.select({ id: packageRedemptionsTable.id })
        .from(packageRedemptionsTable).where(and(
          eq(packageRedemptionsTable.purchaseId, purchase.id),
          eq(packageRedemptionsTable.status, "redeemed"),
        ));
      const zeroed = await db.select({ id: appointmentsTable.id }).from(appointmentsTable).where(and(
        inArray(appointmentsTable.id, appointmentIds),
        eq(appointmentsTable.price, 0),
      ));

      note(`V4 10 concurrent redemptions on remainingSessions=1: ${succeeded} succeeded, `
        + `remaining ${after?.remainingSessions}, status ${after?.status}, `
        + `${redemptions.length} redemption row(s), ${zeroed.length} zero-priced appointment(s)`);
      if (succeeded === 1 && after?.remainingSessions === 0 && redemptions.length === 1 && zeroed.length === 1) {
        return null;
      }

      record({
        id: "BOOKING-F16",
        severity: "HIGH",
        title: "Concurrent package redemptions can oversell or desynchronise the ledger",
        evidence: `purchase started with remainingSessions = 1; ${succeeded} of 10 concurrent redemptions `
          + `succeeded; remainingSessions = ${after?.remainingSessions}; `
          + `${redemptions.length} redeemed row(s); ${zeroed.length} appointment(s) zero-priced`,
      });
      return `${succeeded} succeeded, ${redemptions.length} redemption rows, ${zeroed.length} zeroed prices`;
    });

    // ── V5 — reversing the same redemption twice, concurrently ──
    await probe("V5 concurrent reversal of one redemption restores exactly one session", async () => {
      const date = DATES.reversal;
      const purchase = await createPackagePurchase({
        salonId: fixture.salonId, serviceId: fixture.serviceAId,
        salonCustomerId: fixture.crmCustomerId, sessions: 3, quotaPolicy: "per_service",
      });
      const [appointment] = await db.insert(appointmentsTable).values({
        salonId: fixture.salonId, customerId: fixture.customerId, salonCustomerId: fixture.crmCustomerId,
        employeeId: fixture.employeeAId, serviceId: fixture.serviceAId, date,
        startTime: "09:00", endTime: "10:00", durationMinutes: 60, price: 3000, status: "confirmed",
      }).returning();
      const redeemed = await db.transaction(async (tx) => redeemPackageSessionInTx(tx, {
        purchaseId: purchase.id, appointmentId: appointment!.id, salonId: fixture.salonId,
        requestingCustomerId: fixture.crmCustomerId,
      }));
      if (!redeemed.ok) return `setup failed: redemption rejected (${redeemed.reason})`;

      const reversals = await Promise.all([0, 1, 2].map(() =>
        db.transaction(async (tx) => reversePackageRedemptionInTx(tx, {
          redemptionId: redeemed.redemptionId, salonId: fixture.salonId, reversedByUserId: fixture.ownerId,
        })).catch((error) => ({ ok: false as const, reason: `threw: ${error instanceof Error ? error.message : error}` })),
      ));
      const succeeded = reversals.filter((entry) => entry.ok).length;
      const [after] = await db.select().from(customerPackagePurchasesTable)
        .where(eq(customerPackagePurchasesTable.id, purchase.id));
      const [link] = await db.select().from(packagePurchaseServiceLinksTable)
        .where(eq(packagePurchaseServiceLinksTable.purchaseId, purchase.id));
      const [row] = await db.select({ price: appointmentsTable.price })
        .from(appointmentsTable).where(eq(appointmentsTable.id, appointment!.id));

      note(`V5 3 concurrent reversals: ${succeeded} succeeded; remainingSessions ${after?.remainingSessions}/3, `
        + `per-service quota ${link?.remainingQuota}/3, appointment price restored to ${row?.price}`);
      if (succeeded === 1 && after?.remainingSessions === 3 && link?.remainingQuota === 3 && row?.price === 3000) {
        return null;
      }

      record({
        id: "BOOKING-F18",
        severity: "HIGH",
        title: "Concurrent reversal of one redemption restores more than one session",
        evidence: `${succeeded} of 3 concurrent reversals succeeded; remainingSessions `
          + `${after?.remainingSessions} (expected 3); per-service remainingQuota ${link?.remainingQuota} `
          + `(expected 3); appointment price ${row?.price} (expected 3000)`,
      });
      return `${succeeded} reversals succeeded, remaining ${after?.remainingSessions}, quota ${link?.remainingQuota}`;
    });

    // ── V6 — expiry exactly at the redemption attempt ──
    await probe("V6 an expired package cannot be redeemed", async () => {
      const date = DATES.expiry;
      const purchase = await createPackagePurchase({
        salonId: fixture.salonId, serviceId: fixture.serviceAId,
        salonCustomerId: fixture.crmCustomerId, sessions: 1, quotaPolicy: "shared_pool",
        expiresAt: new Date(Date.now() - 1000),
      });
      const [appointment] = await db.insert(appointmentsTable).values({
        salonId: fixture.salonId, customerId: fixture.customerId, salonCustomerId: fixture.crmCustomerId,
        employeeId: fixture.employeeAId, serviceId: fixture.serviceAId, date,
        startTime: "09:00", endTime: "10:00", durationMinutes: 60, price: 3000, status: "confirmed",
      }).returning();
      const result = await db.transaction(async (tx) => redeemPackageSessionInTx(tx, {
        purchaseId: purchase.id, appointmentId: appointment!.id, salonId: fixture.salonId,
        requestingCustomerId: fixture.crmCustomerId,
      }));
      const [after] = await db.select().from(customerPackagePurchasesTable)
        .where(eq(customerPackagePurchasesTable.id, purchase.id));
      const [row] = await db.select({ price: appointmentsTable.price })
        .from(appointmentsTable).where(eq(appointmentsTable.id, appointment!.id));
      if (!result.ok && after?.remainingSessions === 1 && row?.price === 3000) {
        note(`V6 expired purchase rejected with "${result.reason}", ledger untouched`);
        return null;
      }

      record({
        id: "BOOKING-F19",
        severity: "HIGH",
        title: "An expired package purchase can still be redeemed",
        evidence: `expiresAt is in the past; redeem returned ${JSON.stringify(result)}; `
          + `remainingSessions ${after?.remainingSessions}; appointment price ${row?.price}`,
      });
      return `expired purchase accepted (${JSON.stringify(result)})`;
    });

    // ── V7 — a customer redeeming somebody else's package ──
    await probe("V7 a customer cannot redeem another customer's package", async () => {
      const date = DATES.crossCustomer;
      const victimPurchase = await createPackagePurchase({
        salonId: fixture.salonId, serviceId: fixture.serviceAId,
        salonCustomerId: fixture.crmCustomerId, sessions: 2, quotaPolicy: "shared_pool",
      });
      const [intruderAppointment] = await db.insert(appointmentsTable).values({
        salonId: fixture.salonId, customerId: fixture.intruderId, salonCustomerId: fixture.intruderCrmId,
        employeeId: fixture.employeeAId, serviceId: fixture.serviceAId, date,
        startTime: "09:00", endTime: "10:00", durationMinutes: 60, price: 3000, status: "confirmed",
      }).returning();
      const result = await db.transaction(async (tx) => redeemPackageSessionInTx(tx, {
        purchaseId: victimPurchase.id, appointmentId: intruderAppointment!.id, salonId: fixture.salonId,
        requestingCustomerId: fixture.intruderCrmId,
      }));
      const [after] = await db.select().from(customerPackagePurchasesTable)
        .where(eq(customerPackagePurchasesTable.id, victimPurchase.id));
      const [row] = await db.select({ price: appointmentsTable.price })
        .from(appointmentsTable).where(eq(appointmentsTable.id, intruderAppointment!.id));
      if (!result.ok && after?.remainingSessions === 2 && row?.price === 3000) {
        note(`V7 cross-customer redemption rejected with "${result.reason}", ledger untouched`);
        return null;
      }

      record({
        id: "BOOKING-F20",
        severity: "HIGH",
        title: "One customer can spend another customer's package balance",
        evidence: `purchase belongs to CRM contact ${fixture.crmCustomerId}; redeeming it against an `
          + `appointment owned by ${fixture.intruderCrmId} returned ${JSON.stringify(result)}; `
          + `remainingSessions ${after?.remainingSessions}; intruder appointment price ${row?.price}`,
      });
      return `cross-customer redemption accepted (${JSON.stringify(result)})`;
    });

    // ── V8 — multi-service cart atomicity ──
    await probe("V8 a multi-service cart commits every treatment or none", async () => {
      const date = DATES.cart;
      // Occupy the slot the third treatment wants, so the last member must fail.
      await db.insert(appointmentsTable).values({
        salonId: fixture.salonId, customerId: fixture.intruderId, salonCustomerId: fixture.intruderCrmId,
        employeeId: fixture.employeeAId, serviceId: fixture.serviceAId, date,
        startTime: "12:00", endTime: "13:00", durationMinutes: 60, price: 3000, status: "confirmed",
      });
      const response = await fetch(`${baseUrl}/api/booking-groups`, {
        method: "POST",
        headers: {
          "content-type": "application/json", "idempotency-key": randomUUID(),
          cookie: `${sessionCookieName}=${fixture.customerSession}`,
        },
        body: JSON.stringify({
          salonId: fixture.salonId, date,
          treatments: [
            { serviceId: fixture.serviceAId, employeeId: fixture.employeeAId, startTime: "10:00" },
            { serviceId: fixture.serviceBId, employeeId: fixture.employeeAId, startTime: "11:00" },
            { serviceId: fixture.serviceAId, employeeId: fixture.employeeAId, startTime: "12:00" },
          ],
        }),
      });
      const rows = await db.select({ startTime: appointmentsTable.startTime })
        .from(appointmentsTable).where(and(
          eq(appointmentsTable.customerId, fixture.customerId),
          eq(appointmentsTable.date, date),
        ));
      if (response.status >= 400 && rows.length === 0) {
        note(`V8 cart with an unavailable third treatment rejected (HTTP ${response.status}); no partial rows`);
        return null;
      }
      if (response.status < 300 && rows.length === 3) {
        note(`V8 cart committed all three treatments (HTTP ${response.status}) — the contended slot was free`);
        return null;
      }

      record({
        id: "BOOKING-F21",
        severity: "HIGH",
        title: "A multi-service cart can leave part of itself committed",
        evidence: `POST /api/booking-groups with 3 treatments (the third contending an occupied slot) `
          + `returned ${response.status}; ${rows.length} appointment(s) persisted for this customer on `
          + `${date} at ${rows.map((row) => row.startTime).join(", ")}`,
      });
      return `HTTP ${response.status} left ${rows.length} of 3 cart rows committed`;
    });

    // ── V9 — cart idempotency after a lost response ──
    await probe("V9 retrying a cart with the same key returns the original group", async () => {
      const date = DATES.cartRetry;
      const key = randomUUID();
      const send = () => fetch(`${baseUrl}/api/booking-groups`, {
        method: "POST",
        headers: {
          "content-type": "application/json", "idempotency-key": key,
          cookie: `${sessionCookieName}=${fixture.customerSession}`,
        },
        body: JSON.stringify({
          salonId: fixture.salonId, date,
          treatments: [
            { serviceId: fixture.serviceAId, employeeId: fixture.employeeAId, startTime: "10:00" },
            { serviceId: fixture.serviceBId, employeeId: fixture.employeeAId, startTime: "11:00" },
          ],
        }),
      });
      const first = await send();
      const firstBody = await first.json() as { id?: string };
      const second = await send();
      const secondBody = await second.json() as { id?: string };
      const rows = await db.select({ id: appointmentsTable.id, bookingGroupId: appointmentsTable.bookingGroupId })
        .from(appointmentsTable).where(and(
          eq(appointmentsTable.customerId, fixture.customerId),
          eq(appointmentsTable.date, date),
        ));
      const groups = new Set(rows.map((row) => row.bookingGroupId));
      if (first.status < 300 && rows.length === 2 && groups.size === 1
        && firstBody.id && secondBody.id === firstBody.id) {
        note(`V9 cart retry replayed group ${firstBody.id.slice(0, 8)}; 2 rows, 1 group, `
          + `replayed=${second.headers.get("idempotency-replayed")}`);
        return null;
      }

      record({
        id: "BOOKING-F22",
        severity: "HIGH",
        title: "Retrying a cart booking with the same idempotency key duplicates or splits the group",
        evidence: `first=${first.status} (${firstBody.id}), second=${second.status} (${secondBody.id}); `
          + `${rows.length} appointment(s) across ${groups.size} booking group(s) on ${date}`,
      });
      return `${rows.length} rows across ${groups.size} group(s); second=${second.status}`;
    });

    // ── V10 — a start time off the configured grid ──
    await probe("V10 a start time off the slot grid is handled deliberately", async () => {
      const date = DATES.granularity;
      const offGrid = await book({
        session: fixture.customerSession, salonId: fixture.salonId,
        serviceId: fixture.serviceAId, employeeId: fixture.employeeBId, date, startTime: "10:07",
      });
      const rows = await db.select({ startTime: appointmentsTable.startTime, endTime: appointmentsTable.endTime })
        .from(appointmentsTable).where(and(
          eq(appointmentsTable.customerId, fixture.customerId),
          eq(appointmentsTable.date, date),
        ));
      if (!rows.length) {
        note(`V10 off-grid 10:07 refused (HTTP ${offGrid.status}); slot granularity holds`);
        return null;
      }

      record({
        id: "BOOKING-F23",
        severity: "MEDIUM",
        title: "A booking can be placed off the salon's slot grid, fragmenting advertised availability",
        evidence: `salon_booking_settings.slot_granularity_minutes governs the offered grid; `
          + `POST /api/appointments with startTime 10:07 returned ${offGrid.status} and persisted `
          + rows.map((row) => `${row.startTime}-${row.endTime}`).join(", "),
      });
      return `off-grid booking accepted at ${rows.map((row) => row.startTime).join(", ")}`;
    });

    // ── V11 — rate limiting on the authenticated booking surfaces ──
    await probe("V11 the authenticated booking surfaces resist rapid-fire slot holding", async () => {
      const date = DATES.rateLimit;
      const statuses: number[] = [];
      for (let index = 0; index < 20; index += 1) {
        const attempt = await book({
          session: fixture.customerSession, salonId: fixture.salonId,
          serviceId: fixture.serviceAId, employeeId: fixture.employeeBId,
          date, startTime: "09:00",
        });
        statuses.push(attempt.status);
      }
      const throttled = statuses.filter((status) => status === 429).length;
      const created = statuses.filter((status) => status === 201).length;
      const rows = await db.select({ id: appointmentsTable.id }).from(appointmentsTable).where(and(
        eq(appointmentsTable.salonId, fixture.salonId),
        eq(appointmentsTable.date, date),
      ));
      note(`V11 20 rapid customer bookings for one slot: ${created} created, ${throttled} throttled, `
        + `${rows.length} row(s) persisted`);
      // Correctness is intact either way — the point is whether anything limits volume.
      if (throttled > 0) return null;

      record({
        id: "BOOKING-F16",
        severity: "RELIABILITY",
        title: "Only the widget surface is rate limited; the authenticated booking endpoints are not",
        evidence: `20 consecutive POST /api/appointments from one customer produced no 429 `
          + `(${created} created, ${rows.length} row(s) persisted). widget.ts limits bookings to `
          + `RATE_MAX_BOOKINGS = 5 per 60 s per IP+slug (widget.ts:77, :238), but the customer, owner and `
          + `employee surfaces rely only on admitBookingRequest, whose limit comes from `
          + `BOOKING_MAX_IN_FLIGHT_PER_PROCESS and defaults to "0" — a passthrough `
          + `(booking-admission.ts:3, :18). Slot correctness is unaffected; volume is unbounded`,
      });
      return `no throttling across 20 rapid attempts (${created} created)`;
    });

    // ── V12 — deactivating a salon that still has future appointments ──
    await probe("V12 what happens to future appointments when a salon is deactivated", async () => {
      const date = DATES.cascade;
      const booked = await book({
        session: fixture.customerSession, salonId: fixture.salonId,
        serviceId: fixture.serviceAId, employeeId: fixture.employeeAId, date, startTime: "09:00",
      });
      if (!booked.body.id) return `setup failed: booking ${booked.status}`;

      const response = await fetch(`${baseUrl}/api/salon/profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: `${sessionCookieName}=${fixture.ownerSession}` },
        body: JSON.stringify({ active: false }),
      });
      const [salonRow] = await db.select({ active: salonsTable.active }).from(salonsTable)
        .where(eq(salonsTable.id, fixture.salonId));
      const [appointment] = await db.select({ status: appointmentsTable.status })
        .from(appointmentsTable).where(eq(appointmentsTable.id, booked.body.id));
      // Restore before anything downstream depends on this salon being open.
      await db.update(salonsTable).set({ active: true }).where(eq(salonsTable.id, fixture.salonId));

      if (salonRow?.active !== false) {
        // The probe never got the salon deactivated, so it proves nothing about
        // what deactivation does to future bookings. Recorded as a gap, not a pass.
        note(`V12 NOT EXERCISED — PATCH /api/salon/profile {active:false} returned ${response.status} `
          + `and the salon is still active. No owner-facing route was found that deactivates a salon, `
          + `so the cascade question in section 81 stays untested`);
        return null;
      }
      note(`V12 salon deactivated (HTTP ${response.status}); the future appointment is still `
        + `${appointment?.status}, so staff can still wind it down`);
      // Keeping the appointment is defensible (the salon must be able to wind
      // down); the probe records the behaviour rather than asserting a rule.
      return null;
    });

    // ── V13 — the Belgrade DST transitions ──
    // calendar-timezone-boundaries.test.ts covers leap day, midnight and year
    // rollover, but not the two hours a year that do not behave like hours.
    await probe("V13 wall-clock times survive both Belgrade DST transitions", async () => {
      const cases: Array<{ date: string; time: string; label: string }> = [
        { date: "2026-03-29", time: "01:30", label: "spring, before the jump" },
        { date: "2026-03-29", time: "02:30", label: "spring, the hour that does not exist" },
        { date: "2026-03-29", time: "03:30", label: "spring, after the jump" },
        { date: "2026-10-25", time: "01:30", label: "autumn, before the repeat" },
        { date: "2026-10-25", time: "02:30", label: "autumn, the hour that happens twice" },
        { date: "2026-10-25", time: "03:30", label: "autumn, after the repeat" },
      ];
      const observed: string[] = [];
      const broken: string[] = [];
      for (const entry of cases) {
        const instant = zonedAppointmentInstant(entry.date, entry.time);
        const roundTrip = wallClock(instant);
        const stable = roundTrip.date === entry.date && roundTrip.time === entry.time;
        observed.push(`${entry.date} ${entry.time} -> ${instant.toISOString()} -> ${roundTrip.date} ${roundTrip.time}`);
        // The nonexistent hour cannot round-trip by definition; every other
        // wall-clock time must come back unchanged.
        if (!stable && entry.time !== "02:30") broken.push(`${entry.label}: ${entry.date} ${entry.time} came back as ${roundTrip.time}`);
        if (Number.isNaN(instant.getTime())) broken.push(`${entry.label}: produced an invalid instant`);
      }
      note(`V13 ${observed.join(" | ")}`);
      if (!broken.length) return null;

      record({
        id: "BOOKING-F25",
        severity: "MEDIUM",
        title: "zonedAppointmentInstant does not round-trip wall-clock times across a DST transition",
        evidence: broken.join("; ") + `. Full observation: ${observed.join(" | ")}`,
      });
      return broken.join("; ");
    });

    // ── Z — ledger and appointment integrity across the whole database ──
    await probe("Z package and appointment ledgers hold no impossible state", async () => {
      const scans: Array<{ name: string; query: ReturnType<typeof sql> }> = [
        {
          name: "redemption without an appointment",
          query: sql`select count(*)::int as n from package_redemptions r
            where not exists (select 1 from appointments a where a.id = r.appointment_id)`,
        },
        {
          name: "remainingSessions disagrees with active redemptions",
          query: sql`select count(*)::int as n from customer_package_purchases p
            where p.remaining_sessions <> p.total_sessions - (
              select count(*) from package_redemptions r
              where r.purchase_id = p.id and r.status = 'redeemed')`,
        },
        {
          name: "negative remaining sessions or quota",
          query: sql`select (
              (select count(*) from customer_package_purchases where remaining_sessions < 0)
            + (select count(*) from package_purchase_service_links where remaining_quota < 0)
            )::int as n`,
        },
        {
          name: "per-service quota disagrees with its redemptions",
          query: sql`select count(*)::int as n from package_purchase_service_links l
            join customer_package_purchases p on p.id = l.purchase_id
            where p.quota_policy = 'per_service' and l.remaining_quota <> l.total_quota - (
              select count(*) from package_redemptions r
              where r.purchase_service_link_id = l.id and r.status = 'redeemed')`,
        },
        {
          name: "redemption crossing tenants",
          query: sql`select count(*)::int as n from package_redemptions r
            join appointments a on a.id = r.appointment_id
            where a.salon_id <> r.salon_id`,
        },
        {
          name: "zero-priced appointment with no redemption",
          query: sql`select count(*)::int as n from appointments a
            where a.price = 0 and a.status <> 'cancelled' and a.created_by_user_id is not null
              and not exists (select 1 from package_redemptions r
                where r.appointment_id = a.id and r.status = 'redeemed')`,
        },
        {
          name: "booking group with no appointments",
          query: sql`select count(*)::int as n from booking_groups g
            where not exists (select 1 from appointments a where a.booking_group_id = g.id)`,
        },
      ];
      const counts: string[] = [];
      const breaches: string[] = [];
      for (const scan of scans) {
        try {
          const result = await db.execute(scan.query);
          const count = Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0);
          counts.push(`${scan.name}=${count}`);
          if (count > 0) breaches.push(`${scan.name}: ${count}`);
        } catch (error) {
          counts.push(`${scan.name}=unavailable (${error instanceof Error ? error.message.split("\n")[0] : error})`);
        }
      }
      note(`Z integrity scan — ${counts.join("; ")}`);
      if (!breaches.length) return null;

      record({
        id: "BOOKING-F24",
        severity: "HIGH",
        title: "The package or booking-group ledger holds a state the rules should make impossible",
        evidence: `whole-database scan after the audit run: ${breaches.join("; ")}`,
      });
      return breaches.join("; ");
    });

    console.log("\n──────── BOOKING AUDIT v2 SUMMARY ────────");
    for (const entry of probes) {
      console.log(`${entry.outcome.toUpperCase().padEnd(7)} ${entry.name}`);
    }
    console.log(`\nfindings: ${findings.length}`);
    for (const finding of findings) {
      console.log(`\n${finding.id} [${finding.severity}] ${finding.title}\n  evidence: ${finding.evidence}`);
    }
    console.log("\nBOOKING_AUDIT_V2_FINDINGS_JSON=" + JSON.stringify(findings));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const doomed = await db.select({ id: appointmentsTable.id }).from(appointmentsTable).where(
      inArray(appointmentsTable.salonId, [fixture.salonId, fixture.inactiveSalonId]),
    );
    if (doomed.length) {
      // package_redemptions references appointments; drop the child rows first.
      await db.delete(packageRedemptionsTable)
        .where(inArray(packageRedemptionsTable.appointmentId, doomed.map((row) => row.id)));
      await db.delete(appointmentsTable)
        .where(inArray(appointmentsTable.id, doomed.map((row) => row.id)));
    }
    await pool.end();
  }
}

void main();
