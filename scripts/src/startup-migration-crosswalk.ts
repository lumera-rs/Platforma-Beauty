import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { loadReviewedHistoricalSources, reviewedHistoricalSource } from "./reviewed-historical-source";
import type {
  DdlOperation,
  StartupDdlBaseline,
} from "./production-startup-ddl-inventory";

export const CANONICAL_MIGRATION_ID = "000001";
export const CANONICAL_MIGRATION_CHECKSUM =
  "643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60";
export const CROSSWALK_VERSION = 1;

export type MappingStatus =
  | "CANONICAL_BASELINE"
  | "FUTURE_MIGRATION_REQUIRED"
  | "RETIRED_HISTORICAL"
  | "UNRESOLVED";

export type ExistingDataEffect =
  | "fresh-and-existing-idempotent"
  | "existing-schema-reconciliation"
  | "existing-data-mutation"
  | "read-only-observation"
  | "operational-scaffolding";

export interface ObjectIdentity {
  readonly kind: string;
  readonly schema: string;
  readonly name: string;
  readonly parent?: string;
  readonly dynamicExpression?: string;
}

export interface CrosswalkOccurrence {
  readonly owner: string;
  readonly sourcePath: string;
  /** Exact position of the executable literal and operation in its owner source. */
  readonly sourcePosition: {
    readonly literalLine: number;
    readonly literalColumn: number;
    readonly operationLine: number;
    readonly operationColumn: number;
  };
  /**
   * The complete executable SQL literal, not the inventory's intentionally
   * shortened operation summary.  This preserves e.g. ALTER TYPE RENAME VALUE
   * semantics which are not represented by the historical inventory pattern.
   */
  readonly sourceSql: string;
  readonly sourceSqlChecksum: string;
  /** Source-order ordinal within this startup owner. */
  readonly executionOrder: number;
  readonly callSite?: string;
  readonly phase?: "pre-listen" | "post-listen";
  readonly executionPath: readonly string[];
}

export interface CanonicalCandidateEvidence {
  readonly migrationId: typeof CANONICAL_MIGRATION_ID;
  readonly migrationChecksum: string;
  readonly evidenceType: "candidate-name-match" | "no-candidate-name-match";
  readonly lineReferences: readonly string[];
  readonly semanticsVerified: boolean;
}

export interface StartupMigrationMapping {
  readonly fingerprint: string;
  readonly operationKind: string;
  readonly summary: string;
  readonly objectIdentity: ObjectIdentity;
  readonly existingDataEffect: ExistingDataEffect;
  readonly status: MappingStatus;
  readonly evidence: CanonicalCandidateEvidence;
  readonly dependencies: readonly string[];
  readonly preconditions: readonly string[];
  readonly postconditions: readonly string[];
  readonly rollbackConsiderations: readonly string[];
  readonly resolutionReason: string;
  readonly occurrences: readonly CrosswalkOccurrence[];
}

export type AdditionalOperationCategory =
  | "data-backfill"
  | "function-replacement"
  | "cleanup-reporting"
  | "rollout-marker"
  | "operational-scaffolding";

export interface AdditionalStartupOperation {
  readonly id: string;
  readonly owner: string;
  readonly sourcePath: string;
  readonly category: AdditionalOperationCategory;
  readonly summary: string;
  readonly objectIdentity?: ObjectIdentity;
  readonly existingDataEffect: ExistingDataEffect;
  readonly dependencies: readonly string[];
  readonly preconditions: readonly string[];
  readonly postconditions: readonly string[];
  readonly rollbackConsiderations: readonly string[];
  readonly status: "UNRESOLVED";
  readonly reason: string;
  /** Present for automatically discovered executable SQL. */
  readonly sourceSql?: string;
  readonly sourceSqlChecksum?: string;
  readonly sourcePosition?: {
    readonly line: number;
    readonly column: number;
    readonly executionOrder: number;
  };
}

/**
 * Independently pinned coverage floor.  These values deliberately do not
 * derive from the live discovery result; any source edit that changes the
 * executable-SQL census must update this reviewed fixture explicitly.
 */
export const PINNED_ADDITIONAL_OPERATION_COVERAGE = Object.freeze({
  total: 110,
  byOwner: Object.freeze({
    ensureBusinessGrowthSchema: 98,
    ensureMediaSchema: 1,
    ensureShippingConfigSchema: 1,
    ensureMarketplacePerformanceIndexes: 1,
    ensureReferralSchema: 2,
    ensureWebPushSchema: 2,
    ensureBookingCommandSchema: 1,
    ensureEducationBundlePurchaseSchema: 4,
  }),
});

/** Pinned independently of curated grouping; includes every executable literal. */
export const PINNED_EXECUTABLE_STARTUP_SQL_LITERALS = Object.freeze({
  total: 103,
  functionReplacements: 33,
  dataMutations: 70,
  byOwner: Object.freeze({
    ensureBusinessGrowthSchema: 96,
    ensureShippingConfigSchema: 1,
    ensureReferralSchema: 1,
    ensureWebPushSchema: 1,
    ensureEducationBundlePurchaseSchema: 4,
  }),
});

/**
 * The complete startup-owner sources are independently pinned as a last line
 * of defence.  A new query cannot become invisible merely because its verb is
 * not yet understood by the SQL classifier: it changes this reviewed source
 * census and validation fails until the review pins are deliberately updated.
 */
export const PINNED_STARTUP_OWNER_SOURCE_CHECKSUMS: Readonly<Record<string, string>> = Object.freeze({
  "artifacts/api-server/src/lib/business-growth-schema.ts": "000e7e2b564e450c6a16808bab372871c721d5faf9cd50d702cd76c90e573b30",
  "artifacts/api-server/src/lib/media-schema.ts": "313ca81d6c08c7ca75973173d1ffa5b7b7a2fe47877f98a1ded3de0781d7cfe0",
  "artifacts/api-server/src/lib/shipping-config.ts": "65bd907013564ae640dfce6c63c7c093ef42208d3ec262433a38b499c5a1bc1b",
  "artifacts/api-server/src/lib/marketplace-performance-schema.ts": "892f271abcee6b6e20c2fcd4a38c17e53e3c7a78aaa19e363647e485036b890b",
  "artifacts/api-server/src/lib/referral-schema.ts": "9a93ccf452ed78869a970bf5fe3d2878eeacdf878ceace07131efdefa675a9e5",
  "artifacts/api-server/src/lib/web-push-schema.ts": "5a27699abeebda158e129c120fb7380f1f362c16637e602e7d246ffe89efd051",
  "artifacts/api-server/src/lib/booking-command-schema.ts": "c2609996bf939510960ffb228248cf9463465ad3875b291907c85ba4c6f8566b",
  "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts": "53cb4b3499f1bb369a9be3a50a45cfda7813d9c2d4a9ad4f481f75d97e8f5017",
});

/** Exact executable-literal cardinality represented by each grouped curation. */
const PINNED_CURATED_LITERAL_COUNTS: Readonly<Record<string, number>> = Object.freeze({
  "business-growth/bundle-payment-backfill": 2,
  "education-bundle/payment-reference-backfill": 2,
});

/**
 * Review-owned, byte-exact excerpts.  These are intentionally literals rather
 * than hashes generated from the current source: a same-category rewrite must
 * receive an explicit new review pin.
 */
const PINNED_CURATED_SOURCE_EXCERPT_CHECKSUMS: Readonly<Record<string, string>> = Object.freeze({
  "business-growth/advisory-lock-and-session-state": "bb0a415fec787c41cf88dadf3c245e35f523ecf56cef15f140bcf37c8d5aae97",
  "business-growth/rollout-marker-read": "77a447c9dd20e739ba60bbb32aa961f2652cb8dd02f0d38405f655581e49bea9",
  "business-growth/gift-voucher-immutability-function": "3148807af8e544290d570c3e7041227c0bb6cb303e6c724ae69ad4f6ce43dbfd",
  "business-growth/education-snapshot-backfills": "de4ebdab46d89308799cc736c6ede62865baff3ff368ae022ba3b5df3af89da3",
  "business-growth/bundle-payment-backfill": "02cb84a8f8269817fbfab98cb466d06bed585b1b44abf3c3d782c0cd40b374c0",
  "business-growth/bundle-payment-immutability-function": "bd31a406cfc27bb72c45544f1f8f1364b7f70e613c4648111afd867c63a45b5c",
  "business-growth/rollout-marker-write": "312f1b509b906c829ff9d8e6cff85297792131765a6ffa75497268d423a56ca9",
  "business-growth/cleanup-report-read": "9d55dfdeb76182415757ee29478faac261f00c7e6e63b7b6123347302d9f7b94",
  "media/transaction-and-advisory-lock": "36acbbec3f646974cba125111693a5959dfad195c6d2b5cc0deea0f326887d87",
  "shipping/duplicate-row-cleanup": "02be577da4b2795da77ac4e05a364ee5c13931b89e9cab5d3eabff4d8ec78574",
  "marketplace/advisory-lock-and-session-state": "bfb38d48f8b6bf46e835786214b81885255c1eaba53e6c386620302da7600ac7",
  "referral/tracking-start-backfill": "8b07319c47fbe3b86e9b3c105a3265f33e2b6d6a3934e3ccfda5d46f2522a41b",
  "referral/transaction-and-advisory-lock": "81f17bf4c9fa6f1541e80711d0e37a8b8a4bded6b76d17f751b0bc10523d6ae7",
  "web-push/transaction-and-advisory-lock": "61c82572405e91daf32adf7ca6f665ee6097d8edfbf6ea781653454f80090279",
  "booking-command/transaction-and-advisory-lock": "7e0c51f4575a087b83b8beea946488c7f71ae38168ecf56ee5e65640ad85198e",
  "education-bundle/payment-reference-backfill": "4f193122db5716f726732f88dcef740dd80897d2b2ff3c9e3f265bf21578ad0c",
  "education-bundle/payment-reference-function": "60b41847a42a46d10ce261c80ab73f4488e04291a2cd695812d3cf7552fc6a1e",
  "education-bundle/learner-id-backfill": "d4d0bd8102d4ec691968fd81cc5791039a4727b5b751aa7a2bd577a398fc8a1a",
  "education-bundle/transaction-and-advisory-lock": "c555c08c8e3ee6bd5b5e5bea188f769a35ae0d94b6d446c1aeecdf7378714b9c",
});

