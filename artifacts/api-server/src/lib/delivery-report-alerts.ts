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
 * webhook does not prevent the alert from sending.
 *
 * Total-email-outage fallback: every silence alert travels over Brevo's SEND
 * API regardless of WHICH provider's delivery reports went silent — so if
 * Brevo sending is down too, the alert emails about ANY stale provider fail
 * (or are skipped) and admins would only find out from the dashboard. In
 * exactly that case — at least one alert email about a stale provider was
 * attempted this tick AND every attempted one for that provider failed or
 * was skipped — a fallback SMS (via Infobip, when the SMS integration is
 * configured) naming the affected provider(s) goes to administrators who have
 * a phone number on file. Providers that trip in the same run share one SMS.
 * Rate limiting is inherited from the email path: email attempts only happen
 * once per rolling cooldown window (cooldown-suppressed ticks attempt
 * nothing, so the fallback is never even evaluated), and the SMS outbox
 * eventKey embeds the same per-window alert SEQUENCE, so racing instances
 * and repeats collapse onto the same unique sms_deliveries row. The fallback
 * never fires when the primary email path worked (sent or deduplicated by a
 * racing instance that will evaluate its own outcomes).
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
import { and, asc, eq, inArray, sql } from "drizzle-orm";
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
import { sendSms, type SmsProvider } from "./sms";

const DELIVERY_REPORT_ALERT_EMAIL_TYPE = "delivery_report_silence_alert";

/** Outbox eventKey prefix of the total-email-outage fallback SMS. */
export const DELIVERY_REPORT_ALERT_SMS_EVENT_PREFIX = "delivery-report-silence-alert-sms";
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

/** True when this phone value can actually receive the fallback SMS. */
function hasUsablePhone(phone: string | null): phone is string {
  return !!phone && phone.trim().length > 0;
}

/** The active administrator audience shared by fallback sends and its UI. */
function smsFallbackAdminAudiencePredicate() {
  return and(
    eq(usersTable.active, true),
    inArray(usersTable.role, ["ADMIN", "SUPER_ADMIN"]),
  );
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
  /** Optional SMS provider override for the fallback path — used in tests. */
  smsProvider?: SmsProvider,
): Promise<{
  staleProviders: DeliveryReportProvider[];
  recipientCount: number;
  attemptedEventKeys: string[];
  cooldownSuppressedCount: number;
  failedDeliveryCount: number;
  skippedDeliveryCount: number;
  smsFallback: SmsFallbackSummary;
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
    smsFallback: emptySmsFallbackSummary(),
  };
  if (!staleProviders.length) return empty;

  const recipients = await db.select({ email: usersTable.email, phone: usersTable.phone })
    .from(usersTable)
    .where(smsFallbackAdminAudiencePredicate());
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
  const sends: {
    provider: DeliveryReportProvider;
    sequence: number;
    promise: Promise<Awaited<ReturnType<typeof sendTransactionalEmail>>>;
  }[] = [];
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
      sends.push({
        provider,
        sequence,
        promise: sendTransactionalEmail({
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
        }, transport),
      });
    }
  }

  const results = await Promise.allSettled(sends.map((send) => send.promise));
  const emailFailedOrSkipped = (result: (typeof results)[number]) =>
    result.status === "rejected"
    || ("failed" in result.value && result.value.failed)
    || ("skipped" in result.value && result.value.skipped);
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

  // ── Total-email-outage SMS fallback (every stale provider) ────────────────
  // Every silence alert email travels over Brevo's own SEND API, no matter
  // which provider's delivery reports went silent. If EVERY alert email
  // attempted about some stale provider this tick failed or was skipped,
  // email sending itself is down and admins would never see that warning —
  // page them over the independent SMS channel instead, naming the affected
  // provider. `deduplicated` and in-flight outcomes do NOT count as failures
  // (a racing instance owns that delivery and evaluates its own fallback), so
  // the fallback fires only when the primary email path actually failed.
  // Several providers can trip in the same run; combine those pages so an
  // administrator receives one SMS naming the whole affected provider set.
  let smsFallback = emptySmsFallbackSummary();
  const fallbackProviders: DeliveryReportProvider[] = [];
  const fallbackSequences: { provider: DeliveryReportProvider; sequence: number }[] = [];
  for (const provider of staleProviders) {
    const providerResults = results.filter((_, index) => sends[index]?.provider === provider);
    if (!providerResults.length || !providerResults.every(emailFailedOrSkipped)) continue;
    const providerSequences = sends
      .filter((send) => send.provider === provider)
      .map((send) => send.sequence);
    fallbackProviders.push(provider);
    // The highest alert sequence attempted this tick identifies the current
    // cooldown window deterministically across racing instances (they read
    // the same history), so their SMS eventKeys collide in the outbox.
    fallbackSequences.push({ provider, sequence: Math.max(...providerSequences) });
  }
  if (fallbackProviders.length) {
    smsFallback = await sendSilenceAlertSmsFallback({
      providers: fallbackProviders,
      sequences: fallbackSequences,
      admins: recipients,
      smsProvider,
    });
  }

  return {
    staleProviders,
    recipientCount: recipients.length,
    attemptedEventKeys,
    cooldownSuppressedCount,
    failedDeliveryCount,
    skippedDeliveryCount,
    smsFallback,
  };
}

