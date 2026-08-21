import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, count, desc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  appointmentSeriesTable,
  appointmentsTable,
  beautyGlossaryTable,
  courseEnrollmentsTable,
  courseLessonsTable,
  courseModulesTable,
  courseSessionsTable,
  courierServicesTable,
  coursesTable,
  db,
  educationCentersTable,
  emailCampaignsTable,
  emailDeliveriesTable,
  employeesTable,
  employeeLeaveRequestsTable,
  employeeSchedulesTable,
  employeeServicesTable,
  employeeTimeOffTable,
  favoritesTable,
  favoriteEmployeesTable,
  inspirationItemsTable,
  lessonProgressTable,
  loyaltyTiersTable,
  oauthIdentitiesTable,
  oauthLoginStatesTable,
  phoneVerificationCodesTable,
  orderItemsTable,
  orderStatusHistoryTable,
  ordersTable,
  salonNotificationsTable,
  productReviewsTable,
  productCategoriesTable,
  productsTable,
  productBrandsTable,
  reviewsTable,
  salonHoursTable,
  salonBrandsTable,
  sessionsTable,
  shippingRulesTable,
  shoppingCartItemsTable,
  shoppingCartsTable,
  salonLoyaltyStatusesTable,
  salonsTable,
  salonCustomersTable,
  serviceCategoriesTable,
  serviceTemplatesTable,
  servicesTable,
  subscriptionPlansTable,
  subscriptionsTable,
  smsDeliveriesTable,
  usersTable,
} from "@workspace/db";
import {
  AdminBulkUpdateProductsBody,
  AdminListServiceCategoriesResponse,
  AdminListServiceTemplatesQueryParams,
  AdminListServiceTemplatesResponse,
  AdminRequestServiceCategoryImageUploadBody,
  AdminRequestServiceCategoryImageUploadResponse,
  AdminUpdateServiceCategoryBody,
  AdminUpdateServiceCategoryParams,
  AdminUpdateServiceCategoryResponse,
  AdminCreateEmailCampaignBody,
  AdminCreateEmailCampaignResponse,
  AdminCreateCourierServiceBody,
  AdminCreateCourierServiceResponse,
  AdminCreateBrandBody,
  AdminCreateServiceTemplateBody,
  AdminCreateServiceTemplateResponse,
  AdminCreateLoyaltyTierBody,
  AdminCreateProductBody,
  AdminCreateProductCategoryBody,
  AdminCreateSubscriptionPlanBody,
  AdminDeleteBrandParams,
  AdminDeleteServiceTemplateParams,
  AdminDeleteCourierServiceParams,
  AdminDeleteProductCategoryParams,
  AdminDeleteProductParams,
  AdminListProductsQueryParams,
  AdminUpdateBrandBody,
  AdminUpdateBrandParams,
  AdminUpdateServiceTemplateBody,
  AdminUpdateServiceTemplateParams,
  AdminUpdateServiceTemplateResponse,
  AdminUpdateProductBody,
  AdminUpdateProductCategoryBody,
  AdminUpdateProductCategoryParams,
  AdminUpdateProductParams,
  AdminUpdateShippingConfigBody,
  AdminGetOrderParams,
  AdminGetOrderResponse,
  AdminGetSalonParams,
  AdminGetSalonResponse,
  AdminListOrdersQueryParams,
  AdminListOrdersResponse,
  AdminListEmailCampaignsResponse,
  AdminListCourierServicesResponse,
  AdminUpdateOrderStatusBody,
  AdminUpdateOrderStatusParams,
  AdminUpdateOrderStatusResponse,
  AdminUpdateCourierServiceBody,
  AdminUpdateCourierServiceParams,
  AdminUpdateCourierServiceResponse,
  AdminBulkUpdateOrdersBody,
  GetShippingQuoteQueryParams,
  GetOrderParams,
  GetOrderResponse,
  GetShopProductParams,
  GetShopProductResponse,
  GetShopCartResponse,
  GetShopCheckoutPreviewResponse,
  GetShopCheckoutProfileResponse,
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
  CancelSalonAppointmentSeriesParams,
  CancelSalonAppointmentSeriesResponse,
  CreateAppointmentBody,
  CreateAppointmentResponse,
  AddShopCartItemBody,
  AddShopCartItemResponse,
  CheckoutShopCartBody,
  CheckoutShopCartResponse,
  CreateSalonServiceBody,
  CreateSalonServiceResponse,
  CreateSalonServicesBatchBody,
  CreateSalonServicesBatchResponse,
  DisconnectAuthSignInMethodParams,
  DisconnectAuthSignInMethodResponse,
  DeleteCustomerSalonReviewParams,
  DeleteCustomerSalonReviewResponse,
  GetAdminSummaryResponse,
  GetAuthSignInMethodsResponse,
  GetCurrentUserResponse,
  GetCustomerDashboardResponse,
  GetCustomerSalonReviewParams,
  GetCustomerSalonReviewResponse,
  GetLoyaltyStatusResponse,
  GetMarketplaceHomeDiscoveryQueryParams,
  GetMarketplaceHomeDiscoveryResponse,
  GetPlatformTrustStatsResponse,
  GetSalonAvailabilityParams,
  GetSalonAvailabilityQueryParams,
  GetSalonAvailabilityResponse,
  GetSalonFirstAvailableParams,
  GetSalonFirstAvailableResponse,
  GetSalonDashboardResponse,
  GetManagedSalonProfileResponse,
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
  ListSalonNotificationsResponse,
  ListOrdersResponse,
  ListProductReviewsParams,
  ListProductReviewsResponse,
  ListProductCategoriesResponse,
  ListProductsQueryParams,
  ListProductsResponse,
  ListSalonAppointmentsQueryParams,
  ListSalonAppointmentsResponse,
  ListSalonCustomersResponse,
  ListSalonEmployeesResponse,
  ListSalonServicesResponse,
  ListServiceTemplatesQueryParams,
  ListServiceTemplatesResponse,
  ListSalonsQueryParams,
  ListSalonsResponse,
  LoginBody,
  LoginResponse,
  RegisterBusinessBody,
  RegisterBody,
  RegisterResponse,
  MarkSalonNotificationReadParams,
  MarkSalonNotificationReadResponse,
  RemoveShopCartItemParams,
  RemoveShopCartItemResponse,
  UpsertProductReviewBody,
  UpsertProductReviewParams,
  UpsertProductReviewResponse,
  PublishEducationCourseParams,
  PublishEducationCourseResponse,
  ToggleFavoriteBody,
  ToggleFavoriteResponse,
  UpsertCustomerSalonReviewBody,
  UpsertCustomerSalonReviewParams,
  UpsertCustomerSalonReviewResponse,
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
  UpdateManagedSalonProfileBody,
  CreateSalonAppointmentBody,
  CreateSalonAppointmentResponse,
  CreateSalonAppointmentSeriesBody,
  CreateSalonAppointmentSeriesResponse,
  CreateEmployeeAppointmentSeriesBody,
  CreateEmployeeAppointmentSeriesResponse,
  PreviewSalonAppointmentSeriesBody,
  PreviewSalonAppointmentSeriesResponse,
  PreviewSalonAppointmentSeriesMoveBody,
  PreviewSalonAppointmentSeriesMoveParams,
  PreviewSalonAppointmentSeriesMoveResponse,
  PreviewEmployeeAppointmentSeriesBody,
  PreviewEmployeeAppointmentSeriesResponse,
  MoveSalonAppointmentSeriesBody,
  MoveSalonAppointmentSeriesParams,
  MoveSalonAppointmentSeriesResponse,
  UpdateSalonCustomerBody,
  UpdateSalonCustomerParams,
  UpdateSalonCustomerResponse,
  AdminListSmsDeliveriesResponse,
  UpdateShopCartItemBody,
  UpdateShopCartItemParams,
  UpdateShopCartItemResponse,
} from "@workspace/api-zod";
import { createSession, destroySession, getCurrentUser, hashPassword, isAdmin, publicUser, sessionCookieName, verifyPassword } from "../lib/auth";
import { createBrevoMarketingCampaign, lumeraEmailHtml, sendBrevoCampaignNow, sendTransactionalEmail } from "../lib/brevo";
import { ensureDemoData } from "../lib/seed";
import { maskPhone, sendPhoneVerificationCode, sendSms, sendTestSms } from "../lib/sms";
import { sendDailyAppointmentReminders } from "../lib/sms-reminders";
import { runRescheduledConfirmationRetries } from "../lib/rescheduled-confirmation-retries";
import { infobipBaseUrl, integrationDisplay, integrationSettings, integrationValue, saveIntegrationSettings, type IntegrationName } from "../lib/integrations";
import { lockAppointmentResources } from "../lib/appointment-locks";

const router: IRouter = Router();
const OAUTH_STATE_COOKIE = "lumera_oauth_state";

function cookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 24 * 14, path: "/" };
}

type OAuthProvider = "google" | "facebook";
type OAuthProfile = { id: string; email: string; firstName: string; lastName: string };

function oauthRedirect(req: Request, provider: OAuthProvider) {
  const configured = process.env["APP_BASE_URL"]?.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production" && (!configured || !configured.startsWith("https://"))) return null;
  const base = configured ?? `${req.protocol}://${req.get("host")}`;
  return `${base}/api/auth/oauth/${provider}/callback`;
}

function oauthFailurePath(flow: string, reason: string) {
  const page = flow === "business" ? "/poslovna-prijava" : "/prijava";
  return `${page}?oauth_error=${encodeURIComponent(reason)}`;
}

function emailCampaignView(campaign: typeof emailCampaignsTable.$inferSelect) {
  return {
    id: campaign.id,
    audience: campaign.audience as "customers" | "salons" | "loyalty",
    loyaltyTierId: campaign.loyaltyTierId,
    title: campaign.title,
    subject: campaign.subject,
    htmlContent: campaign.htmlContent,
    scheduledAt: campaign.scheduledAt,
    status: campaign.status,
    recipientCount: campaign.recipientCount,
    brevoCampaignId: campaign.brevoCampaignId,
    errorMessage: campaign.errorMessage,
    createdAt: campaign.createdAt,
    sentAt: campaign.sentAt,
  };
}

function emailSafe(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function appointmentLabel(appointment: typeof appointmentsTable.$inferSelect, salon: typeof salonsTable.$inferSelect, service: typeof servicesTable.$inferSelect) {
  return `${emailSafe(service.name)} u salonu ${emailSafe(salon.name)}, ${emailSafe(calendarDate(appointment.date))} u ${emailSafe(appointment.startTime)}`;
}

function appointmentReminderTime(appointment: typeof appointmentsTable.$inferSelect) {
  const start = new Date(`${calendarDate(appointment.date)}T${appointment.startTime}:00`);
  start.setDate(start.getDate() - 1);
  return start > new Date() ? start : null;
}

async function sendAppointmentEmails(input: {
  event: "created" | "updated" | "cancelled";
  appointment: typeof appointmentsTable.$inferSelect;
  customer: typeof usersTable.$inferSelect;
  salon: typeof salonsTable.$inferSelect;
  service: typeof servicesTable.$inferSelect;
}) {
  const { appointment, customer, salon, service, event } = input;
  const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, salon.ownerId)).limit(1);
  const label = appointmentLabel(appointment, salon, service);
  const eventCopy = event === "created"
    ? appointment.status === "confirmed"
      ? { customerTitle: "Termin je potvrđen", customerText: `Vaš termin za ${label} je potvrđen. Vidimo se u salonu!`, salonTitle: "Novi potvrđen termin", salonText: `${emailSafe(customer.firstName)} ${emailSafe(customer.lastName)} je automatski potvrdio/la ${label}.` }
      : { customerTitle: "Zahtev za termin je primljen", customerText: `Vaš zahtev za ${label} je uspešno primljen. Salon će potvrditi termin.`, salonTitle: "Novi zahtev za termin", salonText: `${emailSafe(customer.firstName)} ${emailSafe(customer.lastName)} je rezervisao/la ${label}.` }
    : event === "updated"
      ? { customerTitle: "Termin je izmenjen", customerText: `Vaš termin je izmenjen: ${label}.`, salonTitle: "Termin je izmenjen", salonText: `${emailSafe(customer.firstName)} ${emailSafe(customer.lastName)} je izmenio/la termin: ${label}.` }
      : { customerTitle: "Termin je otkazan", customerText: `Vaš termin je otkazan: ${label}.`, salonTitle: "Termin je otkazan", salonText: `${emailSafe(customer.firstName)} ${emailSafe(customer.lastName)} je otkazao/la termin: ${label}.` };
  await Promise.all([
    sendTransactionalEmail({
      eventKey: `appointment:${appointment.id}:customer:${event}`,
      emailType: event === "created" && appointment.status === "confirmed" ? "appointment_confirmed" : `appointment_${event}`,
      to: { email: customer.email, name: `${customer.firstName} ${customer.lastName}` },
      subject: `LUMERA — ${eventCopy.customerTitle}`,
      htmlContent: lumeraEmailHtml(eventCopy.customerTitle, `<p>${eventCopy.customerText}</p>`),
      metadata: { appointmentId: appointment.id, salonId: salon.id },
    }),
    owner ? sendTransactionalEmail({
      eventKey: `appointment:${appointment.id}:salon:${event}`,
      emailType: event === "created" && appointment.status === "confirmed" ? "salon_appointment_confirmed" : `salon_appointment_${event}`,
      to: { email: owner.email, name: `${owner.firstName} ${owner.lastName}` },
      subject: `LUMERA Biznis — ${eventCopy.salonTitle}`,
      htmlContent: lumeraEmailHtml(eventCopy.salonTitle, `<p>${eventCopy.salonText}</p>`),
      metadata: { appointmentId: appointment.id, salonId: salon.id },
    }) : Promise.resolve(),
  ]);
  if (event === "created") {
    const scheduledAt = appointmentReminderTime(appointment);
    if (scheduledAt) await sendTransactionalEmail({
      eventKey: `appointment:${appointment.id}:customer:reminder`,
      emailType: "appointment_reminder",
      to: { email: customer.email, name: `${customer.firstName} ${customer.lastName}` },
      subject: "LUMERA — podsetnik za sutrašnji termin",
      htmlContent: lumeraEmailHtml("Podsetnik za termin", `<p>Podsećamo vas na ${label}.</p>`),
      scheduledAt,
      metadata: { appointmentId: appointment.id, salonId: salon.id },
    });
  }
}

