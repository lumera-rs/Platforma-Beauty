import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStartupEquivalenceCrosswalk,
  validateStartupEquivalenceCrosswalk,
  type StartupEquivalenceCrosswalk,
} from "./crosswalk";

const repositoryCrosswalk = (() => {
  let cached: StartupEquivalenceCrosswalk | undefined;
  return (): StartupEquivalenceCrosswalk => cached ??= buildStartupEquivalenceCrosswalk();
})();

test("builds a deterministic operation-level crosswalk for all owners", () => {
  const first = repositoryCrosswalk();
  const second = buildStartupEquivalenceCrosswalk();
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.version, 1);
  assert.equal(first.startupRoot, "artifacts/api-server/src/index.ts");
  assert.equal(first.counts.ownerCount, 8);
  assert.equal(first.counts.ddlOperationCount, 1_459);
  assert.equal(first.counts.additionalOperationCount, 110);
  assert.equal(first.counts.operationCount, 1_569);
  assert.equal(first.counts.unresolvedCount, 1_569);
  assert.equal(first.owners.reduce((total, owner) => total + owner.operationCount, 0), 1_569);
  assert.doesNotThrow(() => validateStartupEquivalenceCrosswalk(first));
});

test("retains exact SQL or a curated operation for every record", () => {
  const crosswalk = repositoryCrosswalk();
  for (const operation of crosswalk.operations) {
    assert.ok(operation.source.path.length > 0);
    assert.match(operation.source.ownerSourceChecksum, /^[a-f0-9]{64}$/u);
    assert.match(operation.source.sourceChecksum, /^[a-f0-9]{64}$/u);
    assert.ok(operation.source.exactSql || operation.source.curatedOperation);
    assert.ok(operation.dependencies.length > 0);
    assert.equal(operation.migrationCoverage.status, "UNRESOLVED");
    assert.equal(operation.migrationCoverage.canonicalCandidate.semanticsVerified, false);
  }
});

test("distinguishes schema, historical, function, runtime, and scaffolding operations", () => {
  const classes = new Set(repositoryCrosswalk().operations.map((operation) => operation.classification));
  assert.deepEqual(classes, new Set([
    "schema-ddl",
    "historical-backfill",
    "function-trigger-replacement",
    "runtime-data-operation",
    "operational-scaffolding",
  ]));
  assert.ok(repositoryCrosswalk().operations.some((operation) =>
    operation.classification === "operational-scaffolding"
    && operation.repeatBehavior.note.includes("not inferred")));
});

test("records static source order without inventing runtime branch order", () => {
  const crosswalk = repositoryCrosswalk();
  assert.ok(crosswalk.operations.every((operation) =>
    operation.conditionalExecution.staticOrder === "source-order"
    && operation.conditionalExecution.actualBranchOrder === "UNKNOWN"));
  assert.ok(crosswalk.operations.every((operation) =>
    operation.source.function.length > 0
    && operation.source.executionPath.length > 0));
  assert.ok(crosswalk.counts.conditionalOperationCount > 0);
  assert.ok(crosswalk.operations.some((operation) =>
    operation.conditionalExecution.branchDependent
    && operation.conditionalExecution.predicates.length > 0));
});

test("pins all original owner sources and does not authorize equivalence", () => {
  const crosswalk = repositoryCrosswalk();
  assert.equal(Object.keys(crosswalk.sourcePin.ownerSourceChecksums).length, 8);
  assert.ok(crosswalk.operations.every((operation) =>
    operation.migrationCoverage.replacementRequirement.length > 0));
  assert.ok(crosswalk.operations.every((operation) =>
    operation.testOnlySetup.status === "SHARED_OWNER_WITH_TEST_CALLERS"
      || operation.testOnlySetup.status === "NO_TEST_CALLER_FOUND"));
});

test("rejects tampered source pins and any attempted equivalence status", () => {
  const crosswalk = repositoryCrosswalk();
  const first = crosswalk.operations[0]!;
  assert.throws(
    () => validateStartupEquivalenceCrosswalk({
      ...crosswalk,
      operations: [{
        ...first,
        source: { ...first.source, sourceChecksum: "0".repeat(64) },
      }, ...crosswalk.operations.slice(1)],
    }),
    /checksum mismatch/u,
  );
  assert.throws(
    () => validateStartupEquivalenceCrosswalk({
      ...crosswalk,
      operations: [{
        ...first,
        migrationCoverage: {
          ...first.migrationCoverage,
          status: "RESOLVED" as never,
        },
      }, ...crosswalk.operations.slice(1)],
    }),
    /not unresolved/u,
  );
});

test("rejects count-preserving forged narratives and omitted/replaced operations", () => {
  const crosswalk = structuredClone(repositoryCrosswalk());
  const first = crosswalk.operations[0]!;
  assert.throws(() => validateStartupEquivalenceCrosswalk({
    ...crosswalk,
    operations: [{
      ...first,
      migrationCoverage: { ...first.migrationCoverage, replacementRequirement: "No replacement required." },
    }, ...crosswalk.operations.slice(1)],
  }), /pinned repository derivation/u);
});