import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
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
}

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

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function normalizedIdentifier(value: string): string {
  return value.replaceAll("\"", "").replace(/[,;()]+$/gu, "");
}

function relationIdentity(value: string): { schema: string; name: string } {
  const raw = normalizedIdentifier(value);
  const clean = raw.replace(/^\$\{(?:s|schema|quoted)\}\./u, "public.");
  if (clean.includes("${") || clean.includes("%I")) {
    return { schema: "<dynamic>", name: clean };
  }
  const parts = clean.split(".");
  if (parts.length > 1) {
    return { schema: parts.at(-2)!, name: parts.at(-1)! };
  }
  return { schema: "public", name: clean };
}

function extractObjectIdentity(operation: DdlOperation): ObjectIdentity {
  const summary = operation.summary.replace(/\s+/gu, " ").trim();
  const tableMatch = summary.match(/\b(?:ALTER|CREATE)\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([^\s(;]+)/iu);
  const onRelationMatch = summary.match(/\bON\s+([^\s(;]+)/iu);
  const parent = tableMatch
    ? relationIdentity(tableMatch[1]!)
    : onRelationMatch
      ? relationIdentity(onRelationMatch[1]!)
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

  const index = summary.match(/\b(?:CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([^\s(;]+)/iu);
  if (index) {
    const identity = relationIdentity(index[1]!);
    return {
      kind: "index",
      schema: identity.schema,
      name: identity.name,
      ...(parent ? { parent: parent.name } : {}),
      ...(identity.schema === "<dynamic>" ? { dynamicExpression: normalizedIdentifier(index[1]!) } : {}),
    };
  }

  const type = summary.match(/\b(?:CREATE|ALTER)\s+TYPE(?:\s+IF\s+NOT\s+EXISTS)?\s+([^\s(;]+)/iu);
  if (type) {
    const identity = relationIdentity(type[1]!);
    return {
      kind: "type",
      ...identity,
      ...(identity.schema === "<dynamic>" ? { dynamicExpression: normalizedIdentifier(type[1]!) } : {}),
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
      ...(parent.schema === "<dynamic>" ? { dynamicExpression: normalizedIdentifier(tableMatch?.[1] ?? onRelationMatch?.[1] ?? "") } : {}),
    };
  }
  throw new Error(`Could not extract object identity for ${operation.fingerprint}: ${operation.summary}`);
}

function existingDataEffect(kind: string): ExistingDataEffect {
  if (kind.startsWith("alter-") || kind.startsWith("drop-") || kind === "validate-constraint") {
    return "existing-schema-reconciliation";
  }
  return "fresh-and-existing-idempotent";
}

function dependenciesFor(identity: ObjectIdentity): string[] {
  const dependencies = [`schema:${identity.schema}`];
  if (identity.parent) dependencies.push(`table:${identity.schema}.${identity.parent}`);
  return dependencies;
}

function canonicalEvidence(
  identity: ObjectIdentity,
  canonicalLines: readonly string[],
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
  const matches: string[] = [];
  canonicalLines.forEach((line, index) => {
    if (matches.length < 5 && line.toLowerCase().includes(token)) {
      matches.push(`lib/db/migrations/000001_canonical_schema/migration.sql:${index + 1}`);
    }
  });
  return {
    migrationId: CANONICAL_MIGRATION_ID,
    migrationChecksum: canonicalChecksum,
    evidenceType: matches.length > 0 ? "candidate-name-match" : "no-candidate-name-match",
    lineReferences: matches,
    semanticsVerified: false,
  };
}

function occurrence(owner: StartupDdlBaseline["owners"][number], operation: DdlOperation): CrosswalkOccurrence {
  return {
    owner: owner.ensureName,
    sourcePath: operation.module,
    ...(operation.callSite ? { callSite: operation.callSite } : {}),
    ...(operation.phase ? { phase: operation.phase } : {}),
    executionPath: operation.path ?? owner.path ?? [owner.ownerModule],
  };
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
    sourcePath: "artifacts/api-server/src/lib/business-growth-schema.ts:217-231,5079",
    category: "data-backfill",
    summary: "Backfill education installment and course-enrollment payment-instruction snapshots.",
    existingDataEffect: "existing-data-mutation",
    dependencies: ["education installments", "course enrollments", "stable payment instruction source rows"],
    preconditions: ["target snapshot columns exist", "source identities are unambiguous"],
    postconditions: ["eligible historical rows contain immutable payment-instruction snapshots"],
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
    sourcePath: "artifacts/api-server/src/lib/referral-schema.ts:14-54",
    category: "operational-scaffolding",
    summary: "Transaction, timeout, and advisory lock lifecycle for referral reconciliation.",
    ...SHARED_SCAFFOLDING,
  },
  {
    id: "web-push/transaction-and-advisory-lock",
    owner: "ensureWebPushSchema",
    sourcePath: "artifacts/api-server/src/lib/web-push-schema.ts",
    category: "operational-scaffolding",
    summary: "Transaction, timeout, and advisory lock lifecycle for Web Push schema rollout.",
    ...SHARED_SCAFFOLDING,
  },
  {
    id: "booking-command/transaction-and-advisory-lock",
    owner: "ensureBookingCommandSchema",
    sourcePath: "artifacts/api-server/src/lib/booking-command-schema.ts",
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
    sourcePath: "artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:4-85",
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
    const source = readFileSync(path.join(REPOSITORY_ROOT, modulePath), "utf8");
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
      .filter(([, relations]) => relations.length === 1 && relations[0]!.schema !== "<dynamic>")
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

function discoveredAdditionalOperations(): AdditionalStartupOperation[] {
  const discovered: AdditionalStartupOperation[] = [];
  for (const [owner, modulePath] of OWNER_MODULES) {
    const source = readFileSync(path.join(REPOSITORY_ROOT, modulePath), "utf8");
    const sourceFile = ts.createSourceFile(modulePath, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      const text = operationText(node);
      if (text) {
        const normalized = text.replace(/\s+/gu, " ").trim();
        const functionReplacement = /\bCREATE\s+OR\s+REPLACE\s+FUNCTION\b/iu.test(normalized);
        const dataMutation = !functionReplacement && (
          /\bINSERT\s+INTO\s+[A-Za-z_$"{%]/iu.test(normalized)
          || /\bDELETE\s+FROM\s+[A-Za-z_$"{%]/iu.test(normalized)
          || /\bUPDATE\s+[A-Za-z_$"{%][^\s,;()]*\s+(?:AS\s+[A-Za-z_][A-Za-z0-9_]*\s+)?SET\b/iu.test(normalized)
        );
        if (functionReplacement || dataMutation) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          const alreadyReviewed = REVIEWED_ADDITIONAL_STARTUP_OPERATIONS.some((item) =>
            sourceRangeCovers(item.sourcePath, modulePath, line));
          if (!alreadyReviewed) {
            const digest = createHash("sha256")
              .update(`${modulePath}\0${line}\0${normalized}`)
              .digest("hex")
              .slice(0, 16);
            discovered.push({
              id: `${owner}/source-discovered-${line}-${digest}`,
              owner,
              sourcePath: `${modulePath}:${line}`,
              category: functionReplacement ? "function-replacement" : "data-backfill",
              summary: normalized,
              existingDataEffect: functionReplacement
                ? "existing-schema-reconciliation"
                : "existing-data-mutation",
              dependencies: ["Exact source query dependencies require semantic review."],
              preconditions: ["Referenced objects exist and affected existing rows have been reviewed."],
              postconditions: ["The source operation's schema or data invariant is preserved by an explicit migration decision."],
              rollbackConsiderations: [
                dataMutation
                  ? "Committed data changes require a reviewed compensating migration or tested restore."
                  : "Function body changes can alter write acceptance immediately.",
              ],
              status: "UNRESOLVED",
              reason: "Source-derived executable SQL is outside the classified 1,459-record DDL inventory and has no approved migration mapping.",
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return discovered;
}

export const ADDITIONAL_STARTUP_OPERATIONS: readonly AdditionalStartupOperation[] = Object.freeze([
  ...REVIEWED_ADDITIONAL_STARTUP_OPERATIONS,
  ...discoveredAdditionalOperations(),
].sort((left, right) => left.id.localeCompare(right.id)));

export function buildStartupMigrationCrosswalk(
  baseline: StartupDdlBaseline,
  canonicalSql: string,
  canonicalChecksum = CANONICAL_MIGRATION_CHECKSUM,
  additionalOperations: readonly AdditionalStartupOperation[] = ADDITIONAL_STARTUP_OPERATIONS,
): StartupMigrationCrosswalk {
  const actualChecksum = createHash("sha256").update(canonicalSql).digest("hex");
  if (actualChecksum !== canonicalChecksum) {
    throw new Error(`Canonical migration checksum mismatch: expected ${canonicalChecksum}, received ${actualChecksum}`);
  }

  const grouped = new Map<string, {
    owner: StartupDdlBaseline["owners"][number];
    operation: DdlOperation;
    occurrences: CrosswalkOccurrence[];
  }>();

  for (const owner of baseline.owners) {
    for (const operation of owner.operations) {
      const current = grouped.get(operation.fingerprint);
      if (current) {
        if (current.operation.kind !== operation.kind || current.operation.summary !== operation.summary) {
          throw new Error(`Fingerprint ${operation.fingerprint} identifies inconsistent operations`);
        }
        current.occurrences.push(occurrence(owner, operation));
      } else {
        grouped.set(operation.fingerprint, {
          owner,
          operation,
          occurrences: [occurrence(owner, operation)],
        });
      }
    }
  }

  const canonicalLines = canonicalSql.split(/\r?\n/u);
  const mappings = [...grouped.values()]
    .map(({ operation, occurrences }) => {
      const identity = extractObjectIdentity(operation);
      const evidence = canonicalEvidence(identity, canonicalLines, canonicalChecksum);
      return {
        fingerprint: operation.fingerprint,
        operationKind: operation.kind,
        summary: operation.summary,
        objectIdentity: identity,
        existingDataEffect: existingDataEffect(operation.kind),
        status: "UNRESOLVED" as const,
        evidence,
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
        occurrences: occurrences.sort((left, right) =>
          `${left.owner}\0${left.sourcePath}\0${left.callSite ?? ""}`.localeCompare(
            `${right.owner}\0${right.sourcePath}\0${right.callSite ?? ""}`,
          )),
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
  validateStartupMigrationCrosswalk(crosswalk, baseline);
  return crosswalk;
}

export function validateStartupMigrationCrosswalk(
  crosswalk: StartupMigrationCrosswalk,
  baseline: StartupDdlBaseline,
): void {
  if (crosswalk.version !== CROSSWALK_VERSION) throw new Error("Unsupported crosswalk version");
  if (crosswalk.canonicalBaseline.checksum !== CANONICAL_MIGRATION_CHECKSUM) {
    throw new Error("Crosswalk does not reference the immutable canonical migration checksum");
  }

  const baselineOperations = new Map<string, {
    kind: string;
    summary: string;
    identity: ObjectIdentity;
    occurrences: string[];
  }>();
  for (const owner of baseline.owners) {
    for (const operation of owner.operations) {
      if (!/^[a-f0-9]{64}$/u.test(operation.fingerprint)) {
        throw new Error(`Invalid inventory fingerprint: ${operation.fingerprint}`);
      }
      const occurrenceKey = JSON.stringify(occurrence(owner, operation));
      const current = baselineOperations.get(operation.fingerprint);
      if (current) {
        if (current.kind !== operation.kind || current.summary !== operation.summary) {
          throw new Error(`Inconsistent baseline operation: ${operation.fingerprint}`);
        }
        current.occurrences.push(occurrenceKey);
      } else {
        baselineOperations.set(operation.fingerprint, {
          kind: operation.kind,
          summary: operation.summary,
          identity: extractObjectIdentity(operation),
          occurrences: [occurrenceKey],
        });
      }
    }
  }

  const seen = new Set<string>();
  let mappedOccurrences = 0;
  for (const mapping of crosswalk.mappings) {
    if (seen.has(mapping.fingerprint)) throw new Error(`Duplicate crosswalk mapping: ${mapping.fingerprint}`);
    seen.add(mapping.fingerprint);
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
    if (!["CANONICAL_BASELINE", "FUTURE_MIGRATION_REQUIRED", "RETIRED_HISTORICAL", "UNRESOLVED"].includes(mapping.status)) {
      throw new Error(`Unsupported mapping status: ${String(mapping.status)}`);
    }
    if (mapping.status === "CANONICAL_BASELINE") {
      if (!mapping.evidence.semanticsVerified || mapping.evidence.evidenceType !== "candidate-name-match"
        || mapping.evidence.lineReferences.length === 0
        || mapping.evidence.migrationChecksum !== CANONICAL_MIGRATION_CHECKSUM) {
        throw new Error(`Unproven canonical equivalence: ${mapping.fingerprint}`);
      }
    }
    const actualOccurrenceKeys = mapping.occurrences.map((item) => JSON.stringify(item)).sort();
    const expectedOccurrenceKeys = [...expected.occurrences].sort();
    if (JSON.stringify(actualOccurrenceKeys) !== JSON.stringify(expectedOccurrenceKeys)) {
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
    if (!operation.sourcePath || !operation.summary || !operation.reason) {
      throw new Error(`Incomplete additional operation: ${operation.id}`);
    }
    const [modulePath] = operation.sourcePath.split(":");
    if (!modulePath || !readFileSync(path.join(REPOSITORY_ROOT, modulePath), "utf8")) {
      throw new Error(`Missing additional-operation source: ${operation.id}`);
    }
  }
  const expectedAdditional = [...ADDITIONAL_STARTUP_OPERATIONS]
    .sort((left, right) => left.id.localeCompare(right.id));
  const actualAdditional = [...crosswalk.additionalOperations]
    .sort((left, right) => left.id.localeCompare(right.id));
  if (JSON.stringify(actualAdditional) !== JSON.stringify(expectedAdditional)) {
    throw new Error("Additional startup operations do not match the reviewed source-derived inventory");
  }

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
  return { baseline, crosswalk: buildStartupMigrationCrosswalk(baseline, canonicalSql) };
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