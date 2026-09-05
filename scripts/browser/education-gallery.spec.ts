import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  db,
  pool,
  coursesTable,
  educationCentersTable,
  educationCenterSubscriptionsTable,
  emailDeliveriesTable,
  educationMediaTable,
  educationMediaUploadsTable,
  subscriptionPlansTable,
  usersTable,
} from "@workspace/db";
import { hashPassword } from "../../artifacts/api-server/src/lib/auth";
import {
  sendEducationGalleryCleanupAlert,
  type TransactionalEmailTransport,
} from "../../artifacts/api-server/src/lib/brevo";
import {
  cleanupEducationMediaUpload,
  runEducationGalleryCleanup,
} from "../../artifacts/api-server/src/routes/marketplace";
import { buildValidOnlineEducationCourse } from "../../artifacts/api-server/src/lib/education-test-fixtures";
import { eq, inArray, like, or, sql } from "drizzle-orm";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWPYEtD0HxkzkC4AAFKXKFH5WEhSAAAAAElFTkSuQmCC",
  "base64",
);
const maxGalleryImageBytes = 8 * 1024 * 1024;

const maxOptimizedImageBytes = 12 * 1024 * 1024;
function paddedPng(size: number): Buffer {
  const bytes = Buffer.alloc(size);
  tinyPng.copy(bytes);
  return bytes;
}

type GalleryFixture = {
  ownerEmail: string;
  ownerPassword: string;
  outsiderEmail: string;
  outsiderPassword: string;
  adminEmail: string;
  adminPassword: string;
  ownerId: string;
  outsiderId: string;
  adminId: string;
  centerId: string;
  courseId: string;
  planId: string;
};