export interface StartupMigrationCrosswalk {
  readonly version: typeof CROSSWALK_VERSION;
  readonly inventory: {
    readonly source: "scripts/src/production-startup-ddl-baseline.json";
    readonly version: 1;
    readonly ownerCount: number;
    readonly recordCount: number;
    readonly uniqueFingerprintCount: number;
  };
  readonly canonicalBaseline: {
    readonly migrationId: typeof CANONICAL_MIGRATION_ID;
    readonly source: "lib/db/migrations/000001_canonical_schema/migration.sql";
    readonly checksum: string;
  };
  readonly mappings: readonly StartupMigrationMapping[];
  readonly additionalOperations: readonly AdditionalStartupOperation[];
}

export interface CrosswalkValidationOptions {
  /**
   * Test-only virtual owner sources.  They permit source-proof adversarial
   * tests without writing to the production owner files.
   */
  readonly sourceOverrides?: ReadonlyMap<string, string>;
}

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function crosswalkSource(modulePath: string, sourceOverrides?: ReadonlyMap<string, string>): string {
  return sourceOverrides?.get(modulePath) ?? reviewedHistoricalSource(REPOSITORY_ROOT, modulePath);
}

function normalizedIdentifier(value: string): string {
  return value.replaceAll("\"", "").replace(/['",;()]+$/gu, "");
}

function relationIdentity(value: string): { schema: string; name: string } {
  const tableExpression = value.match(/^\$\{table\(\s*["']([^"']+)["']\s*\)\}$/u);
  if (tableExpression) {
    return { schema: "<dynamic>", name: tableExpression[1]! };
  }
  const raw = normalizedIdentifier(value);
  if (raw.includes("${") || raw.includes("%I")) {
    const dynamicQualified = raw.match(/^(?:\$\{[^}]+\}|%I)\.([A-Za-z_][A-Za-z0-9_$]*)$/u);
    return {
      schema: "<dynamic>",
      name: dynamicQualified?.[1] ?? raw,
    };
  }
  const parts = raw.split(".");
  if (parts.length > 1) {
    return { schema: parts.at(-2)!, name: parts.at(-1)! };
  }
  return { schema: "public", name: raw };
}

function relationTokenAfter(summary: string, prefix: RegExp): string | undefined {
  const match = prefix.exec(summary);
  if (!match || match.index === undefined) return undefined;
  const source = summary.slice(match.index + match[0].length).trimStart();
  if (source.startsWith("${")) {
    let depth = 0;
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          const suffix = source.slice(index + 1);
          const qualifiedName = suffix.match(/^\.([A-Za-z_][A-Za-z0-9_$]*)/u)?.[0];
          if (qualifiedName) return source.slice(0, index + 1 + qualifiedName.length);
          if (suffix.startsWith(".${")) {
            let suffixDepth = 0;
            for (let suffixIndex = 1; suffixIndex < suffix.length; suffixIndex += 1) {
              if (suffix[suffixIndex] === "{") suffixDepth += 1;
              if (suffix[suffixIndex] === "}") {
                suffixDepth -= 1;
                if (suffixDepth === 0) return source.slice(0, index + 1 + suffixIndex + 1);
              }
            }
          }
          return source.slice(0, index + 1);
        }
      }
    }
    return source;
  }
  return source.match(/^[^\s(;,]+/u)?.[0];
}

