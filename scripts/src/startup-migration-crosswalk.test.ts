import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";
import type { StartupDdlBaseline } from "./production-startup-ddl-inventory";
import {
  ADDITIONAL_STARTUP_OPERATIONS,
  buildStartupMigrationCrosswalk,
  CANONICAL_MIGRATION_CHECKSUM,
  ownerCrosswalkReport,
  PINNED_ADDITIONAL_OPERATION_COVERAGE,
  PINNED_EXECUTABLE_STARTUP_SQL_LITERALS,
  PINNED_STARTUP_OWNER_SOURCE_CHECKSUMS,
  startupExecutableSqlClassification,
  startupSqlLiteralCategory,
  validateStartupMigrationCrosswalk,
  type StartupMigrationCrosswalk,
} from "./startup-migration-crosswalk";

assertDestructiveTestRuntimeAllowed(process.env, "Startup migration crosswalk tests");
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
  assert.equal(crosswalk.additionalOperations.length, 110);
  assert.equal(crosswalk.additionalOperations.length, PINNED_ADDITIONAL_OPERATION_COVERAGE.total);
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

test("pins every executable startup SQL literal, including the sixteen formerly missed aliases", () => {
  const crosswalk = repositoryCrosswalk();
  assert.deepEqual(PINNED_EXECUTABLE_STARTUP_SQL_LITERALS, {
    total: 103,
    functionReplacements: 33,
    dataMutations: 70,
    byOwner: {
      ensureBusinessGrowthSchema: 96,
      ensureShippingConfigSchema: 1,
      ensureReferralSchema: 1,
      ensureWebPushSchema: 1,
      ensureEducationBundlePurchaseSchema: 4,
    },
  });
  for (const line of [239, 1888, 1955, 1993, 2695, 2936, 2968, 3986, 3997, 4612, 4617, 4620, 4644, 4801, 4881, 4894]) {
    assert.ok(crosswalk.additionalOperations.some((operation) =>
      operation.id.includes("source-discovered")
      && operation.sourcePath.includes(`business-growth-schema.ts:${line}:`)),
    `missing previously-undiscovered startup mutation at line ${line}`);
  }
  assert.equal(startupSqlLiteralCategory("WITH ranked AS (SELECT 1) UPDATE ONLY public.users u SET role = 'x'"), "data-backfill");
  assert.equal(startupSqlLiteralCategory("UPDATE public.users u SET role = 'x'"), "data-backfill");
  assert.equal(startupSqlLiteralCategory("UPDATE public.users AS u SET role = 'x'"), "data-backfill");
  assert.equal(startupSqlLiteralCategory("CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$"), "function-replacement");
});

