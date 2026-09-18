import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { loadRepositoryCrosswalk } from "./startup-migration-crosswalk";

export const PINNED_REVIEWED_EVIDENCE_COMMIT = "91b6b162b6b491a5dc76f90cb55de9894c199de6";
export const PINNED_REVIEWED_EVIDENCE_PATH = "docs/additional-operations-evidence/complete-evidence.json";
export const PINNED_REVIEWED_EVIDENCE_SHA256 = "866fb8e2516bbbd5696264d1e43a0ca10be2e80255df5366f9b8354553e606da";

export type JsonRecord = Record<string, unknown>;

export type SourceEvidenceStatistics = {
  total: number;
  exactClaimedSlice: number;
  containedClaimedSlice: number;
  containsActualVerbatimExecutableLiteral: number;
  invalid: number;
};

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

function fail(message: string): never {
  throw new Error(message);
}

function asRecord(value: unknown, context: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${context}: expected object`);
  return value as JsonRecord;
}

function nonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${context}: expected non-empty string`);
  return value;
}

function nonEmptyStringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value) || value.length === 0) fail(`${context}: expected non-empty string array`);
  return value.map((item, index) => nonEmptyString(item, `${context}[${index}]`));
}

function normalizedText(value: string): string {
  return value.replace(/\r\n/gu, "\n").trim();
}

function citedSlice(root: string, file: string, startLine: number, endLine: number): string {
  return readFileSync(path.join(root, file), "utf8").split(/\r?\n/u).slice(startLine - 1, endLine).join("\n");
}

type NarrativeDetail = { path: string; statement: string };

function detailsFrom(value: unknown, fieldPath = "value"): NarrativeDetail[] {
  if (typeof value === "string") return [{ path: fieldPath, statement: nonEmptyString(value, fieldPath) }];
  if (typeof value === "number" || typeof value === "boolean") return [{ path: fieldPath, statement: String(value) }];
  if (Array.isArray(value)) return value.flatMap((item, index) => detailsFrom(item, `${fieldPath}.${index}`));
  const record = asRecord(value, fieldPath);
  return Object.entries(record).flatMap(([key, item]) => detailsFrom(item, `${fieldPath}.${key}`));
}

function summaryFrom(value: unknown, keys: string[], context: string): string {
  if (typeof value === "string") return nonEmptyString(value, context);
  const record = asRecord(value, context);
  for (const key of keys) {
    if (typeof record[key] === "string") return nonEmptyString(record[key], `${context}.${key}`);
  }
  return detailsFrom(record, context)[0]!.statement;
}

/**
 * Deterministically projects all 110 pinned records into six truly common
 * narrative shapes. Every original scalar is retained verbatim in the
 * consistently typed `details` entries; the selected `summary` is a
 * duplicate, human-readable entry point rather than a replacement.
 */
export function normalizeCuratedEvidence(records: JsonRecord[]): JsonRecord[] {
  return records.map((record) => {
    const canonicalComparison = record.canonicalComparison;
    const execution = record.execution;
    const effects = record.effects;
    const evidenceAssessment = record.evidenceAssessment;
    const repeatSafety = record.repeatSafety;
    const stateDependence = record.stateDependence;
    const assessmentStatus = typeof evidenceAssessment === "object" && evidenceAssessment && !Array.isArray(evidenceAssessment)
      ? (evidenceAssessment as JsonRecord).status
      : record.status;

    return {
      ...record,
      canonicalComparison: {
        summary: summaryFrom(canonicalComparison, ["semanticConclusion", "semanticComparison", "evidence", "classification"], `${String(record.id)} canonicalComparison`),
        details: detailsFrom(canonicalComparison, "canonicalComparison"),
      },
      execution: {
        summary: summaryFrom(execution, ["sourceOrder", "conditional"], `${String(record.id)} execution`),
        details: detailsFrom(execution, "execution"),
      },
      effects: {
        summary: summaryFrom(effects, ["description", "detail", "type"], `${String(record.id)} effects`),
        details: detailsFrom(effects, "effects"),
      },
      evidenceAssessment: {
        status: assessmentStatus,
        summary: summaryFrom(evidenceAssessment, ["provisional", "basis"], `${String(record.id)} evidenceAssessment`),
        details: detailsFrom(evidenceAssessment, "evidenceAssessment"),
      },
      repeatSafety: {
        summary: summaryFrom(repeatSafety, ["assessment", "evidence"], `${String(record.id)} repeatSafety`),
        details: detailsFrom(repeatSafety, "repeatSafety"),
      },
      stateDependence: {
        dependsOnCurrentProductionState: true,
        summary: summaryFrom(stateDependence, ["evidence", "detail", "assessment"], `${String(record.id)} stateDependence`),
        details: detailsFrom(stateDependence, "stateDependence"),
      },
    };
  });
}

