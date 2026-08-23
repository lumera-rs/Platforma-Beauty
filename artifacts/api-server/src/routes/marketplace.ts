import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  publishSalonNotificationUpdate,
  subscribeToSalonNotificationEvents,
} from "../lib/salon-notification-events";
import {
  appointmentSeriesTable,
  appointmentsTable,
  beautyGlossaryTable,
  courseCategoriesTable,
  courseDaysTable,
  courseEnrollmentsTable,
  courseLessonsTable,
  courseModulesTable,
  courseReviewsTable,
  courseSessionsTable,
  courierServicesTable,
  coursesTable,
  db,
  educationCentersTable,
  educationCenterSubscriptionsTable,
  educationDisputesTable,
  educationEscrowsTable,
  educationFeaturedChargesTable,
  educationFinancialEventsTable,
  educationInstructorsTable,
  educationLedgerEntriesTable,
  educationMediaTable,
  educationMediaUploadsTable,
  educationMessagesTable,
  educationNotificationsTable,
  educationPayoutsTable,
  educationPlatformSettingsTable,
  educationThreadsTable,
  educationWaitlistTable,
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
  mediaAssetsTable,
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
  salonResourcesTable,
  salonsTable,
  salonCustomersTable,
  serviceCategoriesTable,
  serviceResourceRequirementsTable,
  serviceTemplatesTable,
  servicesTable,
  appointmentResourceAllocationsTable,
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
  DeleteSalonServiceParams,
  DisconnectAuthSignInMethodParams,
  DisconnectAuthSignInMethodResponse,
  DeleteCustomerSalonReviewParams,
  DeleteCustomerSalonReviewResponse,
  GetAdminSummaryResponse,
  GetAuthSignInMethodsResponse,
  GetCurrentUserResponse,
  GetCustomerDashboardResponse,
  GetAppointmentSalonContactParams,
  GetAppointmentSalonContactResponse,
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
  AddEducationCourseGalleryMediaBody,
  AddEducationCourseGalleryMediaResponse,
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
  RequestEducationCourseGalleryUploadBody,
  RequestEducationCourseGalleryUploadResponse,
  GetEducationLmsParams,
  GetEducationLmsResponse,
  GetPublicEducationCenterParams,
  GetPublicEducationCenterResponse,
  GetPublicEducationCourseParams,
  GetPublicEducationCourseResponse,
  ListCoursesQueryParams,
  ListCoursesResponse,
  ListEducationModulesParams,
  ListEducationModulesResponse,
  ListEducationSessionsParams,
  ListEducationSessionsResponse,
  ListPopularEducationCoursesQueryParams,
  ListPopularEducationCoursesResponse,
  ListPublicEducationCategoriesResponse,
  ListPublicEducationCoursesQueryParams,
  ListPublicEducationCoursesResponse,
  ListEnrollmentsResponse,
  ReorderEducationCourseGalleryBody,
  ReorderEducationCourseGalleryResponse,
  ListFavoritesResponse,
  ListMyAppointmentsQueryParams,
  ListMyAppointmentsResponse,
  ListSalonNotificationsResponse,
  ListEducationNotificationsResponse,
  MarkEducationNotificationReadResponse,
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
  ListCitiesResponse,
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
  ReplaceEducationCourseDaysBody,
  ReplaceEducationCourseDaysParams,
  ReplaceEducationCourseDaysResponse,
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
  DeleteEducationCourseGalleryMediaResponse,
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
  ListSalonResourcesResponse,
  CreateSalonResourceBody,
  CreateSalonResourceResponse,
  UpdateSalonResourceBody,
  UpdateSalonResourceParams,
  UpdateSalonResourceResponse,
  DeleteSalonResourceParams,
} from "@workspace/api-zod";
import { createSession, destroySession, getCurrentUser, hashPassword, isAdmin, publicUser, sessionCookieName, verifyPassword } from "../lib/auth";
import {
  BrevoConfigurationError,
  createBrevoMarketingCampaign,
  listBrevoTransactionalWebhookUrls,
  lumeraEmailHtml,
  sendBrevoCampaignNow,
  sendEducationGalleryCleanupAlert,
  sendTransactionalEmail,
  type EducationGalleryCleanupAlert,
} from "../lib/brevo";
import { ensureDemoData } from "../lib/seed";
import { maskPhone, sendPhoneVerificationCode, sendSms, sendTestSms } from "../lib/sms";
import { sendDailyAppointmentReminders } from "../lib/sms-reminders";
import { runRescheduledConfirmationRetries } from "../lib/rescheduled-confirmation-retries";
import { infobipBaseUrl, integrationDisplay, integrationSettings, integrationValue, saveIntegrationSettings, type IntegrationName } from "../lib/integrations";
import { deliveryReportStatuses, resolveWebhookSecret, webhookTokenMatches, DELIVERY_REPORT_GRACE_MINUTES, DELIVERY_REPORT_WINDOW_HOURS, WEBHOOK_VERIFICATION_REFERENCE_PREFIX } from "../lib/provider-events";
import { logger } from "../lib/logger";
import { catalogCache, publishCatalogInvalidation } from "../lib/catalog-cache";
import { lockAppointmentResources } from "../lib/appointment-locks";
import { redeemPackageSessionInTx, handleAppointmentCancellationReversalsInTx } from "../lib/package-entitlement";
import { cancelEducationEnrollment, cancelEducationSession, notifyPromotedWaiter, processUpcomingEducationSessions, releaseSeatAndPromoteWaiter } from "../lib/education-sessions";
import {
  canClaimMediaReference,
  claimMediaReference,
  mediaAssetIdFromUrl,
  releaseMediaReferenceClaims,
  stableMediaUrl,
} from "./media";
import { attachReadyImageAssets } from "./image-media";

const router: IRouter = Router();
const OAUTH_STATE_COOKIE = "lumera_oauth_state";

class MediaClaimConflictError extends Error {}

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
  const page = flow === "business" ? "/poslovna-prijava" : flow === "link" ? "/moj-nalog?tab=settings" : "/prijava";
  return `${page}${page.includes("?") ? "&" : "?"}oauth_error=${encodeURIComponent(reason)}`;
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

// Stable pagination for admin list endpoints. `page` is 1-based, `pageSize` is
// clamped to 1..100. Invalid values fall back to defaults (never a 400) so that
// existing UI callers that omit the params keep working. Returns limit/offset to
// slice a stably ordered query (createdAt desc, id desc).
type PaginationInput = { page?: unknown; pageSize?: unknown };
function parsePagination(query: PaginationInput, defaultPageSize: number): { page: number; pageSize: number; limit: number; offset: number } {
  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page;
  const rawPageSize = Array.isArray(query.pageSize) ? query.pageSize[0] : query.pageSize;
  const parsedPage = Number.parseInt(String(rawPage ?? ""), 10);
  const parsedPageSize = Number.parseInt(String(rawPageSize ?? ""), 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
  const pageSize = Number.isFinite(parsedPageSize)
    ? Math.min(100, Math.max(1, parsedPageSize))
    : defaultPageSize;
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
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
  const [selected] = owner?.activeSalonId
    ? await db.select().from(salonsTable).where(and(eq(salonsTable.ownerId, userId), eq(salonsTable.id, owner.activeSalonId))).limit(1)
    : [];
  if (selected) return selected;

  // A removed or no-longer-owned saved selection must not make every
  // owner-scoped route fail. Recover to the deterministic first location and
  // persist it so subsequent requests share the same authorized context.
  const [fallback] = await db.select().from(salonsTable)
    .where(eq(salonsTable.ownerId, userId))
    .orderBy(asc(salonsTable.createdAt), asc(salonsTable.id))
    .limit(1);
  if (fallback && owner?.activeSalonId !== fallback.id) {
    await db.update(usersTable).set({ activeSalonId: fallback.id, updatedAt: new Date() }).where(eq(usersTable.id, userId));
  }
  return fallback ?? null;
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
  batchResourceReservations: ResourceReservation[] = [],
) {
  const employee = await availableEmployeeWithDb(db, salonId, serviceId, date, startTime, endTime, preferredEmployeeId, reservedAppointments);
  if (!employee) return null;
  // Also check resource availability (read-only, no locks).
  const requirements = await fetchServiceResourceRequirements(db, serviceId);
  if (!requirements.length) return employee;
  const resourcesOk = await resourcesAvailableForSlot(db, requirements, date, startTime, endTime, batchResourceReservations);
  return resourcesOk ? employee : null;
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

const FIRST_AVAILABLE_HORIZON_DAYS = 30;
const firstAvailablePending = new Map<string, Promise<FirstAvailableResponse>>();

function dateAtOffset(startDate: Date, offset: number) {
  const date = new Date(startDate);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function firstAvailableByService(salonId: string): Promise<FirstAvailableResponse> {
  const pending = firstAvailablePending.get(salonId);
  if (pending) return pending;

  const request = computeFirstAvailableByService(salonId);
  firstAvailablePending.set(salonId, request);
  try {
    return await request;
  } finally {
    firstAvailablePending.delete(salonId);
  }
}

/**
 * Pre-aggregated resource allocation counts per resource per date, keyed as
 * `${resourceId}:${date}`.  Each entry is a list of { startTime, endTime,
 * usedQty } so the in-memory slot scan can check overlap without more DB
 * queries.
 */
type ResourceAllocationByDate = Map<string, Array<{ startTime: string; endTime: string; usedQty: number }>>;

function computeFirstAvailableServiceSlots(input: {
  services: (typeof servicesTable.$inferSelect)[];
  employees: (typeof employeesTable.$inferSelect)[];
  appointments: (typeof appointmentsTable.$inferSelect)[];
  employeeServices: (typeof employeeServicesTable.$inferSelect)[];
  schedules: (typeof employeeSchedulesTable.$inferSelect)[];
  timeOff: (typeof employeeTimeOffTable.$inferSelect)[];
  now: Date;
  /** Map from serviceId → ResourceRequirement[]. Only services with requirements need filtering. */
  resourceRequirementsByService: Map<string, ResourceRequirement[]>;
  /** Pre-aggregated allocations keyed by resourceId:date. */
  resourceAllocations: ResourceAllocationByDate;
}): FirstAvailableServiceSlot[] {
  const { services, employees, appointments, employeeServices, schedules, timeOff, now, resourceRequirementsByService, resourceAllocations } = input;
  const today = now.toISOString().slice(0, 10);
  const currentTime = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;

  return services.map((service): FirstAvailableServiceSlot => {
    const candidateIds = new Set(
      employeeServices.filter((link) => link.serviceId === service.id).map((link) => link.employeeId),
    );
    const candidates = employees.filter((employee) => candidateIds.has(employee.id));
    const serviceRequirements = resourceRequirementsByService.get(service.id) ?? [];

    for (let dayOffset = 0; dayOffset < FIRST_AVAILABLE_HORIZON_DAYS; dayOffset += 1) {
      const date = dateAtOffset(now, dayOffset);
      const weekStart = mondayOf(date);
      const sameDay = appointments.filter((appointment) => appointment.date === date);
      const sameWeek = appointments.filter((appointment) => appointment.date >= weekStart && appointment.date <= date);

      for (let hour = 9; hour < 18; hour += 1) {
        const startTime = `${String(hour).padStart(2, "0")}:00`;
        if (date === today && startTime <= currentTime) continue;
        const endTime = appointmentEndTime(startTime, service.durationMinutes);
        if (!endTime) continue;
        const available = candidates.filter((employee) =>
          employeeWorksAt(employee.id, date, startTime, endTime, schedules, timeOff)
          && !sameDay.some((appointment) => appointment.employeeId === employee.id
            && overlapsAppointment(startTime, endTime, appointment)),
        );
        if (!available.length) continue;
        // Resource capacity check (in-memory, no DB).
        if (serviceRequirements.length) {
          const resourceOk = serviceRequirements.every((req) => {
            if (!req.active) return false;
            const key = `${req.resourceId}:${date}`;
            const allocsForDay = resourceAllocations.get(key) ?? [];
            const used = allocsForDay
              .filter((a) => a.startTime < endTime && a.endTime > startTime)
              .reduce((sum, a) => sum + a.usedQty, 0);
            return used + req.quantity <= req.capacity;
          });
          if (!resourceOk) continue;
        }
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
}

function earliestSlotFromResponse(response: FirstAvailableResponse): string | null {
  const earliest = response.services
    .flatMap((service) => service.date && service.startTime ? [`${service.date}T${service.startTime}:00.000Z`] : [])
    .sort()[0];
  return earliest ?? null;
}

async function computeFirstAvailableByService(salonId: string): Promise<FirstAvailableResponse> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const horizonEnd = dateAtOffset(now, FIRST_AVAILABLE_HORIZON_DAYS - 1);
  const [services, employees, appointments] = await Promise.all([
    db.select().from(servicesTable).where(and(eq(servicesTable.salonId, salonId), eq(servicesTable.active, true))),
    db.select().from(employeesTable).where(and(eq(employeesTable.salonId, salonId), eq(employeesTable.active, true))),
    db.select().from(appointmentsTable).where(and(
      eq(appointmentsTable.salonId, salonId),
      gte(appointmentsTable.date, today),
      lte(appointmentsTable.date, horizonEnd),
      ne(appointmentsTable.status, "cancelled"),
    )),
  ]);
  const employeeIds = employees.map((employee) => employee.id);
  const serviceIds = services.map((s) => s.id);
  const [relevantLinks, relevantSchedules, relevantTimeOff, rawRequirements, rawAllocations] = await Promise.all([
    employeeIds.length ? db.select().from(employeeServicesTable).where(inArray(employeeServicesTable.employeeId, employeeIds)) : Promise.resolve([]),
    employeeIds.length ? db.select().from(employeeSchedulesTable).where(inArray(employeeSchedulesTable.employeeId, employeeIds)) : Promise.resolve([]),
    employeeIds.length ? db.select().from(employeeTimeOffTable).where(and(
      inArray(employeeTimeOffTable.employeeId, employeeIds),
      lte(employeeTimeOffTable.startDate, horizonEnd),
      gte(employeeTimeOffTable.endDate, today),
    )) : Promise.resolve([]),
    serviceIds.length ? db.select({
      serviceId: serviceResourceRequirementsTable.serviceId,
      resourceId: serviceResourceRequirementsTable.resourceId,
      quantity: serviceResourceRequirementsTable.quantity,
      capacity: salonResourcesTable.capacity,
      resourceName: salonResourcesTable.name,
      active: salonResourcesTable.active,
    }).from(serviceResourceRequirementsTable)
      .innerJoin(salonResourcesTable, eq(serviceResourceRequirementsTable.resourceId, salonResourcesTable.id))
      .where(inArray(serviceResourceRequirementsTable.serviceId, serviceIds)) : Promise.resolve([]),
    // Fetch existing allocation quantities, grouped by resource+date+timeslot.
    db.select({
      resourceId: appointmentResourceAllocationsTable.resourceId,
      date: appointmentsTable.date,
      startTime: appointmentsTable.startTime,
      endTime: appointmentsTable.endTime,
      usedQty: appointmentResourceAllocationsTable.quantity,
    }).from(appointmentResourceAllocationsTable)
      .innerJoin(appointmentsTable, eq(appointmentResourceAllocationsTable.appointmentId, appointmentsTable.id))
      .where(and(
        eq(appointmentsTable.salonId, salonId),
        gte(appointmentsTable.date, today),
        lte(appointmentsTable.date, horizonEnd),
        ne(appointmentsTable.status, "cancelled"),
      )),
  ]);

  // Build resourceRequirementsByService map.
  const resourceRequirementsByService = new Map<string, ResourceRequirement[]>();
  for (const req of rawRequirements as Array<ResourceRequirement & { serviceId: string }>) {
    const existing = resourceRequirementsByService.get(req.serviceId) ?? [];
    existing.push({ resourceId: req.resourceId, quantity: req.quantity, capacity: req.capacity, resourceName: req.resourceName, active: req.active });
    resourceRequirementsByService.set(req.serviceId, existing);
  }

  // Build resourceAllocations map: key = resourceId:date, value = [{startTime, endTime, usedQty}]
  const resourceAllocations: ResourceAllocationByDate = new Map();
  for (const alloc of rawAllocations as Array<{ resourceId: string; date: string; startTime: string; endTime: string; usedQty: number }>) {
    const key = `${alloc.resourceId}:${alloc.date}`;
    const existing = resourceAllocations.get(key) ?? [];
    existing.push({ startTime: alloc.startTime, endTime: alloc.endTime, usedQty: alloc.usedQty });
    resourceAllocations.set(key, existing);
  }

  const servicesWithFirstSlot = computeFirstAvailableServiceSlots({
    services,
    employees,
    appointments,
    employeeServices: relevantLinks,
    schedules: relevantSchedules,
    timeOff: relevantTimeOff,
    now,
    resourceRequirementsByService,
    resourceAllocations,
  });

  const response = {
    generatedAt: now.toISOString(),
    horizonDays: FIRST_AVAILABLE_HORIZON_DAYS,
    services: servicesWithFirstSlot,
  };
  return response;
}

/**
 * Thrown inside a transaction when a resource capacity check fails, so the
 * transaction rolls back before any rows are committed.  Caught by callers
 * outside the transaction and converted to a 409 response.
 */
class ResourceCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceCapacityError";
  }
}

/**
 * Fetch service resource requirements from DB once and return them as a typed
 * array.  Used by both the write path (inside tx) and the read/preview path
 * (against plain db).
 */
type ResourceRequirement = {
  resourceId: string;
  quantity: number;
  capacity: number;
  resourceName: string;
  active: boolean;
};

async function fetchServiceResourceRequirements(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any,
  serviceId: string,
): Promise<ResourceRequirement[]> {
  return store.select({
    resourceId: serviceResourceRequirementsTable.resourceId,
    quantity: serviceResourceRequirementsTable.quantity,
    capacity: salonResourcesTable.capacity,
    resourceName: salonResourcesTable.name,
    active: salonResourcesTable.active,
  }).from(serviceResourceRequirementsTable)
    .innerJoin(salonResourcesTable, eq(serviceResourceRequirementsTable.resourceId, salonResourcesTable.id))
    .where(eq(serviceResourceRequirementsTable.serviceId, serviceId)) as Promise<ResourceRequirement[]>;
}

async function fetchAppointmentResourceRequirements(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any,
  appointmentId: string,
): Promise<ResourceRequirement[]> {
  return store.select({
    resourceId: appointmentResourceAllocationsTable.resourceId,
    quantity: appointmentResourceAllocationsTable.quantity,
    capacity: salonResourcesTable.capacity,
    resourceName: salonResourcesTable.name,
    active: salonResourcesTable.active,
  }).from(appointmentResourceAllocationsTable)
    .innerJoin(salonResourcesTable, eq(appointmentResourceAllocationsTable.resourceId, salonResourcesTable.id))
    .where(eq(appointmentResourceAllocationsTable.appointmentId, appointmentId)) as Promise<ResourceRequirement[]>;
}

/**
 * In-memory resource reservation list used for preview/availability checks so
 * that within a single batch (series preview, multi-slot booking) each slot
 * accounts for units already reserved by earlier slots in the same batch.
 */
type ResourceReservation = {
  resourceId: string;
  quantity: number;
  date: string;
  startTime: string;
  endTime: string;
};

/**
 * Check whether all requirements for a service can be satisfied for the given
 * slot.  Uses DB counts of already-allocated units plus in-memory reservations
 * for the current batch.  Does NOT write anything.
 *
 * Pass `excludeAppointmentIds` when re-checking a reschedule so the current
 * appointment's existing allocation isn't double-counted.
 */
async function resourcesAvailableForSlot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any,
  requirements: ResourceRequirement[],
  date: string,
  startTime: string,
  endTime: string,
  batchReservations: ResourceReservation[] = [],
  excludeAppointmentIds: string[] = [],
): Promise<boolean> {
  for (const req of requirements) {
    if (!req.active) return false;
    const overlapping = await store.select({
      usedQty: sql<number>`coalesce(sum(${appointmentResourceAllocationsTable.quantity}), 0)::int`,
    }).from(appointmentResourceAllocationsTable)
      .innerJoin(appointmentsTable, eq(appointmentResourceAllocationsTable.appointmentId, appointmentsTable.id))
      .where(and(
        eq(appointmentResourceAllocationsTable.resourceId, req.resourceId),
        eq(appointmentsTable.date, date),
        ne(appointmentsTable.status, "cancelled"),
        lt(appointmentsTable.startTime, endTime),
        gt(appointmentsTable.endTime, startTime),
        excludeAppointmentIds.length ? notInArray(appointmentsTable.id, excludeAppointmentIds) : sql`true`,
      )) as Array<{ usedQty: number }>;
    const dbUsed = overlapping[0]?.usedQty ?? 0;
    const batchUsed = batchReservations
      .filter((r) => r.resourceId === req.resourceId && r.date === date && r.startTime < endTime && r.endTime > startTime)
      .reduce((sum, r) => sum + r.quantity, 0);
    if (dbUsed + batchUsed + req.quantity > req.capacity) return false;
  }
  return true;
}

/**
 * Fetches and locks all resource requirements for a service within a
 * transaction, checks capacity against concurrent appointments in [startTime,
 * endTime), and inserts allocation rows for the new appointment.
 *
 * Must be called inside a transaction after employee locks have been acquired.
 * Resource locks are appended after employee locks (salon -> day -> employee ->
 * resource) to maintain deadlock-free deterministic ordering.
 *
 * Throws ResourceCapacityError so the surrounding transaction rolls back.
 * Services with no requirements are a no-op.
 * Cancelled appointments do not consume capacity.
 */
async function allocateResourcesInTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  salonId: string,
  requirements: ResourceRequirement[],
  appointmentId: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeAppointmentIds: string[] = [],
): Promise<void> {
  if (!requirements.length) return;

  // Acquire resource/day advisory locks after employee locks.
  await lockAppointmentResources(tx, salonId, requirements.map((r) => ({ date, resourceId: r.resourceId })));

  for (const req of requirements) {
    if (!req.active) {
      throw new ResourceCapacityError(`Resurs "${req.resourceName}" nije aktivan.`);
    }
    const overlapping = await tx.select({
      usedQty: sql<number>`coalesce(sum(${appointmentResourceAllocationsTable.quantity}), 0)::int`,
    }).from(appointmentResourceAllocationsTable)
      .innerJoin(appointmentsTable, eq(appointmentResourceAllocationsTable.appointmentId, appointmentsTable.id))
      .where(and(
        eq(appointmentResourceAllocationsTable.resourceId, req.resourceId),
        eq(appointmentsTable.date, date),
        ne(appointmentsTable.status, "cancelled"),
        lt(appointmentsTable.startTime, endTime),
        gt(appointmentsTable.endTime, startTime),
        excludeAppointmentIds.length ? notInArray(appointmentsTable.id, excludeAppointmentIds) : sql`true`,
      )) as Array<{ usedQty: number }>;
    const usedQty = overlapping[0]?.usedQty ?? 0;
    if (usedQty + req.quantity > req.capacity) {
      throw new ResourceCapacityError(`Nema dovoljno kapaciteta za resurs "${req.resourceName}".`);
    }
  }

  // All checks passed – write allocation rows.
  await tx.insert(appointmentResourceAllocationsTable).values(
    requirements.map((req) => ({
      appointmentId,
      resourceId: req.resourceId,
      quantity: req.quantity,
    })),
  ).onConflictDoNothing();
}

/**
 * Thrown inside the createAllocatedAppointment transaction when an atomic
 * package redemption fails, so the whole booking rolls back. The route maps
 * `reason` to a clear 4xx code.
 */
class PackageRedemptionError extends Error {
  constructor(public reason: string) {
    super(`Package redemption failed: ${reason}`);
    this.name = "PackageRedemptionError";
  }
}

async function createAllocatedAppointment(input: {
  salonId: string; customerId: string | null; salonCustomerId?: string | null; serviceId: string; date: string; startTime: string;
  endTime: string; durationMinutes: number; price: number; status: "pending" | "confirmed"; notes?: string | null; preferredEmployeeId?: string | null;
  treatmentLocation?: "salon" | "home"; travelFee?: number; treatmentAddress?: { line1: string; city: string; postalCode?: string; details?: string } | null;
  /** When set, redeem this package purchase against the created appointment in the SAME transaction. */
  packagePurchaseId?: string | null;
}): Promise<{ employee: typeof employeesTable.$inferSelect; appointment: typeof appointmentsTable.$inferSelect } | { employee: null; appointment: null }> {
  return db.transaction(async (tx) => {
    await lockAppointmentResources(tx, input.salonId, [{ date: input.date }]);
    const employee = await availableEmployeeWithDb(tx, input.salonId, input.serviceId, input.date, input.startTime, input.endTime, input.preferredEmployeeId);
    if (!employee) return { employee: null, appointment: null };
    await lockAppointmentResources(tx, input.salonId, [{ date: input.date, employeeId: employee.id }]);
    const requirements = await fetchServiceResourceRequirements(tx, input.serviceId);
    const [appointment] = await tx.insert(appointmentsTable).values({
      salonId: input.salonId, customerId: input.customerId, salonCustomerId: input.salonCustomerId ?? null, employeeId: employee.id, serviceId: input.serviceId,
      date: input.date, startTime: input.startTime, endTime: input.endTime, durationMinutes: input.durationMinutes, price: input.price, status: input.status, notes: input.notes ?? null,
      treatmentLocation: input.treatmentLocation ?? "salon", travelFee: input.travelFee ?? 0,
      treatmentAddressLine1: input.treatmentAddress?.line1 ?? null, treatmentAddressCity: input.treatmentAddress?.city ?? null,
      treatmentAddressPostalCode: input.treatmentAddress?.postalCode ?? null, treatmentAddressDetails: input.treatmentAddress?.details ?? null,
    }).returning();
    // allocateResourcesInTx throws ResourceCapacityError → transaction rolls back.
    await allocateResourcesInTx(tx, input.salonId, requirements, appointment!.id, input.date, input.startTime, input.endTime);
    // Atomic package redemption — any failure throws → whole booking rolls back.
    if (input.packagePurchaseId) {
      if (!input.salonCustomerId) throw new PackageRedemptionError("wrong_customer");
      const redemption = await redeemPackageSessionInTx(tx, {
        purchaseId: input.packagePurchaseId,
        appointmentId: appointment!.id,
        salonId: input.salonId,
        requestingCustomerId: input.salonCustomerId,
      });
      if (!redemption.ok) throw new PackageRedemptionError(redemption.reason);
      // Redemption zeroed the stored price — reflect it in the returned row.
      return { employee, appointment: { ...appointment!, price: 0 } };
    }
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
  const batchResourceReservations: ResourceReservation[] = [];
  const requirements = await fetchServiceResourceRequirements(db, serviceId);
  for (const slot of slots) {
    const employee = await availableEmployee(salonId, serviceId, slot.date, slot.startTime, slot.endTime, preferredEmployeeId, reservedAppointments, batchResourceReservations);
    const available = Boolean(employee);
    result.push({
      date: slot.date,
      startTime: slot.startTime,
      available,
      reason: available ? null : "Nema slobodnog zaposlenog, termin izlazi van radnog vremena, ili nema dostupnih resursa.",
    });
    if (employee) {
      reservedAppointments.push({ employeeId: employee.id, date: slot.date, startTime: slot.startTime, endTime: slot.endTime });
      for (const req of requirements) {
        batchResourceReservations.push({ resourceId: req.resourceId, quantity: req.quantity, date: slot.date, startTime: slot.startTime, endTime: slot.endTime });
      }
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
    const requirements = await fetchServiceResourceRequirements(tx, input.service.id);
    const batchResourceReservations: ResourceReservation[] = [];
    for (const slot of input.slots) {
      const resourceAvailable = await resourcesAvailableForSlot(tx, requirements, slot.date, slot.startTime, slot.endTime, batchResourceReservations);
      if (!resourceAvailable) throw new AppointmentSeriesError(`Nema dovoljno kapaciteta resursa za termin ${slot.date} u ${slot.startTime}.`);
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
      for (const req of requirements) {
        batchResourceReservations.push({ resourceId: req.resourceId, quantity: req.quantity, date: slot.date, startTime: slot.startTime, endTime: slot.endTime });
      }
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
      // allocateResourcesInTx throws ResourceCapacityError → rolls back.
      await allocateResourcesInTx(tx, input.salonId, requirements, appointment!.id, slot.date, slot.startTime, slot.endTime);
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
  const ignoredIdArray = [...ignoredAppointmentIds];
  const reservedAppointments: ReservedAppointment[] = [];
  const batchResourceReservations: ResourceReservation[] = [];
  // All appointments in a series share one service.
  const requirements = slots.length ? await fetchServiceResourceRequirements(store, slots[0]!.appointment.serviceId) : [];
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
    let resourcesOk = true;
    if (employee && requirements.length) {
      resourcesOk = await resourcesAvailableForSlot(store, requirements, slot.date, slot.startTime, slot.endTime, batchResourceReservations, ignoredIdArray);
    }
    const available = Boolean(employee) && resourcesOk;
    result.push({
      appointmentId: slot.appointment.id,
      currentDate: slot.appointment.date,
      currentStartTime: slot.appointment.startTime,
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      available,
      reason: available ? null : (!employee ? "Zaposleni nije slobodan u novom terminu ili tada ne radi." : "Nema dovoljno kapaciteta resursa u novom terminu."),
    });
    if (available) {
      reservedAppointments.push({ employeeId: employee!.id, date: slot.date, startTime: slot.startTime, endTime: slot.endTime });
      for (const req of requirements) {
        batchResourceReservations.push({ resourceId: req.resourceId, quantity: req.quantity, date: slot.date, startTime: slot.startTime, endTime: slot.endTime });
      }
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
    // Pre-check resource capacity for all new slots before writing, accounting
    // for in-batch reservations and ignoring the appointments being moved.
    {
      const ignoredIds = [...ignoredAppointmentIds];
      const batchResourceReservations: ResourceReservation[] = [];
      // Fetch requirements once – all appointments share the same service in a series.
      const requirements = allocations.length
        ? await fetchServiceResourceRequirements(tx, allocations[0]!.slot.appointment.serviceId)
        : [];
      for (const { slot } of allocations) {
        const available = await resourcesAvailableForSlot(tx, requirements, slot.date, slot.startTime, slot.endTime, batchResourceReservations, ignoredIds);
        if (!available) throw new AppointmentSeriesError(`Nema dovoljno kapaciteta resursa za termin ${slot.date} u ${slot.startTime}.`);
        for (const req of requirements) {
          batchResourceReservations.push({ resourceId: req.resourceId, quantity: req.quantity, date: slot.date, startTime: slot.startTime, endTime: slot.endTime });
        }
      }
    }
    await lockAppointmentResources(tx, input.salonId, allocations.map(({ slot, employee }) => ({
      date: slot.date,
      employeeId: employee.id,
    })));
    const moved: (typeof appointmentsTable.$inferSelect)[] = [];
    for (const { slot, employee } of allocations) {
      const requirements = await fetchServiceResourceRequirements(tx, slot.appointment.serviceId);
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
      // Delete old allocations before re-allocating at new time.
      await tx.delete(appointmentResourceAllocationsTable)
        .where(eq(appointmentResourceAllocationsTable.appointmentId, appointment.id));
      // allocateResourcesInTx throws ResourceCapacityError → rolls back.
      await allocateResourcesInTx(tx, input.salonId, requirements, appointment.id, slot.date, slot.startTime, slot.endTime);
      moved.push(appointment);
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

export type EducationAccess = {
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
  if (user.role === "CUSTOMER" || user.role === "STUDENT") {
    return { access: { user, salon: null, centers: [], admin: false }, learnerEmployeeId: null };
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

function hasActiveEducationSubscription(status: string | null | undefined) {
  return status === "active" || status === "free_via_loyalty";
}

async function getEducationPlatformSettings() {
  const [existing] = await db.select().from(educationPlatformSettingsTable).orderBy(asc(educationPlatformSettingsTable.createdAt)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(educationPlatformSettingsTable).values({}).returning();
  return created!;
}

async function lockEducationCenterFinancials(tx: any, centerId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`education-center:${centerId}`}))`);
}

async function educationCenterEligibility(centerId: string) {
  const [center, subscription] = await Promise.all([
    db.select().from(educationCentersTable).where(eq(educationCentersTable.id, centerId)).limit(1),
    db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, centerId)).limit(1),
  ]);
  return {
    center: center[0] ?? null,
    subscription: subscription[0] ?? null,
    eligible: center[0]?.verificationStatus === "verified" && hasActiveEducationSubscription(subscription[0]?.status),
  };
}

/**
 * Batch variant of educationCenterEligibility.
 * Returns a Map<centerId, boolean> for all requested centerIds in two DB round-trips.
 */
async function batchCenterEligibility(centerIds: string[]): Promise<Map<string, boolean>> {
  _hookAssembler("batchCenterEligibility");
  if (!centerIds.length) return new Map();
  const [centers, subscriptions] = await Promise.all([
    db.select().from(educationCentersTable).where(inArray(educationCentersTable.id, centerIds)),
    db.select().from(educationCenterSubscriptionsTable).where(inArray(educationCenterSubscriptionsTable.centerId, centerIds)),
  ]);
  const subByCenterId = new Map(subscriptions.map((s) => [s.centerId, s]));
  const result = new Map<string, boolean>();
  for (const center of centers) {
    const sub = subByCenterId.get(center.id);
    result.set(center.id, center.verificationStatus === "verified" && hasActiveEducationSubscription(sub?.status));
  }
  return result;
}

/**
 * Test-only instrumentation sink.  In NODE_ENV=test callers may set this via
 * setMarketplaceAssemblerTestHook() to assert that batch assemblers are used
 * instead of per-row DB queries.  No-op in production — zero runtime overhead.
 *
 * Usage (vitest/jest):
 *   import { setMarketplaceAssemblerTestHook } from "./marketplace";
 *   const calls: string[] = [];
 *   setMarketplaceAssemblerTestHook((name) => calls.push(name));
 *   // ... invoke route ...
 *   expect(calls).toContain("batchEducationCourseViews");
 *   afterEach(() => setMarketplaceAssemblerTestHook(null));
 */
let _assemblerHook: ((assembler: string) => void) | null = null;
export function setMarketplaceAssemblerTestHook(fn: ((assembler: string) => void) | null): void {
  _assemblerHook = fn;
}
function _hookAssembler(name: string) {
  if (process.env.NODE_ENV !== "production") _assemblerHook?.(name);
}

async function isPublicEducationCourse(course: typeof coursesTable.$inferSelect) {
  if (!course.published || course.archived) return false;
  // Salon-internal courses stay in the business LMS. Only subscribed, verified
  // education centers can sell through the protected public marketplace.
  if (!course.centerId) return false;
  return (await educationCenterEligibility(course.centerId)).eligible;
}

// A course is only *publicly* featured once its featured placement has actually
// been paid for. Activating featured placement flips `isFeatured` immediately and
// records a charge, but a non-zero charge stays "pending" until an administrator
// confirms the manual payment. Until then the placement must not surface publicly.
// A zero-fee charge is recorded as "paid" on activation, so this stays sensible.
async function isPubliclyFeaturedEducationCourse(course: typeof coursesTable.$inferSelect) {
  if (!course.isFeatured) return false;
  if (course.featuredUntil && course.featuredUntil <= new Date()) return false;
  const charge = await latestFeaturedCharge(course.id);
  return charge?.status === "paid";
}

async function releaseAtForEducationCourse(
  course: typeof coursesTable.$inferSelect,
  settings: typeof educationPlatformSettingsTable.$inferSelect,
  assignedSession?: Pick<typeof courseSessionsTable.$inferSelect, "id" | "endsAt"> | null,
) {
  if (course.format === "online") {
    return new Date(Date.now() + settings.onlineRefundDays * 24 * 60 * 60 * 1000);
  }
  if (!assignedSession?.endsAt || assignedSession.endsAt <= new Date()) throw new Error("Nije moguće potvrditi kupovinu za termin koji je već završen.");
  return new Date(assignedSession.endsAt.getTime() + settings.liveAppealDays * 24 * 60 * 60 * 1000);
}

async function refreshMatureEducationEscrows() {
  const candidates = await db.select({ centerId: educationEscrowsTable.centerId }).from(educationEscrowsTable)
    .where(and(eq(educationEscrowsTable.status, "held"), sql`${educationEscrowsTable.releaseAt} <= now()`));
  const centerIds = [...new Set(candidates.map(({ centerId }) => centerId))].sort();
  for (const centerId of centerIds) {
    await db.transaction(async (tx) => {
      // Maturity is a financial transition too. Re-check due rows after taking
      // the center lock so a dispute can win the deadline boundary atomically.
      await lockEducationCenterFinancials(tx, centerId);
      const due = await tx.select().from(educationEscrowsTable)
        .where(and(
          eq(educationEscrowsTable.centerId, centerId),
          eq(educationEscrowsTable.status, "held"),
          sql`${educationEscrowsTable.releaseAt} <= now()`,
        ))
        .for("update");
      for (const escrow of due) {
        const [updated] = await tx.update(educationEscrowsTable)
          .set({ status: "ready_for_payout", releasedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(educationEscrowsTable.id, escrow.id), eq(educationEscrowsTable.status, "held")))
          .returning();
        if (updated) {
          await tx.insert(educationLedgerEntriesTable).values({
            escrowId: updated.id,
            enrollmentId: updated.enrollmentId,
            centerId: updated.centerId,
            type: "release",
            amount: updated.netAmount,
            note: "Sredstva su postala spremna za ručnu isplatu.",
            idempotencyKey: `education-escrow:${updated.id}:release`,
          });
          await tx.insert(educationFinancialEventsTable).values({
            escrowId: updated.id,
            enrollmentId: updated.enrollmentId,
            eventType: "escrow_released",
            previousStatus: "held",
            nextStatus: "ready_for_payout",
            amount: updated.netAmount,
          });
        }
      }
    });
  }
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

async function requireOwnedEducationCenterCourse(access: EducationAccess, courseId: string, res: Response) {
  const course = await requireOwnedCourse(access, courseId, res);
  if (!course) return null;
  if (!course.centerId || !access.centers.some((center) => center.id === course.centerId)) {
    res.status(403).json({ error: "Galerijom mogu upravljati samo vlasnici edukativnog centra." });
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

async function sessionsForCourse(courseId: string, includeLocation = false) {
  const sessions = await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.courseId, courseId)).orderBy(asc(courseSessionsTable.startsAt));
  return sessions.map((session) => ({
    id: session.id,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    location: includeLocation ? session.location : null,
    capacity: session.capacity,
    reservedSeats: session.reservedSeats,
    availableSeats: Math.max(0, session.capacity - session.reservedSeats),
    minimumEnrollments: session.minimumEnrollments,
    cancelledAt: session.cancelledAt?.toISOString() ?? null,
  }));
}

function educationMediaRouteUrl(mediaId: string): string {
  return `/api/education/media/${mediaId}`;
}

function isManagedEducationGalleryObjectPath(media: typeof educationMediaTable.$inferSelect): boolean {
  return Boolean(media.courseId && media.centerId
    && media.objectPath.startsWith(`/objects/education-gallery/${media.centerId}/${media.courseId}/`));
}

function publicEducationMediaUrl(media: typeof educationMediaTable.$inferSelect): string {
  if (isManagedEducationGalleryObjectPath(media)) return educationMediaRouteUrl(media.id);
  const legacyUrl = media.objectPath.trim();
  if (legacyUrl.startsWith("/api/media/")) return legacyUrl;
  if (legacyUrl.startsWith("/objects/")) return `/api/storage${legacyUrl}`;
  if (legacyUrl.startsWith("/api/storage/objects/") || /^https?:\/\//i.test(legacyUrl)) return legacyUrl;
  return `/api/storage/objects/${legacyUrl.replace(/^\/+/, "")}`;
}

function educationMediaObjectPath(centerId: string, courseId: string, mediaId: string): string {
  const root = process.env.PRIVATE_OBJECT_DIR;
  if (!root) throw new Error("App Storage nije podešen.");
  return `${root.replace(/\/+$/, "")}/education-gallery/${centerId}/${courseId}/${mediaId}`;
}

function educationMediaStagingObjectPath(centerId: string, courseId: string, mediaId: string): string {
  const root = process.env.PRIVATE_OBJECT_DIR;
  if (!root) throw new Error("App Storage nije podešen.");
  return `${root.replace(/\/+$/, "")}/education-gallery-staging/${centerId}/${courseId}/${mediaId}`;
}

function educationMediaStoragePath(centerId: string, courseId: string, mediaId: string): string {
  return `/objects/education-gallery/${centerId}/${courseId}/${mediaId}`;
}

function educationMediaStagingStoragePath(centerId: string, courseId: string, mediaId: string): string {
  return `/objects/education-gallery-staging/${centerId}/${courseId}/${mediaId}`;
}

function privateObjectPathFromStoragePath(storagePath: string): string {
  if (!storagePath.startsWith("/objects/")) throw new Error("Neispravna putanja objekta.");
  const root = process.env.PRIVATE_OBJECT_DIR;
  if (!root) throw new Error("App Storage nije podešen.");
  return `${root.replace(/\/+$/, "")}/${storagePath.slice("/objects/".length)}`;
}

function hasExpectedImageSignature(contentType: string, bytes: Buffer): boolean {
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === "image/webp") return bytes.length >= 12 && bytes.subarray(0, 4).equals(Buffer.from("RIFF")) && bytes.subarray(8, 12).equals(Buffer.from("WEBP"));
  if (contentType === "image/gif") return bytes.length >= 6 && (bytes.subarray(0, 6).equals(Buffer.from("GIF87a")) || bytes.subarray(0, 6).equals(Buffer.from("GIF89a")));
  return false;
}

async function signPrivateObject(rawPath: string, method: "DELETE" | "GET" | "PUT", ttlSeconds: number): Promise<string> {
  const [, bucketName, ...objectParts] = rawPath.startsWith("/") ? rawPath.split("/") : `/${rawPath}`.split("/");
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

async function deletePrivateObject(storagePath: string): Promise<void> {
  const deleteUrl = await signPrivateObject(privateObjectPathFromStoragePath(storagePath), "DELETE", 60);
  const response = await fetch(deleteUrl, {
    method: "DELETE",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.ok || response.status === 404) return;
  throw new Error(`App Storage nije obrisao objekat (${response.status}).`);
}

function managedEducationMediaObjectPath(media: typeof educationMediaTable.$inferSelect): string {
  return educationMediaStoragePath(media.centerId!, media.courseId!, media.id);
}

function isManagedEducationMediaObject(media: typeof educationMediaTable.$inferSelect): boolean {
  return Boolean(media.courseId && media.centerId && media.objectPath === managedEducationMediaObjectPath(media));
}

async function readVerifiedEducationMediaUpload(upload: typeof educationMediaUploadsTable.$inferSelect): Promise<Buffer | null> {
  const downloadUrl = await signPrivateObject(privateObjectPathFromStoragePath(upload.objectPath), "GET", 60);
  const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
  const contentLength = Number(response.headers.get("content-length"));
  if (contentType !== upload.contentType || !Number.isInteger(contentLength) || contentLength !== upload.size || contentLength > MAX_EDUCATION_GALLERY_IMAGE_BYTES) {
    response.body?.cancel();
    return null;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.length === upload.size && hasExpectedImageSignature(upload.contentType, bytes) ? bytes : null;
}

async function promoteEducationMediaUpload(upload: typeof educationMediaUploadsTable.$inferSelect, bytes: Buffer): Promise<string> {
  const finalStoragePath = educationMediaStoragePath(upload.centerId, upload.courseId, upload.id);
  const uploadUrl = await signPrivateObject(educationMediaObjectPath(upload.centerId, upload.courseId, upload.id), "PUT", 60);
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": upload.contentType },
    body: bytes,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`App Storage nije sačuvao proverenu sliku (${response.status}).`);
  return finalStoragePath;
}

async function lockEducationCourseGallery(tx: any, courseId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`education-course-gallery:${courseId}`}))`);
}

async function lockEducationMediaObject(tx: any, objectPath: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`education-media-object:${objectPath}`}))`);
}

type EducationGalleryCleanupResult = {
  scanned: number;
  deletedTickets: number;
  deletedStagingObjects: number;
  failed: number;
};

const EDUCATION_GALLERY_CLEANUP_ALERT_FAILURE_COUNT = 3;
type EducationGalleryCleanupOptions = {
  notify?: (alert: EducationGalleryCleanupAlert, now: Date) => Promise<unknown>;
};

function educationMediaUploadCleanupEligibility(now: Date) {
  return or(
    isNotNull(educationMediaUploadsTable.attachedAt),
    and(isNull(educationMediaUploadsTable.attachedAt), lt(educationMediaUploadsTable.expiresAt, now)),
  );
}

async function recordEducationGalleryCleanupFailure(uploadId: string, failedAt: Date): Promise<number | null> {
  const [upload] = await db.update(educationMediaUploadsTable)
    .set({
      cleanupFailureCount: sql`${educationMediaUploadsTable.cleanupFailureCount} + 1`,
      lastCleanupFailureAt: failedAt,
    })
    .where(eq(educationMediaUploadsTable.id, uploadId))
    .returning({ cleanupFailureCount: educationMediaUploadsTable.cleanupFailureCount });
  return upload?.cleanupFailureCount ?? null;
}

async function educationGalleryCleanupAlertSummary(): Promise<EducationGalleryCleanupAlert> {
  const [summary] = await db.select({
    failedTickets: count(educationMediaUploadsTable.id),
    failureAttempts: sql<number>`coalesce(sum(${educationMediaUploadsTable.cleanupFailureCount}), 0)::int`,
    repeatedFailureTickets: sql<number>`count(*) filter (where ${educationMediaUploadsTable.cleanupFailureCount} >= ${EDUCATION_GALLERY_CLEANUP_ALERT_FAILURE_COUNT})::int`,
  })
    .from(educationMediaUploadsTable)
    .where(and(
      educationMediaUploadCleanupEligibility(new Date()),
      gt(educationMediaUploadsTable.cleanupFailureCount, 0),
    ));
  return summary ?? { failedTickets: 0, failureAttempts: 0, repeatedFailureTickets: 0 };
}

export async function cleanupEducationMediaUpload(
  candidate: typeof educationMediaUploadsTable.$inferSelect,
  now: Date,
): Promise<"deleted" | "skipped"> {
  return db.transaction(async (tx) => {
    // Keep the same lock order as attach/delete operations. This makes an
    // expired ticket unable to win a race with an in-flight attachment.
    await lockEducationCourseGallery(tx, candidate.courseId);
    const [upload] = await tx.select().from(educationMediaUploadsTable)
      .where(eq(educationMediaUploadsTable.id, candidate.id))
      .for("update")
      .limit(1);
    if (!upload) return "skipped";

    const [media] = await tx.select({ id: educationMediaTable.id })
      .from(educationMediaTable)
      .where(eq(educationMediaTable.id, upload.id))
      .limit(1);
    const expiredUnattached = !upload.attachedAt && upload.expiresAt < now;
    const attached = Boolean(upload.attachedAt);
    if ((!expiredUnattached && !attached) || (!upload.attachedAt && media)) return "skipped";

    const expectedStagingPath = educationMediaStagingStoragePath(upload.centerId, upload.courseId, upload.id);
    // Never let a database row with an unexpected path turn this maintenance
    // job into a general-purpose object deletion mechanism.
    if (upload.objectPath !== expectedStagingPath) {
      throw new Error(`Neispravna staging putanja za upload ${upload.id}.`);
    }
    if (expiredUnattached) {
      const finalStoragePath = educationMediaStoragePath(upload.centerId, upload.courseId, upload.id);
      await lockEducationMediaObject(tx, finalStoragePath);
      const finalReferences = await tx.select({ id: educationMediaTable.id })
        .from(educationMediaTable)
        .where(eq(educationMediaTable.objectPath, finalStoragePath))
        .limit(1);
      if (!finalReferences.length) {
        // Promotion happens before the attachment row is committed. If that
        // transaction ever rolls back, the expired ticket is the durable
        // claim that makes this otherwise-unreachable final key safe to retry.
        await deletePrivateObject(finalStoragePath);
      }
    }
    await deletePrivateObject(upload.objectPath);
    await tx.delete(educationMediaUploadsTable).where(eq(educationMediaUploadsTable.id, upload.id));
    return "deleted";
  });
}

export async function runEducationGalleryCleanup(options: EducationGalleryCleanupOptions = {}): Promise<EducationGalleryCleanupResult> {
  const now = new Date();
  const candidates = await db.select().from(educationMediaUploadsTable)
    .where(educationMediaUploadCleanupEligibility(now))
    .orderBy(asc(educationMediaUploadsTable.createdAt))
    .limit(100);
  const result: EducationGalleryCleanupResult = {
    scanned: candidates.length,
    deletedTickets: 0,
    deletedStagingObjects: 0,
    failed: 0,
  };
  for (const candidate of candidates) {
    try {
      if (await cleanupEducationMediaUpload(candidate, now) === "deleted") {
        result.deletedTickets += 1;
        result.deletedStagingObjects += 1;
      }
    } catch (error) {
      result.failed += 1;
      let cleanupFailureCount: number | null = null;
      try {
        cleanupFailureCount = await recordEducationGalleryCleanupFailure(candidate.id, now);
      } catch (recordingError) {
        logger.error({ err: recordingError }, "Education gallery cleanup failure could not be recorded");
      }
      logger.warn(
        {
          cleanupFailureCount,
          errorType: error instanceof Error ? error.name : typeof error,
        },
        "Education gallery cleanup failed",
      );
      if (cleanupFailureCount !== null && cleanupFailureCount >= EDUCATION_GALLERY_CLEANUP_ALERT_FAILURE_COUNT) {
        logger.warn(
          { cleanupFailureCount },
          "Education gallery cleanup needs attention: inspect App Storage availability and the cleanup job credentials",
        );
        try {
          const alert = await educationGalleryCleanupAlertSummary();
          await (options.notify ?? sendEducationGalleryCleanupAlert)(alert, now);
        } catch (notificationError) {
          logger.error(
            {
              cleanupFailureCount,
              errorType: notificationError instanceof Error ? notificationError.name : typeof notificationError,
            },
            "Education gallery cleanup alert notification failed",
          );
        }
      }
    }
  }
  return result;
}

async function courseDayProgram(courseId: string) {
  const days = await db.select().from(courseDaysTable)
    .where(eq(courseDaysTable.courseId, courseId))
    .orderBy(asc(courseDaysTable.sortOrder), asc(courseDaysTable.dayNumber));
  return days.map((day) => ({
    id: day.id,
    dayNumber: day.dayNumber,
    title: day.title,
    description: day.description,
    durationMinutes: day.durationMinutes,
  }));
}

async function educationMediaViews(scope: { courseId?: string; centerId?: string }) {
  const where = scope.courseId
    ? eq(educationMediaTable.courseId, scope.courseId)
    : eq(educationMediaTable.centerId, scope.centerId!);
  const media = await db.select().from(educationMediaTable).where(where)
    .orderBy(asc(educationMediaTable.sortOrder), asc(educationMediaTable.createdAt));
  return media.map((item) => ({
    id: item.id,
    url: publicEducationMediaUrl(item),
    altText: item.altText,
    sortOrder: item.sortOrder,
  }));
}

async function centerEducationMediaViews(centerId: string) {
  const centerCourses = await db.select().from(coursesTable).where(eq(coursesTable.centerId, centerId));
  // Use batch eligibility to avoid one center+subscription query per course.
  const uniqueCenterIds = [...new Set(centerCourses.map((c) => c.centerId).filter(Boolean) as string[])];
  const eligibilityMap = await batchCenterEligibility(uniqueCenterIds);
  const publicCourseIds = centerCourses
    .filter((course) => course.published && !course.archived && course.centerId && eligibilityMap.get(course.centerId) === true)
    .map((course) => course.id);
  const directMedia = await db.select().from(educationMediaTable).where(and(
    eq(educationMediaTable.centerId, centerId),
    isNull(educationMediaTable.courseId),
  ));
  const courseMedia = publicCourseIds.length
    ? await db.select().from(educationMediaTable).where(inArray(educationMediaTable.courseId, publicCourseIds))
    : [];
  return [...directMedia, ...courseMedia]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime())
    .map((item) => ({
      id: item.id,
      url: publicEducationMediaUrl(item),
      altText: item.altText,
      sortOrder: item.sortOrder,
    }));
}

async function courseReviewViews(courseId: string) {
  const reviews = await db.select().from(courseReviewsTable)
    .where(and(eq(courseReviewsTable.courseId, courseId), eq(courseReviewsTable.status, "published")))
    .orderBy(desc(courseReviewsTable.createdAt))
    .limit(12);
  return reviews.map((review) => ({
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt.toISOString(),
  }));
}

async function centerPublicView(
  center: typeof educationCentersTable.$inferSelect,
  courses: Array<Record<string, unknown>> = [],
) {
  const centerCourses = await db.select({ id: coursesTable.id }).from(coursesTable)
    .where(eq(coursesTable.centerId, center.id));
  const courseIds = centerCourses.map((course) => course.id);
  const publishedReviews = courseIds.length
    ? await db.select().from(courseReviewsTable)
      .where(and(inArray(courseReviewsTable.courseId, courseIds), eq(courseReviewsTable.status, "published")))
    : [];
  const rating = publishedReviews.length
    ? Math.round((publishedReviews.reduce((sum, review) => sum + review.rating, 0) / publishedReviews.length) * 10) / 10
    : 0;
  return {
    id: center.id,
    name: center.name,
    city: center.city,
    description: center.description,
    imageUrl: center.imageUrl,
    websiteUrl: center.websiteUrl,
    instagramUrl: center.instagramUrl,
    verified: center.verificationStatus === "verified",
    rating,
    reviewCount: publishedReviews.length,
    courseCount: centerCourses.length,
    gallery: await centerEducationMediaViews(center.id),
    courses,
  };
}

async function educationCourseView(
  course: typeof coursesTable.$inferSelect,
  access?: EducationAccess,
  completedLessonIds = new Set<string>(),
  includeLessonContent = false,
) {
  const owned = Boolean(access && isCourseOwner(access, course));
  const enrollment = access
    ? (await db.select().from(courseEnrollmentsTable).where(and(eq(courseEnrollmentsTable.courseId, course.id), eq(courseEnrollmentsTable.purchaserId, access.user.id))).limit(1))[0]
    : undefined;
  const mayReadLessonContent = includeLessonContent || Boolean(access && (access.admin || owned));
  const mayReadLogistics = Boolean(access && (access.admin || owned || enrollment?.paymentStatus === "paid"));
  const [center, salon, sessions, modules, dayProgram, gallery, reviews] = await Promise.all([
    course.centerId ? db.select().from(educationCentersTable).where(eq(educationCentersTable.id, course.centerId)).limit(1) : Promise.resolve([]),
    course.salonId ? db.select().from(salonsTable).where(eq(salonsTable.id, course.salonId)).limit(1) : Promise.resolve([]),
    sessionsForCourse(course.id, mayReadLogistics),
    modulesForCourse(course.id, completedLessonIds, mayReadLessonContent),
    courseDayProgram(course.id),
    educationMediaViews({ courseId: course.id }),
    courseReviewViews(course.id),
  ]);
  const publisher = salon[0] ?? center[0];
  // Resolve instructor display name from the linked instructor profile in this center.
  // Prefer the direct profile link (works even when the profile has no user account);
  // fall back to the legacy user-based link for courses linked before profile IDs existed.
  let instructorName = "Stručni tim";
  let instructorProfileId: string | null = null;
  if (course.centerId) {
    let instructorProfile: typeof educationInstructorsTable.$inferSelect | undefined;
    if (course.instructorProfileId) {
      [instructorProfile] = await db.select().from(educationInstructorsTable)
        .where(and(eq(educationInstructorsTable.id, course.instructorProfileId), eq(educationInstructorsTable.centerId, course.centerId)))
        .limit(1);
    } else if (course.instructorId) {
      [instructorProfile] = await db.select().from(educationInstructorsTable)
        .where(and(eq(educationInstructorsTable.centerId, course.centerId), eq(educationInstructorsTable.userId, course.instructorId)))
        .limit(1);
    }
    if (instructorProfile) {
      instructorName = instructorProfile.fullName;
      instructorProfileId = instructorProfile.id;
    }
  }
  return {
    id: course.id,
    title: course.title,
    description: course.description,
    instructor: instructorName,
    instructorProfileId,
    publisher: publisher?.name ?? "LUMERA partner",
    publisherType: course.salonId ? "SALON" as const : "EDUCATION_CENTER" as const,
    publisherVerified: center[0]?.verificationStatus === "verified",
    category: course.category,
    format: course.format,
    city: course.city,
    price: course.price,
    duration: course.duration,
    level: course.level,
    learningOutcomes: course.learningOutcomes,
    includedItems: course.includedItems,
    requirements: course.requirements,
    rating: course.rating / 10,
    certification: course.certification,
    featured: await isPubliclyFeaturedEducationCourse(course),
    featuredUntil: course.featuredUntil?.toISOString() ?? null,
    refundPolicy: course.refundPolicy,
    groupDiscountMinimum: course.groupDiscountMinimum,
    groupDiscountPercent: course.groupDiscountPercent,
    centerId: course.centerId,
    imageUrl: course.imageUrl,
    startDate: course.startDate,
    published: course.published,
    archived: course.archived,
    availableSeats: sessions.length ? Math.max(...sessions.map((session) => session.availableSeats)) : null,
    enrollmentStatus: enrollment?.status ?? null,
    modules,
    sessions,
    dayProgram,
    gallery,
    center: center[0] ? await centerPublicView(center[0]) : null,
    reviews,
  };
}

async function educationEnrollmentView(enrollment: typeof courseEnrollmentsTable.$inferSelect) {
  const [course, employee, purchaser, modules, escrow, disputes] = await Promise.all([
    db.select().from(coursesTable).where(eq(coursesTable.id, enrollment.courseId)).limit(1),
    enrollment.employeeId ? db.select().from(employeesTable).where(eq(employeesTable.id, enrollment.employeeId)).limit(1) : Promise.resolve([]),
    db.select().from(usersTable).where(eq(usersTable.id, enrollment.purchaserId)).limit(1),
    modulesForCourse(enrollment.courseId),
    db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.enrollmentId, enrollment.id)).limit(1),
    db.select().from(educationDisputesTable)
      .where(and(eq(educationDisputesTable.enrollmentId, enrollment.id), inArray(educationDisputesTable.status, ["open", "under_review"])))
      .orderBy(desc(educationDisputesTable.createdAt)).limit(1),
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
    escrowStatus: escrow[0]?.status ?? null,
    escrowReleaseAt: escrow[0]?.releaseAt?.toISOString() ?? null,
    dispute: disputes[0] ? {
      id: disputes[0].id,
      reason: disputes[0].reason,
      details: disputes[0].details,
      status: disputes[0].status,
      createdAt: disputes[0].createdAt.toISOString(),
    } : null,
  };
}

/**
 * Batch assembler for a list of enrollments.
 * Replaces N×6 DB calls with 6 batch queries total, then assembles views in memory.
 * Drop-in replacement for `Promise.all(enrollments.map(educationEnrollmentView))`.
 */
async function batchEducationEnrollmentViews(enrollments: (typeof courseEnrollmentsTable.$inferSelect)[]) {
  _hookAssembler("batchEducationEnrollmentViews");
  if (!enrollments.length) return [];

  const courseIds = [...new Set(enrollments.map((e) => e.courseId))];
  const employeeIds = [...new Set(enrollments.flatMap((e) => (e.employeeId ? [e.employeeId] : [])))];
  const purchaserIds = [...new Set(enrollments.map((e) => e.purchaserId))];
  const enrollmentIds = enrollments.map((e) => e.id);

  const [courses, employees, purchasers, allModules, escrows, disputes] = await Promise.all([
    db.select().from(coursesTable).where(inArray(coursesTable.id, courseIds)),
    employeeIds.length ? db.select().from(employeesTable).where(inArray(employeesTable.id, employeeIds)) : Promise.resolve([] as (typeof employeesTable.$inferSelect)[]),
    db.select().from(usersTable).where(inArray(usersTable.id, purchaserIds)),
    db.select().from(courseModulesTable).where(inArray(courseModulesTable.courseId, courseIds)).orderBy(asc(courseModulesTable.sortOrder)),
    db.select().from(educationEscrowsTable).where(inArray(educationEscrowsTable.enrollmentId, enrollmentIds)),
    db.select().from(educationDisputesTable)
      .where(and(inArray(educationDisputesTable.enrollmentId, enrollmentIds), inArray(educationDisputesTable.status, ["open", "under_review"])))
      .orderBy(desc(educationDisputesTable.createdAt)),
  ]);

  // Batch-fetch all lessons for all course modules in one query.
  const allModuleIds = allModules.map((m) => m.id);
  const allLessons = allModuleIds.length
    ? await db.select().from(courseLessonsTable).where(inArray(courseLessonsTable.moduleId, allModuleIds)).orderBy(asc(courseLessonsTable.sortOrder))
    : [];

  const courseById = new Map(courses.map((c) => [c.id, c]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const purchaserById = new Map(purchasers.map((u) => [u.id, u]));
  const modulesByCourseId = new Map<string, (typeof courseModulesTable.$inferSelect)[]>();
  for (const m of allModules) {
    const arr = modulesByCourseId.get(m.courseId) ?? [];
    arr.push(m);
    modulesByCourseId.set(m.courseId, arr);
  }
  const lessonsByModuleId = new Map<string, (typeof courseLessonsTable.$inferSelect)[]>();
  for (const l of allLessons) {
    const arr = lessonsByModuleId.get(l.moduleId) ?? [];
    arr.push(l);
    lessonsByModuleId.set(l.moduleId, arr);
  }
  const escrowByEnrollmentId = new Map(escrows.map((e) => [e.enrollmentId, e]));
  // Keep only the latest open/under_review dispute per enrollment (already desc-sorted).
  const disputeByEnrollmentId = new Map<string, typeof educationDisputesTable.$inferSelect>();
  for (const d of disputes) {
    if (!disputeByEnrollmentId.has(d.enrollmentId)) disputeByEnrollmentId.set(d.enrollmentId, d);
  }

  return enrollments.map((enrollment) => {
    const course = courseById.get(enrollment.courseId);
    const employee = enrollment.employeeId ? employeeById.get(enrollment.employeeId) : undefined;
    const purchaser = purchaserById.get(enrollment.purchaserId);
    const escrow = escrowByEnrollmentId.get(enrollment.id);
    const dispute = disputeByEnrollmentId.get(enrollment.id);

    // Reconstruct flat lesson list for this course from cached maps.
    const courseModules = modulesByCourseId.get(enrollment.courseId) ?? [];
    const flatLessons = courseModules.flatMap((m) => lessonsByModuleId.get(m.id) ?? []);

    // Normalize nextLesson: accept legacy title-based values, resolve to ID.
    const nextLesson = enrollment.nextLesson
      ? flatLessons.find((l) => l.id === enrollment.nextLesson || l.title === enrollment.nextLesson)?.id ?? null
      : null;

    return {
      id: enrollment.id,
      courseId: enrollment.courseId,
      courseTitle: course?.title ?? "Arhivirani kurs",
      learnerName: employee?.name ?? `${purchaser?.firstName ?? "Poslovni"} ${purchaser?.lastName ?? "korisnik"}`,
      employeeId: enrollment.employeeId,
      status: enrollment.status,
      paymentStatus: enrollment.paymentStatus,
      progress: enrollment.progress,
      nextLesson,
      purchasedAt: enrollment.purchasedAt.toISOString(),
      escrowStatus: escrow?.status ?? null,
      escrowReleaseAt: escrow?.releaseAt?.toISOString() ?? null,
      dispute: dispute ? {
        id: dispute.id,
        reason: dispute.reason,
        details: dispute.details,
        status: dispute.status,
        createdAt: dispute.createdAt.toISOString(),
      } : null,
    };
  });
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
  earliestSlot: string | null = null,
  lastBookedAtOverride?: Date | null,
) {
  const lastBookedAt = lastBookedAtOverride ?? null;
  return {
    id: salon.id,
    slug: salon.slug,
    name: salon.name,
    city: salon.city,
    municipality: salon.municipality,
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

const SALON_CARD_LOOK_BACK_DAYS = 90;

async function salonCards(
  salons: (typeof salonsTable.$inferSelect)[],
  earliestSlotBySalon: ReadonlyMap<string, string | null> = new Map(),
) {
  if (!salons.length) return [];
  const ids = salons.map((salon) => salon.id);
  const lastBookedSince = new Date(Date.now() - SALON_CARD_LOOK_BACK_DAYS * 24 * 60 * 60 * 1000);
  const [allServices, allHours, lastBookedRows] = await Promise.all([
    db.select().from(servicesTable).where(and(inArray(servicesTable.salonId, ids), eq(servicesTable.active, true))),
    db.select().from(salonHoursTable).where(inArray(salonHoursTable.salonId, ids)),
    db.select({ salonId: appointmentsTable.salonId, lastBookedAt: sql<Date | null>`max(${appointmentsTable.createdAt})` })
      .from(appointmentsTable)
      .where(and(inArray(appointmentsTable.salonId, ids), gte(appointmentsTable.createdAt, lastBookedSince)))
      .groupBy(appointmentsTable.salonId),
  ]);
  // Replace per-salon array filters with grouped maps so card assembly stays
  // O(n) instead of O(salons * appointments).
  const servicesBySalon = groupBySalon(allServices);
  const hoursBySalon = groupBySalon(allHours);
  const lastBookedBySalon = new Map<string, Date | null>();
  for (const row of lastBookedRows) lastBookedBySalon.set(row.salonId, row.lastBookedAt ? new Date(row.lastBookedAt) : null);
  return salons.map((salon) => card(
    salon,
    servicesBySalon.get(salon.id) ?? [],
    hoursBySalon.get(salon.id) ?? [],
    earliestSlotBySalon.get(salon.id) ?? null,
    lastBookedBySalon.get(salon.id) ?? null,
  ));
}

function groupBySalon<T extends { salonId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = map.get(row.salonId);
    if (bucket) bucket.push(row); else map.set(row.salonId, [row]);
  }
  return map;
}

type MarketplaceHomeDiscoveryPayload = ReturnType<typeof GetMarketplaceHomeDiscoveryResponse.parse>;
const DEFAULT_CATEGORY_CARD_IMAGE = "/lumera-media/categories/kozmeticki-saloni.jpg";
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
const MAX_EDUCATION_GALLERY_IMAGE_BYTES = 8 * 1024 * 1024;

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
  allocatedResources: Array<{ resourceId: string; resourceName: string; quantity: number }> = [],
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
    allocatedResources,
  };
}

async function getAllocationsForAppointment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any,
  appointmentId: string,
): Promise<Array<{ resourceId: string; resourceName: string; quantity: number }>> {
  const rows = await store.select({
    resourceId: appointmentResourceAllocationsTable.resourceId,
    quantity: appointmentResourceAllocationsTable.quantity,
    resourceName: salonResourcesTable.name,
  }).from(appointmentResourceAllocationsTable)
    .innerJoin(salonResourcesTable, eq(appointmentResourceAllocationsTable.resourceId, salonResourcesTable.id))
    .where(eq(appointmentResourceAllocationsTable.appointmentId, appointmentId));
  return rows;
}

async function getAllocationsForAppointments(
  appointmentIds: string[],
): Promise<Map<string, Array<{ resourceId: string; resourceName: string; quantity: number }>>> {
  if (!appointmentIds.length) return new Map();
  const rows = await db.select({
    appointmentId: appointmentResourceAllocationsTable.appointmentId,
    resourceId: appointmentResourceAllocationsTable.resourceId,
    quantity: appointmentResourceAllocationsTable.quantity,
    resourceName: salonResourcesTable.name,
  }).from(appointmentResourceAllocationsTable)
    .innerJoin(salonResourcesTable, eq(appointmentResourceAllocationsTable.resourceId, salonResourcesTable.id))
    .where(inArray(appointmentResourceAllocationsTable.appointmentId, appointmentIds));
  const result = new Map<string, Array<{ resourceId: string; resourceName: string; quantity: number }>>();
  for (const row of rows) {
    const existing = result.get(row.appointmentId) ?? [];
    existing.push({ resourceId: row.resourceId, resourceName: row.resourceName, quantity: row.quantity });
    result.set(row.appointmentId, existing);
  }
  return result;
}

type AppointmentListPage = { limit: number; offset: number };
async function appointmentList(
  where?: ReturnType<typeof eq> | ReturnType<typeof and>,
  includeTreatmentAddress = false,
  page?: AppointmentListPage,
) {
  // The list query orders stably (date, startTime, id) so that any status/date/scope
  // predicate folded into `where` is applied in SQL BEFORE the optional LIMIT/OFFSET.
  // This keeps the per-request query count independent of the total appointment count.
  const baseQuery = db.select().from(appointmentsTable).where(where)
    .orderBy(asc(appointmentsTable.date), asc(appointmentsTable.startTime), asc(appointmentsTable.id));
  const appointments = page
    ? await baseQuery.limit(page.limit).offset(page.offset)
    : await baseQuery;
  if (!appointments.length) return [];
  const salonIds = [...new Set(appointments.map((item) => item.salonId))];
  const serviceIds = [...new Set(appointments.map((item) => item.serviceId))];
  const customerIds = [...new Set(appointments.flatMap((item) => item.customerId ? [item.customerId] : []))];
  const salonCustomerIds = [...new Set(appointments.flatMap((item) => item.salonCustomerId ? [item.salonCustomerId] : []))];
  const employeeIds = appointments.flatMap((item) => item.employeeId ? [item.employeeId] : []);
  const appointmentIds = appointments.map((item) => item.id);
  const [salons, services, customers, salonCustomers, employees, smsDeliveries, emailDeliveries, allocations] = await Promise.all([
    db.select().from(salonsTable).where(inArray(salonsTable.id, salonIds)),
    db.select().from(servicesTable).where(inArray(servicesTable.id, serviceIds)),
    db.select().from(usersTable).where(customerIds.length ? inArray(usersTable.id, customerIds) : sql`false`),
    db.select().from(salonCustomersTable).where(salonCustomerIds.length ? inArray(salonCustomersTable.id, salonCustomerIds) : sql`false`),
    db.select().from(employeesTable).where(employeeIds.length ? inArray(employeesTable.id, employeeIds) : sql`false`),
    db.select().from(smsDeliveriesTable).where(inArray(smsDeliveriesTable.appointmentId, appointmentIds)),
    db.select().from(emailDeliveriesTable).where(and(
      inArray(emailDeliveriesTable.appointmentId, appointmentIds),
      eq(emailDeliveriesTable.emailType, "appointment_rescheduled"),
    )),
    db.select({
      appointmentId: appointmentResourceAllocationsTable.appointmentId,
      resourceId: appointmentResourceAllocationsTable.resourceId,
      quantity: appointmentResourceAllocationsTable.quantity,
      resourceName: salonResourcesTable.name,
    }).from(appointmentResourceAllocationsTable)
      .innerJoin(salonResourcesTable, eq(appointmentResourceAllocationsTable.resourceId, salonResourcesTable.id))
      .where(inArray(appointmentResourceAllocationsTable.appointmentId, appointmentIds)),
  ]);
  const allocationsByAppointment = new Map<string, Array<{ resourceId: string; resourceName: string; quantity: number }>>();
  for (const alloc of allocations) {
    const existing = allocationsByAppointment.get(alloc.appointmentId) ?? [];
    existing.push({ resourceId: alloc.resourceId, resourceName: alloc.resourceName, quantity: alloc.quantity });
    allocationsByAppointment.set(alloc.appointmentId, existing);
  }
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
    allocationsByAppointment.get(item.id) ?? [],
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

// This separate endpoint intentionally shares validation with customer
// registration but never reads a role from the browser.
router.post("/auth/student-register", async (req, res): Promise<void> => {
  await ensureDemoData();
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const input = parsed.data;
  const email = input.email.toLowerCase();
  const phoneNormalized = normalizedPhone(input.phone ?? "");
  const code = typeof req.body?.phoneVerificationCode === "string" ? req.body.phoneVerificationCode : "";
  if (!phoneNormalized || !code) { res.status(400).json({ error: "Potvrdite broj telefona pre registracije." }); return; }
  const [existingEmail, existingPhone, verification] = await Promise.all([
    db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1),
    db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phoneNormalized, phoneNormalized)).limit(1),
    db.select().from(phoneVerificationCodesTable).where(eq(phoneVerificationCodesTable.phoneNormalized, phoneNormalized)).limit(1),
  ]);
  if (existingEmail[0] || existingPhone[0]) { res.status(409).json({ error: "E-mail ili broj su već povezani sa nalogom." }); return; }
  if (!verification[0] || verification[0].expiresAt < new Date() || verification[0].attempts >= 5 || verification[0].codeHash !== createHash("sha256").update(code).digest("hex")) {
    if (verification[0]) await db.update(phoneVerificationCodesTable).set({ attempts: verification[0].attempts + 1 }).where(eq(phoneVerificationCodesTable.id, verification[0].id));
    res.status(400).json({ error: "Kod za potvrdu broja nije ispravan ili je istekao." }); return;
  }
  const [student] = await db.insert(usersTable).values({
    firstName: input.firstName, lastName: input.lastName, email, phone: input.phone, phoneNormalized,
    passwordHash: await hashPassword(input.password), passwordSetAt: new Date(), role: "STUDENT",
  }).returning();
  await db.delete(phoneVerificationCodesTable).where(eq(phoneVerificationCodesTable.id, verification[0].id));
  const token = await createSession(student!.id);
  res.cookie(sessionCookieName, token, cookieOptions());
  res.status(201).json(RegisterResponse.parse({ user: publicUser(student!), message: "STUDENT nalog je kreiran." }));
});

router.get("/auth/oauth/:provider/start", async (req, res): Promise<void> => {
  const provider = req.params.provider;
  if (provider !== "google" && provider !== "facebook") { res.status(404).json({ error: "Nepoznat OAuth provajder." }); return; }
  const requestedFlow = typeof req.query.flow === "string" ? req.query.flow : "";
  const flow = requestedFlow === "business" ? "business" : requestedFlow === "link" ? "link" : "customer";
  const linkingUser = flow === "link" ? await getCurrentUser(req) : null;
  if (flow === "link" && !linkingUser) {
    res.redirect(oauthFailurePath("link", "Prijavite se da biste dodali način prijave."));
    return;
  }
  const oauthConfig = await oauthProviderConfig(provider);
  if (!oauthConfig) { res.redirect(oauthFailurePath(flow, "OAuth prijava trenutno nije podešena.")); return; }
  const redirectUri = oauthRedirect(req, provider);
  if (!redirectUri) { res.redirect(oauthFailurePath(flow, "OAuth prijava zahteva bezbedan APP_BASE_URL u produkciji.")); return; }
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = provider === "google" ? randomBytes(48).toString("base64url") : null;
  await db.insert(oauthLoginStatesTable).values({
    state,
    provider,
    flow,
    userId: linkingUser?.id ?? null,
    codeVerifier,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
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

    if (loginState.flow === "link") {
      const currentUser = await getCurrentUser(req);
      if (!currentUser || !loginState.userId || currentUser.id !== loginState.userId) {
        res.redirect(oauthFailurePath("link", "Sesija naloga je promenjena. Pokušajte ponovo."));
        return;
      }
      const linkingUserId = loginState.userId;

      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`select id from ${usersTable} where ${usersTable.id} = ${linkingUserId} for update`);
          const [lockedUser] = await tx.select({ id: usersTable.id }).from(usersTable)
            .where(and(eq(usersTable.id, linkingUserId), eq(usersTable.active, true)))
            .limit(1);
          if (!lockedUser) throw new Error("oauth_link_account_unavailable");

          const [existingIdentity] = await tx.select().from(oauthIdentitiesTable).where(and(
            eq(oauthIdentitiesTable.provider, provider),
            eq(oauthIdentitiesTable.providerAccountId, profile.id),
          )).limit(1);
          if (existingIdentity) {
            if (existingIdentity.userId === linkingUserId) return;
            throw new Error("oauth_link_identity_conflict");
          }

          const [existingProvider] = await tx.select({ id: oauthIdentitiesTable.id }).from(oauthIdentitiesTable)
            .where(and(
              eq(oauthIdentitiesTable.userId, linkingUserId),
              eq(oauthIdentitiesTable.provider, provider),
            ))
            .limit(1);
          if (existingProvider) throw new Error("oauth_link_provider_exists");

          await tx.insert(oauthIdentitiesTable).values({
            userId: linkingUserId,
            provider,
            providerAccountId: profile.id,
            providerEmail: profile.email,
          });
        });
      } catch (error) {
        const errorCode = error instanceof Error ? error.message : "";
        const message = errorCode === "oauth_link_provider_exists"
          ? `LUMERA nalog već ima povezanu ${provider === "google" ? "Google" : "Facebook"} prijavu.`
          : errorCode === "oauth_link_account_unavailable"
            ? "LUMERA nalog više nije dostupan."
            : "Ovaj identitet je već povezan sa drugim LUMERA nalogom ili nije moguće povezivanje.";
        res.redirect(oauthFailurePath("link", message));
        return;
      }

      res.redirect(`/moj-nalog?tab=settings&oauth=linked&provider=${provider}`);
      return;
    }

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
  sms: { keys: ["apiKey", "senderName", "baseUrl", "webhookSecret"], required: ["apiKey", "senderName"] },
  brevo: { keys: ["apiKey", "senderEmail", "senderName", "webhookSecret"], required: ["apiKey", "senderEmail"] },
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
  const [entries, deliveryReportsByProvider] = await Promise.all([
    Promise.all(Object.entries(integrationDefinitions).map(async ([name, definition]) => [
      name,
      await integrationDisplay(name as IntegrationName, definition.keys, definition.required),
    ])),
    deliveryReportStatuses(),
  ]);
  const origin = requestOrigin(req);
  res.json({
    integrations: Object.fromEntries(entries),
    deliveryReports: {
      providers: deliveryReportsByProvider,
      windowHours: DELIVERY_REPORT_WINDOW_HOURS,
      graceMinutes: DELIVERY_REPORT_GRACE_MINUTES,
    },
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

/**
 * Admin webhook self-check ("Proveri webhook"): posts one synthetic delivery
 * event to the app's OWN provider webhook endpoint over the loopback
 * interface, using the currently saved webhook secret as the path token. This
 * exercises the full production path — routing, JSON body parsing, the
 * timing-safe token comparison, and event processing — end to end, without
 * weakening security (no token-check bypass) and without touching delivery
 * state (the synthetic reference can never match a persisted outbound send,
 * and verification-only batches never count as provider delivery reports).
 */
router.post("/admin/integrations/:integration/verify-webhook", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const integration = req.params.integration;
  if (integration !== "sms" && integration !== "brevo") {
    res.status(404).json({ error: "Provera webhook-a je dostupna samo za SMS i Brevo integracije." }); return;
  }
  const secret = await resolveWebhookSecret(integration);
  if (!secret) {
    res.status(400).json({ error: "Webhook tajna nije sačuvana. Unesite i sačuvajte webhook tajnu, pa pokušajte ponovo." }); return;
  }

  const webhookPath = integration === "sms" ? "infobip" : "brevo";
  // Unmatched by construction: no persisted outbound send ever carries this
  // reference, so the synthetic event cannot alter any delivery state.
  const reference = `${WEBHOOK_VERIFICATION_REFERENCE_PREFIX}${randomUUID()}`;
  const payload = integration === "sms"
    ? { results: [{ messageId: reference, status: { groupName: "DELIVERED", name: "DELIVERED_TO_HANDSET" }, doneAt: new Date().toISOString() }] }
    : [{ event: "delivered", "message-id": reference, ts_event: Math.floor(Date.now() / 1000) }];

  // Loopback to the same bound server this admin request arrived on — works
  // identically in development and in the production deployment.
  const localPort = req.socket.localPort;
  if (!localPort) { res.status(502).json({ error: "Provera nije moguća: port servera nije poznat. Pokušajte ponovo." }); return; }
  let response: globalThis.Response;
  try {
    response = await fetch(`http://127.0.0.1:${localPort}/api/webhooks/${webhookPath}/${encodeURIComponent(secret)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    res.status(502).json({ error: "Webhook endpoint nije odgovorio na probni događaj. Proverite da li aplikacija radi, pa pokušajte ponovo." }); return;
  }

  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (response.status === 401) {
    res.status(502).json({ error: "Webhook endpoint je odbio sačuvanu tajnu. Sačuvajte webhook tajnu ponovo, pa kod provajdera registrujte URL sa istom tajnom." }); return;
  }
  if (response.status === 503) {
    res.status(502).json({ error: "Webhook endpoint prijavljuje da tajna nije konfigurisana. Sačuvajte webhook tajnu, pa pokušajte ponovo." }); return;
  }
  if (!response.ok || !body || body["processed"] !== 1 || body["unmatched"] !== 1) {
    res.status(502).json({ error: `Webhook endpoint nije prihvatio probni događaj (status ${response.status}). Proverite podešavanja, pa pokušajte ponovo.` }); return;
  }
  res.json({
    message: integration === "sms"
      ? "Infobip webhook radi: sačuvana tajna se poklapa i endpoint prihvata izveštaje o isporuci. Probni događaj nije promenio nijednu isporuku."
      : "Brevo webhook radi: sačuvana tajna se poklapa i endpoint prihvata događaje. Probni događaj nije promenio nijednu isporuku.",
  });
});

/**
 * Admin copy helper: returns the COMPLETE provider webhook URL with the
 * currently saved secret substituted, so admins never assemble it by hand
 * (hand-assembly is the main source of URL/secret mismatches). The secret is
 * only returned on demand to an authenticated admin; the page fetches it on
 * click and copies it without persistently rendering it.
 */
router.get("/admin/integrations/:integration/webhook-url", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const integration = req.params.integration;
  if (integration !== "sms" && integration !== "brevo") {
    res.status(404).json({ error: "Webhook URL je dostupan samo za SMS i Brevo integracije." }); return;
  }
  const secret = await resolveWebhookSecret(integration);
  if (!secret) {
    res.status(400).json({ error: "Webhook tajna nije sačuvana. Unesite i sačuvajte webhook tajnu, pa pokušajte ponovo." }); return;
  }
  const webhookPath = integration === "sms" ? "infobip" : "brevo";
  res.json({ url: `${requestOrigin(req)}/api/webhooks/${webhookPath}/${encodeURIComponent(secret)}` });
});

/**
 * Admin webhook registration check ("Proveri registraciju na Brevo"): asks the
 * Brevo API (saved apiKey) which transactional webhooks are actually
 * registered at the provider and compares them SERVER-SIDE against this
 * deployment's public webhook URL and the currently saved secret. Complements
 * the loopback self-check above — that proves the app's own endpoint accepts
 * the saved secret, while this catches the failure modes the loopback cannot
 * see: webhook deleted at Brevo, registered for a stale domain, or still
 * carrying an old secret. The saved secret is never returned; tokens found at
 * Brevo are compared timing-safe and reported only with the token masked.
 */
router.post("/admin/integrations/brevo/verify-registration", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const secret = await resolveWebhookSecret("brevo");
  if (!secret) {
    res.status(400).json({ error: "Webhook tajna nije sačuvana. Unesite i sačuvajte webhook tajnu, pa pokušajte ponovo." }); return;
  }
  let registeredUrls: string[];
  try {
    registeredUrls = await listBrevoTransactionalWebhookUrls();
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 200) : "nepoznata greška";
    // Local configuration problems (e.g. integration disabled) carry their own
    // Serbian instruction — surface them directly instead of wrapping them in
    // a provider-error message.
    if (error instanceof BrevoConfigurationError) {
      res.status(400).json({ error: error.message }); return;
    }
    res.status(502).json({ error: `Spisak webhook-ova nije učitan sa Brevo API-ja (${detail}). Proverite Brevo API ključ, pa pokušajte ponovo.` }); return;
  }

  // Normalized public origin of THIS deployment, as seen by the admin request
  // (trust proxy is enabled, so this is the public domain in production).
  let origin: string;
  try { origin = new URL(requestOrigin(req)).origin; } catch { origin = requestOrigin(req); }
  const expectedUrlHint = `${origin}/api/webhooks/brevo/<tajna>`;

  // Keep only registrations that look like a LUMERA Brevo webhook URL and
  // classify each by origin + timing-safe secret comparison. The token itself
  // is never echoed back — masked URLs only.
  const candidates = registeredUrls.flatMap((rawUrl) => {
    let parsed: URL;
    try { parsed = new URL(rawUrl); } catch { return []; }
    const match = /^\/api\/webhooks\/brevo\/([^/]+)\/?$/.exec(parsed.pathname);
    if (!match) return [];
    let token = match[1]!;
    try { token = decodeURIComponent(token); } catch { /* compare raw token */ }
    return [{
      origin: parsed.origin,
      maskedUrl: `${parsed.origin}/api/webhooks/brevo/…`,
      secretMatches: webhookTokenMatches(secret, token),
    }];
  });

  if (candidates.some((candidate) => candidate.secretMatches && candidate.origin === origin)) {
    res.json({ message: "Webhook je registrovan na Brevo: URL pokazuje na ovu aplikaciju i nosi aktuelnu webhook tajnu." }); return;
  }
  const wrongOrigin = candidates.find((candidate) => candidate.secretMatches);
  if (wrongOrigin) {
    res.status(409).json({ error: `Webhook sa aktuelnom tajnom postoji na Brevo, ali je registrovan za drugi domen (${wrongOrigin.maskedUrl}). Na Brevo ponovo registrujte URL ${expectedUrlHint} i zamenite <tajna> sačuvanom webhook tajnom.` }); return;
  }
  if (candidates.some((candidate) => candidate.origin === origin)) {
    res.status(409).json({ error: `Na Brevo je registrovan webhook za ovaj domen, ali sa zastarelom tajnom — događaji će biti odbijani. Ažurirajte registraciju na Brevo tako da URL ${expectedUrlHint} nosi sačuvanu webhook tajnu.` }); return;
  }
  if (candidates.length) {
    res.status(409).json({ error: `Na Brevo postoji webhook u LUMERA formatu (${candidates[0]!.maskedUrl}), ali se ni domen ni tajna ne poklapaju sa ovom aplikacijom. Na Brevo registrujte URL ${expectedUrlHint} i zamenite <tajna> sačuvanom webhook tajnom.` }); return;
  }
  res.status(409).json({ error: `Webhook nije registrovan na Brevo. U Brevo podešavanjima (Transactional → Settings → Webhooks) registrujte URL ${expectedUrlHint} i zamenite <tajna> sačuvanom webhook tajnom.` });
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

router.post("/internal/jobs/education-gallery-cleanup", async (req, res): Promise<void> => {
  const expected = process.env["EDUCATION_GALLERY_CLEANUP_JOB_SECRET"];
  if (!expected || req.get("x-lumera-job-key") !== expected) { res.status(401).json({ error: "Neovlašćen posao." }); return; }
  try {
    res.json(await runEducationGalleryCleanup());
  } catch (error) {
    req.log.error({ err: error }, "Education gallery cleanup job failed");
    res.status(502).json({ error: "Čišćenje galerije nije uspelo. Pokušajte ponovo." });
  }
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
  const query = parsed.data;
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 24;
  const offset = (page - 1) * pageSize;

  // --- SQL-expressible predicates (applied BEFORE pagination) ---------------
  // Derived service booleans (home service, discount, treatment/category match,
  // price ceiling) and salon-hours booleans (open Sunday) are expressed as
  // correlated EXISTS / aggregate subqueries so filtering happens in PostgreSQL
  // over the whole directory, not in application memory over a full table scan.
  const activeService = sql`${servicesTable.salonId} = ${salonsTable.id} and ${servicesTable.active} = true`;
  const homeServiceExists = sql`exists (select 1 from ${servicesTable} where ${activeService} and ${servicesTable.homeServiceAvailable} = true)`;
  const discountExists = sql`exists (select 1 from ${servicesTable} where ${activeService} and ${servicesTable.promoPrice} is not null and ${servicesTable.promoPrice} < ${servicesTable.price})`;
  const openSundayExists = sql`exists (select 1 from ${salonHoursTable} where ${salonHoursTable.salonId} = ${salonsTable.id} and ${salonHoursTable.weekday} = 7 and ${salonHoursTable.closed} = false)`;
  // startingPrice mirrors the card: MIN(COALESCE(promo, price)) over active
  // services, defaulting to 0 when a salon has no active services.
  const startingPriceExpr = sql`coalesce((select min(coalesce(${servicesTable.promoPrice}, ${servicesTable.price})) from ${servicesTable} where ${activeService}), 0)`;
  const bestDiscountExpr = sql`coalesce((select max(${servicesTable.price} - ${servicesTable.promoPrice}) from ${servicesTable} where ${activeService} and ${servicesTable.promoPrice} is not null and ${servicesTable.promoPrice} < ${servicesTable.price}), 0)`;
  // Recent booking count for most-booked-recently: non-cancelled appointments in
  // the last 30 days that target an active service of the salon. Computed with a
  // SQL aggregate so no appointment rows are loaded into memory.
  const recentSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentBookingExpr = sql`coalesce((select count(*) from ${appointmentsTable}
    where ${appointmentsTable.salonId} = ${salonsTable.id}
      and ${appointmentsTable.status} <> 'cancelled'
      and ${appointmentsTable.createdAt} >= ${recentSince}
      and exists (select 1 from ${servicesTable} where ${activeService} and ${servicesTable.id} = ${appointmentsTable.serviceId})), 0)`;
  // Mirrors firstAvailableByService's 30-day, hourly-slot algorithm in SQL so
  // LIMIT/OFFSET are applied after the global earliest-slot ordering, not before
  // a page-local JavaScript sort. Employees with no weekday schedule are treated
  // as available, matching employeeWorksAt().
  const earliestAvailabilityExpr = sql`(
    select min(
      ((now() at time zone 'UTC')::date + day_offset::integer)::timestamp
        + make_interval(hours => slot_hour::integer)
    )
    from generate_series(0, 29) as day_offset
    cross join generate_series(9, 17) as slot_hour
    where (
      day_offset > 0
      or make_time(slot_hour::integer, 0, 0) > (now() at time zone 'UTC')::time
    )
    and exists (
      select 1
      from ${servicesTable}
      inner join ${employeeServicesTable}
        on ${employeeServicesTable.serviceId} = ${servicesTable.id}
      inner join ${employeesTable}
        on ${employeesTable.id} = ${employeeServicesTable.employeeId}
       and ${employeesTable.salonId} = ${salonsTable.id}
       and ${employeesTable.active} = true
      where ${servicesTable.salonId} = ${salonsTable.id}
        and ${servicesTable.active} = true
        and slot_hour::integer * 60 + ${servicesTable.durationMinutes} <= 1440
        and not exists (
          select 1
          from ${employeeTimeOffTable}
          where ${employeeTimeOffTable.employeeId} = ${employeesTable.id}
            and ${employeeTimeOffTable.startDate}
              <= (now() at time zone 'UTC')::date + day_offset::integer
            and ${employeeTimeOffTable.endDate}
              >= (now() at time zone 'UTC')::date + day_offset::integer
        )
        and (
          not exists (
            select 1
            from ${employeeSchedulesTable}
            where ${employeeSchedulesTable.employeeId} = ${employeesTable.id}
              and ${employeeSchedulesTable.weekday}
                = extract(isodow from ((now() at time zone 'UTC')::date + day_offset::integer))::integer
          )
          or exists (
            select 1
            from ${employeeSchedulesTable}
            where ${employeeSchedulesTable.employeeId} = ${employeesTable.id}
              and ${employeeSchedulesTable.weekday}
                = extract(isodow from ((now() at time zone 'UTC')::date + day_offset::integer))::integer
              and ${employeeSchedulesTable.startTime}
                <= to_char(make_time(slot_hour::integer, 0, 0), 'HH24:MI')
              and ${employeeSchedulesTable.endTime}
                >= to_char(
                  make_time(slot_hour::integer, 0, 0) + make_interval(mins => ${servicesTable.durationMinutes}),
                  'HH24:MI'
                )
              and not (
                ${employeeSchedulesTable.breakStart} is not null
                and ${employeeSchedulesTable.breakEnd} is not null
                and to_char(make_time(slot_hour::integer, 0, 0), 'HH24:MI') < ${employeeSchedulesTable.breakEnd}
                and to_char(
                  make_time(slot_hour::integer, 0, 0) + make_interval(mins => ${servicesTable.durationMinutes}),
                  'HH24:MI'
                ) > ${employeeSchedulesTable.breakStart}
              )
          )
        )
        and not exists (
          select 1
          from ${appointmentsTable}
          where ${appointmentsTable.employeeId} = ${employeesTable.id}
            and ${appointmentsTable.date}
              = (now() at time zone 'UTC')::date + day_offset::integer
            and ${appointmentsTable.status} <> 'cancelled'
            and ${appointmentsTable.startTime}
              < to_char(
                make_time(slot_hour::integer, 0, 0) + make_interval(mins => ${servicesTable.durationMinutes}),
                'HH24:MI'
              )
            and ${appointmentsTable.endTime}
              > to_char(make_time(slot_hour::integer, 0, 0), 'HH24:MI')
        )
    )
  )`;

  const treatment = (query.treatment ?? query.category ?? "").trim().toLowerCase();

  const predicates = [
    eq(salonsTable.active, true),
    query.city ? sql`lower(${salonsTable.city}) = ${query.city.toLowerCase()}` : undefined,
    query.municipality ? sql`lower(${salonsTable.municipality}) = ${query.municipality.toLowerCase()}` : undefined,
    treatment
      ? sql`exists (select 1 from ${servicesTable} where ${activeService} and position(${treatment} in lower(${servicesTable.categoryName} || ' ' || ${servicesTable.name} || ' ' || coalesce(array_to_string(${servicesTable.tags}, ' '), ''))) > 0)`
      : undefined,
    query.priceMax !== undefined ? sql`${startingPriceExpr} <= ${query.priceMax}` : undefined,
    query.minRating !== undefined ? sql`${salonsTable.rating} >= ${Math.round(query.minRating * 10)}` : undefined,
    query.minReviewCount !== undefined ? gte(salonsTable.reviewCount, query.minReviewCount) : undefined,
    query.gender === "men" ? eq(salonsTable.servesMen, true) : undefined,
    query.brand
      ? sql`exists (select 1 from ${salonBrandsTable} inner join ${productBrandsTable} on ${productBrandsTable.id} = ${salonBrandsTable.brandId} where ${salonBrandsTable.salonId} = ${salonsTable.id} and lower(${productBrandsTable.name}) = ${query.brand.toLowerCase()})`
      : undefined,
    query.discountsOnly !== undefined ? sql`${discountExists} = ${query.discountsOnly}` : undefined,
    query.openSunday !== undefined ? sql`${openSundayExists} = ${query.openSunday}` : undefined,
    query.homeService !== undefined ? sql`${homeServiceExists} = ${query.homeService}` : undefined,
    query.acceptsCards !== undefined ? eq(salonsTable.acceptsCards, query.acceptsCards) : undefined,
    query.instantBooking !== undefined ? eq(salonsTable.instantBooking, query.instantBooking) : undefined,
    query.topSalon !== undefined ? eq(salonsTable.topSalon, query.topSalon) : undefined,
    query.featured !== undefined ? eq(salonsTable.featured, query.featured) : undefined,
  ].filter((predicate): predicate is Exclude<typeof predicate, undefined> => predicate !== undefined);
  const where = and(...predicates);

  // --- Stable SQL ordering for all practical sort modes ---------------------
  // Every ordering ends with salons.id ASC so pagination is deterministic and
  // page boundaries never skip or duplicate a salon.
  const idTiebreak = asc(salonsTable.id);
  const orderByForSort = (): ReturnType<typeof sql>[] => {
    switch (query.sort) {
      case "top-rated":
        return [sql`${salonsTable.rating} desc`, sql`${salonsTable.reviewCount} desc`, sql`${salonsTable.id} asc`];
      case "cheapest":
        return [sql`${startingPriceExpr} asc`, sql`${salonsTable.rating} desc`, sql`${salonsTable.id} asc`];
      case "largest-discount":
        return [sql`${bestDiscountExpr} desc`, sql`${salonsTable.rating} desc`, sql`${salonsTable.reviewCount} desc`, sql`${salonsTable.id} asc`];
      case "most-popular":
        return [sql`${salonsTable.reviewCount} desc`, sql`${salonsTable.rating} desc`, sql`${salonsTable.id} asc`];
      case "most-booked-recently":
        return [sql`${recentBookingExpr} desc`, sql`${salonsTable.rating} desc`, sql`${salonsTable.reviewCount} desc`, sql`${salonsTable.id} asc`];
      case "newest":
        return [sql`${salonsTable.createdAt} desc`, sql`${salonsTable.id} asc`];
      case "nearest":
        if (query.latitude !== undefined && query.longitude !== undefined) {
          // Haversine distance in SQL; salons without coordinates sort last.
          const lat = query.latitude;
          const lng = query.longitude;
          const distanceExpr = sql`(case when ${salonsTable.latitude} is null or ${salonsTable.longitude} is null then null else
            6371 * 2 * asin(sqrt(
              power(sin(radians(${salonsTable.latitude} - ${lat}) / 2), 2)
              + cos(radians(${lat})) * cos(radians(${salonsTable.latitude})) * power(sin(radians(${salonsTable.longitude} - ${lng}) / 2), 2)
            )) end)`;
          return [sql`${distanceExpr} asc nulls last`, sql`${salonsTable.id} asc`];
        }
        return [sql`${salonsTable.topSalon} desc`, sql`${salonsTable.featured} desc`, sql`${salonsTable.rating} desc`, sql`${salonsTable.id} asc`];
      case "first-available":
        return [sql`${earliestAvailabilityExpr} asc nulls last`, sql`${salonsTable.id} asc`];
      default:
        // recommended
        return [sql`${salonsTable.topSalon} desc`, sql`${salonsTable.featured} desc`, sql`${salonsTable.rating} desc`, sql`${salonsTable.id} asc`];
    }
  };

  // Select ONE page with the canonical availability expression used both for
  // global ordering and for the card payload, so rank and advertised slot can
  // never diverge.
  const pageRows = await db.select({
    salon: salonsTable,
    earliestSlot: sql<string | null>`to_char(${earliestAvailabilityExpr}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  }).from(salonsTable)
    .where(where)
    .orderBy(...orderByForSort())
    .limit(pageSize)
    .offset(offset);
  const pageSalons = pageRows.map((row) => row.salon);
  const earliestSlotBySalon = new Map(pageRows.map((row) => [row.salon.id, row.earliestSlot]));

  // Assemble supporting card data only for the page that survived SQL filters.
  const cards = await salonCards(pageSalons, earliestSlotBySalon);
  const cardById = new Map(cards.map((item) => [item.id, item]));
  const ordered = pageSalons.map((salon) => cardById.get(salon.id)).filter((item): item is NonNullable<typeof item> => Boolean(item));

  res.json(ListSalonsResponse.parse(ordered));
});

router.get("/cities", async (_req, res): Promise<void> => {
  await ensureDemoData();
  // Cache the city catalog under the shared "salons" tag so any salon
  // active/city mutation that broadcasts "salons" also drops this entry.
  const cities = await catalogCache.getOrLoad(
    "cities:catalog",
    ["cities", "salons"],
    async () => {
      // Derive stable city summaries in PostgreSQL from active salons.
      // Deterministic ordering: highest salon count first, then name (sr collation).
      const rows = await db
        .select({ name: salonsTable.city, salonCount: count() })
        .from(salonsTable)
        .where(eq(salonsTable.active, true))
        .groupBy(salonsTable.city)
        .orderBy(desc(count()), asc(salonsTable.city));
      return rows
        .filter((row) => typeof row.name === "string" && row.name.trim().length > 0)
        .map((row) => ({ name: row.name, salonCount: Number(row.salonCount) }));
    },
  );
  res.set("Cache-Control", "public, max-age=60, s-maxage=60");
  res.json(ListCitiesResponse.parse(cities));
});

router.get("/discovery/home", async (req, res): Promise<void> => {
  await ensureDemoData();
  const parsed = GetMarketplaceHomeDiscoveryQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const city = parsed.data.city?.trim().toLowerCase();
  const cacheKey = `discovery:home:${city || "all"}`;

  const payload = await catalogCache.getOrLoad<MarketplaceHomeDiscoveryPayload>(
    cacheKey,
    ["salons", "services", "service-categories"],
    async () => {
      const shelfLimit = 12;
      const recentSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const basePredicate = and(
        eq(salonsTable.active, true),
        city ? sql`lower(${salonsTable.city}) = ${city}` : undefined,
      );
      const bestDiscountExpr = sql`coalesce((
        select max(${servicesTable.price} - ${servicesTable.promoPrice})
        from ${servicesTable}
        where ${servicesTable.salonId} = ${salonsTable.id}
          and ${servicesTable.active} = true
          and ${servicesTable.promoPrice} is not null
          and ${servicesTable.promoPrice} < ${servicesTable.price}
      ), 0)`;
      const recentBookingExpr = sql`coalesce((
        select count(*)
        from ${appointmentsTable}
        inner join ${servicesTable}
          on ${servicesTable.id} = ${appointmentsTable.serviceId}
         and ${servicesTable.salonId} = ${salonsTable.id}
         and ${servicesTable.active} = true
        where ${appointmentsTable.salonId} = ${salonsTable.id}
          and ${appointmentsTable.createdAt} >= ${recentSince}
          and ${appointmentsTable.status} <> 'cancelled'
      ), 0)`;

      // Each shelf is ranked and bounded in PostgreSQL. A cold cache miss
      // therefore touches at most the union of five 12-salon candidate sets.
      const [
        serviceCategories,
        featuredRows,
        newRows,
        discountedRows,
        popularRows,
        topRatedRows,
      ] = await Promise.all([
        db.select().from(serviceCategoriesTable)
          .where(and(
            eq(serviceCategoriesTable.active, true),
            inArray(serviceCategoriesTable.name, DEFAULT_POPULAR_CATEGORY_ORDER),
          ))
          .orderBy(asc(serviceCategoriesTable.name))
          .limit(DEFAULT_POPULAR_CATEGORY_ORDER.length),
        db.select().from(salonsTable)
          .where(and(basePredicate, eq(salonsTable.featured, true)))
          .orderBy(desc(salonsTable.topSalon), desc(salonsTable.rating), desc(salonsTable.reviewCount), asc(salonsTable.id))
          .limit(shelfLimit),
        db.select().from(salonsTable)
          .where(basePredicate)
          .orderBy(desc(salonsTable.createdAt), asc(salonsTable.id))
          .limit(shelfLimit),
        db.select().from(salonsTable)
          .where(and(basePredicate, sql`${bestDiscountExpr} > 0`))
          .orderBy(sql`${bestDiscountExpr} desc`, desc(salonsTable.rating), asc(salonsTable.id))
          .limit(shelfLimit),
        db.select().from(salonsTable)
          .where(and(basePredicate, sql`${recentBookingExpr} > 0`))
          .orderBy(sql`${recentBookingExpr} desc`, desc(salonsTable.rating), asc(salonsTable.id))
          .limit(shelfLimit),
        db.select().from(salonsTable)
          .where(and(basePredicate, gte(salonsTable.reviewCount, 5)))
          .orderBy(desc(salonsTable.rating), desc(salonsTable.reviewCount), asc(salonsTable.id))
          .limit(shelfLimit),
      ]);

      const mainServiceCategories = [...serviceCategories].sort((a, b) => {
        const aIndex = DEFAULT_POPULAR_CATEGORY_ORDER.indexOf(a.name);
        const bIndex = DEFAULT_POPULAR_CATEGORY_ORDER.indexOf(b.name);
        return aIndex - bIndex || a.name.localeCompare(b.name, "sr");
      });
      const fallbackCategoryCards = mainServiceCategories.slice(0, 8).map((category) => ({
        name: category.name,
        categoryName: category.name,
        bookingCount: 0,
        imageUrl: category.fallbackImageUrl ?? DEFAULT_CATEGORY_CARD_IMAGE,
      }));

      const candidateById = new Map<string, typeof salonsTable.$inferSelect>();
      for (const salon of [...featuredRows, ...newRows, ...discountedRows, ...popularRows, ...topRatedRows]) {
        candidateById.set(salon.id, salon);
      }
      const candidates = [...candidateById.values()];
      if (candidates.length === 0) {
        return GetMarketplaceHomeDiscoveryResponse.parse({
          popularServices: fallbackCategoryCards,
          featuredSalons: [],
          newSalons: [],
          discountedSalons: [],
          popularSalons: [],
          topRatedSalons: [],
        });
      }

      const candidateIds = candidates.map((salon) => salon.id);
      const categoryNames = mainServiceCategories.map((category) => category.name);
      const [services, hours, discountServices, categoryBookings] = await Promise.all([
        db.select().from(servicesTable)
          .where(and(inArray(servicesTable.salonId, candidateIds), eq(servicesTable.active, true))),
        db.select().from(salonHoursTable).where(inArray(salonHoursTable.salonId, candidateIds)),
        discountedRows.length
          ? db.select().from(servicesTable)
              .where(and(
                inArray(servicesTable.salonId, discountedRows.map((salon) => salon.id)),
                eq(servicesTable.active, true),
                isNotNull(servicesTable.promoPrice),
                sql`${servicesTable.promoPrice} < ${servicesTable.price}`,
              ))
              .orderBy(asc(servicesTable.salonId), sql`${servicesTable.price} - ${servicesTable.promoPrice} desc`, asc(servicesTable.id))
          : Promise.resolve([] as (typeof servicesTable.$inferSelect)[]),
        categoryNames.length
          ? db.select({
              categoryName: servicesTable.categoryName,
              bookingCount: count(),
            })
              .from(appointmentsTable)
              .innerJoin(servicesTable, and(
                eq(servicesTable.id, appointmentsTable.serviceId),
                eq(servicesTable.active, true),
              ))
              .innerJoin(salonsTable, and(
                eq(salonsTable.id, appointmentsTable.salonId),
                basePredicate,
              ))
              .where(and(
                inArray(servicesTable.categoryName, categoryNames),
                gte(appointmentsTable.createdAt, recentSince),
                ne(appointmentsTable.status, "cancelled"),
              ))
              .groupBy(servicesTable.categoryName)
              .orderBy(desc(count()), asc(servicesTable.categoryName))
              .limit(8)
          : Promise.resolve([] as { categoryName: string; bookingCount: number }[]),
      ]);

      const servicesBySalon = groupBySalon(services);
      const hoursBySalon = groupBySalon(hours);
      const cardById = new Map(candidates.map((salon) => [
        salon.id,
        card(salon, servicesBySalon.get(salon.id) ?? [], hoursBySalon.get(salon.id) ?? []),
      ]));
      const cardsFor = (rows: (typeof salonsTable.$inferSelect)[]) =>
        rows.flatMap((salon) => {
          const value = cardById.get(salon.id);
          return value ? [value] : [];
        });

      const discountsBySalon = new Map<string, typeof servicesTable.$inferSelect>();
      for (const service of discountServices) {
        if (!discountsBySalon.has(service.salonId)) discountsBySalon.set(service.salonId, service);
      }
      const discountedSalons = cardsFor(discountedRows).flatMap((item) => {
        const discount = discountsBySalon.get(item.id);
        return !discount || discount.promoPrice === null
          ? []
          : [{ ...item, discount: { serviceName: discount.name, price: discount.price, promoPrice: discount.promoPrice } }];
      });

      const categoriesByName = new Map(mainServiceCategories.map((category) => [category.name, category]));
      const categoryImageByName = new Map<string, string>();
      for (const salon of candidates) {
        const imageUrl = salon.gallery.find(isRealSalonGalleryImage);
        if (!imageUrl) continue;
        for (const service of servicesBySalon.get(salon.id) ?? []) {
          if (categoriesByName.has(service.categoryName) && !categoryImageByName.has(service.categoryName)) {
            categoryImageByName.set(service.categoryName, imageUrl);
          }
        }
      }
      const popularServices = categoryBookings.length
        ? categoryBookings.map((row) => ({
            name: row.categoryName,
            categoryName: row.categoryName,
            bookingCount: Number(row.bookingCount),
            imageUrl: categoryImageByName.get(row.categoryName)
              ?? categoriesByName.get(row.categoryName)?.fallbackImageUrl
              ?? DEFAULT_CATEGORY_CARD_IMAGE,
          }))
        : fallbackCategoryCards;

      return GetMarketplaceHomeDiscoveryResponse.parse({
        popularServices,
        featuredSalons: cardsFor(featuredRows),
        newSalons: cardsFor(newRows),
        discountedSalons,
        popularSalons: cardsFor(popularRows),
        topRatedSalons: cardsFor(topRatedRows),
      });
    },
  );

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
  const [services, staff, hours, reviews, firstAvailability] = await Promise.all([
    db.select().from(servicesTable).where(and(eq(servicesTable.salonId, salon.id), eq(servicesTable.active, true))),
    db.select().from(employeesTable).where(and(eq(employeesTable.salonId, salon.id), eq(employeesTable.active, true))),
    db.select().from(salonHoursTable).where(eq(salonHoursTable.salonId, salon.id)).orderBy(asc(salonHoursTable.weekday)),
    db.select().from(reviewsTable)
      .where(and(eq(reviewsTable.salonId, salon.id), eq(reviewsTable.visible, true)))
      .orderBy(desc(reviewsTable.createdAt), desc(reviewsTable.id))
      .limit(100),
    firstAvailableByService(salon.id),
  ]);
  const reviewCustomerIds = [...new Set(reviews.map((item) => item.customerId))];
  const serviceIds = services.map((service) => service.id);
  const [reviewUsers, employeeLinks, completedPairs, completedCustomerSummary, serviceBookingRows, lastBookedRows, resourceRequirements] = await Promise.all([
    reviewCustomerIds.length
      ? db.select().from(usersTable).where(inArray(usersTable.id, reviewCustomerIds))
      : Promise.resolve([] as (typeof usersTable.$inferSelect)[]),
    staff.length
      ? db.select().from(employeeServicesTable).where(inArray(employeeServicesTable.employeeId, staff.map((item) => item.id)))
      : Promise.resolve([] as (typeof employeeServicesTable.$inferSelect)[]),
    reviewCustomerIds.length && serviceIds.length
      ? db.selectDistinct({
          customerId: appointmentsTable.customerId,
          serviceId: appointmentsTable.serviceId,
        }).from(appointmentsTable).where(and(
          eq(appointmentsTable.salonId, salon.id),
          eq(appointmentsTable.status, "completed"),
          inArray(appointmentsTable.customerId, reviewCustomerIds),
          inArray(appointmentsTable.serviceId, serviceIds),
        ))
      : Promise.resolve([] as { customerId: string | null; serviceId: string }[]),
    db.execute<{ total_visits: string; customer_count: string; repeat_customer_count: string }>(sql`
      select
        coalesce(sum(visits), 0)::text as total_visits,
        count(*)::text as customer_count,
        count(*) filter (where visits > 1)::text as repeat_customer_count
      from (
        select ${appointmentsTable.customerId} as customer_id, count(*) as visits
        from ${appointmentsTable}
        where ${appointmentsTable.salonId} = ${salon.id}
          and ${appointmentsTable.status} = 'completed'
          and ${appointmentsTable.customerId} is not null
        group by ${appointmentsTable.customerId}
      ) completed_by_customer
    `),
    db.select({
      serviceId: appointmentsTable.serviceId,
      bookingCount: count(),
    }).from(appointmentsTable)
      .where(and(eq(appointmentsTable.salonId, salon.id), ne(appointmentsTable.status, "cancelled")))
      .groupBy(appointmentsTable.serviceId),
    db.select({ lastBookedAt: sql<Date | null>`max(${appointmentsTable.createdAt})` })
      .from(appointmentsTable)
      .where(and(eq(appointmentsTable.salonId, salon.id), ne(appointmentsTable.status, "cancelled"))),
    serviceIds.length
      ? db.select({
          serviceId: serviceResourceRequirementsTable.serviceId,
          resourceId: serviceResourceRequirementsTable.resourceId,
          quantity: serviceResourceRequirementsTable.quantity,
        }).from(serviceResourceRequirementsTable)
          .where(inArray(serviceResourceRequirementsTable.serviceId, serviceIds))
      : Promise.resolve([] as Array<{ serviceId: string; resourceId: string; quantity: number }>),
  ]);
  const reviewUsersById = new Map(reviewUsers.map((user) => [user.id, user]));
  const serviceByName = new Map(services.map((service) => [service.name, service]));
  const completedAppointmentKeys = new Set(
    completedPairs.flatMap((appointment) =>
      appointment.customerId ? [`${appointment.customerId}:${appointment.serviceId}`] : [],
    ),
  );
  const completedSummary = completedCustomerSummary.rows[0];
  const completedVisitCount = Number(completedSummary?.total_visits ?? 0);
  const completedCustomerCount = Number(completedSummary?.customer_count ?? 0);
  const repeatCustomerCount = Number(completedSummary?.repeat_customer_count ?? 0);
  const returnClientRate = completedVisitCount >= 5 && completedCustomerCount >= 3
    ? Math.round(repeatCustomerCount / completedCustomerCount * 100)
    : null;
  const bookingsByServiceId = new Map(serviceBookingRows.map((row) => [row.serviceId, Number(row.bookingCount)]));
  const resourceRequirementsByServiceId = new Map<string, Array<{ resourceId: string; quantity: number }>>();
  for (const requirement of resourceRequirements) {
    const current = resourceRequirementsByServiceId.get(requirement.serviceId) ?? [];
    current.push({ resourceId: requirement.resourceId, quantity: requirement.quantity });
    resourceRequirementsByServiceId.set(requirement.serviceId, current);
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
    ...card(
      salon,
      services,
      hours,
      earliestSlotFromResponse(firstAvailability),
      lastBookedRows[0]?.lastBookedAt ? new Date(lastBookedRows[0].lastBookedAt) : null,
    ),
    gallery: salon.gallery,
    videoUrl: salon.videoUrl,
    description: salon.description,
    homeServiceRadiusKm: salon.homeServiceRadiusKm,
    topServices,
    hours: hours.map((item) => ({ day: ["Ponedeljak", "Utorak", "Sreda", "Četvrtak", "Petak", "Subota", "Nedelja"][item.weekday - 1] ?? "Ponedeljak", open: item.openTime, close: item.closeTime, closed: item.closed })),
    staff: staff.map((item) => {
      const serviceIds = employeeLinks.filter((link) => link.employeeId === item.id).map((link) => link.serviceId);
      return { id: item.id, name: item.name, role: item.role, bio: item.bio, avatarUrl: item.avatarUrl, specialties: item.specialties, serviceIds, serviceNames: services.filter((service) => serviceIds.includes(service.id)).map((service) => service.name) };
    }),
    services: services.map((item) => ({
      id: item.id,
      category: item.categoryName,
      name: item.name,
      description: item.description,
      durationMinutes: item.durationMinutes,
      price: item.price,
      promoPrice: item.promoPrice,
      tags: item.tags,
      packageTreatments: item.packageTreatments,
      imageUrl: item.imageUrl,
      active: item.active,
      homeServiceAvailable: item.homeServiceAvailable,
      homeServiceFee: item.homeServiceFee,
      homeServiceMinimumOrder: item.homeServiceMinimumOrder,
      resourceRequirements: resourceRequirementsByServiceId.get(item.id) ?? [],
    })),
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
  // Build active salon set and per-brand count map to avoid O(n²) scans.
  const activeSalonIds = new Set(salons.filter((s) => s.active).map((s) => s.id));
  const activeSalonCountByBrandId = new Map<string, number>();
  for (const link of links) {
    if (activeSalonIds.has(link.salonId)) {
      activeSalonCountByBrandId.set(link.brandId, (activeSalonCountByBrandId.get(link.brandId) ?? 0) + 1);
    }
  }
  res.json(brands.map((brand) => ({
    id: brand.id, name: brand.name, slug: brand.slug, description: brand.description,
    salonCount: activeSalonCountByBrandId.get(brand.id) ?? 0,
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
  // Fold status/scope predicates into SQL so they filter before the stable page,
  // keeping the query count independent of page size and applied filters.
  const today = new Date().toISOString().slice(0, 10);
  const predicates = [eq(appointmentsTable.customerId, user.id)];
  if (parsed.data.status) predicates.push(eq(appointmentsTable.status, parsed.data.status));
  if (parsed.data.scope === "upcoming") predicates.push(gte(appointmentsTable.date, today));
  if (parsed.data.scope === "past") predicates.push(lt(appointmentsTable.date, today));
  const { limit, offset } = parsePagination(req.query, 50);
  const appointments = await appointmentList(and(...predicates), true, { limit, offset });
  ListMyAppointmentsResponse.parse(appointments);
  res.json(appointments);
});

const appointmentStatusesWithSalonContact = new Set(["pending", "confirmed", "completed"]);

router.get("/appointments/:appointmentId/salon-contact", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  const params = GetAppointmentSalonContactParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Termin nije ispravno izabran." }); return; }

  const [appointment] = await db.select().from(appointmentsTable).where(and(
    eq(appointmentsTable.id, params.data.appointmentId),
    eq(appointmentsTable.customerId, user.id),
  )).limit(1);
  if (!appointment) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  if (!appointmentStatusesWithSalonContact.has(appointment.status)) {
    res.status(403).json({ error: "Kontakt salona je dostupan samo uz aktivan ili završen termin." });
    return;
  }

  const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.id, appointment.salonId)).limit(1);
  if (!salon) { res.status(404).json({ error: "Salon nije pronađen." }); return; }
  res.json(GetAppointmentSalonContactResponse.parse({
    appointmentId: appointment.id,
    name: salon.name,
    phone: salon.phone,
    email: salon.email,
    address: salon.address,
    postalCode: salon.postalCode,
    city: salon.city,
    latitude: salon.latitude,
    longitude: salon.longitude,
  }));
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
  const packagePurchaseId = parsed.data.packagePurchaseId ?? null;
  if (packagePurchaseId && !crmContact?.id) {
    res.status(400).json({ error: "Ne možemo povezati paket bez korisničkog profila u salonu." });
    return;
  }
  let allocation: Awaited<ReturnType<typeof createAllocatedAppointment>>;
  try {
    allocation = await createAllocatedAppointment({
      salonId: salon.id, customerId: user.id, salonCustomerId: crmContact?.id ?? null, serviceId: service.id,
      date: appointmentDate, startTime: parsed.data.startTime, endTime, durationMinutes: service.durationMinutes,
      price: basePrice + (treatmentLocation === "home" ? service.homeServiceFee : 0),
      status: treatmentLocation === "home" ? "pending" : salon.instantBooking ? "confirmed" : "pending", notes: parsed.data.notes ?? null,
      preferredEmployeeId: parsed.data.employeeId,
      treatmentLocation, travelFee: treatmentLocation === "home" ? service.homeServiceFee : 0,
      treatmentAddress: treatmentLocation === "home" ? parsed.data.treatmentAddress : null,
      packagePurchaseId,
    });
  } catch (err: unknown) {
    if (err instanceof ResourceCapacityError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof PackageRedemptionError) {
      const messages: Record<string, string> = {
        not_found: "Izabrani paket nije pronađen.",
        wrong_salon: "Paket ne pripada ovom salonu.",
        wrong_customer: "Paket ne pripada vama.",
        already_redeemed: "Ovaj termin je već iskorišćen iz paketa.",
        no_sessions_left: "Paket nema više dostupnih tretmana.",
        expired: "Paket je istekao.",
        not_active: "Paket nije aktivan.",
        service_not_covered: "Izabrana usluga nije obuhvaćena ovim paketom.",
        appointment_not_eligible: "Termin nije prihvatljiv za iskorišćavanje paketa.",
      };
      // Stable discriminator: `code` is always PACKAGE_ERROR so clients can
      // distinguish package failures from plain availability 409s; `reason`
      // carries the specific RedeemResult reason for programmatic handling.
      res.status(409).json({
        code: "PACKAGE_ERROR",
        reason: err.reason,
        error: messages[err.reason] ?? "Iskorišćavanje paketa nije uspelo.",
      });
      return;
    }
    throw err;
  }
  if (!allocation.employee || !allocation.appointment) {
    res.status(409).json({ error: "Termin više nije slobodan. Osvežite dostupnost i izaberite drugi termin." });
    return;
  }
  const { employee, appointment } = allocation;
  await sendSms({
    eventKey: `appointment-created:${appointment.id}`, salonId: salon.id, appointmentId: appointment.id,
    type: "appointment_confirmation", phone: user.phone, smsOptOut: crmContact?.smsOptOut,
    text: appointment.status === "confirmed"
      ? `LUMERA: termin u salonu ${salon.name} je potvrđen za ${calendarDate(appointment.date)} u ${appointment.startTime}.`
      : `LUMERA: zahtev za ${appointment.treatmentLocation === "home" ? "dolazak na adresu" : "termin"} u salonu ${salon.name} je primljen za ${calendarDate(appointment.date)} u ${appointment.startTime}. Salon će ga potvrditi.`,
  });
  await sendAppointmentEmails({ event: "created", appointment, customer: user, salon, service });
  const allocatedResources = await getAllocationsForAppointment(db, appointment.id);
  const response = appointmentView(appointment, salon, service, user, employee, true, null, allocatedResources);
  CreateAppointmentResponse.parse(response);
  res.status(201).json(response);
});

router.patch("/appointments/:appointmentId", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  const [params, body] = [UpdateAppointmentParams.safeParse(req.params), UpdateAppointmentBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci za izmenu termina nisu ispravni." }); return; }
  let result: { appointment: typeof appointmentsTable.$inferSelect; service: typeof servicesTable.$inferSelect; employee: typeof employeesTable.$inferSelect } | { error: "not-found" | "changed" | "invalid-time" | "unavailable" };
  try {
    result = await db.transaction(async (tx) => {
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
      if (!updated) return { error: "changed" as const };
      const requirements = await fetchServiceResourceRequirements(tx, service.id);
      await tx.delete(appointmentResourceAllocationsTable)
        .where(eq(appointmentResourceAllocationsTable.appointmentId, updated.id));
      // Throws ResourceCapacityError → rolls back transaction.
      await allocateResourcesInTx(tx, appointment.salonId, requirements, updated.id, date, startTime, endTime);
      return { appointment: updated, service, employee };
    });
  } catch (err: unknown) {
    if (err instanceof ResourceCapacityError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
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
  const [salon, service, allocatedResources] = await Promise.all([
    db.select().from(salonsTable).where(eq(salonsTable.id, updated!.salonId)).limit(1),
    db.select().from(servicesTable).where(eq(servicesTable.id, updated!.serviceId)).limit(1),
    getAllocationsForAppointment(db, updated!.id),
  ]);
  await sendAppointmentEmails({ event: "updated", appointment: updated, customer: user, salon: salon[0]!, service: service[0]! });
  const response = appointmentView(updated, salon[0]!, service[0]!, user, employee, true, null, allocatedResources);
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
    if (!appointment) return { error: "changed" as const };
    // Reverse any active package redemptions atomically with the cancellation.
    await handleAppointmentCancellationReversalsInTx(tx, appointment.id, appointment.salonId);
    return { appointment };
  });
  if ("error" in result) {
    res.status(result.error === "not-found" ? 404 : 409).json({
      error: result.error === "not-found" ? "Termin nije pronađen." : "Termin je u međuvremenu promenjen ili otkazan.",
    });
    return;
  }
  const { appointment } = result;
  const [salon, service, employee, allocatedResources] = await Promise.all([
    db.select().from(salonsTable).where(eq(salonsTable.id, appointment.salonId)).limit(1),
    db.select().from(servicesTable).where(eq(servicesTable.id, appointment.serviceId)).limit(1),
    appointment.employeeId ? db.select().from(employeesTable).where(eq(employeesTable.id, appointment.employeeId)).limit(1) : Promise.resolve([]),
    getAllocationsForAppointment(db, appointment.id),
  ]);
  await sendAppointmentEmails({ event: "cancelled", appointment, customer: user, salon: salon[0]!, service: service[0]! });
  const response = appointmentView(appointment, salon[0]!, service[0]!, user, employee[0], true, null, allocatedResources);
  CancelAppointmentResponse.parse(response);
  res.json(response);
});

router.get("/customer/dashboard", async (req, res): Promise<void> => {
  const user = await requireCustomer(req, res); if (!user) return;
  // Bound every read to what the dashboard renders instead of loading the
  // customer's entire appointment history:
  //   - `upcoming` is the earliest 3 non-cancelled appointments (SQL order + limit).
  //   - visit/favorite counts and booked/preference sets are SQL aggregates.
  //   - recommendation candidates are ranked and limited in SQL before card assembly.
  const [upcoming, visitCountRows, favoriteCountRows, bookedSalonRows, preferredCategoryRows] = await Promise.all([
    appointmentList(
      and(eq(appointmentsTable.customerId, user.id), ne(appointmentsTable.status, "cancelled")),
      true,
      { limit: 3, offset: 0 },
    ),
    db.select({ value: count() }).from(appointmentsTable)
      .where(and(eq(appointmentsTable.customerId, user.id), eq(appointmentsTable.status, "completed"))),
    db.select({ value: count() }).from(favoritesTable).where(eq(favoritesTable.userId, user.id)),
    db.selectDistinct({ salonId: appointmentsTable.salonId }).from(appointmentsTable)
      .where(and(eq(appointmentsTable.customerId, user.id), ne(appointmentsTable.status, "cancelled"))),
    db.selectDistinct({ categoryName: servicesTable.categoryName })
      .from(appointmentsTable)
      .innerJoin(servicesTable, eq(servicesTable.id, appointmentsTable.serviceId))
      .where(and(eq(appointmentsTable.customerId, user.id), ne(appointmentsTable.status, "cancelled"))),
  ]);
  const bookedSalonIds = bookedSalonRows.map((row) => row.salonId);
  const preferredCategories = preferredCategoryRows.map((row) => row.categoryName);
  // Rank recommendation candidates in SQL (active salons with an active service
  // in a preferred category, excluding already-booked salons) and cap at 15 so
  // card assembly only ever sees a bounded set.
  const recommendedSalonIdRows = preferredCategories.length
    ? await db.selectDistinct({
        id: salonsTable.id,
        topSalon: salonsTable.topSalon,
        featured: salonsTable.featured,
        rating: salonsTable.rating,
      })
      .from(salonsTable)
      .innerJoin(servicesTable, eq(servicesTable.salonId, salonsTable.id))
      .where(and(
        eq(salonsTable.active, true),
        eq(servicesTable.active, true),
        inArray(servicesTable.categoryName, preferredCategories),
        ...(bookedSalonIds.length ? [notInArray(salonsTable.id, bookedSalonIds)] : []),
      ))
      .orderBy(desc(salonsTable.topSalon), desc(salonsTable.featured), desc(salonsTable.rating), asc(salonsTable.id))
      .limit(15)
    : [];
  const recommendedIds = recommendedSalonIdRows.map((row) => row.id);
  const [recommendedSalons, recentSalons] = await Promise.all([
    recommendedIds.length
      ? db.select().from(salonsTable).where(inArray(salonsTable.id, recommendedIds))
      : Promise.resolve([] as (typeof salonsTable.$inferSelect)[]),
    db.select().from(salonsTable).where(eq(salonsTable.active, true)).limit(3),
  ]);
  // Preserve the SQL ranking order when reloading full salon rows for cards.
  const recommendedRank = new Map(recommendedIds.map((id, index) => [id, index]));
  recommendedSalons.sort((left, right) => (recommendedRank.get(left.id) ?? 0) - (recommendedRank.get(right.id) ?? 0));
  res.json(GetCustomerDashboardResponse.parse({
    upcoming,
    recentSalons: await salonCards(recentSalons),
    recommendations: await salonCards(recommendedSalons),
    favoriteCount: favoriteCountRows[0]?.value ?? 0,
    visitCount: visitCountRows[0]?.value ?? 0,
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
  // Derive the employeeId from the customer's most recent completed appointment at this salon
  const [custRec] = await db
    .select({ id: salonCustomersTable.id })
    .from(salonCustomersTable)
    .where(and(eq(salonCustomersTable.userId, user.id), eq(salonCustomersTable.salonId, salon.id)))
    .limit(1);
  let latestEmployeeId: string | null = null;
  if (custRec) {
    const [latestAppt] = await db
      .select({ employeeId: appointmentsTable.employeeId })
      .from(appointmentsTable)
      .where(and(
        eq(appointmentsTable.salonId, salon.id),
        eq(appointmentsTable.salonCustomerId, custRec.id),
        eq(appointmentsTable.status, "completed"),
      ))
      .orderBy(desc(appointmentsTable.date))
      .limit(1);
    latestEmployeeId = latestAppt?.employeeId ?? null;
  }
  const reviewInput = {
    serviceName: body.data.serviceName,
    rating: body.data.rating,
    text: body.data.text.trim(),
    showProfilePhoto: body.data.showProfilePhoto,
    employeeId: latestEmployeeId,
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
  const { salon, user } = access;
  const scope = req.query.scope === "all" ? "all" : "location";
  const scopeSalons = scope === "all"
    ? await db.select().from(salonsTable).where(eq(salonsTable.ownerId, user.id)).orderBy(asc(salonsTable.name))
    : [salon];
  const scopeSalonIds = scopeSalons.map((item) => item.id);
  if (!scopeSalonIds.length) { res.status(404).json({ error: "Salon nije pronađen." }); return; }
  // Bound reads to what the dashboard renders instead of the salon's whole
  // history: today's list uses a SQL date predicate + order + limit, and the
  // month stats are SQL aggregates over the current calendar month.
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const nextMonthStart = (() => {
    const value = new Date(`${monthStart}T00:00:00.000Z`);
    value.setUTCMonth(value.getUTCMonth() + 1);
    return value.toISOString().slice(0, 10);
  })();
  const [services, todayAppointments, monthStatsRows, locationStatsRows, loyaltyData] = await Promise.all([
    db.select().from(servicesTable).where(eq(servicesTable.salonId, salon.id)),
    appointmentList(
      and(inArray(appointmentsTable.salonId, scopeSalonIds), eq(appointmentsTable.date, today)),
      true,
      { limit: 5, offset: 0 },
    ),
    db.select({
      revenueThisMonth: sql<number>`coalesce(sum(${appointmentsTable.price}) filter (where ${appointmentsTable.status} = 'completed'), 0)`,
      bookingsThisMonth: count(),
      newCustomers: sql<number>`count(distinct coalesce(${appointmentsTable.customerId}, ${appointmentsTable.salonCustomerId}))`,
    }).from(appointmentsTable).where(and(
      inArray(appointmentsTable.salonId, scopeSalonIds),
      gte(appointmentsTable.date, monthStart),
      lt(appointmentsTable.date, nextMonthStart),
    )),
    db.select({
      salonId: appointmentsTable.salonId,
      revenueThisMonth: sql<number>`coalesce(sum(${appointmentsTable.price}) filter (where ${appointmentsTable.status} = 'completed'), 0)`,
      bookingsThisMonth: count(),
      newCustomers: sql<number>`count(distinct coalesce(${appointmentsTable.customerId}, ${appointmentsTable.salonCustomerId}))`,
    }).from(appointmentsTable).where(and(
      inArray(appointmentsTable.salonId, scopeSalonIds),
      gte(appointmentsTable.date, monthStart),
      lt(appointmentsTable.date, nextMonthStart),
    )).groupBy(appointmentsTable.salonId),
    loyaltyStatusForOwner(user.id),
  ]);
  const monthStats = monthStatsRows[0];
  const statsBySalonId = new Map(locationStatsRows.map((item) => [item.salonId, item]));
  const locations = scopeSalons.map((item) => {
    const stats = statsBySalonId.get(item.id);
    return {
      id: item.id,
      name: item.name,
      revenueThisMonth: Number(stats?.revenueThisMonth ?? 0),
      bookingsThisMonth: Number(stats?.bookingsThisMonth ?? 0),
      newCustomers: Number(stats?.newCustomers ?? 0),
    };
  });
  const reviewCount = scopeSalons.reduce((total, item) => total + item.reviewCount, 0);
  const rating = scope === "all"
    ? (reviewCount > 0
      ? scopeSalons.reduce((total, item) => total + item.rating * item.reviewCount, 0) / reviewCount / 10
      : 0)
    : salon.rating / 10;
  res.json(GetSalonDashboardResponse.parse({
    scope,
    loyaltyScope: "owner",
    salon: card(salon, services),
    locations,
    todayAppointments,
    revenueThisMonth: Number(monthStats?.revenueThisMonth ?? 0),
    bookingsThisMonth: Number(monthStats?.bookingsThisMonth ?? 0),
    newCustomers: Number(monthStats?.newCustomers ?? 0),
    rating,
    revenueChange: 12,
    loyalty: loyaltyData,
  }));
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
    imageUrl: salon.imageUrl,
    gallery: salon.gallery,
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
  if (parsed.data.imageUrl !== undefined) {
    if (!await canClaimMediaReference({
      userId: access.user.id,
      url: parsed.data.imageUrl,
      scope: "salon-profile",
      resourceId: access.salon.id,
      existingUrls: [access.salon.imageUrl],
    })) {
      res.status(400).json({ error: "Naslovna fotografija nije otpremljena sa ovog naloga." }); return;
    }
    updates.imageUrl = parsed.data.imageUrl;
  }
  if (parsed.data.gallery !== undefined) {
    const ownership = await Promise.all(parsed.data.gallery.map((url) => canClaimMediaReference({
      userId: access.user.id,
      url,
      scope: "salon-gallery",
      resourceId: access.salon.id,
      existingUrls: access.salon.gallery,
    })));
    if (ownership.some((owned) => !owned)) {
      res.status(400).json({ error: "Galerija sadrži fotografiju koja nije otpremljena sa ovog naloga." }); return;
    }
    updates.gallery = parsed.data.gallery;
  }
  if (!Object.keys(updates).length) { res.status(400).json({ error: "Izaberite najmanje jedno podešavanje za izmenu." }); return; }
  const homeService = await salonHasActiveHomeService(access.salon.id);
  updates.homeService = homeService;
  let updated: typeof salonsTable.$inferSelect | undefined;
  try {
    [updated] = await db.transaction(async (tx) => {
      if (parsed.data.imageUrl !== undefined && mediaAssetIdFromUrl(parsed.data.imageUrl) && !await claimMediaReference({
        userId: access.user.id,
        url: parsed.data.imageUrl,
        scope: "salon-profile",
        resourceId: access.salon.id,
      }, tx)) {
        throw new MediaClaimConflictError();
      }
      if (parsed.data.gallery !== undefined) {
        for (const url of parsed.data.gallery) {
          if (mediaAssetIdFromUrl(url) && !await claimMediaReference({
            userId: access.user.id,
            url,
            scope: "salon-gallery",
            resourceId: access.salon.id,
          }, tx)) {
            throw new MediaClaimConflictError();
          }
        }
      }
      const rows = await tx.update(salonsTable)
        .set(updates)
        .where(eq(salonsTable.id, access.salon.id))
        .returning();
      const removedUrls = [
        ...(parsed.data.imageUrl !== undefined && parsed.data.imageUrl !== access.salon.imageUrl ? [access.salon.imageUrl] : []),
        ...(parsed.data.gallery !== undefined
          ? access.salon.gallery.filter((url) => !parsed.data.gallery!.includes(url))
          : []),
      ];
      await releaseMediaReferenceClaims({
        urls: removedUrls,
        resourceId: access.salon.id,
        visibility: "private",
      }, tx);
      return rows;
    });
  } catch (error) {
    if (!(error instanceof MediaClaimConflictError)) throw error;
    res.status(409).json({ error: "Jedna fotografija je u međuvremenu povezana sa drugim zapisom." });
    return;
  }
  void publishCatalogInvalidation(["salons"]);
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
    imageUrl: updated!.imageUrl,
    gallery: updated!.gallery,
  }));
});

router.get("/salon/managed-salons", async (req, res): Promise<void> => {
  const user = await current(req, res);
  if (!user) return;
  if (user.role !== "SALON_OWNER") { res.status(403).json({ error: "Ova funkcija je dostupna samo vlasnicima salona." }); return; }
  const salons = await db.select({ id: salonsTable.id, name: salonsTable.name, slug: salonsTable.slug }).from(salonsTable).where(eq(salonsTable.ownerId, user.id)).orderBy(asc(salonsTable.name));
  const activeSalon = await ownedSalon(user.id);
  res.json({ activeSalonId: activeSalon?.id ?? null, salons });
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
  // Push status/date-range predicates into SQL so they filter before the stable
  // page. Query count stays constant regardless of page size or applied filters.
  const predicates = [eq(appointmentsTable.salonId, salon.id)];
  if (parsed.data.status) predicates.push(sql`${appointmentsTable.status}::text = ${parsed.data.status}`);
  if (parsed.data.from) predicates.push(gte(appointmentsTable.date, calendarDate(parsed.data.from)));
  if (parsed.data.to) predicates.push(lte(appointmentsTable.date, calendarDate(parsed.data.to)));
  const { limit, offset } = parsePagination(req.query, 100);
  const items = await appointmentList(and(...predicates), true, { limit, offset });
  res.json(ListSalonAppointmentsResponse.parse(items));
});

router.get("/salon/customers", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const today = new Date().toISOString().slice(0, 10);
  // Page the CRM contacts first with a stable order (lastName, firstName, id) so
  // that every downstream read is scoped to the page's contact IDs instead of the
  // full salon appointment/series tables. Query count is constant per page.
  const { limit, offset } = parsePagination(req.query, 50);
  const contacts = await db.select().from(salonCustomersTable)
    .where(eq(salonCustomersTable.salonId, access.salon.id))
    .orderBy(asc(salonCustomersTable.lastName), asc(salonCustomersTable.firstName), asc(salonCustomersTable.id))
    .limit(limit).offset(offset);
  if (!contacts.length) { res.json(ListSalonCustomersResponse.parse([])); return; }
  const contactIds = contacts.map((contact) => contact.id);

  // Grouped aggregate counts restricted to the page contacts (no full table read).
  const [visitCounts, noShowCounts, series] = await Promise.all([
    db.select({ salonCustomerId: appointmentsTable.salonCustomerId, value: count() }).from(appointmentsTable)
      .where(and(
        eq(appointmentsTable.salonId, access.salon.id),
        inArray(appointmentsTable.salonCustomerId, contactIds),
      ))
      .groupBy(appointmentsTable.salonCustomerId),
    db.select({ salonCustomerId: appointmentsTable.salonCustomerId, value: count() }).from(appointmentsTable)
      .where(and(
        eq(appointmentsTable.salonId, access.salon.id),
        inArray(appointmentsTable.salonCustomerId, contactIds),
        eq(appointmentsTable.status, "no-show"),
      ))
      .groupBy(appointmentsTable.salonCustomerId),
    db.select().from(appointmentSeriesTable)
      .where(and(eq(appointmentSeriesTable.salonId, access.salon.id), inArray(appointmentSeriesTable.salonCustomerId, contactIds))),
  ]);
  const visitCountByContactId = new Map(visitCounts.flatMap((row) => row.salonCustomerId ? [[row.salonCustomerId, Number(row.value)] as const] : []));
  const noShowCountByContactId = new Map(noShowCounts.flatMap((row) => row.salonCustomerId ? [[row.salonCustomerId, Number(row.value)] as const] : []));

  // Batch reads for series membership + service names restricted to the page's
  // series/service IDs only.
  const seriesIds = [...new Set(series.map((item) => item.id))];
  const serviceIds = [...new Set(series.map((item) => item.serviceId))];
  const [seriesAppointments, services] = await Promise.all([
    seriesIds.length
      ? db.select({ seriesId: appointmentsTable.seriesId, status: appointmentsTable.status, date: appointmentsTable.date })
          .from(appointmentsTable).where(and(
            eq(appointmentsTable.salonId, access.salon.id),
            inArray(appointmentsTable.seriesId, seriesIds),
          ))
      : Promise.resolve([] as { seriesId: string | null; status: string; date: string }[]),
    serviceIds.length
      ? db.select({ id: servicesTable.id, name: servicesTable.name }).from(servicesTable).where(and(
          eq(servicesTable.salonId, access.salon.id),
          inArray(servicesTable.id, serviceIds),
        ))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const serviceNameById = new Map(services.map((s) => [s.id, s.name]));
  const appointmentsBySeriesId = new Map<string, { status: string; date: string }[]>();
  for (const appt of seriesAppointments) {
    if (!appt.seriesId) continue;
    const arr = appointmentsBySeriesId.get(appt.seriesId) ?? [];
    arr.push({ status: appt.status, date: appt.date });
    appointmentsBySeriesId.set(appt.seriesId, arr);
  }
  const seriesByContactId = new Map<string, (typeof appointmentSeriesTable.$inferSelect)[]>();
  for (const s of series) {
    if (!s.salonCustomerId) continue;
    const arr = seriesByContactId.get(s.salonCustomerId) ?? [];
    arr.push(s);
    seriesByContactId.set(s.salonCustomerId, arr);
  }
  res.json(ListSalonCustomersResponse.parse(contacts.map((contact) => ({
    id: contact.id, firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone,
    smsOptOut: contact.smsOptOut,
    visitCount: visitCountByContactId.get(contact.id) ?? 0,
    noShowCount: noShowCountByContactId.get(contact.id) ?? 0,
    isRegistered: Boolean(contact.userId),
    series: (seriesByContactId.get(contact.id) ?? []).map((item) => {
      const members = appointmentsBySeriesId.get(item.id) ?? [];
      return {
        id: item.id, serviceName: serviceNameById.get(item.serviceId) ?? "Usluga",
        totalAppointments: item.totalAppointments,
        completedAppointments: members.filter((a) => a.status === "completed").length,
        upcomingAppointments: members.filter((a) => a.date >= today && ["pending", "confirmed"].includes(a.status)).length,
      };
    }),
  }))));
});

router.patch("/salon/customers/:customerId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const [params, body] = [UpdateSalonCustomerParams.safeParse(req.params), UpdateSalonCustomerBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci za CRM klijenta nisu ispravni." }); return; }
  // Partial update: only touch columns the client explicitly sent.
  //  - smsOptOut omitted → preserve the stored value (never reset to false).
  //  - birthDate present → set YYYY-MM-DD (Date → date string); null clears it.
  const updateFields: Partial<typeof salonCustomersTable.$inferInsert> = { updatedAt: new Date() };
  if (body.data.smsOptOut !== undefined) updateFields.smsOptOut = body.data.smsOptOut;
  if ("birthDate" in body.data) {
    const bd = body.data.birthDate;
    updateFields.birthDate = bd instanceof Date ? bd.toISOString().slice(0, 10) : null;
  }
  const [contact] = await db.update(salonCustomersTable).set(updateFields)
    .where(and(eq(salonCustomersTable.id, params.data.customerId), eq(salonCustomersTable.salonId, access.salon.id))).returning();
  if (!contact) { res.status(404).json({ error: "CRM klijent nije pronađen." }); return; }
  const appointments = await db.select({ id: appointmentsTable.id }).from(appointmentsTable).where(and(
    eq(appointmentsTable.salonId, access.salon.id),
    eq(appointmentsTable.salonCustomerId, contact.id),
  ));
  const noShowCount = (await db.select({ id: appointmentsTable.id }).from(appointmentsTable).where(and(
    eq(appointmentsTable.salonId, access.salon.id),
    eq(appointmentsTable.salonCustomerId, contact.id),
    eq(appointmentsTable.status, "no-show"),
  ))).length;
  // birthDate is a `date` column (mode:"string") → already YYYY-MM-DD or null.
  const payload = {
    id: contact.id, firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone,
    smsOptOut: contact.smsOptOut, birthDate: contact.birthDate, visitCount: appointments.length,
    noShowCount, isRegistered: Boolean(contact.userId),
  };
  // Validate the shape, but respond with the raw YYYY-MM-DD string so the UI
  // rehydrates the date input (zod.coerce.date() would turn it into a full ISO
  // timestamp, which the date field cannot consume).
  UpdateSalonCustomerResponse.parse(payload);
  res.json(payload);
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
  let allocation: Awaited<ReturnType<typeof createAllocatedAppointment>>;
  try {
    allocation = await createAllocatedAppointment({
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
  } catch (err: unknown) {
    if (err instanceof ResourceCapacityError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
  if (!allocation.appointment || !allocation.employee) {
    res.status(409).json({ error: "Termin više nije slobodan. Osvežite dostupnost i izaberite drugi termin." });
    return;
  }
  const { appointment, employee } = allocation;
  await sendSms({
    eventKey: `appointment-confirmation:${appointment.id}`, salonId: salon.id, appointmentId: appointment.id,
    type: "appointment_confirmation", phone: contact!.phone, smsOptOut: contact!.smsOptOut,
    text: `LUMERA: termin u salonu ${salon.name} je zakazan za ${date} u ${appointment.startTime}.`,
  });
  const allocatedResources = await getAllocationsForAppointment(db, appointment.id);
  const response = appointmentView(appointment, salon, service, contact!, employee, true, null, allocatedResources);
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
    const [employees, allocsByAppt] = await Promise.all([
      employeeIds.length ? db.select().from(employeesTable).where(inArray(employeesTable.id, employeeIds)) : Promise.resolve([] as (typeof employeesTable.$inferSelect)[]),
      getAllocationsForAppointments(created.appointments.map((a) => a.id)),
    ]);
    const views = created.appointments.map((appointment) => appointmentView(appointment, access.salon, service, contact!, employees.find((employee) => employee.id === appointment.employeeId), true, null, allocsByAppt.get(appointment.id) ?? []));
    await sendSeriesConfirmations({ appointments: created.appointments, contact: contact!, salon: access.salon });
    const response = { id: created.series.id, totalAppointments: created.appointments.length, appointments: views };
    CreateSalonAppointmentSeriesResponse.parse(response);
    res.status(201).json(response);
  } catch (error) {
    const message = error instanceof ResourceCapacityError ? error.message
      : error instanceof AppointmentSeriesError ? error.message
        : "Serija termina nije sačuvana.";
    res.status(error instanceof ResourceCapacityError ? 409 : error instanceof AppointmentSeriesError ? error.status : 500).json({ error: message });
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
    // Reverse active package redemptions for every cancelled appointment, atomically.
    for (const appt of cancelled) {
      await handleAppointmentCancellationReversalsInTx(tx, appt.id, access.salon.id);
    }
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
    const message = error instanceof ResourceCapacityError ? error.message
      : error instanceof AppointmentSeriesError ? error.message
        : "Pomeranje serije nije uspelo.";
    res.status(error instanceof AppointmentSeriesError ? error.status : 409).json({ error: message });
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
    if (target.status === "cancelled" && status !== "cancelled") {
      const existingAllocations = await fetchAppointmentResourceRequirements(tx, target.id);
      const requirements = existingAllocations.length
        ? existingAllocations
        : await fetchServiceResourceRequirements(tx, target.serviceId);
      await allocateResourcesInTx(
        tx,
        salon.id,
        requirements,
        target.id,
        target.date,
        target.startTime,
        target.endTime,
        [target.id],
      );
    }
    const [updated] = await tx.update(appointmentsTable).set({
      status: body.data.status,
      employeeId: body.data.employeeId,
      notes: body.data.notes === "" ? null : body.data.notes,
    }).where(and(
      eq(appointmentsTable.id, target.id),
      eq(appointmentsTable.salonId, salon.id),
    )).returning();
    if (!updated) return { error: "changed" as const };
    // On transition INTO cancelled, reverse active package redemptions atomically.
    if (updated.status === "cancelled" && target.status !== "cancelled") {
      await handleAppointmentCancellationReversalsInTx(tx, updated.id, salon.id);
    }
    return { updated };
  }).catch((error: unknown) => {
    if (error instanceof ResourceCapacityError) return { error: "resource-unavailable" as const };
    throw error;
  });
  if ("error" in result) {
    res.status(result.error === "not-found" ? 404 : result.error === "foreign-employee" ? 403 : 409).json({
      error: result.error === "not-found" ? "Termin nije pronađen."
        : result.error === "foreign-employee" ? "Zaposleni pripada drugom salonu."
          : result.error === "unavailable" ? "Izabrani zaposleni nije slobodan za ovaj termin."
            : result.error === "resource-unavailable" ? "Potrebni resursi nisu slobodni za ovaj termin."
            : "Termin je u međuvremenu promenjen.",
    });
    return;
  }
  const { updated } = result;
  const view = (await appointmentList(and(eq(appointmentsTable.id, updated.id), eq(appointmentsTable.salonId, salon.id)), true))[0];
  UpdateSalonAppointmentResponse.parse(view);
  res.json(view);
});

// ---------------------------------------------------------------------------
// Salon resource CRUD routes
// ---------------------------------------------------------------------------

function salonResourceView(resource: typeof salonResourcesTable.$inferSelect) {
  return {
    id: resource.id,
    salonId: resource.salonId,
    name: resource.name,
    type: resource.type,
    capacity: resource.capacity,
    active: resource.active,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  };
}

function maximumConcurrentResourceQuantity(
  allocations: Array<{ date: string; startTime: string; endTime: string; quantity: number }>,
): number {
  const allocationsByDate = new Map<string, typeof allocations>();
  for (const allocation of allocations) {
    const current = allocationsByDate.get(allocation.date) ?? [];
    current.push(allocation);
    allocationsByDate.set(allocation.date, current);
  }
  let maximum = 0;
  for (const dayAllocations of allocationsByDate.values()) {
    const events = dayAllocations.flatMap((allocation) => [
      { time: allocation.startTime, quantity: allocation.quantity },
      { time: allocation.endTime, quantity: -allocation.quantity },
    ]).sort((a, b) => a.time.localeCompare(b.time) || a.quantity - b.quantity);
    let concurrent = 0;
    for (const event of events) {
      concurrent += event.quantity;
      maximum = Math.max(maximum, concurrent);
    }
  }
  return maximum;
}

router.get("/salon/resources", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const resources = await db.select().from(salonResourcesTable)
    .where(eq(salonResourcesTable.salonId, access.salon.id))
    .orderBy(asc(salonResourcesTable.name));
  res.json(ListSalonResourcesResponse.parse(resources.map(salonResourceView)));
});

router.post("/salon/resources", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const parsed = CreateSalonResourceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { name, type, capacity, active } = parsed.data;
  if (!name.trim()) { res.status(400).json({ error: "Naziv resursa je obavezan." }); return; }
  try {
    const [resource] = await db.insert(salonResourcesTable).values({
      salonId: access.salon.id,
      name: name.trim(),
      type,
      capacity,
      active: active ?? true,
    }).returning();
    res.status(201).json(CreateSalonResourceResponse.parse(salonResourceView(resource!)));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("salon_resources_salon_name_unique")) {
      res.status(409).json({ error: "Resurs sa ovim imenom već postoji u salonu." });
      return;
    }
    throw err;
  }
});

router.patch("/salon/resources/:resourceId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const params = UpdateSalonResourceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Resurs nije ispravno izabran." }); return; }
  const parsed = UpdateSalonResourceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { name, type, capacity, active } = parsed.data;
  if (name !== undefined && !name.trim()) { res.status(400).json({ error: "Naziv resursa je obavezan." }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      await lockAppointmentResources(tx, access.salon.id);
      const [current] = await tx.select().from(salonResourcesTable).where(and(
        eq(salonResourcesTable.id, params.data.resourceId),
        eq(salonResourcesTable.salonId, access.salon.id),
      )).for("update").limit(1);
      if (!current) return { error: "not-found" as const };

      const nextCapacity = capacity ?? current.capacity;
      if (nextCapacity < current.capacity) {
        const requirements = await tx.select({ quantity: serviceResourceRequirementsTable.quantity })
          .from(serviceResourceRequirementsTable)
          .innerJoin(servicesTable, eq(serviceResourceRequirementsTable.serviceId, servicesTable.id))
          .where(and(
            eq(serviceResourceRequirementsTable.resourceId, current.id),
            eq(servicesTable.salonId, access.salon.id),
          ));
        if (requirements.some((requirement) => requirement.quantity > nextCapacity)) {
          return { error: "below-requirements" as const };
        }

        const today = new Date().toISOString().slice(0, 10);
        const allocations = await tx.select({
          date: appointmentsTable.date,
          startTime: appointmentsTable.startTime,
          endTime: appointmentsTable.endTime,
          quantity: appointmentResourceAllocationsTable.quantity,
        }).from(appointmentResourceAllocationsTable)
          .innerJoin(appointmentsTable, eq(appointmentResourceAllocationsTable.appointmentId, appointmentsTable.id))
          .where(and(
            eq(appointmentResourceAllocationsTable.resourceId, current.id),
            eq(appointmentsTable.salonId, access.salon.id),
            gte(appointmentsTable.date, today),
            ne(appointmentsTable.status, "cancelled"),
          ));
        if (maximumConcurrentResourceQuantity(allocations) > nextCapacity) {
          return { error: "below-allocations" as const };
        }
      }

      const [resource] = await tx.update(salonResourcesTable).set({
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(capacity !== undefined ? { capacity } : {}),
        ...(active !== undefined ? { active } : {}),
        updatedAt: new Date(),
      }).where(and(
        eq(salonResourcesTable.id, current.id),
        eq(salonResourcesTable.salonId, access.salon.id),
      )).returning();
      return { resource: resource! };
    });
    if ("error" in result) {
      const message = result.error === "not-found"
        ? "Resurs nije pronađen."
        : result.error === "below-requirements"
          ? "Kapacitet ne može biti manji od količine koju zahteva postojeća usluga."
          : "Kapacitet ne može biti manji od već rezervisane količine u budućim terminima.";
      res.status(result.error === "not-found" ? 404 : 409).json({ error: message });
      return;
    }
    res.json(UpdateSalonResourceResponse.parse(salonResourceView(result.resource)));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("salon_resources_salon_name_unique")) {
      res.status(409).json({ error: "Resurs sa ovim imenom već postoji u salonu." });
      return;
    }
    throw err;
  }
});

router.delete("/salon/resources/:resourceId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const params = DeleteSalonResourceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Resurs nije ispravno izabran." }); return; }
  const result = await db.transaction(async (tx) => {
    const [resource] = await tx.select({ id: salonResourcesTable.id }).from(salonResourcesTable)
      .where(and(
        eq(salonResourcesTable.id, params.data.resourceId),
        eq(salonResourcesTable.salonId, access.salon.id),
      )).for("update").limit(1);
    if (!resource) return { error: "not-found" as const };
    // Preserve both configured requirements and historical appointment allocations.
    const [requirement] = await tx.select({ id: serviceResourceRequirementsTable.id })
      .from(serviceResourceRequirementsTable)
      .innerJoin(servicesTable, eq(serviceResourceRequirementsTable.serviceId, servicesTable.id))
      .where(and(
        eq(serviceResourceRequirementsTable.resourceId, resource.id),
        eq(servicesTable.salonId, access.salon.id),
      )).limit(1);
    if (requirement) return { error: "has-requirements" as const };
    const [allocation] = await tx.select({ id: appointmentResourceAllocationsTable.id })
      .from(appointmentResourceAllocationsTable)
      .where(eq(appointmentResourceAllocationsTable.resourceId, resource.id))
      .limit(1);
    if (allocation) return { error: "has-allocations" as const };
    await tx.delete(salonResourcesTable).where(and(
      eq(salonResourcesTable.id, resource.id),
      eq(salonResourcesTable.salonId, access.salon.id),
    ));
    return { deleted: true as const };
  });
  if ("error" in result) {
    res.status(result.error === "not-found" ? 404 : 409).json({
      error: result.error === "not-found"
        ? "Resurs nije pronađen."
        : result.error === "has-requirements"
          ? "Resurs ne može da se obriše jer je povezan sa zahtevima usluga."
          : "Resurs ne može da se obriše jer postoji u istoriji termina. Umesto toga ga označite kao neaktivan.",
    });
    return;
  }
  res.status(204).end();
});

router.get("/salon/services", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const [services, appointmentServices, appointmentSeriesServices] = await Promise.all([
    db.select().from(servicesTable).where(eq(servicesTable.salonId, salon.id)),
    db.select({ serviceId: appointmentsTable.serviceId }).from(appointmentsTable)
      .where(eq(appointmentsTable.salonId, salon.id)),
    db.select({ serviceId: appointmentSeriesTable.serviceId }).from(appointmentSeriesTable)
      .where(eq(appointmentSeriesTable.salonId, salon.id)),
  ]);
  const protectedServiceIds = new Set([
    ...appointmentServices.map((appointment) => appointment.serviceId),
    ...appointmentSeriesServices.map((series) => series.serviceId),
  ]);
  const serviceIds = services.map((s) => s.id);
  const requirements = serviceIds.length
    ? await db.select().from(serviceResourceRequirementsTable).where(inArray(serviceResourceRequirementsTable.serviceId, serviceIds))
    : [];
  const requirementsByServiceId = new Map<string, Array<{ resourceId: string; quantity: number }>>();
  for (const req of requirements) {
    const existing = requirementsByServiceId.get(req.serviceId) ?? [];
    existing.push({ resourceId: req.resourceId, quantity: req.quantity });
    requirementsByServiceId.set(req.serviceId, existing);
  }
  res.json(ListSalonServicesResponse.parse(services.map((item) => ({
    id: item.id, category: item.categoryName, name: item.name, description: item.description,
    durationMinutes: item.durationMinutes, price: item.price, promoPrice: item.promoPrice,
    imageUrl: item.imageUrl, active: item.active, homeServiceAvailable: item.homeServiceAvailable,
    homeServiceFee: item.homeServiceFee, homeServiceMinimumOrder: item.homeServiceMinimumOrder,
    canBePermanentlyDeleted: !protectedServiceIds.has(item.id),
    resourceRequirements: requirementsByServiceId.get(item.id) ?? [],
  }))));
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
  const allTemplates = await catalogCache.getOrLoad(
    "service-templates:all",
    ["service-templates"],
    () => db.select().from(serviceTemplatesTable)
      .where(eq(serviceTemplatesTable.active, true))
      .orderBy(asc(serviceTemplatesTable.mainCategory), asc(serviceTemplatesTable.subcategory), asc(serviceTemplatesTable.name)),
    600_000,
  );
  let templates = allTemplates;
  if (input.mainCategory) templates = templates.filter((t) => t.mainCategory === input.mainCategory);
  if (input.subcategory) templates = templates.filter((t) => t.subcategory === input.subcategory);
  if (input.search) {
    const term = input.search.toLowerCase();
    templates = templates.filter((t) => `${t.name} ${t.mainCategory} ${t.subcategory}`.toLowerCase().includes(term));
  }
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
  if (created.length) void publishCatalogInvalidation(["salons", "services"]);
  res.status(201).json(CreateSalonServicesBatchResponse.parse({
    created: created.map(salonServiceDto),
    skipped: parsed.data.items.filter((item) => {
      const template = byId.get(item.templateId)!;
      return existingKeys.has(`${template.mainCategory}:${template.name}`);
    }).map((item) => byId.get(item.templateId)!.name),
  }));
});

class ServiceRequirementValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceRequirementValidationError";
  }
}

/**
 * Validate and insert resource requirements for a service inside a transaction.
 * Throws ServiceRequirementValidationError (400) for client errors:
 *   - duplicate resourceId in the list
 *   - quantity exceeds that resource's capacity
 *   - resource does not belong to salonId
 */
async function upsertServiceResourceRequirements(
  tx: any,
  serviceId: string,
  salonId: string,
  reqData: Array<{ resourceId: string; quantity: number }>,
): Promise<void> {
  if (!reqData.length) return;
  const uniqueIds = new Set(reqData.map((r) => r.resourceId));
  if (uniqueIds.size !== reqData.length) {
    throw new ServiceRequirementValidationError("Svaki resurs može biti naveden samo jednom.");
  }
  const resourceIds = reqData.map((r) => r.resourceId);
  const ownedResources = await tx.select({
    id: salonResourcesTable.id,
    capacity: salonResourcesTable.capacity,
  }).from(salonResourcesTable)
    .where(and(inArray(salonResourcesTable.id, resourceIds), eq(salonResourcesTable.salonId, salonId))) as Array<{ id: string; capacity: number }>;
  if (ownedResources.length !== resourceIds.length) {
    throw new ServiceRequirementValidationError("Jedan ili više resursa ne pripada ovom salonu.");
  }
  const capacityById = new Map(ownedResources.map((r) => [r.id, r.capacity]));
  for (const req of reqData) {
    const cap = capacityById.get(req.resourceId)!;
    if (req.quantity < 1 || req.quantity > cap) {
      throw new ServiceRequirementValidationError(`Tražena količina resursa mora biti između 1 i ${cap} (kapacitet resursa).`);
    }
  }
  await tx.insert(serviceResourceRequirementsTable).values(reqData.map((r) => ({ serviceId, resourceId: r.resourceId, quantity: r.quantity })));
}

router.post("/salon/services", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  const parsed = CreateSalonServiceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [category] = await db.select().from(serviceCategoriesTable).where(eq(serviceCategoriesTable.name, parsed.data.category)).limit(1);
  let txResult: { service: typeof servicesTable.$inferSelect; resourceRequirements: Array<{ resourceId: string; quantity: number }> };
  try {
    txResult = await db.transaction(async (tx) => {
      await lockAppointmentResources(tx, salon.id);
      const [row] = await tx.insert(servicesTable).values({ ...parsed.data, salonId: salon.id, categoryId: category?.id ?? null, categoryName: parsed.data.category, promoPrice: parsed.data.promoPrice ?? null, homeServiceMinimumOrder: parsed.data.homeServiceMinimumOrder ?? null }).returning();
      await attachReadyImageAssets(tx, access.user.id, parsed.data.imageUrl);
      const reqData = parsed.data.resourceRequirements ?? [];
      await upsertServiceResourceRequirements(tx, row!.id, salon.id, reqData);
      const requirements = reqData.length
        ? await tx.select({ resourceId: serviceResourceRequirementsTable.resourceId, quantity: serviceResourceRequirementsTable.quantity })
          .from(serviceResourceRequirementsTable).where(eq(serviceResourceRequirementsTable.serviceId, row!.id))
        : [];
      return { service: row!, resourceRequirements: requirements };
    });
  } catch (err: unknown) {
    if (err instanceof ServiceRequirementValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
  const { service, resourceRequirements } = txResult;
  await db.update(salonsTable).set({ homeService: await salonHasActiveHomeService(salon.id) }).where(eq(salonsTable.id, salon.id));
  void publishCatalogInvalidation(["salons", "services"]);
  res.status(201).json(CreateSalonServiceResponse.parse({ id: service.id, category: service.categoryName, name: service.name, description: service.description, durationMinutes: service.durationMinutes, price: service.price, promoPrice: service.promoPrice, imageUrl: service.imageUrl, active: service.active, homeServiceAvailable: service.homeServiceAvailable, homeServiceFee: service.homeServiceFee, homeServiceMinimumOrder: service.homeServiceMinimumOrder, resourceRequirements }));
});

router.patch("/salon/services/:serviceId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const parsed = CreateSalonServiceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let txResult: { service: typeof servicesTable.$inferSelect; resourceRequirements: Array<{ resourceId: string; quantity: number }> } | null;
  try {
    txResult = await db.transaction(async (tx) => {
      await lockAppointmentResources(tx, access.salon.id);
      const [row] = await tx.update(servicesTable).set({
        categoryName: parsed.data.category, name: parsed.data.name, description: parsed.data.description,
        durationMinutes: parsed.data.durationMinutes, price: parsed.data.price, promoPrice: parsed.data.promoPrice ?? null,
        imageUrl: parsed.data.imageUrl, active: parsed.data.active,
        homeServiceAvailable: parsed.data.homeServiceAvailable, homeServiceFee: parsed.data.homeServiceFee, homeServiceMinimumOrder: parsed.data.homeServiceMinimumOrder ?? null,
      }).where(and(eq(servicesTable.id, req.params.serviceId), eq(servicesTable.salonId, access.salon.id))).returning();
      if (!row) return null;
      await attachReadyImageAssets(tx, access.user.id, parsed.data.imageUrl);
      // Replace resource requirements if provided.
      if (parsed.data.resourceRequirements !== undefined) {
        await tx.delete(serviceResourceRequirementsTable).where(eq(serviceResourceRequirementsTable.serviceId, row.id));
        await upsertServiceResourceRequirements(tx, row.id, access.salon.id, parsed.data.resourceRequirements);
      }
      const requirements = await tx.select({ resourceId: serviceResourceRequirementsTable.resourceId, quantity: serviceResourceRequirementsTable.quantity })
        .from(serviceResourceRequirementsTable).where(eq(serviceResourceRequirementsTable.serviceId, row.id));
      return { service: row, resourceRequirements: requirements };
    });
  } catch (err: unknown) {
    if (err instanceof ServiceRequirementValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
  if (!txResult) { res.status(404).json({ error: "Usluga nije pronađena." }); return; }
  const { service, resourceRequirements } = txResult;
  await db.update(salonsTable).set({ homeService: await salonHasActiveHomeService(access.salon.id) }).where(eq(salonsTable.id, access.salon.id));
  void publishCatalogInvalidation(["salons", "services"]);
  res.json(CreateSalonServiceResponse.parse({ id: service.id, category: service.categoryName, name: service.name, description: service.description, durationMinutes: service.durationMinutes, price: service.price, promoPrice: service.promoPrice, imageUrl: service.imageUrl, active: service.active, homeServiceAvailable: service.homeServiceAvailable, homeServiceFee: service.homeServiceFee, homeServiceMinimumOrder: service.homeServiceMinimumOrder, resourceRequirements }));
});

router.delete("/salon/services/:serviceId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const params = DeleteSalonServiceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Usluga nije ispravno izabrana." }); return; }

  const result = await db.transaction(async (tx) => {
    const [service] = await tx.select({ id: servicesTable.id }).from(servicesTable).where(and(
      eq(servicesTable.id, params.data.serviceId),
      eq(servicesTable.salonId, access.salon.id),
    )).for("update").limit(1);
    if (!service) return { error: "not-found" as const };

    const [appointment] = await tx.select({ id: appointmentsTable.id }).from(appointmentsTable)
      .where(and(eq(appointmentsTable.serviceId, service.id), eq(appointmentsTable.salonId, access.salon.id))).limit(1);
    const [appointmentSeries] = await tx.select({ id: appointmentSeriesTable.id }).from(appointmentSeriesTable)
      .where(and(eq(appointmentSeriesTable.serviceId, service.id), eq(appointmentSeriesTable.salonId, access.salon.id))).limit(1);
    if (appointment || appointmentSeries) return { error: "has-appointments" as const };

    await tx.delete(servicesTable).where(and(
      eq(servicesTable.id, service.id),
      eq(servicesTable.salonId, access.salon.id),
    ));
    return { deleted: true as const };
  });

  if ("error" in result) {
    res.status(result.error === "not-found" ? 404 : 409).json({
      error: result.error === "not-found"
        ? "Usluga nije pronađena."
        : "Usluga ne može da se obriše jer je povezana sa postojećim terminima.",
    });
    return;
  }

  await db.update(salonsTable).set({ homeService: await salonHasActiveHomeService(access.salon.id) })
    .where(eq(salonsTable.id, access.salon.id));
  void publishCatalogInvalidation(["salons", "services"]);
  res.status(204).end();
});

router.get("/salon/employees", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const { salon } = access;
  // Employee counts are plan-bounded, but all related reads must still be scoped:
  // links, service names, and user accounts are restricted with inArray to the
  // returned employee/service/user IDs instead of scanning full global tables.
  const [employeeRows, services] = await Promise.all([
    db.select({
      employee: employeesTable,
      account: {
        active: usersTable.active,
        email: usersTable.email,
        mustChangePassword: usersTable.mustChangePassword,
      },
    })
      .from(employeesTable)
      .leftJoin(usersTable, eq(usersTable.id, employeesTable.userId))
      .where(and(eq(employeesTable.salonId, salon.id), eq(employeesTable.active, true)))
      .orderBy(asc(employeesTable.name), asc(employeesTable.id))
      .limit(500),
    db.select().from(servicesTable)
      .where(eq(servicesTable.salonId, salon.id))
      .orderBy(asc(servicesTable.name), asc(servicesTable.id))
      .limit(500),
  ]);
  const employees = employeeRows.map((row) => row.employee);
  const employeeIds = employees.map((item) => item.id);
  const salonServiceIds = services.map((item) => item.id);
  const links = await db.select().from(employeeServicesTable)
    .where(employeeIds.length && salonServiceIds.length ? and(
      inArray(employeeServicesTable.employeeId, employeeIds),
      inArray(employeeServicesTable.serviceId, salonServiceIds),
    ) : sql`false`);
  const accountByEmployeeId = new Map(employeeRows.map((row) => [row.employee.id, row.account]));
  const serviceNameById = new Map(services.map((service) => [service.id, service.name]));
  const serviceIdsByEmployeeId = new Map<string, string[]>();
  for (const link of links) {
    const assigned = serviceIdsByEmployeeId.get(link.employeeId) ?? [];
    assigned.push(link.serviceId);
    serviceIdsByEmployeeId.set(link.employeeId, assigned);
  }
  res.json(employees.map((item) => {
    const serviceIds = serviceIdsByEmployeeId.get(item.id) ?? [];
    const account = item.userId ? accountByEmployeeId.get(item.id) : null;
    return {
      id: item.id, name: item.name, role: item.role, bio: item.bio, avatarUrl: item.avatarUrl, email: item.email,
      specialties: item.specialties, serviceIds, serviceNames: serviceIds.flatMap((id) => {
        const name = serviceNameById.get(id);
        return name ? [name] : [];
      }),
      account: account ? { active: account.active, email: account.email, mustChangePassword: account.mustChangePassword } : null,
    };
  }));
});

async function employeeDeactivationPreview(employee: typeof employeesTable.$inferSelect) {
  const [future] = await db.select({ count: count() }).from(appointmentsTable).where(and(
    eq(appointmentsTable.salonId, employee.salonId),
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
  const employeeName = body.name.trim();
  const employeeRole = body.role.trim();
  const serviceIds = Array.isArray(body.serviceIds) ? body.serviceIds.filter((item): item is string => typeof item === "string") : [];
  const services = serviceIds.length ? await db.select().from(servicesTable).where(and(eq(servicesTable.salonId, access.salon.id), inArray(servicesTable.id, serviceIds))) : [];
  if (services.length !== serviceIds.length) { res.status(400).json({ error: "Sve dodeljene usluge moraju pripadati vašem salonu." }); return; }
  const avatarUrl = typeof body.avatarUrl === "string" ? body.avatarUrl.trim() : "";
  if (avatarUrl && !await canClaimMediaReference({ userId: access.user.id, url: avatarUrl, scope: "employee-avatar" })) {
    res.status(400).json({ error: "Fotografija zaposlenog nije otpremljena sa ovog naloga." }); return;
  }
  let employee: typeof employeesTable.$inferSelect | undefined;
  try {
    [employee] = await db.transaction(async (tx) => {
      const rows = await tx.insert(employeesTable).values({
        salonId: access.salon.id, name: employeeName, role: employeeRole, bio: typeof body.bio === "string" ? body.bio.trim() : "",
        avatarUrl,
        email: typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : null,
        specialties: Array.isArray(body.specialties) ? body.specialties.filter((item): item is string => typeof item === "string") : [],
      }).returning();
      if (avatarUrl && !await claimMediaReference({
        userId: access.user.id, url: avatarUrl, scope: "employee-avatar", resourceId: rows[0]!.id,
      }, tx)) {
        throw new MediaClaimConflictError();
      }
      if (serviceIds.length) {
        await tx.insert(employeeServicesTable).values(serviceIds.map((serviceId) => ({ employeeId: rows[0]!.id, serviceId })));
      }
      return rows;
    });
  } catch (error) {
    if (!(error instanceof MediaClaimConflictError)) throw error;
    res.status(409).json({ error: "Fotografija zaposlenog je u međuvremenu povezana sa drugim zapisom." });
    return;
  }
  res.status(201).json({ id: employee!.id });
});

router.patch("/salon/employees/:employeeId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const body = req.body as { name?: unknown; role?: unknown; bio?: unknown; avatarUrl?: unknown; email?: unknown; specialties?: unknown; serviceIds?: unknown; active?: unknown };
  const employee = await employeeInSalon(req.params.employeeId, access.salon.id);
  if (!employee) { res.status(404).json({ error: "Zaposleni nije pronađen." }); return; }
  const nextAvatarUrl = typeof body.avatarUrl === "string" ? body.avatarUrl.trim() : employee.avatarUrl;
  if (nextAvatarUrl && !await canClaimMediaReference({
    userId: access.user.id,
    url: nextAvatarUrl,
    scope: "employee-avatar",
    resourceId: employee.id,
    existingUrls: [employee.avatarUrl],
  })) {
    res.status(400).json({ error: "Fotografija zaposlenog nije otpremljena sa ovog naloga." }); return;
  }
  if (!employee.active) { res.status(409).json({ error: "Deaktivirani zaposleni ne može dobiti pristupni nalog." }); return; }
  const serviceIds = Array.isArray(body.serviceIds) ? body.serviceIds.filter((item): item is string => typeof item === "string") : null;
  if (serviceIds) {
    const services = serviceIds.length ? await db.select().from(servicesTable).where(and(eq(servicesTable.salonId, access.salon.id), inArray(servicesTable.id, serviceIds))) : [];
    if (services.length !== serviceIds.length) { res.status(400).json({ error: "Sve dodeljene usluge moraju pripadati vašem salonu." }); return; }
  }
  try {
    await db.transaction(async (tx) => {
      if (nextAvatarUrl && mediaAssetIdFromUrl(nextAvatarUrl) && !await claimMediaReference({
        userId: access.user.id, url: nextAvatarUrl, scope: "employee-avatar", resourceId: employee.id,
      }, tx)) {
        throw new MediaClaimConflictError();
      }
      if (serviceIds) {
        await tx.delete(employeeServicesTable).where(eq(employeeServicesTable.employeeId, employee.id));
        if (serviceIds.length) await tx.insert(employeeServicesTable).values(serviceIds.map((serviceId) => ({ employeeId: employee.id, serviceId })));
      }
      await tx.update(employeesTable).set({
        name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : employee.name,
        role: typeof body.role === "string" && body.role.trim() ? body.role.trim() : employee.role,
        bio: typeof body.bio === "string" ? body.bio.trim() : employee.bio,
        avatarUrl: nextAvatarUrl,
        email: typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : employee.email,
        specialties: Array.isArray(body.specialties) ? body.specialties.filter((item): item is string => typeof item === "string") : employee.specialties,
        active: typeof body.active === "boolean" ? body.active : employee.active,
      }).where(eq(employeesTable.id, employee.id));
    });
  } catch (error) {
    if (!(error instanceof MediaClaimConflictError)) throw error;
    res.status(409).json({ error: "Fotografija zaposlenog je u međuvremenu povezana sa drugim zapisom." });
    return;
  }
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
  const employees = await db.select().from(employeesTable).where(eq(employeesTable.salonId, access.salon.id));
  const employeeIds = employees.map((employee) => employee.id);
  const requests = employeeIds.length
    ? await db.select().from(employeeLeaveRequestsTable)
      .where(inArray(employeeLeaveRequestsTable.employeeId, employeeIds))
      .orderBy(desc(employeeLeaveRequestsTable.createdAt))
    : [];
  const names = new Map(employees.map((employee) => [employee.id, employee.name]));
  res.json(requests.map((request) => ({
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

// Bounds the employee portal's appointment detail feed so the payload never
// grows with lifetime booking history. Only past history accumulates without
// limit, so we cap the look-back to a short operational window while keeping
// every upcoming appointment visible (future bookings are naturally bounded and
// all operationally relevant). A row cap guarantees the query stays bounded even
// with an unusually dense future calendar. Stats/notification counts come from
// scoped SQL aggregates instead of scanning every appointment ever booked.
const EMPLOYEE_PORTAL_WINDOW_LOOKBACK_DAYS = 45;
const EMPLOYEE_PORTAL_WINDOW_LIMIT = 2000;
const EMPLOYEE_PORTAL_NOTIFICATION_LIMIT = 5;

router.get("/employee/portal", async (req, res): Promise<void> => {
  const access = await requireSalonEmployee(req, res); if (!access) return;
  const { employee, salon, user } = access;
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = mondayOf(today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const tomorrowString = shiftCalendarDate(today, 1);
  // Lower bound covers both the current week (which can start in the previous
  // month) and the requested look-back; upcoming appointments have no upper bound.
  const windowStart = [monthStart, weekStart, shiftCalendarDate(today, -EMPLOYEE_PORTAL_WINDOW_LOOKBACK_DAYS)]
    .reduce((earliest, candidate) => (candidate < earliest ? candidate : earliest));
  const recentCreatedThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const employeeScope = and(
    eq(appointmentsTable.employeeId, employee.id),
    eq(appointmentsTable.salonId, salon.id),
  );
  const inMonth = and(gte(appointmentsTable.date, monthStart), lte(appointmentsTable.date, shiftCalendarDate(monthStart, 31)));

  const [
    windowAppointments,
    recentlyCreated,
    schedules,
    timeOff,
    leaveRequests,
    services,
    [statRow],
  ] = await Promise.all([
    // Bounded operational window (short look-back + all upcoming), stably
    // ordered for the calendar/day view and row-capped for a hard upper bound.
    db.select().from(appointmentsTable)
      .where(and(employeeScope, gte(appointmentsTable.date, windowStart)))
      .orderBy(asc(appointmentsTable.date), asc(appointmentsTable.startTime), asc(appointmentsTable.id))
      .limit(EMPLOYEE_PORTAL_WINDOW_LIMIT),
    // Most recently added appointments (any date) for the "new termin" feed.
    db.select().from(appointmentsTable)
      .where(and(employeeScope, gte(appointmentsTable.createdAt, recentCreatedThreshold)))
      .orderBy(desc(appointmentsTable.createdAt), desc(appointmentsTable.id))
      .limit(EMPLOYEE_PORTAL_NOTIFICATION_LIMIT),
    db.select().from(employeeSchedulesTable).where(eq(employeeSchedulesTable.employeeId, employee.id)).orderBy(asc(employeeSchedulesTable.weekday)),
    db.select().from(employeeTimeOffTable).where(eq(employeeTimeOffTable.employeeId, employee.id)),
    db.select().from(employeeLeaveRequestsTable).where(eq(employeeLeaveRequestsTable.employeeId, employee.id)).orderBy(desc(employeeLeaveRequestsTable.createdAt)),
    db.select({
      id: servicesTable.id,
      name: servicesTable.name,
      durationMinutes: servicesTable.durationMinutes,
      active: servicesTable.active,
    }).from(servicesTable)
      .innerJoin(employeeServicesTable, eq(employeeServicesTable.serviceId, servicesTable.id))
      .where(and(
        eq(employeeServicesTable.employeeId, employee.id),
        eq(servicesTable.salonId, salon.id),
      )),
    // Stat counters computed in SQL over the full history, scoped to this employee.
    db.select({
      week: sql<number>`count(*) filter (where ${appointmentsTable.status} <> 'cancelled' and ${appointmentsTable.date} >= ${weekStart} and ${appointmentsTable.date} <= ${today})::int`,
      month: sql<number>`count(*) filter (where ${appointmentsTable.status} <> 'cancelled' and ${appointmentsTable.date} >= ${monthStart} and to_char(${appointmentsTable.date}, 'YYYY-MM') = ${today.slice(0, 7)})::int`,
      completed: sql<number>`count(*) filter (where ${appointmentsTable.status} = 'completed' and ${appointmentsTable.date} >= ${monthStart})::int`,
      noShow: sql<number>`count(*) filter (where ${appointmentsTable.status} = 'no-show' and ${appointmentsTable.date} >= ${monthStart})::int`,
    }).from(appointmentsTable).where(and(employeeScope, or(inMonth, and(gte(appointmentsTable.date, weekStart), lte(appointmentsTable.date, today))))),
  ]);

  // Resolve only the customers/contacts referenced by the bounded window.
  const salonCustomerIds = [...new Set(windowAppointments.map((appointment) => appointment.salonCustomerId).filter((id): id is string => Boolean(id)))];
  const customerUserIds = [...new Set(windowAppointments.map((appointment) => appointment.customerId).filter((id): id is string => Boolean(id)))];
  const [contacts, customers, allocationsByAppointment] = await Promise.all([
    salonCustomerIds.length ? db.select().from(salonCustomersTable).where(and(eq(salonCustomersTable.salonId, salon.id), inArray(salonCustomersTable.id, salonCustomerIds))) : Promise.resolve([] as (typeof salonCustomersTable.$inferSelect)[]),
    customerUserIds.length ? db.select().from(usersTable).where(inArray(usersTable.id, customerUserIds)) : Promise.resolve([] as (typeof usersTable.$inferSelect)[]),
    getAllocationsForAppointments(windowAppointments.map((appointment) => appointment.id)),
  ]);
  const serviceById = new Map(services.map((service) => [service.id, service]));
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const ownClients = new Map<string, { id: string; firstName: string; lastName: string; phone: string | null }>();
  const appointmentViews = windowAppointments.map((appointment) => {
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
      allocatedResources: allocationsByAppointment.get(appointment.id) ?? [],
    };
  });
  const notifications = [
    ...recentlyCreated.map((item) => ({
      id: `new-${item.id}`, title: "Dodat vam je novi termin", date: item.date, createdAt: item.createdAt,
    })),
    ...windowAppointments.filter((item) => item.date === tomorrowString && !["cancelled", "completed", "no-show"].includes(item.status)).map((item) => ({
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
      week: Number(statRow?.week ?? 0),
      month: Number(statRow?.month ?? 0),
      completed: Number(statRow?.completed ?? 0),
      noShow: Number(statRow?.noShow ?? 0),
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
  if (avatarUrl && !await canClaimMediaReference({
    userId: access.user.id,
    url: avatarUrl,
    scope: "employee-avatar",
    resourceId: access.employee.id,
    existingUrls: [access.employee.avatarUrl],
  })) {
    res.status(400).json({ error: "Fotografija profila nije otpremljena sa ovog naloga." }); return;
  }
  if (phone && !phoneNormalized) { res.status(400).json({ error: "Unesite ispravan broj telefona." }); return; }
  if (phoneNormalized) {
    const [taken] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phoneNormalized, phoneNormalized)).limit(1);
    if (taken && taken.id !== access.user.id) { res.status(409).json({ error: "Broj telefona je već povezan sa drugim nalogom." }); return; }
  }
  try {
    await db.transaction(async (tx) => {
      if (avatarUrl && mediaAssetIdFromUrl(avatarUrl) && !await claimMediaReference({
        userId: access.user.id,
        url: avatarUrl,
        scope: "employee-avatar",
        resourceId: access.employee.id,
      }, tx)) {
        throw new MediaClaimConflictError();
      }
      await tx.update(employeesTable).set({ bio, avatarUrl }).where(eq(employeesTable.id, access.employee.id));
      await tx.update(usersTable).set({ phone: phone || null, phoneNormalized, updatedAt: new Date() }).where(eq(usersTable.id, access.user.id));
    });
  } catch (error) {
    if (!(error instanceof MediaClaimConflictError)) throw error;
    res.status(409).json({ error: "Fotografija profila je u međuvremenu povezana sa drugim zapisom." });
    return;
  }
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
  await publishSalonNotificationUpdate(access.salon.id);
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
    const allocsByAppt = await getAllocationsForAppointments(created.appointments.map((a) => a.id));
    const views = created.appointments.map((appointment) => appointmentView(appointment, access.salon, service[0], contact!, access.employee, false, null, allocsByAppt.get(appointment.id) ?? []));
    await sendSeriesConfirmations({ appointments: created.appointments, contact: contact!, salon: access.salon });
    const response = { id: created.series.id, totalAppointments: created.appointments.length, appointments: views };
    CreateEmployeeAppointmentSeriesResponse.parse(response);
    res.status(201).json(response);
  } catch (error) {
    const message = error instanceof ResourceCapacityError ? error.message
      : error instanceof AppointmentSeriesError ? error.message
        : "Serija termina nije sačuvana.";
    res.status(error instanceof ResourceCapacityError ? 409 : error instanceof AppointmentSeriesError ? error.status : 500).json({ error: message });
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
    const requirements = await fetchServiceResourceRequirements(tx, serviceId);
    const batchResourceReservations: ResourceReservation[] = [];
    // Check resource availability for all slots before inserting.
    for (const slot of preparedSlots) {
      const resourceAvailable = await resourcesAvailableForSlot(tx, requirements, slot.date, slot.startTime, slot.endTime, batchResourceReservations);
      if (!resourceAvailable) throw new EmployeeBookingError(`Nema dovoljno kapaciteta resursa za termin ${slot.date} u ${slot.startTime}.`, 409);
      for (const req of requirements) {
        batchResourceReservations.push({ resourceId: req.resourceId, quantity: req.quantity, date: slot.date, startTime: slot.startTime, endTime: slot.endTime });
      }
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
      // allocateResourcesInTx throws ResourceCapacityError → rolls back.
      await allocateResourcesInTx(tx, access.salon.id, requirements, appointment!.id, slot.date, slot.startTime, slot.endTime);
      created.push(appointment!);
    }
    return { contact, created };
  }).catch((error: unknown) => {
    if (error instanceof EmployeeBookingError) return { error: error.message, status: error.status };
    if (error instanceof ResourceCapacityError) return { error: error.message, status: 409 };
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
  const allocsByAppt = await getAllocationsForAppointments(batch.created.map((a) => a.id));
  res.status(201).json({ appointments: batch.created.map((item) => ({
    id: item.id, date: item.date, startTime: item.startTime, status: item.status,
    allocatedResources: allocsByAppt.get(item.id) ?? [],
  })) });
});

async function loyaltyStatusForSalons(salonIds: string[], subscriptionBaseDue = 2490) {
  const statuses = salonIds.length
    ? await db.select().from(salonLoyaltyStatusesTable).where(inArray(salonLoyaltyStatusesTable.salonId, salonIds))
    : [];
  const tiers = await db.select().from(loyaltyTiersTable).where(eq(loyaltyTiersTable.active, true)).orderBy(asc(loyaltyTiersTable.sortOrder));
  // Existing status rows stay attached to their original location. Summing
  // them here safely migrates every owner to account-wide loyalty without
  // destructive data movement or a duplicate business-account table.
  const spend = statuses.reduce((total, status) => total + status.currentPeriodSpend, 0);
  // With zero active tiers there is nothing to rank against. Return a
  // schema-valid neutral default instead of throwing/500, preserving any
  // current spend the owner has already accrued.
  if (tiers.length === 0) {
    return GetLoyaltyStatusResponse.parse({
      currentTier: "",
      monthlySpend: spend,
      tierThreshold: 0,
      amountToNextTier: 0,
      nextTier: null,
      subscriptionDue: subscriptionBaseDue,
      subscriptionDiscountPercent: 0,
      productDiscountPercent: 0,
      benefits: [],
      freeSubscription: false,
    });
  }
  const current = [...tiers].reverse().find((tier) => tier.spendThreshold <= spend) ?? tiers[0]!;
  const next = tiers.find((tier) => tier.sortOrder > current.sortOrder) ?? null;
  const due = current.freeSubscription ? 0 : Math.round(subscriptionBaseDue * (1 - current.subscriptionDiscountPercent / 100));
  return GetLoyaltyStatusResponse.parse({ currentTier: current.name, monthlySpend: spend, tierThreshold: current.spendThreshold, amountToNextTier: next ? Math.max(next.spendThreshold - spend, 0) : 0, nextTier: next?.name ?? null, subscriptionDue: due, subscriptionDiscountPercent: current.subscriptionDiscountPercent, productDiscountPercent: current.productDiscountPercent, benefits: current.benefits, freeSubscription: current.freeSubscription });
}

async function loyaltyStatusForOwner(ownerId: string) {
  const [salons, subscriptionRows] = await Promise.all([
    db.select({ id: salonsTable.id }).from(salonsTable).where(eq(salonsTable.ownerId, ownerId)),
    db.select({ subscription: subscriptionsTable, plan: subscriptionPlansTable })
      .from(subscriptionsTable)
      .innerJoin(salonsTable, eq(subscriptionsTable.salonId, salonsTable.id))
      .innerJoin(subscriptionPlansTable, eq(subscriptionsTable.planId, subscriptionPlansTable.id))
      .where(eq(salonsTable.ownerId, ownerId)),
  ]);
  // Subscription rows remain location-linked for admin auditing. Owner-facing
  // calculation deliberately chooses one deterministic account subscription
  // rather than charging once per location.
  const priority: Record<(typeof subscriptionsTable.$inferSelect)["status"], number> = {
    free_via_loyalty: 6,
    active: 5,
    trial: 4,
    past_due: 3,
    suspended: 2,
    cancelled: 1,
  };
  const rankedSubscriptions = [...subscriptionRows].sort((a, b) =>
    priority[b.subscription.status] - priority[a.subscription.status]
    || b.subscription.dueAmount - a.subscription.dueAmount
    || a.subscription.id.localeCompare(b.subscription.id),
  );
  // Legacy subscriptions remain location-linked for administration and audit.
  // Owner billing deliberately applies one explicit rule: the best live
  // status wins; equal statuses retain the highest *recorded* due amount, then
  // UUID breaks an exact tie. This never depends on mutable plan pricing or
  // period-end dates and avoids silently undercharging a legacy owner with two
  // active location subscriptions.
  const accountSubscription = rankedSubscriptions[0];
  const subscriptionBaseDue = accountSubscription?.subscription.dueAmount ?? 2490;
  return loyaltyStatusForSalons(salons.map((salon) => salon.id), subscriptionBaseDue);
}

router.get("/shop/brands", async (_req, res): Promise<void> => {
  const brands = await catalogCache.getOrLoad(
    "shop-brands:active",
    ["product-brands"],
    () => db.select().from(productBrandsTable).where(eq(productBrandsTable.active, true)).orderBy(asc(productBrandsTable.name)),
    600_000,
  );
  res.json(brands.map((b) => ({ id: b.id, name: b.name, slug: b.slug, description: b.description, logoUrl: b.logoUrl ?? null })));
});

router.get("/shop/categories", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  void access;
  const allCats = await catalogCache.getOrLoad(
    "product-categories:active",
    ["product-categories"],
    () => db.select().from(productCategoriesTable).where(eq(productCategoriesTable.active, true)).orderBy(asc(productCategoriesTable.sortOrder)),
    600_000,
  );
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

// SQL mirror of productBelongsToActiveCategory so category availability can be
// filtered, counted and paginated in the database rather than in JS. Products
// reference categories by name (not id), matching the in-memory logic exactly:
// - With a subcategory: the subcategory must be active with an active parent
//   whose name equals the product's categoryName.
// - Without a subcategory: a top-level (parentId IS NULL) category with the
//   matching name must be active.
function activeCategoryCondition() {
  const sub = sql`${productCategoriesTable} AS sub`;
  const parent = sql`${productCategoriesTable} AS parent`;
  const cat = sql`${productCategoriesTable} AS cat`;
  return sql`(
    CASE WHEN ${productsTable.subcategoryName} IS NOT NULL THEN
      EXISTS (
        SELECT 1 FROM ${sub}
        WHERE sub.name = ${productsTable.subcategoryName}
          AND sub.active = true
          AND sub.parent_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM ${parent}
            WHERE parent.id = sub.parent_id
              AND parent.active = true
              AND parent.name = ${productsTable.categoryName}
          )
      )
    ELSE
      EXISTS (
        SELECT 1 FROM ${cat}
        WHERE cat.name = ${productsTable.categoryName}
          AND cat.parent_id IS NULL
          AND cat.active = true
      )
    END
  )`;
}

// Grouped review aggregate (count + rounded average) for a set of product ids,
// computed in one query so callers never load every review row and never run
// per-product array reductions.
async function productReviewAggregates(productIds: string[]): Promise<Map<string, { count: number; averageRating: number | null }>> {
  const map = new Map<string, { count: number; averageRating: number | null }>();
  if (productIds.length === 0) return map;
  const rows = await db
    .select({
      productId: productReviewsTable.productId,
      count: count(productReviewsTable.id),
      average: sql<number | null>`avg(${productReviewsTable.rating})`,
    })
    .from(productReviewsTable)
    .where(inArray(productReviewsTable.productId, productIds))
    .groupBy(productReviewsTable.productId);
  for (const row of rows) {
    const average = row.average == null ? null : Math.round(Number(row.average) * 10) / 10;
    map.set(row.productId, { count: Number(row.count), averageRating: average });
  }
  return map;
}

// Build a product DTO from a precomputed aggregate, avoiding repeated review
// array scans. Falls back to a zero aggregate when the product has no reviews.
function productDtoWithAggregate(
  item: typeof productsTable.$inferSelect,
  aggregate: { count: number; averageRating: number | null } | undefined,
) {
  const discountPercent = item.discountPrice ? Math.round((1 - item.discountPrice / item.price) * 100) : null;
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
    averageRating: aggregate?.averageRating ?? null,
    reviewCount: aggregate?.count ?? 0,
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
  const q = parsed.data;
  const productFilters: Parameters<typeof and>[0][] = [eq(productsTable.active, true)];
  if (q.category) productFilters.push(eq(productsTable.categoryName, q.category));
  if (q.subcategory) productFilters.push(eq(productsTable.subcategoryName, q.subcategory));
  if (q.brand) productFilters.push(sql`lower(${productsTable.brand}) = ${q.brand.toLowerCase()}`);
  if (q.onSale) productFilters.push(isNotNull(productsTable.discountPrice));
  if (q.isNew) productFilters.push(eq(productsTable.isNew, true));
  if (q.isBestseller) productFilters.push(eq(productsTable.isBestseller, true));
  if (q.search) productFilters.push(sql`lower(${productsTable.name} || ' ' || ${productsTable.description} || ' ' || coalesce(${productsTable.brand}, '')) like ${`%${q.search.toLowerCase()}%`}`);
  // Category availability is enforced in SQL so counting and paging stay stable
  // and every matching product remains reachable across pages.
  productFilters.push(activeCategoryCondition());
  const whereClause = and(...productFilters);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 24;
  // Count the full matching set, then fetch only the requested page ordered
  // deterministically (name asc, id asc) so page boundaries never shift.
  const [[totals], pageProducts] = await Promise.all([
    db.select({ total: count(productsTable.id) }).from(productsTable).where(whereClause),
    db
      .select()
      .from(productsTable)
      .where(whereClause)
      .orderBy(asc(productsTable.name), asc(productsTable.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ]);
  const total = Number(totals?.total ?? 0);
  // Review aggregates are grouped and scoped to only the products on this page.
  const aggregates = await productReviewAggregates(pageProducts.map((item) => item.id));
  res.json(ListProductsResponse.parse({
    items: pageProducts.map((item) => productDtoWithAggregate(item, aggregates.get(item.id))),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }));
});

router.get("/shop/products/:productId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  const parsed = GetShopProductParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  // Availability (active + active category) is enforced in SQL; a miss is a 404.
  const [product] = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.id, parsed.data.productId), eq(productsTable.active, true), activeCategoryCondition()))
    .limit(1);
  if (!product) {
    res.status(404).json({ error: "Proizvod nije pronađen ili nije dostupan." }); return;
  }
  const item = product;
  // Fetch up to 4 related candidates in SQL, already excluding the current
  // product and enforcing category availability, so the full same-category set
  // is never loaded into memory.
  const [reviewRows, related] = await Promise.all([
    productReviewViews(item.id, access.salon.id),
    db
      .select()
      .from(productsTable)
      .where(and(eq(productsTable.active, true), eq(productsTable.categoryName, item.categoryName), ne(productsTable.id, item.id), activeCategoryCondition()))
      .orderBy(asc(productsTable.name), asc(productsTable.id))
      .limit(4),
  ]);
  // Review aggregates are queried only for the current product plus the related
  // ones and read from grouped maps instead of repeated array filters.
  const aggregates = await productReviewAggregates([item.id, ...related.map((candidate) => candidate.id)]);
  const relatedProducts = related.map((candidate) => productDtoWithAggregate(candidate, aggregates.get(candidate.id)));
  res.json(GetShopProductResponse.parse({
    ...productDtoWithAggregate(item, aggregates.get(item.id)),
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
  res.json(await loyaltyStatusForOwner(access.user.id));
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
  const loyalty = await loyaltyStatusForOwner(access.user.id);
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
    items: views,
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
  await publishSalonNotificationUpdate(salon.id);
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
  // Stable pagination in SQL (createdAt desc, id desc); page/pageSize read
  // directly from req.query (page/pageSize 1..100) so paging works before
  // codegen regenerates the query schema. Response stays a flat array.
  const { limit, offset } = parsePagination(req.query, 50);
  const orders = await db.select().from(ordersTable)
    .where(eq(ordersTable.salonId, salon.id))
    .orderBy(desc(ordersTable.createdAt), desc(ordersTable.id))
    .limit(limit).offset(offset);
  if (!orders.length) { res.json(ListOrdersResponse.parse([])); return; }
  // Fetch order items only for the page's order ids, then pre-group them so the
  // DTO mapping does not scan the whole item set per order.
  const orderIds = orders.map((order) => order.id);
  const items = await db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, orderIds));
  const itemsByOrderId = new Map<string, (typeof orderItemsTable.$inferSelect)[]>();
  for (const item of items) {
    const arr = itemsByOrderId.get(item.orderId) ?? [];
    arr.push(item);
    itemsByOrderId.set(item.orderId, arr);
  }
  // Only referenced courier rows are fetched (couriersForOrders dedupes ids).
  const couriers = await couriersForOrders(orders);
  res.json(ListOrdersResponse.parse(orders.map((order) => orderDto(order, itemsByOrderId.get(order.id) ?? [], salon, order.courierServiceId ? couriers.get(order.courierServiceId) : undefined))));
});

router.get("/shop/notifications", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  // Stable pagination in SQL (createdAt desc, id desc); flat-array response and
  // unread behavior are preserved because unread state lives on each row.
  const { limit, offset } = parsePagination(req.query, 50);
  const notifications = await db.select()
    .from(salonNotificationsTable)
    .where(eq(salonNotificationsTable.salonId, access.salon.id))
    .orderBy(desc(salonNotificationsTable.createdAt), desc(salonNotificationsTable.id))
    .limit(limit).offset(offset);
  res.json(ListSalonNotificationsResponse.parse(notifications));
});

router.get("/shop/notifications/events", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res); if (!access) return;
  res.status(200).set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  subscribeToSalonNotificationEvents(access.salon.id, res);
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
  await publishSalonNotificationUpdate(access.salon.id);
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
  // page/pageSize are read directly from req.query (independent of the generated
  // query schema) so pagination works before codegen regenerates the params.
  const { limit, offset } = parsePagination(req.query, 50);

  // Push all scalar filters into SQL predicates; ALL filters apply before pagination.
  const sqlPredicates = [];
  if (q.status) sqlPredicates.push(eq(ordersTable.status, q.status));
  if (q.paymentStatus) sqlPredicates.push(eq(ordersTable.paymentStatus, q.paymentStatus));
  if (q.deliveryMethod) sqlPredicates.push(eq(ordersTable.deliveryMethod, q.deliveryMethod));
  if (q.from) sqlPredicates.push(gte(ordersTable.createdAt, new Date(`${q.from}T00:00:00.000Z`)));
  if (q.to) sqlPredicates.push(lte(ordersTable.createdAt, new Date(`${q.to}T23:59:59.999Z`)));

  // The `salon` filter is a hard AND constraint: resolve matching salon IDs by
  // name/email and require the order to belong to one of them. If nothing matches
  // the salon term there can be no results.
  if (q.salon) {
    const term = `%${q.salon}%`;
    const matchingSalons = await db.select({ id: salonsTable.id }).from(salonsTable)
      .where(or(ilike(salonsTable.name, term), ilike(salonsTable.email, term)));
    const salonFilterIds = matchingSalons.map((s) => s.id);
    if (!salonFilterIds.length) { res.json([]); return; }
    sqlPredicates.push(inArray(ordersTable.salonId, salonFilterIds));
  }
  // `search` matches the order id, shippingName, or the order's salon (name/email).
  // It is ANDed with every other predicate (including the salon filter above), so it
  // narrows within the salon constraint rather than escaping it.
  if (q.search) {
    const term = `%${q.search}%`;
    const searchSalons = await db.select({ id: salonsTable.id }).from(salonsTable)
      .where(or(ilike(salonsTable.name, term), ilike(salonsTable.email, term)));
    const searchSalonIds = searchSalons.map((s) => s.id);
    const searchClauses = [
      ilike(sql`${ordersTable.id}::text`, term),
      ilike(ordersTable.shippingName, term),
    ];
    if (searchSalonIds.length) searchClauses.push(inArray(ordersTable.salonId, searchSalonIds));
    sqlPredicates.push(or(...searchClauses)!);
  }

  const orders = await db.select().from(ordersTable)
    .where(sqlPredicates.length ? and(...sqlPredicates) : undefined)
    .orderBy(desc(ordersTable.createdAt), desc(ordersTable.id))
    .limit(limit).offset(offset);

  if (!orders.length) { res.json([]); return; }

  // Fetch related rows only for the bounded result set.
  const orderIds = orders.map((o) => o.id);
  const salonIds = [...new Set(orders.map((o) => o.salonId))];
  const [items, histories, salons] = await Promise.all([
    db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, orderIds)),
    db.select().from(orderStatusHistoryTable).where(inArray(orderStatusHistoryTable.orderId, orderIds)).orderBy(desc(orderStatusHistoryTable.createdAt)),
    db.select().from(salonsTable).where(inArray(salonsTable.id, salonIds)),
  ]);
  const couriers = await couriersForOrders(orders);
  const salonById = new Map(salons.map((s) => [s.id, s]));
  const itemsByOrderId = new Map<string, (typeof orderItemsTable.$inferSelect)[]>();
  for (const item of items) {
    const arr = itemsByOrderId.get(item.orderId) ?? [];
    arr.push(item);
    itemsByOrderId.set(item.orderId, arr);
  }
  const historiesByOrderId = new Map<string, (typeof orderStatusHistoryTable.$inferSelect)[]>();
  for (const event of histories) {
    const arr = historiesByOrderId.get(event.orderId) ?? [];
    arr.push(event);
    historiesByOrderId.set(event.orderId, arr);
  }
  res.json(AdminListOrdersResponse.parse(orders.flatMap((order) => {
    const salon = salonById.get(order.salonId);
    return salon ? [adminOrderDto(order, itemsByOrderId.get(order.id) ?? [], salon, historiesByOrderId.get(order.id) ?? [], order.courierServiceId ? couriers.get(order.courierServiceId) : undefined)] : [];
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
  if (!changed.length) { res.json([]); return; }
  const changedSalonIds = [...new Set(changed.map((o) => o.salonId))];
  const [itemRows, salonRows, couriers] = await Promise.all([
    db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, changed.map((o) => o.id))),
    db.select().from(salonsTable).where(inArray(salonsTable.id, changedSalonIds)),
    couriersForOrders(changed),
  ]);
  const salonById = new Map(salonRows.map((s) => [s.id, s]));
  const itemsByOrderId = new Map<string, (typeof orderItemsTable.$inferSelect)[]>();
  for (const item of itemRows) {
    const arr = itemsByOrderId.get(item.orderId) ?? [];
    arr.push(item);
    itemsByOrderId.set(item.orderId, arr);
  }
  res.json(changed.flatMap((order) => {
    const salon = salonById.get(order.salonId);
    return salon ? [adminOrderDto(order, itemsByOrderId.get(order.id) ?? [], salon, [], order.courierServiceId ? couriers.get(order.courierServiceId) : undefined)] : [];
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
  const { updated, deliveryChanged } = await db.transaction(async (tx) => {
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
    return { updated: saved!, deliveryChanged };
  });
  if (deliveryChanged) await publishSalonNotificationUpdate(order.salonId);
  const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.id, updated.salonId)).limit(1);
  if (body.data.status && body.data.status !== order.status) {
    const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, salon!.ownerId)).limit(1);
    if (owner) await sendTransactionalEmail({
      eventKey: `b2b-order:${updated.id}:status:${body.data.status}`,
      emailType: "b2b_order_status",
      to: { email: owner.email, name: `${owner.firstName} ${owner.lastName}` },
      subject: `LUMERA Biznis — status porudžbine: ${body.data.status}`,
      htmlContent: lumeraEmailHtml("Status porudžbine je ažuriran", `<p>Porudžbina za ${emailSafe(salon!.name)} sada ima status <strong>${emailSafe(body.data.status)}</strong>${updated.trackingNumber ? `. Broj za praćenje: <strong>${emailSafe(updated.trackingNumber)}</strong>.` : ""}</p>`),
      metadata: { orderId: updated.id, salonId: salon!.id, status: body.data.status },
    });
  }
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, updated.id));
  const history = await db.select().from(orderStatusHistoryTable).where(eq(orderStatusHistoryTable.orderId, updated.id)).orderBy(desc(orderStatusHistoryTable.createdAt));
  const [courier] = updated.courierServiceId ? await db.select().from(courierServicesTable).where(eq(courierServicesTable.id, updated.courierServiceId)).limit(1) : [];
  res.json(AdminUpdateOrderStatusResponse.parse(adminOrderDto(updated, items, salon!, history, courier)));
});

router.get("/education/courses", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const parsed = ListCoursesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const query = parsed.data;

  // Ownership predicate (SQL): owner salon/center matches. Admins own nothing but
  // see everything, so they impose no ownership restriction. isCourseOwner() returns
  // false for admins, so mirror that exact semantics here.
  const ownershipPredicates: Parameters<typeof and>[0][] = [];
  if (!access.admin && access.salon) ownershipPredicates.push(eq(coursesTable.salonId, access.salon.id));
  if (!access.admin && access.centers.length) {
    ownershipPredicates.push(inArray(coursesTable.centerId, access.centers.map((center) => center.id)));
  }
  const ownedPredicate = ownershipPredicates.length ? or(...ownershipPredicates) : undefined;

  // Center-eligibility predicate (SQL EXISTS): matches educationCenterEligibility
  // exactly — verificationStatus = 'verified' AND an active/free-via-loyalty
  // subscription. Pushed to SQL so it applies *before* the bound.
  const eligibleCenterExists = sql`exists (
    select 1 from ${educationCentersTable} ec
    join ${educationCenterSubscriptionsTable} ecs on ecs.center_id = ec.id
    where ec.id = ${coursesTable.centerId}
      and ec.verification_status = 'verified'
      and ecs.status in ('active', 'free_via_loyalty')
  )`;

  // Public-candidate predicate (SQL): published, not archived, center-linked AND
  // the linked center is eligible. Fully expressed in SQL — no post-limit filtering.
  const publicCandidatePredicate = and(
    eq(coursesTable.published, true),
    eq(coursesTable.archived, false),
    isNotNull(coursesTable.centerId),
    eligibleCenterExists,
  );

  // Visibility predicate: exact prior semantics.
  //   mine  -> admin || owned
  //   else  -> admin || owned || (publicCandidate AND eligible center)
  // Admins impose no visibility restriction. Non-admins restrict to owned (+public unless mine).
  let visibilityPredicate: Parameters<typeof and>[0] | undefined;
  if (!access.admin) {
    const clauses: Parameters<typeof and>[0][] = [];
    if (ownedPredicate) clauses.push(ownedPredicate);
    if (!query.mine) clauses.push(publicCandidatePredicate);
    // No clauses means a non-admin with no ownership asking for `mine` — matches nothing.
    visibilityPredicate = clauses.length ? or(...clauses) : sql`false`;
  }

  // Scalar filters pushed to SQL — preserve exact prior AND semantics/comparisons.
  const scalarPredicates: Parameters<typeof and>[0][] = [];
  if (query.format) scalarPredicates.push(eq(coursesTable.format, query.format));
  if (query.city) scalarPredicates.push(eq(sql`lower(${coursesTable.city})`, query.city.toLowerCase()));
  if (query.category) scalarPredicates.push(ilike(coursesTable.category, `%${query.category}%`));
  if (query.certification !== undefined) scalarPredicates.push(eq(coursesTable.certification, query.certification));
  if (query.minPrice !== undefined) scalarPredicates.push(gte(coursesTable.price, query.minPrice));
  if (query.maxPrice !== undefined) scalarPredicates.push(lte(coursesTable.price, query.maxPrice));
  // rating column stores tenths (course.rating / 10 in the view). minRating is on the 0–5 scale.
  if (query.minRating !== undefined) scalarPredicates.push(gte(coursesTable.rating, Math.ceil(query.minRating * 10)));
  if (query.startDate) scalarPredicates.push(gte(coursesTable.startDate, calendarDate(query.startDate)));

  // Publisher-name (center) filter pushed to SQL via EXISTS over the linked salon
  // or center. Preserves prior case-insensitive substring semantics. Runs before
  // the bound so older matching rows are not truncated.
  if (query.center) {
    const centerLike = `%${query.center.toLowerCase()}%`;
    scalarPredicates.push(or(
      sql`exists (select 1 from ${salonsTable} s where s.id = ${coursesTable.salonId} and lower(s.name) like ${centerLike})`,
      sql`exists (select 1 from ${educationCentersTable} ec where ec.id = ${coursesTable.centerId} and lower(ec.name) like ${centerLike})`,
    ));
  }

  const whereClauses: Parameters<typeof and>[0][] = [];
  if (visibilityPredicate) whereClauses.push(visibilityPredicate);
  whereClauses.push(...scalarPredicates);

  // Every filter (ownership, visibility, eligibility, scalar, publisher-name) is now
  // in the SQL WHERE, so the stable ORDER BY + OFFSET/LIMIT paginates the full match
  // set deterministically — no matching rows are silently omitted by the bound.
  const pageSize = query.pageSize;
  const offset = (query.page - 1) * pageSize;
  const courses = await db.select().from(coursesTable)
    .where(whereClauses.length ? and(...whereClauses) : undefined)
    .orderBy(desc(coursesTable.createdAt), desc(coursesTable.id))
    .limit(pageSize)
    .offset(offset);

  const views = await batchEducationCourseViews(courses, access);
  res.json(ListCoursesResponse.parse(views).map(calendarDateCourseResponse));
});

router.post("/education/courses", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const parsed = CreateEducationCourseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const publisher = access.salon ?? access.centers[0];
  if (!publisher || access.admin) { res.status(403).json({ error: "Administrator ne može da objavi kurs u ime drugog izdavača." }); return; }
  if (access.centers[0] && !(await educationCenterEligibility(access.centers[0].id)).eligible) {
    res.status(403).json({ error: "Centar mora biti verifikovan i imati aktivnu pretplatu pre objave ili prodaje edukacija." });
    return;
  }
  const data = parsed.data;
  if (!await canClaimMediaReference({ userId: access.user.id, url: data.imageUrl, scope: "education-cover" })) {
    res.status(400).json({ error: "Naslovna fotografija edukacije nije otpremljena sa ovog naloga." }); return;
  }
  let course: typeof coursesTable.$inferSelect | undefined;
  try {
    [course] = await db.transaction(async (tx) => {
      const rows = await tx.insert(coursesTable).values({
        salonId: access.salon?.id ?? null,
        centerId: access.centers[0]?.id ?? null,
        title: data.title,
        description: data.description ?? "",
        category: data.category,
        format: data.format,
        city: data.city ?? publisher.city,
        price: data.price,
        duration: data.duration,
        level: data.level ?? "all-levels",
        learningOutcomes: data.learningOutcomes ?? [],
        includedItems: data.includedItems ?? [],
        requirements: data.requirements ?? "",
        certification: data.certification ?? false,
        imageUrl: data.imageUrl,
        startDate: data.startDate ? calendarDate(data.startDate) : null,
        ...(data.refundPolicy !== undefined ? { refundPolicy: data.refundPolicy } : {}),
        groupDiscountMinimum: data.groupDiscountMinimum ?? null,
        groupDiscountPercent: data.groupDiscountPercent ?? null,
        published: false,
        archived: false,
      }).returning();
      if (!await claimMediaReference({
        userId: access.user.id,
        url: data.imageUrl,
        scope: "education-cover",
        resourceId: rows[0]!.id,
        visibility: "education",
      }, tx)) {
        throw new MediaClaimConflictError();
      }
      return rows;
    });
  } catch (error) {
    if (!(error instanceof MediaClaimConflictError)) throw error;
    res.status(409).json({ error: "Naslovna fotografija je u međuvremenu povezana sa drugim zapisom." });
    return;
  }
  void publishCatalogInvalidation(["education-categories"]);
  const view = await educationCourseView(course!, access);
  res.status(201).json(calendarDateCourseResponse(CreateEducationCourseResponse.parse(view)));
});

router.get("/education/courses/:courseId", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const parsed = GetEducationCourseParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, parsed.data.courseId)).limit(1);
  if (!course) { res.status(404).json({ error: "Kurs nije pronađen." }); return; }
  if (!(await isPublicEducationCourse(course)) && !isCourseOwner(access, course) && !access.admin) {
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
  const previousCoverAssetId = mediaAssetIdFromUrl(course.imageUrl);
  const nextCoverAssetId = data.imageUrl === undefined ? previousCoverAssetId : mediaAssetIdFromUrl(data.imageUrl);
  if (data.imageUrl !== undefined && !await canClaimMediaReference({
    userId: access.user.id,
    url: data.imageUrl,
    scope: "education-cover",
    resourceId: course.id,
    existingUrls: [course.imageUrl],
  })) {
    res.status(400).json({ error: "Naslovna fotografija edukacije nije otpremljena sa ovog naloga." }); return;
  }
  let updated: typeof coursesTable.$inferSelect | undefined;
  try {
    [updated] = await db.transaction(async (tx) => {
      if (data.imageUrl !== undefined && mediaAssetIdFromUrl(data.imageUrl) && !await claimMediaReference({
        userId: access.user.id,
        url: data.imageUrl,
        scope: "education-cover",
        resourceId: course.id,
        visibility: "education",
      }, tx)) {
        throw new MediaClaimConflictError();
      }
      const rows = await tx.update(coursesTable).set({
        ...data,
        startDate: data.startDate === undefined ? course.startDate : data.startDate ? calendarDate(data.startDate) : null,
        updatedAt: new Date(),
      }).where(eq(coursesTable.id, course.id)).returning();
      if (previousCoverAssetId && previousCoverAssetId !== nextCoverAssetId) {
        await tx.update(mediaAssetsTable).set({
          resourceId: null,
          visibility: "private",
        }).where(and(
          eq(mediaAssetsTable.id, previousCoverAssetId),
          eq(mediaAssetsTable.ownerUserId, access.user.id),
          eq(mediaAssetsTable.scope, "education-cover"),
          eq(mediaAssetsTable.resourceId, course.id),
        ));
      }
      return rows;
    });
  } catch (error) {
    if (!(error instanceof MediaClaimConflictError)) throw error;
    res.status(409).json({ error: "Naslovna fotografija je u međuvremenu povezana sa drugim zapisom." });
    return;
  }
  if (body.data.category !== undefined) {
    void publishCatalogInvalidation(["education-categories"]);
  }
  res.json(calendarDateCourseResponse(UpdateEducationCourseResponse.parse(await educationCourseView(updated!, access))));
});

router.post("/education/courses/:courseId/publish", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const parsed = PublishEducationCourseParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const course = await requireOwnedCourse(access, parsed.data.courseId, res); if (!course) return;
  if (course.centerId && !(await educationCenterEligibility(course.centerId)).eligible) {
    res.status(403).json({ error: "Kurs ne može biti objavljen dok centar nije verifikovan i pretplata aktivna." });
    return;
  }
  const [updated] = await db.update(coursesTable).set({ published: true, archived: false, updatedAt: new Date() }).where(eq(coursesTable.id, course.id)).returning();
  void publishCatalogInvalidation(["education-categories"]);
  res.json(calendarDateCourseResponse(PublishEducationCourseResponse.parse(await educationCourseView(updated!, access))));
});

router.post("/education/courses/:courseId/gallery/upload-url", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const params = GetEducationCourseParams.safeParse(req.params);
  const body = RequestEducationCourseGalleryUploadBody.safeParse(req.body);
  if (!params.success || !body.success) {
    const requestedSize = req.body && typeof req.body === "object" && "size" in req.body
      ? (req.body as { size?: unknown }).size
      : undefined;
    if (typeof requestedSize === "number" && requestedSize > MAX_EDUCATION_GALLERY_IMAGE_BYTES) {
      res.status(413).json({ error: "Fotografija ne može biti veća od 8 MB." });
      return;
    }
    res.status(400).json({ error: "Podaci za fotografiju nisu ispravni." });
    return;
  }
  const course = await requireOwnedEducationCenterCourse(access, params.data.courseId, res);
  if (!course) return;
  if (!CATEGORY_IMAGE_CONTENT_TYPES.has(body.data.contentType.toLowerCase())) {
    res.status(400).json({ error: "Dozvoljene su JPG, PNG, WEBP i GIF slike." });
    return;
  }
  const mediaId = randomUUID();
  try {
    const stagingStoragePath = educationMediaStagingStoragePath(course.centerId!, course.id, mediaId);
    const uploadUrl = await signPrivateObject(educationMediaStagingObjectPath(course.centerId!, course.id, mediaId), "PUT", 900);
    await db.insert(educationMediaUploadsTable).values({
      id: mediaId,
      courseId: course.id,
      centerId: course.centerId!,
      objectPath: stagingStoragePath,
      contentType: body.data.contentType.toLowerCase(),
      size: body.data.size,
      expiresAt: new Date(Date.now() + 900_000),
    });
    res.json(RequestEducationCourseGalleryUploadResponse.parse({
      uploadUrl,
      mediaId,
      imageUrl: educationMediaRouteUrl(mediaId),
    }));
  } catch (error) {
    req.log.error({ err: error }, "Could not create education gallery upload URL");
    res.status(500).json({ error: "Nije moguće pripremiti upload fotografije." });
  }
});

router.get("/education/media/:mediaId", async (req, res): Promise<void> => {
  const mediaId = String(req.params.mediaId ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mediaId)) {
    res.status(404).json({ error: "Fotografija nije pronađena." });
    return;
  }
  const [media] = await db.select().from(educationMediaTable).where(eq(educationMediaTable.id, mediaId)).limit(1);
  if (!media) {
    res.status(404).json({ error: "Fotografija nije pronađena." });
    return;
  }
  if (media.courseId) {
    const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, media.courseId)).limit(1);
    if (!course) {
      res.status(404).json({ error: "Fotografija nije pronađena." });
      return;
    }
    if (!isManagedEducationGalleryObjectPath(media)) {
      res.status(404).json({ error: "Fotografija nije pronađena." });
      return;
    }
    if (!await isPublicEducationCourse(course)) {
      const access = await requireEducationAccess(req, res);
      if (!access) return;
      if (!isCourseOwner(access, course)) {
        res.status(403).json({ error: "Nemate pristup ovoj fotografiji." });
        return;
      }
    }
  }
  try {
    const signedUrl = await signPrivateObject(privateObjectPathFromStoragePath(media.objectPath), "GET", 300);
    const source = await fetch(signedUrl, { signal: AbortSignal.timeout(30_000) });
    if (!source.ok || !source.body) {
      res.status(404).json({ error: "Fotografija nije pronađena." });
      return;
    }
    const contentType = source.headers.get("content-type");
    const contentLength = source.headers.get("content-length");
    if (contentType) res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Cookie");
    Readable.fromWeb(source.body as ReadableStream<Uint8Array>).pipe(res);
  } catch (error) {
    req.log.error({ err: error, mediaId }, "Could not serve education gallery media");
    res.status(500).json({ error: "Nije moguće prikazati fotografiju." });
  }
});

router.post("/education/courses/:courseId/gallery", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const params = GetEducationCourseParams.safeParse(req.params);
  const body = AddEducationCourseGalleryMediaBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Podaci galerije nisu ispravni." });
    return;
  }
  const course = await requireOwnedEducationCenterCourse(access, params.data.courseId, res);
  if (!course) return;
  const [genericAsset] = await db.select().from(mediaAssetsTable).where(and(
    eq(mediaAssetsTable.id, body.data.mediaId),
    eq(mediaAssetsTable.ownerUserId, access.user.id),
    eq(mediaAssetsTable.scope, "education-gallery"),
    or(isNull(mediaAssetsTable.resourceId), eq(mediaAssetsTable.resourceId, course.id)),
  )).limit(1);
  if (genericAsset) {
    const genericResult = await db.transaction(async (tx) => {
      await lockEducationCourseGallery(tx, course.id);
      if (!await claimMediaReference({
        userId: access.user.id,
        url: stableMediaUrl(genericAsset),
        scope: "education-gallery",
        resourceId: course.id,
        visibility: "education",
      }, tx)) {
        return { kind: "invalid" as const };
      }
      const [existing] = await tx.select().from(educationMediaTable).where(eq(educationMediaTable.id, genericAsset.id)).limit(1);
      if (existing) return { kind: "existing" as const, media: existing };
      const current = await tx.select({ id: educationMediaTable.id }).from(educationMediaTable)
        .where(eq(educationMediaTable.courseId, course.id));
      if (current.length >= 20) return { kind: "full" as const };
      const [media] = await tx.insert(educationMediaTable).values({
        id: genericAsset.id,
        courseId: course.id,
        centerId: course.centerId!,
        objectPath: stableMediaUrl(genericAsset),
        altText: body.data.altText?.trim() ?? "",
        sortOrder: current.length,
      }).returning();
      return { kind: "created" as const, media: media! };
    });
    if (genericResult.kind === "full") {
      res.status(409).json({ error: "Galerija može imati najviše 20 fotografija." });
      return;
    }
    if (genericResult.kind === "invalid") {
      res.status(409).json({ error: "Fotografija je u međuvremenu povezana sa drugim zapisom." });
      return;
    }
    res.status(genericResult.kind === "created" ? 201 : 200).json(AddEducationCourseGalleryMediaResponse.parse({
      id: genericResult.media.id,
      url: publicEducationMediaUrl(genericResult.media),
      altText: genericResult.media.altText,
      sortOrder: genericResult.media.sortOrder,
    }));
    return;
  }
  let result:
    | { kind: "expired" }
    | { kind: "full" }
    | { kind: "invalid" }
    | { kind: "existing" | "created"; media: typeof educationMediaTable.$inferSelect };
  try {
    result = await db.transaction(async (tx) => {
      await lockEducationCourseGallery(tx, course.id);
      const [lockedUpload] = await tx.select().from(educationMediaUploadsTable).where(and(
        eq(educationMediaUploadsTable.id, body.data.mediaId),
        eq(educationMediaUploadsTable.courseId, course.id),
        eq(educationMediaUploadsTable.centerId, course.centerId!),
      )).for("update").limit(1);
      if (!lockedUpload || lockedUpload.expiresAt < new Date()) return { kind: "expired" as const };
      const [existing] = await tx.select().from(educationMediaTable).where(eq(educationMediaTable.id, lockedUpload.id)).limit(1);
      if (existing) return { kind: "existing" as const, media: existing };
      const current = await tx.select({ id: educationMediaTable.id }).from(educationMediaTable)
        .where(eq(educationMediaTable.courseId, course.id));
      if (current.length >= 20) return { kind: "full" as const };
      await lockEducationMediaObject(tx, educationMediaStoragePath(lockedUpload.centerId, lockedUpload.courseId, lockedUpload.id));
      const bytes = await readVerifiedEducationMediaUpload(lockedUpload);
      if (!bytes) return { kind: "invalid" as const };
      const finalStoragePath = await promoteEducationMediaUpload(lockedUpload, bytes);
      const [media] = await tx.insert(educationMediaTable).values({
        id: lockedUpload.id,
        courseId: course.id,
        centerId: course.centerId!,
        objectPath: finalStoragePath,
        altText: body.data.altText?.trim() ?? "",
        sortOrder: current.length,
      }).returning();
      await tx.update(educationMediaUploadsTable).set({ attachedAt: new Date() }).where(eq(educationMediaUploadsTable.id, lockedUpload.id));
      return { kind: "created" as const, media: media! };
    });
  } catch (error) {
    req.log.error({ err: error }, "Could not verify or promote education gallery upload");
    res.status(502).json({ error: "Nije moguće proveriti ili sačuvati otpremljenu fotografiju. Pokušajte ponovo." });
    return;
  }
  if (result.kind === "expired") {
    res.status(400).json({ error: "Upload fotografije je istekao. Izaberite sliku ponovo." });
    return;
  }
  if (result.kind === "full") {
    res.status(409).json({ error: "Galerija može imati najviše 20 fotografija." });
    return;
  }
  if (result.kind === "invalid") {
    res.status(400).json({ error: "Otpremljeni fajl nije ispravna slika ili ne odgovara odabranoj datoteci." });
    return;
  }
  const status = result.kind === "created" ? 201 : 200;
  res.status(status).json(AddEducationCourseGalleryMediaResponse.parse({
    id: result.media.id,
    url: publicEducationMediaUrl(result.media),
    altText: result.media.altText,
    sortOrder: result.media.sortOrder,
  }));
});

router.put("/education/courses/:courseId/gallery", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const params = GetEducationCourseParams.safeParse(req.params);
  const body = ReorderEducationCourseGalleryBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Redosled galerije nije ispravan." });
    return;
  }
  const course = await requireOwnedEducationCenterCourse(access, params.data.courseId, res);
  if (!course) return;
  const reordered = await db.transaction(async (tx) => {
    await lockEducationCourseGallery(tx, course.id);
    const existing = await tx.select().from(educationMediaTable).where(eq(educationMediaTable.courseId, course.id));
    const existingIds = new Set(existing.map((media) => media.id));
    const requestedIds = body.data.items.map((item) => item.mediaId);
    if (requestedIds.length !== existing.length || new Set(requestedIds).size !== requestedIds.length || requestedIds.some((id) => !existingIds.has(id))) return false;
    for (const [sortOrder, item] of body.data.items.entries()) {
      await tx.update(educationMediaTable).set({
        sortOrder,
        ...(item.altText === undefined ? {} : { altText: item.altText.trim() }),
      }).where(and(eq(educationMediaTable.id, item.mediaId), eq(educationMediaTable.courseId, course.id)));
    }
    return true;
  });
  if (!reordered) {
    res.status(400).json({ error: "Redosled mora sadržati sve fotografije kursa tačno jednom." });
    return;
  }
  res.json(ReorderEducationCourseGalleryResponse.parse(await educationMediaViews({ courseId: course.id })));
});

router.delete("/education/courses/:courseId/gallery/:mediaId", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const params = GetEducationCourseParams.safeParse({ courseId: req.params.courseId });
  const mediaId = String(req.params.mediaId ?? "");
  if (!params.success || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mediaId)) {
    res.status(400).json({ error: "Fotografija nije ispravna." });
    return;
  }
  const course = await requireOwnedEducationCenterCourse(access, params.data.courseId, res);
  if (!course) return;
  const deleted = await db.transaction(async (tx) => {
    await lockEducationCourseGallery(tx, course.id);
    const [existing] = await tx.select().from(educationMediaTable).where(and(
      eq(educationMediaTable.id, mediaId),
      eq(educationMediaTable.courseId, course.id),
    )).limit(1);
    if (!existing) return false;
    await lockEducationMediaObject(tx, existing.objectPath);
    const references = await tx.select({ id: educationMediaTable.id }).from(educationMediaTable).where(and(
      eq(educationMediaTable.objectPath, existing.objectPath),
      ne(educationMediaTable.id, existing.id),
    )).limit(1);
    if (!references.length && isManagedEducationMediaObject(existing)) {
      // Keep the row and object in place if storage is temporarily
      // unavailable. A retry can safely treat a prior successful delete as
      // success because deletePrivateObject accepts a 404.
      await deletePrivateObject(existing.objectPath);
    }
    const [removed] = await tx.delete(educationMediaTable).where(and(
      eq(educationMediaTable.id, mediaId),
      eq(educationMediaTable.courseId, course.id),
    )).returning();
    if (!removed) return false;
    const remaining = await tx.select().from(educationMediaTable).where(eq(educationMediaTable.courseId, course.id)).orderBy(asc(educationMediaTable.sortOrder));
    for (const [sortOrder, media] of remaining.entries()) {
      if (media.sortOrder !== sortOrder) await tx.update(educationMediaTable).set({ sortOrder }).where(eq(educationMediaTable.id, media.id));
    }
    return true;
  });
  if (!deleted) {
    res.status(404).json({ error: "Fotografija nije pronađena." });
    return;
  }
  res.status(204).send();
});

router.delete("/education/courses/:courseId", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const parsed = ArchiveEducationCourseParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const course = await requireOwnedCourse(access, parsed.data.courseId, res); if (!course) return;
  await db.update(coursesTable).set({ archived: true, published: false, updatedAt: new Date() }).where(eq(coursesTable.id, course.id));
  void publishCatalogInvalidation(["education-categories"]);
  res.sendStatus(204);
});

function featuredChargeView(charge: typeof educationFeaturedChargesTable.$inferSelect | undefined | null) {
  if (!charge) return null;
  return {
    id: charge.id,
    amount: charge.amount,
    status: charge.status,
    paymentReference: charge.paymentReference,
    activatedAt: charge.activatedAt.toISOString(),
    settledAt: charge.settledAt?.toISOString() ?? null,
  };
}

async function latestFeaturedCharge(courseId: string) {
  const [charge] = await db.select().from(educationFeaturedChargesTable)
    .where(eq(educationFeaturedChargesTable.courseId, courseId))
    .orderBy(desc(educationFeaturedChargesTable.createdAt))
    .limit(1);
  return charge ?? null;
}

router.get("/education/courses/:courseId/featured", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const courseId = String(req.params.courseId ?? "");
  const course = await requireOwnedCourse(access, courseId, res); if (!course) return;
  const settings = await getEducationPlatformSettings();
  const isActive = course.isFeatured && (!course.featuredUntil || course.featuredUntil > new Date());
  res.json({
    courseId: course.id, isFeatured: isActive,
    featuredUntil: course.featuredUntil?.toISOString() ?? null,
    featuredFee: course.featuredFee, featuredCoursePrice: settings.featuredCoursePrice,
    charge: featuredChargeView(await latestFeaturedCharge(course.id)),
  });
});

router.patch("/education/courses/:courseId/featured", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const courseId = String(req.params.courseId ?? "");
  const course = await requireOwnedCourse(access, courseId, res); if (!course) return;
  const active = req.body?.active;
  if (typeof active !== "boolean") { res.status(400).json({ error: "Pošaljite active: true ili false." }); return; }
  const paymentReference = typeof req.body?.paymentReference === "string" && req.body.paymentReference.trim().length > 0
    ? req.body.paymentReference.trim().slice(0, 200)
    : null;
  const settings = await getEducationPlatformSettings();
  // Activating featured placement records an auditable platform charge for the
  // configured fee. A non-zero fee stays "pending" until an administrator confirms
  // the manual payment (mirroring how enrollment escrow settlement works); a zero
  // fee is recorded as paid because there is nothing to collect.
  const { updated, charge } = await db.transaction(async (tx) => {
    let row: typeof coursesTable.$inferSelect;
    let chargeRow: typeof educationFeaturedChargesTable.$inferSelect | null = null;
    if (active) {
      const fee = settings.featuredCoursePrice;
      [row] = await tx.update(coursesTable).set({
        isFeatured: true, featuredActivatedAt: new Date(),
        featuredUntil: null, featuredFee: fee, updatedAt: new Date(),
      }).where(eq(coursesTable.id, course.id)).returning() as [typeof coursesTable.$inferSelect];
      [chargeRow] = await tx.insert(educationFeaturedChargesTable).values({
        courseId: course.id,
        centerId: course.centerId ?? null,
        salonId: course.salonId ?? null,
        amount: fee,
        status: fee > 0 ? "pending" : "paid",
        paymentReference,
        activatedByUserId: access.user.id,
        ...(fee > 0 ? {} : { settledByUserId: access.user.id, settledAt: new Date() }),
        note: fee > 0
          ? "Zahtev za isticanje edukacije — čeka potvrdu uplate."
          : "Isticanje aktivirano bez naknade (platforma trenutno ne naplaćuje isticanje).",
      }).returning() as [typeof educationFeaturedChargesTable.$inferSelect];
    } else {
      [row] = await tx.update(coursesTable).set({
        isFeatured: false, featuredUntil: new Date(), updatedAt: new Date(),
      }).where(eq(coursesTable.id, course.id)).returning() as [typeof coursesTable.$inferSelect];
      // Cancel any still-pending charge when the owner turns featuring off.
      await tx.update(educationFeaturedChargesTable).set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(educationFeaturedChargesTable.courseId, course.id), eq(educationFeaturedChargesTable.status, "pending")));
      chargeRow = await (async () => {
        const [c] = await tx.select().from(educationFeaturedChargesTable)
          .where(eq(educationFeaturedChargesTable.courseId, course.id))
          .orderBy(desc(educationFeaturedChargesTable.createdAt)).limit(1);
        return c ?? null;
      })();
    }
    return { updated: row, charge: chargeRow };
  });
  res.json({
    courseId: updated.id, isFeatured: updated.isFeatured && (!updated.featuredUntil || updated.featuredUntil > new Date()),
    featuredUntil: updated.featuredUntil?.toISOString() ?? null,
    featuredFee: updated.featuredFee, featuredCoursePrice: settings.featuredCoursePrice,
    charge: featuredChargeView(charge),
  });
});

router.patch("/education/courses/:courseId/instructor", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const courseId = String(req.params.courseId ?? "");
  const course = await requireOwnedCourse(access, courseId, res); if (!course) return;
  const rawInstructorId = req.body?.instructorId;
  const instructorId = typeof rawInstructorId === "string" && rawInstructorId.length > 0 ? rawInstructorId : null;
  if (instructorId) {
    const centerId = course.centerId;
    if (!centerId) { res.status(400).json({ error: "Instruktori su dostupni samo za kurseve edukativnih centara." }); return; }
    const [instructor] = await db.select().from(educationInstructorsTable).where(and(eq(educationInstructorsTable.id, instructorId), eq(educationInstructorsTable.centerId, centerId))).limit(1);
    if (!instructor) { res.status(404).json({ error: "Instruktor nije pronađen." }); return; }
    // Associate the course with the instructor PROFILE (always present) instead of
    // the optional linked user account. `instructorId` (a user link) is kept in sync
    // only when the profile has one, so nothing is silently dropped for profiles
    // without a user account.
    const [updated] = await db.update(coursesTable).set({ instructorProfileId: instructor.id, instructorId: instructor.userId ?? null, updatedAt: new Date() }).where(eq(coursesTable.id, course.id)).returning();
    res.json(await educationCourseView(updated!, access));
  } else {
    const [updated] = await db.update(coursesTable).set({ instructorProfileId: null, instructorId: null, updatedAt: new Date() }).where(eq(coursesTable.id, course.id)).returning();
    res.json(await educationCourseView(updated!, access));
  }
});

router.put("/education/courses/:courseId/days", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const [params, body] = [ReplaceEducationCourseDaysParams.safeParse(req.params), ReplaceEducationCourseDaysBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Dnevni program nije ispravan." }); return; }
  const course = await requireOwnedCourse(access, params.data.courseId, res); if (!course) return;
  const uniqueDays = new Set(body.data.days.map((day) => day.dayNumber));
  if (uniqueDays.size !== body.data.days.length) { res.status(400).json({ error: "Svaki dan programa mora imati jedinstveni broj." }); return; }
  await db.transaction(async (tx) => {
    await tx.delete(courseDaysTable).where(eq(courseDaysTable.courseId, course.id));
    await tx.insert(courseDaysTable).values(body.data.days.map((day, index) => ({
      courseId: course.id,
      dayNumber: day.dayNumber,
      title: day.title.trim(),
      description: day.description?.trim() ?? "",
      durationMinutes: day.durationMinutes ?? null,
      sortOrder: index,
    })));
    await tx.update(coursesTable).set({ updatedAt: new Date() }).where(eq(coursesTable.id, course.id));
  });
  const [updated] = await db.select().from(coursesTable).where(eq(coursesTable.id, course.id)).limit(1);
  res.json(calendarDateCourseResponse(ReplaceEducationCourseDaysResponse.parse(await educationCourseView(updated!, access))));
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
  const [paidEnrollment] = access.admin || isCourseOwner(access, course)
    ? []
    : await db.select({ id: courseEnrollmentsTable.id }).from(courseEnrollmentsTable).where(and(
        eq(courseEnrollmentsTable.courseId, course.id),
        eq(courseEnrollmentsTable.purchaserId, access.user.id),
        eq(courseEnrollmentsTable.paymentStatus, "paid"),
        inArray(courseEnrollmentsTable.status, ["active", "completed"]),
      )).limit(1);
  const includeLocation = access.admin || isCourseOwner(access, course) || Boolean(paidEnrollment);
  res.json(ListEducationSessionsResponse.parse(await sessionsForCourse(course.id, includeLocation)));
});

router.post("/education/courses/:courseId/sessions", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const [params, body] = [CreateEducationSessionParams.safeParse(req.params), CreateEducationSessionBody.safeParse(req.body)];
  if (!params.success || !body.success || body.data.endsAt <= body.data.startsAt) { res.status(400).json({ error: "Termin kursa nije ispravan." }); return; }
  const course = await requireOwnedCourse(access, params.data.courseId, res); if (!course) return;
  const createMinimumEnrollments = Number.isInteger(req.body?.minimumEnrollments) && req.body.minimumEnrollments >= 0 ? Number(req.body.minimumEnrollments) : null;
  const [session] = await db.insert(courseSessionsTable).values({ courseId: course.id, startsAt: body.data.startsAt, endsAt: body.data.endsAt, location: body.data.location ?? null, capacity: body.data.capacity, minimumEnrollments: createMinimumEnrollments }).returning();
  res.status(201).json(CreateEducationSessionResponse.parse({ id: session!.id, startsAt: session!.startsAt.toISOString(), endsAt: session!.endsAt.toISOString(), location: session!.location, capacity: session!.capacity, reservedSeats: session!.reservedSeats, availableSeats: session!.capacity, minimumEnrollments: session!.minimumEnrollments, cancelledAt: session!.cancelledAt?.toISOString() ?? null }));
});

router.post("/education/courses/:courseId/enrollments", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  if (!["SALON_OWNER", "CUSTOMER", "STUDENT"].includes(user.role)) {
    res.status(403).json({ error: "Kupovina edukacija je dostupna klijentima i vlasnicima salona." });
    return;
  }
  const [params, body] = [EnrollInEducationCourseParams.safeParse(req.params), EnrollInEducationCourseBody.safeParse(req.body ?? {})];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci prijave nisu ispravni." }); return; }
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, params.data.courseId)).limit(1);
  const access = user.role === "SALON_OWNER" ? await requireEducationAccess(req, res) : null;
  if (user.role === "SALON_OWNER" && !access) return;
  if (!course) { res.status(404).json({ error: "Kurs nije dostupan za prijavu." }); return; }
  const isSalonInternalEnrollment = Boolean(
    access?.salon
    && course.salonId === access.salon.id
    && !course.centerId
    && course.published
    && !course.archived,
  );
  if (!isSalonInternalEnrollment && !(await isPublicEducationCourse(course))) {
    res.status(404).json({ error: "Kurs nije dostupan za prijavu." });
    return;
  }
  let employee: typeof employeesTable.$inferSelect | null = null;
  if (body.data.employeeId) {
    if (!access?.salon) { res.status(403).json({ error: "Zaposlenog možete prijaviti samo preko salona." }); return; }
    employee = await employeeInSalon(body.data.employeeId, access.salon.id);
    if (!employee) { res.status(403).json({ error: "Izabrani zaposleni ne pripada vašem salonu." }); return; }
  }
  const idempotencyKey = req.get("idempotency-key")?.trim() || null;
  if (idempotencyKey && idempotencyKey.length > 200) { res.status(400).json({ error: "Idempotency ključ je predugačak." }); return; }
  const requestedSessionId = typeof req.body?.sessionId === "string" && /^[0-9a-f-]{36}$/i.test(req.body.sessionId) ? req.body.sessionId : null;
  const idempotencyFingerprint = `${course.id}:${employee?.id ?? "purchaser"}:${access?.salon?.id ?? "direct"}:${requestedSessionId ?? "auto"}`;
  if (idempotencyKey) {
    const [replayed] = await db.select().from(courseEnrollmentsTable)
      .where(and(eq(courseEnrollmentsTable.purchaserId, user.id), eq(courseEnrollmentsTable.idempotencyKey, idempotencyKey))).limit(1);
    if (replayed) {
      if (replayed.courseId !== course.id || replayed.idempotencyFingerprint !== idempotencyFingerprint) {
        res.status(409).json({ error: "Idempotency ključ je već upotrebljen za drugu kupovinu." });
        return;
      }
      res.status(201).json(EnrollInEducationCourseResponse.parse(await educationEnrollmentView(replayed)));
      return;
    }
  }
  if (isSalonInternalEnrollment) {
    const firstLesson = (await modulesForCourse(course.id)).flatMap((module) => module.lessons)[0];
    let enrollment: typeof courseEnrollmentsTable.$inferSelect | null;
    try {
      enrollment = await db.transaction(async (tx) => {
        const sessions = await tx.select().from(courseSessionsTable)
          .where(eq(courseSessionsTable.courseId, course.id))
          .orderBy(asc(courseSessionsTable.startsAt))
          .for("update");
        const session = sessions.find((item) => item.reservedSeats < item.capacity);
        if (course.format !== "online" && !session) return null;
        const [created] = await tx.insert(courseEnrollmentsTable).values({
          courseId: course.id,
          userId: user.id,
          salonId: access!.salon!.id,
          employeeId: employee?.id ?? null,
          purchaserId: user.id,
          status: "active",
          paymentStatus: "paid",
          chargedAmount: course.price,
          nextLesson: firstLesson?.id ?? null,
          accessGrantedAt: new Date(),
          auditData: { source: "business-workspace", sessionId: session?.id ?? null, idempotencyKey },
          idempotencyKey,
          idempotencyFingerprint: idempotencyKey ? idempotencyFingerprint : null,
        }).returning();
        if (session) {
          await tx.update(courseSessionsTable)
            .set({ reservedSeats: session.reservedSeats + 1 })
            .where(eq(courseSessionsTable.id, session.id));
        }
        return created!;
      });
    } catch (error) {
      const errorCode = typeof error === "object" && error
        ? (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code
        : undefined;
      if (errorCode === "23505") {
        res.status(409).json({ error: "Ovaj polaznik je već prijavljen na kurs." });
        return;
      }
      throw error;
    }
    if (!enrollment) {
      res.status(409).json({ error: "Nema slobodnih mesta u narednim terminima." });
      return;
    }
    await sendTransactionalEmail({
      eventKey: `course-enrollment:${enrollment.id}:confirmed`,
      emailType: "course_enrollment_confirmed",
      to: { email: user.email, name: `${user.firstName} ${user.lastName}` },
      subject: "LUMERA Edukacije — prijava je potvrđena",
      htmlContent: lumeraEmailHtml("Prijava na edukaciju je potvrđena", `<p>Uspešno ste prijavljeni na kurs <strong>${emailSafe(course.title)}</strong>.</p>`),
      metadata: { enrollmentId: enrollment.id, courseId: course.id },
    });
    res.status(201).json(EnrollInEducationCourseResponse.parse(await educationEnrollmentView(enrollment)));
    return;
  }
  let enrollment: typeof courseEnrollmentsTable.$inferSelect | null;
  try {
    enrollment = await db.transaction(async (tx) => {
      // Public enrollments and center verification changes must share the
      // center lock. Recheck eligibility after acquiring it so a revocation
      // that commits first cannot be followed by a pending purchase.
      if (course.centerId) {
        await lockEducationCenterFinancials(tx, course.centerId);
        const [currentCenter] = await tx.select().from(educationCentersTable)
          .where(eq(educationCentersTable.id, course.centerId))
          .for("update")
          .limit(1);
        const [subscription] = await tx.select().from(educationCenterSubscriptionsTable)
          .where(eq(educationCenterSubscriptionsTable.centerId, course.centerId))
          .for("update")
          .limit(1);
        if (currentCenter?.verificationStatus !== "verified" || !hasActiveEducationSubscription(subscription?.status)) {
          return null;
        }
      }
      if (requestedSessionId) {
        const [requestedSession] = await tx.select().from(courseSessionsTable)
          .where(and(eq(courseSessionsTable.id, requestedSessionId), eq(courseSessionsTable.courseId, course.id)))
          .for("update").limit(1);
        if (!requestedSession || requestedSession.startsAt <= new Date() || requestedSession.cancelledAt) {
          throw new Error("Izabrani termin nije dostupan za ovaj kurs.");
        }
      }
      const [created] = await tx.insert(courseEnrollmentsTable).values({
        courseId: course.id,
        userId: user.id,
        salonId: access?.salon?.id ?? null,
        employeeId: employee?.id ?? null,
        purchaserId: user.id,
        status: "pending",
        paymentStatus: "pending",
        chargedAmount: course.price,
        sessionId: requestedSessionId,
        auditData: { source: "education-marketplace", idempotencyKey, requestedSessionId },
        idempotencyKey,
        idempotencyFingerprint: idempotencyKey ? idempotencyFingerprint : null,
      }).returning();
      return created!;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kupovina nije uspela.";
    const errorCode = typeof error === "object" && error
      ? (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code
      : undefined;
    if (errorCode === "23505" && idempotencyKey) {
      const [replayed] = await db.select().from(courseEnrollmentsTable)
        .where(and(eq(courseEnrollmentsTable.purchaserId, user.id), eq(courseEnrollmentsTable.idempotencyKey, idempotencyKey))).limit(1);
      if (replayed && replayed.courseId === course.id && replayed.idempotencyFingerprint === idempotencyFingerprint) {
        res.status(201).json(EnrollInEducationCourseResponse.parse(await educationEnrollmentView(replayed)));
        return;
      }
    }
    if (errorCode === "23505") { res.status(409).json({ error: "Ovaj polaznik je već prijavljen na kurs." }); return; }
    throw error;
  }
  if (!enrollment) {
    res.status(404).json({ error: "Kurs nije dostupan za prijavu." });
    return;
  }
  await sendTransactionalEmail({
    eventKey: `course-enrollment:${enrollment.id}:requested`,
    emailType: "course_enrollment_requested",
    to: { email: user.email, name: `${user.firstName} ${user.lastName}` },
    subject: "LUMERA Edukacije — zahtev je primljen",
    htmlContent: lumeraEmailHtml("Zahtev za edukaciju je primljen", `<p>Primili smo zahtev za kurs <strong>${emailSafe(course.title)}</strong>.</p><p>Pristup sadržaju i detaljima termina aktivira se tek nakon ručne potvrde uplate.</p>`),
    metadata: { enrollmentId: enrollment.id, courseId: course.id },
  });
  res.status(201).json(EnrollInEducationCourseResponse.parse(await educationEnrollmentView(enrollment)));
});

// Waitlists are deliberately session-scoped: a place on one date is never a
// promise for another date.  The session row lock serializes both capacity
// changes and the position allocation.
router.post("/education/courses/:courseId/sessions/:sessionId/waitlist", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  if (!["CUSTOMER", "STUDENT", "SALON_OWNER"].includes(user.role)) {
    res.status(403).json({ error: "Lista čekanja je dostupna samo polaznicima i salonima." }); return;
  }
  const courseId = String(req.params.courseId ?? "");
  const sessionId = String(req.params.sessionId ?? "");
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, courseId)).limit(1);
  if (!course || !(await isPublicEducationCourse(course)) || course.format === "online") {
    res.status(404).json({ error: "Termin nije dostupan za listu čekanja." }); return;
  }
  try {
    const waitlist = await db.transaction(async (tx) => {
      if (!course.centerId) throw new Error("Kurs nije dostupan za listu čekanja.");
      await lockEducationCenterFinancials(tx, course.centerId);
      const [center] = await tx.select().from(educationCentersTable).where(eq(educationCentersTable.id, course.centerId)).for("update").limit(1);
      const [subscription] = await tx.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, course.centerId)).for("update").limit(1);
      const [lockedCourse] = await tx.select().from(coursesTable).where(eq(coursesTable.id, course.id)).for("update").limit(1);
      if (!lockedCourse?.published || lockedCourse.archived || center?.verificationStatus !== "verified" || !hasActiveEducationSubscription(subscription?.status)) {
        throw new Error("Kurs više nije dostupan za listu čekanja.");
      }
      const [session] = await tx.select().from(courseSessionsTable)
        .where(and(eq(courseSessionsTable.id, sessionId), eq(courseSessionsTable.courseId, course.id)))
        .for("update").limit(1);
      if (!session || session.startsAt <= new Date()) throw new Error("Termin nije dostupan.");
      if (session.reservedSeats < session.capacity) throw new Error("Termin još ima slobodnih mesta. Pošaljite zahtev za kupovinu.");
      const active = await tx.select().from(educationWaitlistTable)
        .where(and(eq(educationWaitlistTable.sessionId, session.id), inArray(educationWaitlistTable.status, ["waiting", "offered"])))
        .orderBy(asc(educationWaitlistTable.position)).for("update");
      if (active.some((entry) => entry.userId === user.id)) throw new Error("Već ste na listi čekanja za ovaj termin.");
      const [created] = await tx.insert(educationWaitlistTable).values({
        sessionId: session.id, courseId: course.id, userId: user.id, purchaserId: user.id, position: (active.at(-1)?.position ?? 0) + 1,
      }).returning();
      await tx.insert(educationNotificationsTable).values({
        userId: user.id, waitlistId: created!.id, type: "waitlist_joined", title: "Dodati ste na listu čekanja",
        body: `Sačuvaćemo vam mesto u redu za kurs „${course.title}“.`, eventKey: `education-waitlist:${created!.id}:joined`,
        actionUrl: `/edukacije/${course.id}`,
      });
      return created!;
    });
    res.status(201).json({ id: waitlist.id, status: waitlist.status, position: waitlist.position });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Dodavanje na listu čekanja nije uspelo." });
  }
});

// Accept an active (offered, unexpired) waitlist offer. Under the center lock we
// re-check the offer, reserve exactly one seat, associate or create the
// purchaser's enrollment safely, and flip the waitlist entry to "enrolled".
// Access is still granted only after the admin confirms payment, so the
// enrollment is created in the pending/pending state like a normal request.
router.post("/education/waitlist/:waitlistId/accept", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  if (!["CUSTOMER", "STUDENT", "SALON_OWNER"].includes(user.role)) {
    res.status(403).json({ error: "Lista čekanja je dostupna samo polaznicima i salonima." }); return;
  }
  const waitlistId = String(req.params.waitlistId ?? "");
  const [entryPreview] = await db.select().from(educationWaitlistTable).where(eq(educationWaitlistTable.id, waitlistId)).limit(1);
  if (!entryPreview || entryPreview.userId !== user.id) { res.status(404).json({ error: "Ponuda sa liste čekanja nije pronađena." }); return; }
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, entryPreview.courseId)).limit(1);
  if (!course || !course.centerId) { res.status(404).json({ error: "Kurs nije dostupan." }); return; }
  let enrollmentId: string;
  try {
    enrollmentId = await db.transaction(async (tx) => {
      await lockEducationCenterFinancials(tx, course.centerId!);
      const [center] = await tx.select().from(educationCentersTable).where(eq(educationCentersTable.id, course.centerId!)).for("update").limit(1);
      const [subscription] = await tx.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, course.centerId!)).for("update").limit(1);
      const [lockedCourse] = await tx.select().from(coursesTable).where(eq(coursesTable.id, course.id)).for("update").limit(1);
      if (!lockedCourse?.published || lockedCourse.archived || center?.verificationStatus !== "verified" || !hasActiveEducationSubscription(subscription?.status)) {
        throw new Error("Kurs više nije dostupan.");
      }
      // Re-read the waitlist entry under lock and validate the offer.
      const [entry] = await tx.select().from(educationWaitlistTable)
        .where(eq(educationWaitlistTable.id, waitlistId)).for("update").limit(1);
      if (!entry || entry.userId !== user.id) throw new Error("Ponuda sa liste čekanja nije pronađena.");
      if (entry.status === "enrolled") throw new Error("Ponuda je već iskorišćena.");
      if (entry.status !== "offered") throw new Error("Ova ponuda više nije aktivna.");
      if (!entry.expiresAt || entry.expiresAt <= new Date()) throw new Error("Ponuda sa liste čekanja je istekla.");

      // Lock the session. An "offered" entry already HOLDS one reserved seat
      // for its 24-hour window (see promoteNextWaitlistEntry), so accepting the
      // offer must NOT reserve a second seat — the held seat simply transfers to
      // this enrollment as the offer flips to "enrolled".
      const [session] = await tx.select().from(courseSessionsTable)
        .where(and(eq(courseSessionsTable.id, entry.sessionId), eq(courseSessionsTable.courseId, course.id)))
        .for("update").limit(1);
      if (!session || session.cancelledAt) throw new Error("Termin nije dostupan.");
      if (session.startsAt <= new Date()) throw new Error("Termin je već započeo.");

      // Reuse only this purchaser's pending request for the offered session.
      // An active enrollment in another session must never be repointed.
      // create a fresh pending one. The uniqueness index guards duplicates.
      const [existing] = await tx.select().from(courseEnrollmentsTable)
        .where(and(
          eq(courseEnrollmentsTable.courseId, course.id),
          eq(courseEnrollmentsTable.purchaserId, user.id),
          eq(courseEnrollmentsTable.status, "pending"),
          eq(courseEnrollmentsTable.paymentStatus, "pending"),
          eq(courseEnrollmentsTable.sessionId, entry.sessionId),
        )).for("update").limit(1);
      if (existing) {
        await tx.update(courseEnrollmentsTable)
          .set({ employeeId: entry.employeeId ?? existing.employeeId, auditData: { ...existing.auditData, seatReserved: true, waitlistId: entry.id }, updatedAt: new Date() })
          .where(eq(courseEnrollmentsTable.id, existing.id));
        await tx.update(educationWaitlistTable)
          .set({ status: "enrolled", updatedAt: new Date() })
          .where(and(eq(educationWaitlistTable.id, entry.id), eq(educationWaitlistTable.status, "offered")));
        return existing.id;
      }
      const [created] = await tx.insert(courseEnrollmentsTable).values({
        courseId: course.id,
        userId: user.id,
        salonId: null,
        employeeId: entry.employeeId ?? null,
        purchaserId: user.id,
        sessionId: entry.sessionId,
        status: "pending",
        paymentStatus: "pending",
        chargedAmount: course.price,
        auditData: { source: "education-waitlist-accept", waitlistId: entry.id, sessionId: entry.sessionId, seatReserved: true },
      }).returning();
      await tx.update(educationWaitlistTable)
        .set({ status: "enrolled", updatedAt: new Date() })
        .where(and(eq(educationWaitlistTable.id, entry.id), eq(educationWaitlistTable.status, "offered")));
      await tx.insert(educationNotificationsTable).values({
        userId: user.id, waitlistId: entry.id, enrollmentId: created!.id, type: "waitlist_enrolled",
        title: "Prihvatili ste mesto", body: `Vaše mesto na kursu „${course.title}“ je rezervisano. Pristup se aktivira nakon potvrde uplate.`,
        eventKey: `education-waitlist:${entry.id}:enrolled`, actionUrl: `/edukacije/${course.id}`,
      }).onConflictDoNothing();
      return created!.id;
    });
  } catch (error) {
    const errorCode = typeof error === "object" && error
      ? (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code
      : undefined;
    if (errorCode === "23505") { res.status(409).json({ error: "Već ste prijavljeni na ovaj kurs." }); return; }
    res.status(409).json({ error: error instanceof Error ? error.message : "Prihvatanje ponude nije uspelo." });
    return;
  }
  const [enrollment] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, enrollmentId)).limit(1);
  await sendTransactionalEmail({
    eventKey: `course-enrollment:${enrollmentId}:waitlist-accepted`,
    emailType: "course_enrollment_requested",
    to: { email: user.email, name: `${user.firstName} ${user.lastName}` },
    subject: "LUMERA Edukacije — mesto sa liste čekanja je rezervisano",
    htmlContent: lumeraEmailHtml("Mesto sa liste čekanja je rezervisano", `<p>Prihvatili ste ponudu za kurs <strong>${emailSafe(course.title)}</strong>.</p><p>Pristup sadržaju i detaljima termina aktivira se tek nakon ručne potvrde uplate.</p>`),
    metadata: { enrollmentId, courseId: course.id, waitlistId },
  }).catch(() => undefined);
  res.status(201).json(EnrollInEducationCourseResponse.parse(await educationEnrollmentView(enrollment!)));
});

router.get("/education/notifications", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  if (user.role !== "STUDENT" && user.role !== "CUSTOMER") { res.status(403).json({ error: "Obaveštenja su privatna za polaznika." }); return; }
  const notificationRows = await db.select().from(educationNotificationsTable)
    .where(eq(educationNotificationsTable.userId, user.id)).orderBy(desc(educationNotificationsTable.createdAt)).limit(100);
  // Active (offered, unexpired) waitlist offers surface an accept CTA. Each
  // active offer holds a reserved seat for its 24-hour window.
  const offerRows = await db.select({
    id: educationWaitlistTable.id,
    courseId: educationWaitlistTable.courseId,
    courseTitle: coursesTable.title,
    sessionId: educationWaitlistTable.sessionId,
    sessionStartsAt: courseSessionsTable.startsAt,
    status: educationWaitlistTable.status,
    position: educationWaitlistTable.position,
    offeredAt: educationWaitlistTable.offeredAt,
    expiresAt: educationWaitlistTable.expiresAt,
  })
    .from(educationWaitlistTable)
    .innerJoin(coursesTable, eq(educationWaitlistTable.courseId, coursesTable.id))
    .leftJoin(courseSessionsTable, eq(educationWaitlistTable.sessionId, courseSessionsTable.id))
    .where(and(
      eq(educationWaitlistTable.userId, user.id),
      eq(educationWaitlistTable.status, "offered"),
      gte(educationWaitlistTable.expiresAt, new Date()),
    ))
    .orderBy(asc(educationWaitlistTable.expiresAt));
  res.json(ListEducationNotificationsResponse.parse({
    notifications: notificationRows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      actionUrl: row.actionUrl,
      enrollmentId: row.enrollmentId,
      waitlistId: row.waitlistId,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    offers: offerRows.map((row) => ({
      id: row.id,
      courseId: row.courseId,
      courseTitle: row.courseTitle ?? "Kurs",
      sessionId: row.sessionId,
      sessionStartsAt: row.sessionStartsAt?.toISOString() ?? null,
      status: row.status,
      position: row.position,
      offeredAt: row.offeredAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
    })),
  }));
});

router.patch("/education/notifications/:notificationId/read", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const [updated] = await db.update(educationNotificationsTable).set({ readAt: new Date() })
    .where(and(eq(educationNotificationsTable.id, String(req.params.notificationId ?? "")), eq(educationNotificationsTable.userId, user.id))).returning();
  if (!updated) { res.status(404).json({ error: "Obaveštenje nije pronađeno." }); return; }
  res.json(MarkEducationNotificationReadResponse.parse({ ok: true }));
});

router.post("/admin/education/enrollments/:enrollmentId/settle", async (req, res): Promise<void> => {
  const admin = await requireAdmin(req, res); if (!admin) return;
  const enrollmentId = String(req.params.enrollmentId);
  const [preview] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, enrollmentId)).limit(1);
  if (!preview) { res.status(404).json({ error: "Zahtev za kupovinu nije pronađen." }); return; }
  const [coursePreview] = await db.select().from(coursesTable).where(eq(coursesTable.id, preview.courseId)).limit(1);
  if (!coursePreview?.centerId || !(await isPublicEducationCourse(coursePreview))) {
    res.status(409).json({ error: "Kurs više nije podoban za zaštićenu potvrdu kupovine." }); return;
  }
  let settled: typeof courseEnrollmentsTable.$inferSelect;
  try {
    settled = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`education-center:${coursePreview.centerId}`}))`);
      const [enrollment] = await tx.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, enrollmentId)).for("update").limit(1);
      if (!enrollment || enrollment.status !== "pending" || enrollment.paymentStatus !== "pending") throw new Error("Ovaj zahtev je već obrađen.");
      const [course] = await tx.select().from(coursesTable).where(eq(coursesTable.id, enrollment.courseId)).for("update").limit(1);
      if (!course?.centerId) throw new Error("Kurs nema verifikovanog izdavača.");
      const [center] = await tx.select().from(educationCentersTable)
        .where(eq(educationCentersTable.id, course.centerId))
        .for("update")
        .limit(1);
      const [subscription] = await tx.select().from(educationCenterSubscriptionsTable)
        .where(eq(educationCenterSubscriptionsTable.centerId, course.centerId))
        .for("update")
        .limit(1);
      if (center?.verificationStatus !== "verified" || !hasActiveEducationSubscription(subscription?.status)) {
        throw new Error("Centar više nije verifikovan ili nema aktivnu pretplatu.");
      }
      let session: typeof courseSessionsTable.$inferSelect | null = null;
      if (course.format !== "online") {
        const sessions = await tx.select().from(courseSessionsTable).where(eq(courseSessionsTable.courseId, course.id)).orderBy(asc(courseSessionsTable.startsAt)).for("update");
        const seatAlreadyReserved = Boolean((enrollment.auditData as { seatReserved?: boolean } | null)?.seatReserved);
        session = enrollment.sessionId
          ? sessions.find((item) => item.id === enrollment.sessionId && (seatAlreadyReserved || item.reservedSeats < item.capacity) && item.endsAt > new Date()) ?? null
          : sessions.find((item) => item.reservedSeats < item.capacity && item.endsAt > new Date()) ?? null;
        if (!session) throw new Error("Nema slobodnih mesta u narednim terminima.");
        if (!seatAlreadyReserved) await tx.update(courseSessionsTable).set({ reservedSeats: session.reservedSeats + 1 }).where(eq(courseSessionsTable.id, session.id));
      }
      const firstLesson = (await modulesForCourse(course.id)).flatMap((module) => module.lessons)[0];
      const [confirmed] = await tx.update(courseEnrollmentsTable).set({
        status: "active", paymentStatus: "paid", accessGrantedAt: new Date(), nextLesson: firstLesson?.id ?? null, sessionId: session?.id ?? null,
        auditData: { ...enrollment.auditData, settlement: "admin_confirmed", settledBy: admin.id, sessionId: session?.id ?? null, seatReserved: Boolean(session) },
        updatedAt: new Date(),
      }).where(and(eq(courseEnrollmentsTable.id, enrollment.id), eq(courseEnrollmentsTable.status, "pending"), eq(courseEnrollmentsTable.paymentStatus, "pending"))).returning();
      if (!confirmed) throw new Error("Zahtev je izmenjen u drugoj operaciji.");
      const settings = await getEducationPlatformSettings();
      // Charge the amount captured at request time (group discount survives here);
      // fall back to the current course price for legacy rows without it.
      const grossAmount = confirmed.chargedAmount ?? course.price;
      const platformFee = Math.floor(grossAmount * settings.commissionPercent / 100);
      const reserveAmount = Math.floor(grossAmount * settings.reservePercent / 100);
      const netAmount = grossAmount - platformFee - reserveAmount;
      const releaseAt = await releaseAtForEducationCourse(course, settings, session);
      const [escrow] = await tx.insert(educationEscrowsTable).values({
        enrollmentId: confirmed.id, centerId: course.centerId, grossAmount, platformFee, reserveAmount, netAmount, releaseAt,
        paymentReference: `manual-settlement:${confirmed.id}`,
      }).returning();
      await tx.insert(educationLedgerEntriesTable).values([
        { escrowId: escrow!.id, enrollmentId: confirmed.id, centerId: course.centerId, type: "charge", amount: grossAmount, note: "Ručno potvrđena kupovina edukacije.", actorUserId: admin.id, idempotencyKey: confirmed.idempotencyKey },
        { escrowId: escrow!.id, enrollmentId: confirmed.id, centerId: course.centerId, type: "platform_fee", amount: -platformFee, note: "Platformska provizija.", actorUserId: admin.id },
        { escrowId: escrow!.id, enrollmentId: confirmed.id, centerId: course.centerId, type: "reserve_hold", amount: -reserveAmount, note: "Zadržana rezerva.", actorUserId: admin.id },
      ]);
      await tx.insert(educationFinancialEventsTable).values({
        escrowId: escrow!.id, enrollmentId: confirmed.id, actorUserId: admin.id, eventType: "purchase_settled_manual", nextStatus: "held", amount: grossAmount,
        metadata: { releaseAt: releaseAt.toISOString(), commissionPercent: settings.commissionPercent, reservePercent: settings.reservePercent, chargedAmount: grossAmount },
      });
      await tx.insert(educationThreadsTable).values({ enrollmentId: confirmed.id, purchaserId: confirmed.purchaserId, centerId: course.centerId });
      return confirmed;
    });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Potvrda uplate nije uspela." });
    return;
  }
  const [purchaser] = await db.select().from(usersTable).where(eq(usersTable.id, settled.purchaserId)).limit(1);
  await sendTransactionalEmail({
    eventKey: `course-enrollment:${settled.id}:settled`, emailType: "course_enrollment_confirmed",
    to: { email: purchaser?.email ?? "", name: `${purchaser?.firstName ?? "LUMERA"} ${purchaser?.lastName ?? "korisnik"}` },
    subject: "LUMERA Edukacije — kupovina je potvrđena",
    htmlContent: lumeraEmailHtml("Kupovina edukacije je potvrđena", `<p>Uplata je ručno potvrđena. Sada imate pristup sadržaju kursa i zaštićenim detaljima termina.</p>`),
    metadata: { enrollmentId: settled.id, courseId: settled.courseId },
  });
  res.json(EnrollInEducationCourseResponse.parse(await educationEnrollmentView(settled)));
});

router.patch("/education/sessions/:sessionId", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const [params, body] = [UpdateEducationSessionParams.safeParse(req.params), UpdateEducationSessionBody.safeParse(req.body)];
  if (!params.success || !body.success || body.data.endsAt <= body.data.startsAt) { res.status(400).json({ error: "Termin kursa nije ispravan." }); return; }
  const [session] = await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, params.data.sessionId)).limit(1);
  if (!session || !(await requireOwnedCourse(access, session.courseId, res))) return;
  if (body.data.capacity < session.reservedSeats) { res.status(409).json({ error: "Kapacitet ne može biti manji od postojećih rezervacija." }); return; }
  const updateMinimumEnrollments = Number.isInteger(req.body?.minimumEnrollments) && req.body.minimumEnrollments >= 0 ? Number(req.body.minimumEnrollments) : null;
  const [updated] = await db.update(courseSessionsTable).set({
    startsAt: body.data.startsAt,
    endsAt: body.data.endsAt,
    location: body.data.location ?? null,
    capacity: body.data.capacity,
    minimumEnrollments: updateMinimumEnrollments,
  }).where(eq(courseSessionsTable.id, session.id)).returning();
  res.json(UpdateEducationSessionResponse.parse({
    id: updated!.id,
    startsAt: updated!.startsAt.toISOString(),
    endsAt: updated!.endsAt.toISOString(),
    location: updated!.location,
    capacity: updated!.capacity,
    reservedSeats: updated!.reservedSeats,
    availableSeats: Math.max(0, updated!.capacity - updated!.reservedSeats),
    minimumEnrollments: updated!.minimumEnrollments,
    cancelledAt: updated!.cancelledAt?.toISOString() ?? null,
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

// Cancel a live session with full escrow refund, waitlist cleanup and notifications.
// Owner/center access only. Admins use the /admin/education/sessions/:sessionId/cancel route.
router.post("/education/sessions/:sessionId/cancel", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  if (access.admin) { res.status(403).json({ error: "Administratori koriste admin rutu za otkazivanje termina." }); return; }
  const sessionId = String(req.params.sessionId ?? "");
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
  if (!reason) { res.status(400).json({ error: "Unesite razlog otkazivanja termina." }); return; }
  const [session] = await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, sessionId)).limit(1);
  if (!session) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  if (!(await requireOwnedCourse(access, session.courseId, res))) return;
  if (session.cancelledAt) { res.status(409).json({ error: "Termin je već otkazan." }); return; }
  try {
    const result = await cancelEducationSession(sessionId, access.user.id, reason);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Otkazivanje termina nije uspelo." });
  }
});

// Cancel a single enrollment (purchaser, owning center/salon, or admin). This
// is the one place that releases the reserved seat and promotes exactly one
// waiter — it delegates to the centralized cancel/refund helper so the seat
// accounting and waitlist stay consistent under concurrency.
router.post("/education/enrollments/:enrollmentId/cancel", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const enrollmentId = String(req.params.enrollmentId ?? "");
  const access = await enrollmentAccessForUser(user, enrollmentId);
  if (!access.enrollment) { res.status(404).json({ error: "Prijava nije pronađena." }); return; }
  // Purchaser, owning center, or admin may cancel. (canParticipate covers all three.)
  if (!access.canParticipate) { res.status(403).json({ error: "Nemate pravo otkazivanja ove prijave." }); return; }
  if (access.enrollment.status === "cancelled") { res.status(409).json({ error: "Prijava je već otkazana." }); return; }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "Otkazivanje prijave.";
  try {
    const result = await cancelEducationEnrollment({ enrollmentId, actorUserId: user.id, reason });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Otkazivanje prijave nije uspelo." });
  }
});

router.get("/education/enrollments", async (req, res): Promise<void> => {
  const lmsAccess = await requireLmsAccess(req, res); if (!lmsAccess) return;
  // Build the access predicate in SQL so we never full-scan course_enrollments or
  // courses: the DB filters to the rows this caller may see, orders them stably,
  // and only the paginated slice is loaded before batch assembly.
  const { access, learnerEmployeeId } = lmsAccess;
  let accessPredicate;
  if (learnerEmployeeId) {
    // Salon employee learner: only their own enrolled seats.
    accessPredicate = eq(courseEnrollmentsTable.employeeId, learnerEmployeeId);
  } else if (access.admin) {
    // Admin sees every enrollment.
    accessPredicate = sql`true`;
  } else {
    // Purchaser OR owner of the course's salon/center. The ownership branch is
    // an EXISTS subquery keyed on the course, using the courses_salon_idx /
    // courses_center_published_idx indexes — no course table scan.
    const ownedPredicates = [];
    if (access.salon) ownedPredicates.push(eq(coursesTable.salonId, access.salon.id));
    if (access.centers.length) ownedPredicates.push(inArray(coursesTable.centerId, access.centers.map((center) => center.id)));
    const purchaserPredicate = eq(courseEnrollmentsTable.purchaserId, access.user.id);
    accessPredicate = ownedPredicates.length
      ? or(
          purchaserPredicate,
          sql`exists (select 1 from ${coursesTable} where ${coursesTable.id} = ${courseEnrollmentsTable.courseId} and ${or(...ownedPredicates)})`,
        )
      : purchaserPredicate;
  }
  const { limit, offset } = parsePagination(req.query, 50);
  const enrollments = await db.select().from(courseEnrollmentsTable)
    .where(accessPredicate)
    .orderBy(desc(courseEnrollmentsTable.purchasedAt), desc(courseEnrollmentsTable.id))
    .limit(limit)
    .offset(offset);
  res.json(ListEnrollmentsResponse.parse(await batchEducationEnrollmentViews(enrollments)));
});

router.get("/education/enrollments/:enrollmentId/lms", async (req, res): Promise<void> => {
  const lmsAccess = await requireLmsAccess(req, res); if (!lmsAccess) return;
  const parsed = GetEducationLmsParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [enrollment] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, parsed.data.enrollmentId)).limit(1);
  if (!enrollment) { res.status(403).json({ error: "Nemate pristup ovom LMS sadržaju." }); return; }
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, enrollment.courseId)).limit(1);
  if (!course) { res.status(404).json({ error: "Kurs nije pronađen." }); return; }
  const assignedEmployee = Boolean(
    enrollment.employeeId
    && lmsAccess.learnerEmployeeId
    && enrollment.employeeId === lmsAccess.learnerEmployeeId,
  );
  if (!lmsAccess.access.admin && enrollment.purchaserId !== lmsAccess.access.user.id && !assignedEmployee && !isCourseOwner(lmsAccess.access, course)) {
    res.status(403).json({ error: "Nemate pristup ovom LMS sadržaju." });
    return;
  }
  if (!lmsAccess.access.admin && (enrollment.status !== "active" && enrollment.status !== "completed" || enrollment.paymentStatus !== "paid")) {
    res.status(403).json({ error: "Pristup kursu se aktivira tek nakon potvrđene uplate." });
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
  const assignedEmployee = Boolean(
    enrollment[0]?.employeeId
    && lmsAccess.learnerEmployeeId
    && enrollment[0].employeeId === lmsAccess.learnerEmployeeId,
  );
  if (!enrollment[0] || (enrollment[0].purchaserId !== lmsAccess.access.user.id && !assignedEmployee) || enrollment[0].status !== "active") { res.status(403).json({ error: "Nemate pravo izmene ovog napretka." }); return; }
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

/**
 * Returns all publicly visible courses, optionally narrowed by SQL predicates.
 * Scalar filter predicates should be passed in so they are pushed to the DB
 * rather than applied in JS after a full-table load. Center eligibility
 * (verification + active subscription) is enforced in SQL via EXISTS so it
 * applies *before* the bound and never truncates matching older rows.
 * Ordered by descending createdAt + id. Bounded to LIMIT 500 by default;
 * pass { limit, offset } for stable page/pageSize pagination — every predicate
 * is applied before the OFFSET/LIMIT so pages never drop matching rows.
 */
async function publicEducationCourses(
  extraPredicates: Parameters<typeof and>[0][] = [],
  pagination?: { limit: number; offset: number },
) {
  return db.select().from(coursesTable)
    .where(publicEducationCoursePredicate(extraPredicates))
    .orderBy(desc(coursesTable.createdAt), desc(coursesTable.id))
    .limit(pagination?.limit ?? 500)
    .offset(pagination?.offset ?? 0);
}

function publicEducationCoursePredicate(extraPredicates: Parameters<typeof and>[0][] = []) {
  return and(
    eq(coursesTable.published, true),
    eq(coursesTable.archived, false),
    isNotNull(coursesTable.centerId),
    // Mirror educationCenterEligibility exactly: verified center with an
    // active / free-via-loyalty subscription.
    sql`exists (
      select 1 from ${educationCentersTable} ec
      join ${educationCenterSubscriptionsTable} ecs on ecs.center_id = ec.id
      where ec.id = ${coursesTable.centerId}
        and ec.verification_status = 'verified'
        and ecs.status in ('active', 'free_via_loyalty')
    )`,
    ...extraPredicates,
  );
}

/**
 * Batch assembler for course card/list views.
 * Fetches all sub-resources for N courses in a fixed number of batch queries,
 * then assembles results in memory — no per-course DB round-trips.
 * Used by the list and popular endpoints; the single-course detail endpoint
 * still calls educationCourseView() directly to preserve full detail.
 */
export async function batchEducationCourseViews(
  courses: (typeof coursesTable.$inferSelect)[],
  access?: EducationAccess,
) {
  _hookAssembler("batchEducationCourseViews");
  if (!courses.length) return [];

  const courseIds = courses.map((c) => c.id);
  const centerIds = [...new Set(courses.flatMap((c) => (c.centerId ? [c.centerId] : [])))];
  const salonIds = [...new Set(courses.flatMap((c) => (c.salonId ? [c.salonId] : [])))];

  // One query per cross-cutting resource; all parallelised.
  const [centers, salons, allSessions, allModules, allDayProgram, allGallery, allReviewRows, allInstructors, paidFeaturedCharges] = await Promise.all([
    centerIds.length ? db.select().from(educationCentersTable).where(inArray(educationCentersTable.id, centerIds)) : Promise.resolve([] as (typeof educationCentersTable.$inferSelect)[]),
    salonIds.length ? db.select().from(salonsTable).where(inArray(salonsTable.id, salonIds)) : Promise.resolve([] as (typeof salonsTable.$inferSelect)[]),
    db.select().from(courseSessionsTable).where(inArray(courseSessionsTable.courseId, courseIds)).orderBy(asc(courseSessionsTable.startsAt)),
    db.select().from(courseModulesTable).where(inArray(courseModulesTable.courseId, courseIds)).orderBy(asc(courseModulesTable.sortOrder)),
    db.select().from(courseDaysTable).where(inArray(courseDaysTable.courseId, courseIds)).orderBy(asc(courseDaysTable.sortOrder), asc(courseDaysTable.dayNumber)),
    db.select().from(educationMediaTable).where(inArray(educationMediaTable.courseId, courseIds)).orderBy(asc(educationMediaTable.sortOrder), asc(educationMediaTable.createdAt)),
    db.select().from(courseReviewsTable).where(and(inArray(courseReviewsTable.courseId, courseIds), eq(courseReviewsTable.status, "published"))).orderBy(desc(courseReviewsTable.createdAt)),
    centerIds.length ? db.select().from(educationInstructorsTable).where(inArray(educationInstructorsTable.centerId, centerIds)) : Promise.resolve([] as (typeof educationInstructorsTable.$inferSelect)[]),
    // Only fetch featured charges for isFeatured courses that haven't expired.
    db.select().from(educationFeaturedChargesTable)
      .where(and(
        inArray(educationFeaturedChargesTable.courseId, courseIds),
        eq(educationFeaturedChargesTable.status, "paid"),
      ))
      .orderBy(desc(educationFeaturedChargesTable.createdAt)),
  ]);

  // Batch-fetch lessons for the collected modules.
  const allModuleIds = allModules.map((m) => m.id);
  const allLessons = allModuleIds.length
    ? await db.select().from(courseLessonsTable).where(inArray(courseLessonsTable.moduleId, allModuleIds)).orderBy(asc(courseLessonsTable.sortOrder))
    : [];

  // Build look-up maps.
  const centerById = new Map(centers.map((c) => [c.id, c]));
  const salonById = new Map(salons.map((s) => [s.id, s]));
  const sessionsByCourseId = new Map<string, (typeof courseSessionsTable.$inferSelect)[]>();
  for (const s of allSessions) {
    const arr = sessionsByCourseId.get(s.courseId) ?? [];
    arr.push(s);
    sessionsByCourseId.set(s.courseId, arr);
  }
  const modulesByCourseId = new Map<string, (typeof courseModulesTable.$inferSelect)[]>();
  for (const m of allModules) {
    const arr = modulesByCourseId.get(m.courseId) ?? [];
    arr.push(m);
    modulesByCourseId.set(m.courseId, arr);
  }
  const lessonsByModuleId = new Map<string, (typeof courseLessonsTable.$inferSelect)[]>();
  for (const l of allLessons) {
    const arr = lessonsByModuleId.get(l.moduleId) ?? [];
    arr.push(l);
    lessonsByModuleId.set(l.moduleId, arr);
  }
  const dayProgramByCourseId = new Map<string, (typeof courseDaysTable.$inferSelect)[]>();
  for (const d of allDayProgram) {
    const arr = dayProgramByCourseId.get(d.courseId) ?? [];
    arr.push(d);
    dayProgramByCourseId.set(d.courseId, arr);
  }
  const galleryByCourseId = new Map<string, (typeof educationMediaTable.$inferSelect)[]>();
  for (const item of allGallery) {
    if (!item.courseId) continue;
    const arr = galleryByCourseId.get(item.courseId) ?? [];
    arr.push(item);
    galleryByCourseId.set(item.courseId, arr);
  }
  // Keep up to 12 published reviews per course.
  const reviewsByCourseId = new Map<string, (typeof courseReviewsTable.$inferSelect)[]>();
  for (const r of allReviewRows) {
    const arr = reviewsByCourseId.get(r.courseId) ?? [];
    if (arr.length < 12) arr.push(r);
    reviewsByCourseId.set(r.courseId, arr);
  }
  const instructorById = new Map(allInstructors.map((i) => [i.id, i]));
  const instructorByUserIdAndCenter = new Map<string, typeof educationInstructorsTable.$inferSelect>();
  for (const i of allInstructors) {
    if (i.userId) instructorByUserIdAndCenter.set(`${i.centerId}:${i.userId}`, i);
  }
  // Latest paid featured charge per course.
  const paidFeaturedByCourseId = new Map<string, typeof educationFeaturedChargesTable.$inferSelect>();
  for (const ch of paidFeaturedCharges) {
    if (!paidFeaturedByCourseId.has(ch.courseId)) paidFeaturedByCourseId.set(ch.courseId, ch);
  }

  // Optionally resolve per-user enrollment status in one batch query.
  const enrollmentByCourseId = new Map<string, typeof courseEnrollmentsTable.$inferSelect>();
  if (access?.user) {
    const enrollments = await db.select().from(courseEnrollmentsTable)
      .where(and(inArray(courseEnrollmentsTable.courseId, courseIds), eq(courseEnrollmentsTable.purchaserId, access.user.id)));
    for (const e of enrollments) enrollmentByCourseId.set(e.courseId, e);
  }

  const now = new Date();

  return courses.map((course) => {
    const center = course.centerId ? centerById.get(course.centerId) : undefined;
    const salon = course.salonId ? salonById.get(course.salonId) : undefined;
    const publisher = salon ?? center;

    // Instructor resolution.
    let instructorName = "Stručni tim";
    let instructorProfileId: string | null = null;
    if (course.centerId) {
      const profile = course.instructorProfileId
        ? instructorById.get(course.instructorProfileId)
        : course.instructorId
          ? instructorByUserIdAndCenter.get(`${course.centerId}:${course.instructorId}`)
          : undefined;
      if (profile) {
        instructorName = profile.fullName;
        instructorProfileId = profile.id;
      }
    }

    // Session logistics authorization — mirror educationCourseView() exactly:
    // admins, the publisher/owner, and paid/enrolled viewers see the location;
    // unauthorized public viewers get null.
    const owned = Boolean(access && isCourseOwner(access, course));
    const enrollmentForLogistics = enrollmentByCourseId.get(course.id);
    const mayReadLogistics = Boolean(
      access && (access.admin || owned || enrollmentForLogistics?.paymentStatus === "paid"),
    );

    // Sessions view (location gated by mayReadLogistics).
    const rawSessions = sessionsByCourseId.get(course.id) ?? [];
    const sessions = rawSessions.map((s) => ({
      id: s.id,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      location: mayReadLogistics ? s.location : null,
      capacity: s.capacity,
      reservedSeats: s.reservedSeats,
      availableSeats: Math.max(0, s.capacity - s.reservedSeats),
      minimumEnrollments: s.minimumEnrollments,
      cancelledAt: s.cancelledAt?.toISOString() ?? null,
    }));

    // Modules + lessons view.
    const courseModules = modulesByCourseId.get(course.id) ?? [];
    const modules = courseModules.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      sortOrder: m.sortOrder,
      lessons: (lessonsByModuleId.get(m.id) ?? []).map((l) => ({
        id: l.id,
        title: l.title,
        description: l.description,
        durationMinutes: l.durationMinutes,
        sortOrder: l.sortOrder,
        completed: false,
      })),
    }));

    // Day program view.
    const dayProgram = (dayProgramByCourseId.get(course.id) ?? []).map((d) => ({
      id: d.id,
      dayNumber: d.dayNumber,
      title: d.title,
      description: d.description,
      durationMinutes: d.durationMinutes,
    }));

    // Gallery view.
    const gallery = (galleryByCourseId.get(course.id) ?? []).map((item) => ({
      id: item.id,
      url: publicEducationMediaUrl(item),
      altText: item.altText,
      sortOrder: item.sortOrder,
    }));

    // Reviews view (max 12, already filtered to published, desc).
    const reviews = (reviewsByCourseId.get(course.id) ?? []).map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
    }));

    // Featured: isFeatured flag + not expired + latest charge is "paid".
    const isFeaturedActive = course.isFeatured && (!course.featuredUntil || course.featuredUntil > now);
    const featured = isFeaturedActive && Boolean(paidFeaturedByCourseId.get(course.id));

    const enrollment = enrollmentByCourseId.get(course.id);

    return {
      id: course.id,
      title: course.title,
      description: course.description,
      instructor: instructorName,
      instructorProfileId,
      publisher: publisher?.name ?? "LUMERA partner",
      publisherType: course.salonId ? "SALON" as const : "EDUCATION_CENTER" as const,
      publisherVerified: center?.verificationStatus === "verified",
      category: course.category,
      format: course.format,
      city: course.city,
      price: course.price,
      duration: course.duration,
      level: course.level,
      learningOutcomes: course.learningOutcomes,
      includedItems: course.includedItems,
      requirements: course.requirements,
      rating: course.rating / 10,
      certification: course.certification,
      featured,
      featuredUntil: course.featuredUntil?.toISOString() ?? null,
      refundPolicy: course.refundPolicy,
      groupDiscountMinimum: course.groupDiscountMinimum,
      groupDiscountPercent: course.groupDiscountPercent,
      centerId: course.centerId,
      imageUrl: course.imageUrl,
      startDate: course.startDate,
      published: course.published,
      archived: course.archived,
      availableSeats: sessions.length ? Math.max(...sessions.map((s) => s.availableSeats)) : null,
      enrollmentStatus: enrollment?.status ?? null,
      modules,
      sessions,
      dayProgram,
      gallery,
      center: center ? null : null, // center detail only needed on single-course view
      reviews,
    };
  });
}

async function publicCourseCard(course: typeof coursesTable.$inferSelect) {
  const { modules, sessions, dayProgram, gallery, center, reviews, ...card } = await educationCourseView(course);
  return card;
}

router.get("/education/public/courses", async (req, res): Promise<void> => {
  const queryInput = {
    ...req.query,
    startDate: typeof req.query.startDate === "string" ? new Date(`${req.query.startDate}T00:00:00.000Z`) : req.query.startDate,
  };
  const parsed = ListPublicEducationCoursesQueryParams.safeParse(queryInput);
  if (!parsed.success || (parsed.data.startDate && Number.isNaN(parsed.data.startDate.getTime()))) {
    res.status(400).json({ error: "Filteri nisu ispravni." }); return;
  }
  const query = parsed.data;

  // Push all scalar predicates into the DB query via publicEducationCourses().
  const sqlPredicates: Parameters<typeof and>[0][] = [];
  if (query.format) sqlPredicates.push(eq(coursesTable.format, query.format));
  if (query.city) sqlPredicates.push(eq(sql`lower(${coursesTable.city})`, query.city.toLowerCase()));
  if (query.category) sqlPredicates.push(ilike(coursesTable.category, `%${query.category}%`));
  if (query.level) sqlPredicates.push(eq(coursesTable.level, query.level));
  if (query.minPrice !== undefined) sqlPredicates.push(gte(coursesTable.price, query.minPrice));
  if (query.maxPrice !== undefined) sqlPredicates.push(lte(coursesTable.price, query.maxPrice));
  if (query.startDate) sqlPredicates.push(gte(coursesTable.startDate, calendarDate(query.startDate)));

  // maxDurationDays pushed to SQL via a correlated day-program count so it applies
  // before the bound. Courses with no published day-program count as 1 day (prior
  // JS default); since maxDurationDays >= 1, a 0-count row always satisfies
  // `count <= maxDurationDays`, matching the prior `(dayCount ?? 1) <= max` semantics.
  if (query.maxDurationDays !== undefined) {
    sqlPredicates.push(sql`(
      select count(*) from ${courseDaysTable} cd where cd.course_id = ${coursesTable.id}
    ) <= ${query.maxDurationDays}`);
  }

  // Stable page/pageSize pagination: OFFSET/LIMIT applied after every SQL predicate.
  const pageSize = query.pageSize;
  const offset = (query.page - 1) * pageSize;
  const courses = await publicEducationCourses(sqlPredicates, { limit: pageSize, offset });
  const views = await batchEducationCourseViews(courses);
  res.json(ListPublicEducationCoursesResponse.parse(views).map(calendarDateCourseResponse));
});

router.get("/education/public/courses/:courseId", async (req, res): Promise<void> => {
  const parsed = GetPublicEducationCourseParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, parsed.data.courseId)).limit(1);
  if (!course || !(await isPublicEducationCourse(course))) {
    res.status(404).json({ error: "Edukacija nije dostupna." }); return;
  }
  // Single-course detail: use educationCourseView for full center/session/gallery depth.
  res.json(calendarDateCourseResponse(GetPublicEducationCourseResponse.parse(await educationCourseView(course))));
});

router.get("/education/public/categories", async (_req, res): Promise<void> => {
  const result = await catalogCache.getOrLoad(
    "education-categories:public-counts",
    ["education-categories"],
    async () => {
      const [categories, counts] = await Promise.all([
        db.select().from(courseCategoriesTable).orderBy(asc(courseCategoriesTable.name)),
        db.select({
          category: sql<string>`lower(${coursesTable.category})`,
          courseCount: count(),
        }).from(coursesTable)
          .where(publicEducationCoursePredicate())
          .groupBy(sql`lower(${coursesTable.category})`),
      ]);
      const countByName = new Map(counts.map((row) => [row.category, Number(row.courseCount)]));
      return categories.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        courseCount: countByName.get(category.name.toLowerCase()) ?? 0,
      })).filter((category) => category.courseCount > 0);
    },
    600_000,
  );
  res.json(ListPublicEducationCategoriesResponse.parse(result));
});

router.get("/education/public/popular", async (req, res): Promise<void> => {
  const parsed = ListPopularEducationCoursesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const limit = parsed.data.limit ?? 6;
  const courses = await db.select().from(coursesTable)
    .where(publicEducationCoursePredicate())
    .orderBy(desc(coursesTable.rating), desc(coursesTable.isFeatured), desc(coursesTable.createdAt), desc(coursesTable.id))
    .limit(limit);
  const views = await batchEducationCourseViews(courses);
  res.json(ListPopularEducationCoursesResponse.parse(views).map(calendarDateCourseResponse));
});

router.get("/education/public/centers/:centerId", async (req, res): Promise<void> => {
  const parsed = GetPublicEducationCenterParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const eligibility = await educationCenterEligibility(parsed.data.centerId);
  if (!eligibility.center || !eligibility.eligible) {
    res.status(404).json({ error: "Edukativni centar nije dostupan." }); return;
  }
  const publicCourses = await publicEducationCourses(
    [eq(coursesTable.centerId, eligibility.center.id)],
    { limit: 100, offset: 0 },
  );
  // Use batch assembler for card-level views (no deep center nesting needed here).
  const cards = await batchEducationCourseViews(publicCourses);
  res.json(GetPublicEducationCenterResponse.parse(await centerPublicView(eligibility.center, cards)));
});

router.get("/education/public/featured", async (_req, res): Promise<void> => {
  const courses = await db.select().from(coursesTable)
    .where(and(
      eq(coursesTable.published, true), eq(coursesTable.archived, false), isNotNull(coursesTable.centerId),
      eq(coursesTable.isFeatured, true), or(sql`${coursesTable.featuredUntil} is null`, gte(coursesTable.featuredUntil, new Date())),
    ))
    .orderBy(desc(coursesTable.featuredActivatedAt));
  if (!courses.length) { res.json([]); return; }
  // Batch eligibility check — replaces N×2 per-course queries.
  const centerIds = [...new Set(courses.map((c) => c.centerId) as string[])];
  const eligibilityMap = await batchCenterEligibility(centerIds);
  // Batch paid-charge check — one query for all candidates.
  const paidCharges = await db.select().from(educationFeaturedChargesTable)
    .where(and(
      inArray(educationFeaturedChargesTable.courseId, courses.map((c) => c.id)),
      eq(educationFeaturedChargesTable.status, "paid"),
    ))
    .orderBy(desc(educationFeaturedChargesTable.createdAt));
  const paidCourseIds = new Set(paidCharges.map((ch) => ch.courseId));
  const visible = courses.filter((course) =>
    course.centerId && eligibilityMap.get(course.centerId) === true && paidCourseIds.has(course.id),
  );
  res.json(await batchEducationCourseViews(visible));
});

router.get("/education/instructors", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const centerId = access.centers[0]?.id;
  if (!centerId || access.admin) { res.status(403).json({ error: "Profilima instruktora upravlja njihov edukativni centar." }); return; }
  const instructors = await db.select().from(educationInstructorsTable).where(eq(educationInstructorsTable.centerId, centerId)).orderBy(desc(educationInstructorsTable.createdAt));
  res.json(instructors.map(instructorProfileView));
});

function instructorBodyFields(body: Record<string, unknown>) {
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 20) : [];
  return {
    photoUrl: typeof body.photoUrl === "string" ? body.photoUrl : null,
    biography: typeof body.biography === "string" ? body.biography.slice(0, 4000) : "",
    industryYears: typeof body.industryYears === "number" && body.industryYears >= 0 ? Math.floor(body.industryYears) : 0,
    experienceYears: typeof body.experienceYears === "number" && body.experienceYears >= 0 ? Math.floor(body.experienceYears) : 0,
    specializations: strings(body.specializations), qualifications: strings(body.qualifications),
  };
}

function instructorProfileView(instructor: typeof educationInstructorsTable.$inferSelect) {
  return {
    id: instructor.id, centerId: instructor.centerId, userId: instructor.userId ?? null,
    fullName: instructor.fullName, photoUrl: instructor.photoUrl ?? null, biography: instructor.biography,
    industryYears: instructor.industryYears, experienceYears: instructor.experienceYears,
    specializations: instructor.specializations, qualifications: instructor.qualifications,
    createdAt: instructor.createdAt.toISOString(), updatedAt: instructor.updatedAt.toISOString(),
  };
}

router.post("/education/instructors", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const centerId = access.centers[0]?.id;
  if (!centerId || access.admin) { res.status(403).json({ error: "Profilima instruktora upravlja njihov edukativni centar." }); return; }
  const body = req.body as Record<string, unknown>;
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  if (!fullName || fullName.length > 120) { res.status(400).json({ error: "Unesite ime instruktora." }); return; }
  const userId = typeof body.userId === "string" && /^[0-9a-f-]{36}$/i.test(body.userId) ? body.userId : null;
  if (userId) {
    const [linkedUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!linkedUser || !["INSTRUCTOR", "EDUCATION_CENTER_OWNER"].includes(linkedUser.role)) {
      res.status(400).json({ error: "Izaberite važeći nalog instruktora." }); return;
    }
  }
  const [created] = await db.insert(educationInstructorsTable).values({
    centerId, userId, fullName, ...instructorBodyFields(body),
  }).returning();
  res.status(201).json(instructorProfileView(created!));
});

router.patch("/education/instructors/:instructorId", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const centerId = access.centers[0]?.id;
  if (!centerId || access.admin) { res.status(403).json({ error: "Profilima instruktora upravlja njihov edukativni centar." }); return; }
  const instructorId = String(req.params.instructorId ?? "");
  const [instructor] = await db.select().from(educationInstructorsTable).where(and(eq(educationInstructorsTable.id, instructorId), eq(educationInstructorsTable.centerId, centerId))).limit(1);
  if (!instructor) { res.status(404).json({ error: "Instruktor nije pronađen." }); return; }
  const body = req.body as Record<string, unknown>;
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : instructor.fullName;
  if (!fullName || fullName.length > 120) { res.status(400).json({ error: "Unesite ime instruktora." }); return; }
  const userId = typeof body.userId === "string" && /^[0-9a-f-]{36}$/i.test(body.userId) ? body.userId : ("userId" in body ? null : instructor.userId);
  if (userId && userId !== instructor.userId) {
    const [linkedUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!linkedUser || !["INSTRUCTOR", "EDUCATION_CENTER_OWNER"].includes(linkedUser.role)) {
      res.status(400).json({ error: "Izaberite važeći nalog instruktora." }); return;
    }
  }
  const [updated] = await db.update(educationInstructorsTable).set({
    fullName, userId, ...instructorBodyFields(body), updatedAt: new Date(),
  }).where(eq(educationInstructorsTable.id, instructor.id)).returning();
  res.json(instructorProfileView(updated!));
});

router.delete("/education/instructors/:instructorId", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  const centerId = access.centers[0]?.id;
  if (!centerId || access.admin) { res.status(403).json({ error: "Profilima instruktora upravlja njihov edukativni centar." }); return; }
  const instructorId = String(req.params.instructorId ?? "");
  const [instructor] = await db.select().from(educationInstructorsTable).where(and(eq(educationInstructorsTable.id, instructorId), eq(educationInstructorsTable.centerId, centerId))).limit(1);
  if (!instructor) { res.status(404).json({ error: "Instruktor nije pronađen." }); return; }
  await db.delete(educationInstructorsTable).where(eq(educationInstructorsTable.id, instructor.id));
  res.sendStatus(204);
});

router.get("/education/instructors/:instructorId/public", async (req, res): Promise<void> => {
  const instructorId = String(req.params.instructorId ?? "");
  const [instructor] = await db.select().from(educationInstructorsTable).where(eq(educationInstructorsTable.id, instructorId)).limit(1);
  if (!instructor) { res.status(404).json({ error: "Instruktor nije pronađen." }); return; }
  const allCourses = await db.select().from(coursesTable).where(eq(coursesTable.centerId, instructor.centerId));
  // Courses are linked to the instructor PROFILE (instructorProfileId). Older
  // records may only carry the legacy userId link, so fall back to that when
  // the profile is backed by a user account.
  const courses = allCourses.filter((course) =>
    course.instructorProfileId === instructor.id
    || (instructor.userId != null && course.instructorProfileId == null && course.instructorId === instructor.userId));
  // Batch eligibility check — one pair of queries for all center IDs.
  const uniqueCenterIds = [...new Set(courses.flatMap((c) => (c.centerId ? [c.centerId] : [])))];
  const eligibilityMap = await batchCenterEligibility(uniqueCenterIds);
  const publicCourses = courses.filter((course) =>
    course.published && !course.archived && course.centerId && eligibilityMap.get(course.centerId) === true,
  );
  const enrollments = publicCourses.length
    ? await db.select().from(courseEnrollmentsTable).where(and(inArray(courseEnrollmentsTable.courseId, publicCourses.map((course) => course.id)), eq(courseEnrollmentsTable.paymentStatus, "paid")))
    : [];
  const rating = publicCourses.length ? publicCourses.reduce((total, course) => total + course.rating, 0) / publicCourses.length / 10 : 0;
  res.json({
    id: instructor.id, name: instructor.fullName, photoUrl: instructor.photoUrl ?? null, biography: instructor.biography,
    industryYears: instructor.industryYears, experienceYears: instructor.experienceYears, specializations: instructor.specializations,
    qualifications: instructor.qualifications, rating, participantCount: enrollments.length,
    courses: await batchEducationCourseViews(publicCourses),
  });
});

router.get("/education/center/status", async (req, res): Promise<void> => {
  const access = await requireEducationAccess(req, res); if (!access) return;
  if (access.admin) { res.status(403).json({ error: "Ovaj status je rezervisan za vlasnika edukativnog centra." }); return; }
  // Batch-fetch subscriptions for all centers in one query.
  const centerIds = access.centers.map((c) => c.id);
  const subscriptions = centerIds.length
    ? await db.select().from(educationCenterSubscriptionsTable).where(inArray(educationCenterSubscriptionsTable.centerId, centerIds))
    : [];
  const subByCenterId = new Map(subscriptions.map((s) => [s.centerId, s]));
  const centers = access.centers.map((center) => {
    const subscription = subByCenterId.get(center.id);
    const eligible = center.verificationStatus === "verified" && hasActiveEducationSubscription(subscription?.status);
    return {
      id: center.id, name: center.name, verificationStatus: center.verificationStatus, verificationNote: center.verificationNote,
      subscriptionStatus: subscription?.status ?? null, currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null, eligible,
    };
  });
  res.json(centers);
});

router.get("/education/purchases", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  // Bounded, stably ordered purchaser list — never full-scans course_enrollments.
  const { limit, offset } = parsePagination(req.query, 50);
  const enrollments = await db.select().from(courseEnrollmentsTable)
    .where(eq(courseEnrollmentsTable.purchaserId, user.id))
    .orderBy(desc(courseEnrollmentsTable.purchasedAt), desc(courseEnrollmentsTable.id))
    .limit(limit)
    .offset(offset);
  res.json(await batchEducationEnrollmentViews(enrollments));
});

// ─── Certificate PDF ────────────────────────────────────────────────────────
// Generates (once) and serves a plain-PDF certificate for a completed online
// enrollment.  The path is persisted in certificatePath so rerequests are free.

function buildCertificatePdf(learnerName: string, courseTitle: string, issuedAt: Date, certificateNumber: string): Buffer {
  const iso = issuedAt.toISOString().slice(0, 10);
  const escaped = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  // Simple single-page PDF built by hand (no external libraries).
  // Content stream draws text in two fonts: Helvetica (body) and Helvetica-Bold
  // (title).  Coordinates are in points (72 pt = 1 inch).  Page: A4 landscape.
  const W = 841, H = 595;

  const contentLines = [
    "BT",
    `/F2 36 Tf`,
    `${W / 2} ${H / 2 + 90} Td`,
    `(${escaped("LUMERA Edukacije")}) Tj`,
    "ET",
    "BT",
    `/F2 24 Tf`,
    `${W / 2} ${H / 2 + 40} Td`,
    `(${escaped("Sertifikat o završenoj edukaciji")}) Tj`,
    "ET",
    "BT",
    `/F1 16 Tf`,
    `${W / 2} ${H / 2} Td`,
    `(${escaped(learnerName)}) Tj`,
    "ET",
    "BT",
    `/F1 13 Tf`,
    `${W / 2} ${H / 2 - 36} Td`,
    `(${escaped("uspešno je završio/la kurs:")}) Tj`,
    "ET",
    "BT",
    `/F2 15 Tf`,
    `${W / 2} ${H / 2 - 64} Td`,
    `(${escaped(courseTitle.length > 70 ? courseTitle.slice(0, 67) + "..." : courseTitle)}) Tj`,
    "ET",
    "BT",
    `/F1 11 Tf`,
    `${W / 2} ${H / 2 - 108} Td`,
    `(${escaped(`Datum: ${iso}   |   Broj: ${certificateNumber}`)}) Tj`,
    "ET",
  ];

  const contentStream = [
    "q",
    // Decorative border rectangle
    `0.8 0.6 0.8 RG`,
    `2 w`,
    `30 30 ${W - 60} ${H - 60} re S`,
    // Center all text via TextMatrix offsets (simple negative-half-width centering is not
    // supported without font metrics in raw PDF; we use approximate centering).
    // Text matrix: positioned relative to page origin with TextMatrix.
    "BT",
    `/F2 36 Tf`,
    `1 0 0 1 ${W / 2 - 130} ${H / 2 + 90} Tm`,
    `(${escaped("LUMERA Edukacije")}) Tj`,
    "ET",
    "BT",
    `/F2 22 Tf`,
    `1 0 0 1 ${W / 2 - 185} ${H / 2 + 44} Tm`,
    `(${escaped("Sertifikat o završenoj edukaciji")}) Tj`,
    "ET",
    "BT",
    `/F1 16 Tf`,
    `1 0 0 1 ${W / 2 - Math.min(learnerName.length * 4.5, 200)} ${H / 2} Tm`,
    `(${escaped(learnerName)}) Tj`,
    "ET",
    "BT",
    `/F1 13 Tf`,
    `1 0 0 1 ${W / 2 - 130} ${H / 2 - 36} Tm`,
    `(${escaped("uspešno je završio/la kurs:")}) Tj`,
    "ET",
    "BT",
    `/F2 14 Tf`,
    `1 0 0 1 ${W / 2 - Math.min(courseTitle.length * 4, 240)} ${H / 2 - 62} Tm`,
    `(${escaped(courseTitle.length > 70 ? courseTitle.slice(0, 67) + "..." : courseTitle)}) Tj`,
    "ET",
    "BT",
    `/F1 10 Tf`,
    `1 0 0 1 ${W / 2 - 165} ${H / 2 - 108} Tm`,
    `(${escaped(`Datum: ${iso}   |   Broj sertifikata: ${certificateNumber}`)}) Tj`,
    "ET",
    "Q",
  ].join("\n");

  const encoder = new TextEncoder();
  const streamBytes = encoder.encode(contentStream);
  const streamLength = streamBytes.length;

  // Build PDF objects
  const objects: string[] = [];
  const offsets: number[] = [];
  let body = "%PDF-1.4\n";

  function addObj(n: number, content: string) {
    offsets[n] = body.length;
    objects.push(content);
    body += `${n} 0 obj\n${content}\nendobj\n`;
  }

  // 1: Catalog
  addObj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  // 2: Pages
  addObj(2, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`);
  // 3: Page (A4 landscape)
  addObj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`);
  // 4: Content stream
  addObj(4, `<< /Length ${streamLength} >>\nstream\n${contentStream}\nendstream`);
  // 5: Font Helvetica
  addObj(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  // 6: Font Helvetica-Bold
  addObj(6, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  const xrefOffset = body.length;
  body += "xref\n";
  body += `0 ${offsets.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let i = 1; i <= offsets.length; i++) {
    body += `${String(offsets[i]!).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body, "latin1");
}

router.get("/education/enrollments/:enrollmentId/certificate", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const enrollmentId = String(req.params.enrollmentId ?? "");
  const [enrollment] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, enrollmentId)).limit(1);
  if (!enrollment) { res.status(404).json({ error: "Prijava nije pronađena." }); return; }
  // Only the purchaser (or the enrolled employee's owner) may download the certificate.
  if (enrollment.purchaserId !== user.id && !isAdmin(user)) {
    // Allow the learner employee themselves to download via their user session
    const [emp] = enrollment.employeeId
      ? await db.select().from(employeesTable).where(eq(employeesTable.id, enrollment.employeeId)).limit(1)
      : [];
    if (!emp || emp.userId !== user.id) {
      res.status(403).json({ error: "Nemate pristup ovom sertifikatu." }); return;
    }
  }
  if (enrollment.status !== "completed" || enrollment.paymentStatus !== "paid") {
    res.status(409).json({ error: "Sertifikat je dostupan tek nakon što završite kurs i platite." }); return;
  }
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, enrollment.courseId)).limit(1);
  if (!course) { res.status(404).json({ error: "Kurs nije pronađen." }); return; }
  if (!course.certification) { res.status(409).json({ error: "Ovaj kurs ne nudi zvanični sertifikat." }); return; }

  // Issue certificate number if not yet issued.
  let certNumber = enrollment.certificateNumber;
  if (!certNumber) {
    certNumber = `LUMERA-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
    await db.update(courseEnrollmentsTable).set({
      certificateNumber: certNumber,
      certificateIssuedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(courseEnrollmentsTable.id, enrollment.id));
  }

  const [purchaser, employee] = await Promise.all([
    db.select().from(usersTable).where(eq(usersTable.id, enrollment.purchaserId)).limit(1),
    enrollment.employeeId ? db.select().from(employeesTable).where(eq(employeesTable.id, enrollment.employeeId)).limit(1) : Promise.resolve([]),
  ]);
  const learnerName = employee[0]?.name ?? `${purchaser[0]?.firstName ?? "Polaznik"} ${purchaser[0]?.lastName ?? ""}`.trim();
  const issuedAt = enrollment.certificateIssuedAt ?? new Date();

  const pdfBuffer = buildCertificatePdf(learnerName, course.title, issuedAt, certNumber);
  const filename = `sertifikat-${certNumber}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.end(pdfBuffer);
});

// ─── ICS Calendar Export ─────────────────────────────────────────────────────
// Generates an RFC 5545 .ics file for a purchased live session enrollment.

function buildIcs(params: {
  uid: string;
  summary: string;
  description: string;
  location: string | null;
  dtstart: Date;
  dtend: Date;
  organizerName: string;
  organizerEmail: string;
}): string {
  function icsDate(d: Date) {
    return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }
  // RFC 5545 §3.1 content-line folding: lines longer than 75 octets are split
  // and each continuation line begins with a single space. Folding must count
  // UTF-8 octets (not JS characters) and must never split a multi-byte
  // character across a fold boundary, otherwise the value cannot be decoded.
  function fold(line: string): string {
    const encoder = new TextEncoder();
    if (encoder.encode(line).length <= 75) return line;
    const result: string[] = [];
    // First line may use all 75 octets; continuation lines reserve 1 octet for
    // the leading space, leaving 74 octets of content per continuation.
    let cur = "";
    let curBytes = 0;
    let limit = 75;
    for (const ch of line) {
      const chBytes = encoder.encode(ch).length;
      if (curBytes + chBytes > limit) {
        result.push(cur);
        cur = " " + ch;
        curBytes = 1 + chBytes;
        limit = 75;
      } else {
        cur += ch;
        curBytes += chBytes;
      }
    }
    if (cur) result.push(cur);
    return result.join("\r\n");
  }
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LUMERA//Education//SR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${params.uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(params.dtstart)}`,
    `DTEND:${icsDate(params.dtend)}`,
    fold(`SUMMARY:${esc(params.summary)}`),
    fold(`DESCRIPTION:${esc(params.description)}`),
    ...(params.location ? [fold(`LOCATION:${esc(params.location)}`)] : []),
    fold(`ORGANIZER;CN="${esc(params.organizerName)}":mailto:${params.organizerEmail}`),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

router.get("/education/enrollments/:enrollmentId/session.ics", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const enrollmentId = String(req.params.enrollmentId ?? "");
  const [enrollment] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, enrollmentId)).limit(1);
  if (!enrollment) { res.status(404).json({ error: "Prijava nije pronađena." }); return; }
  if (enrollment.purchaserId !== user.id && !isAdmin(user)) {
    const [emp] = enrollment.employeeId
      ? await db.select().from(employeesTable).where(eq(employeesTable.id, enrollment.employeeId)).limit(1)
      : [];
    if (!emp || emp.userId !== user.id) {
      res.status(403).json({ error: "Nemate pristup ovom terminu." }); return;
    }
  }
  if (enrollment.paymentStatus !== "paid") {
    res.status(409).json({ error: "Detalji termina su dostupni tek nakon potvrđene uplate." }); return;
  }
  if (!enrollment.sessionId) {
    res.status(409).json({ error: "Ova prijava nema dodeljen termin." }); return;
  }
  const [session, course] = await Promise.all([
    db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, enrollment.sessionId)).limit(1),
    db.select().from(coursesTable).where(eq(coursesTable.id, enrollment.courseId)).limit(1),
  ]);
  if (!session[0] || !course[0]) { res.status(404).json({ error: "Termin ili kurs nisu pronađeni." }); return; }
  const [purchaser] = await db.select().from(usersTable).where(eq(usersTable.id, enrollment.purchaserId)).limit(1);
  const uid = `lumera-session-${session[0].id}@lumera.app`;
  const description = `Edukacija: ${course[0].title}\nOrganizator: LUMERA Edukacije\nBroj prijave: ${enrollment.id}`;
  const icsContent = buildIcs({
    uid,
    summary: `LUMERA Edukacije: ${course[0].title}`,
    description,
    location: session[0].location,
    dtstart: session[0].startsAt,
    dtend: session[0].endsAt,
    organizerName: "LUMERA Edukacije",
    organizerEmail: purchaser?.email ?? "edukacije@lumera.app",
  });
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="termin-${session[0].id}.ics"`);
  res.end(icsContent);
});

// ─── Group Enrollment ────────────────────────────────────────────────────────
// Salon owner enrolls multiple employees at once. The server validates:
//  - all employeeIds belong to the caller's salon
//  - group size ≥ course.groupDiscountMinimum
//  - applies configured groupDiscountPercent to each seat
//  - inserts one enrollment per seat in a single transaction

router.post("/education/courses/:courseId/group-enrollments", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  if (user.role !== "SALON_OWNER") {
    res.status(403).json({ error: "Grupna prijava je dostupna samo vlasnicima salona." }); return;
  }
  const courseId = String(req.params.courseId ?? "");
  const access = await requireEducationAccess(req, res); if (!access) return;
  const salon = access.salon;
  if (!salon) { res.status(403).json({ error: "Nalog nije povezan sa salonom." }); return; }

  const rawIds = req.body?.employeeIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    res.status(400).json({ error: "Navedite bar jednog zaposlenog (employeeIds)." }); return;
  }
  const employeeIds: string[] = rawIds.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id));
  if (employeeIds.length !== rawIds.length || employeeIds.length === 0) {
    res.status(400).json({ error: "Jedan ili više ID-jeva zaposlenih nije ispravno." }); return;
  }
  const sessionId: string | null = typeof req.body?.sessionId === "string" && /^[0-9a-f-]{36}$/i.test(req.body.sessionId) ? req.body.sessionId : null;

  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, courseId)).limit(1);
  if (!course || !(await isPublicEducationCourse(course)) && !(course.salonId === salon.id && course.published && !course.archived)) {
    res.status(404).json({ error: "Kurs nije dostupan za grupnu prijavu." }); return;
  }

  // Validate all employees belong to caller's salon
  const employees = employeeIds.length
    ? await db.select().from(employeesTable)
        .where(and(inArray(employeesTable.id, employeeIds), eq(employeesTable.salonId, salon.id), eq(employeesTable.active, true)))
    : [];
  if (employees.length !== employeeIds.length) {
    res.status(403).json({ error: "Jedan ili više zaposlenih ne pripada vašem salonu ili nisu aktivni." }); return;
  }

  // Validate group discount eligibility
  const minGroup = course.groupDiscountMinimum ?? null;
  const discountPercent = course.groupDiscountPercent ?? 0;
  if (minGroup !== null && employeeIds.length < minGroup) {
    res.status(400).json({
      error: `Grupni popust zahteva najmanje ${minGroup} polaznika. Prijavili ste ${employeeIds.length}.`,
      minimumRequired: minGroup,
      submitted: employeeIds.length,
    }); return;
  }
  const effectiveDiscountPercent = (minGroup !== null && employeeIds.length >= minGroup) ? discountPercent : 0;
  const unitPrice = Math.max(0, Math.round(course.price * (1 - effectiveDiscountPercent / 100)));
  const idempotencyKey = req.get("idempotency-key")?.trim() || null;

  let enrollments: (typeof courseEnrollmentsTable.$inferSelect)[];
  try {
    enrollments = await db.transaction(async (tx) => {
      if (course.centerId) {
        await lockEducationCenterFinancials(tx, course.centerId);
        const [currentCenter] = await tx.select().from(educationCentersTable)
          .where(eq(educationCentersTable.id, course.centerId)).for("update").limit(1);
        const [subscription] = await tx.select().from(educationCenterSubscriptionsTable)
          .where(eq(educationCenterSubscriptionsTable.centerId, course.centerId)).for("update").limit(1);
        if (currentCenter?.verificationStatus !== "verified" || !hasActiveEducationSubscription(subscription?.status)) {
          throw new Error("Centar više nije verifikovan ili nema aktivnu pretplatu.");
        }
      }
      const isSalonInternal = course.salonId === salon.id && !course.centerId;
      if (sessionId) {
        const [reqSession] = await tx.select().from(courseSessionsTable)
          .where(and(eq(courseSessionsTable.id, sessionId), eq(courseSessionsTable.courseId, course.id)))
          .for("update").limit(1);
        if (!reqSession || reqSession.startsAt <= new Date() || reqSession.cancelledAt) {
          throw new Error("Izabrani termin nije dostupan.");
        }
        const remaining = reqSession.capacity - reqSession.reservedSeats;
        if (remaining < employeeIds.length) {
          throw new Error(`Na izabranom terminu ima samo ${remaining} slobodnih mesta.`);
        }
        // Only reserve seats now for enrollments that become active immediately
        // (salon-internal). Center-marketplace group seats stay pending and are
        // reserved atomically at settlement, exactly like single enrollments —
        // this prevents a group from double-reserving (once here, once again on
        // settle) and from leaking capacity when a pending request is abandoned.
        if (isSalonInternal) {
          await tx.update(courseSessionsTable)
            .set({ reservedSeats: reqSession.reservedSeats + employeeIds.length })
            .where(eq(courseSessionsTable.id, reqSession.id));
        }
      }
      const values = employees.map((emp) => ({
        courseId: course.id,
        userId: emp.userId ?? user.id,
        salonId: salon.id,
        employeeId: emp.id,
        purchaserId: user.id,
        status: isSalonInternal ? ("active" as const) : ("pending" as const),
        paymentStatus: isSalonInternal ? ("paid" as const) : ("pending" as const),
        chargedAmount: unitPrice,
        ...(isSalonInternal ? { accessGrantedAt: new Date() } : {}),
        sessionId: sessionId,
        auditData: {
          source: "group-enrollment",
          groupSize: employeeIds.length,
          effectiveDiscountPercent,
          unitPrice,
          idempotencyKey,
        },
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:${emp.id}` : null,
        idempotencyFingerprint: `${course.id}:${emp.id}:group:${sessionId ?? "auto"}`,
      }));
      const created = await tx.insert(courseEnrollmentsTable).values(values).returning();
      return created;
    });
  } catch (error) {
    const errorCode = typeof error === "object" && error
      ? (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code
      : undefined;
    if (errorCode === "23505") {
      res.status(409).json({ error: "Jedan ili više zaposlenih je već prijavljen na ovaj kurs." }); return;
    }
    res.status(409).json({ error: error instanceof Error ? error.message : "Grupna prijava nije uspela." }); return;
  }

  // Send notification email to the purchaser
  await sendTransactionalEmail({
    eventKey: `group-enrollment:${salon.id}:${course.id}:${idempotencyKey ?? Date.now()}`,
    emailType: "course_enrollment_requested",
    to: { email: user.email, name: `${user.firstName} ${user.lastName}` },
    subject: "LUMERA Edukacije — grupna prijava je primljena",
    htmlContent: lumeraEmailHtml(
      "Grupna prijava na edukaciju",
      `<p>Uspešno ste prijavili ${enrollments.length} zaposlenih na kurs <strong>${emailSafe(course.title)}</strong>.</p>`
        + (effectiveDiscountPercent > 0 ? `<p>Primenjen je grupni popust od <strong>${effectiveDiscountPercent}%</strong>. Cena po polazniku: <strong>${unitPrice} RSD</strong>.</p>` : "")
        + `<p>Pristup se aktivira nakon ručne potvrde uplate za svaku prijavu.</p>`,
    ),
    metadata: { courseId: course.id, salonId: salon.id, groupSize: enrollments.length },
  });

  res.status(201).json({
    enrollments: await batchEducationEnrollmentViews(enrollments),
    discountPercent: effectiveDiscountPercent,
    unitPrice,
    totalPrice: unitPrice * enrollments.length,
  });
});

async function enrollmentAccessForUser(user: typeof usersTable.$inferSelect, enrollmentId: string) {
  const [enrollment] = await db.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, enrollmentId)).limit(1);
  if (!enrollment) return { enrollment: null, course: null, center: null, canParticipate: false, admin: false };
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, enrollment.courseId)).limit(1);
  const [center] = course?.centerId
    ? await db.select().from(educationCentersTable).where(eq(educationCentersTable.id, course.centerId)).limit(1)
    : [];
  const admin = isAdmin(user);
  return {
    enrollment,
    course: course ?? null,
    center: center ?? null,
    canParticipate: admin || enrollment.purchaserId === user.id || (Boolean(center) && center!.ownerId === user.id),
    admin,
  };
}

router.get("/education/purchases/:enrollmentId/messages", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const access = await enrollmentAccessForUser(user, String(req.params.enrollmentId));
  if (!access.enrollment || !access.canParticipate) { res.status(403).json({ error: "Nemate pristup porukama ove kupovine." }); return; }
  if (access.enrollment.paymentStatus !== "paid") { res.status(409).json({ error: "Poruke postaju dostupne nakon potvrđene uplate." }); return; }
  const [thread] = await db.select().from(educationThreadsTable).where(eq(educationThreadsTable.enrollmentId, access.enrollment.id)).limit(1);
  if (!thread) { res.json({ thread: null, messages: [] }); return; }
  const messages = await db.select().from(educationMessagesTable).where(eq(educationMessagesTable.threadId, thread.id)).orderBy(asc(educationMessagesTable.createdAt));
  const senderIds = [...new Set(messages.map((message) => message.senderId))];
  const senders = senderIds.length ? await db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName }).from(usersTable).where(inArray(usersTable.id, senderIds)) : [];
  if (!access.admin) {
    await db.update(educationMessagesTable).set({ readAt: new Date() })
      .where(and(eq(educationMessagesTable.threadId, thread.id), ne(educationMessagesTable.senderId, user.id), sql`${educationMessagesTable.readAt} is null`));
  }
  res.json({
    thread: { id: thread.id, status: thread.status, enrollmentId: thread.enrollmentId },
    messages: messages.map((message) => {
      const sender = senders.find((item) => item.id === message.senderId);
      return { id: message.id, body: message.body, senderId: message.senderId, senderName: sender ? `${sender.firstName} ${sender.lastName}` : "LUMERA korisnik", createdAt: message.createdAt.toISOString(), readAt: message.readAt?.toISOString() ?? null };
    }),
  });
});

router.post("/education/purchases/:enrollmentId/messages", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body || body.length > 4000) { res.status(400).json({ error: "Poruka mora imati između 1 i 4000 karaktera." }); return; }
  const access = await enrollmentAccessForUser(user, String(req.params.enrollmentId));
  if (!access.enrollment || !access.canParticipate || access.admin || !access.center) { res.status(403).json({ error: "Samo kupac i vlasnik centra mogu slati poruke u ovoj kupovini." }); return; }
  if (access.enrollment.paymentStatus !== "paid") { res.status(409).json({ error: "Poruke postaju dostupne nakon potvrđene uplate." }); return; }
  let [thread] = await db.select().from(educationThreadsTable).where(eq(educationThreadsTable.enrollmentId, access.enrollment.id)).limit(1);
  if (!thread) {
    [thread] = await db.insert(educationThreadsTable).values({
      enrollmentId: access.enrollment.id,
      purchaserId: access.enrollment.purchaserId,
      centerId: access.center.id,
    }).returning();
  }
  if (thread!.status !== "open") { res.status(409).json({ error: "Ova konverzacija je zatvorena." }); return; }
  const [message] = await db.insert(educationMessagesTable).values({ threadId: thread!.id, senderId: user.id, body }).returning();
  await db.update(educationThreadsTable).set({ updatedAt: new Date() }).where(eq(educationThreadsTable.id, thread!.id));
  res.status(201).json({ id: message!.id, body: message!.body, senderId: message!.senderId, senderName: `${user.firstName} ${user.lastName}`, createdAt: message!.createdAt.toISOString(), readAt: null });
});

router.post("/education/purchases/:enrollmentId/disputes", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  const details = typeof req.body?.details === "string" ? req.body.details.trim() : "";
  if (!reason || !details || reason.length > 160 || details.length > 4000) { res.status(400).json({ error: "Unesite razlog i opis problema." }); return; }
  const access = await enrollmentAccessForUser(user, String(req.params.enrollmentId));
  if (!access.enrollment || access.enrollment.purchaserId !== user.id) { res.status(403).json({ error: "Samo kupac može prijaviti problem za svoju kupovinu." }); return; }
  if (access.enrollment.paymentStatus !== "paid") { res.status(409).json({ error: "Spor se može otvoriti tek nakon potvrđene uplate." }); return; }
  const [escrowPreview] = await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.enrollmentId, access.enrollment.id)).limit(1);
  if (!escrowPreview) { res.status(409).json({ error: "Kupovina nema escrow zaštitu koju možemo zamrznuti." }); return; }
  let result: { dispute: typeof educationDisputesTable.$inferSelect; duplicate: boolean };
  try {
    result = await db.transaction(async (tx) => {
    await lockEducationCenterFinancials(tx, escrowPreview.centerId);
    const [existing] = await tx.select().from(educationDisputesTable)
      .where(and(eq(educationDisputesTable.enrollmentId, access.enrollment!.id), inArray(educationDisputesTable.status, ["open", "under_review"]))).for("update").limit(1);
    if (existing) return { dispute: existing, duplicate: true };
    const [escrow] = await tx.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.id, escrowPreview.id)).for("update").limit(1);
    if (!escrow || !["held", "ready_for_payout"].includes(escrow.status) || escrow.netPaidAt || escrow.reservePaidAt) {
      throw new Error("Ova kupovina više nije podobna za otvaranje spora.");
    }
    if (escrow.releaseAt <= new Date()) throw new Error("Rok za prijavu problema je istekao.");
    const [created] = await tx.insert(educationDisputesTable).values({ enrollmentId: access.enrollment!.id, openedByUserId: user.id, reason, details }).returning();
      const [frozen] = await tx.update(educationEscrowsTable).set({ status: "frozen", frozenAt: new Date(), updatedAt: new Date() })
        .where(and(eq(educationEscrowsTable.id, escrow.id), inArray(educationEscrowsTable.status, ["held", "ready_for_payout"]), sql`${educationEscrowsTable.releaseAt} > now()`, sql`${educationEscrowsTable.netPaidAt} is null`, sql`${educationEscrowsTable.reservePaidAt} is null`)).returning();
      if (!frozen) throw new Error("Escrow je izmenjen u drugoj finansijskoj operaciji.");
      await tx.insert(educationFinancialEventsTable).values({
        escrowId: escrow.id, enrollmentId: access.enrollment!.id, actorUserId: user.id,
        eventType: "dispute_opened", previousStatus: escrow.status, nextStatus: "frozen", note: reason,
      });
    return { dispute: created!, duplicate: false };
    });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Spor nije mogao biti otvoren." });
    return;
  }
  const dispute = {
    id: result.dispute.id,
    enrollmentId: result.dispute.enrollmentId,
    reason: result.dispute.reason,
    details: result.dispute.details,
    status: result.dispute.status,
    createdAt: result.dispute.createdAt.toISOString(),
  };
  if (result.duplicate) {
    res.status(409).json({ error: "Za ovu kupovinu već postoji otvoren spor.", dispute });
    return;
  }
  res.status(201).json(dispute);
});

router.get("/education/disputes", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  const disputes = await db.select().from(educationDisputesTable).orderBy(desc(educationDisputesTable.createdAt));
  const visible = [];
  for (const dispute of disputes) {
    const access = await enrollmentAccessForUser(user, dispute.enrollmentId);
    if (!access.enrollment || !access.canParticipate) continue;
    visible.push({
      id: dispute.id, enrollmentId: dispute.enrollmentId, courseTitle: access.course?.title ?? "Edukacija",
      reason: dispute.reason, details: dispute.details, status: dispute.status, resolutionNote: dispute.resolutionNote,
      createdAt: dispute.createdAt.toISOString(), resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
    });
  }
  res.json(visible);
});

router.get("/admin/summary", async (req, res): Promise<void> => {
  const user = await current(req, res); if (!user) return;
  if (!isAdmin(user)) { res.status(403).json({ error: "Samo administratori mogu da vide ovaj pregled." }); return; }

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [users, salons, allAppointments, orders, reviews, subscriptions, services, eligibleGalleryUploadTickets] = await Promise.all([
    db.select().from(usersTable),
    db.select().from(salonsTable),
    db.select().from(appointmentsTable),
    db.select().from(ordersTable),
    db.select().from(reviewsTable),
    db.select({ status: subscriptionsTable.status }).from(subscriptionsTable),
    db.select({ id: servicesTable.id, categoryName: servicesTable.categoryName }).from(servicesTable),
    db.select({
      cleanupFailureCount: educationMediaUploadsTable.cleanupFailureCount,
      createdAt: educationMediaUploadsTable.createdAt,
    })
      .from(educationMediaUploadsTable)
      .where(educationMediaUploadCleanupEligibility(now)),
  ]);

  const bookingsThisMonth = allAppointments.filter((a) => a.createdAt >= thisMonthStart).length;
  const bookingsLastMonth = allAppointments.filter((a) => a.createdAt >= lastMonthStart && a.createdAt < thisMonthStart).length;
  const bookingsTrend = bookingsLastMonth > 0 ? Math.round(((bookingsThisMonth - bookingsLastMonth) / bookingsLastMonth) * 100) : 0;
  const newSalonsThisMonth = salons.filter((s) => s.createdAt >= thisMonthStart).length;
  const hiddenReviews = reviews.filter((r) => !r.visible).length;
  const activeSubscriptions = subscriptions.filter((s) => s.status === "active" || s.status === "free_via_loyalty").length;
  const galleryCleanupFailedTickets = eligibleGalleryUploadTickets.filter((ticket) => ticket.cleanupFailureCount > 0);
  const oldestEligibleGalleryUploadTicket = eligibleGalleryUploadTickets.reduce<Date | null>(
    (oldest, ticket) => !oldest || ticket.createdAt < oldest ? ticket.createdAt : oldest,
    null,
  );
  const galleryCleanupOldestEligibleTicketAgeMinutes = oldestEligibleGalleryUploadTicket
    ? Math.max(0, Math.floor((now.getTime() - oldestEligibleGalleryUploadTicket.getTime()) / 60_000))
    : null;

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
    galleryCleanupFailedTickets: galleryCleanupFailedTickets.length,
    galleryCleanupFailureAttempts: galleryCleanupFailedTickets.reduce((total, ticket) => total + ticket.cleanupFailureCount, 0),
    galleryCleanupOldestEligibleTicketAgeMinutes,
    galleryCleanupHasRepeatedFailures: galleryCleanupFailedTickets.some(
      (ticket) => ticket.cleanupFailureCount >= EDUCATION_GALLERY_CLEANUP_ALERT_FAILURE_COUNT,
    ),
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

function educationSettingsView(settings: typeof educationPlatformSettingsTable.$inferSelect) {
  return {
    id: settings.id,
    commissionPercent: settings.commissionPercent,
    reservePercent: settings.reservePercent,
    onlineRefundDays: settings.onlineRefundDays,
    liveAppealDays: settings.liveAppealDays,
    featuredCoursePrice: settings.featuredCoursePrice,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

router.get("/admin/education/settings", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const settings = await getEducationPlatformSettings();
  res.json(educationSettingsView(settings));
});

router.patch("/admin/education/settings", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const featuredCoursePriceRaw = Number(req.body?.featuredCoursePrice);
  const candidate = {
    commissionPercent: Number(req.body?.commissionPercent),
    reservePercent: Number(req.body?.reservePercent),
    onlineRefundDays: Number(req.body?.onlineRefundDays),
    liveAppealDays: Number(req.body?.liveAppealDays),
    featuredCoursePrice: Number.isInteger(featuredCoursePriceRaw) && featuredCoursePriceRaw >= 0 ? featuredCoursePriceRaw : 0,
  };
  if (!Object.values(candidate).every((value) => Number.isInteger(value) && value >= 0)
    || candidate.commissionPercent + candidate.reservePercent > 100
    || candidate.onlineRefundDays > 365 || candidate.liveAppealDays > 365) {
    res.status(400).json({ error: "Proverite procente i rokove. Zbir provizije i rezerve ne može preći 100%." });
    return;
  }
  const currentSettings = await getEducationPlatformSettings();
  const [settings] = await db.update(educationPlatformSettingsTable).set({
    ...candidate, updatedByUserId: user.id, updatedAt: new Date(),
  }).where(eq(educationPlatformSettingsTable.id, currentSettings.id)).returning();
  res.json(educationSettingsView(settings!));
});

router.get("/admin/education/centers", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const [centers, subscriptions, plans, escrows] = await Promise.all([
    db.select().from(educationCentersTable).orderBy(desc(educationCentersTable.createdAt)),
    db.select().from(educationCenterSubscriptionsTable),
    db.select().from(subscriptionPlansTable),
    db.select().from(educationEscrowsTable),
  ]);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  res.json(centers.filter((center) => !status || center.verificationStatus === status).map((center) => {
    const subscription = subscriptions.find((item) => item.centerId === center.id);
    const plan = plans.find((item) => item.id === subscription?.planId);
    const held = escrows.filter((item) => item.centerId === center.id && ["held", "frozen"].includes(item.status)).reduce((sum, item) => sum + item.netAmount, 0);
    return {
      id: center.id, name: center.name, city: center.city, description: center.description, imageUrl: center.imageUrl,
      verificationStatus: center.verificationStatus, verificationNote: center.verificationNote,
      verifiedAt: center.verifiedAt?.toISOString() ?? null, subscriptionStatus: subscription?.status ?? null,
      subscriptionPlanId: subscription?.planId ?? null, subscriptionPlan: plan?.name ?? null, heldAmount: held,
      createdAt: center.createdAt.toISOString(),
    };
  }));
});

router.patch("/admin/education/centers/:centerId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const centerId = String(req.params.centerId);
  const [center] = await db.select().from(educationCentersTable).where(eq(educationCentersTable.id, centerId)).limit(1);
  if (!center) { res.status(404).json({ error: "Edukativni centar nije pronađen." }); return; }
  const verificationStatus = typeof req.body?.verificationStatus === "string" ? req.body.verificationStatus : center.verificationStatus;
  const allowedVerification = ["pending", "verified", "rejected", "suspended"];
  const subscriptionStatus = typeof req.body?.subscriptionStatus === "string" ? req.body.subscriptionStatus : undefined;
  const allowedSubscription = ["trial", "active", "past_due", "cancelled", "suspended", "free_via_loyalty"];
  if (!allowedVerification.includes(verificationStatus) || (subscriptionStatus && !allowedSubscription.includes(subscriptionStatus))) {
    res.status(400).json({ error: "Status nije ispravan." }); return;
  }
  const planId = typeof req.body?.planId === "string" ? req.body.planId : null;
  let updated: typeof center | undefined;
  try {
    await db.transaction(async (tx) => {
      // Verification changes and settlements must share the same center lock.
      // Otherwise a settlement can pass its eligibility check while a revocation
      // is waiting to commit, then create access and financial records anyway.
      await lockEducationCenterFinancials(tx, center.id);
      const [currentCenter] = await tx.select().from(educationCentersTable)
        .where(eq(educationCentersTable.id, center.id))
        .for("update")
        .limit(1);
      if (!currentCenter) throw new Error("Edukativni centar nije pronađen.");
      const currentVerificationStatus = verificationStatus as typeof currentCenter.verificationStatus;
      [updated] = await tx.update(educationCentersTable).set({
        verificationStatus: currentVerificationStatus,
        verificationNote: typeof req.body?.verificationNote === "string" ? req.body.verificationNote.trim().slice(0, 1000) || null : currentCenter.verificationNote,
        verifiedAt: currentVerificationStatus === "verified" ? new Date() : null,
        verifiedByUserId: currentVerificationStatus === "verified" ? user.id : null,
        updatedAt: new Date(),
      }).where(eq(educationCentersTable.id, currentCenter.id)).returning();
      if (subscriptionStatus) {
        const [existing] = await tx.select().from(educationCenterSubscriptionsTable)
          .where(eq(educationCenterSubscriptionsTable.centerId, currentCenter.id))
          .for("update")
          .limit(1);
        if (existing) {
          await tx.update(educationCenterSubscriptionsTable).set({
            status: subscriptionStatus as typeof existing.status,
            ...(planId ? { planId } : {}),
            currentPeriodEnd: subscriptionStatus === "active" ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : existing.currentPeriodEnd,
            updatedAt: new Date(),
          }).where(eq(educationCenterSubscriptionsTable.id, existing.id));
        } else {
          const [fallbackPlan] = planId
            ? await tx.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId)).limit(1)
            : await tx.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.active, true)).limit(1);
          if (!fallbackPlan) throw new Error("Pre aktivacije pretplate mora postojati aktivan plan.");
          await tx.insert(educationCenterSubscriptionsTable).values({
            centerId: currentCenter.id, planId: fallbackPlan.id, status: subscriptionStatus as "trial" | "active" | "past_due" | "cancelled" | "suspended" | "free_via_loyalty",
            dueAmount: fallbackPlan.price, currentPeriodEnd: subscriptionStatus === "active" ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null,
          });
        }
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Izmena centra nije uspela.";
    res.status(message === "Edukativni centar nije pronađen." ? 404 : 409).json({ error: message });
    return;
  }
  void publishCatalogInvalidation(["education-categories"]);
  res.json({ id: updated!.id, verificationStatus: updated!.verificationStatus, verificationNote: updated!.verificationNote, verifiedAt: updated!.verifiedAt?.toISOString() ?? null });
});

router.get("/admin/education/finance", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  await refreshMatureEducationEscrows();
  const centerId = typeof req.query.centerId === "string" ? req.query.centerId : null;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const [escrows, centers, enrollments, courses, disputes, payouts, featuredCharges] = await Promise.all([
    db.select().from(educationEscrowsTable).orderBy(desc(educationEscrowsTable.createdAt)),
    db.select().from(educationCentersTable),
    db.select().from(courseEnrollmentsTable),
    db.select().from(coursesTable),
    db.select().from(educationDisputesTable),
    db.select().from(educationPayoutsTable).orderBy(desc(educationPayoutsTable.createdAt)),
    db.select().from(educationFeaturedChargesTable).orderBy(desc(educationFeaturedChargesTable.createdAt)),
  ]);
  const filtered = escrows.filter((escrow) => (!centerId || escrow.centerId === centerId) && (!status || escrow.status === status));
  const rows = filtered.map((escrow) => {
    const enrollment = enrollments.find((item) => item.id === escrow.enrollmentId);
    const course = courses.find((item) => item.id === enrollment?.courseId);
    const center = centers.find((item) => item.id === escrow.centerId);
    const dispute = disputes.find((item) => item.enrollmentId === escrow.enrollmentId && ["open", "under_review"].includes(item.status));
    return {
      id: escrow.id, enrollmentId: escrow.enrollmentId, centerId: escrow.centerId, centerName: center?.name ?? "Obrisan centar",
      courseTitle: course?.title ?? "Arhivirana edukacija", grossAmount: escrow.grossAmount, platformFee: escrow.platformFee,
      reserveAmount: escrow.reserveAmount, netAmount: escrow.netAmount, status: escrow.status,
      releaseAt: escrow.releaseAt.toISOString(), netPaidAt: escrow.netPaidAt?.toISOString() ?? null,
      reservePaidAt: escrow.reservePaidAt?.toISOString() ?? null, disputeOpen: Boolean(dispute), createdAt: escrow.createdAt.toISOString(),
    };
  });
  res.json({
    summary: {
      held: rows.filter((row) => row.status === "held").reduce((sum, row) => sum + row.netAmount, 0),
      ready: rows.filter((row) => row.status === "ready_for_payout").reduce((sum, row) => sum + row.netAmount, 0),
      frozen: rows.filter((row) => row.status === "frozen").reduce((sum, row) => sum + row.netAmount, 0),
      paidOut: rows.filter((row) => row.status === "paid_out").reduce((sum, row) => sum + row.netAmount, 0),
    },
    escrows: rows,
    pendingEnrollments: enrollments.filter((enrollment) => enrollment.status === "pending" && enrollment.paymentStatus === "pending").map((enrollment) => {
      const course = courses.find((item) => item.id === enrollment.courseId);
      return { id: enrollment.id, courseTitle: course?.title ?? "Arhivirana edukacija", purchaserId: enrollment.purchaserId, amount: course?.price ?? 0, createdAt: enrollment.purchasedAt.toISOString() };
    }),
    payouts: payouts.map((payout) => ({ ...payout, paidAt: payout.paidAt?.toISOString() ?? null, createdAt: payout.createdAt.toISOString() })),
    featuredCharges: featuredCharges
      .filter((charge) => !centerId || charge.centerId === centerId)
      .map((charge) => {
        const course = courses.find((item) => item.id === charge.courseId);
        const center = centers.find((item) => item.id === charge.centerId);
        return {
          id: charge.id, courseId: charge.courseId, courseTitle: course?.title ?? "Arhivirana edukacija",
          centerName: center?.name ?? null, amount: charge.amount, status: charge.status,
          paymentReference: charge.paymentReference, activatedAt: charge.activatedAt.toISOString(),
          settledAt: charge.settledAt?.toISOString() ?? null,
        };
      }),
  });
});

router.post("/admin/education/featured-charges/:chargeId/settle", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const chargeId = String(req.params.chargeId ?? "");
  const paymentReference = typeof req.body?.paymentReference === "string" && req.body.paymentReference.trim().length > 0
    ? req.body.paymentReference.trim().slice(0, 200)
    : null;
  const [charge] = await db.select().from(educationFeaturedChargesTable).where(eq(educationFeaturedChargesTable.id, chargeId)).limit(1);
  if (!charge) { res.status(404).json({ error: "Naplata isticanja nije pronađena." }); return; }
  if (charge.status !== "pending") { res.status(409).json({ error: "Ova naplata isticanja je već obrađena." }); return; }
  const [updated] = await db.update(educationFeaturedChargesTable).set({
    status: "paid", settledByUserId: user.id, settledAt: new Date(),
    paymentReference: paymentReference ?? charge.paymentReference, updatedAt: new Date(),
  }).where(and(eq(educationFeaturedChargesTable.id, charge.id), eq(educationFeaturedChargesTable.status, "pending"))).returning();
  if (!updated) { res.status(409).json({ error: "Ova naplata isticanja je već obrađena." }); return; }
  res.json({
    id: updated.id, courseId: updated.courseId, amount: updated.amount, status: updated.status,
    paymentReference: updated.paymentReference, activatedAt: updated.activatedAt.toISOString(),
    settledAt: updated.settledAt?.toISOString() ?? null,
  });
});

router.post("/admin/education/payouts", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  await refreshMatureEducationEscrows();
  const centerId = typeof req.body?.centerId === "string" ? req.body.centerId : "";
  const includeReserve = req.body?.includeReserve === true;
  if (!centerId) { res.status(400).json({ error: "Izaberite edukativni centar." }); return; }
  if (includeReserve && (new Date().getUTCMonth() + 1) % 3 !== 0) {
    res.status(409).json({ error: "Rezerva se može evidentirati samo tokom poslednjeg meseca kvartala." }); return;
  }
  const today = new Date().toISOString().slice(0, 10);
  let payout: typeof educationPayoutsTable.$inferSelect;
  try {
    payout = await db.transaction(async (tx) => {
      // All financial operations for a center acquire this advisory lock before reading escrow rows.
      // It serializes payout and dispute-resolution decisions even when they target different enrollments.
      await lockEducationCenterFinancials(tx, centerId);
      const openDisputes = await tx.select({ id: educationDisputesTable.id }).from(educationDisputesTable)
        .innerJoin(courseEnrollmentsTable, eq(educationDisputesTable.enrollmentId, courseEnrollmentsTable.id))
        .innerJoin(coursesTable, eq(courseEnrollmentsTable.courseId, coursesTable.id))
        .where(and(eq(coursesTable.centerId, centerId), inArray(educationDisputesTable.status, ["open", "under_review"])));
      if (openDisputes.length) throw new Error("Isplata nije moguća dok centar ima otvoren spor.");
      const ready = await tx.select().from(educationEscrowsTable)
        .where(and(eq(educationEscrowsTable.centerId, centerId), eq(educationEscrowsTable.status, "ready_for_payout"), sql`${educationEscrowsTable.releaseAt} <= now()`))
        .for("update");
      const netEscrows = ready.filter((escrow) => !escrow.netPaidAt);
      const reserveEscrows = includeReserve ? ready.filter((escrow) => !escrow.reservePaidAt) : [];
      const amount = netEscrows.reduce((sum, escrow) => sum + escrow.netAmount, 0) + reserveEscrows.reduce((sum, escrow) => sum + escrow.reserveAmount, 0);
      if (!amount) throw new Error("Nema sredstava podobnih za isplatu.");
    const [created] = await tx.insert(educationPayoutsTable).values({
      centerId, amount, periodStart: today, periodEnd: today, status: "paid",
      reference: typeof req.body?.reference === "string" ? req.body.reference.trim().slice(0, 120) || null : null,
      note: typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) || null : null,
      createdByUserId: user.id, paidAt: new Date(),
    }).returning();
    for (const escrow of netEscrows) {
      const payReserve = reserveEscrows.some((item) => item.id === escrow.id);
      const [claimed] = await tx.update(educationEscrowsTable).set({
        netPaidAt: new Date(), ...(payReserve ? { reservePaidAt: new Date(), status: "paid_out" as const } : { status: "ready_for_payout" as const }), updatedAt: new Date(),
      }).where(and(eq(educationEscrowsTable.id, escrow.id), eq(educationEscrowsTable.status, "ready_for_payout"), sql`${educationEscrowsTable.netPaidAt} is null`, ...(payReserve ? [sql`${educationEscrowsTable.reservePaidAt} is null`] : []))).returning();
      if (!claimed) throw new Error("Escrow više nije podoban za isplatu.");
      await tx.insert(educationLedgerEntriesTable).values({ escrowId: escrow.id, enrollmentId: escrow.enrollmentId, centerId, type: "payout", amount: -escrow.netAmount, note: "Ručna isplata neto iznosa.", actorUserId: user.id, metadata: { payoutId: created!.id } });
      if (payReserve) await tx.insert(educationLedgerEntriesTable).values({ escrowId: escrow.id, enrollmentId: escrow.enrollmentId, centerId, type: "payout", amount: -escrow.reserveAmount, note: "Kvartalna isplata rezerve.", actorUserId: user.id, metadata: { payoutId: created!.id, reserve: true } });
    }
    for (const escrow of reserveEscrows.filter((item) => item.netPaidAt)) {
      const [claimed] = await tx.update(educationEscrowsTable).set({ reservePaidAt: new Date(), status: "paid_out", updatedAt: new Date() })
        .where(and(eq(educationEscrowsTable.id, escrow.id), eq(educationEscrowsTable.status, "ready_for_payout"), sql`${educationEscrowsTable.netPaidAt} is not null`, sql`${educationEscrowsTable.reservePaidAt} is null`)).returning();
      if (!claimed) throw new Error("Rezerva više nije podobna za isplatu.");
      await tx.insert(educationLedgerEntriesTable).values({ escrowId: escrow.id, enrollmentId: escrow.enrollmentId, centerId, type: "payout", amount: -escrow.reserveAmount, note: "Kvartalna isplata rezerve.", actorUserId: user.id, metadata: { payoutId: created!.id, reserve: true } });
    }
    return created!;
    });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Isplata nije moguća." });
    return;
  }
  res.status(201).json({ id: payout.id, centerId: payout.centerId, amount: payout.amount, status: payout.status, paidAt: payout.paidAt?.toISOString() ?? null });
});

router.patch("/admin/education/disputes/:disputeId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const action = typeof req.body?.action === "string" ? req.body.action : "";
  const resolutionNote = typeof req.body?.resolutionNote === "string" ? req.body.resolutionNote.trim().slice(0, 4000) : "";
  if (!["refund", "release", "reject"].includes(action) || !resolutionNote) { res.status(400).json({ error: "Izaberite odluku i unesite obrazloženje." }); return; }
  const [disputePreview] = await db.select().from(educationDisputesTable).where(eq(educationDisputesTable.id, String(req.params.disputeId))).limit(1);
  if (!disputePreview) { res.status(404).json({ error: "Spor nije pronađen." }); return; }
  const [escrowPreview] = await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.enrollmentId, disputePreview.enrollmentId)).limit(1);
  if (!escrowPreview) { res.status(409).json({ error: "Spor nema escrow zapis za rešavanje." }); return; }
  let resolution: { result: typeof educationDisputesTable.$inferSelect; enrollment: typeof courseEnrollmentsTable.$inferSelect };
  let promotedWaiter: typeof educationWaitlistTable.$inferSelect | null = null;
  try {
    resolution = await db.transaction(async (tx) => {
    await lockEducationCenterFinancials(tx, escrowPreview.centerId);
    const [dispute] = await tx.select().from(educationDisputesTable).where(eq(educationDisputesTable.id, disputePreview.id)).for("update").limit(1);
    const [enrollment] = await tx.select().from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, dispute!.enrollmentId)).for("update").limit(1);
    const [escrow] = await tx.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.enrollmentId, dispute!.enrollmentId)).for("update").limit(1);
    if (!dispute || !enrollment || !escrow || !["open", "under_review"].includes(dispute.status)) throw new Error("Spor nije otvoren ili je već rešen.");
    if ((escrow.netPaidAt || escrow.reservePaidAt) && action === "reject") {
      const [rejected] = await tx.update(educationDisputesTable).set({
        status: "rejected", resolutionNote, resolvedByUserId: user.id, resolvedAt: new Date(), updatedAt: new Date(),
      }).where(and(eq(educationDisputesTable.id, dispute.id), inArray(educationDisputesTable.status, ["open", "under_review"]))).returning();
      if (!rejected) throw new Error("Spor je već izmenjen u drugoj operaciji.");
      const reconciledStatus = escrow.reservePaidAt ? "paid_out" : escrow.releaseAt <= new Date() ? "ready_for_payout" : "held";
      if (escrow.status === "frozen") {
        await tx.update(educationEscrowsTable).set({ status: reconciledStatus, updatedAt: new Date() })
          .where(and(eq(educationEscrowsTable.id, escrow.id), eq(educationEscrowsTable.status, "frozen"))).returning();
      }
      await tx.insert(educationFinancialEventsTable).values({
        escrowId: escrow.id, enrollmentId: dispute.enrollmentId, actorUserId: user.id,
        eventType: "dispute_rejected_after_payout", previousStatus: escrow.status, nextStatus: reconciledStatus, note: resolutionNote,
      });
      return { result: rejected, enrollment };
    }
    if (escrow.status !== "frozen" || escrow.netPaidAt || escrow.reservePaidAt) throw new Error("Ovaj escrow više nije u zamrznutom stanju i ne može se rešiti ovom odlukom.");
    const disputeStatus = action === "refund" ? "resolved_refund" : action === "release" ? "resolved_payout" : "rejected";
    const [updatedDispute] = await tx.update(educationDisputesTable).set({
      status: disputeStatus, resolutionNote, resolvedByUserId: user.id, resolvedAt: new Date(), updatedAt: new Date(),
    }).where(and(eq(educationDisputesTable.id, dispute.id), inArray(educationDisputesTable.status, ["open", "under_review"]))).returning();
    if (!updatedDispute) throw new Error("Spor je već izmenjen u drugoj operaciji.");
      const nextStatus = action === "refund" ? "refunded" : escrow.releaseAt <= new Date() ? "ready_for_payout" : "held";
      const [updatedEscrow] = await tx.update(educationEscrowsTable).set({ status: nextStatus, updatedAt: new Date() })
        .where(and(eq(educationEscrowsTable.id, escrow.id), eq(educationEscrowsTable.status, "frozen"), sql`${educationEscrowsTable.netPaidAt} is null`, sql`${educationEscrowsTable.reservePaidAt} is null`)).returning();
      if (!updatedEscrow) throw new Error("Escrow je izmenjen u drugoj finansijskoj operaciji.");
      await tx.insert(educationFinancialEventsTable).values({
        escrowId: escrow.id, enrollmentId: dispute.enrollmentId, actorUserId: user.id,
        eventType: `dispute_${action}`, previousStatus: escrow.status, nextStatus, amount: action === "refund" ? -escrow.grossAmount : null, note: resolutionNote,
      });
      if (action === "refund") {
        await tx.insert(educationLedgerEntriesTable).values({ escrowId: escrow.id, enrollmentId: dispute.enrollmentId, centerId: escrow.centerId, type: "refund", amount: -escrow.grossAmount, note: resolutionNote, actorUserId: user.id });
        await tx.update(courseEnrollmentsTable).set({ paymentStatus: "refunded", status: "cancelled", updatedAt: new Date() }).where(eq(courseEnrollmentsTable.id, enrollment.id));
        // Refunding a live seat frees capacity: release exactly one reserved
        // seat and promote exactly one waiter under this same center lock.
        if (enrollment.sessionId && Boolean((enrollment.auditData as { seatReserved?: boolean } | null)?.seatReserved)) {
          const [refundCourse] = await tx.select().from(coursesTable).where(eq(coursesTable.id, enrollment.courseId)).limit(1);
          if (refundCourse) promotedWaiter = await releaseSeatAndPromoteWaiter(tx, enrollment.sessionId, refundCourse);
        }
      }
    return { result: updatedDispute, enrollment };
    });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Odluka o sporu nije moguća." });
    return;
  }
  if (resolution.enrollment) {
    await sendTransactionalEmail({
      eventKey: `education-dispute:${resolution.result.id}:resolution`,
      emailType: "education_dispute_resolution",
      to: { email: (await db.select().from(usersTable).where(eq(usersTable.id, resolution.enrollment.purchaserId)).limit(1))[0]?.email ?? "", name: "LUMERA korisnik" },
      subject: "LUMERA Edukacije — odluka o prijavljenom problemu",
      htmlContent: lumeraEmailHtml("Odluka o prijavljenom problemu", `<p>${emailSafe(resolutionNote)}</p>`),
      metadata: { disputeId: resolution.result.id, enrollmentId: resolution.result.enrollmentId, action },
    });
  }
  const promoted: typeof educationWaitlistTable.$inferSelect | null = promotedWaiter;
  if (promoted && resolution.enrollment) {
    const [promotedCourse] = await db.select().from(coursesTable).where(eq(coursesTable.id, resolution.enrollment.courseId)).limit(1);
    if (promotedCourse) await notifyPromotedWaiter(promoted, promotedCourse);
  }
  res.json({ id: resolution.result.id, status: resolution.result.status, resolutionNote: resolution.result.resolutionNote, resolvedAt: resolution.result.resolvedAt?.toISOString() ?? null });
});

// Admin: cancel any session with full escrow refund and notifications.
router.post("/admin/education/sessions/:sessionId/cancel", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const sessionId = String(req.params.sessionId ?? "");
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
  if (!reason) { res.status(400).json({ error: "Unesite razlog otkazivanja termina." }); return; }
  const [session] = await db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, sessionId)).limit(1);
  if (!session) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  if (session.cancelledAt) { res.status(409).json({ error: "Termin je već otkazan." }); return; }
  try {
    const result = await cancelEducationSession(sessionId, user.id, reason);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Otkazivanje termina nije uspelo." });
  }
});

// Scheduled-job hook: auto-cancel sessions below minimum enrollment and drain
// expired waitlist offers. Protected by the shared admin session so it can be
// triggered by an authenticated admin or a cron caller.
router.post("/admin/education/sessions/process", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  try {
    const result = await processUpcomingEducationSessions();
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Obrada termina nije uspela." });
  }
});

// ── Admin Salons ──────────────────────────────────────────────────────────────

router.get("/admin/salons", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;

  const normalizedQuery = normalizeBooleanQuery(req.query, ["active", "featured"]);
  if (!normalizedQuery) { res.status(400).json({ error: "Boolean filteri prihvataju samo true ili false." }); return; }
  const parsedQuery = AdminListSalonsQueryParams.safeParse(normalizedQuery);
  if (!parsedQuery.success) { res.status(400).json({ error: parsedQuery.error.message }); return; }
  const { search, city, active, featured, subscriptionStatus } = parsedQuery.data;
  const { limit, offset } = parsePagination(req.query, 50);

  // Push ALL scalar predicates into SQL so they apply before pagination.
  const sqlPredicates = [];
  if (active !== undefined) sqlPredicates.push(eq(salonsTable.active, active));
  if (featured !== undefined) sqlPredicates.push(eq(salonsTable.featured, featured));
  if (city) sqlPredicates.push(eq(sql`lower(${salonsTable.city})`, city.toLowerCase()));
  if (search) {
    const term = `%${search}%`;
    sqlPredicates.push(or(ilike(salonsTable.name, term), ilike(salonsTable.city, term), ilike(salonsTable.email, term))!);
  }
  // subscriptionStatus was previously filtered in JS after LIMIT 500, which could
  // silently drop older matches. Move it into SQL as an EXISTS predicate so it is
  // applied before pagination. Semantics are unchanged: a salon matches when it
  // has a subscription row whose status equals the requested value.
  if (subscriptionStatus) {
    sqlPredicates.push(sql`exists (select 1 from ${subscriptionsTable} where ${subscriptionsTable.salonId} = ${salonsTable.id} and ${subscriptionsTable.status}::text = ${subscriptionStatus})`);
  }

  const salons = await db.select().from(salonsTable)
    .where(sqlPredicates.length ? and(...sqlPredicates) : undefined)
    .orderBy(desc(salonsTable.createdAt), desc(salonsTable.id))
    .limit(limit).offset(offset);

  if (!salons.length) { res.json([]); return; }

  const salonIds = salons.map((s) => s.id);
  const [subs, loyalties] = await Promise.all([
    db.select().from(subscriptionsTable)
      .innerJoin(subscriptionPlansTable, eq(subscriptionsTable.planId, subscriptionPlansTable.id))
      .where(inArray(subscriptionsTable.salonId, salonIds)),
    db.select().from(salonLoyaltyStatusesTable).where(inArray(salonLoyaltyStatusesTable.salonId, salonIds)),
  ]);

  // Fetch only the tier IDs referenced by the returned loyalty rows (not the full table).
  const tierIds = [...new Set(loyalties.flatMap((l) => (l.tierId ? [l.tierId] : [])))];
  const tiers = tierIds.length
    ? await db.select().from(loyaltyTiersTable).where(inArray(loyaltyTiersTable.id, tierIds))
    : [];

  const subBySalonId = new Map(subs.map((sub) => [sub.subscriptions.salonId, sub]));
  const loyaltyBySalonId = new Map(loyalties.map((l) => [l.salonId, l]));
  const tierById = new Map(tiers.map((t) => [t.id, t]));
  const result = salons.map((s) => {
    const sub = subBySalonId.get(s.id);
    const loyalty = loyaltyBySalonId.get(s.id);
    const tier = loyalty?.tierId ? tierById.get(loyalty.tierId) : undefined;
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

  res.json(result);
});

router.get("/admin/salons/:salonId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsedParams = AdminGetSalonParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: parsedParams.error.message }); return; }
  const { salonId } = parsedParams.data;

  const [salon, subscriptions, loyaltyStatuses, orders] = await Promise.all([
    db.select().from(salonsTable).where(eq(salonsTable.id, salonId)).limit(1),
    db.select().from(subscriptionsTable)
      .innerJoin(subscriptionPlansTable, eq(subscriptionsTable.planId, subscriptionPlansTable.id))
      .where(eq(subscriptionsTable.salonId, salonId)),
    db.select().from(salonLoyaltyStatusesTable).where(eq(salonLoyaltyStatusesTable.salonId, salonId)).limit(1),
    db.select().from(ordersTable).where(eq(ordersTable.salonId, salonId)).orderBy(desc(ordersTable.createdAt)).limit(500),
  ]);
  const profile = salon[0];
  if (!profile) { res.status(404).json({ error: "Salon nije pronađen." }); return; }

  const subscription = subscriptions[0];
  const loyalty = loyaltyStatuses[0];
  // Fetch only the specific tier referenced by this salon's loyalty row.
  const tier = loyalty?.tierId
    ? (await db.select().from(loyaltyTiersTable).where(eq(loyaltyTiersTable.id, loyalty.tierId)).limit(1))[0]
    : undefined;
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

  // Only after a successful mutation that can affect salon discovery visibility
  // (active/featured/isVerified/topSalon) do we invalidate the shared catalog
  // "salons" tag consumed by /discovery/home. videoUrl-only changes do not.
  if (active !== undefined || featured !== undefined || isVerified !== undefined || topSalon !== undefined) {
    void publishCatalogInvalidation(["salons"]);
  }

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

  const normalizedQuery = normalizeBooleanQuery(req.query, ["active"]);
  if (!normalizedQuery) { res.status(400).json({ error: "Boolean filter prihvata samo true ili false." }); return; }
  const parsedQuery = AdminListUsersQueryParams.safeParse(normalizedQuery);
  if (!parsedQuery.success) { res.status(400).json({ error: parsedQuery.error.message }); return; }
  const { search, role, active } = parsedQuery.data;
  const { limit, offset } = parsePagination(req.query, 50);

  // Push ALL scalar predicates into SQL so they apply before pagination.
  const sqlPredicates = [];
  if (role) sqlPredicates.push(eq(usersTable.role, role));
  if (active !== undefined) sqlPredicates.push(eq(usersTable.active, active));
  if (search) {
    const term = `%${search}%`;
    sqlPredicates.push(or(
      ilike(usersTable.email, term),
      ilike(usersTable.firstName, term),
      ilike(usersTable.lastName, term),
      sql`lower(${usersTable.firstName} || ' ' || ${usersTable.lastName}) like lower(${term})`,
    )!);
  }

  const users = await db.select().from(usersTable)
    .where(sqlPredicates.length ? and(...sqlPredicates) : undefined)
    .orderBy(desc(usersTable.createdAt), desc(usersTable.id))
    .limit(limit).offset(offset);

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
    catalogCache.getOrLoad(
      "service-categories:all",
      ["service-categories"],
      () => db.select().from(serviceCategoriesTable).orderBy(asc(serviceCategoriesTable.name)),
      600_000,
    ),
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
  // Admin list: no active filter — use a separate cache key from the salon-owner (active-only) list
  const allTemplates = await catalogCache.getOrLoad(
    "service-templates:admin-all",
    ["service-templates"],
    () => db.select().from(serviceTemplatesTable)
      .orderBy(asc(serviceTemplatesTable.mainCategory), asc(serviceTemplatesTable.subcategory), asc(serviceTemplatesTable.name)),
    600_000,
  );
  let templates = allTemplates;
  if (input.mainCategory) templates = templates.filter((t) => t.mainCategory === input.mainCategory);
  if (input.subcategory) templates = templates.filter((t) => t.subcategory === input.subcategory);
  if (input.search) {
    const term = input.search.toLowerCase();
    templates = templates.filter((t) => `${t.name} ${t.mainCategory} ${t.subcategory}`.toLowerCase().includes(term));
  }
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
  void publishCatalogInvalidation(["service-templates"]);
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
  void publishCatalogInvalidation(["service-templates"]);
  res.json(AdminUpdateServiceTemplateResponse.parse(serviceTemplateDto(template!)));
});

router.delete("/admin/service-templates/:templateId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const params = AdminDeleteServiceTemplateParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [template] = await db.delete(serviceTemplatesTable).where(eq(serviceTemplatesTable.id, params.data.templateId)).returning();
  if (!template) { res.status(404).json({ error: "Predložak nije pronađen." }); return; }
  void publishCatalogInvalidation(["service-templates"]);
  res.json(serviceTemplateDto(template));
});

router.post("/admin/service-categories/image-upload-url", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  res.status(410).json({
    error: "Ovaj upload tok je zamenjen validiranim /api/media/uploads tokom. Osvežite administratorsku stranicu.",
  });
});

router.patch("/admin/service-categories/:categoryId", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const params = AdminUpdateServiceCategoryParams.safeParse(req.params);
  const parsed = AdminUpdateServiceCategoryBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [existingCategory] = await db.select().from(serviceCategoriesTable)
    .where(eq(serviceCategoriesTable.id, params.data.categoryId)).limit(1);
  if (!existingCategory) { res.status(404).json({ error: "Kategorija usluge nije pronađena." }); return; }
  const imageUrl = parsed.data.fallbackImageUrl?.trim() || null;
  if (imageUrl && !await canClaimMediaReference({
    userId: user.id,
    url: imageUrl,
    scope: "service-category",
    resourceId: params.data.categoryId,
    existingUrls: [existingCategory.fallbackImageUrl],
  })) {
    res.status(400).json({ error: "Fotografija kategorije nije otpremljena sa ovog administratorskog naloga." }); return;
  }
  let category: typeof serviceCategoriesTable.$inferSelect | undefined;
  try {
    [category] = await db.transaction(async (tx) => {
      if (imageUrl && mediaAssetIdFromUrl(imageUrl) && !await claimMediaReference({
        userId: user.id, url: imageUrl, scope: "service-category", resourceId: params.data.categoryId,
      }, tx)) {
        throw new MediaClaimConflictError();
      }
      return tx.update(serviceCategoriesTable)
        .set({ fallbackImageUrl: imageUrl })
        .where(eq(serviceCategoriesTable.id, params.data.categoryId))
        .returning();
    });
  } catch (error) {
    if (!(error instanceof MediaClaimConflictError)) throw error;
    res.status(409).json({ error: "Fotografija kategorije je u međuvremenu povezana sa drugim zapisom." });
    return;
  }
  if (!category) { res.status(404).json({ error: "Kategorija usluge nije pronađena." }); return; }
  const [serviceCount] = await db.select({ count: count() }).from(servicesTable).where(eq(servicesTable.categoryId, category.id));
  void publishCatalogInvalidation(["service-categories", "salons"]);
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
  // Single self-join: load child and optional parent in one round-trip
  const rows = await db.execute<{ child_id: string; child_name: string; child_parent_id: string | null; parent_name: string | null }>(
    sql`SELECT c.id AS child_id, c.name AS child_name, c.parent_id AS child_parent_id, p.name AS parent_name
        FROM product_categories c
        LEFT JOIN product_categories p ON p.id = c.parent_id
        WHERE c.id = ${categoryId}
        LIMIT 1`,
  );
  const row = rows.rows[0];
  if (!row) return null;
  if (!row.child_parent_id) return { categoryId: row.child_id, categoryName: row.child_name, subcategoryName: null };
  if (!row.parent_name) return null;
  return { categoryId: row.child_id, categoryName: row.parent_name, subcategoryName: row.child_name };
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
  const filters: Parameters<typeof and>[0][] = [];
  if (q.search) filters.push(sql`lower(${productsTable.name} || ' ' || ${productsTable.sku} || ' ' || coalesce(${productsTable.brand}, '') || ' ' || ${productsTable.description}) like ${`%${q.search.toLowerCase()}%`}`);
  if (q.category) filters.push(eq(productsTable.categoryName, q.category));
  if (q.subcategory) filters.push(eq(productsTable.subcategoryName, q.subcategory));
  if (q.brand) filters.push(sql`lower(${productsTable.brand}) = ${q.brand.toLowerCase()}`);
  if (q.status === "in-stock") filters.push(gt(productsTable.stock, 0));
  if (q.status === "out-of-stock") filters.push(sql`${productsTable.stock} <= 0`);
  if (q.status === "new") filters.push(eq(productsTable.isNew, true));
  if (q.status === "on-sale") filters.push(isNotNull(productsTable.discountPrice));
  if (q.status === "inactive") filters.push(eq(productsTable.active, false));
  const whereClause = filters.length ? and(...filters) : undefined;
  const sortBy = q.sortBy ?? "createdAt";
  const sortDir = (q.sortDir ?? "desc") === "asc" ? asc : desc;
  const sortExpr = sortBy === "name" ? sortDir(productsTable.name)
    : sortBy === "price" ? sortDir(sql`coalesce(${productsTable.discountPrice}, ${productsTable.price})`)
    : sortBy === "stock" ? sortDir(productsTable.stock)
    : sortDir(productsTable.createdAt);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const [[countRow], items] = await Promise.all([
    db.select({ count: count() }).from(productsTable).where(whereClause),
    db.select().from(productsTable).where(whereClause).orderBy(sortExpr).limit(pageSize).offset(offset),
  ]);
  const total = Number(countRow?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
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
  const imageReferences = [...new Set([body.imageUrl, ...(body.images ?? [])])];
  const imageOwnership = await Promise.all(imageReferences.map((url) => canClaimMediaReference({
    userId: user.id, url, scope: "product",
  })));
  if (imageOwnership.some((owned) => !owned)) {
    res.status(400).json({ error: "Proizvod sadrži fotografiju koja nije otpremljena sa ovog administratorskog naloga." }); return;
  }
  const [existingSku] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.sku, body.sku)).limit(1);
  if (existingSku) { res.status(409).json({ error: "Proizvod sa ovim SKU već postoji." }); return; }
  let product: typeof productsTable.$inferSelect | undefined;
  try {
    [product] = await db.transaction(async (tx) => {
      const rows = await tx.insert(productsTable).values({
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
      for (const url of imageReferences) {
        if (!await claimMediaReference({
          userId: user.id, url, scope: "product", resourceId: rows[0]!.id,
        }, tx)) {
          throw new MediaClaimConflictError();
        }
      }
      return rows;
    });
  } catch (error) {
    if (!(error instanceof MediaClaimConflictError)) throw error;
    res.status(409).json({ error: "Jedna fotografija je u međuvremenu povezana sa drugim zapisom." });
    return;
  }
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
  const nextImageUrl = body.imageUrl ?? existing.imageUrl;
  const nextImages = body.images ?? existing.images;
  const imageReferences = [...new Set([nextImageUrl, ...nextImages])];
  const imageOwnership = await Promise.all(imageReferences.map((url) => canClaimMediaReference({
    userId: user.id,
    url,
    scope: "product",
    resourceId: existing.id,
    existingUrls: [existing.imageUrl, ...existing.images],
  })));
  if (imageOwnership.some((owned) => !owned)) {
    res.status(400).json({ error: "Proizvod sadrži fotografiju koja nije otpremljena sa ovog administratorskog naloga." }); return;
  }
  let assignment: { categoryId: string; categoryName: string; subcategoryName: string | null } | null = null;
  if (body.categoryId !== undefined) {
    if (!body.categoryId) { res.status(400).json({ error: "Kategorija je obavezna." }); return; }
    assignment = await categoryAssignment(body.categoryId);
    if (!assignment) { res.status(404).json({ error: "Kategorija nije pronađena." }); return; }
  }
  const managedImageReferences = imageReferences.filter((url) => mediaAssetIdFromUrl(url));
  let product: typeof productsTable.$inferSelect | undefined;
  try {
    [product] = await db.transaction(async (tx) => {
      for (const url of managedImageReferences) {
        if (!await claimMediaReference({
          userId: user.id, url, scope: "product", resourceId: existing.id,
        }, tx)) {
          throw new MediaClaimConflictError();
        }
      }
      return tx.update(productsTable).set({
        name: body.name ?? existing.name,
        categoryId: assignment?.categoryId ?? existing.categoryId,
        categoryName: assignment?.categoryName ?? existing.categoryName,
        subcategoryName: assignment ? assignment.subcategoryName : existing.subcategoryName,
        brand: body.brand !== undefined ? body.brand : existing.brand,
        description: body.description ?? existing.description,
        shortDescription: body.shortDescription !== undefined ? body.shortDescription : existing.shortDescription,
        imageUrl: nextImageUrl,
        images: nextImages,
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
    });
  } catch (error) {
    if (!(error instanceof MediaClaimConflictError)) throw error;
    res.status(409).json({ error: "Jedna fotografija je u međuvremenu povezana sa drugim zapisom." });
    return;
  }
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
  if (body.imageUrl && !await canClaimMediaReference({ userId: user.id, url: body.imageUrl, scope: "product-category" })) {
    res.status(400).json({ error: "Fotografija kategorije nije otpremljena sa ovog administratorskog naloga." }); return;
  }
  const slug = slugify(body.name);
  const [nameTaken] = await db.select({ id: productCategoriesTable.id }).from(productCategoriesTable).where(eq(productCategoriesTable.name, body.name)).limit(1);
  if (nameTaken) { res.status(409).json({ error: "Kategorija sa ovim nazivom već postoji." }); return; }
  if (body.parentId) {
    const [parent] = await db.select().from(productCategoriesTable).where(eq(productCategoriesTable.id, body.parentId)).limit(1);
    if (!parent) { res.status(404).json({ error: "Nadređena kategorija nije pronađena." }); return; }
    if (parent.parentId) { res.status(400).json({ error: "Podkategorija ne može imati sopstvene podkategorije." }); return; }
  }
  let cat: typeof productCategoriesTable.$inferSelect | undefined;
  try {
    [cat] = await db.transaction(async (tx) => {
      const rows = await tx.insert(productCategoriesTable).values({
        name: body.name,
        slug,
        parentId: body.parentId ?? null,
        sortOrder: body.sortOrder ?? 0,
        icon: body.icon ?? null,
        imageUrl: body.imageUrl ?? null,
        active: body.active ?? true,
      }).returning();
      if (body.imageUrl && !await claimMediaReference({
        userId: user.id, url: body.imageUrl, scope: "product-category", resourceId: rows[0]!.id,
      }, tx)) {
        throw new MediaClaimConflictError();
      }
      return rows;
    });
  } catch (error) {
    if (!(error instanceof MediaClaimConflictError)) throw error;
    res.status(409).json({ error: "Fotografija kategorije je u međuvremenu povezana sa drugim zapisom." });
    return;
  }
  void publishCatalogInvalidation(["product-categories"]);
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
  const nextCategoryImageUrl = body.imageUrl !== undefined ? body.imageUrl : existing.imageUrl;
  if (nextCategoryImageUrl && !await canClaimMediaReference({
    userId: user.id,
    url: nextCategoryImageUrl,
    scope: "product-category",
    resourceId: existing.id,
    existingUrls: [existing.imageUrl],
  })) {
    res.status(400).json({ error: "Fotografija kategorije nije otpremljena sa ovog administratorskog naloga." }); return;
  }
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
  let cat: typeof productCategoriesTable.$inferSelect | undefined;
  try {
    [cat] = await db.transaction(async (tx) => {
      if (nextCategoryImageUrl && mediaAssetIdFromUrl(nextCategoryImageUrl) && !await claimMediaReference({
        userId: user.id, url: nextCategoryImageUrl, scope: "product-category", resourceId: existing.id,
      }, tx)) {
        throw new MediaClaimConflictError();
      }
      const [updated] = await tx.update(productCategoriesTable).set({
        name: newName,
        slug: body.name && body.name !== existing.name ? slugify(body.name) : existing.slug,
        parentId: newParentId,
        sortOrder: body.sortOrder ?? existing.sortOrder,
        icon: body.icon !== undefined ? body.icon : existing.icon,
        imageUrl: nextCategoryImageUrl,
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
  } catch (error) {
    if (!(error instanceof MediaClaimConflictError)) throw error;
    res.status(409).json({ error: "Fotografija kategorije je u međuvremenu povezana sa drugim zapisom." });
    return;
  }
  void publishCatalogInvalidation(["product-categories"]);
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
  void publishCatalogInvalidation(["product-categories"]);
  res.sendStatus(204);
});

// ── Admin Brands ──────────────────────────────────────────────────────────────

router.get("/admin/brands", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const [brands, products] = await Promise.all([
    catalogCache.getOrLoad(
      "admin-brands:all",
      ["product-brands"],
      () => db.select().from(productBrandsTable).orderBy(asc(productBrandsTable.name)),
      600_000,
    ),
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
  void publishCatalogInvalidation(["product-brands"]);
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
  void publishCatalogInvalidation(["product-brands"]);
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
    void publishCatalogInvalidation(["product-brands"]);
    res.json({ id: deactivated!.id, name: deactivated!.name, slug: deactivated!.slug, description: deactivated!.description, logoUrl: deactivated!.logoUrl ?? null, active: deactivated!.active, productCount: inProducts?.count ?? 0 });
    return;
  }
  await db.delete(productBrandsTable).where(eq(productBrandsTable.id, brandId));
  void publishCatalogInvalidation(["product-brands"]);
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