test("fails closed for comment-prefixed, nested, and count-preserving unclassified startup SQL", () => {
  const shippingPath = "artifacts/api-server/src/lib/shipping-config.ts";
  const shippingSource = readFileSync(path.join(ROOT, shippingPath), "utf8");
  const crosswalk = repositoryCrosswalk();
  const bypasses = [
    "/* outer /* nested */ comment */ TRUNCATE public.users",
    "-- migration shortcut\nMERGE INTO public.users u USING public.staged s ON (u.id = s.id) WHEN MATCHED THEN UPDATE SET role = s.role",
    "COPY public.users FROM '/tmp/users.csv'",
    "GRANT SELECT ON public.users TO application",
    "REVOKE SELECT ON public.users FROM application",
    "CREATE VIEW public.active_users AS SELECT * FROM public.users",
    "CREATE SEQUENCE public.order_number_seq",
    "CREATE POLICY tenant_isolation ON public.users USING (true)",
    "ALTER TABLE public.users ENABLE ROW LEVEL SECURITY",
    "COMMENT ON TABLE public.users IS 'runtime change'",
    "REFRESH MATERIALIZED VIEW public.user_rollup",
    "CREATE PROCEDURE public.repair_users() LANGUAGE sql AS $$ UPDATE public.users SET role = 'x' $$",
    "VACUUM public.users",
  ];
  for (const sql of bypasses) {
    assert.equal(
      startupExecutableSqlClassification(sql),
      "unknown-executable-sql",
      `expected fail-closed classification for ${sql}`,
    );
    assert.throws(
      () => validateStartupMigrationCrosswalk(crosswalk, baseline, {
        sourceOverrides: new Map([[
          shippingPath,
          `${shippingSource}\nvoid client.query(${JSON.stringify(sql)});`,
        ]]),
      }),
      /Unclassified executable startup SQL/u,
      `expected virtual-source rejection for ${sql}`,
    );
  }
  assert.equal(
    startupExecutableSqlClassification(
      "CREATE OR REPLACE FUNCTION public.runtime_only() RETURNS void LANGUAGE plpgsql AS $$ BEGIN TRUNCATE public.users; END $$",
    ),
    "function-replacement",
    "function-body SQL is not startup execution",
  );

  const countPreservingBypass = `${shippingSource
    .replace("delete from ${schema}.shipping_rules", "TRUNCATE ${schema}.shipping_rules")}
\nvoid client.query(\`UPDATE \${schema}.shipping_rules SET id = id\`);`;
  assert.throws(
    () => validateStartupMigrationCrosswalk(crosswalk, baseline, {
      sourceOverrides: new Map([[shippingPath, countPreservingBypass]]),
    }),
    /Unclassified executable startup SQL/u,
  );
  assert.equal(
    Object.keys(PINNED_STARTUP_OWNER_SOURCE_CHECKSUMS).length,
    8,
    "every startup owner remains independently source-pinned",
  );
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

test("preserves exact source positions, source order, full SQL, and dynamic identity semantics", () => {
  const crosswalk = repositoryCrosswalk();
  for (const mapping of crosswalk.mappings) {
    for (const item of mapping.occurrences) {
      assert.match(item.sourcePath, /\.ts:\d+:\d+$/u);
      assert.ok(item.sourcePosition.literalLine > 0);
      assert.ok(item.sourcePosition.operationLine > 0);
      assert.ok(item.executionOrder > 0);
      assert.ok(item.sourceSql.length > 0);
      assert.equal(
        item.sourceSqlChecksum,
        createHash("sha256").update(item.sourceSql).digest("hex"),
      );
    }
  }
  for (const owner of baseline.owners) {
    const ordered = crosswalk.mappings
      .flatMap((mapping) => mapping.occurrences)
      .filter((item) => item.owner === owner.ensureName)
      .sort((left, right) => left.executionOrder - right.executionOrder);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      assert.ok(
        current.sourcePosition.operationLine > previous.sourcePosition.operationLine
          || (current.sourcePosition.operationLine === previous.sourcePosition.operationLine
            && current.sourcePosition.operationColumn >= previous.sourcePosition.operationColumn),
        `${owner.ensureName} source order regressed at ${current.sourcePath}`,
      );
    }
  }
  const rename = crosswalk.mappings.find((mapping) => mapping.summary.includes("ALTER TYPE ${s}.user_role"));
  assert.ok(rename?.occurrences.some((item) => item.sourceSql.includes("RENAME VALUE 'EDUCATION_CENTER_OWNER' TO 'EDUKATIVNI_CENTAR'")));
  const dynamicTable = crosswalk.mappings.find((mapping) =>
    mapping.objectIdentity.name === "salons" && mapping.objectIdentity.dynamicExpression?.includes("table"));
  assert.equal(dynamicTable?.objectIdentity.schema, "<dynamic>");
  const dynamicParentIndexes = crosswalk.mappings.filter((mapping) =>
    mapping.objectIdentity.kind === "index"
    && mapping.occurrences.some((item) => /\bON\s+\$\{/u.test(item.sourceSql)));
  assert.equal(dynamicParentIndexes.length, 531);
  assert.ok(dynamicParentIndexes.every((mapping) => mapping.objectIdentity.schema === "<dynamic>"));
  const doubleDynamicTables = crosswalk.mappings.filter((mapping) =>
    mapping.summary.includes("${s}.${table}"));
  assert.equal(doubleDynamicTables.length, 15);
  assert.ok(doubleDynamicTables.every((mapping) =>
    mapping.objectIdentity.name === "${s}.${table}"
      && mapping.objectIdentity.dynamicExpression === "${s}.${table}"));
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
    /Crosswalk mapping order mismatch|Missing crosswalk mapping/u,
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
    /Crosswalk mapping order mismatch|Unsupported crosswalk fingerprint/u,
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

test("rejects every unresolved-classification and canonical-evidence bypass", () => {
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
    /Unsupported mapping status/u,
  );

  for (const status of ["FUTURE_MIGRATION_REQUIRED", "RETIRED_HISTORICAL"] as const) {
    assert.throws(
      () => validateStartupMigrationCrosswalk({
        ...crosswalk,
        mappings: crosswalk.mappings.map((mapping) => ({ ...mapping, status })),
      }, baseline),
      /Unsupported mapping status/u,
    );
  }

  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      mappings: [{
        ...first,
        evidence: {
          ...first.evidence,
          lineReferences: ["lib/db/migrations/000001_canonical_schema/migration.sql:1"],
          semanticsVerified: true,
        },
      }, ...crosswalk.mappings.slice(1)],
    }, baseline),
    /Canonical evidence mismatch/u,
  );

  for (const narrativeForgery of [
    { existingDataEffect: "read-only-observation" as const },
    { dependencies: [] as readonly string[] },
    { preconditions: [] as readonly string[] },
    { postconditions: [] as readonly string[] },
    { rollbackConsiderations: [] as readonly string[] },
    { resolutionReason: "fabricated narrative" },
  ]) {
    assert.throws(
      () => validateStartupMigrationCrosswalk({
        ...crosswalk,
        mappings: [{
          ...first,
          ...narrativeForgery,
        }, ...crosswalk.mappings.slice(1)],
      }, baseline),
      /Mapping narrative mismatch/u,
    );
  }
});