export function loadPinnedReviewedEvidence(root: string): JsonRecord[] {
  const source = execFileSync("git", [
    "show",
    `${PINNED_REVIEWED_EVIDENCE_COMMIT}:${PINNED_REVIEWED_EVIDENCE_PATH}`,
  ], { cwd: root });
  const digest = createHash("sha256").update(source).digest("hex");
  if (digest !== PINNED_REVIEWED_EVIDENCE_SHA256) {
    fail(`pinned reviewed evidence SHA-256 mismatch: ${digest}`);
  }
  const parsed = JSON.parse(source.toString("utf8")) as unknown;
  if (!Array.isArray(parsed)) fail("pinned reviewed evidence: expected array");
  return normalizeCuratedEvidence(parsed.map((record, index) => asRecord(record, `pinned record ${index}`)));
}

function assertStringFields(record: JsonRecord, fields: string[], context: string): void {
  for (const field of fields) nonEmptyString(record[field], `${context}.${field}`);
}

function assertCommonNarrativeSection(value: unknown, context: string): void {
  const section = asRecord(value, context);
  if (JSON.stringify(Object.keys(section).sort()) !== JSON.stringify(["details", "summary"])) {
    fail(`${context}: expected exactly summary and details`);
  }
  nonEmptyString(section.summary, `${context}.summary`);
  const details = section.details;
  if (!Array.isArray(details) || details.length === 0) fail(`${context}.details: expected non-empty array`);
  for (const [index, detail] of details.entries()) {
    const entry = asRecord(detail, `${context}.details[${index}]`);
    if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["path", "statement"])) {
      fail(`${context}.details[${index}]: expected exactly path and statement`);
    }
    assertStringFields(entry, ["path", "statement"], `${context}.details[${index}]`);
  }
}

export function assertEvidenceRecordSchema(record: unknown, index: number): asserts record is JsonRecord {
  const evidence = asRecord(record, `record ${index}`);
  const id = nonEmptyString(evidence.id, `record ${index}.id`);
  const requiredKeys = [
    "canonicalComparison", "category", "effects", "evidenceAssessment", "execution", "id", "owner",
    "repeatSafety", "schemaVersion", "sourceEvidence", "sourcePath", "stateDependence", "status", "uncertainties",
  ];
  for (const key of requiredKeys) {
    if (!Object.hasOwn(evidence, key)) fail(`${id}: missing required top-level key ${key}`);
  }
  if (evidence.schemaVersion !== 1) fail(`${id}: schemaVersion must be 1`);
  assertStringFields(evidence, ["category", "owner", "sourcePath"], id);
  if (evidence.status !== "UNRESOLVED") fail(`${id}: status must be UNRESOLVED`);
  assertCommonNarrativeSection(evidence.canonicalComparison, `${id}.canonicalComparison`);
  assertCommonNarrativeSection(evidence.execution, `${id}.execution`);
  assertCommonNarrativeSection(evidence.effects, `${id}.effects`);
  const assessment = asRecord(evidence.evidenceAssessment, `${id}.evidenceAssessment`);
  if (assessment.status !== evidence.status || assessment.status !== "UNRESOLVED") {
    fail(`${id}.evidenceAssessment.status must equal authoritative UNRESOLVED status`);
  }
  assertCommonNarrativeSection({ summary: assessment.summary, details: assessment.details }, `${id}.evidenceAssessment`);
  const state = asRecord(evidence.stateDependence, `${id}.stateDependence`);
  if (state.dependsOnCurrentProductionState !== true) fail(`${id}.stateDependence.dependsOnCurrentProductionState must be true`);
  assertCommonNarrativeSection({ summary: state.summary, details: state.details }, `${id}.stateDependence`);
  assertCommonNarrativeSection(evidence.repeatSafety, `${id}.repeatSafety`);
  nonEmptyStringArray(evidence.uncertainties, `${id}.uncertainties`);
  if (!Array.isArray(evidence.sourceEvidence) || evidence.sourceEvidence.length === 0) {
    fail(`${id}: sourceEvidence must be a non-empty array`);
  }
}

