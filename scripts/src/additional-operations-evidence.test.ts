import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadRepositoryCrosswalk, PINNED_STARTUP_OWNER_SOURCE_CHECKSUMS, validateStartupMigrationCrosswalk } from "./startup-migration-crosswalk";
import { loadReviewedHistoricalSources, reviewedHistoricalSource } from "./reviewed-historical-source";
import {
  assertSourceEvidence,
  JsonRecord,
  PINNED_REVIEWED_EVIDENCE_COMMIT,
  PINNED_REVIEWED_EVIDENCE_SHA256,
  sourceSpans,
  validateAdditionalOperationsEvidence,
  validateIntegrityManifest,
} from "./additional-operations-evidence-validation";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const docs = path.join(root, "docs/additional-operations-evidence");
const evidence = JSON.parse(readFileSync(path.join(docs, "complete-evidence.json"), "utf8")) as JsonRecord[];
const manifest = JSON.parse(readFileSync(path.join(docs, "verification.json"), "utf8")) as JsonRecord;

function cloneEvidence(): JsonRecord[] {
  return structuredClone(evidence);
}

function expectEvidenceRejection(mutate: (records: JsonRecord[]) => void): void {
  const records = cloneEvidence();
  mutate(records);
  assert.throws(() => validateAdditionalOperationsEvidence(root, records));
}

test("altered historical source is rejected without poisoning authenticated source", () => {
  const { baseline, crosswalk } = loadRepositoryCrosswalk();
  const source = "artifacts/api-server/src/lib/business-growth-schema.ts";
  const overrides = loadReviewedHistoricalSources(root);
  const authentic = overrides.get(source)!;
  overrides.set(source, `${authentic}\n// unauthenticated historical alteration\n`);
  assert.throws(() => validateStartupMigrationCrosswalk(crosswalk, baseline, {
    sourceOverrides: overrides,
  }), /checksum|drift/iu);
  assert.equal(reviewedHistoricalSource(root, source), authentic);
  validateStartupMigrationCrosswalk(crosswalk, baseline);
});

test("incorrect historical evidence spans and altered excerpts are rejected", () => {
  const record = evidence[0]!;
  const item = (record.sourceEvidence as JsonRecord[])[0]!;
  assertSourceEvidence(root, String(record.id), item, item);
  assert.throws(() => assertSourceEvidence(root, String(record.id), {
    ...item, startLine: 1, endLine: 1,
  }, item), /cited source slice|reviewed pin/iu);
  assert.throws(() => assertSourceEvidence(root, String(record.id), {
    ...item, sqlOrCode: "SELECT 'altered historical evidence';",
  }, item), /cited source slice|reviewed pin/iu);
});

test("additional evidence is schema-normalized, pin-authoritative, and unresolved", () => {
  const statistics = validateAdditionalOperationsEvidence(root, evidence);
  assert.deepEqual(statistics, {
    total: 122,
    exactClaimedSlice: 31,
    containedClaimedSlice: 91,
    containsActualVerbatimExecutableLiteral: 0,
    invalid: 0,
  });
  for (const record of evidence) {
    for (const [field, expectedKeys] of [
      ["canonicalComparison", ["details", "summary"]],
      ["execution", ["details", "summary"]],
      ["effects", ["details", "summary"]],
      ["evidenceAssessment", ["details", "status", "summary"]],
      ["repeatSafety", ["details", "summary"]],
      ["stateDependence", ["dependsOnCurrentProductionState", "details", "summary"]],
    ] as const) {
      const section = record[field] as JsonRecord;
      assert.deepEqual(Object.keys(section).sort(), expectedKeys, `${String(record.id)}: ${field} shape`);
      assert.equal(typeof section.summary, "string", `${String(record.id)}: ${field}.summary`);
      assert.ok(Array.isArray(section.details) && section.details.length > 0, `${String(record.id)}: ${field}.details`);
      for (const detail of section.details as JsonRecord[]) {
        assert.deepEqual(Object.keys(detail).sort(), ["path", "statement"], `${String(record.id)}: ${field}.details item`);
        assert.equal(typeof detail.path, "string", `${String(record.id)}: ${field}.details.path`);
        assert.equal(typeof detail.statement, "string", `${String(record.id)}: ${field}.details.statement`);
      }
    }
  }
});

