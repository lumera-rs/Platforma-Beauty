import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  appointmentsTable,
  beautyGlossaryTable,
  courseEnrollmentsTable,
  courseLessonsTable,
  courseModulesTable,
  courseSessionsTable,
  coursesTable,
  db,
  educationCentersTable,
  employeesTable,
  favoritesTable,
  inspirationItemsTable,
  lessonProgressTable,
  loyaltyTiersTable,
  orderItemsTable,
  ordersTable,
  productReviewsTable,
  productCategoriesTable,
  productsTable,
  productBrandsTable,
  reviewsTable,
  salonHoursTable,
  salonBrandsTable,
  shippingRulesTable,
  salonLoyaltyStatusesTable,
  salonsTable,
  serviceCategoriesTable,
  servicesTable,
  subscriptionPlansTable,
  subscriptionsTable,
  usersTable,
} from "@workspace/db";
import {
  AdminBulkUpdateProductsBody,
  AdminCreateBrandBody,
  AdminCreateLoyaltyTierBody,
  AdminCreateProductBody,
  AdminCreateProductCategoryBody,
  AdminCreateSubscriptionPlanBody,
  AdminDeleteBrandParams,
  AdminDeleteProductCategoryParams,
  AdminDeleteProductParams,
  AdminListProductsQueryParams,
  AdminUpdateBrandBody,
  AdminUpdateBrandParams,
  AdminUpdateProductBody,
  AdminUpdateProductCategoryBody,
  AdminUpdateProductCategoryParams,
  AdminUpdateProductParams,
  AdminUpdateShippingConfigBody,
  AdminGetOrderParams,
  AdminGetOrderResponse,
  AdminListOrdersQueryParams,
  AdminListOrdersResponse,
  AdminUpdateOrderStatusBody,
  AdminUpdateOrderStatusParams,
  AdminUpdateOrderStatusResponse,
  GetShippingQuoteQueryParams,
  GetOrderParams,
  GetOrderResponse,
  GetShopProductParams,
  GetShopProductResponse,
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
  ArchiveEducationCourseParams,
  CompleteEducationLessonParams,
  CompleteEducationLessonResponse,
  CreateEducationCourseBody,
  CreateEducationCourseResponse,
  CreateEducationLessonBody,
  CreateEducationLessonParams,
  CreateEducationLessonResponse,
  CreateEducationModuleBody,
  CreateEducationModuleParams,
  CreateEducationModuleResponse,
  CreateEducationSessionBody,
  CreateEducationSessionParams,
  CreateEducationSessionResponse,
  EnrollInEducationCourseBody,
  EnrollInEducationCourseParams,
  EnrollInEducationCourseResponse,
  GetEducationCourseParams,
  GetEducationCourseResponse,
  GetEducationLmsParams,
  GetEducationLmsResponse,
  ListCoursesQueryParams,
  ListCoursesResponse,
  ListEducationModulesParams,
  ListEducationModulesResponse,
  ListEducationSessionsParams,
  ListEducationSessionsResponse,
  ListEnrollmentsResponse,
  ListFavoritesResponse,
  ListMyAppointmentsQueryParams,
  ListMyAppointmentsResponse,
  ListOrdersResponse,
  ListProductReviewsParams,
  ListProductReviewsResponse,
  ListProductCategoriesResponse,
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
  RegisterBusinessBody,
  RegisterBody,
  RegisterResponse,
  UpsertProductReviewBody,
  UpsertProductReviewParams,
  UpsertProductReviewResponse,
  PublishEducationCourseParams,
  ToggleFavoriteBody,
  ToggleFavoriteResponse,
  UpdateEducationCourseBody,
  UpdateEducationCourseParams,
  UpdateEducationCourseResponse,
  UpdateEducationLessonBody,
  UpdateEducationLessonParams,
  UpdateEducationLessonResponse,
  UpdateEducationModuleBody,
  UpdateEducationModuleParams,
  UpdateEducationModuleResponse,
  UpdateEducationSessionBody,
  UpdateEducationSessionParams,
  UpdateEducationSessionResponse,
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

async function employeeInSalon(employeeId: string, salonId: string) {
  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.salonId, salonId)))
    .limit(1);
  return employee ?? null;
}

type EducationAccess = {
  user: typeof usersTable.$inferSelect;
  salon: typeof salonsTable.$inferSelect | null;
  centers: (typeof educationCentersTable.$inferSelect)[];
  admin: boolean;
};

async function requireEducationAccess(req: Request, res: Response): Promise<EducationAccess | null> {
  await ensureDemoData();
  const user = await getCurrentUser(req);
  if (!user || !["SALON_OWNER", "EDUCATION_CENTER_OWNER", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    res.status(403).json({ error: "Edukacije su dostupne samo poslovnim nalozima." });
    return null;
  }
  const admin = isAdmin(user);
  const [salon, centers] = await Promise.all([
    user.role === "SALON_OWNER" ? ownedSalon(user.id) : Promise.resolve(null),
    user.role === "EDUCATION_CENTER_OWNER"
      ? db.select().from(educationCentersTable).where(eq(educationCentersTable.ownerId, user.id))
      : Promise.resolve([] as (typeof educationCentersTable.$inferSelect)[]),
  ]);
  if (!admin && !salon && !centers.length) {
    res.status(403).json({ error: "Poslovni nalog nije povezan sa izdavačem edukacija." });
    return null;
  }
  return { user, salon, centers, admin };
}

type LmsAccess = {
  access: EducationAccess;
  learnerEmployeeId: string | null;
};

async function requireLmsAccess(req: Request, res: Response): Promise<LmsAccess | null> {
  await ensureDemoData();
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(403).json({ error: "LMS je dostupan samo upisanim poslovnim korisnicima." });
    return null;
  }
  if (["SALON_OWNER", "EDUCATION_CENTER_OWNER", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    const access = await requireEducationAccess(req, res);
    return access ? { access, learnerEmployeeId: null } : null;
  }
  if (user.role !== "SALON_EMPLOYEE") {
    res.status(403).json({ error: "LMS je dostupan samo upisanim poslovnim korisnicima." });
    return null;
  }
  const [employee] = await db.select().from(employeesTable)
    .where(and(eq(employeesTable.userId, user.id), eq(employeesTable.active, true))).limit(1);
  if (!employee) {
    res.status(403).json({ error: "Poslovni nalog nije povezan sa aktivnim zaposlenim." });
    return null;
  }
  return {
    access: { user, salon: null, centers: [], admin: false },
    learnerEmployeeId: employee.id,
  };
}

function isCourseOwner(access: EducationAccess, course: typeof coursesTable.$inferSelect) {
  if (access.admin) return false;
  return Boolean(
    (access.salon && course.salonId === access.salon.id)
    || access.centers.some((center) => center.id === course.centerId),
  );
}

async function requireOwnedCourse(access: EducationAccess, courseId: string, res: Response) {
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, courseId)).limit(1);
  if (!course) {
    res.status(404).json({ error: "Kurs nije pronađen." });
    return null;
  }
  if (!isCourseOwner(access, course)) {
    res.status(403).json({ error: access.admin ? "Administratori imaju samo uvid u tuđe kurseve." : "Nemate pravo izmene ovog kursa." });
    return null;
  }
  return course;
}

async function modulesForCourse(courseId: string, completedLessonIds = new Set<string>(), includeLessonContent = false) {
  const modules = await db.select().from(courseModulesTable).where(eq(courseModulesTable.courseId, courseId)).orderBy(asc(courseModulesTable.sortOrder));
  if (!modules.length) return [];
  const lessons = await db.select().from(courseLessonsTable).where(inArray(courseLessonsTable.moduleId, modules.map((module) => module.id))).orderBy(asc(courseLessonsTable.sortOrder));
  return modules.map((module) => ({
    id: module.id,
    title: module.title,
    description: module.description,
    sortOrder: module.sortOrder,
    lessons: lessons
      .filter((lesson) => lesson.moduleId === module.id)
      .map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        description: lesson.description,
        ...(includeLessonContent ? { content: lesson.content } : {}),
        durationMinutes: lesson.durationMinutes,
        sortOrder: lesson.sortOrder,
        completed: completedLessonIds.has(lesson.id),
      })),
  }));
}

async function sessionsForCourse(courseId: string) {
  const sessions = await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.courseId, courseId)).orderBy(asc(courseSessionsTable.startsAt));
  return sessions.map((session) => ({
    id: session.id,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    location: session.location,
    capacity: session.capacity,
    reservedSeats: session.reservedSeats,
    availableSeats: Math.max(0, session.capacity - session.reservedSeats),
  }));
}

async function educationCourseView(
  course: typeof coursesTable.$inferSelect,
  access?: EducationAccess,
  completedLessonIds = new Set<string>(),
  includeLessonContent = false,
) {
  const mayReadLessonContent = includeLessonContent || Boolean(access && (access.admin || isCourseOwner(access, course)));
  const [center, salon, sessions, modules] = await Promise.all([
    course.centerId ? db.select().from(educationCentersTable).where(eq(educationCentersTable.id, course.centerId)).limit(1) : Promise.resolve([]),
    course.salonId ? db.select().from(salonsTable).where(eq(salonsTable.id, course.salonId)).limit(1) : Promise.resolve([]),
    sessionsForCourse(course.id),
    modulesForCourse(course.id, completedLessonIds, mayReadLessonContent),
  ]);
  const publisher = salon[0] ?? center[0];
  const enrollment = access
    ? (await db.select().from(courseEnrollmentsTable).where(and(eq(courseEnrollmentsTable.courseId, course.id), eq(courseEnrollmentsTable.purchaserId, access.user.id))).limit(1))[0]
    : undefined;
  return {
    id: course.id,
    title: course.title,
    description: course.description,
    instructor: course.instructorId ? "LUMERA mentor" : "Stručni tim",
    publisher: publisher?.name ?? "LUMERA partner",
    publisherType: course.salonId ? "SALON" as const : "EDUCATION_CENTER" as const,
    category: course.category,
    format: course.format,
    city: course.city,
    price: course.price,
    duration: course.duration,
    rating: course.rating / 10,
    certification: course.certification,
    imageUrl: course.imageUrl,
    startDate: course.startDate,
    published: course.published,
    archived: course.archived,
    availableSeats: sessions.length ? Math.max(...sessions.map((session) => session.availableSeats)) : null,
    enrollmentStatus: enrollment?.status ?? null,
    modules,
    sessions,
  };
}

async function educationEnrollmentView(enrollment: typeof courseEnrollmentsTable.$inferSelect) {
  const [course, employee, purchaser, modules] = await Promise.all([
    db.select().from(coursesTable).where(eq(coursesTable.id, enrollment.courseId)).limit(1),
    enrollment.employeeId ? db.select().from(employeesTable).where(eq(employeesTable.id, enrollment.employeeId)).limit(1) : Promise.resolve([]),
    db.select().from(usersTable).where(eq(usersTable.id, enrollment.purchaserId)).limit(1),
    modulesForCourse(enrollment.courseId),
  ]);
  // `nextLesson` used to contain a title in early demo data. Normalize that
  // legacy value at the boundary so the protected LMS can always select by ID.
  const nextLesson = enrollment.nextLesson
    ? modules.flatMap((item) => item.lessons).find((lesson) => lesson.id === enrollment.nextLesson || lesson.title === enrollment.nextLesson)?.id ?? null
    : null;
  return {
    id: enrollment.id,
    courseId: enrollment.courseId,
    courseTitle: course[0]?.title ?? "Arhivirani kurs",
    learnerName: employee[0]?.name ?? `${purchaser[0]?.firstName ?? "Poslovni"} ${purchaser[0]?.lastName ?? "korisnik"}`,
    employeeId: enrollment.employeeId,
    status: enrollment.status,
    paymentStatus: enrollment.paymentStatus,
    progress: enrollment.progress,
    nextLesson,
    purchasedAt: enrollment.purchasedAt.toISOString(),
  };
}

async function requireCustomer(req: Request, res: Response) {
  const user = await current(req, res);
  if (!user) return null;
  if (user.role !== "CUSTOMER") {
    res.status(403).json({ error: "Ova funkcija je dostupna samo klijentima." });
    return null;
  }
  return user;
}

async function requireSalonOwner(req: Request, res: Response) {
  const user = await current(req, res);
  if (!user) return null;
  if (user.role !== "SALON_OWNER") {
    res.status(403).json({ error: "Ova funkcija je dostupna samo vlasnicima salona." });
    return null;
  }
  const salon = await ownedSalon(user.id);
  if (!salon) {
    res.status(403).json({ error: "Nalog nije povezan sa salonom." });
    return null;
  }
  return { user, salon };
}

function businessSlug(name: string, userId: string) {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "partner";
  return `${base}-${userId.slice(0, 8)}`;
}

