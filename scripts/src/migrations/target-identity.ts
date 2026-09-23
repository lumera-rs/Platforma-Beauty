import type { DatabaseClient } from "../backend-standards-database";

export interface ExpectedTargetIdentity {
  readonly databaseName: string;
  readonly systemIdentifier: string;
  readonly transport: "encrypted" | "unencrypted";
  readonly neon?: {
    readonly tenantId: string;
    readonly timelineId: string;
  };
}

export function validateExpectedTargetIdentity(value: unknown): ExpectedTargetIdentity {
  const identity = value as (Partial<ExpectedTargetIdentity> & {
    neon?: Partial<NonNullable<ExpectedTargetIdentity["neon"]>> | null;
  }) | undefined;
  if (!identity || typeof identity.databaseName !== "string"
    || !identity.databaseName.trim() || identity.databaseName.includes("\0")
    || Buffer.byteLength(identity.databaseName, "utf8") > 63
    || typeof identity.systemIdentifier !== "string"
    || !/^[1-9][0-9]{0,19}$/u.test(identity.systemIdentifier)
    || BigInt(identity.systemIdentifier) > 18446744073709551615n
    || (identity.transport !== "encrypted" && identity.transport !== "unencrypted")) {
    throw new Error("Explicit expected target identity requires databaseName, decimal systemIdentifier and transport=encrypted|unencrypted");
  }
  if (identity.neon !== undefined) {
    if (!identity.neon || typeof identity.neon.tenantId !== "string"
      || !/^[0-9a-f]{32}$/u.test(identity.neon.tenantId)) {
      throw new Error("Explicit expected target identity neon.tenantId requires lowercase 32hex");
    }
    if (typeof identity.neon.timelineId !== "string"
      || !/^[0-9a-f]{32}$/u.test(identity.neon.timelineId)) {
      throw new Error("Explicit expected target identity neon.timelineId requires lowercase 32hex");
    }
  }
  return identity as ExpectedTargetIdentity;
}

export async function assertTargetIdentity(
  client: DatabaseClient,
  expected: ExpectedTargetIdentity | undefined,
): Promise<void> {
  const identity = validateExpectedTargetIdentity(expected);
  // One read, on the very same dedicated backend subsequently used to mutate.
  // No address/port assumption: Unix sockets and some hosted servers return NULL.
  // ssl proves backend transport encryption, NOT certificate authentication.
  let rows: Record<string, unknown>[];
  try {
    ({ rows } = await client.query(`
      SELECT pg_catalog.current_database() AS database_name,
             control.system_identifier::text AS system_identifier,
             ssl.ssl AS encrypted,
             pg_catalog.current_setting('neon.tenant_id', true) AS neon_tenant_id,
             pg_catalog.current_setting('neon.timeline_id', true) AS neon_timeline_id
      FROM pg_catalog.pg_control_system() AS control
      JOIN pg_catalog.pg_stat_ssl AS ssl ON ssl.pid = pg_catalog.pg_backend_pid()
    `));
  } catch {
    throw new Error("Target identity indeterminate: pg_control_system and own-backend pg_stat_ssl access are required");
  }
  const row = rows[0];
  if (rows.length !== 1 || !row || typeof row.database_name !== "string"
    || typeof row.system_identifier !== "string" || !/^[1-9][0-9]*$/u.test(row.system_identifier)
    || typeof row.encrypted !== "boolean") {
    throw new Error("Target identity indeterminate: missing or invalid backend evidence");
  }
  if (row.database_name !== identity.databaseName) throw new Error("Target identity mismatch: databaseName");
  if (row.system_identifier !== identity.systemIdentifier) throw new Error("Target identity mismatch: systemIdentifier");
  if ((row.encrypted ? "encrypted" : "unencrypted") !== identity.transport) {
    throw new Error("Target identity mismatch: transport");
  }
  const actualTenantId = row.neon_tenant_id;
  const actualTimelineId = row.neon_timeline_id;
  const nonNeon = actualTenantId === null && actualTimelineId === null;
  if (nonNeon) {
    if (identity.neon) throw new Error("Target identity mismatch: neon.tenantId");
    return;
  }
  if (typeof actualTenantId !== "string" || !/^[0-9a-f]{32}$/u.test(actualTenantId)) {
    throw new Error("Target identity indeterminate: missing or invalid neon.tenantId backend evidence");
  }
  if (typeof actualTimelineId !== "string" || !/^[0-9a-f]{32}$/u.test(actualTimelineId)) {
    throw new Error("Target identity indeterminate: missing or invalid neon.timelineId backend evidence");
  }
  if (!identity.neon) throw new Error("Target identity mismatch: neon.tenantId expected value is required");
  if (actualTenantId !== identity.neon.tenantId) throw new Error("Target identity mismatch: neon.tenantId");
  if (actualTimelineId !== identity.neon.timelineId) throw new Error("Target identity mismatch: neon.timelineId");
}
