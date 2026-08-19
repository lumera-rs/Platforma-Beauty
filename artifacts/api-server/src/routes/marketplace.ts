import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  appointmentsTable,
  coursesTable,
  db,
  educationCentersTable,
  employeesTable,
  favoritesTable,
  loyaltyTiersTable,
  orderItemsTable,
  ordersTable,
  productsTable,
  reviewsTable,
  salonHoursTable,
  salonLoyaltyStatusesTable,
  salonsTable,
  serviceCategoriesTable,
  servicesTable,
  subscriptionPlansTable,
  subscriptionsTable,
  usersTable,
} from "@workspace/db";
import {
  AdminCreateLoyaltyTierBody,
  AdminCreateSubscriptionPlanBody,
  AdminDeleteLoyaltyTierParams,
  AdminDeleteReviewParams,
  AdminDeleteSubscriptionPlanParams,
  AdminListReviewsQueryParams,
  AdminListSalonsQueryParams,
  AdminListUsersQueryParams,
  AdminUpdateLoyaltyTierBody,
  AdminUpdateLoyaltyTierParams,
  AdminUpdateReviewBody,
  AdminUpdateReviewParams,
  AdminUpdateSalonBody,
  AdminUpdateSalonParams,
  AdminUpdateSubscriptionPlanBody,
  AdminUpdateSubscriptionPlanParams,
  AdminUpdateUserBody,
  AdminUpdateUserParams,
  CancelAppointmentBody,
  CancelAppointmentParams,
  CancelAppointmentResponse,
  CreateAppointmentBody,
  CreateAppointmentResponse,
  CreateOrderBody,
  CreateOrderResponse,
  CreateSalonServiceBody,
  CreateSalonServiceResponse,
  GetAdminSummaryResponse,
  GetCurrentUserResponse,
  GetCustomerDashboardResponse,
  GetLoyaltyStatusResponse,
  GetSalonAvailabilityParams,
  GetSalonAvailabilityQueryParams,
  GetSalonAvailabilityResponse,
  GetSalonDashboardResponse,
  GetSalonParams,
  GetSalonResponse,
  GetShopSummaryResponse,
  ListCoursesQueryParams,
  ListCoursesResponse,
  ListEnrollmentsResponse,
  ListFavoritesResponse,
  ListMyAppointmentsQueryParams,
  ListMyAppointmentsResponse,
  ListOrdersResponse,
  ListProductsQueryParams,
  ListProductsResponse,
  ListSalonAppointmentsQueryParams,
  ListSalonAppointmentsResponse,
  ListSalonEmployeesResponse,
  ListSalonServicesResponse,
  ListSalonsQueryParams,
  ListSalonsResponse,
  LoginBody,
  LoginResponse,
  RegisterBody,
  RegisterResponse,
  ToggleFavoriteBody,
  ToggleFavoriteResponse,
  UpdateAppointmentBody,
  UpdateAppointmentParams,
  UpdateAppointmentResponse,
  UpdateSalonAppointmentBody,
  UpdateSalonAppointmentParams,
  UpdateSalonAppointmentResponse,
} from "@workspace/api-zod";
import { createSession, destroySession, getCurrentUser, hashPassword, isAdmin, publicUser, sessionCookieName, verifyPassword } from "../lib/auth";
import { ensureDemoData } from "../lib/seed";

const router: IRouter = Router();

function cookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 24 * 14, path: "/" };
}

function normalizeBooleanQuery(query: Request["query"], keys: string[]): Record<string, unknown> | null {
  const normalized: Record<string, unknown> = { ...query };
  for (const key of keys) {
    const value = normalized[key];
    if (value === undefined) continue;
    if (value === true || value === "true") normalized[key] = true;
    else if (value === false || value === "false") normalized[key] = false;
    else return null;
  }
  return normalized;
}

function calendarDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

async function current(req: Request, res: Response) {
  await ensureDemoData();
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Prijavite se da biste nastavili." });
    return null;
  }
  return user;
}

async function ownedSalon(userId: string) {
  const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.ownerId, userId)).limit(1);
  return salon ?? null;
}

function card(salon: typeof salonsTable.$inferSelect, services: (typeof servicesTable.$inferSelect)[] = []) {
  return {
    id: salon.id,
    slug: salon.slug,
    name: salon.name,
    city: salon.city,
    municipality: salon.municipality,
    address: salon.address,
    imageUrl: salon.imageUrl,
    rating: salon.rating / 10,
    reviewCount: salon.reviewCount,
    shortDescription: salon.shortDescription,
    popularServices: services.slice(0, 3).map((item) => item.name),
    startingPrice: services.length ? Math.min(...services.map((item) => item.promoPrice ?? item.price)) : 0,
    earliestSlot: "Danas, 16:30",
    homeService: salon.homeService,
    featured: salon.featured,
  };
}

async function salonCards(salons: (typeof salonsTable.$inferSelect)[]) {
  if (!salons.length) return [];
  const allServices = await db.select().from(servicesTable).where(inArray(servicesTable.salonId, salons.map((salon) => salon.id)));
  return salons.map((salon) => card(salon, allServices.filter((service) => service.salonId === salon.id)));
}

function appointmentView(
  appointment: typeof appointmentsTable.$inferSelect,
  salon: typeof salonsTable.$inferSelect,
  service: typeof servicesTable.$inferSelect,
  customer: typeof usersTable.$inferSelect,
  employee: typeof employeesTable.$inferSelect | undefined,
) {
  return {
    id: appointment.id,
    salonId: salon.id,
    salonName: salon.name,
    customerName: `${customer.firstName} ${customer.lastName}`,
    serviceName: service.name,
    employeeName: employee?.name ?? "Bilo koji dostupan",
    date: appointment.date,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    durationMinutes: appointment.durationMinutes,
    price: appointment.price,
    status: appointment.status,
    notes: appointment.notes,
  };
}

async function appointmentList(where?: ReturnType<typeof eq>) {
  const appointments = await db.select().from(appointmentsTable).where(where).orderBy(asc(appointmentsTable.date), asc(appointmentsTable.startTime));
  if (!appointments.length) return [];
  const salonIds = [...new Set(appointments.map((item) => item.salonId))];
  const serviceIds = [...new Set(appointments.map((item) => item.serviceId))];
  const customerIds = [...new Set(appointments.map((item) => item.customerId))];
  const employeeIds = appointments.flatMap((item) => item.employeeId ? [item.employeeId] : []);
  const [salons, services, customers, employees] = await Promise.all([
    db.select().from(salonsTable).where(inArray(salonsTable.id, salonIds)),
    db.select().from(servicesTable).where(inArray(servicesTable.id, serviceIds)),
    db.select().from(usersTable).where(inArray(usersTable.id, customerIds)),
    employeeIds.length ? db.select().from(employeesTable).where(inArray(employeesTable.id, employeeIds)) : Promise.resolve([]),
  ]);
  return appointments.map((item) => appointmentView(
    item,
    salons.find((salon) => salon.id === item.salonId)!,
    services.find((service) => service.id === item.serviceId)!,
    customers.find((customer) => customer.id === item.customerId)!,
    (employees as (typeof employeesTable.$inferSelect)[]).find((employee) => employee.id === item.employeeId),
  ));
}

