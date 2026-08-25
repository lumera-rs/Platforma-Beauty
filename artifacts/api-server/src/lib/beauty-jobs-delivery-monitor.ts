import { createHash } from "node:crypto";
import { and, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { db, emailDeliveriesTable, usersTable } from "@workspace/db";
import {
  BEAUTY_JOB_DELIVERY_ALERT_EMAIL_TYPE,
  BEAUTY_JOB_EMAIL_TYPES,
  lumeraEmailHtml,
  sendTransactionalEmail,
  type TransactionalEmailTransport,
} from "./brevo";
import { logger } from "./logger";

export const BEAUTY_JOB_DELIVERY_STALE_AFTER_MS = 30 * 60_000;
export const BEAUTY_JOB_DELIVERY_ALERT_THRESHOLD = 5;
export const BEAUTY_JOB_DELIVERY_ALERT_COOLDOWN_MS = 6 * 60 * 60_000;
const BEAUTY_JOB_DELIVERY_ISSUE_LIMIT = 250;
const MAX_ALERT_RECIPIENTS = 500;

export type BeautyJobDeliveryIssueSummary = {
  delayedQueuedCount: number;
  failedCount: number;
  skippedCount: number;
  totalIssueCount: number;
  terminalIssueCount: number;
  staleAfterMinutes: number;
  alertThreshold: number;
};

export async function listBeautyJobDeliveryIssues(now = new Date()) {
  const staleBefore = new Date(now.getTime() - BEAUTY_JOB_DELIVERY_STALE_AFTER_MS);
  const beautyTypes = BEAUTY_JOB_EMAIL_TYPES as unknown as string[];
  const issuePredicate = and(
    inArray(emailDeliveriesTable.emailType, beautyTypes),
    or(
      and(
        eq(emailDeliveriesTable.status, "queued"),
        lte(emailDeliveriesTable.createdAt, staleBefore),
      ),
      inArray(emailDeliveriesTable.status, ["failed", "skipped"]),
    ),
  );

  const [summaryRow, deliveries] = await Promise.all([
    db.select({
      delayedQueuedCount: sql<number>`count(*) filter (where ${emailDeliveriesTable.status} = 'queued' and ${emailDeliveriesTable.createdAt} <= ${staleBefore})::int`,
      failedCount: sql<number>`count(*) filter (where ${emailDeliveriesTable.status} = 'failed')::int`,
      skippedCount: sql<number>`count(*) filter (where ${emailDeliveriesTable.status} = 'skipped')::int`,
    }).from(emailDeliveriesTable)
      .where(inArray(emailDeliveriesTable.emailType, beautyTypes))
      .then((rows) => rows[0]),
    db.select({
      id: emailDeliveriesTable.id,
      emailType: emailDeliveriesTable.emailType,
      status: emailDeliveriesTable.status,
      retryCount: emailDeliveriesTable.retryCount,
      retryableFailure: emailDeliveriesTable.retryableFailure,
      nextRetryAt: emailDeliveriesTable.nextRetryAt,
      createdAt: emailDeliveriesTable.createdAt,
    }).from(emailDeliveriesTable)
      .where(issuePredicate)
      .orderBy(desc(emailDeliveriesTable.createdAt))
      .limit(BEAUTY_JOB_DELIVERY_ISSUE_LIMIT),
  ]);

  const delayedQueuedCount = Number(summaryRow?.delayedQueuedCount ?? 0);
  const failedCount = Number(summaryRow?.failedCount ?? 0);
  const skippedCount = Number(summaryRow?.skippedCount ?? 0);
  const terminalIssueCount = failedCount + skippedCount;
  const summary: BeautyJobDeliveryIssueSummary = {
    delayedQueuedCount,
    failedCount,
    skippedCount,
    totalIssueCount: delayedQueuedCount + terminalIssueCount,
    terminalIssueCount,
    staleAfterMinutes: BEAUTY_JOB_DELIVERY_STALE_AFTER_MS / 60_000,
    alertThreshold: BEAUTY_JOB_DELIVERY_ALERT_THRESHOLD,
  };

  return {
    summary,
    deliveries: deliveries.map((delivery) => ({
      id: delivery.id,
      emailType: delivery.emailType as typeof BEAUTY_JOB_EMAIL_TYPES[number],
      status: delivery.status as "queued" | "failed" | "skipped",
      retryCount: delivery.retryCount,
      retryAvailable: delivery.status === "failed" && delivery.retryableFailure,
      issueKind: delivery.status === "queued"
        ? "delayed"
        : delivery.status === "skipped"
          ? "configuration"
          : delivery.retryableFailure
            ? "temporary"
            : "permanent",
      nextRetryAt: delivery.nextRetryAt,
      createdAt: delivery.createdAt,
    })),
  };
}

function recipientKey(email: string) {
  return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16);
}

