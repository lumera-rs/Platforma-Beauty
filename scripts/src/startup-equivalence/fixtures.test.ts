import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile } from "node:fs/promises";
import {
  explicitAdminUrlFromArgs,
  operationCoverage,
  validateDisposableAdminUrl,
  characterizeDisposableEquivalence,
} from "./fixtures";

test("disposable admin URL validation is explicit and fail-closed", () => {
  assert.throws(() => validateDisposableAdminUrl("postgresql://localhost/db"), /explicit non-default/u);
  assert.throws(() => validateDisposableAdminUrl("postgresql://db.example.test:15432/db"), /loopback/u);
  assert.throws(() => validateDisposableAdminUrl("postgresql://127.0.0.1:5432/db"), /non-default/u);
  assert.doesNotThrow(() => validateDisposableAdminUrl("postgresql://fixture_owner@127.0.0.1:15432/db"));
  assert.throws(() => validateDisposableAdminUrl("postgresql://owner@127.0.0.1:15432/db?host=remote"), /query overrides/u);
  assert.throws(() => validateDisposableAdminUrl("postgresql://owner:secret@127.0.0.1:15432/db"), /passwords/u);
  assert.throws(() => validateDisposableAdminUrl("postgresql://127.0.0.1:15432/db"), /username/u);
});

test("ambient database URLs are never selected", () => {
  assert.equal(explicitAdminUrlFromArgs([]), undefined);
  assert.equal(explicitAdminUrlFromArgs(["--admin-url=postgresql://127.0.0.1:15432/db"]), "postgresql://127.0.0.1:15432/db");
});

test("operation-level crosswalk reports unresolved historical work without inventing coverage", () => {
  const coverage = operationCoverage();
  assert.ok(coverage.totalMappings > 0);
  assert.ok(coverage.additionalOperationCount > 0);
  assert.ok(coverage.unresolvedAdditionalOperationIds.length > 0);
  assert.ok(coverage.mappingStatusCounts.UNRESOLVED !== undefined || coverage.additionalStatusCounts.UNRESOLVED !== undefined);
});

const explicitAdminUrl = explicitAdminUrlFromArgs();
test("disposable equivalence characterization requires an explicit child-database admin target", {
  skip: explicitAdminUrl ? false : "Pass --admin-url=postgresql://127.0.0.1:<non-5432-port>/<admin-db> to run disposable characterization.",
}, async () => {
  const previousDisposableDatabase = process.env.LUMERA_DISPOSABLE_DATABASE;
  const report = await characterizeDisposableEquivalence(explicitAdminUrl!);
  assert.equal(process.env.DATABASE_URL, undefined, "owned child URL must not leak after characterization");
  assert.equal(process.env.LUMERA_DISPOSABLE_DATABASE, previousDisposableDatabase,
    "owned child marker must be restored after delayed ORM imports");
  const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length);
  if (output) await writeFile(output, `${JSON.stringify(report, (key, value) =>
    key === "structuralPayload" || key === "physicalPayload" ? undefined : value, 2)}\n`);
  assert.equal(report.provenance.productionClaim, false);
  assert.equal(report.provenance.kind, "DISPOSABLE_CHILD_DATABASES_ONLY");
  assert.equal(report.driftRejection.readiness, "NOT_READY");
  assert.equal(report.partialSchemaRejection.readiness, "NOT_READY");
  assert.equal(report.startupRollouts.length, 8);
  assert.ok(report.startupRollouts.every((item) => item.executed));
  assert.ok(report.startupRollouts.some((item) => item.name === "ensureReferralSchema" && !item.injectedPool));
  assert.equal(report.startupRepeat.length, 8);
  assert.ok(report.startupRepeat.every((item) => item.executed));
  assert.deepEqual(report.startupRepeatDifference.changedRowCounts, {});
  // Characterization of a known BLOCKER, not an equivalence success test:
  // the existing fast-path rollout replaces routines differently on repeat.
  assert.equal(report.startupRepeatDifference.structuralFingerprintChanged, true);
  assert.equal(report.startupRepeatDifference.physicalFingerprintChanged, true);
  assert.ok(report.startupRepeatDifference.catalogChanges.length > 0);
  assert.ok(report.blockers.includes("STARTUP_REPEAT_CATALOG_DRIFT"));
  assert.equal(report.repeatedStartupPreflight?.readiness, "NOT_READY");
  assert.equal(report.finalStartupDifference.structuralFingerprintChanged, false);
  assert.equal(report.finalStartupDifference.physicalFingerprintChanged, false);
  assert.ok(Object.keys(report.finalStartupDifference.changedRowCounts).length > 0);
  assert.ok(report.blockers.includes("STARTUP_SEED_OR_RECONCILIATION_DATA_MISSING_FROM_MIGRATIONS"));
  assert.ok(report.blockers.length > 0, "unresolved operation coverage must remain visible");
});