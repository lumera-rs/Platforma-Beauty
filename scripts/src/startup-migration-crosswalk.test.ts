import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { StartupDdlBaseline } from "./production-startup-ddl-inventory";
import {
  ADDITIONAL_STARTUP_OPERATIONS,
  buildStartupMigrationCrosswalk,
  CANONICAL_MIGRATION_CHECKSUM,
  ownerCrosswalkReport,
  validateStartupMigrationCrosswalk,
  type StartupMigrationCrosswalk,
} from "./startup-migration-crosswalk";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baseline = JSON.parse(readFileSync(
  path.join(ROOT, "scripts/src/production-startup-ddl-baseline.json"),
  "utf8",
)) as StartupDdlBaseline;
const canonicalSql = readFileSync(
  path.join(ROOT, "lib/db/migrations/000001_canonical_schema/migration.sql"),
  "utf8",
);

function repositoryCrosswalk(): StartupMigrationCrosswalk {
  return buildStartupMigrationCrosswalk(baseline, canonicalSql);
}

test("accounts for all 1,459 records with one mapping per fingerprint", () => {
  const crosswalk = repositoryCrosswalk();
  assert.equal(crosswalk.inventory.ownerCount, 8);
  assert.equal(crosswalk.inventory.recordCount, 1_459);
  assert.equal(crosswalk.inventory.uniqueFingerprintCount, 1_435);
  assert.equal(crosswalk.mappings.length, 1_435);
  assert.equal(
    crosswalk.mappings.reduce((total, mapping) => total + mapping.occurrences.length, 0),
    1_459,
  );
  assert.equal(new Set(crosswalk.mappings.map((mapping) => mapping.fingerprint)).size, 1_435);
});

test("fails closed instead of inventing canonical, future, or retired equivalence", () => {
  const crosswalk = repositoryCrosswalk();
  assert.deepEqual(new Set(crosswalk.mappings.map((mapping) => mapping.status)), new Set(["UNRESOLVED"]));
  assert.ok(crosswalk.mappings.every((mapping) => mapping.evidence.semanticsVerified === false));
  assert.ok(crosswalk.mappings.every((mapping) =>
    mapping.evidence.migrationChecksum === CANONICAL_MIGRATION_CHECKSUM));
});

test("extracts an exact object identity and review evidence for every mapping", () => {
  const crosswalk = repositoryCrosswalk();
  for (const mapping of crosswalk.mappings) {
    assert.ok(mapping.objectIdentity.kind);
    assert.ok(mapping.objectIdentity.schema);
    assert.ok(mapping.objectIdentity.name);
    assert.ok(mapping.dependencies.length > 0);
    assert.ok(mapping.preconditions.length > 0);
    assert.ok(mapping.postconditions.length > 0);
    assert.ok(mapping.rollbackConsiderations.length > 0);
    assert.ok(mapping.resolutionReason.length > 0);
    if (mapping.objectIdentity.dynamicExpression) {
      assert.equal(mapping.status, "UNRESOLVED");
      assert.equal(mapping.objectIdentity.schema, "<dynamic>");
      assert.equal(mapping.evidence.lineReferences.length, 0);
    } else {
      assert.notEqual(mapping.objectIdentity.schema, "$s");
      assert.notEqual(mapping.objectIdentity.name, "I");
    }
  }
});

test("records additional non-DDL operations for every owner", () => {
  const crosswalk = repositoryCrosswalk();
  assert.equal(crosswalk.additionalOperations.length, ADDITIONAL_STARTUP_OPERATIONS.length);
  assert.deepEqual(
    new Set(crosswalk.additionalOperations.map((operation) => operation.owner)),
    new Set(baseline.owners.map((owner) => owner.ensureName)),
  );
  for (const category of [
    "data-backfill",
    "function-replacement",
    "cleanup-reporting",
    "rollout-marker",
    "operational-scaffolding",
  ] as const) {
    assert.ok(crosswalk.additionalOperations.some((operation) => operation.category === category));
  }
  assert.ok(crosswalk.additionalOperations.some((operation) =>
    operation.sourcePath.includes("web-push-schema.ts:82")));
  for (const [objectName, verb] of [
    ["referral_credit_ledger", "UPDATE"],
    ["retail_cart_items", "DELETE FROM"],
    ["fulfillment_status", "UPDATE"],
    ["education_salon_cleanup_reports", "INSERT INTO"],
  ] as const) {
    assert.ok(crosswalk.additionalOperations.some((operation) =>
      operation.id.includes("source-discovered")
      && operation.owner === "ensureBusinessGrowthSchema"
      && operation.summary.includes(objectName)
      && operation.summary.includes(verb)),
    `missing nested Business Growth ${verb} for ${objectName}`);
  }
});

