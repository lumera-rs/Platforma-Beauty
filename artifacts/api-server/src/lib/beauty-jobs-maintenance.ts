import { eq, and, sql } from "drizzle-orm";
import {
  beautyJobListingsTable,
  beautyJobNotificationsTable,
  db,
  salonsTable,
} from "@workspace/db";

async function recipientForListing(listing: typeof beautyJobListingsTable.$inferSelect): Promise<string | null> {
  if (listing.userId) return listing.userId;
  if (!listing.salonId) return null;
  const [salon] = await db.select({ ownerId: salonsTable.ownerId })
    .from(salonsTable)
    .where(eq(salonsTable.id, listing.salonId))
    .limit(1);
  return salon?.ownerId ?? null;
}

export async function expireBeautyJobListings(): Promise<number> {
  const expired = await db.update(beautyJobListingsTable)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(
      eq(beautyJobListingsTable.status, "active"),
      sql`${beautyJobListingsTable.expiresAt} <= now()`,
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