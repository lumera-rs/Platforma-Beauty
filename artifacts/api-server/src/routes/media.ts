import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { isSupportedProductDocument } from "../lib/commerce-g-domain";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import sharp from "sharp";
import {
  coursesTable,
  db,
  educationCentersTable,
  educationCenterSubscriptionsTable,
  educationInstructorsTable,
  educationMediaTable,
  employeesTable,
  mediaAssetsTable,
  mediaUploadTicketsTable,
  mediaVariantsTable,
  productsTable,
  salonCustomersTable,
  salonsTable,
  suppliersTable,
  treatmentPhotosTable,
  usersTable,
} from "@workspace/db";
import {
  FinalizeMediaUploadParams,
  FinalizeMediaUploadResponse,
  GetMediaAssetParams,
  GetMediaAssetQueryParams,
  RequestMediaUploadBody,
  RequestMediaUploadResponse,
} from "@workspace/api-zod";
import { getCurrentUser, isAdmin } from "../lib/auth";
import { integrationValue } from "../lib/integrations";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const UPLOAD_TTL_SECONDS = 15 * 60;
const REVALIDATED_REVOCABLE_MEDIA_CACHE_CONTROL = "public, max-age=0, s-maxage=0, must-revalidate";
const CLOUDFLARE_API_TOKEN_ENV = "CLOUDFLARE_API_TOKEN";
const CLOUDFLARE_ZONE_ID_ENV = "CLOUDFLARE_ZONE_ID";
export const MEDIA_ROUTE_REGRESSION_CLEANUP_KEY = "media-route-regression";
export const MEDIA_ROUTE_REGRESSION_CONTROL_CLEANUP_KEY = "media-route-regression-control";
const MEDIA_ROUTE_REGRESSION_CLEANUP_KEYS = [
  MEDIA_ROUTE_REGRESSION_CLEANUP_KEY,
  MEDIA_ROUTE_REGRESSION_CONTROL_CLEANUP_KEY,
] as const;
type MediaRouteRegressionCleanupKey = typeof MEDIA_ROUTE_REGRESSION_CLEANUP_KEYS[number];
const MEDIA_ROUTE_REGRESSION_HEADER = "x-lumera-media-regression-token";
let mediaRouteRegressionMarker: {
  token: string;
  cleanupKey: MediaRouteRegressionCleanupKey;
} | null = null;
export type MediaCachePurgeRequest = {
  assetIds: string[];
  pathPrefixes: string[];
  surrogateKeys: string[];
};
type MediaCachePurgeHandler = (request: MediaCachePurgeRequest) => Promise<void>;
let mediaCachePurgeHandlerForTesting: MediaCachePurgeHandler | null = null;

function isMediaRouteRegressionCleanupKey(value: string | null): value is MediaRouteRegressionCleanupKey {
  return MEDIA_ROUTE_REGRESSION_CLEANUP_KEYS.some((cleanupKey) => cleanupKey === value);
}

/**
 * Enables an in-process test harness marker protected by an ephemeral token.
 * The token is returned only to the regression process and is never persisted.
 */
export function enableMediaRouteRegressionUploadMarking(
  cleanupKey: MediaRouteRegressionCleanupKey = MEDIA_ROUTE_REGRESSION_CLEANUP_KEY,
): {
  requestHeaders: Record<string, string>;
  disable: () => void;
} {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Media regression upload marking cannot run in production.");
  }
  if (mediaRouteRegressionMarker) {
    throw new Error("Media regression upload marking is already enabled.");
  }
  const token = randomBytes(32).toString("hex");
  mediaRouteRegressionMarker = { token, cleanupKey };
  return {
    requestHeaders: { [MEDIA_ROUTE_REGRESSION_HEADER]: token },
    disable: () => {
      if (mediaRouteRegressionMarker?.token === token) mediaRouteRegressionMarker = null;
    },
  };
}

/**
 * Lets the regression model a reverse proxy that stored older immutable media
 * responses. Production must use the configured purge endpoint instead.
 */
export function enableMediaCachePurgeForTesting(handler: MediaCachePurgeHandler): {
  disable: () => void;
} {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Media cache purge test controls cannot run in production.");
  }
  if (mediaCachePurgeHandlerForTesting) {
    throw new Error("Media cache purge test control is already enabled.");
  }
  mediaCachePurgeHandlerForTesting = handler;
  return {
    disable: () => {
      if (mediaCachePurgeHandlerForTesting === handler) mediaCachePurgeHandlerForTesting = null;
    },
  };
}

async function configuredCloudflareCachePurge(): Promise<{ apiKey: string; zoneId: string; origin: string }> {
  const [apiKey, zoneId, domain] = await Promise.all([
    integrationValue("cloudflare", "apiKey", process.env[CLOUDFLARE_API_TOKEN_ENV]),
    integrationValue("cloudflare", "zoneId", process.env[CLOUDFLARE_ZONE_ID_ENV]),
    integrationValue("cloudflare", "domain", process.env["APP_BASE_URL"]),
  ]);
  if (!apiKey || !zoneId || !domain) {
    throw new Error("Cloudflare API ključ, Zone ID i javni domen moraju biti podešeni pre deaktivacije salona.");
  }
  if (!/^[a-f0-9]{32}$/i.test(zoneId)) {
    throw new Error("Cloudflare Zone ID mora sadržati 32 heksadecimalna znaka.");
  }
  const rawOrigin = domain.trim().replace(/\/$/, "");
  if (!rawOrigin) throw new Error("Javni domen mora biti podešen za Cloudflare purge.");
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(rawOrigin);
  } catch {
    throw new Error("Javni domen mora biti ispravan HTTPS URL za Cloudflare purge.");
  }
  if (parsedOrigin.protocol !== "https:" || parsedOrigin.username || parsedOrigin.password) {
    throw new Error("Javni domen mora biti bezbedan HTTPS URL za Cloudflare purge.");
  }
  return { apiKey, zoneId, origin: parsedOrigin.origin };
}

export function mediaCachePurgeRequest(assetIds: readonly string[]): MediaCachePurgeRequest {
  const uniqueAssetIds = [...new Set(assetIds)];
  return {
    assetIds: uniqueAssetIds,
    // A path prefix includes every query-string size/format combination and
    // every Accept-negotiated representation that an older cache may retain.
    pathPrefixes: uniqueAssetIds.map((assetId) => `/api/media/${assetId}`),
    surrogateKeys: uniqueAssetIds.map((assetId) => `media-asset-${assetId}`),
  };
}

