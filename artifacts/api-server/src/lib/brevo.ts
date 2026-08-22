import { ReplitConnectors } from "@replit/connectors-sdk";
import { createHash, randomUUID } from "node:crypto";
import { db, emailDeliveriesTable, usersTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, lt, lte } from "drizzle-orm";
import { logger } from "./logger";
import { integrationSettings, integrationValue } from "./integrations";

type Recipient = { email: string; name?: string | null };
type EmailDelivery = typeof emailDeliveriesTable.$inferSelect;
export type TransactionalEmailTransport = {
  send(input: {
    idempotencyKey: string;
    to: Recipient;
    subject: string;
    htmlContent: string;
    scheduledAt?: Date | null;
  }): Promise<{ messageId?: string } | { skipped: true; errorMessage: string }>;
};

const RESCHEDULED_EMAIL_TYPE = "appointment_rescheduled";
const EDUCATION_GALLERY_CLEANUP_ALERT_EMAIL_TYPE = "education_gallery_cleanup_alert";
const EDUCATION_GALLERY_CLEANUP_ALERT_COOLDOWN_MS = 60 * 60_000;
const RETRY_DELAYS_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000] as const;
const RETRY_LEASE_MS = 2 * 60_000;
const RETRY_BATCH_SIZE = 50;

export type EducationGalleryCleanupAlert = {
  failedTickets: number;
  failureAttempts: number;
  repeatedFailureTickets: number;
};

async function sender() {
  const email = await integrationValue("brevo", "senderEmail", process.env["BREVO_SENDER_EMAIL"]);
  if (!email) return null;
  return { email, name: await integrationValue("brevo", "senderName", process.env["BREVO_SENDER_NAME"]) || "LUMERA" };
}

async function brevoFetch(path: string, init: RequestInit): Promise<Response> {
  const settings = await integrationSettings("brevo");
  if (!settings.enabled) throw new Error("Brevo integracija je isključena u admin podešavanjima.");
  const apiKey = settings.values.apiKey ?? process.env["BREVO_API_KEY"];
  if (apiKey) {
    return fetch(`https://api.brevo.com/v3${path}`, {
      ...init,
      headers: { "api-key": apiKey, "content-type": "application/json", ...init.headers },
    });
  }
  const connectors = new ReplitConnectors();
  const headers = init.headers ? Object.fromEntries(new Headers(init.headers).entries()) : undefined;
  return connectors.proxy("brevo", path, { ...init, headers }) as Promise<Response>;
}

