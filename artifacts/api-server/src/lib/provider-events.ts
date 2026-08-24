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
  integrationSettingsTable,
  providerWebhookReceiptsTable,
  smsDeliveriesTable,
} from "@workspace/db";
import { and, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { integrationSettings, type IntegrationName } from "./integrations";

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

/**
 * Return the public HTTPS origin configured for this deployment.
 *
 * Outbound provider requests have no browser origin to derive a URL from.
 * APP_BASE_URL is the deployment-owned origin used for production OAuth
 * callbacks and must therefore be the source for per-message webhook URLs too.
 * Never fall back to the request host or a development/preview address: an
 * Infobip notifyUrl is sent to an external provider and must not expose a
 * preview endpoint as the production delivery destination.
 */
function deploymentPublicOrigin(): string | null {
  const configured = process.env["APP_BASE_URL"]?.trim();
  if (!configured) return null;

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const developmentHost = hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname.endsWith(".replit.dev");
  if (
    url.protocol !== "https:"
    || developmentHost
    || url.username
    || url.password
    || url.port
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) return null;

  return url.origin;
}

/**
 * Build Infobip's per-message delivery-report callback URL. A missing or
 * development-only configuration deliberately returns undefined so the
 * provider receives no notifyUrl and cannot be pointed at a preview origin.
 */
export async function resolveInfobipNotifyUrl(): Promise<string | undefined> {
  const [secret, origin] = await Promise.all([
    resolveWebhookSecret("sms"),
    Promise.resolve(deploymentPublicOrigin()),
  ]);
  if (!secret || !origin) return undefined;
  return `${origin}/api/webhooks/infobip/${encodeURIComponent(secret)}`;
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
export async function deliveryReportStatuses(
  now = new Date(),
  executor: DatabaseQueryExecutor = db,
): Promise<Record<DeliveryReportProvider, DeliveryReportStatus>> {
  const windowStart = new Date(now.getTime() - DELIVERY_REPORT_WINDOW_HOURS * 60 * 60 * 1000);
  const graceCutoff = new Date(now.getTime() - DELIVERY_REPORT_GRACE_MINUTES * 60 * 1000);

  // A transaction uses one pg client. Run its reads in sequence so node-postgres
  // never receives overlapping client.query calls, while retaining the same
  // repeatable-read snapshot when a caller supplies a transaction executor.
  const receipts = await executor.select({
    provider: providerWebhookReceiptsTable.provider,
    lastEventAt: providerWebhookReceiptsTable.lastEventAt,
  }).from(providerWebhookReceiptsTable);
  const sends = await executor.select({
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
    .groupBy(automationDeliveriesTable.channel);

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
// Infobip SMS delivery-report webhook registration health (guided check)
// ---------------------------------------------------------------------------
//
// Brevo's registration check lists the provider's registered webhooks and
// compares URL + secret server-side. Infobip has no equivalent public API for
// the account-level SMS delivery-report URL (it is configured in the Infobip
// portal / by Infobip support and cannot be listed programmatically), so the
// SMS check derives a registration verdict from evidence the app itself can
// verify:
//   - whether a webhook secret is saved (without one every report is rejected),
//   - WHEN the secret was last saved (a report accepted before a secret change
//     proves nothing about the CURRENT registration — Infobip would still be
//     calling with the old token, which the endpoint now rejects),
//   - the last accepted VERIFIED real report (admin self-check batches are
//     excluded from receipt tracking, so they can never fake this proof), and
//   - the delivery-report silence warning (grace-aged recent sends with no
//     report since — the "provider is NOT calling us" signal).

/**
 * When the webhook secret for a provider was last saved in the database, or
 * null when no database-saved secret exists (environment fallback: age
 * unknown, treated as never-changed). Saving any OTHER setting must not bump
 * this timestamp — saveIntegrationSettings only touches updatedAt of rows
 * whose value was actually (re)written.
 */
export async function webhookSecretSavedAt(provider: WebhookProvider): Promise<Date | null> {
  const [row] = await db.select({ updatedAt: integrationSettingsTable.updatedAt })
    .from(integrationSettingsTable)
    .where(and(
      eq(integrationSettingsTable.integration, provider),
      eq(integrationSettingsTable.settingKey, "webhookSecret"),
    ))
    .limit(1);
  return row?.updatedAt ?? null;
}

export type SmsWebhookRegistrationState =
  | "no_secret"      // no webhook secret configured — the endpoint rejects every report
  | "confirmed"      // a real verified report was accepted since the secret was last saved
  | "misconfigured"  // recent sends exist but reports stay silent — registration missing/stale at Infobip
  | "stale_secret"   // reports were confirmed before the secret changed, none since — Infobip likely carries the old token
  | "unconfirmed";   // no evidence either way (no confirming report, no qualifying silence)

/**
 * Pure verdict: classify the Infobip delivery-report registration from the
 * verifiable evidence above. Precedence:
 *   1. no secret → nothing can ever be accepted;
 *   2. a report accepted since the secret was last saved proves Infobip calls
 *      this endpoint with the CURRENT secret — unless newer grace-aged sends
 *      are silent again (registration broke after the confirmation);
 *   3. a report exists but predates the secret change → the registration
 *      almost certainly still carries the old secret (actionable regardless
 *      of traffic: the silence, when present, is explained by the change);
 *   4. no confirming report: silence despite qualifying sends means
 *      misconfigured, otherwise there is simply nothing to judge by yet.
 */
export function smsWebhookRegistrationState(input: {
  secretSaved: boolean;
  /** DB save time of the secret; null = env fallback (treated as never-changed). */
  secretSavedAt: Date | null;
  /** Last accepted verified REAL report (self-checks never count). */
  lastEventAt: Date | null;
  /** Delivery-report silence warning (grace-aged sends, no report since). */
  reportWarning: boolean;
}): SmsWebhookRegistrationState {
  if (!input.secretSaved) return "no_secret";
  const confirmedSinceSecretSave = input.lastEventAt !== null
    && (input.secretSavedAt === null || input.lastEventAt.getTime() >= input.secretSavedAt.getTime());
  if (confirmedSinceSecretSave) return input.reportWarning ? "misconfigured" : "confirmed";
  if (input.lastEventAt !== null && input.secretSavedAt !== null) return "stale_secret";
  return input.reportWarning ? "misconfigured" : "unconfirmed";
}

export interface SmsWebhookRegistrationStatus {
  state: SmsWebhookRegistrationState;
  /** When the webhook secret was last saved in the database (ISO), or null. */
  secretSavedAt: string | null;
  /** Last accepted verified real report (ISO), or null if never. */
  lastReportAt: string | null;
}

/**
 * Registration status for the admin integrations page, composed from the
 * already-computed Infobip delivery-report freshness (avoids re-querying).
 */
export async function smsWebhookRegistrationStatus(infobip: DeliveryReportStatus): Promise<SmsWebhookRegistrationStatus> {
  const [secret, secretSavedAt] = await Promise.all([
    resolveWebhookSecret("sms"),
    webhookSecretSavedAt("sms"),
  ]);
  const lastEventAt = infobip.lastEventAt ? new Date(infobip.lastEventAt) : null;
  return {
    state: smsWebhookRegistrationState({
      secretSaved: Boolean(secret),
      secretSavedAt,
      lastEventAt,
      reportWarning: infobip.warning,
    }),
    secretSavedAt: secretSavedAt ? secretSavedAt.toISOString() : null,
    lastReportAt: infobip.lastEventAt,
  };
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

// An opened/failed CASE update consumes up to five PostgreSQL bind parameters
// per delivery key. Stay well below the 65,535 protocol limit while keeping
// large replay batches to a small number of set-based statements.
const DELIVERY_STATE_UPDATE_CHUNK_SIZE = 10_000;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size));
  }
  return result;
}

/**
 * Clamp a provider timestamp: use it when plausible, otherwise fall back to
 * `now`. Future-dated events (clock skew / forgery) are clamped to now so a
 * replayed forged timestamp cannot park state in the future.
 */
function eventTime(raw: Date | null, now: Date): Date {
  if (!raw || Number.isNaN(raw.getTime())) return now;
  return raw.getTime() > now.getTime() ? now : raw;
}

interface DeliveryStateInput {
  channel: "email" | "sms";
  channelEventKey: string;
  kind: DeliveryEventKind;
  occurredAt: Date | null;
  failureReason?: string;
}

/**
 * Apply a batch of delivery-state events with one guarded UPDATE per
 * channel/kind group, while retaining the input-order semantics of the old
 * per-event implementation.
 *
 * A delivery's guard can only move from true to false: deliveredAt/openedAt
 * are never cleared, and a failure is only cleared by an event that also sets
 * deliveredAt or openedAt. Consequently, the first event for a given
 * channel/key/kind is the only event of that kind that could ever update.
 * Those first events are arranged into per-delivery waves, retaining each
 * delivery's own input order. Events for different deliveries in a wave can
 * then share a set-based channel/kind UPDATE without affecting each other.
 *
 * The one existence query runs after the updates and covers every candidate
 * key. This distinguishes a guarded no-op on an existing delivery from an
 * unknown key without falling back to one SELECT per replay.
 */
async function applyDeliveryStates(
  events: readonly DeliveryStateInput[],
  now: Date,
): Promise<ProviderEventOutcome[]> {
  if (!events.length) return [];

  const scopeKey = (event: Pick<DeliveryStateInput, "channel" | "channelEventKey">) =>
    `${event.channel}\u0000${event.channelEventKey}`;
  type Candidate = { event: DeliveryStateInput; index: number };
  const candidatesByScope = new Map<string, Candidate[]>();
  const seenKindsByScope = new Map<string, Set<DeliveryEventKind>>();

  for (const [index, event] of events.entries()) {
    const key = scopeKey(event);
    const seenKinds = seenKindsByScope.get(key) ?? new Set<DeliveryEventKind>();
    if (seenKinds.has(event.kind)) continue;
    seenKinds.add(event.kind);
    seenKindsByScope.set(key, seenKinds);
    const candidates = candidatesByScope.get(key) ?? [];
    candidates.push({ event, index });
    candidatesByScope.set(key, candidates);
  }

  const candidateEvents = [...candidatesByScope.values()].flat();
  const candidateKeys = [...new Set(candidateEvents.map(({ event }) => event.channelEventKey))];
  const candidateChannels = [...new Set(candidateEvents.map(({ event }) => event.channel))];
  const updatedIndexes = new Set<number>();

  const applyGroup = async (candidates: readonly Candidate[]) => {
    const [{ event: firstEvent }] = candidates;
    const channel = firstEvent.channel;
    const kind = firstEvent.kind;
    const eventKeys = candidates.map(({ event }) => event.channelEventKey);
    const timestampCase = sql`case ${automationDeliveriesTable.eventKey} ${sql.join(
      candidates.map(({ event }) => {
        const at = eventTime(event.occurredAt, now);
        return sql`when ${event.channelEventKey} then ${at}::timestamptz`;
      }),
      sql` `,
    )} end`;
    const scope = and(
      eq(automationDeliveriesTable.channel, channel),
      inArray(automationDeliveriesTable.eventKey, eventKeys),
    );

    let updated: Array<{ eventKey: string }> = [];
    if (kind === "delivered") {
      updated = await db.update(automationDeliveriesTable)
        .set({ deliveredAt: timestampCase, failedAt: null })
        .where(and(scope, isNull(automationDeliveriesTable.deliveredAt)))
        .returning({ eventKey: automationDeliveriesTable.eventKey });
    } else if (kind === "opened") {
      updated = await db.update(automationDeliveriesTable)
        .set({
          openedAt: timestampCase,
          deliveredAt: sql`coalesce(${automationDeliveriesTable.deliveredAt}, ${timestampCase})`,
          failedAt: null,
        })
        .where(and(scope, isNull(automationDeliveriesTable.openedAt)))
        .returning({ eventKey: automationDeliveriesTable.eventKey });
    } else {
      const reasonCase = sql`case ${automationDeliveriesTable.eventKey} ${sql.join(
        candidates.map(({ event }) => sql`when ${event.channelEventKey} then ${
          event.failureReason ? event.failureReason.slice(0, 500) : sql`${automationDeliveriesTable.errorMessage}`
        }`),
        sql` `,
      )} end`;
      updated = await db.update(automationDeliveriesTable)
        .set({ failedAt: timestampCase, errorMessage: reasonCase })
        .where(and(
          scope,
          isNull(automationDeliveriesTable.deliveredAt),
          isNull(automationDeliveriesTable.openedAt),
          isNull(automationDeliveriesTable.failedAt),
        ))
        .returning({ eventKey: automationDeliveriesTable.eventKey });
    }

    const updatedKeys = new Set(updated.map((row) => `${channel}\u0000${row.eventKey}`));
    for (const { event, index } of candidates) {
      if (updatedKeys.has(scopeKey(event))) updatedIndexes.add(index);
    }
  };

  // A delivery has only three monotonic kinds, so this produces at most three
  // waves and at most three set-based UPDATE groups per wave. A very large
  // group is chunked below to stay within PostgreSQL's parameter budget.
  for (let wave = 0; wave < 3; wave += 1) {
    const groups = new Map<string, Candidate[]>();
    for (const candidates of candidatesByScope.values()) {
      const candidate = candidates[wave];
      if (!candidate) continue;
      const groupKey = `${candidate.event.channel}\u0000${candidate.event.kind}`;
      const group = groups.get(groupKey) ?? [];
      group.push(candidate);
      groups.set(groupKey, group);
    }

    for (const group of groups.values()) {
      for (const candidates of chunks(group, DELIVERY_STATE_UPDATE_CHUNK_SIZE)) {
        await applyGroup(candidates);
      }
    }
  }

  const existing = new Set<string>();
  for (const eventKeys of chunks(candidateKeys, DELIVERY_STATE_UPDATE_CHUNK_SIZE)) {
    const existingRows = await db.select({
      eventKey: automationDeliveriesTable.eventKey,
      channel: automationDeliveriesTable.channel,
    }).from(automationDeliveriesTable).where(and(
      inArray(automationDeliveriesTable.eventKey, eventKeys),
      inArray(automationDeliveriesTable.channel, candidateChannels),
    ));
    for (const row of existingRows) existing.add(`${row.channel}\u0000${row.eventKey}`);
  }
  return events.map((event, index) => {
    if (updatedIndexes.has(index)) return "updated";
    return existing.has(scopeKey(event)) ? "duplicate" : "unmatched";
  });
}

/** Apply one delivery-state event through the shared batched transition path. */
async function applyDeliveryState(
  channelEventKey: string,
  channel: "email" | "sms",
  kind: DeliveryEventKind,
  occurredAt: Date | null,
  failureReason?: string,
  now = new Date(),
): Promise<ProviderEventOutcome> {
  const [outcome] = await applyDeliveryStates([{
    channel,
    channelEventKey,
    kind,
    occurredAt,
    failureReason,
  }], now);
  return outcome;
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

/**
 * Brevo delivery-event capability table — the SINGLE SOURCE OF TRUTH shared
 * by all three places that must agree on which delivery events matter:
 *
 *   1. the webhook handler (brevoEventKind below — which payload events set
 *      deliveredAt / openedAt / failedAt),
 *   2. the admin registration check (missingBrevoWebhookEvents — which
 *      subscriptions a healthy registration must carry), and
 *   3. the one-click registration (BREVO_WEBHOOK_REGISTRATION_EVENTS — the
 *      event names submitted to Brevo when creating/repairing the webhook).
 *
 * Adding a newly processed delivery event is therefore ONE row here: the
 * handler starts consuming it, the check starts requiring it, and the next
 * one-click registration subscribes to it — none of the three can drift.
 *
 * Naming: Brevo's registration API/dashboard use camelCase names
 * ("hardBounce") while webhook payloads arrive snake_case ("hard_bounce"),
 * so all comparisons normalize case and separators on both sides.
 * `registrationName` is the canonical camelCase name the registration API
 * accepts; `names` are the payload/listing variants that also count.
 *
 * Each entry is ONE delivery capability: it counts as covered when ANY of
 * its accepted names is subscribed, and its Serbian label is what admins see
 * when it is missing. Opens are a single capability (any open event sets
 * openedAt), while each failure event is its own capability — a registration
 * with only hardBounce still silently drops soft bounces, blocks, invalid
 * addresses, and send errors.
 */
const REQUIRED_BREVO_WEBHOOK_EVENTS: ReadonlyArray<{
  kind: DeliveryEventKind;
  label: string;
  registrationName: string;
  names: readonly string[];
}> = [
  { kind: "delivered", label: "isporučeno (delivered)", registrationName: "delivered", names: ["delivered"] },
  { kind: "opened", label: "otvaranja (opened / uniqueOpened)", registrationName: "opened", names: ["opened", "unique_opened", "first_opening", "proxy_open"] },
  { kind: "failed", label: "trajno odbijeno (hardBounce)", registrationName: "hardBounce", names: ["hard_bounce"] },
  { kind: "failed", label: "privremeno odbijeno (softBounce)", registrationName: "softBounce", names: ["soft_bounce"] },
  { kind: "failed", label: "blokirano (blocked)", registrationName: "blocked", names: ["blocked"] },
  { kind: "failed", label: "nevažeća adresa (invalid)", registrationName: "invalid", names: ["invalid_email", "invalid"] },
  { kind: "failed", label: "greška u slanju (error)", registrationName: "error", names: ["error"] },
];

/** Normalized event name → delivery-state kind, derived from the table. */
const BREVO_EVENT_KIND_BY_NAME: ReadonlyMap<string, DeliveryEventKind> = new Map(
  REQUIRED_BREVO_WEBHOOK_EVENTS.flatMap((capability) =>
    [capability.registrationName, ...capability.names]
      .map((name) => [normalizeBrevoEventName(name), capability.kind] as const)),
);

function brevoEventKind(event: string): DeliveryEventKind | null {
  // requests, deferred, clicks, spam complaints, … carry no delivery state.
  return BREVO_EVENT_KIND_BY_NAME.get(normalizeBrevoEventName(event)) ?? null;
}

/**
 * Event names the one-click registration submits to Brevo — exactly one
 * canonical registration name per required capability above. Derived, never
 * hand-maintained: a capability added to REQUIRED_BREVO_WEBHOOK_EVENTS is
 * automatically subscribed by the next one-click registration/repair, and a
 * registration created from this list can never trip the missing-events
 * warning.
 */
export const BREVO_WEBHOOK_REGISTRATION_EVENTS: readonly string[] =
  REQUIRED_BREVO_WEBHOOK_EVENTS.map((capability) => capability.registrationName);

/** Normalize a Brevo event name so camelCase and snake_case variants compare equal. */
function normalizeBrevoEventName(name: string): string {
  return name.toLowerCase().replace(/[_\s-]/g, "");
}

/**
 * Given the event names a Brevo webhook registration subscribes to, return
 * the Serbian labels of the delivery capabilities the app processes but the
 * registration does NOT cover (empty array = fully subscribed).
 */
export function missingBrevoWebhookEvents(subscribed: readonly string[]): string[] {
  const normalized = new Set(subscribed.map(normalizeBrevoEventName));
  return REQUIRED_BREVO_WEBHOOK_EVENTS
    .filter((capability) =>
      ![capability.registrationName, ...capability.names]
        .some((name) => normalized.has(normalizeBrevoEventName(name))))
    .map((capability) => capability.label);
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
    if (
      (record["ts_event"] !== undefined
        && (typeof record["ts_event"] !== "number" || !Number.isFinite(record["ts_event"])))
      || (record["date"] !== undefined
        && (typeof record["date"] !== "string" || Number.isNaN(new Date(record["date"]).getTime())))
      || (record["reason"] !== undefined && typeof record["reason"] !== "string")
    ) return null;
    events.push(record as unknown as BrevoWebhookEvent);
  }
  return events;
}

/**
 * Batch the message-id → event-key matching for a whole webhook payload into
 * ONE query: persisted outbound emails (automation type only) whose Brevo
 * providerMessageId is among the batch's message ids. A message id absent
 * from the map is unmatched — exactly what the previous per-event
 * `providerMessageId = ? AND emailType = 'automation' LIMIT 1` lookup
 * reported, including synthetic self-check references, which can never
 * correspond to a persisted outbound send.
 */
async function brevoEventKeysByMessageId(messageIds: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(messageIds)];
  if (!unique.length) return new Map();
  const byMessageId = new Map<string, string>();
  for (const messageIdChunk of chunks(unique, DELIVERY_STATE_UPDATE_CHUNK_SIZE)) {
    const rows = await db
      .select({
        providerMessageId: emailDeliveriesTable.providerMessageId,
        eventKey: emailDeliveriesTable.eventKey,
      })
      .from(emailDeliveriesTable)
      .where(and(
        inArray(emailDeliveriesTable.providerMessageId, messageIdChunk),
        eq(emailDeliveriesTable.emailType, "automation"),
      ));
    for (const row of rows) {
      // Mirror the old LIMIT 1: first row wins if a provider id ever repeated.
      if (row.providerMessageId && !byMessageId.has(row.providerMessageId)) {
        byMessageId.set(row.providerMessageId, row.eventKey);
      }
    }
  }
  return byMessageId;
}
/**
 * Process a single verified Brevo event. Matching goes through the persisted
 * outbound email (email_deliveries.providerMessageId, automation type only) to
 * its shared event key, which is the automation delivery's channel key.
 */
export async function applyBrevoEvent(event: BrevoWebhookEvent, now = new Date()): Promise<ProviderEventOutcome> {
  const kind = brevoEventKind(event.event);
  if (!kind) return "ignored";
  const eventKey = (await brevoEventKeysByMessageId([event["message-id"]])).get(event["message-id"]);
  if (!eventKey) return "unmatched";
  return applyDeliveryState(eventKey, "email", kind, brevoEventDate(event), event.reason, now);
}

/**
 * Process a verified Brevo batch: classify every event first, resolve all
 * matchable message ids with one batched query, then apply delivery states in
 * at most one set-based UPDATE per event kind.
 */
export async function applyBrevoEvents(events: BrevoWebhookEvent[], now = new Date()): Promise<WebhookSummary> {
  const summary = emptySummary();
  const classified = events.map((event) => ({ event, kind: brevoEventKind(event.event) }));
  const eventKeys = await brevoEventKeysByMessageId(
    classified.filter((entry) => entry.kind).map((entry) => entry.event["message-id"]),
  );
  const matched: DeliveryStateInput[] = [];
  for (const { event, kind } of classified) {
    if (!kind) { tally(summary, "ignored"); continue; }
    const eventKey = eventKeys.get(event["message-id"]);
    if (!eventKey) {
      tally(summary, "unmatched");
      continue;
    }
    matched.push({
      channel: "email",
      channelEventKey: eventKey,
      kind,
      occurredAt: brevoEventDate(event),
      failureReason: event.reason,
    });
  }
  for (const outcome of await applyDeliveryStates(matched, now)) tally(summary, outcome);
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
    const record = item as Record<string, unknown>;
    const messageId = record["messageId"];
    const callbackData = record["callbackData"];
    if (
      (messageId === undefined && callbackData === undefined)
      || (messageId !== undefined && typeof messageId !== "string")
      || (callbackData !== undefined && typeof callbackData !== "string")
      || (record["doneAt"] !== undefined
        && (typeof record["doneAt"] !== "string" || Number.isNaN(new Date(record["doneAt"]).getTime())))
    ) return null;
    const status = record["status"];
    if (status !== undefined && (!status || typeof status !== "object" || Array.isArray(status))) return null;
    if (status && typeof status === "object") {
      const statusRecord = status as Record<string, unknown>;
      if (
        (statusRecord["groupName"] !== undefined && typeof statusRecord["groupName"] !== "string")
        || (statusRecord["name"] !== undefined && typeof statusRecord["name"] !== "string")
        || (statusRecord["description"] !== undefined && typeof statusRecord["description"] !== "string")
      ) return null;
    }
  }
  return results as InfobipDeliveryReport[];
}

