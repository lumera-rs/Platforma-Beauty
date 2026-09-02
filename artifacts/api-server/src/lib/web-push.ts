import { createECDH, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import webPush from "web-push";
import {
  db,
  appointmentsTable,
  pushSubscriptionsTable,
  systemPushDeliveriesTable,
  type SystemPushPayload,
} from "@workspace/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { logger } from "./logger";
import { integrationSettings } from "./integrations";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbExecutor = typeof db | Transaction;

export type WebPushConfiguration =
  | { configured: false; publicKey: null; reason: string }
  | { configured: true; publicKey: string; subject: string; privateKey: string };

export function parseWebPushConfiguration(values: {
  publicKey?: string;
  privateKey?: string;
  subject?: string;
}): WebPushConfiguration {
  const publicKey = values.publicKey?.trim();
  const privateKey = values.privateKey?.trim();
  const subject = values.subject?.trim();
  const missing = [
    !publicKey && "publicKey",
    !privateKey && "privateKey",
    !subject && "subject",
  ].filter(Boolean);
  if (missing.length) return { configured: false, publicKey: null, reason: `Missing ${missing.join(", ")}` };
  let subjectUrl: URL;
  try {
    subjectUrl = new URL(subject!);
  } catch {
    return { configured: false, publicKey: null, reason: "subject must be a valid mailto: or https: URI" };
  }
  if (
    (subjectUrl.protocol !== "mailto:" && subjectUrl.protocol !== "https:")
    || (subjectUrl.protocol === "mailto:" && (!subjectUrl.pathname.includes("@") || Boolean(subjectUrl.search) || Boolean(subjectUrl.hash)))
    || (subjectUrl.protocol === "https:" && (!subjectUrl.hostname || Boolean(subjectUrl.username) || Boolean(subjectUrl.password)))
  ) {
    return { configured: false, publicKey: null, reason: "subject must be a valid mailto: or https: URI" };
  }
  try {
    const publicBytes = Buffer.from(publicKey!, "base64url");
    const privateBytes = Buffer.from(privateKey!, "base64url");
    if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) throw new Error();
    if (publicBytes.toString("base64url") !== publicKey || privateBytes.toString("base64url") !== privateKey) throw new Error();
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(privateBytes);
    if (!ecdh.getPublicKey().equals(publicBytes)) {
      return { configured: false, publicKey: null, reason: "publicKey and privateKey do not belong to the same VAPID key pair" };
    }
  } catch {
    return { configured: false, publicKey: null, reason: "publicKey or privateKey is not a valid VAPID key" };
  }
  return { configured: true, publicKey: publicKey!, privateKey: privateKey!, subject: subject! };
}

export function webPushEnvironmentConfiguration(env: NodeJS.ProcessEnv = process.env): WebPushConfiguration {
  return parseWebPushConfiguration({
    publicKey: env["VAPID_PUBLIC_KEY"],
    privateKey: env["VAPID_PRIVATE_KEY"],
    subject: env["VAPID_SUBJECT"],
  });
}

export function resolveWebPushConfiguration(
  settings: { configuredInDatabase: boolean; enabled: boolean; values: Record<string, string> },
  env: NodeJS.ProcessEnv = process.env,
): WebPushConfiguration {
  if (settings.configuredInDatabase && !settings.enabled) {
    return { configured: false, publicKey: null, reason: "Web Push integration is disabled" };
  }
  return parseWebPushConfiguration({
    publicKey: env["VAPID_PUBLIC_KEY"],
    privateKey: env["VAPID_PRIVATE_KEY"],
    subject: env["VAPID_SUBJECT"],
    ...settings.values,
  });
}

export async function webPushConfiguration(env: NodeJS.ProcessEnv = process.env): Promise<WebPushConfiguration> {
  const settings = await integrationSettings("web_push");
  return resolveWebPushConfiguration(settings, env);
}

export function publicWebPushConfiguration(configuration: WebPushConfiguration) {
  return configuration.configured
    ? { configured: true as const, publicKey: configuration.publicKey }
    : { configured: false as const, publicKey: null };
}

