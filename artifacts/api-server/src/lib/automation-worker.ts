/**
 * Automation worker: evaluates active automation rules idempotently.
 * Runs periodically; each run processes all active rules for all salons.
 * Strict tenant isolation — each rule is processed within its own salon boundary.
 */

import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  db,
  automationRulesTable,
  automationRunsTable,
  automationDeliveriesTable,
  appointmentsTable,
  salonCustomersTable,
  salonsTable,
  customerPackagePurchasesTable,
} from "@workspace/db";
import { sendTransactionalEmail, lumeraEmailHtml, type TransactionalEmailTransport } from "./brevo";
import { sendSms, type SmsProvider } from "./sms";
import { logger } from "./logger";

export type AutomationRule = typeof automationRulesTable.$inferSelect;
export type SalonCustomer = typeof salonCustomersTable.$inferSelect;

// ---------------------------------------------------------------------------
// Template substitution
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type TemplateVars = {
  firstName: string;
  lastName: string;
  salonName: string;
  voucherCode: string;
};

/**
 * Substitute known placeholders. Every value is HTML-escaped via the same path
 * so email bodies are safe; SMS bodies contain no HTML so escaping is inert
 * (plain text) for the characters that appear in names. Unknown placeholders are
 * left literal (existing behavior) — only the documented set is replaced.
 */
export function substituteTemplate(
  template: string,
  vars: TemplateVars,
): string {
  return template
    .replace(/\{\{firstName\}\}/g, escapeHtml(vars.firstName))
    .replace(/\{\{lastName\}\}/g, escapeHtml(vars.lastName))
    .replace(/\{\{salonName\}\}/g, escapeHtml(vars.salonName))
    .replace(/\{\{voucherCode\}\}/g, escapeHtml(vars.voucherCode));
}

// ---------------------------------------------------------------------------
// Trigger evaluation — exported so test-run can reuse it
// ---------------------------------------------------------------------------

