import { Router } from "express";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import {
  beautyJobCategoriesTable, beautyJobContactsTable, beautyJobListingAvailabilityTable,
  beautyJobListingsTable, beautyJobNotificationsTable, beautyJobPlatformSettingsTable,
  beautyJobReportsTable, beautyJobSavedListingsTable, db, salonsTable, usersTable,
} from "@workspace/db";
import {
  CloseBeautyJobParams, CloseBeautyJobResponse,
  ContactBeautyJobAuthorBody, ContactBeautyJobAuthorParams, ContactBeautyJobAuthorResponse,
  CreateBeautyJobBody, CreateBeautyJobResponse,
  GetBeautyJobModerationQueueResponse, GetBeautyJobParams, GetBeautyJobResponse,
  GetBeautyJobSettingsResponse, ListBeautyJobCategoriesResponse,
  ListBeautyJobInboxResponse, ListBeautyJobNotificationsResponse,
  ListBeautyJobsQueryParams, ListBeautyJobsResponse, ListMyBeautyJobsResponse,
  ListSavedBeautyJobsResponse, MarkBeautyJobNotificationReadParams,
  MarkBeautyJobNotificationReadResponse, ModerateBeautyJobBody,
  ModerateBeautyJobParams, ModerateBeautyJobResponse, RenewBeautyJobParams,
  RenewBeautyJobResponse, ReplyToBeautyJobContactBody,
  ReplyToBeautyJobContactParams, ReplyToBeautyJobContactResponse,
  ReportBeautyJobBody, ReportBeautyJobParams, ReportBeautyJobResponse,
  ResolveBeautyJobReportBody, ResolveBeautyJobReportParams,
  ResolveBeautyJobReportResponse, SweepExpiredBeautyJobsResponse,
  ToggleSavedBeautyJobParams, ToggleSavedBeautyJobResponse,
  UpdateBeautyJobBody, UpdateBeautyJobParams, UpdateBeautyJobResponse,
  UpdateBeautyJobSettingsBody, UpdateBeautyJobSettingsResponse,
} from "@workspace/api-zod";
import { getCurrentUser, isAdmin } from "../lib/auth";
import { attachReadyImageAssets } from "./image-media";
import { expireBeautyJobListings } from "../lib/beauty-jobs-maintenance";

