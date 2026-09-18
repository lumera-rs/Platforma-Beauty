import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  ADDITIONAL_STARTUP_OPERATIONS,
  loadRepositoryCrosswalk,
  PINNED_STARTUP_OWNER_SOURCE_CHECKSUMS,
  type AdditionalStartupOperation,
  type CrosswalkOccurrence,
  type ObjectIdentity,
  type StartupMigrationCrosswalk,
} from "../startup-migration-crosswalk";
import {
  checkRealRepositoryProductionStartupDdlInventory,
  type StartupDdlBaseline,
} from "../production-startup-ddl-inventory";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const STARTUP_ROOT = "artifacts/api-server/src/index.ts";
const VERSION = 1 as const;

export type EquivalenceClassification =
  | "schema-ddl"
  | "historical-backfill"
  | "function-trigger-replacement"
  | "runtime-data-operation"
  | "operational-scaffolding"
  | "test-only-setup";

export interface ConditionalExecution {
  readonly branchDependent: boolean;
  readonly predicates: readonly string[];
  readonly branchKinds: readonly string[];
  readonly staticOrder: "source-order";
  readonly actualBranchOrder: "UNKNOWN";
  readonly note: string;
}

export interface RepeatBehavior {
  readonly status: "UNPROVEN";
  readonly sourceSignals: readonly string[];
  readonly note: string;
}

export interface MigrationCoverage {
  readonly status: "UNRESOLVED";
  readonly canonicalCandidate: {
    readonly migrationId: "000001";
    readonly lineReferences: readonly string[];
    readonly nameMatch: "candidate-name-match" | "no-candidate-name-match";
    readonly semanticsVerified: false;
  };
  readonly replacementRequirement: string;
}

export interface OperationSource {
  readonly path: string;
  readonly ownerSourceChecksum: string;
  readonly sourceChecksum: string;
  readonly function: string;
  readonly executionPath: readonly string[];
  readonly phase?: "pre-listen" | "post-listen";
  readonly exactSql?: string;
  readonly curatedOperation?: {
    readonly id: string;
    readonly category: string;
    readonly summary: string;
  };
  readonly sourcePosition: {
    readonly line: number;
    readonly column: number;
  };
}

export interface StartupEquivalenceOperation {
  readonly id: string;
  readonly owner: string;
  readonly classification: EquivalenceClassification;
  readonly objectIdentity?: ObjectIdentity;
  readonly dependencies: readonly string[];
  readonly source: OperationSource;
  readonly staticExecutionOrder: number;
  readonly conditionalExecution: ConditionalExecution;
  readonly repeatBehavior: RepeatBehavior;
  readonly migrationCoverage: MigrationCoverage;
  readonly testOnlySetup: {
    readonly status: "SHARED_OWNER_WITH_TEST_CALLERS" | "NO_TEST_CALLER_FOUND";
    readonly evidencePaths: readonly string[];
    readonly note: string;
  };
}

export interface StartupEquivalenceOwner {
  readonly owner: string;
  readonly ownerSource: string;
  readonly ownerSourceChecksum: string;
  readonly callSite?: string;
  readonly phase?: "pre-listen" | "post-listen";
  readonly executionPath: readonly string[];
  readonly transitiveSourceModules: readonly string[];
  readonly operationCount: number;
}

export interface StartupEquivalenceCrosswalk {
  readonly version: typeof VERSION;
  readonly startupRoot: typeof STARTUP_ROOT;
  readonly sourcePin: {
    readonly inventory: "scripts/src/production-startup-ddl-baseline.json";
    readonly canonicalMigration: "lib/db/migrations/000001_canonical_schema/migration.sql";
    readonly ownerSourceChecksums: Readonly<Record<string, string>>;
  };
  readonly owners: readonly StartupEquivalenceOwner[];
  readonly operations: readonly StartupEquivalenceOperation[];
  readonly counts: {
    readonly ownerCount: number;
    readonly operationCount: number;
    readonly ddlOperationCount: number;
    readonly additionalOperationCount: number;
    readonly unresolvedCount: number;
    readonly conditionalOperationCount: number;
  };
}

interface SourceContext {
  readonly source: string;
  readonly sourceFile: ts.SourceFile;
  readonly functionName: string;
  readonly conditionalExecution: ConditionalExecution;
}

interface ParsedSource {
  readonly source: string;
  readonly sourceFile: ts.SourceFile;
  readonly nodes: readonly ts.Node[];
  readonly exactNodes: ReadonlyMap<string, ts.Node>;
}