function isCompleteReviewedCoverage(claimed: string, actual: string, pinnedClaim: string | undefined): boolean {
  if (normalizedText(actual) === normalizedText(claimed)) return true;
  if (!pinnedClaim || normalizedText(claimed) !== normalizedText(pinnedClaim)) return false;
  /*
   * A non-exact item is deliberately retained from the independently reviewed
   * pin. It may include a complete template literal or a reviewed surrounding
   * code excerpt while its locator additionally carries line context. The pin
   * makes that exception non-forgeable; arbitrary substrings never qualify.
   */
  return normalizedText(actual).includes(normalizedText(claimed));
}

export function assertSourceEvidence(
  root: string,
  id: string,
  item: unknown,
  pinnedItem?: unknown,
): "exact" | "contained" {
  const evidence = asRecord(item, `${id}: source evidence`);
  const evidencePath = nonEmptyString(evidence.path, `${id}: source evidence path`);
  const absolutePath = path.join(root, evidencePath);
  if (!existsSync(absolutePath)) fail(`${id}: missing evidence path ${evidencePath}`);
  if (!Number.isInteger(evidence.startLine) || !Number.isInteger(evidence.endLine)) {
    fail(`${id}: source evidence lines must be integers`);
  }
  const startLine = Number(evidence.startLine);
  const endLine = Number(evidence.endLine);
  const lines = readFileSync(absolutePath, "utf8").split(/\r?\n/u);
  if (startLine < 1 || endLine < startLine || endLine > lines.length) fail(`${id}: source evidence bounds`);
  const claimed = normalizedText(nonEmptyString(evidence.sqlOrCode, `${id}: sqlOrCode`));
  const actual = normalizedText(citedSlice(root, evidencePath, startLine, endLine));
  if (!actual.includes(claimed)) fail(`${id}: sqlOrCode is not contained in cited source slice`);
  const pinned = pinnedItem === undefined ? undefined : asRecord(pinnedItem, `${id}: pinned source evidence`);
  if (pinned) {
    for (const key of ["path", "startLine", "endLine", "sqlOrCode"]) {
      if (evidence[key] !== pinned[key]) fail(`${id}: source evidence ${key} differs from reviewed pin`);
    }
  }
  const pinnedClaim = pinned && typeof pinned.sqlOrCode === "string" ? pinned.sqlOrCode : undefined;
  if (!isCompleteReviewedCoverage(claimed, actual, pinnedClaim)) {
    fail(`${id}: sqlOrCode must be the complete cited literal or reviewed code excerpt`);
  }
  return actual === claimed ? "exact" : "contained";
}