function extractObjectIdentity(operation: DdlOperation): ObjectIdentity {
  const summary = operation.summary.replace(/\s+/gu, " ").trim();
  const tableToken = relationTokenAfter(summary, /\b(?:ALTER|CREATE)\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+/iu);
  const onRelationToken = relationTokenAfter(summary, /\bON\s+/iu);
  const parent = tableToken
    ? relationIdentity(tableToken)
    : onRelationToken
      ? relationIdentity(onRelationToken)
      : undefined;

  const constraint = summary.match(/\b(?:ADD|DROP|VALIDATE)\s+CONSTRAINT(?:\s+IF\s+EXISTS)?\s+([^\s(;]+)/iu);
  if (constraint && parent) {
    return {
      kind: "constraint",
      schema: parent.schema,
      name: normalizedIdentifier(constraint[1]!),
      parent: parent.name,
    };
  }

  const trigger = summary.match(/\b(?:CREATE|DROP)\s+TRIGGER(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([^\s(;]+)/iu);
  if (trigger) {
    const name = normalizedIdentifier(trigger[1]!);
    const sourceParent = TRIGGER_PARENT_BY_NAME.get(name);
    const triggerParent = parent ?? sourceParent;
    return {
      kind: "trigger",
      schema: triggerParent?.schema ?? "<dynamic>",
      name,
      ...(triggerParent ? { parent: triggerParent.name } : {}),
      ...(!triggerParent || name.includes("${") || name.includes("%I")
        ? { dynamicExpression: !triggerParent ? `trigger-parent:${name}` : name }
        : {}),
    };
  }

  const indexToken = relationTokenAfter(summary, /\b(?:CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+/iu);
  if (indexToken) {
    const identity = relationIdentity(indexToken);
    const schema = parent?.schema ?? identity.schema;
    return {
      kind: "index",
      schema,
      name: identity.name,
      ...(parent ? { parent: parent.name } : {}),
      ...(schema === "<dynamic>"
        ? { dynamicExpression: parent?.schema === "<dynamic>"
          ? `${normalizedIdentifier(indexToken)} ON ${normalizedIdentifier(onRelationToken ?? "")}`
          : normalizedIdentifier(indexToken) }
        : {}),
    };
  }

  const typeToken = relationTokenAfter(summary, /\b(?:CREATE|ALTER)\s+TYPE(?:\s+IF\s+NOT\s+EXISTS)?\s+/iu);
  if (typeToken) {
    const identity = relationIdentity(typeToken);
    return {
      kind: "type",
      ...identity,
      ...(identity.schema === "<dynamic>" ? { dynamicExpression: normalizedIdentifier(typeToken) } : {}),
    };
  }

  const extension = summary.match(/\bCREATE\s+EXTENSION(?:\s+IF\s+NOT\s+EXISTS)?\s+([^\s(;]+)/iu);
  if (extension) {
    return { kind: "extension", schema: "pg_catalog", name: normalizedIdentifier(extension[1]!) };
  }

  if (parent) {
    return {
      kind: "table",
      ...parent,
      ...(parent.schema === "<dynamic>" ? { dynamicExpression: normalizedIdentifier(tableToken ?? onRelationToken ?? "") } : {}),
    };
  }
  throw new Error(`Could not extract object identity for ${operation.fingerprint}: ${operation.summary}`);
}

function existingDataEffect(kind: string): ExistingDataEffect {
  // The historical inventory records syntactic DDL, not proof that populated
  // production relations satisfy its invariant.  Treat every catalog change
  // conservatively until a reviewed migration establishes otherwise.
  void kind;
  return "existing-schema-reconciliation";
}

function dependenciesFor(identity: ObjectIdentity): string[] {
  const dependencies = [`schema:${identity.schema}`];
  if (identity.parent) dependencies.push(`table:${identity.schema}.${identity.parent}`);
  return dependencies;
}

/**
 * Review narrative is derived only from the immutable inventory operation,
 * executable-source identity, and canonical evidence.  Validators rebuild this
 * object rather than trusting narrative prose carried by a candidate document.
 */
function mappingNarrative(
  operation: Pick<DdlOperation, "kind">,
  identity: ObjectIdentity,
  evidence: CanonicalCandidateEvidence,
): Pick<
  StartupMigrationMapping,
  "existingDataEffect"
  | "dependencies"
  | "preconditions"
  | "postconditions"
  | "rollbackConsiderations"
  | "resolutionReason"
> {
  return {
    existingDataEffect: existingDataEffect(operation.kind),
    dependencies: dependenciesFor(identity),
    preconditions: [
      "All referenced parent objects and existing rows satisfy the reviewed operation semantics.",
      "The operation has been compared with the immutable canonical migration or an approved future migration.",
    ],
    postconditions: [
      `The reviewed ${identity.kind} identity ${identity.schema}.${identity.name} has the approved definition.`,
      "Existing production data is preserved or changed only by an explicitly reviewed backfill.",
    ],
    rollbackConsiderations: [
      operation.kind.startsWith("drop-")
        ? "A DROP is not evidence that an object is retired; rollback requires explicit historical proof."
        : "Application rollback must remain compatible with the resulting catalog and data state.",
    ],
    resolutionReason: evidence.evidenceType === "candidate-name-match"
      ? "Canonical SQL contains the object name, but name presence does not prove definition or transition-semantic equivalence."
      : "No exact object-name candidate was found in immutable 000001; no future migration or retirement is authorized by this task.",
  };
}

function canonicalEvidence(
  identity: ObjectIdentity,
  canonicalLines: readonly { readonly text: string; readonly lower: string }[],
  canonicalChecksum: string,
): CanonicalCandidateEvidence {
  if (identity.dynamicExpression) {
    return {
      migrationId: CANONICAL_MIGRATION_ID,
      migrationChecksum: canonicalChecksum,
      evidenceType: "no-candidate-name-match",
      lineReferences: [],
      semanticsVerified: false,
    };
  }
  const token = identity.name.toLowerCase();
  const exactToken = new RegExp(`(?:^|[^A-Za-z0-9_$])${token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:$|[^A-Za-z0-9_$])`, "u");
  const matches: string[] = [];
  for (const [index, line] of canonicalLines.entries()) {
    if (exactToken.test(line.lower)) {
      matches.push(`lib/db/migrations/000001_canonical_schema/migration.sql:${index + 1}`);
      if (matches.length === 5) break;
    }
  }
  return {
    migrationId: CANONICAL_MIGRATION_ID,
    migrationChecksum: canonicalChecksum,
    evidenceType: matches.length > 0 ? "candidate-name-match" : "no-candidate-name-match",
    lineReferences: matches,
    semanticsVerified: false,
  };
}

const INVENTORY_OPERATION_PATTERNS: readonly { readonly kind: string; readonly expression: RegExp }[] = [
  { kind: "create-table", expression: /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[^\s(;,]+/giu },
  { kind: "drop-table", expression: /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[^\s(;,]+/giu },
  { kind: "create-index", expression: /\bCREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?\s+(?:IF\s+NOT\s+EXISTS\s+)?[^\s(;,]+(?:\s+ON\s+[^\s(;,]+)/giu },
  { kind: "drop-index", expression: /\bDROP\s+INDEX(?:\s+CONCURRENTLY)?\s+(?:IF\s+EXISTS\s+)?[^\s(;,]+/giu },
  { kind: "create-trigger", expression: /\bCREATE\s+TRIGGER\s+[^\s(;,]+/giu },
  { kind: "drop-trigger", expression: /\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?[^\s(;,]+/giu },
  { kind: "create-type", expression: /\bCREATE\s+TYPE\s+(?:IF\s+NOT\s+EXISTS\s+)?[^\s(;,]+/giu },
  { kind: "drop-type", expression: /\bDROP\s+TYPE\s+(?:IF\s+EXISTS\s+)?[^\s(;,]+/giu },
  { kind: "alter-type", expression: /\bALTER\s+TYPE\s+[^\s;,]+(?:\s+ADD\s+VALUE(?:\s+IF\s+NOT\s+EXISTS)?\s+[^;]+)?/giu },
  { kind: "create-extension", expression: /\bCREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?[^\s;,]+/giu },
  { kind: "add-constraint", expression: /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[^\s;,]+\s+ADD\s+CONSTRAINT\s+[^\s;,]+/giu },
  { kind: "drop-constraint", expression: /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[^\s;,]+\s+DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?[^\s;,]+/giu },
  { kind: "validate-constraint", expression: /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[^\s;,]+\s+VALIDATE\s+CONSTRAINT\s+[^\s;,]+/giu },
  { kind: "alter-table", expression: /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[^\s;,]+\s+(?!(?:ADD|DROP|VALIDATE)\s+CONSTRAINT\b)[^;]+/giu },
];

function normalizedSql(value: string): string {
  return value
    .replace(/\$\{([^}]*)\}/gu, (_match, expression: string) => `\${${expression.trim()}}`)
    .replace(/--[^\n]*/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function inventoryFingerprint(kind: string, statement: string, literal: string): string {
  return createHash("sha256")
    .update(`${kind}\0${normalizedSql(statement)}\0${normalizedSql(literal)}`)
    .digest("hex");
}

interface SourcedOperation {
  readonly fingerprint: string;
  readonly sourcePath: string;
  readonly sourcePosition: CrosswalkOccurrence["sourcePosition"];
  readonly sourceSql: string;
  readonly sourceSqlChecksum: string;
}

function sourcedOperations(modulePath: string, sourceOverrides?: ReadonlyMap<string, string>): SourcedOperation[] {
  const source = crosswalkSource(modulePath, sourceOverrides);
  const sourceFile = ts.createSourceFile(modulePath, source, ts.ScriptTarget.Latest, true);
  const result: SourcedOperation[] = [];
  const visit = (node: ts.Node): void => {
    const literal = operationText(node);
    if (literal !== undefined) {
      const literalStart = node.getStart(sourceFile);
      for (const pattern of INVENTORY_OPERATION_PATTERNS) {
        pattern.expression.lastIndex = 0;
        for (const match of literal.matchAll(pattern.expression)) {
          const position = sourceFile.getLineAndCharacterOfPosition(literalStart + (match.index ?? 0) + 1);
          const literalPosition = sourceFile.getLineAndCharacterOfPosition(literalStart);
          result.push({
            fingerprint: inventoryFingerprint(pattern.kind, match[0]!, literal),
            sourcePath: `${modulePath}:${position.line + 1}:${position.character + 1}`,
            sourcePosition: {
              literalLine: literalPosition.line + 1,
              literalColumn: literalPosition.character + 1,
              operationLine: position.line + 1,
              operationColumn: position.character + 1,
            },
            sourceSql: literal,
            sourceSqlChecksum: createHash("sha256").update(literal).digest("hex"),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result.sort((left, right) =>
    left.sourcePosition.operationLine - right.sourcePosition.operationLine
    || left.sourcePosition.operationColumn - right.sourcePosition.operationColumn
    || left.fingerprint.localeCompare(right.fingerprint));
}

function expectedOccurrences(
  baseline: StartupDdlBaseline,
  sourceOverrides?: ReadonlyMap<string, string>,
): Map<string, CrosswalkOccurrence[]> {
  const sourceByModule = new Map<string, SourcedOperation[]>();
  const cursors = new Map<string, number>();
  const result = new Map<string, CrosswalkOccurrence[]>();
  for (const owner of baseline.owners) {
    for (const operation of owner.operations) {
      let sourced = sourceByModule.get(operation.module);
      if (!sourced) {
        sourced = sourcedOperations(operation.module, sourceOverrides);
        sourceByModule.set(operation.module, sourced);
      }
      const sourceKey = `${operation.module}\0${operation.fingerprint}`;
      const candidateIndex = cursors.get(sourceKey) ?? 0;
      const candidates = sourced.filter((item) => item.fingerprint === operation.fingerprint);
      const sourceOperation = candidates[candidateIndex];
      if (!sourceOperation) {
        throw new Error(`Could not independently locate inventory operation ${operation.fingerprint} in ${operation.module}`);
      }
      cursors.set(sourceKey, candidateIndex + 1);
      const executionOrder = sourced.indexOf(sourceOperation) + 1;
      const item: CrosswalkOccurrence = {
        owner: owner.ensureName,
        sourcePath: sourceOperation.sourcePath,
        sourcePosition: sourceOperation.sourcePosition,
        sourceSql: sourceOperation.sourceSql,
        sourceSqlChecksum: sourceOperation.sourceSqlChecksum,
        executionOrder,
        ...(operation.callSite ? { callSite: operation.callSite } : {}),
        ...(operation.phase ? { phase: operation.phase } : {}),
        executionPath: operation.path ?? owner.path ?? [owner.ownerModule],
      };
      const current = result.get(operation.fingerprint) ?? [];
      current.push(item);
      result.set(operation.fingerprint, current);
    }
  }
  return result;
}

const SHARED_SCAFFOLDING = {
  existingDataEffect: "operational-scaffolding" as const,
  dependencies: ["database connection", "startup DDL timeout policy"],
  preconditions: ["owner has acquired one database client"],
  postconditions: ["lock and session state are released or restored"],
  rollbackConsiderations: ["Scaffolding does not replace rollback for committed DDL or data writes."],
  status: "UNRESOLVED" as const,
  reason: "Operational scaffolding is outside the classified DDL inventory and must move or retire with its owner.",
};

const REVIEWED_ADDITIONAL_STARTUP_OPERATIONS: readonly AdditionalStartupOperation[] = Object.freeze([
  {
    id: "business-growth/advisory-lock-and-session-state",
    owner: "ensureBusinessGrowthSchema",
    sourcePath: "artifacts/api-server/src/lib/business-growth-schema.ts:5002-5010,5153-5160,5190-5204",
    category: "operational-scaffolding",
    summary: "Acquire/release rollout advisory lock and set/restore search_path, timeout, and snapshot-backfill session state.",
    ...SHARED_SCAFFOLDING,
  },
  {
    id: "business-growth/rollout-marker-read",
    owner: "ensureBusinessGrowthSchema",
    sourcePath: "artifacts/api-server/src/lib/business-growth-schema.ts:5036-5042",
    category: "rollout-marker",
    summary: "Read rollout relation existence and current business-growth schema version.",
    objectIdentity: { kind: "table", schema: "public", name: "business_growth_schema_rollout" },
    existingDataEffect: "read-only-observation",
    dependencies: ["public.business_growth_schema_rollout when present"],
    preconditions: ["search_path identifies the requested schema"],
    postconditions: ["runtime selects the pending rollout statement set"],
    rollbackConsiderations: ["Read is reversible, but using stale marker state can select the wrong reconciliation path."],
    status: "UNRESOLVED",
    reason: "The migration ledger must replace this legacy rollout-marker decision before retirement.",
  },
  {
    id: "business-growth/gift-voucher-immutability-function",
    owner: "ensureBusinessGrowthSchema",
    sourcePath: "artifacts/api-server/src/lib/business-growth-schema.ts:5051-5066",
    category: "function-replacement",
    summary: "CREATE OR REPLACE FUNCTION prevent_education_gift_voucher_snapshot_update.",
    objectIdentity: { kind: "function", schema: "public", name: "prevent_education_gift_voucher_snapshot_update" },
    existingDataEffect: "existing-schema-reconciliation",
    dependencies: ["public.education_gift_vouchers"],
    preconditions: ["dependent table and trigger columns exist"],
    postconditions: ["snapshot immutability trigger function has reviewed canonical body"],
    rollbackConsiderations: ["Replacing the body changes write acceptance immediately and is not safely reversed by startup retry."],
    status: "UNRESOLVED",
    reason: "Function bodies are outside the 1,459-operation classifier and require exact semantic comparison.",
  },
  {
    id: "business-growth/education-snapshot-backfills",
    owner: "ensureBusinessGrowthSchema",
    sourcePath: "artifacts/api-server/src/lib/business-growth-schema.ts:229-238",
    category: "data-backfill",
    summary: "Backfill course-enrollment payment-instruction snapshots.",
    existingDataEffect: "existing-data-mutation",
    dependencies: ["course enrollments", "stable payment instruction source rows"],
    preconditions: ["target snapshot columns exist", "source identities are unambiguous"],
    postconditions: ["eligible historical course-enrollment rows contain immutable payment-instruction snapshots"],
    rollbackConsiderations: ["Autocommitted historical row updates require restore or a reviewed compensating migration."],
    status: "UNRESOLVED",
    reason: "Generated UPDATE statements are not represented by the DDL fingerprint inventory.",
  },
  {
    id: "business-growth/bundle-payment-backfill",
    owner: "ensureBusinessGrowthSchema",
    sourcePath: "artifacts/api-server/src/lib/business-growth-schema.ts:5087-5108",
    category: "data-backfill",
    summary: "Detect education bundle purchases and backfill payment_reference and payment_instructions.",
    objectIdentity: { kind: "table", schema: "public", name: "education_bundle_purchases" },
    existingDataEffect: "existing-data-mutation",
    dependencies: ["public.education_bundle_purchases", "stable purchase UUIDs"],
    preconditions: ["payment columns exist", "generated references are unique"],
    postconditions: ["payment references and instruction snapshots are populated before NOT NULL enforcement"],
    rollbackConsiderations: ["Autocommitted generated references must not be regenerated differently by rollback code."],
    status: "UNRESOLVED",
    reason: "Backfill semantics need a reviewed versioned migration even when the final columns exist in the baseline.",
  },
  {
    id: "business-growth/bundle-payment-immutability-function",
    owner: "ensureBusinessGrowthSchema",
    sourcePath: "artifacts/api-server/src/lib/business-growth-schema.ts:5112-5120",
    category: "function-replacement",
    summary: "CREATE OR REPLACE FUNCTION reject_bundle_payment_reference_change.",
    objectIdentity: { kind: "function", schema: "public", name: "reject_bundle_payment_reference_change" },
    existingDataEffect: "existing-schema-reconciliation",
    dependencies: ["public.education_bundle_purchases"],
    preconditions: ["payment reference and instruction columns exist and are backfilled"],
    postconditions: ["payment identity fields are immutable under the reviewed function body"],
    rollbackConsiderations: ["Old and new function bodies can enforce different financial invariants."],
    status: "UNRESOLVED",
    reason: "Function replacement is outside the classified DDL inventory.",
  },
  {
    id: "business-growth/rollout-marker-write",
    owner: "ensureBusinessGrowthSchema",
    sourcePath: "artifacts/api-server/src/lib/business-growth-schema.ts:5145-5148",
    category: "rollout-marker",
    summary: "INSERT ... ON CONFLICT the completed business-growth rollout version.",
    objectIdentity: { kind: "table", schema: "public", name: "business_growth_schema_rollout" },
    existingDataEffect: "existing-data-mutation",
    dependencies: ["all selected business-growth rollout statements completed"],
    preconditions: ["legacy rollout table exists"],
    postconditions: ["legacy marker records the selected version"],
    rollbackConsiderations: ["A marker must never claim completion after a partially failed autocommit rollout."],
    status: "UNRESOLVED",
    reason: "Legacy marker writes must be retired only after the canonical migration ledger owns version state.",
  },
  {
    id: "business-growth/cleanup-report-read",
    owner: "ensureBusinessGrowthSchema",
    sourcePath: "artifacts/api-server/src/lib/business-growth-schema.ts:5175-5178",
    category: "cleanup-reporting",
    summary: "Read the latest education salon cleanup report after startup DDL.",
    objectIdentity: { kind: "table", schema: "public", name: "education_salon_cleanup_reports" },
    existingDataEffect: "read-only-observation",
    dependencies: ["public.education_salon_cleanup_reports"],
    preconditions: ["cleanup reporting table exists"],
    postconditions: ["startup log reflects the latest cleanup result"],
    rollbackConsiderations: ["Removing the read loses operational evidence unless reporting receives a new explicit owner."],
    status: "UNRESOLVED",
    reason: "Reporting is not schema DDL but is coupled to startup rollout completion.",
  },
  {
    id: "media/transaction-and-advisory-lock",
    owner: "ensureMediaSchema",
    sourcePath: "artifacts/api-server/src/lib/media-schema.ts:105-109",
    category: "operational-scaffolding",
    summary: "BEGIN/COMMIT/ROLLBACK and advisory lock lifecycle for media schema rollout.",
    ...SHARED_SCAFFOLDING,
  },
  {
    id: "shipping/duplicate-row-cleanup",
    owner: "ensureShippingConfigSchema",
    sourcePath: "artifacts/api-server/src/lib/shipping-config.ts:24-35,54-65",
    category: "data-backfill",
    summary: "Lock shipping_rules, delete duplicate rows while retaining the lowest id, then create the unique singleton index.",
    objectIdentity: { kind: "table", schema: "public", name: "shipping_rules" },
    existingDataEffect: "existing-data-mutation",
    dependencies: ["public.shipping_rules"],
    preconditions: ["table lock acquired", "lowest id is the approved survivor policy"],
    postconditions: ["at most one shipping_rules row remains and singleton uniqueness can be enforced"],
    rollbackConsiderations: ["Committed duplicate deletion is logically irreversible without a backup."],
    status: "UNRESOLVED",
    reason: "The destructive cleanup is omitted by the DDL-only inventory and needs explicit migration review.",
  },
  {
    id: "marketplace/advisory-lock-and-session-state",
    owner: "ensureMarketplacePerformanceIndexes",
    sourcePath: "artifacts/api-server/src/lib/marketplace-performance-schema.ts:18-20,39-44",
    category: "operational-scaffolding",
    summary: "Manage advisory lock and session timeout state around concurrent index creation.",
    ...SHARED_SCAFFOLDING,
  },
  {
    id: "referral/tracking-start-backfill",
    owner: "ensureReferralSchema",
    sourcePath: "artifacts/api-server/src/lib/referral-schema.ts:27-41",
    category: "data-backfill",
    summary: "Backfill referral_qualifications.tracking_started_at from immutable verification audit evidence or legacy updated_at.",
    objectIdentity: { kind: "table", schema: "public", name: "referral_qualifications" },
    existingDataEffect: "existing-data-mutation",
    dependencies: ["referral_attributions", "business_verification_audits"],
    preconditions: ["tracking_started_at column exists", "legacy fallback policy is approved"],
    postconditions: ["eligible A/B1 qualifications have a tracking start timestamp"],
    rollbackConsiderations: ["Historical attribution timestamps cannot be reconstructed after destructive source cleanup."],
    status: "UNRESOLVED",
    reason: "The UPDATE is outside the DDL classifier and requires data-policy review.",
  },
  {
    id: "referral/transaction-and-advisory-lock",
    owner: "ensureReferralSchema",
    sourcePath: "artifacts/api-server/src/lib/referral-schema.ts:16-18,48-53",
    category: "operational-scaffolding",
    summary: "Transaction, timeout, and advisory lock lifecycle for referral reconciliation.",
    ...SHARED_SCAFFOLDING,
  },
  {
    id: "web-push/transaction-and-advisory-lock",
    owner: "ensureWebPushSchema",
    sourcePath: "artifacts/api-server/src/lib/web-push-schema.ts:11-15,18-24",
    category: "operational-scaffolding",
    summary: "Transaction, timeout, and advisory lock lifecycle for Web Push schema rollout.",
    ...SHARED_SCAFFOLDING,
  },
  {
    id: "booking-command/transaction-and-advisory-lock",
    owner: "ensureBookingCommandSchema",
    sourcePath: "artifacts/api-server/src/lib/booking-command-schema.ts:9-12,35-38",
    category: "operational-scaffolding",
    summary: "Transaction, timeout, and advisory lock lifecycle for booking command schema rollout.",
    ...SHARED_SCAFFOLDING,
  },
  {
    id: "education-bundle/payment-reference-backfill",
    owner: "ensureEducationBundlePurchaseSchema",
    sourcePath: "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:24-31",
    category: "data-backfill",
    summary: "Backfill bundle payment_reference and payment_instructions before NOT NULL and snapshot constraints.",
    objectIdentity: { kind: "table", schema: "public", name: "education_bundle_purchases" },
    existingDataEffect: "existing-data-mutation",
    dependencies: ["public.education_bundle_purchases"],
    preconditions: ["payment columns exist", "generated reference uniqueness is verified"],
    postconditions: ["every historical purchase has an immutable payment reference snapshot"],
    rollbackConsiderations: ["Financial reference changes require restore or reviewed compensation."],
    status: "UNRESOLVED",
    reason: "The UPDATE statements are outside the DDL fingerprint inventory.",
  },
  {
    id: "education-bundle/payment-reference-function",
    owner: "ensureEducationBundlePurchaseSchema",
    sourcePath: "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:39-47",
    category: "function-replacement",
    summary: "CREATE OR REPLACE FUNCTION reject_bundle_payment_reference_change.",
    objectIdentity: { kind: "function", schema: "public", name: "reject_bundle_payment_reference_change" },
    existingDataEffect: "existing-schema-reconciliation",
    dependencies: ["public.education_bundle_purchases"],
    preconditions: ["payment fields are fully backfilled"],
    postconditions: ["reviewed trigger function protects payment identity"],
    rollbackConsiderations: ["Function-body rollback can weaken or change financial immutability."],
    status: "UNRESOLVED",
    reason: "Function replacement is outside the classified DDL inventory.",
  },
  {
    id: "education-bundle/learner-id-backfill",
    owner: "ensureEducationBundlePurchaseSchema",
    sourcePath: "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:54-58",
    category: "data-backfill",
    summary: "Backfill course_enrollments learner identity from existing employee/user relationships.",
    objectIdentity: { kind: "table", schema: "public", name: "course_enrollments" },
    existingDataEffect: "existing-data-mutation",
    dependencies: ["course_enrollments", "employees", "users"],
    preconditions: ["legacy employee relationship resolves to one approved learner identity"],
    postconditions: ["eligible enrollment rows have valid learner references before constraint validation"],
    rollbackConsiderations: ["Identity reassignment must not be reversed without preserving learner ownership evidence."],
    status: "UNRESOLVED",
    reason: "The UPDATE is outside the DDL classifier and affects learner identity boundaries.",
  },
  {
    id: "education-bundle/transaction-and-advisory-lock",
    owner: "ensureEducationBundlePurchaseSchema",
    sourcePath: "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:9-12,81-84",
    category: "operational-scaffolding",
    summary: "Transaction, timeout, and shared business-growth advisory lock lifecycle.",
    ...SHARED_SCAFFOLDING,
  },
]);

const OWNER_MODULES = [
  ["ensureBusinessGrowthSchema", "artifacts/api-server/src/lib/business-growth-schema.ts"],
  ["ensureMediaSchema", "artifacts/api-server/src/lib/media-schema.ts"],
  ["ensureShippingConfigSchema", "artifacts/api-server/src/lib/shipping-config.ts"],
  ["ensureMarketplacePerformanceIndexes", "artifacts/api-server/src/lib/marketplace-performance-schema.ts"],
  ["ensureReferralSchema", "artifacts/api-server/src/lib/referral-schema.ts"],
  ["ensureWebPushSchema", "artifacts/api-server/src/lib/web-push-schema.ts"],
  ["ensureBookingCommandSchema", "artifacts/api-server/src/lib/booking-command-schema.ts"],
  ["ensureEducationBundlePurchaseSchema", "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts"],
] as const;

function triggerParentIndex(): ReadonlyMap<string, { schema: string; name: string }> {
  const candidates = new Map<string, { schema: string; name: string }[]>();
  for (const [, modulePath] of OWNER_MODULES) {
    const source = crosswalkSource(modulePath);
    const sourceFile = ts.createSourceFile(modulePath, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      const text = operationText(node);
      if (text) {
        const pattern = /\b(?:CREATE|DROP)\s+TRIGGER(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([^\s(;]+)[\s\S]{0,800}?\bON\s+([^\s(;]+)/giu;
        for (const match of text.matchAll(pattern)) {
          const triggerName = normalizedIdentifier(match[1]!);
          const relation = relationIdentity(match[2]!);
          const current = candidates.get(triggerName) ?? [];
          if (!current.some((item) => item.schema === relation.schema && item.name === relation.name)) {
            current.push(relation);
          }
          candidates.set(triggerName, current);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return new Map(
    [...candidates]
      // Schema parameters are runtime values, but the relation name remains a
      // useful exact parent identity when every source occurrence agrees.
      .filter(([, relations]) => new Set(relations.map((relation) => relation.name)).size === 1)
      .map(([name, relations]) => [name, relations[0]!]),
  );
}

const TRIGGER_PARENT_BY_NAME = triggerParentIndex();

function sourceRangeCovers(sourcePath: string, modulePath: string, line: number): boolean {
  if (!sourcePath.startsWith(modulePath)) return false;
  const suffix = sourcePath.slice(modulePath.length + 1);
  for (const match of suffix.matchAll(/(\d+)(?:-(\d+))?/gu)) {
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (line >= start && line <= end) return true;
  }
  return false;
}

function operationText(node: ts.Node): string | undefined {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return [
      node.head.text,
      ...node.templateSpans.flatMap((span) => [`\${${span.expression.getText()}}`, span.literal.text]),
    ].join("");
  }
  return undefined;
}

interface ExecutableStartupSqlLiteral {
  readonly owner: string;
  readonly modulePath: string;
  readonly text: string;
  readonly normalized: string;
  readonly category: Extract<AdditionalOperationCategory, "data-backfill" | "function-replacement">;
  readonly line: number;
  readonly column: number;
  readonly executionOrder: number;
}

export type StartupExecutableSqlClassification =
  | "inventory-ddl"
  | "data-backfill"
  | "function-replacement"
  | "operational-scaffolding"
  | "unknown-executable-sql";

/**
 * Return SQL keywords outside strings, dollar-quoted function bodies, quoted
 * identifiers, and line/block comments.  Nested block comments are accepted
 * because PostgreSQL accepts them.  Only top-level keywords are relevant:
 * UPDATE inside CREATE FUNCTION ... AS $$ ... $$ is runtime function code,
 * not a statement executed while startup runs.
 */
function topLevelSqlKeywords(text: string): readonly string[] {
  const keywords: string[] = [];
  let index = 0;
  let depth = 0;
  while (index < text.length) {
    const current = text[index]!;
    const next = text[index + 1];
    if (/\s/u.test(current)) {
      index += 1;
    } else if (current === "-" && next === "-") {
      index = text.indexOf("\n", index + 2);
      if (index < 0) break;
    } else if (current === "/" && next === "*") {
      let commentDepth = 1;
      index += 2;
      while (index < text.length && commentDepth > 0) {
        if (text[index] === "/" && text[index + 1] === "*") {
          commentDepth += 1;
          index += 2;
        } else if (text[index] === "*" && text[index + 1] === "/") {
          commentDepth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
    } else if (current === "'" || current === "\"") {
      const quote = current;
      index += 1;
      while (index < text.length) {
        if (text[index] === quote) {
          index += text[index + 1] === quote ? 2 : 1;
          if (text[index - 1] === quote && text[index] !== quote) break;
        } else {
          index += 1;
        }
      }
    } else if (current === "$") {
      const delimiter = text.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$/u)?.[0]
        ?? (next === "$" ? "$$" : undefined);
      if (delimiter) {
        const end = text.indexOf(delimiter, index + delimiter.length);
        index = end < 0 ? text.length : end + delimiter.length;
      } else {
        index += 1;
      }
    } else if (current === "(") {
      depth += 1;
      index += 1;
    } else if (current === ")") {
      depth = Math.max(0, depth - 1);
      index += 1;
    } else if (/[A-Za-z_]/u.test(current)) {
      const start = index;
      index += 1;
      while (index < text.length && /[A-Za-z0-9_$]/u.test(text[index]!)) index += 1;
      if (depth === 0) keywords.push(text.slice(start, index).toUpperCase());
    } else {
      index += 1;
    }
  }
  return keywords;
}

function hasKeywordSequence(keywords: readonly string[], ...sequence: readonly string[]): boolean {
  return sequence.every((keyword, index) => keywords[index] === keyword);
}

function hasTopLevelKeyword(keywords: readonly string[], keyword: string): boolean {
  return keywords.includes(keyword);
}

function hasKeywordSubsequence(keywords: readonly string[], ...sequence: readonly string[]): boolean {
  return keywords.some((_keyword, start) => sequence.every((item, index) => keywords[start + index] === item));
}

/**
 * Classifies complete SQL literals rather than searching arbitrary substrings.
 * The explicit unknown result is intentionally fail-closed for executable
 * schema/data verbs that are outside the 1,459-record DDL inventory.
 */
export function startupExecutableSqlClassification(
  text: string,
): StartupExecutableSqlClassification | undefined {
  const keywords = topLevelSqlKeywords(text);
  if (keywords.length === 0) return undefined;

  if (hasKeywordSequence(keywords, "CREATE", "OR", "REPLACE", "FUNCTION")) {
    return "function-replacement";
  }
  if (hasKeywordSequence(keywords, "ALTER", "TABLE")
    && (hasTopLevelKeyword(keywords, "POLICY")
      || hasKeywordSubsequence(keywords, "ROW", "LEVEL", "SECURITY"))) {
    return "unknown-executable-sql";
  }
  if (hasKeywordSequence(keywords, "CREATE", "POLICY")
    || hasKeywordSequence(keywords, "CREATE", "VIEW")
    || hasKeywordSequence(keywords, "CREATE", "MATERIALIZED", "VIEW")
    || hasKeywordSequence(keywords, "CREATE", "SEQUENCE")
    || hasKeywordSequence(keywords, "CREATE", "PROCEDURE")
    || hasKeywordSequence(keywords, "CREATE", "OR", "REPLACE", "PROCEDURE")
    || hasKeywordSequence(keywords, "COMMENT", "ON")
    || hasKeywordSequence(keywords, "REFRESH", "MATERIALIZED", "VIEW")
    || ["TRUNCATE", "MERGE", "COPY", "GRANT", "REVOKE", "CALL"].includes(keywords[0]!)) {
    return "unknown-executable-sql";
  }
  if (hasTopLevelKeyword(keywords, "INSERT")
    || hasTopLevelKeyword(keywords, "DELETE")
    || hasTopLevelKeyword(keywords, "UPDATE")) {
    return "data-backfill";
  }
  if (INVENTORY_OPERATION_PATTERNS.some((pattern) => {
    pattern.expression.lastIndex = 0;
    return pattern.expression.test(text);
  })) {
    return "inventory-ddl";
  }
  if (["BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE", "SET", "SHOW", "SELECT", "DO", "LOCK"].includes(keywords[0]!)) {
    return "operational-scaffolding";
  }
  return "unknown-executable-sql";
}

function looksLikeSqlLiteral(text: string): boolean {
  const first = topLevelSqlKeywords(text)[0];
  return first !== undefined && [
    "ALTER", "ANALYZE", "BEGIN", "CALL", "CLUSTER", "COMMENT", "COMMIT", "COPY",
    "CREATE", "DELETE", "DO", "DROP", "GRANT", "INSERT", "LOCK", "MERGE",
    "REFRESH", "REINDEX", "RELEASE", "REVOKE", "ROLLBACK", "SAVEPOINT", "SELECT",
    "SET", "SHOW", "TRUNCATE", "UPDATE", "VACUUM", "WITH",
  ].includes(first);
}

export function startupSqlLiteralCategory(
  text: string,
): Extract<AdditionalOperationCategory, "data-backfill" | "function-replacement"> | undefined {
  const classification = startupExecutableSqlClassification(text);
  return classification === "data-backfill" || classification === "function-replacement"
    ? classification
    : undefined;
}

/**
 * The reviewed additional-operation census predates top-level lexical
 * classification and intentionally includes UPDATEs inside DO blocks (which
 * execute during startup).  Keep that historical, pinned census stable while
 * the lexer above governs fail-closed recognition of newly introduced verbs.
 */
function reviewedStartupSqlLiteralCategory(
  text: string,
): Extract<AdditionalOperationCategory, "data-backfill" | "function-replacement"> | undefined {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (/\bCREATE\s+OR\s+REPLACE\s+FUNCTION\b/iu.test(normalized)) return "function-replacement";
  if (
    /\bINSERT\s+INTO\s+[A-Za-z_$"{%]/iu.test(normalized)
    || /\bDELETE\s+FROM\s+[A-Za-z_$"{%]/iu.test(normalized)
    || /\bUPDATE\s+(?:ONLY\s+)?[A-Za-z_$"{%][^\s,;()]*\s+(?:(?:AS\s+)?[A-Za-z_][A-Za-z0-9_]*\s+)?SET\b/iu.test(normalized)
  ) return "data-backfill";
  return undefined;
}

function executableStartupSqlLiterals(sourceOverrides?: ReadonlyMap<string, string>): ExecutableStartupSqlLiteral[] {
  const literals: ExecutableStartupSqlLiteral[] = [];
  for (const [owner, modulePath] of OWNER_MODULES) {
    const source = crosswalkSource(modulePath, sourceOverrides);
    const sourceFile = ts.createSourceFile(modulePath, source, ts.ScriptTarget.Latest, true);
    let executionOrder = 0;
    const visit = (node: ts.Node): void => {
      const text = operationText(node);
      if (text) {
        const normalized = text.replace(/\s+/gu, " ").trim();
        const category = reviewedStartupSqlLiteralCategory(text);
        if (category) {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          executionOrder += 1;
          literals.push({
            owner,
            modulePath,
            text,
            normalized,
            category,
            line: position.line + 1,
            column: position.character + 1,
            executionOrder,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return literals;
}

function discoveredAdditionalOperations(): AdditionalStartupOperation[] {
  const discovered: AdditionalStartupOperation[] = [];
  const literals = executableStartupSqlLiterals();
  for (const literal of literals) {
    const alreadyReviewed = REVIEWED_ADDITIONAL_STARTUP_OPERATIONS.some((item) => {
      if (!sourceRangeCovers(item.sourcePath, literal.modulePath, literal.line)) return false;
      // The reviewed grouping has a pinned source cardinality.  An added
      // literal in its range is emitted rather than silently swallowed.
      const count = literals.filter((candidate) =>
        candidate.modulePath === literal.modulePath
        && sourceRangeCovers(item.sourcePath, candidate.modulePath, candidate.line)).length;
      return count === (PINNED_CURATED_LITERAL_COUNTS[item.id] ?? 1);
    });
    if (!alreadyReviewed) {
      const digest = createHash("sha256")
        .update(`${literal.modulePath}\0${literal.line}\0${literal.normalized}`)
        .digest("hex")
        .slice(0, 16);
      discovered.push({
        id: `${literal.owner}/source-discovered-${literal.line}-${digest}`,
        owner: literal.owner,
        sourcePath: `${literal.modulePath}:${literal.line}:${literal.column}`,
        category: literal.category,
        summary: literal.normalized,
        existingDataEffect: literal.category === "function-replacement"
          ? "existing-schema-reconciliation"
          : "existing-data-mutation",
        dependencies: ["Exact source query dependencies require semantic review."],
        preconditions: ["Referenced objects exist and affected existing rows have been reviewed."],
        postconditions: ["The source operation's schema or data invariant is preserved by an explicit migration decision."],
        rollbackConsiderations: [
          literal.category === "data-backfill"
            ? "Committed data changes require a reviewed compensating migration or tested restore."
            : "Function body changes can alter write acceptance immediately.",
        ],
        status: "UNRESOLVED",
        reason: "Source-derived executable SQL is outside the classified 1,459-record DDL inventory and has no approved migration mapping.",
        sourceSql: literal.text,
        sourceSqlChecksum: createHash("sha256").update(literal.text).digest("hex"),
        sourcePosition: {
          line: literal.line,
          column: literal.column,
          executionOrder: literal.executionOrder,
        },
      });
    }
  }
  return discovered;
}

export const ADDITIONAL_STARTUP_OPERATIONS: readonly AdditionalStartupOperation[] = Object.freeze([
  ...REVIEWED_ADDITIONAL_STARTUP_OPERATIONS,
  ...discoveredAdditionalOperations(),
].sort((left, right) => left.id.localeCompare(right.id)));

function assertPinnedExecutableSqlCoverage(
  sourceOverrides?: ReadonlyMap<string, string>,
): readonly ExecutableStartupSqlLiteral[] {
  const literals = executableStartupSqlLiterals(sourceOverrides);
  const functionReplacements = literals.filter((item) => item.category === "function-replacement").length;
  const dataMutations = literals.filter((item) => item.category === "data-backfill").length;
  if (literals.length !== PINNED_EXECUTABLE_STARTUP_SQL_LITERALS.total
    || functionReplacements !== PINNED_EXECUTABLE_STARTUP_SQL_LITERALS.functionReplacements
    || dataMutations !== PINNED_EXECUTABLE_STARTUP_SQL_LITERALS.dataMutations) {
    throw new Error("Pinned executable startup SQL literal coverage does not match source");
  }
  const expectedOwners = PINNED_EXECUTABLE_STARTUP_SQL_LITERALS.byOwner;
  const actualOwners = new Map<string, number>();
  for (const literal of literals) actualOwners.set(literal.owner, (actualOwners.get(literal.owner) ?? 0) + 1);
  if (JSON.stringify(Object.fromEntries([...actualOwners].sort()))
    !== JSON.stringify(Object.fromEntries(Object.entries(expectedOwners).sort()))) {
    throw new Error("Pinned executable startup SQL owner coverage does not match source");
  }
  return literals;
}

function assertNoUnknownExecutableStartupSql(sourceOverrides?: ReadonlyMap<string, string>): void {
  for (const [, modulePath] of OWNER_MODULES) {
    const source = crosswalkSource(modulePath, sourceOverrides);
    const sourceFile = ts.createSourceFile(modulePath, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      const text = operationText(node);
      if (text && looksLikeSqlLiteral(text)
        && startupExecutableSqlClassification(text) === "unknown-executable-sql") {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        throw new Error(`Unclassified executable startup SQL at ${modulePath}:${position.line + 1}:${position.character + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
}

function assertPinnedStartupOwnerSourceCoverage(sourceOverrides?: ReadonlyMap<string, string>): void {
  const modulePaths = OWNER_MODULES.map(([, modulePath]) => modulePath).sort();
  const pinnedPaths = Object.keys(PINNED_STARTUP_OWNER_SOURCE_CHECKSUMS).sort();
  if (JSON.stringify(modulePaths) !== JSON.stringify(pinnedPaths)) {
    throw new Error("Pinned startup owner source coverage does not match owner inventory");
  }
  for (const modulePath of modulePaths) {
    const checksum = createHash("sha256").update(crosswalkSource(modulePath, sourceOverrides)).digest("hex");
    if (checksum !== PINNED_STARTUP_OWNER_SOURCE_CHECKSUMS[modulePath]) {
      throw new Error(`Pinned startup owner source checksum mismatch: ${modulePath}`);
    }
  }
}

function assertPinnedAdditionalOperationCoverage(
  operations: readonly AdditionalStartupOperation[],
  literals: readonly ExecutableStartupSqlLiteral[],
  sourceOverrides?: ReadonlyMap<string, string>,
): void {
  if (operations.length !== PINNED_ADDITIONAL_OPERATION_COVERAGE.total) {
    throw new Error("Pinned additional-operation total does not match source-derived inventory");
  }
  const actualOwners = new Map<string, number>();
  for (const operation of operations) actualOwners.set(operation.owner, (actualOwners.get(operation.owner) ?? 0) + 1);
  if (JSON.stringify(Object.fromEntries([...actualOwners].sort()))
    !== JSON.stringify(Object.fromEntries(Object.entries(PINNED_ADDITIONAL_OPERATION_COVERAGE.byOwner).sort()))) {
    throw new Error("Pinned additional-operation owner coverage does not match source-derived inventory");
  }
  const curated = operations.filter((operation) => !operation.id.includes("/source-discovered-"));
  const pinnedCuratedIds = Object.keys(PINNED_CURATED_SOURCE_EXCERPT_CHECKSUMS).sort();
  if (curated.length !== pinnedCuratedIds.length
    || JSON.stringify(curated.map((operation) => operation.id).sort()) !== JSON.stringify(pinnedCuratedIds)) {
    throw new Error("Pinned curated additional-operation source coverage does not match inventory");
  }

  for (const operation of operations) {
    if (!operation.id.includes("/source-discovered-")) continue;
    if (!operation.sourcePosition || !operation.sourceSql || !operation.sourceSqlChecksum) {
      throw new Error(`Discovered additional operation lacks exact source proof: ${operation.id}`);
    }
    const source = literals.find((literal) =>
      literal.owner === operation.owner
      && literal.modulePath === operation.sourcePath.split(":")[0]
      && literal.line === operation.sourcePosition!.line
      && literal.column === operation.sourcePosition!.column
      && literal.text === operation.sourceSql);
    if (!source || createHash("sha256").update(operation.sourceSql).digest("hex") !== operation.sourceSqlChecksum
      || source.executionOrder !== operation.sourcePosition.executionOrder) {
      throw new Error(`Discovered additional operation source proof mismatch: ${operation.id}`);
    }
  }
}

export function buildStartupMigrationCrosswalk(
  baseline: StartupDdlBaseline,
  canonicalSql: string,
  canonicalChecksum = CANONICAL_MIGRATION_CHECKSUM,
  additionalOperations: readonly AdditionalStartupOperation[] = ADDITIONAL_STARTUP_OPERATIONS,
  sourceOverrides: ReadonlyMap<string, string> = loadReviewedHistoricalSources(REPOSITORY_ROOT),
): StartupMigrationCrosswalk {
  const actualChecksum = createHash("sha256").update(canonicalSql).digest("hex");
  if (actualChecksum !== canonicalChecksum) {
    throw new Error(`Canonical migration checksum mismatch: expected ${canonicalChecksum}, received ${actualChecksum}`);
  }

  const sourcedOccurrences = expectedOccurrences(baseline, sourceOverrides);
  const grouped = new Map<string, {
    owner: StartupDdlBaseline["owners"][number];
    operation: DdlOperation;
    occurrences: CrosswalkOccurrence[];
  }>();

  for (const owner of baseline.owners) {
    for (const operation of owner.operations) {
      const current = grouped.get(operation.fingerprint);
      const allOccurrences = sourcedOccurrences.get(operation.fingerprint);
      const sourcedOccurrence = allOccurrences?.[current?.occurrences.length ?? 0];
      if (!sourcedOccurrence || sourcedOccurrence.owner !== owner.ensureName) {
        throw new Error(`Could not reconcile sourced occurrence for ${operation.fingerprint}`);
      }
      if (current) {
        if (current.operation.kind !== operation.kind || current.operation.summary !== operation.summary) {
          throw new Error(`Fingerprint ${operation.fingerprint} identifies inconsistent operations`);
        }
        current.occurrences.push(sourcedOccurrence);
      } else {
        grouped.set(operation.fingerprint, {
          owner,
          operation,
          occurrences: [sourcedOccurrence],
        });
      }
    }
  }

  const canonicalLines = canonicalSql.split(/\r?\n/u).map((text) => ({ text, lower: text.toLowerCase() }));
  const mappings = [...grouped.values()]
    .map(({ operation, occurrences }) => {
      const identity = extractObjectIdentity(operation);
      const evidence = canonicalEvidence(identity, canonicalLines, canonicalChecksum);
      return {
        fingerprint: operation.fingerprint,
        operationKind: operation.kind,
        summary: operation.summary,
        objectIdentity: identity,
        ...mappingNarrative(operation, identity, evidence),
        status: "UNRESOLVED" as const,
        evidence,
        occurrences,
      } satisfies StartupMigrationMapping;
    })
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));

  const recordCount = baseline.owners.reduce((total, owner) => total + owner.operations.length, 0);
  const crosswalk: StartupMigrationCrosswalk = {
    version: CROSSWALK_VERSION,
    inventory: {
      source: "scripts/src/production-startup-ddl-baseline.json",
      version: baseline.version,
      ownerCount: baseline.owners.length,
      recordCount,
      uniqueFingerprintCount: mappings.length,
    },
    canonicalBaseline: {
      migrationId: CANONICAL_MIGRATION_ID,
      source: "lib/db/migrations/000001_canonical_schema/migration.sql",
      checksum: canonicalChecksum,
    },
    mappings,
    additionalOperations: [...additionalOperations].sort((left, right) => left.id.localeCompare(right.id)),
  };
  validateStartupMigrationCrosswalk(crosswalk, baseline, {
    sourceOverrides,
  });
  return crosswalk;
}

export function validateStartupMigrationCrosswalk(
  crosswalk: StartupMigrationCrosswalk,
  baseline: StartupDdlBaseline,
  options: CrosswalkValidationOptions = {},
): void {
  if (crosswalk.version !== CROSSWALK_VERSION) throw new Error("Unsupported crosswalk version");
  if (crosswalk.canonicalBaseline.migrationId !== CANONICAL_MIGRATION_ID
    || crosswalk.canonicalBaseline.source !== "lib/db/migrations/000001_canonical_schema/migration.sql"
    || crosswalk.canonicalBaseline.checksum !== CANONICAL_MIGRATION_CHECKSUM) {
    throw new Error("Crosswalk does not reference the immutable canonical migration checksum");
  }
  const canonicalSql = readFileSync(
    path.join(REPOSITORY_ROOT, "lib/db/migrations/000001_canonical_schema/migration.sql"),
    "utf8",
  );
  const canonicalChecksum = createHash("sha256").update(canonicalSql).digest("hex");
  if (canonicalChecksum !== CANONICAL_MIGRATION_CHECKSUM) {
    throw new Error("Immutable canonical migration checksum drifted on disk");
  }
  const canonicalLines = canonicalSql.split(/\r?\n/u).map((text) => ({ text, lower: text.toLowerCase() }));
  assertNoUnknownExecutableStartupSql(options.sourceOverrides);
  const sourcedOccurrenceMap = expectedOccurrences(baseline, options.sourceOverrides);

  const baselineOperations = new Map<string, {
    kind: string;
    summary: string;
    identity: ObjectIdentity;
    occurrences: CrosswalkOccurrence[];
  }>();
  for (const owner of baseline.owners) {
    for (const operation of owner.operations) {
      if (!/^[a-f0-9]{64}$/u.test(operation.fingerprint)) {
        throw new Error(`Invalid inventory fingerprint: ${operation.fingerprint}`);
      }
      const current = baselineOperations.get(operation.fingerprint);
      const expectedOccurrence = sourcedOccurrenceMap.get(operation.fingerprint)?.[current?.occurrences.length ?? 0];
      if (!expectedOccurrence || expectedOccurrence.owner !== owner.ensureName) {
        throw new Error(`Could not reconcile baseline source occurrence: ${operation.fingerprint}`);
      }
      if (current) {
        if (current.kind !== operation.kind || current.summary !== operation.summary) {
          throw new Error(`Inconsistent baseline operation: ${operation.fingerprint}`);
        }
        current.occurrences.push(expectedOccurrence);
      } else {
        baselineOperations.set(operation.fingerprint, {
          kind: operation.kind,
          summary: operation.summary,
          identity: extractObjectIdentity(operation),
          occurrences: [expectedOccurrence],
        });
      }
    }
  }

  const seen = new Set<string>();
  let mappedOccurrences = 0;
  const expectedFingerprintOrder = [...baselineOperations.keys()].sort((left, right) => left.localeCompare(right));
  for (const [mappingIndex, mapping] of crosswalk.mappings.entries()) {
    if (seen.has(mapping.fingerprint)) throw new Error(`Duplicate crosswalk mapping: ${mapping.fingerprint}`);
    seen.add(mapping.fingerprint);
    if (mapping.fingerprint !== expectedFingerprintOrder[mappingIndex]) {
      throw new Error(`Crosswalk mapping order mismatch at ${mappingIndex}`);
    }
    const expected = baselineOperations.get(mapping.fingerprint);
    if (!expected) {
      throw new Error(`Unsupported crosswalk fingerprint: ${mapping.fingerprint}`);
    }
    if (mapping.operationKind !== expected.kind || mapping.summary !== expected.summary) {
      throw new Error(`Operation metadata mismatch: ${mapping.fingerprint}`);
    }
    if (JSON.stringify(mapping.objectIdentity) !== JSON.stringify(expected.identity)) {
      throw new Error(`Object identity mismatch: ${mapping.fingerprint}`);
    }
    if (!mapping.objectIdentity.kind || !mapping.objectIdentity.schema || !mapping.objectIdentity.name) {
      throw new Error(`Missing object identity: ${mapping.fingerprint}`);
    }
    const expectedEvidence = canonicalEvidence(expected.identity, canonicalLines, canonicalChecksum);
    const expectedNarrative = mappingNarrative(
      { kind: expected.kind },
      expected.identity,
      expectedEvidence,
    );
    if (JSON.stringify({
      existingDataEffect: mapping.existingDataEffect,
      dependencies: mapping.dependencies,
      preconditions: mapping.preconditions,
      postconditions: mapping.postconditions,
      rollbackConsiderations: mapping.rollbackConsiderations,
      resolutionReason: mapping.resolutionReason,
    }) !== JSON.stringify(expectedNarrative)) {
      throw new Error(`Mapping narrative mismatch: ${mapping.fingerprint}`);
    }
    if (mapping.status !== "UNRESOLVED") {
      throw new Error(`Unsupported mapping status: ${String(mapping.status)}`);
    }
    if (JSON.stringify(mapping.evidence) !== JSON.stringify(expectedEvidence)) {
      throw new Error(`Canonical evidence mismatch: ${mapping.fingerprint}`);
    }
    if (JSON.stringify(mapping.occurrences) !== JSON.stringify(expected.occurrences)) {
      throw new Error(`Occurrence mismatch for ${mapping.fingerprint}`);
    }
    mappedOccurrences += mapping.occurrences.length;
  }

  for (const fingerprint of baselineOperations.keys()) {
    if (!seen.has(fingerprint)) throw new Error(`Missing crosswalk mapping: ${fingerprint}`);
  }
  if (mappedOccurrences !== [...baselineOperations.values()].reduce((sum, value) => sum + value.occurrences.length, 0)) {
    throw new Error("Crosswalk occurrence total does not match inventory");
  }

  const additionalIds = new Set<string>();
  const owners = new Set(baseline.owners.map((owner) => owner.ensureName));
  for (const operation of crosswalk.additionalOperations) {
    if (additionalIds.has(operation.id)) throw new Error(`Duplicate additional operation: ${operation.id}`);
    additionalIds.add(operation.id);
    if (!owners.has(operation.owner)) throw new Error(`Unknown additional-operation owner: ${operation.owner}`);
    if (operation.status !== "UNRESOLVED") throw new Error(`Unsupported additional-operation status: ${operation.id}`);
    if (!operation.sourcePath || !operation.summary || !operation.reason
      || operation.dependencies.length === 0 || operation.preconditions.length === 0
      || operation.postconditions.length === 0 || operation.rollbackConsiderations.length === 0) {
      throw new Error(`Incomplete additional operation: ${operation.id}`);
    }
    const [modulePath] = operation.sourcePath.split(":");
    if (!modulePath || !crosswalkSource(modulePath, options.sourceOverrides)) {
      throw new Error(`Missing additional-operation source: ${operation.id}`);
    }
    if (!operation.id.includes("/source-discovered-")) {
      const ranges = [...operation.sourcePath.slice(modulePath.length + 1).matchAll(/(\d+)(?:-(\d+))?/gu)];
      if (ranges.length === 0 || ranges.some((match) => Number(match[2] ?? match[1]) - Number(match[1]) > 25)) {
        throw new Error(`Curated additional operation lacks narrow source positions: ${operation.id}`);
      }
      const sourceLines = crosswalkSource(modulePath, options.sourceOverrides).split(/\r?\n/u);
      const excerpt = ranges.flatMap((match) => sourceLines.slice(Number(match[1]) - 1, Number(match[2] ?? match[1])));
      const expectedChecksum = PINNED_CURATED_SOURCE_EXCERPT_CHECKSUMS[operation.id];
      const actualChecksum = createHash("sha256").update(excerpt.join("\n")).digest("hex");
      if (!expectedChecksum || actualChecksum !== expectedChecksum) {
        throw new Error(`Curated additional operation source excerpt checksum mismatch: ${operation.id}`);
      }
    }
  }
  const expectedAdditional = [...ADDITIONAL_STARTUP_OPERATIONS]
    .sort((left, right) => left.id.localeCompare(right.id));
  const actualAdditional = [...crosswalk.additionalOperations]
    .sort((left, right) => left.id.localeCompare(right.id));
  if (JSON.stringify(actualAdditional) !== JSON.stringify(expectedAdditional)) {
    throw new Error("Additional startup operations do not match the reviewed source-derived inventory");
  }
  const literals = assertPinnedExecutableSqlCoverage(options.sourceOverrides);
  assertPinnedAdditionalOperationCoverage(crosswalk.additionalOperations, literals, options.sourceOverrides);
  assertPinnedStartupOwnerSourceCoverage(options.sourceOverrides);

  if (crosswalk.inventory.recordCount !== mappedOccurrences
    || crosswalk.inventory.uniqueFingerprintCount !== seen.size
    || crosswalk.inventory.ownerCount !== baseline.owners.length) {
    throw new Error("Crosswalk metadata does not reconcile with validated content");
  }
}

export interface OwnerCrosswalkReport {
  readonly owner: string;
  readonly inventoryRecords: number;
  readonly uniqueFingerprints: number;
  readonly canonicalBaseline: number;
  readonly futureMigrationRequired: number;
  readonly retiredHistorical: number;
  readonly unresolved: number;
  readonly additionalOperations: number;
}

export function ownerCrosswalkReport(
  crosswalk: StartupMigrationCrosswalk,
  baseline: StartupDdlBaseline,
): readonly OwnerCrosswalkReport[] {
  return baseline.owners.map((owner) => {
    const mappings = crosswalk.mappings.filter((mapping) =>
      mapping.occurrences.some((item) => item.owner === owner.ensureName));
    return {
      owner: owner.ensureName,
      inventoryRecords: owner.operations.length,
      uniqueFingerprints: mappings.length,
      canonicalBaseline: mappings.filter((mapping) => mapping.status === "CANONICAL_BASELINE").length,
      futureMigrationRequired: mappings.filter((mapping) => mapping.status === "FUTURE_MIGRATION_REQUIRED").length,
      retiredHistorical: mappings.filter((mapping) => mapping.status === "RETIRED_HISTORICAL").length,
      unresolved: mappings.filter((mapping) => mapping.status === "UNRESOLVED").length,
      additionalOperations: crosswalk.additionalOperations.filter((item) => item.owner === owner.ensureName).length,
    };
  });
}

export function loadRepositoryCrosswalk(): {
  readonly baseline: StartupDdlBaseline;
  readonly crosswalk: StartupMigrationCrosswalk;
} {
  const baseline = JSON.parse(readFileSync(
    path.join(REPOSITORY_ROOT, "scripts/src/production-startup-ddl-baseline.json"),
    "utf8",
  )) as StartupDdlBaseline;
  const canonicalSql = readFileSync(
    path.join(REPOSITORY_ROOT, "lib/db/migrations/000001_canonical_schema/migration.sql"),
    "utf8",
  );
  const sourceOverrides = loadReviewedHistoricalSources(REPOSITORY_ROOT);
  return { baseline, crosswalk: buildStartupMigrationCrosswalk(baseline, canonicalSql,
    CANONICAL_MIGRATION_CHECKSUM, ADDITIONAL_STARTUP_OPERATIONS, sourceOverrides) };
}

function main(): void {
  const { baseline, crosswalk } = loadRepositoryCrosswalk();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(crosswalk, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({
    inventory: crosswalk.inventory,
    canonicalBaseline: crosswalk.canonicalBaseline,
    additionalOperationCount: crosswalk.additionalOperations.length,
    owners: ownerCrosswalkReport(crosswalk, baseline),
  }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();