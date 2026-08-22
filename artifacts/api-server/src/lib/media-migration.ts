import { createHash, randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import {
  coursesTable,
  db,
  educationCentersTable,
  educationMediaTable,
  employeesTable,
  mediaAssetsTable,
  mediaVariantsTable,
  productCategoriesTable,
  productsTable,
  salonsTable,
  serviceCategoriesTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger";
import {
  cleanupPromotedMediaVariants,
  processImageBytes,
  readPrivateStorageObject,
  stableMediaUrl,
} from "../routes/media";

type LegacyScope =
  | "salon-profile"
  | "salon-gallery"
  | "employee-avatar"
  | "product"
  | "education-cover"
  | "education-gallery"
  | "education-center"
  | "service-category"
  | "product-category";

type MigrationResult = {
  reference: string;
  imageUrl: string | null;
  reason?: string;
};

type MigrationReport = {
  migrated: number;
  retained: number;
  skipped: Record<string, number>;
  remainingSources: Array<{
    scope: LegacyScope;
    resourceId: string;
    reference: string;
    reason: string;
  }>;
};

const CONTENT_TYPE_BY_FORMAT: Record<string, string> = {
  avif: "image/avif",
  heif: "image/avif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function isAlreadyManaged(reference: string) {
  return reference.startsWith("/api/media/");
}

async function firstExistingPath(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Try the next workspace/package working-directory candidate.
    }
  }
  return null;
}

async function legacyBytes(reference: string): Promise<Buffer | null> {
  if (reference.startsWith("/lumera-media/")) {
    const relative = reference.replace(/^\/+/, "");
    const path = await firstExistingPath([
      resolve(process.cwd(), "../beauty-marketplace/public", relative),
      resolve(process.cwd(), "artifacts/beauty-marketplace/public", relative),
      resolve(process.cwd(), "public", relative),
    ]);
    return path ? readFile(path) : null;
  }
  if (reference.startsWith("/objects/")) return readPrivateStorageObject(reference);
  if (reference.startsWith("/api/storage/objects/")) {
    return readPrivateStorageObject(reference.slice("/api/storage".length));
  }
  const categoryImage = /^\/api\/category-images\/([0-9a-f-]{36})$/i.exec(reference);
  if (categoryImage) return readPrivateStorageObject(`/objects/category-images/${categoryImage[1]}`);
  return null;
}

async function importReference(input: {
  reference: string;
  scope: LegacyScope;
  resourceId: string;
  ownerUserId: string | null;
  visibility: "public" | "education";
}): Promise<MigrationResult> {
  const reference = input.reference.trim();
  if (!reference || isAlreadyManaged(reference)) return { reference, imageUrl: reference || null };
  const bytes = await legacyBytes(reference);
  if (!bytes) return {
    reference,
    imageUrl: null,
    reason: /^https?:\/\//i.test(reference) ? "external-source-left-in-place" : "source-unavailable",
  };
  try {
    const metadata = await sharp(bytes, { failOn: "warning", limitInputPixels: 40_000_000 }).metadata();
    const contentType = metadata.format ? CONTENT_TYPE_BY_FORMAT[metadata.format] : undefined;
    if (!contentType) return { reference, imageUrl: null, reason: "unsupported-format" };
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const [existing] = await db.select().from(mediaAssetsTable).where(and(
      eq(mediaAssetsTable.scope, input.scope),
      eq(mediaAssetsTable.resourceId, input.resourceId),
      eq(mediaAssetsTable.contentHash, contentHash),
    )).limit(1);
    if (existing) return { reference, imageUrl: stableMediaUrl(existing) };
    const assetId = randomUUID();
    const processed = await processImageBytes({ assetId, bytes, declaredContentType: contentType });
    try {
      const [asset] = await db.transaction(async (tx) => {
        const [created] = await tx.insert(mediaAssetsTable).values({
          id: assetId,
          ownerUserId: input.ownerUserId,
          scope: input.scope,
          resourceId: input.resourceId,
          visibility: input.visibility,
          originalFileName: basename(reference) || `${assetId}.${metadata.format}`,
          originalContentType: contentType,
          width: processed.width,
          height: processed.height,
          contentHash: processed.contentHash,
        }).returning();
        await tx.insert(mediaVariantsTable).values(processed.variants);
        return [created!];
      });
      return { reference, imageUrl: stableMediaUrl(asset) };
    } catch (error) {
      await cleanupPromotedMediaVariants(processed.variants);
      throw error;
    }
  } catch (error) {
    logger.warn({ err: error, reference, scope: input.scope }, "Legacy media import skipped");
    return { reference, imageUrl: null, reason: "validation-or-storage-failure" };
  }
}

