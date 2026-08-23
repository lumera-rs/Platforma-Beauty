/**
 * Delivery-report silence alerting.
 *
 * Reuses the per-provider staleness signal from provider-events.ts
 * (deliveryReportStatuses) — the same signal that powers the admin
 * integrations page warning — and pushes it to administrators proactively:
 *   - the admin dashboard summary lists stale providers (via
 *     staleDeliveryReportProviders) so the "Potrebna je intervencija" alert
 *     shows up without opening the integrations page, and
 *   - a scheduled checker (wired in index.ts) emails administrators when
 *     delivery reports go silent.
 *
 * Rate limiting (must not spam on every check): a ROLLING cooldown per
 * provider and administrator. Before sending, the last alert's own timestamp
 * (metadata.alertAt of the newest prior outbox row for that provider +
 * recipient) is compared against `now`; within
 * DELIVERY_REPORT_ALERT_COOLDOWN_MS nothing is sent. A fixed time bucket
 * would allow two alerts minutes apart across a bucket boundary — the
 * rolling check guarantees a full cooldown between any two alerts to the
 * same admin about the same provider.
 *
 * Concurrency safety: the eventKey carries a per-provider/per-recipient
 * SEQUENCE number (count of prior alert rows + 1). Two instances that race
 * past the cooldown check compute the same sequence and therefore the same
 * eventKey; email_deliveries.event_key is unique, so the idempotent outbox
 * (sendTransactionalEmail reports the insert conflict as deduplicated)
 * collapses them into a single provider send. State lives in the database,
 * so it survives restarts and is shared across instances.
 *
 * Failure notes: the alert email itself goes out via Brevo's SEND API, which
 * is independent of the (possibly broken) delivery-report WEBHOOK — a silent
 * webhook does not prevent the alert from sending. If Brevo sending is
 * unavailable too, the send is logged as failed/skipped and the dashboard
 * alert remains the fallback surface.
 *
 * Recovery notices (runDeliveryReportRecoveryAlerts): once a provider that
 * previously triggered a silence alert receives verified events again, each
 * alerted administrator gets a single "reports are arriving again" email so
 * they know the fix worked without re-checking the dashboard. Dedup anchors
 * on the silence-alert SEQUENCE instead of a time window: a recovery email's
 * metadata records the silence sequence it answers (silenceSequence), and no
 * further recovery email goes out until a NEWER silence alert exists. Flap
 * cycles inside the silence cooldown (silent → recovered → silent → recovered)
 * therefore produce at most one recovery email per silence alert, and a
 * provider (or admin) that never alerted never gets a recovery notice.
 * Racing instances compute the same anchored eventKey and collapse in the
 * idempotent outbox exactly like the silence alerts do.
 */
import { createHash } from "node:crypto";
import { db, emailDeliveriesTable, usersTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  lumeraEmailHtml,
  sendTransactionalEmail,
  type TransactionalEmailTransport,
} from "./brevo";
import { logger } from "./logger";
import {
  deliveryReportStatuses,
  DELIVERY_REPORT_WINDOW_HOURS,
  type DeliveryReportProvider,
  type DeliveryReportStatus,
} from "./provider-events";

const DELIVERY_REPORT_ALERT_EMAIL_TYPE = "delivery_report_silence_alert";
const DELIVERY_REPORT_RECOVERY_EMAIL_TYPE = "delivery_report_recovery_alert";
/** Rolling cooldown: at least this long between two alerts to the same admin about the same provider. */
export const DELIVERY_REPORT_ALERT_COOLDOWN_MS = 24 * 60 * 60_000;

/** Admin-facing provider labels (Serbian UI copy uses the same names). */
export const DELIVERY_REPORT_PROVIDER_LABELS: Record<DeliveryReportProvider, string> = {
  brevo: "Brevo (e-mail)",
  infobip: "Infobip (SMS)",
};

/**
 * Providers whose delivery reports look silent, in stable order. Shared by
 * the admin dashboard summary endpoint and the scheduled email alert so both
 * surfaces always agree with the integrations page warning.
 */