function card(
  salon: typeof salonsTable.$inferSelect,
  services: (typeof servicesTable.$inferSelect)[] = [],
  hours: (typeof salonHoursTable.$inferSelect)[] = [],
  appointments: (typeof appointmentsTable.$inferSelect)[] = [],
  employees: (typeof employeesTable.$inferSelect)[] = [],
) {
  const lastBookedAt = appointments.reduce<Date | null>((latest, item) => !latest || item.createdAt > latest ? item.createdAt : latest, null);
  const earliestSlot = findEarliestSlot(services, hours, appointments, employees);
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
    earliestSlot,
    homeService: salon.homeService,
    featured: salon.featured,
    topSalon: salon.topSalon,
    acceptsCards: salon.acceptsCards,
    instantBooking: salon.instantBooking,
    hasDiscount: services.some((item) => item.promoPrice !== null && item.promoPrice < item.price),
    openSunday: hours.some((item) => item.weekday === 7 && !item.closed),
    lastBookedAt: lastBookedAt?.toISOString() ?? null,
    createdAt: salon.createdAt.toISOString(),
    latitude: salon.latitude,
    longitude: salon.longitude,
  };
}

function findEarliestSlot(
  services: (typeof servicesTable.$inferSelect)[],
  hours: (typeof salonHoursTable.$inferSelect)[],
  appointments: (typeof appointmentsTable.$inferSelect)[],
  employees: (typeof employeesTable.$inferSelect)[],
) {
  const service = services.find((item) => item.active);
  if (!service || !employees.length) return null;
  const durationHours = Math.max(1, Math.ceil(service.durationMinutes / 60));
  const now = new Date();
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const day = new Date(now);
    day.setDate(now.getDate() + dayOffset);
    const weekday = day.getDay() === 0 ? 7 : day.getDay();
    const workingHours = hours.find((item) => item.weekday === weekday && !item.closed);
    if (!workingHours) continue;
    const date = day.toISOString().slice(0, 10);
    const firstHour = Math.max(Number(workingHours.openTime.slice(0, 2)), dayOffset === 0 ? now.getHours() + 1 : 0);
    const lastHour = Number(workingHours.closeTime.slice(0, 2)) - durationHours;
    for (let hour = firstHour; hour <= lastHour; hour += 1) {
      const start = `${String(hour).padStart(2, "0")}:00`;
      const end = `${String(hour + durationHours).padStart(2, "0")}:00`;
      const available = employees.some((employee) => !appointments.some((appointment) =>
        appointment.employeeId === employee.id && appointment.date === date && appointment.status !== "cancelled"
          && appointment.startTime < end && appointment.endTime > start,
      ));
      if (available) return `${date}T${start}:00.000Z`;
    }
  }
  return null;
}

async function salonCards(salons: (typeof salonsTable.$inferSelect)[]) {
  if (!salons.length) return [];
  const ids = salons.map((salon) => salon.id);
  const [allServices, allHours, allAppointments, allEmployees] = await Promise.all([
    db.select().from(servicesTable).where(inArray(servicesTable.salonId, ids)),
    db.select().from(salonHoursTable).where(inArray(salonHoursTable.salonId, ids)),
    db.select().from(appointmentsTable).where(inArray(appointmentsTable.salonId, ids)),
    db.select().from(employeesTable).where(and(inArray(employeesTable.salonId, ids), eq(employeesTable.active, true))),
  ]);
  return salons.map((salon) => card(
    salon,
    allServices.filter((service) => service.salonId === salon.id),
    allHours.filter((hour) => hour.salonId === salon.id),
    allAppointments.filter((appointment) => appointment.salonId === salon.id),
    allEmployees.filter((employee) => employee.salonId === salon.id),
  ));
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
    role: "CUSTOMER",
  }).returning();
  const token = await createSession(user!.id);
  res.cookie(sessionCookieName, token, cookieOptions());
  res.status(201).json(RegisterResponse.parse({ user: publicUser(user!), message: "Dobro došli u Lumeru." }));
});

router.post("/auth/business-register", async (req, res): Promise<void> => {
  await ensureDemoData();
  const parsed = RegisterBusinessBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const input = parsed.data;
  const email = input.email.toLowerCase();
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) { res.status(409).json({ error: "Nalog sa ovom e-mail adresom već postoji." }); return; }

  try {
    const user = await db.transaction(async (tx) => {
      const role = input.businessType === "SALON" ? "SALON_OWNER" : "EDUCATION_CENTER_OWNER";
      const [created] = await tx.insert(usersTable).values({
        firstName: input.firstName,
        lastName: input.lastName,
        email,
        phone: input.phone,
        passwordHash: await hashPassword(input.password),
        role,
      }).returning();

      if (input.businessType === "SALON") {
        await tx.insert(salonsTable).values({
          ownerId: created!.id,
          name: input.businessName,
          slug: businessSlug(input.businessName, created!.id),
          city: input.city,
          municipality: input.municipality,
          address: input.address,
          phone: input.phone,
          email,
          shortDescription: `${input.businessName} je novi LUMERA partner.`,
          description: `Poslovni profil za ${input.businessName}. Dopunite ponudu, tim i radno vreme iz poslovnog portala.`,
          imageUrl: "https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=1200&auto=format&fit=crop",
          active: false,
        });
      } else {
        await tx.insert(educationCentersTable).values({
          ownerId: created!.id,
          name: input.businessName,
          city: input.city,
          description: `Edukativni centar ${input.businessName} na LUMERA platformi.`,
          imageUrl: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?q=80&w=1200&auto=format&fit=crop",
        });
      }

      return created!;
    });

    const token = await createSession(user.id);
    res.cookie(sessionCookieName, token, cookieOptions());
    res.status(201).json(RegisterResponse.parse({ user: publicUser(user), message: "Poslovni nalog je kreiran." }));
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Nalog ili poslovni profil sa ovim podacima već postoji." });
      return;
    }
    throw error;
  }
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
  const normalized = normalizeBooleanQuery(req.query, ["homeService", "discountsOnly", "acceptsCards", "openSunday", "instantBooking", "topSalon"]);
  if (!normalized) { res.status(400).json({ error: "Boolean filteri prihvataju samo true ili false." }); return; }
  const parsed = ListSalonsQueryParams.safeParse(normalized);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let salons = await db.select().from(salonsTable).where(eq(salonsTable.active, true));
  const query = parsed.data;
  if (query.city) salons = salons.filter((item) => item.city.toLowerCase() === query.city!.toLowerCase());
  if (query.municipality) salons = salons.filter((item) => item.municipality.toLowerCase() === query.municipality!.toLowerCase());
  if (query.homeService !== undefined) salons = salons.filter((item) => item.homeService === query.homeService);
  const allCards = await salonCards(salons);
  const allServices = salons.length ? await db.select().from(servicesTable).where(inArray(servicesTable.salonId, salons.map((item) => item.id))) : [];
  const linkedBrands = salons.length ? await db.select().from(salonBrandsTable).where(inArray(salonBrandsTable.salonId, salons.map((item) => item.id))) : [];
  const brands = linkedBrands.length ? await db.select().from(productBrandsTable).where(inArray(productBrandsTable.id, linkedBrands.map((item) => item.brandId))) : [];
  const treatment = (query.treatment ?? query.category ?? "").toLowerCase();
  const filtered = allCards.filter((item) => {
    const services = allServices.filter((service) => service.salonId === item.id);
    const matchesTreatment = !treatment || services.some((service) => `${service.categoryName} ${service.name} ${service.tags.join(" ")}`.toLowerCase().includes(treatment));
    const matchesPrice = query.priceMax === undefined || item.startingPrice <= query.priceMax;
    const matchesRating = query.minRating === undefined || item.rating >= query.minRating;
    const matchesMen = query.gender !== "men" || services.some((service) => service.categoryName === "Muški frizeri" || service.tags.some((tag) => tag.toLowerCase().includes("muškar")));
    const matchesBrand = !query.brand || linkedBrands.filter((link) => link.salonId === item.id).some((link) => brands.find((brand) => brand.id === link.brandId)?.name.toLowerCase() === query.brand!.toLowerCase());
    return matchesTreatment && matchesPrice && matchesRating && matchesMen && matchesBrand
      && (query.discountsOnly === undefined || item.hasDiscount === query.discountsOnly)
      && (query.acceptsCards === undefined || item.acceptsCards === query.acceptsCards)
      && (query.openSunday === undefined || item.openSunday === query.openSunday)
      && (query.instantBooking === undefined || item.instantBooking === query.instantBooking)
      && (query.topSalon === undefined || item.topSalon === query.topSalon);
  });
  const sorted = [...filtered].sort((a, b) => {
    if (query.sort === "top-rated") return b.rating - a.rating;
    if (query.sort === "cheapest") return a.startingPrice - b.startingPrice;
    if (query.sort === "most-popular") return b.reviewCount - a.reviewCount;
    if (query.sort === "newest") return b.createdAt.localeCompare(a.createdAt);
    if (query.sort === "first-available") {
      if (!a.earliestSlot) return 1;
      if (!b.earliestSlot) return -1;
      return a.earliestSlot.localeCompare(b.earliestSlot);
    }
    if (query.sort === "nearest" && query.latitude !== undefined && query.longitude !== undefined) {
      const distance = (item: typeof a) => {
        const source = salons.find((salon) => salon.id === item.id);
        if (source?.latitude === null || source?.latitude === undefined || source?.longitude === null || source?.longitude === undefined) return Number.POSITIVE_INFINITY;
        const toRadians = (value: number) => value * Math.PI / 180;
        const latitudeDelta = toRadians(source.latitude - query.latitude!);
        const longitudeDelta = toRadians(source.longitude - query.longitude!);
        const base = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(toRadians(query.latitude!)) * Math.cos(toRadians(source.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(base), Math.sqrt(1 - base));
      };
      return distance(a) - distance(b);
    }
    return Number(b.topSalon) - Number(a.topSalon) || Number(b.featured) - Number(a.featured) || b.rating - a.rating;
  });
  res.json(ListSalonsResponse.parse(sorted));
});

router.get("/salons/:slug", async (req, res): Promise<void> => {
  await ensureDemoData();
  const parsed = GetSalonParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.slug, parsed.data.slug)).limit(1);
  if (!salon) { res.status(404).json({ error: "Salon nije pronađen." }); return; }
  const [services, staff, hours, reviews, appointments] = await Promise.all([
    db.select().from(servicesTable).where(and(eq(servicesTable.salonId, salon.id), eq(servicesTable.active, true))),
    db.select().from(employeesTable).where(and(eq(employeesTable.salonId, salon.id), eq(employeesTable.active, true))),
    db.select().from(salonHoursTable).where(eq(salonHoursTable.salonId, salon.id)).orderBy(asc(salonHoursTable.weekday)),
    db.select().from(reviewsTable).where(and(eq(reviewsTable.salonId, salon.id), eq(reviewsTable.visible, true))),
    db.select().from(appointmentsTable).where(eq(appointmentsTable.salonId, salon.id)),
  ]);
  const reviewUsers = reviews.length ? await db.select().from(usersTable).where(inArray(usersTable.id, reviews.map((item) => item.customerId))) : [];
  res.json(GetSalonResponse.parse({
    ...card(salon, services, hours, appointments, staff),
    gallery: salon.gallery,
    description: salon.description,
    phone: salon.phone,
    email: salon.email,
    latitude: salon.latitude ?? 44.8,
    longitude: salon.longitude ?? 20.46,
    hours: hours.map((item) => ({ day: ["Ponedeljak", "Utorak", "Sreda", "Četvrtak", "Petak", "Subota", "Nedelja"][item.weekday - 1] ?? "Ponedeljak", open: item.openTime, close: item.closeTime, closed: item.closed })),
    staff: staff.map((item) => ({ id: item.id, name: item.name, role: item.role, bio: item.bio, avatarUrl: item.avatarUrl, specialties: item.specialties })),
    services: services.map((item) => ({ id: item.id, category: item.categoryName, name: item.name, description: item.description, durationMinutes: item.durationMinutes, price: item.price, promoPrice: item.promoPrice, tags: item.tags, packageTreatments: item.packageTreatments, imageUrl: item.imageUrl, active: item.active })),
    reviews: reviews.map((item) => ({ id: item.id, authorName: `${reviewUsers.find((user) => user.id === item.customerId)?.firstName ?? "Gost"} ${reviewUsers.find((user) => user.id === item.customerId)?.lastName ?? ""}`.trim(), rating: item.rating, text: item.text, date: item.createdAt.toISOString().slice(0, 10), serviceName: item.serviceName })),
  }));
});