export async function evaluateTrigger(
  rule: AutomationRule,
  customer: SalonCustomer,
  now: Date,
): Promise<{ triggered: boolean; reason?: string }> {
  const salonId = rule.salonId;
  const customerId = customer.id;
  const cfg = rule.triggerConfig as Record<string, unknown>;

  switch (rule.trigger) {
    case "inactive_days": {
      const inactiveDays = typeof cfg["inactiveDays"] === "number" ? cfg["inactiveDays"] : 30;
      const cutoff = new Date(now.getTime() - inactiveDays * 86_400_000).toISOString().slice(0, 10);
      // Only fire if NO future appointment exists either
      const [futureAppt] = await db
        .select({ id: appointmentsTable.id })
        .from(appointmentsTable)
        .where(and(
          eq(appointmentsTable.salonId, salonId),
          eq(appointmentsTable.salonCustomerId, customerId),
          gte(appointmentsTable.date, now.toISOString().slice(0, 10)),
          sql`${appointmentsTable.status} in ('pending', 'confirmed')`,
        ))
        .limit(1);
      if (futureAppt) return { triggered: false, reason: "has_future_appointment" };

      const [last] = await db
        .select({ date: appointmentsTable.date })
        .from(appointmentsTable)
        .where(and(
          eq(appointmentsTable.salonId, salonId),
          eq(appointmentsTable.salonCustomerId, customerId),
          eq(appointmentsTable.status, "completed"),
        ))
        .orderBy(sql`${appointmentsTable.date} desc`)
        .limit(1);
      if (!last) return { triggered: false, reason: "no_completed_appointments" };
      return { triggered: last.date < cutoff };
    }

    case "birthday": {
      if (!customer.birthDate) return { triggered: false, reason: "no_birthdate" };
      // Match month-day; fire once per calendar year using epoch key
      const bdMD = customer.birthDate.slice(5); // MM-DD
      const todayMD = now.toISOString().slice(5, 10); // MM-DD
      return { triggered: bdMD === todayMD };
    }

    case "visit_count": {
      const targetCount = typeof cfg["visitCount"] === "number" ? cfg["visitCount"] : 5;
      const [countRow] = await db
        .select({ cnt: sql<number>`count(*)::int` })
        .from(appointmentsTable)
        .where(and(
          eq(appointmentsTable.salonId, salonId),
          eq(appointmentsTable.salonCustomerId, customerId),
          eq(appointmentsTable.status, "completed"),
        ));
      // Exact match to avoid repeated fires
      return { triggered: (countRow?.cnt ?? 0) === targetCount };
    }

    case "first_visit_completed": {
      const [countRow] = await db
        .select({ cnt: sql<number>`count(*)::int` })
        .from(appointmentsTable)
        .where(and(
          eq(appointmentsTable.salonId, salonId),
          eq(appointmentsTable.salonCustomerId, customerId),
          eq(appointmentsTable.status, "completed"),
        ));
      return { triggered: (countRow?.cnt ?? 0) === 1 };
    }

    case "package_completed": {
      const [purchase] = await db
        .select({ id: customerPackagePurchasesTable.id })
        .from(customerPackagePurchasesTable)
        .where(and(
          eq(customerPackagePurchasesTable.salonId, salonId),
          eq(customerPackagePurchasesTable.salonCustomerId, customerId),
          eq(customerPackagePurchasesTable.status, "completed"),
        ))
        .limit(1);
      return { triggered: purchase !== undefined };
    }

    case "appointment_cancelled": {
      const lookback = typeof cfg["lookbackDays"] === "number" ? cfg["lookbackDays"] : 7;
      const cutoff = new Date(now.getTime() - lookback * 86_400_000).toISOString().slice(0, 10);
      const [cancelled] = await db
        .select({ id: appointmentsTable.id })
        .from(appointmentsTable)
        .where(and(
          eq(appointmentsTable.salonId, salonId),
          eq(appointmentsTable.salonCustomerId, customerId),
          eq(appointmentsTable.status, "cancelled"),
          gte(appointmentsTable.date, cutoff),
        ))
        .limit(1);
      return { triggered: cancelled !== undefined };
    }

    case "expected_return_overdue": {
      // Use customer's typical interval if computable, else fall back to configuredDays
      const configuredDays = typeof cfg["overdueDays"] === "number" ? cfg["overdueDays"] : 45;

      // Check no future appointment first
      const [futureAppt] = await db
        .select({ id: appointmentsTable.id })
        .from(appointmentsTable)
        .where(and(
          eq(appointmentsTable.salonId, salonId),
          eq(appointmentsTable.salonCustomerId, customerId),
          gte(appointmentsTable.date, now.toISOString().slice(0, 10)),
          sql`${appointmentsTable.status} in ('pending', 'confirmed')`,
        ))
        .limit(1);
      if (futureAppt) return { triggered: false, reason: "has_future_appointment" };

      const completedRows = await db
        .select({ date: appointmentsTable.date })
        .from(appointmentsTable)
        .where(and(
          eq(appointmentsTable.salonId, salonId),
          eq(appointmentsTable.salonCustomerId, customerId),
          eq(appointmentsTable.status, "completed"),
        ))
        .orderBy(sql`${appointmentsTable.date} asc`);

      if (!completedRows.length) return { triggered: false, reason: "no_completed_appointments" };

      // Compute median interval
      let typicalDays = configuredDays;
      if (completedRows.length >= 2) {
        const gaps: number[] = [];
        for (let i = 1; i < completedRows.length; i++) {
          const diff = (new Date(completedRows[i]!.date).getTime() - new Date(completedRows[i - 1]!.date).getTime()) / 86_400_000;
          gaps.push(diff);
        }
        gaps.sort((a, b) => a - b);
        const mid = Math.floor(gaps.length / 2);
        typicalDays = gaps.length % 2 === 0 ? ((gaps[mid - 1]! + gaps[mid]!) / 2) : gaps[mid]!;
      }

      const lastDate = completedRows[completedRows.length - 1]!.date;
      const daysSince = Math.floor((now.getTime() - new Date(lastDate).getTime()) / 86_400_000);
      return { triggered: daysSince > typicalDays };
    }

    default:
      return { triggered: false, reason: "unknown_trigger" };
  }
}