export function staleDeliveryReportProviders(
  statuses: Record<DeliveryReportProvider, DeliveryReportStatus>,
): DeliveryReportProvider[] {
  return (["brevo", "infobip"] as const).filter((provider) => statuses[provider].warning);
}

function formatBelgradeTime(iso: string | null): string {
  if (!iso) return "nikada";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "nikada";
  return new Intl.DateTimeFormat("sr-RS", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Belgrade",
  }).format(date);
}

/**
 * Check delivery-report freshness and email administrators about every stale
 * provider. Safe to run on every scheduler tick and from any number of
 * instances: the rolling cooldown suppresses repeats, and racing instances
 * collapse onto the same sequence-numbered outbox eventKey (see module doc).
 *
 * Returns a summary (stale providers, recipients, attempted event keys,
 * cooldown suppressions and failure counts) for logging and tests. Never
 * throws on provider failures — individual send outcomes are tallied and
 * logged.
 */
export async function runDeliveryReportSilenceAlerts(
  now = new Date(),
  transport?: TransactionalEmailTransport,
): Promise<{
  staleProviders: DeliveryReportProvider[];
  recipientCount: number;
  attemptedEventKeys: string[];
  cooldownSuppressedCount: number;
  failedDeliveryCount: number;
  skippedDeliveryCount: number;
}> {
  const statuses = await deliveryReportStatuses(now);
  const staleProviders = staleDeliveryReportProviders(statuses);
  const empty = {
    staleProviders,
    recipientCount: 0,
    attemptedEventKeys: [] as string[],
    cooldownSuppressedCount: 0,
    failedDeliveryCount: 0,
    skippedDeliveryCount: 0,
  };
  if (!staleProviders.length) return empty;

  const recipients = await db.select({ email: usersTable.email })
    .from(usersTable)
    .where(and(
      eq(usersTable.active, true),
      inArray(usersTable.role, ["ADMIN", "SUPER_ADMIN"]),
    ));
  if (!recipients.length) {
    logger.warn(
      { staleProviders },
      "Delivery-report silence alert has no configured administrator recipients",
    );
    return empty;
  }

  // Prior alert history per provider + recipient: newest alert timestamp
  // (metadata.alertAt, ISO — lexicographic max equals chronological max)
  // anchors the rolling cooldown, and the row count is the next sequence
  // number for the idempotent outbox eventKey.
  const providerExpr = sql<string>`${emailDeliveriesTable.metadata}->>'provider'`;
  const history = await db.select({
    recipientEmail: emailDeliveriesTable.recipientEmail,
    provider: providerExpr,
    alertCount: sql<number>`count(*)::int`,
    lastAlertAtIso: sql<string | null>`max(${emailDeliveriesTable.metadata}->>'alertAt')`,
  })
    .from(emailDeliveriesTable)
    .where(eq(emailDeliveriesTable.emailType, DELIVERY_REPORT_ALERT_EMAIL_TYPE))
    .groupBy(emailDeliveriesTable.recipientEmail, providerExpr);
  const historyByKey = new Map(history.map((row) => [`${row.provider}:${row.recipientEmail}`, row]));

  let cooldownSuppressedCount = 0;
  const attemptedEventKeys: string[] = [];
  const sends: Promise<Awaited<ReturnType<typeof sendTransactionalEmail>>>[] = [];
  for (const provider of staleProviders) {
    const status = statuses[provider];
    const label = DELIVERY_REPORT_PROVIDER_LABELS[provider];
    const subject = `LUMERA — izveštaji o isporuci ne stižu (${label})`;
    const htmlContent = lumeraEmailHtml(
      "Potrebna je intervencija: izveštaji o isporuci ne stižu",
      `<p>Automatske poruke se šalju preko kanala <strong>${label}</strong>, ali provajder ne javlja status isporuke — webhook za izveštaje deluje neispravno ili je isključen.</p>
      <p><strong>Trenutno stanje (poslednja ${DELIVERY_REPORT_WINDOW_HOURS} h):</strong> poslatih poruka: ${status.recentSendCount}, poslednje slanje: ${formatBelgradeTime(status.lastAutomationSentAt)}, poslednji primljeni izveštaj: ${formatBelgradeTime(status.lastEventAt)}.</p>
      <p>Proverite webhook podešavanja u sekciji Integracije u admin panelu (tajna webhook adresa mora biti registrovana kod provajdera), a zatim potvrdite da upozorenje nestaje sa admin pregleda.</p>`,
    );
    for (const recipient of recipients) {
      const normalizedEmail = recipient.email.toLowerCase();
      const prior = historyByKey.get(`${provider}:${normalizedEmail}`);
      const lastAlertAt = prior?.lastAlertAtIso ? new Date(prior.lastAlertAtIso) : null;
      // Rolling cooldown: a full DELIVERY_REPORT_ALERT_COOLDOWN_MS must have
      // elapsed since this recipient's newest alert about this provider. An
      // unparseable/future anchor also suppresses — never risks spam.
      if (lastAlertAt && !Number.isNaN(lastAlertAt.getTime())
        && now.getTime() - lastAlertAt.getTime() < DELIVERY_REPORT_ALERT_COOLDOWN_MS) {
        cooldownSuppressedCount += 1;
        continue;
      }
      const sequence = (prior?.alertCount ?? 0) + 1;
      const recipientKey = createHash("sha256").update(normalizedEmail).digest("hex").slice(0, 16);
      // Racing instances compute the same sequence → same eventKey → the
      // unique outbox key collapses them into one provider send.
      const eventKey = `delivery-report-silence-alert:${provider}:${recipientKey}:${sequence}`;
      attemptedEventKeys.push(eventKey);
      sends.push(sendTransactionalEmail({
        eventKey,
        emailType: DELIVERY_REPORT_ALERT_EMAIL_TYPE,
        to: { email: recipient.email },
        subject,
        htmlContent,
        metadata: {
          provider,
          alertAt: now.toISOString(),
          sequence,
          recentSendCount: status.recentSendCount,
          lastAutomationSentAt: status.lastAutomationSentAt,
          lastEventAt: status.lastEventAt,
        },
      }, transport));
    }
  }

  const results = await Promise.allSettled(sends);
  const failedDeliveryCount = results.filter(
    (result) => result.status === "rejected" || ("failed" in result.value && result.value.failed),
  ).length;
  const skippedDeliveryCount = results.filter(
    (result) => result.status === "fulfilled" && "skipped" in result.value && result.value.skipped,
  ).length;
  const deduplicatedCount = results.filter(
    (result) => result.status === "fulfilled" && "deduplicated" in result.value && result.value.deduplicated,
  ).length;

  if (failedDeliveryCount || skippedDeliveryCount) {
    logger.warn(
      { staleProviders, recipientCount: recipients.length, cooldownSuppressedCount, failedDeliveryCount, skippedDeliveryCount },
      "Delivery-report silence alert delivery did not complete for every administrator",
    );
  } else if (attemptedEventKeys.length && deduplicatedCount < results.length) {
    // Only log when something new actually went out — a cooldown-suppressed
    // or fully deduplicated tick is the steady state while a provider stays
    // silent.
    logger.info(
      { staleProviders, recipientCount: recipients.length, cooldownSuppressedCount },
      "Delivery-report silence alert delivery queued",
    );
  }
  return {
    staleProviders,
    recipientCount: recipients.length,
    attemptedEventKeys,
    cooldownSuppressedCount,
    failedDeliveryCount,
    skippedDeliveryCount,
  };
}