async function migrateList(input: {
  references: string[];
  scope: LegacyScope;
  resourceId: string;
  ownerUserId: string | null;
  visibility: "public" | "education";
}, report: MigrationReport) {
  const results: string[] = [];
  for (const reference of input.references) {
    const migrated = await importReference({ ...input, reference });
    if (migrated.imageUrl) {
      results.push(migrated.imageUrl);
      if (migrated.imageUrl !== reference) report.migrated += 1;
      else report.retained += 1;
    } else {
      results.push(reference);
      report.retained += 1;
      const reason = migrated.reason ?? "unknown";
      report.skipped[reason] = (report.skipped[reason] ?? 0) + 1;
      let safeReference = reference;
      if (/^https?:\/\//i.test(reference)) {
        try {
          const url = new URL(reference);
          safeReference = `${url.origin}${url.pathname}`;
        } catch {
          safeReference = "[invalid-external-url]";
        }
      }
      report.remainingSources.push({
        scope: input.scope,
        resourceId: input.resourceId,
        reference: safeReference,
        reason,
      });
    }
  }
  return results;
}

/**
 * Safe and repeatable migration: a database reference is changed only after
 * every replacement object and its variant metadata have been committed.
 * Legacy files/objects are intentionally retained for rollback compatibility.
 */