export interface SmsFallbackSummary {
  /** True when some stale provider's alert email failed/skipped for every attempted recipient. */
  triggered: boolean;
  /** Administrators with a phone number on file (fallback audience). */
  recipientCount: number;
  attemptedEventKeys: string[];
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  deduplicatedCount: number;
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
    .where(smsFallbackAdminAudiencePredicate());
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

function emptySmsFallbackSummary(): SmsFallbackSummary {
  return {
    triggered: false,
    recipientCount: 0,
    attemptedEventKeys: [],
    sentCount: 0,
    failedCount: 0,
    skippedCount: 0,
    deduplicatedCount: 0,
  };
}

/**
 * Page administrators over SMS because the silence-alert email about a stale
 * provider could not be sent to anyone (total email outage). Reuses the
 * durable SMS outbox (sendSms): the eventKey embeds the affected provider set
 * and the alert sequence(s) of the current cooldown window, so repeats and
 * racing instances collapse onto one unique sms_deliveries row per admin per
 * affected provider set per window — the fallback can never spam.
 * Never throws — individual send outcomes are tallied and logged.
 */
async function sendSilenceAlertSmsFallback(input: {
  providers: DeliveryReportProvider[];
  sequences: { provider: DeliveryReportProvider; sequence: number }[];
  admins: { email: string; phone: string | null }[];
  smsProvider?: SmsProvider;
}): Promise<SmsFallbackSummary> {
  const providers = (["brevo", "infobip"] as const).filter((provider) =>
    input.providers.includes(provider),
  );
  const sequencesByProvider = new Map(input.sequences.map((entry) => [entry.provider, entry.sequence]));
  const labels = providers.map((provider) => DELIVERY_REPORT_PROVIDER_LABELS[provider]).join(", ");
  const providerSetKey = providers.join("+");
  const sequenceKey = providers.length === 1
    ? String(sequencesByProvider.get(providers[0]))
    : providers.map((provider) => `${provider}-${sequencesByProvider.get(provider)}`).join("+");
  const phoneAdmins = input.admins.filter(
    (admin): admin is { email: string; phone: string } => hasUsablePhone(admin.phone),
  );
  if (!phoneAdmins.length) {
    logger.warn(
      { providers, sequences: input.sequences },
      "Delivery-report silence alert email failed for every administrator and no administrator has a phone number for the SMS fallback",
    );
    return { ...emptySmsFallbackSummary(), triggered: true };
  }

  const text = `LUMERA upozorenje: izveštaji o isporuci ne stižu (${labels}), a upozorenje e-poštom nije moglo da se pošalje (slanje e-pošte ne radi). Proverite Integracije u admin panelu.`;
  const attemptedEventKeys: string[] = [];
  const sends = phoneAdmins.map((admin) => {
    const recipientKey = createHash("sha256")
      .update(admin.phone.replace(/\s+/g, ""))
      .digest("hex")
      .slice(0, 16);
    // Keep the single-provider key byte-for-byte compatible. For a combined
    // incident, the canonical provider set and all provider sequences make
    // the key unique to this exact cooldown window while racing runs collide.
    const eventKey = providers.length === 1
      ? `${DELIVERY_REPORT_ALERT_SMS_EVENT_PREFIX}:${providers[0]}:${recipientKey}:${sequenceKey}`
      : `${DELIVERY_REPORT_ALERT_SMS_EVENT_PREFIX}:${providerSetKey}:${recipientKey}:${sequenceKey}`;
    attemptedEventKeys.push(eventKey);
    return sendSms({
      eventKey,
      salonId: null,
      appointmentId: null,
      type: "admin_alert",
      phone: admin.phone,
      text,
    }, input.smsProvider);
  });
  const results = await Promise.allSettled(sends);

  const has = (key: "skipped" | "deduplicated" | "failed") => (result: (typeof results)[number]) =>
    result.status === "fulfilled" && key in result.value && (result.value as Record<string, unknown>)[key] === true;
  const summary: SmsFallbackSummary = {
    triggered: true,
    recipientCount: phoneAdmins.length,
    attemptedEventKeys,
    sentCount: results.filter(
      (result) => result.status === "fulfilled" && "messageId" in result.value,
    ).length,
    failedCount: results.filter(
      (result) => result.status === "rejected" || has("failed")(result),
    ).length,
    skippedCount: results.filter(has("skipped")).length,
    deduplicatedCount: results.filter(has("deduplicated")).length,
  };

  if (summary.failedCount || summary.skippedCount) {
    logger.warn(
      { providers, sequences: input.sequences, ...summary, attemptedEventKeys: undefined },
      "Delivery-report silence SMS fallback did not reach every administrator",
    );
  } else if (summary.sentCount) {
    logger.warn(
      { providers, sequences: input.sequences, recipientCount: summary.recipientCount, sentCount: summary.sentCount },
      "Delivery-report silence alert emails all failed — SMS fallback sent to administrators",
    );
  }
  return summary;
}

/**
 * The active administrators the total-email-outage SMS fallback could
 * actually reach. Uses the exact same audience (active ADMIN/SUPER_ADMIN) and
 * phone predicate as the fallback send path, so the admin-panel audience list
 * can never disagree with what the fallback would really do. Only the names
 * needed for coordination are returned; phone numbers and email addresses
 * stay server-side.
 *
 * The stable name ordering keeps the admin panel readable without exposing
 * another private account field just to sort the response.
 */
export interface SmsFallbackReachableAdmin {
  firstName: string;
  lastName: string;
}
/**
 * How many active administrators the total-email-outage SMS fallback could
 * actually reach. Keep this derived from the same audience-list helper so
 * count and names cannot drift apart.
 */
export async function smsFallbackReachableAdminCount(): Promise<number> {
  return (await smsFallbackReachableAdmins()).length;
}

export async function smsFallbackReachableAdmins(): Promise<SmsFallbackReachableAdmin[]> {
  const names = await db.select({
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    phone: usersTable.phone,
  })
    .from(usersTable)
    .where(smsFallbackAdminAudiencePredicate())
    .orderBy(asc(usersTable.lastName), asc(usersTable.firstName));
  return names
    .filter((admin) => hasUsablePhone(admin.phone))
    .map(({ firstName, lastName }) => ({ firstName, lastName }));
}