router.get("/inspiracija", async (_req, res): Promise<void> => {
  await ensureDemoData();
  const [items, salons, services] = await Promise.all([
    db.select().from(inspirationItemsTable).orderBy(desc(inspirationItemsTable.createdAt)),
    db.select().from(salonsTable).where(eq(salonsTable.active, true)),
    db.select().from(servicesTable),
  ]);
  res.json(items.map((item) => ({
    id: item.id,
    title: item.title,
    tags: item.tags,
    imageUrl: item.imageUrl,
    salon: salons.find((salon) => salon.id === item.salonId) ? { name: salons.find((salon) => salon.id === item.salonId)!.name, slug: salons.find((salon) => salon.id === item.salonId)!.slug } : null,
    serviceName: services.find((service) => service.id === item.serviceId)?.name ?? null,
  })));
});

router.get("/recnik", async (_req, res): Promise<void> => {
  await ensureDemoData();
  res.json(await db.select().from(beautyGlossaryTable).orderBy(asc(beautyGlossaryTable.term)));
});

router.get("/brendovi", async (_req, res): Promise<void> => {
  await ensureDemoData();
  const [brands, links, salons] = await Promise.all([db.select().from(productBrandsTable), db.select().from(salonBrandsTable), db.select().from(salonsTable)]);
  res.json(brands.map((brand) => ({
    id: brand.id, name: brand.name, slug: brand.slug, description: brand.description,
    salonCount: links.filter((link) => link.brandId === brand.id && salons.some((salon) => salon.id === link.salonId && salon.active)).length,
  })));
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
  const user = await requireCustomer(req, res); if (!user) return;
  const parsed = ListMyAppointmentsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let appointments = await appointmentList(eq(appointmentsTable.customerId, user.id));
  if (parsed.data.status) appointments = appointments.filter((item) => item.status === parsed.data.status);
  if (parsed.data.scope === "upcoming") appointments = appointments.filter((item) => item.date >= new Date().toISOString().slice(0, 10));
  if (parsed.data.scope === "past") appointments = appointments.filter((item) => item.date < new Date().toISOString().slice(0, 10));
  res.json(ListMyAppointmentsResponse.parse(appointments));
});

router.post("/appointments", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [service] = await db.select().from(servicesTable).where(and(eq(servicesTable.id, parsed.data.serviceId), eq(servicesTable.salonId, parsed.data.salonId))).limit(1);
  const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.id, parsed.data.salonId)).limit(1);
  if (!service || !salon) { res.status(404).json({ error: "Salon ili usluga nisu pronađeni." }); return; }
  const employee = parsed.data.employeeId
    ? await employeeInSalon(parsed.data.employeeId, salon.id)
    : (await db.select().from(employeesTable).where(eq(employeesTable.salonId, salon.id)).limit(1))[0] ?? null;
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
  const user = await requireCustomer(req, res); if (!user) return;
  const [params, body] = [UpdateAppointmentParams.safeParse(req.params), UpdateAppointmentBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci za izmenu termina nisu ispravni." }); return; }
  const [appointment] = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.id, params.data.appointmentId), eq(appointmentsTable.customerId, user.id))).limit(1);
  if (!appointment) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  if (body.data.employeeId && !(await employeeInSalon(body.data.employeeId, appointment.salonId))) {
    res.status(400).json({ error: "Izabrani zaposleni ne pripada ovom salonu." });
    return;
  }
  const [updated] = await db.update(appointmentsTable).set({ date: body.data.date ? calendarDate(body.data.date) : appointment.date, startTime: body.data.startTime ?? appointment.startTime, employeeId: body.data.employeeId ?? appointment.employeeId, notes: body.data.notes ?? appointment.notes }).where(eq(appointmentsTable.id, appointment.id)).returning();
  const [salon, service] = await Promise.all([db.select().from(salonsTable).where(eq(salonsTable.id, updated!.salonId)).limit(1), db.select().from(servicesTable).where(eq(servicesTable.id, updated!.serviceId)).limit(1)]);
  const [employee] = updated!.employeeId ? await db.select().from(employeesTable).where(eq(employeesTable.id, updated!.employeeId)).limit(1) : [];
  res.json(UpdateAppointmentResponse.parse(appointmentView(updated!, salon[0]!, service[0]!, user, employee)));
});

router.post("/appointments/:appointmentId/cancel", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  const [params, body] = [CancelAppointmentParams.safeParse(req.params), CancelAppointmentBody.safeParse(req.body ?? {})];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci za otkazivanje nisu ispravni." }); return; }
  const [appointment] = await db.update(appointmentsTable).set({ status: "cancelled", cancellationReason: body.data.reason ?? null }).where(and(eq(appointmentsTable.id, params.data.appointmentId), eq(appointmentsTable.customerId, user.id))).returning();
  if (!appointment) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  const [salon, service, employee] = await Promise.all([db.select().from(salonsTable).where(eq(salonsTable.id, appointment.salonId)).limit(1), db.select().from(servicesTable).where(eq(servicesTable.id, appointment.serviceId)).limit(1), appointment.employeeId ? db.select().from(employeesTable).where(eq(employeesTable.id, appointment.employeeId)).limit(1) : Promise.resolve([])]);
  res.json(CancelAppointmentResponse.parse(appointmentView(appointment, salon[0]!, service[0]!, user, employee[0])));
});

router.get("/customer/dashboard", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  const appointments = await appointmentList(eq(appointmentsTable.customerId, user.id));
  const salons = await db.select().from(salonsTable).limit(3);
  const favorites = await db.select().from(favoritesTable).where(eq(favoritesTable.userId, user.id));
  res.json(GetCustomerDashboardResponse.parse({ upcoming: appointments.filter((item) => item.status !== "cancelled").slice(0, 3), recentSalons: await salonCards(salons), favoriteCount: favorites.length, visitCount: appointments.filter((item) => item.status === "completed").length }));
});

router.get("/customer/favorites", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  const favorites = await db.select().from(favoritesTable).where(eq(favoritesTable.userId, user.id));
  const salons = favorites.length ? await db.select().from(salonsTable).where(inArray(salonsTable.id, favorites.map((item) => item.salonId))) : [];
  res.json(ListFavoritesResponse.parse(await salonCards(salons)));
});

router.post("/customer/favorites", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  const parsed = ToggleFavoriteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [favorite] = await db.select().from(favoritesTable).where(and(eq(favoritesTable.userId, user.id), eq(favoritesTable.salonId, parsed.data.salonId))).limit(1);
  if (favorite) await db.delete(favoritesTable).where(eq(favoritesTable.id, favorite.id));
  else await db.insert(favoritesTable).values({ userId: user.id, salonId: parsed.data.salonId });
  res.json(ToggleFavoriteResponse.parse({ salonId: parsed.data.salonId, favorited: !favorite }));
});

router.get("/salon/dashboard", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const [services, appointments, loyalty] = await Promise.all([db.select().from(servicesTable).where(eq(servicesTable.salonId, salon.id)), appointmentList(eq(appointmentsTable.salonId, salon.id)), db.select().from(salonLoyaltyStatusesTable).where(eq(salonLoyaltyStatusesTable.salonId, salon.id)).limit(1)]);
  const loyaltyData = await loyaltyStatus(salon.id);
  const completed = appointments.filter((item) => item.status === "completed");
  res.json(GetSalonDashboardResponse.parse({ salon: card(salon, services), todayAppointments: appointments.slice(0, 5), revenueThisMonth: completed.reduce((sum, item) => sum + item.price, 0), bookingsThisMonth: appointments.length, newCustomers: new Set(appointments.map((item) => item.customerName)).size, rating: salon.rating / 10, revenueChange: 12, loyalty: loyaltyData }));
});

router.get("/salon/appointments", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const parsed = ListSalonAppointmentsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let items = await appointmentList(eq(appointmentsTable.salonId, salon.id));
  if (parsed.data.status) items = items.filter((item) => item.status === parsed.data.status);
  if (parsed.data.from) items = items.filter((item) => item.date >= calendarDate(parsed.data.from!));
  if (parsed.data.to) items = items.filter((item) => item.date <= calendarDate(parsed.data.to!));
  res.json(ListSalonAppointmentsResponse.parse(items));
});

router.patch("/salon/appointments/:appointmentId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const [params, body] = [UpdateSalonAppointmentParams.safeParse(req.params), UpdateSalonAppointmentBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci za izmenu nisu ispravni." }); return; }
  const [target] = await db.select({ salonId: appointmentsTable.salonId }).from(appointmentsTable).where(eq(appointmentsTable.id, params.data.appointmentId)).limit(1);
  if (!target) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  if (target.salonId !== salon.id) { res.status(403).json({ error: "Termin pripada drugom salonu." }); return; }
  if (body.data.employeeId && !(await employeeInSalon(body.data.employeeId, salon.id))) {
    res.status(403).json({ error: "Zaposleni pripada drugom salonu." });
    return;
  }
  const [updated] = await db.update(appointmentsTable).set({ status: body.data.status, employeeId: body.data.employeeId, notes: body.data.notes }).where(and(eq(appointmentsTable.id, params.data.appointmentId), eq(appointmentsTable.salonId, salon.id))).returning();
  if (!updated) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  const [service, customer, employee] = await Promise.all([db.select().from(servicesTable).where(eq(servicesTable.id, updated.serviceId)).limit(1), db.select().from(usersTable).where(eq(usersTable.id, updated.customerId)).limit(1), updated.employeeId ? db.select().from(employeesTable).where(eq(employeesTable.id, updated.employeeId)).limit(1) : Promise.resolve([])]);
  res.json(UpdateSalonAppointmentResponse.parse(appointmentView(updated, salon, service[0]!, customer[0]!, employee[0])));
});

router.get("/salon/services", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const services = await db.select().from(servicesTable).where(eq(servicesTable.salonId, salon.id));
  res.json(ListSalonServicesResponse.parse(services.map((item) => ({ id: item.id, category: item.categoryName, name: item.name, description: item.description, durationMinutes: item.durationMinutes, price: item.price, promoPrice: item.promoPrice, imageUrl: item.imageUrl, active: item.active }))));
});

router.post("/salon/services", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const parsed = CreateSalonServiceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [category] = await db.select().from(serviceCategoriesTable).where(eq(serviceCategoriesTable.name, parsed.data.category)).limit(1);
  const [service] = await db.insert(servicesTable).values({ ...parsed.data, salonId: salon.id, categoryId: category?.id ?? null, categoryName: parsed.data.category, promoPrice: parsed.data.promoPrice ?? null }).returning();
  res.status(201).json(CreateSalonServiceResponse.parse({ id: service!.id, category: service!.categoryName, name: service!.name, description: service!.description, durationMinutes: service!.durationMinutes, price: service!.price, promoPrice: service!.promoPrice, imageUrl: service!.imageUrl, active: service!.active }));
});

router.get("/salon/employees", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
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

router.get("/shop/categories", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  void access;
  const allCats = await db.select().from(productCategoriesTable).where(eq(productCategoriesTable.active, true)).orderBy(asc(productCategoriesTable.sortOrder));
  const parents = allCats.filter((c) => !c.parentId);
  const result = parents.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    sortOrder: p.sortOrder,
    icon: p.icon ?? null,
    subcategories: allCats
      .filter((c) => c.parentId === p.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({ id: c.id, name: c.name, slug: c.slug, sortOrder: c.sortOrder })),
  }));
  res.json(ListProductCategoriesResponse.parse(result));
});

function productBelongsToActiveCategory(
  product: typeof productsTable.$inferSelect,
  categories: Array<typeof productCategoriesTable.$inferSelect>,
): boolean {
  if (product.subcategoryName) {
    const subcategory = categories.find((category) => category.name === product.subcategoryName);
    if (!subcategory?.active || !subcategory.parentId) return false;
    const parent = categories.find((category) => category.id === subcategory.parentId);
    return Boolean(parent?.active && parent.name === product.categoryName);
  }
  const category = categories.find((item) => item.name === product.categoryName && !item.parentId);
  return Boolean(category?.active);
}

function productDto(
  item: typeof productsTable.$inferSelect,
  reviews: Array<typeof productReviewsTable.$inferSelect> = [],
) {
  const discountPercent = item.discountPrice ? Math.round((1 - item.discountPrice / item.price) * 100) : null;
  const averageRating = reviews.length
    ? Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length) * 10) / 10
    : null;
  return {
    id: item.id,
    name: item.name,
    category: item.categoryName,
    subcategory: item.subcategoryName ?? null,
    brand: item.brand ?? null,
    description: item.description,
    shortDescription: item.shortDescription ?? null,
    imageUrl: item.imageUrl,
    images: item.images ?? [],
    price: item.price,
    discountPrice: item.discountPrice ?? null,
    discountPercent,
    stock: item.stock,
    sku: item.sku,
    unit: item.unit,
    weightGrams: item.weightGrams ?? null,
    isNew: item.isNew,
    isBestseller: item.isBestseller,
    variantType: item.variantType ?? null,
    variants: item.variants ?? null,
    averageRating,
    reviewCount: reviews.length,
  };
}