const parsedSourceCache = new Map<string, ParsedSource>();

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function lineColumn(sourceFile: ts.SourceFile, node: ts.Node): { line: number; column: number } {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: position.line + 1, column: position.character + 1 };
}

function expressionText(sourceFile: ts.SourceFile, expression: ts.Expression | undefined): string {
  return expression ? expression.getText(sourceFile).replace(/\s+/gu, " ").trim() : "<unknown>";
}

function sourceNodeAt(
  sourceFile: ts.SourceFile,
  line: number,
  column?: number,
): ts.Node | undefined {
  const target = sourceFile.getPositionOfLineAndCharacter(Math.max(0, line - 1), Math.max(0, (column ?? 1) - 1));
  let best: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    if (start <= target && target <= end) {
      if (!best || node.getWidth(sourceFile) < best.getWidth(sourceFile)) best = node;
      ts.forEachChild(node, visit);
    }
  };
  visit(sourceFile);
  return best;
}

function parsedSource(sourcePath: string): ParsedSource {
  const cached = parsedSourceCache.get(sourcePath);
  if (cached) return cached;
  const source = readFileSync(path.join(REPOSITORY_ROOT, sourcePath), "utf8");
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
  const nodes: ts.Node[] = [];
  const exactNodes = new Map<string, ts.Node>();
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateExpression(node)) {
      nodes.push(node);
      const position = lineColumn(sourceFile, node);
      exactNodes.set(`${position.line}:${position.column}`, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const parsed = { source, sourceFile, nodes, exactNodes };
  parsedSourceCache.set(sourcePath, parsed);
  return parsed;
}

function contextAt(sourcePath: string, line: number, column?: number): SourceContext {
  const parsed = parsedSource(sourcePath);
  const source = parsed.source;
  const sourceFile = parsed.sourceFile;
  const target = sourceFile.getPositionOfLineAndCharacter(
    Math.max(0, line - 1),
    Math.max(0, (column ?? 1) - 1),
  );
  const node = (column ? parsed.exactNodes.get(`${line}:${column}`) : undefined)
    ?? parsed.nodes
      .filter((candidate) => candidate.getStart(sourceFile) <= target && target <= candidate.getEnd())
      .sort((left, right) => left.getWidth(sourceFile) - right.getWidth(sourceFile))[0]
    ?? sourceNodeAt(sourceFile, line, column);
  const predicates: string[] = [];
  const branchKinds: string[] = [];
  let functionName = "<module>";
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)
      || ts.isFunctionExpression(current) || ts.isArrowFunction(current)) {
      functionName = current.name?.getText(sourceFile) ?? functionName;
    } else if (ts.isIfStatement(current)) {
      predicates.push(`if (${expressionText(sourceFile, current.expression)})`);
      branchKinds.push(current.thenStatement === current.parent ? "then" : "conditional");
    } else if (ts.isConditionalExpression(current)) {
      predicates.push(`condition (${expressionText(sourceFile, current.condition)})`);
      branchKinds.push("conditional-expression");
    } else if (ts.isSwitchStatement(current)) {
      predicates.push(`switch (${expressionText(sourceFile, current.expression)})`);
      branchKinds.push("switch");
    } else if (ts.isCaseClause(current)) {
      predicates.push(`case (${expressionText(sourceFile, current.expression)})`);
      branchKinds.push("case");
    } else if (ts.isDefaultClause(current)) {
      predicates.push("default case");
      branchKinds.push("default");
    } else if (ts.isForStatement(current)) {
      predicates.push(`for (${current.condition ? expressionText(sourceFile, current.condition) : "<condition>"})`);
      branchKinds.push("loop");
    } else if (ts.isForInStatement(current) || ts.isForOfStatement(current)) {
      predicates.push(`loop (${current.expression.getText(sourceFile).replace(/\s+/gu, " ").trim()})`);
      branchKinds.push("loop");
    } else if (ts.isWhileStatement(current) || ts.isDoStatement(current)) {
      predicates.push(`loop (${expressionText(sourceFile, current.expression)})`);
      branchKinds.push("loop");
    } else if (ts.isCatchClause(current)) {
      predicates.push(`catch (${current.variableDeclaration?.getText(sourceFile) ?? "<error>"})`);
      branchKinds.push("catch");
    } else if (ts.isTryStatement(current)) {
      predicates.push("try/finally");
      branchKinds.push("try");
    }
    current = current.parent;
  }
  predicates.reverse();
  branchKinds.reverse();
  return {
    source,
    sourceFile,
    functionName,
    conditionalExecution: {
      branchDependent: predicates.length > 0,
      predicates,
      branchKinds,
      staticOrder: "source-order",
      actualBranchOrder: "UNKNOWN",
      note: predicates.length > 0
        ? "Source order is known; runtime order depends on branch predicates and data."
        : "Source order is known; runtime scheduling and failure behavior are not proven here.",
    },
  };
}

