/**
 * Provider delivery-event processing (Brevo email + Infobip SMS webhooks).
 *
 * Security model:
 *   - Each provider webhook URL embeds a shared secret path token that the
 *     administrator configures both here (integration setting `webhookSecret`,
 *     env fallback) and at the provider when registering the webhook URL.
 *     Neither Brevo transactional webhooks nor Infobip delivery reports sign
 *     payloads natively, so the capability-URL token IS the signature: requests
 *     are verified with a timing-safe comparison and rejected (401) otherwise.
 *   - When no secret is configured the endpoints reject everything (503) —
 *     events are never accepted unauthenticated.
 *
 * Idempotency / replay model (first-write-wins, monotonic):
 *   - `delivered` sets deliveredAt only when it is still NULL.
 *   - `opened` sets openedAt only when it is still NULL (and backfills
 *     deliveredAt — an opened message was necessarily delivered).
 *   - `failed` sets failedAt only when the delivery has not already been
 *     delivered/opened/failed; delivery confirmation always wins over an
 *     out-of-order failure event.
 *   - A replayed event therefore matches zero rows and reports `duplicate`;
 *     state (including the originally recorded timestamps) never changes.
 *   - Webhooks NEVER touch automation_deliveries.status: flipping it back to a
 *     claimable state could make the worker resend an accepted message.
 *
 * Tenant isolation: events are matched exclusively by the globally-unique
 * provider message reference of a previously persisted outbound send. The
 * matched row carries its own salonId, so an event can never cross salons.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import {
  automationDeliveriesTable,
  db,
  emailDeliveriesTable,
  providerWebhookReceiptsTable,
  smsDeliveriesTable,
} from "@workspace/db";
import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { integrationSettings, type IntegrationName } from "./integrations";

// ---------------------------------------------------------------------------
// Webhook secret resolution + verification
// ---------------------------------------------------------------------------

export type WebhookProvider = "brevo" | "sms";

const WEBHOOK_SECRET_ENV: Record<WebhookProvider, string> = {
  brevo: "BREVO_WEBHOOK_SECRET",
  sms: "SMS_WEBHOOK_SECRET",
};

/**
 * Resolve the configured webhook secret for a provider. Reads the encrypted
 * integration setting `webhookSecret` with an environment fallback. This
 * intentionally ignores the integration `enabled` flag: delivery reports for
 * already-sent messages may arrive after an admin disables outbound sending,
 * and a configured secret must keep authenticating (or rejecting) them.
 */
export async function resolveWebhookSecret(provider: WebhookProvider): Promise<string | undefined> {
  const settings = await integrationSettings(provider as IntegrationName);
  return settings.values["webhookSecret"] ?? process.env[WEBHOOK_SECRET_ENV[provider]] ?? undefined;
}