async function campaignRecipients(audience: "customers" | "salons" | "loyalty", loyaltyTierId?: string | null) {
  if (audience === "customers") {
    const users = await db.select().from(usersTable).where(eq(usersTable.role, "CUSTOMER"));
    return users.filter((user) => user.active).map((user) => ({ email: user.email, name: `${user.firstName} ${user.lastName}`.trim() }));
  }
  if (audience === "salons") {
    const rows = await db.select({ email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(salonsTable).innerJoin(usersTable, eq(salonsTable.ownerId, usersTable.id));
    return rows.map((user) => ({ email: user.email, name: `${user.firstName} ${user.lastName}`.trim() }));
  }
  if (!loyaltyTierId) return [];
  const rows = await db.select({ email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(salonLoyaltyStatusesTable)
    .innerJoin(salonsTable, eq(salonLoyaltyStatusesTable.salonId, salonsTable.id))
    .innerJoin(usersTable, eq(salonsTable.ownerId, usersTable.id))
    .where(eq(salonLoyaltyStatusesTable.tierId, loyaltyTierId));
  return rows.map((user) => ({ email: user.email, name: `${user.firstName} ${user.lastName}`.trim() }));
}

async function oauthProviderConfig(provider: OAuthProvider) {
  if (provider === "google") {
    const clientId = await integrationValue("google_oauth", "clientId", process.env["GOOGLE_CLIENT_ID"]);
    const clientSecret = await integrationValue("google_oauth", "clientSecret", process.env["GOOGLE_CLIENT_SECRET"]);
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }
  const clientId = await integrationValue("facebook_oauth", "clientId", process.env["FACEBOOK_APP_ID"]);
  const clientSecret = await integrationValue("facebook_oauth", "clientSecret", process.env["FACEBOOK_APP_SECRET"]);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function resolveOAuthProfile(provider: OAuthProvider, code: string, redirectUri: string, codeVerifier?: string | null): Promise<OAuthProfile> {
  const config = await oauthProviderConfig(provider);
  if (!config) throw new Error("OAuth provajder nije konfigurisan.");
  const tokenUrl = provider === "google" ? "https://oauth2.googleapis.com/token" : "https://graph.facebook.com/v20.0/oauth/access_token";
  const tokenBody = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    ...(provider === "google" && codeVerifier ? { code_verifier: codeVerifier } : {}),
  });
  const tokenResponse = await fetch(tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: tokenBody });
  if (!tokenResponse.ok) throw new Error("OAuth provajder je odbio prijavu.");
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) throw new Error("OAuth provajder nije vratio pristupni token.");
  if (provider === "google") {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${token.access_token}` } });
    const profile = await response.json() as { sub?: string; email?: string; email_verified?: boolean; given_name?: string; family_name?: string; name?: string };
    if (!response.ok || !profile.sub || !profile.email || !profile.email_verified) throw new Error("Google nije potvrdio e-mail adresu.");
    const names = (profile.name ?? "").trim().split(/\s+/);
    return { id: profile.sub, email: profile.email.toLowerCase(), firstName: profile.given_name ?? names[0] ?? "LUMERA", lastName: profile.family_name ?? (names.slice(1).join(" ") || "Korisnik") };
  }
  const response = await fetch(`https://graph.facebook.com/me?fields=id,email,first_name,last_name,name&access_token=${encodeURIComponent(token.access_token)}`);
  const profile = await response.json() as { id?: string; email?: string; first_name?: string; last_name?: string; name?: string };
  if (!response.ok || !profile.id || !profile.email) throw new Error("Facebook nalog nema dostupnu e-mail adresu.");
  const names = (profile.name ?? "").trim().split(/\s+/);
  return { id: profile.id, email: profile.email.toLowerCase(), firstName: profile.first_name ?? names[0] ?? "LUMERA", lastName: profile.last_name ?? (names.slice(1).join(" ") || "Korisnik") };
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
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function calendarDateCourseResponse<T extends { startDate?: Date | null }>(course: T) {
  return {
    ...course,
    startDate: course.startDate ? calendarDate(course.startDate) : null,
  };
}

function isHttpVideoUrl(value: string | null): boolean {
  if (value === null) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
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

function signInMethodsView(
  user: typeof usersTable.$inferSelect,
  identities: (typeof oauthIdentitiesTable.$inferSelect)[],
) {
  const identitiesByProvider = new Map<OAuthProvider, typeof oauthIdentitiesTable.$inferSelect>();
  for (const identity of identities) {
    if (!identitiesByProvider.has(identity.provider)) identitiesByProvider.set(identity.provider, identity);
  }

  const passwordAvailable = user.passwordSetAt !== null;
  const connectedProviders = (["google", "facebook"] as const).flatMap((provider) => {
    const identity = identitiesByProvider.get(provider);
    return identity ? [{ provider, email: identity.providerEmail, connectedAt: identity.createdAt }] : [];
  });
  const canDisconnect = passwordAvailable || connectedProviders.length > 1;

  return {
    passwordAvailable,
    providers: connectedProviders.map((identity) => ({ ...identity, canDisconnect })),
  };
}

async function signInMethods(user: typeof usersTable.$inferSelect) {
  const identities = await db.select().from(oauthIdentitiesTable)
    .where(eq(oauthIdentitiesTable.userId, user.id))
    .orderBy(asc(oauthIdentitiesTable.createdAt));
  return signInMethodsView(user, identities);
}

async function ownedSalon(userId: string) {
  const [owner] = await db.select({ activeSalonId: usersTable.activeSalonId }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const [salon] = owner?.activeSalonId
    ? await db.select().from(salonsTable).where(and(eq(salonsTable.ownerId, userId), eq(salonsTable.id, owner.activeSalonId))).limit(1)
    : await db.select().from(salonsTable).where(eq(salonsTable.ownerId, userId)).orderBy(asc(salonsTable.createdAt)).limit(1);
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

function appointmentEndTime(startTime: string, durationMinutes: number) {
  const [hours, minutes] = startTime.split(":").map(Number);
  const end = hours * 60 + minutes + durationMinutes;
  if (!Number.isFinite(end) || end > 24 * 60) return null;
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

function overlapsAppointment(startTime: string, endTime: string, appointment: typeof appointmentsTable.$inferSelect) {
  return appointment.status !== "cancelled" && appointment.startTime < endTime && appointment.endTime > startTime;
}

function mondayOf(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  const offset = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().slice(0, 10);
}

function employeeWorksAt(
  employeeId: string,
  date: string,
  startTime: string,
  endTime: string,
  schedules: (typeof employeeSchedulesTable.$inferSelect)[],
  timeOff: (typeof employeeTimeOffTable.$inferSelect)[],
) {
  if (timeOff.some((item) => item.employeeId === employeeId && item.startDate <= date && item.endDate >= date)) return false;
  const weekday = ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const daily = schedules.filter((item) => item.employeeId === employeeId && item.weekday === weekday);
  if (!daily.length) return true;
  return daily.some((item) => startTime >= item.startTime && endTime <= item.endTime
    && !(item.breakStart && item.breakEnd && startTime < item.breakEnd && endTime > item.breakStart));
}

async function eligibleEmployees(salonId: string, serviceId: string, preferredEmployeeId?: string | null) {
  const employees = await db.select().from(employeesTable).where(and(eq(employeesTable.salonId, salonId), eq(employeesTable.active, true)));
  const ids = employees.map((employee) => employee.id);
  const links = ids.length ? await db.select().from(employeeServicesTable).where(and(inArray(employeeServicesTable.employeeId, ids), eq(employeeServicesTable.serviceId, serviceId))) : [];
  const serviceEmployeeIds = new Set(links.map((item) => item.employeeId));
  return employees.filter((employee) => serviceEmployeeIds.has(employee.id) && (!preferredEmployeeId || employee.id === preferredEmployeeId));
}

type ReservedAppointment = {
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
};

async function availableEmployeeWithDb(
  store: any,
  salonId: string,
  serviceId: string,
  date: string,
  startTime: string,
  endTime: string,
  preferredEmployeeId?: string | null,
  reservedAppointments: ReservedAppointment[] = [],
  ignoredAppointmentIds: Set<string> = new Set(),
) {
  const employees = await store.select().from(employeesTable).where(and(eq(employeesTable.salonId, salonId), eq(employeesTable.active, true)));
  const ids = employees.map((employee: typeof employeesTable.$inferSelect) => employee.id);
  const links = ids.length ? await store.select().from(employeeServicesTable).where(and(inArray(employeeServicesTable.employeeId, ids), eq(employeeServicesTable.serviceId, serviceId))) : [];
  const candidateIds = new Set(links.map((item: typeof employeeServicesTable.$inferSelect) => item.employeeId));
  const candidates = employees.filter((employee: typeof employeesTable.$inferSelect) => candidateIds.has(employee.id) && (!preferredEmployeeId || employee.id === preferredEmployeeId));
  if (!candidates.length) return null;
  const weekStart = mondayOf(date);
  // `store` is often a transaction session. A pg client can execute only one
  // query at a time, so keep these reads sequential instead of queueing them
  // with Promise.all on the transaction's single connection.
  const sameDay = await store.select().from(appointmentsTable).where(and(
    eq(appointmentsTable.salonId, salonId),
    eq(appointmentsTable.date, date),
  ));
  const sameWeek = await store.select().from(appointmentsTable).where(and(
    eq(appointmentsTable.salonId, salonId),
    sql`${appointmentsTable.date} >= ${weekStart} and ${appointmentsTable.date} <= ${date}`,
  ));
  const schedules = await store.select().from(employeeSchedulesTable)
    .where(inArray(employeeSchedulesTable.employeeId, candidates.map((employee: typeof employeesTable.$inferSelect) => employee.id)));
  const timeOff = await store.select().from(employeeTimeOffTable)
    .where(inArray(employeeTimeOffTable.employeeId, candidates.map((employee: typeof employeesTable.$inferSelect) => employee.id)));
  const reservedSameDay = reservedAppointments.filter((appointment) => appointment.date === date);
  const reservedSameWeek = reservedAppointments.filter((appointment) => appointment.date >= weekStart && appointment.date <= date);
  const available = candidates.filter((employee: typeof employeesTable.$inferSelect) => employeeWorksAt(employee.id, date, startTime, endTime, schedules, timeOff)
    && !sameDay.some((appointment: typeof appointmentsTable.$inferSelect) => !ignoredAppointmentIds.has(appointment.id) && appointment.employeeId === employee.id && overlapsAppointment(startTime, endTime, appointment))
    && !reservedSameDay.some((appointment) => appointment.employeeId === employee.id && appointment.startTime < endTime && appointment.endTime > startTime));
  if (!available.length) return null;
  return [...available].sort((a, b) => {
    const dayA = sameDay.filter((appointment: typeof appointmentsTable.$inferSelect) => appointment.employeeId === a.id && appointment.status !== "cancelled").length
      + reservedSameDay.filter((appointment) => appointment.employeeId === a.id).length;
    const dayB = sameDay.filter((appointment: typeof appointmentsTable.$inferSelect) => appointment.employeeId === b.id && appointment.status !== "cancelled").length
      + reservedSameDay.filter((appointment) => appointment.employeeId === b.id).length;
    const weekA = sameWeek.filter((appointment: typeof appointmentsTable.$inferSelect) => appointment.employeeId === a.id && appointment.status !== "cancelled").length
      + reservedSameWeek.filter((appointment) => appointment.employeeId === a.id).length;
    const weekB = sameWeek.filter((appointment: typeof appointmentsTable.$inferSelect) => appointment.employeeId === b.id && appointment.status !== "cancelled").length
      + reservedSameWeek.filter((appointment) => appointment.employeeId === b.id).length;
    return dayA - dayB || weekA - weekB || a.name.localeCompare(b.name);
  })[0]!;
}

async function availableEmployee(
  salonId: string,
  serviceId: string,
  date: string,
  startTime: string,
  endTime: string,
  preferredEmployeeId?: string | null,
  reservedAppointments: ReservedAppointment[] = [],
) {
  return availableEmployeeWithDb(db, salonId, serviceId, date, startTime, endTime, preferredEmployeeId, reservedAppointments);
}

type FirstAvailableServiceSlot = {
  serviceId: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  employeeId: string | null;
  employeeName: string | null;
};

type FirstAvailableResponse = {
  generatedAt: string;
  horizonDays: number;
  services: FirstAvailableServiceSlot[];
};

const firstAvailableCache = new Map<string, { expiresAt: number; response: FirstAvailableResponse }>();
const firstAvailablePending = new Map<string, Promise<FirstAvailableResponse>>();

function dateAtOffset(startDate: Date, offset: number) {
  const date = new Date(startDate);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function firstAvailableByService(salonId: string): Promise<FirstAvailableResponse> {
  const cached = firstAvailableCache.get(salonId);
  if (cached && cached.expiresAt > Date.now()) return cached.response;
  const pending = firstAvailablePending.get(salonId);
  if (pending) return pending;

  const request = computeFirstAvailableByService(salonId);
  firstAvailablePending.set(salonId, request);
  try {
    const response = await request;
    firstAvailableCache.set(salonId, { response, expiresAt: Date.now() + 30_000 });
    return response;
  } finally {
    firstAvailablePending.delete(salonId);
  }
}

async function computeFirstAvailableByService(salonId: string): Promise<FirstAvailableResponse> {
  const [services, employees, appointments] = await Promise.all([
    db.select().from(servicesTable).where(and(eq(servicesTable.salonId, salonId), eq(servicesTable.active, true))),
    db.select().from(employeesTable).where(and(eq(employeesTable.salonId, salonId), eq(employeesTable.active, true))),
    db.select().from(appointmentsTable).where(eq(appointmentsTable.salonId, salonId)),
  ]);
  const employeeIds = employees.map((employee) => employee.id);
  const [relevantLinks, relevantSchedules, relevantTimeOff] = employeeIds.length
    ? await Promise.all([
      db.select().from(employeeServicesTable).where(inArray(employeeServicesTable.employeeId, employeeIds)),
      db.select().from(employeeSchedulesTable).where(inArray(employeeSchedulesTable.employeeId, employeeIds)),
      db.select().from(employeeTimeOffTable).where(inArray(employeeTimeOffTable.employeeId, employeeIds)),
    ])
    : [[], [], []];
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const currentTime = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  const horizonDays = 30;

  const servicesWithFirstSlot = services.map((service): FirstAvailableServiceSlot => {
    const candidateIds = new Set(
      relevantLinks.filter((link) => link.serviceId === service.id).map((link) => link.employeeId),
    );
    const candidates = employees.filter((employee) => candidateIds.has(employee.id));

    for (let dayOffset = 0; dayOffset < horizonDays; dayOffset += 1) {
      const date = dateAtOffset(now, dayOffset);
      const weekStart = mondayOf(date);
      const sameDay = appointments.filter((appointment) => appointment.date === date && appointment.status !== "cancelled");
      const sameWeek = appointments.filter((appointment) =>
        appointment.status !== "cancelled" && appointment.date >= weekStart && appointment.date <= date,
      );

      for (let hour = 9; hour < 18; hour += 1) {
        const startTime = `${String(hour).padStart(2, "0")}:00`;
        if (date === today && startTime <= currentTime) continue;
        const endTime = appointmentEndTime(startTime, service.durationMinutes);
        if (!endTime) continue;
        const available = candidates.filter((employee) =>
          employeeWorksAt(employee.id, date, startTime, endTime, relevantSchedules, relevantTimeOff)
          && !sameDay.some((appointment) => appointment.employeeId === employee.id
            && overlapsAppointment(startTime, endTime, appointment)),
        );
        if (!available.length) continue;
        const employee = [...available].sort((a, b) => {
          const dayA = sameDay.filter((appointment) => appointment.employeeId === a.id).length;
          const dayB = sameDay.filter((appointment) => appointment.employeeId === b.id).length;
          const weekA = sameWeek.filter((appointment) => appointment.employeeId === a.id).length;
          const weekB = sameWeek.filter((appointment) => appointment.employeeId === b.id).length;
          return dayA - dayB || weekA - weekB || a.name.localeCompare(b.name, "sr");
        })[0]!;
        return { serviceId: service.id, date, startTime, endTime, employeeId: employee.id, employeeName: employee.name };
      }
    }

    return { serviceId: service.id, date: null, startTime: null, endTime: null, employeeId: null, employeeName: null };
  });

  const response = {
    generatedAt: now.toISOString(),
    horizonDays,
    services: servicesWithFirstSlot,
  };
  return response;
}

async function createAllocatedAppointment(input: {
  salonId: string; customerId: string | null; salonCustomerId?: string | null; serviceId: string; date: string; startTime: string;
  endTime: string; durationMinutes: number; price: number; status: "pending" | "confirmed"; notes?: string | null; preferredEmployeeId?: string | null;
  treatmentLocation?: "salon" | "home"; travelFee?: number; treatmentAddress?: { line1: string; city: string; postalCode?: string; details?: string } | null;
}) {
  return db.transaction(async (tx) => {
    await lockAppointmentResources(tx, input.salonId, [{ date: input.date }]);
    const employee = await availableEmployeeWithDb(tx, input.salonId, input.serviceId, input.date, input.startTime, input.endTime, input.preferredEmployeeId);
    if (!employee) return { employee: null, appointment: null };
    await lockAppointmentResources(tx, input.salonId, [{ date: input.date, employeeId: employee.id }]);
    const [appointment] = await tx.insert(appointmentsTable).values({
      salonId: input.salonId, customerId: input.customerId, salonCustomerId: input.salonCustomerId ?? null, employeeId: employee.id, serviceId: input.serviceId,
      date: input.date, startTime: input.startTime, endTime: input.endTime, durationMinutes: input.durationMinutes, price: input.price, status: input.status, notes: input.notes ?? null,
      treatmentLocation: input.treatmentLocation ?? "salon", travelFee: input.travelFee ?? 0,
      treatmentAddressLine1: input.treatmentAddress?.line1 ?? null, treatmentAddressCity: input.treatmentAddress?.city ?? null,
      treatmentAddressPostalCode: input.treatmentAddress?.postalCode ?? null, treatmentAddressDetails: input.treatmentAddress?.details ?? null,
    }).returning();
    return { employee, appointment: appointment! };
  });
}

type PreparedSeriesSlot = { date: string; startTime: string; endTime: string };

function prepareSeriesSlots(
  slots: Array<{ date: string | Date; startTime: string }>,
  durationMinutes: number,
): PreparedSeriesSlot[] {
  const today = new Date().toISOString().slice(0, 10);
  const prepared = slots.map((slot) => {
    const date = calendarDate(slot.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(slot.startTime) || date < today) {
      throw new AppointmentSeriesError("Svaki termin mora imati važeći današnji ili budući datum i vreme.", 400);
    }
    const endTime = appointmentEndTime(slot.startTime, durationMinutes);
    if (!endTime) throw new AppointmentSeriesError("Trajanje termina izlazi van dana.", 400);
    return { date, startTime: slot.startTime, endTime };
  });
  const unique = new Set(prepared.map((slot) => `${slot.date}:${slot.startTime}`));
  if (unique.size !== prepared.length) throw new AppointmentSeriesError("Serija ne može sadržati isti termin više puta.", 400);
  const ordered = prepared.sort((a, b) => `${a.date}:${a.startTime}`.localeCompare(`${b.date}:${b.startTime}`));
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    for (const previous of ordered.slice(0, index)) {
      if (previous.date !== current.date) continue;
      if (previous.startTime < current.endTime && previous.endTime > current.startTime) {
        throw new AppointmentSeriesError("Termini u istoj seriji ne mogu se preklapati.", 400);
      }
    }
  }
  return ordered;
}

async function previewSeriesSlots(
  salonId: string,
  serviceId: string,
  slots: PreparedSeriesSlot[],
  preferredEmployeeId?: string | null,
) {
  const result: Array<{ date: string; startTime: string; available: boolean; reason: string | null }> = [];
  const reservedAppointments: ReservedAppointment[] = [];
  for (const slot of slots) {
    const employee = await availableEmployee(salonId, serviceId, slot.date, slot.startTime, slot.endTime, preferredEmployeeId, reservedAppointments);
    result.push({
      date: slot.date,
      startTime: slot.startTime,
      available: Boolean(employee),
      reason: employee ? null : "Nema slobodnog zaposlenog ili termin izlazi van radnog vremena.",
    });
    if (employee) {
      reservedAppointments.push({ employeeId: employee.id, date: slot.date, startTime: slot.startTime, endTime: slot.endTime });
    }
  }
  return { slots: result, allAvailable: result.every((slot) => slot.available) };
}

async function createAppointmentSeries(input: {
  salonId: string;
  customerId: string | null;
  salonCustomerId: string;
  service: typeof servicesTable.$inferSelect;
  slots: PreparedSeriesSlot[];
  createdByUserId: string;
  notes?: string | null;
  preferredEmployeeId?: string | null;
}) {
  return db.transaction(async (tx) => {
    await lockAppointmentResources(tx, input.salonId, input.slots);
    const allocations: Array<{ slot: PreparedSeriesSlot; employee: typeof employeesTable.$inferSelect }> = [];
    const reservedAppointments: ReservedAppointment[] = [];
    for (const slot of input.slots) {
      const employee = await availableEmployeeWithDb(
        tx,
        input.salonId,
        input.service.id,
        slot.date,
        slot.startTime,
        slot.endTime,
        input.preferredEmployeeId,
        reservedAppointments,
      );
      if (!employee) throw new AppointmentSeriesError(`Termin ${slot.date} u ${slot.startTime} više nije slobodan.`);
      allocations.push({ slot, employee });
      reservedAppointments.push({ employeeId: employee.id, date: slot.date, startTime: slot.startTime, endTime: slot.endTime });
    }
    await lockAppointmentResources(tx, input.salonId, allocations.map(({ slot, employee }) => ({
      date: slot.date,
      employeeId: employee.id,
    })));
    const [series] = await tx.insert(appointmentSeriesTable).values({
      salonId: input.salonId,
      salonCustomerId: input.salonCustomerId,
      serviceId: input.service.id,
      employeeId: input.preferredEmployeeId ?? null,
      totalAppointments: input.slots.length,
      createdByUserId: input.createdByUserId,
    }).returning();
    const appointments: (typeof appointmentsTable.$inferSelect)[] = [];
    for (const { slot, employee } of allocations) {
      const [appointment] = await tx.insert(appointmentsTable).values({
        salonId: input.salonId,
        customerId: input.customerId,
        salonCustomerId: input.salonCustomerId,
        employeeId: employee.id,
        serviceId: input.service.id,
        seriesId: series!.id,
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        durationMinutes: input.service.durationMinutes,
        price: input.service.promoPrice ?? input.service.price,
        status: "confirmed",
        notes: input.notes ?? null,
      }).returning();
      appointments.push(appointment!);
    }
    return { series: series!, appointments };
  });
}

type SeriesMoveSlot = {
  appointment: typeof appointmentsTable.$inferSelect;
  date: string;
  startTime: string;
  endTime: string;
};

function futureUnfinishedSeriesAppointments(appointments: (typeof appointmentsTable.$inferSelect)[]) {
  const today = new Date().toISOString().slice(0, 10);
  return appointments
    .filter((appointment) => appointment.date >= today && ["pending", "confirmed"].includes(appointment.status))
    .sort((a, b) => `${a.date}:${a.startTime}`.localeCompare(`${b.date}:${b.startTime}`));
}

function shiftCalendarDate(date: string, dayOffset: number) {
  const result = new Date(`${date}T12:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + dayOffset);
  return result.toISOString().slice(0, 10);
}

function prepareSeriesMoveSlots(
  appointments: (typeof appointmentsTable.$inferSelect)[],
  input: { dayOffset?: number; startTime?: string },
) {
  const dayOffset = input.dayOffset ?? 0;
  if (dayOffset === 0 && !input.startTime) {
    throw new AppointmentSeriesError("Unesite broj dana za pomeranje ili novo vreme termina.", 400);
  }
  const today = new Date().toISOString().slice(0, 10);
  const slots = appointments.map((appointment) => {
    const date = shiftCalendarDate(appointment.date, dayOffset);
    const startTime = input.startTime ?? appointment.startTime;
    const endTime = appointmentEndTime(startTime, appointment.durationMinutes);
    if (date < today || !endTime) {
      throw new AppointmentSeriesError("Novo vreme svakog termina mora biti danas ili u budućnosti i završiti se istog dana.", 400);
    }
    return { appointment, date, startTime, endTime };
  });
  if (!slots.some((slot) => slot.date !== slot.appointment.date || slot.startTime !== slot.appointment.startTime)) {
    throw new AppointmentSeriesError("Novo vreme je isto kao postojeće; unesite stvarnu promenu.", 400);
  }
  return slots;
}

async function previewSeriesMove(
  store: any,
  salonId: string,
  slots: SeriesMoveSlot[],
) {
  const ignoredAppointmentIds = new Set(slots.map((slot) => slot.appointment.id));
  const reservedAppointments: ReservedAppointment[] = [];
  const result: Array<{
    appointmentId: string;
    currentDate: string;
    currentStartTime: string;
    date: string;
    startTime: string;
    endTime: string;
    available: boolean;
    reason: string | null;
  }> = [];
  for (const slot of slots) {
    const employee = await availableEmployeeWithDb(
      store,
      salonId,
      slot.appointment.serviceId,
      slot.date,
      slot.startTime,
      slot.endTime,
      slot.appointment.employeeId,
      reservedAppointments,
      ignoredAppointmentIds,
    );
    result.push({
      appointmentId: slot.appointment.id,
      currentDate: slot.appointment.date,
      currentStartTime: slot.appointment.startTime,
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      available: Boolean(employee),
      reason: employee ? null : "Zaposleni nije slobodan u novom terminu ili tada ne radi.",
    });
    if (employee) {
      reservedAppointments.push({ employeeId: employee.id, date: slot.date, startTime: slot.startTime, endTime: slot.endTime });
    }
  }
  return { slots: result, allAvailable: result.every((slot) => slot.available) };
}

export async function moveAppointmentSeries(input: {
  salonId: string;
  seriesId: string;
  move: { dayOffset?: number; startTime?: string };
  contact: typeof salonCustomersTable.$inferSelect | null;
  salon: typeof salonsTable.$inferSelect;
  moveEventId: string;
}) {
  return db.transaction(async (tx) => {
    await lockAppointmentResources(tx, input.salonId);
    const initial = futureUnfinishedSeriesAppointments(await tx.select().from(appointmentsTable).where(and(
      eq(appointmentsTable.salonId, input.salonId),
      eq(appointmentsTable.seriesId, input.seriesId),
    )).for("update"));
    if (!initial.length) throw new AppointmentSeriesError("U ovoj seriji nema budućih nezavršenih termina za pomeranje.", 409);
    const initialSlots = prepareSeriesMoveSlots(initial, input.move);
    const lockDates = [...new Set([
      ...initial.map((appointment) => appointment.date),
      ...initialSlots.map((slot) => slot.date),
    ])].sort();
    await lockAppointmentResources(tx, input.salonId, lockDates.map((date) => ({ date })));

    const appointments = futureUnfinishedSeriesAppointments(await tx.select().from(appointmentsTable).where(and(
      eq(appointmentsTable.salonId, input.salonId),
      eq(appointmentsTable.seriesId, input.seriesId),
    )).for("update"));
    if (!appointments.length) throw new AppointmentSeriesError("U ovoj seriji više nema budućih nezavršenih termina za pomeranje.", 409);
    const slots = prepareSeriesMoveSlots(appointments, input.move);
    const ignoredAppointmentIds = new Set(slots.map((slot) => slot.appointment.id));
    const reservedAppointments: ReservedAppointment[] = [];
    const allocations: Array<{ slot: SeriesMoveSlot; employee: typeof employeesTable.$inferSelect }> = [];
    for (const slot of slots) {
      const employee = await availableEmployeeWithDb(
        tx,
        input.salonId,
        slot.appointment.serviceId,
        slot.date,
        slot.startTime,
        slot.endTime,
        slot.appointment.employeeId,
        reservedAppointments,
        ignoredAppointmentIds,
      );
      if (!employee) throw new AppointmentSeriesError(`Termin ${slot.date} u ${slot.startTime} više nije slobodan.`);
      allocations.push({ slot, employee });
      reservedAppointments.push({ employeeId: employee.id, date: slot.date, startTime: slot.startTime, endTime: slot.endTime });
    }
    await lockAppointmentResources(tx, input.salonId, allocations.map(({ slot, employee }) => ({
      date: slot.date,
      employeeId: employee.id,
    })));
    const moved: (typeof appointmentsTable.$inferSelect)[] = [];
    for (const { slot, employee } of allocations) {
      const [appointment] = await tx.update(appointmentsTable).set({
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        employeeId: employee.id,
      }).where(and(
        eq(appointmentsTable.id, slot.appointment.id),
        inArray(appointmentsTable.status, ["pending", "confirmed"]),
      )).returning();
      if (!appointment) throw new AppointmentSeriesError("Jedan od termina serije je u međuvremenu promenjen. Ponovo pregledajte konflikte.");
      moved.push(appointment!);
    }
    if (input.contact?.email) {
      await tx.insert(emailDeliveriesTable).values(moved.map((appointment) => ({
        eventKey: `appointment-rescheduled:${input.moveEventId}:${appointment.id}:email`,
        emailType: "appointment_rescheduled",
        salonId: input.salonId,
        appointmentId: appointment.id,
        recipientEmail: input.contact!.email!.toLowerCase(),
        recipientName: `${input.contact!.firstName} ${input.contact!.lastName}`.trim() || "LUMERA klijent",
        subject: "LUMERA — termin je pomeren",
        htmlContent: lumeraEmailHtml("Termin je pomeren", `<p>Vaš termin u salonu <b>${emailSafe(input.salon.name)}</b> je pomeren na <b>${appointment.date} u ${appointment.startTime}</b>.</p>`),
        nextRetryAt: new Date(),
        metadata: { appointmentId: appointment.id, salonId: input.salonId, moveEventId: input.moveEventId },
      })));
    }
    return moved;
  });
}

async function sendSeriesConfirmations(input: {
  appointments: (typeof appointmentsTable.$inferSelect)[];
  contact: typeof salonCustomersTable.$inferSelect;
  salon: typeof salonsTable.$inferSelect;
}) {
  for (const appointment of input.appointments) {
    await sendSms({
      eventKey: `appointment-confirmation:${appointment.id}`, salonId: input.salon.id, appointmentId: appointment.id,
      type: "appointment_confirmation", phone: input.contact.phone, smsOptOut: input.contact.smsOptOut,
      text: `LUMERA: termin u salonu ${input.salon.name} je zakazan za ${appointment.date} u ${appointment.startTime}.`,
    });
    if (input.contact.email) {
      await sendTransactionalEmail({
        eventKey: `appointment-confirmation:${appointment.id}:email`,
        emailType: "appointment_confirmation",
        to: { email: input.contact.email, name: `${input.contact.firstName} ${input.contact.lastName}`.trim() || "LUMERA klijent" },
        subject: "LUMERA — potvrda termina",
        htmlContent: lumeraEmailHtml("Termin je zakazan", `<p>Vaš termin u salonu <b>${emailSafe(input.salon.name)}</b> je zakazan za <b>${appointment.date} u ${appointment.startTime}</b>.</p>`),
      });
    }
  }
}

async function sendSeriesUpdates(input: {
  appointments: (typeof appointmentsTable.$inferSelect)[];
  contact: typeof salonCustomersTable.$inferSelect;
  salon: typeof salonsTable.$inferSelect;
  moveEventId: string;
}) {
  for (const appointment of input.appointments) {
    await sendSms({
      eventKey: `appointment-rescheduled:${input.moveEventId}:${appointment.id}`,
      salonId: input.salon.id,
      appointmentId: appointment.id,
      type: "appointment_confirmation",
      phone: input.contact.phone,
      smsOptOut: input.contact.smsOptOut,
      text: `LUMERA: termin u salonu ${input.salon.name} je pomeren na ${appointment.date} u ${appointment.startTime}.`,
    });
  }
}

function normalizedPhone(phone: string) {
  const digits = phone.replace(/[^\d]/g, "").replace(/^00/, "");
  if (!digits) return "";
  // Serbian local numbers become the same stored form as +381 numbers.
  return digits.startsWith("0") ? `381${digits.slice(1)}` : digits;
}

async function linkPhoneContactsToUser(store: any, userId: string, phone: string) {
  const phoneNormalized = normalizedPhone(phone);
  if (!phoneNormalized) return;
  const contacts = (await store.select().from(salonCustomersTable)).filter((contact: typeof salonCustomersTable.$inferSelect) =>
    contact.phoneNormalized === phoneNormalized || (!!contact.phone && normalizedPhone(contact.phone) === phoneNormalized));
  for (const salonId of [...new Set(contacts.map((contact: typeof salonCustomersTable.$inferSelect) => contact.salonId))]) {
    const group = contacts.filter((contact: typeof salonCustomersTable.$inferSelect) => contact.salonId === salonId);
    const canonical = group[0]!;
    const duplicateIds = group.slice(1).map((contact: typeof salonCustomersTable.$inferSelect) => contact.id);
    if (duplicateIds.length) {
      await store.update(appointmentsTable).set({ salonCustomerId: canonical.id, customerId: userId }).where(inArray(appointmentsTable.salonCustomerId, duplicateIds));
      await store.delete(salonCustomersTable).where(inArray(salonCustomersTable.id, duplicateIds));
    }
    await store.update(salonCustomersTable).set({ userId, phoneNormalized, updatedAt: new Date() }).where(eq(salonCustomersTable.id, canonical.id));
    await store.update(appointmentsTable).set({ customerId: userId }).where(eq(appointmentsTable.salonCustomerId, canonical.id));
  }
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

function temporaryPassword() {
  return `Lm!${randomBytes(9).toString("base64url")}7`;
}

class EmployeeBookingError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

class AppointmentSeriesError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

type SalonEmployeeAccess = {
  user: typeof usersTable.$inferSelect;
  employee: typeof employeesTable.$inferSelect;
  salon: typeof salonsTable.$inferSelect;
};

async function requireSalonEmployee(req: Request, res: Response): Promise<SalonEmployeeAccess | null> {
  const user = await current(req, res);
  if (!user) return null;
  if (user.role !== "SALON_EMPLOYEE") {
    res.status(403).json({ error: "Ova funkcija je dostupna samo zaposlenima salona." });
    return null;
  }
  if (user.mustChangePassword) {
    res.status(428).json({ error: "Promenite privremenu lozinku pre pristupa portalu.", code: "PASSWORD_CHANGE_REQUIRED" });
    return null;
  }
  const [employee] = await db.select().from(employeesTable)
    .where(and(eq(employeesTable.userId, user.id), eq(employeesTable.active, true))).limit(1);
  if (!employee) {
    res.status(403).json({ error: "Nalog zaposlenog nije povezan sa aktivnim profilom." });
    return null;
  }
  const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.id, employee.salonId)).limit(1);
  if (!salon) {
    res.status(403).json({ error: "Profil zaposlenog nije povezan sa salonom." });
    return null;
  }
  return { user, employee, salon };
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
    homeService: services.some((service) => service.active && service.homeServiceAvailable),
    featured: salon.featured,
    isVerified: salon.isVerified,
    topSalon: salon.topSalon,
    acceptsCards: salon.acceptsCards,
    instantBooking: salon.instantBooking,
    servesMen: salon.servesMen,
    hasDiscount: services.some((item) => item.promoPrice !== null && item.promoPrice < item.price),
    openSunday: hours.some((item) => item.weekday === 7 && !item.closed),
    lastBookedAt: lastBookedAt?.toISOString() ?? null,
    createdAt: salon.createdAt.toISOString(),
    latitude: salon.latitude,
    longitude: salon.longitude,
  };
}

async function salonHasActiveHomeService(salonId: string): Promise<boolean> {
  const [service] = await db.select({ id: servicesTable.id }).from(servicesTable).where(and(
    eq(servicesTable.salonId, salonId),
    eq(servicesTable.active, true),
    eq(servicesTable.homeServiceAvailable, true),
  )).limit(1);
  return Boolean(service);
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
    db.select().from(servicesTable).where(and(inArray(servicesTable.salonId, ids), eq(servicesTable.active, true))),
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

type MarketplaceHomeDiscoveryPayload = ReturnType<typeof GetMarketplaceHomeDiscoveryResponse.parse>;
const marketplaceHomeDiscoveryCache = new Map<string, { expiresAt: number; payload: MarketplaceHomeDiscoveryPayload }>();
const DEFAULT_CATEGORY_CARD_IMAGE = "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1200&q=85";
const DEFAULT_POPULAR_CATEGORY_ORDER = [
  "Frizerski saloni",
  "Muški frizeri",
  "Kozmetički saloni",
  "Depilacija",
  "Lice",
  "Masaža",
  "Nokti",
  "Telo",
  "Wellness",
  "Lux tretmani",
  "Paketi usluga",
  "Ordinacije i poliklinike",
];
const CATEGORY_IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function isRealSalonGalleryImage(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  if (!normalized || normalized.includes("placeholder") || normalized.startsWith("/lumera-media/")) return false;
  return /^https?:\/\//.test(normalized) || normalized.startsWith("/api/storage/objects/");
}

function categoryImageProxyUrl(imageId: string): string {
  return `/api/category-images/${imageId}`;
}

function categoryImageObjectPath(imageId: string): string {
  const root = process.env.PRIVATE_OBJECT_DIR;
  if (!root) throw new Error("App Storage nije podešen.");
  return `${root.replace(/\/+$/, "")}/category-images/${imageId}`;
}

async function signCategoryImageObject(imageId: string, method: "GET" | "PUT", ttlSeconds: number): Promise<string> {
  const path = categoryImageObjectPath(imageId);
  const [, bucketName, ...objectParts] = path.startsWith("/") ? path.split("/") : `/${path}`.split("/");
  const response = await fetch("http://127.0.0.1:1106/object-storage/signed-object-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectParts.join("/"),
      method,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`App Storage nije generisao URL (${response.status}).`);
  const data = await response.json() as { signed_url?: string };
  if (!data.signed_url) throw new Error("App Storage nije vratio potpisani URL.");
  return data.signed_url;
}

function appointmentView(
  appointment: typeof appointmentsTable.$inferSelect,
  salon: typeof salonsTable.$inferSelect,
  service: typeof servicesTable.$inferSelect,
  customer: Pick<typeof usersTable.$inferSelect, "firstName" | "lastName"> | Pick<typeof salonCustomersTable.$inferSelect, "firstName" | "lastName">,
  employee: typeof employeesTable.$inferSelect | undefined,
  includeTreatmentAddress = false,
  rescheduledConfirmation: {
    sms: { status: typeof smsDeliveriesTable.$inferSelect["status"]; nextRetryAt: Date | null } | null;
    email: { status: typeof emailDeliveriesTable.$inferSelect["status"]; nextRetryAt: Date | null } | null;
  } | null = null,
) {
  return {
    id: appointment.id,
    salonId: salon.id,
    salonSlug: salon.slug,
    salonName: salon.name,
    serviceId: service.id,
    customerName: `${customer.firstName} ${customer.lastName}`,
    serviceName: service.name,
    employeeId: employee?.id ?? null,
    employeeName: employee?.name ?? "Bilo koji dostupan",
    date: calendarDate(appointment.date),
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    durationMinutes: appointment.durationMinutes,
    price: appointment.price,
    treatmentLocation: appointment.treatmentLocation as "salon" | "home",
    travelFee: appointment.travelFee,
    treatmentAddress: includeTreatmentAddress && appointment.treatmentLocation === "home" && appointment.treatmentAddressLine1 && appointment.treatmentAddressCity
      ? { line1: appointment.treatmentAddressLine1, city: appointment.treatmentAddressCity, postalCode: appointment.treatmentAddressPostalCode, details: appointment.treatmentAddressDetails }
      : null,
    seriesId: appointment.seriesId,
    status: appointment.status,
    notes: appointment.notes,
    rescheduledConfirmation,
  };
}

async function appointmentList(where?: ReturnType<typeof eq>, includeTreatmentAddress = false) {
  const appointments = await db.select().from(appointmentsTable).where(where).orderBy(asc(appointmentsTable.date), asc(appointmentsTable.startTime));
  if (!appointments.length) return [];
  const salonIds = [...new Set(appointments.map((item) => item.salonId))];
  const serviceIds = [...new Set(appointments.map((item) => item.serviceId))];
  const customerIds = [...new Set(appointments.flatMap((item) => item.customerId ? [item.customerId] : []))];
  const salonCustomerIds = [...new Set(appointments.flatMap((item) => item.salonCustomerId ? [item.salonCustomerId] : []))];
  const employeeIds = appointments.flatMap((item) => item.employeeId ? [item.employeeId] : []);
  const appointmentIds = appointments.map((item) => item.id);
  const [salons, services, customers, salonCustomers, employees, smsDeliveries, emailDeliveries] = await Promise.all([
    db.select().from(salonsTable).where(inArray(salonsTable.id, salonIds)),
    db.select().from(servicesTable).where(inArray(servicesTable.id, serviceIds)),
    customerIds.length ? db.select().from(usersTable).where(inArray(usersTable.id, customerIds)) : Promise.resolve([] as (typeof usersTable.$inferSelect)[]),
    salonCustomerIds.length ? db.select().from(salonCustomersTable).where(inArray(salonCustomersTable.id, salonCustomerIds)) : Promise.resolve([] as (typeof salonCustomersTable.$inferSelect)[]),
    employeeIds.length ? db.select().from(employeesTable).where(inArray(employeesTable.id, employeeIds)) : Promise.resolve([]),
    db.select().from(smsDeliveriesTable).where(inArray(smsDeliveriesTable.appointmentId, appointmentIds)),
    db.select().from(emailDeliveriesTable).where(and(
      inArray(emailDeliveriesTable.appointmentId, appointmentIds),
      eq(emailDeliveriesTable.emailType, "appointment_rescheduled"),
    )),
  ]);
  const latestByAppointment = <T extends { appointmentId: string | null; createdAt: Date }>(deliveries: T[]) => {
    const latest = new Map<string, T>();
    for (const delivery of deliveries) {
      if (!delivery.appointmentId) continue;
      const previous = latest.get(delivery.appointmentId);
      if (!previous || previous.createdAt < delivery.createdAt) latest.set(delivery.appointmentId, delivery);
    }
    return latest;
  };
  const rescheduledSms = latestByAppointment(smsDeliveries.filter((delivery) => delivery.eventKey.startsWith("appointment-rescheduled:")));
  const rescheduledEmails = latestByAppointment(emailDeliveries);
  return appointments.map((item) => appointmentView(
    item,
    salons.find((salon) => salon.id === item.salonId)!,
    services.find((service) => service.id === item.serviceId)!,
    customers.find((customer) => customer.id === item.customerId) ?? salonCustomers.find((customer) => customer.id === item.salonCustomerId) ?? { firstName: "Gost", lastName: "" },
    (employees as (typeof employeesTable.$inferSelect)[]).find((employee) => employee.id === item.employeeId),
    includeTreatmentAddress,
    (() => {
      const sms = rescheduledSms.get(item.id);
      const email = rescheduledEmails.get(item.id);
      return sms || email
        ? {
            sms: sms ? { status: sms.status, nextRetryAt: sms.nextRetryAt } : null,
            email: email ? { status: email.status, nextRetryAt: email.nextRetryAt } : null,
          }
        : null;
    })(),
  ));
}

router.post("/auth/phone-verification/request", async (req, res): Promise<void> => {
  const phone = typeof req.body?.phone === "string" ? req.body.phone : "";
  const phoneNormalized = normalizedPhone(phone);
  if (!/^3816\d{7,8}$/.test(phoneNormalized)) { res.status(400).json({ error: "Unesite važeći mobilni broj u Srbiji." }); return; }
  const requestIp = req.ip || req.socket.remoteAddress || "unknown";
  const now = new Date();
  const [existingCode] = await db.select().from(phoneVerificationCodesTable).where(eq(phoneVerificationCodesTable.phoneNormalized, phoneNormalized)).limit(1);
  if (existingCode && now.getTime() - existingCode.lastRequestedAt.getTime() < 60_000) { res.status(429).json({ error: "Sačekajte minut pre slanja novog koda." }); return; }
  const ipRequests = (await db.select().from(phoneVerificationCodesTable)).filter((item) => item.lastRequestIp === requestIp && now.getTime() - item.lastRequestedAt.getTime() < 10 * 60_000).reduce((sum, item) => sum + item.requestCount, 0);
  if (ipRequests >= 5) { res.status(429).json({ error: "Previše zahteva sa ove mreže. Pokušajte kasnije." }); return; }
  if (existingCode && existingCode.attempts >= 5 && existingCode.expiresAt > now) { res.status(429).json({ error: "Previše neuspešnih pokušaja. Zatražite novi kod nakon isteka postojećeg." }); return; }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expired = !existingCode || existingCode.expiresAt <= now;
  await db.insert(phoneVerificationCodesTable).values({ phoneNormalized, codeHash: createHash("sha256").update(code).digest("hex"), expiresAt: new Date(Date.now() + 10 * 60 * 1000), requestCount: 1, lastRequestedAt: now, lastRequestIp: requestIp })
    .onConflictDoUpdate({ target: phoneVerificationCodesTable.phoneNormalized, set: { codeHash: createHash("sha256").update(code).digest("hex"), expiresAt: new Date(Date.now() + 10 * 60 * 1000), attempts: expired ? 0 : existingCode!.attempts, requestCount: expired ? 1 : existingCode!.requestCount + 1, lastRequestedAt: now, lastRequestIp: requestIp } });
  const sent = await sendPhoneVerificationCode(phone, code);
  res.json({ message: sent ? "Kod je poslat SMS porukom." : "Kod je spreman za lokalnu proveru.", ...(process.env.NODE_ENV === "production" ? {} : { developmentCode: code }) });
});

router.post("/auth/phone-verification/confirm", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res);
  if (!user) return;
  const phone = typeof req.body?.phone === "string" ? req.body.phone : "";
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  const phoneNormalized = normalizedPhone(phone);
  const [verification] = await db.select().from(phoneVerificationCodesTable).where(eq(phoneVerificationCodesTable.phoneNormalized, phoneNormalized)).limit(1);
  if (!/^3816\d{7,8}$/.test(phoneNormalized) || !verification || verification.expiresAt < new Date() || verification.attempts >= 5 || verification.codeHash !== createHash("sha256").update(code).digest("hex")) {
    if (verification) await db.update(phoneVerificationCodesTable).set({ attempts: verification.attempts + 1 }).where(eq(phoneVerificationCodesTable.id, verification.id));
    res.status(400).json({ error: "Kod za potvrdu broja nije ispravan ili je istekao." }); return;
  }
  try {
    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ phone, phoneNormalized, updatedAt: new Date() }).where(eq(usersTable.id, user.id));
      await linkPhoneContactsToUser(tx, user.id, phone);
      await tx.delete(phoneVerificationCodesTable).where(eq(phoneVerificationCodesTable.id, verification.id));
    });
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: "Ovaj broj je već povezan sa drugim nalogom." });
  }
});

router.post("/auth/register", async (req, res): Promise<void> => {
  await ensureDemoData();
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, parsed.data.email.toLowerCase())).limit(1);
  if (existing) { res.status(409).json({ error: "Nalog sa ovom e-mail adresom već postoji." }); return; }
  const phoneNormalized = parsed.data.phone ? normalizedPhone(parsed.data.phone) : null;
  const verificationCode = typeof req.body?.phoneVerificationCode === "string" ? req.body.phoneVerificationCode : "";
  if (!phoneNormalized || !verificationCode) { res.status(400).json({ error: "Potvrdite broj telefona pre registracije." }); return; }
  const [verification] = await db.select().from(phoneVerificationCodesTable).where(eq(phoneVerificationCodesTable.phoneNormalized, phoneNormalized)).limit(1);
  if (!verification || verification.expiresAt < new Date() || verification.attempts >= 5 || verification.codeHash !== createHash("sha256").update(verificationCode).digest("hex")) {
    if (verification) await db.update(phoneVerificationCodesTable).set({ attempts: verification.attempts + 1 }).where(eq(phoneVerificationCodesTable.id, verification.id));
    res.status(400).json({ error: "Kod za potvrdu broja nije ispravan ili je istekao." }); return;
  }
  if (phoneNormalized) {
    const [phoneOwner] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phoneNormalized, phoneNormalized)).limit(1);
    if (phoneOwner) { res.status(409).json({ error: "Broj telefona je već povezan sa drugim nalogom." }); return; }
  }
  const [user] = await db.insert(usersTable).values({
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    email: parsed.data.email.toLowerCase(),
    phone: parsed.data.phone ?? null, phoneNormalized,
    passwordHash: await hashPassword(parsed.data.password),
    passwordSetAt: new Date(),
    role: "CUSTOMER",
  }).returning();
  await db.delete(phoneVerificationCodesTable).where(eq(phoneVerificationCodesTable.id, verification.id));
  const verifiedPhone = user!.phone;
  if (verifiedPhone) await db.transaction((tx) => linkPhoneContactsToUser(tx, user!.id, verifiedPhone));
  const token = await createSession(user!.id);
  res.cookie(sessionCookieName, token, cookieOptions());
  res.status(201).json(RegisterResponse.parse({ user: publicUser(user!), message: "Dobro došli u Lumeru." }));
});

router.get("/auth/oauth/:provider/start", async (req, res): Promise<void> => {
  const provider = req.params.provider;
  const flow = req.query.flow === "business" ? "business" : "customer";
  if (provider !== "google" && provider !== "facebook") { res.status(404).json({ error: "Nepoznat OAuth provajder." }); return; }
  const oauthConfig = await oauthProviderConfig(provider);
  if (!oauthConfig) { res.redirect(oauthFailurePath(flow, "OAuth prijava trenutno nije podešena.")); return; }
  const redirectUri = oauthRedirect(req, provider);
  if (!redirectUri) { res.redirect(oauthFailurePath(flow, "OAuth prijava zahteva bezbedan APP_BASE_URL u produkciji.")); return; }
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = provider === "google" ? randomBytes(48).toString("base64url") : null;
  await db.insert(oauthLoginStatesTable).values({ state, provider, flow, codeVerifier, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60 * 1000,
    path: "/api/auth/oauth",
  });
  const url = new URL(provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://www.facebook.com/v20.0/dialog/oauth");
  url.searchParams.set("client_id", oauthConfig.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  if (provider === "google") {
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("code_challenge", createHash("sha256").update(codeVerifier!).digest("base64url"));
    url.searchParams.set("code_challenge_method", "S256");
  } else {
    url.searchParams.set("scope", "email,public_profile");
  }
  res.redirect(url.toString());
});

router.get("/auth/oauth/:provider/callback", async (req, res): Promise<void> => {
  const provider = req.params.provider;
  if (provider !== "google" && provider !== "facebook") { res.status(404).json({ error: "Nepoznat OAuth provajder." }); return; }
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const browserState = req.cookies?.[OAUTH_STATE_COOKIE];
  res.clearCookie(OAUTH_STATE_COOKIE, { path: "/api/auth/oauth" });
  if (typeof browserState !== "string" || browserState !== state) {
    res.redirect(oauthFailurePath("customer", "Prijava nije povezana sa ovim browserom. Pokušajte ponovo."));
    return;
  }
  const [loginState] = await db.select().from(oauthLoginStatesTable).where(and(eq(oauthLoginStatesTable.state, state), eq(oauthLoginStatesTable.provider, provider))).limit(1);
  if (!loginState || loginState.expiresAt <= new Date()) { res.redirect(oauthFailurePath(loginState?.flow ?? "customer", "Prijava je istekla. Pokušajte ponovo.")); return; }
  await db.delete(oauthLoginStatesTable).where(eq(oauthLoginStatesTable.id, loginState.id));
  if (typeof req.query.error === "string" || typeof req.query.code !== "string") { res.redirect(oauthFailurePath(loginState.flow, "Prijava je otkazana ili nije odobrena.")); return; }
  try {
    const redirectUri = oauthRedirect(req, provider);
    if (!redirectUri) { res.redirect(oauthFailurePath(loginState.flow, "OAuth prijava zahteva bezbedan APP_BASE_URL u produkciji.")); return; }
    const profile = await resolveOAuthProfile(provider, req.query.code, redirectUri, loginState.codeVerifier);
    const user = await db.transaction(async (tx) => {
      const [identity] = await tx.select().from(oauthIdentitiesTable).where(and(eq(oauthIdentitiesTable.provider, provider), eq(oauthIdentitiesTable.providerAccountId, profile.id))).limit(1);
      if (identity) {
        const [existingByIdentity] = await tx.select().from(usersTable).where(eq(usersTable.id, identity.userId)).limit(1);
        if (existingByIdentity) return existingByIdentity;
      }
      const [existingByEmail] = await tx.select().from(usersTable).where(eq(usersTable.email, profile.email)).limit(1);
      const user = existingByEmail ?? (await tx.insert(usersTable).values({
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
        passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
        role: "CUSTOMER",
      }).returning())[0]!;
      await tx.insert(oauthIdentitiesTable).values({
        userId: user.id, provider, providerAccountId: profile.id, providerEmail: profile.email,
      }).onConflictDoNothing();
      return user;
    });
    const token = await createSession(user.id);
    res.cookie(sessionCookieName, token, cookieOptions());
    res.redirect(loginState.flow === "business" ? "/poslovna-registracija?oauth=1" : "/moj-nalog");
  } catch {
    res.redirect(oauthFailurePath(loginState.flow, "Nismo mogli da potvrdimo nalog kod provajdera."));
  }
});

router.get("/admin/email-marketing/campaigns", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const campaigns = await db.select().from(emailCampaignsTable).orderBy(desc(emailCampaignsTable.createdAt));
  res.json(AdminListEmailCampaignsResponse.parse({ campaigns: campaigns.map(emailCampaignView) }));
});

router.post("/admin/email-marketing/campaigns", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsed = AdminCreateEmailCampaignBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const input = parsed.data;
  if (input.audience === "loyalty" && !input.loyaltyTierId) { res.status(400).json({ error: "Izaberite loyalty nivo za ovu kampanju." }); return; }
  const scheduledAt = input.sendMode === "scheduled" ? input.scheduledAt ?? null : null;
  if (input.sendMode === "scheduled" && (!scheduledAt || scheduledAt <= new Date())) {
    res.status(400).json({ error: "Izaberite buduće vreme za zakazanu kampanju." }); return;
  }
  const recipients = await campaignRecipients(input.audience, input.loyaltyTierId);
  if (!recipients.length) { res.status(400).json({ error: "Izabrana publika nema nijednog primaoca." }); return; }
  const [campaign] = await db.insert(emailCampaignsTable).values({
    createdByUserId: user.id,
    audience: input.audience,
    loyaltyTierId: input.loyaltyTierId ?? null,
    title: input.title,
    subject: input.subject,
    htmlContent: input.htmlContent,
    scheduledAt,
    status: input.sendMode === "scheduled" ? "scheduled" : "draft",
    recipientCount: recipients.length,
  }).returning();
  try {
    const brevo = await createBrevoMarketingCampaign({
      name: input.title,
      subject: input.subject,
      htmlContent: input.htmlContent,
      recipients,
      scheduledAt,
    });
    if (input.sendMode === "now") await sendBrevoCampaignNow(brevo.id);
    const [updated] = await db.update(emailCampaignsTable).set({
      brevoCampaignId: brevo.id,
      status: input.sendMode === "scheduled" ? "scheduled" : "sent",
      sentAt: input.sendMode === "now" ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(emailCampaignsTable.id, campaign!.id)).returning();
    res.status(201).json(AdminCreateEmailCampaignResponse.parse(emailCampaignView(updated!)));
  } catch (error) {
    const [failed] = await db.update(emailCampaignsTable).set({
      status: "failed",
      errorMessage: error instanceof Error ? error.message.slice(0, 1000) : "Nepoznata Brevo greška",
      updatedAt: new Date(),
    }).where(eq(emailCampaignsTable.id, campaign!.id)).returning();
    res.status(502).json({ error: failed?.errorMessage ?? "Brevo kampanja nije kreirana." });
  }
});

router.get("/admin/sms-deliveries", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const deliveries = await db.select().from(smsDeliveriesTable).orderBy(desc(smsDeliveriesTable.createdAt)).limit(500);
  const salonIds = deliveries.flatMap((item) => item.salonId ? [item.salonId] : []);
  const salons = salonIds.length ? await db.select().from(salonsTable).where(inArray(salonsTable.id, [...new Set(salonIds)])) : [];
  res.json(AdminListSmsDeliveriesResponse.parse(deliveries.map((delivery) => ({
    id: delivery.id, salonName: delivery.salonId ? salons.find((salon) => salon.id === delivery.salonId)?.name ?? null : null,
    recipientPhone: maskPhone(delivery.recipientPhone), messageType: delivery.messageType, status: delivery.status,
    errorMessage: delivery.errorMessage, createdAt: delivery.createdAt,
  }))));
});

const integrationDefinitions: Record<IntegrationName, { keys: string[]; required: string[] }> = {
  sms: { keys: ["apiKey", "senderName", "baseUrl"], required: ["apiKey", "senderName"] },
  brevo: { keys: ["apiKey", "senderEmail", "senderName"], required: ["apiKey", "senderEmail"] },
  google_oauth: { keys: ["clientId", "clientSecret"], required: ["clientId", "clientSecret"] },
  facebook_oauth: { keys: ["clientId", "clientSecret"], required: ["clientId", "clientSecret"] },
};

function integrationName(value: string): value is IntegrationName {
  return value in integrationDefinitions;
}

function requestOrigin(req: Request) {
  const host = req.get("host") ?? "localhost";
  return `${req.protocol}://${host}`;
}

router.get("/admin/integrations", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const entries = await Promise.all(Object.entries(integrationDefinitions).map(async ([name, definition]) => [
    name,
    await integrationDisplay(name as IntegrationName, definition.keys, definition.required),
  ]));
  const origin = requestOrigin(req);
  res.json({
    integrations: Object.fromEntries(entries),
    redirectUris: {
      google: `${origin}/api/auth/oauth/google/callback`,
      facebook: `${origin}/api/auth/oauth/facebook/callback`,
    },
    smsReminder: {
      command: "pnpm --filter @workspace/scripts run sms-reminders",
      active: false,
      instructions: [
        "U Replit Deployments izaberite Create deployment, zatim Scheduled deployment.",
        "Podesite jutarnji raspored, na primer 08:00 po vremenu Beograda.",
        "Kao komandu unesite prikazanu komandu ispod.",
        "Dodajte LUMERA_API_BASE_URL i SMS_REMINDER_JOB_SECRET u podešavanja scheduled deployment-a.",
      ],
    },
  });
});

router.put("/admin/integrations/:integration", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  if (!integrationName(req.params.integration)) { res.status(404).json({ error: "Nepoznata integracija." }); return; }
  const body = req.body as { enabled?: unknown; values?: unknown };
  if (typeof body.enabled !== "boolean" || !body.values || typeof body.values !== "object" || Array.isArray(body.values)) {
    res.status(400).json({ error: "Pošaljite enabled vrednost i polja integracije." }); return;
  }
  const definition = integrationDefinitions[req.params.integration];
  const values = Object.fromEntries(Object.entries(body.values as Record<string, unknown>)
    .filter(([key, value]) => definition.keys.includes(key) && typeof value === "string")
    .map(([key, value]) => [key, value as string]));
  if (req.params.integration === "sms" && values.baseUrl) {
    try { infobipBaseUrl(values.baseUrl); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "SMS base URL nije ispravan." }); return; }
  }
  await saveIntegrationSettings({ integration: req.params.integration, enabled: body.enabled, values, updatedByUserId: user.id });
  res.json(await integrationDisplay(req.params.integration, definition.keys, definition.required));
});

router.post("/admin/integrations/:integration/test", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  if (!integrationName(req.params.integration)) { res.status(404).json({ error: "Nepoznata integracija." }); return; }
  const recipient = typeof req.body?.recipient === "string" ? req.body.recipient.trim() : "";
  try {
    if (req.params.integration === "sms") {
      if (!recipient) { res.status(400).json({ error: "Unesite broj za test SMS." }); return; }
      await sendTestSms(recipient);
      res.json({ message: "Test SMS je poslat." }); return;
    }
    if (req.params.integration === "brevo") {
      if (!recipient || !recipient.includes("@")) { res.status(400).json({ error: "Unesite ispravnu e-mail adresu za test." }); return; }
      const result = await sendTransactionalEmail({
        eventKey: `integration-test-email:${Date.now()}`, emailType: "integration_test", to: { email: recipient, name: "LUMERA administrator" },
        subject: "LUMERA — test Brevo integracije", htmlContent: lumeraEmailHtml("Test e-mail", "<p>Brevo integracija je uspešno povezana.</p>"),
      });
      if ("failed" in result || "skipped" in result) throw new Error("Brevo nije poslao test e-mail. Proverite podešavanja.");
      res.json({ message: "Test e-mail je poslat." }); return;
    }
    const config = await integrationSettings(req.params.integration);
    const definition = integrationDefinitions[req.params.integration];
    if (!config.enabled || !definition.required.every((key) => Boolean(config.values[key]))) throw new Error("Popunite i aktivirajte obavezna OAuth polja pre testa.");
    res.json({ message: "OAuth konfiguracija je potpuna. Redirect URI je spreman za unos kod provajdera." });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Test integracije nije uspeo." });
  }
});

router.post("/internal/jobs/sms-reminders", async (req, res): Promise<void> => {
  const expected = process.env["SMS_REMINDER_JOB_SECRET"];
  if (!expected || req.get("x-lumera-job-key") !== expected) { res.status(401).json({ error: "Neovlašćen posao." }); return; }
  const date = typeof req.body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? req.body.date : undefined;
  const result = await sendDailyAppointmentReminders(date);
  req.log.info(result, "SMS reminder batch finished");
  res.json(result);
});

router.post("/internal/jobs/rescheduled-confirmation-retries", async (req, res): Promise<void> => {
  const expected = process.env["CONFIRMATION_RETRY_JOB_SECRET"];
  if (!expected || req.get("x-lumera-job-key") !== expected) { res.status(401).json({ error: "Neovlašćen posao." }); return; }
  const result = await runRescheduledConfirmationRetries();
  res.json(result);
});

router.post("/auth/business-register", async (req, res): Promise<void> => {
  await ensureDemoData();
  const parsed = RegisterBusinessBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const input = parsed.data;
  const email = input.email.toLowerCase();
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  const signedIn = await getCurrentUser(req);
  const [linkedIdentity, existingSalon, existingCenter] = existing && signedIn?.id === existing.id ? await Promise.all([
    db.select({ id: oauthIdentitiesTable.id }).from(oauthIdentitiesTable).where(eq(oauthIdentitiesTable.userId, existing.id)).limit(1),
    db.select({ id: salonsTable.id }).from(salonsTable).where(eq(salonsTable.ownerId, existing.id)).limit(1),
    db.select({ id: educationCentersTable.id }).from(educationCentersTable).where(eq(educationCentersTable.ownerId, existing.id)).limit(1),
  ]) : [[], [], []];
  const socialBusinessCompletion = Boolean(
    existing && signedIn?.id === existing.id && existing.role === "CUSTOMER"
    && linkedIdentity.length && !existingSalon.length && !existingCenter.length,
  );
  if (existing && !socialBusinessCompletion) { res.status(409).json({ error: "Nalog sa ovom e-mail adresom već postoji." }); return; }
  if (!existing && !input.password) { res.status(400).json({ error: "Lozinka je obavezna za registraciju e-mailom." }); return; }

  try {
    const user = await db.transaction(async (tx) => {
      const role = input.businessType === "SALON" ? "SALON_OWNER" : "EDUCATION_CENTER_OWNER";
      const created = existing
        ? (await tx.update(usersTable).set({ role, phone: input.phone }).where(eq(usersTable.id, existing.id)).returning())[0]!
        : (await tx.insert(usersTable).values({
          firstName: input.firstName,
          lastName: input.lastName,
          email,
          phone: input.phone,
          passwordHash: await hashPassword(input.password!),
          passwordSetAt: new Date(),
          role,
        }).returning())[0]!;

      if (input.businessType === "SALON") {
        await tx.insert(salonsTable).values({
          ownerId: created!.id,
          name: input.businessName,
          slug: businessSlug(input.businessName, created!.id),
          city: input.city,
          municipality: input.municipality,
          address: input.address,
          postalCode: input.postalCode,
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
  if (user?.role === "SALON_EMPLOYEE" && !user.active) {
    res.status(403).json({ error: "Nalog zaposlenog je deaktiviran. Obratite se vlasniku salona." }); return;
  }
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

router.post("/auth/change-password", async (req, res): Promise<void> => {
  const user = await current(req, res);
  if (!user) return;
  if (user.role !== "SALON_EMPLOYEE") {
    res.status(403).json({ error: "Promena ove lozinke nije dostupna za ovaj tip naloga." });
    return;
  }
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  if (newPassword.length < 8) {
    res.status(400).json({ error: "Nova lozinka mora imati najmanje 8 karaktera." });
    return;
  }
  if (!user.mustChangePassword && !(await verifyPassword(currentPassword, user.passwordHash))) {
    res.status(400).json({ error: "Trenutna lozinka nije ispravna." });
    return;
  }
  const [updated] = await db.update(usersTable).set({
    passwordHash: await hashPassword(newPassword),
    passwordSetAt: new Date(),
    mustChangePassword: false,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, user.id)).returning();
  res.json({ user: publicUser(updated!) });
});

router.get("/auth/sign-in-methods", async (req, res): Promise<void> => {
  const user = await current(req, res);
  if (!user) return;
  res.json(GetAuthSignInMethodsResponse.parse(await signInMethods(user)));
});

router.delete("/auth/sign-in-methods/:provider", async (req, res): Promise<void> => {
  const user = await current(req, res);
  if (!user) return;
  const params = DisconnectAuthSignInMethodParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Nepoznat način prijave." }); return; }

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${usersTable} where ${usersTable.id} = ${user.id} for update`);
    const [lockedUser] = await tx.select().from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
    const identities = await tx.select().from(oauthIdentitiesTable)
      .where(eq(oauthIdentitiesTable.userId, user.id))
      .orderBy(asc(oauthIdentitiesTable.createdAt));
    const hasProvider = identities.some((identity) => identity.provider === params.data.provider);
    if (!lockedUser || !hasProvider) return { error: "not-found" as const };

    const methods = signInMethodsView(lockedUser, identities);
    const provider = methods.providers.find((item) => item.provider === params.data.provider);
    if (!provider?.canDisconnect) return { error: "no-alternative" as const };

    await tx.delete(oauthIdentitiesTable).where(and(
      eq(oauthIdentitiesTable.userId, user.id),
      eq(oauthIdentitiesTable.provider, params.data.provider),
    ));

    return {
      methods: signInMethodsView(
        lockedUser,
        identities.filter((identity) => identity.provider !== params.data.provider),
      ),
    };
  });

  if ("error" in result) {
    res.status(result.error === "not-found" ? 404 : 400).json({
      error: result.error === "not-found"
        ? "Ovaj način prijave nije povezan sa vašim nalogom."
        : "Pre odvajanja dodajte drugu prijavu ili postavite lozinku za nalog.",
    });
    return;
  }

  res.json(DisconnectAuthSignInMethodResponse.parse(result.methods));
});

router.get("/salons", async (req, res): Promise<void> => {
  await ensureDemoData();
  const normalized = normalizeBooleanQuery(req.query, ["homeService", "discountsOnly", "acceptsCards", "openSunday", "instantBooking", "topSalon", "featured"]);
  if (!normalized) { res.status(400).json({ error: "Boolean filteri prihvataju samo true ili false." }); return; }
  const parsed = ListSalonsQueryParams.safeParse(normalized);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let salons = await db.select().from(salonsTable).where(eq(salonsTable.active, true));
  const query = parsed.data;
  if (query.city) salons = salons.filter((item) => item.city.toLowerCase() === query.city!.toLowerCase());
  if (query.municipality) salons = salons.filter((item) => item.municipality.toLowerCase() === query.municipality!.toLowerCase());
  const allCards = await salonCards(salons);
  const allServices = salons.length
    ? await db.select().from(servicesTable).where(and(inArray(servicesTable.salonId, salons.map((item) => item.id)), eq(servicesTable.active, true)))
    : [];
  const activeServiceIds = new Set(allServices.map((service) => service.id));
  const linkedBrands = salons.length ? await db.select().from(salonBrandsTable).where(inArray(salonBrandsTable.salonId, salons.map((item) => item.id))) : [];
  const brands = linkedBrands.length ? await db.select().from(productBrandsTable).where(inArray(productBrandsTable.id, linkedBrands.map((item) => item.brandId))) : [];
  const bestDiscountBySalon = new Map<string, number>();
  for (const service of allServices) {
    if (service.promoPrice === null || service.promoPrice >= service.price) continue;
    bestDiscountBySalon.set(
      service.salonId,
      Math.max(bestDiscountBySalon.get(service.salonId) ?? 0, service.price - service.promoPrice),
    );
  }
  const treatment = (query.treatment ?? query.category ?? "").toLowerCase();
  const filtered = allCards.filter((item) => {
    const services = allServices.filter((service) => service.salonId === item.id);
    const matchesTreatment = !treatment || services.some((service) => `${service.categoryName} ${service.name} ${service.tags.join(" ")}`.toLowerCase().includes(treatment));
    const matchesPrice = query.priceMax === undefined || item.startingPrice <= query.priceMax;
    const matchesRating = query.minRating === undefined || item.rating >= query.minRating;
    const matchesReviewCount = query.minReviewCount === undefined || item.reviewCount >= query.minReviewCount;
    const matchesMen = query.gender !== "men" || item.servesMen;
    const matchesBrand = !query.brand || linkedBrands.filter((link) => link.salonId === item.id).some((link) => brands.find((brand) => brand.id === link.brandId)?.name.toLowerCase() === query.brand!.toLowerCase());
    return matchesTreatment && matchesPrice && matchesRating && matchesReviewCount && matchesMen && matchesBrand
      && (query.discountsOnly === undefined || item.hasDiscount === query.discountsOnly)
      && (query.acceptsCards === undefined || item.acceptsCards === query.acceptsCards)
      && (query.openSunday === undefined || item.openSunday === query.openSunday)
      && (query.instantBooking === undefined || item.instantBooking === query.instantBooking)
      && (query.homeService === undefined || item.homeService === query.homeService)
      && (query.topSalon === undefined || item.topSalon === query.topSalon)
      && (query.featured === undefined || item.featured === query.featured);
  });
  const recentSalonBookingCounts = new Map<string, number>();
  if (query.sort === "most-booked-recently" && salons.length) {
    const recentAppointments = await db.select({
      salonId: appointmentsTable.salonId,
      serviceId: appointmentsTable.serviceId,
    }).from(appointmentsTable).where(and(
      inArray(appointmentsTable.salonId, salons.map((salon) => salon.id)),
      gte(appointmentsTable.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
      ne(appointmentsTable.status, "cancelled"),
    ));
    for (const appointment of recentAppointments) {
      if (!activeServiceIds.has(appointment.serviceId)) continue;
      recentSalonBookingCounts.set(appointment.salonId, (recentSalonBookingCounts.get(appointment.salonId) ?? 0) + 1);
    }
  }
  const sorted = [...filtered].sort((a, b) => {
    if (query.sort === "top-rated") return b.rating - a.rating;
    if (query.sort === "cheapest") return a.startingPrice - b.startingPrice;
    if (query.sort === "largest-discount") {
      return (bestDiscountBySalon.get(b.id) ?? 0) - (bestDiscountBySalon.get(a.id) ?? 0)
        || b.rating - a.rating
        || b.reviewCount - a.reviewCount;
    }
    if (query.sort === "most-popular") return b.reviewCount - a.reviewCount;
    if (query.sort === "most-booked-recently") {
      return (recentSalonBookingCounts.get(b.id) ?? 0) - (recentSalonBookingCounts.get(a.id) ?? 0)
        || b.rating - a.rating
        || b.reviewCount - a.reviewCount;
    }
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

router.get("/discovery/home", async (req, res): Promise<void> => {
  await ensureDemoData();
  const parsed = GetMarketplaceHomeDiscoveryQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const city = parsed.data.city?.trim().toLowerCase();
  const cacheKey = city || "all";
  const cached = marketplaceHomeDiscoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.set("Cache-Control", "public, max-age=60, s-maxage=60");
    res.json(cached.payload);
    return;
  }

  const salons = (await db.select().from(salonsTable).where(eq(salonsTable.active, true)))
    .filter((salon) => !city || salon.city.toLowerCase() === city);
  const serviceCategories = await db.select().from(serviceCategoriesTable).where(eq(serviceCategoriesTable.active, true));
  const mainServiceCategories = serviceCategories.filter((category) => DEFAULT_POPULAR_CATEGORY_ORDER.includes(category.name));
  const fallbackCategoryCards = mainServiceCategories
    .sort((a, b) => {
      const aIndex = DEFAULT_POPULAR_CATEGORY_ORDER.indexOf(a.name);
      const bIndex = DEFAULT_POPULAR_CATEGORY_ORDER.indexOf(b.name);
      return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex)
        || a.name.localeCompare(b.name, "sr");
    })
    .slice(0, 8)
    .map((category) => ({
      name: category.name,
      categoryName: category.name,
      bookingCount: 0,
      imageUrl: category.fallbackImageUrl ?? DEFAULT_CATEGORY_CARD_IMAGE,
    }));
  let payload: MarketplaceHomeDiscoveryPayload;
  if (!salons.length) {
    payload = GetMarketplaceHomeDiscoveryResponse.parse({
      popularServices: fallbackCategoryCards,
      featuredSalons: [],
      newSalons: [],
      discountedSalons: [],
      popularSalons: [],
      topRatedSalons: [],
    });
  } else {
    const salonIds = salons.map((salon) => salon.id);
    const [services, hours, recentAppointments] = await Promise.all([
      db.select().from(servicesTable).where(and(inArray(servicesTable.salonId, salonIds), eq(servicesTable.active, true))),
      db.select().from(salonHoursTable).where(inArray(salonHoursTable.salonId, salonIds)),
      db.select().from(appointmentsTable).where(and(
        inArray(appointmentsTable.salonId, salonIds),
        gte(appointmentsTable.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
        ne(appointmentsTable.status, "cancelled"),
      )),
    ]);
    const servicesBySalon = new Map<string, (typeof servicesTable.$inferSelect)[]>();
    const hoursBySalon = new Map<string, (typeof salonHoursTable.$inferSelect)[]>();
    for (const service of services) servicesBySalon.set(service.salonId, [...(servicesBySalon.get(service.salonId) ?? []), service]);
    for (const hour of hours) hoursBySalon.set(hour.salonId, [...(hoursBySalon.get(hour.salonId) ?? []), hour]);
    const cards = salons.map((salon) => card(salon, servicesBySalon.get(salon.id), hoursBySalon.get(salon.id)));
    const knownCategoryNames = new Set(mainServiceCategories.map((category) => category.name));
    const categoryServices = services.filter((service) => knownCategoryNames.has(service.categoryName));
    const bookingCounts = new Map<string, number>();
    const activeServiceIds = new Set(services.map((service) => service.id));
    for (const appointment of recentAppointments) {
      if (!activeServiceIds.has(appointment.serviceId)) continue;
      bookingCounts.set(appointment.serviceId, (bookingCounts.get(appointment.serviceId) ?? 0) + 1);
    }
    const salonBookingCounts = new Map<string, number>();
    const discountsBySalon = new Map<string, typeof servicesTable.$inferSelect>();
    for (const service of services) {
      salonBookingCounts.set(service.salonId, (salonBookingCounts.get(service.salonId) ?? 0) + (bookingCounts.get(service.id) ?? 0));
      if (service.promoPrice !== null && service.promoPrice < service.price) {
        const current = discountsBySalon.get(service.salonId);
        const currentSaving = current ? current.price - (current.promoPrice ?? current.price) : 0;
        if (!current || service.price - service.promoPrice > currentSaving) discountsBySalon.set(service.salonId, service);
      }
    }
    const rankCards = (items: typeof cards, compare: (a: typeof cards[number], b: typeof cards[number]) => number, limit = 12) =>
      [...items].sort(compare).slice(0, limit);
    const servicesById = new Map(categoryServices.map((service) => [service.id, service]));
    const categoryBookingCounts = new Map<string, number>();
    const categorySalonBookingCounts = new Map<string, number>();
    for (const appointment of recentAppointments) {
      const service = servicesById.get(appointment.serviceId);
      if (!service) continue;
      categoryBookingCounts.set(service.categoryName, (categoryBookingCounts.get(service.categoryName) ?? 0) + 1);
      const key = `${service.categoryName}\u0000${service.salonId}`;
      categorySalonBookingCounts.set(key, (categorySalonBookingCounts.get(key) ?? 0) + 1);
    }
    const salonById = new Map(salons.map((salon) => [salon.id, salon]));
    const categoryPhotos = new Map<string, { imageUrl: string; bookingCount: number; createdAt: Date }>();
    for (const service of categoryServices) {
      const salon = salonById.get(service.salonId);
      const galleryImage = salon?.gallery.find(isRealSalonGalleryImage);
      if (!salon || !galleryImage) continue;
      const bookingCount = categorySalonBookingCounts.get(`${service.categoryName}\u0000${service.salonId}`) ?? 0;
      const current = categoryPhotos.get(service.categoryName);
      if (!current || bookingCount > current.bookingCount || (bookingCount === current.bookingCount && salon.createdAt > current.createdAt)) {
        categoryPhotos.set(service.categoryName, { imageUrl: galleryImage, bookingCount, createdAt: salon.createdAt });
      }
    }
    const categoriesByName = new Map(mainServiceCategories.map((category) => [category.name, category]));
    const bookedCategories = [...categoryBookingCounts.entries()]
      .map(([categoryName, bookingCount]) => ({
        name: categoryName,
        categoryName,
        bookingCount,
        imageUrl: categoryPhotos.get(categoryName)?.imageUrl
          ?? categoriesByName.get(categoryName)?.fallbackImageUrl
          ?? DEFAULT_CATEGORY_CARD_IMAGE,
      }))
      .filter((category) => category.bookingCount > 0)
      .sort((a, b) => b.bookingCount - a.bookingCount || a.categoryName.localeCompare(b.categoryName, "sr"))
      .slice(0, 8);
    const popularServices = bookedCategories.length ? bookedCategories : fallbackCategoryCards;
    const featuredSalons = rankCards(
      cards.filter((item) => item.featured),
      (a, b) => Number(b.topSalon) - Number(a.topSalon) || b.rating - a.rating || b.reviewCount - a.reviewCount,
    );
    const discountedSalons = rankCards(
      cards.filter((item) => discountsBySalon.has(item.id)),
      (a, b) => {
        const saving = (salonId: string) => {
          const service = discountsBySalon.get(salonId)!;
          return service.price - (service.promoPrice ?? service.price);
        };
        return saving(b.id) - saving(a.id) || b.rating - a.rating;
      },
    ).flatMap((item) => {
      const discount = discountsBySalon.get(item.id)!;
      return discount.promoPrice === null
        ? []
        : [{ ...item, discount: { serviceName: discount.name, price: discount.price, promoPrice: discount.promoPrice } }];
    });
    payload = GetMarketplaceHomeDiscoveryResponse.parse({
      popularServices,
      featuredSalons,
      newSalons: rankCards(cards, (a, b) => b.createdAt.localeCompare(a.createdAt)),
      discountedSalons,
      popularSalons: rankCards(
        cards.filter((item) => (salonBookingCounts.get(item.id) ?? 0) > 0),
        (a, b) => (salonBookingCounts.get(b.id) ?? 0) - (salonBookingCounts.get(a.id) ?? 0) || b.rating - a.rating,
      ),
      topRatedSalons: rankCards(
        cards.filter((item) => item.reviewCount >= 5),
        (a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount,
      ),
    });
  }

  if (marketplaceHomeDiscoveryCache.size >= 100) marketplaceHomeDiscoveryCache.clear();
  marketplaceHomeDiscoveryCache.set(cacheKey, { expiresAt: Date.now() + 60_000, payload });
  res.set("Cache-Control", "public, max-age=60, s-maxage=60");
  res.json(payload);
});

router.get("/platform/trust-stats", async (_req, res): Promise<void> => {
  await ensureDemoData();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [[activeSalons], [bookingsThisMonth], [customerAccounts]] = await Promise.all([
    db.select({ value: count() }).from(salonsTable).where(eq(salonsTable.active, true)),
    db.select({ value: count() }).from(appointmentsTable).where(and(gte(appointmentsTable.createdAt, monthStart), ne(appointmentsTable.status, "cancelled"))),
    db.select({ value: count() }).from(usersTable).where(and(eq(usersTable.role, "CUSTOMER"), eq(usersTable.active, true))),
  ]);
  res.set("Cache-Control", "public, max-age=60");
  res.json(GetPlatformTrustStatsResponse.parse({
    activeSalons: Number(activeSalons?.value ?? 0),
    bookingsThisMonth: Number(bookingsThisMonth?.value ?? 0),
    customerAccounts: Number(customerAccounts?.value ?? 0),
  }));
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
  const reviewUsersById = new Map(reviewUsers.map((user) => [user.id, user]));
  const employeeLinks = staff.length ? await db.select().from(employeeServicesTable).where(inArray(employeeServicesTable.employeeId, staff.map((item) => item.id))) : [];
  const serviceByName = new Map(services.map((service) => [service.name, service]));
  const completedAppointmentKeys = new Set(
    appointments
      .filter((appointment) => appointment.status === "completed" && appointment.customerId)
      .map((appointment) => `${appointment.customerId}:${appointment.serviceId}`),
  );
  const completedVisitsByCustomer = new Map<string, number>();
  for (const appointment of appointments) {
    if (appointment.status !== "completed" || !appointment.customerId) continue;
    completedVisitsByCustomer.set(
      appointment.customerId,
      (completedVisitsByCustomer.get(appointment.customerId) ?? 0) + 1,
    );
  }
  const returnClientRate = appointments.filter((appointment) => appointment.status === "completed").length >= 5
    && completedVisitsByCustomer.size >= 3
    ? Math.round(
      [...completedVisitsByCustomer.values()].filter((visits) => visits > 1).length
      / completedVisitsByCustomer.size * 100,
    )
    : null;
  const bookingsByServiceId = new Map<string, number>();
  for (const appointment of appointments) {
    if (appointment.status === "cancelled") continue;
    bookingsByServiceId.set(appointment.serviceId, (bookingsByServiceId.get(appointment.serviceId) ?? 0) + 1);
  }
  const topServices = services
    .map((service) => ({ ...service, bookingCount: bookingsByServiceId.get(service.id) ?? 0 }))
    .filter((service) => service.bookingCount > 0)
    .sort((a, b) => b.bookingCount - a.bookingCount || a.name.localeCompare(b.name, "sr"))
    .slice(0, 3)
    .map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      durationMinutes: service.durationMinutes,
      price: service.price,
      promoPrice: service.promoPrice,
      bookingCount: service.bookingCount,
    }));
  res.json(GetSalonResponse.parse({
    ...card(salon, services, hours, appointments, staff),
    gallery: salon.gallery,
    videoUrl: salon.videoUrl,
    description: salon.description,
    phone: salon.phone,
    email: salon.email,
    latitude: salon.latitude,
    longitude: salon.longitude,
    homeServiceRadiusKm: salon.homeServiceRadiusKm,
    topServices,
    hours: hours.map((item) => ({ day: ["Ponedeljak", "Utorak", "Sreda", "Četvrtak", "Petak", "Subota", "Nedelja"][item.weekday - 1] ?? "Ponedeljak", open: item.openTime, close: item.closeTime, closed: item.closed })),
    staff: staff.map((item) => {
      const serviceIds = employeeLinks.filter((link) => link.employeeId === item.id).map((link) => link.serviceId);
      return { id: item.id, name: item.name, role: item.role, bio: item.bio, avatarUrl: item.avatarUrl, specialties: item.specialties, serviceIds, serviceNames: services.filter((service) => serviceIds.includes(service.id)).map((service) => service.name) };
    }),
    services: services.map((item) => ({ id: item.id, category: item.categoryName, name: item.name, description: item.description, durationMinutes: item.durationMinutes, price: item.price, promoPrice: item.promoPrice, tags: item.tags, packageTreatments: item.packageTreatments, imageUrl: item.imageUrl, active: item.active, homeServiceAvailable: item.homeServiceAvailable, homeServiceFee: item.homeServiceFee, homeServiceMinimumOrder: item.homeServiceMinimumOrder })),
    returnClientRate,
    reviews: reviews.map((item) => {
      const reviewer = reviewUsersById.get(item.customerId);
      const reviewedService = serviceByName.get(item.serviceName);
      return {
        id: item.id,
        authorName: `${reviewer?.firstName ?? "Gost"} ${reviewer?.lastName ?? ""}`.trim(),
        avatarUrl: item.showProfilePhoto ? reviewer?.avatarUrl ?? null : null,
        verifiedBooking: !!reviewedService && completedAppointmentKeys.has(`${item.customerId}:${reviewedService.id}`),
        rating: item.rating,
        text: item.text,
        date: item.createdAt.toISOString().slice(0, 10),
        serviceName: item.serviceName,
      };
    }),
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
  if (typeof req.query.serviceId !== "string" || !req.query.serviceId.trim()) {
    res.status(400).json({ error: "serviceId je obavezan parametar." }); return;
  }
  const [params, query] = [GetSalonAvailabilityParams.safeParse(req.params), GetSalonAvailabilityQueryParams.safeParse(req.query)];
  if (!params.success || !query.success) { res.status(400).json({ error: "Parametri za dostupnost nisu ispravni." }); return; }
  const [service] = await db.select().from(servicesTable).where(and(eq(servicesTable.id, query.data.serviceId), eq(servicesTable.salonId, params.data.salonId))).limit(1);
  if (!service) { res.status(404).json({ error: "Usluga nije pronađena." }); return; }
  const date = calendarDate(query.data.date);
  const eligible = await eligibleEmployees(params.data.salonId, service.id, query.data.employeeId);
  if (query.data.employeeId && !eligible.length) { res.status(404).json({ error: "Izabrani zaposleni ne obavlja ovu uslugu." }); return; }
  const slots = (await Promise.all(Array.from({ length: 9 }, async (_, index) => {
    const start = `${String(9 + index).padStart(2, "0")}:00`;
    const end = appointmentEndTime(start, service.durationMinutes);
    if (!end) return null;
    const employee = await availableEmployee(params.data.salonId, service.id, date, start, end, query.data.employeeId);
    return employee ? { start, end, employeeId: employee.id, employeeName: employee.name } : null;
  }))).filter(Boolean).slice(0, 14);
  res.json(GetSalonAvailabilityResponse.parse(slots));
});

router.get("/salons/:salonId/first-available", async (req, res): Promise<void> => {
  await ensureDemoData();
  const params = GetSalonFirstAvailableParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Salon nije ispravno izabran." });
    return;
  }
  const [salon] = await db.select({ id: salonsTable.id }).from(salonsTable)
    .where(and(eq(salonsTable.id, params.data.salonId), eq(salonsTable.active, true))).limit(1);
  if (!salon) {
    res.status(404).json({ error: "Salon nije pronađen." });
    return;
  }
  res.set("Cache-Control", "public, max-age=30");
  res.json(GetSalonFirstAvailableResponse.parse(await firstAvailableByService(salon.id)));
});

router.get("/appointments", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  const parsed = ListMyAppointmentsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let appointments = await appointmentList(eq(appointmentsTable.customerId, user.id), true);
  if (parsed.data.status) appointments = appointments.filter((item) => item.status === parsed.data.status);
  if (parsed.data.scope === "upcoming") appointments = appointments.filter((item) => item.date >= new Date().toISOString().slice(0, 10));
  if (parsed.data.scope === "past") appointments = appointments.filter((item) => item.date < new Date().toISOString().slice(0, 10));
  ListMyAppointmentsResponse.parse(appointments);
  res.json(appointments);
});

router.post("/appointments", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [service] = await db.select().from(servicesTable).where(and(eq(servicesTable.id, parsed.data.serviceId), eq(servicesTable.salonId, parsed.data.salonId))).limit(1);
  const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.id, parsed.data.salonId)).limit(1);
  if (!service || !salon) { res.status(404).json({ error: "Salon ili usluga nisu pronađeni." }); return; }
  const treatmentLocation = parsed.data.treatmentLocation ?? "salon";
  if (treatmentLocation === "home" && !service.homeServiceAvailable) { res.status(400).json({ error: "Ova usluga trenutno nije dostupna na vašoj adresi." }); return; }
  if (treatmentLocation === "home" && (!parsed.data.treatmentAddress?.line1 || !parsed.data.treatmentAddress.city)) { res.status(400).json({ error: "Unesite adresu za dolazak." }); return; }
  if (treatmentLocation === "home" && !user.phoneNormalized) { res.status(400).json({ error: "Potvrdite broj telefona SMS kodom pre zakazivanja dolaska na adresu." }); return; }
  const basePrice = service.promoPrice ?? service.price;
  if (treatmentLocation === "home" && service.homeServiceMinimumOrder !== null && basePrice < service.homeServiceMinimumOrder) {
    res.status(400).json({ error: `Minimalna vrednost usluge za dolazak je ${service.homeServiceMinimumOrder} RSD.` }); return;
  }
  const appointmentDate = calendarDate(parsed.data.date);
  if (appointmentDate < new Date().toISOString().slice(0, 10)) {
    res.status(400).json({ error: "Termin mora biti zakazan za današnji ili budući datum." });
    return;
  }
  const endTime = appointmentEndTime(parsed.data.startTime, service.durationMinutes);
  if (!endTime) { res.status(400).json({ error: "Trajanje termina izlazi van radnog dana." }); return; }
  const [createdContact] = await db.insert(salonCustomersTable).values({
    salonId: salon.id, userId: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone,
  }).onConflictDoNothing().returning();
  const crmContact = createdContact ?? (await db.select().from(salonCustomersTable).where(and(eq(salonCustomersTable.salonId, salon.id), eq(salonCustomersTable.userId, user.id))).limit(1))[0];
  const allocation = await createAllocatedAppointment({
    salonId: salon.id, customerId: user.id, salonCustomerId: crmContact?.id ?? null, serviceId: service.id,
    date: appointmentDate, startTime: parsed.data.startTime, endTime, durationMinutes: service.durationMinutes,
    price: basePrice + (treatmentLocation === "home" ? service.homeServiceFee : 0),
    status: treatmentLocation === "home" ? "pending" : salon.instantBooking ? "confirmed" : "pending", notes: parsed.data.notes ?? null,
    preferredEmployeeId: parsed.data.employeeId,
    treatmentLocation, travelFee: treatmentLocation === "home" ? service.homeServiceFee : 0,
    treatmentAddress: treatmentLocation === "home" ? parsed.data.treatmentAddress : null,
  });
  if (!allocation.employee || !allocation.appointment) { res.status(409).json({ error: "Nema dostupnog zaposlenog za ovaj termin." }); return; }
  const { employee, appointment } = allocation;
  await sendSms({
    eventKey: `appointment-created:${appointment.id}`, salonId: salon.id, appointmentId: appointment.id,
    type: "appointment_confirmation", phone: user.phone, smsOptOut: crmContact?.smsOptOut,
    text: appointment.status === "confirmed"
      ? `LUMERA: termin u salonu ${salon.name} je potvrđen za ${calendarDate(appointment.date)} u ${appointment.startTime}.`
      : `LUMERA: zahtev za ${appointment.treatmentLocation === "home" ? "dolazak na adresu" : "termin"} u salonu ${salon.name} je primljen za ${calendarDate(appointment.date)} u ${appointment.startTime}. Salon će ga potvrditi.`,
  });
  await sendAppointmentEmails({ event: "created", appointment, customer: user, salon, service });
  const response = appointmentView(appointment, salon, service, user, employee, true);
  CreateAppointmentResponse.parse(response);
  res.status(201).json(response);
});

router.patch("/appointments/:appointmentId", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  const [params, body] = [UpdateAppointmentParams.safeParse(req.params), UpdateAppointmentBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci za izmenu termina nisu ispravni." }); return; }
  const result = await db.transaction(async (tx) => {
    const [initial] = await tx.select().from(appointmentsTable).where(and(
      eq(appointmentsTable.id, params.data.appointmentId),
      eq(appointmentsTable.customerId, user.id),
    )).limit(1);
    if (!initial) return { error: "not-found" as const };

    const date = body.data.date ? calendarDate(body.data.date) : initial.date;
    const startTime = body.data.startTime ?? initial.startTime;
    const employeeId = body.data.employeeId ?? initial.employeeId;
    await lockAppointmentResources(tx, initial.salonId, [
      { date: initial.date, employeeId: initial.employeeId },
      { date, employeeId },
    ]);
    const [appointment] = await tx.select().from(appointmentsTable).where(and(
      eq(appointmentsTable.id, initial.id),
      eq(appointmentsTable.customerId, user.id),
    )).for("update").limit(1);
    if (!appointment || !["pending", "confirmed"].includes(appointment.status)) return { error: "changed" as const };
    const [service] = await tx.select().from(servicesTable).where(eq(servicesTable.id, appointment.serviceId)).limit(1);
    const endTime = service ? appointmentEndTime(startTime, service.durationMinutes) : null;
    if (!service || !endTime) return { error: "invalid-time" as const };
    const employee = await availableEmployeeWithDb(
      tx, appointment.salonId, service.id, date, startTime, endTime, employeeId, [], new Set([appointment.id]),
    );
    if (!employee) return { error: "unavailable" as const };
    await lockAppointmentResources(tx, appointment.salonId, [{ date, employeeId: employee.id }]);
    const [updated] = await tx.update(appointmentsTable).set({
      date, startTime, endTime, employeeId: employee.id, notes: body.data.notes ?? appointment.notes,
    }).where(and(eq(appointmentsTable.id, appointment.id), inArray(appointmentsTable.status, ["pending", "confirmed"]))).returning();
    return updated ? { appointment: updated, service, employee } : { error: "changed" as const };
  });
  if ("error" in result) {
    const error = result.error;
    res.status(error === "not-found" ? 404 : error === "invalid-time" ? 400 : 409).json({
      error: error === "not-found" ? "Termin nije pronađen."
        : error === "invalid-time" ? "Trajanje termina izlazi van radnog dana."
          : error === "unavailable" ? "Termin više nije slobodan kod izabranog zaposlenog."
            : "Termin je u međuvremenu promenjen. Osvežite raspored i pokušajte ponovo.",
    });
    return;
  }
  const { appointment: updated, employee } = result;
  const [salon, service] = await Promise.all([db.select().from(salonsTable).where(eq(salonsTable.id, updated!.salonId)).limit(1), db.select().from(servicesTable).where(eq(servicesTable.id, updated!.serviceId)).limit(1)]);
  await sendAppointmentEmails({ event: "updated", appointment: updated, customer: user, salon: salon[0]!, service: service[0]! });
  const response = appointmentView(updated, salon[0]!, service[0]!, user, employee, true);
  UpdateAppointmentResponse.parse(response);
  res.json(response);
});

router.post("/appointments/:appointmentId/cancel", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  const [params, body] = [CancelAppointmentParams.safeParse(req.params), CancelAppointmentBody.safeParse(req.body ?? {})];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci za otkazivanje nisu ispravni." }); return; }
  const result = await db.transaction(async (tx) => {
    const [initial] = await tx.select().from(appointmentsTable).where(and(
      eq(appointmentsTable.id, params.data.appointmentId),
      eq(appointmentsTable.customerId, user.id),
    )).limit(1);
    if (!initial) return { error: "not-found" as const };
    await lockAppointmentResources(tx, initial.salonId, [{ date: initial.date, employeeId: initial.employeeId }]);
    const [appointment] = await tx.update(appointmentsTable).set({
      status: "cancelled",
      cancellationReason: body.data.reason ?? null,
    }).where(and(
      eq(appointmentsTable.id, initial.id),
      eq(appointmentsTable.customerId, user.id),
      inArray(appointmentsTable.status, ["pending", "confirmed"]),
    )).returning();
    return appointment ? { appointment } : { error: "changed" as const };
  });
  if ("error" in result) {
    res.status(result.error === "not-found" ? 404 : 409).json({
      error: result.error === "not-found" ? "Termin nije pronađen." : "Termin je u međuvremenu promenjen ili otkazan.",
    });
    return;
  }
  const { appointment } = result;
  const [salon, service, employee] = await Promise.all([db.select().from(salonsTable).where(eq(salonsTable.id, appointment.salonId)).limit(1), db.select().from(servicesTable).where(eq(servicesTable.id, appointment.serviceId)).limit(1), appointment.employeeId ? db.select().from(employeesTable).where(eq(employeesTable.id, appointment.employeeId)).limit(1) : Promise.resolve([])]);
  await sendAppointmentEmails({ event: "cancelled", appointment, customer: user, salon: salon[0]!, service: service[0]! });
  const response = appointmentView(appointment, salon[0]!, service[0]!, user, employee[0], true);
  CancelAppointmentResponse.parse(response);
  res.json(response);
});

router.get("/customer/dashboard", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  const [appointments, bookingRecords, favorites] = await Promise.all([
    appointmentList(eq(appointmentsTable.customerId, user.id), true),
    db.select().from(appointmentsTable).where(eq(appointmentsTable.customerId, user.id)),
    db.select().from(favoritesTable).where(eq(favoritesTable.userId, user.id)),
  ]);
  const bookedSalonIds = [...new Set(bookingRecords
    .filter((appointment) => appointment.status !== "cancelled")
    .map((appointment) => appointment.salonId))];
  const bookedServiceIds = [...new Set(bookingRecords
    .filter((appointment) => appointment.status !== "cancelled")
    .map((appointment) => appointment.serviceId))];
  const bookedServices = bookedServiceIds.length
    ? await db.select().from(servicesTable).where(inArray(servicesTable.id, bookedServiceIds))
    : [];
  const preferredCategories = new Set(bookedServices.map((service) => service.categoryName));
  const activeSalons = preferredCategories.size
    ? await db.select().from(salonsTable).where(eq(salonsTable.active, true))
    : [];
  const candidateSalonIds = activeSalons
    .filter((salon) => !bookedSalonIds.includes(salon.id))
    .map((salon) => salon.id);
  const candidateServices = candidateSalonIds.length
    ? await db.select().from(servicesTable).where(inArray(servicesTable.salonId, candidateSalonIds))
    : [];
  const recommendedSalons = activeSalons
    .filter((salon) => candidateServices.some((service) =>
      service.salonId === salon.id && service.active && preferredCategories.has(service.categoryName),
    ))
    .sort((left, right) => Number(right.topSalon) - Number(left.topSalon)
      || Number(right.featured) - Number(left.featured)
      || right.rating - left.rating)
    .slice(0, 15);
  const recentSalons = await db.select().from(salonsTable).where(eq(salonsTable.active, true)).limit(3);
  res.json(GetCustomerDashboardResponse.parse({
    upcoming: appointments.filter((item) => item.status !== "cancelled").slice(0, 3),
    recentSalons: await salonCards(recentSalons),
    recommendations: await salonCards(recommendedSalons),
    favoriteCount: favorites.length,
    visitCount: appointments.filter((item) => item.status === "completed").length,
  }));
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

async function customerReviewContext(customerId: string, salonId: string) {
  const [completedAppointments, existingReview] = await Promise.all([
    db.select().from(appointmentsTable).where(and(
      eq(appointmentsTable.customerId, customerId),
      eq(appointmentsTable.salonId, salonId),
      eq(appointmentsTable.status, "completed"),
    )),
    db.select().from(reviewsTable).where(and(
      eq(reviewsTable.customerId, customerId),
      eq(reviewsTable.salonId, salonId),
    )).orderBy(desc(reviewsTable.createdAt)).limit(1),
  ]);
  const completedServiceIds = [...new Set(completedAppointments.map((appointment) => appointment.serviceId))];
  const completedServices = completedServiceIds.length
    ? await db.select().from(servicesTable).where(inArray(servicesTable.id, completedServiceIds))
    : [];
  return {
    review: existingReview[0] ?? null,
    eligibleServices: [...new Set(completedServices.map((service) => service.name))],
  };
}

function customerReviewView(review: typeof reviewsTable.$inferSelect) {
  return {
    id: review.id,
    salonId: review.salonId,
    serviceName: review.serviceName,
    rating: review.rating,
    text: review.text,
    showProfilePhoto: review.showProfilePhoto,
  };
}

router.get("/customer/reviews/:salonId", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  const parsed = GetCustomerSalonReviewParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [salon] = await db.select({ id: salonsTable.id }).from(salonsTable).where(eq(salonsTable.id, parsed.data.salonId)).limit(1);
  if (!salon) { res.status(404).json({ error: "Salon nije pronađen." }); return; }
  const context = await customerReviewContext(user.id, salon.id);
  res.json(GetCustomerSalonReviewResponse.parse({
    review: context.review ? customerReviewView(context.review) : null,
    eligibleServices: context.eligibleServices,
  }));
});

router.put("/customer/reviews/:salonId", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  const [params, body] = [UpsertCustomerSalonReviewParams.safeParse(req.params), UpsertCustomerSalonReviewBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci za recenziju nisu ispravni." }); return; }
  const [salon] = await db.select({ id: salonsTable.id }).from(salonsTable).where(eq(salonsTable.id, params.data.salonId)).limit(1);
  if (!salon) { res.status(404).json({ error: "Salon nije pronađen." }); return; }
  const context = await customerReviewContext(user.id, salon.id);
  const keepsExistingService = context.review?.serviceName === body.data.serviceName;
  if (!keepsExistingService && !context.eligibleServices.includes(body.data.serviceName)) {
    res.status(400).json({ error: "Recenziju možete ostaviti samo za završenu uslugu u ovom salonu." });
    return;
  }
  const reviewInput = {
    serviceName: body.data.serviceName,
    rating: body.data.rating,
    text: body.data.text.trim(),
    showProfilePhoto: body.data.showProfilePhoto,
  };
  const saved = await db.transaction(async (tx) => {
    // Serializing writes per salon keeps the stored public aggregate in sync
    // when several customers submit reviews at the same time.
    await tx.select({ id: salonsTable.id }).from(salonsTable)
      .where(eq(salonsTable.id, salon.id))
      .for("update");
    const [review] = await tx.insert(reviewsTable)
      .values({ salonId: salon.id, customerId: user.id, ...reviewInput })
      .onConflictDoUpdate({
        target: [reviewsTable.customerId, reviewsTable.salonId],
        set: reviewInput,
      })
      .returning();
    const visibleReviews = await tx.select().from(reviewsTable).where(and(
      eq(reviewsTable.salonId, salon.id),
      eq(reviewsTable.visible, true),
    ));
    const reviewCount = visibleReviews.length;
    const rating = reviewCount
      ? Math.round(visibleReviews.reduce((total, item) => total + item.rating, 0) / reviewCount * 10)
      : 0;
    await tx.update(salonsTable).set({ reviewCount, rating }).where(eq(salonsTable.id, salon.id));
    return review!;
  });
  res.json(UpsertCustomerSalonReviewResponse.parse(customerReviewView(saved!)));
});

router.delete("/customer/reviews/:salonId", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  const params = DeleteCustomerSalonReviewParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [salon] = await db.select({ id: salonsTable.id }).from(salonsTable).where(eq(salonsTable.id, params.data.salonId)).limit(1);
  if (!salon) { res.status(404).json({ error: "Salon nije pronađen." }); return; }

  const deleted = await db.transaction(async (tx) => {
    // Serialize review writes per salon so the stored public aggregate stays
    // correct when a review is deleted while another is created or updated.
    await tx.select({ id: salonsTable.id }).from(salonsTable)
      .where(eq(salonsTable.id, salon.id))
      .for("update");
    const [review] = await tx.delete(reviewsTable).where(and(
      eq(reviewsTable.salonId, salon.id),
      eq(reviewsTable.customerId, user.id),
    )).returning();
    if (!review) return false;

    const visibleReviews = await tx.select().from(reviewsTable).where(and(
      eq(reviewsTable.salonId, salon.id),
      eq(reviewsTable.visible, true),
    ));
    const reviewCount = visibleReviews.length;
    const rating = reviewCount
      ? Math.round(visibleReviews.reduce((total, item) => total + item.rating, 0) / reviewCount * 10)
      : 0;
    await tx.update(salonsTable).set({ reviewCount, rating }).where(eq(salonsTable.id, salon.id));
    return true;
  });
  if (!deleted) { res.status(404).json({ error: "Vaša recenzija nije pronađena." }); return; }

  DeleteCustomerSalonReviewResponse.parse(undefined);
  res.sendStatus(204);
});

router.get("/customer/favorite-employees/:salonId", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  const [favorite] = await db.select().from(favoriteEmployeesTable).where(and(eq(favoriteEmployeesTable.userId, user.id), eq(favoriteEmployeesTable.salonId, req.params.salonId))).limit(1);
  res.json({ employeeId: favorite?.employeeId ?? null });
});

router.put("/customer/favorite-employees/:salonId", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  const employeeId = typeof req.body?.employeeId === "string" ? req.body.employeeId : null;
  if (!employeeId) { res.status(400).json({ error: "employeeId je obavezan." }); return; }
  const employee = await employeeInSalon(employeeId, req.params.salonId);
  if (!employee) { res.status(404).json({ error: "Zaposleni ne pripada ovom salonu." }); return; }
  await db.insert(favoriteEmployeesTable).values({ userId: user.id, salonId: req.params.salonId, employeeId })
    .onConflictDoUpdate({ target: [favoriteEmployeesTable.userId, favoriteEmployeesTable.salonId], set: { employeeId } });
  res.json({ employeeId });
});

router.get("/salon/dashboard", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const [services, appointments, loyalty] = await Promise.all([db.select().from(servicesTable).where(eq(servicesTable.salonId, salon.id)), appointmentList(eq(appointmentsTable.salonId, salon.id), true), db.select().from(salonLoyaltyStatusesTable).where(eq(salonLoyaltyStatusesTable.salonId, salon.id)).limit(1)]);
  const loyaltyData = await loyaltyStatus(salon.id);
  const completed = appointments.filter((item) => item.status === "completed");
  res.json(GetSalonDashboardResponse.parse({ salon: card(salon, services), todayAppointments: appointments.slice(0, 5), revenueThisMonth: completed.reduce((sum, item) => sum + item.price, 0), bookingsThisMonth: appointments.length, newCustomers: new Set(appointments.map((item) => item.customerName)).size, rating: salon.rating / 10, revenueChange: 12, loyalty: loyaltyData }));
});

router.get("/salon/profile", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const [homeService, openSunday] = await Promise.all([
    salonHasActiveHomeService(salon.id),
    db.select({ id: salonHoursTable.id }).from(salonHoursTable)
      .where(and(eq(salonHoursTable.salonId, salon.id), eq(salonHoursTable.weekday, 7), eq(salonHoursTable.closed, false))).limit(1),
  ]);
  res.json(GetManagedSalonProfileResponse.parse({
    id: salon.id,
    name: salon.name,
    slug: salon.slug,
    videoUrl: salon.videoUrl,
    acceptsCards: salon.acceptsCards,
    instantBooking: salon.instantBooking,
    homeService,
    homeServiceRadiusKm: salon.homeServiceRadiusKm,
    servesMen: salon.servesMen,
    openSunday: openSunday.length > 0,
  }));
});

router.patch("/salon/profile", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  if (req.body && typeof req.body === "object" && Object.prototype.hasOwnProperty.call(req.body, "homeService")) {
    res.status(400).json({ error: "Dostupnost dolaska se podešava kroz aktivne usluge." });
    return;
  }
  const parsed = UpdateManagedSalonProfileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (parsed.data.videoUrl !== undefined && !isHttpVideoUrl(parsed.data.videoUrl)) { res.status(400).json({ error: "Video URL mora početi sa http:// ili https://." }); return; }
  const updates: Partial<typeof salonsTable.$inferInsert> = {};
  if (parsed.data.videoUrl !== undefined) updates.videoUrl = parsed.data.videoUrl;
  if (parsed.data.acceptsCards !== undefined) updates.acceptsCards = parsed.data.acceptsCards;
  if (parsed.data.instantBooking !== undefined) updates.instantBooking = parsed.data.instantBooking;
  if (parsed.data.homeServiceRadiusKm !== undefined) updates.homeServiceRadiusKm = Math.max(1, Math.min(100, Math.round(parsed.data.homeServiceRadiusKm)));
  if (parsed.data.servesMen !== undefined) {
    updates.servesMen = parsed.data.servesMen;
    updates.servesMenManuallySet = true;
  }
  if (!Object.keys(updates).length) { res.status(400).json({ error: "Izaberite najmanje jedno podešavanje za izmenu." }); return; }
  const homeService = await salonHasActiveHomeService(access.salon.id);
  updates.homeService = homeService;
  const [updated] = await db.update(salonsTable)
    .set(updates)
    .where(eq(salonsTable.id, access.salon.id))
    .returning();
  res.json(GetManagedSalonProfileResponse.parse({
    id: updated!.id,
    name: updated!.name,
    slug: updated!.slug,
    videoUrl: updated!.videoUrl,
    acceptsCards: updated!.acceptsCards,
    instantBooking: updated!.instantBooking,
    homeService,
    homeServiceRadiusKm: updated!.homeServiceRadiusKm,
    servesMen: updated!.servesMen,
    openSunday: (await db.select({ id: salonHoursTable.id }).from(salonHoursTable)
      .where(and(eq(salonHoursTable.salonId, updated!.id), eq(salonHoursTable.weekday, 7), eq(salonHoursTable.closed, false))).limit(1)).length > 0,
  }));
});

router.get("/salon/managed-salons", async (req, res): Promise<void> => {
  const user = await current(req, res);
  if (!user) return;
  if (user.role !== "SALON_OWNER") { res.status(403).json({ error: "Ova funkcija je dostupna samo vlasnicima salona." }); return; }
  const salons = await db.select({ id: salonsTable.id, name: salonsTable.name, slug: salonsTable.slug }).from(salonsTable).where(eq(salonsTable.ownerId, user.id)).orderBy(asc(salonsTable.name));
  res.json({ activeSalonId: (await db.select({ activeSalonId: usersTable.activeSalonId }).from(usersTable).where(eq(usersTable.id, user.id)).limit(1))[0]?.activeSalonId ?? salons[0]?.id ?? null, salons });
});

router.put("/salon/active-salon", async (req, res): Promise<void> => {
  const user = await current(req, res);
  if (!user) return;
  if (user.role !== "SALON_OWNER" || typeof req.body?.salonId !== "string") { res.status(400).json({ error: "Izaberite salon." }); return; }
  const [salon] = await db.select({ id: salonsTable.id }).from(salonsTable).where(and(eq(salonsTable.id, req.body.salonId), eq(salonsTable.ownerId, user.id))).limit(1);
  if (!salon) { res.status(404).json({ error: "Salon nije dostupan ovom nalogu." }); return; }
  await db.update(usersTable).set({ activeSalonId: salon.id, updatedAt: new Date() }).where(eq(usersTable.id, user.id));
  res.json({ activeSalonId: salon.id });
});

router.get("/salon/appointments", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const parseQueryDate = (value: unknown) => typeof value === "string" ? new Date(`${value}T12:00:00.000Z`) : value;
  const parsed = ListSalonAppointmentsQueryParams.safeParse({ ...req.query, from: parseQueryDate(req.query.from), to: parseQueryDate(req.query.to) });
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let items = await appointmentList(eq(appointmentsTable.salonId, salon.id), true);
  if (parsed.data.status) items = items.filter((item) => item.status === parsed.data.status);
  if (parsed.data.from) items = items.filter((item) => item.date >= calendarDate(parsed.data.from!));
  if (parsed.data.to) items = items.filter((item) => item.date <= calendarDate(parsed.data.to!));
  res.json(ListSalonAppointmentsResponse.parse(items));
});

router.get("/salon/customers", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const [contacts, appointments, series, services] = await Promise.all([
    db.select().from(salonCustomersTable).where(eq(salonCustomersTable.salonId, access.salon.id)).orderBy(asc(salonCustomersTable.lastName), asc(salonCustomersTable.firstName)),
    db.select().from(appointmentsTable).where(eq(appointmentsTable.salonId, access.salon.id)),
    db.select().from(appointmentSeriesTable).where(eq(appointmentSeriesTable.salonId, access.salon.id)),
    db.select().from(servicesTable).where(eq(servicesTable.salonId, access.salon.id)),
  ]);
  res.json(ListSalonCustomersResponse.parse(contacts.map((contact) => ({
    id: contact.id, firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone,
    smsOptOut: contact.smsOptOut, visitCount: appointments.filter((item) => item.salonCustomerId === contact.id).length,
    noShowCount: appointments.filter((item) => item.salonCustomerId === contact.id && item.status === "no-show").length, isRegistered: Boolean(contact.userId),
    series: series.filter((item) => item.salonCustomerId === contact.id).map((item) => {
      const members = appointments.filter((appointment) => appointment.seriesId === item.id);
      return {
        id: item.id, serviceName: services.find((service) => service.id === item.serviceId)?.name ?? "Usluga",
        totalAppointments: item.totalAppointments,
        completedAppointments: members.filter((appointment) => appointment.status === "completed").length,
        upcomingAppointments: members.filter((appointment) => appointment.date >= new Date().toISOString().slice(0, 10) && ["pending", "confirmed"].includes(appointment.status)).length,
      };
    }),
  }))));
});

router.patch("/salon/customers/:customerId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const [params, body] = [UpdateSalonCustomerParams.safeParse(req.params), UpdateSalonCustomerBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci za CRM klijenta nisu ispravni." }); return; }
  const [contact] = await db.update(salonCustomersTable).set({ smsOptOut: body.data.smsOptOut, updatedAt: new Date() })
    .where(and(eq(salonCustomersTable.id, params.data.customerId), eq(salonCustomersTable.salonId, access.salon.id))).returning();
  if (!contact) { res.status(404).json({ error: "CRM klijent nije pronađen." }); return; }
  const appointments = await db.select({ id: appointmentsTable.id }).from(appointmentsTable).where(eq(appointmentsTable.salonCustomerId, contact.id));
  res.json(UpdateSalonCustomerResponse.parse({
    id: contact.id, firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone,
    smsOptOut: contact.smsOptOut, visitCount: appointments.length, noShowCount: (await db.select({ id: appointmentsTable.id }).from(appointmentsTable).where(and(eq(appointmentsTable.salonCustomerId, contact.id), eq(appointmentsTable.status, "no-show")))).length, isRegistered: Boolean(contact.userId),
  }));
});

router.post("/salon/appointments", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const parsed = CreateSalonAppointmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { salon } = access;
  if (Boolean(parsed.data.salonCustomerId) === Boolean(parsed.data.guest)) {
    res.status(400).json({ error: "Izaberite CRM klijenta ili unesite podatke novog gosta." }); return;
  }
  const [service] = await db.select().from(servicesTable).where(and(eq(servicesTable.id, parsed.data.serviceId), eq(servicesTable.salonId, salon.id), eq(servicesTable.active, true))).limit(1);
  if (!service) { res.status(404).json({ error: "Usluga nije pronađena u ovom salonu." }); return; }
  const date = calendarDate(parsed.data.date);
  const endTime = appointmentEndTime(parsed.data.startTime, service.durationMinutes);
  if (!endTime) { res.status(400).json({ error: "Trajanje termina izlazi van radnog dana." }); return; }
  let contact: typeof salonCustomersTable.$inferSelect | undefined;
  if (parsed.data.salonCustomerId) {
    contact = (await db.select().from(salonCustomersTable).where(and(eq(salonCustomersTable.id, parsed.data.salonCustomerId), eq(salonCustomersTable.salonId, salon.id))).limit(1))[0];
    if (!contact) { res.status(404).json({ error: "CRM klijent ne pripada ovom salonu." }); return; }
  } else {
    const submittedPhone = normalizedPhone(parsed.data.guest!.phone);
    const contacts = await db.select().from(salonCustomersTable).where(eq(salonCustomersTable.salonId, salon.id));
    const [registeredUser] = await db.select().from(usersTable).where(eq(usersTable.phoneNormalized, submittedPhone)).limit(1);
    contact = contacts.find((item) => item.phoneNormalized === submittedPhone || (item.phone && normalizedPhone(item.phone) === submittedPhone));
    if (!contact) {
      [contact] = await db.insert(salonCustomersTable).values({
        salonId: salon.id, firstName: parsed.data.guest!.firstName.trim(), lastName: parsed.data.guest!.lastName.trim(),
        phone: parsed.data.guest!.phone.trim(), phoneNormalized: submittedPhone, userId: registeredUser?.id ?? null, email: parsed.data.guest!.email?.trim().toLowerCase() || null,
      }).returning();
    } else if (registeredUser && contact.userId !== registeredUser.id) {
      [contact] = await db.update(salonCustomersTable).set({ userId: registeredUser.id, phoneNormalized: submittedPhone, updatedAt: new Date() }).where(eq(salonCustomersTable.id, contact.id)).returning();
      await db.update(appointmentsTable).set({ customerId: registeredUser.id }).where(eq(appointmentsTable.salonCustomerId, contact!.id));
    }
  }
  const allocation = await createAllocatedAppointment({
    salonId: salon.id,
    customerId: contact!.userId,
    salonCustomerId: contact!.id,
    serviceId: service.id,
    date,
    startTime: parsed.data.startTime,
    endTime,
    durationMinutes: service.durationMinutes,
    price: service.promoPrice ?? service.price,
    status: "confirmed",
    notes: parsed.data.notes ?? null,
    preferredEmployeeId: parsed.data.employeeId,
  });
  if (!allocation.appointment || !allocation.employee) {
    res.status(409).json({ error: "Nema dostupnog zaposlenog za ovaj termin." });
    return;
  }
  const { appointment, employee } = allocation;
  await sendSms({
    eventKey: `appointment-confirmation:${appointment.id}`, salonId: salon.id, appointmentId: appointment.id,
    type: "appointment_confirmation", phone: contact!.phone, smsOptOut: contact!.smsOptOut,
    text: `LUMERA: termin u salonu ${salon.name} je zakazan za ${date} u ${appointment.startTime}.`,
  });
  const response = appointmentView(appointment, salon, service, contact!, employee, true);
  CreateSalonAppointmentResponse.parse(response);
  res.status(201).json(response);
});

router.post("/salon/appointment-series/preview", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const parsed = PreviewSalonAppointmentSeriesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Podaci za pregled serije nisu ispravni." }); return; }
  const [service] = await db.select().from(servicesTable).where(and(eq(servicesTable.id, parsed.data.serviceId), eq(servicesTable.salonId, access.salon.id), eq(servicesTable.active, true))).limit(1);
  if (!service) { res.status(404).json({ error: "Usluga nije pronađena u ovom salonu." }); return; }
  if (parsed.data.employeeId && !(await employeeInSalon(parsed.data.employeeId, access.salon.id))) {
    res.status(403).json({ error: "Zaposleni pripada drugom salonu." }); return;
  }
  try {
    const slots = prepareSeriesSlots(parsed.data.slots, service.durationMinutes);
    const response = PreviewSalonAppointmentSeriesResponse.parse(
      await previewSeriesSlots(access.salon.id, service.id, slots, parsed.data.employeeId),
    );
    res.json({
      ...response,
      slots: response.slots.map((slot) => ({ ...slot, date: calendarDate(slot.date) })),
    });
  } catch (error) {
    const message = error instanceof AppointmentSeriesError ? error.message : "Pregled serije nije uspeo.";
    res.status(error instanceof AppointmentSeriesError ? error.status : 500).json({ error: message });
  }
});

router.post("/salon/appointment-series", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const parsed = CreateSalonAppointmentSeriesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Podaci za seriju termina nisu ispravni." }); return; }
  if (Boolean(parsed.data.salonCustomerId) === Boolean(parsed.data.guest)) {
    res.status(400).json({ error: "Izaberite CRM klijenta ili unesite podatke novog gosta." }); return;
  }
  const [service] = await db.select().from(servicesTable).where(and(eq(servicesTable.id, parsed.data.serviceId), eq(servicesTable.salonId, access.salon.id), eq(servicesTable.active, true))).limit(1);
  if (!service) { res.status(404).json({ error: "Usluga nije pronađena u ovom salonu." }); return; }
  if (parsed.data.employeeId && !(await employeeInSalon(parsed.data.employeeId, access.salon.id))) {
    res.status(403).json({ error: "Zaposleni pripada drugom salonu." }); return;
  }
  let contact: typeof salonCustomersTable.$inferSelect | undefined;
  if (parsed.data.salonCustomerId) {
    contact = (await db.select().from(salonCustomersTable).where(and(eq(salonCustomersTable.id, parsed.data.salonCustomerId), eq(salonCustomersTable.salonId, access.salon.id))).limit(1))[0];
    if (!contact) { res.status(404).json({ error: "CRM klijent ne pripada ovom salonu." }); return; }
  } else {
    const phone = normalizedPhone(parsed.data.guest!.phone);
    if (!phone) { res.status(400).json({ error: "Unesite ispravan broj telefona klijenta." }); return; }
    const [registered] = await db.select().from(usersTable).where(eq(usersTable.phoneNormalized, phone)).limit(1);
    const contacts = await db.select().from(salonCustomersTable).where(eq(salonCustomersTable.salonId, access.salon.id));
    contact = contacts.find((item) => item.phoneNormalized === phone || (item.phone && normalizedPhone(item.phone) === phone));
    if (!contact) {
      [contact] = await db.insert(salonCustomersTable).values({
        salonId: access.salon.id, firstName: parsed.data.guest!.firstName.trim(), lastName: parsed.data.guest!.lastName.trim(),
        phone: parsed.data.guest!.phone.trim(), phoneNormalized: phone, userId: registered?.id ?? null, email: parsed.data.guest!.email?.trim().toLowerCase() || null,
      }).returning();
    }
  }
  try {
    const slots = prepareSeriesSlots(parsed.data.slots, service.durationMinutes);
    const created = await createAppointmentSeries({
      salonId: access.salon.id, customerId: contact!.userId, salonCustomerId: contact!.id, service, slots,
      createdByUserId: access.user.id, notes: parsed.data.notes ?? null, preferredEmployeeId: parsed.data.employeeId,
    });
    const employeeIds = [...new Set(created.appointments.flatMap((item) => item.employeeId ? [item.employeeId] : []))];
    const employees = employeeIds.length ? await db.select().from(employeesTable).where(inArray(employeesTable.id, employeeIds)) : [];
    const views = created.appointments.map((appointment) => appointmentView(appointment, access.salon, service, contact!, employees.find((employee) => employee.id === appointment.employeeId), true));
    await sendSeriesConfirmations({ appointments: created.appointments, contact: contact!, salon: access.salon });
    const response = { id: created.series.id, totalAppointments: created.appointments.length, appointments: views };
    CreateSalonAppointmentSeriesResponse.parse(response);
    res.status(201).json(response);
  } catch (error) {
    const message = error instanceof AppointmentSeriesError ? error.message : "Serija termina nije sačuvana.";
    res.status(error instanceof AppointmentSeriesError ? error.status : 500).json({ error: message });
  }
});

router.delete("/salon/appointment-series/:seriesId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const params = CancelSalonAppointmentSeriesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Serija termina nije ispravna." }); return; }
  const result = await db.transaction(async (tx) => {
    await lockAppointmentResources(tx, access.salon.id);
    const [series] = await tx.select().from(appointmentSeriesTable).where(and(
      eq(appointmentSeriesTable.id, params.data.seriesId),
      eq(appointmentSeriesTable.salonId, access.salon.id),
    )).limit(1);
    if (!series) return { error: "not-found" as const };
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = await tx.select({
      date: appointmentsTable.date,
      employeeId: appointmentsTable.employeeId,
    }).from(appointmentsTable).where(and(
      eq(appointmentsTable.seriesId, series.id),
      sql`${appointmentsTable.date} >= ${today}`,
      inArray(appointmentsTable.status, ["pending", "confirmed"]),
    ));
    await lockAppointmentResources(tx, access.salon.id, upcoming);
    const cancelled = await tx.update(appointmentsTable).set({
      status: "cancelled",
      cancellationReason: "Otkazana preostala serija termina.",
    }).where(and(
      eq(appointmentsTable.seriesId, series.id),
      sql`${appointmentsTable.date} >= ${today}`,
      inArray(appointmentsTable.status, ["pending", "confirmed"]),
    )).returning({ id: appointmentsTable.id });
    return { series, cancelled };
  });
  if ("error" in result) { res.status(404).json({ error: "Serija termina nije pronađena." }); return; }
  const { series, cancelled } = result;
  res.json(CancelSalonAppointmentSeriesResponse.parse({ id: series.id, cancelledAppointments: cancelled.length }));
});

router.post("/salon/appointment-series/:seriesId/move/preview", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const [params, body] = [PreviewSalonAppointmentSeriesMoveParams.safeParse(req.params), PreviewSalonAppointmentSeriesMoveBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci za pomeranje serije nisu ispravni." }); return; }
  const [series] = await db.select().from(appointmentSeriesTable).where(and(
    eq(appointmentSeriesTable.id, params.data.seriesId),
    eq(appointmentSeriesTable.salonId, access.salon.id),
  )).limit(1);
  if (!series) { res.status(404).json({ error: "Serija termina nije pronađena." }); return; }
  const appointments = futureUnfinishedSeriesAppointments(await db.select().from(appointmentsTable).where(and(
    eq(appointmentsTable.salonId, access.salon.id),
    eq(appointmentsTable.seriesId, series.id),
  )));
  if (!appointments.length) { res.status(409).json({ error: "U ovoj seriji nema budućih nezavršenih termina za pomeranje." }); return; }
  try {
    const slots = prepareSeriesMoveSlots(appointments, body.data);
    const response = PreviewSalonAppointmentSeriesMoveResponse.parse(
      await previewSeriesMove(db, access.salon.id, slots),
    );
    res.json({
      ...response,
      slots: response.slots.map((slot) => ({
        ...slot,
        currentDate: calendarDate(slot.currentDate),
        date: calendarDate(slot.date),
      })),
    });
  } catch (error) {
    const message = error instanceof AppointmentSeriesError ? error.message : "Pregled pomeranja serije nije uspeo.";
    res.status(error instanceof AppointmentSeriesError ? error.status : 500).json({ error: message });
  }
});

router.post("/salon/appointment-series/:seriesId/move", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const [params, body] = [MoveSalonAppointmentSeriesParams.safeParse(req.params), MoveSalonAppointmentSeriesBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci za pomeranje serije nisu ispravni." }); return; }
  const [series] = await db.select().from(appointmentSeriesTable).where(and(
    eq(appointmentSeriesTable.id, params.data.seriesId),
    eq(appointmentSeriesTable.salonId, access.salon.id),
  )).limit(1);
  if (!series) { res.status(404).json({ error: "Serija termina nije pronađena." }); return; }
  try {
    const [contact] = series.salonCustomerId
      ? await db.select().from(salonCustomersTable).where(and(eq(salonCustomersTable.id, series.salonCustomerId), eq(salonCustomersTable.salonId, access.salon.id))).limit(1)
      : [];
    const moveEventId = randomUUID();
    const moved = await moveAppointmentSeries({ salonId: access.salon.id, seriesId: series.id, move: body.data, contact: contact ?? null, salon: access.salon, moveEventId });
    if (contact) {
      await sendSeriesUpdates({ appointments: moved, contact, salon: access.salon, moveEventId });
      await runRescheduledConfirmationRetries();
    }
    const views = await appointmentList(and(eq(appointmentsTable.salonId, access.salon.id), inArray(appointmentsTable.id, moved.map((appointment) => appointment.id))), true);
    const viewById = new Map(views.map((appointment) => [appointment.id, appointment]));
    const response = {
      id: series.id,
      movedAppointments: moved.length,
      appointments: moved.map((appointment) => viewById.get(appointment.id)!),
    };
    MoveSalonAppointmentSeriesResponse.parse(response);
    res.json(response);
  } catch (error) {
    const message = error instanceof AppointmentSeriesError ? error.message : "Pomeranje serije nije uspelo.";
    res.status(error instanceof AppointmentSeriesError ? error.status : 500).json({ error: message });
  }
});

router.patch("/salon/appointments/:appointmentId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const [params, body] = [UpdateSalonAppointmentParams.safeParse(req.params), UpdateSalonAppointmentBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci za izmenu nisu ispravni." }); return; }
  const result = await db.transaction(async (tx) => {
    await lockAppointmentResources(tx, salon.id);
    if (body.data.employeeId) {
      const [requestedEmployee] = await tx.select({ id: employeesTable.id }).from(employeesTable).where(and(
        eq(employeesTable.id, body.data.employeeId),
        eq(employeesTable.salonId, salon.id),
      )).limit(1);
      if (!requestedEmployee) return { error: "foreign-employee" as const };
    }
    const [target] = await tx.select().from(appointmentsTable).where(and(
      eq(appointmentsTable.id, params.data.appointmentId),
      eq(appointmentsTable.salonId, salon.id),
    )).for("update").limit(1);
    if (!target) return { error: "not-found" as const };
    const employeeId = body.data.employeeId ?? target.employeeId;
    const status = body.data.status ?? target.status;
    await lockAppointmentResources(tx, salon.id, [
      { date: target.date, employeeId: target.employeeId },
      { date: target.date, employeeId },
    ]);
    if (employeeId && status !== "cancelled") {
      const [service] = await tx.select().from(servicesTable).where(eq(servicesTable.id, target.serviceId)).limit(1);
      const employee = service
        ? await availableEmployeeWithDb(tx, salon.id, service.id, target.date, target.startTime, target.endTime, employeeId, [], new Set([target.id]))
        : null;
      if (!employee) return { error: "unavailable" as const };
      await lockAppointmentResources(tx, salon.id, [{ date: target.date, employeeId: employee.id }]);
    }
    const [updated] = await tx.update(appointmentsTable).set({
      status: body.data.status,
      employeeId: body.data.employeeId,
      notes: body.data.notes === "" ? null : body.data.notes,
    }).where(and(
      eq(appointmentsTable.id, target.id),
      eq(appointmentsTable.salonId, salon.id),
    )).returning();
    return updated ? { updated } : { error: "changed" as const };
  });
  if ("error" in result) {
    res.status(result.error === "not-found" ? 404 : result.error === "foreign-employee" ? 403 : 409).json({
      error: result.error === "not-found" ? "Termin nije pronađen."
        : result.error === "foreign-employee" ? "Zaposleni pripada drugom salonu."
          : result.error === "unavailable" ? "Izabrani zaposleni nije slobodan za ovaj termin."
            : "Termin je u međuvremenu promenjen.",
    });
    return;
  }
  const { updated } = result;
  const view = (await appointmentList(and(eq(appointmentsTable.id, updated.id), eq(appointmentsTable.salonId, salon.id)), true))[0];
  UpdateSalonAppointmentResponse.parse(view);
  res.json(view);
});

router.get("/salon/services", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const services = await db.select().from(servicesTable).where(eq(servicesTable.salonId, salon.id));
  res.json(ListSalonServicesResponse.parse(services.map((item) => ({ id: item.id, category: item.categoryName, name: item.name, description: item.description, durationMinutes: item.durationMinutes, price: item.price, promoPrice: item.promoPrice, imageUrl: item.imageUrl, active: item.active, homeServiceAvailable: item.homeServiceAvailable, homeServiceFee: item.homeServiceFee, homeServiceMinimumOrder: item.homeServiceMinimumOrder }))));
});

const serviceTemplateDto = (item: typeof serviceTemplatesTable.$inferSelect) => ({
  id: item.id, name: item.name, mainCategory: item.mainCategory, subcategory: item.subcategory,
  typicalDurationMinutes: item.typicalDurationMinutes, priceMin: item.priceMin, priceMax: item.priceMax,
  description: item.description, active: item.active,
});

const salonServiceDto = (item: typeof servicesTable.$inferSelect) => ({
  id: item.id, category: item.categoryName, name: item.name, description: item.description,
  durationMinutes: item.durationMinutes, price: item.price, promoPrice: item.promoPrice, imageUrl: item.imageUrl,
  active: item.active, homeServiceAvailable: item.homeServiceAvailable, homeServiceFee: item.homeServiceFee,
  homeServiceMinimumOrder: item.homeServiceMinimumOrder,
});

router.get("/service-templates", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const parsed = ListServiceTemplatesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const input = parsed.data;
  const templates = await db.select().from(serviceTemplatesTable)
    .where(and(
      eq(serviceTemplatesTable.active, true),
      input.mainCategory ? eq(serviceTemplatesTable.mainCategory, input.mainCategory) : undefined,
      input.subcategory ? eq(serviceTemplatesTable.subcategory, input.subcategory) : undefined,
      input.search ? sql`lower(${serviceTemplatesTable.name} || ' ' || ${serviceTemplatesTable.mainCategory} || ' ' || ${serviceTemplatesTable.subcategory}) like ${`%${input.search.toLowerCase()}%`}` : undefined,
    )).orderBy(asc(serviceTemplatesTable.mainCategory), asc(serviceTemplatesTable.subcategory), asc(serviceTemplatesTable.name));
  res.json(ListServiceTemplatesResponse.parse(templates.map(serviceTemplateDto)));
});

router.post("/salon/services/from-templates", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const parsed = CreateSalonServicesBatchBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const uniqueIds = [...new Set(parsed.data.items.map((item) => item.templateId))];
  if (uniqueIds.length !== parsed.data.items.length) { res.status(400).json({ error: "Svaki predložak može biti izabran samo jednom." }); return; }
  const templates = await db.select().from(serviceTemplatesTable).where(and(inArray(serviceTemplatesTable.id, uniqueIds), eq(serviceTemplatesTable.active, true)));
  if (templates.length !== uniqueIds.length) { res.status(400).json({ error: "Neki izabrani predlošci nisu dostupni." }); return; }
  const categories = await db.select().from(serviceCategoriesTable);
  const categoryByName = new Map(categories.map((category) => [category.name, category]));
  const existing = await db.select({ name: servicesTable.name, categoryName: servicesTable.categoryName }).from(servicesTable)
    .where(eq(servicesTable.salonId, access.salon.id));
  const existingKeys = new Set(existing.map((item) => `${item.categoryName}:${item.name}`));
  const byId = new Map(templates.map((item) => [item.id, item]));
  const toCreate = parsed.data.items.flatMap((item) => {
    const template = byId.get(item.templateId)!;
    if (existingKeys.has(`${template.mainCategory}:${template.name}`)) return [];
    const category = categoryByName.get(template.mainCategory);
    return [{
      salonId: access.salon.id, categoryId: category?.id ?? null, categoryName: template.mainCategory,
      name: template.name, description: template.description ?? `Stručno izveden tretman: ${template.name}.`,
      durationMinutes: item.durationMinutes ?? template.typicalDurationMinutes, price: item.price,
      promoPrice: null, tags: [template.mainCategory, template.subcategory], packageTreatments: null,
      imageUrl: "/lumera-media/product-1.jpg", active: true,
    }];
  });
  const created = toCreate.length ? await db.insert(servicesTable).values(toCreate).returning() : [];
  res.status(201).json(CreateSalonServicesBatchResponse.parse({
    created: created.map(salonServiceDto),
    skipped: parsed.data.items.filter((item) => {
      const template = byId.get(item.templateId)!;
      return existingKeys.has(`${template.mainCategory}:${template.name}`);
    }).map((item) => byId.get(item.templateId)!.name),
  }));
});

router.post("/salon/services", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const parsed = CreateSalonServiceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [category] = await db.select().from(serviceCategoriesTable).where(eq(serviceCategoriesTable.name, parsed.data.category)).limit(1);
  const [service] = await db.insert(servicesTable).values({ ...parsed.data, salonId: salon.id, categoryId: category?.id ?? null, categoryName: parsed.data.category, promoPrice: parsed.data.promoPrice ?? null, homeServiceMinimumOrder: parsed.data.homeServiceMinimumOrder ?? null }).returning();
  await db.update(salonsTable).set({ homeService: await salonHasActiveHomeService(salon.id) }).where(eq(salonsTable.id, salon.id));
  res.status(201).json(CreateSalonServiceResponse.parse({ id: service!.id, category: service!.categoryName, name: service!.name, description: service!.description, durationMinutes: service!.durationMinutes, price: service!.price, promoPrice: service!.promoPrice, imageUrl: service!.imageUrl, active: service!.active, homeServiceAvailable: service!.homeServiceAvailable, homeServiceFee: service!.homeServiceFee, homeServiceMinimumOrder: service!.homeServiceMinimumOrder }));
});

router.patch("/salon/services/:serviceId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const parsed = CreateSalonServiceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [service] = await db.update(servicesTable).set({
    categoryName: parsed.data.category, name: parsed.data.name, description: parsed.data.description,
    durationMinutes: parsed.data.durationMinutes, price: parsed.data.price, promoPrice: parsed.data.promoPrice ?? null,
    imageUrl: parsed.data.imageUrl, active: parsed.data.active,
    homeServiceAvailable: parsed.data.homeServiceAvailable, homeServiceFee: parsed.data.homeServiceFee, homeServiceMinimumOrder: parsed.data.homeServiceMinimumOrder ?? null,
  }).where(and(eq(servicesTable.id, req.params.serviceId), eq(servicesTable.salonId, access.salon.id))).returning();
  if (!service) { res.status(404).json({ error: "Usluga nije pronađena." }); return; }
  await db.update(salonsTable).set({ homeService: await salonHasActiveHomeService(access.salon.id) }).where(eq(salonsTable.id, access.salon.id));
  res.json(CreateSalonServiceResponse.parse({ id: service.id, category: service.categoryName, name: service.name, description: service.description, durationMinutes: service.durationMinutes, price: service.price, promoPrice: service.promoPrice, imageUrl: service.imageUrl, active: service.active, homeServiceAvailable: service.homeServiceAvailable, homeServiceFee: service.homeServiceFee, homeServiceMinimumOrder: service.homeServiceMinimumOrder }));
});

router.get("/salon/employees", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const [employees, services, links, users] = await Promise.all([
    db.select().from(employeesTable).where(and(eq(employeesTable.salonId, salon.id), eq(employeesTable.active, true))),
    db.select().from(servicesTable).where(eq(servicesTable.salonId, salon.id)),
    db.select().from(employeeServicesTable),
    db.select().from(usersTable).where(eq(usersTable.role, "SALON_EMPLOYEE")),
  ]);
  res.json(employees.map((item) => {
    const serviceIds = links.filter((link) => link.employeeId === item.id).map((link) => link.serviceId);
    const account = users.find((user) => user.id === item.userId);
    return {
      id: item.id, name: item.name, role: item.role, bio: item.bio, avatarUrl: item.avatarUrl, email: item.email,
      specialties: item.specialties, serviceIds, serviceNames: services.filter((service) => serviceIds.includes(service.id)).map((service) => service.name),
      account: account ? { active: account.active, email: account.email, mustChangePassword: account.mustChangePassword } : null,
    };
  }));
});

async function employeeDeactivationPreview(employee: typeof employeesTable.$inferSelect) {
  const [future] = await db.select({ count: count() }).from(appointmentsTable).where(and(
    eq(appointmentsTable.employeeId, employee.id),
    gte(appointmentsTable.date, new Date().toISOString().slice(0, 10)),
    ne(appointmentsTable.status, "cancelled"),
  ));
  return {
    employeeId: employee.id,
    employeeName: employee.name,
    futureAppointmentCount: Number(future?.count ?? 0),
    hasLoginAccount: Boolean(employee.userId),
  };
}

router.get("/salon/employees/:employeeId/deactivation-preview", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const employee = await employeeInSalon(req.params.employeeId, access.salon.id);
  if (!employee) { res.status(404).json({ error: "Zaposleni nije pronađen." }); return; }
  res.json(await employeeDeactivationPreview(employee));
});

router.post("/salon/employees/:employeeId/deactivate", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const employee = await employeeInSalon(req.params.employeeId, access.salon.id);
  if (!employee) { res.status(404).json({ error: "Zaposleni nije pronađen." }); return; }
  if (!employee.active) { res.status(409).json({ error: "Zaposleni je već deaktiviran." }); return; }
  const preview = await employeeDeactivationPreview(employee);
  await db.transaction(async (tx) => {
    await tx.update(employeesTable).set({ active: false }).where(eq(employeesTable.id, employee.id));
    if (employee.userId) {
      await tx.update(usersTable).set({ active: false, updatedAt: new Date() }).where(and(
        eq(usersTable.id, employee.userId),
        eq(usersTable.role, "SALON_EMPLOYEE"),
      ));
      await tx.delete(sessionsTable).where(eq(sessionsTable.userId, employee.userId));
    }
  });
  res.json({ employeeId: employee.id, deactivated: true, futureAppointmentCount: preview.futureAppointmentCount, loginAccountDeactivated: Boolean(employee.userId) });
});

router.post("/salon/employees", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const body = req.body as { name?: unknown; role?: unknown; bio?: unknown; avatarUrl?: unknown; email?: unknown; specialties?: unknown; serviceIds?: unknown };
  if (typeof body.name !== "string" || !body.name.trim() || typeof body.role !== "string" || !body.role.trim()) { res.status(400).json({ error: "Ime i uloga zaposlenog su obavezni." }); return; }
  const serviceIds = Array.isArray(body.serviceIds) ? body.serviceIds.filter((item): item is string => typeof item === "string") : [];
  const services = serviceIds.length ? await db.select().from(servicesTable).where(and(eq(servicesTable.salonId, access.salon.id), inArray(servicesTable.id, serviceIds))) : [];
  if (services.length !== serviceIds.length) { res.status(400).json({ error: "Sve dodeljene usluge moraju pripadati vašem salonu." }); return; }
  const [employee] = await db.insert(employeesTable).values({
    salonId: access.salon.id, name: body.name.trim(), role: body.role.trim(), bio: typeof body.bio === "string" ? body.bio.trim() : "",
    avatarUrl: typeof body.avatarUrl === "string" ? body.avatarUrl.trim() : "",
    email: typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : null,
    specialties: Array.isArray(body.specialties) ? body.specialties.filter((item): item is string => typeof item === "string") : [],
  }).returning();
  if (serviceIds.length) await db.insert(employeeServicesTable).values(serviceIds.map((serviceId) => ({ employeeId: employee!.id, serviceId })));
  res.status(201).json({ id: employee!.id });
});

router.patch("/salon/employees/:employeeId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const body = req.body as { name?: unknown; role?: unknown; bio?: unknown; avatarUrl?: unknown; email?: unknown; specialties?: unknown; serviceIds?: unknown; active?: unknown };
  const employee = await employeeInSalon(req.params.employeeId, access.salon.id);
  if (!employee) { res.status(404).json({ error: "Zaposleni nije pronađen." }); return; }
  if (!employee.active) { res.status(409).json({ error: "Deaktivirani zaposleni ne može dobiti pristupni nalog." }); return; }
  const serviceIds = Array.isArray(body.serviceIds) ? body.serviceIds.filter((item): item is string => typeof item === "string") : null;
  if (serviceIds) {
    const services = serviceIds.length ? await db.select().from(servicesTable).where(and(eq(servicesTable.salonId, access.salon.id), inArray(servicesTable.id, serviceIds))) : [];
    if (services.length !== serviceIds.length) { res.status(400).json({ error: "Sve dodeljene usluge moraju pripadati vašem salonu." }); return; }
    await db.delete(employeeServicesTable).where(eq(employeeServicesTable.employeeId, employee.id));
    if (serviceIds.length) await db.insert(employeeServicesTable).values(serviceIds.map((serviceId) => ({ employeeId: employee.id, serviceId })));
  }
  await db.update(employeesTable).set({
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : employee.name,
    role: typeof body.role === "string" && body.role.trim() ? body.role.trim() : employee.role,
    bio: typeof body.bio === "string" ? body.bio.trim() : employee.bio,
    avatarUrl: typeof body.avatarUrl === "string" ? body.avatarUrl.trim() : employee.avatarUrl,
    email: typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : employee.email,
    specialties: Array.isArray(body.specialties) ? body.specialties.filter((item): item is string => typeof item === "string") : employee.specialties,
    active: typeof body.active === "boolean" ? body.active : employee.active,
  }).where(eq(employeesTable.id, employee.id));
  res.json({ id: employee.id });
});

router.post("/salon/employees/:employeeId/access", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const employee = await employeeInSalon(req.params.employeeId, access.salon.id);
  if (!employee) { res.status(404).json({ error: "Zaposleni nije pronađen." }); return; }
  if (employee.userId) { res.status(409).json({ error: "Zaposleni već ima aktivan nalog. Koristite reset lozinke." }); return; }
  const fallback = `${employee.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/(^\.|\.$)/g, "") || "zaposleni"}.${employee.id.slice(0, 6)}@lumera.local`;
  const email = (employee.email || fallback).toLowerCase();
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) { res.status(409).json({ error: "Ovaj e-mail je već povezan sa drugim nalogom. Izmenite e-mail zaposlenog." }); return; }
  const [firstName, ...rest] = employee.name.trim().split(/\s+/);
  const temporary = temporaryPassword();
  const [account] = await db.insert(usersTable).values({
    firstName: firstName || "Zaposleni",
    lastName: rest.join(" ") || "LUMERA",
    email,
    passwordHash: await hashPassword(temporary),
    passwordSetAt: new Date(),
    mustChangePassword: true,
    role: "SALON_EMPLOYEE",
  }).returning();
  await db.update(employeesTable).set({ userId: account!.id, email }).where(eq(employeesTable.id, employee.id));
  res.status(201).json({ email, temporaryPassword: temporary, mustChangePassword: true });
});

router.post("/salon/employees/:employeeId/access/reset-password", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const employee = await employeeInSalon(req.params.employeeId, access.salon.id);
  if (!employee?.userId) { res.status(404).json({ error: "Zaposleni nema povezan nalog." }); return; }
  const [account] = await db.select().from(usersTable)
    .where(and(eq(usersTable.id, employee.userId), eq(usersTable.role, "SALON_EMPLOYEE"))).limit(1);
  if (!account) { res.status(403).json({ error: "Povezani nalog nije nalog zaposlenog." }); return; }
  const temporary = temporaryPassword();
  await db.update(usersTable).set({
    passwordHash: await hashPassword(temporary),
    passwordSetAt: new Date(),
    mustChangePassword: true,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, account.id));
  res.json({ email: account.email, temporaryPassword: temporary, mustChangePassword: true });
});

router.get("/salon/leave-requests", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const [employees, requests] = await Promise.all([
    db.select().from(employeesTable).where(eq(employeesTable.salonId, access.salon.id)),
    db.select().from(employeeLeaveRequestsTable).orderBy(desc(employeeLeaveRequestsTable.createdAt)),
  ]);
  const names = new Map(employees.map((employee) => [employee.id, employee.name]));
  res.json(requests.filter((request) => names.has(request.employeeId)).map((request) => ({
    ...request, employeeName: names.get(request.employeeId)!,
  })));
});

router.patch("/salon/leave-requests/:requestId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const status = req.body?.status;
  if (status !== "approved" && status !== "rejected") { res.status(400).json({ error: "Status mora biti odobreno ili odbijeno." }); return; }
  const [request] = await db.select().from(employeeLeaveRequestsTable).where(eq(employeeLeaveRequestsTable.id, req.params.requestId)).limit(1);
  if (!request) { res.status(404).json({ error: "Zahtev nije pronađen." }); return; }
  const employee = await employeeInSalon(request.employeeId, access.salon.id);
  if (!employee) { res.status(403).json({ error: "Zahtev pripada drugom salonu." }); return; }
  if (request.status !== "pending") { res.status(409).json({ error: "Ovaj zahtev je već obrađen." }); return; }
  await db.transaction(async (tx) => {
    await tx.update(employeeLeaveRequestsTable).set({ status, reviewedAt: new Date() }).where(eq(employeeLeaveRequestsTable.id, request.id));
    if (status === "approved") {
      await tx.insert(employeeTimeOffTable).values({
        employeeId: request.employeeId, startDate: request.startDate, endDate: request.endDate, reason: request.reason,
      });
    }
  });
  res.json({ id: request.id, status });
});

router.get("/employee/portal", async (req, res): Promise<void> => {
  const access = await requireSalonEmployee(req, res); if (!access) return;
  const { employee, salon, user } = access;
  const [appointments, schedules, timeOff, leaveRequests, serviceLinks] = await Promise.all([
    db.select().from(appointmentsTable).where(eq(appointmentsTable.employeeId, employee.id)).orderBy(asc(appointmentsTable.date), asc(appointmentsTable.startTime)),
    db.select().from(employeeSchedulesTable).where(eq(employeeSchedulesTable.employeeId, employee.id)).orderBy(asc(employeeSchedulesTable.weekday)),
    db.select().from(employeeTimeOffTable).where(eq(employeeTimeOffTable.employeeId, employee.id)),
    db.select().from(employeeLeaveRequestsTable).where(eq(employeeLeaveRequestsTable.employeeId, employee.id)).orderBy(desc(employeeLeaveRequestsTable.createdAt)),
    db.select().from(employeeServicesTable).where(eq(employeeServicesTable.employeeId, employee.id)),
  ]);
  const [services, contacts, customers] = await Promise.all([
    serviceLinks.length ? db.select().from(servicesTable).where(inArray(servicesTable.id, serviceLinks.map((link) => link.serviceId))) : Promise.resolve([] as (typeof servicesTable.$inferSelect)[]),
    appointments.some((appointment) => appointment.salonCustomerId) ? db.select().from(salonCustomersTable).where(eq(salonCustomersTable.salonId, salon.id)) : Promise.resolve([] as (typeof salonCustomersTable.$inferSelect)[]),
    appointments.some((appointment) => appointment.customerId) ? db.select().from(usersTable) : Promise.resolve([] as (typeof usersTable.$inferSelect)[]),
  ]);
  const serviceById = new Map(services.map((service) => [service.id, service]));
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const ownClients = new Map<string, { id: string; firstName: string; lastName: string; phone: string | null }>();
  const appointmentViews = appointments.map((appointment) => {
    const contact = appointment.salonCustomerId ? contactById.get(appointment.salonCustomerId) : undefined;
    const customer = appointment.customerId ? customerById.get(appointment.customerId) : undefined;
    const person = contact ?? customer;
    if (contact) ownClients.set(contact.id, { id: contact.id, firstName: contact.firstName, lastName: contact.lastName, phone: contact.phone });
    return {
      id: appointment.id, date: appointment.date, startTime: appointment.startTime, endTime: appointment.endTime, status: appointment.status,
      seriesId: appointment.seriesId,
      notes: appointment.notes, serviceName: serviceById.get(appointment.serviceId)?.name ?? "Usluga nije dostupna",
      customerName: person ? `${person.firstName} ${person.lastName}`.trim() : "Gost",
      customerPhone: person?.phone ?? null,
    };
  });
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = mondayOf(today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const tomorrow = new Date(`${today}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowString = tomorrow.toISOString().slice(0, 10);
  const visibleStatuses = appointments.filter((item) => item.status !== "cancelled");
  const notifications = [
    ...appointments.filter((item) => item.createdAt >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).slice(-5).reverse().map((item) => ({
      id: `new-${item.id}`, title: "Dodat vam je novi termin", date: item.date, createdAt: item.createdAt,
    })),
    ...appointments.filter((item) => item.date === tomorrowString && !["cancelled", "completed", "no-show"].includes(item.status)).map((item) => ({
      id: `reminder-${item.id}`, title: `Podsetnik: sutra u ${item.startTime} imate termin`, date: item.date, createdAt: item.createdAt,
    })),
  ];
  res.json({
    salon: { name: salon.name },
    employee: { id: employee.id, name: employee.name, role: employee.role, bio: employee.bio, avatarUrl: employee.avatarUrl, email: user.email, phone: user.phone },
    appointments: appointmentViews,
    clients: [...ownClients.values()].sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)),
    services: services.filter((service) => service.active).map((service) => ({ id: service.id, name: service.name, durationMinutes: service.durationMinutes })),
    schedule: schedules,
    timeOff,
    leaveRequests,
    notifications,
    stats: {
      week: visibleStatuses.filter((item) => item.date >= weekStart && item.date <= today).length,
      month: visibleStatuses.filter((item) => item.date >= monthStart && item.date.slice(0, 7) === today.slice(0, 7)).length,
      completed: appointments.filter((item) => item.status === "completed" && item.date >= monthStart).length,
      noShow: appointments.filter((item) => item.status === "no-show" && item.date >= monthStart).length,
    },
  });
});

router.patch("/employee/appointments/:appointmentId", async (req, res): Promise<void> => {
  const access = await requireSalonEmployee(req, res); if (!access) return;
  const status = req.body?.status;
  const notes = req.body?.notes;
  if (status !== "completed" && status !== "no-show") { res.status(400).json({ error: "Možete označiti samo završen ili no-show termin." }); return; }
  if (notes !== undefined && typeof notes !== "string") { res.status(400).json({ error: "Napomena mora biti tekst." }); return; }
  const result = await db.transaction(async (tx) => {
    await lockAppointmentResources(tx, access.salon.id);
    const [initial] = await tx.select().from(appointmentsTable).where(and(
      eq(appointmentsTable.id, req.params.appointmentId),
      eq(appointmentsTable.employeeId, access.employee.id),
      eq(appointmentsTable.salonId, access.salon.id),
    )).limit(1);
    if (!initial) return { error: "not-found" as const };
    await lockAppointmentResources(tx, access.salon.id, [{ date: initial.date, employeeId: initial.employeeId }]);
    const [appointment] = await tx.update(appointmentsTable).set({
      status,
      notes: typeof notes === "string" ? notes.trim() || null : undefined,
    }).where(and(
      eq(appointmentsTable.id, initial.id),
      eq(appointmentsTable.employeeId, access.employee.id),
      eq(appointmentsTable.salonId, access.salon.id),
      inArray(appointmentsTable.status, ["pending", "confirmed"]),
    )).returning();
    return appointment ? { appointment } : { error: "changed" as const };
  });
  if ("error" in result) {
    res.status(result.error === "not-found" ? 404 : 409).json({
      error: result.error === "not-found" ? "Vaš termin nije pronađen." : "Termin je u međuvremenu promenjen.",
    });
    return;
  }
  const { appointment } = result;
  res.json({ id: appointment.id, status: appointment.status, notes: appointment.notes });
});

router.put("/employee/profile", async (req, res): Promise<void> => {
  const access = await requireSalonEmployee(req, res); if (!access) return;
  const bio = typeof req.body?.bio === "string" ? req.body.bio.trim() : access.employee.bio;
  const avatarUrl = typeof req.body?.avatarUrl === "string" ? req.body.avatarUrl.trim() : access.employee.avatarUrl;
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : access.user.phone;
  const phoneNormalized = phone ? normalizedPhone(phone) : null;
  if (phone && !phoneNormalized) { res.status(400).json({ error: "Unesite ispravan broj telefona." }); return; }
  if (phoneNormalized) {
    const [taken] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phoneNormalized, phoneNormalized)).limit(1);
    if (taken && taken.id !== access.user.id) { res.status(409).json({ error: "Broj telefona je već povezan sa drugim nalogom." }); return; }
  }
  await db.transaction(async (tx) => {
    await tx.update(employeesTable).set({ bio, avatarUrl }).where(eq(employeesTable.id, access.employee.id));
    await tx.update(usersTable).set({ phone: phone || null, phoneNormalized, updatedAt: new Date() }).where(eq(usersTable.id, access.user.id));
  });
  res.json({ bio, avatarUrl, phone: phone || null });
});

router.post("/employee/leave-requests", async (req, res): Promise<void> => {
  const access = await requireSalonEmployee(req, res); if (!access) return;
  const startDate = typeof req.body?.startDate === "string" ? req.body.startDate : "";
  const endDate = typeof req.body?.endDate === "string" ? req.body.endDate : "";
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate || !reason) {
    res.status(400).json({ error: "Unesite važeći period i razlog odsustva." }); return;
  }
  const [request] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(employeeLeaveRequestsTable).values({ employeeId: access.employee.id, startDate, endDate, reason }).returning();
    await tx.insert(salonNotificationsTable).values({
      salonId: access.salon.id, title: "Novi zahtev za odsustvo",
      message: `${access.employee.name} traži odsustvo od ${startDate} do ${endDate}.`,
      href: "/vlasnik/zaposleni",
    });
    return [created!];
  });
  res.status(201).json(request);
});

router.post("/employee/appointment-series/preview", async (req, res): Promise<void> => {
  const access = await requireSalonEmployee(req, res); if (!access) return;
  const parsed = PreviewEmployeeAppointmentSeriesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Podaci za pregled serije nisu ispravni." }); return; }
  if (parsed.data.employeeId && parsed.data.employeeId !== access.employee.id) {
    res.status(403).json({ error: "Možete proveravati dostupnost samo za svoje termine." }); return;
  }
  const [assigned, service] = await Promise.all([
    db.select().from(employeeServicesTable).where(and(eq(employeeServicesTable.employeeId, access.employee.id), eq(employeeServicesTable.serviceId, parsed.data.serviceId))).limit(1),
    db.select().from(servicesTable).where(and(eq(servicesTable.id, parsed.data.serviceId), eq(servicesTable.salonId, access.salon.id), eq(servicesTable.active, true))).limit(1),
  ]);
  if (!assigned[0] || !service[0]) { res.status(403).json({ error: "Možete zakazati samo svoje dodeljene usluge." }); return; }
  try {
    const slots = prepareSeriesSlots(parsed.data.slots, service[0].durationMinutes);
    const response = PreviewEmployeeAppointmentSeriesResponse.parse(
      await previewSeriesSlots(access.salon.id, service[0].id, slots, access.employee.id),
    );
    res.json({
      ...response,
      slots: response.slots.map((slot) => ({ ...slot, date: calendarDate(slot.date) })),
    });
  } catch (error) {
    const message = error instanceof AppointmentSeriesError ? error.message : "Pregled serije nije uspeo.";
    res.status(error instanceof AppointmentSeriesError ? error.status : 500).json({ error: message });
  }
});

router.post("/employee/appointment-series", async (req, res): Promise<void> => {
  const access = await requireSalonEmployee(req, res); if (!access) return;
  const parsed = CreateEmployeeAppointmentSeriesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Podaci za seriju termina nisu ispravni." }); return; }
  if (parsed.data.employeeId && parsed.data.employeeId !== access.employee.id) {
    res.status(403).json({ error: "Možete zakazati samo svoje termine." }); return;
  }
  if (Boolean(parsed.data.salonCustomerId) === Boolean(parsed.data.guest)) {
    res.status(400).json({ error: "Izaberite klijenta kog ste uslužili ili unesite novog klijenta." }); return;
  }
  const [assigned, service] = await Promise.all([
    db.select().from(employeeServicesTable).where(and(eq(employeeServicesTable.employeeId, access.employee.id), eq(employeeServicesTable.serviceId, parsed.data.serviceId))).limit(1),
    db.select().from(servicesTable).where(and(eq(servicesTable.id, parsed.data.serviceId), eq(servicesTable.salonId, access.salon.id), eq(servicesTable.active, true))).limit(1),
  ]);
  if (!assigned[0] || !service[0]) { res.status(403).json({ error: "Možete zakazati samo svoje dodeljene usluge." }); return; }
  let contact: typeof salonCustomersTable.$inferSelect | undefined;
  let newlyCreatedContact = false;
  if (parsed.data.salonCustomerId) {
    contact = (await db.select().from(salonCustomersTable).where(and(eq(salonCustomersTable.id, parsed.data.salonCustomerId), eq(salonCustomersTable.salonId, access.salon.id))).limit(1))[0];
    if (!contact) { res.status(403).json({ error: "Klijent ne pripada ovom salonu." }); return; }
  } else {
    const phone = normalizedPhone(parsed.data.guest!.phone);
    if (!phone || !parsed.data.guest!.firstName.trim()) { res.status(400).json({ error: "Unesite ime i ispravan telefon klijenta." }); return; }
    const contacts = await db.select().from(salonCustomersTable).where(eq(salonCustomersTable.salonId, access.salon.id));
    contact = contacts.find((item) => item.phoneNormalized === phone || (item.phone && normalizedPhone(item.phone) === phone));
    if (!contact) {
      const [registered] = await db.select().from(usersTable).where(eq(usersTable.phoneNormalized, phone)).limit(1);
      [contact] = await db.insert(salonCustomersTable).values({
        salonId: access.salon.id, firstName: parsed.data.guest!.firstName.trim(), lastName: parsed.data.guest!.lastName.trim(),
        phone: parsed.data.guest!.phone.trim(), phoneNormalized: phone, userId: registered?.id ?? null, email: parsed.data.guest!.email?.trim().toLowerCase() || null,
      }).returning();
      newlyCreatedContact = true;
    }
  }
  const [previous] = await db.select({ id: appointmentsTable.id }).from(appointmentsTable)
    .where(and(eq(appointmentsTable.employeeId, access.employee.id), eq(appointmentsTable.salonCustomerId, contact!.id))).limit(1);
  if (!newlyCreatedContact && !previous) { res.status(403).json({ error: "Možete izabrati samo klijenta kog ste već uslužili." }); return; }
  try {
    const slots = prepareSeriesSlots(parsed.data.slots, service[0].durationMinutes);
    const created = await createAppointmentSeries({
      salonId: access.salon.id, customerId: contact!.userId, salonCustomerId: contact!.id, service: service[0], slots,
      createdByUserId: access.user.id, preferredEmployeeId: access.employee.id,
    });
    const views = created.appointments.map((appointment) => appointmentView(appointment, access.salon, service[0], contact!, access.employee));
    await sendSeriesConfirmations({ appointments: created.appointments, contact: contact!, salon: access.salon });
    const response = { id: created.series.id, totalAppointments: created.appointments.length, appointments: views };
    CreateEmployeeAppointmentSeriesResponse.parse(response);
    res.status(201).json(response);
  } catch (error) {
    const message = error instanceof AppointmentSeriesError ? error.message : "Serija termina nije sačuvana.";
    res.status(error instanceof AppointmentSeriesError ? error.status : 500).json({ error: message });
  }
});

router.post("/employee/appointments", async (req, res): Promise<void> => {
  const access = await requireSalonEmployee(req, res); if (!access) return;
  const serviceId = typeof req.body?.serviceId === "string" ? req.body.serviceId : "";
  const slots = Array.isArray(req.body?.slots) ? req.body.slots.filter((slot: unknown): slot is { date: string; startTime: string } =>
    Boolean(slot) && typeof (slot as { date?: unknown }).date === "string" && typeof (slot as { startTime?: unknown }).startTime === "string") : [];
  const salonCustomerId = typeof req.body?.salonCustomerId === "string" ? req.body.salonCustomerId : null;
  const guest = req.body?.guest as { firstName?: unknown; lastName?: unknown; phone?: unknown; email?: unknown } | undefined;
  if (!serviceId || !slots.length || slots.length > 12 || (!salonCustomerId && (!guest || typeof guest.firstName !== "string" || typeof guest.phone !== "string"))) {
    res.status(400).json({ error: "Izaberite uslugu, klijenta i najmanje jedan termin." }); return;
  }
  const [assigned, service] = await Promise.all([
    db.select().from(employeeServicesTable).where(and(eq(employeeServicesTable.employeeId, access.employee.id), eq(employeeServicesTable.serviceId, serviceId))).limit(1),
    db.select().from(servicesTable).where(and(eq(servicesTable.id, serviceId), eq(servicesTable.salonId, access.salon.id), eq(servicesTable.active, true))).limit(1),
  ]);
  if (!assigned[0] || !service[0]) { res.status(403).json({ error: "Možete zakazati samo svoje dodeljene usluge." }); return; }
  const preparedSlots: Array<{ date: string; startTime: string; endTime: string }> = [];
  for (const slot of slots) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date) || !/^\d{2}:\d{2}$/.test(slot.startTime)) { res.status(400).json({ error: "Datum ili vreme nisu ispravni." }); return; }
    const endTime = appointmentEndTime(slot.startTime, service[0].durationMinutes);
    if (!endTime) { res.status(400).json({ error: "Trajanje termina izlazi van dana." }); return; }
    preparedSlots.push({ date: slot.date, startTime: slot.startTime, endTime });
  }
  const guestPhone = salonCustomerId ? null : String(guest!.phone).trim();
  const guestPhoneNormalized = guestPhone ? normalizedPhone(guestPhone) : null;
  if (!salonCustomerId && (!guestPhoneNormalized || !String(guest!.firstName).trim())) { res.status(400).json({ error: "Unesite ime i telefon klijenta." }); return; }
  const batch = await db.transaction(async (tx) => {
    await lockAppointmentResources(tx, access.salon.id, preparedSlots.map((slot) => ({
      date: slot.date,
      employeeId: access.employee.id,
    })));
    let contact: typeof salonCustomersTable.$inferSelect;
    let newlyCreatedContact = false;
    if (salonCustomerId) {
      const [client] = await tx.select().from(salonCustomersTable)
        .where(and(eq(salonCustomersTable.id, salonCustomerId), eq(salonCustomersTable.salonId, access.salon.id))).limit(1);
      if (!client) throw new EmployeeBookingError("Klijent ne pripada ovom salonu.", 403);
      contact = client;
    } else {
      const contacts = await tx.select().from(salonCustomersTable).where(eq(salonCustomersTable.salonId, access.salon.id));
      const existing = contacts.find((item) => item.phoneNormalized === guestPhoneNormalized || (item.phone && normalizedPhone(item.phone) === guestPhoneNormalized));
      if (existing) {
        contact = existing;
      } else {
        const [registered] = await tx.select().from(usersTable).where(eq(usersTable.phoneNormalized, guestPhoneNormalized!)).limit(1);
        [contact] = await tx.insert(salonCustomersTable).values({
          salonId: access.salon.id, firstName: String(guest!.firstName).trim(), lastName: typeof guest!.lastName === "string" ? guest!.lastName.trim() : "",
          phone: guestPhone!, phoneNormalized: guestPhoneNormalized!, email: typeof guest!.email === "string" ? guest!.email.trim().toLowerCase() || null : null,
          userId: registered?.id ?? null,
        }).returning();
        newlyCreatedContact = true;
      }
    }
    const [previous] = await tx.select({ id: appointmentsTable.id }).from(appointmentsTable)
      .where(and(eq(appointmentsTable.employeeId, access.employee.id), eq(appointmentsTable.salonCustomerId, contact.id))).limit(1);
    if (!newlyCreatedContact && !previous) {
      throw new EmployeeBookingError("Možete izabrati samo klijenta kog ste već uslužili.", 403);
    }
    const created: (typeof appointmentsTable.$inferSelect)[] = [];
    for (const slot of preparedSlots) {
      const employee = await availableEmployeeWithDb(tx, access.salon.id, serviceId, slot.date, slot.startTime, slot.endTime, access.employee.id);
      if (!employee) throw new EmployeeBookingError(`Termin ${slot.date} u ${slot.startTime} nije slobodan ili je van vašeg radnog vremena.`);
      const [appointment] = await tx.insert(appointmentsTable).values({
        salonId: access.salon.id, customerId: contact.userId, salonCustomerId: contact.id, employeeId: access.employee.id, serviceId,
        date: slot.date, startTime: slot.startTime, endTime: slot.endTime, durationMinutes: service[0].durationMinutes,
        price: service[0].promoPrice ?? service[0].price, status: "confirmed",
      }).returning();
      created.push(appointment!);
    }
    return { contact, created };
  }).catch((error: unknown) => {
    if (error instanceof EmployeeBookingError) return { error: error.message, status: error.status };
    throw error;
  });
  if ("error" in batch) { res.status(batch.status).json({ error: batch.error }); return; }
  for (const [index, appointment] of batch.created.entries()) {
    const slot = preparedSlots[index]!;
    await sendSms({
      eventKey: `appointment-confirmation:${appointment.id}`, salonId: access.salon.id, appointmentId: appointment.id,
      type: "appointment_confirmation", phone: batch.contact.phone, smsOptOut: batch.contact.smsOptOut,
      text: `LUMERA: termin u salonu ${access.salon.name} je zakazan za ${slot.date} u ${slot.startTime}.`,
    });
    if (batch.contact.email) {
      await sendTransactionalEmail({
        eventKey: `appointment-confirmation:${appointment.id}:email`,
        emailType: "appointment_confirmation",
        to: { email: batch.contact.email, name: `${batch.contact.firstName} ${batch.contact.lastName}`.trim() || "LUMERA klijent" },
        subject: "LUMERA — potvrda termina",
        htmlContent: lumeraEmailHtml("Termin je zakazan", `<p>Vaš termin u salonu <b>${emailSafe(access.salon.name)}</b> je zakazan za <b>${slot.date} u ${slot.startTime}</b>.</p>`),
      });
    }
  }
  res.status(201).json({ appointments: batch.created.map((item) => ({ id: item.id, date: item.date, startTime: item.startTime, status: item.status })) });
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
  config: {
    freeShippingThreshold: number;
    tiers: Array<{ maxWeightGrams: number; price: number; label: string }>;
    personalDeliveryEnabled: boolean;
    personalDeliveryName: string;
    personalDeliveryPrice: number;
    personalDeliveryDescription: string;
  },
  totalWeightGrams: number,
  subtotal: number,
  deliveryMethod: "courier" | "personal_belgrade" = "courier",
  destinationCity?: string | null,
) {
  const threshold = config.freeShippingThreshold;
  const freeByThreshold = threshold > 0 && subtotal >= threshold;
  const sorted = [...config.tiers].sort((a, b) => a.maxWeightGrams - b.maxWeightGrams);
  let tierPrice = 0;
  if (sorted.length > 0 && totalWeightGrams > 0) {
    const match = sorted.find((t) => totalWeightGrams <= t.maxWeightGrams);
    tierPrice = match ? match.price : sorted[sorted.length - 1]!.price;
  }
  const isBelgrade = /beograd/i.test(destinationCity ?? "");
  const personalAvailable = config.personalDeliveryEnabled && (destinationCity == null || isBelgrade);
  const shippingCost = freeByThreshold ? 0 : deliveryMethod === "personal_belgrade"
    ? config.personalDeliveryPrice
    : tierPrice;
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
    availableMethods: [
      { id: "courier" as const, name: "Kurirska služba", description: "Standardna dostava prema težini pošiljke.", price: freeByThreshold ? 0 : tierPrice, available: true },
      { id: "personal_belgrade" as const, name: config.personalDeliveryName, description: config.personalDeliveryDescription, price: freeByThreshold ? 0 : config.personalDeliveryPrice, available: personalAvailable },
    ],
  };
}