router.post("/auth/register", async (req, res): Promise<void> => {
  await ensureDemoData();
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, parsed.data.email.toLowerCase())).limit(1);
  if (existing) { res.status(409).json({ error: "Nalog sa ovom e-mail adresom već postoji." }); return; }
  const [user] = await db.insert(usersTable).values({
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    email: parsed.data.email.toLowerCase(),
    phone: parsed.data.phone ?? null,
    passwordHash: await hashPassword(parsed.data.password),
    role: parsed.data.role ?? "CUSTOMER",
  }).returning();
  const token = await createSession(user!.id);
  res.cookie(sessionCookieName, token, cookieOptions());
  res.status(201).json(RegisterResponse.parse({ user: publicUser(user!), message: "Dobro došli u Lumeru." }));
});

router.post("/auth/login", async (req, res): Promise<void> => {
  await ensureDemoData();
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, parsed.data.email.toLowerCase())).limit(1);
  if (!user || !user.active || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "E-mail ili lozinka nisu ispravni." }); return;
  }
  const token = await createSession(user.id);
  res.cookie(sessionCookieName, token, cookieOptions());
  res.json(LoginResponse.parse({ user: publicUser(user), message: "Uspešno ste prijavljeni." }));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await destroySession(req);
  res.clearCookie(sessionCookieName, { path: "/" });
  res.sendStatus(204);
});

router.get("/auth/me", async (req, res): Promise<void> => {
  await ensureDemoData();
  const user = await getCurrentUser(req);
  res.json(GetCurrentUserResponse.parse({ user: user ? publicUser(user) : null }));
});

router.get("/salons", async (req, res): Promise<void> => {
  await ensureDemoData();
  const parsed = ListSalonsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let salons = await db.select().from(salonsTable).where(eq(salonsTable.active, true));
  const query = parsed.data;
  if (query.city) salons = salons.filter((item) => item.city.toLowerCase() === query.city!.toLowerCase());
  if (query.homeService !== undefined) salons = salons.filter((item) => item.homeService === query.homeService);
  const allCards = await salonCards(salons);
  const filtered = query.category || query.treatment
    ? allCards.filter((item) => item.popularServices.join(" ").toLowerCase().includes((query.treatment ?? query.category ?? "").toLowerCase()))
    : allCards;
  const sorted = [...filtered].sort((a, b) => {
    if (query.sort === "top-rated") return b.rating - a.rating;
    if (query.sort === "cheapest") return a.startingPrice - b.startingPrice;
    if (query.sort === "most-popular") return b.reviewCount - a.reviewCount;
    return Number(b.featured) - Number(a.featured) || b.rating - a.rating;
  });
  res.json(ListSalonsResponse.parse(sorted));
});

router.get("/salons/:slug", async (req, res): Promise<void> => {
  await ensureDemoData();
  const parsed = GetSalonParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.slug, parsed.data.slug)).limit(1);
  if (!salon) { res.status(404).json({ error: "Salon nije pronađen." }); return; }
  const [services, staff, hours, reviews] = await Promise.all([
    db.select().from(servicesTable).where(and(eq(servicesTable.salonId, salon.id), eq(servicesTable.active, true))),
    db.select().from(employeesTable).where(and(eq(employeesTable.salonId, salon.id), eq(employeesTable.active, true))),
    db.select().from(salonHoursTable).where(eq(salonHoursTable.salonId, salon.id)).orderBy(asc(salonHoursTable.weekday)),
    db.select().from(reviewsTable).where(and(eq(reviewsTable.salonId, salon.id), eq(reviewsTable.visible, true))),
  ]);
  const reviewUsers = reviews.length ? await db.select().from(usersTable).where(inArray(usersTable.id, reviews.map((item) => item.customerId))) : [];
  res.json(GetSalonResponse.parse({
    ...card(salon, services),
    gallery: salon.gallery,
    description: salon.description,
    phone: salon.phone,
    email: salon.email,
    latitude: salon.latitude ?? 44.8,
    longitude: salon.longitude ?? 20.46,
    hours: hours.map((item) => ({ day: ["Ponedeljak", "Utorak", "Sreda", "Četvrtak", "Petak", "Subota", "Nedelja"][item.weekday - 1] ?? "Ponedeljak", open: item.openTime, close: item.closeTime, closed: item.closed })),
    staff: staff.map((item) => ({ id: item.id, name: item.name, role: item.role, bio: item.bio, avatarUrl: item.avatarUrl, specialties: item.specialties })),
    services: services.map((item) => ({ id: item.id, category: item.categoryName, name: item.name, description: item.description, durationMinutes: item.durationMinutes, price: item.price, promoPrice: item.promoPrice, imageUrl: item.imageUrl, active: item.active })),
    reviews: reviews.map((item) => ({ id: item.id, authorName: `${reviewUsers.find((user) => user.id === item.customerId)?.firstName ?? "Gost"} ${reviewUsers.find((user) => user.id === item.customerId)?.lastName ?? ""}`.trim(), rating: item.rating, text: item.text, date: item.createdAt.toISOString().slice(0, 10), serviceName: item.serviceName })),
  }));
});

router.get("/salons/:salonId/availability", async (req, res): Promise<void> => {
  await ensureDemoData();
  const [params, query] = [GetSalonAvailabilityParams.safeParse(req.params), GetSalonAvailabilityQueryParams.safeParse(req.query)];
  if (!params.success || !query.success) { res.status(400).json({ error: "Parametri za dostupnost nisu ispravni." }); return; }
  const [service] = await db.select().from(servicesTable).where(and(eq(servicesTable.id, query.data.serviceId), eq(servicesTable.salonId, params.data.salonId))).limit(1);
  if (!service) { res.status(404).json({ error: "Usluga nije pronađena." }); return; }
  const staff = await db.select().from(employeesTable).where(eq(employeesTable.salonId, params.data.salonId));
  const existing = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.salonId, params.data.salonId), eq(appointmentsTable.date, calendarDate(query.data.date))));
  const targets = query.data.employeeId ? staff.filter((item) => item.id === query.data.employeeId) : staff;
  const slots = targets.flatMap((employee) => Array.from({ length: 9 }, (_, index) => {
    const start = `${String(9 + index).padStart(2, "0")}:00`;
    const endHour = 9 + index + Math.ceil(service.durationMinutes / 60);
    const end = `${String(endHour).padStart(2, "0")}:00`;
    const occupied = existing.some((appointment) => appointment.employeeId === employee.id && appointment.status !== "cancelled" && appointment.startTime < end && appointment.endTime > start);
    return occupied ? null : { start, end, employeeId: employee.id, employeeName: employee.name };
  }).filter(Boolean)).slice(0, 14);
  res.json(GetSalonAvailabilityResponse.parse(slots));
});

