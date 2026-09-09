import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyBaselineEligibility,
  type BaselineEligibilityManifest,
  type ExpectedFingerprint,
} from "./eligibility";
import { fingerprintSnapshot, type CatalogFingerprintResult } from "./fingerprint";
import type {
  OwnershipException,
  SchemaSnapshot,
  TableDefinition,
} from "./model";

const POSTGRES_16 = {
  serverVersionNum: 160010,
  serverMajorVersion: 16,
  deparserFormat: "postgresql-16-deparser-v1",
} as const;

function fingerprint(
  value: SchemaSnapshot,
  registry: OwnershipException[] = [],
): CatalogFingerprintResult {
  return fingerprintSnapshot(value, registry, POSTGRES_16);
}

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
    physicalSnapshot: structuredClone(value.physicalPayload) as SchemaSnapshot,
  };
}

function manifest(...values: ExpectedFingerprint[]): BaselineEligibilityManifest {
  return { formatVersion: 1, expected: values };
}

test("only an exact known legacy fingerprint is eligible for metadata adoption", () => {
  const legacy = fingerprint(snapshot("users", "salons"));
  const current = fingerprint(snapshot("users", "salons", "appointments"));
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
  const legacy = fingerprint(snapshot("users", "salons"));
  const expectedLegacy = manifest(expected("legacy-v1", "LEGACY", legacy));

  assert.equal(
    classifyBaselineEligibility(fingerprint(snapshot()), expectedLegacy).code,
    "FRESH_DATABASE",
  );
  assert.equal(
    classifyBaselineEligibility(fingerprint(snapshot("users")), expectedLegacy).code,
    "PARTIAL_SCHEMA",
  );
  assert.equal(
    classifyBaselineEligibility(fingerprint(snapshot("unrelated")), expectedLegacy).code,
    "WRONG_DATABASE",
  );
});

test("fresh database requires every application-owned identity collection to be empty", () => {
  const legacy = fingerprint(snapshot("users"));
  const expectedLegacy = manifest(expected("legacy-v1", "LEGACY", legacy));
  const enumOnly = fingerprint({
    tables: [],
    enums: [{ schema: "public", name: "status", labels: [] }],
  });
  const schemaOnly = fingerprint({
    tables: [],
    unmodelled: {
      views: [], materializedViews: [], foreignTables: [], sequences: [],
      applicationSchemas: ["tenant_tools"], rlsTables: [], policies: [], extensions: [],
    },
  });
  assert.notEqual(
    classifyBaselineEligibility(enumOnly, expectedLegacy).code,
    "FRESH_DATABASE",
  );
  assert.notEqual(
    classifyBaselineEligibility(schemaOnly, expectedLegacy).code,
    "FRESH_DATABASE",
  );
});

test("catalogs containing only ownership-excluded objects are explicit and fail closed", () => {
  const registry = [{
    objectType: "TABLE" as const,
    schema: "public",
    name: "spatial_ref_sys",
    owner: "PostGIS",
    mechanism: "extension",
    reason: "extension-owned",
    temporary: false,
  }];
  const excludedOnly = fingerprint(snapshot("spatial_ref_sys"), registry);
  const result = classifyBaselineEligibility(excludedOnly, manifest());
  assert.equal(result.code, "ONLY_EXCLUDED_OBJECTS");
  assert.equal(result.eligibleForMetadataAdoption, false);
});

test("an empty approved manifest never manufactures known legacy authority", () => {
  const result = classifyBaselineEligibility(fingerprint(snapshot("users")), manifest());
  assert.equal(result.code, "UNKNOWN_FINGERPRINT");
  assert.equal(result.eligibleForMetadataAdoption, false);
});

test("unknown P0/P1 drift is reported and never eligible", () => {
  const legacy = fingerprint(snapshot("users", "salons"));
  const driftedSnapshot = snapshot("users", "salons");
  driftedSnapshot.tables[0]!.columns = [];
  const classified = classifyBaselineEligibility(
    fingerprint(driftedSnapshot),
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
    fingerprint(renamed),
    manifest(expected("legacy-v1", "LEGACY", fingerprint(legacySnapshot))),
  );
  assert.equal(classified.code, "UNKNOWN_FINGERPRINT");
  assert.equal(classified.eligibleForMetadataAdoption, false);
});

test("exact ownership exclusions are harmless but unknown extras prevent adoption", () => {
  const legacy = fingerprint(snapshot("users"));
  const registry = [{
    objectType: "TABLE" as const,
    schema: "public",
    name: "spatial_ref_sys",
    owner: "PostGIS",
    mechanism: "extension",
    reason: "extension-owned",
    temporary: false,
  }];
  const withOwned = fingerprint(snapshot("users", "spatial_ref_sys"), registry);
  assert.equal(
    classifyBaselineEligibility(withOwned, manifest(expected("legacy-v1", "LEGACY", legacy))).code,
    "KNOWN_LEGACY",
  );

  const withUnknown = fingerprint(snapshot("users", "unknown_extra"), registry);
  const rejected = classifyBaselineEligibility(
    withUnknown,
    manifest(expected("legacy-v1", "LEGACY", legacy)),
  );
  assert.equal(rejected.eligibleForMetadataAdoption, false);
  assert.notEqual(rejected.code, "KNOWN_LEGACY");
});

test("malformed and version-incompatible manifest entries fail closed", () => {
  const legacy = fingerprint(snapshot("users"));
  const candidate = expected("legacy-v1", "LEGACY", legacy);
  assert.throws(
    () => classifyBaselineEligibility(legacy, manifest({
      ...candidate,
      fingerprintVersion: 1 as never,
    })),
    /Incompatible expected fingerprint version/,
  );
  for (const state of ["OTHER", undefined, null]) {
    assert.throws(
      () => classifyBaselineEligibility(legacy, manifest({
        ...candidate,
        state,
      } as never)),
      /Invalid expected fingerprint state/,
    );
  }
  assert.throws(
    () => classifyBaselineEligibility(legacy, {
      formatVersion: 1,
      expected: null,
    } as never),
    /Malformed baseline eligibility manifest/,
  );
});

test("conflicting CURRENT and LEGACY assignments fail closed in either order", () => {
  const value = fingerprint(snapshot("users"));
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
  const users = fingerprint(snapshot("users"));
  const inconsistent = {
    ...expected("legacy-v1", "LEGACY", users),
    physicalSnapshot: snapshot("unrelated"),
  };
  assert.throws(
    () => classifyBaselineEligibility(users, manifest(inconsistent)),
    /Expected fingerprint does not match physical snapshot/,
  );
});