function courierServiceDto(service: typeof courierServicesTable.$inferSelect) {
  return {
    id: service.id,
    code: service.code,
    name: service.name,
    trackingUrlTemplate: service.trackingUrlTemplate ?? null,
    active: service.active,
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString(),
  };
}

function trackingUrlFor(template: string | null | undefined, trackingNumber: string | null, deliveryMethod: string) {
  if (deliveryMethod === "personal_belgrade" || !template || !trackingNumber?.trim()) return null;
  try {
    const url = new URL(template.replaceAll("{trackingNumber}", encodeURIComponent(trackingNumber.trim())));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function validTrackingTemplate(template: string | null | undefined) {
  if (template == null || template.trim() === "") return true;
  if (!template.includes("{trackingNumber}")) return false;
  try {
    const url = new URL(template.replaceAll("{trackingNumber}", "tracking-number"));
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function cleanTrackingTemplate(template: string | null | undefined) {
  const value = template?.trim();
  return value ? value : null;
}

function courierCode(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "kurirska-sluzba";
}

async function couriersForOrders(orders: Array<typeof ordersTable.$inferSelect>) {
  const ids = [...new Set(orders.flatMap((order) => order.courierServiceId ? [order.courierServiceId] : []))];
  const services = ids.length ? await db.select().from(courierServicesTable).where(inArray(courierServicesTable.id, ids)) : [];
  return new Map(services.map((service) => [service.id, service]));
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

router.get("/loyalty/tiers", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  res.json((await db.select().from(loyaltyTiersTable).where(eq(loyaltyTiersTable.active, true)).orderBy(asc(loyaltyTiersTable.sortOrder))).map((tier) => ({
    id: tier.id, name: tier.name, sortOrder: tier.sortOrder, spendThreshold: tier.spendThreshold, period: tier.period,
    subscriptionDiscountPercent: tier.subscriptionDiscountPercent, productDiscountPercent: tier.productDiscountPercent,
    freeSubscription: tier.freeSubscription, premiumListing: tier.premiumListing, freeShipping: tier.freeShipping, benefits: tier.benefits, active: tier.active,
  })));
});

router.get("/shop/summary", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const loyalty = await loyaltyStatus(salon.id);
  const cart = await shopCartDto(salon.id);
  res.json(GetShopSummaryResponse.parse({ monthlySpend: loyalty.monthlySpend, nextTierSpend: loyalty.monthlySpend + loyalty.amountToNextTier, amountToNextTier: loyalty.amountToNextTier, currentTier: loyalty.currentTier, subscriptionDue: loyalty.subscriptionDue, subscriptionDiscount: loyalty.subscriptionDiscountPercent, benefits: loyalty.benefits, cartCount: cart.itemCount }));
});

const checkoutPaymentMethods = ["CARD", "BANK_TRANSFER", "CASH_ON_DELIVERY"] as const;

async function getOrCreateShopCart(salonId: string) {
  const [existing] = await db.select().from(shoppingCartsTable).where(eq(shoppingCartsTable.salonId, salonId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(shoppingCartsTable).values({ salonId }).returning();
  return created!;
}

async function shopCartDto(salonId: string) {
  const [cart] = await db.select().from(shoppingCartsTable).where(eq(shoppingCartsTable.salonId, salonId)).limit(1);
  if (!cart) return { id: null, items: [], itemCount: 0, subtotal: 0, totalWeightGrams: 0 };
  const items = await db.select().from(shoppingCartItemsTable).where(eq(shoppingCartItemsTable.cartId, cart.id)).orderBy(asc(shoppingCartItemsTable.createdAt));
  const productIds = [...new Set(items.map((item) => item.productId))];
  const products = productIds.length ? await db.select().from(productsTable).where(inArray(productsTable.id, productIds)) : [];
  const byId = new Map(products.map((product) => [product.id, product]));
  const views = items.map((item) => {
    const product = byId.get(item.productId);
    const variant = item.variantValue ? product?.variants?.find((candidate) => candidate.value === item.variantValue) : undefined;
    const availableStock = variant?.stock ?? product?.stock ?? 0;
    return {
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      productImageUrl: item.productImageUrl,
      variantValue: item.variantValue,
      variantLabel: item.variantLabel,
      productSku: item.productSku,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.unitPrice * item.quantity,
      availableStock,
      weightGrams: product?.weightGrams ?? 0,
    };
  });
  return {
    id: cart.id,
    items: views.map(({ weightGrams: _weightGrams, ...item }) => item),
    itemCount: views.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: views.reduce((sum, item) => sum + item.lineTotal, 0),
    totalWeightGrams: views.reduce((sum, item) => sum + item.weightGrams * item.quantity, 0),
  };
}

function cartLineForProduct(product: typeof productsTable.$inferSelect, variantValue: string | undefined, quantity: number) {
  const variants = product.variants ?? [];
  if (variants.length > 0 && !variantValue) return { error: `Izaberite varijantu za proizvod "${product.name}".` } as const;
  if (variants.length === 0 && variantValue) return { error: `Proizvod "${product.name}" nema dostupne varijante.` } as const;
  const variant = variantValue ? variants.find((candidate) => candidate.value === variantValue) : undefined;
  if (variantValue && !variant) return { error: `Varijanta "${variantValue}" ne postoji za proizvod "${product.name}".` } as const;
  const available = variant?.stock ?? product.stock;
  if (available < quantity) return { error: `Nedovoljno zaliha za "${product.name}".` } as const;
  return {
    unitPrice: variant?.price ?? ((product.discountPrice ?? product.price) + (variant?.priceAdjust ?? 0)),
    variantLabel: variant?.label ?? null,
    productSku: variant?.sku ?? product.sku,
  } as const;
}

router.get("/shop/cart", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  res.json(GetShopCartResponse.parse(await shopCartDto(access.salon.id)));
});

router.post("/shop/cart/items", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const parsed = AddShopCartItemBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, parsed.data.productId)).limit(1);
  if (!product || !product.active) { res.status(404).json({ error: "Proizvod nije dostupan." }); return; }
  const categories = await db.select().from(productCategoriesTable);
  if (!productBelongsToActiveCategory(product, categories)) { res.status(400).json({ error: "Kategorija ovog proizvoda trenutno nije dostupna." }); return; }
  const cart = await getOrCreateShopCart(access.salon.id);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from shopping_carts where id = ${cart.id} for update`);
    const rows = await tx.select().from(shoppingCartItemsTable).where(eq(shoppingCartItemsTable.cartId, cart.id));
    const existing = rows.find((item) => item.productId === product.id && item.variantValue === (parsed.data.variantValue ?? null));
    const quantity = (existing?.quantity ?? 0) + (parsed.data.quantity ?? 1);
    const line = cartLineForProduct(product, parsed.data.variantValue, quantity);
    if ("error" in line) return { error: line.error };
    if (existing) {
      await tx.update(shoppingCartItemsTable).set({
        quantity, unitPrice: line.unitPrice, variantLabel: line.variantLabel, productSku: line.productSku,
        productName: product.name, productImageUrl: product.imageUrl, updatedAt: new Date(),
      }).where(eq(shoppingCartItemsTable.id, existing.id));
    } else {
      await tx.insert(shoppingCartItemsTable).values({
        cartId: cart.id, productId: product.id, variantValue: parsed.data.variantValue ?? null,
        productName: product.name, productImageUrl: product.imageUrl, variantLabel: line.variantLabel,
        productSku: line.productSku, unitPrice: line.unitPrice, quantity,
      });
    }
    await tx.update(shoppingCartsTable).set({ updatedAt: new Date() }).where(eq(shoppingCartsTable.id, cart.id));
    return { error: null };
  });
  if (result.error) { res.status(400).json({ error: result.error }); return; }
  res.json(AddShopCartItemResponse.parse(await shopCartDto(access.salon.id)));
});

router.patch("/shop/cart/items/:cartItemId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const params = UpdateShopCartItemParams.safeParse(req.params);
  const body = UpdateShopCartItemBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Neispravan zahtev." }); return; }
  const [cart] = await db.select().from(shoppingCartsTable).where(eq(shoppingCartsTable.salonId, access.salon.id)).limit(1);
  if (!cart) { res.status(404).json({ error: "Korpa nije pronađena." }); return; }
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from shopping_carts where id = ${cart.id} for update`);
    const [item] = await tx.select().from(shoppingCartItemsTable).where(and(eq(shoppingCartItemsTable.id, params.data.cartItemId), eq(shoppingCartItemsTable.cartId, cart.id))).limit(1);
    if (!item) return { error: "Stavka korpe nije pronađena.", status: 404 };
    const [product] = await tx.select().from(productsTable).where(eq(productsTable.id, item.productId)).limit(1);
    if (!product || !product.active) return { error: "Proizvod više nije dostupan.", status: 400 };
    const line = cartLineForProduct(product, item.variantValue ?? undefined, body.data.quantity);
    if ("error" in line) return { error: line.error, status: 400 };
    await tx.update(shoppingCartItemsTable).set({ quantity: body.data.quantity, unitPrice: line.unitPrice, variantLabel: line.variantLabel, productSku: line.productSku, updatedAt: new Date() }).where(eq(shoppingCartItemsTable.id, item.id));
    await tx.update(shoppingCartsTable).set({ updatedAt: new Date() }).where(eq(shoppingCartsTable.id, cart.id));
    return { error: null, status: 200 };
  });
  if (result.error) { res.status(result.status).json({ error: result.error }); return; }
  res.json(UpdateShopCartItemResponse.parse(await shopCartDto(access.salon.id)));
});