// ---------------------------------------------------------------------------
// Cooldown + idempotency keys
// ---------------------------------------------------------------------------

/**
 * Rolling cooldown window: a full 14×24h must elapse since the LAST CONFIRMED
 * SENT run (per rule+customer) before another send may proceed. This is a true
 * rolling window anchored on automationRunsTable.sentAt — NOT a calendar-bucket
 * (`floor(now/14d)`) window, which previously allowed two sends seconds apart
 * across a bucket boundary. The rolling gate is enforced under a per-(rule,
 * customer) advisory xact lock so concurrent workers around the boundary can
 * never both send.
 */
export const AUTOMATION_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Stable idempotency / event key for a single send *occasion*.
 *
 * The bucket component keeps the provider + automation-delivery event keys
 * STABLE across worker ticks and retries within the same 14-day cycle (so a
 * provider-success-then-crash retry dedupes on the same key). It is NOT used as
 * the cooldown decision — that is the rolling `sentAt` check in `isInCooldown`.
 * The eventKey remains unique per rule+customer+cycle for idempotency.
 *
 * Historical name retained for API stability; callers/tests import it as-is.
 */
export function buildEpochKey(ruleId: string, customerId: string, now: Date): string {
  const cycle = Math.floor(now.getTime() / AUTOMATION_COOLDOWN_MS);
  return `automation:${ruleId}:${customerId}:${cycle}`;
}

/**
 * True rolling-cooldown gate. MUST be called while holding the per-(rule,
 * customer) advisory xact lock inside a transaction so the read is serialized
 * against concurrent workers. Returns the blocking sentAt when suppressed.
 */
async function findActiveCooldown(
  exec: Executor,
  ruleId: string,
  customerId: string,
  now: Date,
): Promise<Date | null> {
  const [last] = await exec
    .select({ sentAt: automationRunsTable.sentAt })
    .from(automationRunsTable)
    .where(and(
      eq(automationRunsTable.ruleId, ruleId),
      eq(automationRunsTable.salonCustomerId, customerId),
      eq(automationRunsTable.status, "sent"),
      isNotNull(automationRunsTable.sentAt),
    ))
    .orderBy(sql`${automationRunsTable.sentAt} desc`)
    .limit(1);
  if (!last?.sentAt) return null;
  const elapsed = now.getTime() - last.sentAt.getTime();
  return elapsed < AUTOMATION_COOLDOWN_MS ? last.sentAt : null;
}

// ---------------------------------------------------------------------------
// Delivery helpers — claim/lease pattern
//
// Crash-safe delivery lifecycle:
//   queued   → (claim) → processing → (success) → sent
//                                    → (opt-out)  → skipped
//                                    → (error)    → failed → (reclaim) → processing → …
//
// Terminal states: sent, skipped. Only sent and intentional skipped are final.
// A processing row whose lease (claimExpiresAt) has expired is reclaimable by
// any worker — this covers worker crashes after claim but before provider call.
// If the provider succeeded but the local status update crashed, the SAME
// eventKey is passed to the provider on retry so the provider's own idempotency
// key deduplicates the send; we then reconcile status to "sent".
// ---------------------------------------------------------------------------

/** Lease duration in milliseconds (5 minutes). */
const DELIVERY_LEASE_MS = 5 * 60 * 1000;

type SenderOverride = {
  emailTransport?: TransactionalEmailTransport;
  smsProvider?: SmsProvider;
};