router.get("/appointments", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const parsed = ListMyAppointmentsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let appointments = await appointmentList(eq(appointmentsTable.customerId, user.id));
  if (parsed.data.status) appointments = appointments.filter((item) => item.status === parsed.data.status);
  if (parsed.data.scope === "upcoming") appointments = appointments.filter((item) => item.date >= new Date().toISOString().slice(0, 10));
  if (parsed.data.scope === "past") appointments = appointments.filter((item) => item.date < new Date().toISOString().slice(0, 10));
  res.json(ListMyAppointmentsResponse.parse(appointments));
});

router.post("/appointments", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [service] = await db.select().from(servicesTable).where(and(eq(servicesTable.id, parsed.data.serviceId), eq(servicesTable.salonId, parsed.data.salonId))).limit(1);
  const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.id, parsed.data.salonId)).limit(1);
  if (!service || !salon) { res.status(404).json({ error: "Salon ili usluga nisu pronađeni." }); return; }
  const [employee] = parsed.data.employeeId ? await db.select().from(employeesTable).where(eq(employeesTable.id, parsed.data.employeeId)).limit(1) : await db.select().from(employeesTable).where(eq(employeesTable.salonId, salon.id)).limit(1);
  if (!employee) { res.status(409).json({ error: "Nema dostupnog zaposlenog za ovaj termin." }); return; }
  const startHour = Number(parsed.data.startTime.slice(0, 2));
  const endTime = `${String(startHour + Math.ceil(service.durationMinutes / 60)).padStart(2, "0")}:00`;
  const existing = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.employeeId, employee.id), eq(appointmentsTable.date, calendarDate(parsed.data.date))));
  if (existing.some((item) => item.status !== "cancelled" && item.startTime < endTime && item.endTime > parsed.data.startTime)) {
    res.status(409).json({ error: "Ovaj termin je upravo zauzet. Izaberite drugi termin." }); return;
  }
  const [appointment] = await db.insert(appointmentsTable).values({
    salonId: salon.id, customerId: user.id, employeeId: employee.id, serviceId: service.id, date: calendarDate(parsed.data.date), startTime: parsed.data.startTime, endTime, durationMinutes: service.durationMinutes, price: service.promoPrice ?? service.price, status: "pending", notes: parsed.data.notes ?? null,
  }).returning();
  res.status(201).json(CreateAppointmentResponse.parse(appointmentView(appointment!, salon, service, user, employee)));
});

router.patch("/appointments/:appointmentId", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const [params, body] = [UpdateAppointmentParams.safeParse(req.params), UpdateAppointmentBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci za izmenu termina nisu ispravni." }); return; }
  const [appointment] = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.id, params.data.appointmentId), eq(appointmentsTable.customerId, user.id))).limit(1);
  if (!appointment) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  const [updated] = await db.update(appointmentsTable).set({ date: body.data.date ? calendarDate(body.data.date) : appointment.date, startTime: body.data.startTime ?? appointment.startTime, employeeId: body.data.employeeId ?? appointment.employeeId, notes: body.data.notes ?? appointment.notes }).where(eq(appointmentsTable.id, appointment.id)).returning();
  const [salon, service] = await Promise.all([db.select().from(salonsTable).where(eq(salonsTable.id, updated!.salonId)).limit(1), db.select().from(servicesTable).where(eq(servicesTable.id, updated!.serviceId)).limit(1)]);
  const [employee] = updated!.employeeId ? await db.select().from(employeesTable).where(eq(employeesTable.id, updated!.employeeId)).limit(1) : [];
  res.json(UpdateAppointmentResponse.parse(appointmentView(updated!, salon[0]!, service[0]!, user, employee)));
});

router.post("/appointments/:appointmentId/cancel", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const [params, body] = [CancelAppointmentParams.safeParse(req.params), CancelAppointmentBody.safeParse(req.body ?? {})];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci za otkazivanje nisu ispravni." }); return; }
  const [appointment] = await db.update(appointmentsTable).set({ status: "cancelled", cancellationReason: body.data.reason ?? null }).where(and(eq(appointmentsTable.id, params.data.appointmentId), eq(appointmentsTable.customerId, user.id))).returning();
  if (!appointment) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  const [salon, service, employee] = await Promise.all([db.select().from(salonsTable).where(eq(salonsTable.id, appointment.salonId)).limit(1), db.select().from(servicesTable).where(eq(servicesTable.id, appointment.serviceId)).limit(1), appointment.employeeId ? db.select().from(employeesTable).where(eq(employeesTable.id, appointment.employeeId)).limit(1) : Promise.resolve([])]);
  res.json(CancelAppointmentResponse.parse(appointmentView(appointment, salon[0]!, service[0]!, user, employee[0])));
});

router.get("/customer/dashboard", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const appointments = await appointmentList(eq(appointmentsTable.customerId, user.id));
  const salons = await db.select().from(salonsTable).limit(3);
  const favorites = await db.select().from(favoritesTable).where(eq(favoritesTable.userId, user.id));
  res.json(GetCustomerDashboardResponse.parse({ upcoming: appointments.filter((item) => item.status !== "cancelled").slice(0, 3), recentSalons: await salonCards(salons), favoriteCount: favorites.length, visitCount: appointments.filter((item) => item.status === "completed").length }));
});

router.get("/customer/favorites", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const favorites = await db.select().from(favoritesTable).where(eq(favoritesTable.userId, user.id));
  const salons = favorites.length ? await db.select().from(salonsTable).where(inArray(salonsTable.id, favorites.map((item) => item.salonId))) : [];
  res.json(ListFavoritesResponse.parse(await salonCards(salons)));
});

router.post("/customer/favorites", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const parsed = ToggleFavoriteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [favorite] = await db.select().from(favoritesTable).where(and(eq(favoritesTable.userId, user.id), eq(favoritesTable.salonId, parsed.data.salonId))).limit(1);
  if (favorite) await db.delete(favoritesTable).where(eq(favoritesTable.id, favorite.id));
  else await db.insert(favoritesTable).values({ userId: user.id, salonId: parsed.data.salonId });
  res.json(ToggleFavoriteResponse.parse({ salonId: parsed.data.salonId, favorited: !favorite }));
});