function ownerSourceChecksum(sourcePath: string): string {
  const expected = PINNED_STARTUP_OWNER_SOURCE_CHECKSUMS[sourcePath];
  if (!expected) throw new Error(`Missing independent source pin for ${sourcePath}`);
  const actual = hash(readFileSync(path.join(REPOSITORY_ROOT, sourcePath), "utf8"));
  if (actual !== expected) throw new Error(`Startup owner source checksum mismatch: ${sourcePath}`);
  return expected;
}

function sourcePositionPath(sourcePath: string, line: number, column: number): string {
  return `${sourcePath}:${line}:${column}`;
}

function sourceSignals(sql: string): string[] {
  const normalized = sql.replace(/\s+/gu, " ").trim().toUpperCase();
  const signals: string[] = [];
  if (/\bIF\s+NOT\s+EXISTS\b/u.test(normalized)) signals.push("IF NOT EXISTS");
  if (/\bIF\s+EXISTS\b/u.test(normalized)) signals.push("IF EXISTS");
  if (/\bCREATE\s+OR\s+REPLACE\b/u.test(normalized)) signals.push("CREATE OR REPLACE");
  if (/\bON\s+CONFLICT\b/u.test(normalized)) signals.push("ON CONFLICT");
  return signals;
}

function repeatBehavior(sql: string | undefined, classification: EquivalenceClassification): RepeatBehavior {
  return {
    status: "UNPROVEN",
    sourceSignals: sql ? sourceSignals(sql) : [],
    note: classification === "operational-scaffolding"
      ? "Lock, timeout, transaction, and cleanup behavior is reported separately; repeat safety is not inferred."
      : "Source syntax is recorded as a signal only; idempotency and existing-data effects require independent migration proof.",
  };
}

function classificationForAdditional(operation: AdditionalStartupOperation): EquivalenceClassification {
  switch (operation.category) {
    case "data-backfill": return "historical-backfill";
    case "function-replacement": return "function-trigger-replacement";
    case "operational-scaffolding": return "operational-scaffolding";
    case "cleanup-reporting":
    case "rollout-marker":
      return "runtime-data-operation";
  }
}

function migrationCoverage(
  mapping: StartupMigrationCrosswalk["mappings"][number],
): MigrationCoverage {
  return {
    status: "UNRESOLVED",
    canonicalCandidate: {
      migrationId: "000001",
      lineReferences: mapping.evidence.lineReferences,
      nameMatch: mapping.evidence.evidenceType,
      semanticsVerified: false,
    },
    replacementRequirement: "A separately reviewed numbered migration or explicit retention decision is required; object-name presence is not equivalence.",
  };
}

function additionalMigrationCoverage(): MigrationCoverage {
  return {
    status: "UNRESOLVED",
    canonicalCandidate: {
      migrationId: "000001",
      lineReferences: [],
      nameMatch: "no-candidate-name-match",
      semanticsVerified: false,
    },
    replacementRequirement: "A separately reviewed numbered migration or explicit runtime-retention justification is required.",
  };
}

function testCallerEvidence(owner: string): string[] {
  const roots = [
    path.join(REPOSITORY_ROOT, "artifacts/api-server/src"),
    path.join(REPOSITORY_ROOT, "scripts/src"),
  ];
  const result: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        const source = readFileSync(full, "utf8");
        if (new RegExp(`\\b${owner}\\b`, "u").test(source)) {
          result.push(path.relative(REPOSITORY_ROOT, full).replaceAll(path.sep, "/"));
        }
      }
    }
  };
  for (const root of roots) if (statSync(root).isDirectory()) visit(root);
  return result.sort();
}

