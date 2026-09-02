import { Router, type IRouter } from "express";
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { imageAssetsTable, db, type ImageAssetVariantSet } from "@workspace/db";
import { getCurrentUser } from "../lib/auth";
import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  MAX_IMAGE_UPLOAD_BYTES,
  deletePrivateObject,
  generateOptimizedImageSet,
  imageAssetOriginalStoragePath,
  imageAssetStagingStoragePath,
  imageAssetVariantStoragePath,
  imageVariantMetadata,
  rawPrivateObjectPath,
  readPrivateObject,
  signPrivateObject,
  uploadPrivateObject,
} from "../lib/image-storage";

const router: IRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANAGED_IMAGE_URL_PATTERN = /^\/api\/media\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\?.*)?$/i;
const IMAGE_UPLOAD_TTL_MS = 30 * 60 * 1000;
const UNATTACHED_READY_TTL_MS = 24 * 60 * 60 * 1000;
const PERMANENT_ASSET_EXPIRY = new Date("9999-12-31T23:59:59.999Z");

function imageUrl(assetId: string): string {
  return `/api/media/images/${assetId}`;
}

function cleanFilename(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().slice(0, 240);
  return name || null;
}

function managedImageAssetIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (ids.size >= 100) return ids;
  if (typeof value === "string") {
    const match = MANAGED_IMAGE_URL_PATTERN.exec(value.trim());
    if (match?.[1]) ids.add(match[1]);
    return ids;
  }
  if (Array.isArray(value)) {
    for (const item of value) managedImageAssetIds(item, ids);
    return ids;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) managedImageAssetIds(item, ids);
  }
  return ids;
}

type ImageAssetTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function attachReadyImageAssets(
  tx: ImageAssetTransaction,
  uploadedByUserId: string,
  persistedValues: unknown,
): Promise<void> {
  const assetIds = [...managedImageAssetIds(persistedValues)];
  if (!assetIds.length) return;
  const attached = await tx.update(imageAssetsTable)
    .set({ expiresAt: PERMANENT_ASSET_EXPIRY, updatedAt: new Date() })
    .where(and(
      inArray(imageAssetsTable.id, assetIds),
      eq(imageAssetsTable.uploadedByUserId, uploadedByUserId),
      eq(imageAssetsTable.status, "ready"),
      gt(imageAssetsTable.expiresAt, new Date()),
    ))
    .returning({ id: imageAssetsTable.id });
  if (attached.length !== assetIds.length) {
    throw new Error("One or more managed image assets are not ready or do not belong to this user.");
  }
}

router.post("/media/uploads/request-url", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Prijavite se da biste otpremili sliku." });
    return;
  }
  const name = cleanFilename(req.body?.name);
  const size = Number(req.body?.size);
  const contentType = typeof req.body?.contentType === "string" ? req.body.contentType.toLowerCase() : "";
  if (!name || !Number.isInteger(size) || size < 1 || size > MAX_IMAGE_UPLOAD_BYTES) {
    res.status(size > MAX_IMAGE_UPLOAD_BYTES ? 413 : 400).json({ error: "Slika mora biti manja od 8 MB." });
    return;
  }
  if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
    res.status(400).json({ error: "Dozvoljene su JPG, PNG, WEBP i GIF slike." });
    return;
  }

  const [asset] = await db.insert(imageAssetsTable).values({
    uploadedByUserId: user.id,
    originalFilename: name,
    sourceContentType: contentType,
    sourceSize: size,
    stagingObjectPath: imageAssetStagingStoragePath(user.id, crypto.randomUUID()),
    expiresAt: new Date(Date.now() + IMAGE_UPLOAD_TTL_MS),
  }).returning();
  if (!asset) {
    res.status(500).json({ error: "Nije moguće pripremiti upload slike." });
    return;
  }

  // Keep the asset ID in the object path so upload records are auditable and
  // cleanup cannot delete a path outside this asset's staging namespace.
  const expectedPath = imageAssetStagingStoragePath(user.id, asset.id);
  await db.update(imageAssetsTable)
    .set({ stagingObjectPath: expectedPath, updatedAt: new Date() })
    .where(eq(imageAssetsTable.id, asset.id));

  try {
    const uploadUrl = await signPrivateObject(rawPrivateObjectPath(expectedPath), "PUT", 900);
    res.json({
      assetId: asset.id,
      uploadUrl,
      finalizeUrl: `/api/media/image-uploads/${asset.id}/finalize`,
    });
  } catch (error) {
    await db.update(imageAssetsTable)
      .set({ status: "failed", failureReason: "storage-signing", updatedAt: new Date() })
      .where(eq(imageAssetsTable.id, asset.id));
    req.log.error({ err: error, assetId: asset.id }, "Could not sign image upload");
    res.status(500).json({ error: "App Storage trenutno nije dostupan." });
  }
});