router.get("/salon/dashboard", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const salon = await ownedSalon(user.id);
  if (!salon) { res.status(403).json({ error: "Ova kontrolna tabla je dostupna vlasnicima salona." }); return; }
  const [services, appointments, loyalty] = await Promise.all([db.select().from(servicesTable).where(eq(servicesTable.salonId, salon.id)), appointmentList(eq(appointmentsTable.salonId, salon.id)), db.select().from(salonLoyaltyStatusesTable).where(eq(salonLoyaltyStatusesTable.salonId, salon.id)).limit(1)]);
  const loyaltyData = await loyaltyStatus(salon.id);
  const completed = appointments.filter((item) => item.status === "completed");
  res.json(GetSalonDashboardResponse.parse({ salon: card(salon, services), todayAppointments: appointments.slice(0, 5), revenueThisMonth: completed.reduce((sum, item) => sum + item.price, 0), bookingsThisMonth: appointments.length, newCustomers: new Set(appointments.map((item) => item.customerName)).size, rating: salon.rating / 10, revenueChange: 12, loyalty: loyaltyData }));
});

router.get("/salon/appointments", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const salon = await ownedSalon(user.id); if (!salon) { res.status(403).json({ error: "Nedozvoljen pristup." }); return; }
  const parsed = ListSalonAppointmentsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let items = await appointmentList(eq(appointmentsTable.salonId, salon.id));
  if (parsed.data.status) items = items.filter((item) => item.status === parsed.data.status);
  if (parsed.data.from) items = items.filter((item) => item.date >= calendarDate(parsed.data.from!));
  if (parsed.data.to) items = items.filter((item) => item.date <= calendarDate(parsed.data.to!));
  res.json(ListSalonAppointmentsResponse.parse(items));
});

router.patch("/salon/appointments/:appointmentId", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const salon = await ownedSalon(user.id); if (!salon) { res.status(403).json({ error: "Nedozvoljen pristup." }); return; }
  const [params, body] = [UpdateSalonAppointmentParams.safeParse(req.params), UpdateSalonAppointmentBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci za izmenu nisu ispravni." }); return; }
  const [updated] = await db.update(appointmentsTable).set({ status: body.data.status, employeeId: body.data.employeeId, notes: body.data.notes }).where(and(eq(appointmentsTable.id, params.data.appointmentId), eq(appointmentsTable.salonId, salon.id))).returning();
  if (!updated) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  const [service, customer, employee] = await Promise.all([db.select().from(servicesTable).where(eq(servicesTable.id, updated.serviceId)).limit(1), db.select().from(usersTable).where(eq(usersTable.id, updated.customerId)).limit(1), updated.employeeId ? db.select().from(employeesTable).where(eq(employeesTable.id, updated.employeeId)).limit(1) : Promise.resolve([])]);
  res.json(UpdateSalonAppointmentResponse.parse(appointmentView(updated, salon, service[0]!, customer[0]!, employee[0])));
});

router.get("/salon/services", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const salon = await ownedSalon(user.id); if (!salon) { res.status(403).json({ error: "Nedozvoljen pristup." }); return; }
  const services = await db.select().from(servicesTable).where(eq(servicesTable.salonId, salon.id));
  res.json(ListSalonServicesResponse.parse(services.map((item) => ({ id: item.id, category: item.categoryName, name: item.name, description: item.description, durationMinutes: item.durationMinutes, price: item.price, promoPrice: item.promoPrice, imageUrl: item.imageUrl, active: item.active }))));
});

router.post("/salon/services", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const salon = await ownedSalon(user.id); if (!salon) { res.status(403).json({ error: "Nedozvoljen pristup." }); return; }
  const parsed = CreateSalonServiceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [category] = await db.select().from(serviceCategoriesTable).where(eq(serviceCategoriesTable.name, parsed.data.category)).limit(1);
  const [service] = await db.insert(servicesTable).values({ ...parsed.data, salonId: salon.id, categoryId: category?.id ?? null, categoryName: parsed.data.category, promoPrice: parsed.data.promoPrice ?? null }).returning();
  res.status(201).json(CreateSalonServiceResponse.parse({ id: service!.id, category: service!.categoryName, name: service!.name, description: service!.description, durationMinutes: service!.durationMinutes, price: service!.price, promoPrice: service!.promoPrice, imageUrl: service!.imageUrl, active: service!.active }));
});

router.get("/salon/employees", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const salon = await ownedSalon(user.id); if (!salon) { res.status(403).json({ error: "Nedozvoljen pristup." }); return; }
  const employees = await db.select().from(employeesTable).where(eq(employeesTable.salonId, salon.id));
  res.json(ListSalonEmployeesResponse.parse(employees.map((item) => ({ id: item.id, name: item.name, role: item.role, bio: item.bio, avatarUrl: item.avatarUrl, specialties: item.specialties }))));
});

async function loyaltyStatus(salonId: string) {
  const [status] = await db.select().from(salonLoyaltyStatusesTable).where(eq(salonLoyaltyStatusesTable.salonId, salonId)).limit(1);
  const tiers = await db.select().from(loyaltyTiersTable).where(eq(loyaltyTiersTable.active, true)).orderBy(asc(loyaltyTiersTable.sortOrder));
  const current = tiers.find((tier) => tier.id === status?.tierId) ?? tiers[0]!;
  const next = tiers.find((tier) => tier.sortOrder > current.sortOrder) ?? null;
  const spend = status?.currentPeriodSpend ?? 0;
  const due = current.freeSubscription ? 0 : Math.round(2490 * (1 - current.subscriptionDiscountPercent / 100));
  return GetLoyaltyStatusResponse.parse({ currentTier: current.name, monthlySpend: spend, tierThreshold: current.spendThreshold, amountToNextTier: next ? Math.max(next.spendThreshold - spend, 0) : 0, nextTier: next?.name ?? null, subscriptionDue: due, subscriptionDiscountPercent: current.subscriptionDiscountPercent, productDiscountPercent: current.productDiscountPercent, benefits: current.benefits, freeSubscription: current.freeSubscription });
}

router.get("/shop/products", async (req, res): Promise<void> => {
  await ensureDemoData();
  const parsed = ListProductsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let products = await db.select().from(productsTable).where(eq(productsTable.active, true));
  if (parsed.data.category) products = products.filter((item) => item.categoryName === parsed.data.category);
  if (parsed.data.search) products = products.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(parsed.data.search!.toLowerCase()));
  res.json(ListProductsResponse.parse(products.map((item) => ({ id: item.id, name: item.name, category: item.categoryName, description: item.description, imageUrl: item.imageUrl, price: item.price, discountPrice: item.discountPrice, stock: item.stock, sku: item.sku, unit: item.unit }))));
});

router.get("/loyalty/status", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const salon = await ownedSalon(user.id); if (!salon) { res.status(403).json({ error: "Nedozvoljen pristup." }); return; }
  res.json(await loyaltyStatus(salon.id));
});