/**
 * Check for providers whose delivery reports have RECOVERED after a silence
 * alert and email each previously-alerted administrator exactly once per
 * silence episode. Safe to run on every scheduler tick from any number of
 * instances:
 *   - a recipient/provider pair is only considered when it has silence-alert
 *     history (never alerted → never notified),
 *   - verified events must have arrived AFTER the newest silence alert
 *     (metadata.alertAt < receipt lastEventAt) and the provider must read
 *     healthy now — a warning that merely aged out of the send window without
 *     any events is not a recovery,
 *   - the outbox eventKey anchors on the newest silence-alert sequence
 *     (count of silence rows), so repeat ticks and racing instances collapse
 *     onto the same key, and no new recovery email is possible until a NEWER
 *     silence alert exists (flap cycles inside the silence cooldown cannot
 *     spam),
 *   - already-answered episodes are skipped without touching the outbox by
 *     comparing the newest recovery row's recorded silenceSequence.
 *
 * Returns a summary for logging and tests. Never throws on provider
 * failures — individual send outcomes are tallied and logged.
 */
export async function runDeliveryReportRecoveryAlerts(
  now = new Date(),
  transport?: TransactionalEmailTransport,
): Promise<{
  notifiedProviders: DeliveryReportProvider[];
  recipientCount: number;
  attemptedEventKeys: string[];
  alreadyNotifiedCount: number;
  failedDeliveryCount: number;
  skippedDeliveryCount: number;
}> {
  const statuses = await deliveryReportStatuses(now);
  // Only providers that read healthy now AND have received at least one
  // verified event can have recovered; a stale or never-reporting provider
  // has nothing to announce.
  const candidates = (["brevo", "infobip"] as const).filter(
    (provider) => !statuses[provider].warning && statuses[provider].lastEventAt !== null,
  );
  const empty = {
    notifiedProviders: [] as DeliveryReportProvider[],
    recipientCount: 0,
    attemptedEventKeys: [] as string[],
    alreadyNotifiedCount: 0,
    failedDeliveryCount: 0,
    skippedDeliveryCount: 0,
  };
  if (!candidates.length) return empty;

  const recipients = await db.select({ email: usersTable.email })
    .from(usersTable)
    .where(and(
      eq(usersTable.active, true),
      inArray(usersTable.role, ["ADMIN", "SUPER_ADMIN"]),
    ));
  if (!recipients.length) return empty;

  // Silence-alert history per provider + recipient: the row count is the
  // current silence sequence (the recovery eventKey anchor) and the newest
  // alertAt is the timestamp verified events must postdate. Recovery history
  // records which silence sequence was already answered.
  const providerExpr = sql<string>`${emailDeliveriesTable.metadata}->>'provider'`;
  const [silenceHistory, recoveryHistory] = await Promise.all([
    db.select({
      recipientEmail: emailDeliveriesTable.recipientEmail,
      provider: providerExpr,
      alertCount: sql<number>`count(*)::int`,
      lastAlertAtIso: sql<string | null>`max(${emailDeliveriesTable.metadata}->>'alertAt')`,
    })
      .from(emailDeliveriesTable)
      .where(eq(emailDeliveriesTable.emailType, DELIVERY_REPORT_ALERT_EMAIL_TYPE))
      .groupBy(emailDeliveriesTable.recipientEmail, providerExpr),
    db.select({
      recipientEmail: emailDeliveriesTable.recipientEmail,
      provider: providerExpr,
      answeredSequence: sql<number | null>`max((${emailDeliveriesTable.metadata}->>'silenceSequence')::int)`,
    })
      .from(emailDeliveriesTable)
      .where(eq(emailDeliveriesTable.emailType, DELIVERY_REPORT_RECOVERY_EMAIL_TYPE))
      .groupBy(emailDeliveriesTable.recipientEmail, providerExpr),
  ]);
  const silenceByKey = new Map(silenceHistory.map((row) => [`${row.provider}:${row.recipientEmail}`, row]));
  const answeredByKey = new Map(recoveryHistory.map((row) => [`${row.provider}:${row.recipientEmail}`, row.answeredSequence ?? 0]));

  let alreadyNotifiedCount = 0;
  const attemptedEventKeys: string[] = [];
  const notifiedProviders = new Set<DeliveryReportProvider>();
  const sends: Promise<Awaited<ReturnType<typeof sendTransactionalEmail>>>[] = [];
  for (const provider of candidates) {
    const status = statuses[provider];
    const lastEventAt = status.lastEventAt ? new Date(status.lastEventAt) : null;
    if (!lastEventAt || Number.isNaN(lastEventAt.getTime())) continue;
    const label = DELIVERY_REPORT_PROVIDER_LABELS[provider];
    const subject = `LUMERA — izveštaji o isporuci ponovo stižu (${label})`;
    const htmlContent = lumeraEmailHtml(
      "Izveštaji o isporuci ponovo stižu",
      `<p>Provajder <strong>${label}</strong> ponovo javlja status isporuke — poslednji potvrđeni izveštaj primljen je ${formatBelgradeTime(status.lastEventAt)}.</p>
      <p>Ranije upozorenje o izveštajima koji ne stižu je time razrešeno; webhook radi ispravno i nije potrebna dalja intervencija.</p>`,
    );
    for (const recipient of recipients) {
      const normalizedEmail = recipient.email.toLowerCase();
      const silence = silenceByKey.get(`${provider}:${normalizedEmail}`);
      // Never notify a recipient (or provider) that never received a silence
      // alert — there is no loop to close.
      if (!silence || !silence.alertCount) continue;
      const lastAlertAt = silence.lastAlertAtIso ? new Date(silence.lastAlertAtIso) : null;
      // A missing/unparseable anchor suppresses conservatively, and verified
      // events must have arrived strictly AFTER the newest silence alert —
      // otherwise the reports have not actually resumed since the admin was
      // warned.
      if (!lastAlertAt || Number.isNaN(lastAlertAt.getTime())) continue;
      if (lastEventAt.getTime() <= lastAlertAt.getTime()) continue;
      const sequence = silence.alertCount;
      if ((answeredByKey.get(`${provider}:${normalizedEmail}`) ?? 0) >= sequence) {
        alreadyNotifiedCount += 1;
        continue;
      }
      const recipientKey = createHash("sha256").update(normalizedEmail).digest("hex").slice(0, 16);
      // Anchored on the silence sequence: repeat ticks and racing instances
      // compute the same eventKey and the unique outbox key collapses them.
      const eventKey = `delivery-report-recovery-alert:${provider}:${recipientKey}:${sequence}`;
      attemptedEventKeys.push(eventKey);
      notifiedProviders.add(provider);
      sends.push(sendTransactionalEmail({
        eventKey,
        emailType: DELIVERY_REPORT_RECOVERY_EMAIL_TYPE,
        to: { email: recipient.email },
        subject,
        htmlContent,
        metadata: {
          provider,
          recoveredAt: now.toISOString(),
          silenceSequence: sequence,
          lastEventAt: status.lastEventAt,
        },
      }, transport));
    }
  }

  const results = await Promise.allSettled(sends);
  const failedDeliveryCount = results.filter(
    (result) => result.status === "rejected" || ("failed" in result.value && result.value.failed),
  ).length;
  const skippedDeliveryCount = results.filter(
    (result) => result.status === "fulfilled" && "skipped" in result.value && result.value.skipped,
  ).length;
  const deduplicatedCount = results.filter(
    (result) => result.status === "fulfilled" && "deduplicated" in result.value && result.value.deduplicated,
  ).length;

  const providers = [...notifiedProviders];
  if (failedDeliveryCount || skippedDeliveryCount) {
    logger.warn(
      { notifiedProviders: providers, recipientCount: recipients.length, alreadyNotifiedCount, failedDeliveryCount, skippedDeliveryCount },
      "Delivery-report recovery notice delivery did not complete for every administrator",
    );
  } else if (attemptedEventKeys.length && deduplicatedCount < results.length) {
    // Only log when something new actually went out — an already-answered or
    // fully deduplicated tick is the steady state after a recovery.
    logger.info(
      { notifiedProviders: providers, recipientCount: recipients.length, alreadyNotifiedCount },
      "Delivery-report recovery notice delivery queued",
    );
  }
  return {
    notifiedProviders: providers,
    recipientCount: recipients.length,
    attemptedEventKeys,
    alreadyNotifiedCount,
    failedDeliveryCount,
    skippedDeliveryCount,
  };
}