router.delete("/shop/cart/items/:cartItemId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const params = RemoveShopCartItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [cart] = await db.select().from(shoppingCartsTable).where(eq(shoppingCartsTable.salonId, access.salon.id)).limit(1);
  if (!cart) { res.status(404).json({ error: "Korpa nije pronađena." }); return; }
  await db.transaction(async (tx) => {
    await tx.execute(sql`select id from shopping_carts where id = ${cart.id} for update`);
    await tx.delete(shoppingCartItemsTable).where(and(eq(shoppingCartItemsTable.id, params.data.cartItemId), eq(shoppingCartItemsTable.cartId, cart.id)));
    await tx.update(shoppingCartsTable).set({ updatedAt: new Date() }).where(eq(shoppingCartsTable.id, cart.id));
  });
  res.json(RemoveShopCartItemResponse.parse(await shopCartDto(access.salon.id)));
});

router.get("/shop/checkout-profile", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon, user } = access;
  const billingDefaults = salon.companyName && salon.companyTaxId && salon.companyRegistrationNumber && salon.companyAddress && salon.companyCity
    ? { companyName: salon.companyName, pib: salon.companyTaxId, registrationNumber: salon.companyRegistrationNumber, street: salon.companyAddress, city: salon.companyCity, postalCode: salon.companyPostalCode ?? "" }
    : null;
  res.json(GetShopCheckoutProfileResponse.parse({
    salonName: salon.name,
    salonAddress: {
      recipientName: `${user.firstName} ${user.lastName}`.trim() || salon.name,
      street: salon.address,
      city: salon.city,
      postalCode: salon.postalCode ?? "",
      phone: salon.phone,
      email: salon.email,
    },
    billingDefaults,
    paymentMethods: checkoutPaymentMethods,
  }));
});