router.get("/shop/summary", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const salon = await ownedSalon(user.id); if (!salon) { res.status(403).json({ error: "Nedozvoljen pristup." }); return; }
  const loyalty = await loyaltyStatus(salon.id);
  res.json(GetShopSummaryResponse.parse({ monthlySpend: loyalty.monthlySpend, nextTierSpend: loyalty.monthlySpend + loyalty.amountToNextTier, amountToNextTier: loyalty.amountToNextTier, currentTier: loyalty.currentTier, subscriptionDue: loyalty.subscriptionDue, subscriptionDiscount: loyalty.subscriptionDiscountPercent, benefits: loyalty.benefits, cartCount: 0 }));
});

router.get("/shop/orders", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const salon = await ownedSalon(user.id); if (!salon) { res.status(403).json({ error: "Nedozvoljen pristup." }); return; }
  const orders = await db.select().from(ordersTable).where(eq(ordersTable.salonId, salon.id)).orderBy(asc(ordersTable.createdAt));
  const items = orders.length ? await db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, orders.map((item) => item.id))) : [];
  res.json(ListOrdersResponse.parse(orders.map((order) => ({ id: order.id, status: order.status, total: order.total, itemCount: items.filter((item) => item.orderId === order.id).reduce((sum, item) => sum + item.quantity, 0), createdAt: order.createdAt.toISOString(), items: items.filter((item) => item.orderId === order.id).map((item) => ({ productId: item.productId, productName: item.productName, quantity: item.quantity, price: item.price })) }))));
});

router.post("/shop/orders", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const salon = await ownedSalon(user.id); if (!salon) { res.status(403).json({ error: "Nedozvoljen pristup." }); return; }
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const productIds = parsed.data.items.map((item) => item.productId);
  const products = await db.select().from(productsTable).where(inArray(productsTable.id, productIds));
  if (products.length !== productIds.length) { res.status(400).json({ error: "Jedan ili više proizvoda nisu dostupni." }); return; }
  const total = parsed.data.items.reduce((sum, item) => sum + (products.find((product) => product.id === item.productId)!.discountPrice ?? products.find((product) => product.id === item.productId)!.price) * item.quantity, 0);
  const [order] = await db.insert(ordersTable).values({ salonId: salon.id, status: "pending", total, shippingName: parsed.data.shippingName, shippingAddress: parsed.data.shippingAddress, paymentMethod: parsed.data.paymentMethod }).returning();
  const items = parsed.data.items.map((item) => { const product = products.find((value) => value.id === item.productId)!; return { orderId: order!.id, productId: product.id, productName: product.name, quantity: item.quantity, price: product.discountPrice ?? product.price }; });
  await db.insert(orderItemsTable).values(items);
  res.status(201).json(CreateOrderResponse.parse({ id: order!.id, status: order!.status, total: order!.total, itemCount: items.reduce((sum, item) => sum + item.quantity, 0), createdAt: order!.createdAt.toISOString(), items: items.map((item) => ({ productId: item.productId, productName: item.productName, quantity: item.quantity, price: item.price })) }));
});

router.get("/education/courses", async (req, res): Promise<void> => {
  await ensureDemoData();
  const parsed = ListCoursesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let courses = await db.select().from(coursesTable).where(eq(coursesTable.published, true));
  if (parsed.data.format) courses = courses.filter((item) => item.format === parsed.data.format);
  if (parsed.data.city) courses = courses.filter((item) => item.city === parsed.data.city);
  const centers = await db.select().from(educationCentersTable);
  res.json(ListCoursesResponse.parse(courses.map((item) => ({ id: item.id, title: item.title, instructor: "Lumera mentor", center: centers.find((center) => center.id === item.centerId)?.name ?? "Edukativni centar", category: item.category, format: item.format, city: item.city, price: item.price, duration: item.duration, rating: item.rating / 10, certification: item.certification, imageUrl: item.imageUrl }))));
});

router.get("/education/enrollments", async (_req, res): Promise<void> => {
  await ensureDemoData();
  res.json(ListEnrollmentsResponse.parse([]));
});

router.get("/admin/summary", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  if (!isAdmin(user)) { res.status(403).json({ error: "Samo administratori mogu da vide ovaj pregled." }); return; }

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [users, salons, allAppointments, orders, reviews, subscriptions, services] = await Promise.all([
    db.select().from(usersTable),
    db.select().from(salonsTable),
    db.select().from(appointmentsTable),
    db.select().from(ordersTable),
    db.select().from(reviewsTable),
    db.select({ status: subscriptionsTable.status }).from(subscriptionsTable),
    db.select({ id: servicesTable.id, categoryName: servicesTable.categoryName }).from(servicesTable),
  ]);

  const bookingsThisMonth = allAppointments.filter((a) => a.createdAt >= thisMonthStart).length;
  const bookingsLastMonth = allAppointments.filter((a) => a.createdAt >= lastMonthStart && a.createdAt < thisMonthStart).length;
  const bookingsTrend = bookingsLastMonth > 0 ? Math.round(((bookingsThisMonth - bookingsLastMonth) / bookingsLastMonth) * 100) : 0;
  const newSalonsThisMonth = salons.filter((s) => s.createdAt >= thisMonthStart).length;
  const hiddenReviews = reviews.filter((r) => !r.visible).length;
  const activeSubscriptions = subscriptions.filter((s) => s.status === "active" || s.status === "free_via_loyalty").length;

  const categoryCount: Record<string, number> = {};
  const categoryByService = new Map(services.map((service) => [service.id, service.categoryName]));
  for (const appointment of allAppointments) {
    const categoryName = categoryByService.get(appointment.serviceId);
    if (categoryName) categoryCount[categoryName] = (categoryCount[categoryName] ?? 0) + 1;
  }
  const topCategories = Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, cnt]) => ({ name, count: cnt }));

  res.json(GetAdminSummaryResponse.parse({
    totalUsers: users.length,
    totalSalons: salons.length,
    activeSalons: salons.filter((s) => s.active).length,
    bookingsThisMonth,
    bookingsLastMonth,
    bookingsTrend,
    grossMerchandiseValue: orders.reduce((sum, item) => sum + item.total, 0),
    newSalonsThisMonth,
    totalReviews: reviews.length,
    hiddenReviews,
    activeSubscriptions,
    topCategories,
  }));
});

// ── Admin helper ──────────────────────────────────────────────────────────────

async function requireAdmin(req: Request, res: Response) {
  const user = await current(req, res);
  if (!user) return null;
  if (!isAdmin(user)) { res.status(403).json({ error: "Pristup dozvoljen samo administratorima." }); return null; }
  return user;
}

async function requireSuperAdmin(req: Request, res: Response) {
  const user = await requireAdmin(req, res);
  if (!user) return null;
  if (user.role !== "SUPER_ADMIN") {
    res.status(403).json({ error: "Ova promena je dozvoljena samo super administratorima." });
    return null;
  }
  return user;
}

// ── Admin Salons ──────────────────────────────────────────────────────────────

router.get("/admin/salons", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;

  let salons = await db.select().from(salonsTable);
  const normalizedQuery = normalizeBooleanQuery(req.query, ["active", "featured"]);
  if (!normalizedQuery) { res.status(400).json({ error: "Boolean filteri prihvataju samo true ili false." }); return; }
  const parsedQuery = AdminListSalonsQueryParams.safeParse(normalizedQuery);
  if (!parsedQuery.success) { res.status(400).json({ error: parsedQuery.error.message }); return; }
  const { search, city, active, featured, subscriptionStatus } = parsedQuery.data;

  if (search) {
    const q = search.toLowerCase();
    salons = salons.filter((s) => s.name.toLowerCase().includes(q) || s.city.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
  }
  if (city) salons = salons.filter((s) => s.city.toLowerCase() === city.toLowerCase());
  if (active !== undefined) salons = salons.filter((s) => s.active === active);
  if (featured !== undefined) salons = salons.filter((s) => s.featured === featured);

  if (!salons.length) { res.json([]); return; }

  const salonIds = salons.map((s) => s.id);
  const [subs, loyalties, tiers] = await Promise.all([
    db.select().from(subscriptionsTable)
      .innerJoin(subscriptionPlansTable, eq(subscriptionsTable.planId, subscriptionPlansTable.id))
      .where(inArray(subscriptionsTable.salonId, salonIds)),
    db.select().from(salonLoyaltyStatusesTable).where(inArray(salonLoyaltyStatusesTable.salonId, salonIds)),
    db.select().from(loyaltyTiersTable),
  ]);

  let result = salons.map((s) => {
    const sub = subs.find((sub) => sub.subscriptions.salonId === s.id);
    const loyalty = loyalties.find((l) => l.salonId === s.id);
    const tier = tiers.find((t) => t.id === loyalty?.tierId);
    return {
      id: s.id,
      name: s.name,
      slug: s.slug,
      city: s.city,
      active: s.active,
      featured: s.featured,
      rating: s.rating / 10,
      reviewCount: s.reviewCount,
      subscriptionStatus: sub?.subscriptions.status ?? null,
      subscriptionPlan: sub?.subscription_plans.name ?? null,
      loyaltyTier: tier?.name ?? null,
      loyaltySpend: loyalty?.currentPeriodSpend ?? 0,
      createdAt: s.createdAt.toISOString(),
    };
  });

  if (subscriptionStatus) result = result.filter((s) => s.subscriptionStatus === subscriptionStatus);

  res.json(result);
});

router.patch("/admin/salons/:salonId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsedParams = AdminUpdateSalonParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { salonId } = parsedParams.data;
  const parsed = AdminUpdateSalonBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { active, featured } = parsed.data;

  const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.id, salonId)).limit(1);
  if (!salon) { res.status(404).json({ error: "Salon nije pronađen." }); return; }

  const updates: Partial<typeof salonsTable.$inferInsert> = {};
  if (active !== undefined) updates.active = active;
  if (featured !== undefined) updates.featured = featured;

  const [updated] = await db.update(salonsTable).set(updates).where(eq(salonsTable.id, salonId)).returning();

  const [subs, loyalties, tiers] = await Promise.all([
    db.select().from(subscriptionsTable)
      .innerJoin(subscriptionPlansTable, eq(subscriptionsTable.planId, subscriptionPlansTable.id))
      .where(eq(subscriptionsTable.salonId, salonId)),
    db.select().from(salonLoyaltyStatusesTable).where(eq(salonLoyaltyStatusesTable.salonId, salonId)),
    db.select().from(loyaltyTiersTable),
  ]);
  const sub = subs[0];
  const loyalty = loyalties[0];
  const tier = tiers.find((t) => t.id === loyalty?.tierId);

  res.json({
    id: updated!.id,
    name: updated!.name,
    slug: updated!.slug,
    city: updated!.city,
    active: updated!.active,
    featured: updated!.featured,
    rating: updated!.rating / 10,
    reviewCount: updated!.reviewCount,
    subscriptionStatus: sub?.subscriptions.status ?? null,
    subscriptionPlan: sub?.subscription_plans.name ?? null,
    loyaltyTier: tier?.name ?? null,
    loyaltySpend: loyalty?.currentPeriodSpend ?? 0,
    createdAt: updated!.createdAt.toISOString(),
  });
});

// ── Admin Users ───────────────────────────────────────────────────────────────

router.get("/admin/users", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;

  let users = await db.select().from(usersTable);
  const normalizedQuery = normalizeBooleanQuery(req.query, ["active"]);
  if (!normalizedQuery) { res.status(400).json({ error: "Boolean filter prihvata samo true ili false." }); return; }
  const parsedQuery = AdminListUsersQueryParams.safeParse(normalizedQuery);
  if (!parsedQuery.success) { res.status(400).json({ error: parsedQuery.error.message }); return; }
  const { search, role, active } = parsedQuery.data;

  if (search) {
    const q = search.toLowerCase();
    users = users.filter((u) => u.email.toLowerCase().includes(q) || `${u.firstName} ${u.lastName}`.toLowerCase().includes(q));
  }
  if (role) users = users.filter((u) => u.role === role);
  if (active !== undefined) users = users.filter((u) => u.active === active);

  res.json(users.map((u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phone,
    role: u.role,
    active: u.active,
    createdAt: u.createdAt.toISOString(),
  })));
});

