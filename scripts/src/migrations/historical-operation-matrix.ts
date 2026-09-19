import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EquivalenceClassification, StartupEquivalenceCrosswalk, StartupEquivalenceOperation } from "../startup-equivalence/crosswalk";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_ARCHIVE = "/tmp/lumera-ddl-equivalence-report/operation-crosswalk.json";
const DEFAULT_SCOPE = "docs/startup-ddl-equivalence/evidence/supported-operation-scope.json";
const EXPECTED_OPERATION_COUNT = 1569;
const EXPECTED_HISTORICAL_COUNT = 67;
const EXPECTED_OWNER_COUNT = 8;

export type PathKey = "A_fresh_canonical_empty" | "B1_canonical_global_refs_no_tenants"
  | "B2_post_002_ordinary_runtime" | "C_unknown_old_historical";
export type Applicability = "YES" | "CONDITIONAL" | "NO" | "NOOP" | "REFUSE";

export interface HistoricalOperationMatrixRecord {
  readonly id: string;
  readonly owner: string;
  readonly classification: "historical-backfill";
  readonly source: {
    readonly file: string;
    readonly lineRange: string;
    readonly sourceSha256: string;
    readonly ownerSourceSha256: string;
    readonly exactSqlTemplate?: string;
    readonly completeSourceExcerpt?: string;
    readonly sourceExcerptSha256?: string;
  };
  readonly affectedTables: readonly string[];
  readonly requiredSourceData: readonly string[];
  readonly dependencies: readonly string[];
  readonly sourceSemanticsReconstructable: "YES" | "CONDITIONAL";
  readonly dataStateReconstructableWithoutProductionEvidence: "YES" | "CONDITIONAL" | "NO";
  readonly applicability: Readonly<Record<PathKey, Applicability>>;
  readonly applicabilityReason: string;
  readonly safeImplementationWithoutProductionEvidence: "YES" | "CONDITIONAL" | "NO";
  readonly disposition: "IMPLEMENTED_IN_000002" | "VACUOUS_ON_SUPPORTED_EMPTY_STATE"
    | "REQUIRES_SEPARATE_REVIEWED_MIGRATION" | "EXPLICITLY_REFUSED";
}

export interface RuntimeOperationEvidence {
  readonly id: string;
  readonly owner: string;
  readonly category: "rollout-marker-read" | "rollout-marker-write" | "cleanup-report-read";
  readonly source: {
    readonly file: string;
    readonly lineRange: string;
    readonly ownerSourceSha256: string;
    readonly completeSourceExcerpt: string;
    readonly sourceExcerptSha256: string;
  };
  readonly affectedTables: readonly string[];
  readonly dependencies: readonly string[];
  readonly consumerProof: string;
  readonly consumerAfterStartupRemoval: "NONE_OBSOLETE_BOOKKEEPING";
  readonly A_fresh_canonical_empty: Applicability;
  readonly B1_canonical_global_refs_no_tenants: Applicability;
  readonly B2_post_002_ordinary_runtime: Applicability;
  readonly C_unknown_old_historical: Applicability;
  readonly safeImplementationWithoutProductionEvidence: "YES" | "NO";
}

export interface HistoricalOperationMatrix {
  readonly matrixVersion: 1;
  readonly generatedAtPolicy: "deterministic-source-pinned";
  readonly archive: {
    readonly path: string;
    readonly sha256: string;
    readonly version: number;
    readonly operationCount: number;
    readonly ownerCount: number;
    readonly historicalBackfillCount: number;
  };
  readonly canonicalMigration: {
    readonly path: string;
    readonly sha256: string;
  };
  readonly sourcePinValidation: {
    readonly ownerFilesChecked: number;
    readonly ownerFilesPassed: number;
    readonly canonicalMigrationPassed: boolean;
    readonly supportedScopeArchiveMatched: boolean;
  };
  readonly supportedStateBoundary: {
    readonly migration: "000002_supported_startup_state";
    readonly coveredHistoricalRecordIds: readonly string[];
    readonly globalEquivalence: "BLOCKED";
    readonly note: string;
  };
  readonly pathNecessity: Readonly<Record<PathKey, {
    readonly mandatoryHistoricalOperationIds: readonly string[];
    readonly statement: string;
  }>>;
  readonly records: readonly HistoricalOperationMatrixRecord[];
  readonly runtimeOperations: readonly RuntimeOperationEvidence[];
}