router.get("/shop/checkout-preview", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const cart = await shopCartDto(access.salon.id);
  const shipping = calculateShipping(await getShippingConfig(), cart.totalWeightGrams, cart.subtotal);
  res.json(GetShopCheckoutPreviewResponse.parse({ cart, shipping, total: cart.subtotal + shipping.shippingCost, paymentMethods: checkoutPaymentMethods }));
});

router.post("/shop/checkout", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const parsed = CheckoutShopCartBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (!parsed.data.termsAccepted) { res.status(400).json({ error: "Morate prihvatiti Uslove kupovine pre potvrde porudžbine." }); return; }
  const { salon, user } = access;
  const delivery = parsed.data.useSalonAddress
    ? {
        recipientName: `${user.firstName} ${user.lastName}`.trim() || salon.name,
        street: salon.address,
        city: salon.city,
        postalCode: salon.postalCode ?? "",
        phone: salon.phone,
        email: salon.email,
      }
    : parsed.data.deliveryAddress;
  if (!delivery || [delivery.recipientName, delivery.street, delivery.city, delivery.postalCode, delivery.phone, delivery.email].some((value) => !value?.trim())) {
    res.status(400).json({ error: "Unesite sve obavezne podatke za dostavu, uključujući poštanski broj i email." }); return;
  }
  const config = await getShippingConfig();
  const deliveryMethod = parsed.data.deliveryMethod;
  if (deliveryMethod === "personal_belgrade" && (!config.personalDeliveryEnabled || !/beograd/i.test(delivery.city))) {
    res.status(400).json({ error: "Lična dostava je dostupna samo na adresama u Beogradu kada je uključena u administraciji." }); return;
  }
  const billing = parsed.data.billingDetails ?? null;
  if (billing && [billing.companyName, billing.pib, billing.registrationNumber, billing.street, billing.city, billing.postalCode].some((value) => !value?.trim())) {
    res.status(400).json({ error: "Unesite kompletne podatke firme za fakturisanje." }); return;
  }
  const [cart] = await db.select().from(shoppingCartsTable).where(eq(shoppingCartsTable.salonId, salon.id)).limit(1);
  if (!cart) { res.status(400).json({ error: "Vaša korpa je prazna." }); return; }
  let conflictProductName: string | null = null;
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from shopping_carts where id = ${cart.id} for update`);
    const lines = await tx.select().from(shoppingCartItemsTable).where(eq(shoppingCartItemsTable.cartId, cart.id));
    if (!lines.length) {
      conflictProductName = "";
      tx.rollback();
    }
    const productIds = [...new Set(lines.map((line) => line.productId))];
    const lockedProducts = new Map<string, typeof productsTable.$inferSelect>();
    for (const productId of productIds.sort()) {
      await tx.execute(sql`select id from products where id = ${productId} for update`);
      const [product] = await tx.select().from(productsTable).where(eq(productsTable.id, productId)).limit(1);
      if (!product || !product.active) {
        conflictProductName = product?.name ?? "izabrani proizvod";
        tx.rollback();
      }
      lockedProducts.set(productId, product!);
    }
    const categories = await tx.select().from(productCategoriesTable);
    const productQuantities = new Map<string, number>();
    const variantQuantities = new Map<string, number>();
    const details = lines.map((line) => {
      const product = lockedProducts.get(line.productId)!;
      if (!productBelongsToActiveCategory(product, categories)) {
        conflictProductName = product.name;
        tx.rollback();
      }
      const variants = product.variants ?? [];
      const variant = line.variantValue ? variants.find((candidate) => candidate.value === line.variantValue) : undefined;
      if ((variants.length > 0 && !line.variantValue) || (variants.length === 0 && line.variantValue) || (line.variantValue && !variant)) {
        conflictProductName = product.name;
        tx.rollback();
      }
      productQuantities.set(product.id, (productQuantities.get(product.id) ?? 0) + line.quantity);
      if (line.variantValue) {
        const key = `${product.id}\u0000${line.variantValue}`;
        variantQuantities.set(key, (variantQuantities.get(key) ?? 0) + line.quantity);
      }
      return {
        product,
        variant,
        variantValue: line.variantValue,
        quantity: line.quantity,
        price: variant?.price ?? ((product.discountPrice ?? product.price) + (variant?.priceAdjust ?? 0)),
      };
    });
    for (const [productId, quantity] of productQuantities) {
      const product = lockedProducts.get(productId)!;
      if (product.stock < quantity) {
        conflictProductName = product.name;
        tx.rollback();
      }
    }
    for (const [key, quantity] of variantQuantities) {
      const [productId, variantValue] = key.split("\u0000");
      const product = lockedProducts.get(productId!)!;
      const variant = (product.variants ?? []).find((candidate) => candidate.value === variantValue);
      if (!variant || (variant.stock !== undefined && variant.stock < quantity)) {
        conflictProductName = product.name;
        tx.rollback();
      }
    }
    const subtotal = details.reduce((sum, line) => sum + line.price * line.quantity, 0);
    const totalWeightGrams = details.reduce((sum, line) => sum + (line.product.weightGrams ?? 0) * line.quantity, 0);
    const shipping = calculateShipping(config, totalWeightGrams, subtotal, deliveryMethod, delivery.city);
    for (const [productId, quantity] of productQuantities) {
      const product = lockedProducts.get(productId)!;
      const updatedVariants = (product.variants ?? []).map((variant) => {
        const used = variantQuantities.get(`${productId}\u0000${variant.value}`) ?? 0;
        return used > 0 && variant.stock !== undefined ? { ...variant, stock: variant.stock - used } : variant;
      });
      const updated = await tx.update(productsTable).set({ stock: sql`stock - ${quantity}`, variants: updatedVariants }).where(and(eq(productsTable.id, productId), sql`stock >= ${quantity}`)).returning({ id: productsTable.id });
      if (!updated.length) {
        conflictProductName = product.name;
        tx.rollback();
      }
    }
    const [order] = await tx.insert(ordersTable).values({
      salonId: salon.id,
      status: "pending",
      total: subtotal + shipping.shippingCost,
      subtotal,
      shippingCost: shipping.shippingCost,
      totalWeightGrams,
      shippingName: delivery.recipientName,
      shippingAddress: delivery.street,
      shippingCity: delivery.city,
      shippingPostalCode: delivery.postalCode,
      shippingPhone: delivery.phone,
      shippingEmail: delivery.email,
      shippingNote: parsed.data.note ?? null,
      shippingIsSalonAddress: parsed.data.useSalonAddress,
      billingCompanyName: billing?.companyName ?? null,
      billingTaxId: billing?.pib ?? null,
      billingRegistrationNumber: billing?.registrationNumber ?? null,
      billingAddress: billing?.street ?? null,
      billingCity: billing?.city ?? null,
      billingPostalCode: billing?.postalCode ?? null,
      paymentMethod: parsed.data.paymentMethod,
      paymentStatus: parsed.data.paymentMethod === "CARD" ? "pending" : "unpaid",
      deliveryMethod,
    }).returning();
    const orderItems = details.map((line) => ({
      orderId: order!.id,
      productId: line.product.id,
      productName: line.product.name,
      productSku: line.variant?.sku ?? line.product.sku,
      variantValue: line.variantValue,
      variantLabel: line.variant?.label ?? null,
      quantity: line.quantity,
      price: line.price,
    }));
    await tx.insert(orderItemsTable).values(orderItems);
    await tx.delete(shoppingCartItemsTable).where(eq(shoppingCartItemsTable.cartId, cart.id));
    await tx.update(shoppingCartsTable).set({ updatedAt: new Date() }).where(eq(shoppingCartsTable.id, cart.id));
    await tx.insert(salonNotificationsTable).values({
      salonId: salon.id,
      title: "Porudžbina je kreirana",
      message: `Vaša B2B porudžbina #${order!.id.slice(0, 8).toUpperCase()} je uspešno primljena.`,
      href: `/vlasnik/porudzbine/${order!.id}`,
    });
    return { order: order!, items: orderItems };
  }).catch((error: unknown) => {
    if (conflictProductName !== null) return null;
    throw error;
  });
  if (!created) {
    res.status(conflictProductName ? 409 : 400).json({ error: conflictProductName ? `Zalihe za "${conflictProductName}" su se promenile tokom obrade. Osvežite korpu i pokušajte ponovo.` : "Vaša korpa je prazna." });
    return;
  }
  await sendTransactionalEmail({
    eventKey: `b2b-order:${created.order.id}:created`,
    emailType: "b2b_order_created",
    to: { email: user.email, name: `${user.firstName} ${user.lastName}` },
    subject: "LUMERA Biznis — porudžbina je primljena",
    htmlContent: lumeraEmailHtml("Porudžbina je primljena", `<p>Hvala vam. Primili smo B2B porudžbinu za salon <strong>${emailSafe(salon.name)}</strong>.</p>`),
    metadata: { orderId: created.order.id, salonId: salon.id },
  });
  res.status(201).json(CheckoutShopCartResponse.parse(orderDto(created.order, created.items, salon)));
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
  courier?: typeof courierServicesTable.$inferSelect,
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
    paymentStatus: order.paymentStatus,
    deliveryMethod: order.deliveryMethod,
    courierServiceId: order.courierServiceId ?? null,
    courierService: courier?.name ?? order.courierService ?? (order.deliveryMethod === "personal_belgrade" ? "Lična dostava" : null),
    trackingNumber: order.trackingNumber ?? null,
    trackingUrl: trackingUrlFor(courier?.trackingUrlTemplate, order.trackingNumber, order.deliveryMethod),
    total: order.total,
    subtotal: order.subtotal,
    shippingCost: order.shippingCost,
    totalWeightGrams: order.totalWeightGrams,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    salon: {
      id: salon.id,
      name: salon.name,
      phone: salon.phone,
      email: salon.email,
      address: salon.address,
      city: salon.city,
      postalCode: salon.postalCode ?? null,
    },
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

