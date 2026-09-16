import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadRepositoryCrosswalk, PINNED_STARTUP_OWNER_SOURCE_CHECKSUMS } from "./startup-migration-crosswalk";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidencePath = path.join(root, "docs/additional-operations-evidence/complete-evidence.json");
const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as Array<Record<string, unknown>>;
const { baseline, crosswalk } = loadRepositoryCrosswalk();
const byId = new Map(crosswalk.additionalOperations.map((operation) => [operation.id, operation]));

export function sourceSpans(locator: string): Array<{ file: string; start: number; end: number }> {
  const match = /^\s*([^,\s:][^,]*?):(\d+)(?::\d+)?(?:-(\d+)(?::\d+)?)?(.*)$/u.exec(locator);
  if (!match) return [];
  const file = match[1]!;
  const spans = [{ file, start: Number(match[2]), end: Number(match[3] ?? match[2]) }];
  let rest = match[4]!;
  while (rest.length) {
    const continuation = /^\s*,\s*(\d+)(?::\d+)?(?:-(\d+)(?::\d+)?)?(.*)$/u.exec(rest);
    if (!continuation) return [];
    spans.push({ file, start: Number(continuation[1]), end: Number(continuation[2] ?? continuation[1]) });
    rest = continuation[3]!;
  }
  return spans;
}

function citedSlice(file: string, startLine: number, endLine: number): string {
  return readFileSync(path.join(root, file), "utf8").split(/\r?\n/u).slice(startLine - 1, endLine).join("\n");
}

function assertSourceEvidence(id: string, item: Record<string, unknown>): void {
  assert.equal(typeof item.path, "string", `${id}: source evidence path`);
  const evidencePath = String(item.path);
  assert.ok(existsSync(path.join(root, evidencePath)), `${id}: missing evidence path`);
  assert.equal(Number.isInteger(item.startLine), true, `${id}: evidence startLine`);
  assert.equal(Number.isInteger(item.endLine), true, `${id}: evidence endLine`);
  const startLine = Number(item.startLine);
  const endLine = Number(item.endLine);
  const lines = readFileSync(path.join(root, evidencePath), "utf8").split(/\r?\n/u);
  assert.ok(startLine >= 1 && endLine >= startLine && endLine <= lines.length, `${id}: evidence bounds`);
  assert.equal(typeof item.sqlOrCode, "string", `${id}: sqlOrCode`);
  const claimed = String(item.sqlOrCode).replace(/\r\n/gu, "\n").trim();
  assert.ok(claimed.length > 0, `${id}: sqlOrCode must not be empty`);
  const actual = citedSlice(evidencePath, startLine, endLine);
  assert.ok(actual.includes(claimed), `${id}: sqlOrCode is not contained in cited source slice`);
}