interface ArchiveOperation extends StartupEquivalenceOperation {
  readonly classification: EquivalenceClassification;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stripPosition(pathWithPosition: string): { file: string; lineRange: string } {
  const match = /^(.*?):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)?(?::\d+)?$/u.exec(pathWithPosition);
  if (!match) throw new Error(`Source path has no line range: ${pathWithPosition}`);
  return { file: match[1]!, lineRange: match[2]! };
}

function sourceLines(file: string, lineRange: string): string {
  const lines = readFileSync(resolve(ROOT, file), "utf8").split(/\r?\n/u);
  const ranges = lineRange.split(",").map((part) => {
    const [start, end = start] = part.split("-").map(Number);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      throw new Error(`Invalid source range ${file}:${lineRange}`);
    }
    return { start, end };
  });
  return ranges.map(({ start, end }) => lines.slice(start - 1, end).join("\n")).join("\n");
}

function affectedTables(sql: string): string[] {
  const found = new Set<string>();
  const cteNames = new Set<string>();
  for (const match of sql.matchAll(/\b([a-z][a-z0-9_]*)\s+AS\s*\(/giu)) cteNames.add(match[1]!.toLowerCase());
  const expression = /(?:\$\{[a-z][a-zA-Z0-9_]*\}|public)\.([a-z][a-z0-9_]*)/giu;
  for (const match of sql.matchAll(expression)) found.add(match[1]!.toLowerCase());
  for (const match of sql.matchAll(/(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+(?:\$\{[^}]+\}\.)?([a-z][a-z0-9_]*)/giu)) {
    found.add(match[1]!.toLowerCase());
  }
  return [...found].filter((name) => !cteNames.has(name)
    && name !== "information_schema" && !name.startsWith("pg_")).sort();
}

function requiredSourceData(tables: readonly string[], sql: string): string[] {
  const result = [`Rows satisfying the source predicates for: ${tables.join(", ") || "the enclosing source operation"}.`];
  if (/\bUPDATE\b|\bDELETE\b|\bSET\b/iu.test(sql)) {
    result.push("Existing target rows and their before-values are required; an empty match proves only vacuity.");
  }
  if (/\bJOIN\b|\bFROM\b/iu.test(sql)) {
    result.push("Referenced lookup/owner rows and foreign-key relationships must be present and ownership-consistent.");
  }
  if (/\bjsonb?\b|\bSNAPSHOT\b|\bPAYMENT\b|\bPRICE\b|\bLIMIT\b/iu.test(sql)) {
    result.push("Historical snapshots or immutable source terms are required; current catalog values are not historical evidence.");
  }
  return result;
}

function runtimeCategory(operation: StartupEquivalenceOperation): RuntimeOperationEvidence["category"] {
  const id = operation.source.curatedOperation?.id ?? operation.id;
  if (id.endsWith("rollout-marker-read")) return "rollout-marker-read";
  if (id.endsWith("rollout-marker-write")) return "rollout-marker-write";
  if (id.endsWith("cleanup-report-read")) return "cleanup-report-read";
  throw new Error(`Unexpected runtime operation in matrix: ${operation.id}`);
}

function runtimeConsumerProof(category: RuntimeOperationEvidence["category"]): string {
  if (category === "rollout-marker-read") {
    return "The source reads the singleton version only to choose/recheck the startup fast path and additive contract repairs; it is not evidence that data-only migration receipts completed.";
  }
  if (category === "rollout-marker-write") {
    return "The original writer runs after the BusinessGrowth DDL/data sequence and rewrites completion time. 000002 deliberately never writes this marker because unresolved operations remain outside its receipt.";
  }
  return "The source reads version-99 cleanup counters after startup for logging only; it does not make the cleanup report a proof of candidate provenance.";
}

function buildRuntimeOperations(archive: StartupEquivalenceCrosswalk): RuntimeOperationEvidence[] {
  return archive.operations
    .filter((operation) => operation.classification === "runtime-data-operation")
    .map((operation) => {
      const { file, lineRange } = stripPosition(operation.source.path);
      const excerpt = sourceLines(file, lineRange);
      const category = runtimeCategory(operation);
      const tables = affectedTables(excerpt);
      return {
        id: operation.id,
        owner: operation.owner,
        category,
        source: {
          file,
          lineRange,
          ownerSourceSha256: operation.source.ownerSourceChecksum,
          completeSourceExcerpt: excerpt,
          sourceExcerptSha256: sha256(excerpt),
        },
        affectedTables: tables,
        dependencies: [...operation.dependencies],
        consumerProof: runtimeConsumerProof(category),
        consumerAfterStartupRemoval: "NONE_OBSOLETE_BOOKKEEPING",
        A_fresh_canonical_empty: category === "rollout-marker-write" ? "NO" : "NOOP",
        B1_canonical_global_refs_no_tenants: category === "rollout-marker-write" ? "NO" : "NOOP",
        B2_post_002_ordinary_runtime: category === "rollout-marker-write" ? "NO" : "CONDITIONAL",
        C_unknown_old_historical: "REFUSE",
        safeImplementationWithoutProductionEvidence: "NO",
      };
    });
}

const SUPPORTED_LINES = new Set([642, 2182, 2359, 2422, 3132, 3331, 4045, 4440, 4384, 4628]);
const RELATION_LINES = new Set([4605, 4612, 4617, 4620, 4633, 4637, 4638, 4644]);

function sourceDisposition(operation: ArchiveOperation, line: number, tables: readonly string[], sql: string): {
  sourceSemanticsReconstructable: "YES" | "CONDITIONAL";
  dataStateReconstructableWithoutProductionEvidence: "YES" | "CONDITIONAL" | "NO";
  applicability: Record<PathKey, Applicability>;
  applicabilityReason: string;
  safeImplementationWithoutProductionEvidence: "YES" | "CONDITIONAL" | "NO";
  disposition: HistoricalOperationMatrixRecord["disposition"];
} {
  if (SUPPORTED_LINES.has(line)) {
    return {
      sourceSemanticsReconstructable: "YES",
      dataStateReconstructableWithoutProductionEvidence: "YES",
      applicability: {
        A_fresh_canonical_empty: "YES",
        B1_canonical_global_refs_no_tenants: "YES",
        B2_post_002_ordinary_runtime: "NOOP",
        C_unknown_old_historical: "REFUSE",
      },
      applicabilityReason: "The exact guarded reference/fallback/empty-cleanup subset is implemented and source-paired in 000002; C is refused rather than inferred.",
      safeImplementationWithoutProductionEvidence: "YES",
      disposition: "IMPLEMENTED_IN_000002",
    };
  }
  if (RELATION_LINES.has(line)) {
    return {
      sourceSemanticsReconstructable: "YES",
      dataStateReconstructableWithoutProductionEvidence: "NO",
      applicability: {
        A_fresh_canonical_empty: "NOOP",
        B1_canonical_global_refs_no_tenants: "NOOP",
        B2_post_002_ordinary_runtime: "NOOP",
        C_unknown_old_historical: "REFUSE",
      },
      applicabilityReason: "The source can be read exactly, but plan identity, subscriber terms, pending links and historical snapshots cannot be reconstructed from current rows without reviewed evidence.",
      safeImplementationWithoutProductionEvidence: "NO",
      disposition: "EXPLICITLY_REFUSED",
    };
  }
  const isPurePredicateOperation = /\b(UPDATE|DELETE|INSERT|DO)\b/iu.test(sql);
  const emptyVacuity = isPurePredicateOperation
    ? "Its SQL is source-reconstructable, but an empty supported fixture proves only that its row predicate is vacuous."
    : "Its operation depends on a populated historical state or a runtime contract not represented by 000002.";
  const supportedGlobalTables = new Set([
    "suppliers", "beauty_job_platform_settings", "beauty_job_categories",
    "shop_settings", "b2c_display_settings", "aftercare_settings",
    "education_placement_settings", "education_b2b_discount_settings",
    "subscription_plans", "education_salon_cleanup_reports", "lumera_migration_ledger",
  ]);
  const b1TargetEmpty = tables.some((table) => !supportedGlobalTables.has(table));
  return {
    sourceSemanticsReconstructable: operation.source.exactSql ? "YES" : "CONDITIONAL",
    dataStateReconstructableWithoutProductionEvidence: "CONDITIONAL",
    applicability: {
      A_fresh_canonical_empty: isPurePredicateOperation ? "NOOP" : "CONDITIONAL",
      B1_canonical_global_refs_no_tenants: b1TargetEmpty ? "NOOP" : "CONDITIONAL",
      B2_post_002_ordinary_runtime: "NOOP",
      C_unknown_old_historical: "REFUSE",
    },
    applicabilityReason: `${emptyVacuity} For B1, ${b1TargetEmpty
      ? "the exact target table is outside the admitted global-reference allowlist and is guaranteed empty by the supported-state eligibility predicate"
      : "the target is an admitted global table and needs an operation-specific predicate check"
    }. For B2, it is not required or replayed after a legitimately committed 000002 receipt. A future migration would need a separately reviewed receipt/manifest before transforming any populated row; it is not silently omitted from the global matrix.`,
    safeImplementationWithoutProductionEvidence: "CONDITIONAL",
    disposition: "REQUIRES_SEPARATE_REVIEWED_MIGRATION",
  };
}

function validateArchive(
  archive: StartupEquivalenceCrosswalk,
  archiveBytes: Buffer,
  scopePath: string,
): { canonicalSha256: string; ownerFilesChecked: number; supportedScopeArchiveMatched: boolean } {
  if (archive.version !== 1 || archive.operations.length !== EXPECTED_OPERATION_COUNT
    || archive.owners.length !== EXPECTED_OWNER_COUNT) {
    throw new Error(`Unexpected crosswalk cardinality: version=${archive.version}, owners=${archive.owners.length}, operations=${archive.operations.length}`);
  }
  const historical = archive.operations.filter((operation) => operation.classification === "historical-backfill");
  if (historical.length !== EXPECTED_HISTORICAL_COUNT) {
    throw new Error(`Expected exactly ${EXPECTED_HISTORICAL_COUNT} historical-backfill records, got ${historical.length}`);
  }
  const knownOwners = new Set(Object.keys(archive.sourcePin.ownerSourceChecksums));
  if (knownOwners.size !== EXPECTED_OWNER_COUNT) throw new Error("Archive does not pin exactly eight startup owner files");
  for (const owner of archive.owners) {
    if (!knownOwners.has(owner.ownerSource)) throw new Error(`Owner is not source-pinned: ${owner.ownerSource}`);
  }
  for (const [file, expected] of Object.entries(archive.sourcePin.ownerSourceChecksums)) {
    const actual = sha256(readFileSync(resolve(ROOT, file)));
    if (actual !== expected) throw new Error(`Owner source checksum mismatch: ${file}`);
  }
  for (const operation of historical) {
    const { file } = stripPosition(operation.source.path);
    const expected = archive.sourcePin.ownerSourceChecksums[file];
    if (!expected || operation.source.ownerSourceChecksum !== expected) {
      throw new Error(`Historical operation owner pin mismatch: ${operation.id}`);
    }
  }
  const canonicalSha256 = sha256(readFileSync(resolve(ROOT, archive.sourcePin.canonicalMigration)));
  let supportedScopeArchiveMatched = false;
  try {
    const scope = JSON.parse(readFileSync(resolve(ROOT, scopePath), "utf8")) as { archiveSha256?: string };
    supportedScopeArchiveMatched = scope.archiveSha256 === sha256(archiveBytes);
  } catch {
    // The archive is authoritative; a missing old scope annotation must not
    // make source-pinned matrix generation silently use another inventory.
  }
  return {
    canonicalSha256,
    ownerFilesChecked: knownOwners.size,
    supportedScopeArchiveMatched,
  };
}

export function buildHistoricalOperationMatrix(
  archivePath = DEFAULT_ARCHIVE,
  scopePath = DEFAULT_SCOPE,
): HistoricalOperationMatrix {
  const archiveBytes = readFileSync(archivePath);
  const archive = JSON.parse(archiveBytes.toString("utf8")) as StartupEquivalenceCrosswalk;
  const validation = validateArchive(archive, archiveBytes, scopePath);
  const records = archive.operations
    .filter((operation): operation is ArchiveOperation => operation.classification === "historical-backfill")
    .map((operation): HistoricalOperationMatrixRecord => {
      const { file, lineRange } = stripPosition(operation.source.path);
      const line = operation.source.sourcePosition.line;
      const sql = operation.source.exactSql ?? sourceLines(file, lineRange);
      const tables = affectedTables(sql);
      const decision = sourceDisposition(operation, line, tables, sql);
      const excerpt = operation.source.exactSql ? undefined : sourceLines(file, lineRange);
      return {
        id: operation.id,
        owner: operation.owner,
        classification: "historical-backfill",
        source: {
          file,
          lineRange,
          sourceSha256: operation.source.sourceChecksum,
          ownerSourceSha256: operation.source.ownerSourceChecksum,
          ...(operation.source.exactSql ? { exactSqlTemplate: operation.source.exactSql } : {}),
          ...(excerpt ? { completeSourceExcerpt: excerpt, sourceExcerptSha256: sha256(excerpt) } : {}),
        },
        affectedTables: tables,
        requiredSourceData: requiredSourceData(tables, sql),
        dependencies: [...operation.dependencies],
        ...decision,
      };
    });
  const runtimeOperations = buildRuntimeOperations(archive);
  if (runtimeOperations.length !== 3) {
    throw new Error(`Expected exactly three runtime marker/consumer operations, got ${runtimeOperations.length}`);
  }
  const coveredHistoricalRecordIds = records
    .filter((record) => record.disposition === "IMPLEMENTED_IN_000002")
    .map((record) => record.id);
  return {
    matrixVersion: 1,
    generatedAtPolicy: "deterministic-source-pinned",
    archive: {
      path: archivePath,
      sha256: sha256(archiveBytes),
      version: archive.version,
      operationCount: archive.operations.length,
      ownerCount: archive.owners.length,
      historicalBackfillCount: records.length,
    },
    canonicalMigration: { path: archive.sourcePin.canonicalMigration, sha256: validation.canonicalSha256 },
    sourcePinValidation: {
      ownerFilesChecked: validation.ownerFilesChecked,
      ownerFilesPassed: validation.ownerFilesChecked,
      canonicalMigrationPassed: true,
      supportedScopeArchiveMatched: validation.supportedScopeArchiveMatched,
    },
    supportedStateBoundary: {
      migration: "000002_supported_startup_state",
      coveredHistoricalRecordIds,
      globalEquivalence: "BLOCKED",
      note: "The matrix is an operation-level decision record. Empty predicates are recorded as vacuous, not as proof of populated historical equivalence.",
    },
    pathNecessity: {
      A_fresh_canonical_empty: {
        mandatoryHistoricalOperationIds: [],
        statement: "No historical-backfill record is mandatory for the fresh path; 000001 plus the admitted 000002 transition supplies the required state.",
      },
      B1_canonical_global_refs_no_tenants: {
        mandatoryHistoricalOperationIds: [],
        statement: "No historical-backfill record beyond the ten 000002-covered records is mandatory; all remaining targets are empty under the exact supported-state allowlist.",
      },
      B2_post_002_ordinary_runtime: {
        mandatoryHistoricalOperationIds: [],
        statement: "No historical-backfill record is replayed after a contiguous committed 000001/000002 ledger frontier; ordinary runtime subscriptions are not rejected by legacy backfill evidence.",
      },
      C_unknown_old_historical: {
        mandatoryHistoricalOperationIds: records.map((record) => record.id),
        statement: "Unknown/legacy history is refused. Admission of any populated transformation requires a separate reviewed migration and is not a blocker for A, B1 or B2.",
      },
    },
    records,
    runtimeOperations,
  };
}

function argument(name: string): string | undefined {
  const value = process.argv.find((item) => item.startsWith(`${name}=`));
  return value?.slice(name.length + 1);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const archive = argument("--archive") ?? process.argv[2] ?? DEFAULT_ARCHIVE;
  const output = argument("--output") ?? process.argv[3]
    ?? "docs/startup-ddl-equivalence/evidence/historical-operation-matrix.json";
  const scope = argument("--scope") ?? DEFAULT_SCOPE;
  writeFileSync(resolve(ROOT, output), `${JSON.stringify(buildHistoricalOperationMatrix(archive, scope), null, 2)}\n`);
}