function operationSource(
  owner: string,
  ownerPath: string,
  occurrence: CrosswalkOccurrence,
): OperationSource & { readonly context: SourceContext } {
  const context = contextAt(ownerPath, occurrence.sourcePosition.literalLine, occurrence.sourcePosition.literalColumn);
  return {
    context,
    path: sourcePositionPath(ownerPath, occurrence.sourcePosition.literalLine, occurrence.sourcePosition.literalColumn),
    ownerSourceChecksum: ownerSourceChecksum(ownerPath),
    sourceChecksum: occurrence.sourceSqlChecksum,
    function: context.functionName === "<module>" ? owner : context.functionName,
    executionPath: occurrence.executionPath,
    ...(occurrence.phase ? { phase: occurrence.phase } : {}),
    exactSql: occurrence.sourceSql,
    sourcePosition: {
      line: occurrence.sourcePosition.literalLine,
      column: occurrence.sourcePosition.literalColumn,
    },
  };
}

function additionalSource(
  operation: AdditionalStartupOperation,
): OperationSource & { readonly context: SourceContext } {
  const [sourcePath, range] = operation.sourcePath.split(":");
  const line = Number(range?.split("-")[0] ?? "1");
  const context = contextAt(sourcePath!, line);
  const sourceText = context.source;
  const excerpt = sourceExcerpt(sourceText, range ?? String(line));
  const exactSql = operation.sourceSql;
  return {
    context,
    path: operation.sourcePath,
    ownerSourceChecksum: ownerSourceChecksum(sourcePath!),
    sourceChecksum: exactSql ? operation.sourceSqlChecksum! : hash(excerpt),
    function: context.functionName === "<module>" ? operation.owner : context.functionName,
    executionPath: [STARTUP_ROOT, `${sourcePath}::${context.functionName}`],
    ...(exactSql ? { exactSql } : {
      curatedOperation: {
        id: operation.id,
        category: operation.category,
        summary: operation.summary,
      },
    }),
    sourcePosition: {
      line,
      column: operation.sourcePosition?.column ?? 1,
    },
  };
}

function operationTestSetup(owner: string, evidence: ReadonlyMap<string, readonly string[]>): StartupEquivalenceOperation["testOnlySetup"] {
  const paths = evidence.get(owner) ?? [];
  return paths.length > 0
    ? {
      status: "SHARED_OWNER_WITH_TEST_CALLERS",
      evidencePaths: paths,
      note: "The owner is production-reachable and also referenced by tests; this operation is not classified as test-only.",
    }
    : {
      status: "NO_TEST_CALLER_FOUND",
      evidencePaths: [],
      note: "No test caller was found in scanned test sources; absence is not proof of absence elsewhere.",
    };
}

function sortOperations(left: StartupEquivalenceOperation, right: StartupEquivalenceOperation): number {
  return left.owner.localeCompare(right.owner)
    || left.staticExecutionOrder - right.staticExecutionOrder
    || left.source.path.localeCompare(right.source.path)
    || left.id.localeCompare(right.id);
}

