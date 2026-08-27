import { and, eq, lte, sql } from "drizzle-orm";
import { db, emailDeliveriesTable, retailOrdersTable, shopSettingsTable, usersTable } from "@workspace/db";
import { enqueueTransactionalEmail, lumeraEmailHtml } from "./brevo";
import { logger } from "./logger";

/** Durable, restart-safe invitation sweep. The unique event key is the durable
 * one-per-order fence; order locking makes concurrent workers deterministic. */
export async function runRetailReviewInvitationSweep(now = new Date()) {
  const [settings] = await db.select().from(shopSettingsTable).limit(1);
  if (!settings?.reviewRewardsEnabled) return { considered: 0, enqueued: 0 };
  const due = new Date(now.getTime() - settings.reviewInvitationDelayDays * 86_400_000);
  const candidates = await db.select({ id: retailOrdersTable.id }).from(retailOrdersTable)
    .where(and(eq(retailOrdersTable.status, "delivered"), lte(retailOrdersTable.updatedAt, due))).limit(100);
  let enqueued = 0;
  for (const candidate of candidates) {
    const didEnqueue = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(retailOrdersTable).where(eq(retailOrdersTable.id, candidate.id)).for("update").limit(1);
      const [current] = await tx.select().from(shopSettingsTable).limit(1);
      if (!order || !current?.reviewRewardsEnabled || order.status !== "delivered" || order.updatedAt > new Date(now.getTime() - current.reviewInvitationDelayDays * 86_400_000)) return false;
      const [user] = order.userId ? await tx.select().from(usersTable).where(eq(usersTable.id, order.userId)).limit(1) : [];
      if (!user?.active || !user.email) return false;
      const eventKey = `retail-review-invitation:${order.id}`;
      const [existing] = await tx.select({ id: emailDeliveriesTable.id }).from(emailDeliveriesTable).where(eq(emailDeliveriesTable.eventKey, eventKey)).limit(1);
      if (existing) return false;
      await enqueueTransactionalEmail(tx, {
        eventKey, emailType: "retail_review_invitation", to: { email: user.email, name: user.firstName },
        subject: "LUMERA — podelite utiske o kupovini",
        htmlContent: lumeraEmailHtml("Kako vam se dopadaju proizvodi?", "<p>Vaša recenzija pomaže drugim kupcima pri izboru.</p>"),
        metadata: { retailOrderId: order.id, invitationDelayDays: current.reviewInvitationDelayDays },
      }, now);
      return true;
    });
    if (didEnqueue) enqueued++;
  }
  logger.info({ considered: candidates.length, enqueued }, "Retail review invitation sweep completed");
  return { considered: candidates.length, enqueued };
}