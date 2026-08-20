import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, emailDeliveriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { integrationSettings, integrationValue } from "./integrations";

type Recipient = { email: string; name?: string | null };

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
  const response = await brevoFetch(path, { method: "POST", body: JSON.stringify(body) });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Brevo ${response.status}: ${error.slice(0, 500)}`);
  }
  return response.status === 204 ? {} as T : response.json() as Promise<T>;
}

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
  metadata?: Record<string, unknown>;
  scheduledAt?: Date;
}) {
  const [delivery] = await db.insert(emailDeliveriesTable).values({
    eventKey: input.eventKey,
    emailType: input.emailType,
    recipientEmail: input.to.email.toLowerCase(),
    recipientName: input.to.name ?? null,
    subject: input.subject,
    scheduledAt: input.scheduledAt ?? null,
    metadata: input.metadata ?? {},
  }).onConflictDoNothing().returning();
  if (!delivery) return { deduplicated: true };

  const from = await sender();
  if (!from) {
    await db.update(emailDeliveriesTable).set({
      status: "skipped",
      errorMessage: "BREVO_SENDER_EMAIL nije podešen.",
    }).where(eq(emailDeliveriesTable.id, delivery.id));
    return { skipped: true };
  }
  try {
    const result = await brevoJson<{ messageId?: string }>("/smtp/email", {
      sender: from,
      to: [{ email: input.to.email, name: input.to.name ?? undefined }],
      subject: input.subject,
      htmlContent: input.htmlContent,
      ...(input.scheduledAt ? { scheduledAt: input.scheduledAt.toISOString() } : {}),
    });
    await db.update(emailDeliveriesTable).set({
      status: "sent",
      providerMessageId: result.messageId ?? null,
      sentAt: input.scheduledAt ? null : new Date(),
    }).where(eq(emailDeliveriesTable.id, delivery.id));
    return { messageId: result.messageId };
  } catch (error) {
    logger.warn({ err: error, eventKey: input.eventKey }, "Brevo transactional email failed");
    await db.update(emailDeliveriesTable).set({
      status: "failed",
      errorMessage: error instanceof Error ? error.message.slice(0, 1000) : "Nepoznata Brevo greška",
    }).where(eq(emailDeliveriesTable.id, delivery.id));
    return { failed: true };
  }
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