function adminOrderDto(
  order: typeof ordersTable.$inferSelect,
  items: Array<typeof orderItemsTable.$inferSelect>,
  salon: typeof salonsTable.$inferSelect,
  history: Array<typeof orderStatusHistoryTable.$inferSelect>,
  courier?: typeof courierServicesTable.$inferSelect,
) {
  return {
    ...orderDto(order, items, salon, courier),
    adminNote: order.adminNote ?? null,
    history: history.map((event) => ({
      id: event.id,
      actorName: event.actorName,
      field: event.field,
      previousValue: event.previousValue ?? null,
      nextValue: event.nextValue ?? null,
      note: event.note ?? null,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

router.get("/shop/orders", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const orders = await db.select().from(ordersTable).where(eq(ordersTable.salonId, salon.id)).orderBy(desc(ordersTable.createdAt));
  const items = orders.length ? await db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, orders.map((item) => item.id))) : [];
  const couriers = await couriersForOrders(orders);
  res.json(ListOrdersResponse.parse(orders.map((order) => orderDto(order, items.filter((item) => item.orderId === order.id), salon, order.courierServiceId ? couriers.get(order.courierServiceId) : undefined))));
});

router.get("/shop/notifications", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const notifications = await db.select()
    .from(salonNotificationsTable)
    .where(eq(salonNotificationsTable.salonId, access.salon.id))
    .orderBy(desc(salonNotificationsTable.createdAt));
  res.json(ListSalonNotificationsResponse.parse(notifications));
});

router.patch("/shop/notifications/:notificationId/read", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const parsed = MarkSalonNotificationReadParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [notification] = await db.update(salonNotificationsTable)
    .set({ readAt: new Date() })
    .where(and(
      eq(salonNotificationsTable.id, parsed.data.notificationId),
      eq(salonNotificationsTable.salonId, access.salon.id),
    ))
    .returning();
  if (!notification) { res.status(404).json({ error: "Obaveštenje nije pronađeno." }); return; }
  res.json(MarkSalonNotificationReadResponse.parse(notification));
});

