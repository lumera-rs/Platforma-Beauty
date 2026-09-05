import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  appointmentTreatmentsTable,
  appointmentsTable,
  bookingGroupsTable,
  db,
  employeeLocationAssignmentsTable,
  employeeServicesTable,
  employeesTable,
  salonCustomersTable,
  salonBookingSettingsTable,
  salonNotificationsTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import {
  CreateWidgetBookingGroupBody,
  CreateWidgetBookingGroupResponse,
  CreateWidgetAppointmentBody,
  GetWidgetAvailabilityQueryParams,
} from "@workspace/api-zod";
import { ensureDemoData } from "../lib/seed";
import { admitBookingRequest } from "../lib/booking-admission";
import { publishSalonNotificationUpdate } from "../lib/salon-notification-events";
import { canonicalAvailability } from "../lib/availability-store";
import {
  allocateResourcesInTx,
  appointmentEndTime,
  bookingGroupLayoutValid,
  createAllocatedAppointment,
  fetchServiceResourceRequirements,
  rawTreatmentDateInputs,
  normalizedPhone,
} from "./marketplace";
import { getCurrentUser } from "../lib/auth";
import { lockAppointmentResources } from "../lib/appointment-locks";
import { enqueueBookingGroupConfirmationInTx } from "../lib/appointment-customer-events";
import {
  bookingIdempotencyKey,
  executeBookingCommand,
  replayBookingCommand,
  sendBookingCommandResult,
} from "../lib/booking-command";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// CORS — ONLY these /widget routes are cross-origin readable (the widget is
// embedded as an iframe/script on external salon websites). No credentials.
// The rest of the API stays same-origin.
// ─────────────────────────────────────────────────────────────────────────────
router.use("/widget", (req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key");
  res.setHeader("Access-Control-Max-Age", "86400");
  // Task #8: Helmet's app-wide default (Cross-Origin-Resource-Policy:
  // same-origin, set in app.ts) would otherwise let a browser block these
  // routes' own responses from being read by the cross-origin salon
  // websites this CORS policy exists to serve. Override it back to
  // cross-origin here, scoped to exactly the routes that already opt into
  // cross-origin reads above -- every other route keeps Helmet's stricter
  // default.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting — hand-rolled, in-memory, bounded. Keyed by IP + salon slug.
// ─────────────────────────────────────────────────────────────────────────────
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_READS = 60;
const RATE_MAX_BOOKINGS = 5;
const RATE_MAX_KEYS = 10_000;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string, max: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (rateBuckets.size >= RATE_MAX_KEYS) {
      // Bounded memory: drop expired buckets, then oldest entries if needed.
      for (const [existingKey, existing] of rateBuckets) {
        if (existing.resetAt <= now) rateBuckets.delete(existingKey);
      }
      while (rateBuckets.size >= RATE_MAX_KEYS) {
        const oldest = rateBuckets.keys().next().value;
        if (oldest === undefined) break;
        rateBuckets.delete(oldest);
      }
    }
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > max;
}

function clientKey(req: Request, slug: string): string {
  // Express derives req.ip from the application's explicit trust-proxy policy.
  // Never parse X-Forwarded-For here: on direct/local connections it is
  // attacker-controlled, while behind the known deployment edge Express
  // safely removes the configured number of trusted proxy hops.
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return `${ip}:${slug}`;
}

function guardRate(req: Request, res: Response, slug: string, max: number): boolean {
  if (rateLimited(clientKey(req, slug), max)) {
    res.status(429).json({ error: "Previše zahteva — pokušajte ponovo za minut." });
    return true;
  }
  return false;
}

async function replayWidgetBookingCommand(
  req: Request,
  res: Response,
  next: NextFunction,
  commandType: string,
): Promise<void> {
  const signedInUser = await getCurrentUser(req);
  if (signedInUser?.role === "JOBSEEKER") {
    res.status(403).json({ error: "JOBSEEKER nalozi ne mogu zakazivati termine." });
    return;
  }
  const idempotencyKey = req.get("Idempotency-Key");
  if (!idempotencyKey || idempotencyKey.length > 200 || !/^[\x21-\x7e]+$/.test(idempotencyKey)) {
    next();
    return;
  }
  const phoneNormalized = typeof req.body?.phone === "string" ? normalizedPhone(req.body.phone) : null;
  if (!phoneNormalized) { next(); return; }
  const [salon] = await db.select({ id: salonsTable.id }).from(salonsTable)
    .where(eq(salonsTable.slug, String(req.params.slug))).limit(1);
  if (!salon) { next(); return; }
  const actorId = createHash("sha256").update(phoneNormalized).digest("hex");
  const replay = await replayBookingCommand({
    salonId: salon.id, actorType: "widget_guest", actorId, idempotencyKey,
    commandType, payload: req.body,
  });
  if (replay) { sendBookingCommandResult(res, replay); return; }
  next();
}

/** Widget-bookable salon: must exist, be active and verified. */
async function widgetSalon(slug: string) {
  const [salon] = await db.select().from(salonsTable).where(and(
    eq(salonsTable.slug, slug),
    eq(salonsTable.active, true),
    eq(salonsTable.isVerified, true),
  )).limit(1);
  return salon ?? null;
}

router.get("/widget/salons/:slug", async (req, res): Promise<void> => {
  const slug = String(req.params.slug);
  if (guardRate(req, res, slug, RATE_MAX_READS)) return;
  await ensureDemoData();
  const salon = await widgetSalon(slug);
  if (!salon) { res.status(404).json({ error: "Salon nije dostupan za online zakazivanje." }); return; }
  const services = await db.select().from(servicesTable).where(and(
    eq(servicesTable.salonId, salon.id),
    eq(servicesTable.active, true),
  )).orderBy(asc(servicesTable.categoryName), asc(servicesTable.name));
  const employees = await db.select({ employee: employeesTable }).from(employeeLocationAssignmentsTable)
    .innerJoin(employeesTable, eq(employeesTable.id, employeeLocationAssignmentsTable.employeeId))
    .where(and(
      eq(employeeLocationAssignmentsTable.salonId, salon.id),
      eq(employeeLocationAssignmentsTable.active, true),
      eq(employeesTable.active, true),
    )).orderBy(asc(employeesTable.name)).then((rows) => rows.map((row) => row.employee));
  const mappings = employees.length
    ? await db.select().from(employeeServicesTable).where(inArray(employeeServicesTable.employeeId, employees.map((employee) => employee.id)))
    : [];
  res.json({
    id: salon.id,
    name: salon.name,
    slug: salon.slug,
    city: salon.city,
    address: salon.address,
    services: services.map((service) => ({
      id: service.id,
      name: service.name,
      durationMinutes: service.durationMinutes,
      price: service.price,
      promoPrice: service.promoPrice,
      categoryName: service.categoryName,
    })),
    employees: employees.map((employee) => ({
      id: employee.id,
      name: employee.name,
      role: employee.role,
      serviceIds: mappings.filter((mapping) => mapping.employeeId === employee.id).map((mapping) => mapping.serviceId),
    })),
  });
});

router.get("/widget/salons/:slug/availability", async (req, res): Promise<void> => {
  const slug = String(req.params.slug);
  if (guardRate(req, res, slug, RATE_MAX_READS)) return;
  const parsed = GetWidgetAvailabilityQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { serviceId, date, employeeId } = parsed.data;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    res.status(400).json({ error: "Nevažeći datum." });
    return;
  }
  const salon = await widgetSalon(slug);
  if (!salon) { res.status(404).json({ error: "Salon nije dostupan za online zakazivanje." }); return; }
  const [service] = await db.select().from(servicesTable).where(and(
    eq(servicesTable.id, serviceId),
    eq(servicesTable.salonId, salon.id),
    eq(servicesTable.active, true),
  )).limit(1);
  if (!service) { res.status(404).json({ error: "Usluga nije pronađena." }); return; }
  const granularity = Number(req.query.granularityMinutes ?? 30);
  if (!Number.isInteger(granularity) || granularity < 5 || granularity > 180) {
    res.status(400).json({ error: "Granularnost termina nije ispravna." }); return;
  }
  const slots = await canonicalAvailability({
    salonId: salon.id, service, dates: [date], employeeId: employeeId ?? null,
    granularityMinutes: granularity,
  });
  res.json(slots.map(({ startTime, endTime, employeeId: slotEmployeeId, employeeName }) => ({
    start: startTime, end: endTime, employeeId: slotEmployeeId, employeeName,
  })));
});