export async function migrateLegacyMediaReferences() {
  const report: MigrationReport = { migrated: 0, retained: 0, skipped: {}, remainingSources: [] };
  const admin = (await db.select({ id: usersTable.id }).from(usersTable)
    .where(inArray(usersTable.role, ["ADMIN", "SUPER_ADMIN"])).limit(1))[0];

  for (const salon of await db.select().from(salonsTable)) {
    const [imageUrl] = await migrateList({
      references: [salon.imageUrl],
      scope: "salon-profile",
      resourceId: salon.id,
      ownerUserId: salon.ownerId,
      visibility: "public",
    }, report);
    const gallery = await migrateList({
      references: salon.gallery,
      scope: "salon-gallery",
      resourceId: salon.id,
      ownerUserId: salon.ownerId,
      visibility: "public",
    }, report);
    if (imageUrl !== salon.imageUrl || gallery.some((url, index) => url !== salon.gallery[index])) {
      await db.update(salonsTable).set({ imageUrl, gallery }).where(eq(salonsTable.id, salon.id));
    }
  }

  for (const employee of await db.select({
    employee: employeesTable,
    ownerId: salonsTable.ownerId,
  }).from(employeesTable).innerJoin(salonsTable, eq(employeesTable.salonId, salonsTable.id))) {
    if (!employee.employee.avatarUrl) continue;
    const [avatarUrl] = await migrateList({
      references: [employee.employee.avatarUrl],
      scope: "employee-avatar",
      resourceId: employee.employee.id,
      ownerUserId: employee.employee.userId ?? employee.ownerId,
      visibility: "public",
    }, report);
    if (avatarUrl !== employee.employee.avatarUrl) {
      await db.update(employeesTable).set({ avatarUrl }).where(eq(employeesTable.id, employee.employee.id));
    }
  }

  for (const product of await db.select().from(productsTable)) {
    const references = [...new Set([product.imageUrl, ...product.images])];
    const migrated = await migrateList({
      references,
      scope: "product",
      resourceId: product.id,
      ownerUserId: admin?.id ?? null,
      visibility: "public",
    }, report);
    const mapped = new Map(references.map((reference, index) => [reference, migrated[index]!]));
    const imageUrl = mapped.get(product.imageUrl)!;
    const images = product.images.map((reference) => mapped.get(reference)!);
    if (imageUrl !== product.imageUrl || images.some((url, index) => url !== product.images[index])) {
      await db.update(productsTable).set({ imageUrl, images }).where(eq(productsTable.id, product.id));
    }
  }

  for (const course of await db.select().from(coursesTable)) {
    const ownerUserId = course.salonId
      ? (await db.select({ ownerId: salonsTable.ownerId }).from(salonsTable).where(eq(salonsTable.id, course.salonId)).limit(1))[0]?.ownerId ?? null
      : course.centerId
        ? (await db.select({ ownerId: educationCentersTable.ownerId }).from(educationCentersTable).where(eq(educationCentersTable.id, course.centerId)).limit(1))[0]?.ownerId ?? null
        : null;
    const [imageUrl] = await migrateList({
      references: [course.imageUrl],
      scope: "education-cover",
      resourceId: course.id,
      ownerUserId,
      visibility: "education",
    }, report);
    if (imageUrl !== course.imageUrl) await db.update(coursesTable).set({ imageUrl }).where(eq(coursesTable.id, course.id));
  }

  for (const center of await db.select().from(educationCentersTable)) {
    const [imageUrl] = await migrateList({
      references: [center.imageUrl],
      scope: "education-center",
      resourceId: center.id,
      ownerUserId: center.ownerId,
      visibility: "public",
    }, report);
    if (imageUrl !== center.imageUrl) await db.update(educationCentersTable).set({ imageUrl }).where(eq(educationCentersTable.id, center.id));
  }

  for (const media of await db.select().from(educationMediaTable)) {
    const course = media.courseId
      ? (await db.select().from(coursesTable).where(eq(coursesTable.id, media.courseId)).limit(1))[0]
      : null;
    if (!course || isAlreadyManaged(media.objectPath)) continue;
    const ownerUserId = media.centerId
      ? (await db.select({ ownerId: educationCentersTable.ownerId }).from(educationCentersTable).where(eq(educationCentersTable.id, media.centerId)).limit(1))[0]?.ownerId ?? null
      : null;
    const [objectPath] = await migrateList({
      references: [media.objectPath],
      scope: "education-gallery",
      resourceId: course.id,
      ownerUserId,
      visibility: "education",
    }, report);
    if (objectPath !== media.objectPath) await db.update(educationMediaTable).set({ objectPath }).where(eq(educationMediaTable.id, media.id));
  }

  if (admin) {
    for (const category of await db.select().from(serviceCategoriesTable)) {
      if (!category.fallbackImageUrl) continue;
      const [fallbackImageUrl] = await migrateList({
        references: [category.fallbackImageUrl],
        scope: "service-category",
        resourceId: category.id,
        ownerUserId: admin.id,
        visibility: "public",
      }, report);
      if (fallbackImageUrl !== category.fallbackImageUrl) {
        await db.update(serviceCategoriesTable).set({ fallbackImageUrl }).where(eq(serviceCategoriesTable.id, category.id));
      }
    }
    for (const category of await db.select().from(productCategoriesTable)) {
      if (!category.imageUrl) continue;
      const [imageUrl] = await migrateList({
        references: [category.imageUrl],
        scope: "product-category",
        resourceId: category.id,
        ownerUserId: admin.id,
        visibility: "public",
      }, report);
      if (imageUrl !== category.imageUrl) {
        await db.update(productCategoriesTable).set({ imageUrl }).where(eq(productCategoriesTable.id, category.id));
      }
    }
  }

  logger.info(report, "Legacy media migration completed; legacy source objects were retained");
  return report;
}