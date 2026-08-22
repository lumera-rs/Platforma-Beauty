import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import {
  db,
  employeesTable,
  imageAssetsTable,
  productCategoriesTable,
  salonsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword, sessionCookieName } from "./auth";
import { deletePrivateObject } from "./image-storage";
import { attachReadyImageAssets } from "../routes/media";

const password = "image-pipeline-test-password";
const email = `image-pipeline-${randomUUID()}@example.test`;

type Server = ReturnType<typeof app.listen>;

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function stopServer(server: Server): Promise<void> {
  server.close();
  await once(server, "close");
}

async function login(baseUrl: string, loginEmail = email): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: loginEmail, password }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith(`${sessionCookieName}=`));
  if (!cookie) throw new Error("Login did not return a session cookie.");
  return cookie;
}

async function run(): Promise<void> {
  if (!process.env.PRIVATE_OBJECT_DIR || !process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) {
    throw new Error("App Storage environment is required for the image pipeline integration test.");
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(usersTable).values({
    firstName: "Image",
    lastName: "Pipeline",
    email,
    passwordHash,
    passwordSetAt: new Date(),
    role: "CUSTOMER",
  }).returning();
  const ownerEmail = `image-pipeline-owner-${randomUUID()}@example.test`;
  const [owner] = await db.insert(usersTable).values({
    firstName: "Image",
    lastName: "Owner",
    email: ownerEmail,
    passwordHash,
    passwordSetAt: new Date(),
    role: "SALON_OWNER",
  }).returning();
  const originalSalonImageUrl = "/lumera-media/salon-4.jpg";
  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner!.id,
    name: "Image Pipeline Test Salon",
    slug: `image-pipeline-test-${randomUUID()}`,
    city: "Beograd",
    municipality: "Zemun",
    address: "Test adresa 1",
    phone: "+381600000000",
    email: ownerEmail,
    shortDescription: "Test salon",
    description: "Test salon za proveru atomskog priključivanja slike.",
    imageUrl: originalSalonImageUrl,
  }).returning();
  const adminEmail = `image-pipeline-admin-${randomUUID()}@example.test`;
  const [admin] = await db.insert(usersTable).values({
    firstName: "Image",
    lastName: "Admin",
    email: adminEmail,
    passwordHash,
    passwordSetAt: new Date(),
    role: "ADMIN",
  }).returning();
  const employeeEmail = `image-pipeline-employee-${randomUUID()}@example.test`;
  const [employeeUser] = await db.insert(usersTable).values({
    firstName: "Image",
    lastName: "Employee",
    email: employeeEmail,
    passwordHash,
    passwordSetAt: new Date(),
    role: "SALON_EMPLOYEE",
  }).returning();
  const originalEmployeeAvatarUrl = "/lumera-media/employee-1.jpg";
  const [employee] = await db.insert(employeesTable).values({
    salonId: salon!.id,
    userId: employeeUser!.id,
    name: "Image Employee",
    role: "Stilista",
    bio: "Test employee",
    avatarUrl: originalEmployeeAvatarUrl,
    email: employeeEmail,
  }).returning();

  let assetId: string | undefined;
  const additionalAssetIds: string[] = [];
  let productCategoryId: string | undefined;
  let server: Server | undefined;

  try {
    const first = await startServer();
    server = first.server;

    const unauthenticated = await fetch(`${first.baseUrl}/api/media/uploads/request-url`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "test.png", size: 100, contentType: "image/png" }),
    });
    assert.equal(unauthenticated.status, 401);

    const cookie = await login(first.baseUrl);
    const original = await sharp({
      create: {
        width: 2400,
        height: 1600,
        channels: 4,
        background: { r: 126, g: 68, b: 92, alpha: 1 },
      },
    }).png().toBuffer();
    const uploadManagedImage = async (uploadCookie: string, name: string) => {
      const uploadRequest = await fetch(`${first.baseUrl}/api/media/uploads/request-url`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: uploadCookie },
        body: JSON.stringify({ name, size: original.length, contentType: "image/png" }),
      });
      assert.equal(uploadRequest.status, 200);
      const uploadIntent = await uploadRequest.json() as { assetId: string; uploadUrl: string; finalizeUrl: string };
      additionalAssetIds.push(uploadIntent.assetId);
      const directUpload = await fetch(uploadIntent.uploadUrl, {
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: original,
      });
      assert.ok(directUpload.ok, `Direct App Storage upload failed with ${directUpload.status}.`);
      const finalizedResponse = await fetch(`${first.baseUrl}${uploadIntent.finalizeUrl}`, {
        method: "POST",
        headers: { cookie: uploadCookie },
      });
      assert.equal(finalizedResponse.status, 200);
      return await finalizedResponse.json() as { assetId: string; imageUrl: string; width: number; height: number };
    };

    const request = await fetch(`${first.baseUrl}/api/media/uploads/request-url`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "responsive-source.png", size: original.length, contentType: "image/png" }),
    });
    assert.equal(request.status, 200);
    const intent = await request.json() as { assetId: string; uploadUrl: string; finalizeUrl: string };
    assetId = intent.assetId;

    const upload = await fetch(intent.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: original,
    });
    assert.ok(upload.ok, `Direct App Storage upload failed with ${upload.status}.`);

    const finalize = await fetch(`${first.baseUrl}${intent.finalizeUrl}`, {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(finalize.status, 200);
    const finalized = await finalize.json() as { imageUrl: string; width: number; height: number };
    assert.equal(finalized.imageUrl, `/api/media/images/${assetId}`);
    assert.equal(finalized.width, 2400);
    assert.equal(finalized.height, 1600);

    const ownerCookie = await login(first.baseUrl, ownerEmail);
    const foreignAssetSave = await fetch(`${first.baseUrl}/api/salon/profile`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ imageUrl: finalized.imageUrl }),
    });
    assert.equal(foreignAssetSave.status, 500);
    const [salonAfterRejectedSave] = await db.select({ imageUrl: salonsTable.imageUrl })
      .from(salonsTable)
      .where(eq(salonsTable.id, salon!.id))
      .limit(1);
    assert.equal(salonAfterRejectedSave?.imageUrl, originalSalonImageUrl);

    const hiddenFromOtherCallers = await fetch(`${first.baseUrl}${finalized.imageUrl}?size=thumbnail&format=webp`);
    assert.equal(hiddenFromOtherCallers.status, 404);
    assert.equal(hiddenFromOtherCallers.headers.get("cache-control"), "private, no-store");

    const thumbnail = await fetch(`${first.baseUrl}${finalized.imageUrl}?size=thumbnail&format=webp`, {
      headers: { cookie },
    });
    assert.equal(thumbnail.status, 200);
    assert.equal(thumbnail.headers.get("content-type"), "image/webp");
    assert.equal(thumbnail.headers.get("cache-control"), "private, no-store");
    assert.ok(thumbnail.headers.get("etag"));
    assert.equal(thumbnail.headers.get("vary"), "Accept, Cookie");
    const thumbnailMetadata = await sharp(Buffer.from(await thumbnail.arrayBuffer())).metadata();
    assert.equal(thumbnailMetadata.format, "webp");
    assert.equal(thumbnailMetadata.width, 320);
    assert.equal(thumbnailMetadata.height, 213);

    const acceptedAvif = await fetch(`${first.baseUrl}${finalized.imageUrl}?size=medium`, {
      headers: { accept: "image/avif,image/webp,image/*", cookie },
    });
    assert.equal(acceptedAvif.status, 200);
    assert.equal(acceptedAvif.headers.get("content-type"), "image/avif");
    const avifMetadata = await sharp(Buffer.from(await acceptedAvif.arrayBuffer())).metadata();
    assert.equal(avifMetadata.format, "heif");
    assert.equal(avifMetadata.width, 960);

    await db.transaction((tx) => attachReadyImageAssets(tx, user!.id, finalized.imageUrl));
    const [attached] = await db.select({ expiresAt: imageAssetsTable.expiresAt })
      .from(imageAssetsTable)
      .where(eq(imageAssetsTable.id, assetId))
      .limit(1);
    assert.equal(attached?.expiresAt.getUTCFullYear(), 9999);

    const adminCookie = await login(first.baseUrl, adminEmail);
    const adminImage = await uploadManagedImage(adminCookie, "admin-category.png");
    const categoryName = `Image Pipeline Category ${randomUUID()}`;
    const createCategory = await fetch(`${first.baseUrl}/api/admin/product-categories`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ name: categoryName, imageUrl: adminImage.imageUrl }),
    });
    assert.equal(createCategory.status, 201);
    const createdCategory = await createCategory.json() as { id: string; imageUrl: string | null };
    productCategoryId = createdCategory.id;
    assert.equal(createdCategory.imageUrl, adminImage.imageUrl);
    const publicCategoryImage = await fetch(`${first.baseUrl}${adminImage.imageUrl}?size=thumbnail&format=webp`);
    assert.equal(publicCategoryImage.status, 200);
    assert.equal(publicCategoryImage.headers.get("cache-control"), "public, max-age=31536000, immutable");

    const rejectedCategoryUpdate = await fetch(`${first.baseUrl}/api/admin/product-categories/${createdCategory.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ imageUrl: finalized.imageUrl }),
    });
    assert.equal(rejectedCategoryUpdate.status, 500);
    const [categoryAfterRejectedUpdate] = await db.select({ imageUrl: productCategoriesTable.imageUrl })
      .from(productCategoriesTable)
      .where(eq(productCategoriesTable.id, createdCategory.id))
      .limit(1);
    assert.equal(categoryAfterRejectedUpdate?.imageUrl, adminImage.imageUrl);

    const employeeCookie = await login(first.baseUrl, employeeEmail);
    const employeeImage = await uploadManagedImage(employeeCookie, "employee-avatar.png");
    const updateEmployeeProfile = await fetch(`${first.baseUrl}/api/employee/profile`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: employeeCookie },
      body: JSON.stringify({ avatarUrl: employeeImage.imageUrl }),
    });
    assert.equal(updateEmployeeProfile.status, 200);
    const publicEmployeeImage = await fetch(`${first.baseUrl}${employeeImage.imageUrl}?size=thumbnail&format=webp`);
    assert.equal(publicEmployeeImage.status, 200);
    assert.equal(publicEmployeeImage.headers.get("cache-control"), "public, max-age=31536000, immutable");

    const rejectedEmployeeUpdate = await fetch(`${first.baseUrl}/api/employee/profile`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: employeeCookie },
      body: JSON.stringify({ avatarUrl: finalized.imageUrl }),
    });
    assert.equal(rejectedEmployeeUpdate.status, 500);
    const [employeeAfterRejectedUpdate] = await db.select({ avatarUrl: employeesTable.avatarUrl })
      .from(employeesTable)
      .where(eq(employeesTable.id, employee!.id))
      .limit(1);
    assert.equal(employeeAfterRejectedUpdate?.avatarUrl, employeeImage.imageUrl);

    const mediumWebp = await fetch(`${first.baseUrl}${finalized.imageUrl}?size=medium&format=webp`);
    assert.equal(mediumWebp.status, 200);
    const mediumWebpEtag = mediumWebp.headers.get("etag");
    assert.ok(mediumWebpEtag);
    const unchangedMediumWebp = await fetch(`${first.baseUrl}${finalized.imageUrl}?size=medium&format=webp`, {
      headers: { "if-none-match": mediumWebpEtag! },
    });
    assert.equal(unchangedMediumWebp.status, 304);
    const [storedAsset] = await db.select().from(imageAssetsTable).where(eq(imageAssetsTable.id, assetId)).limit(1);
    const mediumWebpPath = storedAsset?.variants?.medium.webp.objectPath;
    assert.ok(mediumWebpPath);
    await deletePrivateObject(mediumWebpPath);
    const missingDuringRevalidation = await fetch(`${first.baseUrl}${finalized.imageUrl}?size=medium&format=webp`, {
      headers: { "if-none-match": mediumWebpEtag! },
    });
    assert.equal(missingDuringRevalidation.status, 503);
    assert.equal(missingDuringRevalidation.headers.get("cache-control"), "private, no-store");

    await stopServer(server);
    server = undefined;

    const restarted = await startServer();
    server = restarted.server;
    const afterRestart = await fetch(`${restarted.baseUrl}${finalized.imageUrl}?size=large&format=fallback`);
    assert.equal(afterRestart.status, 200);
    assert.equal(afterRestart.headers.get("cache-control"), "public, max-age=31536000, immutable");
    const restartedMetadata = await sharp(Buffer.from(await afterRestart.arrayBuffer())).metadata();
    assert.equal(restartedMetadata.width, 1920);
    assert.equal(restartedMetadata.height, 1280);
  } finally {
    if (server) await stopServer(server);
    for (const cleanupAssetId of [assetId, ...additionalAssetIds].filter((id): id is string => Boolean(id))) {
      const [asset] = await db.select().from(imageAssetsTable).where(eq(imageAssetsTable.id, cleanupAssetId)).limit(1);
      const objectPaths = asset
        ? [
            asset.stagingObjectPath,
            asset.originalObjectPath,
            ...Object.values(asset.variants ?? {}).flatMap((set) => Object.values(set).map((variant) => variant.objectPath)),
          ].filter((path): path is string => Boolean(path))
        : [];
      await Promise.allSettled(objectPaths.map((path) => deletePrivateObject(path)));
      await db.delete(imageAssetsTable).where(eq(imageAssetsTable.id, cleanupAssetId));
    }
    if (productCategoryId) await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, productCategoryId));
    if (employee) await db.delete(employeesTable).where(eq(employeesTable.id, employee.id));
    if (salon) await db.delete(salonsTable).where(eq(salonsTable.id, salon.id));
    if (employeeUser) await db.delete(usersTable).where(eq(usersTable.id, employeeUser.id));
    if (admin) await db.delete(usersTable).where(eq(usersTable.id, admin.id));
    if (owner) await db.delete(usersTable).where(eq(usersTable.id, owner.id));
    if (user) await db.delete(usersTable).where(eq(usersTable.id, user.id));
  }
}

run()
  .then(() => {
    console.log("Image pipeline integration test passed.");
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });