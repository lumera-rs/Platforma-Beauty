/**
 * Background operational monitors.
 *
 * These checks deliberately use provider truth rather than the last admin
 * page visit. A provider-side edit can remove Brevo event subscriptions while
 * the application itself continues to send email successfully.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  BrevoConfigurationError,
  listBrevoTransactionalWebhooks,
  lumeraEmailHtml,
  missingEventsForActiveBrevoRegistration,
  sendTransactionalEmail,
  type TransactionalEmailTransport,
} from "./brevo";
import {
  brevoRegistrationMissingEvents,
  clearBrevoRegistrationIncomplete,
  integrationSettings,
  markBrevoRegistrationIncomplete,
} from "./integrations";
import {
  deploymentPublicOrigin,
  missingBrevoWebhookEvents,
  resolveWebhookSecret,
} from "./provider-events";
import { logger } from "./logger";

const BREVO_WEBHOOK_COVERAGE_ALERT_EMAIL_TYPE = "brevo_webhook_coverage_alert";
const MAX_BREVO_REGISTRATION_ALERT_RECIPIENTS = 500;

type MonitorStatus = "healthy" | "incomplete" | "skipped" | "unavailable";

export type BrevoWebhookCoverageMonitorResult = {
  status: MonitorStatus;
  activeRegistration: boolean | null;
  missingEvents: string[];
  recipientCount: number;
  attemptedEventKeys: string[];
  deduplicatedCount: number;
  failedDeliveryCount: number;
  skippedDeliveryCount: number;
};

export type BrevoWebhookCoverageMonitorOptions = {
  /** Injected by regression tests; production checks use their actual start time. */
  observedAt?: Date;
};

function emptyResult(status: MonitorStatus, activeRegistration: boolean | null = null): BrevoWebhookCoverageMonitorResult {
  return {
    status,
    activeRegistration,
    missingEvents: [],
    recipientCount: 0,
    attemptedEventKeys: [],
    deduplicatedCount: 0,
    failedDeliveryCount: 0,
    skippedDeliveryCount: 0,
  };
}

function configuredDeploymentOrigins(): Set<string> {
  const origin = deploymentPublicOrigin();
  return origin ? new Set([origin]) : new Set();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function recipientKey(email: string): string {
  return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16);
}

function missingEventsKey(missingEvents: readonly string[]): string {
  return createHash("sha256").update(missingEvents.join("\u001f")).digest("hex").slice(0, 24);
}

function deploymentKey(origins: ReadonlySet<string>): string {
  return createHash("sha256").update([...origins].sort().join("\u001f")).digest("hex").slice(0, 16);
}

/**
 * Check the current Brevo registration and notify active administrators once
 * for each distinct missing-event set. The persisted integration marker is
 * also updated so the existing admin integrations card remains actionable
 * until a later healthy check clears it.
 *
 * Provider failures are intentionally non-fatal: they are not evidence that
 * the registration changed, so the previous warning must not be cleared.
 */