/**
 * Executor for automationDeliveriesTable writes: either the top-level `db` or a
 * transaction handle. Automation deliveries reference the run row (FK on
 * run_id), and the run is created inside the advisory-locked cooldown
 * transaction, so delivery writes MUST use that same transaction to see the
 * not-yet-committed run. (The SMS/email provider adapters keep their own
 * independent smsDeliveriesTable/brevo bookkeeping on `db`.)
 */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Atomically claim a delivery row for processing.
 *
 * Returns the claimed row or null if another worker holds a live lease
 * (concurrent non-stale claim — leave the run retryable, don't mark it sent).
 *
 * Claimable conditions:
 *   - status = 'queued'   (fresh row — first attempt)
 *   - status = 'failed'   (prior attempt failed — retry allowed)
 *   - status = 'processing' AND claimExpiresAt < NOW()  (stale lease — recovery)
 */
async function claimDelivery(
  exec: Executor,
  channelEventKey: string,
  runId: string,
  salonId: string,
  channel: string,
  recipientEmail: string | null | undefined,
  recipientPhone: string | null | undefined,
  now: Date,
): Promise<{
  row: typeof automationDeliveriesTable.$inferSelect;
  alreadyFinal: boolean;
} | null> {
  const claimExpiry = new Date(now.getTime() + DELIVERY_LEASE_MS);

  // Step 1: ensure row exists (idempotent insert as queued).
  await exec.insert(automationDeliveriesTable).values({
    runId,
    salonId,
    eventKey: channelEventKey,
    channel,
    recipientEmail: recipientEmail ?? null,
    recipientPhone: recipientPhone ?? null,
    status: "queued",
  }).onConflictDoNothing();

  // Step 2: conditional UPDATE to claim. Only transitions from claimable states.
  // This is the single atomic "compare-and-swap" that prevents double-send.
  const claimed = await exec
    .update(automationDeliveriesTable)
    .set({ status: "processing", processingStartedAt: now, claimExpiresAt: claimExpiry })
    .where(and(
      eq(automationDeliveriesTable.eventKey, channelEventKey),
      or(
        inArray(automationDeliveriesTable.status, ["queued", "failed"]),
        and(
          eq(automationDeliveriesTable.status, "processing"),
          lt(automationDeliveriesTable.claimExpiresAt, now),
        ),
      ),
    ))
    .returning();

  if (claimed.length) return { row: claimed[0]!, alreadyFinal: false };

  // Step 3: no row was updated — either it's already terminal (sent/skipped)
  // or another worker holds a live processing lease. Read current state.
  const [existing] = await exec
    .select()
    .from(automationDeliveriesTable)
    .where(eq(automationDeliveriesTable.eventKey, channelEventKey))
    .limit(1);

  if (!existing) return null; // Shouldn't happen after step 1, but handle defensively.

  if (existing.status === "sent" || existing.status === "skipped") {
    // Already terminal — caller should dedupe.
    return { row: existing, alreadyFinal: true };
  }

  // Another worker holds a non-stale processing lease — leave run pending.
  return null;
}

async function sendAutomationEmail(
  exec: Executor,
  runId: string,
  salonId: string,
  email: string | null | undefined,
  subject: string,
  body: string,
  eventKey: string,
  override?: SenderOverride,
  now = new Date(),
): Promise<"sent" | "skipped" | "failed" | "leased_by_other"> {
  const channelKey = `${eventKey}:email`;
  const claim = await claimDelivery(exec, channelKey, runId, salonId, "email", email, null, now);

  if (!claim) {
    // Another worker holds a live lease — leave run pending/retryable.
    return "leased_by_other";
  }
  if (claim.alreadyFinal) {
    return claim.row.status === "skipped" ? "skipped" : "sent";
  }

  // We hold the lease — proceed to send.
  if (!email) {
    await exec.update(automationDeliveriesTable)
      .set({ status: "skipped", errorMessage: "No email address", claimExpiresAt: null })
      .where(eq(automationDeliveriesTable.eventKey, channelKey));
    return "skipped";
  }

  try {
    // Pass the SAME channelKey as eventKey so the email outbox reuses one stable
    // delivery id as the Brevo idempotency key across retries. This makes a
    // provider-success-but-local-crash reconcile to "sent" via duplicate_parameter,
    // and lets a temporary failure be retried by the background email worker.
    //
    // sendTransactionalEmail does NOT throw on provider failure — it returns a
    // discriminated result. We MUST inspect it: treating a no-throw as success
    // would wrongly mark a failed/queued send as "sent" and (via the caller)
    // anchor the rolling cooldown on a delivery that never actually went out.
    const result = await sendTransactionalEmail({
      eventKey: channelKey,
      emailType: "automation",
      to: { email },
      subject,
      htmlContent: lumeraEmailHtml(subject, `<p>${body.replace(/\n/g, "<br>")}</p>`),
      salonId,
    }, override?.emailTransport);

    // messageId → provider accepted; deduplicated → prior send already succeeded.
    if ("messageId" in result || "deduplicated" in result) {
      await exec.update(automationDeliveriesTable)
        .set({ status: "sent", sentAt: now, claimExpiresAt: null })
        .where(eq(automationDeliveriesTable.eventKey, channelKey));
      return "sent";
    }
    // Transport not configured / permanently un-sendable → intentional skip.
    if ("skipped" in result) {
      await exec.update(automationDeliveriesTable)
        .set({ status: "skipped", errorMessage: "Email transport skipped", claimExpiresAt: null })
        .where(eq(automationDeliveriesTable.eventKey, channelKey));
      return "skipped";
    }
    // queued (temporary failure awaiting backoff retry) or inProgress (another
    // worker/lease active) → NOT final. Leave the automation delivery reclaimable
    // (queued) and the run pending so a later reconciliation finalises it once the
    // background email retry succeeds/fails. Never anchor the cooldown here.
    if ("queued" in result || "inProgress" in result) {
      await exec.update(automationDeliveriesTable)
        .set({ status: "queued", claimExpiresAt: null })
        .where(eq(automationDeliveriesTable.eventKey, channelKey));
      return "leased_by_other";
    }
    // failed → permanent/exhausted. Retryable at the automation layer only via a
    // fresh cycle; does not anchor the cooldown.
    await exec.update(automationDeliveriesTable)
      .set({ status: "failed", errorMessage: "Email delivery failed", claimExpiresAt: null })
      .where(eq(automationDeliveriesTable.eventKey, channelKey));
    return "failed";
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 500) : "unknown";
    await exec.update(automationDeliveriesTable)
      .set({ status: "failed", errorMessage: msg, claimExpiresAt: null })
      .where(eq(automationDeliveriesTable.eventKey, channelKey));
    return "failed";
  }
}