function deriveStartupEquivalenceCrosswalk(): StartupEquivalenceCrosswalk {
  const { baseline, crosswalk } = loadRepositoryCrosswalk();
  assertIndependentInventory(baseline, crosswalk);
  const testEvidence = new Map(
    baseline.owners.map((owner) => [owner.ensureName, testCallerEvidence(owner.ensureName)] as const),
  );
  const operations: StartupEquivalenceOperation[] = [];
  for (const mapping of crosswalk.mappings) {
    for (const occurrence of mapping.occurrences) {
      const source = operationSource(
        occurrence.owner,
        occurrence.sourcePath.split(":")[0]!,
        occurrence,
      );
      const { context, ...sourceRecord } = source;
      operations.push({
        id: `ddl/${occurrence.owner}/${occurrence.executionOrder}/${mapping.fingerprint}`,
        owner: occurrence.owner,
        classification: "schema-ddl",
        objectIdentity: mapping.objectIdentity,
        dependencies: mapping.dependencies,
        source: sourceRecord,
        staticExecutionOrder: occurrence.executionOrder,
        conditionalExecution: context.conditionalExecution,
        repeatBehavior: repeatBehavior(source.exactSql, "schema-ddl"),
        migrationCoverage: migrationCoverage(mapping),
        testOnlySetup: operationTestSetup(occurrence.owner, testEvidence),
      });
    }
  }
  for (const additional of crosswalk.additionalOperations) {
    const source = additionalSource(additional);
    const { context, ...sourceRecord } = source;
    const classification = classificationForAdditional(additional);
    operations.push({
      id: `additional/${additional.id}`,
      owner: additional.owner,
      classification,
      ...(additional.objectIdentity ? { objectIdentity: additional.objectIdentity } : {}),
      dependencies: additional.dependencies,
      source: sourceRecord,
      staticExecutionOrder: additional.sourcePosition?.executionOrder ?? Number.MAX_SAFE_INTEGER,
      conditionalExecution: context.conditionalExecution,
      repeatBehavior: repeatBehavior(source.exactSql, classification),
      migrationCoverage: additionalMigrationCoverage(),
      testOnlySetup: operationTestSetup(additional.owner, testEvidence),
    });
  }
  operations.sort(sortOperations);
  const owners = baseline.owners.map((owner) => {
    const ownerOperations = operations.filter((operation) => operation.owner === owner.ensureName);
    return {
      owner: owner.ensureName,
      ownerSource: owner.ownerModule,
      ownerSourceChecksum: ownerSourceChecksum(owner.ownerModule),
      ...(owner.callSite ? { callSite: owner.callSite } : {}),
      ...(owner.phase ? { phase: owner.phase } : {}),
      executionPath: owner.path ?? [STARTUP_ROOT, `${owner.ownerModule}::${owner.ensureName}`],
      transitiveSourceModules: [...new Set(owner.operations.map((operation) => operation.module))].sort(),
      operationCount: ownerOperations.length,
    };
  });
  const conditionalOperationCount = operations.filter((operation) => operation.conditionalExecution.branchDependent).length;
  const result: StartupEquivalenceCrosswalk = {
    version: VERSION,
    startupRoot: STARTUP_ROOT,
    sourcePin: {
      inventory: "scripts/src/production-startup-ddl-baseline.json",
      canonicalMigration: "lib/db/migrations/000001_canonical_schema/migration.sql",
      ownerSourceChecksums: { ...PINNED_STARTUP_OWNER_SOURCE_CHECKSUMS },
    },
    owners,
    operations,
    counts: {
      ownerCount: owners.length,
      operationCount: operations.length,
      ddlOperationCount: operations.filter((operation) => operation.classification === "schema-ddl").length,
      additionalOperationCount: operations.filter((operation) => operation.id.startsWith("additional/")).length,
      unresolvedCount: operations.filter((operation) => operation.migrationCoverage.status === "UNRESOLVED").length,
      conditionalOperationCount,
    },
  };
  return result;
}

export function buildStartupEquivalenceCrosswalk(): StartupEquivalenceCrosswalk {
  // Always derive from pinned repository sources, never an operator document.
  return deriveStartupEquivalenceCrosswalk();
}

function excerptChecksum(sourcePath: string, range: string): string {
  const source = readFileSync(path.join(REPOSITORY_ROOT, sourcePath), "utf8");
  return hash(sourceExcerpt(source, range));
}

function sourceExcerpt(source: string, ranges: string): string {
  const lines = source.split(/\r?\n/u);
  return ranges.split(",").map((range) => {
    if (!/^[1-9]\d*(?:-[1-9]\d*)?$/.test(range)) throw new Error("Invalid curated source range");
    const [first, end] = range.split("-").map(Number);
    const last = end ?? first!;
    if (last < first! || last > lines.length) throw new Error("Curated source range is outside source");
    return lines.slice(first! - 1, last).join("\n");
  }).join("\n");
}