router.get("/shop/orders/:orderId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const parsed = GetOrderParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [order] = await db.select().from(ordersTable)
    .where(and(eq(ordersTable.id, parsed.data.orderId), eq(ordersTable.salonId, access.salon.id))).limit(1);
  if (!order) { res.status(404).json({ error: "Porudžbina nije pronađena." }); return; }
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
  const [courier] = order.courierServiceId ? await db.select().from(courierServicesTable).where(eq(courierServicesTable.id, order.courierServiceId)).limit(1) : [];
  res.json(GetOrderResponse.parse(orderDto(order, items, access.salon, courier)));
});

router.post("/shop/orders", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  res.status(410).json({ error: "Direktno kreiranje porudžbine je ukinuto. Potvrdite porudžbinu iz sačuvane korpe." });
  return; /*
    The former item-submission implementation is intentionally retained below
    only until the deprecated endpoint can be removed in a focused cleanup.
    The route must never bypass the saved-cart checkout transaction.
  */
  /*
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
  */
});

router.get("/admin/orders", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsed = AdminListOrdersQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const q = parsed.data;
  let orders = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt));
  const salons = await db.select().from(salonsTable);
  if (q.status) orders = orders.filter((order) => order.status === q.status);
  if (q.paymentStatus) orders = orders.filter((order) => order.paymentStatus === q.paymentStatus);
  if (q.deliveryMethod) orders = orders.filter((order) => order.deliveryMethod === q.deliveryMethod);
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
  const histories = orders.length ? await db.select().from(orderStatusHistoryTable).where(inArray(orderStatusHistoryTable.orderId, orders.map((order) => order.id))).orderBy(desc(orderStatusHistoryTable.createdAt)) : [];
  const couriers = await couriersForOrders(orders);
  res.json(AdminListOrdersResponse.parse(orders.flatMap((order) => {
    const salon = salons.find((item) => item.id === order.salonId);
    return salon ? [adminOrderDto(order, items.filter((item) => item.orderId === order.id), salon, histories.filter((event) => event.orderId === order.id), order.courierServiceId ? couriers.get(order.courierServiceId) : undefined)] : [];
  })));
});

