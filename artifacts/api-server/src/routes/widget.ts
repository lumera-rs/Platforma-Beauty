import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  employeeServicesTable,
  employeesTable,
  salonCustomersTable,
  salonNotificationsTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import {
  CreateWidgetAppointmentBody,
  GetWidgetAvailabilityQueryParams,
} from "@workspace/api-zod";
import { ensureDemoData } from "../lib/seed";
import { publishSalonNotificationUpdate } from "../lib/salon-notification-events";
import {
  appointmentEndTime,
  availableEmployee,
  createAllocatedAppointment,
  eligibleEmployees,
  normalizedPhone,
} from "./marketplace";
import { getCurrentUser } from "../lib/auth";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// CORS — ONLY these /widget routes are cross-origin readable (the widget is
// embedded as an iframe/script on external salon websites). No credentials.
// The rest of the API stays same-origin.
// ─────────────────────────────────────────────────────────────────────────────
router.use("/widget", (req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
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
  const forwarded = req.headers["x-forwarded-for"];
  const ip = (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : null) || req.socket.remoteAddress || "unknown";
  return `${ip}:${slug}`;
}

function guardRate(req: Request, res: Response, slug: string, max: number): boolean {
  if (rateLimited(clientKey(req, slug), max)) {
    res.status(429).json({ error: "Previše zahteva — pokušajte ponovo za minut." });
    return true;
  }
  return false;
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
  const employees = await db.select().from(employeesTable).where(and(
    eq(employeesTable.salonId, salon.id),
    eq(employeesTable.active, true),
  )).orderBy(asc(employeesTable.name));
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
  const candidates = await eligibleEmployees(salon.id, service.id, employeeId ?? null);
  if (!candidates.length) { res.json([]); return; }
  const slots: { start: string; end: string; employeeId: string; employeeName: string }[] = [];
  for (let hour = 9; hour < 17; hour += 1) {
    const start = `${String(hour).padStart(2, "0")}:00`;
    const end = appointmentEndTime(start, service.durationMinutes);
    if (!end) continue;
    const employee = await availableEmployee(salon.id, service.id, date, start, end, employeeId ?? null);
    if (employee) slots.push({ start, end, employeeId: employee.id, employeeName: employee.name });
  }
  res.json(slots);
});

router.post("/widget/salons/:slug/appointments", async (req, res): Promise<void> => {
  const slug = String(req.params.slug);
  if (guardRate(req, res, slug, RATE_MAX_BOOKINGS)) return;
  const signedInUser = await getCurrentUser(req);
  if (signedInUser?.role === "JOBSEEKER") {
    res.status(403).json({ error: "JOBSEEKER nalozi ne mogu zakazivati termine." });
    return;
  }
  const parsed = CreateWidgetAppointmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
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

  // Find-or-create the CRM contact by normalized phone (guest booking:
  // appointments.customerId stays null, the salon_customers row carries identity).
  let [contact] = await db.select().from(salonCustomersTable).where(and(
    eq(salonCustomersTable.salonId, salon.id),
    eq(salonCustomersTable.phoneNormalized, phoneNormalized),
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
  const result = await createAllocatedAppointment({
    salonId: salon.id,
    customerId: null,
    salonCustomerId: contact.id,
    serviceId: service.id,
    date,
    startTime,
    endTime,
    durationMinutes: service.durationMinutes,
    price,
    status: "pending",
    notes: parsed.data.note?.trim() || null,
    preferredEmployeeId: parsed.data.employeeId ?? null,
  });
  if (!result.appointment || !result.employee) {
    res.status(409).json({ error: "Izabrani termin više nije dostupan — izaberite drugi." });
    return;
  }
  await db.insert(salonNotificationsTable).values({
    salonId: salon.id,
    title: "Novi zahtev sa sajta",
    message: `${contact.firstName} ${contact.lastName} je preko widgeta zatražio/la ${service.name} za ${date} u ${startTime}.`,
    href: "/vlasnik/termini",
  });
  await publishSalonNotificationUpdate(salon.id);
  res.status(201).json({
    appointmentId: result.appointment.id,
    status: result.appointment.status,
    date: result.appointment.date,
    startTime: result.appointment.startTime,
    endTime: result.appointment.endTime,
    employeeName: result.employee.name,
    serviceName: service.name,
    salonName: salon.name,
  });
});

export default router;