export async function runBrevoWebhookCoverageMonitor(
  now = new Date(),
  transport?: TransactionalEmailTransport,
  options: BrevoWebhookCoverageMonitorOptions = {},
): Promise<BrevoWebhookCoverageMonitorResult> {
  const settings = await integrationSettings("brevo");
  if (!settings.enabled) return emptyResult("skipped");

  const secret = await resolveWebhookSecret("brevo");
  const origins = configuredDeploymentOrigins();
  if (!secret || !origins.size) return emptyResult("skipped");
  // The timestamp captures when this provider observation started. A later
  // check that finishes first must win over this older observation.
  const observedAt = options.observedAt ?? new Date();

  let webhooks;
  try {
    webhooks = await listBrevoTransactionalWebhooks({ requireRecognizedResponse: true });
  } catch (error) {
    if (!(error instanceof BrevoConfigurationError)) {
      logger.warn({ errorType: error instanceof Error ? error.name : typeof error }, "Brevo webhook coverage check could not load provider registrations");
    }
    return emptyResult("unavailable");
  }

  const activeRegistrationMissingEvents = missingEventsForActiveBrevoRegistration(webhooks, secret, origins);
  const activeRegistration = activeRegistrationMissingEvents !== null;
  // No current registration is an incident too: all delivery capabilities are
  // currently uncovered. This is distinct from skipped configuration above,
  // where no provider check was safe to perform.
  const missingEvents = activeRegistrationMissingEvents ?? missingBrevoWebhookEvents([]);

  if (!missingEvents.length) {
    const applied = await clearBrevoRegistrationIncomplete(observedAt);
    if (!applied) return emptyResult("skipped", activeRegistration);
    return emptyResult("healthy", activeRegistration);
  }

  const alertEpisode = await markBrevoRegistrationIncomplete(missingEvents, null, observedAt);
  if (!alertEpisode) {
    return emptyResult("skipped", activeRegistration);
  }
  const recipients = await db.select({ email: usersTable.email })
    .from(usersTable)
    .where(and(
      eq(usersTable.active, true),
      inArray(usersTable.role, ["ADMIN", "SUPER_ADMIN"]),
    ))
    .limit(MAX_BREVO_REGISTRATION_ALERT_RECIPIENTS);
  if (!recipients.length) {
    logger.warn({ missingEvents }, "Brevo webhook coverage alert has no configured administrator recipients");
    return {
      ...emptyResult("incomplete", activeRegistration),
      missingEvents,
    };
  }

  const coverageKey = missingEventsKey(missingEvents);
  const configuredDeploymentKey = deploymentKey(origins);
  const alertEpisodeKey = createHash("sha256").update(alertEpisode).digest("hex").slice(0, 16);
  const subject = "LUMERA — nedostaju događaji na Brevo webhook-u";
  const eventDescription = missingEvents.map(escapeHtml).join(", ");
  const registrationDescription = activeRegistration
    ? "Aktivna Brevo webhook registracija više ne prati sve događaje koje LUMERA obrađuje."
    : "Aktivna Brevo webhook registracija nije pronađena za ovu aplikaciju.";
  const htmlContent = lumeraEmailHtml(
    "Potrebna je intervencija: Brevo webhook",
    `<p>${registrationDescription}</p>
     <p><strong>Nedostaju:</strong> ${eventDescription}</p>
     <p>Otvorite Admin → Integracije i na Brevo ponovo uključite navedene događaje (Transactional → Settings → Webhooks). Bez njih se tiho gube praćenje otvaranja i upozorenja o neisporučenim porukama.</p>`,
  );

  const attemptedEventKeys: string[] = [];
  const sends = recipients.map((recipient) => {
    const eventKey = `brevo-webhook-coverage-alert:${configuredDeploymentKey}:${alertEpisodeKey}:${coverageKey}:${recipientKey(recipient.email)}`;
    attemptedEventKeys.push(eventKey);
    return sendTransactionalEmail({
      eventKey,
      emailType: BREVO_WEBHOOK_COVERAGE_ALERT_EMAIL_TYPE,
      to: { email: recipient.email },
      subject,
      htmlContent,
      metadata: {
        missingEvents,
        checkedAt: now.toISOString(),
        activeRegistration,
      },
    }, transport);
  });
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
      { recipientCount: recipients.length, missingEvents, failedDeliveryCount, skippedDeliveryCount },
      "Brevo webhook coverage alert delivery did not complete for every administrator",
    );
  } else if (deduplicatedCount < results.length) {
    logger.info({ recipientCount: recipients.length, missingEvents }, "Brevo webhook coverage alert delivery queued");
  }

  return {
    status: "incomplete",
    activeRegistration,
    missingEvents,
    recipientCount: recipients.length,
    attemptedEventKeys,
    deduplicatedCount,
    failedDeliveryCount,
    skippedDeliveryCount,
  };
}

/** Compatibility alias for callers that refer to this as registration monitoring. */
export const runBrevoRegistrationMonitor = runBrevoWebhookCoverageMonitor;

/** Read the currently persisted coverage warning for operational dashboards. */
export async function currentBrevoWebhookCoverageWarning(): Promise<string[]> {
  return brevoRegistrationMissingEvents();
}