async function createGalleryFixture(): Promise<GalleryFixture> {
  const suffix = randomUUID();
  const ownerPassword = "gallery-owner-password";
  const outsiderPassword = "gallery-outsider-password";
  const adminPassword = "gallery-admin-password";
  let ownerId: string | undefined;
  let outsiderId: string | undefined;
  let adminId: string | undefined;
  let centerId: string | undefined;
  let courseId: string | undefined;
  let planId: string | undefined;
  try {
    const [owner] = await db.insert(usersTable).values({
      firstName: "Gallery",
      lastName: "Owner",
      email: `browser-gallery-owner-${suffix}@example.test`,
      passwordHash: await hashPassword(ownerPassword),
      passwordSetAt: new Date(),
      role: "EDUKATIVNI_CENTAR",
    }).returning();
    if (!owner) throw new Error("Could not create gallery owner fixture.");
    ownerId = owner.id;
    const [outsider] = await db.insert(usersTable).values({
      firstName: "Gallery",
      lastName: "Outsider",
      email: `browser-gallery-outsider-${suffix}@example.test`,
      passwordHash: await hashPassword(outsiderPassword),
      passwordSetAt: new Date(),
      role: "CUSTOMER",
    }).returning();
    if (!outsider) throw new Error("Could not create gallery outsider fixture.");
    outsiderId = outsider.id;
    const [admin] = await db.insert(usersTable).values({
      firstName: "Gallery",
      lastName: "Administrator",
      email: `browser-gallery-admin-${suffix}@example.test`,
      passwordHash: await hashPassword(adminPassword),
      passwordSetAt: new Date(),
      role: "ADMIN",
    }).returning();
    if (!admin) throw new Error("Could not create gallery admin fixture.");
    adminId = admin.id;
    const [center] = await db.insert(educationCentersTable).values({
      ownerId: owner.id,
      name: `Gallery test center ${suffix}`,
      city: "Beograd",
      description: "Isolated center for course gallery testing.",
      imageUrl: "/gallery-test-center.jpg",
      verificationStatus: "verified",
      verifiedAt: new Date(),
      verifiedByUserId: owner.id,
    }).returning();
    if (!center) throw new Error("Could not create gallery center fixture.");
    centerId = center.id;
    const [plan] = await db.insert(subscriptionPlansTable).values({
      name: `Gallery test plan ${suffix}`,
      price: 0,
      features: [],
      limits: {},
    }).returning();
    if (!plan) throw new Error("Could not create gallery subscription plan fixture.");
    planId = plan.id;
    await db.insert(educationCenterSubscriptionsTable).values({
      centerId: center.id,
      planId: plan.id,
      status: "active",
      dueAmount: 0,
      currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const [course] = await db.insert(coursesTable).values(buildValidOnlineEducationCourse({
      centerId: center.id,
      title: `Gallery course ${suffix}`,
      description: "Isolated course for direct gallery upload testing.",
      category: "Browser test",
      format: "online",
      city: "Beograd",
      price: 1,
      duration: "1 dan",
      certification: false,
      imageUrl: "/gallery-test-course.jpg",
      published: true,
    })).returning();
    if (!course) throw new Error("Could not create gallery course fixture.");
    courseId = course.id;
    return {
      ownerEmail: owner.email,
      ownerPassword,
      outsiderEmail: outsider.email,
      outsiderPassword,
      adminEmail: admin.email,
      adminPassword,
      ownerId,
      outsiderId,
      adminId,
      centerId,
      courseId,
      planId,
    };
  } catch (error) {
    if (courseId) await db.delete(coursesTable).where(eq(coursesTable.id, courseId));
    if (centerId) await db.delete(educationCentersTable).where(eq(educationCentersTable.id, centerId));
    if (planId) await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId));
    if (adminId) await db.delete(usersTable).where(eq(usersTable.id, adminId));
    if (outsiderId) await db.delete(usersTable).where(eq(usersTable.id, outsiderId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpGalleryFixture(fixture: GalleryFixture) {
  await db.delete(coursesTable).where(eq(coursesTable.id, fixture.courseId));
  await db.delete(educationCentersTable).where(eq(educationCentersTable.id, fixture.centerId));
  await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, fixture.planId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.adminId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.outsiderId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
}

async function uploadGalleryImage(
  request: APIRequestContext,
  fixture: GalleryFixture,
  name: string,
): Promise<{ mediaId: string; uploadUrl: string }> {
  const ticketResponse = await request.post(`/api/education/courses/${fixture.courseId}/gallery/upload-url`, {
    data: {
      name,
      size: tinyPng.length,
      contentType: "image/png",
    },
  });
  expect(ticketResponse).toBeOK();
  const ticket = await ticketResponse.json() as { mediaId: string; uploadUrl: string };
  const upload = await request.put(ticket.uploadUrl, {
    headers: { "Content-Type": "image/png" },
    data: tinyPng,
  });
  expect(upload).toBeOK();
  return ticket;
}

function privateObjectPathFromStoragePath(storagePath: string): string {
  if (!storagePath.startsWith("/objects/")) throw new Error("Expected a private storage path.");
  const root = process.env.PRIVATE_OBJECT_DIR;
  if (!root) throw new Error("PRIVATE_OBJECT_DIR is required for gallery storage checks.");
  return `${root.replace(/\/+$/, "")}/${storagePath.slice("/objects/".length)}`;
}

async function signedStorageUrl(storagePath: string, method: "DELETE" | "GET"): Promise<string> {
  const rawPath = privateObjectPathFromStoragePath(storagePath);
  const [, bucketName, ...objectParts] = rawPath.startsWith("/") ? rawPath.split("/") : `/${rawPath}`.split("/");
  const response = await fetch("http://127.0.0.1:1106/object-storage/signed-object-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectParts.join("/"),
      method,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }),
  });
  expect(response.ok).toBe(true);
  const data = await response.json() as { signed_url?: string };
  if (!data.signed_url) throw new Error("App Storage did not return a signed URL.");
  return data.signed_url;
}

async function storageObjectStatus(storagePath: string): Promise<number> {
  const response = await fetch(await signedStorageUrl(storagePath, "GET"));
  response.body?.cancel();
  return response.status;
}

async function deleteStorageObject(storagePath: string): Promise<void> {
  const response = await fetch(await signedStorageUrl(storagePath, "DELETE"), { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Could not clean up gallery test object (${response.status}).`);
  }
}

function galleryDeleteRollbackFaultNames(mediaId: string) {
  const suffix = mediaId.replaceAll("-", "");
  return {
    triggerName: `gallery_delete_rollback_${suffix}`,
    functionName: `gallery_delete_rollback_${suffix}_fn`,
  };
}

async function installGalleryDeleteRollbackFault(mediaId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) throw new Error("Expected a gallery media UUID.");
  const { triggerName, functionName } = galleryDeleteRollbackFaultNames(mediaId);
  await pool.query(`
    CREATE FUNCTION public.${functionName}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.id = '${mediaId}'::uuid THEN
        RAISE EXCEPTION 'forced gallery delete rollback';
      END IF;
      RETURN OLD;
    END;
    $$;
  `);
  await pool.query(`
    CREATE TRIGGER ${triggerName}
    BEFORE DELETE ON public.education_media
    FOR EACH ROW EXECUTE FUNCTION public.${functionName}();
  `);
}

async function removeGalleryDeleteRollbackFault(mediaId: string): Promise<void> {
  const { triggerName, functionName } = galleryDeleteRollbackFaultNames(mediaId);
  await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON public.education_media;`);
  await pool.query(`DROP FUNCTION IF EXISTS public.${functionName}();`);
}

async function waitForGalleryLockWaiters(courseId: string, expectedWaiters: number): Promise<void> {
  const lockKey = `education-course-gallery:${courseId}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ waiterCount: number }>(`
      SELECT count(*)::int AS "waiterCount"
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND objid = hashtext($1)::oid
        AND NOT granted
    `, [lockKey]);
    if ((result.rows[0]?.waiterCount ?? 0) >= expectedWaiters) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Expected ${expectedWaiters} gallery operations to wait on the course lock.`);
}

test("education center owner uploads, manages, and removes a course gallery image", async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = await createGalleryFixture();
  try {
    const ownerLogin = await page.request.post("/api/auth/login", {
      data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
    });
    expect(ownerLogin).toBeOK();

    await page.goto(`/biznis/edukacije/${fixture.courseId}`);
    await expect(page.getByText("Fotografije galerije", { exact: true })).toBeVisible();
    const picker = page.getByLabel("Dodaj fotografiju u galeriju");
    await expect(picker).toBeAttached();
    let oversizedUploadUrlRequests = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/media/uploads")) {
        oversizedUploadUrlRequests += 1;
      }
    });
    await picker.setInputFiles({
      name: "course-gallery-too-large.png",
      mimeType: "image/png",
      buffer: paddedPng(maxOptimizedImageBytes + 1),
    });
    await expect(page.getByRole("alert")).toContainText("do 12 MB");
    await expect(picker).toBeEnabled();
    expect(oversizedUploadUrlRequests).toBe(0);
    const firstUploadTicketResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && response.url().includes("/api/media/uploads"),
    );
    await picker.setInputFiles({ name: "course-gallery.png", mimeType: "image/png", buffer: tinyPng });
    await expect(page.getByText("Fotografija 1", { exact: true })).toBeVisible({ timeout: 30_000 });
    const firstUploadTicket = await (await firstUploadTicketResponse).json() as { uploadUrl: string; uploadId: string };
    await picker.setInputFiles({ name: "course-gallery-second.png", mimeType: "image/png", buffer: tinyPng });
    await expect(page.getByText("Fotografija 2", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel(/Opis slike/).first()).toBeVisible();

    const ownerCourse = await page.request.get(`/api/education/courses/${fixture.courseId}`);
    expect(ownerCourse).toBeOK();
    const ownerCourseJson = await ownerCourse.json() as { gallery: Array<{ id: string; url: string; altText: string }> };
    expect(ownerCourseJson.gallery).toHaveLength(2);
    expect(ownerCourseJson.gallery[0]?.url).toMatch(/^\/api\/media\//);
    expect(JSON.stringify(ownerCourseJson)).not.toContain("objectPath");
    const storedMedia = await db.select().from(educationMediaTable).where(eq(educationMediaTable.id, ownerCourseJson.gallery[0]!.id)).limit(1);
    expect(storedMedia[0]?.objectPath).toMatch(/^\/api\/media\//);
    expect(storedMedia[0]?.objectPath).not.toContain("staging");
    const servedImage = await page.request.get(ownerCourseJson.gallery[0]!.url);
    expect(servedImage).toBeOK();
    expect(servedImage.headers()["content-type"]).toContain("image/png");
    expect(servedImage.headers()["cache-control"]).toBe("private, no-store");
    const originalImageBytes = await servedImage.body();
    const stagingOverwrite = await page.request.put(firstUploadTicket.uploadUrl, {
      headers: { "Content-Type": "image/png" },
      data: Buffer.from("not a PNG"),
    });
    expect(stagingOverwrite.ok()).toBeTruthy();
    const replayedAttach = await page.request.post(`/api/education/courses/${fixture.courseId}/gallery`, {
      data: { mediaId: firstUploadTicket.uploadId },
    });
    expect(replayedAttach.status()).toBe(200);
    const immutableImage = await page.request.get(ownerCourseJson.gallery[0]!.url);
    expect(immutableImage).toBeOK();
    expect(Buffer.compare(await immutableImage.body(), originalImageBytes)).toBe(0);

    const legacyMedia = await db.insert(educationMediaTable).values([
      {
        courseId: fixture.courseId,
        centerId: fixture.centerId,
        objectPath: "https://example.test/legacy-course-image.png",
        altText: "Legacy HTTP image",
        sortOrder: 100,
      },
      {
        courseId: fixture.courseId,
        centerId: fixture.centerId,
        objectPath: "/objects/legacy-course-image.png",
        altText: "Legacy object image",
        sortOrder: 101,
      },
      {
        courseId: fixture.courseId,
        centerId: fixture.centerId,
        objectPath: "legacy-course-bare-key.png",
        altText: "Legacy bare course image",
        sortOrder: 102,
      },
      {
        centerId: fixture.centerId,
        objectPath: "/api/storage/objects/legacy-center-image.png",
        altText: "Legacy center image",
        sortOrder: 103,
      },
      {
        centerId: fixture.centerId,
        objectPath: "legacy-center-bare-key.png",
        altText: "Legacy bare center image",
        sortOrder: 104,
      },
    ]).returning();
    const legacyCourse = await page.request.get(`/api/education/courses/${fixture.courseId}`);
    expect(legacyCourse).toBeOK();
    const legacyCourseJson = await legacyCourse.json() as { gallery: Array<{ id: string; url: string }> };
    expect(legacyCourseJson.gallery.find((media) => media.id === legacyMedia[0]!.id)?.url).toBe("https://example.test/legacy-course-image.png");
    expect(legacyCourseJson.gallery.find((media) => media.id === legacyMedia[1]!.id)?.url).toBe("/api/storage/objects/legacy-course-image.png");
    expect(legacyCourseJson.gallery.find((media) => media.id === legacyMedia[2]!.id)?.url).toBe("/api/storage/objects/legacy-course-bare-key.png");
    const legacyCenter = await page.request.get(`/api/education/public/centers/${fixture.centerId}`);
    expect(legacyCenter).toBeOK();
    const legacyCenterJson = await legacyCenter.json() as { gallery: Array<{ id: string; url: string }> };
    expect(legacyCenterJson.gallery.find((media) => media.id === legacyMedia[3]!.id)?.url).toBe("/api/storage/objects/legacy-center-image.png");
    expect(legacyCenterJson.gallery.find((media) => media.id === legacyMedia[4]!.id)?.url).toBe("/api/storage/objects/legacy-center-bare-key.png");
    await db.delete(educationMediaTable).where(inArray(educationMediaTable.id, legacyMedia.map((media) => media.id)));

    await page.getByLabel("Pomeri fotografiju ranije").last().click();
    await expect(async () => {
      const reordered = await page.request.get(`/api/education/courses/${fixture.courseId}`);
      const reorderedJson = await reordered.json() as { gallery: Array<{ id: string }> };
      expect(reorderedJson.gallery[0]?.id).toBe(ownerCourseJson.gallery[1]?.id);
    }).toPass({ timeout: 15_000 });

    await db.update(coursesTable).set({ published: false }).where(eq(coursesTable.id, fixture.courseId));
    const privateImage = await page.request.get(ownerCourseJson.gallery[0]!.url);
    expect(privateImage).toBeOK();
    expect(privateImage.headers()["cache-control"]).toBe("private, no-store");
    await page.request.post("/api/auth/logout");
    const anonymousPrivateImage = await page.request.get(ownerCourseJson.gallery[0]!.url);
    expect(anonymousPrivateImage.status()).not.toBe(200);
    await db.update(coursesTable).set({ published: true }).where(eq(coursesTable.id, fixture.courseId));
    const anonymousImage = await page.request.get(ownerCourseJson.gallery[0]!.url);
    expect(anonymousImage).toBeOK();
    expect(anonymousImage.headers()["content-type"]).toContain("image/png");

    const ownerRelogin = await page.request.post("/api/auth/login", {
      data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
    });
    expect(ownerRelogin).toBeOK();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByLabel("Ukloni fotografiju").first().click();
    await expect(page.getByText("Fotografija 1", { exact: true })).toBeVisible({ timeout: 15_000 });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByLabel("Ukloni fotografiju").first().click();
    await expect(page.getByText(/Galerija je prazna/)).toBeVisible({ timeout: 15_000 });

    await page.request.post("/api/auth/logout");
    const outsiderLogin = await page.request.post("/api/auth/login", {
      data: { email: fixture.outsiderEmail, password: fixture.outsiderPassword },
    });
    expect(outsiderLogin).toBeOK();
    const forbidden = await page.request.post(`/api/education/courses/${fixture.courseId}/gallery/upload-url`, {
      data: { name: "forbidden.png", size: tinyPng.length, contentType: "image/png" },
    });
    expect(forbidden.status()).toBe(403);
  } finally {
    await cleanUpGalleryFixture(fixture);
  }
});