router.post("/media/image-uploads/:assetId/finalize", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Prijavite se da biste završili upload slike." });
    return;
  }
  const assetId = req.params.assetId;
  if (!UUID_PATTERN.test(assetId)) {
    res.status(404).json({ error: "Upload slike nije pronađen." });
    return;
  }

  const [asset] = await db.select().from(imageAssetsTable)
    .where(and(eq(imageAssetsTable.id, assetId), eq(imageAssetsTable.uploadedByUserId, user.id)))
    .limit(1);
  if (!asset) {
    res.status(404).json({ error: "Upload slike nije pronađen." });
    return;
  }
  if (asset.status === "ready" && asset.variants) {
    res.json({ assetId, imageUrl: imageUrl(assetId), width: asset.originalWidth, height: asset.originalHeight });
    return;
  }
  if (asset.expiresAt < new Date()) {
    res.status(410).json({ error: "Upload je istekao. Izaberite sliku ponovo." });
    return;
  }
  if (asset.stagingObjectPath !== imageAssetStagingStoragePath(user.id, asset.id)) {
    res.status(409).json({ error: "Upload putanja nije validna." });
    return;
  }

  const [claimed] = await db.update(imageAssetsTable)
    .set({ status: "processing", failureReason: null, updatedAt: new Date() })
    .where(and(
      eq(imageAssetsTable.id, asset.id),
      eq(imageAssetsTable.uploadedByUserId, user.id),
      inArray(imageAssetsTable.status, ["pending", "failed"]),
    ))
    .returning();
  if (!claimed) {
    res.status(409).json({ error: "Obrada ovog uploada je već u toku." });
    return;
  }

  const uploadedPaths: string[] = [];
  try {
    const staged = await readPrivateObject(claimed.stagingObjectPath);
    if (staged.contentType !== claimed.sourceContentType || staged.bytes.length !== claimed.sourceSize) {
      throw new Error("Otpremljeni fajl ne odgovara najavljenoj slici.");
    }
    const generated = await generateOptimizedImageSet(staged.bytes, claimed.sourceContentType);
    const originalPath = imageAssetOriginalStoragePath(claimed.id, generated.original.extension);
    await uploadPrivateObject(originalPath, generated.original.bytes, generated.original.contentType);
    uploadedPaths.push(originalPath);

    for (const size of ["thumbnail", "medium", "large"] as const) {
      for (const format of ["avif", "webp", "fallback"] as const) {
        const variant = generated.variants[size][format];
        const objectPath = imageAssetVariantStoragePath(claimed.id, size, format, variant.extension);
        await uploadPrivateObject(objectPath, variant.bytes, variant.contentType);
        uploadedPaths.push(objectPath);
      }
    }

    const variants = imageVariantMetadata(claimed.id, generated.variants);
    await db.update(imageAssetsTable).set({
      status: "ready",
      originalObjectPath: originalPath,
      originalWidth: generated.original.width,
      originalHeight: generated.original.height,
      variants,
      expiresAt: new Date(Date.now() + UNATTACHED_READY_TTL_MS),
      updatedAt: new Date(),
    }).where(eq(imageAssetsTable.id, claimed.id));
    await deletePrivateObject(claimed.stagingObjectPath).catch((error) => {
      req.log.warn({ err: error, assetId: claimed.id }, "Could not remove finalized image staging object");
    });
    res.json({
      assetId: claimed.id,
      imageUrl: imageUrl(claimed.id),
      width: generated.original.width,
      height: generated.original.height,
    });
  } catch (error) {
    await Promise.allSettled(uploadedPaths.map((path) => deletePrivateObject(path)));
    const message = error instanceof Error ? error.message : "Obrada slike nije uspela.";
    await db.update(imageAssetsTable)
      .set({ status: "failed", failureReason: message.slice(0, 240), updatedAt: new Date() })
      .where(eq(imageAssetsTable.id, claimed.id));
    req.log.error({ err: error, assetId: claimed.id }, "Could not finalize optimized image");
    res.status(422).json({ error: message });
  }
});

