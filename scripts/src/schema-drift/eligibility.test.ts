import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyBaselineEligibility,
  type BaselineEligibilityManifest,
  type ExpectedFingerprint,
} from "./eligibility";
import { fingerprintSnapshot, type CatalogFingerprintResult } from "./fingerprint";
import type { SchemaSnapshot, TableDefinition } from "./model";

function table(name: string): TableDefinition {
  return {
    schema: "public",
    name,
    columns: [{
      position: 1,
      name: "id",
      type: "uuid",
      nullable: false,
      default: null,
      generated: null,
    }],
    primaryKey: null,
    uniques: [],
    foreignKeys: [],
    checks: [],
    exclusions: [],
    indexes: [],
  };
}

const snapshot = (...names: string[]): SchemaSnapshot => ({ tables: names.map(table) });

function expected(
  id: string,
  state: ExpectedFingerprint["state"],
  value: CatalogFingerprintResult,
): ExpectedFingerprint {
  return {
    id,
    state,
    formatVersion: value.formatVersion,
    algorithm: value.algorithm,
    fingerprintVersion: value.fingerprintVersion,
    schemaFormatVersion: value.schemaFormatVersion,
    structuralFingerprint: value.structuralFingerprint,
    physicalFingerprint: value.physicalFingerprint,
    physicalSnapshot: { tables: structuredClone(value.physicalPayload.tables as TableDefinition[]) },
  };
}

function manifest(...values: ExpectedFingerprint[]): BaselineEligibilityManifest {
  return { formatVersion: 1, expected: values };
}

test("only an exact known legacy fingerprint is eligible for metadata adoption", () => {
  const legacy = fingerprintSnapshot(snapshot("users", "salons"));
  const current = fingerprintSnapshot(snapshot("users", "salons", "appointments"));
  const knownLegacy = classifyBaselineEligibility(
    legacy,
    manifest(expected("current-v1", "CURRENT", current), expected("legacy-v1", "LEGACY", legacy)),
  );
  assert.equal(knownLegacy.code, "KNOWN_LEGACY");
  assert.equal(knownLegacy.eligibleForMetadataAdoption, true);
  assert.equal(knownLegacy.matchedExpectedId, "legacy-v1");

  const alreadyCurrent = classifyBaselineEligibility(
    current,
    manifest(expected("current-v1", "CURRENT", current), expected("legacy-v1", "LEGACY", legacy)),
  );
  assert.equal(alreadyCurrent.code, "ALREADY_CURRENT");
  assert.equal(alreadyCurrent.eligibleForMetadataAdoption, false);
});

test("fresh, partial, and wrong databases have distinct fail-closed results", () => {
  const legacy = fingerprintSnapshot(snapshot("users", "salons"));
  const expectedLegacy = manifest(expected("legacy-v1", "LEGACY", legacy));

  assert.equal(
    classifyBaselineEligibility(fingerprintSnapshot(snapshot()), expectedLegacy).code,
    "FRESH_DATABASE",
  );
  assert.equal(
    classifyBaselineEligibility(fingerprintSnapshot(snapshot("users")), expectedLegacy).code,
    "PARTIAL_SCHEMA",
  );
  assert.equal(
    classifyBaselineEligibility(fingerprintSnapshot(snapshot("unrelated")), expectedLegacy).code,
    "WRONG_DATABASE",
  );
});

test("unknown P0/P1 drift is reported and never eligible", () => {
  const legacy = fingerprintSnapshot(snapshot("users", "salons"));
  const driftedSnapshot = snapshot("users", "salons");
  driftedSnapshot.tables[0]!.columns = [];
  const classified = classifyBaselineEligibility(
    fingerprintSnapshot(driftedSnapshot),
    manifest(expected("legacy-v1", "LEGACY", legacy)),
  );
  assert.equal(classified.code, "UNEXPECTED_P0_P1_DRIFT");
  assert.equal(classified.eligibleForMetadataAdoption, false);
  assert.ok(classified.comparison?.p0p1Findings.some((finding) =>
    finding.objectPath === "public.users.id" && finding.severity === "P1"));
});

test("physical-only unknown drift remains fail-closed", () => {
  const legacySnapshot = snapshot("users", "salons");
  legacySnapshot.tables[0]!.indexes.push({
    name: "users_id_idx",
    expressions: ["id"],
    unique: false,
    predicate: null,
    method: "btree",
    keyOptions: [0],
    collations: [""],
    opclasses: ["pg_catalog.uuid_ops"],
  });
  const renamed = structuredClone(legacySnapshot);
  renamed.tables[0]!.indexes[0]!.name = "renamed_users_id_idx";
  const classified = classifyBaselineEligibility(
    fingerprintSnapshot(renamed),
    manifest(expected("legacy-v1", "LEGACY", fingerprintSnapshot(legacySnapshot))),
  );
  assert.equal(classified.code, "UNKNOWN_FINGERPRINT");
  assert.equal(classified.eligibleForMetadataAdoption, false);
});

test("exact ownership exclusions are harmless but unknown extras prevent adoption", () => {
  const legacy = fingerprintSnapshot(snapshot("users"));
  const registry = [{
    objectType: "TABLE" as const,
    schema: "public",
    name: "spatial_ref_sys",
    owner: "PostGIS",
    mechanism: "extension",
    reason: "extension-owned",
    temporary: false,
  }];
  const withOwned = fingerprintSnapshot(snapshot("users", "spatial_ref_sys"), registry);
  assert.equal(
    classifyBaselineEligibility(withOwned, manifest(expected("legacy-v1", "LEGACY", legacy))).code,
    "KNOWN_LEGACY",
  );

  const withUnknown = fingerprintSnapshot(snapshot("users", "unknown_extra"), registry);
  const rejected = classifyBaselineEligibility(
    withUnknown,
    manifest(expected("legacy-v1", "LEGACY", legacy)),
  );
  assert.equal(rejected.eligibleForMetadataAdoption, false);
  assert.notEqual(rejected.code, "KNOWN_LEGACY");
});

test("malformed and version-incompatible manifests fail closed", () => {
  const legacy = fingerprintSnapshot(snapshot("users"));
  const candidate = expected("legacy-v1", "LEGACY", legacy);
  assert.throws(
    () => classifyBaselineEligibility(legacy, { formatVersion: 1, expected: [] }),
    /no expected fingerprints/,
  );
  assert.throws(
    () => classifyBaselineEligibility(legacy, manifest({
      ...candidate,
      fingerprintVersion: 2 as never,
    })),
    /Incompatible expected fingerprint version/,
  );
});

test("conflicting CURRENT and LEGACY assignments fail closed in either order", () => {
  const value = fingerprintSnapshot(snapshot("users"));
  const current = expected("current-v1", "CURRENT", value);
  const legacy = expected("legacy-v1", "LEGACY", value);
  for (const candidates of [[current, legacy], [legacy, current]]) {
    assert.throws(
      () => classifyBaselineEligibility(value, manifest(...candidates)),
      /Duplicate or conflicting expected fingerprint pair/,
    );
  }
});

test("manifest digests must describe the reviewed physical snapshot", () => {
  const users = fingerprintSnapshot(snapshot("users"));
  const inconsistent = {
    ...expected("legacy-v1", "LEGACY", users),
    physicalSnapshot: snapshot("unrelated"),
  };
  assert.throws(
    () => classifyBaselineEligibility(users, manifest(inconsistent)),
    /Expected fingerprint does not match physical snapshot/,
  );
});