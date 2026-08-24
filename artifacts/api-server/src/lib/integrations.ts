import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { db, integrationSettingsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

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
 *   - brevoRegistrationMissingEvents — the last provider-verified list of
 *     delivery event groups missing from an otherwise matching Brevo webhook
 * The reminder is pending while changedAt exists and verifiedAt is older.
 */
const WEBHOOK_MARKER_KEYS = [
  "webhookSecretChangedAt",
  "webhookVerifiedAt",
  "brevoRegistrationMissingEvents",
] as const;
type WebhookMarkerKey = (typeof WEBHOOK_MARKER_KEYS)[number];
type WebhookTimestampMarkerKey = Exclude<WebhookMarkerKey, "brevoRegistrationMissingEvents">;
const INTEGRATION_VERSION_KEY = "__configVersion";
const METADATA_KEY_SET: ReadonlySet<string> = new Set([...WEBHOOK_MARKER_KEYS, INTEGRATION_VERSION_KEY]);
/** A confirmation is a point-in-time health check, not permanent proof. */
export const WEBHOOK_CONFIRMATION_MAX_AGE_DAYS = 7;
const WEBHOOK_CONFIRMATION_MAX_AGE_MS = WEBHOOK_CONFIRMATION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

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

export class IntegrationSettingsVersionConflictError extends Error {
  readonly code = "INTEGRATION_SETTINGS_VERSION_CONFLICT";

  constructor(
    readonly expectedVersion: string | null,
    readonly currentVersion: string | null,
  ) {
    super("Podešavanja integracije su u međuvremenu promenjena. Osvežite stranicu i potvrdite najnovije vrednosti pre ponovnog čuvanja.");
    this.name = "IntegrationSettingsVersionConflictError";
  }
}

function fallbackValues(integration: IntegrationName): Record<string, string | undefined> {
  if (integration === "sms") return { apiKey: process.env["SMS_PROVIDER_API_KEY"], senderName: process.env["SMS_SENDER_NAME"], baseUrl: process.env["SMS_PROVIDER_BASE_URL"] };
  if (integration === "brevo") return { apiKey: process.env["BREVO_API_KEY"], senderEmail: process.env["BREVO_SENDER_EMAIL"], senderName: process.env["BREVO_SENDER_NAME"] };
  if (integration === "google_oauth") return { clientId: process.env["GOOGLE_CLIENT_ID"], clientSecret: process.env["GOOGLE_CLIENT_SECRET"] };
  return { clientId: process.env["FACEBOOK_APP_ID"], clientSecret: process.env["FACEBOOK_APP_SECRET"] };
}

export async function integrationSettings(integration: IntegrationName) {
  // Configuration rows and their concurrency token must come from one query
  // snapshot. Reading them separately could pair stale displayed values with a
  // newer token, allowing that stale form to overwrite an intervening save.
  const allRows = await db.select().from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.integration, integration));
  const rows = allRows
    // Marker rows are metadata, not configuration: they must neither surface
    // as values nor flip an env-fallback integration to "database-configured".
    .filter((row) => !METADATA_KEY_SET.has(row.settingKey));
  const versionRow = allRows.find((row) => row.settingKey === INTEGRATION_VERSION_KEY);
  let version: string | null = null;
  if (versionRow) {
    try { version = decrypt(versionRow.encryptedValue); } catch { version = null; }
  }
  if (!rows.length) return { configuredInDatabase: false, enabled: true, values: {} as Record<string, string>, version };
  const values: Record<string, string> = {};
  for (const row of rows) values[row.settingKey] = decrypt(row.encryptedValue);
  return { configuredInDatabase: true, enabled: rows[0]!.enabled, values, version };
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
  expectedVersion?: string | null;
}) {
  await db.transaction(async (tx) => {
    // A provider may not have a row yet, so row-level locks alone cannot
    // serialize the first two saves. The transaction lock covers both the
    // empty and populated cases while keeping different providers independent.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lumera:integration-settings:${input.integration}`}))`);
    const [versionRow] = await tx.select({
      encryptedValue: integrationSettingsTable.encryptedValue,
    }).from(integrationSettingsTable).where(and(
      eq(integrationSettingsTable.integration, input.integration),
      eq(integrationSettingsTable.settingKey, INTEGRATION_VERSION_KEY),
    )).limit(1);
    let currentVersion: string | null = null;
    if (versionRow) {
      try { currentVersion = decrypt(versionRow.encryptedValue); } catch { currentVersion = null; }
    }
    if (input.expectedVersion !== undefined && input.expectedVersion !== currentVersion) {
      throw new IntegrationSettingsVersionConflictError(input.expectedVersion, currentVersion);
    }

    const existingRows = await tx.select({
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
      await tx.insert(integrationSettingsTable).values({
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
    const rows = await tx.select().from(integrationSettingsTable).where(eq(integrationSettingsTable.integration, input.integration));
    if (rows.length) {
      await tx.update(integrationSettingsTable)
        .set({ enabled: input.enabled, updatedByUserId: input.updatedByUserId })
        .where(eq(integrationSettingsTable.integration, input.integration));
    }
    const encryptedVersion = encrypt(randomUUID());
    await tx.insert(integrationSettingsTable).values({
      integration: input.integration,
      settingKey: INTEGRATION_VERSION_KEY,
      encryptedValue: encryptedVersion,
      enabled: true,
      updatedByUserId: input.updatedByUserId,
    }).onConflictDoUpdate({
      target: [integrationSettingsTable.integration, integrationSettingsTable.settingKey],
      set: { encryptedValue: encryptedVersion, updatedByUserId: input.updatedByUserId, updatedAt: new Date() },
    });
  });
}

async function integrationMarker(integration: IntegrationName, settingKey: WebhookTimestampMarkerKey): Promise<Date | null> {
  const [row] = await db.select().from(integrationSettingsTable)
    .where(and(eq(integrationSettingsTable.integration, integration), eq(integrationSettingsTable.settingKey, settingKey)))
    .limit(1);
  if (!row) return null;
  let at: Date;
  try { at = new Date(decrypt(row.encryptedValue)); } catch { return null; }
  return Number.isNaN(at.getTime()) ? null : at;
}

async function setIntegrationMetadata(integration: IntegrationName, settingKey: WebhookMarkerKey, value: string, updatedByUserId: string) {
  await db.insert(integrationSettingsTable).values({
    integration, settingKey, encryptedValue: encrypt(value), enabled: true, updatedByUserId,
  }).onConflictDoUpdate({
    target: [integrationSettingsTable.integration, integrationSettingsTable.settingKey],
    set: { encryptedValue: encrypt(value), updatedByUserId, updatedAt: new Date() },
  });
}

async function setIntegrationMarker(integration: IntegrationName, settingKey: WebhookTimestampMarkerKey, updatedByUserId: string, at: Date) {
  await setIntegrationMetadata(integration, settingKey, at.toISOString(), updatedByUserId);
}

async function clearIntegrationMetadata(integration: IntegrationName, settingKey: WebhookMarkerKey) {
  await db.delete(integrationSettingsTable).where(and(
    eq(integrationSettingsTable.integration, integration),
    eq(integrationSettingsTable.settingKey, settingKey),
  ));
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

/** Persist actionable missing Brevo registration coverage so the admin card
 * keeps the exact repair instruction after the page is reopened. */
export async function markBrevoRegistrationIncomplete(missingEvents: string[], updatedByUserId: string) {
  const normalized = [...new Set(missingEvents.filter((event) => typeof event === "string" && event.trim()))];
  if (!normalized.length) {
    await clearBrevoRegistrationIncomplete();
    return;
  }
  await setIntegrationMetadata("brevo", "brevoRegistrationMissingEvents", JSON.stringify(normalized), updatedByUserId);
}

/** Read the last provider-verified incomplete-event verdict without exposing
 * any provider URL, secret, or other integration setting. */
export async function brevoRegistrationMissingEvents(): Promise<string[]> {
  const [row] = await db.select({
    encryptedValue: integrationSettingsTable.encryptedValue,
  }).from(integrationSettingsTable).where(and(
    eq(integrationSettingsTable.integration, "brevo"),
    eq(integrationSettingsTable.settingKey, "brevoRegistrationMissingEvents"),
  )).limit(1);
  if (!row) return [];
  try {
    const parsed: unknown = JSON.parse(decrypt(row.encryptedValue));
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((event): event is string => typeof event === "string" && event.trim().length > 0))]
      : [];
  } catch {
    return [];
  }
}

export async function clearBrevoRegistrationIncomplete() {
  await clearIntegrationMetadata("brevo", "brevoRegistrationMissingEvents");
}

/** Return the last successful webhook confirmation without exposing marker
 * storage details or any integration secret. */
export async function webhookVerifiedAt(integration: "sms" | "brevo"): Promise<Date | null> {
  return integrationMarker(integration, "webhookVerifiedAt");
}

/** Return whether an existing webhook confirmation is past its safe age. */
export function webhookVerificationIsStale(verifiedAt: Date | null, now = new Date()): boolean {
  if (!verifiedAt) return false;
  return verifiedAt.getTime() <= now.getTime() - WEBHOOK_CONFIRMATION_MAX_AGE_MS;
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
  return { enabled: settings.configuredInDatabase ? settings.enabled : complete, configuredInDatabase: settings.configuredInDatabase, complete, values, version: settings.version };
}