async function productReviewViews(productId: string, currentSalonId?: string) {
  const rows = await db
    .select({ review: productReviewsTable, salonName: salonsTable.name })
    .from(productReviewsTable)
    .innerJoin(salonsTable, eq(productReviewsTable.salonId, salonsTable.id))
    .where(eq(productReviewsTable.productId, productId))
    .orderBy(desc(productReviewsTable.updatedAt));
  return rows.map(({ review, salonName }) => ({
    id: review.id,
    salonName,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.updatedAt.toISOString(),
    mine: review.salonId === currentSalonId,
  }));
}

router.get("/shop/products", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const normalized = normalizeBooleanQuery(req.query, ["onSale", "isNew", "isBestseller"]);
  if (!normalized) { res.status(400).json({ error: "Invalid boolean filter" }); return; }
  const parsed = ListProductsQueryParams.safeParse(normalized);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [catalogCategories, activeProducts, allReviews] = await Promise.all([
    db.select().from(productCategoriesTable),
    db.select().from(productsTable).where(eq(productsTable.active, true)),
    db.select().from(productReviewsTable),
  ]);
  let products = activeProducts.filter((product) => productBelongsToActiveCategory(product, catalogCategories));
  const q = parsed.data;
  if (q.category) products = products.filter((item) => item.categoryName === q.category);
  if (q.subcategory) products = products.filter((item) => item.subcategoryName === q.subcategory);
  if (q.brand) products = products.filter((item) => item.brand?.toLowerCase() === q.brand!.toLowerCase());
  if (q.search) products = products.filter((item) => `${item.name} ${item.description} ${item.brand ?? ""}`.toLowerCase().includes(q.search!.toLowerCase()));
  if (q.onSale) products = products.filter((item) => item.discountPrice != null);
  if (q.isNew) products = products.filter((item) => item.isNew);
  if (q.isBestseller) products = products.filter((item) => item.isBestseller);
  res.json(ListProductsResponse.parse(products.map((item) => productDto(item, allReviews.filter((review) => review.productId === item.id)))));
});

router.get("/shop/products/:productId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const parsed = GetShopProductParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [product, categories] = await Promise.all([
    db.select().from(productsTable).where(eq(productsTable.id, parsed.data.productId)).limit(1),
    db.select().from(productCategoriesTable),
  ]);
  const item = product[0];
  if (!item || !item.active || !productBelongsToActiveCategory(item, categories)) {
    res.status(404).json({ error: "Proizvod nije pronađen ili nije dostupan." }); return;
  }
  const [reviewRows, allReviews, related] = await Promise.all([
    productReviewViews(item.id, access.salon.id),
    db.select().from(productReviewsTable),
    db.select().from(productsTable).where(and(eq(productsTable.active, true), eq(productsTable.categoryName, item.categoryName))),
  ]);
  const relatedProducts = related
    .filter((candidate) => candidate.id !== item.id && productBelongsToActiveCategory(candidate, categories))
    .slice(0, 4)
    .map((candidate) => productDto(candidate, allReviews.filter((review) => review.productId === candidate.id)));
  res.json(GetShopProductResponse.parse({
    ...productDto(item, allReviews.filter((review) => review.productId === item.id)),
    reviews: reviewRows,
    relatedProducts,
  }));
});

router.get("/shop/products/:productId/reviews", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const parsed = ListProductReviewsParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  res.json(ListProductReviewsResponse.parse(await productReviewViews(parsed.data.productId, access.salon.id)));
});

router.post("/shop/products/:productId/reviews", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const params = UpsertProductReviewParams.safeParse(req.params);
  const body = UpsertProductReviewBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Neispravan zahtev." }); return; }
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, params.data.productId)).limit(1);
  if (!product) { res.status(404).json({ error: "Proizvod nije pronađen." }); return; }
  const orders = await db.select({ id: ordersTable.id }).from(ordersTable)
    .where(and(eq(ordersTable.salonId, access.salon.id), inArray(ordersTable.status, ["paid", "processing", "shipped", "delivered"])));
  const purchased = orders.length && (await db.select({ id: orderItemsTable.id }).from(orderItemsTable)
    .where(and(eq(orderItemsTable.productId, product.id), inArray(orderItemsTable.orderId, orders.map((order) => order.id))))).length > 0;
  if (!purchased) { res.status(403).json({ error: "Recenziju može ostaviti samo salon koji je kupio ovaj proizvod." }); return; }
  const [existing] = await db.select().from(productReviewsTable)
    .where(and(eq(productReviewsTable.productId, product.id), eq(productReviewsTable.salonId, access.salon.id))).limit(1);
  const [saved] = existing
    ? await db.update(productReviewsTable).set({ rating: body.data.rating, comment: body.data.comment ?? "", updatedAt: new Date() }).where(eq(productReviewsTable.id, existing.id)).returning()
    : await db.insert(productReviewsTable).values({ productId: product.id, salonId: access.salon.id, rating: body.data.rating, comment: body.data.comment ?? "" }).returning();
  res.json(UpsertProductReviewResponse.parse({
    id: saved!.id,
    salonName: access.salon.name,
    rating: saved!.rating,
    comment: saved!.comment,
    createdAt: saved!.updatedAt.toISOString(),
    mine: true,
  }));
});

// ── Shipping calculation ─────────────────────────────────────────────────────

async function getShippingConfig() {
  const [config] = await db.select().from(shippingRulesTable).limit(1);
  if (config) return config;
  const [created] = await db.insert(shippingRulesTable).values({ freeShippingThreshold: 0, tiers: [] }).returning();
  return created!;
}

function calculateShipping(
  config: { freeShippingThreshold: number; tiers: Array<{ maxWeightGrams: number; price: number; label: string }> },
  totalWeightGrams: number,
  subtotal: number,
) {
  const threshold = config.freeShippingThreshold;
  const freeByThreshold = threshold > 0 && subtotal >= threshold;
  const sorted = [...config.tiers].sort((a, b) => a.maxWeightGrams - b.maxWeightGrams);
  let tierPrice = 0;
  if (sorted.length > 0 && totalWeightGrams > 0) {
    const match = sorted.find((t) => totalWeightGrams <= t.maxWeightGrams);
    tierPrice = match ? match.price : sorted[sorted.length - 1]!.price;
  }
  const shippingCost = freeByThreshold ? 0 : tierPrice;
  const amountToFreeShipping = threshold > 0 && !freeByThreshold ? threshold - subtotal : 0;
  let message: string | null = null;
  if (freeByThreshold) message = `Besplatna dostava jer je porudžbina preko ${threshold.toLocaleString("sr-RS")} RSD`;
  else if (threshold > 0) message = `Još ${amountToFreeShipping.toLocaleString("sr-RS")} RSD do besplatne dostave`;
  return {
    totalWeightGrams,
    shippingCost,
    freeShipping: freeByThreshold,
    freeShippingThreshold: threshold,
    amountToFreeShipping,
    message,
  };
}

router.get("/shop/shipping-quote", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const parsed = GetShippingQuoteQueryParams.safeParse({
    weightGrams: Number(req.query.weightGrams),
    subtotal: Number(req.query.subtotal),
  });
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const config = await getShippingConfig();
  res.json(calculateShipping(config, parsed.data.weightGrams, parsed.data.subtotal));
});

router.get("/loyalty/status", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  res.json(await loyaltyStatus(salon.id));
});

router.get("/shop/summary", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const loyalty = await loyaltyStatus(salon.id);
  res.json(GetShopSummaryResponse.parse({ monthlySpend: loyalty.monthlySpend, nextTierSpend: loyalty.monthlySpend + loyalty.amountToNextTier, amountToNextTier: loyalty.amountToNextTier, currentTier: loyalty.currentTier, subscriptionDue: loyalty.subscriptionDue, subscriptionDiscount: loyalty.subscriptionDiscountPercent, benefits: loyalty.benefits, cartCount: 0 }));
});

function orderDto(
  order: typeof ordersTable.$inferSelect,
  items: Array<{
    orderId: string;
    productId: string;
    productName: string;
    variantValue: string | null;
    variantLabel: string | null;
    productSku: string | null;
    quantity: number;
    price: number;
  }>,
  salon: typeof salonsTable.$inferSelect,
) {
  const billing = order.billingCompanyName
    ? {
        companyName: order.billingCompanyName,
        pib: order.billingTaxId ?? "",
        registrationNumber: order.billingRegistrationNumber ?? "",
        address: order.billingAddress ?? "",
        city: order.billingCity ?? "",
        postalCode: order.billingPostalCode ?? "",
      }
    : null;
  return {
    id: order.id,
    status: order.status,
    total: order.total,
    subtotal: order.subtotal,
    shippingCost: order.shippingCost,
    totalWeightGrams: order.totalWeightGrams,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    salon: { id: salon.id, name: salon.name, phone: salon.phone, email: salon.email },
    delivery: {
      recipientName: order.shippingName,
      address: order.shippingAddress,
      city: order.shippingCity ?? null,
      postalCode: order.shippingPostalCode ?? null,
      phone: order.shippingPhone ?? null,
      note: order.shippingNote ?? null,
      usesSalonAddress: order.shippingIsSalonAddress,
    },
    billing,
    items: items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      variantValue: item.variantValue ?? null,
      variantLabel: item.variantLabel ?? null,
      productSku: item.productSku ?? null,
      quantity: item.quantity,
      price: item.price,
    })),
  };
}

router.get("/shop/orders", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const orders = await db.select().from(ordersTable).where(eq(ordersTable.salonId, salon.id)).orderBy(desc(ordersTable.createdAt));
  const items = orders.length ? await db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, orders.map((item) => item.id))) : [];
  res.json(ListOrdersResponse.parse(orders.map((order) => orderDto(order, items.filter((item) => item.orderId === order.id), salon))));
});

router.get("/shop/orders/:orderId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const parsed = GetOrderParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [order] = await db.select().from(ordersTable)
    .where(and(eq(ordersTable.id, parsed.data.orderId), eq(ordersTable.salonId, access.salon.id))).limit(1);
  if (!order) { res.status(404).json({ error: "Porudžbina nije pronađena." }); return; }
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
  res.json(GetOrderResponse.parse(orderDto(order, items, access.salon)));
});

