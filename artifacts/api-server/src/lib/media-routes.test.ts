import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, like } from "drizzle-orm";
import sharp from "sharp";
import {
  db,
  coursesTable,
  educationCentersTable,
  educationCenterSubscriptionsTable,
  employeesTable,
  mediaAssetsTable,
  mediaUploadTicketsTable,
  mediaVariantsTable,
  pool,
  productCategoriesTable,
  productsTable,
  salonsTable,
  subscriptionPlansTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureDemoData } from "./seed";
import { approvedServiceCategoryReference, migrateLegacyMediaReferences } from "./media-migration";
import {
  canClaimMediaReference,
  claimMediaReference,
  cleanupMediaRouteRegressionUploads,
  deletePrivateStorageObject,
  enableMediaCachePurgeForTesting,
  enableMediaRouteRegressionUploadMarking,
  MEDIA_ROUTE_REGRESSION_CONTROL_CLEANUP_KEY,
  MEDIA_ROUTE_REGRESSION_CLEANUP_KEY,
  mediaAssetIdFromUrl,
  processImageBytes,
  readPrivateStorageObject,
  recordMediaRouteRegressionPromotionPath,
  runMediaUploadCleanup,
} from "../routes/media";
import { ensureMediaSchema } from "./media-schema";

type Ticket = { uploadId: string; uploadUrl: string; expiresAt: string };
type Asset = { id: string; imageUrl: string; width: number; height: number; contentHash: string };
type EducationCourse = { id: string; imageUrl: string; published: boolean; archived: boolean };
let mediaRegressionRequestHeaders: Record<string, string> = {};

async function jsonRequest<T>(
  baseUrl: string,
  path: string,
  session: string,
  method: "PATCH" | "POST",
  body?: unknown,
  includeRegressionMarker = true,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      cookie: `${sessionCookieName}=${session}`,
      ...(includeRegressionMarker ? mediaRegressionRequestHeaders : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() as T };
}