export function validateStartupEquivalenceCrosswalk(
  crosswalk: StartupEquivalenceCrosswalk,
): void {
  if (crosswalk.version !== VERSION || crosswalk.startupRoot !== STARTUP_ROOT) {
    throw new Error("Unsupported startup equivalence crosswalk identity");
  }
  const pinnedPaths = Object.keys(PINNED_STARTUP_OWNER_SOURCE_CHECKSUMS).sort();
  if (JSON.stringify(Object.keys(crosswalk.sourcePin.ownerSourceChecksums).sort()) !== JSON.stringify(pinnedPaths)) {
    throw new Error("Startup equivalence owner source pin set changed");
  }
  for (const sourcePath of pinnedPaths) {
    if (crosswalk.sourcePin.ownerSourceChecksums[sourcePath] !== PINNED_STARTUP_OWNER_SOURCE_CHECKSUMS[sourcePath]) {
      throw new Error(`Startup equivalence owner source pin changed: ${sourcePath}`);
    }
    ownerSourceChecksum(sourcePath);
  }
  const ids = new Set<string>();
  for (const [index, operation] of crosswalk.operations.entries()) {
    if (ids.has(operation.id)) throw new Error(`Duplicate startup equivalence operation: ${operation.id}`);
    ids.add(operation.id);
    if (operation.migrationCoverage.status !== "UNRESOLVED"
      || operation.migrationCoverage.canonicalCandidate.semanticsVerified !== false) {
      throw new Error(`Startup equivalence operation is not unresolved: ${operation.id}`);
    }
    if (operation.staticExecutionOrder < 1
      || operation.source.ownerSourceChecksum !== PINNED_STARTUP_OWNER_SOURCE_CHECKSUMS[operation.source.path.split(":")[0]!]) {
      throw new Error(`Startup equivalence source pin mismatch: ${operation.id}`);
    }
    if (index > 0 && sortOperations(crosswalk.operations[index - 1]!, operation) > 0) {
      throw new Error(`Startup equivalence operation order is not deterministic: ${operation.id}`);
    }
    const [sourcePath, range] = operation.source.path.split(":");
    if (operation.source.exactSql !== undefined) {
      if (hash(operation.source.exactSql) !== operation.source.sourceChecksum) {
        throw new Error(`Exact startup SQL checksum mismatch: ${operation.id}`);
      }
    } else if (operation.source.curatedOperation && range) {
      if (excerptChecksum(sourcePath!, range) !== operation.source.sourceChecksum) {
        throw new Error(`Curated startup operation excerpt checksum mismatch: ${operation.id}`);
      }
    } else {
      throw new Error(`Startup operation lacks exact SQL or curated operation: ${operation.id}`);
    }
  }
  const actualCounts = {
    operationCount: crosswalk.operations.length,
    ddlOperationCount: crosswalk.operations.filter((operation) => operation.classification === "schema-ddl").length,
    additionalOperationCount: crosswalk.operations.filter((operation) => operation.id.startsWith("additional/")).length,
    unresolvedCount: crosswalk.operations.filter((operation) => operation.migrationCoverage.status === "UNRESOLVED").length,
    conditionalOperationCount: crosswalk.operations.filter((operation) => operation.conditionalExecution.branchDependent).length,
  };
  for (const [key, value] of Object.entries(actualCounts)) {
    if (crosswalk.counts[key as keyof typeof actualCounts] !== value) {
      throw new Error(`Startup equivalence count mismatch: ${key}`);
    }
  }
  if (crosswalk.counts.ownerCount !== crosswalk.owners.length
    || crosswalk.counts.unresolvedCount !== crosswalk.counts.operationCount) {
    throw new Error("Startup equivalence metadata does not reconcile");
  }
  // Checksums of a supplied string do not establish that it came from source.
  // Match the complete record, including narrative, to repository derivation.
  if (JSON.stringify(crosswalk) !== JSON.stringify(deriveStartupEquivalenceCrosswalk())) {
    throw new Error("Startup equivalence records differ from pinned repository derivation");
  }
}

function assertIndependentInventory(
  baseline: StartupDdlBaseline,
  crosswalk: StartupMigrationCrosswalk,
): void {
  const report = checkRealRepositoryProductionStartupDdlInventory(REPOSITORY_ROOT, baseline);
  if (report.violations.length > 0 || !report.matchesBaseline) {
    throw new Error(`Independent startup inventory rejected:\n${report.violations
      .map((violation) => `- ${violation.reason}: ${violation.detail}`).join("\n")}`);
  }
  const expectedDdlOccurrences = crosswalk.mappings.reduce((total, mapping) => total + mapping.occurrences.length, 0);
  if (expectedDdlOccurrences !== report.owners.reduce((total, owner) => total + owner.operations.length, 0)) {
    throw new Error("Crosswalk DDL occurrence count does not match independent inventory");
  }
}

export function writeStartupEquivalenceCrosswalk(outputPath: string): StartupEquivalenceCrosswalk {
  const crosswalk = buildStartupEquivalenceCrosswalk();
  writeFileSync(outputPath, `${JSON.stringify(crosswalk, null, 2)}\n`, "utf8");
  return crosswalk;
}

function main(): void {
  const outputIndex = process.argv.indexOf("--output");
  const outputEquals = process.argv.find((argument) => argument.startsWith("--output="));
  const outputPath = outputEquals?.slice("--output=".length)
    ?? (outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined);
  const crosswalk = buildStartupEquivalenceCrosswalk();
  const json = `${JSON.stringify(crosswalk, null, 2)}\n`;
  if (outputPath) writeFileSync(outputPath, json, "utf8");
  else process.stdout.write(json);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();