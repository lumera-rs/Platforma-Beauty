import type { DatabaseClient } from "../backend-standards-database";

export interface ExpectedTargetIdentity {
  readonly databaseName: string;
  readonly systemIdentifier: string;
  readonly transport: "encrypted" | "unencrypted";
  readonly neon?: {
    readonly projectId: string;
    readonly branchId: string;
    readonly timelineId?: string;
  };
}

const neonProjectIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)+$/u;
const neonBranchIdPattern = /^br-[a-z0-9]+(?:-[a-z0-9]+)+$/u;
const neonTimelineIdPattern = /^[0-9a-f]{32}$/u;

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
    if (!identity.neon || typeof identity.neon !== "object" || Array.isArray(identity.neon)) {
      throw new Error("Explicit expected target identity neon requires projectId and branchId");
    }
    const keys = Object.keys(identity.neon);
    if (keys.some((key) => key !== "projectId" && key !== "branchId" && key !== "timelineId")) {
      throw new Error("Explicit expected target identity neon contains an unsupported field");
    }
    if (typeof identity.neon.projectId !== "string"
      || Buffer.byteLength(identity.neon.projectId, "utf8") > 63
      || !neonProjectIdPattern.test(identity.neon.projectId)) {
      throw new Error("Explicit expected target identity neon.projectId requires a lowercase hyphenated Neon project id");
    }
    if (typeof identity.neon.branchId !== "string"
      || Buffer.byteLength(identity.neon.branchId, "utf8") > 63
      || !neonBranchIdPattern.test(identity.neon.branchId)) {
      throw new Error("Explicit expected target identity neon.branchId requires a lowercase br- prefixed Neon branch id");
    }
    if (identity.neon.timelineId !== undefined && (typeof identity.neon.timelineId !== "string"
      || !neonTimelineIdPattern.test(identity.neon.timelineId))) {
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
             pg_catalog.current_setting('neon.project_id', true) AS neon_project_id,
             pg_catalog.current_setting('neon.branch_id', true) AS neon_branch_id,
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
  const actualProjectId = row.neon_project_id;
  const actualBranchId = row.neon_branch_id;
  const actualTimelineId = row.neon_timeline_id;
  const nonNeon = actualProjectId === null && actualBranchId === null && actualTimelineId === null;
  if (nonNeon) {
    if (identity.neon) throw new Error("Target identity mismatch: neon.projectId");
    return;
  }
  if (typeof actualProjectId !== "string" || Buffer.byteLength(actualProjectId, "utf8") > 63
    || !neonProjectIdPattern.test(actualProjectId)) {
    throw new Error("Target identity indeterminate: missing or invalid neon.projectId backend evidence");
  }
  if (typeof actualBranchId !== "string" || Buffer.byteLength(actualBranchId, "utf8") > 63
    || !neonBranchIdPattern.test(actualBranchId)) {
    throw new Error("Target identity indeterminate: missing or invalid neon.branchId backend evidence");
  }
  if (actualTimelineId !== null
    && (typeof actualTimelineId !== "string" || !neonTimelineIdPattern.test(actualTimelineId))) {
    throw new Error("Target identity indeterminate: missing or invalid neon.timelineId backend evidence");
  }
  if (!identity.neon) throw new Error("Target identity mismatch: neon.projectId expected value is required");
  if (actualProjectId !== identity.neon.projectId) throw new Error("Target identity mismatch: neon.projectId");
  if (actualBranchId !== identity.neon.branchId) throw new Error("Target identity mismatch: neon.branchId");
  if (identity.neon.timelineId !== undefined) {
    if (actualTimelineId === null) {
      throw new Error("Target identity indeterminate: missing or invalid neon.timelineId backend evidence");
    }
    if (actualTimelineId !== identity.neon.timelineId) throw new Error("Target identity mismatch: neon.timelineId");
  }
}
