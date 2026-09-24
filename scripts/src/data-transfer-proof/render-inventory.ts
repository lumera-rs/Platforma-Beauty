import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../../../", import.meta.url);
const actual = JSON.parse(await readFile(new URL("docs/data-transfer/inventory.json", root), "utf8"));
const prior = JSON.parse(await readFile(new URL(".local/data-transfer-inventory/step1-inventory.json", root), "utf8"));
const migrationPath = "lib/db/migrations/000002_supported_startup_state/migration.sql";
const migrationLines = (await readFile(new URL(migrationPath, root), "utf8")).split("\n");
for (const table of actual.tables) {
  table.seededBy = migrationLines.flatMap((line, index) =>
    line.includes(`INSERT INTO ${table.table}`) ? [`${migrationPath}:${index + 1}`] : []);
}
const effects: Record<string, string> = {
  assign_immutable_business_payment_reference: "Assigns a payment reference on insert and rejects later reference changes.",
  enforce_supplier_catalog_ownership: "Checks supplier ownership of catalog rows and raises on mismatch.",
  enqueue_restocked_product_waitlist: "Creates product-restock waitlist outbox records when product availability changes; this is an externally deliverable side effect.",
  prevent_b2b_invoice_snapshot_update: "Rejects updates to immutable B2B invoice snapshot fields.",
  prevent_coupon_order_snapshot_update: "Rejects changes to coupon order evidence.",
  prevent_education_gift_voucher_snapshot_update: "Rejects changes to immutable gift-voucher snapshot fields.",
  prevent_incomplete_commercial_snapshot_insert: "Validates commercial snapshot completeness; unattached in the target.",
  prevent_order_bundle_component_update: "Rejects changes to recorded order-bundle components.",
  prevent_order_g2_snapshot_update: "Rejects changes to immutable B2B G2 order evidence.",
  prevent_order_item_commercial_snapshot_update: "Rejects changes to commercial order-item evidence.",
  prevent_order_promotion_snapshot_update: "Rejects changes to immutable order-promotion evidence.",
  prevent_retail_g2_snapshot_update: "Rejects changes to retail G2 order evidence.",
  prevent_retail_order_item_commercial_snapshot_update: "Rejects changes to retail commercial order-item evidence.",
  prevent_retail_order_promotion_snapshot_update: "Rejects changes to retail order-promotion evidence.",
  protect_aftercare_evidence: "Rejects changes to immutable aftercare recommendation evidence.",
  protect_aftercare_line_evidence: "Rejects changes to immutable aftercare recommendation-line evidence.",
  referral_prevent_mutation: "Rejects updates/deletes of append-only referral ledger/redemption rows.",
  referral_protect_attribution_identity: "Rejects changes to attribution identity fields.",
  reject_bundle_payment_reference_change: "Rejects changes to assigned bundle-payment references.",
  validate_b2c_banner_destination: "Validates banner destination and destination-field consistency.",
  validate_bundle_component: "Validates bundle-component compatibility and rejects invalid components.",
};
for (const trigger of actual.targetTriggers) trigger.effect = effects[trigger.function] ?? "Unclassified: requires review.";
for (const fn of actual.targetFunctions) fn.effect = effects[fn.name] ?? "Unclassified: requires review.";
const corrections = actual.tables.flatMap((table: any) => {
  const previous = prior.tables.find((item: any) => `public.${item.table}` === table.table);
  if (!previous) return [{ table: table.table, correction: "Table exists in migration-built target; provisional inventory incorrectly treated it as source-only.", targetSeedCount: table.seededTargetCount }];
  if (previous.columnDifferences.length !== table.columnDifferences.length) return [{
    table: table.table, correction: "Provisional Drizzle-derived column difference list replaced by raw source-versus-migration-target catalog differences.",
    provisionalDifferences: previous.columnDifferences, actualDifferences: table.columnDifferences,
  }];
  return [];
});
for (const table of actual.tables) {
  const previous = prior.tables.find((item: any) => `public.${item.table}` === table.table);
  if (!previous) continue;
  const currentKeys = table.foreignKeys.map((fk: any) => {
    const definition = fk.definition.replaceAll('"', "");
    const match = /FOREIGN KEY \(([^)]+)\) REFERENCES (?:public\.)?([^ (]+)\(([^)]+)\)/u.exec(definition);
    return { columns: match?.[1]?.split(",").map(value => value.trim()), references: `public.${match?.[2]}`,
      referencedColumns: match?.[3]?.split(",").map(value => value.trim()),
      onDelete: /ON DELETE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)/u.exec(definition)?.[1]?.toLowerCase() ?? "no action",
      onUpdate: /ON UPDATE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)/u.exec(definition)?.[1]?.toLowerCase() ?? "no action" };
  });
  const normalize = (values: any[]) => values.map(value => JSON.stringify({
    columns: value.columns, references: value.references, referencedColumns: value.referencedColumns,
    onDelete: value.onDelete, onUpdate: value.onUpdate,
  })).sort();
  if (JSON.stringify(normalize(currentKeys)) !== JSON.stringify(normalize(previous.foreignKeyDependencies))) {
    corrections.push({ table: table.table, correction: "Actual target FK dependency multiset differs from provisional inventory.",
      provisionalForeignKeys: previous.foreignKeyDependencies, actualForeignKeys: table.foreignKeys } as any);
  }
}
actual.provisionalCorrections = corrections;
actual.externalData = prior.externalDataReferences.codeReferences;
actual.sourceFaultProvenance = {
  function: "appointment_cancel_email_fault_ba4be4fa_f647_4c52_b8f8_ef3a36b7",
  implementation: "artifacts/api-server/src/lib/appointment-routes.test.ts:1273",
  introducingCommit: "fcc7ae09",
  finding: "Body matches the cancellation-email enqueue fault-injection test introduced in fcc7ae09. The tracked test uses an unsuffixed function name. The exact actor/run that created the UUID-suffixed source object is not established by retained Git evidence; no attribution is invented.",
  sourceAttachedTriggers: 0, targetCount: 0,
};
for (const table of actual.tables) {
  if (table.table === "public.education_salon_cleanup_reports") {
    table.businessDecisions = ["Migration-generated cleanup evidence differs between source and target; owner must choose preservation/provenance policy. No implicit overwrite or exclusion."];
  }
}
await writeFile(new URL("docs/data-transfer/inventory.json", root), `${JSON.stringify(actual, null, 2)}\n`);
const lines = [
  "# Migration-built data-transfer inventory", "",
  "Authority: the owned PostgreSQL 16 target was built by `applyMigrations` loading migrations 000001–000004. The source dump was restored only into the same runner's separately named disposable source database. Source metadata/counts were read in one REPEATABLE READ READ ONLY transaction. No source migration-ledger rows were read.", "",
  "Actual output:", "```text",
  (await readFile(new URL(".local/data-transfer/inventory.log", root), "utf8")).trim(), "```", "",
  "## Corrections to the provisional inventory", "",
  "- `public.education_salon_cleanup_reports` **exists** in the migration-built target and contains one migration-generated receipt. Source also contains one row. The original source-only classification was wrong; it is now compare-with-seeded-rows and requires a provenance decision.",
  "- The six provisional `order_items` nullability differences were Drizzle representation artifacts. Actual PostgreSQL source and migration-built target agree. No nullability drift remains.",
  "- All other provisional column-difference locations remain: seven target-only columns and one changed default. The raw catalog values—not normalized Drizzle expressions—are recorded in inventory.json.",
  "- The actual target has 256 application tables, ten seeded tables and 28 seed rows; not the provisional 255 tables and nine seeded-table classification.",
  "- The target FK dependency multiset also differs from the provisional inventory on the tables listed below (including additional canonical duplicate FKs and the aftercare reference). Exact prior and actual definitions are retained in inventory.json:",
  ...corrections.filter((entry: any) => entry.provisionalForeignKeys).map((entry: any) =>
    `  - \`${entry.table}\`: provisional ${entry.provisionalForeignKeys.length} FK entries; actual target ${entry.actualForeignKeys.length} FK entries.`),
  "- Source has 24 user triggers and 22 application functions. Actual target has 24 user triggers and 21 application functions; these are now measured target-side facts.", "",
  "## Per-table inventory", "",
  "The JSON companion records each foreign-key name, referenced table, complete definition, all raw source and target columns (type, nullability, default, generated/identity attributes), each difference, seed location, and owner-decision flags. Counts below are actual restored/source and freshly migrated/target counts. Transfer is the default; compare-with-seeded-rows is a blocking reconciliation proposal, not permission to remove or overwrite seeds. The operational migration ledger alone is never transferred.", "",
  "Migration 000001 creates the baseline schema and does not seed application rows. The ten seeded tables receive their rows from migration 000002; each exact INSERT line is recorded in `seededBy`. An empty `seededBy` means neither migration seeds that table.", "",
  "| Table | Source rows | Target seed rows | FK dependencies | Column differences | Proposed classification | Owner decision |",
  "|---|---:|---:|---|---:|---|---|",
  ...actual.tables.map((table: any) => `| \`${table.table}\` | ${table.sourceCount} | ${table.seededTargetCount} | ${[...new Set(table.foreignKeys.map((fk: any) => fk.target))].join(", ") || "—"} | ${table.columnDifferences.length} | ${table.proposal} | ${table.businessDecisions.length ? "required" : "—"} |`),
  "", "## Raw column differences", "",
  ...actual.tables.flatMap((table: any) => table.columnDifferences.map((difference: any) =>
    `- \`${table.table}.${difference.column}\`: **${difference.kind}**; source \`${JSON.stringify(difference.source)}\`; target \`${JSON.stringify(difference.target)}\`.`)),
  "", "## Business decisions — not exclusions", "",
  "Every table remains included unless an owner explicitly names an exclusion. All snapshot data is demo data, so promotion/retention of *any* snapshot row is itself an owner decision for a future real move. This proof does not approve it. Specific additional decisions:",
  ...actual.tables.filter((table: any) => table.businessDecisions.length).map((table: any) => `- \`${table.table}\`: ${table.businessDecisions.map((flag: any) => typeof flag === "string" ? flag : JSON.stringify(flag)).join("; ")}`),
  "", "## Target trigger inventory and prevention", "",
  "The transfer engine refuses ALWAYS/REPLICA user triggers, sets transaction-local `session_replication_role=replica` for loading, then restores origin mode. Ordinary application triggers and FK triggers are suppressed; explicit FK/check/unique/exclusion validation is therefore required before commit. No application service or external delivery worker is started by the tool. Suppression does not itself decide how future workers should handle transferred pending messages; that is an owner decision.", "",
  "| Table | Trigger | Function | Effect |", "|---|---|---|---|",
  ...actual.targetTriggers.map((trigger: any) => `| \`${trigger.table}\` | \`${trigger.name}\` | \`${trigger.function}\` | ${trigger.effect} |`),
  "", "## Actual target functions", "",
  "| Function | Attached triggers | Definition SHA-256 | Effect |", "|---|---:|---|---|",
  ...actual.targetFunctions.map((fn: any) => `| \`${fn.name}\` | ${fn.attachedTriggers} | \`${fn.definitionHash}\` | ${fn.effect} |`),
  "", "## Unattached source fault-injection function", "",
  "`appointment_cancel_email_fault_ba4be4fa_f647_4c52_b8f8_ef3a36b7` has zero attached triggers in the restored source and is absent from the migration-built target. Its function body matches the cancellation-email enqueue fault injection in `artifacts/api-server/src/lib/appointment-routes.test.ts:1273`, introduced in commit `fcc7ae09`. The function raises when the customer-cancellation email outbox insert occurs; it is test instrumentation, not application schema authority. The retained tracked implementation uses the unsuffixed name: the exact historical actor/run responsible for this UUID-suffixed object cannot be proved from these artifacts and is not asserted. Data transfer copies no functions or triggers.", "",
  "## Data outside PostgreSQL", "",
  ...actual.externalData.map((item: any) => `- **${item.category}**: ${item.transferConcern} Code references: ${item.references.map((ref: any) => typeof ref === "string" ? `\`${ref}\`` : `\`${JSON.stringify(ref)}\``).join(", ")}.`),
  "", "Database object paths/URLs copy as shared column values. The tool does not fetch or copy blobs, re-sign URLs, copy credentials, send mail/SMS, or validate provider ownership. Object-storage ownership, blob migration, URL reachability and external-provider configuration need separate phase-8 approval.", "",
];
await writeFile(new URL("docs/data-transfer/inventory.md", root), lines.join("\n"));
console.log(`INVENTORY_DOCUMENTED tables=${actual.tables.length} triggers=${actual.targetTriggers.length} functions=${actual.targetFunctions.length} corrections=${corrections.length}`);