export function validateAdditionalOperationsEvidence(root: string, data: unknown): SourceEvidenceStatistics {
  if (!Array.isArray(data)) fail("complete evidence: expected array");
  const evidence = data.map((record, index) => {
    asRecord(record, `record ${index}`);
    return record as JsonRecord;
  });
  for (const [index, record] of evidence.entries()) {
    assertEvidenceRecordSchema(record, index);
  }
  const expected = loadPinnedReviewedEvidence(root);
  if (evidence.length !== expected.length) fail("complete evidence: pinned record count mismatch");
  /*
   * This is deliberately a complete deep comparison, not an ID/count-derived
   * expected fixture. The expected narratives come from git-show at the pinned
   * reviewed commit and are SHA-256 verified above.
   */
  if (JSON.stringify(evidence) !== JSON.stringify(expected)) {
    fail("complete evidence: differs from SHA-256-verified reviewed pin");
  }

  const { baseline, crosswalk } = loadRepositoryCrosswalk();
  const byId = new Map(crosswalk.additionalOperations.map((operation) => [operation.id, operation]));
  if (evidence.length !== 110 || byId.size !== 110) fail("complete evidence: expected 110 records");
  if (baseline.owners.length !== 8 || baseline.owners.reduce((total, owner) => total + owner.operations.length, 0) !== 1459) {
    fail("startup baseline: expected 8 owners and 1,459 historical occurrences");
  }
  if (crosswalk.mappings.length !== 1435 || crosswalk.mappings.some((mapping) => mapping.status !== "UNRESOLVED")) {
    fail("startup crosswalk: expected 1,435 UNRESOLVED mappings");
  }
  const seenIds = new Set<string>();
  const expectedById = new Map(expected.map((record) => [String(record.id), record]));
  const statistics: SourceEvidenceStatistics = {
    total: 0, exactClaimedSlice: 0, containedClaimedSlice: 0, containsActualVerbatimExecutableLiteral: 0, invalid: 0,
  };

  for (const record of evidence) {
    const id = String(record.id);
    if (seenIds.has(id)) fail(`${id}: duplicate record id`);
    seenIds.add(id);
    const operation = byId.get(id);
    if (!operation) fail(`${id}: absent from authoritative crosswalk`);
    if (record.owner !== operation.owner || record.sourcePath !== operation.sourcePath
      || record.status !== operation.status || record.category !== operation.category) {
      fail(`${id}: crosswalk-authoritative identity fields differ`);
    }
    const spans = sourceSpans(String(record.sourcePath));
    if (spans.length === 0) fail(`${id}: sourcePath must contain a source span`);
    for (const span of spans) {
      const source = path.join(root, span.file);
      if (!existsSync(source)) fail(`${id}: missing sourcePath file ${span.file}`);
      const lineCount = readFileSync(source, "utf8").split(/\r?\n/u).length;
      if (span.start < 1 || span.end < span.start || span.end > lineCount) fail(`${id}: sourcePath bounds`);
    }
    const pinnedRecord = expectedById.get(id)!;
    const pinnedSourceEvidence = pinnedRecord.sourceEvidence as unknown[];
    for (const [itemIndex, item] of (record.sourceEvidence as unknown[]).entries()) {
      const result = assertSourceEvidence(root, id, item, pinnedSourceEvidence[itemIndex]);
      statistics.total += 1;
      if (result === "exact") statistics.exactClaimedSlice += 1;
      else statistics.containedClaimedSlice += 1;
    }
  }
  if (seenIds.size !== byId.size) fail("complete evidence: missing authoritative crosswalk record");
  return statistics;
}

export function validateIntegrityManifest(root: string, manifestData: unknown): void {
  const manifest = asRecord(manifestData, "verification manifest");
  const inputHashes = asRecord(manifest.inputHashesSha256, "verification manifest.inputHashesSha256");
  const assembledHashes = asRecord(manifest.assembledArtifactHashesSha256, "verification manifest.assembledArtifactHashesSha256");
  for (const file of Object.keys(inputHashes)) {
    if (Object.hasOwn(assembledHashes, file)) {
      fail(`verification manifest duplicate hash declaration: ${file}`);
    }
  }
  const declared = { ...inputHashes, ...assembledHashes };
  const docsDirectory = path.join(root, "docs/additional-operations-evidence");
  const requiredFiles = readdirSync(docsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== "verification.json")
    .map((entry) => entry.name)
    .sort();
  const declaredFiles = Object.keys(declared).sort();
  if (JSON.stringify(declaredFiles) !== JSON.stringify(requiredFiles)) {
    fail(`verification manifest coverage mismatch: expected ${requiredFiles.join(", ")}`);
  }
  if (!Object.hasOwn(declared, "DDL-RESOLUTION-METHODOLOGY.md")) {
    fail("verification manifest must include DDL-RESOLUTION-METHODOLOGY.md");
  }
  for (const file of declaredFiles) {
    const expectedHash = nonEmptyString(declared[file], `verification manifest hash ${file}`);
    const actualHash = createHash("sha256").update(readFileSync(path.join(docsDirectory, file))).digest("hex");
    if (actualHash !== expectedHash) fail(`verification manifest hash mismatch: ${file}`);
  }
  const sourceEvidenceValidation = asRecord(manifest.sourceEvidenceValidation, "verification manifest.sourceEvidenceValidation");
  const evidence = JSON.parse(readFileSync(path.join(docsDirectory, "complete-evidence.json"), "utf8")) as unknown;
  const computed = validateAdditionalOperationsEvidence(root, evidence);
  for (const [key, value] of Object.entries(computed)) {
    if (sourceEvidenceValidation[key] !== value) {
      fail(`verification manifest sourceEvidenceValidation.${key} mismatch`);
    }
  }
}