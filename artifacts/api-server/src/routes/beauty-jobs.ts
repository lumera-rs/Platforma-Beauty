import { Router } from "express";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import {
  beautyJobCategoriesTable, beautyJobContactsTable, beautyJobListingAvailabilityTable,
  beautyJobListingsTable, beautyJobNotificationsTable, beautyJobPlatformSettingsTable,
  beautyJobRentalRequestsTable, beautyJobRentalSlotsTable, beautyJobReportsTable,
  beautyJobSavedListingsTable, db, salonsTable, usersTable,
} from "@workspace/db";
import {
  CloseBeautyJobParams, CloseBeautyJobResponse,
  ContactBeautyJobAuthorBody, ContactBeautyJobAuthorParams, ContactBeautyJobAuthorResponse,
  CreateBeautyJobRentalRequestBody, CreateBeautyJobRentalRequestParams,
  CreateBeautyJobRentalRequestResponse,
  CreateBeautyJobBody, CreateBeautyJobResponse,
  GetBeautyJobModerationQueueResponse, GetBeautyJobParams, GetBeautyJobResponse,
  GetBeautyJobDeliveryIssuesResponse,
  GetBeautyJobSettingsResponse, ListBeautyJobCategoriesResponse,
  ListBeautyJobInboxResponse, ListBeautyJobNotificationsResponse,
  ListBeautyJobRentalRequestInboxResponse, ListMyBeautyJobRentalRequestsResponse,
  ListBeautyJobsQueryParams, ListBeautyJobsResponse, ListMyBeautyJobsResponse,
  ListSavedBeautyJobsResponse, MarkBeautyJobNotificationReadParams,
  MarkBeautyJobNotificationReadResponse, ModerateBeautyJobBody,
  ModerateBeautyJobParams, ModerateBeautyJobResponse, RenewBeautyJobParams,
  RenewBeautyJobResponse, ReplyToBeautyJobContactBody,
  ReplyToBeautyJobContactParams, ReplyToBeautyJobContactResponse,
  ReportBeautyJobBody, ReportBeautyJobParams, ReportBeautyJobResponse,
  RetryBeautyJobDeliveryParams, RetryBeautyJobDeliveryResponse,
  RespondToBeautyJobRentalRequestBody, RespondToBeautyJobRentalRequestParams,
  RespondToBeautyJobRentalRequestResponse,
  ResolveBeautyJobReportBody, ResolveBeautyJobReportParams,
  ResolveBeautyJobReportResponse, SweepExpiredBeautyJobsResponse,
  ToggleSavedBeautyJobParams, ToggleSavedBeautyJobResponse,
  UpdateBeautyJobBody, UpdateBeautyJobParams, UpdateBeautyJobResponse,
  UpdateBeautyJobSettingsBody, UpdateBeautyJobSettingsResponse,
} from "@workspace/api-zod";
import { getCurrentUser, isAdmin } from "../lib/auth";
import { attachReadyImageAssets } from "./image-media";
import { expireBeautyJobListings } from "../lib/beauty-jobs-maintenance";
import {
  deliverBeautyJobEmail,
  enqueueBeautyJobEmail,
  retryBeautyJobEmailDelivery,
} from "../lib/beauty-jobs-email";
import { listBeautyJobDeliveryIssues } from "../lib/beauty-jobs-delivery-monitor";

const router = Router();
type BeautyJobTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const RENTAL_TYPES = new Set(["equipment_rental", "space_rental"]);
const MANAGED_URL = /^\/api\/media\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bad(res: import("express").Response, message = "Neispravan zahtev.") { res.status(400).json({ error: message, code: "VALIDATION_ERROR" }); }
async function session(req: import("express").Request, res: import("express").Response) {
  const user = await getCurrentUser(req);
  if (user?.role === "SALON_EMPLOYEE") { res.status(403).json({ error: "Pristup modulu nije dozvoljen.", code: "FORBIDDEN" }); return undefined; }
  return user;
}
async function authenticated(req: import("express").Request, res: import("express").Response) {
  const user = await session(req, res);
  if (!user) { if (!res.headersSent) res.status(401).json({ error: "Potrebna je prijava.", code: "UNAUTHORIZED" }); return undefined; }
  return user;
}
async function ownerSalon(user: typeof usersTable.$inferSelect) {
  if (user.role !== "SALON_OWNER" || !user.activeSalonId) return undefined;
  const [salon] = await db.select().from(salonsTable).where(and(eq(salonsTable.id, user.activeSalonId), eq(salonsTable.ownerId, user.id))).limit(1);
  return salon;
}
function validPhotos(photos: string[] | undefined) { return !photos || (photos.length <= 8 && photos.every((p) => MANAGED_URL.test(p))); }
function ensureCompatibility(categorySlug: string, type: string, availability?: string | null) {
  const rentalCategory = categorySlug === "iznajmljivanje-opreme" || categorySlug === "iznajmljivanje-prostora-stolice";
  if (RENTAL_TYPES.has(type) !== rentalCategory) return "Tip oglasa nije kompatibilan sa kategorijom.";
  if (RENTAL_TYPES.has(type) && !availability?.trim()) return "Za iznajmljivanje je obavezna dostupnost.";
  return undefined;
}
async function settings() {
  const [row] = await db.select().from(beautyJobPlatformSettingsTable).orderBy(desc(beautyJobPlatformSettingsTable.updatedAt)).limit(1);
  if (row) return row;
  const [created] = await db.insert(beautyJobPlatformSettingsTable).values({}).returning();
  return created!;
}
const listingSelect = {
  listing: beautyJobListingsTable, categorySlug: beautyJobCategoriesTable.slug,
  categoryName: beautyJobCategoriesTable.name, availabilityPattern: beautyJobListingAvailabilityTable.availabilityPattern,
  dayLabels: beautyJobListingAvailabilityTable.dayLabels,
  authorDisplayName: sql<string>`coalesce(${salonsTable.name}, ${usersTable.firstName} || ' ' || ${usersTable.lastName})`,
};
type RentalSlotView = {
  id: string;
  listingId: string;
  startsAt: string;
  endsAt: string;
  available: boolean;
};

function view(
  row: typeof beautyJobListingsTable.$inferSelect & { categorySlug: string; categoryName: string; availabilityPattern: string | null; dayLabels: string[] | null; authorDisplayName: string; isSaved?: boolean; isOwner?: boolean },
  availableSlots: RentalSlotView[] = [],
) {
  return {
    ...row, categorySlug: row.categorySlug, categoryName: row.categoryName,
    availabilityPattern: row.availabilityPattern ?? null, dayLabels: row.dayLabels ?? [],
    authorDisplayName: row.authorDisplayName, isSaved: row.isSaved ?? false, isOwner: row.isOwner ?? false,
    latitude: RENTAL_TYPES.has(row.type) ? null : row.latitude,
    longitude: RENTAL_TYPES.has(row.type) ? null : row.longitude,
    expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    availableSlots,
  };
}

async function rentalSlotsByListing(listingIds: string[]) {
  const result = new Map<string, RentalSlotView[]>();
  if (!listingIds.length) return result;
  const rows = await db.select({
    slot: beautyJobRentalSlotsTable,
    booked: sql<boolean>`${beautyJobRentalRequestsTable.id} is not null`,
  }).from(beautyJobRentalSlotsTable)
    .leftJoin(beautyJobRentalRequestsTable, and(
      eq(beautyJobRentalRequestsTable.slotId, beautyJobRentalSlotsTable.id),
      eq(beautyJobRentalRequestsTable.status, "accepted"),
    ))
    .where(and(inArray(beautyJobRentalSlotsTable.listingId, listingIds), sql`${beautyJobRentalSlotsTable.endsAt} > now()`))
    .orderBy(asc(beautyJobRentalSlotsTable.startsAt));
  for (const row of rows) {
    const slots = result.get(row.slot.listingId) ?? [];
    slots.push({
      id: row.slot.id,
      listingId: row.slot.listingId,
      startsAt: row.slot.startsAt.toISOString(),
      endsAt: row.slot.endsAt.toISOString(),
      available: !row.booked && row.slot.startsAt.getTime() > Date.now(),
    });
    result.set(row.slot.listingId, slots);
  }
  return result;
}