test("narrative bypasses from the independent review are all rejected", () => {
  const first = (records: JsonRecord[]) => records[0]!;
  const mutations: Array<[string, (records: JsonRecord[]) => void]> = [
    ["nested resolution status", (records) => { (first(records).evidenceAssessment as JsonRecord).status = "RESOLVED"; }],
    ["canonical representation claim", (records) => {
      (first(records).canonicalComparison as JsonRecord).semanticConclusion = "REPRESENTED in canonical 000001; safe to remove";
    }],
    ["canonical equivalence claim", (records) => {
      (first(records).canonicalComparison as JsonRecord).semanticConclusion = "Equivalent to canonical baseline";
    }],
    ["repeat-safe/idempotent claim", (records) => {
      (first(records).repeatSafety as JsonRecord).assessment = "SAFE and fully idempotent";
    }],
    ["state-independent claim", (records) => {
      (first(records).stateDependence as JsonRecord).dependsOnCurrentProductionState = false;
    }],
    ["empty uncertainties", (records) => { first(records).uncertainties = []; }],
    ["meaningless uncertainty", (records) => { first(records).uncertainties = ["none"]; }],
    ["erased effects", (records) => { first(records).effects = "n/a"; }],
    ["same-shape canonical removal claim", (records) => {
      (first(records).canonicalComparison as JsonRecord).summary = "Equivalent; safe to remove";
    }],
    ["same-shape repeat safety claim", (records) => {
      const details = (first(records).repeatSafety as JsonRecord).details as JsonRecord[];
      details[0]!.statement = "Fully idempotent";
    }],
    ["same-shape effects erased across all records", (records) => {
      for (const record of records) (record.effects as JsonRecord).summary = "n/a";
    }],
    ["same-shape fabricated uncertainty", (records) => {
      first(records).uncertainties = ["Production execution and removal safety have already been verified."];
    }],
  ];
  for (const [name, mutate] of mutations) {
    assert.doesNotThrow(() => mutate(cloneEvidence()), `${name}: test mutation must be applicable`);
    expectEvidenceRejection(mutate);
  }
});

test("source evidence is non-shrinkable and reviewed code excerpts remain valid", () => {
  const literalRecord = evidence.find((record) => {
    const item = (record.sourceEvidence as JsonRecord[])[0];
    return item && String(item.sqlOrCode).includes("UPDATE");
  })!;
  const literal = (literalRecord.sourceEvidence as JsonRecord[])[0]!;
  assert.throws(() => assertSourceEvidence(root, "fragment", { ...literal, sqlOrCode: "UPDATE" }));
  assert.throws(() => assertSourceEvidence(root, "fabricated", {
    ...literal,
    sqlOrCode: "UPDATE fabricated_table SET fabricated = true",
  }));
  expectEvidenceRejection((records) => {
    ((records.find((record) => record.id === literalRecord.id)!.sourceEvidence as JsonRecord[])[0]!).sqlOrCode = "UPDATE";
  });
  expectEvidenceRejection((records) => {
    (records.find((record) => record.id === literalRecord.id)!.sourceEvidence as JsonRecord[])[0]!.endLine =
      Number(literal.endLine) - 1;
  });
  assert.ok(["exact", "contained"].includes(assertSourceEvidence(root, String(literalRecord.id), literal)));
});

test("record identity, count, and nested-schema attacks are rejected", () => {
  expectEvidenceRejection((records) => { records.pop(); });
  expectEvidenceRejection((records) => { records.push(structuredClone(records[0]!)); });
  expectEvidenceRejection((records) => { records.push(structuredClone(records[0]!)); records[110]!.id = "appended-record"; });
  for (const [field, value] of [
    ["id", "different/id"],
    ["owner", "fabricated-owner"],
    ["category", "fabricated-category"],
    ["status", "RESOLVED"],
    ["schemaVersion", 2],
  ] as const) {
    expectEvidenceRejection((records) => { records[0]![field] = value; });
  }
  for (const field of [
    "canonicalComparison", "execution", "effects", "evidenceAssessment", "repeatSafety", "stateDependence",
  ]) {
    expectEvidenceRejection((records) => { records[0]![field] = "unstructured narrative"; });
  }
});