async function sendAutomationSms(
  exec: Executor,
  runId: string,
  salonId: string,
  phone: string | null | undefined,
  smsOptOut: boolean,
  text: string,
  eventKey: string,
  override?: SenderOverride,
  now = new Date(),
): Promise<"sent" | "skipped" | "failed" | "leased_by_other"> {
  const channelKey = `${eventKey}:sms`;
  const claim = await claimDelivery(exec, channelKey, runId, salonId, "sms", null, phone, now);

  if (!claim) {
    return "leased_by_other";
  }
  if (claim.alreadyFinal) {
    return claim.row.status === "skipped" ? "skipped" : "sent";
  }

  // We hold the automation-delivery lease — sendSms passes the SAME channelKey
  // so the SMS delivery row (its own claim/lease lifecycle) handles crash
  // recovery and provider-success-before-local-status-crash reconciliation.
  const result = await sendSms({
    eventKey: channelKey,
    salonId,
    appointmentId: null,
    type: "automation",
    phone,
    smsOptOut,
    text,
  }, override?.smsProvider);

  // A LIVE SMS claim (another sender holds the lease) must NOT finalize the
  // automation delivery — leave the run pending so it retries. We treat this
  // like leased_by_other: keep the automation delivery in processing (still
  // claimable when its own lease expires) and do not mark sent/skipped/failed.
  if ("inProgress" in result) {
    return "leased_by_other";
  }

  // Reconcile against the persistent smsDeliveriesTable state. A "deduplicated"
  // result means the SMS row is already terminal; its priorStatus tells us
  // whether the message was actually sent (provider-success-then-local-crash →
  // preserve "sent" attribution) or intentionally skipped (opt-out/no-phone).
  let status: "sent" | "skipped" | "failed";
  if ("deduplicated" in result) {
    status = result.priorStatus === "sent" ? "sent"
      : result.priorStatus === "skipped" ? "skipped"
      : "skipped"; // queued/processing/unknown → don't over-claim attribution
  } else if ("skipped" in result) {
    status = "skipped";
  } else if ("failed" in result) {
    status = "failed";
  } else {
    status = "sent";
  }

  await exec.update(automationDeliveriesTable)
    .set({ status, sentAt: status === "sent" ? now : undefined, claimExpiresAt: null })
    .where(eq(automationDeliveriesTable.eventKey, channelKey));

  return status;
}