/** Timing-safe token comparison (hash both sides to equalize lengths). */
export function webhookTokenMatches(expected: string, provided: string): boolean {
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Delivery-report receipt tracking (webhook freshness monitoring)
// ---------------------------------------------------------------------------

/** Delivery-report provider keys as shown to admins (webhook path names). */
export type DeliveryReportProvider = "brevo" | "infobip";

/** Automation sends within this window are considered "recent" for warnings. */
export const DELIVERY_REPORT_WINDOW_HOURS = 24;
/**
 * Sends younger than this are not expected to have produced events yet —
 * providers need a little time to attempt delivery and call the webhook.
 */
export const DELIVERY_REPORT_GRACE_MINUTES = 30;

/**
 * Record that a verified webhook request with at least one parseable event
 * was accepted for this provider. Monotonic (GREATEST) so concurrent or
 * replayed recordings can never move the timestamp backwards. Monitoring
 * metadata only — callers treat failures as non-fatal so a tracking hiccup
 * can never change webhook response semantics.
 */
export async function recordWebhookReceipt(provider: DeliveryReportProvider, at = new Date()): Promise<void> {
  await db.insert(providerWebhookReceiptsTable)
    .values({ provider, lastEventAt: at, updatedAt: at })
    .onConflictDoUpdate({
      target: providerWebhookReceiptsTable.provider,
      set: {
        lastEventAt: sql`greatest(${providerWebhookReceiptsTable.lastEventAt}, excluded.last_event_at)`,
        updatedAt: at,
      },
    });
}

export interface DeliveryReportStatus {
  /** Server receipt time of the last accepted verified event (ISO), or null if never. */
  lastEventAt: string | null;
  /** Most recent automation send on this provider's channel within the window (ISO). */
  lastAutomationSentAt: string | null;
  /** Automation sends on this provider's channel within the window. */
  recentSendCount: number;
  /** True when recent sends exist but no event has arrived since the newest grace-aged send. */
  warning: boolean;
}

/**
 * Pure warning decision: warn when at least one automation send is old enough
 * that its delivery report should have arrived (grace-aged, within the recent
 * window) and no verified event has been received since that send. A healthy
 * webhook produces delivered/bounce events within minutes of every send, so
 * "newest qualifying send with zero events after it" is the silence signal.
 */
export function deliveryReportWarning(input: {
  lastEventAt: Date | null;
  lastQualifyingSentAt: Date | null;
}): boolean {
  if (!input.lastQualifyingSentAt) return false;
  return !input.lastEventAt || input.lastEventAt.getTime() < input.lastQualifyingSentAt.getTime();
}

/** Normalize a driver-returned timestamp (Date or string) to Date. */
function asDate(value: unknown): Date | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Per-provider delivery-report freshness for the admin integrations page.
 * Compares recent automation sends (per channel) with the last accepted
 * verified webhook event per provider. Read-only monitoring — no effect on
 * webhook authentication or delivery-state transitions.
 */
export async function deliveryReportStatuses(now = new Date()): Promise<Record<DeliveryReportProvider, DeliveryReportStatus>> {
  const windowStart = new Date(now.getTime() - DELIVERY_REPORT_WINDOW_HOURS * 60 * 60 * 1000);
  const graceCutoff = new Date(now.getTime() - DELIVERY_REPORT_GRACE_MINUTES * 60 * 1000);

  const [receipts, sends] = await Promise.all([
    db.select({
      provider: providerWebhookReceiptsTable.provider,
      lastEventAt: providerWebhookReceiptsTable.lastEventAt,
    }).from(providerWebhookReceiptsTable),
    db.select({
      channel: automationDeliveriesTable.channel,
      recentSendCount: sql<number>`count(*)::int`,
      lastSentAt: sql<unknown>`max(${automationDeliveriesTable.sentAt})`,
      lastQualifyingSentAt: sql<unknown>`max(${automationDeliveriesTable.sentAt}) filter (where ${automationDeliveriesTable.sentAt} <= ${graceCutoff})`,
    })
      .from(automationDeliveriesTable)
      .where(and(
        eq(automationDeliveriesTable.status, "sent"),
        isNotNull(automationDeliveriesTable.sentAt),
        gte(automationDeliveriesTable.sentAt, windowStart),
      ))
      .groupBy(automationDeliveriesTable.channel),
  ]);

  const receiptByProvider = new Map(receipts.map((row) => [row.provider, row.lastEventAt]));
  const sendsByChannel = new Map(sends.map((row) => [row.channel, row]));
  const channelForProvider: Record<DeliveryReportProvider, "email" | "sms"> = { brevo: "email", infobip: "sms" };

  const status = (provider: DeliveryReportProvider): DeliveryReportStatus => {
    const lastEventAt = receiptByProvider.get(provider) ?? null;
    const channelSends = sendsByChannel.get(channelForProvider[provider]);
    const lastSentAt = asDate(channelSends?.lastSentAt);
    const lastQualifyingSentAt = asDate(channelSends?.lastQualifyingSentAt);
    return {
      lastEventAt: lastEventAt ? lastEventAt.toISOString() : null,
      lastAutomationSentAt: lastSentAt ? lastSentAt.toISOString() : null,
      recentSendCount: channelSends?.recentSendCount ?? 0,
      warning: deliveryReportWarning({ lastEventAt, lastQualifyingSentAt }),
    };
  };

  return { brevo: status("brevo"), infobip: status("infobip") };
}

// ---------------------------------------------------------------------------
// Event outcome accounting
// ---------------------------------------------------------------------------

export type ProviderEventOutcome =
  | "updated"    // matched an automation delivery and changed state
  | "duplicate"  // matched, but state was already recorded (replay / out-of-order)
  | "unmatched"  // no automation delivery corresponds to this message reference
  | "ignored";   // event type carries no delivery-state information

export interface WebhookSummary {
  processed: number;
  updated: number;
  duplicates: number;
  unmatched: number;
  ignored: number;
  invalid: number;
}

export function emptySummary(): WebhookSummary {
  return { processed: 0, updated: 0, duplicates: 0, unmatched: 0, ignored: 0, invalid: 0 };
}

function tally(summary: WebhookSummary, outcome: ProviderEventOutcome) {
  summary.processed += 1;
  if (outcome === "updated") summary.updated += 1;
  else if (outcome === "duplicate") summary.duplicates += 1;
  else if (outcome === "unmatched") summary.unmatched += 1;
  else summary.ignored += 1;
}

// ---------------------------------------------------------------------------
// Idempotent, monotonic state transitions on automation_deliveries
// ---------------------------------------------------------------------------

type DeliveryEventKind = "delivered" | "opened" | "failed";

/**
 * Clamp a provider timestamp: use it when plausible, otherwise fall back to
 * `now`. Future-dated events (clock skew / forgery) are clamped to now so a
 * replayed forged timestamp cannot park state in the future.
 */
function eventTime(raw: Date | null, now: Date): Date {
  if (!raw || Number.isNaN(raw.getTime())) return now;
  return raw.getTime() > now.getTime() ? now : raw;
}

/**
 * Apply one delivery-state event to the automation delivery identified by its
 * channel event key. All transitions are guarded UPDATEs — a replay or an
 * out-of-order regression matches zero rows and is reported as `duplicate`.
 */
async function applyDeliveryState(
  channelEventKey: string,
  channel: "email" | "sms",
  kind: DeliveryEventKind,
  occurredAt: Date | null,
  failureReason?: string,
  now = new Date(),
): Promise<ProviderEventOutcome> {
  const at = eventTime(occurredAt, now);
  const scope = and(
    eq(automationDeliveriesTable.eventKey, channelEventKey),
    eq(automationDeliveriesTable.channel, channel),
  );

  if (kind === "delivered") {
    const updated = await db.update(automationDeliveriesTable)
      .set({ deliveredAt: at, failedAt: null })
      .where(and(scope, isNull(automationDeliveriesTable.deliveredAt)))
      .returning({ id: automationDeliveriesTable.id });
    if (updated.length) return "updated";
  } else if (kind === "opened") {
    const updated = await db.update(automationDeliveriesTable)
      .set({
        openedAt: at,
        deliveredAt: sql`coalesce(${automationDeliveriesTable.deliveredAt}, ${at})`,
        failedAt: null,
      })
      .where(and(scope, isNull(automationDeliveriesTable.openedAt)))
      .returning({ id: automationDeliveriesTable.id });
    if (updated.length) return "updated";
  } else {
    const updated = await db.update(automationDeliveriesTable)
      .set({
        failedAt: at,
        ...(failureReason ? { errorMessage: failureReason.slice(0, 500) } : {}),
      })
      .where(and(
        scope,
        isNull(automationDeliveriesTable.deliveredAt),
        isNull(automationDeliveriesTable.openedAt),
        isNull(automationDeliveriesTable.failedAt),
      ))
      .returning({ id: automationDeliveriesTable.id });
    if (updated.length) return "updated";
  }

  // Nothing changed: distinguish a replay (row exists) from an unknown key.
  const [existing] = await db.select({ id: automationDeliveriesTable.id })
    .from(automationDeliveriesTable).where(scope).limit(1);
  return existing ? "duplicate" : "unmatched";
}

// ---------------------------------------------------------------------------
// Brevo (email) webhook events
// ---------------------------------------------------------------------------

/** Brevo transactional webhook event payload (fields we consume). */
export interface BrevoWebhookEvent {
  event: string;
  /** Brevo's provider message id, echoed from the send response. */
  ["message-id"]: string;
  /** Unix seconds of the event, when provided. */
  ts_event?: number;
  /** ISO-ish date string alternative. */
  date?: string;
  reason?: string;
}

const BREVO_OPENED_EVENTS = new Set(["opened", "unique_opened", "first_opening", "proxy_open"]);
const BREVO_FAILED_EVENTS = new Set(["hard_bounce", "soft_bounce", "blocked", "invalid_email", "error"]);

function brevoEventKind(event: string): DeliveryEventKind | null {
  if (event === "delivered") return "delivered";
  if (BREVO_OPENED_EVENTS.has(event)) return "opened";
  if (BREVO_FAILED_EVENTS.has(event)) return "failed";
  return null; // requests, deferred, clicks, spam complaints, … — no state change
}

function brevoEventDate(event: BrevoWebhookEvent): Date | null {
  if (typeof event.ts_event === "number" && Number.isFinite(event.ts_event)) {
    return new Date(event.ts_event * 1000);
  }
  if (typeof event.date === "string") {
    const parsed = new Date(event.date);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

export function parseBrevoWebhookBody(body: unknown): BrevoWebhookEvent[] | null {
  const items = Array.isArray(body) ? body : [body];
  const events: BrevoWebhookEvent[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    if (typeof record["event"] !== "string" || typeof record["message-id"] !== "string") return null;
    events.push(record as unknown as BrevoWebhookEvent);
  }
  return events;
}

/**
 * Process a single verified Brevo event. Matching goes through the persisted
 * outbound email (email_deliveries.providerMessageId, automation type only) to
 * its shared event key, which is the automation delivery's channel key.
 */
export async function applyBrevoEvent(event: BrevoWebhookEvent, now = new Date()): Promise<ProviderEventOutcome> {
  const kind = brevoEventKind(event.event);
  if (!kind) return "ignored";

  const [outbound] = await db
    .select({ eventKey: emailDeliveriesTable.eventKey })
    .from(emailDeliveriesTable)
    .where(and(
      eq(emailDeliveriesTable.providerMessageId, event["message-id"]),
      eq(emailDeliveriesTable.emailType, "automation"),
    ))
    .limit(1);
  if (!outbound) return "unmatched";

  return applyDeliveryState(outbound.eventKey, "email", kind, brevoEventDate(event), event.reason, now);
}

export async function applyBrevoEvents(events: BrevoWebhookEvent[], now = new Date()): Promise<WebhookSummary> {
  const summary = emptySummary();
  for (const event of events) tally(summary, await applyBrevoEvent(event, now));
  return summary;
}

// ---------------------------------------------------------------------------
// Infobip (SMS) delivery reports
// ---------------------------------------------------------------------------

/** Infobip delivery-report entry (fields we consume). */
export interface InfobipDeliveryReport {
  /** Our stable submission id (sms_deliveries.id) — we set it at send time. */
  messageId?: string;
  /** Echo of callbackData (also our stable submission id). */
  callbackData?: string;
  doneAt?: string;
  status?: { groupName?: string; name?: string; description?: string };
}

const INFOBIP_FAILED_GROUPS = new Set(["UNDELIVERABLE", "REJECTED", "EXPIRED"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseInfobipWebhookBody(body: unknown): InfobipDeliveryReport[] | null {
  if (!body || typeof body !== "object") return null;
  const results = (body as { results?: unknown }).results;
  if (!Array.isArray(results)) return null;
  for (const item of results) {
    if (!item || typeof item !== "object") return null;
  }
  return results as InfobipDeliveryReport[];
}

/**
 * Process a single verified Infobip delivery report. The report's messageId is
 * the stable sms_deliveries.id we submitted; matching goes through that row
 * (automation type only) to the shared event key. SMS has no open events.
 */
export async function applyInfobipReport(report: InfobipDeliveryReport, now = new Date()): Promise<ProviderEventOutcome> {
  const groupName = report.status?.groupName?.toUpperCase();
  const kind: DeliveryEventKind | null =
    groupName === "DELIVERED" ? "delivered"
    : groupName && INFOBIP_FAILED_GROUPS.has(groupName) ? "failed"
    : null; // PENDING and unknown groups carry no terminal state
  if (!kind) return "ignored";

  const reference = report.messageId ?? report.callbackData;
  // sms_deliveries.id is a UUID; a non-UUID reference can never match (and
  // would make PostgreSQL reject the cast), so classify it as unmatched.
  if (!reference || typeof reference !== "string" || !UUID_PATTERN.test(reference)) return "unmatched";

  const [outbound] = await db
    .select({ eventKey: smsDeliveriesTable.eventKey })
    .from(smsDeliveriesTable)
    .where(and(
      eq(smsDeliveriesTable.id, reference),
      eq(smsDeliveriesTable.messageType, "automation"),
    ))
    .limit(1);
  if (!outbound) return "unmatched";

  const doneAt = report.doneAt ? new Date(report.doneAt) : null;
  const reason = report.status?.description ?? report.status?.name;
  return applyDeliveryState(outbound.eventKey, "sms", kind, doneAt, reason, now);
}

export async function applyInfobipReports(reports: InfobipDeliveryReport[], now = new Date()): Promise<WebhookSummary> {
  const summary = emptySummary();
  for (const report of reports) tally(summary, await applyInfobipReport(report, now));
  return summary;
}

// ---------------------------------------------------------------------------
// Admin webhook self-check ("Proveri webhook") — synthetic event marking
// ---------------------------------------------------------------------------

/**
 * Prefix of the synthetic message references the admin webhook self-check
 * posts to the app's own webhook endpoints. Such a reference can never match
 * a persisted outbound send (Brevo provider message ids are
 * `<...@smtp-relay...>` strings, Infobip references are the UUIDs of
 * sms_deliveries rows), so a synthetic event is always classified `unmatched`
 * and can never alter delivery state.
 *
 * Batches consisting solely of verification references are additionally
 * excluded from delivery-report receipt tracking: a self-check proves that
 * the endpoint and the saved secret work, NOT that the provider is calling
 * the webhook, so it must never silence the report-staleness warning. This
 * carries no security risk — the marker only lets an (already authenticated)
 * caller opt out of refreshing the freshness timestamp, never bypass the
 * timing-safe token check or delivery-state guards.
 */
export const WEBHOOK_VERIFICATION_REFERENCE_PREFIX = "lumera-webhook-verify:";

function isVerificationReference(reference: unknown): boolean {
  return typeof reference === "string" && reference.startsWith(WEBHOOK_VERIFICATION_REFERENCE_PREFIX);
}

/** True when every event in the batch is a synthetic self-check event. */
export function isBrevoVerificationBatch(events: BrevoWebhookEvent[]): boolean {
  return events.length > 0 && events.every((event) => isVerificationReference(event["message-id"]));
}

/** True when every report in the batch is a synthetic self-check report. */
export function isInfobipVerificationBatch(reports: InfobipDeliveryReport[]): boolean {
  return reports.length > 0 && reports.every((report) => isVerificationReference(report.messageId ?? report.callbackData));
}
