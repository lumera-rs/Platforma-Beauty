import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, like, sql } from "drizzle-orm";
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
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, sessionCookieName } from "./auth";
import { ensureDemoData } from "./seed";
import { approvedServiceCategoryReference } from "./media-migration";
import {
  canClaimMediaReference,
  claimMediaReference,
  deletePrivateStorageObject,
  mediaAssetIdFromUrl,
  readPrivateStorageObject,
  runMediaUploadCleanup,
} from "../routes/media";

type Ticket = { uploadId: string; uploadUrl: string; expiresAt: string };
type Asset = { id: string; imageUrl: string; width: number; height: number; contentHash: string };

async function jsonRequest<T>(
  baseUrl: string,
  path: string,
  session: string,
  method: "PATCH" | "POST",
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      cookie: `${sessionCookieName}=${session}`,
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
  const originalSalonMedia = {
    imageUrl: ownerAndSalon.salon.imageUrl,
    gallery: ownerAndSalon.salon.gallery,
  };
  let activeServer: Awaited<ReturnType<typeof startServer>> | null = null;

  try {
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

    const webpResponse = await fetch(`${activeServer.baseUrl}${firstFinalize.body.imageUrl}&size=thumbnail`, {
      headers: { accept: "image/webp,image/*" },
    });
    assert.equal(webpResponse.status, 200);
    assert.equal(webpResponse.headers.get("content-type"), "image/webp");
    assert.equal(webpResponse.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(webpResponse.headers.get("vary"), "Accept");
    const etag = webpResponse.headers.get("etag");
    assert.ok(etag);

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
    assert.equal(stableWithoutVersion.headers.get("cache-control"), "public, max-age=300, s-maxage=3600");
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

    const detachedProfile = await jsonRequest<{ imageUrl: string; gallery: string[] }>(
      activeServer.baseUrl,
      "/salon/profile",
      session,
      "PATCH",
      originalSalonMedia,
    );
    assert.equal(detachedProfile.status, 200);
    assert.equal(detachedProfile.body.imageUrl, originalSalonMedia.imageUrl);
    assert.deepEqual(detachedProfile.body.gallery, originalSalonMedia.gallery);
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
      { gallery: originalSalonMedia.gallery },
    );
    assert.equal(cleanupRaceRestoration.status, 200);
    await runMediaUploadCleanup();
    assert.equal(
      (await db.select({ id: mediaAssetsTable.id }).from(mediaAssetsTable)
        .where(eq(mediaAssetsTable.id, cleanupRaceAsset.id))).length,
      0,
      "The same asset should become cleanup-eligible after its resource reference is removed.",
    );

    const [educationFixture] = await db.select({
      course: coursesTable,
      ownerId: educationCentersTable.ownerId,
    }).from(coursesTable)
      .innerJoin(educationCentersTable, eq(educationCentersTable.id, coursesTable.centerId))
      .innerJoin(
        educationCenterSubscriptionsTable,
        eq(educationCenterSubscriptionsTable.centerId, educationCentersTable.id),
      )
      .innerJoin(usersTable, eq(usersTable.id, educationCentersTable.ownerId))
      .where(and(
        eq(coursesTable.published, true),
        eq(coursesTable.archived, false),
        eq(educationCentersTable.verificationStatus, "verified"),
        inArray(educationCenterSubscriptionsTable.status, ["active", "free_via_loyalty"]),
        eq(usersTable.active, true),
        eq(usersTable.role, "EDUCATION_CENTER_OWNER"),
        sql`${coursesTable.imageUrl} like '/api/media/%'`,
      ))
      .limit(1);
    assert.ok(educationFixture, "A public managed Education course is required for cover revocation regression.");
    const oldEducationCover = educationFixture.course.imageUrl;
    const oldEducationAssetId = mediaAssetIdFromUrl(oldEducationCover);
    assert.ok(oldEducationAssetId);
    const educationSession = await createSession(educationFixture.ownerId);
    const educationTicket = await jsonRequest<Ticket>(
      activeServer.baseUrl,
      "/media/uploads",
      educationSession,
      "POST",
      {
        scope: "education-cover",
        resourceId: educationFixture.course.id,
        name: "education-cover-regression.jpg",
        size: jpeg.length,
        contentType: "image/jpeg",
      },
    );
    assert.equal(educationTicket.status, 200);
    createdUploadIds.push(educationTicket.body.uploadId);
    assert.ok((await fetch(educationTicket.body.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: jpeg,
    })).ok);
    const educationAsset = await jsonRequest<Asset>(
      activeServer.baseUrl,
      `/media/uploads/${educationTicket.body.uploadId}/finalize`,
      educationSession,
      "POST",
    );
    assert.equal(educationAsset.status, 201);
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
        `/education/courses/${educationFixture.course.id}`,
        educationSession,
        "PATCH",
        { imageUrl: educationAsset.body.imageUrl },
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
      const newCoverAfterReplacement = await fetch(`${activeServer.baseUrl}${educationAsset.body.imageUrl}&size=thumbnail`);
      assert.equal(newCoverAfterReplacement.status, 200);
      assert.equal(newCoverAfterReplacement.headers.get("cache-control"), "private, no-store");
    } finally {
      if (educationCoverReplaced) {
        const restoration = await jsonRequest<{ imageUrl: string }>(
          activeServer.baseUrl,
          `/education/courses/${educationFixture.course.id}`,
          educationSession,
          "PATCH",
          { imageUrl: oldEducationCover },
        );
        assert.equal(restoration.status, 200, "Education cover regression must restore its original course reference.");
      }
    }
    const newCoverAfterRestoration = await fetch(`${activeServer.baseUrl}${educationAsset.body.imageUrl}&size=thumbnail`);
    assert.equal(newCoverAfterRestoration.status, 403, "Restoration must revoke the temporary Education cover.");

    console.log("Media upload, optimization, cache and restart regression passed.");
  } finally {
    if (activeServer) await stopServer(activeServer.server).catch(() => undefined);
    await db.update(salonsTable).set(originalSalonMedia).where(eq(salonsTable.id, ownerAndSalon.salon.id));
    await db.delete(productsTable).where(like(productsTable.sku, "MEDIA-ROLLBACK-%"));
    await db.delete(productCategoriesTable).where(like(productCategoriesTable.name, "Media category rollback %"));
    await db.delete(coursesTable).where(like(coursesTable.title, "Media course rollback %"));
    await db.delete(employeesTable).where(like(employeesTable.name, "Media employee rollback %"));
    for (const uploadId of createdUploadIds) {
      const variants = await db.select().from(mediaVariantsTable).where(eq(mediaVariantsTable.assetId, uploadId));
      const [ticket] = await db.select().from(mediaUploadTicketsTable).where(eq(mediaUploadTicketsTable.id, uploadId)).limit(1);
      for (const variant of variants) await deletePrivateStorageObject(variant.objectPath).catch(() => undefined);
      if (ticket) await deletePrivateStorageObject(ticket.stagingObjectPath).catch(() => undefined);
      await db.delete(mediaAssetsTable).where(eq(mediaAssetsTable.id, uploadId));
      await db.delete(mediaUploadTicketsTable).where(eq(mediaUploadTicketsTable.id, uploadId));
    }
    await pool.end();
  }
}

await run();