import { db, educationFinancialAuditLogTable } from "@workspace/db";

type EducationFinancialAuditTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const REDACTED = "[REDACTED]";
const MAX_ACTION_LENGTH = 160;
const MAX_ENTITY_TYPE_LENGTH = 120;
const MAX_ENTITY_ID_LENGTH = 300;
const MAX_REASON_LENGTH = 2_000;
const MAX_SNAPSHOT_DEPTH = 10;
const MAX_SNAPSHOT_KEYS = 100;
const MAX_SNAPSHOT_ITEMS = 100;
const MAX_SNAPSHOT_STRING_LENGTH = 4_000;

export type EducationFinancialAuditInput = {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
};

function requiredText(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Education financial audit ${field} is required.`);
  if (normalized.length > maximum) {
    throw new Error(`Education financial audit ${field} exceeds ${maximum} characters.`);
  }
  return normalized;
}

function optionalText(value: string | null | undefined, field: string, maximum: number): string | null {
  if (value == null) return null;
  return requiredText(value, field, maximum);
}

/**
 * Payment instructions may deliberately include a masked account or an account
 * summary. Raw credential-shaped fields, on the other hand, must never reach
 * the immutable audit table.
 */
function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/(secret|token|password|privatekey)/.test(normalized)) return true;
  if (/(raw(account|credential)|accountcredential|credentialaccount)/.test(normalized)) return true;
  if (
    normalized.includes("account")
    && !/(masked|mask|summary)/.test(normalized)
    && (normalized.endsWith("account") || normalized.endsWith("accountnumber"))
  ) return true;
  return normalized === "credential" || normalized === "credentials";
}

function boundedString(value: string): string {
  return value.length <= MAX_SNAPSHOT_STRING_LENGTH
    ? value
    : `${value.slice(0, MAX_SNAPSHOT_STRING_LENGTH)}…[truncated]`;
}

/**
 * Produces JSONB-compatible audit snapshots without calling user-defined
 * serializers. It is exported so financial services can assert their audit
 * payloads before opening a transaction.
 */
export function redactEducationFinancialAuditSnapshot(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  const seen = new WeakSet<object>();

  const visit = (current: unknown, depth: number): unknown => {
    if (current == null || typeof current === "boolean") return current;
    if (typeof current === "string") return boundedString(current);
    if (typeof current === "number") return Number.isFinite(current) ? current : String(current);
    if (typeof current === "bigint") return current.toString();
    if (typeof current === "undefined" || typeof current === "function" || typeof current === "symbol") return null;
    if (current instanceof Date) return Number.isNaN(current.getTime()) ? null : current.toISOString();
    if (depth >= MAX_SNAPSHOT_DEPTH) return "[truncated: maximum depth]";
    if (typeof current !== "object") return String(current);
    if (seen.has(current)) return "[truncated: circular reference]";
    seen.add(current);

    if (Array.isArray(current)) {
      const result = current.slice(0, MAX_SNAPSHOT_ITEMS).map((item) => visit(item, depth + 1));
      if (current.length > MAX_SNAPSHOT_ITEMS) result.push("[truncated: additional items]");
      return result;
    }

    const result: Record<string, unknown> = {};
    const entries = Object.entries(current);
    for (const [key, child] of entries.slice(0, MAX_SNAPSHOT_KEYS)) {
      result[boundedString(key)] = isSensitiveKey(key) ? REDACTED : visit(child, depth + 1);
    }
    if (entries.length > MAX_SNAPSHOT_KEYS) result.__truncatedKeys = entries.length - MAX_SNAPSHOT_KEYS;
    return result;
  };

  const sanitized = visit(value, 0);
  if (!sanitized || Array.isArray(sanitized) || typeof sanitized !== "object") {
    throw new Error("Education financial audit snapshots must be objects or null.");
  }
  return sanitized as Record<string, unknown>;
}

/** Inserts the central Education financial audit as part of the caller's transaction. */
export async function writeEducationFinancialAuditInTx(
  tx: EducationFinancialAuditTransaction,
  input: EducationFinancialAuditInput,
): Promise<void> {
  await tx.insert(educationFinancialAuditLogTable).values({
    actorUserId: input.actorUserId,
    action: requiredText(input.action, "action", MAX_ACTION_LENGTH),
    entityType: requiredText(input.entityType, "entityType", MAX_ENTITY_TYPE_LENGTH),
    entityId: requiredText(input.entityId, "entityId", MAX_ENTITY_ID_LENGTH),
    oldValue: redactEducationFinancialAuditSnapshot(input.oldValue),
    newValue: redactEducationFinancialAuditSnapshot(input.newValue),
    reason: optionalText(input.reason, "reason", MAX_REASON_LENGTH),
  });
}