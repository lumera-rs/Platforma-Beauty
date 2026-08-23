import { db, smsDeliveriesTable } from "@workspace/db";
import { and, eq, lt, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";
import { infobipBaseUrl, integrationSettings, integrationValue } from "./integrations";

export type SmsMessageType = "appointment_confirmation" | "appointment_reminder" | "automation" | "admin_alert" | "retail_order";

/** Lease duration for an SMS delivery claim (5 minutes). */
const SMS_LEASE_MS = 5 * 60 * 1000;

/**
 * Persisted SMS delivery status, mirroring the automation delivery lifecycle.
 * Only `sent` and intentional `skipped` are terminal/deduplicated.
 */
export type SmsDeliveryStatus = "queued" | "processing" | "sent" | "failed" | "skipped";

/** Provider send input. `idempotencyKey` is the persistent sms_deliveries.id. */
export interface SmsSendInput {
  to: string;
  text: string;
  /**
   * Stable, persistent idempotency key = sms_deliveries.id (UUID). It is passed
   * to Infobip as BOTH request `bulkId` and `destinations[0].messageId` (and
   * `callbackData`) so a resend with the SAME key is deduplicated/traceable and
   * a submission's outcome can later be looked up. NEVER regenerate on retry.
   */
  idempotencyKey?: string;
}

/**
 * Result of reconciling a prior (unknown-outcome) submission by its stable
 * messageId against the provider's outbound logs:
 *   - { accepted: true }  — a matching submission exists → treat local as sent.
 *   - { accepted: false } — provider definitively has NO matching log → safe to
 *                           resend with the SAME key.
 *   - { unavailable: true } — lookup failed/unreachable → outcome still unknown;
 *                           caller must NOT resend (retain lease, return inProgress).
 */
export type SmsReconcileResult =
  | { accepted: true; providerMessageId?: string }
  | { accepted: false }
  | { unavailable: true };

export interface SmsProvider {
  send(input: SmsSendInput): Promise<{ messageId?: string }>;
  /**
   * Optional provider-level reconciliation. Look up an outbound submission by
   * the stable messageId (Infobip GET /sms/1/logs). Any matching log — in any
   * provider status — counts as ACCEPTED for local send idempotency, because
   * "local sent" means "provider accepted the submission", not "delivered".
   */
  lookupByMessageId?(messageId: string): Promise<SmsReconcileResult>;
}

class InfobipSmsProvider implements SmsProvider {
  private async credentials() {
    const apiKey = await integrationValue("sms", "apiKey", process.env["SMS_PROVIDER_API_KEY"]);
    const baseUrl = infobipBaseUrl(await integrationValue("sms", "baseUrl", process.env["SMS_PROVIDER_BASE_URL"]));
    return { apiKey, baseUrl };
  }

  async send(input: SmsSendInput) {
    const { apiKey, baseUrl } = await this.credentials();
    const sender = await integrationValue("sms", "senderName", process.env["SMS_SENDER_NAME"]) ?? "LUMERA";
    if (!apiKey) throw new Error("SMS_PROVIDER_API_KEY nije podešen.");
    // Pass the stable delivery id as bulkId + per-destination messageId (+
    // callbackData). Infobip accepts a client-supplied destination.messageId
    // (<=200 chars); reusing it on retry makes the submission idempotent and
    // discoverable via GET /sms/1/logs.
    const key = input.idempotencyKey;
    const destination: { to: string; messageId?: string } = { to: input.to };
    if (key) destination.messageId = key;
    const message: Record<string, unknown> = {
      destinations: [destination],
      from: sender,
      text: input.text,
    };
    if (key) message["callbackData"] = key;
    const body: Record<string, unknown> = { messages: [message] };
    if (key) body["bulkId"] = key;
    const response = await fetch(`${baseUrl}/sms/2/text/advanced`, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `App ${apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Infobip ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const payload = await response.json() as { messages?: Array<{ messageId?: string }> };
    return { messageId: payload.messages?.[0]?.messageId };
  }

  async lookupByMessageId(messageId: string): Promise<SmsReconcileResult> {
    const { apiKey, baseUrl } = await this.credentials();
    if (!apiKey) return { unavailable: true };
    try {
      // GET /sms/1/logs?messageId=<encoded>&limit=1 finds outbound submissions
      // from the last 48h. Any matching result = accepted (submission exists).
      const response = await fetch(
        `${baseUrl}/sms/1/logs?messageId=${encodeURIComponent(messageId)}&limit=1`,
        {
          method: "GET",
          redirect: "error",
          headers: { Authorization: `App ${apiKey}`, accept: "application/json" },
        },
      );
      if (!response.ok) return { unavailable: true };
      const payload = await response.json() as { results?: Array<{ messageId?: string }> };
      const match = payload.results?.[0];
      if (match) return { accepted: true, providerMessageId: match.messageId ?? messageId };
      return { accepted: false };
    } catch {
      // Network/transport failure → outcome remains unknown; do not resend.
      return { unavailable: true };
    }
  }
}

const provider: SmsProvider = new InfobipSmsProvider();

/**
 * The real Infobip provider instance — exported for tests that assert the exact
 * request construction (bulkId / destination.messageId) and logs-lookup URL.
 */
export const infobipSmsProvider: SmsProvider = provider;

export async function sendTestSms(to: string) {
  const settings = await integrationSettings("sms");
  if (!settings.enabled) throw new Error("SMS integracija je isključena.");
  if (!(settings.values.apiKey ?? process.env["SMS_PROVIDER_API_KEY"])) throw new Error("Unesite SMS API ključ pre testa.");
  // One-off, non-durable send: generate a fresh key purely for idempotent submit.
  return provider.send({ to, text: "LUMERA test poruka: SMS integracija je uspešno povezana.", idempotencyKey: randomUUID() });
}

export function maskPhone(phone: string) {
  const compact = phone.replace(/\s+/g, "");
  return compact.length <= 4 ? "****" : `${compact.slice(0, Math.max(0, compact.length - 4)).replace(/\d/g, "X")}${compact.slice(-4)}`;
}

export async function sendPhoneVerificationCode(phone: string, code: string) {
  const settings = await integrationSettings("sms");
  if (!settings.enabled || !(settings.values.apiKey ?? process.env["SMS_PROVIDER_API_KEY"])) return false;
  await provider.send({ to: phone, text: `LUMERA kod za potvrdu broja telefona: ${code}. Važi 10 minuta.`, idempotencyKey: randomUUID() });
  return true;
}

/**
 * Send (or dedupe/retry) a single SMS keyed by `eventKey`, using a race-safe
 * claim/lease lifecycle on `sms_deliveries` so a crash at any point recovers
 * correctly and the provider is called at most once per successful send:
 *
 *   - `skipped: true`         — intentional policy skip (no phone, opt-out,
 *                               integration disabled). Terminal / deduplicated.
 *   - `{ messageId }`         — provider accepted (sent). Terminal / deduplicated.
 *   - `deduplicated: true`    — a terminal row already exists for this eventKey;
 *                               `priorStatus` is the reconciled persisted status.
 *   - `inProgress: true`      — another sender holds a LIVE lease (not stale);
 *                               caller must retry later (never treat as sent/skipped).
 *   - `failed: true`          — provider error; the row is reclaimable for retry.
 *
 * Claimable states for a (re)attempt: `queued`, `failed`, or a `processing` row
 * whose lease has expired (stale). This means a crash after the queued insert
 * but before the provider call is reclaimed and the provider is actually called.
 */
export async function sendSms(
  input: {
    eventKey: string;
    /** Owning salon, or null for platform-level messages (e.g. admin alerts). */
    salonId: string | null;
    appointmentId: string | null;
    type: SmsMessageType;
    phone: string | null | undefined;
    smsOptOut?: boolean;
    text: string;
  },
  /** Optional provider override — used in tests to inject a fake/stub */
  providerOverride?: SmsProvider,
): Promise<
  | { skipped: true }
  | { messageId?: string }
  | { deduplicated: true; priorStatus: SmsDeliveryStatus }
  | { inProgress: true }
  | { failed: true }
> {
  if (!input.phone) return { skipped: true };
  const now = new Date();

  // Step 1: ensure a row exists (idempotent insert as queued). If a row already
  // exists we do nothing here and reconcile via the CAS claim below.
  await db.insert(smsDeliveriesTable).values({
    eventKey: input.eventKey, salonId: input.salonId, appointmentId: input.appointmentId ?? null,
    messageType: input.type, recipientPhone: input.phone, body: input.text,
  }).onConflictDoNothing();

  // Step 2: atomic compare-and-swap claim. Only transitions from claimable
  // states (queued / failed / stale-processing) succeed; this single UPDATE ...
  // RETURNING is what guarantees at-most-one live sender.
  const claimExpiry = new Date(now.getTime() + SMS_LEASE_MS);
  const [claimed] = await db
    .update(smsDeliveriesTable)
    .set({ status: "processing", processingStartedAt: now, claimExpiresAt: claimExpiry })
    .where(and(
      eq(smsDeliveriesTable.eventKey, input.eventKey),
      or(
        eq(smsDeliveriesTable.status, "queued"),
        eq(smsDeliveriesTable.status, "failed"),
        and(
          eq(smsDeliveriesTable.status, "processing"),
          lt(smsDeliveriesTable.claimExpiresAt, now),
        ),
      ),
    ))
    .returning();

  if (!claimed) {
    // No claimable row — it's either terminal (sent/skipped → dedupe) or another
    // sender holds a LIVE processing lease (retry later; never downgrade).
    const [existing] = await db.select().from(smsDeliveriesTable)
      .where(eq(smsDeliveriesTable.eventKey, input.eventKey)).limit(1);
    if (!existing) {
      // Extremely unlikely after the insert above; treat as retryable in-progress.
      return { inProgress: true };
    }
    if (existing.status === "sent" || existing.status === "skipped") {
      return { deduplicated: true, priorStatus: existing.status };
    }
    // status === "processing" with a live (non-expired) lease.
    return { inProgress: true };
  }

  // We now hold the lease on `claimed`. Apply policy skips first (terminal).
  if (input.smsOptOut) {
    await db.update(smsDeliveriesTable)
      .set({ status: "skipped", errorMessage: "SMS obaveštenja su isključena za ovaj CRM kontakt.", claimExpiresAt: null })
      .where(eq(smsDeliveriesTable.id, claimed.id));
    return { skipped: true };
  }
  // If a provider override is supplied (e.g. in tests), skip the settings check.
  const activeProvider = providerOverride ?? null;
  if (!activeProvider) {
    const smsSettings = await integrationSettings("sms");
    if (!smsSettings.enabled) {
      await db.update(smsDeliveriesTable)
        .set({ status: "skipped", errorMessage: "SMS integracija je isključena u admin podešavanjima.", claimExpiresAt: null })
        .where(eq(smsDeliveriesTable.id, claimed.id));
      return { skipped: true };
    }
    if (!(smsSettings.values.apiKey ?? process.env["SMS_PROVIDER_API_KEY"])) {
      await db.update(smsDeliveriesTable)
        .set({ status: "skipped", errorMessage: "SMS_PROVIDER_API_KEY nije podešen.", claimExpiresAt: null })
        .where(eq(smsDeliveriesTable.id, claimed.id));
      return { skipped: true };
    }
  }
  const usedProvider = activeProvider ?? provider;

  // ── Unknown-outcome recovery ─────────────────────────────────────────────
  // If this claimed row already carries `submissionStartedAt`, a PRIOR attempt
  // issued (or was in the middle of issuing) a provider request whose outcome
  // we never durably recorded (provider-accepted-then-crash, or DB write failure
  // after send). BEFORE any resend we reconcile by the row's stable id, which is
  // exactly the messageId we submitted, so we never double-send blindly.
  if (claimed.submissionStartedAt) {
    if (usedProvider.lookupByMessageId) {
      let reconciled: SmsReconcileResult;
      try {
        reconciled = await usedProvider.lookupByMessageId(claimed.id);
      } catch {
        reconciled = { unavailable: true };
      }
      if ("accepted" in reconciled && reconciled.accepted) {
        // Provider already accepted the earlier submission → mark local sent.
        await db.update(smsDeliveriesTable)
          .set({ status: "sent", providerMessageId: reconciled.providerMessageId ?? claimed.id, sentAt: new Date(), claimExpiresAt: null })
          .where(eq(smsDeliveriesTable.id, claimed.id));
        return { messageId: reconciled.providerMessageId ?? claimed.id };
      }
      if ("unavailable" in reconciled) {
        // Outcome still unknown — do NOT resend. Keep the row processing with a
        // refreshed lease (retain submissionStartedAt) so a later claim retries.
        await db.update(smsDeliveriesTable)
          .set({ claimExpiresAt: new Date(Date.now() + SMS_LEASE_MS) })
          .where(eq(smsDeliveriesTable.id, claimed.id));
        return { inProgress: true };
      }
      // reconciled.accepted === false → provider definitively has no matching
      // log → fall through and resend using the SAME stable messageId.
    } else {
      // Provider cannot reconcile (no lookup) AND we have an unknown outcome.
      // Safer to not blind-resend: keep processing with a refreshed lease.
      await db.update(smsDeliveriesTable)
        .set({ claimExpiresAt: new Date(Date.now() + SMS_LEASE_MS) })
        .where(eq(smsDeliveriesTable.id, claimed.id));
      return { inProgress: true };
    }
  }

  // ── Submit (fresh or reconciliation-confirmed resend) ────────────────────
  // Durably persist the unknown-outcome marker WHILE holding the lease, right
  // before the provider request. If we crash during/after send, the next claim
  // sees submissionStartedAt and reconciles instead of blind-resending.
  await db.update(smsDeliveriesTable)
    .set({ submissionStartedAt: new Date() })
    .where(eq(smsDeliveriesTable.id, claimed.id));

  let sent: { messageId?: string };
  try {
    sent = await usedProvider.send({ to: input.phone, text: input.text, idempotencyKey: claimed.id });
  } catch (error) {
    logger.warn({ err: error, eventKey: input.eventKey }, "SMS delivery failed");
    // Provider error → mark failed but PRESERVE submissionStartedAt so the next
    // claim reconciles (the request may still have reached the provider). The
    // provider reference/messageId (== claimed.id) is never cleared on retry.
    await db.update(smsDeliveriesTable)
      .set({ status: "failed", errorMessage: error instanceof Error ? error.message.slice(0, 1000) : "Nepoznata SMS greška", claimExpiresAt: null })
      .where(eq(smsDeliveriesTable.id, claimed.id));
    return { failed: true };
  }

  // Provider ACCEPTED. Record sent. If this DB write fails, we must NOT erase the
  // unknown-outcome marker nor blind-resend — the row stays processing with its
  // submissionStartedAt intact, and the next claim reconciles via lookup.
  try {
    await db.update(smsDeliveriesTable)
      .set({ status: "sent", providerMessageId: sent.messageId ?? claimed.id, sentAt: new Date(), claimExpiresAt: null })
      .where(eq(smsDeliveriesTable.id, claimed.id));
  } catch (error) {
    logger.error({ err: error, eventKey: input.eventKey }, "SMS sent but persisting sent-state failed; will reconcile on next claim");
    // Leave the row as-is (processing, submissionStartedAt set). The lease will
    // expire and the next claim reconciles the accepted submission to sent.
  }
  return sent;
}