test("education gallery accepts the exact 8 MB limit and rejects invalid bytes before attachment", async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = await createGalleryFixture();
  try {
    const ownerLogin = await page.request.post("/api/auth/login", {
      data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
    });
    expect(ownerLogin).toBeOK();

    const uploadTicketResponse = await page.request.post(`/api/education/courses/${fixture.courseId}/gallery/upload-url`, {
      data: {
        name: "course-gallery-maximum.png",
        size: maxGalleryImageBytes,
        contentType: "image/png",
      },
    });
    expect(uploadTicketResponse).toBeOK();
    const uploadTicket = await uploadTicketResponse.json() as { uploadUrl: string; mediaId: string };
    const maximumUpload = await page.request.put(uploadTicket.uploadUrl, {
      headers: { "Content-Type": "image/png" },
      data: paddedPng(maxGalleryImageBytes),
    });
    expect(maximumUpload).toBeOK();
    const attachedMaximum = await page.request.post(`/api/education/courses/${fixture.courseId}/gallery`, {
      data: { mediaId: uploadTicket.mediaId, altText: "" },
    });
    expect(attachedMaximum.status()).toBe(201);
    const attachedMaximumJson = await attachedMaximum.json() as { id: string };

    const malformedTicketResponse = await page.request.post(`/api/education/courses/${fixture.courseId}/gallery/upload-url`, {
      data: {
        name: "course-gallery-malformed.png",
        size: tinyPng.length,
        contentType: "image/png",
      },
    });
    expect(malformedTicketResponse).toBeOK();
    const malformedTicket = await malformedTicketResponse.json() as { uploadUrl: string; mediaId: string };
    const malformedUpload = await page.request.put(malformedTicket.uploadUrl, {
      headers: { "Content-Type": "image/png" },
      data: Buffer.from("not a PNG"),
    });
    expect(malformedUpload).toBeOK();
    const malformedAttach = await page.request.post(`/api/education/courses/${fixture.courseId}/gallery`, {
      data: { mediaId: malformedTicket.mediaId },
    });
    expect(malformedAttach.status()).toBe(400);
    expect(await malformedAttach.json()).toEqual({ error: "Otpremljeni fajl nije ispravna slika ili ne odgovara odabranoj datoteci." });

    const oversizedTicket = await page.request.post(`/api/education/courses/${fixture.courseId}/gallery/upload-url`, {
      data: {
        name: "course-gallery-oversized.png",
        size: maxGalleryImageBytes + 1,
        contentType: "image/png",
      },
    });
    expect(oversizedTicket.status()).toBe(413);
    expect(await oversizedTicket.json()).toEqual({ error: "Fotografija ne može biti veća od 8 MB." });

    const courseResponse = await page.request.get(`/api/education/courses/${fixture.courseId}`);
    expect(courseResponse).toBeOK();
    const courseJson = await courseResponse.json() as { gallery: Array<{ id: string }> };
    expect(courseJson.gallery.map((media) => media.id)).toEqual([attachedMaximumJson.id]);
    const uploadRows = await db.select().from(educationMediaUploadsTable).where(eq(educationMediaUploadsTable.courseId, fixture.courseId));
    expect(uploadRows).toHaveLength(2);
    expect(uploadRows.find((upload) => upload.id === uploadTicket.mediaId)?.attachedAt).not.toBeNull();
    expect(uploadRows.find((upload) => upload.id === malformedTicket.mediaId)?.attachedAt).toBeNull();

    const removedMaximum = await page.request.delete(`/api/education/courses/${fixture.courseId}/gallery/${attachedMaximumJson.id}`);
    expect(removedMaximum).toBeOK();
    const [expiredMalformedUpload] = await db.update(educationMediaUploadsTable)
      .set({ expiresAt: new Date(0) })
      .where(eq(educationMediaUploadsTable.id, malformedTicket.mediaId))
      .returning();
    expect(expiredMalformedUpload).toBeDefined();
    await expect(cleanupEducationMediaUpload(expiredMalformedUpload!, new Date())).resolves.toBe("deleted");
  } finally {
    await cleanUpGalleryFixture(fixture);
  }
});

