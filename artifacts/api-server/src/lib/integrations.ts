import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { db, integrationSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type IntegrationName = "sms" | "brevo" | "google_oauth" | "facebook_oauth";

const key = () => {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) throw new Error("SESSION_SECRET je obavezan za šifrovano čuvanje integracionih podešavanja.");
  return createHash("sha256").update(secret).digest();
};

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

function decrypt(value: string) {
  const [iv, tag, body] = value.split(".");
  if (!iv || !tag || !body) throw new Error("Nevažeći format integracione tajne.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

export function maskIntegrationValue(value: string) {
  return value.length <= 4 ? "••••" : `••••••••${value.slice(-4)}`;
}

export function infobipBaseUrl(value: string | undefined) {
  const raw = value?.trim() || "https://api.infobip.com";
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("SMS base URL nije ispravan URL."); }
  const approved = url.hostname === "api.infobip.com" || url.hostname.endsWith(".api.infobip.com");
  if (url.protocol !== "https:" || !approved || url.username || url.password || url.port) {
    throw new Error("SMS base URL mora biti bezbedan HTTPS Infobip domen.");
  }
  return url.toString().replace(/\/$/, "");
}

function fallbackValues(integration: IntegrationName): Record<string, string | undefined> {
  if (integration === "sms") return { apiKey: process.env["SMS_PROVIDER_API_KEY"], senderName: process.env["SMS_SENDER_NAME"], baseUrl: process.env["SMS_PROVIDER_BASE_URL"] };
  if (integration === "brevo") return { apiKey: process.env["BREVO_API_KEY"], senderEmail: process.env["BREVO_SENDER_EMAIL"], senderName: process.env["BREVO_SENDER_NAME"] };
  if (integration === "google_oauth") return { clientId: process.env["GOOGLE_CLIENT_ID"], clientSecret: process.env["GOOGLE_CLIENT_SECRET"] };
  return { clientId: process.env["FACEBOOK_APP_ID"], clientSecret: process.env["FACEBOOK_APP_SECRET"] };
}

export async function integrationSettings(integration: IntegrationName) {
  const rows = await db.select().from(integrationSettingsTable).where(eq(integrationSettingsTable.integration, integration));
  if (!rows.length) return { configuredInDatabase: false, enabled: true, values: {} as Record<string, string> };
  const values: Record<string, string> = {};
  for (const row of rows) values[row.settingKey] = decrypt(row.encryptedValue);
  return { configuredInDatabase: true, enabled: rows[0]!.enabled, values };
}

export async function integrationValue(integration: IntegrationName, settingKey: string, fallback?: string) {
  const settings = await integrationSettings(integration);
  if (!settings.enabled) return undefined;
  return settings.values[settingKey] ?? fallback;
}

export async function saveIntegrationSettings(input: {
  integration: IntegrationName;
  enabled: boolean;
  values: Record<string, string>;
  updatedByUserId: string;
}) {
  for (const [settingKey, value] of [...Object.entries(input.values), ["__enabled", "1"]]) {
    if (!value.trim()) continue;
    await db.insert(integrationSettingsTable).values({
      integration: input.integration, settingKey, encryptedValue: encrypt(value.trim()), enabled: input.enabled, updatedByUserId: input.updatedByUserId,
    }).onConflictDoUpdate({
      target: [integrationSettingsTable.integration, integrationSettingsTable.settingKey],
      set: { encryptedValue: encrypt(value.trim()), enabled: input.enabled, updatedByUserId: input.updatedByUserId, updatedAt: new Date() },
    });
  }
  const rows = await db.select().from(integrationSettingsTable).where(eq(integrationSettingsTable.integration, input.integration));
  if (rows.length) await db.update(integrationSettingsTable).set({ enabled: input.enabled, updatedByUserId: input.updatedByUserId, updatedAt: new Date() }).where(eq(integrationSettingsTable.integration, input.integration));
}

export async function integrationDisplay(integration: IntegrationName, keys: string[], required: string[]) {
  const settings = await integrationSettings(integration);
  const effective = { ...fallbackValues(integration), ...settings.values };
  const values = Object.fromEntries(keys.map((settingKey) => [settingKey, settings.values[settingKey] ? maskIntegrationValue(settings.values[settingKey]!) : effective[settingKey] ? "Environment fallback" : null]));
  const complete = required.every((settingKey) => Boolean(effective[settingKey]));
  return { enabled: settings.configuredInDatabase ? settings.enabled : complete, configuredInDatabase: settings.configuredInDatabase, complete, values };
}