router.post("/shop/orders", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const useSalonAddress = parsed.data.useSalonAddress !== false;
  const delivery = useSalonAddress
    ? {
        recipientName: salon.name,
        street: salon.address,
        city: salon.city,
        postalCode: null as string | null,
        phone: salon.phone,
        note: null as string | null,
      }
    : parsed.data.deliveryAddress
      ? {
          recipientName: parsed.data.deliveryAddress.recipientName,
          street: parsed.data.deliveryAddress.street,
          city: parsed.data.deliveryAddress.city,
          postalCode: parsed.data.deliveryAddress.postalCode,
          phone: parsed.data.deliveryAddress.phone,
          note: parsed.data.deliveryAddress.note ?? null,
        }
      : null;
  if (!delivery) { res.status(400).json({ error: "Unesite kompletnu adresu za drugu adresu dostave." }); return; }
  const billing = parsed.data.billingDetails ?? null;
  const productIds = parsed.data.items.map((item) => item.productId);
  const products = await db.select().from(productsTable).where(inArray(productsTable.id, productIds));
  const catalogCategories = await db.select().from(productCategoriesTable);

  // Aggregate quantities per product (handles duplicate line items)
  const aggregated = new Map<string, number>();
  for (const orderItem of parsed.data.items) {
    aggregated.set(orderItem.productId, (aggregated.get(orderItem.productId) ?? 0) + orderItem.quantity);
  }

  // Validate each line: products with variants require a selection; products without variants reject one.
  for (const orderItem of parsed.data.items) {
    const product = products.find((p) => p.id === orderItem.productId);
    if (!product) { res.status(400).json({ error: `Proizvod nije pronađen.` }); return; }
    if (!product.active) { res.status(400).json({ error: `Proizvod "${product.name}" nije dostupan za naručivanje.` }); return; }
    if (!productBelongsToActiveCategory(product, catalogCategories)) {
      res.status(400).json({ error: `Kategorija proizvoda "${product.name}" trenutno nije dostupna za naručivanje.` }); return;
    }
    const variants = product.variants ?? [];
    if (variants.length > 0 && orderItem.variantValue === undefined) {
      res.status(400).json({ error: `Izaberite varijantu za proizvod "${product.name}".` }); return;
    }
    if (variants.length === 0 && orderItem.variantValue !== undefined) {
      res.status(400).json({ error: `Proizvod "${product.name}" nema dostupne varijante.` }); return;
    }
    if (orderItem.variantValue !== undefined) {
      const variant = variants.find((v) => v.value === orderItem.variantValue);
      if (!variant) { res.status(400).json({ error: `Varijanta "${orderItem.variantValue}" ne postoji za proizvod "${product.name}".` }); return; }
    }
  }
  for (const [productId, totalQty] of aggregated) {
    const product = products.find((p) => p.id === productId)!;
    if (product.stock < totalQty) {
      res.status(400).json({ error: `Nedovoljno zaliha za "${product.name}". Na stanju: ${product.stock}, traženo: ${totalQty}.` }); return;
    }
  }

  const shippingConfig = await getShippingConfig();

  // Single transaction: locks products, updates product/variant stock, then creates order and items.
  let conflictProductName: string | null = null;
  const created = await db.transaction(async (tx) => {
    const lockedProducts = new Map<string, typeof products[number]>();
    for (const productId of [...aggregated.keys()].sort()) {
      await tx.execute(sql`select id from products where id = ${productId} for update`);
      const [product] = await tx.select().from(productsTable).where(eq(productsTable.id, productId)).limit(1);
      if (!product || !product.active) {
        conflictProductName = product?.name ?? "izabrani proizvod";
        tx.rollback();
      }
      lockedProducts.set(productId, product!);
    }

    const variantQuantities = new Map<string, number>();
    for (const item of parsed.data.items) {
      const product = lockedProducts.get(item.productId)!;
      const variants = product.variants ?? [];
      if (
        (variants.length > 0 && item.variantValue === undefined) ||
        (variants.length === 0 && item.variantValue !== undefined)
      ) {
        conflictProductName = product.name;
        tx.rollback();
      }
      if (item.variantValue !== undefined) {
        const key = `${item.productId}\u0000${item.variantValue}`;
        variantQuantities.set(key, (variantQuantities.get(key) ?? 0) + item.quantity);
      }
    }

    for (const [productId, totalQty] of aggregated) {
      const product = lockedProducts.get(productId)!;
      if (product.stock < totalQty) {
        conflictProductName = product.name;
        tx.rollback();
      }
    }
    for (const [key, quantity] of variantQuantities) {
      const [productId, variantValue] = key.split("\u0000");
      const product = lockedProducts.get(productId!)!;
      const variant = (product.variants ?? []).find((value) => value.value === variantValue);
      if (!variant || (variant.stock !== undefined && variant.stock < quantity)) {
        conflictProductName = product.name;
        tx.rollback();
      }
    }

    const lineDetails = parsed.data.items.map((item) => {
      const product = lockedProducts.get(item.productId)!;
      const variant = item.variantValue !== undefined
        ? (product.variants ?? []).find((value) => value.value === item.variantValue)
        : undefined;
      return {
        product,
        variantValue: item.variantValue ?? null,
        variantLabel: variant?.label ?? null,
        quantity: item.quantity,
        price: variant?.price ?? ((product.discountPrice ?? product.price) + (variant?.priceAdjust ?? 0)),
      };
    });
    const subtotal = lineDetails.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const totalWeightGrams = lineDetails.reduce((sum, item) => sum + (item.product.weightGrams ?? 0) * item.quantity, 0);
    const shipping = calculateShipping(shippingConfig, totalWeightGrams, subtotal);
    const total = subtotal + shipping.shippingCost;

    for (const [productId, totalQty] of aggregated) {
      const product = lockedProducts.get(productId)!;
      const updatedVariants = (product.variants ?? []).map((variant) => {
        const quantity = variantQuantities.get(`${productId}\u0000${variant.value}`) ?? 0;
        return quantity > 0 && variant.stock !== undefined ? { ...variant, stock: variant.stock - quantity } : variant;
      });
      const updated = await tx.update(productsTable)
        .set({ stock: sql`stock - ${totalQty}`, variants: updatedVariants })
        .where(and(eq(productsTable.id, productId), sql`stock >= ${totalQty}`))
        .returning({ id: productsTable.id });
      if (!updated.length) {
        conflictProductName = product.name;
        tx.rollback();
      }
    }
    const [order] = await tx.insert(ordersTable).values({
      salonId: salon.id,
      status: "pending",
      total,
      subtotal,
      totalWeightGrams,
      shippingCost: shipping.shippingCost,
      shippingName: delivery.recipientName,
      shippingAddress: delivery.street,
      shippingCity: delivery.city,
      shippingPostalCode: delivery.postalCode,
      shippingPhone: delivery.phone,
      shippingNote: delivery.note,
      shippingIsSalonAddress: useSalonAddress,
      billingCompanyName: billing?.companyName ?? null,
      billingTaxId: billing?.pib ?? null,
      billingRegistrationNumber: billing?.registrationNumber ?? null,
      billingAddress: billing?.street ?? null,
      billingCity: billing?.city ?? null,
      billingPostalCode: billing?.postalCode ?? null,
      paymentMethod: parsed.data.paymentMethod,
    }).returning();
    const items = lineDetails.map((item) => ({
      orderId: order!.id,
      productId: item.product.id,
      productName: item.product.name,
      productSku: item.product.variants?.find((variant) => variant.value === item.variantValue)?.sku ?? item.product.sku,
      variantValue: item.variantValue,
      variantLabel: item.variantLabel,
      quantity: item.quantity,
      price: item.price,
    }));
    await tx.insert(orderItemsTable).values(items);
    return { order: order!, items };
  }).catch((error: unknown) => {
    if (conflictProductName !== null) return null;
    throw error;
  });
  if (!created) {
    res.status(409).json({ error: `Zalihe za "${conflictProductName}" su se promenile tokom obrade. Pokušajte ponovo.` });
    return;
  }
  res.status(201).json(CreateOrderResponse.parse(orderDto(created.order, created.items, salon)));
});

router.get("/admin/orders", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsed = AdminListOrdersQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const q = parsed.data;
  let orders = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt));
  const salons = await db.select().from(salonsTable);
  if (q.status) orders = orders.filter((order) => order.status === q.status);
  if (q.salon) {
    const term = q.salon.toLowerCase();
    orders = orders.filter((order) => {
      const salon = salons.find((item) => item.id === order.salonId);
      return salon?.name.toLowerCase().includes(term) || salon?.email.toLowerCase().includes(term);
    });
  }
  if (q.search) {
    const term = q.search.toLowerCase();
    orders = orders.filter((order) => {
      const salon = salons.find((item) => item.id === order.salonId);
      return order.id.toLowerCase().includes(term) || order.shippingName.toLowerCase().includes(term) || Boolean(salon?.name.toLowerCase().includes(term));
    });
  }
  if (q.from) orders = orders.filter((order) => order.createdAt >= new Date(`${q.from}T00:00:00.000Z`));
  if (q.to) orders = orders.filter((order) => order.createdAt <= new Date(`${q.to}T23:59:59.999Z`));
  const items = orders.length ? await db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, orders.map((order) => order.id))) : [];
  res.json(AdminListOrdersResponse.parse(orders.flatMap((order) => {
    const salon = salons.find((item) => item.id === order.salonId);
    return salon ? [orderDto(order, items.filter((item) => item.orderId === order.id), salon)] : [];
  })));
});

router.get("/admin/orders/:orderId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsed = AdminGetOrderParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, parsed.data.orderId)).limit(1);
  if (!order) { res.status(404).json({ error: "Porudžbina nije pronađena." }); return; }
  const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.id, order.salonId)).limit(1);
  if (!salon) { res.status(404).json({ error: "Salon porudžbine nije pronađen." }); return; }
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
  res.json(AdminGetOrderResponse.parse(orderDto(order, items, salon)));
});

router.patch("/admin/orders/:orderId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const params = AdminUpdateOrderStatusParams.safeParse(req.params);
  const body = AdminUpdateOrderStatusBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Neispravan zahtev." }); return; }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.orderId)).limit(1);
  if (!order) { res.status(404).json({ error: "Porudžbina nije pronađena." }); return; }
  const allowed: Record<string, string[]> = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["shipped", "cancelled"],
    paid: ["shipped", "cancelled"],
    processing: ["shipped", "cancelled"],
    shipped: ["delivered", "cancelled"],
    delivered: [],
    cancelled: [],
  };
  if (!allowed[order.status]?.includes(body.data.status)) {
    res.status(400).json({ error: "Ova promena statusa nije dozvoljena." }); return;
  }
  const [updated] = await db.update(ordersTable)
    .set({ status: body.data.status, updatedAt: new Date() })
    .where(eq(ordersTable.id, order.id)).returning();
  const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.id, updated!.salonId)).limit(1);
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, updated!.id));
  res.json(AdminUpdateOrderStatusResponse.parse(orderDto(updated!, items, salon!)));
});

router.get("/education/courses", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const parsed = ListCoursesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const query = parsed.data;
  let courses = await db.select().from(coursesTable);
  courses = courses.filter((course) => {
    const owned = isCourseOwner(access, course);
    if (query.mine) return access.admin || owned;
    return !course.archived && (course.published || owned || access.admin);
  });
  if (query.format) courses = courses.filter((course) => course.format === query.format);
  if (query.city) courses = courses.filter((course) => course.city?.toLowerCase() === query.city!.toLowerCase());
  if (query.category) courses = courses.filter((course) => course.category.toLowerCase().includes(query.category!.toLowerCase()));
  if (query.certification !== undefined) courses = courses.filter((course) => course.certification === query.certification);
  if (query.minPrice !== undefined) courses = courses.filter((course) => course.price >= query.minPrice!);
  if (query.maxPrice !== undefined) courses = courses.filter((course) => course.price <= query.maxPrice!);
  if (query.minRating !== undefined) courses = courses.filter((course) => course.rating / 10 >= query.minRating!);
  if (query.startDate) {
    const earliestStartDate = calendarDate(query.startDate);
    courses = courses.filter((course) => course.startDate !== null && course.startDate >= earliestStartDate);
  }
  if (query.center) {
    const publishers = await Promise.all(courses.map(async (course) => (await educationCourseView(course, access)).publisher));
    courses = courses.filter((_, index) => publishers[index]!.toLowerCase().includes(query.center!.toLowerCase()));
  }
  const views = await Promise.all(courses.map((course) => educationCourseView(course, access)));
  res.json(ListCoursesResponse.parse(views));
});

router.post("/education/courses", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const parsed = CreateEducationCourseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const publisher = access.salon ?? access.centers[0];
  if (!publisher || access.admin) { res.status(403).json({ error: "Administrator ne može da objavi kurs u ime drugog izdavača." }); return; }
  const data = parsed.data;
  const [course] = await db.insert(coursesTable).values({
    salonId: access.salon?.id ?? null,
    centerId: access.centers[0]?.id ?? null,
    title: data.title,
    description: data.description ?? "",
    category: data.category,
    format: data.format,
    city: data.city ?? publisher.city,
    price: data.price,
    duration: data.duration,
    certification: data.certification ?? false,
    imageUrl: data.imageUrl,
    startDate: data.startDate ? calendarDate(data.startDate) : null,
    published: false,
    archived: false,
  }).returning();
  const view = await educationCourseView(course!, access);
  res.status(201).json(CreateEducationCourseResponse.parse(view));
});

router.get("/education/courses/:courseId", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const parsed = GetEducationCourseParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, parsed.data.courseId)).limit(1);
  if (!course) { res.status(404).json({ error: "Kurs nije pronađen." }); return; }
  if ((!course.published || course.archived) && !isCourseOwner(access, course) && !access.admin) {
    res.status(403).json({ error: "Ovaj kurs nije dostupan u katalogu." }); return;
  }
  res.json(GetEducationCourseResponse.parse(await educationCourseView(course, access)));
});

router.patch("/education/courses/:courseId", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const [params, body] = [UpdateEducationCourseParams.safeParse(req.params), UpdateEducationCourseBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci kursa nisu ispravni." }); return; }
  const course = await requireOwnedCourse(access, params.data.courseId, res); if (!course) return;
  const data = body.data;
  const [updated] = await db.update(coursesTable).set({
    ...data,
    startDate: data.startDate === undefined ? course.startDate : data.startDate ? calendarDate(data.startDate) : null,
    updatedAt: new Date(),
  }).where(eq(coursesTable.id, course.id)).returning();
  res.json(UpdateEducationCourseResponse.parse(await educationCourseView(updated!, access)));
});

router.post("/education/courses/:courseId/publish", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const parsed = PublishEducationCourseParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const course = await requireOwnedCourse(access, parsed.data.courseId, res); if (!course) return;
  const [updated] = await db.update(coursesTable).set({ published: true, archived: false, updatedAt: new Date() }).where(eq(coursesTable.id, course.id)).returning();
  res.json(GetEducationCourseResponse.parse(await educationCourseView(updated!, access)));
});

router.delete("/education/courses/:courseId", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const parsed = ArchiveEducationCourseParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const course = await requireOwnedCourse(access, parsed.data.courseId, res); if (!course) return;
  await db.update(coursesTable).set({ archived: true, published: false, updatedAt: new Date() }).where(eq(coursesTable.id, course.id));
  res.sendStatus(204);
});

router.get("/education/courses/:courseId/modules", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const parsed = ListEducationModulesParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, parsed.data.courseId)).limit(1);
  if (!course || ((!course.published || course.archived) && !isCourseOwner(access, course) && !access.admin)) { res.status(404).json({ error: "Kurs nije pronađen." }); return; }
  res.json(ListEducationModulesResponse.parse(await modulesForCourse(course.id, new Set(), access.admin || isCourseOwner(access, course))));
});