export function validatePushSubscription(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}) {
  if (input.endpoint.length > 4096 || input.keys.p256dh.length > 1024 || input.keys.auth.length > 512) {
    throw new Error("Push subscription is too large.");
  }
  const endpoint = new URL(input.endpoint);
  if (endpoint.protocol !== "https:") throw new Error("Push endpoint must use HTTPS.");
  const hostname = endpoint.hostname.toLowerCase();
  const supportedProvider = hostname === "fcm.googleapis.com"
    || hostname === "updates.push.services.mozilla.com"
    || hostname === "push.services.mozilla.com"
    || hostname === "web.push.apple.com"
    || hostname.endsWith(".notify.windows.com");
  if (!supportedProvider) throw new Error("Push endpoint provider is not supported.");
}

export async function enqueueSystemPushDeliveries(
  executor: DbExecutor,
  input: { userId: string; eventKey: string; payload: SystemPushPayload; expiresAt: Date },
) {
  const subscriptions = await executor.select({ id: pushSubscriptionsTable.id })
    .from(pushSubscriptionsTable)
    .where(and(eq(pushSubscriptionsTable.userId, input.userId), eq(pushSubscriptionsTable.enabled, true)));
  if (!subscriptions.length) return 0;
  const created = await executor.insert(systemPushDeliveriesTable).values(subscriptions.map((subscription) => ({
    eventKey: input.eventKey,
    subscriptionId: subscription.id,
    userId: input.userId,
    payload: input.payload,
    expiresAt: input.expiresAt,
  }))).onConflictDoNothing().returning({ id: systemPushDeliveriesTable.id });
  return created.length;
}

type ClaimedDelivery = {
  id: string;
  claim_token: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  payload: SystemPushPayload;
  attempt_count: number;
};

async function claimOne(now: Date): Promise<ClaimedDelivery | undefined> {
  const token = randomUUID();
  const claimExpiresAt = new Date(now.getTime() + 2 * 60_000);
  const result = await db.execute<ClaimedDelivery>(sql`
    WITH candidate AS (
      SELECT d.id
      FROM system_push_deliveries d
      JOIN push_subscriptions s ON s.id = d.subscription_id
      WHERE s.enabled = true
        AND d.next_attempt_at <= ${now}
        AND d.expires_at > ${now}
        AND (
          d.status = 'queued'
          OR (d.status = 'processing' AND d.claim_expires_at < ${now})
        )
      ORDER BY d.next_attempt_at, d.created_at, d.id
      FOR UPDATE OF d SKIP LOCKED
      LIMIT 1
    )
    UPDATE system_push_deliveries d
    SET status = 'processing', claim_token = ${token}, claimed_at = ${now},
        claim_expires_at = ${claimExpiresAt}, updated_at = ${now}
    FROM candidate, push_subscriptions s
    WHERE d.id = candidate.id AND s.id = d.subscription_id
    RETURNING d.id, d.claim_token, d.subscription_id, s.endpoint, s.p256dh,
      s.auth, d.payload, d.attempt_count
  `);
  return result.rows[0];
}

async function expireStaleDeliveries(now: Date) {
  await db.update(systemPushDeliveriesTable).set({
    status: "failed",
    lastError: "Reminder expired before delivery.",
    claimToken: null,
    claimedAt: null,
    claimExpiresAt: null,
    updatedAt: now,
  }).where(sql`${systemPushDeliveriesTable.status} IN ('queued', 'processing')
    AND ${systemPushDeliveriesTable.expiresAt} <= ${now}`);
}

async function reminderIsStillCurrent(delivery: ClaimedDelivery) {
  if (!delivery.payload.tag.startsWith("appointment-reminder:")) return true;
  const schedules = delivery.payload.data?.["appointmentSchedules"];
  if (!Array.isArray(schedules) || schedules.length === 0) return false;
  const expected = new Map<string, { date: string; startTime: string }>();
  for (const value of schedules) {
    if (!value || typeof value !== "object") return false;
    const id = Reflect.get(value, "id");
    const date = Reflect.get(value, "date");
    const startTime = Reflect.get(value, "startTime");
    if (typeof id !== "string" || typeof date !== "string" || typeof startTime !== "string") return false;
    expected.set(id, { date, startTime });
  }
  const appointments = await db.select({
    id: appointmentsTable.id,
    status: appointmentsTable.status,
    date: appointmentsTable.date,
    startTime: appointmentsTable.startTime,
  }).from(appointmentsTable).where(inArray(appointmentsTable.id, [...expected.keys()]));
  return appointments.length === expected.size && appointments.every((appointment) => {
    const schedule = expected.get(appointment.id);
    return appointment.status === "confirmed"
      && appointment.date === schedule?.date
      && appointment.startTime === schedule.startTime;
  });
}

function providerStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const status = Reflect.get(error, "statusCode");
  return typeof status === "number" ? status : null;
}

function safeProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https:\/\/\S+/g, "<push-endpoint>").slice(0, 1000);
}

export function systemPushRetry(attemptCount: number, status: number | null) {
  const retryable = status === null || status === 408 || status === 429 || status >= 500;
  const willRetry = retryable && attemptCount < 8;
  const backoffMs = Math.min(6 * 60 * 60_000, 30_000 * 2 ** Math.min(Math.max(0, attemptCount - 1), 10));
  return { willRetry, backoffMs };
}

export function systemPushAcknowledgementToken(deliveryId: string, secret = process.env["SESSION_SECRET"]) {
  if (!secret) throw new Error("SESSION_SECRET is required for Web Push delivery acknowledgements.");
  return createHmac("sha256", secret)
    .update(`system-push-delivery-ack:v1:${deliveryId}`)
    .digest("base64url");
}

export async function acknowledgeSystemPushDelivery(deliveryId: string, token: string) {
  const expected = Buffer.from(systemPushAcknowledgementToken(deliveryId));
  const supplied = Buffer.from(token);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false;
  const [acknowledged] = await db.update(systemPushDeliveriesTable).set({
    acknowledgedAt: sql`now()`,
    updatedAt: sql`greatest(${systemPushDeliveriesTable.updatedAt}, now())`,
  }).where(and(
    eq(systemPushDeliveriesTable.id, deliveryId),
    isNull(systemPushDeliveriesTable.acknowledgedAt),
  )).returning({ id: systemPushDeliveriesTable.id });
  return Boolean(acknowledged);
}

export async function webPushDeliveryMetrics(periodDays: 1 | 7 | 30 | 90, now = new Date()) {
  const periodStartedAt = new Date(now.getTime() - periodDays * 24 * 60 * 60_000);
  const result = await db.execute<{
    sent: number;
    acknowledged: number;
    failed: number;
    retried: number;
    pending: number;
    expired_or_changed: number;
    provider_errors: number;
    active_devices: number;
    automatically_deactivated: number;
  }>(sql`
    WITH delivery_metrics AS (
      SELECT
        count(*) FILTER (WHERE status = 'sent')::int AS sent,
        count(*) FILTER (WHERE acknowledged_at IS NOT NULL)::int AS acknowledged,
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        coalesce(sum(greatest(attempt_count - 1, 0)), 0)::int AS retried,
        count(*) FILTER (WHERE status IN ('queued', 'processing'))::int AS pending,
        count(*) FILTER (
          WHERE status = 'failed'
            AND last_error IN (
              'Reminder expired before delivery.',
              'Reminder source changed before delivery.'
            )
        )::int AS expired_or_changed,
        count(*) FILTER (
          WHERE status = 'failed'
            AND (
              last_error IS NULL
              OR last_error NOT IN (
                'Reminder expired before delivery.',
                'Reminder source changed before delivery.'
              )
            )
        )::int AS provider_errors
      FROM system_push_deliveries
      WHERE created_at >= ${periodStartedAt}
    ),
    device_metrics AS (
      SELECT
        count(*) FILTER (WHERE enabled = true)::int AS active_devices,
        count(*) FILTER (
          WHERE enabled = false
            AND disabled_at >= ${periodStartedAt}
            AND disabled_reason IN ('provider_404', 'provider_410')
        )::int AS automatically_deactivated
      FROM push_subscriptions
    )
    SELECT delivery_metrics.*, device_metrics.*
    FROM delivery_metrics
    CROSS JOIN device_metrics
  `);
  const row = result.rows[0]!;
  return {
    periodDays,
    periodStartedAt,
    deliveries: {
      sent: row.sent,
      acknowledged: row.acknowledged,
      failed: row.failed,
      retried: row.retried,
      pending: row.pending,
      expiredOrChanged: row.expired_or_changed,
      providerErrors: row.provider_errors,
    },
    devices: {
      active: row.active_devices,
      automaticallyDeactivated: row.automatically_deactivated,
    },
  };
}