/** Terminal delivery-state kind of a report, or null (PENDING / unknown groups). */
function infobipReportKind(report: InfobipDeliveryReport): DeliveryEventKind | null {
  const groupName = report.status?.groupName?.toUpperCase();
  return groupName === "DELIVERED" ? "delivered"
    : groupName && INFOBIP_FAILED_GROUPS.has(groupName) ? "failed"
    : null; // PENDING and unknown groups carry no terminal state
}
/**
 * Process a single verified Infobip delivery report. The report's messageId is
 * the stable sms_deliveries.id we submitted; matching goes through that row
 * (automation type only) to the shared event key. SMS has no open events.
 */
export async function applyInfobipReport(report: InfobipDeliveryReport, now = new Date()): Promise<ProviderEventOutcome> {
  const kind = infobipReportKind(report);
  if (!kind) return "ignored";
  const reference = infobipReference(report);
  if (!reference) return "unmatched";
  const eventKey = (await smsEventKeysById([reference])).get(reference);
  if (!eventKey) return "unmatched";
  return applyDeliveryState(
    eventKey,
    "sms",
    kind,
    report.doneAt ? new Date(report.doneAt) : null,
    report.status?.description ?? report.status?.name,
    now,
  );
}

/**
 * Process a verified Infobip batch: classify every report first, resolve all
 * valid UUID references with one batched query, then apply delivery states in
 * at most one set-based UPDATE per event kind.
 */