function insideCooldown(now: Date, priorAlertAt: string | null | undefined) {
  if (!priorAlertAt) return false;
  const prior = Date.parse(priorAlertAt);
  return !Number.isFinite(prior) || now.getTime() < prior + BEAUTY_JOB_DELIVERY_ALERT_COOLDOWN_MS;
}

export async function runBeautyJobDeliveryFailureAlerts(
  now = new Date(),
  transport?: TransactionalEmailTransport,
) {
  const { summary } = await listBeautyJobDeliveryIssues(now);
  const empty = {
    summary,
    recipientCount: 0,
    attemptedEventKeys: [] as string[],
    cooldownSuppressedCount: 0,
    failedDeliveryCount: 0,
    skippedDeliveryCount: 0,
  };
  if (summary.terminalIssueCount < BEAUTY_JOB_DELIVERY_ALERT_THRESHOLD) return empty;

  const [recipients, history] = await Promise.all([
    db.select({ email: usersTable.email }).from(usersTable).where(and(
      eq(usersTable.active, true),
      inArray(usersTable.role, ["ADMIN", "SUPER_ADMIN"]),
    )).limit(MAX_ALERT_RECIPIENTS),
    db.select({
      recipientEmail: emailDeliveriesTable.recipientEmail,
      alertCount: sql<number>`count(*)::int`,
      lastAlertAt: sql<string | null>`max(${emailDeliveriesTable.metadata}->>'alertAt')`,
    }).from(emailDeliveriesTable)
      .where(eq(emailDeliveriesTable.emailType, BEAUTY_JOB_DELIVERY_ALERT_EMAIL_TYPE))
      .groupBy(emailDeliveriesTable.recipientEmail),
  ]);
  if (!recipients.length) {
    logger.warn(
      { terminalIssueCount: summary.terminalIssueCount },
      "Beauty Jobs email delivery alert has no administrator recipients",
    );
    return empty;
  }

  const historyByRecipient = new Map(history.map((row) => [row.recipientEmail.toLowerCase(), row]));
  const attemptedEventKeys: string[] = [];
  let cooldownSuppressedCount = 0;
  const sends = recipients.flatMap((recipient) => {
    const prior = historyByRecipient.get(recipient.email.toLowerCase());
    if (insideCooldown(now, prior?.lastAlertAt)) {
      cooldownSuppressedCount += 1;
      return [];
    }
    const sequence = Number(prior?.alertCount ?? 0) + 1;
    const eventKey = `beauty-job-delivery-alert:${sequence}:${recipientKey(recipient.email)}`;
    attemptedEventKeys.push(eventKey);
    return [sendTransactionalEmail({
      eventKey,
      emailType: BEAUTY_JOB_DELIVERY_ALERT_EMAIL_TYPE,
      to: { email: recipient.email },
      subject: "LUMERA — Beauty Poslovi mejlovi zahtevaju proveru",
      htmlContent: lumeraEmailHtml(
        "Beauty Poslovi mejlovi zahtevaju proveru",
        `<p>Broj terminalno neisporučenih Beauty Poslovi poruka dostigao je prag za upozorenje.</p>
         <p><strong>Neuspešno:</strong> ${summary.failedCount} · <strong>Preskočeno:</strong> ${summary.skippedCount} · <strong>Dugo na čekanju:</strong> ${summary.delayedQueuedCount}</p>
         <p>Otvorite Admin → Oglasi &amp; izveštaji → Isporuka mejlova. Pregled ne prikazuje adrese ni sadržaj poruka, a ručni retry je dostupan samo za prolazne greške.</p>`,
      ),
      metadata: {
        alertAt: now.toISOString(),
        failedCount: summary.failedCount,
        skippedCount: summary.skippedCount,
        delayedQueuedCount: summary.delayedQueuedCount,
        threshold: BEAUTY_JOB_DELIVERY_ALERT_THRESHOLD,
      },
    }, transport)];
  });
  const results = await Promise.allSettled(sends);
  const failedDeliveryCount = results.filter(
    (result) => result.status === "rejected" || ("failed" in result.value && result.value.failed),
  ).length;
  const skippedDeliveryCount = results.filter(
    (result) => result.status === "fulfilled" && "skipped" in result.value && result.value.skipped,
  ).length;

  logger.warn({
    terminalIssueCount: summary.terminalIssueCount,
    delayedQueuedCount: summary.delayedQueuedCount,
    recipientCount: recipients.length,
    attemptedCount: attemptedEventKeys.length,
    failedDeliveryCount,
    skippedDeliveryCount,
  }, "Beauty Jobs email delivery threshold reached");

  return {
    summary,
    recipientCount: recipients.length,
    attemptedEventKeys,
    cooldownSuppressedCount,
    failedDeliveryCount,
    skippedDeliveryCount,
  };
}