router.post("/widget/salons/:slug/appointments", (req, res, next) =>
  replayWidgetBookingCommand(req, res, next, "widget.appointment.create"),
admitBookingRequest, async (req, res): Promise<void> => {
  const slug = String(req.params.slug);
  if (guardRate(req, res, slug, RATE_MAX_BOOKINGS)) return;
  const signedInUser = await getCurrentUser(req);
  if (signedInUser?.role === "JOBSEEKER") {
    res.status(403).json({ error: "JOBSEEKER nalozi ne mogu zakazivati termine." });
    return;
  }
  const parsed = CreateWidgetAppointmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const idempotencyKey = bookingIdempotencyKey(req, res); if (!idempotencyKey) return;
  const { serviceId, date, startTime } = parsed.data;
  const today = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date < today) {
    res.status(400).json({ error: "Izaberite važeći današnji ili budući datum." });
    return;
  }
  if (!/^\d{2}:\d{2}$/.test(startTime)) { res.status(400).json({ error: "Nevažeće vreme termina." }); return; }
  const salon = await widgetSalon(slug);
  if (!salon) { res.status(404).json({ error: "Salon nije dostupan za online zakazivanje." }); return; }
  const [service] = await db.select().from(servicesTable).where(and(
    eq(servicesTable.id, serviceId),
    eq(servicesTable.salonId, salon.id),
    eq(servicesTable.active, true),
  )).limit(1);
  if (!service) { res.status(404).json({ error: "Usluga nije pronađena." }); return; }
  const endTime = appointmentEndTime(startTime, service.durationMinutes);
  if (!endTime) { res.status(400).json({ error: "Trajanje termina izlazi van radnog dana." }); return; }

  const phoneNormalized = normalizedPhone(parsed.data.phone);
  if (!phoneNormalized) { res.status(400).json({ error: "Unesite važeći broj telefona." }); return; }
  let [contact] = await db.select().from(salonCustomersTable).where(and(
    eq(salonCustomersTable.salonId, salon.id), eq(salonCustomersTable.phoneNormalized, phoneNormalized),
  )).limit(1);
  if (!contact) {
    const [registeredUser] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.phoneNormalized, phoneNormalized)).limit(1);
    await db.insert(salonCustomersTable).values({
      salonId: salon.id,
      firstName: parsed.data.firstName.trim(),
      lastName: parsed.data.lastName.trim(),
      phone: parsed.data.phone.trim(),
      phoneNormalized,
      userId: registeredUser?.id ?? null,
      email: parsed.data.email?.trim().toLowerCase() || null,
    }).onConflictDoNothing();
    [contact] = await db.select().from(salonCustomersTable).where(and(
      eq(salonCustomersTable.salonId, salon.id),
      eq(salonCustomersTable.phoneNormalized, phoneNormalized),
    )).limit(1);
  }
  if (!contact) { res.status(500).json({ error: "Kreiranje klijenta nije uspelo — pokušajte ponovo." }); return; }

  const price = service.promoPrice ?? service.price;
  const actorId = createHash("sha256").update(phoneNormalized).digest("hex");
  const command = await executeBookingCommand({
    salonId: salon.id, actorType: "widget_guest", actorId, idempotencyKey,
    commandType: "widget.appointment.create", payload: req.body,
  }, async (tx) => {
    const result = await createAllocatedAppointment({
      salonId: salon.id,
      customerId: null,
      salonCustomerId: contact!.id,
      serviceId: service.id,
      date,
      startTime,
      endTime,
      durationMinutes: service.durationMinutes,
      price,
      status: "pending",
      notes: parsed.data.note?.trim() || null,
      preferredEmployeeId: parsed.data.employeeId ?? null,
      tx,
    });
    if (!result.appointment || !result.employee) {
      return { status: 409, body: { error: "Izabrani termin više nije dostupan — izaberite drugi." } };
    }
    await tx.insert(salonNotificationsTable).values({
      salonId: salon.id,
      title: "Novi zahtev sa sajta",
      message: `${contact!.firstName} ${contact!.lastName} je preko widgeta zatražio/la ${service.name} za ${date} u ${startTime}.`,
      href: "/vlasnik/termini",
    });
    return { status: 201, body: {
      appointmentId: result.appointment.id,
      status: result.appointment.status,
      date: result.appointment.date,
      startTime: result.appointment.startTime,
      endTime: result.appointment.endTime,
      employeeName: result.employee.name,
      serviceName: service.name,
      salonName: salon.name,
    } };
  });
  if (!command.replayed && command.status === 201) await publishSalonNotificationUpdate(salon.id);
  sendBookingCommandResult(res, command);
});