test("education gallery cleanup keeps an upload ticket when storage deletion fails", async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = await createGalleryFixture();
  let stagingPath: string | undefined;
  try {
    const ownerLogin = await page.request.post("/api/auth/login", {
      data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
    });
    expect(ownerLogin).toBeOK();

    const ticket = await uploadGalleryImage(page.request, fixture, "delete-rollback-retry.png");
    const [expiredUpload] = await db.update(educationMediaUploadsTable)
      .set({ expiresAt: new Date(0) })
      .where(eq(educationMediaUploadsTable.id, ticket.mediaId))
      .returning();
    expect(expiredUpload).toBeDefined();
    stagingPath = expiredUpload!.objectPath;

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input, init) => {
        if (init?.method === "DELETE") return new Response(null, { status: 503 });
        return originalFetch(input, init);
      };
      await expect(cleanupEducationMediaUpload(expiredUpload!, new Date()))
        .rejects.toThrow("App Storage nije obrisao objekat (503).");
    } finally {
      globalThis.fetch = originalFetch;
    }

    const retainedTickets = await db.select().from(educationMediaUploadsTable)
      .where(eq(educationMediaUploadsTable.id, ticket.mediaId));
    expect(retainedTickets).toHaveLength(1);
    expect(await storageObjectStatus(expiredUpload!.objectPath)).toBe(200);

    await expect(cleanupEducationMediaUpload(expiredUpload!, new Date())).resolves.toBe("deleted");
    const removedTickets = await db.select().from(educationMediaUploadsTable)
      .where(eq(educationMediaUploadsTable.id, ticket.mediaId));
    expect(removedTickets).toHaveLength(0);
    expect(await storageObjectStatus(expiredUpload!.objectPath)).toBe(404);
    stagingPath = undefined;
  } finally {
    if (stagingPath) await deleteStorageObject(stagingPath);
    await cleanUpGalleryFixture(fixture);
  }
});