/**
 * Production deactivation is fail-closed until a cache owner is configured.
 * A long-lived immutable response cannot be revoked by changing origin headers
 * after it has already been stored by a browser or reverse proxy.
 */
export async function requireMediaCachePurgeForVisibilityRevocation(): Promise<void> {
  if (mediaCachePurgeHandlerForTesting || process.env.NODE_ENV !== "production") return;
  await configuredCloudflareCachePurge();
}

export async function purgeMediaCacheForVisibilityRevocation(assetIds: readonly string[]): Promise<void> {
  const request = mediaCachePurgeRequest(assetIds);
  if (!request.assetIds.length) return;
  if (mediaCachePurgeHandlerForTesting) {
    await mediaCachePurgeHandlerForTesting(request);
    return;
  }
  if (process.env.NODE_ENV !== "production") return;
  const configured = await configuredCloudflareCachePurge();
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${configured.zoneId}/purge_cache`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${configured.apiKey}`,
      "cache-control": "no-store",
    },
    body: JSON.stringify({
      prefixes: request.pathPrefixes.map((pathPrefix) => `${configured.origin}${pathPrefix}`),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => null) as { success?: boolean; errors?: Array<{ message?: string }> } | null;
  if (!response.ok || result?.success !== true) {
    const providerMessage = result?.errors?.find((error) => typeof error.message === "string")?.message;
    throw new Error(providerMessage ? `Cloudflare purge nije uspeo: ${providerMessage}` : `Cloudflare purge nije uspeo (${response.status}).`);
  }
}
const SUPPORTED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const CONTENT_TYPE_BY_SHARP_FORMAT: Record<string, string> = {
  avif: "image/avif",
  heif: "image/avif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

type MediaScope =
  | "salon-profile"
  | "salon-gallery"
  | "employee-avatar"
  | "product"
  | "product-document"
  | "supplier"
  | "education-cover"
  | "education-gallery"
  | "education-center"
  | "instructor-avatar"
  | "service-category"
  | "product-category"
  | "treatment-photo"
  | "jobseeker-portfolio"
  | "rma-photo"
  | "retail-review-photo";

// These references can be removed from public resources after an image URL has
// been issued. They must revalidate at the origin instead of letting a stable,
// content-versioned URL remain in a shared cache for a year.
const REVOCABLE_PUBLIC_MEDIA_SCOPES = new Set<string>([
  "salon-profile",
  "salon-gallery",
  "employee-avatar",
  "product",
  "product-document",
  "supplier",
  "service-category",
  "product-category",
]);

type MediaVariantInsert = typeof mediaVariantsTable.$inferInsert;

function privateObjectRoot(): string {
  const root = process.env.PRIVATE_OBJECT_DIR;
  if (!root) throw new Error("App Storage nije podešen.");
  return root.replace(/\/+$/, "");
}

function privateObjectPath(storagePath: string): string {
  if (!storagePath.startsWith("/objects/")) throw new Error("Neispravna App Storage putanja.");
  return `${privateObjectRoot()}/${storagePath.slice("/objects/".length)}`;
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

async function putPrivateObject(storagePath: string, contentType: string, bytes: Buffer): Promise<void> {
  const uploadUrl = await signPrivateObject(privateObjectPath(storagePath), "PUT", 120);
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: bytes,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`App Storage nije sačuvao sliku (${response.status}).`);
}

export async function deletePrivateStorageObject(storagePath: string): Promise<void> {
  const deleteUrl = await signPrivateObject(privateObjectPath(storagePath), "DELETE", 60);
  const response = await fetch(deleteUrl, { method: "DELETE", signal: AbortSignal.timeout(30_000) });
  if (!response.ok && response.status !== 404) throw new Error(`App Storage nije obrisao objekat (${response.status}).`);
}

export async function readPrivateStorageObject(storagePath: string): Promise<Buffer | null> {
  const downloadUrl = await signPrivateObject(privateObjectPath(storagePath), "GET", 60);
  const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(45_000) });
  if (!response.ok) return null;
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) {
    response.body?.cancel();
    return null;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES ? bytes : null;
}

async function requireMediaUser(req: Request, res: Response) {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Prijavite se da biste otpremili fotografiju." });
    return null;
  }
  return user;
}

