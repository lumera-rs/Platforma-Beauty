# Additional startup-operation literal census

**RECONCILIATION COMPLETE.** A direct TypeScript-AST scan found **103** literals: **70 DML + 33 `CREATE OR REPLACE FUNCTION`**. The reproducible repository command `pnpm --filter @workspace/scripts run test:additional-operations-evidence` checks the pinned census and its reconciliation against the crosswalk at source commit `6e7ac9411eb454b4aeddccd46444df1aa7e120bc`.

## Evidence boundary

- Historical inventory: `scripts/src/production-startup-ddl-baseline.json`, SHA-256 `a8bcfc8731d8017f901dde01e04d5fd78ad1f930b0562a6a642d980483f465e2`; 8 owners / 1,459 DDL records.
- Canonical `000001_canonical_schema`: `lib/db/migrations/000001_canonical_schema/migration.sql`, SHA-256 `643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`; 19,416 lines.
- Runner: `scripts/src/migrations/runner.ts`, SHA-256 `4afe2c551a3a3f0560e0ee202d18ab9d1299c305f884995da4cc92b3e254a376`; AST parse clean; observed exports `applyMigrations` 218, `migrationStatus` 269, `adoptBaseline` 306. None was executed.
- `index.ts` AST showed all eight named imports and awaited calls at lines 84–91, before `app.listen` line 100; all eight owner modules parsed cleanly and export their named owner function.

## Machine-readable 103-row proof

The canonical `complete-evidence.json` records retain the full source locations, executable SQL/code, owner and operation IDs used by the audit. `census.json` pins the original complete 103-row census by repository commit and SHA-256 instead of copying or rewriting its literal evidence. The validator reads that pinned artifact and requires the 103/70/33 literal counts, all 110 IDs and their authoritative owner/category/status/source location, and the unchanged hashes of all eight owner modules.

Owner literal cardinalities: Business Growth 96; Media 0; Shipping 1; Marketplace 0; Referral 1; Web Push 1; Booking Command 0; Education Bundle 4. The JSON also includes the baseline’s per-owner DDL cardinality, all nine crosswalk IDs that are intentionally outside this DML/function census, and source checksums for all eight owner modules.

## 110-ID distinction and semantic overlap

The 110 additional-operation IDs are **not** 110 literal nodes. Of them, 101 are represented by the 103 literal rows: `business-growth/bundle-payment-backfill` groups L093/L094 and `education-bundle/payment-reference-backfill` groups L100/L101. Nine IDs are explicitly listed as non-census operational scaffolding or read/report behavior. They are not missing literal links.

Exact duplicate raw SQL: none. The JSON flags repeated terminal function names separately (including `reject_bundle_payment_reference_change` across L091/L095/L102). Different checksums mean same-name/repeated-target evidence alone is **not** proof of equivalent bodies or data effects; it remains a semantic-review overlap, not a deduplication conclusion.

No runtime, database, network, Git, baseline, or application-source mutation was performed by this audit.