function rentalSlotValidation(slots: Array<{ id?: string; startsAt: Date; endsAt: Date }> | undefined, required: boolean, allowPastIds = new Set<string>()) {
  if (required && !slots?.length) return "Dodajte bar jedan konkretan termin za iznajmljivanje.";
  if (!slots) return undefined;
  const sorted = [...slots].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (let i = 0; i < sorted.length; i += 1) {
    const slot = sorted[i]!;
    if (slot.startsAt.getTime() <= Date.now() && (!slot.id || !allowPastIds.has(slot.id))) return "Termini moraju počinjati u budućnosti.";
    if (slot.endsAt.getTime() <= slot.startsAt.getTime()) return "Kraj termina mora biti posle početka.";
    if (i > 0 && slot.startsAt.getTime() < sorted[i - 1]!.endsAt.getTime()) return "Termini se ne smeju preklapati.";
  }
  return undefined;
}

function rentalRequestView(
  row: typeof beautyJobRentalRequestsTable.$inferSelect,
  context: { listingTitle: string; applicantDisplayName: string; startsAt: Date; endsAt: Date },
) {
  return {
    ...row,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    listingTitle: context.listingTitle,
    applicantDisplayName: context.applicantDisplayName,
    startsAt: context.startsAt.toISOString(),
    endsAt: context.endsAt.toISOString(),
  };
}
function contactView(
  row: typeof beautyJobContactsTable.$inferSelect,
  context?: { listingTitle?: string; applicantDisplayName?: string },
) {
  return {
    ...row,
    repliedAt: row.repliedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...context,
  };
}
function reportView(
  row: typeof beautyJobReportsTable.$inferSelect,
  context?: { listingTitle?: string; authorSalonId?: string | null; authorUserId?: string | null },
) {
  return {
    ...row,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    ...context,
  };
}
function notificationView(row: typeof beautyJobNotificationsTable.$inferSelect) {
  return {
    ...row,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
function settingsView(row: typeof beautyJobPlatformSettingsTable.$inferSelect) {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}
function listingQuery(viewer?: { id: string; salonId?: string }) {
  const savedUserId = viewer?.id ?? "00000000-0000-0000-0000-000000000000";
  const isOwner = viewer
    ? viewer.salonId
      ? sql<boolean>`(${beautyJobListingsTable.salonId} = ${viewer.salonId} or ${beautyJobListingsTable.userId} = ${viewer.id})`
      : sql<boolean>`${beautyJobListingsTable.userId} = ${viewer.id}`
    : sql<boolean>`false`;
  return db.select({ ...listingSelect, isSaved: sql<boolean>`${beautyJobSavedListingsTable.listingId} is not null`, isOwner }).from(beautyJobListingsTable)
    .innerJoin(beautyJobCategoriesTable, eq(beautyJobListingsTable.categoryId, beautyJobCategoriesTable.id))
    .leftJoin(beautyJobListingAvailabilityTable, eq(beautyJobListingAvailabilityTable.listingId, beautyJobListingsTable.id))
    .leftJoin(salonsTable, eq(beautyJobListingsTable.salonId, salonsTable.id))
    .leftJoin(usersTable, eq(beautyJobListingsTable.userId, usersTable.id))
    .leftJoin(beautyJobSavedListingsTable, and(eq(beautyJobSavedListingsTable.listingId, beautyJobListingsTable.id), eq(beautyJobSavedListingsTable.userId, savedUserId)));
}
async function canManage(user: typeof usersTable.$inferSelect, listing: typeof beautyJobListingsTable.$inferSelect) {
  if (isAdmin(user)) return true;
  if (listing.userId) return listing.userId === user.id;
  const salon = await ownerSalon(user);
  return salon?.id === listing.salonId;
}
async function notification(recipientUserId: string, type: string, title: string, body: string, listingId?: string, contactId?: string) {
  const [created] = await db.insert(beautyJobNotificationsTable).values({ recipientUserId, type, title, body, listingId, contactId }).returning();
  return created;
}
async function listingRecipient(listing: typeof beautyJobListingsTable.$inferSelect) {
  if (listing.userId) return listing.userId;
  const [salon] = listing.salonId ? await db.select({ ownerId: salonsTable.ownerId }).from(salonsTable).where(eq(salonsTable.id, listing.salonId)).limit(1) : [];
  return salon?.ownerId;
}
async function transactionListingRecipient(
  tx: BeautyJobTransaction,
  listing: typeof beautyJobListingsTable.$inferSelect,
) {
  if (listing.userId) return listing.userId;
  const [salon] = listing.salonId
    ? await tx.select({ ownerId: salonsTable.ownerId }).from(salonsTable)
      .where(eq(salonsTable.id, listing.salonId)).limit(1)
    : [];
  return salon?.ownerId;
}
async function lockBeautyJobEvent(tx: BeautyJobTransaction, id: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${id}, 0))`);
}

router.get("/beauty-jobs/categories", async (req, res, next) => { try {
  if (await session(req, res) === undefined && res.headersSent) return;
  const categories = await db.select().from(beautyJobCategoriesTable).where(eq(beautyJobCategoriesTable.enabled, true)).orderBy(asc(beautyJobCategoriesTable.name));
  res.json(ListBeautyJobCategoriesResponse.parse({ categories: categories.map((category) => ({ id: category.id, slug: category.slug, name: category.name, subtypeLabels: category.subtypeLabels, featureFlag: category.featureFlag })) }));
} catch (e) { next(e); } });

router.get("/beauty-jobs", async (req, res, next) => { try {
  const viewer = await session(req, res); if (viewer === undefined && res.headersSent) return;
  const viewerSalon = viewer?.role === "SALON_OWNER" ? await ownerSalon(viewer) : undefined;
  const parsed = ListBeautyJobsQueryParams.safeParse(req.query); if (!parsed.success) return bad(res);
  const q = parsed.data; const page = q.page ?? 1; const pageSize = q.pageSize ?? 24;
  const conditions = [eq(beautyJobListingsTable.status, "active"), eq(beautyJobListingsTable.moderationStatus, "approved"), eq(beautyJobCategoriesTable.enabled, true), sql`${beautyJobListingsTable.expiresAt} > now()`];
  if (q.category) conditions.push(eq(beautyJobCategoriesTable.slug, q.category));
  if (q.type) conditions.push(eq(beautyJobListingsTable.type, q.type));
  if (q.intent) conditions.push(eq(beautyJobListingsTable.intent, q.intent));
  if (q.minPrice !== undefined && q.maxPrice !== undefined && q.minPrice > q.maxPrice) return bad(res, "Minimalna cena ne može biti veća od maksimalne.");
  if ((q.latitude === undefined) !== (q.longitude === undefined)) return bad(res, "Latitude i longitude se navode zajedno.");
  if (q.city) conditions.push(ilike(beautyJobListingsTable.city, `%${q.city}%`));
  if (q.region) conditions.push(ilike(beautyJobListingsTable.region, `%${q.region}%`));
  if (q.minPrice !== undefined) conditions.push(sql`${beautyJobListingsTable.priceAmount} >= ${q.minPrice}`);
  if (q.maxPrice !== undefined) conditions.push(sql`${beautyJobListingsTable.priceAmount} <= ${q.maxPrice}`);
  if (q.availability) conditions.push(ilike(beautyJobListingAvailabilityTable.availabilityPattern, `%${q.availability}%`));
  if (q.query) conditions.push(or(ilike(beautyJobListingsTable.title, `%${q.query}%`), ilike(beautyJobListingsTable.description, `%${q.query}%`))!);
  const where = and(...conditions);
  const order = q.sort === "oldest" ? asc(beautyJobListingsTable.createdAt)
    : q.sort === "price_asc" ? asc(beautyJobListingsTable.priceAmount)
    : q.sort === "price_desc" ? desc(beautyJobListingsTable.priceAmount)
    : q.sort === "nearest" && q.latitude !== undefined && q.longitude !== undefined
      ? sql`(${beautyJobListingsTable.latitude} - ${q.latitude}) * (${beautyJobListingsTable.latitude} - ${q.latitude}) + (${beautyJobListingsTable.longitude} - ${q.longitude}) * (${beautyJobListingsTable.longitude} - ${q.longitude}) asc nulls last`
      : desc(beautyJobListingsTable.createdAt);
  const [items, totals] = await Promise.all([
    listingQuery(viewer ? { id: viewer.id, salonId: viewerSalon?.id } : undefined).where(where).orderBy(order).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(beautyJobListingsTable).innerJoin(beautyJobCategoriesTable, eq(beautyJobListingsTable.categoryId, beautyJobCategoriesTable.id)).leftJoin(beautyJobListingAvailabilityTable, eq(beautyJobListingAvailabilityTable.listingId, beautyJobListingsTable.id)).where(where),
  ]);
  res.json(ListBeautyJobsResponse.parse({ items: items.map((r) => view({ ...r.listing, ...r })), total: totals[0]?.total ?? 0, page, pageSize }));
} catch (e) { next(e); } });

router.post("/beauty-jobs", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return;
  if (isAdmin(user) || !["CUSTOMER", "SALON_OWNER"].includes(user.role)) return res.status(403).json({ error: "Objavljivanje nije dozvoljeno.", code: "FORBIDDEN" });
  const body = CreateBeautyJobBody.safeParse(req.body); if (!body.success || !validPhotos(body.data?.photos)) return bad(res);
  if (RENTAL_TYPES.has(body.data.type) && (body.data.latitude !== undefined || body.data.longitude !== undefined)) {
    return res.status(400).json({ error: "Precizne koordinate nisu dozvoljene za oglase o iznajmljivanju.", code: "RENTAL_COORDINATES_NOT_ALLOWED" });
  }
  const [category] = await db.select().from(beautyJobCategoriesTable).where(and(eq(beautyJobCategoriesTable.id, body.data.categoryId), eq(beautyJobCategoriesTable.enabled, true))).limit(1);
  if (!category) return bad(res, "Kategorija nije dostupna."); const compatibility = ensureCompatibility(category.slug, body.data.type, body.data.availabilityPattern); if (compatibility) return bad(res, compatibility);
  const requiresSlots = RENTAL_TYPES.has(body.data.type) && body.data.intent === "offering";
  const slotError = rentalSlotValidation(body.data.availableSlots, requiresSlots); if (slotError) return bad(res, slotError);
  const cfg = await settings(); const authorSalon = user.role === "SALON_OWNER" ? await ownerSalon(user) : undefined;
  if (user.role === "SALON_OWNER" && !authorSalon) return res.status(403).json({ error: "Aktivan salon nije dostupan.", code: "FORBIDDEN" });
  const since = new Date(Date.now() - 3600000);
  const authorFilter = authorSalon ? eq(beautyJobListingsTable.salonId, authorSalon.id) : eq(beautyJobListingsTable.userId, user.id);
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`beauty-job-post:${user.id}`}))`);
    const [recent] = await tx.select({ total: count() }).from(beautyJobListingsTable).where(and(authorFilter, sql`${beautyJobListingsTable.createdAt} >= ${since}`));
    if ((recent?.total ?? 0) >= cfg.hourlyPostingLimit) return null;
    const { availabilityPattern: _availabilityPattern, dayLabels: _dayLabels, availableSlots: _availableSlots, ...listingData } = body.data;
    const [l] = await tx.insert(beautyJobListingsTable).values({ ...listingData, salonId: authorSalon?.id, userId: authorSalon ? null : user.id, postedByType: authorSalon ? "salon" : "user", photos: body.data.photos ?? [], expiresAt: new Date(Date.now() + cfg.listingExpiryDays * 86400000) }).returning();
    if (RENTAL_TYPES.has(body.data.type)) await tx.insert(beautyJobListingAvailabilityTable).values({ listingId: l!.id, availabilityPattern: body.data.availabilityPattern!, dayLabels: body.data.dayLabels ?? [] });
    if (requiresSlots && body.data.availableSlots?.length) {
      await tx.insert(beautyJobRentalSlotsTable).values(body.data.availableSlots.map((slot) => ({ listingId: l!.id, startsAt: slot.startsAt, endsAt: slot.endsAt })));
    }
    await attachReadyImageAssets(tx, user.id, body.data.photos ?? []); return l!;
  });
  if (!created) return res.status(429).json({ error: "Previše objava. Pokušajte kasnije.", code: "RATE_LIMITED" });
  const [row] = await listingQuery({ id: user.id, salonId: authorSalon?.id }).where(eq(beautyJobListingsTable.id, created.id)).limit(1);
  const slotMap = await rentalSlotsByListing([created.id]);
  res.status(201).json(CreateBeautyJobResponse.parse(view({ ...row!.listing, ...row! }, slotMap.get(created.id))));
} catch (e) { next(e); } });

