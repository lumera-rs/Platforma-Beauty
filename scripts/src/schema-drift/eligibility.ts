import { compareSchemas } from "./compare";
import {
  FINGERPRINT_ALGORITHM,
  FINGERPRINT_FORMAT_VERSION,
  FINGERPRINT_VERSION,
  SCHEMA_FORMAT_VERSION,
  fingerprintSnapshot,
  type CatalogFingerprintResult,
} from "./fingerprint";
import {
  compareCodeUnits,
  type Finding,
  type PostgresFingerprintCompatibility,
  type SchemaSnapshot,
} from "./model";

export const BASELINE_ELIGIBILITY_FORMAT_VERSION = 1 as const;

export interface ExpectedFingerprint {
  id: string;
  state: "CURRENT" | "LEGACY";
  formatVersion: typeof FINGERPRINT_FORMAT_VERSION;
  algorithm: typeof FINGERPRINT_ALGORITHM;
  fingerprintVersion: typeof FINGERPRINT_VERSION;
  schemaFormatVersion: typeof SCHEMA_FORMAT_VERSION;
  structuralFingerprint: string;
  physicalFingerprint: string;
  physicalSnapshot: SchemaSnapshot;
}

export interface BaselineEligibilityManifest {
  formatVersion: typeof BASELINE_ELIGIBILITY_FORMAT_VERSION;
  expected: ExpectedFingerprint[];
}

export type BaselineEligibilityCode =
  | "FRESH_DATABASE"
  | "ALREADY_CURRENT"
  | "KNOWN_LEGACY"
  | "PARTIAL_SCHEMA"
  | "WRONG_DATABASE"
  | "UNEXPECTED_P0_P1_DRIFT"
  | "UNKNOWN_FINGERPRINT";

export interface BaselineEligibilityResult {
  formatVersion: typeof BASELINE_ELIGIBILITY_FORMAT_VERSION;
  code: BaselineEligibilityCode;
  eligibleForMetadataAdoption: boolean;
  matchedExpectedId: string | null;
  live: Pick<CatalogFingerprintResult,
    "formatVersion" | "algorithm" | "fingerprintVersion" | "schemaFormatVersion"
    | "structuralFingerprint" | "physicalFingerprint" | "normalizedObjectCount"
    | "ownershipExceptions" | "postgresCompatibility">;
  comparison: {
    expectedId: string;
    sharedTableCount: number;
    expectedTableCount: number;
    liveTableCount: number;
    p0p1Findings: Finding[];
  } | null;
}

const fingerprintPattern = /^[a-f0-9]{64}$/;