router.post("/education/courses/:courseId/modules", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const [params, body] = [CreateEducationModuleParams.safeParse(req.params), CreateEducationModuleBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci modula nisu ispravni." }); return; }
  const course = await requireOwnedCourse(access, params.data.courseId, res); if (!course) return;
  const [module] = await db.insert(courseModulesTable).values({ courseId: course.id, title: body.data.title, description: body.data.description ?? "", sortOrder: body.data.sortOrder ?? 0 }).returning();
  res.status(201).json(CreateEducationModuleResponse.parse({ id: module!.id, title: module!.title, description: module!.description, sortOrder: module!.sortOrder, lessons: [] }));
});

router.patch("/education/modules/:moduleId", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const [params, body] = [UpdateEducationModuleParams.safeParse(req.params), UpdateEducationModuleBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci modula nisu ispravni." }); return; }
  const [module] = await db.select().from(courseModulesTable).where(eq(courseModulesTable.id, params.data.moduleId)).limit(1);
  if (!module) { res.status(404).json({ error: "Modul nije pronađen." }); return; }
  const course = await requireOwnedCourse(access, module.courseId, res); if (!course) return;
  const [updated] = await db.update(courseModulesTable).set(body.data).where(eq(courseModulesTable.id, module.id)).returning();
  const lessons = await modulesForCourse(course.id);
  res.json(UpdateEducationModuleResponse.parse(lessons.find((item) => item.id === updated!.id)!));
});

router.delete("/education/modules/:moduleId", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const moduleId = String(req.params.moduleId ?? "");
  const [module] = await db.select().from(courseModulesTable).where(eq(courseModulesTable.id, moduleId)).limit(1);
  if (!module) { res.status(404).json({ error: "Modul nije pronađen." }); return; }
  const course = await requireOwnedCourse(access, module.courseId, res); if (!course) return;
  await db.delete(courseModulesTable).where(eq(courseModulesTable.id, module.id));
  res.sendStatus(204);
});

router.post("/education/modules/:moduleId/lessons", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const [params, body] = [CreateEducationLessonParams.safeParse(req.params), CreateEducationLessonBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci lekcije nisu ispravni." }); return; }
  const [module] = await db.select().from(courseModulesTable).where(eq(courseModulesTable.id, params.data.moduleId)).limit(1);
  if (!module || !(await requireOwnedCourse(access, module.courseId, res))) return;
  const [lesson] = await db.insert(courseLessonsTable).values({ moduleId: module.id, title: body.data.title, description: body.data.description ?? "", content: body.data.content ?? "", durationMinutes: body.data.durationMinutes ?? 30, sortOrder: body.data.sortOrder ?? 0 }).returning();
  res.status(201).json(CreateEducationLessonResponse.parse({ ...lesson!, completed: false }));
});

router.patch("/education/lessons/:lessonId", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const [params, body] = [UpdateEducationLessonParams.safeParse(req.params), UpdateEducationLessonBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci lekcije nisu ispravni." }); return; }
  const [lesson] = await db.select().from(courseLessonsTable).where(eq(courseLessonsTable.id, params.data.lessonId)).limit(1);
  if (!lesson) { res.status(404).json({ error: "Lekcija nije pronađena." }); return; }
  const [module] = await db.select().from(courseModulesTable).where(eq(courseModulesTable.id, lesson.moduleId)).limit(1);
  if (!module || !(await requireOwnedCourse(access, module.courseId, res))) return;
  const [updated] = await db.update(courseLessonsTable).set(body.data).where(eq(courseLessonsTable.id, lesson.id)).returning();
  res.json(UpdateEducationLessonResponse.parse({ ...updated!, completed: false }));
});

router.delete("/education/lessons/:lessonId", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const lessonId = String(req.params.lessonId ?? "");
  const [lesson] = await db.select().from(courseLessonsTable).where(eq(courseLessonsTable.id, lessonId)).limit(1);
  if (!lesson) { res.status(404).json({ error: "Lekcija nije pronađena." }); return; }
  const [module] = await db.select().from(courseModulesTable).where(eq(courseModulesTable.id, lesson.moduleId)).limit(1);
  if (!module || !(await requireOwnedCourse(access, module.courseId, res))) return;
  await db.delete(courseLessonsTable).where(eq(courseLessonsTable.id, lesson.id));
  res.sendStatus(204);
});

router.get("/education/courses/:courseId/sessions", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const parsed = ListEducationSessionsParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, parsed.data.courseId)).limit(1);
  if (!course || ((!course.published || course.archived) && !isCourseOwner(access, course) && !access.admin)) { res.status(404).json({ error: "Kurs nije pronađen." }); return; }
  res.json(ListEducationSessionsResponse.parse(await sessionsForCourse(course.id)));
});

router.post("/education/courses/:courseId/sessions", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const [params, body] = [CreateEducationSessionParams.safeParse(req.params), CreateEducationSessionBody.safeParse(req.body)];
  if (!params.success || !body.success || body.data.endsAt <= body.data.startsAt) { res.status(400).json({ error: "Termin kursa nije ispravan." }); return; }
  const course = await requireOwnedCourse(access, params.data.courseId, res); if (!course) return;
  const [session] = await db.insert(courseSessionsTable).values({ courseId: course.id, startsAt: body.data.startsAt, endsAt: body.data.endsAt, location: body.data.location ?? null, capacity: body.data.capacity }).returning();
  res.status(201).json(CreateEducationSessionResponse.parse({ id: session!.id, startsAt: session!.startsAt.toISOString(), endsAt: session!.endsAt.toISOString(), location: session!.location, capacity: session!.capacity, reservedSeats: session!.reservedSeats, availableSeats: session!.capacity }));
});

router.post("/education/courses/:courseId/enrollments", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const [params, body] = [EnrollInEducationCourseParams.safeParse(req.params), EnrollInEducationCourseBody.safeParse(req.body ?? {})];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci prijave nisu ispravni." }); return; }
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, params.data.courseId)).limit(1);
  if (!course || !course.published || course.archived) { res.status(404).json({ error: "Kurs nije dostupan za prijavu." }); return; }
  let employee: typeof employeesTable.$inferSelect | null = null;
  if (body.data.employeeId) {
    if (!access.salon) { res.status(403).json({ error: "Zaposlenog možete prijaviti samo preko salona." }); return; }
    employee = await employeeInSalon(body.data.employeeId, access.salon.id);
    if (!employee) { res.status(403).json({ error: "Izabrani zaposleni ne pripada vašem salonu." }); return; }
  }
  const existing = await db.select().from(courseEnrollmentsTable).where(and(eq(courseEnrollmentsTable.courseId, course.id), eq(courseEnrollmentsTable.purchaserId, access.user.id)));
  if (existing.some((item) => (item.employeeId ?? null) === (employee?.id ?? null) && item.status !== "cancelled")) { res.status(409).json({ error: "Ovaj polaznik je već prijavljen na kurs." }); return; }
  const sessions = await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.courseId, course.id)).orderBy(asc(courseSessionsTable.startsAt));
  const session = sessions.find((item) => item.reservedSeats < item.capacity);
  if (course.format !== "online" && !session) { res.status(409).json({ error: "Nema slobodnih mesta u narednim terminima." }); return; }
  if (session) await db.update(courseSessionsTable).set({ reservedSeats: session.reservedSeats + 1 }).where(eq(courseSessionsTable.id, session.id));
  const firstLesson = (await modulesForCourse(course.id)).flatMap((module) => module.lessons)[0];
  const [enrollment] = await db.insert(courseEnrollmentsTable).values({
    courseId: course.id,
    userId: access.user.id,
    salonId: access.salon?.id ?? null,
    employeeId: employee?.id ?? null,
    purchaserId: access.user.id,
    status: "active",
    paymentStatus: "paid",
    nextLesson: firstLesson?.id ?? null,
    auditData: { source: "business-workspace", sessionId: session?.id ?? null },
  }).returning();
  res.status(201).json(EnrollInEducationCourseResponse.parse(await educationEnrollmentView(enrollment!)));
});

router.patch("/education/sessions/:sessionId", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const [params, body] = [UpdateEducationSessionParams.safeParse(req.params), UpdateEducationSessionBody.safeParse(req.body)];
  if (!params.success || !body.success || body.data.endsAt <= body.data.startsAt) { res.status(400).json({ error: "Termin kursa nije ispravan." }); return; }
  const [session] = await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, params.data.sessionId)).limit(1);
  if (!session || !(await requireOwnedCourse(access, session.courseId, res))) return;
  if (body.data.capacity < session.reservedSeats) { res.status(409).json({ error: "Kapacitet ne može biti manji od postojećih rezervacija." }); return; }
  const [updated] = await db.update(courseSessionsTable).set({
    startsAt: body.data.startsAt,
    endsAt: body.data.endsAt,
    location: body.data.location ?? null,
    capacity: body.data.capacity,
  }).where(eq(courseSessionsTable.id, session.id)).returning();
  res.json(UpdateEducationSessionResponse.parse({
    id: updated!.id,
    startsAt: updated!.startsAt.toISOString(),
    endsAt: updated!.endsAt.toISOString(),
    location: updated!.location,
    capacity: updated!.capacity,
    reservedSeats: updated!.reservedSeats,
    availableSeats: Math.max(0, updated!.capacity - updated!.reservedSeats),
  }));
});

router.delete("/education/sessions/:sessionId", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const sessionId = String(req.params.sessionId ?? "");
  const [session] = await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, sessionId)).limit(1);
  if (!session || !(await requireOwnedCourse(access, session.courseId, res))) return;
  if (session.reservedSeats > 0) { res.status(409).json({ error: "Termin sa rezervacijama ne može biti obrisan." }); return; }
  await db.delete(courseSessionsTable).where(eq(courseSessionsTable.id, session.id));
  res.sendStatus(204);
});

router.get("/education/enrollments", async (req, res): Promise<void> => {
  const lmsAccess = await requireLmsAccess(req, res); if (!lmsAccess) return;
  const [enrollments, courses] = await Promise.all([db.select().from(courseEnrollmentsTable), db.select().from(coursesTable)]);
  const visible = enrollments.filter((enrollment) => {
    if (lmsAccess.learnerEmployeeId) return enrollment.employeeId === lmsAccess.learnerEmployeeId;
    if (lmsAccess.access.admin || enrollment.purchaserId === lmsAccess.access.user.id) return true;
    const course = courses.find((item) => item.id === enrollment.courseId);
    return Boolean(course && isCourseOwner(lmsAccess.access, course));
  });
  res.json(ListEnrollmentsResponse.parse(await Promise.all(visible.map(educationEnrollmentView))));
});

router.get("/education/enrollments/:enrollmentId/lms", async (req, res): Promise<void> => {
  const lmsAccess = await requireLmsAccess(req, res); if (!lmsAccess) return;
  const parsed = GetEducationLmsParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [enrollment] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, parsed.data.enrollmentId)).limit(1);
  if (!enrollment) { res.status(403).json({ error: "Nemate pristup ovom LMS sadržaju." }); return; }
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, enrollment.courseId)).limit(1);
  if (!course) { res.status(404).json({ error: "Kurs nije pronađen." }); return; }
  if (!lmsAccess.access.admin && enrollment.purchaserId !== lmsAccess.access.user.id && enrollment.employeeId !== lmsAccess.learnerEmployeeId && !isCourseOwner(lmsAccess.access, course)) {
    res.status(403).json({ error: "Nemate pristup ovom LMS sadržaju." });
    return;
  }
  const progress = await db.select().from(lessonProgressTable).where(eq(lessonProgressTable.enrollmentId, enrollment.id));
  res.json(GetEducationLmsResponse.parse({
    enrollment: await educationEnrollmentView(enrollment),
    course: await educationCourseView(course, lmsAccess.access, new Set(progress.map((item) => item.lessonId)), true),
  }));
});