async function startServer() {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function stopServer(server: ReturnType<typeof app.listen>) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

/**
 * Models a browser/CDN entry written before revocable salon media stopped using
 * immutable caching. It intentionally serves the seeded 200 without contacting
 * the API until the application invokes the purge handler.
 */
function createLegacyImmutableMediaCache() {
  const entries = new Map<string, { status: number }>();
  return {
    async fetch(url: string): Promise<{ status: number; fromCache: boolean }> {
      const cached = entries.get(url);
      if (cached) return { ...cached, fromCache: true };
      const response = await fetch(url);
      const entry = { status: response.status };
      if (entry.status === 200) entries.set(url, entry);
      return { ...entry, fromCache: false };
    },
    purgePathPrefixes(pathPrefixes: readonly string[]): void {
      for (const url of entries.keys()) {
        if (pathPrefixes.some((pathPrefix) => new URL(url).pathname === pathPrefix)) {
          entries.delete(url);
        }
      }
    },
  };
}

async function forceEndpointClaimConflict<T>(
  assetId: string,
  requestFactory: () => Promise<T>,
): Promise<T> {
  const blocker = await pool.connect();
  let requestPromise: Promise<T> | null = null;
  let committed = false;
  try {
    await blocker.query("begin");
    await blocker.query("select id from media_assets where id = $1 for update", [assetId]);
    requestPromise = requestFactory();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await blocker.query("update media_assets set resource_id = $2 where id = $1", [assetId, randomUUID()]);
    await blocker.query("commit");
    committed = true;
    return await requestPromise;
  } finally {
    if (!committed) await blocker.query("rollback").catch(() => undefined);
    blocker.release();
    if (!committed && requestPromise) await requestPromise.catch(() => undefined);
    await db.update(mediaAssetsTable).set({ resourceId: null }).where(eq(mediaAssetsTable.id, assetId));
  }
}

async function run() {
  await ensureMediaSchema();
  assert.equal(
    approvedServiceCategoryReference(
      "Frizerski saloni",
      "https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=1200&q=85",
    ),
    "/lumera-media/categories/frizerski-saloni.jpg",
    "The approved replacement should intercept the exact historical category source.",
  );
  assert.equal(
    approvedServiceCategoryReference(
      "Frizerski saloni",
      "https://images.unsplash.com/photo-not-the-approved-source?auto=format",
    ),
    "https://images.unsplash.com/photo-not-the-approved-source?auto=format",
    "An arbitrary external category image must remain subject to the normal migration audit.",
  );
  await ensureDemoData();
  const [ownerAndSalon] = await db.select({ user: usersTable, salon: salonsTable }).from(usersTable)
    .innerJoin(salonsTable, eq(salonsTable.id, usersTable.activeSalonId))
    .where(and(eq(usersTable.role, "SALON_OWNER"), eq(usersTable.active, true)))
    .limit(1);
  assert.ok(ownerAndSalon, "A demo salon owner is required for the media route regression.");
  const [adminUser] = await db.select().from(usersTable)
    .where(and(inArray(usersTable.role, ["ADMIN", "SUPER_ADMIN"]), eq(usersTable.active, true)))
    .limit(1);
  assert.ok(adminUser, "An active admin is required for media claim endpoint regressions.");
  const [productCategory] = await db.select({ id: productCategoriesTable.id }).from(productCategoriesTable)
    .where(eq(productCategoriesTable.active, true))
    .limit(1);
  assert.ok(productCategory, "An active product category is required for product media claim regression.");
  const session = await createSession(ownerAndSalon.user.id);
  const adminSession = await createSession(adminUser.id);
  const createdUploadIds: string[] = [];
  let educationFixtureOwnerId: string | null = null;
  let educationFixtureCenterId: string | null = null;
  let educationFixtureSubscriptionId: string | null = null;
  let educationFixturePlanId: string | null = null;
  let educationFixtureCourseId: string | null = null;
  const originalSalonMedia = {
    imageUrl: ownerAndSalon.salon.imageUrl,
    gallery: ownerAndSalon.salon.gallery,
    active: ownerAndSalon.salon.active,
  };
  let privacyProbeAssetId: string | null = null;
  let activeServer: Awaited<ReturnType<typeof startServer>> | null = null;
  let disableRegressionUploadMarking: (() => void) | null = null;
  let disableMediaCachePurge: (() => void) | null = null;
  const regressionLock = await pool.connect();
  let regressionLockHeld = false;

  try {
    const lockResult = await regressionLock.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext($1)) as locked",
      [MEDIA_ROUTE_REGRESSION_CLEANUP_KEY],
    );
    assert.equal(
      lockResult.rows[0]?.locked,
      true,
      "Another media route regression is already running against this development database.",
    );
    regressionLockHeld = true;
    await cleanupMediaRouteRegressionUploads();
    const marking = enableMediaRouteRegressionUploadMarking();
    disableRegressionUploadMarking = marking.disable;
    mediaRegressionRequestHeaders = marking.requestHeaders;
    const legacyImmutableMediaCache = createLegacyImmutableMediaCache();
    const cachePurgeRequests: Array<{ assetIds: string[]; pathPrefixes: string[]; surrogateKeys: string[] }> = [];
    const purgeControl = enableMediaCachePurgeForTesting(async (request) => {
      cachePurgeRequests.push({
        assetIds: request.assetIds,
        pathPrefixes: request.pathPrefixes,
        surrogateKeys: request.surrogateKeys,
      });
      legacyImmutableMediaCache.purgePathPrefixes(request.pathPrefixes);
    });
    disableMediaCachePurge = purgeControl.disable;
    activeServer = await startServer();
    assert.equal(await canClaimMediaReference({
      userId: ownerAndSalon.user.id,
      url: "https://example.invalid/injected.jpg",
      scope: "salon-profile",
      resourceId: ownerAndSalon.salon.id,
    }), false, "A new unmanaged URL must not bypass the owner-bound media pipeline.");
    assert.equal(await canClaimMediaReference({
      userId: ownerAndSalon.user.id,
      url: "https://legacy.example/existing.jpg",
      scope: "salon-profile",
      resourceId: ownerAndSalon.salon.id,
      existingUrls: ["https://legacy.example/existing.jpg"],
    }), true, "An unchanged legacy URL remains compatible until migration can import it.");
    const jpeg = await sharp({
      create: { width: 96, height: 64, channels: 3, background: "#b76e79" },
    }).jpeg({ quality: 90 }).toBuffer();
    const uploadAsset = async (scope: string, uploadSession: string, name: string) => {
      const ticket = await jsonRequest<Ticket>(
        activeServer!.baseUrl,
        "/media/uploads",
        uploadSession,
        "POST",
        { scope, name, size: jpeg.length, contentType: "image/jpeg" },
      );
      assert.equal(ticket.status, 200, `${scope} upload ticket should be issued.`);
      createdUploadIds.push(ticket.body.uploadId);
      const [persistedTicket] = await db.select({
        testCleanupKey: mediaUploadTicketsTable.testCleanupKey,
      }).from(mediaUploadTicketsTable).where(eq(mediaUploadTicketsTable.id, ticket.body.uploadId)).limit(1);
      assert.equal(
        persistedTicket?.testCleanupKey,
        MEDIA_ROUTE_REGRESSION_CLEANUP_KEY,
        "The upload ticket and its recovery marker must be created atomically.",
      );
      assert.ok((await fetch(ticket.body.uploadUrl, {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: jpeg,
      })).ok);
      const asset = await jsonRequest<Asset>(
        activeServer!.baseUrl,
        `/media/uploads/${ticket.body.uploadId}/finalize`,
        uploadSession,
        "POST",
      );
      assert.equal(asset.status, 201, `${scope} asset should finalize.`);
      return asset.body;
    };
    const ordinaryTicket = await jsonRequest<Ticket>(
      activeServer.baseUrl,
      "/media/uploads",
      session,
      "POST",
      {
        scope: "employee-avatar",
        name: "ordinary-upload-control.jpg",
        size: jpeg.length,
        contentType: "image/jpeg",
      },
      false,
    );
    assert.equal(ordinaryTicket.status, 200);
    createdUploadIds.push(ordinaryTicket.body.uploadId);
    const [ordinaryUnmarkedTicket] = await db.select({
      testCleanupKey: mediaUploadTicketsTable.testCleanupKey,
    }).from(mediaUploadTicketsTable).where(eq(mediaUploadTicketsTable.id, ordinaryTicket.body.uploadId)).limit(1);
    assert.equal(
      ordinaryUnmarkedTicket?.testCleanupKey,
      null,
      "A request without the ephemeral regression token must remain unmarked.",
    );
    const [markedControlTicket] = await db.update(mediaUploadTicketsTable).set({
      testCleanupKey: MEDIA_ROUTE_REGRESSION_CONTROL_CLEANUP_KEY,
    }).where(eq(mediaUploadTicketsTable.id, ordinaryTicket.body.uploadId))
      .returning({ id: mediaUploadTicketsTable.id });
    assert.equal(
      markedControlTicket?.id,
      ordinaryTicket.body.uploadId,
      "The safety-control ticket must receive its own durable cleanup identity before upload.",
    );
    assert.ok((await fetch(ordinaryTicket.body.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: jpeg,
    })).ok);
    const ordinaryAsset = await jsonRequest<Asset>(
      activeServer.baseUrl,
      `/media/uploads/${ordinaryTicket.body.uploadId}/finalize`,
      session,
      "POST",
    );
    assert.equal(ordinaryAsset.status, 201);
    const [ordinaryAssetRecord] = await db.select({
      testCleanupKey: mediaAssetsTable.testCleanupKey,
    }).from(mediaAssetsTable).where(eq(mediaAssetsTable.id, ordinaryAsset.body.id)).limit(1);
    assert.equal(
      ordinaryAssetRecord?.testCleanupKey,
      MEDIA_ROUTE_REGRESSION_CONTROL_CLEANUP_KEY,
      "The safety-control asset must retain its separate durable cleanup identity.",
    );
    const [ordinaryVariant] = await db.select({ objectPath: mediaVariantsTable.objectPath })
      .from(mediaVariantsTable)
      .where(eq(mediaVariantsTable.assetId, ordinaryAsset.body.id))
      .limit(1);
    assert.ok(ordinaryVariant && (await readPrivateStorageObject(ordinaryVariant.objectPath))?.length);
    const strandedRecoveryUpload = await uploadAsset(
      "employee-avatar",
      session,
      "recovery-stranded.jpg",
    );
    const interruptedTicket = await jsonRequest<Ticket>(
      activeServer.baseUrl,
      "/media/uploads",
      session,
      "POST",
      {
        scope: "employee-avatar",
        name: "recovery-interrupted-before-commit.jpg",
        size: jpeg.length,
        contentType: "image/jpeg",
      },
    );
    assert.equal(interruptedTicket.status, 200);
    createdUploadIds.push(interruptedTicket.body.uploadId);
    const [persistedInterruptedTicket] = await db.select({
      stagingObjectPath: mediaUploadTicketsTable.stagingObjectPath,
      testCleanupKey: mediaUploadTicketsTable.testCleanupKey,
    }).from(mediaUploadTicketsTable)
      .where(eq(mediaUploadTicketsTable.id, interruptedTicket.body.uploadId))
      .limit(1);
    assert.equal(
      persistedInterruptedTicket?.testCleanupKey,
      MEDIA_ROUTE_REGRESSION_CLEANUP_KEY,
      "An interrupted upload must be marked in the same insert that creates its ticket.",
    );
    assert.ok((await fetch(interruptedTicket.body.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: jpeg,
    })).ok);
    const promotedBeforeCommit = await processImageBytes({
      assetId: interruptedTicket.body.uploadId,
      bytes: jpeg,
      declaredContentType: "image/jpeg",
      beforeVariantUpload: (objectPath) => recordMediaRouteRegressionPromotionPath(
        interruptedTicket.body.uploadId,
        objectPath,
      ),
    });
    const [promotionManifest] = await db.select({
      promotionCleanupPaths: mediaUploadTicketsTable.promotionCleanupPaths,
    }).from(mediaUploadTicketsTable)
      .where(eq(mediaUploadTicketsTable.id, interruptedTicket.body.uploadId))
      .limit(1);
    assert.deepEqual(
      new Set(promotionManifest?.promotionCleanupPaths),
      new Set(promotedBeforeCommit.variants.map(({ objectPath }) => objectPath)),
      "Every promoted object path must be durable before its App Storage upload starts.",
    );
    const [markedRecoveryAsset] = await db.select({
      testCleanupKey: mediaAssetsTable.testCleanupKey,
    }).from(mediaAssetsTable).where(eq(mediaAssetsTable.id, strandedRecoveryUpload.id)).limit(1);
    assert.equal(
      markedRecoveryAsset?.testCleanupKey,
      MEDIA_ROUTE_REGRESSION_CLEANUP_KEY,
      "Finalized regression media must retain the ticket's database-only cleanup marker.",
    );
    disableRegressionUploadMarking();
    disableRegressionUploadMarking = null;
    mediaRegressionRequestHeaders = {};
    const recovered = await cleanupMediaRouteRegressionUploads({
      cleanupKeys: [MEDIA_ROUTE_REGRESSION_CLEANUP_KEY],
    });
    assert.ok(recovered.tickets >= 2 && recovered.assets >= 1, "Recovery must remove every interrupted regression upload.");
    assert.equal(
      (await db.select({ id: mediaAssetsTable.id }).from(mediaAssetsTable)
        .where(eq(mediaAssetsTable.id, strandedRecoveryUpload.id))).length,
      0,
      "Recovery must remove marked finalized media and its database record.",
    );
    assert.equal(
      (await db.select({ id: mediaUploadTicketsTable.id }).from(mediaUploadTicketsTable)
        .where(eq(mediaUploadTicketsTable.id, interruptedTicket.body.uploadId))).length,
      0,
      "Recovery must remove a ticket interrupted after promotion but before its asset transaction.",
    );
    assert.equal(
      await readPrivateStorageObject(persistedInterruptedTicket!.stagingObjectPath),
      null,
      "Recovery must remove the interrupted upload's staging object.",
    );
    for (const variant of promotedBeforeCommit.variants) {
      assert.equal(
        await readPrivateStorageObject(variant.objectPath),
        null,
        `Recovery must remove the uncommitted ${variant.sizeName}/${variant.format} object.`,
      );
    }
    const [ordinaryTicketAfterRecovery] = await db.select({
      testCleanupKey: mediaUploadTicketsTable.testCleanupKey,
    }).from(mediaUploadTicketsTable).where(eq(mediaUploadTicketsTable.id, ordinaryTicket.body.uploadId)).limit(1);
    assert.equal(
      ordinaryTicketAfterRecovery?.testCleanupKey,
      MEDIA_ROUTE_REGRESSION_CONTROL_CLEANUP_KEY,
      "Primary recovery must preserve the separately marked safety-control ticket.",
    );
    assert.ok(
      (await db.select({ id: mediaAssetsTable.id }).from(mediaAssetsTable)
        .where(eq(mediaAssetsTable.id, ordinaryAsset.body.id))).length,
      "Recovery must preserve the ordinary upload asset.",
    );
    assert.ok(
      ordinaryVariant && (await readPrivateStorageObject(ordinaryVariant.objectPath))?.length,
      "Recovery must preserve App Storage objects for an ordinary upload.",
    );
    const controlRecovery = await cleanupMediaRouteRegressionUploads({
      cleanupKeys: [MEDIA_ROUTE_REGRESSION_CONTROL_CLEANUP_KEY],
    });
    assert.equal(controlRecovery.tickets, 1);
    assert.equal(controlRecovery.assets, 1);
    assert.equal(
      (await db.select({ id: mediaAssetsTable.id }).from(mediaAssetsTable)
        .where(eq(mediaAssetsTable.id, ordinaryAsset.body.id))).length,
      0,
      "The safety-control asset must also be recoverable after an interrupted run.",
    );
    assert.equal(
      ordinaryVariant ? await readPrivateStorageObject(ordinaryVariant.objectPath) : null,
      null,
      "Safety-control App Storage objects must not leak after their recovery pass.",
    );
    const resumedMarking = enableMediaRouteRegressionUploadMarking();
    disableRegressionUploadMarking = resumedMarking.disable;
    mediaRegressionRequestHeaders = resumedMarking.requestHeaders;
    const ticketResponse = await jsonRequest<Ticket>(
      activeServer.baseUrl,
      "/media/uploads",
      session,
      "POST",
      {
        scope: "salon-profile",
        resourceId: ownerAndSalon.salon.id,
        name: "media-regression.jpg",
        size: jpeg.length,
        contentType: "image/jpeg",
      },
    );
    assert.equal(ticketResponse.status, 200, "Owner-scoped upload ticket should be issued.");
    createdUploadIds.push(ticketResponse.body.uploadId);
    const uploadResponse = await fetch(ticketResponse.body.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: jpeg,
    });
    assert.ok(uploadResponse.ok, "Staged upload should reach App Storage.");

    const firstFinalize = await jsonRequest<Asset>(
      activeServer.baseUrl,
      `/media/uploads/${ticketResponse.body.uploadId}/finalize`,
      session,
      "POST",
    );
    assert.equal(firstFinalize.status, 201, "First finalization should create an immutable asset.");
    assert.equal(firstFinalize.body.width, 96);
    assert.equal(firstFinalize.body.height, 64);
    assert.match(firstFinalize.body.imageUrl, /^\/api\/media\/[0-9a-f-]{36}\?v=[0-9a-f]{16}$/);
    const [unattachedAsset] = await db.select({
      resourceId: mediaAssetsTable.resourceId,
      visibility: mediaAssetsTable.visibility,
    }).from(mediaAssetsTable).where(eq(mediaAssetsTable.id, firstFinalize.body.id)).limit(1);
    assert.deepEqual(
      unattachedAsset,
      { resourceId: null, visibility: "private" },
      "Finalization must keep an asset private and unattached until the resource update claims it.",
    );

    const repeatedFinalize = await jsonRequest<Asset>(
      activeServer.baseUrl,
      `/media/uploads/${ticketResponse.body.uploadId}/finalize`,
      session,
      "POST",
    );
    assert.equal(repeatedFinalize.status, 200, "Finalization retry should be idempotent.");
    assert.equal(repeatedFinalize.body.id, firstFinalize.body.id);
    assert.equal(repeatedFinalize.body.imageUrl, firstFinalize.body.imageUrl);

    const claimTicket = await jsonRequest<Ticket>(
      activeServer.baseUrl,
      "/media/uploads",
      session,
      "POST",
      {
        scope: "employee-avatar",
        name: "claim-regression.jpg",
        size: jpeg.length,
        contentType: "image/jpeg",
      },
    );
    assert.equal(claimTicket.status, 200);
    createdUploadIds.push(claimTicket.body.uploadId);
    assert.ok((await fetch(claimTicket.body.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: jpeg,
    })).ok);
    const claimAsset = await jsonRequest<Asset>(
      activeServer.baseUrl,
      `/media/uploads/${claimTicket.body.uploadId}/finalize`,
      session,
      "POST",
    );
    assert.equal(claimAsset.status, 201);

    const rolledBackResourceId = randomUUID();
    await assert.rejects(db.transaction(async (tx) => {
      assert.equal(await claimMediaReference({
        userId: ownerAndSalon.user.id,
        url: claimAsset.body.imageUrl,
        scope: "employee-avatar",
        resourceId: rolledBackResourceId,
      }, tx), true);
      throw new Error("forced resource-write rollback");
    }));
    const [afterRollback] = await db.select({ resourceId: mediaAssetsTable.resourceId })
      .from(mediaAssetsTable).where(eq(mediaAssetsTable.id, claimAsset.body.id)).limit(1);
    assert.equal(afterRollback?.resourceId, null, "A failed resource transaction must also roll back its media claim.");

    const competingResourceIds = [randomUUID(), randomUUID()];
    const competingClaims = await Promise.all(competingResourceIds.map((resourceId) => claimMediaReference({
      userId: ownerAndSalon.user.id,
      url: claimAsset.body.imageUrl,
      scope: "employee-avatar",
      resourceId,
    })));
    assert.equal(competingClaims.filter(Boolean).length, 1, "Only one resource may win an atomic media claim.");
    const [afterCompetition] = await db.select({ resourceId: mediaAssetsTable.resourceId })
      .from(mediaAssetsTable).where(eq(mediaAssetsTable.id, claimAsset.body.id)).limit(1);
    assert.equal(
      afterCompetition?.resourceId,
      competingResourceIds[competingClaims.findIndex(Boolean)],
      "The durable asset binding must match the winning claim.",
    );

    const employeeAsset = await uploadAsset("employee-avatar", session, "employee-create-rollback.jpg");
    const employeeName = `Media employee rollback ${randomUUID()}`;
    const employeeConflict = await forceEndpointClaimConflict(employeeAsset.id, () => jsonRequest<{ error: string }>(
      activeServer!.baseUrl,
      "/salon/employees",
      session,
      "POST",
      { name: employeeName, role: "Stilista", avatarUrl: employeeAsset.imageUrl },
    ));
    assert.equal(employeeConflict.status, 409);
    assert.equal(
      (await db.select({ id: employeesTable.id }).from(employeesTable).where(eq(employeesTable.name, employeeName))).length,
      0,
      "Employee creation must roll back when its media claim loses the race.",
    );

    const courseAsset = await uploadAsset("education-cover", session, "course-create-rollback.jpg");
    const courseTitle = `Media course rollback ${randomUUID()}`;
    const courseConflict = await forceEndpointClaimConflict(courseAsset.id, () => jsonRequest<{ error: string }>(
      activeServer!.baseUrl,
      "/education/courses",
      session,
      "POST",
      {
        title: courseTitle,
        description: "Transactional media claim regression.",
        category: "Test",
        format: "online",
        price: 1000,
        duration: "1 dan",
        certification: false,
        imageUrl: courseAsset.imageUrl,
      },
    ));
    assert.equal(courseConflict.status, 409);
    assert.equal(
      (await db.select({ id: coursesTable.id }).from(coursesTable).where(eq(coursesTable.title, courseTitle))).length,
      0,
      "Course creation must roll back when its cover claim loses the race.",
    );

    const productAsset = await uploadAsset("product", adminSession, "product-create-rollback.jpg");
    const productSku = `MEDIA-ROLLBACK-${randomUUID()}`;
    const productConflict = await forceEndpointClaimConflict(productAsset.id, () => jsonRequest<{ error: string }>(
      activeServer!.baseUrl,
      "/admin/products",
      adminSession,
      "POST",
      {
        name: "Media product rollback",
        categoryId: productCategory.id,
        categoryName: "ignored",
        description: "Transactional media claim regression.",
        imageUrl: productAsset.imageUrl,
        images: [],
        price: 1000,
        stock: 1,
        sku: productSku,
        unit: "kom",
        weightGrams: 100,
      },
    ));
    assert.equal(productConflict.status, 409);
    assert.equal(
      (await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.sku, productSku))).length,
      0,
      "Product creation must roll back when one image claim loses the race.",
    );

    const categoryAsset = await uploadAsset("product-category", adminSession, "category-create-rollback.jpg");
    const categoryName = `Media category rollback ${randomUUID()}`;
    const categoryConflict = await forceEndpointClaimConflict(categoryAsset.id, () => jsonRequest<{ error: string }>(
      activeServer!.baseUrl,
      "/admin/product-categories",
      adminSession,
      "POST",
      { name: categoryName, imageUrl: categoryAsset.imageUrl },
    ));
    assert.equal(categoryConflict.status, 409);
    assert.equal(
      (await db.select({ id: productCategoriesTable.id }).from(productCategoriesTable).where(eq(productCategoriesTable.name, categoryName))).length,
      0,
      "Product-category creation must roll back when its image claim loses the race.",
    );

    const galleryTicket = await jsonRequest<Ticket>(
      activeServer.baseUrl,
      "/media/uploads",
      session,
      "POST",
      {
        scope: "salon-gallery",
        resourceId: ownerAndSalon.salon.id,
        name: "media-gallery-regression.jpg",
        size: jpeg.length,
        contentType: "image/jpeg",
      },
    );
    assert.equal(galleryTicket.status, 200);
    createdUploadIds.push(galleryTicket.body.uploadId);
    const galleryUpload = await fetch(galleryTicket.body.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: jpeg,
    });
    assert.ok(galleryUpload.ok);
    const galleryFinalize = await jsonRequest<Asset>(
      activeServer.baseUrl,
      `/media/uploads/${galleryTicket.body.uploadId}/finalize`,
      session,
      "POST",
    );
    assert.equal(galleryFinalize.status, 201);
    const attachedProfile = await jsonRequest<{ imageUrl: string; gallery: string[] }>(
      activeServer.baseUrl,
      "/salon/profile",
      session,
      "PATCH",
      { imageUrl: firstFinalize.body.imageUrl, gallery: [galleryFinalize.body.imageUrl] },
    );
    assert.equal(attachedProfile.status, 200, "A finalized image should attach to salon profile and gallery.");
    assert.equal(attachedProfile.body.imageUrl, firstFinalize.body.imageUrl);
    assert.deepEqual(attachedProfile.body.gallery, [galleryFinalize.body.imageUrl]);

    await db.update(mediaAssetsTable).set({ resourceId: null, visibility: "private" })
      .where(eq(mediaAssetsTable.id, firstFinalize.body.id));
    const migrationReport = await migrateLegacyMediaReferences();
    assert.ok(migrationReport.repaired >= 1, "The media audit should repair a drifted active salon cover.");
    const [repairedProfileAsset] = await db.select({
      resourceId: mediaAssetsTable.resourceId,
      visibility: mediaAssetsTable.visibility,
      scope: mediaAssetsTable.scope,
    }).from(mediaAssetsTable).where(eq(mediaAssetsTable.id, firstFinalize.body.id)).limit(1);
    assert.deepEqual(
      repairedProfileAsset,
      { resourceId: ownerAndSalon.salon.id, visibility: "public", scope: "salon-profile" },
      "Only the matching owner-uploaded salon-profile asset should be repaired.",
    );
    const repairedCover = await fetch(`${activeServer.baseUrl}${firstFinalize.body.imageUrl}&size=thumbnail`);
    assert.equal(repairedCover.status, 200, "An audited active salon cover must load anonymously.");

    const publicCatalog = await fetch(`${activeServer.baseUrl}/api/salons?pageSize=100`);
    assert.equal(publicCatalog.status, 200);
    const publicCatalogSalons = await publicCatalog.json() as Array<{ id: string; imageUrl: string }>;
    const publicProfile = await fetch(`${activeServer.baseUrl}/api/salons/${ownerAndSalon.salon.slug}`);
    assert.equal(publicProfile.status, 200);
    const publicProfileBody = await publicProfile.json() as { imageUrl: string; gallery: string[] };
    const publicSalonImages = [
      ...publicCatalogSalons.map((salon) => salon.imageUrl),
      publicProfileBody.imageUrl,
      ...publicProfileBody.gallery,
    ].filter((url) => mediaAssetIdFromUrl(url));
    for (const imageUrl of new Set(publicSalonImages)) {
      assert.equal(
        (await fetch(`${activeServer.baseUrl}${imageUrl}&size=thumbnail`)).status,
        200,
        `Public salon image ${imageUrl} must load anonymously.`,
      );
    }

    privacyProbeAssetId = randomUUID();
    const privacyProbeUrl = `/api/media/${privacyProbeAssetId}?v=${"a".repeat(16)}`;
    await db.insert(mediaAssetsTable).values({
      id: privacyProbeAssetId,
      ownerUserId: ownerAndSalon.user.id,
      scope: "treatment-photo",
      resourceId: null,
      visibility: "private",
      originalFileName: "customer-treatment.jpg",
      originalContentType: "image/jpeg",
      width: 1,
      height: 1,
      contentHash: "a".repeat(64),
    });
    await db.update(salonsTable).set({ gallery: [galleryFinalize.body.imageUrl, privacyProbeUrl] })
      .where(eq(salonsTable.id, ownerAndSalon.salon.id));
    await migrateLegacyMediaReferences();
    const [privateTreatmentAsset] = await db.select({
      resourceId: mediaAssetsTable.resourceId,
      visibility: mediaAssetsTable.visibility,
      scope: mediaAssetsTable.scope,
    }).from(mediaAssetsTable).where(eq(mediaAssetsTable.id, privacyProbeAssetId)).limit(1);
    assert.deepEqual(
      privateTreatmentAsset,
      { resourceId: null, visibility: "private", scope: "treatment-photo" },
      "The salon audit must never publish treatment/customer media, even if a bad salon row references it.",
    );
    await db.update(salonsTable).set({ gallery: [galleryFinalize.body.imageUrl] })
      .where(eq(salonsTable.id, ownerAndSalon.salon.id));

    const webpResponse = await fetch(`${activeServer.baseUrl}${firstFinalize.body.imageUrl}&size=thumbnail`, {
      headers: { accept: "image/webp,image/*" },
    });
    assert.equal(webpResponse.status, 200);
    assert.equal(webpResponse.headers.get("content-type"), "image/webp");
    assert.equal(
      webpResponse.headers.get("cache-control"),
      "public, max-age=0, s-maxage=0, must-revalidate",
      "Active salon media must revalidate so a cached response cannot survive deactivation.",
    );
    assert.equal(webpResponse.headers.get("vary"), "Accept");
    assert.equal(
      webpResponse.headers.get("cache-tag"),
      `media-asset-${firstFinalize.body.id}`,
      "Public salon media must expose a Cloudflare cache tag for targeted invalidation.",
    );
    const etag = webpResponse.headers.get("etag");
    assert.ok(etag);
    const galleryWebpResponse = await fetch(`${activeServer.baseUrl}${galleryFinalize.body.imageUrl}&size=thumbnail`, {
      headers: { accept: "image/webp,image/*" },
    });
    assert.equal(galleryWebpResponse.status, 200);
    assert.equal(
      galleryWebpResponse.headers.get("cache-control"),
      "public, max-age=0, s-maxage=0, must-revalidate",
      "Active salon gallery media must revalidate so a cached response cannot survive deactivation.",
    );
    const galleryEtag = galleryWebpResponse.headers.get("etag");
    assert.ok(galleryEtag);

    const conditional = await fetch(`${activeServer.baseUrl}${firstFinalize.body.imageUrl}&size=thumbnail`, {
      headers: { accept: "image/webp,image/*", "if-none-match": etag! },
    });
    assert.equal(conditional.status, 304, "Matching ETag should avoid retransmitting image bytes.");

    const avifResponse = await fetch(`${activeServer.baseUrl}${firstFinalize.body.imageUrl}&size=medium&format=avif`);
    assert.equal(avifResponse.status, 200);
    assert.equal(avifResponse.headers.get("content-type"), "image/avif");

    const stableWithoutVersion = await fetch(
      `${activeServer.baseUrl}/api/media/${firstFinalize.body.id}?size=large&format=fallback`,
    );
    assert.equal(stableWithoutVersion.status, 200);
    assert.equal(
      stableWithoutVersion.headers.get("cache-control"),
      "public, max-age=0, s-maxage=0, must-revalidate",
      "Omitting the content version must not restore a stale-cache path for salon media.",
    );
    assert.ok(["image/jpeg", "image/png"].includes(stableWithoutVersion.headers.get("content-type") ?? ""));

    const invalidBytes = Buffer.from("not an image");
    const invalidTicket = await jsonRequest<Ticket>(
      activeServer.baseUrl,
      "/media/uploads",
      session,
      "POST",
      {
        scope: "salon-gallery",
        resourceId: ownerAndSalon.salon.id,
        name: "fake.png",
        size: invalidBytes.length,
        contentType: "image/png",
      },
    );
    assert.equal(invalidTicket.status, 200);
    createdUploadIds.push(invalidTicket.body.uploadId);
    const invalidUpload = await fetch(invalidTicket.body.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: invalidBytes,
    });
    assert.ok(invalidUpload.ok);
    const rejectedFinalize = await jsonRequest<{ error: string }>(
      activeServer.baseUrl,
      `/media/uploads/${invalidTicket.body.uploadId}/finalize`,
      session,
      "POST",
    );
    assert.equal(rejectedFinalize.status, 400, "Real-byte decoding must reject a forged image content type.");

    await stopServer(activeServer.server);
    activeServer = await startServer();
    const afterRestart = await fetch(`${activeServer.baseUrl}${firstFinalize.body.imageUrl}&size=thumbnail&format=webp`);
    assert.equal(afterRestart.status, 200, "Final media must remain available after an API restart.");
    assert.equal(afterRestart.headers.get("content-type"), "image/webp");
    const profileAfterRestart = await fetch(`${activeServer.baseUrl}/api/salon/profile`, {
      headers: { cookie: `${sessionCookieName}=${session}` },
    });
    assert.equal(profileAfterRestart.status, 200);
    const profileAfterRestartBody = await profileAfterRestart.json() as { imageUrl: string; gallery: string[] };
    assert.equal(profileAfterRestartBody.imageUrl, firstFinalize.body.imageUrl);
    assert.deepEqual(profileAfterRestartBody.gallery, [galleryFinalize.body.imageUrl]);

    const inactiveCoverAsset = await uploadAsset("salon-profile", session, "inactive-salon-cover.jpg");
    const inactiveGalleryAsset = await uploadAsset("salon-gallery", session, "inactive-salon-gallery.jpg");
    const cachedLegacyCoverUrl = `${activeServer.baseUrl}${firstFinalize.body.imageUrl}&size=thumbnail`;
    const cachedLegacyGalleryUrl = `${activeServer.baseUrl}${galleryFinalize.body.imageUrl}&size=thumbnail`;
    for (const [url, label] of [
      [cachedLegacyCoverUrl, "cover"],
      [cachedLegacyGalleryUrl, "gallery"],
    ] as const) {
      const seeded = await legacyImmutableMediaCache.fetch(url);
      assert.deepEqual(
        seeded,
        { status: 200, fromCache: false },
        `The legacy immutable ${label} cache entry must be populated before deactivation.`,
      );
    }
    const deactivated = await jsonRequest<{ active: boolean }>(
      activeServer.baseUrl,
      `/admin/salons/${ownerAndSalon.salon.id}`,
      adminSession,
      "PATCH",
      { active: false },
    );
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.body.active, false);
    assert.deepEqual(
      cachePurgeRequests,
      [{
        assetIds: [firstFinalize.body.id, galleryFinalize.body.id],
        pathPrefixes: [`/api/media/${firstFinalize.body.id}`, `/api/media/${galleryFinalize.body.id}`],
        surrogateKeys: [`media-asset-${firstFinalize.body.id}`, `media-asset-${galleryFinalize.body.id}`],
      }],
      "Deactivation must purge every cover/gallery path before an old immutable response can be reused.",
    );
    for (const [url, label] of [
      [cachedLegacyCoverUrl, "cover"],
      [cachedLegacyGalleryUrl, "gallery"],
    ] as const) {
      const afterPurge = await legacyImmutableMediaCache.fetch(url);
      assert.deepEqual(
        afterPurge,
        { status: 403, fromCache: false },
        `Purging the cached ${label} must force the next request to reach the deactivated API instead of serving the legacy immutable bytes.`,
      );
    }
    for (const [assetId, label] of [
      [firstFinalize.body.id, "cover"],
      [galleryFinalize.body.id, "gallery"],
    ] as const) {
      const [deactivatedAsset] = await db.select({
        resourceId: mediaAssetsTable.resourceId,
        visibility: mediaAssetsTable.visibility,
      }).from(mediaAssetsTable).where(eq(mediaAssetsTable.id, assetId)).limit(1);
      assert.deepEqual(
        deactivatedAsset,
        { resourceId: ownerAndSalon.salon.id, visibility: "private" },
        `Deactivating a salon must privatize its published ${label} asset without unbinding it.`,
      );
      assert.equal(
        (await fetch(`${activeServer.baseUrl}/api/media/${assetId}?size=thumbnail`)).status,
        403,
        `An old direct URL for the deactivated salon's ${label} must be denied.`,
      );
    }
    assert.equal(
      (await fetch(`${activeServer.baseUrl}${privacyProbeUrl}&size=thumbnail`)).status,
      403,
      "Private treatment/customer media must remain protected during salon deactivation.",
    );
    const revalidatedDeactivatedCover = await fetch(
      `${activeServer.baseUrl}${firstFinalize.body.imageUrl}&size=thumbnail`,
      { headers: { accept: "image/webp,image/*", "if-none-match": etag! } },
    );
    assert.equal(
      revalidatedDeactivatedCover.status,
      403,
      "A cached salon cover must revalidate against the deactivated visibility before it can be reused.",
    );
    assert.equal(revalidatedDeactivatedCover.headers.get("cache-control"), "private, no-store");
    const revalidatedDeactivatedGallery = await fetch(
      `${activeServer.baseUrl}${galleryFinalize.body.imageUrl}&size=thumbnail`,
      { headers: { accept: "image/webp,image/*", "if-none-match": galleryEtag! } },
    );
    assert.equal(
      revalidatedDeactivatedGallery.status,
      403,
      "A cached salon gallery image must revalidate against the deactivated visibility before it can be reused.",
    );
    assert.equal(revalidatedDeactivatedGallery.headers.get("cache-control"), "private, no-store");
    const inactiveProfile = await jsonRequest<{ imageUrl: string; gallery: string[] }>(
      activeServer.baseUrl,
      "/salon/profile",
      session,
      "PATCH",
      { imageUrl: inactiveCoverAsset.imageUrl, gallery: [inactiveGalleryAsset.imageUrl] },
    );
    assert.equal(inactiveProfile.status, 200);
    for (const imageUrl of [inactiveCoverAsset.imageUrl, inactiveGalleryAsset.imageUrl]) {
      assert.equal(
        (await fetch(`${activeServer.baseUrl}${imageUrl}&size=thumbnail`)).status,
        403,
        "Media attached while the salon is inactive must remain private.",
      );
    }
    const activated = await jsonRequest<{ active: boolean }>(
      activeServer.baseUrl,
      `/admin/salons/${ownerAndSalon.salon.id}`,
      adminSession,
      "PATCH",
      { active: true },
    );
    assert.equal(activated.status, 200);
    assert.equal(activated.body.active, true);
    for (const imageUrl of [inactiveCoverAsset.imageUrl, inactiveGalleryAsset.imageUrl]) {
      const activatedImage = await fetch(`${activeServer.baseUrl}${imageUrl}&size=thumbnail`);
      assert.equal(activatedImage.status, 200, "Activating a salon must publish its matching profile and gallery images immediately.");
      assert.equal(
        activatedImage.headers.get("cache-control"),
        "public, max-age=0, s-maxage=0, must-revalidate",
        "Re-activated salon media must retain revalidation after becoming public again.",
      );
    }

    const replacementProfileAsset = await uploadAsset("salon-profile", session, "profile-detachment-replacement.jpg");
    const detachedProfile = await jsonRequest<{ imageUrl: string; gallery: string[] }>(
      activeServer.baseUrl,
      "/salon/profile",
      session,
      "PATCH",
      { imageUrl: replacementProfileAsset.imageUrl, gallery: [] },
    );
    assert.equal(
      detachedProfile.status,
      200,
      `Replacing managed salon media failed: ${JSON.stringify(detachedProfile.body)}`,
    );
    assert.equal(detachedProfile.body.imageUrl, replacementProfileAsset.imageUrl);
    assert.deepEqual(detachedProfile.body.gallery, []);
    const replacementResponse = await fetch(`${activeServer.baseUrl}${replacementProfileAsset.imageUrl}&size=thumbnail`);
    assert.equal(replacementResponse.status, 200);
    assert.equal(
      replacementResponse.headers.get("cache-control"),
      "public, max-age=0, s-maxage=0, must-revalidate",
      "A subsequent salon media change must keep the replacement response revocable.",
    );
    for (const assetId of [firstFinalize.body.id, galleryFinalize.body.id]) {
      const [detachedAsset] = await db.select({
        resourceId: mediaAssetsTable.resourceId,
        visibility: mediaAssetsTable.visibility,
      }).from(mediaAssetsTable).where(eq(mediaAssetsTable.id, assetId)).limit(1);
      assert.deepEqual(
        detachedAsset,
        { resourceId: null, visibility: "private" },
        "Removing a salon image must privatize and unbind its media asset in the same update.",
      );
    }
    await db.update(mediaUploadTicketsTable).set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(inArray(mediaUploadTicketsTable.id, [firstFinalize.body.id, galleryFinalize.body.id]));
    await runMediaUploadCleanup();
    assert.equal(
      (await db.select({ id: mediaAssetsTable.id }).from(mediaAssetsTable)
        .where(inArray(mediaAssetsTable.id, [firstFinalize.body.id, galleryFinalize.body.id]))).length,
      0,
      "Expired finalized assets that were never attached or were later detached must be removed.",
    );
    assert.equal(
      (await fetch(`${activeServer.baseUrl}${firstFinalize.body.imageUrl}&size=thumbnail`)).status,
      404,
      "Cleaned unattached media must no longer be served.",
    );

    const cleanupRaceAsset = await uploadAsset("salon-gallery", session, "cleanup-claim-race.jpg");
    await db.update(mediaUploadTicketsTable).set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(mediaUploadTicketsTable.id, cleanupRaceAsset.id));
    let cleanupRaceHookRan = false;
    await runMediaUploadCleanup({
      afterAbandonedCandidate: async (assetId) => {
        if (assetId !== cleanupRaceAsset.id) return;
        cleanupRaceHookRan = true;
        const attachment = await jsonRequest<{ gallery: string[] }>(
          activeServer!.baseUrl,
          "/salon/profile",
          session,
          "PATCH",
          { gallery: [cleanupRaceAsset.imageUrl] },
        );
        assert.equal(attachment.status, 200, "A resource claim that wins before cleanup reservation should succeed.");
        assert.deepEqual(attachment.body.gallery, [cleanupRaceAsset.imageUrl]);
      },
    });
    assert.equal(cleanupRaceHookRan, true, "The cleanup race hook should run after candidate discovery.");
    const [claimedDuringCleanup] = await db.select({
      resourceId: mediaAssetsTable.resourceId,
      visibility: mediaAssetsTable.visibility,
      cleanupReservedAt: mediaAssetsTable.cleanupReservedAt,
    }).from(mediaAssetsTable).where(eq(mediaAssetsTable.id, cleanupRaceAsset.id)).limit(1);
    assert.deepEqual(claimedDuringCleanup, {
      resourceId: ownerAndSalon.salon.id,
      visibility: "public",
      cleanupReservedAt: null,
    }, "Cleanup must not reserve or delete an asset claimed after candidate discovery.");
    const cleanupRaceVariants = await db.select().from(mediaVariantsTable)
      .where(eq(mediaVariantsTable.assetId, cleanupRaceAsset.id));
    assert.ok(cleanupRaceVariants.length > 0);
    for (const variant of cleanupRaceVariants) {
      assert.ok(
        (await readPrivateStorageObject(variant.objectPath))?.length,
        `Cleanup must preserve the claimed ${variant.sizeName}/${variant.format} variant.`,
      );
    }
    assert.equal(
      (await fetch(`${activeServer.baseUrl}${cleanupRaceAsset.imageUrl}&size=medium&format=webp`)).status,
      200,
      "The winning attachment must remain readable after cleanup resumes.",
    );
    const cleanupRaceRestoration = await jsonRequest<{ gallery: string[] }>(
      activeServer.baseUrl,
      "/salon/profile",
      session,
      "PATCH",
      { gallery: [] },
    );
    assert.equal(cleanupRaceRestoration.status, 200);
    await runMediaUploadCleanup();
    assert.equal(
      (await db.select({ id: mediaAssetsTable.id }).from(mediaAssetsTable)
        .where(eq(mediaAssetsTable.id, cleanupRaceAsset.id))).length,
      0,
      "The same asset should become cleanup-eligible after its resource reference is removed.",
    );

    const employeeAvatar = await uploadAsset("employee-avatar", session, "employee-avatar-revocation.jpg");
    const cacheEmployeeName = `Media cache employee ${randomUUID()}`;
    const employeeCreate = await jsonRequest<{ id: string }>(
      activeServer.baseUrl,
      "/salon/employees",
      session,
      "POST",
      { name: cacheEmployeeName, role: "Stilista", avatarUrl: employeeAvatar.imageUrl },
    );
    assert.equal(employeeCreate.status, 201, "The cache regression employee should be created with a managed avatar.");
    const employeeAvatarUrl = `${activeServer.baseUrl}${employeeAvatar.imageUrl}&size=thumbnail`;
    const publicEmployeeAvatar = await fetch(employeeAvatarUrl);
    assert.equal(publicEmployeeAvatar.status, 200);
    assert.equal(
      publicEmployeeAvatar.headers.get("cache-control"),
      "public, max-age=0, s-maxage=0, must-revalidate",
      "Employee avatars must revalidate because deactivation can revoke their public access.",
    );
    assert.deepEqual(
      await legacyImmutableMediaCache.fetch(employeeAvatarUrl),
      { status: 200, fromCache: false },
      "The legacy employee-avatar cache entry must be populated before deactivation.",
    );
    const employeeDeactivation = await jsonRequest<{ deactivated: boolean }>(
      activeServer.baseUrl,
      `/salon/employees/${employeeCreate.body.id}/deactivate`,
      session,
      "POST",
    );
    assert.equal(employeeDeactivation.status, 200);
    assert.equal(employeeDeactivation.body.deactivated, true);
    assert.deepEqual(
      await legacyImmutableMediaCache.fetch(employeeAvatarUrl),
      { status: 403, fromCache: false },
      "Employee deactivation must purge the cached avatar before it can bypass the revoked access.",
    );
    const [revokedEmployeeAvatar] = await db.select({
      resourceId: mediaAssetsTable.resourceId,
      visibility: mediaAssetsTable.visibility,
    }).from(mediaAssetsTable).where(eq(mediaAssetsTable.id, employeeAvatar.id)).limit(1);
    assert.deepEqual(
      revokedEmployeeAvatar,
      { resourceId: null, visibility: "private" },
      "Employee deactivation must unbind and privatize the managed avatar.",
    );
    const deniedEmployeeAvatar = await fetch(employeeAvatarUrl);
    assert.equal(deniedEmployeeAvatar.status, 403);
    assert.equal(deniedEmployeeAvatar.headers.get("cache-control"), "private, no-store");

    const oldProductAsset = await uploadAsset("product", adminSession, "product-image-revocation.jpg");
    const cacheProductSku = `MEDIA-CACHE-${randomUUID()}`;
    const productCreate = await jsonRequest<{ id: string; imageUrl: string }>(
      activeServer.baseUrl,
      "/admin/products",
      adminSession,
      "POST",
      {
        name: "Media cache product",
        categoryId: productCategory.id,
        categoryName: "ignored",
        description: "Managed product image cache regression.",
        imageUrl: oldProductAsset.imageUrl,
        images: [],
        price: 1000,
        stock: 1,
        sku: cacheProductSku,
        unit: "kom",
        weightGrams: 100,
      },
    );
    assert.equal(productCreate.status, 201, "The cache regression product should be created with a managed image.");
    const oldProductImageUrl = `${activeServer.baseUrl}${oldProductAsset.imageUrl}&size=thumbnail`;
    const publicProductImage = await fetch(oldProductImageUrl);
    assert.equal(publicProductImage.status, 200);
    assert.equal(
      publicProductImage.headers.get("cache-control"),
      "public, max-age=0, s-maxage=0, must-revalidate",
      "Product images must revalidate because an administrator can remove them from a product.",
    );
    assert.deepEqual(
      await legacyImmutableMediaCache.fetch(oldProductImageUrl),
      { status: 200, fromCache: false },
      "The legacy product-image cache entry must be populated before replacement.",
    );
    const replacementProductAsset = await uploadAsset("product", adminSession, "product-image-replacement.jpg");
    const productReplacement = await jsonRequest<{ imageUrl: string }>(
      activeServer.baseUrl,
      `/admin/products/${productCreate.body.id}`,
      adminSession,
      "PATCH",
      { imageUrl: replacementProductAsset.imageUrl, images: [] },
    );
    assert.equal(productReplacement.status, 200);
    assert.equal(productReplacement.body.imageUrl, replacementProductAsset.imageUrl);
    assert.deepEqual(
      await legacyImmutableMediaCache.fetch(oldProductImageUrl),
      { status: 403, fromCache: false },
      "Replacing a product image must purge the cached original before it can bypass revoked access.",
    );
    const [revokedProductImage] = await db.select({
      resourceId: mediaAssetsTable.resourceId,
      visibility: mediaAssetsTable.visibility,
    }).from(mediaAssetsTable).where(eq(mediaAssetsTable.id, oldProductAsset.id)).limit(1);
    assert.deepEqual(
      revokedProductImage,
      { resourceId: null, visibility: "private" },
      "Replacing a product image must unbind and privatize the old managed asset.",
    );
    const deniedProductImage = await fetch(oldProductImageUrl);
    assert.equal(deniedProductImage.status, 403);
    assert.equal(deniedProductImage.headers.get("cache-control"), "private, no-store");
    const replacementProductImage = await fetch(`${activeServer.baseUrl}${replacementProductAsset.imageUrl}&size=thumbnail`);
    assert.equal(replacementProductImage.status, 200);
    assert.equal(
      replacementProductImage.headers.get("cache-control"),
      "public, max-age=0, s-maxage=0, must-revalidate",
      "The replacement product image must keep a revocable cache policy.",
    );
    const bulkProductDeactivation = await jsonRequest<{ updated: number }>(
      activeServer.baseUrl,
      "/admin/products/bulk",
      adminSession,
      "POST",
      { productIds: [productCreate.body.id], action: "deactivate" },
    );
    assert.equal(bulkProductDeactivation.status, 200);
    assert.equal(bulkProductDeactivation.body.updated, 1);
    assert.equal(
      (await fetch(`${activeServer.baseUrl}${replacementProductAsset.imageUrl}&size=thumbnail`)).status,
      403,
      "Bulk deactivation must revoke the managed product image.",
    );
    const bulkProductReactivation = await jsonRequest<{ updated: number }>(
      activeServer.baseUrl,
      "/admin/products/bulk",
      adminSession,
      "POST",
      { productIds: [productCreate.body.id], action: "activate" },
    );
    assert.equal(bulkProductReactivation.status, 200);
    assert.equal(bulkProductReactivation.body.updated, 1);
    const reactivatedProductImage = await fetch(`${activeServer.baseUrl}${replacementProductAsset.imageUrl}&size=thumbnail`);
    assert.equal(reactivatedProductImage.status, 200);
    assert.equal(
      reactivatedProductImage.headers.get("cache-control"),
      "public, max-age=0, s-maxage=0, must-revalidate",
      "Bulk reactivation must safely reclaim the image with the revocable public cache policy.",
    );
    const [reactivatedProductAsset] = await db.select({
      resourceId: mediaAssetsTable.resourceId,
      visibility: mediaAssetsTable.visibility,
    }).from(mediaAssetsTable).where(eq(mediaAssetsTable.id, replacementProductAsset.id)).limit(1);
    assert.deepEqual(
      reactivatedProductAsset,
      { resourceId: productCreate.body.id, visibility: "public" },
      "Bulk reactivation must rebind the managed image to its active product.",
    );

    const oldProductCategoryAsset = await uploadAsset("product-category", adminSession, "product-category-image-revocation.jpg");
    const cacheCategoryName = `Media cache category ${randomUUID()}`;
    const productCategoryCreate = await jsonRequest<{ id: string; imageUrl: string | null }>(
      activeServer.baseUrl,
      "/admin/product-categories",
      adminSession,
      "POST",
      { name: cacheCategoryName, imageUrl: oldProductCategoryAsset.imageUrl },
    );
    assert.equal(productCategoryCreate.status, 201);
    assert.equal(productCategoryCreate.body.imageUrl, oldProductCategoryAsset.imageUrl);
    const oldProductCategoryImageUrl = `${activeServer.baseUrl}${oldProductCategoryAsset.imageUrl}&size=thumbnail`;
    const publicProductCategoryImage = await fetch(oldProductCategoryImageUrl);
    assert.equal(publicProductCategoryImage.status, 200);
    assert.equal(
      publicProductCategoryImage.headers.get("cache-control"),
      "public, max-age=0, s-maxage=0, must-revalidate",
      "Product-category images must revalidate because an administrator can replace them.",
    );
    assert.deepEqual(
      await legacyImmutableMediaCache.fetch(oldProductCategoryImageUrl),
      { status: 200, fromCache: false },
      "The legacy product-category cache entry must be populated before replacement.",
    );
    const replacementProductCategoryAsset = await uploadAsset("product-category", adminSession, "product-category-image-replacement.jpg");
    const productCategoryReplacement = await jsonRequest<{ imageUrl: string | null }>(
      activeServer.baseUrl,
      `/admin/product-categories/${productCategoryCreate.body.id}`,
      adminSession,
      "PATCH",
      { imageUrl: replacementProductCategoryAsset.imageUrl },
    );
    assert.equal(productCategoryReplacement.status, 200);
    assert.equal(productCategoryReplacement.body.imageUrl, replacementProductCategoryAsset.imageUrl);
    assert.deepEqual(
      await legacyImmutableMediaCache.fetch(oldProductCategoryImageUrl),
      { status: 403, fromCache: false },
      "Replacing a product-category image must purge the cached original before it can bypass revoked access.",
    );
    const [revokedProductCategoryImage] = await db.select({
      resourceId: mediaAssetsTable.resourceId,
      visibility: mediaAssetsTable.visibility,
    }).from(mediaAssetsTable).where(eq(mediaAssetsTable.id, oldProductCategoryAsset.id)).limit(1);
    assert.deepEqual(
      revokedProductCategoryImage,
      { resourceId: null, visibility: "private" },
      "Replacing a product-category image must unbind and privatize the old managed asset.",
    );

    const educationFixtureKey = randomUUID();
    const [educationOwner] = await db.insert(usersTable).values({
      firstName: "Media",
      lastName: "Regression",
      email: `media-regression-${educationFixtureKey}@example.invalid`,
      passwordHash: await hashPassword(randomUUID()),
      passwordSetAt: new Date(),
      role: "EDUKATIVNI_CENTAR",
    }).returning();
    assert.ok(educationOwner);
    educationFixtureOwnerId = educationOwner.id;

    const [educationPlan] = await db.insert(subscriptionPlansTable).values({
      name: `MEDIA-REGRESSION-${educationFixtureKey}`,
      price: 0,
      features: ["Media regression fixture"],
      limits: {},
    }).returning();
    assert.ok(educationPlan);
    educationFixturePlanId = educationPlan.id;

    const [educationCenter] = await db.insert(educationCentersTable).values({
      ownerId: educationOwner.id,
      name: `Media regression center ${educationFixtureKey}`,
      city: "Beograd",
      description: "Temporary fixture for the managed Education cover regression.",
      imageUrl: "/lumera-media/course-1.jpg",
      verificationStatus: "verified",
      verifiedAt: new Date(),
      verifiedByUserId: adminUser.id,
    }).returning();
    assert.ok(educationCenter);
    educationFixtureCenterId = educationCenter.id;

    const [educationSubscription] = await db.insert(educationCenterSubscriptionsTable).values({
      centerId: educationCenter.id,
      planId: educationPlan.id,
      status: "active",
      dueAmount: 0,
      currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }).returning();
    assert.ok(educationSubscription);
    educationFixtureSubscriptionId = educationSubscription.id;

    const educationSession = await createSession(educationOwner.id);
    const originalEducationAsset = await uploadAsset(
      "education-cover",
      educationSession,
      "education-cover-original.jpg",
    );
    const educationCourse = await jsonRequest<EducationCourse>(
      activeServer.baseUrl,
      "/education/courses",
      educationSession,
      "POST",
      {
        title: `Media cover regression ${educationFixtureKey}`,
        description: "Temporary published course for the managed Education cover regression.",
        category: "Test",
        format: "online",
        price: 1000,
        duration: "1 dan",
        certification: false,
        imageUrl: originalEducationAsset.imageUrl,
      },
    );
    assert.equal(educationCourse.status, 201, "The regression should create its own managed Education course.");
    educationFixtureCourseId = educationCourse.body.id;
    const publishedEducationCourse = await jsonRequest<EducationCourse>(
      activeServer.baseUrl,
      `/education/courses/${educationCourse.body.id}/publish`,
      educationSession,
      "POST",
    );
    assert.equal(publishedEducationCourse.status, 200, "The temporary Education course should be publishable.");
    assert.equal(publishedEducationCourse.body.published, true);
    assert.equal(publishedEducationCourse.body.archived, false);
    assert.equal(publishedEducationCourse.body.imageUrl, originalEducationAsset.imageUrl);

    const oldEducationCover = publishedEducationCourse.body.imageUrl;
    const oldEducationAssetId = mediaAssetIdFromUrl(oldEducationCover);
    assert.equal(oldEducationAssetId, originalEducationAsset.id);
    const [claimedOriginalEducationAsset] = await db.select({
      resourceId: mediaAssetsTable.resourceId,
      visibility: mediaAssetsTable.visibility,
    }).from(mediaAssetsTable).where(eq(mediaAssetsTable.id, originalEducationAsset.id)).limit(1);
    assert.deepEqual(
      claimedOriginalEducationAsset,
      { resourceId: educationCourse.body.id, visibility: "education" },
      "The fixture course must own its managed cover before the revocation check starts.",
    );

    const educationAsset = await uploadAsset(
      "education-cover",
      educationSession,
      "education-cover-replacement.jpg",
    );
    const oldCoverBeforeReplacement = await fetch(`${activeServer.baseUrl}${oldEducationCover}&size=thumbnail`);
    assert.equal(oldCoverBeforeReplacement.status, 200);
    assert.equal(
      oldCoverBeforeReplacement.headers.get("cache-control"),
      "private, no-store",
      "Revocable Education imagery must never receive immutable public caching.",
    );

    let educationCoverReplaced = false;
    try {
      const replacement = await jsonRequest<{ imageUrl: string }>(
        activeServer.baseUrl,
        `/education/courses/${educationCourse.body.id}`,
        educationSession,
        "PATCH",
        { imageUrl: educationAsset.imageUrl },
      );
      educationCoverReplaced = replacement.status === 200;
      assert.equal(replacement.status, 200);
      const oldCoverAfterReplacement = await fetch(`${activeServer.baseUrl}${oldEducationCover}&size=thumbnail`);
      assert.equal(oldCoverAfterReplacement.status, 403, "A replaced Education cover must stop being anonymously readable.");
      const [revokedOldAsset] = await db.select({
        resourceId: mediaAssetsTable.resourceId,
        visibility: mediaAssetsTable.visibility,
      }).from(mediaAssetsTable).where(eq(mediaAssetsTable.id, oldEducationAssetId)).limit(1);
      assert.deepEqual(
        revokedOldAsset,
        { resourceId: null, visibility: "private" },
        "Replacing a course cover must atomically privatize and unbind the previous asset.",
      );
      const newCoverAfterReplacement = await fetch(`${activeServer.baseUrl}${educationAsset.imageUrl}&size=thumbnail`);
      assert.equal(newCoverAfterReplacement.status, 200);
      assert.equal(newCoverAfterReplacement.headers.get("cache-control"), "private, no-store");
    } finally {
      if (educationCoverReplaced) {
        const restoration = await jsonRequest<{ imageUrl: string }>(
          activeServer.baseUrl,
          `/education/courses/${educationCourse.body.id}`,
          educationSession,
          "PATCH",
          { imageUrl: oldEducationCover },
        );
        assert.equal(restoration.status, 200, "Education cover regression must restore its original course reference.");
      }
    }
    const newCoverAfterRestoration = await fetch(`${activeServer.baseUrl}${educationAsset.imageUrl}&size=thumbnail`);
    assert.equal(newCoverAfterRestoration.status, 403, "Restoration must revoke the temporary Education cover.");

    console.log("Media upload, optimization, cache and restart regression passed.");
  } finally {
    const storageCleanupErrors: unknown[] = [];
    if (activeServer) await stopServer(activeServer.server).catch(() => undefined);
    disableMediaCachePurge?.();
    disableRegressionUploadMarking?.();
    mediaRegressionRequestHeaders = {};
    await db.update(salonsTable).set(originalSalonMedia).where(eq(salonsTable.id, ownerAndSalon.salon.id));
    if (privacyProbeAssetId) {
      await db.delete(mediaAssetsTable).where(eq(mediaAssetsTable.id, privacyProbeAssetId));
    }
    await db.delete(productsTable).where(like(productsTable.sku, "MEDIA-ROLLBACK-%"));
    await db.delete(productsTable).where(like(productsTable.sku, "MEDIA-CACHE-%"));
    await db.delete(productCategoriesTable).where(like(productCategoriesTable.name, "Media category rollback %"));
    await db.delete(productCategoriesTable).where(like(productCategoriesTable.name, "Media cache category %"));
    await db.delete(coursesTable).where(like(coursesTable.title, "Media course rollback %"));
    await db.delete(employeesTable).where(like(employeesTable.name, "Media employee rollback %"));
    await db.delete(employeesTable).where(like(employeesTable.name, "Media cache employee %"));
    if (educationFixtureCourseId) {
      await db.delete(coursesTable).where(eq(coursesTable.id, educationFixtureCourseId));
    }
    if (educationFixtureSubscriptionId) {
      await db.delete(educationCenterSubscriptionsTable)
        .where(eq(educationCenterSubscriptionsTable.id, educationFixtureSubscriptionId));
    }
    if (educationFixtureCenterId) {
      await db.delete(educationCentersTable).where(eq(educationCentersTable.id, educationFixtureCenterId));
    }
    for (const uploadId of createdUploadIds) {
      const variants = await db.select().from(mediaVariantsTable).where(eq(mediaVariantsTable.assetId, uploadId));
      const [ticket] = await db.select().from(mediaUploadTicketsTable).where(eq(mediaUploadTicketsTable.id, uploadId)).limit(1);
      for (const variant of variants) {
        await deletePrivateStorageObject(variant.objectPath).catch((error) => storageCleanupErrors.push(error));
      }
      if (ticket) {
        await deletePrivateStorageObject(ticket.stagingObjectPath).catch((error) => storageCleanupErrors.push(error));
      }
      await db.delete(mediaAssetsTable).where(eq(mediaAssetsTable.id, uploadId));
      await db.delete(mediaUploadTicketsTable).where(eq(mediaUploadTicketsTable.id, uploadId));
    }
    if (educationFixturePlanId) {
      await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, educationFixturePlanId));
    }
    if (educationFixtureOwnerId) {
      await db.delete(usersTable).where(eq(usersTable.id, educationFixtureOwnerId));
    }
    if (regressionLockHeld) {
      await regressionLock.query("select pg_advisory_unlock(hashtext($1))", [
        MEDIA_ROUTE_REGRESSION_CLEANUP_KEY,
      ]);
    }
    regressionLock.release();
    await pool.end();
    if (storageCleanupErrors.length) {
      throw new AggregateError(storageCleanupErrors, "Media regression cleanup left App Storage objects behind.");
    }
  }
}

await run();