// ---------------------------------------------------------------------------
// Process one rule for all customers in its salon
// ---------------------------------------------------------------------------

async function processRule(
  rule: AutomationRule,
  salonName: string,
  now: Date,
  override?: SenderOverride,
): Promise<{ sent: number; skipped: number; failed: number }> {
  const stats = { sent: 0, skipped: 0, failed: 0 };

  const customers = await db
    .select()
    .from(salonCustomersTable)
    .where(eq(salonCustomersTable.salonId, rule.salonId));

  for (const customer of customers) {
    try {
      // Serialize the ENTIRE decision + send for this (rule, customer) with a
      // per-pair advisory xact lock. This guarantees that two concurrent workers
      // evaluating the same customer around the 14-day boundary cannot both send:
      // the first commits with sentAt set, the second then observes the active
      // rolling cooldown and suppresses. The lock scope is per-(rule,customer),
      // so it introduces no cross-customer contention.
      const lockKey = `automation-cooldown:${rule.id}:${customer.id}`;
      const outcome = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);

        const key = buildEpochKey(rule.id, customer.id, now);

        // 1) Evaluate eligibility FIRST. A non-triggered customer must NOT
        //    consume a run row, so if they become eligible later they still send.
        const { triggered } = await evaluateTrigger(rule, customer, now);
        if (!triggered) return "skipped" as const;

        // 2) True ROLLING cooldown gate (serialized by the advisory lock above):
        //    suppress if < 14×24h since the last CONFIRMED sent run. Intentional
        //    skipped / failed / ineligible attempts never anchor this window —
        //    only a run with status='sent' and a sentAt timestamp does.
        const cooldownUntil = await findActiveCooldown(tx, rule.id, customer.id, now);
        if (cooldownUntil) return "skipped" as const;

        // 3) Triggered + eligible → claim (or reuse) a run for this cycle key.
        //    - New row inserted → we own it, proceed to deliver.
        //    - Conflict → a run already exists for this rule+customer+cycle.
        //      * sent/skipped → final, dedupe (skip).
        //      * pending/failed → retry through it (channel event keys dedupe sends).
        const [inserted] = await tx.insert(automationRunsTable).values({
          eventKey: key,
          ruleId: rule.id,
          salonId: rule.salonId,
          salonCustomerId: customer.id,
          status: "pending",
          executedAt: now,
        }).onConflictDoNothing().returning();

        let run = inserted;
        if (!run) {
          const [existing] = await tx
            .select()
            .from(automationRunsTable)
            .where(eq(automationRunsTable.eventKey, key))
            .limit(1);
          if (!existing) return "skipped" as const; // vanished; nothing safe to do
          if (existing.status === "sent" || existing.status === "skipped") {
            return "skipped" as const; // final — dedupe
          }
          // pending or failed → retry. Reset executedAt so attribution windows
          // track the latest attempt; channel event keys prevent resending sent
          // channels. sentAt is preserved (only ever set on a confirmed send).
          const [reclaimed] = await tx.update(automationRunsTable)
            .set({ status: "pending", executedAt: now, errorMessage: null, skipReason: null })
            .where(eq(automationRunsTable.id, existing.id))
            .returning();
          run = reclaimed ?? existing;
        }

        // Build template vars (firstName + lastName + salonName + voucherCode).
        const templateVars = {
          firstName: customer.firstName,
          lastName: customer.lastName,
          salonName,
          voucherCode: rule.voucherCode ?? "",
        };

        const subject = substituteTemplate(rule.emailSubject ?? "Poruka od salona", templateVars);
        const emailBody = substituteTemplate(rule.emailBody ?? "", templateVars);
        const smsBody = substituteTemplate(rule.smsBody ?? "", templateVars);

        const results: Array<"sent" | "skipped" | "failed" | "leased_by_other"> = [];

        if (rule.action === "send_email" || rule.action === "send_email_and_sms") {
          results.push(await sendAutomationEmail(tx, run.id, rule.salonId, customer.email, subject, emailBody, key, override, now));
        }
        if (rule.action === "send_sms" || rule.action === "send_email_and_sms") {
          results.push(await sendAutomationSms(tx, run.id, rule.salonId, customer.phone, customer.smsOptOut, smsBody, key, override, now));
        }

        // If any channel is leased_by_other, leave run pending so the owning
        // worker finalises it; don't count as sent/skipped/failed from our side.
        if (results.includes("leased_by_other")) {
          return "skipped" as const;
        }

        // Run is "sent" only if at least one channel actually sent.
        const finalResults = results as Array<"sent" | "skipped" | "failed">;
        const finalStatus = finalResults.includes("sent") ? "sent"
          : finalResults.includes("failed") ? "failed"
          : "skipped";

        const skipOrFailReason = finalStatus !== "sent"
          ? finalResults.every((r) => r === "skipped") ? "all_channels_skipped" : "all_channels_failed"
          : undefined;

        await tx.update(automationRunsTable)
          .set({
            status: finalStatus,
            skipReason: skipOrFailReason ?? null,
            errorMessage: finalStatus === "failed" ? "One or more delivery channels failed." : null,
            // Anchor the rolling cooldown ONLY on a confirmed send. Never reset
            // it for skipped/failed so a failed attempt stays retryable.
            sentAt: finalStatus === "sent" ? now : undefined,
          })
          .where(eq(automationRunsTable.id, run.id));

        return finalStatus;
      });

      if (outcome === "sent") stats.sent++;
      else if (outcome === "failed") stats.failed++;
      else stats.skipped++;

    } catch (err) {
      logger.warn({ err, ruleId: rule.id, customerId: customer.id }, "Automation customer evaluation failed");
      stats.failed++;
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Attribution pass: link sent runs to new appointments within 14 days
// ---------------------------------------------------------------------------

async function runAttributionPass(now: Date): Promise<void> {
  const windowStart = new Date(now.getTime() - 14 * 86_400_000);

  // Find sent runs with no attribution yet, from the last 14 days
  const unattributed = await db
    .select({
      id: automationRunsTable.id,
      salonCustomerId: automationRunsTable.salonCustomerId,
      salonId: automationRunsTable.salonId,
      executedAt: automationRunsTable.executedAt,
    })
    .from(automationRunsTable)
    .where(and(
      eq(automationRunsTable.status, "sent"),
      isNull(automationRunsTable.attributedAppointmentId),
      gte(automationRunsTable.createdAt, windowStart),
    ))
    .limit(200);

  for (const run of unattributed) {
    if (!run.executedAt) continue;
    const [appt] = await db
      .select({ id: appointmentsTable.id })
      .from(appointmentsTable)
      .where(and(
        eq(appointmentsTable.salonId, run.salonId),
        eq(appointmentsTable.salonCustomerId, run.salonCustomerId),
        gte(appointmentsTable.createdAt, run.executedAt),
        lte(appointmentsTable.createdAt, new Date(run.executedAt.getTime() + 14 * 86_400_000)),
        sql`${appointmentsTable.status} in ('pending', 'confirmed', 'completed')`,
      ))
      .limit(1);

    if (appt) {
      await db.update(automationRunsTable)
        .set({ attributedAppointmentId: appt.id })
        .where(eq(automationRunsTable.id, run.id));
    }
  }
}

// ---------------------------------------------------------------------------
// Public: dry-run evaluator for test-run endpoint
// ---------------------------------------------------------------------------

export interface DryRunResult {
  wouldTriggerCount: number;
  eligibleCustomers: number;
  skippedDueToOptOut: number;
  skippedDueToRecentRun: number;
  triggerBreakdown: Record<string, number>;
}

export async function dryRunAutomationRule(
  rule: AutomationRule,
  now = new Date(),
): Promise<DryRunResult> {
  const customers = await db
    .select()
    .from(salonCustomersTable)
    .where(eq(salonCustomersTable.salonId, rule.salonId));

  let wouldTriggerCount = 0;
  let skippedDueToOptOut = 0;
  let skippedDueToRecentRun = 0;
  const triggerBreakdown: Record<string, number> = {};

  for (const customer of customers) {
    // Mirror the live worker's TRUE rolling cooldown (not the calendar-bucket
    // proxy) so the dry-run estimate matches what a real run would actually do.
    const cooldownUntil = await findActiveCooldown(db, rule.id, customer.id, now);
    if (cooldownUntil) { skippedDueToRecentRun++; continue; }

    const smsOnlyAndOptedOut = customer.smsOptOut && rule.action === "send_sms";
    if (smsOnlyAndOptedOut) { skippedDueToOptOut++; continue; }

    const { triggered } = await evaluateTrigger(rule, customer, now);
    if (triggered) {
      wouldTriggerCount++;
      triggerBreakdown[rule.trigger] = (triggerBreakdown[rule.trigger] ?? 0) + 1;
    }
  }

  return {
    wouldTriggerCount,
    eligibleCustomers: customers.length,
    skippedDueToOptOut,
    skippedDueToRecentRun,
    triggerBreakdown,
  };
}

// ---------------------------------------------------------------------------
// Scheduled runner
// ---------------------------------------------------------------------------

export async function runAutomationWorker(
  now = new Date(),
  override?: SenderOverride,
): Promise<{
  rulesProcessed: number;
  sent: number;
  skipped: number;
  failed: number;
}> {
  const activeRules = await db
    .select({
      rule: automationRulesTable,
      salonName: salonsTable.name,
    })
    .from(automationRulesTable)
    .innerJoin(salonsTable, eq(salonsTable.id, automationRulesTable.salonId))
    .where(eq(automationRulesTable.status, "active"));

  let totalSent = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const { rule, salonName } of activeRules) {
    try {
      const stats = await processRule(rule, salonName, now, override);
      totalSent += stats.sent;
      totalSkipped += stats.skipped;
      totalFailed += stats.failed;
    } catch (err) {
      logger.warn({ err, ruleId: rule.id }, "Automation rule processing failed");
      totalFailed++;
    }
  }

  // Attribution pass — run after all deliveries
  try {
    await runAttributionPass(now);
  } catch (err) {
    logger.warn({ err }, "Automation attribution pass failed");
  }

  logger.info(
    { rulesProcessed: activeRules.length, sent: totalSent, skipped: totalSkipped, failed: totalFailed },
    "Automation worker run complete",
  );

  return {
    rulesProcessed: activeRules.length,
    sent: totalSent,
    skipped: totalSkipped,
    failed: totalFailed,
  };
}