router.get("/beauty-jobs/mine", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return; const salon = await ownerSalon(user);
  const where = salon ? eq(beautyJobListingsTable.salonId, salon.id) : eq(beautyJobListingsTable.userId, user.id);
  const items = await listingQuery({ id: user.id, salonId: salon?.id }).where(where).orderBy(desc(beautyJobListingsTable.createdAt));
  const slotMap = await rentalSlotsByListing(items.map((item) => item.listing.id));
  res.json(ListMyBeautyJobsResponse.parse({ items: items.map((r) => view({ ...r.listing, ...r }, slotMap.get(r.listing.id))), total: items.length, page: 1, pageSize: items.length }));
} catch (e) { next(e); } });

router.patch("/beauty-jobs/:listingId", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return; const p = UpdateBeautyJobParams.safeParse(req.params), b = UpdateBeautyJobBody.safeParse(req.body); if (!p.success || !b.success || !validPhotos(b.data.photos)) return bad(res);
  const [existing] = await db.select().from(beautyJobListingsTable).where(eq(beautyJobListingsTable.id, p.data.listingId)).limit(1); if (!existing) return res.status(404).json({ error: "Oglas nije pronađen.", code: "NOT_FOUND" });
  if (!(await canManage(user, existing))) return res.status(403).json({ error: "Nije dozvoljeno.", code: "FORBIDDEN" });
  const slotConflict = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`beauty-job-rental-listing:${existing.id}`}))`);
    const [lockedListing] = await tx.select().from(beautyJobListingsTable).where(eq(beautyJobListingsTable.id, existing.id)).for("update").limit(1);
    if (!lockedListing) return "VALIDATION:Oglas nije pronađen.";
    const [lockedAvailability] = await tx.select({ pattern: beautyJobListingAvailabilityTable.availabilityPattern, dayLabels: beautyJobListingAvailabilityTable.dayLabels }).from(beautyJobListingAvailabilityTable).where(eq(beautyJobListingAvailabilityTable.listingId, existing.id)).limit(1);
    const categoryId = b.data.categoryId ?? lockedListing.categoryId;
    const [category] = await tx.select().from(beautyJobCategoriesTable).where(and(eq(beautyJobCategoriesTable.id, categoryId), eq(beautyJobCategoriesTable.enabled, true))).limit(1);
    const type = b.data.type ?? lockedListing.type;
    const intent = b.data.intent ?? lockedListing.intent;
    const pattern = b.data.availabilityPattern ?? lockedAvailability?.pattern;
    const compatibility = !category ? "Kategorija nije pronađena." : ensureCompatibility(category.slug, type, pattern);
    if (compatibility) return `VALIDATION:${compatibility}`;
    const requiresSlots = RENTAL_TYPES.has(type) && intent === "offering";
    if (RENTAL_TYPES.has(type) && ((b.data.latitude !== undefined && b.data.latitude !== null) || (b.data.longitude !== undefined && b.data.longitude !== null))) {
      return "COORDINATES:Precizne koordinate nisu dozvoljene za oglase o iznajmljivanju.";
    }
    const existingSlots = await tx.select().from(beautyJobRentalSlotsTable).where(eq(beautyJobRentalSlotsTable.listingId, existing.id)).for("update");
    const requested = existingSlots.length ? await tx.selectDistinct({ slotId: beautyJobRentalRequestsTable.slotId })
      .from(beautyJobRentalRequestsTable)
      .where(inArray(beautyJobRentalRequestsTable.slotId, existingSlots.map((slot) => slot.id))) : [];
    const requestedIds = new Set(requested.map((row) => row.slotId));
    if (!requiresSlots && requestedIds.size) return "Termini sa zahtevima sprečavaju promenu tipa ovog oglasa.";
    if (requiresSlots && b.data.availableSlots !== undefined) {
      const existingById = new Map(existingSlots.map((slot) => [slot.id, slot]));
      if (b.data.availableSlots.some((slot) => slot.id && !existingById.has(slot.id))) return "Jedan od termina ne pripada ovom oglasu.";
      const incomingIds = new Set(b.data.availableSlots.flatMap((slot) => slot.id ? [slot.id] : []));
      for (const slot of b.data.availableSlots) {
        if (!slot.id || !requestedIds.has(slot.id)) continue;
        const current = existingById.get(slot.id)!;
        if (current.startsAt.getTime() !== slot.startsAt.getTime() || current.endsAt.getTime() !== slot.endsAt.getTime()) {
          return "Termin sa postojećim zahtevom ne može se menjati.";
        }
      }
      const retainedRequested = existingSlots.filter((slot) => requestedIds.has(slot.id) && !incomingIds.has(slot.id));
      if (retainedRequested.some((slot) => slot.startsAt.getTime() > Date.now())) {
        return "Termin sa postojećim zahtevom ne može se ukloniti.";
      }
      const resultingSlots = [
        ...b.data.availableSlots,
        ...retainedRequested.map((slot) => ({ id: slot.id, startsAt: slot.startsAt, endsAt: slot.endsAt })),
      ];
      const validation = rentalSlotValidation(resultingSlots, true, requestedIds);
      if (validation) return `VALIDATION:${validation}`;
      const deletable = existingSlots.filter((slot) => !incomingIds.has(slot.id) && !requestedIds.has(slot.id)).map((slot) => slot.id);
      if (deletable.length) await tx.delete(beautyJobRentalSlotsTable).where(inArray(beautyJobRentalSlotsTable.id, deletable));
      for (const slot of b.data.availableSlots) {
        if (slot.id) {
          if (!requestedIds.has(slot.id)) {
            await tx.update(beautyJobRentalSlotsTable).set({ startsAt: slot.startsAt, endsAt: slot.endsAt, updatedAt: new Date() }).where(eq(beautyJobRentalSlotsTable.id, slot.id));
          }
        } else {
          await tx.insert(beautyJobRentalSlotsTable).values({ listingId: existing.id, startsAt: slot.startsAt, endsAt: slot.endsAt });
        }
      }
    } else if (requiresSlots && existingSlots.length === 0) {
      return "VALIDATION:Dodajte bar jedan konkretan termin za iznajmljivanje.";
    } else if (!requiresSlots && existingSlots.length) {
      await tx.delete(beautyJobRentalSlotsTable).where(eq(beautyJobRentalSlotsTable.listingId, existing.id));
    }
    const { availabilityPattern: _availabilityPattern, dayLabels: _dayLabels, availableSlots: _availableSlots, ...listingUpdates } = b.data;
    await tx.update(beautyJobListingsTable).set({
      ...listingUpdates,
      photos: b.data.photos ?? lockedListing.photos,
      latitude: RENTAL_TYPES.has(type) ? null : b.data.latitude,
      longitude: RENTAL_TYPES.has(type) ? null : b.data.longitude,
      moderationStatus: "pending",
      status: lockedListing.status === "rejected" ? "active" : lockedListing.status,
      updatedAt: new Date(),
    }).where(eq(beautyJobListingsTable.id, existing.id));
    if (RENTAL_TYPES.has(type)) {
      await tx.insert(beautyJobListingAvailabilityTable).values({ listingId: existing.id, availabilityPattern: pattern!, dayLabels: b.data.dayLabels ?? lockedAvailability?.dayLabels ?? [] }).onConflictDoUpdate({ target: beautyJobListingAvailabilityTable.listingId, set: { availabilityPattern: pattern!, dayLabels: b.data.dayLabels ?? lockedAvailability?.dayLabels ?? [], updatedAt: new Date() } });
    } else {
      await tx.delete(beautyJobListingAvailabilityTable).where(eq(beautyJobListingAvailabilityTable.listingId, existing.id));
    }
    await attachReadyImageAssets(tx, user.id, b.data.photos?.filter((x) => !lockedListing.photos.includes(x)) ?? []);
    return null;
  });
  if (slotConflict) {
    const coordinateError = slotConflict.startsWith("COORDINATES:");
    const validation = coordinateError || slotConflict.startsWith("VALIDATION:") || slotConflict.includes("ne pripada");
    const error = slotConflict.replace(/^(VALIDATION|COORDINATES):/, "");
    return res.status(validation ? 400 : 409).json({ error, code: coordinateError ? "RENTAL_COORDINATES_NOT_ALLOWED" : validation ? "VALIDATION_ERROR" : "RENTAL_SLOT_CONFLICT" });
  }
  const salon = await ownerSalon(user);
  const [row] = await listingQuery({ id: user.id, salonId: salon?.id }).where(eq(beautyJobListingsTable.id, existing.id)).limit(1);
  const slotMap = await rentalSlotsByListing([existing.id]);
  res.json(UpdateBeautyJobResponse.parse(view({ ...row!.listing, ...row! }, slotMap.get(existing.id))));
} catch (e) { next(e); } });

router.post("/beauty-jobs/:listingId/renew", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return; const p = RenewBeautyJobParams.safeParse(req.params); if (!p.success) return bad(res); const [l] = await db.select().from(beautyJobListingsTable).where(eq(beautyJobListingsTable.id, p.data.listingId)).limit(1); if (!l || !(await canManage(user, l))) return res.status(404).json({ error: "Oglas nije pronađen.", code: "NOT_FOUND" }); const cfg = await settings(); const [u] = await db.update(beautyJobListingsTable).set({ status: "active", expiresAt: new Date(Date.now() + cfg.listingExpiryDays * 86400000), updatedAt: new Date() }).where(eq(beautyJobListingsTable.id, l.id)).returning(); await notification(user.id, "renewed", "Oglas je obnovljen", u!.title, u!.id); const salon = await ownerSalon(user); const [row] = await listingQuery({ id: user.id, salonId: salon?.id }).where(eq(beautyJobListingsTable.id, l.id)).limit(1); res.json(RenewBeautyJobResponse.parse(view({ ...row!.listing, ...row! })));
} catch (e) { next(e); } });
router.post("/beauty-jobs/:listingId/close", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return; const p = CloseBeautyJobParams.safeParse(req.params); if (!p.success) return bad(res); const [l] = await db.select().from(beautyJobListingsTable).where(eq(beautyJobListingsTable.id, p.data.listingId)).limit(1); if (!l || !(await canManage(user, l))) return res.status(404).json({ error: "Oglas nije pronađen.", code: "NOT_FOUND" }); await db.update(beautyJobListingsTable).set({ status: "closed", closedAt: new Date(), updatedAt: new Date() }).where(eq(beautyJobListingsTable.id, l.id)); const salon = await ownerSalon(user); const [row] = await listingQuery({ id: user.id, salonId: salon?.id }).where(eq(beautyJobListingsTable.id, l.id)).limit(1); res.json(CloseBeautyJobResponse.parse(view({ ...row!.listing, ...row! })));
} catch (e) { next(e); } });

router.post("/beauty-jobs/:listingId/save", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return; const p = ToggleSavedBeautyJobParams.safeParse(req.params); if (!p.success) return bad(res);
  const [listing] = await db.select({ id: beautyJobListingsTable.id }).from(beautyJobListingsTable).where(and(eq(beautyJobListingsTable.id, p.data.listingId), eq(beautyJobListingsTable.status, "active"), eq(beautyJobListingsTable.moderationStatus, "approved"), sql`${beautyJobListingsTable.expiresAt} > now()`)).limit(1);
  if (!listing) return res.status(404).json({ error: "Oglas nije pronađen.", code: "NOT_FOUND" });
  const [saved] = await db.select().from(beautyJobSavedListingsTable).where(and(eq(beautyJobSavedListingsTable.userId, user.id), eq(beautyJobSavedListingsTable.listingId, p.data.listingId))).limit(1);
  if (saved) {
    await db.delete(beautyJobSavedListingsTable).where(and(eq(beautyJobSavedListingsTable.userId, user.id), eq(beautyJobSavedListingsTable.listingId, p.data.listingId)));
    res.json(ToggleSavedBeautyJobResponse.parse({ saved: false }));
  } else {
    await db.insert(beautyJobSavedListingsTable).values({ userId: user.id, listingId: p.data.listingId }).onConflictDoNothing();
    res.json(ToggleSavedBeautyJobResponse.parse({ saved: true }));
  }
} catch (e) { next(e); } });
router.get("/beauty-jobs/saved", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return; const salon = await ownerSalon(user); const items = await listingQuery({ id: user.id, salonId: salon?.id }).where(eq(beautyJobSavedListingsTable.userId, user.id)).orderBy(desc(beautyJobSavedListingsTable.createdAt));
  res.json(ListSavedBeautyJobsResponse.parse({ items: items.map((r) => view({ ...r.listing, ...r })), total: items.length, page: 1, pageSize: items.length }));
} catch (e) { next(e); } });

router.get("/beauty-jobs/rental-requests/mine", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return;
  const requests = await db.select({
    request: beautyJobRentalRequestsTable,
    listingTitle: beautyJobListingsTable.title,
    applicantDisplayName: sql<string>`${usersTable.firstName} || ' ' || ${usersTable.lastName}`,
    startsAt: beautyJobRentalSlotsTable.startsAt,
    endsAt: beautyJobRentalSlotsTable.endsAt,
  }).from(beautyJobRentalRequestsTable)
    .innerJoin(beautyJobListingsTable, eq(beautyJobRentalRequestsTable.listingId, beautyJobListingsTable.id))
    .innerJoin(beautyJobRentalSlotsTable, eq(beautyJobRentalRequestsTable.slotId, beautyJobRentalSlotsTable.id))
    .innerJoin(usersTable, eq(beautyJobRentalRequestsTable.applicantUserId, usersTable.id))
    .where(eq(beautyJobRentalRequestsTable.applicantUserId, user.id))
    .orderBy(desc(beautyJobRentalRequestsTable.createdAt));
  res.json(ListMyBeautyJobRentalRequestsResponse.parse({ requests: requests.map((row) => rentalRequestView(row.request, row)) }));
} catch (e) { next(e); } });

router.get("/beauty-jobs/rental-requests/inbox", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return; const salon = await ownerSalon(user);
  const scope = salon ? eq(beautyJobListingsTable.salonId, salon.id) : eq(beautyJobListingsTable.userId, user.id);
  const requests = await db.select({
    request: beautyJobRentalRequestsTable,
    listingTitle: beautyJobListingsTable.title,
    applicantDisplayName: sql<string>`${usersTable.firstName} || ' ' || ${usersTable.lastName}`,
    startsAt: beautyJobRentalSlotsTable.startsAt,
    endsAt: beautyJobRentalSlotsTable.endsAt,
  }).from(beautyJobRentalRequestsTable)
    .innerJoin(beautyJobListingsTable, eq(beautyJobRentalRequestsTable.listingId, beautyJobListingsTable.id))
    .innerJoin(beautyJobRentalSlotsTable, eq(beautyJobRentalRequestsTable.slotId, beautyJobRentalSlotsTable.id))
    .innerJoin(usersTable, eq(beautyJobRentalRequestsTable.applicantUserId, usersTable.id))
    .where(scope)
    .orderBy(desc(beautyJobRentalRequestsTable.createdAt));
  res.json(ListBeautyJobRentalRequestInboxResponse.parse({ requests: requests.map((row) => rentalRequestView(row.request, row)) }));
} catch (e) { next(e); } });

router.post("/beauty-jobs/:listingId/rental-requests", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return;
  const p = CreateBeautyJobRentalRequestParams.safeParse(req.params), b = CreateBeautyJobRentalRequestBody.safeParse(req.body); if (!p.success || !b.success) return bad(res);
  const [row] = await db.select({ listing: beautyJobListingsTable, slot: beautyJobRentalSlotsTable })
    .from(beautyJobRentalSlotsTable)
    .innerJoin(beautyJobListingsTable, eq(beautyJobRentalSlotsTable.listingId, beautyJobListingsTable.id))
    .where(and(
      eq(beautyJobListingsTable.id, p.data.listingId),
      eq(beautyJobRentalSlotsTable.id, b.data.slotId),
      inArray(beautyJobListingsTable.type, ["equipment_rental", "space_rental"]),
      eq(beautyJobListingsTable.intent, "offering"),
      eq(beautyJobListingsTable.status, "active"),
      eq(beautyJobListingsTable.moderationStatus, "approved"),
      sql`${beautyJobListingsTable.expiresAt} > now()`,
      sql`${beautyJobRentalSlotsTable.startsAt} > now()`,
    )).limit(1);
  if (!row) return res.status(404).json({ error: "Termin nije pronađen ili više nije dostupan.", code: "NOT_FOUND" });
  const recipient = await listingRecipient(row.listing); if (!recipient || recipient === user.id) return res.status(403).json({ error: "Rezervacija sopstvenog oglasa nije dozvoljena.", code: "FORBIDDEN" });
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`beauty-job-rental-listing:${row.listing.id}`}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`beauty-job-rental-slot:${row.slot.id}`}))`);
    const [lockedListing] = await tx.select().from(beautyJobListingsTable).where(eq(beautyJobListingsTable.id, row.listing.id)).for("update").limit(1);
    const [lockedSlot] = await tx.select().from(beautyJobRentalSlotsTable).where(and(eq(beautyJobRentalSlotsTable.id, row.slot.id), eq(beautyJobRentalSlotsTable.listingId, row.listing.id))).for("update").limit(1);
    const now = new Date();
    if (!lockedListing || !lockedSlot || !RENTAL_TYPES.has(lockedListing.type) || lockedListing.intent !== "offering" || lockedListing.status !== "active" || lockedListing.moderationStatus !== "approved" || lockedListing.expiresAt <= now || lockedSlot.startsAt <= now) {
      return { error: "Termin više nije dostupan.", code: "RENTAL_SLOT_UNAVAILABLE" } as const;
    }
    const [accepted] = await tx.select({ id: beautyJobRentalRequestsTable.id }).from(beautyJobRentalRequestsTable)
      .where(and(eq(beautyJobRentalRequestsTable.slotId, row.slot.id), eq(beautyJobRentalRequestsTable.status, "accepted"))).limit(1);
    if (accepted) return { error: "Termin je već rezervisan.", code: "RENTAL_SLOT_UNAVAILABLE" } as const;
    const [duplicate] = await tx.select({ id: beautyJobRentalRequestsTable.id }).from(beautyJobRentalRequestsTable)
      .where(and(eq(beautyJobRentalRequestsTable.slotId, row.slot.id), eq(beautyJobRentalRequestsTable.applicantUserId, user.id), eq(beautyJobRentalRequestsTable.status, "pending"))).limit(1);
    if (duplicate) return { error: "Već ste poslali zahtev za ovaj termin.", code: "RENTAL_REQUEST_EXISTS" } as const;
    const [created] = await tx.insert(beautyJobRentalRequestsTable).values({
      listingId: row.listing.id, slotId: row.slot.id, applicantUserId: user.id, message: b.data.message?.trim() || null,
    }).returning();
    await tx.insert(beautyJobNotificationsTable).values({
      recipientUserId: recipient, listingId: row.listing.id, type: "new_rental_request",
      title: "Novi zahtev za rezervaciju", body: row.listing.title,
    });
    return { request: created! } as const;
  });
  if ("error" in result) return res.status(409).json(result);
  res.status(201).json(CreateBeautyJobRentalRequestResponse.parse(rentalRequestView(result.request, {
    listingTitle: row.listing.title,
    applicantDisplayName: `${user.firstName} ${user.lastName}`,
    startsAt: row.slot.startsAt,
    endsAt: row.slot.endsAt,
  })));
} catch (e) { next(e); } });