async function brevoJson<T>(path: string, body: unknown): Promise<T> {
  const response = await brevoFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Brevo ${response.status}: ${error.slice(0, 500)}`);
  }
  return response.status === 204 ? {} as T : response.json() as Promise<T>;
}

const brevoTransactionalEmailTransport: TransactionalEmailTransport = {
  async send(input) {
    const from = await sender();
    if (!from) return { skipped: true, errorMessage: "BREVO_SENDER_EMAIL nije podešen." };
    return brevoJson<{ messageId?: string }>("/smtp/email", {
      sender: from,
      to: [{ email: input.to.email, name: input.to.name ?? undefined }],
      subject: input.subject,
      htmlContent: input.htmlContent,
      headers: { idempotencyKey: input.idempotencyKey },
      ...(input.scheduledAt ? { scheduledAt: input.scheduledAt.toISOString() } : {}),
    });
  },
};

export function lumeraEmailHtml(title: string, content: string) {
  return `<!doctype html><html lang="sr"><body style="margin:0;background:#f7f4ef;font-family:Arial,sans-serif;color:#28221b">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden">
  <tr><td style="background:#302a23;padding:26px 34px;color:#e1bd6b;font-size:24px;font-weight:700;letter-spacing:1px">LUMERA</td></tr>
  <tr><td style="padding:34px"><h1 style="font-size:25px;margin:0 0 18px;color:#302a23">${title}</h1>${content}
  <p style="margin-top:30px;color:#766e65;font-size:13px">LUMERA — lepota, wellness i edukacija na jednom mestu.</p></td></tr>
  </table></td></tr></table></body></html>`;
}

export async function sendTransactionalEmail(input: {
  eventKey: string;
  emailType: string;
  to: Recipient;
  subject: string;
  htmlContent: string;
  salonId?: string;
  appointmentId?: string;
  metadata?: Record<string, unknown>;
  scheduledAt?: Date;
}, transport: TransactionalEmailTransport = brevoTransactionalEmailTransport) {
  const [delivery] = await db.insert(emailDeliveriesTable).values({
    eventKey: input.eventKey,
    emailType: input.emailType,
    salonId: input.salonId ?? null,
    appointmentId: input.appointmentId ?? null,
    recipientEmail: input.to.email.toLowerCase(),
    recipientName: input.to.name ?? null,
    subject: input.subject,
    htmlContent: input.htmlContent,
    scheduledAt: input.scheduledAt ?? null,
    nextRetryAt: input.emailType === RESCHEDULED_EMAIL_TYPE ? new Date() : null,
    metadata: input.metadata ?? {},
  }).onConflictDoNothing().returning();
  if (!delivery) return { deduplicated: true };
  if (retryable(delivery)) {
    const processingToken = randomUUID();
    const [claimed] = await db.update(emailDeliveriesTable).set({
      status: "processing",
      processingToken,
      nextRetryAt: new Date(Date.now() + RETRY_LEASE_MS),
    }).where(and(
      eq(emailDeliveriesTable.id, delivery.id),
      eq(emailDeliveriesTable.status, "queued"),
      lte(emailDeliveriesTable.nextRetryAt, new Date()),
    )).returning();
    if (!claimed) return { queued: true };
    return deliverEmail(claimed, input.htmlContent, processingToken, transport);
  }
  return deliverEmail(delivery, input.htmlContent, undefined, transport);
}

export async function sendEducationGalleryCleanupAlert(
  alert: EducationGalleryCleanupAlert,
  now = new Date(),
  transport: TransactionalEmailTransport = brevoTransactionalEmailTransport,
) {
  const recipients = await db.select({ email: usersTable.email })
    .from(usersTable)
    .where(and(
      eq(usersTable.active, true),
      inArray(usersTable.role, ["ADMIN", "SUPER_ADMIN"]),
    ));
  const alertWindow = Math.floor(now.getTime() / EDUCATION_GALLERY_CLEANUP_ALERT_COOLDOWN_MS);

  if (!recipients.length) {
    logger.warn(
      { alertWindow, failedTickets: alert.failedTickets, failureAttempts: alert.failureAttempts },
      "Education gallery cleanup alert has no configured administrator recipients",
    );
    return { recipientCount: 0, failedDeliveryCount: 0, skippedDeliveryCount: 0 };
  }

  const subject = "LUMERA — potrebna je intervencija za čišćenje galerije";
  const htmlContent = lumeraEmailHtml(
    "Potrebna je intervencija za čišćenje galerije",
    `<p>Automatsko čišćenje privatnih staging fajlova je više puta neuspešno.</p>
    <p><strong>Trenutno stanje:</strong> ${alert.failedTickets} neuspešnih zapisa, ${alert.failureAttempts} neuspešnih pokušaja i ${alert.repeatedFailureTickets} zapisa sa ponovljenim neuspehom.</p>
    <p>Proverite dostupnost App Storage-a i kredencijale posla za čišćenje, a zatim proverite Admin pregled pre ponovnog pokretanja posla.</p>`,
  );
  const results = await Promise.allSettled(recipients.map((recipient) => {
    const recipientKey = createHash("sha256").update(recipient.email.toLowerCase()).digest("hex").slice(0, 16);
    return sendTransactionalEmail({
      eventKey: `education-gallery-cleanup-alert:${alertWindow}:${recipientKey}`,
      emailType: EDUCATION_GALLERY_CLEANUP_ALERT_EMAIL_TYPE,
      to: { email: recipient.email },
      subject,
      htmlContent,
      metadata: {
        alertWindow,
        failedTickets: alert.failedTickets,
        failureAttempts: alert.failureAttempts,
        repeatedFailureTickets: alert.repeatedFailureTickets,
      },
    }, transport);
  }));
  const failedDeliveryCount = results.filter(
    (result) => result.status === "rejected" || ("failed" in result.value && result.value.failed),
  ).length;
  const skippedDeliveryCount = results.filter(
    (result) => result.status === "fulfilled" && "skipped" in result.value && result.value.skipped,
  ).length;

  if (failedDeliveryCount || skippedDeliveryCount) {
    logger.warn(
      {
        alertWindow,
        recipientCount: recipients.length,
        failedDeliveryCount,
        skippedDeliveryCount,
      },
      "Education gallery cleanup alert delivery did not complete for every administrator",
    );
  } else {
    logger.info(
      { alertWindow, recipientCount: recipients.length },
      "Education gallery cleanup alert delivery queued",
    );
  }
  return { recipientCount: recipients.length, failedDeliveryCount, skippedDeliveryCount };
}

function nextRetryAt(retryCount: number, now = new Date()) {
  const delay = RETRY_DELAYS_MS[retryCount];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}

function retryable(delivery: EmailDelivery) {
  return delivery.emailType === RESCHEDULED_EMAIL_TYPE;
}

function temporaryFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const match = /Brevo (\d{3}):/.exec(message);
  if (match) {
    const status = Number(match[1]);
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }
  return error instanceof TypeError
    || error instanceof DOMException
    || /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|network|socket hang up|timeout)\b/i.test(message);
}

function educationGalleryAlertDeliveryErrorContext(error: unknown, eventKey: string) {
  const message = error instanceof Error ? error.message : "";
  const providerStatus = /Brevo (\d{3}):/.exec(message)?.[1];
  return {
    eventKey,
    errorType: error instanceof Error ? error.name : typeof error,
    ...(providerStatus ? { providerStatus: Number(providerStatus) } : {}),
  };
}

function educationGalleryAlertStoredError(error: unknown) {
  const context = educationGalleryAlertDeliveryErrorContext(error, "");
  return context.providerStatus
    ? `${context.errorType} (Brevo ${context.providerStatus})`
    : context.errorType;
}

function claimedDeliveryWhere(deliveryId: string, processingToken?: string) {
  return processingToken
    ? and(
        eq(emailDeliveriesTable.id, deliveryId),
        eq(emailDeliveriesTable.status, "processing"),
        eq(emailDeliveriesTable.processingToken, processingToken),
      )
    : eq(emailDeliveriesTable.id, deliveryId);
}

function duplicateBrevoRequest(error: unknown) {
  return error instanceof Error && error.message.includes("duplicate_parameter");
}

async function deliverEmail(
  delivery: EmailDelivery,
  htmlContent: string,
  processingToken?: string,
  transport: TransactionalEmailTransport = brevoTransactionalEmailTransport,
) {
  try {
    const result = await transport.send({
      idempotencyKey: delivery.id,
      to: { email: delivery.recipientEmail, name: delivery.recipientName },
      subject: delivery.subject,
      htmlContent,
      scheduledAt: delivery.scheduledAt,
    });
    if ("skipped" in result) {
      await db.update(emailDeliveriesTable).set({
        status: "skipped",
        errorMessage: delivery.emailType === EDUCATION_GALLERY_CLEANUP_ALERT_EMAIL_TYPE
          ? "Email transport is not configured."
          : result.errorMessage,
        nextRetryAt: null,
        processingToken: null,
      }).where(claimedDeliveryWhere(delivery.id, processingToken));
      return { skipped: true };
    }
    await db.update(emailDeliveriesTable).set({
      status: "sent",
      providerMessageId: result.messageId ?? null,
      errorMessage: null,
      nextRetryAt: null,
      processingToken: null,
      sentAt: delivery.scheduledAt ? null : new Date(),
    }).where(claimedDeliveryWhere(delivery.id, processingToken));
    return { messageId: result.messageId };
  } catch (error) {
    if (delivery.emailType === EDUCATION_GALLERY_CLEANUP_ALERT_EMAIL_TYPE) {
      logger.warn(
        educationGalleryAlertDeliveryErrorContext(error, delivery.eventKey),
        "Brevo transactional email failed",
      );
    } else {
      logger.warn({ err: error, eventKey: delivery.eventKey }, "Brevo transactional email failed");
    }
    if (duplicateBrevoRequest(error)) {
      await db.update(emailDeliveriesTable).set({
        status: "sent",
        errorMessage: null,
        nextRetryAt: null,
        processingToken: null,
        sentAt: new Date(),
      }).where(claimedDeliveryWhere(delivery.id, processingToken));
      return { deduplicated: true };
    }
    const retryAt = retryable(delivery) && temporaryFailure(error) ? nextRetryAt(delivery.retryCount) : null;
    await db.update(emailDeliveriesTable).set({
      status: retryAt ? "queued" : "failed",
      errorMessage: delivery.emailType === EDUCATION_GALLERY_CLEANUP_ALERT_EMAIL_TYPE
        ? educationGalleryAlertStoredError(error)
        : error instanceof Error ? error.message.slice(0, 1000) : "Nepoznata Brevo greška",
      nextRetryAt: retryAt,
      processingToken: null,
    }).where(claimedDeliveryWhere(delivery.id, processingToken));
    return { failed: true };
  }
}

export async function retryFailedRescheduledEmailConfirmations(
  now = new Date(),
  transport: TransactionalEmailTransport = brevoTransactionalEmailTransport,
) {
  await db.update(emailDeliveriesTable).set({
    status: "queued",
    processingToken: null,
    nextRetryAt: now,
  }).where(and(
    eq(emailDeliveriesTable.emailType, RESCHEDULED_EMAIL_TYPE),
    eq(emailDeliveriesTable.status, "processing"),
    lte(emailDeliveriesTable.nextRetryAt, now),
  ));

  const due = await db.select().from(emailDeliveriesTable).where(and(
    eq(emailDeliveriesTable.emailType, RESCHEDULED_EMAIL_TYPE),
    eq(emailDeliveriesTable.status, "queued"),
    isNotNull(emailDeliveriesTable.nextRetryAt),
    lte(emailDeliveriesTable.nextRetryAt, now),
    lt(emailDeliveriesTable.retryCount, RETRY_DELAYS_MS.length),
    isNotNull(emailDeliveriesTable.htmlContent),
  )).orderBy(emailDeliveriesTable.nextRetryAt).limit(RETRY_BATCH_SIZE);

  let retried = 0;
  for (const delivery of due) {
    const processingToken = randomUUID();
    const [claimed] = await db.update(emailDeliveriesTable).set({
      status: "processing",
      retryCount: delivery.retryCount + 1,
      nextRetryAt: new Date(now.getTime() + RETRY_LEASE_MS),
      processingToken,
    }).where(and(
      eq(emailDeliveriesTable.id, delivery.id),
      eq(emailDeliveriesTable.status, "queued"),
      lte(emailDeliveriesTable.nextRetryAt, now),
    )).returning();
    if (!claimed) continue;
    retried += 1;
    await deliverEmail(claimed, claimed.htmlContent!, processingToken, transport);
  }
  return { considered: due.length, retried };
}

export async function createBrevoMarketingCampaign(input: {
  name: string;
  subject: string;
  htmlContent: string;
  recipients: Recipient[];
  scheduledAt?: Date | null;
}) {
  const from = await sender();
  if (!from) throw new Error("BREVO_SENDER_EMAIL nije podešen.");
  if (!input.recipients.length) throw new Error("Izabrana publika nema primaoce.");

  const list = await brevoJson<{ id: number }>("/contacts/lists", { name: `LUMERA kampanja ${input.name}` });
  for (const recipient of input.recipients) {
    await brevoJson("/contacts", {
      email: recipient.email,
      attributes: recipient.name ? { FNAME: recipient.name } : {},
      updateEnabled: true,
    });
  }
  await brevoJson(`/contacts/lists/${list.id}/contacts/add`, { emails: input.recipients.map((item) => item.email) });
  return brevoJson<{ id: number }>("/emailCampaigns", {
    name: input.name,
    subject: input.subject,
    sender: from,
    htmlContent: input.htmlContent,
    recipients: { listIds: [list.id] },
    ...(input.scheduledAt ? { scheduledAt: input.scheduledAt.toISOString() } : {}),
  });
}

export async function sendBrevoCampaignNow(campaignId: number) {
  await brevoJson(`/emailCampaigns/${campaignId}/sendNow`, {});
}