router.patch("/admin/users/:userId", async (req, res): Promise<void> => {
  const admin = await requireSuperAdmin(req, res); if (!admin) return;
  const parsedParams = AdminUpdateUserParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { userId } = parsedParams.data;
  const parsed = AdminUpdateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { role, active } = parsed.data;

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('lumera_active_super_admin_guard'))`);
    const [target] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!target) return { status: "not-found" as const };

    const willRemoveActiveSuperAdmin =
      target.role === "SUPER_ADMIN" &&
      target.active &&
      ((role !== undefined && role !== "SUPER_ADMIN") || active === false);

    if (willRemoveActiveSuperAdmin) {
      const [activeSuperAdmins] = await tx.select({ count: count() }).from(usersTable)
        .where(and(eq(usersTable.role, "SUPER_ADMIN"), eq(usersTable.active, true)));
      if ((activeSuperAdmins?.count ?? 0) <= 1) return { status: "protected" as const };
    }

    const updates: Partial<typeof usersTable.$inferInsert> = {};
    if (role !== undefined) updates.role = role;
    if (active !== undefined) updates.active = active;
    const [updated] = await tx.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
    return { status: "updated" as const, user: updated! };
  });

  if (result.status === "not-found") { res.status(404).json({ error: "Korisnik nije pronađen." }); return; }
  if (result.status === "protected") {
    res.status(409).json({ error: "Nije moguće ukloniti ili deaktivirati poslednjeg aktivnog super administratora." });
    return;
  }
  const updated = result.user;

  res.json({
    id: updated!.id,
    firstName: updated!.firstName,
    lastName: updated!.lastName,
    email: updated!.email,
    phone: updated!.phone,
    role: updated!.role,
    active: updated!.active,
    createdAt: updated!.createdAt.toISOString(),
  });
});

// ── Admin Loyalty Tiers ───────────────────────────────────────────────────────

router.get("/admin/loyalty-tiers", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const tiers = await db.select().from(loyaltyTiersTable).orderBy(asc(loyaltyTiersTable.sortOrder));
  res.json(tiers.map((t) => ({
    id: t.id, name: t.name, sortOrder: t.sortOrder, spendThreshold: t.spendThreshold,
    period: t.period, subscriptionDiscountPercent: t.subscriptionDiscountPercent,
    productDiscountPercent: t.productDiscountPercent, freeSubscription: t.freeSubscription,
    premiumListing: t.premiumListing, freeShipping: t.freeShipping, benefits: t.benefits, active: t.active,
  })));
});

router.post("/admin/loyalty-tiers", async (req, res): Promise<void> => {
  const user = await requireSuperAdmin(req, res); if (!user) return;
  const parsed = AdminCreateLoyaltyTierBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = parsed.data;
  if (!body.name || body.sortOrder === undefined || body.spendThreshold === undefined) {
    res.status(400).json({ error: "Naziv, redosled i prag potrošnje su obavezni." }); return;
  }
  const [tier] = await db.insert(loyaltyTiersTable).values({
    name: body.name,
    sortOrder: body.sortOrder,
    spendThreshold: body.spendThreshold,
    period: body.period ?? "monthly",
    subscriptionDiscountPercent: body.subscriptionDiscountPercent ?? 0,
    productDiscountPercent: body.productDiscountPercent ?? 0,
    freeSubscription: body.freeSubscription ?? false,
    premiumListing: body.premiumListing ?? false,
    freeShipping: body.freeShipping ?? false,
    benefits: body.benefits ?? [],
    active: body.active ?? true,
  }).returning();
  res.status(201).json({
    id: tier!.id, name: tier!.name, sortOrder: tier!.sortOrder, spendThreshold: tier!.spendThreshold,
    period: tier!.period, subscriptionDiscountPercent: tier!.subscriptionDiscountPercent,
    productDiscountPercent: tier!.productDiscountPercent, freeSubscription: tier!.freeSubscription,
    premiumListing: tier!.premiumListing, freeShipping: tier!.freeShipping, benefits: tier!.benefits, active: tier!.active,
  });
});

router.patch("/admin/loyalty-tiers/:tierId", async (req, res): Promise<void> => {
  const user = await requireSuperAdmin(req, res); if (!user) return;
  const parsedParams = AdminUpdateLoyaltyTierParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { tierId } = parsedParams.data;
  const [existing] = await db.select().from(loyaltyTiersTable).where(eq(loyaltyTiersTable.id, tierId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Nivo nije pronađen." }); return; }
  const parsed = AdminUpdateLoyaltyTierBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = parsed.data;
  const [tier] = await db.update(loyaltyTiersTable).set({
    name: body.name ?? existing.name,
    sortOrder: body.sortOrder ?? existing.sortOrder,
    spendThreshold: body.spendThreshold ?? existing.spendThreshold,
    period: body.period ?? existing.period,
    subscriptionDiscountPercent: body.subscriptionDiscountPercent ?? existing.subscriptionDiscountPercent,
    productDiscountPercent: body.productDiscountPercent ?? existing.productDiscountPercent,
    freeSubscription: body.freeSubscription ?? existing.freeSubscription,
    premiumListing: body.premiumListing ?? existing.premiumListing,
    freeShipping: body.freeShipping ?? existing.freeShipping,
    benefits: body.benefits ?? existing.benefits,
    active: body.active ?? existing.active,
  }).where(eq(loyaltyTiersTable.id, tierId)).returning();
  res.json({
    id: tier!.id, name: tier!.name, sortOrder: tier!.sortOrder, spendThreshold: tier!.spendThreshold,
    period: tier!.period, subscriptionDiscountPercent: tier!.subscriptionDiscountPercent,
    productDiscountPercent: tier!.productDiscountPercent, freeSubscription: tier!.freeSubscription,
    premiumListing: tier!.premiumListing, freeShipping: tier!.freeShipping, benefits: tier!.benefits, active: tier!.active,
  });
});

router.delete("/admin/loyalty-tiers/:tierId", async (req, res): Promise<void> => {
  const user = await requireSuperAdmin(req, res); if (!user) return;
  const parsedParams = AdminDeleteLoyaltyTierParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { tierId } = parsedParams.data;
  const [existing] = await db.select().from(loyaltyTiersTable).where(eq(loyaltyTiersTable.id, tierId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Nivo nije pronađen." }); return; }
  // Deactivate instead of hard-delete if there are active salons on this tier
  const [inUse] = await db.select({ count: count() }).from(salonLoyaltyStatusesTable)
    .where(eq(salonLoyaltyStatusesTable.tierId, tierId));
  if ((inUse?.count ?? 0) > 0) {
    const [deactivated] = await db.update(loyaltyTiersTable).set({ active: false }).where(eq(loyaltyTiersTable.id, tierId)).returning();
    res.json({
      id: deactivated!.id, name: deactivated!.name, sortOrder: deactivated!.sortOrder, spendThreshold: deactivated!.spendThreshold,
      period: deactivated!.period, subscriptionDiscountPercent: deactivated!.subscriptionDiscountPercent,
      productDiscountPercent: deactivated!.productDiscountPercent, freeSubscription: deactivated!.freeSubscription,
      premiumListing: deactivated!.premiumListing, freeShipping: deactivated!.freeShipping, benefits: deactivated!.benefits, active: deactivated!.active,
    });
    return;
  }
  await db.delete(loyaltyTiersTable).where(eq(loyaltyTiersTable.id, tierId));
  res.json({
    id: existing.id, name: existing.name, sortOrder: existing.sortOrder, spendThreshold: existing.spendThreshold,
    period: existing.period, subscriptionDiscountPercent: existing.subscriptionDiscountPercent,
    productDiscountPercent: existing.productDiscountPercent, freeSubscription: existing.freeSubscription,
    premiumListing: existing.premiumListing, freeShipping: existing.freeShipping, benefits: existing.benefits, active: false,
  });
});

// ── Admin Subscription Plans ──────────────────────────────────────────────────

router.get("/admin/subscription-plans", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const plans = await db.select().from(subscriptionPlansTable);
  res.json(plans.map((p) => ({
    id: p.id, name: p.name, price: p.price, trialDays: p.trialDays,
    features: p.features, limits: p.limits, active: p.active,
  })));
});

router.post("/admin/subscription-plans", async (req, res): Promise<void> => {
  const user = await requireSuperAdmin(req, res); if (!user) return;
  const parsed = AdminCreateSubscriptionPlanBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = parsed.data;
  if (!body.name || body.price === undefined) {
    res.status(400).json({ error: "Naziv i cena su obavezni." }); return;
  }
  const [plan] = await db.insert(subscriptionPlansTable).values({
    name: body.name,
    price: body.price,
    trialDays: body.trialDays ?? 0,
    features: body.features ?? [],
    limits: body.limits ?? {},
    active: body.active ?? true,
  }).returning();
  res.status(201).json({
    id: plan!.id, name: plan!.name, price: plan!.price, trialDays: plan!.trialDays,
    features: plan!.features, limits: plan!.limits, active: plan!.active,
  });
});

router.patch("/admin/subscription-plans/:planId", async (req, res): Promise<void> => {
  const user = await requireSuperAdmin(req, res); if (!user) return;
  const parsedParams = AdminUpdateSubscriptionPlanParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { planId } = parsedParams.data;
  const [existing] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Plan nije pronađen." }); return; }
  const parsed = AdminUpdateSubscriptionPlanBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = parsed.data;
  const [plan] = await db.update(subscriptionPlansTable).set({
    name: body.name ?? existing.name,
    price: body.price ?? existing.price,
    trialDays: body.trialDays ?? existing.trialDays,
    features: body.features ?? existing.features,
    limits: body.limits ?? existing.limits,
    active: body.active ?? existing.active,
  }).where(eq(subscriptionPlansTable.id, planId)).returning();
  res.json({
    id: plan!.id, name: plan!.name, price: plan!.price, trialDays: plan!.trialDays,
    features: plan!.features, limits: plan!.limits, active: plan!.active,
  });
});

router.delete("/admin/subscription-plans/:planId", async (req, res): Promise<void> => {
  const user = await requireSuperAdmin(req, res); if (!user) return;
  const parsedParams = AdminDeleteSubscriptionPlanParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { planId } = parsedParams.data;
  const [existing] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Plan nije pronađen." }); return; }
  // Preserve the full subscription history by archiving every referenced plan.
  const [inUse] = await db.select({ count: count() }).from(subscriptionsTable)
    .where(eq(subscriptionsTable.planId, planId));
  if ((inUse?.count ?? 0) > 0) {
    const [deactivated] = await db.update(subscriptionPlansTable).set({ active: false }).where(eq(subscriptionPlansTable.id, planId)).returning();
    res.json({
      id: deactivated!.id, name: deactivated!.name, price: deactivated!.price, trialDays: deactivated!.trialDays,
      features: deactivated!.features, limits: deactivated!.limits, active: deactivated!.active,
    });
    return;
  }
  await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId));
  res.json({
    id: existing.id, name: existing.name, price: existing.price, trialDays: existing.trialDays,
    features: existing.features, limits: existing.limits, active: false,
  });
});

// ── Admin Reviews ─────────────────────────────────────────────────────────────

router.get("/admin/reviews", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;

  let reviews = await db.select().from(reviewsTable).orderBy(desc(reviewsTable.createdAt));
  const normalizedQuery = normalizeBooleanQuery(req.query, ["visible"]);
  if (!normalizedQuery) { res.status(400).json({ error: "Boolean filter prihvata samo true ili false." }); return; }
  const parsedQuery = AdminListReviewsQueryParams.safeParse(normalizedQuery);
  if (!parsedQuery.success) { res.status(400).json({ error: parsedQuery.error.message }); return; }
  const { search, salonId, visible, minRating, maxRating } = parsedQuery.data;

  if (salonId) reviews = reviews.filter((r) => r.salonId === salonId);
  if (visible !== undefined) reviews = reviews.filter((r) => r.visible === visible);
  if (minRating !== undefined) reviews = reviews.filter((r) => r.rating >= minRating);
  if (maxRating !== undefined) reviews = reviews.filter((r) => r.rating <= maxRating);
  if (search) {
    const q = search.toLowerCase();
    reviews = reviews.filter((r) => r.text.toLowerCase().includes(q) || r.serviceName.toLowerCase().includes(q));
  }

  if (!reviews.length) { res.json([]); return; }

  const salonIds = [...new Set(reviews.map((r) => r.salonId))];
  const customerIds = [...new Set(reviews.map((r) => r.customerId))];
  const [salons, customers] = await Promise.all([
    db.select().from(salonsTable).where(inArray(salonsTable.id, salonIds)),
    db.select().from(usersTable).where(inArray(usersTable.id, customerIds)),
  ]);

  res.json(reviews.map((r) => {
    const salon = salons.find((s) => s.id === r.salonId);
    const customer = customers.find((c) => c.id === r.customerId);
    return {
      id: r.id,
      salonId: r.salonId,
      salonName: salon?.name ?? "Nepoznat salon",
      customerId: r.customerId,
      customerName: customer ? `${customer.firstName} ${customer.lastName}` : "Nepoznat korisnik",
      serviceName: r.serviceName,
      rating: r.rating,
      text: r.text,
      visible: r.visible,
      date: r.createdAt.toISOString(),
    };
  }));
});

router.patch("/admin/reviews/:reviewId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsedParams = AdminUpdateReviewParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { reviewId } = parsedParams.data;
  const parsed = AdminUpdateReviewBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { visible } = parsed.data;

  const [existing] = await db.select().from(reviewsTable).where(eq(reviewsTable.id, reviewId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Recenzija nije pronađena." }); return; }

  const updates: Partial<typeof reviewsTable.$inferInsert> = {};
  if (visible !== undefined) updates.visible = visible;

  const [updated] = await db.update(reviewsTable).set(updates).where(eq(reviewsTable.id, reviewId)).returning();
  const [salon, customer] = await Promise.all([
    db.select().from(salonsTable).where(eq(salonsTable.id, updated!.salonId)).limit(1),
    db.select().from(usersTable).where(eq(usersTable.id, updated!.customerId)).limit(1),
  ]);
  res.json({
    id: updated!.id,
    salonId: updated!.salonId,
    salonName: salon[0]?.name ?? "Nepoznat salon",
    customerId: updated!.customerId,
    customerName: customer[0] ? `${customer[0].firstName} ${customer[0].lastName}` : "Nepoznat korisnik",
    serviceName: updated!.serviceName,
    rating: updated!.rating,
    text: updated!.text,
    visible: updated!.visible,
    date: updated!.createdAt.toISOString(),
  });
});

router.delete("/admin/reviews/:reviewId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsedParams = AdminDeleteReviewParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { reviewId } = parsedParams.data;
  const [existing] = await db.select().from(reviewsTable).where(eq(reviewsTable.id, reviewId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Recenzija nije pronađena." }); return; }
  await db.delete(reviewsTable).where(eq(reviewsTable.id, reviewId));
  res.sendStatus(204);
});

export default router;