async function ownedSalon(userId: string) {
  const [owner] = await db.select({ activeSalonId: usersTable.activeSalonId }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const [selected] = owner?.activeSalonId
    ? await db.select().from(salonsTable).where(and(eq(salonsTable.ownerId, userId), eq(salonsTable.id, owner.activeSalonId))).limit(1)
    : [];
  if (selected) return selected;
  const [fallback] = await db.select().from(salonsTable)
    .where(eq(salonsTable.ownerId, userId))
    .orderBy(asc(salonsTable.createdAt), asc(salonsTable.id))
    .limit(1);
  if (fallback && owner?.activeSalonId !== fallback.id) {
    await db.update(usersTable).set({ activeSalonId: fallback.id, updatedAt: new Date() }).where(eq(usersTable.id, userId));
  }
  return fallback ?? null;
}

/**
 * Resolves a client scope to a resource the current user actually controls.
 * The returned resource ID, not the untrusted request value, is persisted.
 */
async function authorizeUploadScope(
  user: typeof usersTable.$inferSelect,
  scope: MediaScope,
  requestedResourceId: string | null | undefined,
): Promise<{ resourceId: string | null; visibility: "public" | "private" | "education" } | null> {
  if (scope === "rma-photo") {
    // RMA creation performs the atomic owner/resource claim. Until then the
    // finalized image is private and has no browser-selected resource owner.
    return ["CUSTOMER", "JOBSEEKER", "SALON_OWNER"].includes(user.role) && !requestedResourceId
      ? { resourceId: null, visibility: "private" }
      : null;
  }
  if (scope === "retail-review-photo") {
    return ["CUSTOMER", "JOBSEEKER"].includes(user.role) && !requestedResourceId
      ? { resourceId: null, visibility: "private" }
      : null;
  }
  if (scope === "jobseeker-portfolio") {
    // The profile route performs the later atomic claim.  Never trust a
    // browser-provided resource id for this owner-only private scope.
    return user.role === "JOBSEEKER" && !requestedResourceId
      ? { resourceId: null, visibility: "private" }
      : null;
  }
  if (scope === "treatment-photo") {
    // Employees upload before/after photos of their own completed treatments.
    // The asset stays PRIVATE and unattached (resourceId null) until the
    // treatment-photo row is created and claims it; reads are authorized in
    // mayReadAsset via the treatment_photos row.
    if (user.role !== "SALON_EMPLOYEE") return null;
    const [employee] = await db.select({ id: employeesTable.id }).from(employeesTable)
      .where(and(eq(employeesTable.userId, user.id), eq(employeesTable.active, true))).limit(1);
    if (!employee) return null;
    return { resourceId: null, visibility: "private" };
  }
  if (scope === "employee-avatar" && user.role === "SALON_EMPLOYEE") {
    const [employee] = await db.select({ id: employeesTable.id }).from(employeesTable)
      .where(and(eq(employeesTable.userId, user.id), eq(employeesTable.active, true))).limit(1);
    if (!employee || (requestedResourceId && requestedResourceId !== employee.id)) return null;
    return { resourceId: employee.id, visibility: "public" };
  }
  if (scope === "salon-profile" || scope === "salon-gallery" || scope === "employee-avatar") {
    if (!["SALON_OWNER", "EDUKATIVNI_CENTAR"].includes(user.role)) return null;
    const salon = await ownedSalon(user.id);
    if (!salon) return null;
    if (scope === "employee-avatar" && requestedResourceId) {
      const [employee] = await db.select({ id: employeesTable.id }).from(employeesTable)
        .where(and(eq(employeesTable.id, requestedResourceId), eq(employeesTable.salonId, salon.id))).limit(1);
      if (!employee) return null;
      return { resourceId: employee.id, visibility: "public" };
    }
    return { resourceId: scope === "employee-avatar" ? null : salon.id, visibility: "public" };
  }

  if (scope === "product" || scope === "product-document" || scope === "supplier" || scope === "service-category" || scope === "product-category") {
    if (!isAdmin(user)) return null;
    if ((scope === "product" || scope === "product-document") && requestedResourceId) {
      const [product] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.id, requestedResourceId)).limit(1);
      if (!product) return null;
    }
    if (scope === "supplier" && requestedResourceId) {
      const [supplier] = await db.select({ id: suppliersTable.id }).from(suppliersTable).where(eq(suppliersTable.id, requestedResourceId)).limit(1);
      if (!supplier) return null;
    }
    return { resourceId: requestedResourceId ?? null, visibility: "public" };
  }

  if (scope === "education-cover" || scope === "education-gallery") {
    if (!["SALON_OWNER", "EDUKATIVNI_CENTAR"].includes(user.role)) return null;
    if (!requestedResourceId) {
      if (scope === "education-gallery") return null;
      const mayCreate = user.role === "SALON_OWNER"
        ? Boolean(await ownedSalon(user.id))
        : Boolean((await db.select({ id: educationCentersTable.id }).from(educationCentersTable).where(eq(educationCentersTable.ownerId, user.id)).limit(1))[0]);
      return mayCreate ? { resourceId: null, visibility: "private" } : null;
    }
    const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, requestedResourceId)).limit(1);
    if (!course) return null;
    const ownsCourse = user.role === "SALON_OWNER"
      ? Boolean((await ownedSalon(user.id))?.id === course.salonId)
      : Boolean(course.centerId && (await db.select({ id: educationCentersTable.id }).from(educationCentersTable)
        .where(and(eq(educationCentersTable.id, course.centerId), eq(educationCentersTable.ownerId, user.id))).limit(1))[0]);
    return ownsCourse ? { resourceId: course.id, visibility: "education" } : null;
  }

  if (scope === "education-center") {
    if (user.role !== "EDUKATIVNI_CENTAR" || !requestedResourceId) return null;
    const [center] = await db.select({ id: educationCentersTable.id }).from(educationCentersTable)
      .where(and(eq(educationCentersTable.id, requestedResourceId), eq(educationCentersTable.ownerId, user.id))).limit(1);
    return center ? { resourceId: center.id, visibility: "public" } : null;
  }

  if (scope === "instructor-avatar") {
    if (user.role !== "EDUKATIVNI_CENTAR" || !requestedResourceId) return null;
    const [instructor] = await db.select({ id: educationInstructorsTable.id }).from(educationInstructorsTable)
      .innerJoin(educationCentersTable, eq(educationInstructorsTable.centerId, educationCentersTable.id))
      .where(and(eq(educationInstructorsTable.id, requestedResourceId), eq(educationCentersTable.ownerId, user.id))).limit(1);
    return instructor ? { resourceId: instructor.id, visibility: "public" } : null;
  }

  return null;
}

export function stableMediaUrl(asset: Pick<typeof mediaAssetsTable.$inferSelect, "id" | "contentHash">): string {
  return `/api/media/${asset.id}?v=${asset.contentHash.slice(0, 16)}`;
}

export function mediaAssetIdFromUrl(url: string): string | null {
  const match = /^\/api\/media\/([0-9a-f-]{36})(?:\?|$)/i.exec(url.trim());
  return match && UUID_PATTERN.test(match[1]!) ? match[1]! : null;
}

export async function canClaimMediaReference(input: {
  userId: string;
  url: string;
  scope: MediaScope;
  resourceId?: string;
  existingUrls?: readonly (string | null | undefined)[];
}): Promise<boolean> {
  const assetId = mediaAssetIdFromUrl(input.url);
  if (!assetId) {
    const normalized = input.url.trim();
    return input.existingUrls?.some((existing) => existing?.trim() === normalized) ?? false;
  }
  const [asset] = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.id, assetId)).limit(1);
  return Boolean(
    asset
    && asset.ownerUserId === input.userId
    && asset.scope === input.scope
    && !asset.cleanupReservedAt
    && (!asset.resourceId || !input.resourceId || asset.resourceId === input.resourceId),
  );
}

