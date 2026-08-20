import { db, smsDeliveriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { infobipBaseUrl, integrationSettings, integrationValue } from "./integrations";

export type SmsMessageType = "appointment_confirmation" | "appointment_reminder";

export interface SmsProvider {
  send(input: { to: string; text: string }): Promise<{ messageId?: string }>;
}

class InfobipSmsProvider implements SmsProvider {
  async send(input: { to: string; text: string }) {
    const apiKey = await integrationValue("sms", "apiKey", process.env["SMS_PROVIDER_API_KEY"]);
    const baseUrl = infobipBaseUrl(await integrationValue("sms", "baseUrl", process.env["SMS_PROVIDER_BASE_URL"]));
    const sender = await integrationValue("sms", "senderName", process.env["SMS_SENDER_NAME"]) ?? "LUMERA";
    if (!apiKey) throw new Error("SMS_PROVIDER_API_KEY nije podešen.");
    const response = await fetch(`${baseUrl}/sms/2/text/advanced`, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `App ${apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ messages: [{ destinations: [{ to: input.to }], from: sender, text: input.text }] }),
    });
    if (!response.ok) throw new Error(`Infobip ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const payload = await response.json() as { messages?: Array<{ messageId?: string }> };
    return { messageId: payload.messages?.[0]?.messageId };
  }
}

const provider: SmsProvider = new InfobipSmsProvider();

export async function sendTestSms(to: string) {
  const settings = await integrationSettings("sms");
  if (!settings.enabled) throw new Error("SMS integracija je isključena.");
  if (!(settings.values.apiKey ?? process.env["SMS_PROVIDER_API_KEY"])) throw new Error("Unesite SMS API ključ pre testa.");
  return provider.send({ to, text: "LUMERA test poruka: SMS integracija je uspešno povezana." });
}

export function maskPhone(phone: string) {
  const compact = phone.replace(/\s+/g, "");
  return compact.length <= 4 ? "****" : `${compact.slice(0, Math.max(0, compact.length - 4)).replace(/\d/g, "X")}${compact.slice(-4)}`;
}

export async function sendSms(input: {
  eventKey: string;
  salonId: string;
  appointmentId: string;
  type: SmsMessageType;
  phone: string | null | undefined;
  smsOptOut?: boolean;
  text: string;
}) {
  if (!input.phone) return { skipped: true };
  const [delivery] = await db.insert(smsDeliveriesTable).values({
    eventKey: input.eventKey, salonId: input.salonId, appointmentId: input.appointmentId,
    messageType: input.type, recipientPhone: input.phone, body: input.text,
  }).onConflictDoNothing().returning();
  if (!delivery) return { deduplicated: true };
  if (input.smsOptOut) {
    await db.update(smsDeliveriesTable).set({ status: "skipped", errorMessage: "SMS obaveštenja su isključena za ovaj CRM kontakt." }).where(eq(smsDeliveriesTable.id, delivery.id));
    return { skipped: true };
  }
  const smsSettings = await integrationSettings("sms");
  if (!smsSettings.enabled) {
    await db.update(smsDeliveriesTable).set({ status: "skipped", errorMessage: "SMS integracija je isključena u admin podešavanjima." }).where(eq(smsDeliveriesTable.id, delivery.id));
    return { skipped: true };
  }
  if (!(smsSettings.values.apiKey ?? process.env["SMS_PROVIDER_API_KEY"])) {
    await db.update(smsDeliveriesTable).set({ status: "skipped", errorMessage: "SMS_PROVIDER_API_KEY nije podešen." }).where(eq(smsDeliveriesTable.id, delivery.id));
    return { skipped: true };
  }
  try {
    const sent = await provider.send({ to: input.phone, text: input.text });
    await db.update(smsDeliveriesTable).set({ status: "sent", providerMessageId: sent.messageId ?? null, sentAt: new Date() }).where(eq(smsDeliveriesTable.id, delivery.id));
    return sent;
  } catch (error) {
    logger.warn({ err: error, eventKey: input.eventKey }, "SMS delivery failed");
    await db.update(smsDeliveriesTable).set({ status: "failed", errorMessage: error instanceof Error ? error.message.slice(0, 1000) : "Nepoznata SMS greška" }).where(eq(smsDeliveriesTable.id, delivery.id));
    return { failed: true };
  }
}