router.post("/education/enrollments/:enrollmentId/lessons/:lessonId/complete", async (req, res): Promise<void> => {
  const lmsAccess = await requireLmsAccess(req, res); if (!lmsAccess) return;
  const parsed = CompleteEducationLessonParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [enrollment, lesson] = await Promise.all([
    db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, parsed.data.enrollmentId)).limit(1),
    db.select().from(courseLessonsTable).where(eq(courseLessonsTable.id, parsed.data.lessonId)).limit(1),
  ]);
  if (!enrollment[0] || (enrollment[0].purchaserId !== lmsAccess.access.user.id && enrollment[0].employeeId !== lmsAccess.learnerEmployeeId) || enrollment[0].status !== "active") { res.status(403).json({ error: "Nemate pravo izmene ovog napretka." }); return; }
  if (!lesson[0]) { res.status(404).json({ error: "Lekcija nije pronađena." }); return; }
  const [module] = await db.select().from(courseModulesTable).where(eq(courseModulesTable.id, lesson[0].moduleId)).limit(1);
  if (!module || module.courseId !== enrollment[0].courseId) { res.status(400).json({ error: "Lekcija ne pripada ovom kursu." }); return; }
  const completed = await db.select().from(lessonProgressTable).where(eq(lessonProgressTable.enrollmentId, enrollment[0].id));
  if (!completed.some((item) => item.lessonId === lesson[0].id)) {
    await db.insert(lessonProgressTable).values({ enrollmentId: enrollment[0].id, lessonId: lesson[0].id, completedByUserId: lmsAccess.access.user.id });
  }
  const modules = await modulesForCourse(enrollment[0].courseId);
  const allLessons = modules.flatMap((item) => item.lessons);
  const completedIds = new Set([...completed.map((item) => item.lessonId), lesson[0].id]);
  const progress = allLessons.length ? Math.round((completedIds.size / allLessons.length) * 100) : 0;
  const nextLesson = allLessons.find((item) => !completedIds.has(item.id))?.id ?? null;
  const [updated] = await db.update(courseEnrollmentsTable).set({
    progress,
    nextLesson,
    status: progress === 100 ? "completed" : "active",
    completedAt: progress === 100 ? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(courseEnrollmentsTable.id, enrollment[0].id)).returning();
  res.json(CompleteEducationLessonResponse.parse(await educationEnrollmentView(updated!)));
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
      topSalon: s.topSalon,
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
  const { active, featured, topSalon } = parsed.data;

  const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.id, salonId)).limit(1);
  if (!salon) { res.status(404).json({ error: "Salon nije pronađen." }); return; }

  const updates: Partial<typeof salonsTable.$inferInsert> = {};
  if (active !== undefined) updates.active = active;
  if (featured !== undefined) updates.featured = featured;
  if (topSalon !== undefined) updates.topSalon = topSalon;

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
    topSalon: updated!.topSalon,
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

// ── Admin B2B Products ────────────────────────────────────────────────────────

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[čć]/g, "c").replace(/š/g, "s").replace(/ž/g, "z").replace(/đ/g, "dj")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function adminProductDto(item: typeof productsTable.$inferSelect) {
  const discountPercent = item.discountPrice ? Math.round((1 - item.discountPrice / item.price) * 100) : null;
  return {
    id: item.id,
    name: item.name,
    categoryId: item.categoryId ?? null,
    categoryName: item.categoryName,
    subcategoryName: item.subcategoryName ?? null,
    brand: item.brand ?? null,
    description: item.description,
    shortDescription: item.shortDescription ?? null,
    imageUrl: item.imageUrl,
    images: item.images ?? [],
    price: item.price,
    discountPrice: item.discountPrice ?? null,
    discountPercent,
    stock: item.stock,
    sku: item.sku,
    unit: item.unit,
    weightGrams: item.weightGrams ?? null,
    isNew: item.isNew,
    isBestseller: item.isBestseller,
    variantType: item.variantType ?? null,
    variants: item.variants ?? null,
    active: item.active,
    createdAt: item.createdAt.toISOString(),
  };
}

function validateVariantInventory(
  variants: Array<{ label: string; value: string; priceAdjust?: number; price?: number; stock?: number; sku?: string }> | null,
  stock: number,
): string | null {
  if (!Number.isInteger(stock) || stock < 0) return "Ukupna zaliha proizvoda mora biti nenegativan ceo broj.";
  if (!variants?.length) return null;
  const values = new Set<string>();
  for (const variant of variants) {
    const value = variant.value.trim();
    if (!value || values.has(value)) return "Svaka varijanta mora imati jedinstvenu vrednost.";
    values.add(value);
    if (variant.stock !== undefined && (!Number.isInteger(variant.stock) || variant.stock < 0)) {
      return "Zaliha varijante mora biti nenegativan ceo broj.";
    }
    if (variant.price !== undefined && (!Number.isInteger(variant.price) || variant.price < 0)) {
      return "Cena varijante mora biti nenegativan ceo broj.";
    }
  }
  const variantsWithStock = variants.filter((variant) => variant.stock !== undefined);
  if (variantsWithStock.length > 0 && variantsWithStock.length !== variants.length) {
    return "Ako varijante imaju sopstvenu zalihu, unesite zalihu za svaku varijantu.";
  }
  if (variantsWithStock.length === variants.length) {
    const totalVariantStock = variantsWithStock.reduce((sum, variant) => sum + (variant.stock ?? 0), 0);
    if (totalVariantStock !== stock) {
      return "Ukupna zaliha proizvoda mora biti jednaka zbiru zaliha svih varijanti.";
    }
  }
  return null;
}

async function categoryAssignment(categoryId: string) {
  const [category] = await db.select().from(productCategoriesTable).where(eq(productCategoriesTable.id, categoryId)).limit(1);
  if (!category) return null;
  if (!category.parentId) return { categoryId: category.id, categoryName: category.name, subcategoryName: null };
  const [parent] = await db.select().from(productCategoriesTable).where(eq(productCategoriesTable.id, category.parentId)).limit(1);
  if (!parent) return null;
  return { categoryId: category.id, categoryName: parent.name, subcategoryName: category.name };
}

router.get("/admin/products", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsed = AdminListProductsQueryParams.safeParse({
    ...req.query,
    page: req.query.page !== undefined ? Number(req.query.page) : undefined,
    pageSize: req.query.pageSize !== undefined ? Number(req.query.pageSize) : undefined,
  });
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const q = parsed.data;
  let products = await db.select().from(productsTable);
  if (q.search) {
    const term = q.search.toLowerCase();
    products = products.filter((p) => `${p.name} ${p.sku} ${p.brand ?? ""} ${p.description}`.toLowerCase().includes(term));
  }
  if (q.category) products = products.filter((p) => p.categoryName === q.category);
  if (q.subcategory) products = products.filter((p) => p.subcategoryName === q.subcategory);
  if (q.brand) products = products.filter((p) => p.brand?.toLowerCase() === q.brand!.toLowerCase());
  if (q.status === "in-stock") products = products.filter((p) => p.stock > 0);
  if (q.status === "out-of-stock") products = products.filter((p) => p.stock <= 0);
  if (q.status === "new") products = products.filter((p) => p.isNew);
  if (q.status === "on-sale") products = products.filter((p) => p.discountPrice != null);
  if (q.status === "inactive") products = products.filter((p) => !p.active);
  const sortBy = q.sortBy ?? "createdAt";
  const dir = (q.sortDir ?? "desc") === "asc" ? 1 : -1;
  products.sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name, "sr") * dir;
    if (sortBy === "price") return ((a.discountPrice ?? a.price) - (b.discountPrice ?? b.price)) * dir;
    if (sortBy === "stock") return (a.stock - b.stock) * dir;
    return (a.createdAt.getTime() - b.createdAt.getTime()) * dir;
  });
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  const total = products.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const items = products.slice((page - 1) * pageSize, page * pageSize);
  res.json({ items: items.map(adminProductDto), total, page, pageSize, totalPages });
});

router.post("/admin/products", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsed = AdminCreateProductBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = parsed.data;
  if (body.discountPrice != null && body.discountPrice >= body.price) {
    res.status(400).json({ error: "Akcijska cena mora biti niža od redovne cene." }); return;
  }
  if (!body.categoryId) { res.status(400).json({ error: "Kategorija je obavezna." }); return; }
  const assignment = await categoryAssignment(body.categoryId);
  if (!assignment) { res.status(404).json({ error: "Kategorija nije pronađena." }); return; }
  const variantError = validateVariantInventory(body.variants ?? null, body.stock);
  if (variantError) { res.status(400).json({ error: variantError }); return; }
  const [existingSku] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.sku, body.sku)).limit(1);
  if (existingSku) { res.status(409).json({ error: "Proizvod sa ovim SKU već postoji." }); return; }
  const [product] = await db.insert(productsTable).values({
    name: body.name,
    ...assignment,
    brand: body.brand ?? null,
    description: body.description,
    shortDescription: body.shortDescription ?? null,
    imageUrl: body.imageUrl,
    images: body.images ?? [],
    price: body.price,
    discountPrice: body.discountPrice ?? null,
    stock: body.stock,
    sku: body.sku,
    unit: body.unit,
    weightGrams: body.weightGrams,
    isNew: body.isNew ?? false,
    isBestseller: body.isBestseller ?? false,
    variantType: body.variantType?.trim() || null,
    variants: body.variants ?? null,
    active: body.active ?? true,
  }).returning();
  res.status(201).json(adminProductDto(product!));
});

router.post("/admin/products/bulk", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsed = AdminBulkUpdateProductsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { productIds, action, categoryId, pricePercent } = parsed.data;
  const products = await db.select().from(productsTable).where(inArray(productsTable.id, productIds));
  if (!products.length) { res.status(404).json({ error: "Nijedan proizvod nije pronađen." }); return; }
  let updated = 0;
  if (action === "activate" || action === "deactivate") {
    const result = await db.update(productsTable).set({ active: action === "activate" }).where(inArray(productsTable.id, productIds)).returning({ id: productsTable.id });
    updated = result.length;
  } else if (action === "set-new" || action === "unset-new") {
    const result = await db.update(productsTable).set({ isNew: action === "set-new" }).where(inArray(productsTable.id, productIds)).returning({ id: productsTable.id });
    updated = result.length;
  } else if (action === "set-category") {
    if (!categoryId) { res.status(400).json({ error: "categoryId je obavezan za promenu kategorije." }); return; }
    const [category] = await db.select().from(productCategoriesTable).where(eq(productCategoriesTable.id, categoryId)).limit(1);
    if (!category) { res.status(404).json({ error: "Kategorija nije pronađena." }); return; }
    const parent = category.parentId
      ? (await db.select().from(productCategoriesTable).where(eq(productCategoriesTable.id, category.parentId)).limit(1))[0]
      : null;
    const result = await db.update(productsTable).set({
      categoryId: category.id,
      categoryName: parent ? parent.name : category.name,
      subcategoryName: parent ? category.name : null,
    }).where(inArray(productsTable.id, productIds)).returning({ id: productsTable.id });
    updated = result.length;
  } else if (action === "adjust-price-percent") {
    if (pricePercent === undefined || pricePercent === 0) { res.status(400).json({ error: "pricePercent je obavezan za promenu cena." }); return; }
    for (const product of products) {
      const factor = 1 + pricePercent / 100;
      const newPrice = Math.max(1, Math.round(product.price * factor));
      const newDiscount = product.discountPrice != null ? Math.max(1, Math.round(product.discountPrice * factor)) : null;
      await db.update(productsTable).set({ price: newPrice, discountPrice: newDiscount }).where(eq(productsTable.id, product.id));
      updated += 1;
    }
  }
  res.json({ updated });
});

router.patch("/admin/products/:productId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsedParams = AdminUpdateProductParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { productId } = parsedParams.data;
  const [existing] = await db.select().from(productsTable).where(eq(productsTable.id, productId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Proizvod nije pronađen." }); return; }
  const parsed = AdminUpdateProductBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = parsed.data;
  const nextPrice = body.price ?? existing.price;
  const nextDiscount = body.discountPrice !== undefined ? body.discountPrice : existing.discountPrice;
  if (nextDiscount != null && nextDiscount >= nextPrice) {
    res.status(400).json({ error: "Akcijska cena mora biti niža od redovne cene." }); return;
  }
  if (body.sku && body.sku !== existing.sku) {
    const [skuTaken] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.sku, body.sku)).limit(1);
    if (skuTaken) { res.status(409).json({ error: "Proizvod sa ovim SKU već postoji." }); return; }
  }
  const nextStock = body.stock ?? existing.stock;
  const nextVariants = body.variants !== undefined ? body.variants : existing.variants;
  const variantError = validateVariantInventory(nextVariants, nextStock);
  if (variantError) { res.status(400).json({ error: variantError }); return; }
  let assignment: { categoryId: string; categoryName: string; subcategoryName: string | null } | null = null;
  if (body.categoryId !== undefined) {
    if (!body.categoryId) { res.status(400).json({ error: "Kategorija je obavezna." }); return; }
    assignment = await categoryAssignment(body.categoryId);
    if (!assignment) { res.status(404).json({ error: "Kategorija nije pronađena." }); return; }
  }
  const [product] = await db.update(productsTable).set({
    name: body.name ?? existing.name,
    categoryId: assignment?.categoryId ?? existing.categoryId,
    categoryName: assignment?.categoryName ?? existing.categoryName,
    subcategoryName: assignment ? assignment.subcategoryName : existing.subcategoryName,
    brand: body.brand !== undefined ? body.brand : existing.brand,
    description: body.description ?? existing.description,
    shortDescription: body.shortDescription !== undefined ? body.shortDescription : existing.shortDescription,
    imageUrl: body.imageUrl ?? existing.imageUrl,
    images: body.images ?? existing.images,
    price: nextPrice,
    discountPrice: nextDiscount,
    stock: nextStock,
    sku: body.sku ?? existing.sku,
    unit: body.unit ?? existing.unit,
    weightGrams: body.weightGrams ?? existing.weightGrams,
    isNew: body.isNew ?? existing.isNew,
    isBestseller: body.isBestseller ?? existing.isBestseller,
    variantType: body.variantType !== undefined ? body.variantType?.trim() || null : existing.variantType,
    variants: nextVariants,
    active: body.active ?? existing.active,
  }).where(eq(productsTable.id, productId)).returning();
  res.json(adminProductDto(product!));
});

