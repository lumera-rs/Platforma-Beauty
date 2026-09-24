import type { MigrationDatabaseClient } from "./database-client";

export interface DatabaseTargetIdentity {
  readonly databaseName: string;
  readonly systemIdentifier: string;
  readonly transport: "encrypted" | "unencrypted";
  readonly neon?: {
    readonly projectId: string;
    readonly branchId: string;
    readonly timelineId?: string;
  };
}

export interface LedgerIdentity {
  readonly databaseName: string;
  readonly systemIdentifier: string;
  readonly neonProjectId: string | null;
  readonly neonBranchId: string | null;
}

export interface LedgerIdentityColumns {
  readonly database_name?: unknown;
  readonly system_identifier?: unknown;
  readonly neon_project_id?: unknown;
  readonly neon_branch_id?: unknown;
}

const neonProjectIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)+$/u;
const neonBranchIdPattern = /^br-[a-z0-9]+(?:-[a-z0-9]+)+$/u;
const neonTimelineIdPattern = /^[0-9a-f]{32}$/u;

export async function readDatabaseTargetIdentity(
  client: MigrationDatabaseClient,
): Promise<DatabaseTargetIdentity> {
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
  const actualProjectId = row.neon_project_id;
  const actualBranchId = row.neon_branch_id;
  const actualTimelineId = row.neon_timeline_id;
  const nonNeon = actualProjectId === null && actualBranchId === null && actualTimelineId === null;
  if (nonNeon) {
    return {
      databaseName: row.database_name,
      systemIdentifier: row.system_identifier,
      transport: row.encrypted ? "encrypted" : "unencrypted",
    };
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
  return {
    databaseName: row.database_name,
    systemIdentifier: row.system_identifier,
    transport: row.encrypted ? "encrypted" : "unencrypted",
    neon: {
      projectId: actualProjectId,
      branchId: actualBranchId,
      ...(typeof actualTimelineId === "string" ? { timelineId: actualTimelineId } : {}),
    },
  };
}

export function ledgerIdentityFromTarget(identity: DatabaseTargetIdentity): LedgerIdentity {
  return {
    databaseName: identity.databaseName,
    systemIdentifier: identity.systemIdentifier,
    neonProjectId: identity.neon?.projectId ?? null,
    neonBranchId: identity.neon?.branchId ?? null,
  };
}

export type LedgerIdentityState =
  | { readonly kind: "unbound" }
  | { readonly kind: "bound"; readonly identity: LedgerIdentity }
  | { readonly kind: "partial"; readonly component: string };

export function parseLedgerIdentity(columns: LedgerIdentityColumns): LedgerIdentityState {
  const values = [
    columns.database_name,
    columns.system_identifier,
    columns.neon_project_id,
    columns.neon_branch_id,
  ];
  if (values.every(value => value == null)) return { kind: "unbound" };
  if (typeof columns.database_name !== "string") return { kind: "partial", component: "databaseName" };
  if (typeof columns.system_identifier !== "string") return { kind: "partial", component: "systemIdentifier" };
  const projectNull = columns.neon_project_id == null;
  const branchNull = columns.neon_branch_id == null;
  if (projectNull !== branchNull) {
    return { kind: "partial", component: projectNull ? "neon.projectId" : "neon.branchId" };
  }
  if (!projectNull && typeof columns.neon_project_id !== "string") {
    return { kind: "partial", component: "neon.projectId" };
  }
  if (!branchNull && typeof columns.neon_branch_id !== "string") {
    return { kind: "partial", component: "neon.branchId" };
  }
  return {
    kind: "bound",
    identity: {
      databaseName: columns.database_name,
      systemIdentifier: columns.system_identifier,
      neonProjectId: projectNull ? null : columns.neon_project_id as string,
      neonBranchId: branchNull ? null : columns.neon_branch_id as string,
    },
  };
}

export function ledgerIdentityMismatch(
  actual: LedgerIdentity,
  expected: LedgerIdentity,
): string | null {
  if (actual.databaseName !== expected.databaseName) return "databaseName";
  if (actual.systemIdentifier !== expected.systemIdentifier) return "systemIdentifier";
  if (actual.neonProjectId !== expected.neonProjectId) return "neon.projectId";
  if (actual.neonBranchId !== expected.neonBranchId) return "neon.branchId";
  return null;
}