test("additional evidence is complete, crosswalk-authoritative, and unresolved", () => {
  assert.equal(evidence.length, 110);
  assert.equal(byId.size, 110);
  const ids = evidence.map((record) => record.id);
  assert.equal(new Set(ids).size, 110);
  assert.deepEqual(new Set(ids), new Set(byId.keys()));

  for (const record of evidence) {
    const id = String(record.id);
    const operation = byId.get(id)!;
    const requiredKeys = [
      "canonicalComparison",
      "category",
      "effects",
      "evidenceAssessment",
      "execution",
      "id",
      "owner",
      "repeatSafety",
      "schemaVersion",
      "sourceEvidence",
      "sourcePath",
      "stateDependence",
      "status",
      "uncertainties",
    ];
    for (const key of requiredKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(record, key), `${id}: required top-level key ${key}`);
    }
    assert.equal(record.schemaVersion, 1, `${id}: schemaVersion`);
    assert.equal(record.owner, operation.owner, `${id}: owner`);
    assert.equal(record.sourcePath, operation.sourcePath, `${id}: sourcePath`);
    assert.equal(record.status, operation.status, `${id}: status`);
    assert.equal(operation.status, "UNRESOLVED", `${id}: crosswalk status`);
    assert.equal(record.category, operation.category, `${id}: category`);
    assert.ok(Array.isArray(record.sourceEvidence) && record.sourceEvidence.length > 0, `${id}: sourceEvidence`);

    const spans = sourceSpans(String(record.sourcePath));
    assert.ok(spans.length > 0, `${id}: sourcePath must contain at least one span`);
    for (const span of spans) {
      const absolute = path.join(root, span.file);
      assert.ok(existsSync(absolute), `${id}: missing ${span.file}`);
      const lineCount = readFileSync(absolute, "utf8").split(/\r?\n/u).length;
      assert.ok(span.start >= 1 && span.end >= span.start && span.end <= lineCount, `${id}: source bounds`);
    }
    for (const item of record.sourceEvidence as Array<Record<string, unknown>>) {
      assertSourceEvidence(id, item);
    }
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

test("source evidence rejects out-of-bounds continuations and fabricated SQL", () => {
  assert.throws(() => {
    const spans = sourceSpans("scripts/src/additional-operations-evidence.test.ts:1-2,999999-1000000");
    for (const span of spans) {
      const lineCount = readFileSync(path.join(root, span.file), "utf8").split(/\r?\n/u).length;
      assert.ok(span.end <= lineCount, "continuation must be within file");
    }
  });
  assert.throws(() => assertSourceEvidence("adversarial", {
    path: "scripts/src/additional-operations-evidence.test.ts",
    startLine: 1,
    endLine: 2,
    sqlOrCode: "FABRICATED SQL NOT IN SOURCE",
  }));
});

test("pinned canonical baseline, inventory, owners, and provenance remain intact", () => {
  const canonical = readFileSync(path.join(root, "lib/db/migrations/000001_canonical_schema/migration.sql"));
  assert.equal(createHash("sha256").update(canonical).digest("hex"), "643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60");
  assert.equal(crosswalk.mappings.length, 1435);
  assert.equal(baseline.owners.length, 8);
  assert.equal(baseline.owners.reduce((total, owner) => total + owner.operations.length, 0), 1459);
  assert.match(readFileSync(path.join(root, "docs/additional-operations-evidence/README.md"), "utf8"), /6e7ac9411eb454b4aeddccd46444df1aa7e120bc/u);
  assert.equal(crosswalk.mappings.filter((mapping) => mapping.status !== "UNRESOLVED").length, 0);
  assert.equal(Object.keys(PINNED_STARTUP_OWNER_SOURCE_CHECKSUMS).length, 8);
  for (const [source, checksum] of Object.entries(PINNED_STARTUP_OWNER_SOURCE_CHECKSUMS)) {
    assert.equal(createHash("sha256").update(readFileSync(path.join(root, source))).digest("hex"), checksum, source);
  }
});

test("pinned literal census remains complete and byte-identical", () => {
  const manifest = JSON.parse(readFileSync(
    path.join(root, "docs/additional-operations-evidence/census.json"),
    "utf8",
  )) as {
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
    `${manifest.sourceArtifact.repositoryCommit}:${manifest.sourceArtifact.path}`,
  ], { cwd: root });
  assert.equal(createHash("sha256").update(source).digest("hex"), manifest.sourceArtifact.sha256);
  const census = JSON.parse(source.toString("utf8")) as {
    census: { actual: [number, number, number]; literals: unknown[][] };
    crosswalkCoverage: { representedIds: number; unrepresentedNonCensusIds: unknown[][] };
  };
  assert.deepEqual(census.census.actual, [
    manifest.expected.literalRows,
    manifest.expected.dataMutationLiterals,
    manifest.expected.functionReplacementLiterals,
  ]);
  assert.equal(census.census.literals.length, manifest.expected.literalRows);
  assert.equal(census.crosswalkCoverage.representedIds, manifest.expected.representedOperationIds);
  assert.equal(
    census.crosswalkCoverage.unrepresentedNonCensusIds.length,
    manifest.expected.nonCensusOperationIds,
  );
});

test("report prose has no ephemeral crosswalk provenance", () => {
  const docs = path.join(root, "docs/additional-operations-evidence");
  const files = ["README.md", "context.md", "census.md", "census.json", "complete-report.md", "verification.json",
    "bg-data.json", "bg-functions.json", "other-owners.json", "complete-evidence.json"];
  for (const file of files) {
    assert.doesNotMatch(readFileSync(path.join(docs, file), "utf8"), /\/tmp\/additional-evidence-crosswalk\.json/u, file);
  }
});