export async function claimMediaReference(input: {
  userId: string;
  url: string;
  scope: MediaScope;
  resourceId: string;
  visibility?: "public" | "private" | "education";
}, executor: Pick<typeof db, "update"> = db): Promise<boolean> {
  const assetId = mediaAssetIdFromUrl(input.url);
  if (!assetId) return false;
  const [asset] = await executor.update(mediaAssetsTable).set({
    resourceId: input.resourceId,
    visibility: input.visibility ?? (input.scope.startsWith("education-") ? "education" : "public"),
  }).where(and(
    eq(mediaAssetsTable.id, assetId),
    eq(mediaAssetsTable.ownerUserId, input.userId),
    eq(mediaAssetsTable.scope, input.scope),
    isNull(mediaAssetsTable.cleanupReservedAt),
    or(isNull(mediaAssetsTable.resourceId), eq(mediaAssetsTable.resourceId, input.resourceId)),
  )).returning();
  return Boolean(asset);
}

/**
 * Reconciles only the managed media already referenced by a salon.
 * This is intentionally stricter than a URL match: an asset must be owned by
 * the salon, have the matching salon-media scope, and be unreserved. Active
 * salons may publish an unclaimed or already salon-bound asset; inactive
 * salons only privatize already-public assets bound to that salon.
 */
export async function publishActiveSalonMediaReferences(input: {
  salonId: string;
  ownerUserId: string;
  active: boolean;
  imageUrl: string;
  gallery: readonly string[];
}, executor: Pick<typeof db, "update"> = db): Promise<string[]> {
  const references = [
    { url: input.imageUrl, scope: "salon-profile" as const },
    ...input.gallery.map((url) => ({ url, scope: "salon-gallery" as const })),
  ];
  const changedAssetIds: string[] = [];
  for (const { url, scope } of references) {
    const assetId = mediaAssetIdFromUrl(url);
    if (!assetId) continue;
    const [asset] = await executor.update(mediaAssetsTable)
      .set(input.active
        ? { resourceId: input.salonId, visibility: "public" }
        : { visibility: "private" })
      .where(and(
        eq(mediaAssetsTable.id, assetId),
        eq(mediaAssetsTable.ownerUserId, input.ownerUserId),
        eq(mediaAssetsTable.scope, scope),
        isNull(mediaAssetsTable.cleanupReservedAt),
        input.active
          ? or(isNull(mediaAssetsTable.resourceId), eq(mediaAssetsTable.resourceId, input.salonId))
          : and(eq(mediaAssetsTable.resourceId, input.salonId), eq(mediaAssetsTable.visibility, "public")),
      )).returning({ id: mediaAssetsTable.id });
    if (asset) changedAssetIds.push(asset.id);
  }
  return changedAssetIds;
}

export async function releaseMediaReferenceClaims(input: {
  urls: readonly string[];
  resourceId: string;
  visibility?: "public" | "private" | "education";
}, executor: Pick<typeof db, "update"> = db): Promise<string[]> {
  const assetIds = input.urls
    .map(mediaAssetIdFromUrl)
    .filter((assetId): assetId is string => Boolean(assetId));
  if (!assetIds.length) return [];
  const released = await executor.update(mediaAssetsTable).set({
    resourceId: null,
    ...(input.visibility ? { visibility: input.visibility } : {}),
  }).where(and(
    inArray(mediaAssetsTable.id, assetIds),
    eq(mediaAssetsTable.resourceId, input.resourceId),
  )).returning({ id: mediaAssetsTable.id });
  return released.map((asset) => asset.id);
}

function extensionFor(contentType: string): string {
  if (contentType === "application/pdf") return "pdf";
  if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (contentType === "image/avif") return "avif";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/png") return "png";
  return "jpg";
}

function variantStoragePath(assetId: string, hash: string, sizeName: string, format: string, contentType: string): string {
  return `/objects/media/${assetId}/${hash.slice(0, 20)}/${sizeName}-${format}.${extensionFor(contentType)}`;
}

async function addVariant(
  assetId: string,
  contentHash: string,
  sizeName: string,
  format: string,
  contentType: string,
  width: number,
  height: number,
  bytes: Buffer,
  beforeUpload?: (objectPath: string) => Promise<void>,
): Promise<MediaVariantInsert> {
  const objectPath = variantStoragePath(assetId, contentHash, sizeName, format, contentType);
  try {
    await beforeUpload?.(objectPath);
    await putPrivateObject(objectPath, contentType, bytes);
  } catch (error) {
    await deletePrivateStorageObject(objectPath).catch(() => undefined);
    throw error;
  }
  return {
    assetId,
    sizeName,
    format,
    objectPath,
    contentType,
    width,
    height,
    byteSize: bytes.length,
    etag: `"${createHash("sha256").update(bytes).digest("hex")}"`,
  };
}

export async function cleanupPromotedMediaVariants(
  variants: readonly Pick<MediaVariantInsert, "objectPath">[],
): Promise<void> {
  await Promise.allSettled(variants.map(({ objectPath }) => deletePrivateStorageObject(objectPath)));
}

