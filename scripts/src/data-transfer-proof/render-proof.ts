import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../../../", import.meta.url);
const snapshotText = await readFile(new URL(".local/data-transfer/snapshot-proof-final.log", root), "utf8");
const successText = await readFile(new URL(".local/data-transfer-engine/canonical-success.log", root), "utf8");
const seedText = await readFile(new URL(".local/data-transfer/seed-calibration.log", root), "utf8");
const snapshot = JSON.parse(await readFile(new URL(".local/data-transfer/snapshot-proof.json", root), "utf8"));
const success = JSON.parse(await readFile(new URL(".local/data-transfer/canonical-success-proof.json", root), "utf8"));
for (const [name, result] of [["snapshot-proof", snapshot], ["canonical-success-proof", success]] as const) {
  await writeFile(new URL(`docs/data-transfer/${name}.json`, root), `${JSON.stringify(result, null, 2)}\n`);
}
const summary = (text: string): string => text.split("\n").filter(line =>
  /^(TRANSFER_RESULT|VERIFICATION|OWNED_CLUSTER_REMOVED|BLOCKER|TRANSFER_ERROR)/u.test(line)).join("\n");
await writeFile(new URL("docs/data-transfer/proof.md", root), [
  "# Disposable transfer proof", "",
  "All database work used owned PostgreSQL 16 clusters with isolated child environments. No development, production, or Neon target or secret was selected. Target databases were built by executing migrations 000001–000004 through `applyMigrations`; no application schema or numbered migration was changed.", "",
  "## Snapshot proof — refused atomically", "",
  "The preserved demo dump was restored into the owned source. The tool ran with default policy: no column drops, no table exclusions, no casts, and no implicit seed reconciliation. Actual final output:", "```text", summary(snapshotText), "```", "",
  "The ten seed-reconciliation blockers are owner decisions, not permission to overwrite seeds or renumber identifiers. The eight FK counts describe the attempted target contents with its own seeds retained; they are **not** evidence that the original source rows themselves violate those FKs. Copying source business references while retaining target seed identifiers produces these prospective-target failures. The transaction rolled back all staged rows.", "",
  "Every one of the 256 table outcomes—including source count, before/after target counts, before/after content hashes, per-table blockers, and engine source/target shared-column hashes—is in [snapshot-proof.json](./snapshot-proof.json). All target data hashes and counts equal their pre-transfer values. Structural and physical fingerprints are also recorded unchanged. No row contents are included.", "",
  "## Drift encountered and handling", "",
  "- Seven target-only nullable columns take their target default, which is NULL: `beauty_job_listings.first_published_at`, `education_b2b_orders.idempotency_key`, `education_b2b_orders.idempotency_fingerprint`, and `salons.entrance_directions`, `salons.intercom`, `salons.floor`, `salons.apartment`.",
  "- `retail_product_reviews.comment` has a source empty-text default and no target default. Shared stored values copy unchanged; no row value is replaced with a new default.",
  "- No source-only columns or type/nullability differences were found between the restored source and the migration-built target. Full raw definitions are in [inventory.json](./inventory.json).",
  "- `education_salon_cleanup_reports` exists on both sides and has one row on each. Its differing receipt content is a seed-reconciliation blocker, not a silently dropped source table.",
  "- Ordinary target triggers are suppressed transaction-locally. Source functions/triggers—including the unattached fault-injection function—are never copied.",
  "- Eight canonical tables have no primary key. Their shared row payloads use deterministic C-collated full-row ordering with duplicate multiplicity preserved; tables with primary keys use primary-key ordering. This is an explicit accommodation for canonical tables lacking a PK, not a schema alteration.",
  "- Stored generated shared columns are omitted from INSERT and recomputed by PostgreSQL, but remain included in source/target verification hashes. Divergent recomputation is a content mismatch and rolls back.", "",
  "## Canonical positive proof", "",
  "A separate owned source was also built by the migration runner. Its seed rows were explicitly aligned byte-for-byte with the fresh target seeds solely to create a synthetic success fixture, then one synthetic `service_categories` business row was added. This is not an automatic reconciliation performed by the tool or authorization to modify the preserved snapshot. The real application `transferData` admission, pinned seed contract, ledger identity check, and all constraints ran.", "",
  "Actual output:", "```text", summary(successText), "```", "",
  "Every transferred table's source count/hash equals its target count/hash. [canonical-success-proof.json](./canonical-success-proof.json) retains all 256 actual outcomes and fingerprints. `target_data_unchanged=false` is correct for this success fixture: the business row committed. The snapshot proof, separately, retained unchanged target data.", "",
  "## Seed calibration", "",
  "The committed seed contract was calibrated only from a fresh migration-built owned target. It covers every application table, including empty tables. The only omitted comparison columns on seeded tables are the explicitly listed generated UUID/time fields below. The fixed supplier identifier is included. Omission is for pristine-target seed admission only: transfer content verification still compares shared identifiers and timestamps, so independently generated seeds require an owner decision.", "",
  "Actual calibration output:", "```text", seedText.trim(), "```", "",
  "## Reproduction", "",
  "From a clean isolated shell with PostgreSQL 16 tools on PATH, run the following commands. They accept no ambient database URL and create their own clusters:", "",
  "```sh",
  'env -i HOME="$HOME" PATH="$PATH" CI=true NODE_ENV=test pnpm --filter @workspace/scripts exec tsx src/data-transfer-proof/inventory.ts',
  'env -i HOME="$HOME" PATH="$PATH" CI=true NODE_ENV=test pnpm --filter @workspace/scripts exec tsx src/data-transfer-proof/run-proof.ts',
  'env -i HOME="$HOME" PATH="$PATH" CI=true NODE_ENV=test pnpm --filter @workspace/scripts exec tsx src/data-transfer-proof/run-proof.ts --success',
  "```", "",
  "Inventory/snapshot reproduction additionally needs the preserved dump and provisional inventory outside Git. The synthetic success fixture does not. The calibration command is a reviewed repository-maintenance action, not an operator option for accepting a dirty target.", "",
].join("\n"));
console.log(`PROOF_DOCUMENTED snapshot_tables=${snapshot.outcomes.length} snapshot_blockers=${snapshot.report.blockers.length} success_tables=${success.outcomes.length}`);