router.delete("/admin/products/:productId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsedParams = AdminDeleteProductParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { productId } = parsedParams.data;
  const [existing] = await db.select().from(productsTable).where(eq(productsTable.id, productId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Proizvod nije pronađen." }); return; }
  const [inOrders] = await db.select({ count: count() }).from(orderItemsTable).where(eq(orderItemsTable.productId, productId));
  if ((inOrders?.count ?? 0) > 0) {
    const [deactivated] = await db.update(productsTable).set({ active: false }).where(eq(productsTable.id, productId)).returning();
    res.json(adminProductDto(deactivated!));
    return;
  }
  await db.delete(productsTable).where(eq(productsTable.id, productId));
  res.json(adminProductDto({ ...existing, active: false }));
});

// ── Admin Product Categories ──────────────────────────────────────────────────

async function adminCategoryDto(cat: typeof productCategoriesTable.$inferSelect) {
  const [byId] = await db.select({ count: count() }).from(productsTable).where(eq(productsTable.categoryId, cat.id));
  return {
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    parentId: cat.parentId ?? null,
    sortOrder: cat.sortOrder,
    icon: cat.icon ?? null,
    imageUrl: cat.imageUrl ?? null,
    active: cat.active,
    productCount: byId?.count ?? 0,
  };
}

router.get("/admin/product-categories", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const [cats, productCounts] = await Promise.all([
    db.select().from(productCategoriesTable).orderBy(asc(productCategoriesTable.sortOrder)),
    db.select({ categoryId: productsTable.categoryId, count: count() }).from(productsTable).groupBy(productsTable.categoryId),
  ]);
  const countByCat = new Map(productCounts.map((c) => [c.categoryId, c.count]));
  res.json(cats.map((cat) => ({
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    parentId: cat.parentId ?? null,
    sortOrder: cat.sortOrder,
    icon: cat.icon ?? null,
    imageUrl: cat.imageUrl ?? null,
    active: cat.active,
    productCount: countByCat.get(cat.id) ?? 0,
  })));
});

router.post("/admin/product-categories", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsed = AdminCreateProductCategoryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = parsed.data;
  const slug = slugify(body.name);
  const [nameTaken] = await db.select({ id: productCategoriesTable.id }).from(productCategoriesTable).where(eq(productCategoriesTable.name, body.name)).limit(1);
  if (nameTaken) { res.status(409).json({ error: "Kategorija sa ovim nazivom već postoji." }); return; }
  if (body.parentId) {
    const [parent] = await db.select().from(productCategoriesTable).where(eq(productCategoriesTable.id, body.parentId)).limit(1);
    if (!parent) { res.status(404).json({ error: "Nadređena kategorija nije pronađena." }); return; }
    if (parent.parentId) { res.status(400).json({ error: "Podkategorija ne može imati sopstvene podkategorije." }); return; }
  }
  const [cat] = await db.insert(productCategoriesTable).values({
    name: body.name,
    slug,
    parentId: body.parentId ?? null,
    sortOrder: body.sortOrder ?? 0,
    icon: body.icon ?? null,
    imageUrl: body.imageUrl ?? null,
    active: body.active ?? true,
  }).returning();
  res.status(201).json(await adminCategoryDto(cat!));
});

router.patch("/admin/product-categories/:categoryId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsedParams = AdminUpdateProductCategoryParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { categoryId } = parsedParams.data;
  const [existing] = await db.select().from(productCategoriesTable).where(eq(productCategoriesTable.id, categoryId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Kategorija nije pronađena." }); return; }
  const parsed = AdminUpdateProductCategoryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = parsed.data;
  if (body.parentId !== undefined && body.parentId !== existing.parentId) {
    const [children] = await db.select({ count: count() }).from(productCategoriesTable).where(eq(productCategoriesTable.parentId, categoryId));
    if ((children?.count ?? 0) > 0) {
      res.status(409).json({ error: "Kategorija sa podkategorijama ne može se premestiti. Prvo premestite podkategorije." });
      return;
    }
  }
  if (body.parentId) {
    if (body.parentId === categoryId) { res.status(400).json({ error: "Kategorija ne može biti sama sebi nadređena." }); return; }
    const [parent] = await db.select().from(productCategoriesTable).where(eq(productCategoriesTable.id, body.parentId)).limit(1);
    if (!parent) { res.status(404).json({ error: "Nadređena kategorija nije pronađena." }); return; }
    if (parent.parentId) { res.status(400).json({ error: "Podkategorija ne može imati sopstvene podkategorije." }); return; }
  }
  const newName = body.name ?? existing.name;
  const newParentId = body.parentId !== undefined ? body.parentId : existing.parentId;
  const [cat] = await db.transaction(async (tx) => {
    const [updated] = await tx.update(productCategoriesTable).set({
      name: newName,
      slug: body.name && body.name !== existing.name ? slugify(body.name) : existing.slug,
      parentId: newParentId,
      sortOrder: body.sortOrder ?? existing.sortOrder,
      icon: body.icon !== undefined ? body.icon : existing.icon,
      imageUrl: body.imageUrl !== undefined ? body.imageUrl : existing.imageUrl,
      active: body.active ?? existing.active,
    }).where(eq(productCategoriesTable.id, categoryId)).returning();

    if (existing.parentId || newParentId) {
      const parent = newParentId
        ? (await tx.select().from(productCategoriesTable).where(eq(productCategoriesTable.id, newParentId)).limit(1))[0]
        : null;
      await tx.update(productsTable).set({
        categoryId: updated!.id,
        categoryName: parent?.name ?? newName,
        subcategoryName: parent ? newName : null,
      }).where(or(
        eq(productsTable.categoryId, categoryId),
        eq(productsTable.subcategoryName, existing.name),
        eq(productsTable.categoryName, existing.name),
      ));
    } else if (body.name && body.name !== existing.name) {
      await tx.update(productsTable).set({ categoryName: newName }).where(eq(productsTable.categoryName, existing.name));
    }
    return [updated!];
  });
  res.json(await adminCategoryDto(cat!));
});

router.delete("/admin/product-categories/:categoryId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsedParams = AdminDeleteProductCategoryParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { categoryId } = parsedParams.data;
  const [existing] = await db.select().from(productCategoriesTable).where(eq(productCategoriesTable.id, categoryId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Kategorija nije pronađena." }); return; }
  const [children] = await db.select({ count: count() }).from(productCategoriesTable).where(eq(productCategoriesTable.parentId, categoryId));
  if ((children?.count ?? 0) > 0) { res.status(409).json({ error: "Kategorija ima podkategorije. Prvo obrišite ili premestite podkategorije." }); return; }
  const [products] = await db.select({ count: count() }).from(productsTable).where(or(
    eq(productsTable.categoryId, categoryId),
    eq(productsTable.subcategoryName, existing.name),
  ));
  if ((products?.count ?? 0) > 0) { res.status(409).json({ error: "Kategorija sadrži proizvode. Prvo premestite proizvode u drugu kategoriju." }); return; }
  await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, categoryId));
  res.sendStatus(204);
});

// ── Admin Brands ──────────────────────────────────────────────────────────────

router.get("/admin/brands", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const [brands, products] = await Promise.all([
    db.select().from(productBrandsTable).orderBy(asc(productBrandsTable.name)),
    db.select({ brand: productsTable.brand, count: count() }).from(productsTable).groupBy(productsTable.brand),
  ]);
  const countByBrand = new Map(products.map((p) => [p.brand?.toLowerCase(), p.count]));
  res.json(brands.map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    description: b.description,
    logoUrl: b.logoUrl ?? null,
    active: b.active,
    productCount: countByBrand.get(b.name.toLowerCase()) ?? 0,
  })));
});

router.post("/admin/brands", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsed = AdminCreateBrandBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = parsed.data;
  const [nameTaken] = await db.select({ id: productBrandsTable.id }).from(productBrandsTable).where(eq(productBrandsTable.name, body.name)).limit(1);
  if (nameTaken) { res.status(409).json({ error: "Brend sa ovim nazivom već postoji." }); return; }
  const [brand] = await db.insert(productBrandsTable).values({
    name: body.name,
    slug: slugify(body.name),
    description: body.description ?? "",
    logoUrl: body.logoUrl ?? null,
    active: body.active ?? true,
  }).returning();
  res.status(201).json({ id: brand!.id, name: brand!.name, slug: brand!.slug, description: brand!.description, logoUrl: brand!.logoUrl ?? null, active: brand!.active, productCount: 0 });
});

router.patch("/admin/brands/:brandId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsedParams = AdminUpdateBrandParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { brandId } = parsedParams.data;
  const [existing] = await db.select().from(productBrandsTable).where(eq(productBrandsTable.id, brandId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Brend nije pronađen." }); return; }
  const parsed = AdminUpdateBrandBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = parsed.data;
  const [brand] = await db.update(productBrandsTable).set({
    name: body.name ?? existing.name,
    slug: body.name && body.name !== existing.name ? slugify(body.name) : existing.slug,
    description: body.description ?? existing.description,
    logoUrl: body.logoUrl !== undefined ? body.logoUrl : existing.logoUrl,
    active: body.active ?? existing.active,
  }).where(eq(productBrandsTable.id, brandId)).returning();
  // Keep denormalized product brand names in sync
  if (body.name && body.name !== existing.name) {
    await db.update(productsTable).set({ brand: body.name }).where(eq(productsTable.brand, existing.name));
  }
  const [productCount] = await db.select({ count: count() }).from(productsTable).where(eq(productsTable.brand, brand!.name));
  res.json({ id: brand!.id, name: brand!.name, slug: brand!.slug, description: brand!.description, logoUrl: brand!.logoUrl ?? null, active: brand!.active, productCount: productCount?.count ?? 0 });
});

router.delete("/admin/brands/:brandId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsedParams = AdminDeleteBrandParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { brandId } = parsedParams.data;
  const [existing] = await db.select().from(productBrandsTable).where(eq(productBrandsTable.id, brandId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Brend nije pronađen." }); return; }
  const [[inProducts], [inSalons]] = await Promise.all([
    db.select({ count: count() }).from(productsTable).where(eq(productsTable.brand, existing.name)),
    db.select({ count: count() }).from(salonBrandsTable).where(eq(salonBrandsTable.brandId, brandId)),
  ]);
  if ((inProducts?.count ?? 0) > 0 || (inSalons?.count ?? 0) > 0) {
    const [deactivated] = await db.update(productBrandsTable).set({ active: false }).where(eq(productBrandsTable.id, brandId)).returning();
    res.json({ id: deactivated!.id, name: deactivated!.name, slug: deactivated!.slug, description: deactivated!.description, logoUrl: deactivated!.logoUrl ?? null, active: deactivated!.active, productCount: inProducts?.count ?? 0 });
    return;
  }
  await db.delete(productBrandsTable).where(eq(productBrandsTable.id, brandId));
  res.json({ id: existing.id, name: existing.name, slug: existing.slug, description: existing.description, logoUrl: existing.logoUrl ?? null, active: false, productCount: 0 });
});

// ── Admin Shipping Configuration ──────────────────────────────────────────────

router.get("/admin/shipping", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const config = await getShippingConfig();
  res.json({ freeShippingThreshold: config.freeShippingThreshold, tiers: config.tiers, updatedAt: config.updatedAt.toISOString() });
});

router.put("/admin/shipping", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsed = AdminUpdateShippingConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = parsed.data;
  const seen = new Set<number>();
  for (const tier of body.tiers) {
    if (seen.has(tier.maxWeightGrams)) { res.status(400).json({ error: "Dva ranga ne mogu imati istu maksimalnu težinu." }); return; }
    seen.add(tier.maxWeightGrams);
  }
  const existing = await getShippingConfig();
  const [config] = await db.update(shippingRulesTable).set({
    freeShippingThreshold: body.freeShippingThreshold,
    tiers: [...body.tiers].sort((a, b) => a.maxWeightGrams - b.maxWeightGrams),
    updatedAt: new Date(),
  }).where(eq(shippingRulesTable.id, existing.id)).returning();
  res.json({ freeShippingThreshold: config!.freeShippingThreshold, tiers: config!.tiers, updatedAt: config!.updatedAt.toISOString() });
});

export default router;