export function classifyBaselineEligibility(
  live: CatalogFingerprintResult,
  manifest: BaselineEligibilityManifest,
): BaselineEligibilityResult {
  validateManifest(manifest, live.postgresCompatibility);
  const liveSummary: BaselineEligibilityResult["live"] = {
    formatVersion: live.formatVersion,
    algorithm: live.algorithm,
    fingerprintVersion: live.fingerprintVersion,
    schemaFormatVersion: live.schemaFormatVersion,
    postgresCompatibility: live.postgresCompatibility,
    structuralFingerprint: live.structuralFingerprint,
    physicalFingerprint: live.physicalFingerprint,
    normalizedObjectCount: live.normalizedObjectCount,
    ownershipExceptions: live.ownershipExceptions,
  };
  const result = (
    code: BaselineEligibilityCode,
    matchedExpectedId: string | null = null,
    comparison: BaselineEligibilityResult["comparison"] = null,
  ): BaselineEligibilityResult => ({
    formatVersion: BASELINE_ELIGIBILITY_FORMAT_VERSION,
    code,
    eligibleForMetadataAdoption: code === "KNOWN_LEGACY",
    matchedExpectedId,
    live: liveSummary,
    comparison,
  });

  if ((live.physicalPayload.tables as SchemaSnapshot["tables"]).length === 0) {
    return result("FRESH_DATABASE");
  }

  const exact = manifest.expected.find((candidate) =>
    candidate.structuralFingerprint === live.structuralFingerprint
    && candidate.physicalFingerprint === live.physicalFingerprint);
  if (exact) {
    return result(exact.state === "LEGACY" ? "KNOWN_LEGACY" : "ALREADY_CURRENT", exact.id);
  }

  const liveSnapshot = live.physicalPayload as SchemaSnapshot;
  const liveTables = new Set(liveSnapshot.tables.map((table) => `${table.schema}.${table.name}`));
  const comparisons = manifest.expected.map((candidate) => {
    const expectedTables = new Set(candidate.physicalSnapshot.tables.map((table) =>
      `${table.schema}.${table.name}`));
    const sharedTableCount = [...expectedTables].filter((key) => liveTables.has(key)).length;
    const audit = compareSchemas(candidate.physicalSnapshot, liveSnapshot);
    return {
      expectedId: candidate.id,
      sharedTableCount,
      expectedTableCount: expectedTables.size,
      liveTableCount: liveTables.size,
      p0p1Findings: audit.findings.filter((finding) =>
        finding.severity === "P0" || finding.severity === "P1"),
    };
  }).sort((left, right) =>
    right.sharedTableCount - left.sharedTableCount
    || compareCodeUnits(left.expectedId, right.expectedId));
  const closest = comparisons[0] ?? null;
  if (!closest || closest.sharedTableCount === 0) return result("WRONG_DATABASE", null, closest);
  if (closest.sharedTableCount < closest.expectedTableCount) {
    return result("PARTIAL_SCHEMA", null, closest);
  }
  if (closest.p0p1Findings.length > 0) {
    return result("UNEXPECTED_P0_P1_DRIFT", null, closest);
  }
  return result("UNKNOWN_FINGERPRINT", null, closest);
}

function validateManifest(
  manifest: BaselineEligibilityManifest,
  postgresCompatibility: PostgresFingerprintCompatibility,
): void {
  if (manifest.formatVersion !== BASELINE_ELIGIBILITY_FORMAT_VERSION) {
    throw new Error(`Unsupported baseline eligibility manifest version: ${manifest.formatVersion}`);
  }
  if (manifest.expected.length === 0) throw new Error("Baseline eligibility manifest has no expected fingerprints");
  const ids = new Set<string>();
  const fingerprintPairs = new Set<string>();
  for (const candidate of manifest.expected) {
    if (!candidate.id.trim() || ids.has(candidate.id)) throw new Error(`Invalid or duplicate expected fingerprint id: ${candidate.id}`);
    ids.add(candidate.id);
    if (
      candidate.formatVersion !== FINGERPRINT_FORMAT_VERSION
      || candidate.algorithm !== FINGERPRINT_ALGORITHM
      || candidate.fingerprintVersion !== FINGERPRINT_VERSION
      || candidate.schemaFormatVersion !== SCHEMA_FORMAT_VERSION
    ) throw new Error(`Incompatible expected fingerprint version: ${candidate.id}`);
    if (
      !fingerprintPattern.test(candidate.structuralFingerprint)
      || !fingerprintPattern.test(candidate.physicalFingerprint)
    ) throw new Error(`Invalid expected fingerprint digest: ${candidate.id}`);
    if (!candidate.physicalSnapshot || !Array.isArray(candidate.physicalSnapshot.tables)) {
      throw new Error(`Missing expected physical snapshot: ${candidate.id}`);
    }
    const pair = `${candidate.structuralFingerprint}\u0000${candidate.physicalFingerprint}`;
    if (fingerprintPairs.has(pair)) {
      throw new Error(`Duplicate or conflicting expected fingerprint pair: ${candidate.id}`);
    }
    fingerprintPairs.add(pair);
    const computed = fingerprintSnapshot(candidate.physicalSnapshot, [], postgresCompatibility);
    if (
      computed.structuralFingerprint !== candidate.structuralFingerprint
      || computed.physicalFingerprint !== candidate.physicalFingerprint
    ) {
      throw new Error(`Expected fingerprint does not match physical snapshot: ${candidate.id}`);
    }
  }
}

export function serializeBaselineEligibility(result: BaselineEligibilityResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}