test("education gallery deletion retries safely after storage succeeds and the database rolls back", async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = await createGalleryFixture();
  let mediaId: string | undefined;
  let finalPath: string | undefined;
  let rollbackFaultInstalled = false;
  try {
    const ownerLogin = await page.request.post("/api/auth/login", {
      data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
    });
    expect(ownerLogin).toBeOK();

    const ticket = await uploadGalleryImage(page.request, fixture, "delete-rollback-retry.png");
    const attached = await page.request.post(`/api/education/courses/${fixture.courseId}/gallery`, {
      data: { mediaId: ticket.mediaId },
    });
    expect(attached.status()).toBe(201);
    mediaId = ticket.mediaId;
    const [storedMedia] = await db.select().from(educationMediaTable)
      .where(eq(educationMediaTable.id, mediaId));
    expect(storedMedia).toBeDefined();
    finalPath = storedMedia!.objectPath;

    await installGalleryDeleteRollbackFault(mediaId);
    rollbackFaultInstalled = true;
    const rolledBackDelete = await page.request.delete(`/api/education/courses/${fixture.courseId}/gallery/${mediaId}`);
    expect(rolledBackDelete.status()).toBe(500);

    const retainedMedia = await db.select().from(educationMediaTable)
      .where(eq(educationMediaTable.id, mediaId));
    expect(retainedMedia).toHaveLength(1);
    expect(await storageObjectStatus(finalPath)).toBe(404);

    await removeGalleryDeleteRollbackFault(mediaId);
    rollbackFaultInstalled = false;
    const retriedDelete = await page.request.delete(`/api/education/courses/${fixture.courseId}/gallery/${mediaId}`);
    expect(retriedDelete.status()).toBe(204);
    const removedMedia = await db.select().from(educationMediaTable)
      .where(eq(educationMediaTable.id, mediaId));
    expect(removedMedia).toHaveLength(0);

    const [upload] = await db.select().from(educationMediaUploadsTable)
      .where(eq(educationMediaUploadsTable.id, mediaId));
    expect(upload).toBeDefined();
    await expect(cleanupEducationMediaUpload(upload!, new Date())).resolves.toBe("deleted");
    finalPath = undefined;
  } finally {
    if (rollbackFaultInstalled && mediaId) await removeGalleryDeleteRollbackFault(mediaId);
    if (finalPath) await deleteStorageObject(finalPath);
    await cleanUpGalleryFixture(fixture);
  }
});