export async function processImageBytes(input: {
  assetId: string;
  bytes: Buffer;
  declaredContentType: string;
  beforeVariantUpload?: (objectPath: string) => Promise<void>;
}): Promise<{
  width: number;
  height: number;
  contentType: string;
  contentHash: string;
  variants: MediaVariantInsert[];
}> {
  const metadata = await sharp(input.bytes, {
    failOn: "warning",
    limitInputPixels: MAX_IMAGE_PIXELS,
  }).metadata();
  const detectedContentType = metadata.format ? CONTENT_TYPE_BY_SHARP_FORMAT[metadata.format] : undefined;
  if (!detectedContentType || detectedContentType !== input.declaredContentType || !SUPPORTED_CONTENT_TYPES.has(detectedContentType)) {
    throw new Error("Sadržaj datoteke ne odgovara prijavljenom tipu slike.");
  }
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
    throw new Error("Dimenzije slike nisu ispravne ili su prevelike.");
  }
  if ((metadata.pages ?? 1) > 1) throw new Error("Animirane i višestranične slike nisu podržane.");

  const contentHash = createHash("sha256").update(input.bytes).digest("hex");
  const variants: MediaVariantInsert[] = [];
  try {
    variants.push(await addVariant(
      input.assetId,
      contentHash,
      "original",
      "original",
      detectedContentType,
      metadata.width,
      metadata.height,
      input.bytes,
      input.beforeVariantUpload,
    ));

    const normalized = sharp(input.bytes, { failOn: "warning", limitInputPixels: MAX_IMAGE_PIXELS }).rotate();
    const normalizedMetadata = await normalized.clone().metadata();
    const fallbackContentType = normalizedMetadata.hasAlpha ? "image/png" : "image/jpeg";
    const sizes = [
      { name: "thumbnail", width: 320 },
      { name: "medium", width: 800 },
      { name: "large", width: 1600 },
    ] as const;
    const avifEnabled = sharp.format.heif.output.buffer;

    for (const size of sizes) {
      const resized = normalized.clone().resize({
        width: size.width,
        height: size.width,
        fit: "inside",
        withoutEnlargement: true,
      });
      const fallbackBytes = fallbackContentType === "image/png"
        ? await resized.clone().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
        : await resized.clone().jpeg({ quality: 84, mozjpeg: true }).toBuffer();
      const fallbackMetadata = await sharp(fallbackBytes).metadata();
      variants.push(await addVariant(
        input.assetId,
        contentHash,
        size.name,
        "fallback",
        fallbackContentType,
        fallbackMetadata.width!,
        fallbackMetadata.height!,
        fallbackBytes,
        input.beforeVariantUpload,
      ));

      const webpBytes = await resized.clone().webp({ quality: 82, effort: 4 }).toBuffer();
      const webpMetadata = await sharp(webpBytes).metadata();
      variants.push(await addVariant(
        input.assetId,
        contentHash,
        size.name,
        "webp",
        "image/webp",
        webpMetadata.width!,
        webpMetadata.height!,
        webpBytes,
        input.beforeVariantUpload,
      ));

      if (avifEnabled) {
        try {
          const avifBytes = await resized.clone().avif({ quality: 52, effort: 4 }).toBuffer();
          const avifMetadata = await sharp(avifBytes).metadata();
          variants.push(await addVariant(
            input.assetId,
            contentHash,
            size.name,
            "avif",
            "image/avif",
            avifMetadata.width!,
            avifMetadata.height!,
            avifBytes,
            input.beforeVariantUpload,
          ));
        } catch (error) {
          logger.warn({ err: error, assetId: input.assetId, size: size.name }, "AVIF encoder unavailable; keeping WebP and fallback variants");
        }
      }
    }
  } catch (error) {
    await cleanupPromotedMediaVariants(variants);
    throw error;
  }

  return {
    width: metadata.width,
    height: metadata.height,
    contentType: detectedContentType,
    contentHash,
    variants,
  };
}

