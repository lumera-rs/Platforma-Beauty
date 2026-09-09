import { createHash } from "node:crypto";
import type { DatabaseClient } from "../backend-standards-database";
import {
  readPostgresFingerprintCompatibility,
  readPostgresSnapshot,
} from "./catalog";
import {
  classifyBaselineEligibility,
  type BaselineEligibilityManifest,
  type BaselineEligibilityResult,
} from "./eligibility";
import { fingerprintSnapshot } from "./fingerprint";
import {
  acquireBaselineAdoptionLock,
  beginBaselineAdoptionTransaction,
  releaseBaselineAdoptionLock,
} from "./fingerprint-transaction";
import { ownershipExceptions } from "./ownership";
import { readOnlyQueryLayer } from "./read-only-query";

export const BASELINE_METADATA_SCHEMA = "lumera_migrations";
export const BASELINE_METADATA_TABLE = "baseline_adoptions";

export interface BaselineAdoptionRequest {
  expectedId: string;
  actor: string;
  manifestBytes: string;
}

export interface BaselineAdoptionResult {
  outcome: "ADOPTED" | "ALREADY_ADOPTED";
  eligibility: BaselineEligibilityResult;
  expectedId: string;
  manifestSha256: string;
}

export class BaselineAdoptionRefusedError extends Error {
  constructor(
    readonly eligibility: BaselineEligibilityResult,
    message: string,
  ) {
    super(message);
    this.name = "BaselineAdoptionRefusedError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function adoptKnownLegacyBaseline(
  client: DatabaseClient,
  request: BaselineAdoptionRequest,
): Promise<BaselineAdoptionResult> {
  let lockAcquired = false;
  try {
    await acquireBaselineAdoptionLock(client);
    lockAcquired = true;
    await beginBaselineAdoptionTransaction(client);
    const result = await adoptKnownLegacyBaselineInTransaction(client, request);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (lockAcquired) await releaseBaselineAdoptionLock(client);
  }
}

export async function adoptKnownLegacyBaselineInTransaction(
  client: DatabaseClient,
  request: BaselineAdoptionRequest,
): Promise<BaselineAdoptionResult> {
  const expectedId = request.expectedId.trim();
  const actor = request.actor.trim();
  if (!expectedId) throw new Error("Expected legacy fingerprint id is required");
  if (!actor) throw new Error("Adoption actor is required");
  let manifest: BaselineEligibilityManifest;
  try {
    manifest = JSON.parse(request.manifestBytes) as BaselineEligibilityManifest;
  } catch {
    throw new Error("Eligibility manifest is not valid JSON");
  }

  const readOnlyClient = readOnlyQueryLayer(client);
  const postgresCompatibility = await readPostgresFingerprintCompatibility(readOnlyClient);
  const live = fingerprintSnapshot(
    await readPostgresSnapshot(readOnlyClient),
    ownershipExceptions,
    postgresCompatibility,
  );
  const eligibility = classifyBaselineEligibility(live, manifest);
  if (
    eligibility.code !== "KNOWN_LEGACY"
    || !eligibility.eligibleForMetadataAdoption
    || eligibility.matchedExpectedId !== expectedId
  ) {
    throw new BaselineAdoptionRefusedError(
      eligibility,
      `Baseline adoption refused: expected KNOWN_LEGACY ${expectedId}, got `
        + `${eligibility.code} ${eligibility.matchedExpectedId ?? "(no match)"}`,
    );
  }

  const manifestSha256 = sha256(request.manifestBytes);
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${BASELINE_METADATA_SCHEMA}`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${BASELINE_METADATA_SCHEMA}.${BASELINE_METADATA_TABLE} (
      expected_id text PRIMARY KEY,
      structural_fingerprint text NOT NULL,
      physical_fingerprint text NOT NULL,
      manifest_sha256 text NOT NULL,
      fingerprint_format_version integer NOT NULL,
      fingerprint_algorithm text NOT NULL,
      fingerprint_version integer NOT NULL,
      schema_format_version integer NOT NULL,
      postgres_server_version_num integer NOT NULL,
      postgres_server_major_version integer NOT NULL,
      postgres_deparser_format text NOT NULL,
      adopted_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      adopted_by text NOT NULL,
      database_name text NOT NULL DEFAULT current_database()
    )`);
  const inserted = await client.query(`
    INSERT INTO ${BASELINE_METADATA_SCHEMA}.${BASELINE_METADATA_TABLE} (
      expected_id, structural_fingerprint, physical_fingerprint, manifest_sha256,
      fingerprint_format_version, fingerprint_algorithm, fingerprint_version,
      schema_format_version, postgres_server_version_num,
      postgres_server_major_version, postgres_deparser_format, adopted_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (expected_id) DO NOTHING
    RETURNING expected_id`, [
    expectedId,
    eligibility.live.structuralFingerprint,
    eligibility.live.physicalFingerprint,
    manifestSha256,
    eligibility.live.formatVersion,
    eligibility.live.algorithm,
    eligibility.live.fingerprintVersion,
    eligibility.live.schemaFormatVersion,
    eligibility.live.postgresCompatibility.serverVersionNum,
    eligibility.live.postgresCompatibility.serverMajorVersion,
    eligibility.live.postgresCompatibility.deparserFormat,
    actor,
  ]);

  if (inserted.rows.length === 0) {
    const existing = await client.query(`
      SELECT structural_fingerprint, physical_fingerprint, manifest_sha256,
        fingerprint_format_version, fingerprint_algorithm, fingerprint_version,
        schema_format_version, postgres_server_version_num,
        postgres_server_major_version, postgres_deparser_format
      FROM ${BASELINE_METADATA_SCHEMA}.${BASELINE_METADATA_TABLE}
      WHERE expected_id = $1`, [expectedId]);
    const row = existing.rows[0] as Record<string, unknown> | undefined;
    const same = row
      && row.structural_fingerprint === eligibility.live.structuralFingerprint
      && row.physical_fingerprint === eligibility.live.physicalFingerprint
      && row.manifest_sha256 === manifestSha256
      && Number(row.fingerprint_format_version) === eligibility.live.formatVersion
      && row.fingerprint_algorithm === eligibility.live.algorithm
      && Number(row.fingerprint_version) === eligibility.live.fingerprintVersion
      && Number(row.schema_format_version) === eligibility.live.schemaFormatVersion
      && Number(row.postgres_server_version_num)
        === eligibility.live.postgresCompatibility.serverVersionNum
      && Number(row.postgres_server_major_version)
        === eligibility.live.postgresCompatibility.serverMajorVersion
      && row.postgres_deparser_format
        === eligibility.live.postgresCompatibility.deparserFormat;
    if (!same) {
      throw new Error(`Baseline adoption ledger conflict for expected id: ${expectedId}`);
    }
  }

  return {
    outcome: inserted.rows.length === 1 ? "ADOPTED" : "ALREADY_ADOPTED",
    eligibility,
    expectedId,
    manifestSha256,
  };
}