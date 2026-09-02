import { eq, and, gt, lte, sql } from "drizzle-orm";
import {
  beautyJobListingsTable,
  beautyJobNotificationsTable,
  db,
  salonsTable,
} from "@workspace/db";
import {
  deliverBeautyJobEmail,
  enqueueBeautyJobEmail,
} from "./beauty-jobs-email";

const EXPIRY_WARNING_MS = 3 * 24 * 60 * 60 * 1000;
const EXPIRY_WARNING_BATCH_SIZE = 500;

async function recipientForListing(listing: typeof beautyJobListingsTable.$inferSelect): Promise<string | null> {
  if (listing.userId) return listing.userId;
  if (!listing.salonId) return null;
  const [salon] = await db.select({ ownerId: salonsTable.ownerId })
    .from(salonsTable)
    .where(eq(salonsTable.id, listing.salonId))
    .limit(1);
  return salon?.ownerId ?? null;
}

export async function expireBeautyJobListings(now = new Date()): Promise<number> {
  const warningRows = await db.select({
    listing: beautyJobListingsTable,
    recipientUserId: sql<string>`coalesce(${beautyJobListingsTable.userId}, ${salonsTable.ownerId})`,
  }).from(beautyJobListingsTable)
    .leftJoin(salonsTable, eq(beautyJobListingsTable.salonId, salonsTable.id))
    .where(and(
      eq(beautyJobListingsTable.status, "active"),
      eq(beautyJobListingsTable.moderationStatus, "approved"),
      gt(beautyJobListingsTable.expiresAt, now),
      lte(beautyJobListingsTable.expiresAt, new Date(now.getTime() + EXPIRY_WARNING_MS)),
    ))
    .orderBy(beautyJobListingsTable.expiresAt)
    .limit(EXPIRY_WARNING_BATCH_SIZE);

  for (const { listing, recipientUserId } of warningRows) {
    if (!recipientUserId) continue;
    const eventKey = `beauty-job:expiry-warning:${listing.id}:recipient:${recipientUserId}`;
    const enqueued = await db.transaction(async (tx) => {
      const [created] = await tx.insert(beautyJobNotificationsTable).values({
        recipientUserId,
        listingId: listing.id,
        type: "expiry_warning",
        title: "Oglas uskoro ističe",
        body: listing.title,
      }).onConflictDoNothing().returning();
      if (!created) return false;
      await enqueueBeautyJobEmail(tx, {
        eventKey,
        emailType: "beauty_job_expiry_warning",
        recipientUserId,
        subject: "Vaš oglas uskoro ističe",
        title: "Vaš oglas uskoro ističe",
        content: `Oglas „${listing.title}“ ističe ${listing.expiresAt.toLocaleDateString("sr-RS")}. Obnovite ga na vreme ako želite da ostane aktivan.`,
        listingId: listing.id,
        metadata: {
          notificationId: created.id,
          expiresAt: listing.expiresAt.toISOString(),
        },
      });
      return true;
    });
    if (enqueued) await deliverBeautyJobEmail(eventKey);
  }

  const expired = await db.update(beautyJobListingsTable)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(
      eq(beautyJobListingsTable.status, "active"),
      lte(beautyJobListingsTable.expiresAt, now),
    ))
    .returning();

  for (const listing of expired) {
    const recipientUserId = await recipientForListing(listing);
    if (!recipientUserId) continue;
    await db.insert(beautyJobNotificationsTable).values({
      recipientUserId,
      listingId: listing.id,
      type: "expired",
      title: "Oglas je istekao",
      body: listing.title,
    });
  }

  return expired.length;
}