test("source locator parser requires a span and preserves comma continuations", () => {
  assert.deepEqual(sourceSpans("artifacts/example.ts:9-12,81-84"), [
    { file: "artifacts/example.ts", start: 9, end: 12 },
    { file: "artifacts/example.ts", start: 81, end: 84 },
  ]);
  assert.deepEqual(sourceSpans("artifacts/example.ts"), []);
  assert.deepEqual(sourceSpans("artifacts/example.ts:9-12,not-a-span"), []);
});

test("integrity manifest covers every package file and derived source statistics", () => {
  validateIntegrityManifest(root, manifest);
  const noMethodology = structuredClone(manifest);
  delete (noMethodology.inputHashesSha256 as JsonRecord)["DDL-RESOLUTION-METHODOLOGY.md"];
  delete (noMethodology.assembledArtifactHashesSha256 as JsonRecord)["DDL-RESOLUTION-METHODOLOGY.md"];
  assert.throws(() => validateIntegrityManifest(root, noMethodology));
  const badHash = structuredClone(manifest);
  (badHash.inputHashesSha256 as JsonRecord)["other-owners.md"] = "0".repeat(64);
  assert.throws(() => validateIntegrityManifest(root, badHash));
  const badStatistics = structuredClone(manifest);
  (badStatistics.sourceEvidenceValidation as JsonRecord).exactClaimedSlice = 24;
  assert.throws(() => validateIntegrityManifest(root, badStatistics));
  const duplicateDeclaration = structuredClone(manifest);
  (duplicateDeclaration.assembledArtifactHashesSha256 as JsonRecord)["bg-data.json"] =
    (duplicateDeclaration.inputHashesSha256 as JsonRecord)["bg-data.json"];
  assert.throws(() => validateIntegrityManifest(root, duplicateDeclaration));
});

test("pinned canonical baseline, inventory, owners, and reviewed pin remain intact", () => {
  const canonical = readFileSync(path.join(root, "lib/db/migrations/000001_canonical_schema/migration.sql"));
  assert.equal(createHash("sha256").update(canonical).digest("hex"), "643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60");
  assert.equal(Object.keys(PINNED_STARTUP_OWNER_SOURCE_CHECKSUMS).length, 8);
  for (const [source, checksum] of Object.entries(PINNED_STARTUP_OWNER_SOURCE_CHECKSUMS)) {
    assert.equal(createHash("sha256").update(reviewedHistoricalSource(root, source)).digest("hex"), checksum, source);
  }
  const reviewed = execFileSync("git", [
    "show",
    `${PINNED_REVIEWED_EVIDENCE_COMMIT}:docs/additional-operations-evidence/complete-evidence.json`,
  ], { cwd: root });
  assert.equal(createHash("sha256").update(reviewed).digest("hex"), PINNED_REVIEWED_EVIDENCE_SHA256);
});

test("pinned literal census remains complete and byte-identical", () => {
  const censusManifest = JSON.parse(readFileSync(path.join(docs, "census.json"), "utf8")) as {
    sourceArtifact: { repositoryCommit: string; path: string; sha256: string };
    expected: {
      literalRows: number;
      dataMutationLiterals: number;
      functionReplacementLiterals: number;
      representedOperationIds: number;
      nonCensusOperationIds: number;
    };
  };
  const source = execFileSync("git", [
    "show",
    `${censusManifest.sourceArtifact.repositoryCommit}:${censusManifest.sourceArtifact.path}`,
  ], { cwd: root });
  assert.equal(createHash("sha256").update(source).digest("hex"), censusManifest.sourceArtifact.sha256);
  const census = JSON.parse(source.toString("utf8")) as {
    census: { actual: [number, number, number]; literals: unknown[][] };
    crosswalkCoverage: { representedIds: number; unrepresentedNonCensusIds: unknown[][] };
  };
  assert.deepEqual(census.census.actual, [
    censusManifest.expected.literalRows,
    censusManifest.expected.dataMutationLiterals,
    censusManifest.expected.functionReplacementLiterals,
  ]);
  assert.equal(census.census.literals.length, censusManifest.expected.literalRows);
  assert.equal(census.crosswalkCoverage.representedIds, censusManifest.expected.representedOperationIds);
  assert.equal(census.crosswalkCoverage.unrepresentedNonCensusIds.length, censusManifest.expected.nonCensusOperationIds);
});