async function readStagedUpload(ticket: typeof mediaUploadTicketsTable.$inferSelect): Promise<Buffer> {
  const downloadUrl = await signPrivateObject(privateObjectPath(ticket.stagingObjectPath), "GET", 60);
  const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error("Otpremanje nije pronađeno u App Storage-u.");
  const responseType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
  const responseLength = Number(response.headers.get("content-length"));
  if (responseType !== ticket.contentType || !Number.isInteger(responseLength) || responseLength !== ticket.byteSize || responseLength > MAX_IMAGE_BYTES) {
    response.body?.cancel();
    throw new Error("Otpremanje ne odgovara najavljenoj datoteci.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== ticket.byteSize) throw new Error("Otpremanje nije kompletno.");
  return bytes;
}

function mediaAssetResponse(asset: typeof mediaAssetsTable.$inferSelect) {
  return FinalizeMediaUploadResponse.parse({
    id: asset.id,
    imageUrl: stableMediaUrl(asset),
    width: asset.width,
    height: asset.height,
    contentHash: asset.contentHash,
  });
}

export async function recordMediaRouteRegressionPromotionPath(
  uploadId: string,
  objectPath: string,
): Promise<void> {
  const [recorded] = await db.update(mediaUploadTicketsTable).set({
    promotionCleanupPaths: sql`
      ${mediaUploadTicketsTable.promotionCleanupPaths}
      || jsonb_build_array(${objectPath}::text)
    `,
  }).where(and(
    eq(mediaUploadTicketsTable.id, uploadId),
    inArray(mediaUploadTicketsTable.testCleanupKey, [...MEDIA_ROUTE_REGRESSION_CLEANUP_KEYS]),
  )).returning({ id: mediaUploadTicketsTable.id });
  if (!recorded) {
    throw new Error("Media regression upload disappeared before promotion could be recorded.");
  }
}

router.post("/media/uploads", async (req, res): Promise<void> => {
  const user = await requireMediaUser(req, res); if (!user) return;
  const parsed = RequestMediaUploadBody.safeParse(req.body);
  if (!parsed.success) {
    const requestedSize = typeof req.body?.size === "number" ? req.body.size : 0;
    res.status(requestedSize > MAX_IMAGE_BYTES ? 413 : 400).json({
      error: requestedSize > MAX_IMAGE_BYTES
        ? "Fotografija ne može biti veća od 12 MB."
        : "Izaberite JPG, PNG, WEBP ili AVIF fotografiju.",
    });
    return;
  }
  const body = parsed.data;
  const isProductDocument = body.scope === "product-document";
  const isDocumentType = body.contentType === "application/pdf"
    || body.contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (isProductDocument !== isDocumentType) {
    res.status(400).json({ error: "PDF/DOCX uploads are allowed only for product-document scope." });
    return;
  }
  const authorization = await authorizeUploadScope(user, body.scope as MediaScope, body.resourceId);
  if (!authorization) {
    res.status(403).json({ error: "Nemate pravo da postavite fotografiju za izabrani sadržaj." });
    return;
  }
  const uploadId = randomUUID();
  const stagingObjectPath = `/objects/media-staging/${user.id}/${uploadId}`;
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000);
  try {
    const uploadUrl = await signPrivateObject(privateObjectPath(stagingObjectPath), "PUT", UPLOAD_TTL_SECONDS);
    await db.insert(mediaUploadTicketsTable).values({
      id: uploadId,
      ownerUserId: user.id,
      scope: body.scope,
      resourceId: authorization.resourceId,
      stagingObjectPath,
      originalFileName: body.name,
      contentType: body.contentType,
      byteSize: body.size,
      expiresAt,
      testCleanupKey: mediaRouteRegressionMarker
        && req.get(MEDIA_ROUTE_REGRESSION_HEADER) === mediaRouteRegressionMarker.token
        ? mediaRouteRegressionMarker.cleanupKey
        : null,
    });
    res.json(RequestMediaUploadResponse.parse({ uploadId, uploadUrl, expiresAt: expiresAt.toISOString() }));
  } catch (error) {
    req.log.error({ err: error, scope: body.scope }, "Could not create media upload ticket");
    res.status(502).json({ error: "Nije moguće pripremiti otpremanje fotografije." });
  }
});

router.post("/media/uploads/:uploadId/finalize", async (req, res): Promise<void> => {
  const user = await requireMediaUser(req, res); if (!user) return;
  const params = FinalizeMediaUploadParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Upload nije pronađen." }); return; }
  const [ticket] = await db.select().from(mediaUploadTicketsTable).where(eq(mediaUploadTicketsTable.id, params.data.uploadId)).limit(1);
  if (!ticket) { res.status(404).json({ error: "Upload nije pronađen." }); return; }
  if (ticket.ownerUserId !== user.id) { res.status(403).json({ error: "Ovaj upload pripada drugom nalogu." }); return; }
  if (ticket.finalizedAssetId) {
    const [asset] = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.id, ticket.finalizedAssetId)).limit(1);
    if (asset) { res.json(mediaAssetResponse(asset)); return; }
  }
  if (ticket.expiresAt <= new Date()) { res.status(410).json({ error: "Upload je istekao. Izaberite fotografiju ponovo." }); return; }
  const authorization = await authorizeUploadScope(user, ticket.scope as MediaScope, ticket.resourceId);
  if (!authorization) { res.status(403).json({ error: "Više nemate pravo da postavite ovu fotografiju." }); return; }

  let processed: Awaited<ReturnType<typeof processImageBytes>> | null = null;
  try {
    const bytes = await readStagedUpload(ticket);
    const beforeVariantUpload = isMediaRouteRegressionCleanupKey(ticket.testCleanupKey)
      ? (objectPath: string) => recordMediaRouteRegressionPromotionPath(ticket.id, objectPath)
      : undefined;
    const isDocument = ticket.scope === "product-document";
    if (isDocument) {
      if (!isSupportedProductDocument(ticket.originalFileName, ticket.contentType, bytes)) {
        throw new Error("Sadržaj dokumenta ne odgovara PDF/DOCX tipu.");
      }
    }
    const promoted = isDocument
      ? {
          // MediaAsset's public contract has positive dimensions. Documents
          // have no raster dimensions, so use the neutral 1×1 sentinel.
          width: 1, height: 1, contentType: ticket.contentType,
          contentHash: createHash("sha256").update(bytes).digest("hex"),
          variants: [await addVariant(
            ticket.id, createHash("sha256").update(bytes).digest("hex"), "original", "original",
            ticket.contentType, 1, 1, bytes, beforeVariantUpload,
          )],
        }
      : await processImageBytes({
          assetId: ticket.id, bytes, declaredContentType: ticket.contentType, beforeVariantUpload,
        });
    processed = promoted;
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`media-upload:${ticket.id}`}))`);
      const [lockedTicket] = await tx.select().from(mediaUploadTicketsTable).where(eq(mediaUploadTicketsTable.id, ticket.id)).for("update").limit(1);
      if (!lockedTicket) throw new Error("Upload je nestao tokom obrade.");
      if (lockedTicket.finalizedAssetId) {
        const [existing] = await tx.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.id, lockedTicket.finalizedAssetId)).limit(1);
        if (existing) return { asset: existing, created: false };
      }
      const [existingAsset] = await tx.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.id, ticket.id)).limit(1);
      if (existingAsset) {
        await tx.update(mediaUploadTicketsTable).set({ finalizedAssetId: existingAsset.id, finalizedAt: new Date() }).where(eq(mediaUploadTicketsTable.id, ticket.id));
        return { asset: existingAsset, created: false };
      }
      const [asset] = await tx.insert(mediaAssetsTable).values({
        id: ticket.id,
        ownerUserId: user.id,
        scope: ticket.scope,
        resourceId: null,
        visibility: "private",
        originalFileName: ticket.originalFileName,
        originalContentType: promoted.contentType,
        width: promoted.width,
        height: promoted.height,
        contentHash: promoted.contentHash,
        testCleanupKey: ticket.testCleanupKey,
      }).returning();
      await tx.insert(mediaVariantsTable).values(promoted.variants);
      await tx.update(mediaUploadTicketsTable).set({ finalizedAssetId: asset!.id, finalizedAt: new Date() }).where(eq(mediaUploadTicketsTable.id, ticket.id));
      return { asset: asset!, created: true };
    });
    try {
      await deletePrivateStorageObject(ticket.stagingObjectPath);
    } catch (cleanupError) {
      req.log.warn({ err: cleanupError, uploadId: ticket.id }, "Finalized media staging cleanup will be retried");
      await db.update(mediaUploadTicketsTable).set({
        cleanupFailureCount: ticket.cleanupFailureCount + 1,
        lastCleanupFailureAt: new Date(),
      }).where(eq(mediaUploadTicketsTable.id, ticket.id));
    }
    res.status(result.created ? 201 : 200).json(mediaAssetResponse(result.asset));
  } catch (error) {
    if (processed) {
      const [durableAsset] = await db.select({ id: mediaAssetsTable.id })
        .from(mediaAssetsTable)
        .where(eq(mediaAssetsTable.id, ticket.id))
        .limit(1)
        .catch(() => []);
      if (!durableAsset) await cleanupPromotedMediaVariants(processed.variants);
    }
    req.log.warn({ err: error, uploadId: ticket.id }, "Could not validate or finalize media upload");
    res.status(400).json({ error: error instanceof Error ? error.message : "Fotografija nije ispravna." });
  }
});

async function mayReadAsset(req: Request, asset: typeof mediaAssetsTable.$inferSelect): Promise<boolean> {
  if (asset.visibility === "public") return true;
  if (asset.visibility === "education" && asset.resourceId) {
    const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, asset.resourceId)).limit(1);
    const isLiveCourseReference = asset.scope === "education-cover"
      ? mediaAssetIdFromUrl(course?.imageUrl ?? "") === asset.id
      : asset.scope === "education-gallery"
        ? Boolean((await db.select({ id: educationMediaTable.id }).from(educationMediaTable).where(and(
          eq(educationMediaTable.id, asset.id),
          eq(educationMediaTable.courseId, asset.resourceId),
        )).limit(1))[0])
        : false;
    if (isLiveCourseReference && course?.published && !course.archived && course.centerId) {
      const [[center], [subscription]] = await Promise.all([
        db.select().from(educationCentersTable).where(eq(educationCentersTable.id, course.centerId)).limit(1),
        db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, course.centerId)).limit(1),
      ]);
      if (center?.verificationStatus === "verified" && ["active", "free_via_loyalty"].includes(subscription?.status ?? "")) return true;
    }
  }
  const user = await getCurrentUser(req);
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (asset.ownerUserId === user.id) return true;
  if (asset.scope === "treatment-photo" && asset.resourceId) {
    // resourceId is the treatment_photos row id after claim. Readable by the
    // salon owner (CRM profile view) and the customer the photo belongs to
    // (their own appointment view). The uploader is covered above.
    const [photo] = await db.select({
      salonOwnerId: salonsTable.ownerId,
      customerUserId: salonCustomersTable.userId,
    }).from(treatmentPhotosTable)
      .innerJoin(salonsTable, eq(salonsTable.id, treatmentPhotosTable.salonId))
      .innerJoin(salonCustomersTable, eq(salonCustomersTable.id, treatmentPhotosTable.salonCustomerId))
      .where(eq(treatmentPhotosTable.mediaAssetId, asset.id))
      .limit(1);
    if (photo && (photo.salonOwnerId === user.id || photo.customerUserId === user.id)) return true;
  }
  return false;
}

function preferredFormats(explicitFormat: string | undefined, accept: string): string[] {
  if (explicitFormat === "original") return ["original"];
  if (explicitFormat === "fallback") return ["fallback", "original"];
  if (explicitFormat === "webp") return ["webp", "fallback", "original"];
  if (explicitFormat === "avif") return ["avif", "webp", "fallback", "original"];
  return [
    ...(accept.includes("image/avif") ? ["avif"] : []),
    ...(accept.includes("image/webp") ? ["webp"] : []),
    "fallback",
    "original",
  ];
}

export function selectMediaVariant(
  variants: (typeof mediaVariantsTable.$inferSelect)[],
  sizeName: "thumbnail" | "medium" | "large" | "original",
  explicitFormat: "avif" | "webp" | "fallback" | "original" | undefined,
  accept: string,
) {
  if (sizeName === "original") return variants.find((variant) => variant.sizeName === "original" && variant.format === "original") ?? null;
  for (const format of preferredFormats(explicitFormat, accept)) {
    const match = variants.find((variant) => variant.sizeName === sizeName && variant.format === format);
    if (match) return match;
  }
  return null;
}

router.get("/media/:assetId", async (req, res): Promise<void> => {
  const [params, query] = [GetMediaAssetParams.safeParse(req.params), GetMediaAssetQueryParams.safeParse(req.query)];
  if (!params.success || !query.success) {
    res.setHeader("Cache-Control", "private, no-store");
    res.status(404).json({ error: "Fotografija nije pronađena." });
    return;
  }
  const [asset] = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.id, params.data.assetId)).limit(1);
  if (!asset) {
    res.setHeader("Cache-Control", "private, no-store");
    res.status(404).json({ error: "Fotografija nije pronađena." });
    return;
  }
  const canRead = await mayReadAsset(req, asset);
  if (!canRead) {
    res.setHeader("Cache-Control", "private, no-store");
    res.status(403).json({ error: "Nemate pristup ovoj fotografiji." });
    return;
  }
  const variants = await db.select().from(mediaVariantsTable).where(eq(mediaVariantsTable.assetId, asset.id));
  const variant = selectMediaVariant(variants, query.data.size, query.data.format, String(req.headers.accept ?? ""));
  if (!variant) {
    res.setHeader("Cache-Control", "private, no-store");
    res.status(404).json({ error: "Tražena veličina fotografije nije dostupna." });
    return;
  }

  const isPublic = asset.visibility === "public";
  const versionMatches = typeof req.query.v === "string" && req.query.v === asset.contentHash.slice(0, 16);
  const isRevocablePublicMedia = REVOCABLE_PUBLIC_MEDIA_SCOPES.has(asset.scope);
  res.setHeader("Content-Type", variant.contentType);
  if (asset.scope === "product-document") {
    const safeName = asset.originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  }
  res.setHeader("Content-Length", String(variant.byteSize));
  res.setHeader("ETag", variant.etag);
  res.setHeader("Vary", isPublic ? "Accept" : "Accept, Cookie");
  if (isPublic) {
    const cacheTag = `media-asset-${asset.id}`;
    // Cache-Tag is understood by Cloudflare; Surrogate-Key is retained for
    // compatible intermediary caches already configured around the API.
    res.setHeader("Cache-Tag", cacheTag);
    res.setHeader("Surrogate-Key", cacheTag);
  }
  res.setHeader(
    "Cache-Control",
    isPublic
      ? isRevocablePublicMedia
        ? REVALIDATED_REVOCABLE_MEDIA_CACHE_CONTROL
        : versionMatches ? "public, max-age=31536000, immutable" : "public, max-age=300, s-maxage=3600"
      : "private, no-store",
  );
  if (req.headers["if-none-match"] === variant.etag) { res.status(304).end(); return; }

  try {
    const downloadUrl = await signPrivateObject(privateObjectPath(variant.objectPath), "GET", 120);
    const source = await fetch(downloadUrl, { signal: AbortSignal.timeout(30_000) });
    if (!source.ok || !source.body) { res.status(404).json({ error: "Fotografija nije pronađena." }); return; }
    Readable.fromWeb(source.body as ReadableStream<Uint8Array>).pipe(res);
  } catch (error) {
    req.log.error({ err: error, assetId: asset.id, variantId: variant.id }, "Could not serve media variant");
    res.status(502).json({ error: "Fotografija trenutno nije dostupna." });
  }
});

export async function runMediaUploadCleanup(options: {
  afterAbandonedCandidate?: (assetId: string) => Promise<void>;
} = {}): Promise<void> {
  const candidates = await db.select().from(mediaUploadTicketsTable).where(and(
    lt(mediaUploadTicketsTable.expiresAt, new Date()),
    or(isNull(mediaUploadTicketsTable.finalizedAt), sql`${mediaUploadTicketsTable.cleanupFailureCount} > 0`),
  )).limit(100);
  for (const ticket of candidates) {
    try {
      await deletePrivateStorageObject(ticket.stagingObjectPath);
      if (ticket.finalizedAt) {
        await db.update(mediaUploadTicketsTable).set({ cleanupFailureCount: 0, lastCleanupFailureAt: null })
          .where(eq(mediaUploadTicketsTable.id, ticket.id));
      } else {
        await db.delete(mediaUploadTicketsTable).where(eq(mediaUploadTicketsTable.id, ticket.id));
      }
    } catch (error) {
      await db.update(mediaUploadTicketsTable).set({
        cleanupFailureCount: ticket.cleanupFailureCount + 1,
        lastCleanupFailureAt: new Date(),
      }).where(eq(mediaUploadTicketsTable.id, ticket.id));
      logger.warn({ err: error, uploadId: ticket.id }, "Media staging cleanup failed");
    }
  }

  const abandoned = await db.select({
    ticketId: mediaUploadTicketsTable.id,
    assetId: mediaAssetsTable.id,
  }).from(mediaUploadTicketsTable)
    .innerJoin(mediaAssetsTable, eq(mediaUploadTicketsTable.finalizedAssetId, mediaAssetsTable.id))
    .where(and(
      lt(mediaUploadTicketsTable.expiresAt, new Date()),
      isNotNull(mediaUploadTicketsTable.finalizedAt),
      isNull(mediaAssetsTable.resourceId),
      or(
        isNull(mediaAssetsTable.cleanupReservedAt),
        lt(mediaAssetsTable.cleanupReservedAt, new Date(Date.now() - 5 * 60_000)),
      ),
    ))
    .limit(100);
  for (const item of abandoned) {
    await options.afterAbandonedCandidate?.(item.assetId);
    const reservationTime = new Date();
    const [reserved] = await db.update(mediaAssetsTable)
      .set({ cleanupReservedAt: reservationTime })
      .where(and(
        eq(mediaAssetsTable.id, item.assetId),
        isNull(mediaAssetsTable.resourceId),
        or(
          isNull(mediaAssetsTable.cleanupReservedAt),
          lt(mediaAssetsTable.cleanupReservedAt, new Date(Date.now() - 5 * 60_000)),
        ),
      ))
      .returning({ id: mediaAssetsTable.id });
    if (!reserved) continue;
    const variants = await db.select({ objectPath: mediaVariantsTable.objectPath })
      .from(mediaVariantsTable)
      .where(eq(mediaVariantsTable.assetId, item.assetId));
    try {
      for (const variant of variants) await deletePrivateStorageObject(variant.objectPath);
      await db.transaction(async (tx) => {
        await tx.delete(mediaUploadTicketsTable).where(eq(mediaUploadTicketsTable.id, item.ticketId));
        await tx.delete(mediaAssetsTable).where(and(
          eq(mediaAssetsTable.id, item.assetId),
          isNull(mediaAssetsTable.resourceId),
          eq(mediaAssetsTable.cleanupReservedAt, reservationTime),
        ));
      });
    } catch (error) {
      logger.warn({ err: error, assetId: item.assetId }, "Unattached finalized media cleanup failed");
    }
  }
}

/**
 * Removes media left behind by a force-stopped media route regression.
 *
 * The marker is database-only and never originates from a browser request.
 * This intentionally does not inspect filenames, owners, or business records,
 * which keeps cleanup independent from fixture state and excludes real uploads.
 */
export async function cleanupMediaRouteRegressionUploads(options: {
  cleanupKeys?: readonly MediaRouteRegressionCleanupKey[];
} = {}): Promise<{
  tickets: number;
  assets: number;
}> {
  if (mediaRouteRegressionMarker) {
    throw new Error("Media regression recovery cannot run while regression uploads are active.");
  }
  const cleanupKeys = [...(options.cleanupKeys ?? MEDIA_ROUTE_REGRESSION_CLEANUP_KEYS)];
  if (!cleanupKeys.length || cleanupKeys.some((key) => !isMediaRouteRegressionCleanupKey(key))) {
    throw new Error("Media regression recovery received an unsupported cleanup key.");
  }
  const [tickets, assets] = await Promise.all([
    db.select({
      id: mediaUploadTicketsTable.id,
      stagingObjectPath: mediaUploadTicketsTable.stagingObjectPath,
      promotionCleanupPaths: mediaUploadTicketsTable.promotionCleanupPaths,
    }).from(mediaUploadTicketsTable)
      .where(inArray(mediaUploadTicketsTable.testCleanupKey, cleanupKeys)),
    db.select({ id: mediaAssetsTable.id })
      .from(mediaAssetsTable)
      .where(inArray(mediaAssetsTable.testCleanupKey, cleanupKeys)),
  ]);
  if (!tickets.length && !assets.length) return { tickets: 0, assets: 0 };

  const assetIds = assets.map(({ id }) => id);
  const variants = assetIds.length
    ? await db.select({ objectPath: mediaVariantsTable.objectPath })
      .from(mediaVariantsTable)
      .where(inArray(mediaVariantsTable.assetId, assetIds))
    : [];
  const objectPaths = new Set([
    ...tickets.map(({ stagingObjectPath }) => stagingObjectPath),
    ...tickets.flatMap(({ promotionCleanupPaths }) => (
      Array.isArray(promotionCleanupPaths)
        ? promotionCleanupPaths.filter((path): path is string => typeof path === "string")
        : []
    )),
    ...variants.map(({ objectPath }) => objectPath),
  ]);
  const deletions = await Promise.allSettled(
    [...objectPaths].map((objectPath) => deletePrivateStorageObject(objectPath)),
  );
  const failures = deletions
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length) {
    throw new AggregateError(failures, "Media regression recovery could not remove every App Storage object.");
  }

  await db.transaction(async (tx) => {
    await tx.delete(mediaUploadTicketsTable)
      .where(inArray(mediaUploadTicketsTable.testCleanupKey, cleanupKeys));
    await tx.delete(mediaAssetsTable)
      .where(inArray(mediaAssetsTable.testCleanupKey, cleanupKeys));
  });
  return { tickets: tickets.length, assets: assets.length };
}

export default router;