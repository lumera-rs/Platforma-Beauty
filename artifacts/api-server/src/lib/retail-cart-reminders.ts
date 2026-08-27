import {
  db,
  emailDeliveriesTable,
  retailCartItemsTable,
  retailCartsTable,
  shopSettingsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { enqueueTransactionalEmail, lumeraEmailHtml, RETAIL_CART_REMINDER_EMAIL_TYPE } from "./brevo";
import { logger } from "./logger";

const BATCH_SIZE = 50;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validRecipient(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length <= 320 && EMAIL.test(value);
}

/**
 * Claims eligible cart activity by recording its version and inserting a
 * deterministic outbox event in one short transaction. Provider delivery is
 * deliberately left to the durable email retry worker.
 */
export async function runRetailCartReminderSweep(now = new Date()) {
  const [settings] = await db.select().from(shopSettingsTable).limit(1);
  if (!settings?.retailCartReminderEnabled || !settings.retailCartReminderBrevoTemplateId) {
    return { considered: 0, enqueued: 0 };
  }
  const cutoff = new Date(now.getTime() - settings.retailCartReminderDelayHours * 60 * 60_000);
  const candidates = await db.select({ id: retailCartsTable.id })
    .from(retailCartsTable)
    .where(and(
      lt(retailCartsTable.updatedAt, cutoff),
      or(
        isNull(retailCartsTable.reminderEnqueuedActivityVersion),
        sql`${retailCartsTable.reminderEnqueuedActivityVersion} < ${retailCartsTable.activityVersion}`,
      ),
    ))
    .orderBy(retailCartsTable.updatedAt)
    .limit(BATCH_SIZE);

  let enqueued = 0;
  for (const candidate of candidates) {
    const claimed = await db.transaction(async (tx) => {
      // Settings may have changed after the candidate scan. Revalidate them
      // immediately before the durable outbox insert.
      const [currentSettings] = await tx.select().from(shopSettingsTable).limit(1);
      if (!currentSettings?.retailCartReminderEnabled || !currentSettings.retailCartReminderBrevoTemplateId) return false;
      const currentCutoff = new Date(now.getTime() - currentSettings.retailCartReminderDelayHours * 60 * 60_000);
      const [cart] = await tx.select().from(retailCartsTable)
        .where(eq(retailCartsTable.id, candidate.id)).limit(1).for("update");
      if (!cart
        || cart.updatedAt.getTime() >= currentCutoff.getTime()
        || cart.reminderEnqueuedActivityVersion === cart.activityVersion
        || cart.completedActivityVersion === cart.activityVersion) return false;
      const [line] = await tx.select({ id: retailCartItemsTable.id }).from(retailCartItemsTable)
        .where(eq(retailCartItemsTable.cartId, cart.id)).limit(1);
      if (!line) return false;
      const [user] = cart.userId
        ? await tx.select({ email: usersTable.email, firstName: usersTable.firstName, active: usersTable.active })
          .from(usersTable).where(eq(usersTable.id, cart.userId)).limit(1)
        : [];
      // An account-bound cart never falls back to an old guest capture if the
      // account was deactivated; only anonymous carts may use contactEmail.
      if (cart.userId && !user?.active) return false;
      const recipient = cart.userId ? user?.email : cart.contactEmail;
      if (!validRecipient(recipient)) return false;
      const eventKey = `retail-cart-reminder:${cart.id}:activity:${cart.activityVersion}`;
      await enqueueTransactionalEmail(tx, {
        eventKey,
        emailType: RETAIL_CART_REMINDER_EMAIL_TYPE,
        to: { email: recipient, name: user?.firstName },
        subject: "LUMERA — proizvodi vas čekaju u korpi",
        htmlContent: lumeraEmailHtml("Vaša korpa vas čeka", "<p>Sačuvali smo proizvode koje ste izabrali. Vratite se u LUMERA prodavnicu kada vam odgovara.</p>"),
        brevoTemplateId: currentSettings.retailCartReminderBrevoTemplateId,
        metadata: {
          retailCartId: cart.id,
          activityVersion: cart.activityVersion,
        },
      }, now);
      const [updated] = await tx.update(retailCartsTable).set({
        reminderEnqueuedActivityVersion: cart.activityVersion,
      }).where(and(
        eq(retailCartsTable.id, cart.id),
        eq(retailCartsTable.activityVersion, cart.activityVersion),
        or(isNull(retailCartsTable.reminderEnqueuedActivityVersion), lt(retailCartsTable.reminderEnqueuedActivityVersion, cart.activityVersion)),
      )).returning({ id: retailCartsTable.id });
      return Boolean(updated);
    });
    if (claimed) enqueued += 1;
  }
  logger.info({ considered: candidates.length, enqueued }, "Retail cart reminder sweep completed");
  return { considered: candidates.length, enqueued };
}