test("concurrent gallery attach, cleanup, and deletion preserve a referenced final object", async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = await createGalleryFixture();
  let releaseGalleryLock: (() => void) | undefined;
  let galleryLockHolder: Promise<void> | undefined;
  const storagePaths = new Set<string>();
  try {
    const ownerLogin = await page.request.post("/api/auth/login", {
      data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
    });
    expect(ownerLogin).toBeOK();

    const referencedTicket = await uploadGalleryImage(page.request, fixture, "referenced-race.png");
    const referencedAttach = await page.request.post(`/api/education/courses/${fixture.courseId}/gallery`, {
      data: { mediaId: referencedTicket.mediaId },
    });
    expect(referencedAttach.status()).toBe(201);
    const [referencedMedia] = await db.select().from(educationMediaTable)
      .where(eq(educationMediaTable.id, referencedTicket.mediaId));
    const [referencedUpload] = await db.select().from(educationMediaUploadsTable)
      .where(eq(educationMediaUploadsTable.id, referencedTicket.mediaId));
    expect(referencedMedia).toBeDefined();
    expect(referencedUpload).toBeDefined();
    storagePaths.add(referencedMedia!.objectPath);
    storagePaths.add(referencedUpload!.objectPath);

    const [duplicateReference] = await db.insert(educationMediaTable).values({
      courseId: fixture.courseId,
      centerId: fixture.centerId,
      objectPath: referencedMedia!.objectPath,
      altText: "Concurrent reference",
      sortOrder: 1,
    }).returning();
    expect(duplicateReference).toBeDefined();

    const attachingTicket = await uploadGalleryImage(page.request, fixture, "attaching-race.png");
    const [attachingUpload] = await db.select().from(educationMediaUploadsTable)
      .where(eq(educationMediaUploadsTable.id, attachingTicket.mediaId));
    expect(attachingUpload).toBeDefined();
    const attachingFinalPath = `/objects/education-gallery/${fixture.centerId}/${fixture.courseId}/${attachingTicket.mediaId}`;
    storagePaths.add(attachingUpload!.objectPath);
    storagePaths.add(attachingFinalPath);

    let galleryLockAcquired!: () => void;
    const galleryLockAcquiredPromise = new Promise<void>((resolve) => {
      galleryLockAcquired = resolve;
    });
    const galleryLockReleasedPromise = new Promise<void>((resolve) => {
      releaseGalleryLock = resolve;
    });
    galleryLockHolder = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`education-course-gallery:${fixture.courseId}`}))`);
      galleryLockAcquired();
      await galleryLockReleasedPromise;
    });
    await galleryLockAcquiredPromise;

    const attachPromise = page.request.post(`/api/education/courses/${fixture.courseId}/gallery`, {
      data: { mediaId: attachingTicket.mediaId },
    });
    await waitForGalleryLockWaiters(fixture.courseId, 1);

    // Cleanup selected this ticket as expired immediately before attachment.
    // Once it gets the lock, it must re-read the ticket and preserve the final
    // object that attachment committed while cleanup was waiting.
    const cleanupPromise = cleanupEducationMediaUpload(
      attachingUpload!,
      new Date(attachingUpload!.expiresAt.getTime() + 1),
    );
    await waitForGalleryLockWaiters(fixture.courseId, 2);

    const deletePromise = page.request.delete(
      `/api/education/courses/${fixture.courseId}/gallery/${referencedTicket.mediaId}`,
    );
    await waitForGalleryLockWaiters(fixture.courseId, 3);

    if (!releaseGalleryLock) throw new Error("Gallery lock was never armed, so the waiters could not be released.");
    releaseGalleryLock();
    releaseGalleryLock = undefined;

    const [attachResult, cleanupResult, deleteResult] = await Promise.all([
      attachPromise,
      cleanupPromise,
      deletePromise,
    ]);
    await galleryLockHolder;
    galleryLockHolder = undefined;
    expect(attachResult.status()).toBe(201);
    expect(cleanupResult).toBe("deleted");
    expect(deleteResult.status()).toBe(204);

    const attachingTickets = await db.select().from(educationMediaUploadsTable)
      .where(eq(educationMediaUploadsTable.id, attachingTicket.mediaId));
    expect(attachingTickets).toHaveLength(0);
    const [attachedMedia] = await db.select().from(educationMediaTable)
      .where(eq(educationMediaTable.id, attachingTicket.mediaId));
    expect(attachedMedia?.objectPath).toBe(attachingFinalPath);
    expect(await storageObjectStatus(attachingFinalPath)).toBe(200);
    const attachedImage = await page.request.get(`/api/education/media/${attachingTicket.mediaId}`);
    expect(attachedImage).toBeOK();

    const referencedRows = await db.select().from(educationMediaTable)
      .where(eq(educationMediaTable.id, referencedTicket.mediaId));
    expect(referencedRows).toHaveLength(0);
    const [remainingReference] = await db.select().from(educationMediaTable)
      .where(eq(educationMediaTable.id, duplicateReference!.id));
    expect(remainingReference?.objectPath).toBe(referencedMedia!.objectPath);
    expect(await storageObjectStatus(referencedMedia!.objectPath)).toBe(200);
    const referencedImage = await page.request.get(`/api/education/media/${duplicateReference!.id}`);
    expect(referencedImage).toBeOK();
  } finally {
    releaseGalleryLock?.();
    if (galleryLockHolder) await galleryLockHolder;
    for (const storagePath of storagePaths) await deleteStorageObject(storagePath);
    await cleanUpGalleryFixture(fixture);
  }
});

test("repeated gallery cleanup failures alert admins without exposing ticket details", async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = await createGalleryFixture();
  const syntheticAlertWindow = 40_000_000 + Number.parseInt(randomUUID().slice(0, 8), 16) % 1_000_000;
  const syntheticAlertTime = new Date(syntheticAlertWindow * 60 * 60_000);
  const cleanupAlerts: Array<{
    failedTickets: number;
    failureAttempts: number;
    repeatedFailureTickets: number;
  }> = [];
  const cleanupOptions = {
    notify: async (alert: typeof cleanupAlerts[number]) => {
      cleanupAlerts.push(alert);
    },
  };
  try {
    const ownerLogin = await page.request.post("/api/auth/login", {
      data: { email: fixture.ownerEmail, password: fixture.ownerPassword },
    });
    expect(ownerLogin).toBeOK();

    const uploadTicketResponse = await page.request.post(`/api/education/courses/${fixture.courseId}/gallery/upload-url`, {
      data: {
        name: "cleanup-alert.png",
        size: tinyPng.length,
        contentType: "image/png",
      },
    });
    expect(uploadTicketResponse).toBeOK();
    const uploadTicket = await uploadTicketResponse.json() as { mediaId: string };
    const malformedStoragePath = `/objects/invalid-cleanup-${randomUUID()}`;
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await db.update(educationMediaUploadsTable)
      .set({
        objectPath: malformedStoragePath,
        expiresAt: new Date(0),
        createdAt: twoHoursAgo,
      })
      .where(eq(educationMediaUploadsTable.id, uploadTicket.mediaId));

    await runEducationGalleryCleanup(cleanupOptions);
    await runEducationGalleryCleanup(cleanupOptions);
    await runEducationGalleryCleanup(cleanupOptions);

    const [failedTicket] = await db.select({
      cleanupFailureCount: educationMediaUploadsTable.cleanupFailureCount,
      lastCleanupFailureAt: educationMediaUploadsTable.lastCleanupFailureAt,
    })
      .from(educationMediaUploadsTable)
      .where(eq(educationMediaUploadsTable.id, uploadTicket.mediaId));
    expect(failedTicket?.cleanupFailureCount).toBeGreaterThanOrEqual(3);
    expect(failedTicket?.lastCleanupFailureAt).not.toBeNull();
    expect(cleanupAlerts).toHaveLength(1);
    expect(cleanupAlerts[0]!.failedTickets).toBeGreaterThanOrEqual(1);
    expect(cleanupAlerts[0]!.failureAttempts).toBeGreaterThanOrEqual(3);
    expect(cleanupAlerts[0]!.repeatedFailureTickets).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(cleanupAlerts[0])).not.toContain(malformedStoragePath);
    expect(JSON.stringify(cleanupAlerts[0])).not.toContain(uploadTicket.mediaId);

    let transportCalls = 0;
    const attemptedEmails: Parameters<TransactionalEmailTransport["send"]>[0][] = [];
    const transport: TransactionalEmailTransport = {
      async send(input) {
        transportCalls += 1;
        attemptedEmails.push(input);
        if (transportCalls === 1) throw new TypeError("simulated network failure");
        return { messageId: `gallery-alert-${transportCalls}` };
      },
    };
    const firstDelivery = await sendEducationGalleryCleanupAlert(cleanupAlerts[0]!, syntheticAlertTime, transport);
    expect(firstDelivery.recipientCount).toBeGreaterThanOrEqual(1);
    expect(firstDelivery.failedDeliveryCount).toBe(1);
    expect(transportCalls).toBe(firstDelivery.recipientCount);

    const firstWindowDeliveries = await db.select({
      errorMessage: emailDeliveriesTable.errorMessage,
      eventKey: emailDeliveriesTable.eventKey,
    }).from(emailDeliveriesTable).where(
      like(emailDeliveriesTable.eventKey, `education-gallery-cleanup-alert:${syntheticAlertWindow}:%`),
    );
    expect(firstWindowDeliveries).toHaveLength(firstDelivery.recipientCount);
    const persistedDeliveryDiagnostics = JSON.stringify(firstWindowDeliveries);
    expect(persistedDeliveryDiagnostics).toContain("TypeError");
    expect(persistedDeliveryDiagnostics).not.toContain("simulated network failure");
    expect(persistedDeliveryDiagnostics).not.toContain(fixture.adminEmail);
    expect(persistedDeliveryDiagnostics).not.toContain(malformedStoragePath);
    expect(persistedDeliveryDiagnostics).not.toContain(uploadTicket.mediaId);

    const initiallyAlertedEmails = new Set(attemptedEmails.map((delivery) => delivery.to.email));
    const callsBeforeDuplicate = transportCalls;
    const duplicateDelivery = await sendEducationGalleryCleanupAlert(cleanupAlerts[0]!, syntheticAlertTime, transport);
    const duplicateRecipients = attemptedEmails.slice(callsBeforeDuplicate).map((delivery) => delivery.to.email);
    expect(
      duplicateRecipients.some((email) => initiallyAlertedEmails.has(email)),
      "An admin already alerted in this window must not receive a duplicate email.",
    ).toBe(false);

    const callsBeforeNextWindow = transportCalls;
    const nextWindowDelivery = await sendEducationGalleryCleanupAlert(
      cleanupAlerts[0]!,
      new Date(syntheticAlertTime.getTime() + 60 * 60_000),
      transport,
    );
    expect(transportCalls - callsBeforeNextWindow).toBe(nextWindowDelivery.recipientCount);
    for (const email of attemptedEmails) {
      expect(email.htmlContent).toContain("neuspešnih pokušaja");
      expect(email.htmlContent).toContain("App Storage");
      expect(email.htmlContent).not.toContain(malformedStoragePath);
      expect(email.htmlContent).not.toContain(uploadTicket.mediaId);
    }

    const forbiddenSummary = await page.request.get("/api/admin/summary");
    expect(forbiddenSummary.status()).toBe(403);

    await page.request.post("/api/auth/logout");
    const adminLogin = await page.request.post("/api/auth/login", {
      data: { email: fixture.adminEmail, password: fixture.adminPassword },
    });
    expect(adminLogin).toBeOK();

    const adminSummaryResponse = await page.request.get("/api/admin/summary");
    expect(adminSummaryResponse).toBeOK();
    const adminSummary = await adminSummaryResponse.json() as {
      galleryCleanupFailedTickets: number;
      galleryCleanupFailureAttempts: number;
      galleryCleanupOldestEligibleTicketAgeMinutes: number | null;
      galleryCleanupHasRepeatedFailures: boolean;
    };
    expect(adminSummary.galleryCleanupFailedTickets).toBeGreaterThanOrEqual(1);
    expect(adminSummary.galleryCleanupFailureAttempts).toBeGreaterThanOrEqual(3);
    expect(adminSummary.galleryCleanupOldestEligibleTicketAgeMinutes).toBeGreaterThanOrEqual(119);
    expect(adminSummary.galleryCleanupHasRepeatedFailures).toBe(true);
    expect(JSON.stringify(adminSummary)).not.toContain(malformedStoragePath);
    expect(JSON.stringify(adminSummary)).not.toContain(uploadTicket.mediaId);
    expect(adminSummary).not.toHaveProperty("objectPath");
    expect(adminSummary).not.toHaveProperty("tickets");

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Pregled Platforme" })).toBeVisible();
    await expect(page.getByTestId("gallery-cleanup-alert")).toContainText("Potrebna je intervencija.");
    await expect(page.getByTestId("gallery-cleanup-failed-tickets")).not.toHaveText("0");
    await expect(page.getByTestId("gallery-cleanup-failure-attempts")).not.toHaveText("0");
    await expect(page.getByTestId("gallery-cleanup-oldest-ticket-age")).not.toHaveText("Nema");
  } finally {
    await db.delete(emailDeliveriesTable).where(or(
      like(emailDeliveriesTable.eventKey, `education-gallery-cleanup-alert:${syntheticAlertWindow}:%`),
      like(emailDeliveriesTable.eventKey, `education-gallery-cleanup-alert:${syntheticAlertWindow + 1}:%`),
    ));
    await cleanUpGalleryFixture(fixture);
  }
});