router.patch("/beauty-jobs/rental-requests/:requestId", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return;
  const p = RespondToBeautyJobRentalRequestParams.safeParse(req.params), b = RespondToBeautyJobRentalRequestBody.safeParse(req.body); if (!p.success || !b.success) return bad(res);
  const [preview] = await db.select({
    request: beautyJobRentalRequestsTable,
    listing: beautyJobListingsTable,
    applicantDisplayName: sql<string>`${usersTable.firstName} || ' ' || ${usersTable.lastName}`,
    startsAt: beautyJobRentalSlotsTable.startsAt,
    endsAt: beautyJobRentalSlotsTable.endsAt,
  }).from(beautyJobRentalRequestsTable)
    .innerJoin(beautyJobListingsTable, eq(beautyJobRentalRequestsTable.listingId, beautyJobListingsTable.id))
    .innerJoin(beautyJobRentalSlotsTable, eq(beautyJobRentalRequestsTable.slotId, beautyJobRentalSlotsTable.id))
    .innerJoin(usersTable, eq(beautyJobRentalRequestsTable.applicantUserId, usersTable.id))
    .where(eq(beautyJobRentalRequestsTable.id, p.data.requestId)).limit(1);
  if (!preview || !(await canManage(user, preview.listing))) return res.status(404).json({ error: "Zahtev nije pronađen.", code: "NOT_FOUND" });
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`beauty-job-rental-listing:${preview.listing.id}`}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`beauty-job-rental-slot:${preview.request.slotId}`}))`);
    const [lockedListing] = await tx.select().from(beautyJobListingsTable).where(eq(beautyJobListingsTable.id, preview.listing.id)).for("update").limit(1);
    const [lockedSlot] = await tx.select().from(beautyJobRentalSlotsTable).where(and(eq(beautyJobRentalSlotsTable.id, preview.request.slotId), eq(beautyJobRentalSlotsTable.listingId, preview.listing.id))).for("update").limit(1);
    const [locked] = await tx.select().from(beautyJobRentalRequestsTable).where(eq(beautyJobRentalRequestsTable.id, preview.request.id)).for("update").limit(1);
    if (!locked || locked.status !== "pending") return { error: "Zahtev je već obrađen.", code: "RENTAL_REQUEST_ALREADY_HANDLED" } as const;
    if (b.data.status === "accepted") {
      const now = new Date();
      if (!lockedListing || !lockedSlot || !RENTAL_TYPES.has(lockedListing.type) || lockedListing.intent !== "offering" || lockedListing.status !== "active" || lockedListing.moderationStatus !== "approved" || lockedListing.expiresAt <= now || lockedSlot.startsAt <= now) {
        return { error: "Termin ili oglas više nije dostupan za prihvatanje.", code: "RENTAL_SLOT_UNAVAILABLE" } as const;
      }
      const [accepted] = await tx.select({ id: beautyJobRentalRequestsTable.id }).from(beautyJobRentalRequestsTable)
        .where(and(eq(beautyJobRentalRequestsTable.slotId, locked.slotId), eq(beautyJobRentalRequestsTable.status, "accepted"))).limit(1);
      if (accepted) return { error: "Termin je već rezervisan drugim zahtevom.", code: "RENTAL_SLOT_UNAVAILABLE" } as const;
    }
    const now = new Date();
    const [updated] = await tx.update(beautyJobRentalRequestsTable).set({ status: b.data.status, respondedAt: now, updatedAt: now })
      .where(eq(beautyJobRentalRequestsTable.id, locked.id)).returning();
    const notifications = [{
      recipientUserId: locked.applicantUserId, listingId: locked.listingId,
      type: b.data.status === "accepted" ? "rental_request_accepted" : "rental_request_declined",
      title: b.data.status === "accepted" ? "Zahtev za rezervaciju je prihvaćen" : "Zahtev za rezervaciju je odbijen",
      body: preview.listing.title,
    }];
    if (b.data.status === "accepted") {
      const declined = await tx.update(beautyJobRentalRequestsTable).set({ status: "declined", respondedAt: now, updatedAt: now })
        .where(and(eq(beautyJobRentalRequestsTable.slotId, locked.slotId), eq(beautyJobRentalRequestsTable.status, "pending")))
        .returning({ applicantUserId: beautyJobRentalRequestsTable.applicantUserId, listingId: beautyJobRentalRequestsTable.listingId });
      notifications.push(...declined.map((item) => ({
        recipientUserId: item.applicantUserId, listingId: item.listingId, type: "rental_request_declined",
        title: "Termin je rezervisan drugim zahtevom", body: preview.listing.title,
      })));
    }
    await tx.insert(beautyJobNotificationsTable).values(notifications);
    return { request: updated! } as const;
  });
  if ("error" in result) return res.status(409).json(result);
  res.json(RespondToBeautyJobRentalRequestResponse.parse(rentalRequestView(result.request, {
    listingTitle: preview.listing.title,
    applicantDisplayName: preview.applicantDisplayName,
    startsAt: preview.startsAt,
    endsAt: preview.endsAt,
  })));
} catch (e) { next(e); } });

router.post("/beauty-jobs/:listingId/contact", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return; const p = ContactBeautyJobAuthorParams.safeParse(req.params), b = ContactBeautyJobAuthorBody.safeParse(req.body); if (!p.success || !b.success) return bad(res);
  const [listing] = await db.select().from(beautyJobListingsTable).where(and(eq(beautyJobListingsTable.id, p.data.listingId), eq(beautyJobListingsTable.status, "active"), eq(beautyJobListingsTable.moderationStatus, "approved"), sql`${beautyJobListingsTable.expiresAt} > now()`)).limit(1);
  if (!listing) return res.status(404).json({ error: "Oglas nije pronađen.", code: "NOT_FOUND" }); const recipient = await listingRecipient(listing); if (!recipient || recipient === user.id) return res.status(403).json({ error: "Kontakt nije dozvoljen.", code: "FORBIDDEN" });
  const contact = await db.transaction(async (tx) => {
    const [created] = await tx.insert(beautyJobContactsTable).values({
      listingId: listing.id,
      applicantUserId: user.id,
      applicantMessage: b.data.message,
    }).returning();
    await tx.update(beautyJobListingsTable)
      .set({ contactCount: sql`${beautyJobListingsTable.contactCount} + 1` })
      .where(eq(beautyJobListingsTable.id, listing.id));
    const [createdNotification] = await tx.insert(beautyJobNotificationsTable).values({
      recipientUserId: recipient,
      listingId: listing.id,
      contactId: created!.id,
      type: "new_contact",
      title: "Novi kontakt za oglas",
      body: listing.title,
    }).returning();
    await enqueueBeautyJobEmail(tx, {
      eventKey: `beauty-job:contact:${created!.id}:recipient:${recipient}`,
      emailType: "beauty_job_new_contact",
      recipientUserId: recipient,
      subject: "Novi kontakt za vaš oglas",
      title: "Novi kontakt za vaš oglas",
      content: `${user.firstName} ${user.lastName} je poslao/la poruku za oglas „${listing.title}“.`,
      listingId: listing.id,
      contactId: created!.id,
      metadata: { notificationId: createdNotification!.id },
    });
    return created!;
  });
  await deliverBeautyJobEmail(`beauty-job:contact:${contact.id}:recipient:${recipient}`);
  res.status(201).json(ContactBeautyJobAuthorResponse.parse(contactView(contact)));
} catch (e) { next(e); } });

router.get("/beauty-jobs/inbox", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return; const salon = await ownerSalon(user);
  const scope = salon ? eq(beautyJobListingsTable.salonId, salon.id) : eq(beautyJobListingsTable.userId, user.id);
  const contacts = await db.select({ contact: beautyJobContactsTable, listingTitle: beautyJobListingsTable.title, applicantDisplayName: sql<string>`${usersTable.firstName} || ' ' || ${usersTable.lastName}` }).from(beautyJobContactsTable).innerJoin(beautyJobListingsTable, eq(beautyJobContactsTable.listingId, beautyJobListingsTable.id)).innerJoin(usersTable, eq(beautyJobContactsTable.applicantUserId, usersTable.id)).where(or(scope, eq(beautyJobContactsTable.applicantUserId, user.id))).orderBy(desc(beautyJobContactsTable.createdAt));
  res.json(ListBeautyJobInboxResponse.parse({ contacts: contacts.map((r) => contactView(r.contact, { listingTitle: r.listingTitle, applicantDisplayName: r.applicantDisplayName })) }));
} catch (e) { next(e); } });
router.patch("/beauty-jobs/contacts/:contactId", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return; const p = ReplyToBeautyJobContactParams.safeParse(req.params), b = ReplyToBeautyJobContactBody.safeParse(req.body); if (!p.success || !b.success) return bad(res);
  const [row] = await db.select({ contact: beautyJobContactsTable, listing: beautyJobListingsTable }).from(beautyJobContactsTable).innerJoin(beautyJobListingsTable, eq(beautyJobContactsTable.listingId, beautyJobListingsTable.id)).where(eq(beautyJobContactsTable.id, p.data.contactId)).limit(1);
  if (!row || !(await canManage(user, row.listing))) return res.status(404).json({ error: "Kontakt nije pronađen.", code: "NOT_FOUND" });
  const replyResult = await db.transaction(async (tx) => {
    await lockBeautyJobEvent(tx, row.contact.id);
    const [fresh] = await tx.select({ contact: beautyJobContactsTable, listing: beautyJobListingsTable })
      .from(beautyJobContactsTable)
      .innerJoin(beautyJobListingsTable, eq(beautyJobContactsTable.listingId, beautyJobListingsTable.id))
      .where(eq(beautyJobContactsTable.id, row.contact.id)).limit(1);
    if (!fresh) return null;
    const isFirstReply = Boolean(b.data.authorReply && !fresh.contact.authorReply);
    const [updated] = await tx.update(beautyJobContactsTable).set({
      authorReply: b.data.authorReply ?? fresh.contact.authorReply,
      authorStatus: b.data.authorStatus ?? (b.data.authorReply ? "replied" : fresh.contact.authorStatus),
      repliedAt: b.data.authorReply ? new Date() : fresh.contact.repliedAt,
      updatedAt: new Date(),
    }).where(eq(beautyJobContactsTable.id, fresh.contact.id)).returning();
    if (!isFirstReply) return { updated: updated!, eventKey: null };
    const [replyNotification] = await tx.insert(beautyJobNotificationsTable).values({
      recipientUserId: updated!.applicantUserId,
      listingId: fresh.listing.id,
      contactId: updated!.id,
      type: "author_reply",
      title: "Odgovor na vaš kontakt",
      body: fresh.listing.title,
    }).returning();
    const eventKey = `beauty-job:reply:${updated!.id}:recipient:${updated!.applicantUserId}`;
    await enqueueBeautyJobEmail(tx, {
      eventKey,
      emailType: "beauty_job_author_reply",
      recipientUserId: updated!.applicantUserId,
      subject: "Dobili ste odgovor na Beauty Poslovi kontakt",
      title: "Dobili ste odgovor na vaš kontakt",
      content: `Autor oglasa „${fresh.listing.title}“ je odgovorio/la na vašu poruku.`,
      listingId: fresh.listing.id,
      contactId: updated!.id,
      metadata: { notificationId: replyNotification!.id },
    });
    return { updated: updated!, eventKey };
  });
  if (!replyResult) return res.status(404).json({ error: "Kontakt nije pronađen.", code: "NOT_FOUND" });
  if (replyResult.eventKey) await deliverBeautyJobEmail(replyResult.eventKey);
  res.json(ReplyToBeautyJobContactResponse.parse(contactView(replyResult.updated)));
} catch (e) { next(e); } });

router.post("/beauty-jobs/:listingId/report", async (req, res, next) => { try {
  const user = await session(req, res); if (user === undefined && res.headersSent) return; const p = ReportBeautyJobParams.safeParse(req.params), b = ReportBeautyJobBody.safeParse(req.body); if (!p.success || !b.success) return bad(res);
  const [listing] = await db.select({ id: beautyJobListingsTable.id }).from(beautyJobListingsTable).where(and(eq(beautyJobListingsTable.id, p.data.listingId), eq(beautyJobListingsTable.status, "active"), eq(beautyJobListingsTable.moderationStatus, "approved"), sql`${beautyJobListingsTable.expiresAt} > now()`)).limit(1);
  if (!listing) return res.status(404).json({ error: "Oglas nije pronađen.", code: "NOT_FOUND" });
  const [report] = await db.insert(beautyJobReportsTable).values({ listingId: p.data.listingId, reporterUserId: user?.id, reason: b.data.reason }).returning();
  res.status(201).json(ReportBeautyJobResponse.parse(reportView(report!)));
} catch (e) { next(e); } });

router.get("/beauty-jobs/notifications", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return; const notifications = await db.select().from(beautyJobNotificationsTable).where(eq(beautyJobNotificationsTable.recipientUserId, user.id)).orderBy(desc(beautyJobNotificationsTable.createdAt)).limit(100);
  res.json(ListBeautyJobNotificationsResponse.parse({ notifications: notifications.map(notificationView) }));
} catch (e) { next(e); } });
router.post("/beauty-jobs/notifications/:notificationId/read", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return; const p = MarkBeautyJobNotificationReadParams.safeParse(req.params); if (!p.success) return bad(res); const [n] = await db.update(beautyJobNotificationsTable).set({ readAt: new Date() }).where(and(eq(beautyJobNotificationsTable.id, p.data.notificationId), eq(beautyJobNotificationsTable.recipientUserId, user.id))).returning(); if (!n) return res.status(404).json({ error: "Obaveštenje nije pronađeno.", code: "NOT_FOUND" });
  res.json(MarkBeautyJobNotificationReadResponse.parse(notificationView(n)));
} catch (e) { next(e); } });

async function admin(req: import("express").Request, res: import("express").Response) { const user = await authenticated(req, res); if (!user || !isAdmin(user)) { if (user) res.status(403).json({ error: "Administratorski pristup je obavezan.", code: "FORBIDDEN" }); return undefined; } return user; }
router.get("/admin/beauty-jobs/settings", async (req, res, next) => { try { if (!(await admin(req, res))) return; res.json(GetBeautyJobSettingsResponse.parse(settingsView(await settings()))); } catch (e) { next(e); } });
router.patch("/admin/beauty-jobs/settings", async (req, res, next) => { try { const user = await admin(req, res); if (!user) return; const b = UpdateBeautyJobSettingsBody.safeParse(req.body); if (!b.success) return bad(res); const current = await settings(); const [updated] = await db.update(beautyJobPlatformSettingsTable).set({ ...b.data, updatedByUserId: user.id, updatedAt: new Date() }).where(eq(beautyJobPlatformSettingsTable.id, current.id)).returning(); res.json(UpdateBeautyJobSettingsResponse.parse(settingsView(updated!))); } catch (e) { next(e); } });
router.post("/admin/beauty-jobs/expiry-sweep", async (req, res, next) => { try { if (!(await admin(req, res))) return; const expired = await expireBeautyJobListings(); res.json(SweepExpiredBeautyJobsResponse.parse({ expired })); } catch (e) { next(e); } });
router.get("/admin/beauty-jobs/email-deliveries", async (req, res, next) => { try {
  if (!(await admin(req, res))) return;
  res.json(GetBeautyJobDeliveryIssuesResponse.parse(await listBeautyJobDeliveryIssues()));
} catch (e) { next(e); } });
router.post("/admin/beauty-jobs/email-deliveries/:deliveryId/retry", async (req, res, next) => { try {
  if (!(await admin(req, res))) return;
  const parsed = RetryBeautyJobDeliveryParams.safeParse(req.params);
  if (!parsed.success) return bad(res);
  const result = await retryBeautyJobEmailDelivery(parsed.data.deliveryId);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 409;
    res.status(status).json({
      error: result.reason === "not_found"
        ? "Beauty Poslovi delivery zapis nije pronađen."
        : "Ručni retry je dozvoljen samo za terminalnu prolaznu grešku.",
      code: result.reason === "not_found" ? "NOT_FOUND" : "DELIVERY_NOT_RETRYABLE",
    });
    return;
  }
  res.json(RetryBeautyJobDeliveryResponse.parse({
    id: parsed.data.deliveryId,
    status: result.status,
    retried: true,
  }));
} catch (e) { next(e); } });
router.get("/admin/beauty-jobs/queue", async (req, res, next) => { try {
  if (!(await admin(req, res))) return; const [listings, reports] = await Promise.all([
    listingQuery().where(or(eq(beautyJobListingsTable.moderationStatus, "pending"), eq(beautyJobListingsTable.moderationStatus, "rejected"))).orderBy(desc(beautyJobListingsTable.createdAt)),
    db.select({ report: beautyJobReportsTable, listingTitle: beautyJobListingsTable.title, authorSalonId: beautyJobListingsTable.salonId, authorUserId: beautyJobListingsTable.userId }).from(beautyJobReportsTable).innerJoin(beautyJobListingsTable, eq(beautyJobReportsTable.listingId, beautyJobListingsTable.id)).where(eq(beautyJobReportsTable.status, "pending")).orderBy(desc(beautyJobReportsTable.createdAt)),
  ]);
  res.json(GetBeautyJobModerationQueueResponse.parse({
    listings: listings.map((r) => view({ ...r.listing, ...r })),
    reports: reports.map((r) => reportView(r.report, { listingTitle: r.listingTitle, authorSalonId: r.authorSalonId, authorUserId: r.authorUserId })),
  }));
} catch (e) { next(e); } });
router.post("/admin/beauty-jobs/:listingId/moderation", async (req, res, next) => { try {
  const user = await admin(req, res); if (!user) return; const p = ModerateBeautyJobParams.safeParse(req.params), b = ModerateBeautyJobBody.safeParse(req.body); if (!p.success || !b.success) return bad(res);
  if (b.data.action === "reject" && !b.data.reason?.trim()) return res.status(400).json({ error: "Razlog odbijanja je obavezan.", code: "REJECTION_REASON_REQUIRED" });
  const moderationResult = await db.transaction(async (tx) => {
    await lockBeautyJobEvent(tx, p.data.listingId);
    const [existing] = await tx.select().from(beautyJobListingsTable)
      .where(eq(beautyJobListingsTable.id, p.data.listingId)).limit(1);
    if (!existing) return null;
    const values = b.data.action === "approve"
      ? { moderationStatus: "approved" as const, status: "active" as const }
      : b.data.action === "reject"
        ? { moderationStatus: "rejected" as const, status: "rejected" as const }
        : b.data.action === "close"
          ? { status: "closed" as const, closedAt: new Date() }
          : { moderationStatus: "approved" as const, status: "active" as const };
    const stateChanged = b.data.action === "approve" || b.data.action === "reactivate"
      ? existing.moderationStatus !== "approved" || existing.status !== "active"
      : b.data.action === "reject"
        ? existing.moderationStatus !== "rejected" || existing.status !== "rejected"
        : existing.status !== "closed";
    const [listing] = await tx.update(beautyJobListingsTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(beautyJobListingsTable.id, p.data.listingId))
      .returning();
    if (!stateChanged) return { listing: listing!, eventKey: null };
    const recipient = await transactionListingRecipient(tx, listing!);
    if (!recipient) return { listing: listing!, eventKey: null };
    const [moderationNotification] = await tx.insert(beautyJobNotificationsTable).values({
      recipientUserId: recipient,
      listingId: listing!.id,
      type: "moderation",
      title: "Status oglasa je ažuriran",
      body: b.data.reason?.trim() || listing!.title,
    }).returning();
    const subject = b.data.action === "approve" || b.data.action === "reactivate" ? "Oglas je odobren" : b.data.action === "reject" ? "Oglas je odbijen" : "Status oglasa je ažuriran";
    const eventKey = `beauty-job:moderation:${moderationNotification!.id}:recipient:${recipient}`;
    await enqueueBeautyJobEmail(tx, {
      eventKey,
      emailType: "beauty_job_moderation",
      recipientUserId: recipient,
      subject,
      title: subject,
      content: b.data.reason?.trim() || `Oglas „${listing!.title}“ je dobio novu odluku moderatora.`,
      listingId: listing!.id,
      metadata: { action: b.data.action, notificationId: moderationNotification!.id },
    });
    return { listing: listing!, eventKey };
  });
  if (!moderationResult) return res.status(404).json({ error: "Oglas nije pronađen.", code: "NOT_FOUND" });
  if (moderationResult.eventKey) await deliverBeautyJobEmail(moderationResult.eventKey);
  const [row] = await listingQuery().where(eq(beautyJobListingsTable.id, moderationResult.listing.id)).limit(1);
  res.json(ModerateBeautyJobResponse.parse(view({ ...row!.listing, ...row! })));
} catch (e) { next(e); } });
router.post("/admin/beauty-jobs/reports/:reportId/resolve", async (req, res, next) => { try {
  const user = await admin(req, res); if (!user) return; const p = ResolveBeautyJobReportParams.safeParse(req.params), b = ResolveBeautyJobReportBody.safeParse(req.body); if (!p.success || !b.success) return bad(res);
  const result = await db.transaction(async (tx) => {
    await lockBeautyJobEvent(tx, p.data.reportId);
    const [updated] = await tx.update(beautyJobReportsTable).set({ status: b.data.status, resolutionNote: b.data.resolutionNote ?? null, resolvedAt: new Date(), resolvedByUserId: user.id }).where(and(eq(beautyJobReportsTable.id, p.data.reportId), eq(beautyJobReportsTable.status, "pending"))).returning();
    if (!updated) return null;
    if (b.data.status !== "resolved") return { report: updated, eventKey: null };
    const [listing] = await tx.update(beautyJobListingsTable)
      .set({ moderationStatus: "rejected", status: "rejected", updatedAt: new Date() })
      .where(eq(beautyJobListingsTable.id, updated.listingId)).returning();
    if (!listing) return { report: updated, eventKey: null };
    const recipient = await transactionListingRecipient(tx, listing);
    if (!recipient) return { report: updated, eventKey: null };
    const [reportNotification] = await tx.insert(beautyJobNotificationsTable).values({
      recipientUserId: recipient,
      listingId: listing.id,
      type: "moderation",
      title: "Oglas je uklonjen nakon prijave",
      body: b.data.resolutionNote || listing.title,
    }).returning();
    const eventKey = `beauty-job:moderation-report:${updated.id}:recipient:${recipient}`;
    await enqueueBeautyJobEmail(tx, {
      eventKey,
      emailType: "beauty_job_moderation",
      recipientUserId: recipient,
      subject: "Oglas je uklonjen nakon prijave",
      title: "Oglas je uklonjen nakon prijave",
      content: b.data.resolutionNote || `Oglas „${listing.title}“ je uklonjen nakon provere prijave.`,
      listingId: listing.id,
      metadata: { reportId: updated.id, notificationId: reportNotification!.id },
    });
    return { report: updated, eventKey };
  });
  if (!result) return res.status(404).json({ error: "Prijava nije pronađena ili je već rešena.", code: "NOT_FOUND" });
  if (result.eventKey) await deliverBeautyJobEmail(result.eventKey);
  res.json(ResolveBeautyJobReportResponse.parse(reportView(result.report)));
} catch (e) { next(e); } });

// This must be registered after fixed /beauty-jobs paths (mine, saved, inbox,
// notifications) so public static resources are never interpreted as an id.
router.get("/beauty-jobs/:listingId", async (req, res, next) => { try {
  const viewer = await session(req, res); if (viewer === undefined && res.headersSent) return;
  const viewerSalon = viewer?.role === "SALON_OWNER" ? await ownerSalon(viewer) : undefined;
  const p = GetBeautyJobParams.safeParse(req.params); if (!p.success) return bad(res);
  const [updated] = await db.update(beautyJobListingsTable).set({ viewCount: sql`${beautyJobListingsTable.viewCount} + 1` })
    .where(and(eq(beautyJobListingsTable.id, p.data.listingId), eq(beautyJobListingsTable.status, "active"), eq(beautyJobListingsTable.moderationStatus, "approved"), sql`${beautyJobListingsTable.expiresAt} > now()`)).returning();
  if (!updated) return res.status(404).json({ error: "Oglas nije pronađen.", code: "NOT_FOUND" });
  const [row] = await listingQuery(viewer ? { id: viewer.id, salonId: viewerSalon?.id } : undefined).where(eq(beautyJobListingsTable.id, updated.id)).limit(1);
  const slotMap = await rentalSlotsByListing([updated.id]);
  res.json(GetBeautyJobResponse.parse(view({ ...row!.listing, ...row! }, slotMap.get(updated.id))));
} catch (e) { next(e); } });

export default router;