function selectVariant(
  variants: ImageAssetVariantSet,
  rawSize: unknown,
  rawFormat: unknown,
  acceptHeader: string,
) {
  const size = rawSize === "thumbnail" || rawSize === "medium" || rawSize === "large" ? rawSize : "large";
  const requestedFormat = rawFormat === "avif" || rawFormat === "webp" || rawFormat === "fallback" ? rawFormat : null;
  const format = requestedFormat
    ?? (acceptHeader.includes("image/avif") ? "avif" : acceptHeader.includes("image/webp") ? "webp" : "fallback");
  return { size, format, variant: variants[size][format] };
}

router.get("/media/images/:assetId", async (req, res): Promise<void> => {
  const assetId = req.params.assetId;
  if (!UUID_PATTERN.test(assetId)) {
    res.status(404).end();
    return;
  }
  const [asset] = await db.select().from(imageAssetsTable)
    .where(and(eq(imageAssetsTable.id, assetId), eq(imageAssetsTable.status, "ready")))
    .limit(1);
  if (!asset?.variants) {
    res.status(404).end();
    return;
  }

  const { size, format, variant } = selectVariant(
    asset.variants,
    req.query.size,
    req.query.format,
    req.get("accept") ?? "",
  );
  const etag = `"${asset.id}-${size}-${format}-${variant.bytes}"`;
  const isAttached = asset.expiresAt.getUTCFullYear() >= 9999;
  if (!isAttached) {
    const user = await getCurrentUser(req);
    if (!user || user.id !== asset.uploadedByUserId) {
      res.set({ "Cache-Control": "private, no-store", "Vary": "Cookie" });
      res.status(404).end();
      return;
    }
  }
  const cacheHeaders = {
    "Cache-Control": isAttached ? "public, max-age=31536000, immutable" : "private, no-store",
    "Cross-Origin-Resource-Policy": "same-site",
    "ETag": etag,
    "Vary": isAttached ? "Accept" : "Accept, Cookie",
    "X-Content-Type-Options": "nosniff",
  };
  try {
    const signedUrl = await signPrivateObject(rawPrivateObjectPath(variant.objectPath), "GET", 60);
    const response = await fetch(signedUrl, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok || !response.body) throw new Error(`App Storage returned ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== variant.bytes) throw new Error("App Storage returned an incomplete image.");
    if (req.get("if-none-match") === etag) {
      res.set(cacheHeaders);
      res.status(304).end();
      return;
    }
    res.set({
      ...cacheHeaders,
      "Content-Type": variant.contentType,
      "Content-Length": String(variant.bytes),
    });
    res.end(bytes);
  } catch (error) {
    req.log.error({ err: error, assetId, size, format }, "Could not serve optimized image");
    if (!res.headersSent) {
      res.set("Cache-Control", "private, no-store");
      res.status(503).end();
    }
    else res.end();
  }
});

export async function cleanupExpiredImageAssets(): Promise<number> {
  const expired = await db.select().from(imageAssetsTable)
    .where(lt(imageAssetsTable.expiresAt, new Date()))
    .limit(100);
  let deleted = 0;
  for (const asset of expired) {
    try {
      const objectPaths = new Set<string>([asset.stagingObjectPath]);
      if (asset.originalObjectPath) objectPaths.add(asset.originalObjectPath);
      objectPaths.add(imageAssetOriginalStoragePath(asset.id, "jpg"));
      objectPaths.add(imageAssetOriginalStoragePath(asset.id, "png"));
      for (const size of ["thumbnail", "medium", "large"] as const) {
        objectPaths.add(imageAssetVariantStoragePath(asset.id, size, "avif", "avif"));
        objectPaths.add(imageAssetVariantStoragePath(asset.id, size, "webp", "webp"));
        objectPaths.add(imageAssetVariantStoragePath(asset.id, size, "fallback", "jpg"));
        objectPaths.add(imageAssetVariantStoragePath(asset.id, size, "fallback", "png"));
      }
      const cleanupResults = await Promise.allSettled(
        [...objectPaths].map((objectPath) => deletePrivateObject(objectPath)),
      );
      const failed = cleanupResults.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      await db.delete(imageAssetsTable).where(eq(imageAssetsTable.id, asset.id));
      deleted += 1;
    } catch {
      // The next scheduled pass will retry. The row is the durable cleanup claim.
    }
  }
  return deleted;
}

export default router;