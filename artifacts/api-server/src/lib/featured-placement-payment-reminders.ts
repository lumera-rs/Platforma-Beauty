import { createHash } from "node:crypto";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import {
  coursesTable,
  db,
  educationCentersTable,
  educationNotificationsTable,
  educationPlacementsTable,
  salonNotificationsTable,
  salonsTable,
} from "@workspace/db";
import { publishSalonNotificationUpdate } from "./salon-notification-events";

export const FEATURED_PLACEMENT_PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const FEATURED_PLACEMENT_REMINDER_LEAD_MS = 2 * 60 * 60 * 1000;

type Placement = typeof educationPlacementsTable.$inferSelect;
type PlacementOwner = { userId: string; salonId: string | null };

function deterministicNotificationId(eventKey: string): string {
  const hex = createHash("sha256").update(eventKey).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

async function placementOwner(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  placement: Placement,
): Promise<PlacementOwner | null> {
  if (placement.salonId) {
    const [salon] = await tx.select({ ownerId: salonsTable.ownerId })
      .from(salonsTable).where(eq(salonsTable.id, placement.salonId)).limit(1);
    return salon ? { userId: salon.ownerId, salonId: placement.salonId } : null;
  }
  const centerId = placement.centerId ?? (placement.courseId
    ? (await tx.select({ centerId: coursesTable.centerId }).from(coursesTable)
      .where(eq(coursesTable.id, placement.courseId)).limit(1))[0]?.centerId
    : null);
  if (!centerId) return null;
  const [center] = await tx.select({ ownerId: educationCentersTable.ownerId })
    .from(educationCentersTable).where(eq(educationCentersTable.id, centerId)).limit(1);
  return center ? { userId: center.ownerId, salonId: null } : null;
}

async function insertOwnerNotification(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  placement: Placement,
  owner: PlacementOwner,
  event: "payment-reminder" | "payment-expired",
): Promise<boolean> {
  const eventKey = `featured-placement:${placement.id}:${event}`;
  const expired = event === "payment-expired";
  const title = expired ? "Rok za uplatu isticanja je istekao" : "Uskoro ističe rok za uplatu isticanja";
  const body = expired
    ? "Rezervisani slot je oslobođen. Ako i dalje želite isticanje, napravite novi zahtev."
    : "Uplata još čeka potvrdu, a rok ističe za manje od dva sata. Uplatite na vreme da biste zadržali rezervisani slot.";
  const actionUrl = placement.salonId ? "/vlasnik/profil" : "/poslovanje/edukacije?tab=placements";

  if (owner.salonId) {
    const inserted = await tx.insert(salonNotificationsTable).values({
      id: deterministicNotificationId(eventKey),
      salonId: owner.salonId,
      title,
      message: body,
      href: actionUrl,
    }).onConflictDoNothing().returning({ id: salonNotificationsTable.id });
    return inserted.length > 0;
  }
  const inserted = await tx.insert(educationNotificationsTable).values({
    userId: owner.userId,
    type: `featured_placement_${event.replace("-", "_")}`,
    title,
    body,
    actionUrl,
    eventKey,
  }).onConflictDoNothing().returning({ id: educationNotificationsTable.id });
  return inserted.length > 0;
}

export async function expireFeaturedPlacementPaymentInTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  placement: Placement,
  now: Date,
) {
  const [updated] = await tx.update(educationPlacementsTable)
    .set({ status: "expired", updatedAt: now })
    .where(and(
      eq(educationPlacementsTable.id, placement.id),
      eq(educationPlacementsTable.status, "pending_payment"),
    )).returning();
  if (!updated) return { placement: null, salonId: null, notified: false };
  const owner = await placementOwner(tx, updated);
  const notified = owner ? await insertOwnerNotification(tx, updated, owner, "payment-expired") : false;
  return { placement: updated, salonId: notified ? owner?.salonId ?? null : null, notified };
}

async function processPlacement(placementId: string, now: Date) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`featured-placement-reminder:${placementId}`}))`);
    const [placement] = await tx.select().from(educationPlacementsTable)
      .where(eq(educationPlacementsTable.id, placementId)).for("update").limit(1);
    if (!placement || placement.status !== "pending_payment") return null;

    const deadline = new Date(placement.createdAt.getTime() + FEATURED_PLACEMENT_PAYMENT_WINDOW_MS);
    const expired = deadline <= now;
    const reminderDue = new Date(deadline.getTime() - FEATURED_PLACEMENT_REMINDER_LEAD_MS) <= now;
    if (!expired && !reminderDue) return null;

    if (expired) {
      const result = await expireFeaturedPlacementPaymentInTx(tx, placement, now);
      if (!result.placement) return null;
      return { salonId: result.salonId, expired: 1, reminded: 0, notified: Number(result.notified) };
    }

    const owner = await placementOwner(tx, placement);
    const notified = owner ? await insertOwnerNotification(tx, placement, owner, "payment-reminder") : false;
    return { salonId: notified ? owner?.salonId ?? null : null, expired: 0, reminded: 1, notified: Number(notified) };
  });
}

export async function runFeaturedPlacementPaymentReminderSweep(now = new Date()) {
  const reminderStart = new Date(now.getTime() - FEATURED_PLACEMENT_PAYMENT_WINDOW_MS);
  const reminderCutoff = new Date(now.getTime() - (FEATURED_PLACEMENT_PAYMENT_WINDOW_MS - FEATURED_PLACEMENT_REMINDER_LEAD_MS));
  const candidates = await db.select({ id: educationPlacementsTable.id })
    .from(educationPlacementsTable)
    .where(and(
      eq(educationPlacementsTable.status, "pending_payment"),
      lte(educationPlacementsTable.createdAt, reminderCutoff),
      gte(educationPlacementsTable.createdAt, reminderStart),
    )).orderBy(educationPlacementsTable.createdAt).limit(100);
  const expiredCandidates = await db.select({ id: educationPlacementsTable.id })
    .from(educationPlacementsTable)
    .where(and(
      eq(educationPlacementsTable.status, "pending_payment"),
      lte(educationPlacementsTable.createdAt, reminderStart),
    )).orderBy(educationPlacementsTable.createdAt).limit(100);

  let expired = 0;
  let reminded = 0;
  let notified = 0;
  const salonIds = new Set<string>();
  for (const candidate of [...candidates, ...expiredCandidates]) {
    const result = await processPlacement(candidate.id, now);
    if (!result) continue;
    expired += result.expired;
    reminded += result.reminded;
    notified += result.notified;
    if (result.salonId) salonIds.add(result.salonId);
  }
  await Promise.all([...salonIds].map(publishSalonNotificationUpdate));
  return { considered: candidates.length + expiredCandidates.length, expired, reminded, notified };
}