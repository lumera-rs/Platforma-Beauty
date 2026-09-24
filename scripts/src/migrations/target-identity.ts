import type { DatabaseClient } from "../backend-standards-database";
import {
  readDatabaseTargetIdentity,
  type DatabaseTargetIdentity,
} from "@workspace/db/migration-runtime";

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
): Promise<DatabaseTargetIdentity> {
  const identity = validateExpectedTargetIdentity(expected);
  // One read on the same dedicated backend subsequently used to mutate.
  const actual = await readDatabaseTargetIdentity(client);
  if (actual.databaseName !== identity.databaseName) throw new Error("Target identity mismatch: databaseName");
  if (actual.systemIdentifier !== identity.systemIdentifier) throw new Error("Target identity mismatch: systemIdentifier");
  if (actual.transport !== identity.transport) {
    throw new Error("Target identity mismatch: transport");
  }
  if (!actual.neon) {
    if (identity.neon) throw new Error("Target identity mismatch: neon.projectId");
    return actual;
  }
  if (!identity.neon) throw new Error("Target identity mismatch: neon.projectId expected value is required");
  if (actual.neon.projectId !== identity.neon.projectId) throw new Error("Target identity mismatch: neon.projectId");
  if (actual.neon.branchId !== identity.neon.branchId) throw new Error("Target identity mismatch: neon.branchId");
  if (identity.neon.timelineId !== undefined) {
    if (actual.neon.timelineId === undefined) {
      throw new Error("Target identity indeterminate: missing or invalid neon.timelineId backend evidence");
    }
    if (actual.neon.timelineId !== identity.neon.timelineId) throw new Error("Target identity mismatch: neon.timelineId");
  }
  return actual;
}