const allowedOrderTransitions: Record<string, string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  paid: ["shipped", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

router.patch("/admin/orders/bulk", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const body = AdminBulkUpdateOrdersBody.safeParse(req.body);
  if (!body.success || (!body.data.status && !body.data.paymentStatus)) {
    res.status(400).json({ error: body.success ? "Izaberite status isporuke ili plaćanja." : body.error.message }); return;
  }
  const selected = await db.select().from(ordersTable).where(inArray(ordersTable.id, body.data.orderIds));
  if (selected.length !== body.data.orderIds.length) { res.status(404).json({ error: "Jedna ili više porudžbina nije pronađena." }); return; }
  if (body.data.status && selected.some((order) => !allowedOrderTransitions[order.status]?.includes(body.data.status!))) {
    res.status(400).json({ error: "Masovna promena bi preskočila dozvoljeni tok isporuke. Obradite porudžbine po redosledu statusa." }); return;
  }
  const changed = await db.transaction(async (tx) => {
    const result = [];
    for (const order of selected) {
      const update = {
        ...(body.data.status ? { status: body.data.status } : {}),
        ...(body.data.paymentStatus ? { paymentStatus: body.data.paymentStatus } : {}),
        updatedAt: new Date(),
      };
      const [saved] = await tx.update(ordersTable).set(update).where(eq(ordersTable.id, order.id)).returning();
      for (const [field, previousValue, nextValue] of [
        ["status", order.status, body.data.status],
        ["paymentStatus", order.paymentStatus, body.data.paymentStatus],
      ] as const) {
        if (nextValue && previousValue !== nextValue) {
          await tx.insert(orderStatusHistoryTable).values({
            orderId: order.id, actorUserId: user.id, actorName: `${user.firstName} ${user.lastName}`.trim() || "Administrator",
            field, previousValue, nextValue,
          });
        }
      }
      result.push(saved!);
    }
    return result;
  });
  const itemRows = changed.length ? await db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, changed.map((order) => order.id))) : [];
  const salonRows = await db.select().from(salonsTable);
  const couriers = await couriersForOrders(changed);
  res.json(changed.flatMap((order) => {
    const salon = salonRows.find((candidate) => candidate.id === order.salonId);
    return salon ? [adminOrderDto(order, itemRows.filter((item) => item.orderId === order.id), salon, [], order.courierServiceId ? couriers.get(order.courierServiceId) : undefined)] : [];
  }));
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
  const history = await db.select().from(orderStatusHistoryTable).where(eq(orderStatusHistoryTable.orderId, order.id)).orderBy(desc(orderStatusHistoryTable.createdAt));
  const [courier] = order.courierServiceId ? await db.select().from(courierServicesTable).where(eq(courierServicesTable.id, order.courierServiceId)).limit(1) : [];
  res.json(AdminGetOrderResponse.parse(adminOrderDto(order, items, salon, history, courier)));
});

router.patch("/admin/orders/:orderId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const params = AdminUpdateOrderStatusParams.safeParse(req.params);
  const body = AdminUpdateOrderStatusBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Neispravan zahtev." }); return; }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.orderId)).limit(1);
  if (!order) { res.status(404).json({ error: "Porudžbina nije pronađena." }); return; }
  if (body.data.status && !allowedOrderTransitions[order.status]?.includes(body.data.status)) {
    res.status(400).json({ error: "Ova promena statusa nije dozvoljena." }); return;
  }
  let selectedCourier: typeof courierServicesTable.$inferSelect | null | undefined;
  if (body.data.courierServiceId !== undefined && body.data.courierServiceId !== null) {
    [selectedCourier] = await db.select().from(courierServicesTable).where(eq(courierServicesTable.id, body.data.courierServiceId)).limit(1);
    if (!selectedCourier) { res.status(400).json({ error: "Izabrana kurirska služba ne postoji." }); return; }
  }
  const update = {
    ...(body.data.status ? { status: body.data.status } : {}),
    ...(body.data.paymentStatus ? { paymentStatus: body.data.paymentStatus } : {}),
    ...(body.data.courierServiceId !== undefined ? {
      courierServiceId: selectedCourier?.id ?? null,
      courierService: selectedCourier?.name ?? null,
    } : {}),
    ...(body.data.trackingNumber !== undefined ? { trackingNumber: body.data.trackingNumber } : {}),
    ...(body.data.adminNote !== undefined ? { adminNote: body.data.adminNote } : {}),
    updatedAt: new Date(),
  };
  const [updated] = await db.transaction(async (tx) => {
    const [saved] = await tx.update(ordersTable).set(update).where(eq(ordersTable.id, order.id)).returning();
    const changes = [
      ["status", order.status, body.data.status],
      ["paymentStatus", order.paymentStatus, body.data.paymentStatus],
        ["courierService", order.courierService, body.data.courierServiceId === undefined ? undefined : selectedCourier?.name ?? null],
      ["trackingNumber", order.trackingNumber, body.data.trackingNumber],
      ["adminNote", order.adminNote, body.data.adminNote],
    ] as const;
    for (const [field, previousValue, nextValue] of changes) {
      if (nextValue !== undefined && previousValue !== nextValue) {
        await tx.insert(orderStatusHistoryTable).values({
          orderId: order.id, actorUserId: user.id, actorName: `${user.firstName} ${user.lastName}`.trim() || "Administrator",
          field, previousValue: previousValue ?? null, nextValue: nextValue ?? null,
        });
      }
    }
    const deliveryChanged = (body.data.courierServiceId !== undefined && order.courierServiceId !== (selectedCourier?.id ?? null))
      || (body.data.trackingNumber !== undefined && order.trackingNumber !== body.data.trackingNumber);
    if (deliveryChanged) {
      const courierName = selectedCourier?.name ?? order.courierService ?? "dostava";
      const tracking = body.data.trackingNumber ?? order.trackingNumber;
      await tx.insert(salonNotificationsTable).values({
        salonId: order.salonId,
        title: "Podaci o isporuci su ažurirani",
        message: tracking ? `Kurirska služba: ${courierName}. Broj za praćenje: ${tracking}.` : `Kurirska služba: ${courierName}.`,
        href: `/vlasnik/porudzbine/${order.id}`,
      });
    }
    return [saved!];
  });
  const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.id, updated!.salonId)).limit(1);
  if (body.data.status && body.data.status !== order.status) {
    const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, salon!.ownerId)).limit(1);
    if (owner) await sendTransactionalEmail({
      eventKey: `b2b-order:${updated!.id}:status:${body.data.status}`,
      emailType: "b2b_order_status",
      to: { email: owner.email, name: `${owner.firstName} ${owner.lastName}` },
      subject: `LUMERA Biznis — status porudžbine: ${body.data.status}`,
      htmlContent: lumeraEmailHtml("Status porudžbine je ažuriran", `<p>Porudžbina za ${emailSafe(salon!.name)} sada ima status <strong>${emailSafe(body.data.status)}</strong>${updated!.trackingNumber ? `. Broj za praćenje: <strong>${emailSafe(updated!.trackingNumber)}</strong>.` : ""}</p>`),
      metadata: { orderId: updated!.id, salonId: salon!.id, status: body.data.status },
    });
  }
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, updated!.id));
  const history = await db.select().from(orderStatusHistoryTable).where(eq(orderStatusHistoryTable.orderId, updated!.id)).orderBy(desc(orderStatusHistoryTable.createdAt));
  const [courier] = updated!.courierServiceId ? await db.select().from(courierServicesTable).where(eq(courierServicesTable.id, updated!.courierServiceId)).limit(1) : [];
  res.json(AdminUpdateOrderStatusResponse.parse(adminOrderDto(updated!, items, salon!, history, courier)));
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
  res.json(ListCoursesResponse.parse(views).map(calendarDateCourseResponse));
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
  res.status(201).json(calendarDateCourseResponse(CreateEducationCourseResponse.parse(view)));
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
  res.json(calendarDateCourseResponse(GetEducationCourseResponse.parse(await educationCourseView(course, access))));
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
  res.json(calendarDateCourseResponse(UpdateEducationCourseResponse.parse(await educationCourseView(updated!, access))));
});

router.post("/education/courses/:courseId/publish", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const parsed = PublishEducationCourseParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const course = await requireOwnedCourse(access, parsed.data.courseId, res); if (!course) return;
  const [updated] = await db.update(coursesTable).set({ published: true, archived: false, updatedAt: new Date() }).where(eq(coursesTable.id, course.id)).returning();
  res.json(calendarDateCourseResponse(PublishEducationCourseResponse.parse(await educationCourseView(updated!, access))));
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
  await sendTransactionalEmail({
    eventKey: `course-enrollment:${enrollment!.id}:confirmed`,
    emailType: "course_enrollment_confirmed",
    to: { email: access.user.email, name: `${access.user.firstName} ${access.user.lastName}` },
    subject: "LUMERA Edukacije — prijava je potvrđena",
    htmlContent: lumeraEmailHtml("Prijava na edukaciju je potvrđena", `<p>Uspešno ste prijavljeni na kurs <strong>${emailSafe(course.title)}</strong>.</p>`),
    metadata: { enrollmentId: enrollment!.id, courseId: course.id },
  });
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
  const response = GetEducationLmsResponse.parse({
    enrollment: await educationEnrollmentView(enrollment),
    course: await educationCourseView(course, lmsAccess.access, new Set(progress.map((item) => item.lessonId)), true),
  });
  res.json({ ...response, course: calendarDateCourseResponse(response.course) });
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
      isVerified: s.isVerified,
      topSalon: s.topSalon,
      videoUrl: s.videoUrl,
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

router.get("/admin/salons/:salonId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsedParams = AdminGetSalonParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { salonId } = parsedParams.data;

  const [salon, subscriptions, loyaltyStatuses, tiers, orders] = await Promise.all([
    db.select().from(salonsTable).where(eq(salonsTable.id, salonId)).limit(1),
    db.select().from(subscriptionsTable)
      .innerJoin(subscriptionPlansTable, eq(subscriptionsTable.planId, subscriptionPlansTable.id))
      .where(eq(subscriptionsTable.salonId, salonId)),
    db.select().from(salonLoyaltyStatusesTable).where(eq(salonLoyaltyStatusesTable.salonId, salonId)).limit(1),
    db.select().from(loyaltyTiersTable),
    db.select().from(ordersTable).where(eq(ordersTable.salonId, salonId)).orderBy(desc(ordersTable.createdAt)),
  ]);
  const profile = salon[0];
  if (!profile) { res.status(404).json({ error: "Salon nije pronađen." }); return; }

  const subscription = subscriptions[0];
  const loyalty = loyaltyStatuses[0];
  const tier = tiers.find((candidate) => candidate.id === loyalty?.tierId);
  const itemCounts = orders.length
    ? await db.select({
        orderId: orderItemsTable.orderId,
        itemCount: sql<number>`sum(${orderItemsTable.quantity})`,
      }).from(orderItemsTable).where(inArray(orderItemsTable.orderId, orders.map((order) => order.id))).groupBy(orderItemsTable.orderId)
    : [];
  const itemCountByOrder = new Map(itemCounts.map((item) => [item.orderId, Number(item.itemCount)]));
  const orderSummaries = orders.map((order) => ({
    id: order.id,
    createdAt: order.createdAt.toISOString(),
    status: order.status,
    paymentStatus: order.paymentStatus,
    deliveryMethod: order.deliveryMethod,
    total: order.total,
    itemCount: itemCountByOrder.get(order.id) ?? 0,
  }));

  res.json(AdminGetSalonResponse.parse({
    id: profile.id,
    name: profile.name,
    slug: profile.slug,
    city: profile.city,
    address: profile.address,
    postalCode: profile.postalCode ?? null,
    phone: profile.phone,
    email: profile.email,
    active: profile.active,
    featured: profile.featured,
    isVerified: profile.isVerified,
    topSalon: profile.topSalon,
    videoUrl: profile.videoUrl,
    rating: profile.rating / 10,
    reviewCount: profile.reviewCount,
    subscriptionStatus: subscription?.subscriptions.status ?? null,
    subscriptionPlan: subscription?.subscription_plans.name ?? null,
    loyaltyTier: tier?.name ?? null,
    loyaltySpend: loyalty?.currentPeriodSpend ?? 0,
    createdAt: profile.createdAt.toISOString(),
    orderCount: orders.length,
    orderTotal: orders.reduce((sum, order) => sum + order.total, 0),
    orders: orderSummaries,
  }));
});

router.patch("/admin/salons/:salonId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsedParams = AdminUpdateSalonParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { salonId } = parsedParams.data;
  const parsed = AdminUpdateSalonBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { active, featured, isVerified, topSalon, videoUrl } = parsed.data;
  if (videoUrl !== undefined && !isHttpVideoUrl(videoUrl)) { res.status(400).json({ error: "Video URL mora početi sa http:// ili https://." }); return; }

  const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.id, salonId)).limit(1);
  if (!salon) { res.status(404).json({ error: "Salon nije pronađen." }); return; }

  const updates: Partial<typeof salonsTable.$inferInsert> = {};
  if (active !== undefined) updates.active = active;
  if (featured !== undefined) updates.featured = featured;
  if (isVerified !== undefined) updates.isVerified = isVerified;
  if (topSalon !== undefined) updates.topSalon = topSalon;
  if (videoUrl !== undefined) updates.videoUrl = videoUrl;

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
    isVerified: updated!.isVerified,
    topSalon: updated!.topSalon,
    videoUrl: updated!.videoUrl,
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

  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(reviewsTable).where(eq(reviewsTable.id, reviewId)).limit(1);
    if (!existing) return null;
    if (visible === undefined) return existing;

    // Keep a moderation visibility change and the stored public aggregate
    // together so the public salon response always describes visible reviews.
    await tx.select({ id: salonsTable.id }).from(salonsTable)
      .where(eq(salonsTable.id, existing.salonId))
      .for("update");
    const [review] = await tx.update(reviewsTable)
      .set({ visible })
      .where(eq(reviewsTable.id, reviewId))
      .returning();
    if (!review) return null;

    const visibleReviews = await tx.select().from(reviewsTable).where(and(
      eq(reviewsTable.salonId, review.salonId),
      eq(reviewsTable.visible, true),
    ));
    const reviewCount = visibleReviews.length;
    const rating = reviewCount
      ? Math.round(visibleReviews.reduce((total, item) => total + item.rating, 0) / reviewCount * 10)
      : 0;
    await tx.update(salonsTable).set({ reviewCount, rating }).where(eq(salonsTable.id, review.salonId));
    return review;
  });
  if (!updated) { res.status(404).json({ error: "Recenzija nije pronađena." }); return; }

  const [salon, customer] = await Promise.all([
    db.select().from(salonsTable).where(eq(salonsTable.id, updated.salonId)).limit(1),
    db.select().from(usersTable).where(eq(usersTable.id, updated.customerId)).limit(1),
  ]);
  res.json({
    id: updated.id,
    salonId: updated.salonId,
    salonName: salon[0]?.name ?? "Nepoznat salon",
    customerId: updated.customerId,
    customerName: customer[0] ? `${customer[0].firstName} ${customer[0].lastName}` : "Nepoznat korisnik",
    serviceName: updated.serviceName,
    rating: updated.rating,
    text: updated.text,
    visible: updated.visible,
    date: updated.createdAt.toISOString(),
  });
});

router.delete("/admin/reviews/:reviewId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsedParams = AdminDeleteReviewParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { reviewId } = parsedParams.data;
  const deleted = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(reviewsTable).where(eq(reviewsTable.id, reviewId)).limit(1);
    if (!existing) return false;

    // Serialize moderator removals with customer review changes for the same
    // salon, then derive the aggregate from the final visible review set.
    await tx.select({ id: salonsTable.id }).from(salonsTable)
      .where(eq(salonsTable.id, existing.salonId))
      .for("update");
    const [review] = await tx.delete(reviewsTable).where(eq(reviewsTable.id, reviewId)).returning();
    if (!review) return false;
    const visibleReviews = await tx.select().from(reviewsTable).where(and(
      eq(reviewsTable.salonId, review.salonId),
      eq(reviewsTable.visible, true),
    ));
    const reviewCount = visibleReviews.length;
    const rating = reviewCount
      ? Math.round(visibleReviews.reduce((total, item) => total + item.rating, 0) / reviewCount * 10)
      : 0;
    await tx.update(salonsTable).set({ reviewCount, rating }).where(eq(salonsTable.id, review.salonId));
    return true;
  });
  if (!deleted) { res.status(404).json({ error: "Recenzija nije pronađena." }); return; }
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

function adminServiceCategoryDto(
  category: typeof serviceCategoriesTable.$inferSelect,
  serviceCount: number,
) {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    active: category.active,
    fallbackImageUrl: category.fallbackImageUrl ?? null,
    serviceCount,
  };
}

router.get("/category-images/:imageId", async (req, res): Promise<void> => {
  const { imageId } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(imageId)) { res.status(404).json({ error: "Slika nije pronađena." }); return; }
  try {
    res.set("Cache-Control", "public, max-age=3600");
    res.redirect(302, await signCategoryImageObject(imageId, "GET", 3600));
  } catch (error) {
    req.log.error({ err: error }, "Could not serve category image");
    res.status(404).json({ error: "Slika nije pronađena." });
  }
});

router.get("/admin/service-categories", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const [categories, counts] = await Promise.all([
    db.select().from(serviceCategoriesTable).orderBy(asc(serviceCategoriesTable.name)),
    db.select({ categoryId: servicesTable.categoryId, count: count() }).from(servicesTable).groupBy(servicesTable.categoryId),
  ]);
  const countByCategoryId = new Map(counts.map((item) => [item.categoryId, Number(item.count)]));
  res.json(AdminListServiceCategoriesResponse.parse(
    categories.map((category) => adminServiceCategoryDto(category, countByCategoryId.get(category.id) ?? 0)),
  ));
});

router.get("/admin/service-templates", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsed = AdminListServiceTemplatesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const input = parsed.data;
  const templates = await db.select().from(serviceTemplatesTable).where(and(
    input.mainCategory ? eq(serviceTemplatesTable.mainCategory, input.mainCategory) : undefined,
    input.subcategory ? eq(serviceTemplatesTable.subcategory, input.subcategory) : undefined,
    input.search ? sql`lower(${serviceTemplatesTable.name} || ' ' || ${serviceTemplatesTable.mainCategory} || ' ' || ${serviceTemplatesTable.subcategory}) like ${`%${input.search.toLowerCase()}%`}` : undefined,
  )).orderBy(asc(serviceTemplatesTable.mainCategory), asc(serviceTemplatesTable.subcategory), asc(serviceTemplatesTable.name));
  res.json(AdminListServiceTemplatesResponse.parse(templates.map(serviceTemplateDto)));
});

router.post("/admin/service-templates", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsed = AdminCreateServiceTemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (parsed.data.priceMax < parsed.data.priceMin) { res.status(400).json({ error: "Maksimalna cena ne može biti manja od minimalne." }); return; }
  const [existing] = await db.select({ id: serviceTemplatesTable.id }).from(serviceTemplatesTable)
    .where(and(eq(serviceTemplatesTable.mainCategory, parsed.data.mainCategory), eq(serviceTemplatesTable.name, parsed.data.name))).limit(1);
  if (existing) { res.status(409).json({ error: "Predložak sa ovim nazivom već postoji u kategoriji." }); return; }
  const [template] = await db.insert(serviceTemplatesTable).values(parsed.data).returning();
  res.status(201).json(AdminCreateServiceTemplateResponse.parse(serviceTemplateDto(template!)));
});

router.patch("/admin/service-templates/:templateId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const params = AdminUpdateServiceTemplateParams.safeParse(req.params);
  const parsed = AdminUpdateServiceTemplateBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [existing] = await db.select().from(serviceTemplatesTable).where(eq(serviceTemplatesTable.id, params.data.templateId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Predložak nije pronađen." }); return; }
  const next = { ...existing, ...parsed.data };
  if (next.priceMax < next.priceMin) { res.status(400).json({ error: "Maksimalna cena ne može biti manja od minimalne." }); return; }
  const [template] = await db.update(serviceTemplatesTable).set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(serviceTemplatesTable.id, existing.id)).returning();
  res.json(AdminUpdateServiceTemplateResponse.parse(serviceTemplateDto(template!)));
});

router.delete("/admin/service-templates/:templateId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const params = AdminDeleteServiceTemplateParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [template] = await db.delete(serviceTemplatesTable).where(eq(serviceTemplatesTable.id, params.data.templateId)).returning();
  if (!template) { res.status(404).json({ error: "Predložak nije pronađen." }); return; }
  res.json(serviceTemplateDto(template));
});

router.post("/admin/service-categories/image-upload-url", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsed = AdminRequestServiceCategoryImageUploadBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (!CATEGORY_IMAGE_CONTENT_TYPES.has(parsed.data.contentType.toLowerCase())) {
    res.status(400).json({ error: "Dozvoljene su JPG, PNG, WEBP i GIF slike." }); return;
  }
  try {
    const imageId = randomUUID();
    const uploadUrl = await signCategoryImageObject(imageId, "PUT", 900);
    res.json(AdminRequestServiceCategoryImageUploadResponse.parse({
      uploadUrl,
      imageUrl: categoryImageProxyUrl(imageId),
    }));
  } catch (error) {
    req.log.error({ err: error }, "Could not create category image upload URL");
    res.status(500).json({ error: "Nije moguće pripremiti upload slike." });
  }
});

router.patch("/admin/service-categories/:categoryId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const params = AdminUpdateServiceCategoryParams.safeParse(req.params);
  const parsed = AdminUpdateServiceCategoryBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [category] = await db.update(serviceCategoriesTable)
    .set({ fallbackImageUrl: parsed.data.fallbackImageUrl?.trim() || null })
    .where(eq(serviceCategoriesTable.id, params.data.categoryId))
    .returning();
  if (!category) { res.status(404).json({ error: "Kategorija usluge nije pronađena." }); return; }
  const [serviceCount] = await db.select({ count: count() }).from(servicesTable).where(eq(servicesTable.categoryId, category.id));
  marketplaceHomeDiscoveryCache.clear();
  res.json(AdminUpdateServiceCategoryResponse.parse(adminServiceCategoryDto(category, Number(serviceCount?.count ?? 0))));
});

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
  res.json({
    freeShippingThreshold: config.freeShippingThreshold, tiers: config.tiers,
    personalDeliveryEnabled: config.personalDeliveryEnabled, personalDeliveryName: config.personalDeliveryName,
    personalDeliveryPrice: config.personalDeliveryPrice, personalDeliveryDescription: config.personalDeliveryDescription,
    updatedAt: config.updatedAt.toISOString(),
  });
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
    personalDeliveryEnabled: body.personalDeliveryEnabled,
    personalDeliveryName: body.personalDeliveryName,
    personalDeliveryPrice: body.personalDeliveryPrice,
    personalDeliveryDescription: body.personalDeliveryDescription,
    updatedAt: new Date(),
  }).where(eq(shippingRulesTable.id, existing.id)).returning();
  res.json({
    freeShippingThreshold: config!.freeShippingThreshold, tiers: config!.tiers,
    personalDeliveryEnabled: config!.personalDeliveryEnabled, personalDeliveryName: config!.personalDeliveryName,
    personalDeliveryPrice: config!.personalDeliveryPrice, personalDeliveryDescription: config!.personalDeliveryDescription,
    updatedAt: config!.updatedAt.toISOString(),
  });
});

// ── Admin Courier Service Catalog ─────────────────────────────────────────────

router.get("/admin/courier-services", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const services = await db.select().from(courierServicesTable).orderBy(asc(courierServicesTable.name));
  res.json(AdminListCourierServicesResponse.parse(services.map(courierServiceDto)));
});

router.post("/admin/courier-services", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsed = AdminCreateCourierServiceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const name = parsed.data.name.trim();
  const trackingUrlTemplate = cleanTrackingTemplate(parsed.data.trackingUrlTemplate);
  if (!validTrackingTemplate(trackingUrlTemplate)) {
    res.status(400).json({ error: "URL šablon mora koristiti http/https i sadržati {trackingNumber}." }); return;
  }
  const code = courierCode(name);
  const [existing] = await db.select({ id: courierServicesTable.id }).from(courierServicesTable)
    .where(or(eq(courierServicesTable.name, name), eq(courierServicesTable.code, code))).limit(1);
  if (existing) { res.status(409).json({ error: "Kurirska služba sa tim nazivom već postoji." }); return; }
  const [service] = await db.insert(courierServicesTable).values({
    code, name, trackingUrlTemplate, active: parsed.data.active ?? true,
  }).returning();
  res.status(201).json(AdminCreateCourierServiceResponse.parse(courierServiceDto(service!)));
});

router.patch("/admin/courier-services/:courierServiceId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const params = AdminUpdateCourierServiceParams.safeParse(req.params);
  const parsed = AdminUpdateCourierServiceBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: !params.success ? params.error.message : parsed.error?.message ?? "Neispravan zahtev." }); return; }
  const [existing] = await db.select().from(courierServicesTable).where(eq(courierServicesTable.id, params.data.courierServiceId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Kurirska služba nije pronađena." }); return; }
  const name = parsed.data.name?.trim();
  const trackingUrlTemplate = parsed.data.trackingUrlTemplate === undefined ? undefined : cleanTrackingTemplate(parsed.data.trackingUrlTemplate);
  if (!validTrackingTemplate(trackingUrlTemplate)) {
    res.status(400).json({ error: "URL šablon mora koristiti http/https i sadržati {trackingNumber}." }); return;
  }
  if (name && name !== existing.name) {
    const [sameName] = await db.select({ id: courierServicesTable.id }).from(courierServicesTable).where(eq(courierServicesTable.name, name)).limit(1);
    if (sameName) { res.status(409).json({ error: "Kurirska služba sa tim nazivom već postoji." }); return; }
  }
  const [service] = await db.update(courierServicesTable).set({
    ...(name ? { name } : {}),
    ...(trackingUrlTemplate !== undefined ? { trackingUrlTemplate } : {}),
    ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    updatedAt: new Date(),
  }).where(eq(courierServicesTable.id, existing.id)).returning();
  res.json(AdminUpdateCourierServiceResponse.parse(courierServiceDto(service!)));
});

router.delete("/admin/courier-services/:courierServiceId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const params = AdminDeleteCourierServiceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [deleted] = await db.delete(courierServicesTable).where(eq(courierServicesTable.id, params.data.courierServiceId)).returning();
  if (!deleted) { res.status(404).json({ error: "Kurirska služba nije pronađena." }); return; }
  res.sendStatus(204);
});

export default router;