test("derives trigger parents from executable source or marks them dynamic", () => {
  const crosswalk = repositoryCrosswalk();
  const triggers = crosswalk.mappings.filter((mapping) => mapping.objectIdentity.kind === "trigger");
  assert.ok(triggers.length > 0);
  assert.ok(triggers.every((mapping) =>
    Boolean(mapping.objectIdentity.parent) || Boolean(mapping.objectIdentity.dynamicExpression)));
  const giftVoucher = triggers.find((mapping) =>
    mapping.objectIdentity.name === "education_gift_vouchers_snapshot_immutable");
  assert.equal(giftVoucher?.objectIdentity.parent, "education_gift_vouchers");
});

test("owner report reconciles resolved and unresolved counts", () => {
  const crosswalk = repositoryCrosswalk();
  const report = ownerCrosswalkReport(crosswalk, baseline);
  assert.equal(report.length, 8);
  assert.equal(report.reduce((total, owner) => total + owner.inventoryRecords, 0), 1_459);
  assert.ok(report.every((owner) =>
    owner.canonicalBaseline + owner.futureMigrationRequired + owner.retiredHistorical + owner.unresolved
      === owner.uniqueFingerprints));
  assert.ok(report.every((owner) => owner.unresolved === owner.uniqueFingerprints));
});

test("rejects missing, duplicate, unsupported, and inconsistent mappings", () => {
  const crosswalk = repositoryCrosswalk();
  const first = crosswalk.mappings[0]!;

  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      mappings: crosswalk.mappings.slice(1),
    }, baseline),
    /Missing crosswalk mapping/u,
  );

  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      mappings: [...crosswalk.mappings, first],
    }, baseline),
    /Duplicate crosswalk mapping/u,
  );

  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      mappings: [{
        ...first,
        fingerprint: "f".repeat(64),
      }, ...crosswalk.mappings.slice(1)],
    }, baseline),
    /Unsupported crosswalk fingerprint/u,
  );

  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      mappings: [{
        ...first,
        occurrences: [],
      }, ...crosswalk.mappings.slice(1)],
    }, baseline),
    /Occurrence mismatch/u,
  );

  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      mappings: [{
        ...first,
        summary: `${first.summary} fabricated`,
      }, ...crosswalk.mappings.slice(1)],
    }, baseline),
    /Operation metadata mismatch/u,
  );

  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      mappings: [{
        ...first,
        objectIdentity: { kind: "table", schema: "public", name: "fabricated" },
      }, ...crosswalk.mappings.slice(1)],
    }, baseline),
    /Object identity mismatch/u,
  );

  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      mappings: [{
        ...first,
        occurrences: first.occurrences.map((item) => ({ ...item, owner: "ensureMediaSchema" })),
      }, ...crosswalk.mappings.slice(1)],
    }, baseline),
    /Occurrence mismatch/u,
  );
});

test("rejects unsupported status and unproven canonical claims", () => {
  const crosswalk = repositoryCrosswalk();
  const first = crosswalk.mappings[0]!;

  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      mappings: [{
        ...first,
        status: "UNSUPPORTED" as never,
      }, ...crosswalk.mappings.slice(1)],
    }, baseline),
    /Unsupported mapping status/u,
  );

  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      mappings: [{
        ...first,
        status: "CANONICAL_BASELINE",
      }, ...crosswalk.mappings.slice(1)],
    }, baseline),
    /Unproven canonical equivalence/u,
  );
});

test("rejects removal or fabrication of additional operations", () => {
  const crosswalk = repositoryCrosswalk();
  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      additionalOperations: crosswalk.additionalOperations.slice(1),
    }, baseline),
    /Additional startup operations do not match/u,
  );
  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      additionalOperations: [{
        ...crosswalk.additionalOperations[0]!,
        summary: "fabricated",
      }, ...crosswalk.additionalOperations.slice(1)],
    }, baseline),
    /Additional startup operations do not match/u,
  );
});

test("rejects canonical migration checksum drift", () => {
  assert.throws(
    () => buildStartupMigrationCrosswalk(baseline, `${canonicalSql}\n-- changed`),
    /Canonical migration checksum mismatch/u,
  );
});

test("JSON and owner report generation are deterministic", () => {
  const first = repositoryCrosswalk();
  const second = repositoryCrosswalk();
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(
    JSON.stringify(ownerCrosswalkReport(first, baseline)),
    JSON.stringify(ownerCrosswalkReport(second, baseline)),
  );
});