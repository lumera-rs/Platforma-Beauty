import type { DatabaseClient } from "../backend-standards-database";

export interface ExpectedTargetIdentity {
  readonly databaseName: string;
  readonly systemIdentifier: string;
  readonly transport: "encrypted" | "unencrypted";
}

export function validateExpectedTargetIdentity(value: unknown): ExpectedTargetIdentity {
  const identity = value as Partial<ExpectedTargetIdentity> | undefined;
  if (!identity || typeof identity.databaseName !== "string"
    || !identity.databaseName.trim() || identity.databaseName.includes("\0")
    || Buffer.byteLength(identity.databaseName, "utf8") > 63
    || typeof identity.systemIdentifier !== "string"
    || !/^[1-9][0-9]{0,19}$/u.test(identity.systemIdentifier)
    || BigInt(identity.systemIdentifier) > 18446744073709551615n
    || (identity.transport !== "encrypted" && identity.transport !== "unencrypted")) {
    throw new Error("Explicit expected target identity requires databaseName, decimal systemIdentifier and transport=encrypted|unencrypted");
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
             ssl.ssl AS encrypted
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
}