router.post("/widget/salons/:slug/booking-groups", (req, res, next) =>
  replayWidgetBookingCommand(req, res, next, "widget.booking-group.create"),
admitBookingRequest, async (req, res): Promise<void> => {
  const slug = String(req.params.slug);
  if (guardRate(req, res, slug, RATE_MAX_BOOKINGS)) return;
  const signedInUser = await getCurrentUser(req);
  if (signedInUser?.role === "JOBSEEKER") {
    res.status(403).json({ error: "JOBSEEKER nalozi ne mogu zakazivati termine." });
    return;
  }
  const parsed = CreateWidgetBookingGroupBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const idempotencyKey = bookingIdempotencyKey(req, res); if (!idempotencyKey) return;
  const today = new Date().toISOString().slice(0, 10);
  const rawDates = rawTreatmentDateInputs(req.body);
  if (!rawDates) {
    res.status(400).json({ error: "Izaberite važeći današnji ili budući termin." });
    return;
  }
  const treatments = parsed.data.treatments.map((item, index) => ({
    ...item,
    date: rawDates[index]!,
  }));
  if (treatments.some((item) => item.date < today || !/^\d{2}:\d{2}$/.test(item.startTime))) {
    res.status(400).json({ error: "Izaberite važeći današnji ili budući termin." });
    return;
  }
  const salon = await widgetSalon(slug);
  if (!salon) { res.status(404).json({ error: "Salon nije dostupan za online zakazivanje." }); return; }
  const services = await db.select().from(servicesTable).where(and(
    eq(servicesTable.salonId, salon.id), eq(servicesTable.active, true),
    inArray(servicesTable.id, treatments.map((item) => item.serviceId)),
  ));
  if (services.length !== new Set(treatments.map((item) => item.serviceId)).size) {
    res.status(404).json({ error: "Jedna ili više usluga nisu pronađene." }); return;
  }
  const phoneNormalized = normalizedPhone(parsed.data.phone);
  if (!phoneNormalized) { res.status(400).json({ error: "Unesite važeći broj telefona." }); return; }
  let [contact] = await db.select().from(salonCustomersTable).where(and(
    eq(salonCustomersTable.salonId, salon.id), eq(salonCustomersTable.phoneNormalized, phoneNormalized),
  )).limit(1);
  if (!contact) {
    const [registeredUser] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.phoneNormalized, phoneNormalized)).limit(1);
    await db.insert(salonCustomersTable).values({
      salonId: salon.id, firstName: parsed.data.firstName.trim(), lastName: parsed.data.lastName.trim(),
      phone: parsed.data.phone.trim(), phoneNormalized, userId: registeredUser?.id ?? null,
      email: parsed.data.email?.trim().toLowerCase() || null,
    }).onConflictDoNothing();
    [contact] = await db.select().from(salonCustomersTable).where(and(
      eq(salonCustomersTable.salonId, salon.id), eq(salonCustomersTable.phoneNormalized, phoneNormalized),
    )).limit(1);
  }
  if (!contact) { res.status(500).json({ error: "Kreiranje klijenta nije uspelo — pokušajte ponovo." }); return; }
  const byId = new Map(services.map((service) => [service.id, service]));
  try {
    const actorId = createHash("sha256").update(phoneNormalized).digest("hex");
    const command = await executeBookingCommand({
      salonId: salon.id, actorType: "widget_guest", actorId, idempotencyKey,
      commandType: "widget.booking-group.create", payload: req.body,
    }, async (tx) => {
      await lockAppointmentResources(tx, salon.id, treatments.map((item) => ({ date: item.date })));
      const requirements: Array<Awaited<ReturnType<typeof fetchServiceResourceRequirements>>> = [];
      const planned: Array<{ item: (typeof treatments)[number]; service: typeof servicesTable.$inferSelect; employeeId: string; endTime: string }> = [];
      const reservedAppointments: Array<{ employeeId: string; date: string; startTime: string; endTime: string; bufferMinutes: number; resourceIds: string[] }> = [];
      const resourceReservations: Array<{ resourceId: string; quantity: number; date: string; startTime: string; endTime: string; bufferMinutes: number }> = [];
      for (const item of treatments) {
        const service = byId.get(item.serviceId)!;
        const endTime = appointmentEndTime(item.startTime, service.durationMinutes);
        if (!endTime) throw new Error("INVALID_TIME");
        const serviceRequirements = await fetchServiceResourceRequirements(tx, service.id);
        requirements.push(serviceRequirements);
        const slots = await canonicalAvailability({
          salonId: salon.id, service, dates: [item.date], employeeId: item.employeeId ?? null, store: tx,
          reservedAppointments, resourceReservations,
        });
        const slot = slots.find((candidate) => candidate.startTime === item.startTime && candidate.endTime === endTime);
        if (!slot || planned.some((entry) => entry.item.date === item.date && entry.employeeId === slot.employeeId
          && entry.item.startTime < endTime && entry.endTime > item.startTime)) throw new Error("STALE_SLOT");
        planned.push({ item, service, employeeId: slot.employeeId, endTime });
        reservedAppointments.push({
          employeeId: slot.employeeId, date: item.date, startTime: item.startTime, endTime,
          bufferMinutes: service.bufferMinutes, resourceIds: serviceRequirements.map((entry) => entry.resourceId),
        });
        resourceReservations.push(...serviceRequirements.map((entry) => ({
          resourceId: entry.resourceId, quantity: entry.quantity, date: item.date, startTime: item.startTime,
          endTime: appointmentEndTime(endTime, service.bufferMinutes)!, bufferMinutes: 0,
        })));
      }
      const [settings] = await tx.select().from(salonBookingSettingsTable)
        .where(eq(salonBookingSettingsTable.salonId, salon.id)).for("share").limit(1);
      if (!bookingGroupLayoutValid(planned.map((entry, position) => ({
        date: entry.item.date, startTime: entry.item.startTime, endTime: entry.endTime,
        position,
      })), settings?.maxVisitGapMinutes ?? 0)) throw new Error("INVALID_LAYOUT");
      await lockAppointmentResources(tx, salon.id, planned.flatMap((entry, index) => [
        { date: entry.item.date, employeeId: entry.employeeId },
        ...requirements[index]!.map((requirement) => ({ date: entry.item.date, resourceId: requirement.resourceId })),
      ]));
      const revalidationAppointments: typeof reservedAppointments = [];
      const revalidationResources: typeof resourceReservations = [];
      for (let index = 0; index < planned.length; index += 1) {
        const entry = planned[index]!;
        const slots = await canonicalAvailability({
          salonId: salon.id, service: entry.service, dates: [entry.item.date],
          employeeId: entry.employeeId, store: tx,
          reservedAppointments: revalidationAppointments, resourceReservations: revalidationResources,
        });
        if (!slots.some((slot) => slot.startTime === entry.item.startTime && slot.endTime === entry.endTime
          && slot.employeeId === entry.employeeId)) throw new Error("STALE_SLOT");
        revalidationAppointments.push({
          employeeId: entry.employeeId, date: entry.item.date, startTime: entry.item.startTime, endTime: entry.endTime,
          bufferMinutes: entry.service.bufferMinutes, resourceIds: requirements[index]!.map((item) => item.resourceId),
        });
        revalidationResources.push(...requirements[index]!.map((item) => ({
          resourceId: item.resourceId, quantity: item.quantity, date: entry.item.date, startTime: entry.item.startTime,
          endTime: appointmentEndTime(entry.endTime, entry.service.bufferMinutes)!, bufferMinutes: 0,
        })));
      }
      const [group] = await tx.insert(bookingGroupsTable).values({
        salonId: salon.id, customerId: null, salonCustomerId: contact!.id, createdByUserId: null,
        notes: parsed.data.note?.trim() || null,
      }).returning();
      const appointments = [];
      for (let position = 0; position < planned.length; position++) {
        const entry = planned[position]!;
        const [appointment] = await tx.insert(appointmentsTable).values({
          salonId: salon.id, customerId: null, salonCustomerId: contact!.id, employeeId: entry.employeeId,
          serviceId: entry.service.id, bookingGroupId: group!.id, date: entry.item.date,
          startTime: entry.item.startTime, endTime: entry.endTime, durationMinutes: entry.service.durationMinutes,
          price: entry.service.promoPrice ?? entry.service.price, status: "pending",
          notes: parsed.data.note?.trim() || null, plannedDate: entry.item.date,
          plannedStartTime: entry.item.startTime, plannedEndTime: entry.endTime,
        }).returning();
        await tx.insert(appointmentTreatmentsTable).values({
          appointmentId: appointment!.id, serviceId: entry.service.id, employeeId: entry.employeeId,
          position, durationMinutes: entry.service.durationMinutes, bufferMinutes: entry.service.bufferMinutes,
          price: entry.service.promoPrice ?? entry.service.price,
          plannedStartTime: entry.item.startTime, plannedEndTime: entry.endTime,
        });
        const bufferedEnd = appointmentEndTime(entry.endTime, entry.service.bufferMinutes);
        if (!bufferedEnd) throw new Error("STALE_SLOT");
        await allocateResourcesInTx(tx, salon.id, requirements[position]!, appointment!.id, entry.item.date,
          entry.item.startTime, requirements[position]!.length ? bufferedEnd : entry.endTime);
        const [employee] = await tx.select().from(employeesTable).where(eq(employeesTable.id, entry.employeeId)).limit(1);
        appointments.push({ appointment: appointment!, employee: employee!, service: entry.service });
      }
      await tx.insert(salonNotificationsTable).values({
        salonId: salon.id, title: "Nova grupna rezervacija sa sajta",
        message: `${contact!.firstName} ${contact!.lastName} je preko widgeta zatražio/la ${appointments.length} tretmana.`,
        href: "/vlasnik/termini",
      });
      const response = CreateWidgetBookingGroupResponse.parse({
        id: group!.id, salonId: salon.id, createdAt: group!.createdAt,
        appointments: appointments.map(({ appointment, employee, service }) => ({
          id: appointment.id, salonId: salon.id, salonSlug: salon.slug, salonName: salon.name,
          serviceId: service.id, customerName: `${contact!.firstName} ${contact!.lastName}`,
          serviceName: service.name, employeeId: employee.id, employeeName: employee.name,
          date: appointment.date, startTime: appointment.startTime, endTime: appointment.endTime,
          durationMinutes: appointment.durationMinutes, price: appointment.price, treatmentLocation: "salon",
          travelFee: 0, treatmentAddress: null, seriesId: null, bookingGroupId: group!.id,
          status: appointment.status, notes: appointment.notes, allocatedResources: [],
        })),
      });
       await enqueueBookingGroupConfirmationInTx(tx, group!.id);
      return { status: 201, body: response };
    });
    if (!command.replayed && command.status === 201) {
      await publishSalonNotificationUpdate(salon.id);
    }
    sendBookingCommandResult(res, command);
  } catch (error) {
    if (error instanceof Error && (error.message === "STALE_SLOT" || error.message === "INVALID_TIME" || error.message === "INVALID_LAYOUT")) {
      res.status(error.message === "INVALID_TIME" ? 400 : 409).json({
        ...(error.message === "INVALID_LAYOUT" ? { code: "BOOKING_GROUP_LAYOUT_CONFLICT" } : {}),
        error: error.message === "INVALID_TIME" ? "Vreme tretmana nije ispravno."
          : error.message === "INVALID_LAYOUT" ? "Izabrani tretmani nisu u dozvoljenom redosledu ili razmaku."
          : "Jedan od termina više nije dostupan — izaberite drugi.",
      });
      return;
    }
    throw error;
  }
});

export default router;