let configurationWarningWritten = false;

export async function runSystemPushWorker(options: { batchSize?: number; now?: Date } = {}) {
  // Resolve exactly once so every delivery in this batch uses one coherent
  // public/private/subject snapshot even if an administrator saves mid-run.
  const configuration = await webPushConfiguration();
  if (!configuration.configured) {
    if (!configurationWarningWritten) {
      configurationWarningWritten = true;
      logger.warn({ reason: configuration.reason }, "System push worker skipped because VAPID is not configured");
    }
    return { processed: 0, sent: 0, retried: 0, failed: 0, disabled: 0, skipped: true as const };
  }
  webPush.setVapidDetails(configuration.subject, configuration.publicKey, configuration.privateKey);
  const result = { processed: 0, sent: 0, retried: 0, failed: 0, disabled: 0, skipped: false as const };
  const batchSize = Math.max(1, Math.min(250, Math.floor(options.batchSize ?? 100)));
  await expireStaleDeliveries(options.now ?? new Date());
  for (let index = 0; index < batchSize; index++) {
    const now = options.now ?? new Date();
    const delivery = await claimOne(now);
    if (!delivery) break;
    result.processed++;
    if (!(await reminderIsStillCurrent(delivery))) {
      await db.update(systemPushDeliveriesTable).set({
        status: "failed",
        attemptCount: delivery.attempt_count,
        lastError: "Reminder source changed before delivery.",
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        updatedAt: now,
      }).where(and(eq(systemPushDeliveriesTable.id, delivery.id), eq(systemPushDeliveriesTable.claimToken, delivery.claim_token)));
      result.failed++;
      continue;
    }
    try {
      const response = await webPush.sendNotification({
        endpoint: delivery.endpoint,
        keys: { p256dh: delivery.p256dh, auth: delivery.auth },
      }, JSON.stringify({
        ...delivery.payload,
        deliveryReceipt: {
          deliveryId: delivery.id,
          token: systemPushAcknowledgementToken(delivery.id),
        },
      }), { TTL: 60 * 60, urgency: "high" });
      await db.update(systemPushDeliveriesTable).set({
        status: "sent", attemptCount: delivery.attempt_count + 1, lastAttemptAt: now,
        lastHttpStatus: response.statusCode, lastError: null, sentAt: now,
        claimToken: null, claimedAt: null, claimExpiresAt: null, updatedAt: now,
      }).where(and(eq(systemPushDeliveriesTable.id, delivery.id), eq(systemPushDeliveriesTable.claimToken, delivery.claim_token)));
      result.sent++;
    } catch (error) {
      const status = providerStatus(error);
      const attemptCount = delivery.attempt_count + 1;
      if (status === 404 || status === 410) {
        await db.transaction(async (tx) => {
          await tx.update(pushSubscriptionsTable).set({
            enabled: false, disabledAt: now, disabledReason: `provider_${status}`, updatedAt: now,
          }).where(eq(pushSubscriptionsTable.id, delivery.subscription_id));
          await tx.update(systemPushDeliveriesTable).set({
            status: "failed", attemptCount, lastAttemptAt: now, lastHttpStatus: status,
            lastError: `Subscription rejected by provider (${status}).`,
            claimToken: null, claimedAt: null, claimExpiresAt: null, updatedAt: now,
          }).where(and(eq(systemPushDeliveriesTable.id, delivery.id), eq(systemPushDeliveriesTable.claimToken, delivery.claim_token)));
        });
        result.disabled++;
        result.failed++;
        continue;
      }
      const { willRetry, backoffMs } = systemPushRetry(attemptCount, status);
      await db.update(systemPushDeliveriesTable).set({
        status: willRetry ? "queued" : "failed", attemptCount, lastAttemptAt: now,
        lastHttpStatus: status, lastError: safeProviderError(error),
        nextAttemptAt: willRetry ? new Date(now.getTime() + backoffMs) : now,
        claimToken: null, claimedAt: null, claimExpiresAt: null, updatedAt: now,
      }).where(and(eq(systemPushDeliveriesTable.id, delivery.id), eq(systemPushDeliveriesTable.claimToken, delivery.claim_token)));
      if (willRetry) result.retried++;
      else result.failed++;
    }
  }
  return result;
}