export async function applyInfobipReports(reports: InfobipDeliveryReport[], now = new Date()): Promise<WebhookSummary> {
  const summary = emptySummary();
  const classified = reports.map((report) => ({
    report,
    kind: infobipReportKind(report),
    reference: infobipReference(report),
  }));
  const eventKeys = await smsEventKeysById(
    classified.flatMap((entry) => entry.kind && entry.reference ? [entry.reference] : []),
  );
  const matched: DeliveryStateInput[] = [];
  for (const { report, kind, reference } of classified) {
    if (!kind) { tally(summary, "ignored"); continue; }
    const eventKey = reference ? eventKeys.get(reference) : undefined;
    if (!eventKey) {
      tally(summary, "unmatched");
      continue;
    }
    matched.push({
      channel: "sms",
      channelEventKey: eventKey,
      kind,
      occurredAt: report.doneAt ? new Date(report.doneAt) : null,
      failureReason: report.status?.description ?? report.status?.name,
    });
  }
  for (const outcome of await applyDeliveryStates(matched, now)) tally(summary, outcome);
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

/**
 * Batch the sms_deliveries.id → event-key matching for a whole delivery
 * report payload into ONE query (automation type only). Same unmatched
 * semantics as the previous per-report `id = ? LIMIT 1` lookup: any
 * reference absent from the map is unmatched. sms_deliveries.id is the
 * primary key, so at most one row exists per reference.
 */
async function smsEventKeysById(ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const byId = new Map<string, string>();
  for (const idChunk of chunks(unique, DELIVERY_STATE_UPDATE_CHUNK_SIZE)) {
    const rows = await db
      .select({ id: smsDeliveriesTable.id, eventKey: smsDeliveriesTable.eventKey })
      .from(smsDeliveriesTable)
      .where(and(
        inArray(smsDeliveriesTable.id, idChunk),
        eq(smsDeliveriesTable.messageType, "automation"),
      ));
    for (const row of rows) byId.set(row.id, row.eventKey);
  }
  return byId;
}

/**
 * The report's stable sms_deliveries.id reference, or null when it can never
 * match. sms_deliveries.id is a UUID; a non-UUID reference (including a
 * synthetic self-check reference) would make PostgreSQL reject the cast, so
 * it is classified unmatched without ever reaching the database.
 */
function infobipReference(report: InfobipDeliveryReport): string | null {
  const reference = report.messageId ?? report.callbackData;
  if (!reference || typeof reference !== "string" || !UUID_PATTERN.test(reference)) return null;
  return reference;
}

type DatabaseQueryExecutor = Pick<typeof db, "select">;