test("rejects reordered mappings, reordered occurrences, and fabricated source positions", () => {
  const crosswalk = repositoryCrosswalk();
  const repeated = crosswalk.mappings.find((mapping) => mapping.occurrences.length > 1)!;
  assert.throws(
    () => validateStartupMigrationCrosswalk({ ...crosswalk, mappings: [...crosswalk.mappings].reverse() }, baseline),
    /Crosswalk mapping order mismatch/u,
  );
  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      mappings: crosswalk.mappings.map((mapping) => mapping === repeated
        ? { ...mapping, occurrences: [...mapping.occurrences].reverse() }
        : mapping),
    }, baseline),
    /Occurrence mismatch/u,
  );
  const first = crosswalk.mappings[0]!;
  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      mappings: [{
        ...first,
        occurrences: first.occurrences.map((item) => ({
          ...item,
          sourcePosition: { ...item.sourcePosition, operationLine: item.sourcePosition.operationLine + 1 },
        })),
      }, ...crosswalk.mappings.slice(1)],
    }, baseline),
    /Occurrence mismatch/u,
  );
});

test("rejects fabricated crosswalk metadata and canonical baseline identifiers", () => {
  const crosswalk = repositoryCrosswalk();
  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      inventory: { ...crosswalk.inventory, recordCount: crosswalk.inventory.recordCount + 1 },
    }, baseline),
    /Crosswalk metadata does not reconcile/u,
  );
  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      canonicalBaseline: { ...crosswalk.canonicalBaseline, checksum: "0".repeat(64) },
    }, baseline),
    /immutable canonical migration checksum/u,
  );
  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      canonicalBaseline: { ...crosswalk.canonicalBaseline, source: "fabricated.sql" as never },
    }, baseline),
    /immutable canonical migration checksum/u,
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
  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      additionalOperations: crosswalk.additionalOperations.map((operation, index) => index === 0
        ? { ...operation, dependencies: [] }
        : operation),
    }, baseline),
    /Incomplete additional operation/u,
  );
  const curated = crosswalk.additionalOperations.find((operation) => !operation.id.includes("/source-discovered-"))!;
  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      additionalOperations: crosswalk.additionalOperations.map((operation) => operation === curated
        ? { ...operation, sourcePath: "artifacts/api-server/src/lib/referral-schema.ts:1-56" }
        : operation),
    }, baseline),
    /Curated additional operation lacks narrow source positions/u,
  );
  assert.throws(
    () => validateStartupMigrationCrosswalk({
      ...crosswalk,
      additionalOperations: crosswalk.additionalOperations.map((operation) =>
        operation.id === "shipping/duplicate-row-cleanup"
          ? { ...operation, sourcePath: "artifacts/api-server/src/lib/shipping-config.ts:56-61" }
          : operation),
    }, baseline),
    /Curated additional operation source excerpt checksum mismatch/u,
  );
  const shippingPath = "artifacts/api-server/src/lib/shipping-config.ts";
  const driftedShippingSource = readFileSync(path.join(ROOT, shippingPath), "utf8")
    .replace("delete from ${schema}.shipping_rules", "DELETE FROM ${schema}.shipping_rules");
  assert.throws(
    () => validateStartupMigrationCrosswalk(crosswalk, baseline, {
      sourceOverrides: new Map([[shippingPath, driftedShippingSource]]),
    }),
    /Curated additional operation source excerpt checksum mismatch/u,
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