const router = Router();
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
function view(row: typeof beautyJobListingsTable.$inferSelect & { categorySlug: string; categoryName: string; availabilityPattern: string | null; dayLabels: string[] | null; authorDisplayName: string; isSaved?: boolean; isOwner?: boolean }) {
  return {
    ...row, categorySlug: row.categorySlug, categoryName: row.categoryName,
    availabilityPattern: row.availabilityPattern ?? null, dayLabels: row.dayLabels ?? [],
    authorDisplayName: row.authorDisplayName, isSaved: row.isSaved ?? false, isOwner: row.isOwner ?? false,
    latitude: RENTAL_TYPES.has(row.type) ? null : row.latitude,
    longitude: RENTAL_TYPES.has(row.type) ? null : row.longitude,
    expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
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
  await db.insert(beautyJobNotificationsTable).values({ recipientUserId, type, title, body, listingId, contactId });
}
async function listingRecipient(listing: typeof beautyJobListingsTable.$inferSelect) {
  if (listing.userId) return listing.userId;
  const [salon] = listing.salonId ? await db.select({ ownerId: salonsTable.ownerId }).from(salonsTable).where(eq(salonsTable.id, listing.salonId)).limit(1) : [];
  return salon?.ownerId;
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
  const cfg = await settings(); const authorSalon = user.role === "SALON_OWNER" ? await ownerSalon(user) : undefined;
  if (user.role === "SALON_OWNER" && !authorSalon) return res.status(403).json({ error: "Aktivan salon nije dostupan.", code: "FORBIDDEN" });
  const since = new Date(Date.now() - 3600000);
  const authorFilter = authorSalon ? eq(beautyJobListingsTable.salonId, authorSalon.id) : eq(beautyJobListingsTable.userId, user.id);
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`beauty-job-post:${user.id}`}))`);
    const [recent] = await tx.select({ total: count() }).from(beautyJobListingsTable).where(and(authorFilter, sql`${beautyJobListingsTable.createdAt} >= ${since}`));
    if ((recent?.total ?? 0) >= cfg.hourlyPostingLimit) return null;
    const { availabilityPattern: _availabilityPattern, dayLabels: _dayLabels, ...listingData } = body.data;
    const [l] = await tx.insert(beautyJobListingsTable).values({ ...listingData, salonId: authorSalon?.id, userId: authorSalon ? null : user.id, postedByType: authorSalon ? "salon" : "user", photos: body.data.photos ?? [], expiresAt: new Date(Date.now() + cfg.listingExpiryDays * 86400000) }).returning();
    if (RENTAL_TYPES.has(body.data.type)) await tx.insert(beautyJobListingAvailabilityTable).values({ listingId: l!.id, availabilityPattern: body.data.availabilityPattern!, dayLabels: body.data.dayLabels ?? [] });
    await attachReadyImageAssets(tx, user.id, body.data.photos ?? []); return l!;
  });
  if (!created) return res.status(429).json({ error: "Previše objava. Pokušajte kasnije.", code: "RATE_LIMITED" });
  const [row] = await listingQuery({ id: user.id, salonId: authorSalon?.id }).where(eq(beautyJobListingsTable.id, created.id)).limit(1);
  res.status(201).json(CreateBeautyJobResponse.parse(view({ ...row!.listing, ...row! })));
} catch (e) { next(e); } });

router.get("/beauty-jobs/mine", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return; const salon = await ownerSalon(user);
  const where = salon ? eq(beautyJobListingsTable.salonId, salon.id) : eq(beautyJobListingsTable.userId, user.id);
  const items = await listingQuery({ id: user.id, salonId: salon?.id }).where(where).orderBy(desc(beautyJobListingsTable.createdAt));
  res.json(ListMyBeautyJobsResponse.parse({ items: items.map((r) => view({ ...r.listing, ...r })), total: items.length, page: 1, pageSize: items.length }));
} catch (e) { next(e); } });

router.patch("/beauty-jobs/:listingId", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return; const p = UpdateBeautyJobParams.safeParse(req.params), b = UpdateBeautyJobBody.safeParse(req.body); if (!p.success || !b.success || !validPhotos(b.data.photos)) return bad(res);
  const [existing] = await db.select().from(beautyJobListingsTable).where(eq(beautyJobListingsTable.id, p.data.listingId)).limit(1); if (!existing) return res.status(404).json({ error: "Oglas nije pronađen.", code: "NOT_FOUND" });
  if (!(await canManage(user, existing))) return res.status(403).json({ error: "Nije dozvoljeno.", code: "FORBIDDEN" });
  const categoryId = b.data.categoryId ?? existing.categoryId; const [category] = await db.select().from(beautyJobCategoriesTable).where(and(eq(beautyJobCategoriesTable.id, categoryId), eq(beautyJobCategoriesTable.enabled, true))).limit(1);
  const [currentAvailability] = await db.select({ pattern: beautyJobListingAvailabilityTable.availabilityPattern, dayLabels: beautyJobListingAvailabilityTable.dayLabels }).from(beautyJobListingAvailabilityTable).where(eq(beautyJobListingAvailabilityTable.listingId, existing.id)).limit(1);
  const type = b.data.type ?? existing.type; const pattern = b.data.availabilityPattern ?? currentAvailability?.pattern; const compatibility = !category ? "Kategorija nije pronađena." : ensureCompatibility(category.slug, type, pattern); if (compatibility) return bad(res, compatibility);
  if (RENTAL_TYPES.has(type) && ((b.data.latitude !== undefined && b.data.latitude !== null) || (b.data.longitude !== undefined && b.data.longitude !== null))) {
    return res.status(400).json({ error: "Precizne koordinate nisu dozvoljene za oglase o iznajmljivanju.", code: "RENTAL_COORDINATES_NOT_ALLOWED" });
  }
  await db.transaction(async (tx) => {
    const { availabilityPattern: _availabilityPattern, dayLabels: _dayLabels, ...listingUpdates } = b.data;
    await tx.update(beautyJobListingsTable).set({
      ...listingUpdates,
      photos: b.data.photos ?? existing.photos,
      latitude: RENTAL_TYPES.has(type) ? null : b.data.latitude,
      longitude: RENTAL_TYPES.has(type) ? null : b.data.longitude,
      moderationStatus: "pending",
      status: existing.status === "rejected" ? "active" : existing.status,
      updatedAt: new Date(),
    }).where(eq(beautyJobListingsTable.id, existing.id));
    if (RENTAL_TYPES.has(type)) {
      await tx.insert(beautyJobListingAvailabilityTable).values({ listingId: existing.id, availabilityPattern: pattern!, dayLabels: b.data.dayLabels ?? currentAvailability?.dayLabels ?? [] }).onConflictDoUpdate({ target: beautyJobListingAvailabilityTable.listingId, set: { availabilityPattern: pattern!, dayLabels: b.data.dayLabels ?? currentAvailability?.dayLabels ?? [], updatedAt: new Date() } });
    } else {
      await tx.delete(beautyJobListingAvailabilityTable).where(eq(beautyJobListingAvailabilityTable.listingId, existing.id));
    }
    await attachReadyImageAssets(tx, user.id, b.data.photos?.filter((x) => !existing.photos.includes(x)) ?? []);
  });
  const salon = await ownerSalon(user);
  const [row] = await listingQuery({ id: user.id, salonId: salon?.id }).where(eq(beautyJobListingsTable.id, existing.id)).limit(1);
  res.json(UpdateBeautyJobResponse.parse(view({ ...row!.listing, ...row! })));
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

router.post("/beauty-jobs/:listingId/contact", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return; const p = ContactBeautyJobAuthorParams.safeParse(req.params), b = ContactBeautyJobAuthorBody.safeParse(req.body); if (!p.success || !b.success) return bad(res);
  const [listing] = await db.select().from(beautyJobListingsTable).where(and(eq(beautyJobListingsTable.id, p.data.listingId), eq(beautyJobListingsTable.status, "active"), eq(beautyJobListingsTable.moderationStatus, "approved"), sql`${beautyJobListingsTable.expiresAt} > now()`)).limit(1);
  if (!listing) return res.status(404).json({ error: "Oglas nije pronađen.", code: "NOT_FOUND" }); const recipient = await listingRecipient(listing); if (!recipient || recipient === user.id) return res.status(403).json({ error: "Kontakt nije dozvoljen.", code: "FORBIDDEN" });
  const contact = await db.transaction(async (tx) => { const [c] = await tx.insert(beautyJobContactsTable).values({ listingId: listing.id, applicantUserId: user.id, applicantMessage: b.data.message }).returning(); await tx.update(beautyJobListingsTable).set({ contactCount: sql`${beautyJobListingsTable.contactCount} + 1` }).where(eq(beautyJobListingsTable.id, listing.id)); await tx.insert(beautyJobNotificationsTable).values({ recipientUserId: recipient, listingId: listing.id, contactId: c!.id, type: "new_contact", title: "Novi kontakt za oglas", body: listing.title }); return c!; });
  res.status(201).json(ContactBeautyJobAuthorResponse.parse(contactView(contact)));
} catch (e) { next(e); } });

router.get("/beauty-jobs/inbox", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return; const salon = await ownerSalon(user);
  const scope = salon ? eq(beautyJobListingsTable.salonId, salon.id) : eq(beautyJobListingsTable.userId, user.id);
  const contacts = await db.select({ contact: beautyJobContactsTable, listingTitle: beautyJobListingsTable.title, applicantDisplayName: sql<string>`${usersTable.firstName} || ' ' || ${usersTable.lastName}` }).from(beautyJobContactsTable).innerJoin(beautyJobListingsTable, eq(beautyJobContactsTable.listingId, beautyJobListingsTable.id)).innerJoin(usersTable, eq(beautyJobContactsTable.applicantUserId, usersTable.id)).where(scope).orderBy(desc(beautyJobContactsTable.createdAt));
  res.json(ListBeautyJobInboxResponse.parse({ contacts: contacts.map((r) => contactView(r.contact, { listingTitle: r.listingTitle, applicantDisplayName: r.applicantDisplayName })) }));
} catch (e) { next(e); } });
router.patch("/beauty-jobs/contacts/:contactId", async (req, res, next) => { try {
  const user = await authenticated(req, res); if (!user) return; const p = ReplyToBeautyJobContactParams.safeParse(req.params), b = ReplyToBeautyJobContactBody.safeParse(req.body); if (!p.success || !b.success) return bad(res);
  const [row] = await db.select({ contact: beautyJobContactsTable, listing: beautyJobListingsTable }).from(beautyJobContactsTable).innerJoin(beautyJobListingsTable, eq(beautyJobContactsTable.listingId, beautyJobListingsTable.id)).where(eq(beautyJobContactsTable.id, p.data.contactId)).limit(1);
  if (!row || !(await canManage(user, row.listing))) return res.status(404).json({ error: "Kontakt nije pronađen.", code: "NOT_FOUND" });
  const [updated] = await db.update(beautyJobContactsTable).set({ authorReply: b.data.authorReply ?? row.contact.authorReply, authorStatus: b.data.authorStatus ?? (b.data.authorReply ? "replied" : row.contact.authorStatus), repliedAt: b.data.authorReply ? new Date() : row.contact.repliedAt, updatedAt: new Date() }).where(eq(beautyJobContactsTable.id, row.contact.id)).returning();
  if (b.data.authorReply) await notification(updated!.applicantUserId, "author_reply", "Odgovor na vaš kontakt", row.listing.title, row.listing.id, updated!.id);
  res.json(ReplyToBeautyJobContactResponse.parse(contactView(updated!)));
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
  const values = b.data.action === "approve" ? { moderationStatus: "approved" as const, status: "active" as const } : b.data.action === "reject" ? { moderationStatus: "rejected" as const, status: "rejected" as const } : b.data.action === "close" ? { status: "closed" as const, closedAt: new Date() } : { moderationStatus: "approved" as const, status: "active" as const };
  const [l] = await db.update(beautyJobListingsTable).set({ ...values, updatedAt: new Date() }).where(eq(beautyJobListingsTable.id, p.data.listingId)).returning(); if (!l) return res.status(404).json({ error: "Oglas nije pronađen.", code: "NOT_FOUND" }); const recipient = await listingRecipient(l); if (recipient) await notification(recipient, "moderation", "Status oglasa je ažuriran", b.data.reason?.trim() || l.title, l.id); const [row] = await listingQuery().where(eq(beautyJobListingsTable.id, l.id)).limit(1);
  res.json(ModerateBeautyJobResponse.parse(view({ ...row!.listing, ...row! })));
} catch (e) { next(e); } });
router.post("/admin/beauty-jobs/reports/:reportId/resolve", async (req, res, next) => { try {
  const user = await admin(req, res); if (!user) return; const p = ResolveBeautyJobReportParams.safeParse(req.params), b = ResolveBeautyJobReportBody.safeParse(req.body); if (!p.success || !b.success) return bad(res);
  const report = await db.transaction(async (tx) => {
    const [updated] = await tx.update(beautyJobReportsTable).set({ status: b.data.status, resolutionNote: b.data.resolutionNote ?? null, resolvedAt: new Date(), resolvedByUserId: user.id }).where(and(eq(beautyJobReportsTable.id, p.data.reportId), eq(beautyJobReportsTable.status, "pending"))).returning();
    if (!updated) return null;
    if (b.data.status === "resolved") await tx.update(beautyJobListingsTable).set({ moderationStatus: "rejected", status: "rejected", updatedAt: new Date() }).where(eq(beautyJobListingsTable.id, updated.listingId));
    return updated;
  });
  if (!report) return res.status(404).json({ error: "Prijava nije pronađena ili je već rešena.", code: "NOT_FOUND" });
  if (b.data.status === "resolved") {
    const [listing] = await db.select().from(beautyJobListingsTable).where(eq(beautyJobListingsTable.id, report.listingId)).limit(1);
    if (listing) { const recipient = await listingRecipient(listing); if (recipient) await notification(recipient, "moderation", "Oglas je uklonjen nakon prijave", b.data.resolutionNote || listing.title, listing.id); }
  }
  res.json(ResolveBeautyJobReportResponse.parse(reportView(report)));
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
  res.json(GetBeautyJobResponse.parse(view({ ...row!.listing, ...row! })));
} catch (e) { next(e); } });

export default router;