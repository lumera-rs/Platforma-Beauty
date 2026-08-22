import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  db,
  coursesTable,
  educationCentersTable,
  educationCenterSubscriptionsTable,
  educationMediaTable,
  subscriptionPlansTable,
  usersTable,
} from "@workspace/db";
import { hashPassword } from "../../artifacts/api-server/src/lib/auth";
import { eq, inArray } from "drizzle-orm";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLq7wAAAABJRU5ErkJggg==",
  "base64",
);

type GalleryFixture = {
  ownerEmail: string;
  ownerPassword: string;
  outsiderEmail: string;
  outsiderPassword: string;
  ownerId: string;
  outsiderId: string;
  centerId: string;
  courseId: string;
  planId: string;
};

async function createGalleryFixture(): Promise<GalleryFixture> {
  const suffix = randomUUID();
  const ownerPassword = "gallery-owner-password";
  const outsiderPassword = "gallery-outsider-password";
  let ownerId: string | undefined;
  let outsiderId: string | undefined;
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
      role: "EDUCATION_CENTER_OWNER",
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
    const [course] = await db.insert(coursesTable).values({
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
    }).returning();
    if (!course) throw new Error("Could not create gallery course fixture.");
    courseId = course.id;
    return {
      ownerEmail: owner.email,
      ownerPassword,
      outsiderEmail: outsider.email,
      outsiderPassword,
      ownerId,
      outsiderId,
      centerId,
      courseId,
      planId,
    };
  } catch (error) {
    if (courseId) await db.delete(coursesTable).where(eq(coursesTable.id, courseId));
    if (centerId) await db.delete(educationCentersTable).where(eq(educationCentersTable.id, centerId));
    if (planId) await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId));
    if (outsiderId) await db.delete(usersTable).where(eq(usersTable.id, outsiderId));
    if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    throw error;
  }
}

async function cleanUpGalleryFixture(fixture: GalleryFixture) {
  await db.delete(coursesTable).where(eq(coursesTable.id, fixture.courseId));
  await db.delete(educationCentersTable).where(eq(educationCentersTable.id, fixture.centerId));
  await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, fixture.planId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.outsiderId));
  await db.delete(usersTable).where(eq(usersTable.id, fixture.ownerId));
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
    const firstUploadTicketResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && response.url().includes(`/api/education/courses/${fixture.courseId}/gallery/upload-url`),
    );
    await picker.setInputFiles({ name: "course-gallery.png", mimeType: "image/png", buffer: tinyPng });
    await expect(page.getByText("Fotografija 1", { exact: true })).toBeVisible({ timeout: 30_000 });
    const firstUploadTicket = await (await firstUploadTicketResponse).json() as { uploadUrl: string; mediaId: string };
    await picker.setInputFiles({ name: "course-gallery-second.png", mimeType: "image/png", buffer: tinyPng });
    await expect(page.getByText("Fotografija 2", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel(/Opis slike/).first()).toBeVisible();

    const ownerCourse = await page.request.get(`/api/education/courses/${fixture.courseId}`);
    expect(ownerCourse).toBeOK();
    const ownerCourseJson = await ownerCourse.json() as { gallery: Array<{ url: string; altText: string }> };
    expect(ownerCourseJson.gallery).toHaveLength(2);
    expect(ownerCourseJson.gallery[0]?.url).toMatch(/^\/api\/education\/media\//);
    expect(JSON.stringify(ownerCourseJson)).not.toContain("objectPath");
    const storedMedia = await db.select().from(educationMediaTable).where(eq(educationMediaTable.id, ownerCourseJson.gallery[0]!.id)).limit(1);
    expect(storedMedia[0]?.objectPath).toMatch(/^\/objects\/education-gallery\//);
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
      data: { mediaId: firstUploadTicket.mediaId },
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