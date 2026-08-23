import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { db, integrationSettingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export type IntegrationName = "sms" | "brevo" | "google_oauth" | "facebook_oauth";

/**
 * Metadata marker rows stored alongside integration settings (same encrypted
 * key/value table) but never treated as configuration: they are excluded from
 * `integrationSettings` values and do not make an integration count as
 * "configured in database". Used to persist the "webhook secret changed but
 * the provider registration was not re-confirmed yet" state across reloads:
 *   - webhookSecretChangedAt — set when a save actually changes the effective
 *     webhook secret (which invalidates the URL registered at the provider)
 *   - webhookVerifiedAt — set when a webhook re-confirmation succeeds (the
 *     loopback self-check, or Brevo one-click registration whose re-check
 *     passed)
 * The reminder is pending while changedAt exists and verifiedAt is older.
 */
const WEBHOOK_MARKER_KEYS = ["webhookSecretChangedAt", "webhookVerifiedAt"] as const;
type WebhookMarkerKey = (typeof WEBHOOK_MARKER_KEYS)[number];
const WEBHOOK_MARKER_KEY_SET: ReadonlySet<string> = new Set(WEBHOOK_MARKER_KEYS);

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
  const rows = (await db.select().from(integrationSettingsTable).where(eq(integrationSettingsTable.integration, integration)))
    // Marker rows are metadata, not configuration: they must neither surface
    // as values nor flip an env-fallback integration to "database-configured".
    .filter((row) => !WEBHOOK_MARKER_KEY_SET.has(row.settingKey));
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
  const existingRows = await db.select({
    settingKey: integrationSettingsTable.settingKey,
    encryptedValue: integrationSettingsTable.encryptedValue,
  }).from(integrationSettingsTable).where(eq(integrationSettingsTable.integration, input.integration));
  const existingValues = new Map(existingRows.map((row) => [row.settingKey, row.encryptedValue]));

  for (const [settingKey, value] of [...Object.entries(input.values), ["__enabled", "1"]]) {
    if (!value.trim()) continue;
    const existingEncryptedValue = existingValues.get(settingKey);
    if (existingEncryptedValue) {
      try {
        if (decrypt(existingEncryptedValue) === value.trim()) continue;
      } catch {
        // A corrupt stored value must be replaced rather than treated as a no-op.
      }
    }
    const encryptedValue = encrypt(value.trim());
    await db.insert(integrationSettingsTable).values({
      integration: input.integration, settingKey, encryptedValue, enabled: input.enabled, updatedByUserId: input.updatedByUserId,
    }).onConflictDoUpdate({
      target: [integrationSettingsTable.integration, integrationSettingsTable.settingKey],
      set: { encryptedValue, enabled: input.enabled, updatedByUserId: input.updatedByUserId, updatedAt: new Date() },
    });
  }
  // Apply the integration-level enabled flag to every row WITHOUT touching
  // updatedAt: per-row updatedAt must reflect when THAT setting's value was
  // last (re)written — the SMS registration check compares delivery-report
  // receipts against the webhookSecret save time, so saving an unrelated
  // field (or toggling enabled) must not make the secret look freshly changed.
  const rows = await db.select().from(integrationSettingsTable).where(eq(integrationSettingsTable.integration, input.integration));
  if (rows.length) await db.update(integrationSettingsTable).set({ enabled: input.enabled, updatedByUserId: input.updatedByUserId }).where(eq(integrationSettingsTable.integration, input.integration));
}

async function integrationMarker(integration: IntegrationName, settingKey: WebhookMarkerKey): Promise<Date | null> {
  const [row] = await db.select().from(integrationSettingsTable)
    .where(and(eq(integrationSettingsTable.integration, integration), eq(integrationSettingsTable.settingKey, settingKey)))
    .limit(1);
  if (!row) return null;
  let at: Date;
  try { at = new Date(decrypt(row.encryptedValue)); } catch { return null; }
  return Number.isNaN(at.getTime()) ? null : at;
}

async function setIntegrationMarker(integration: IntegrationName, settingKey: WebhookMarkerKey, updatedByUserId: string, at: Date) {
  await db.insert(integrationSettingsTable).values({
    integration, settingKey, encryptedValue: encrypt(at.toISOString()), enabled: true, updatedByUserId,
  }).onConflictDoUpdate({
    target: [integrationSettingsTable.integration, integrationSettingsTable.settingKey],
    set: { encryptedValue: encrypt(at.toISOString()), updatedByUserId, updatedAt: new Date() },
  });
}

/** Persist that the effective webhook secret changed — the URL registered at
 * the provider no longer works until the admin re-registers and re-confirms. */
export async function markWebhookSecretChanged(integration: "sms" | "brevo", updatedByUserId: string, at = new Date()) {
  await setIntegrationMarker(integration, "webhookSecretChangedAt", updatedByUserId, at);
}

/** Persist that a webhook re-confirmation succeeded (loopback self-check, or
 * Brevo one-click registration whose provider-side re-check passed). */
export async function markWebhookReconfirmed(integration: "sms" | "brevo", updatedByUserId: string, at = new Date()) {
  await setIntegrationMarker(integration, "webhookVerifiedAt", updatedByUserId, at);
}

/** Return the last successful webhook confirmation without exposing marker
 * storage details or any integration secret. */
export async function webhookVerifiedAt(integration: "sms" | "brevo"): Promise<Date | null> {
  return integrationMarker(integration, "webhookVerifiedAt");
}

/**
 * True while a webhook secret change awaits re-confirmation: a change was
 * recorded and no confirmation succeeded at or after it. Derived from the two
 * persisted markers so the admin reminder survives page reloads and sessions.
 */
export async function webhookSecretPendingReconfirmation(integration: "sms" | "brevo"): Promise<boolean> {
  const changedAt = await integrationMarker(integration, "webhookSecretChangedAt");
  if (!changedAt) return false;
  const verifiedAt = await integrationMarker(integration, "webhookVerifiedAt");
  return !verifiedAt || verifiedAt.getTime() < changedAt.getTime();
}

export async function integrationDisplay(integration: IntegrationName, keys: string[], required: string[]) {
  const settings = await integrationSettings(integration);
  const effective = { ...fallbackValues(integration), ...settings.values };
  const values = Object.fromEntries(keys.map((settingKey) => [settingKey, settings.values[settingKey] ? maskIntegrationValue(settings.values[settingKey]!) : effective[settingKey] ? "Environment fallback" : null]));
  const complete = required.every((settingKey) => Boolean(effective[settingKey]));
  return { enabled: settings.configuredInDatabase ? settings.enabled : complete, configuredInDatabase: settings.configuredInDatabase, complete, values };
}
