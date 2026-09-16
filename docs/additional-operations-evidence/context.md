# Additional operations audit context

## Evidence read

* Current crosswalk: `pnpm --filter @workspace/scripts exec tsx ./src/startup-migration-crosswalk.ts --json`, pinned to source commit `6e7ac9411eb454b4aeddccd46444df1aa7e120bc`.
* Historical inventory: `scripts/src/production-startup-ddl-baseline.json`.
* Immutable canonical baseline:
  `lib/db/migrations/000001_canonical_schema/migration.sql` (19,416 lines;
  SHA-256 `643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`).
* Startup index: `artifacts/api-server/src/index.ts`.
* Migration runner: `scripts/src/migrations/runner.ts`.
* Eight owner modules named by the baseline, including the seven non-Business
  Growth modules fully reviewed for the companion report and the relevant
  Business Growth source spans.

Crosswalk metadata reports eight owners, 1,459 historical DDL occurrences,
1,435 unique fingerprints/mappings, and 110 additional operations. It pins
the same canonical checksum above. All 1,435 mappings and all 110 additional
operations are currently `UNRESOLVED`. This audit did not alter that
crosswalk, canonical migration, or any source/pin.

## Actual startup order

The API executes these top-level awaited calls in
`artifacts/api-server/src/index.ts:81-92`, before it starts database listeners,
calls `app.listen`, creates scheduled jobs, or launches the scheduler sweep:

1. `ensureBusinessGrowthSchema()` — line 84
2. `ensureMediaSchema()` — line 85
3. `ensureShippingConfigSchema()` — line 86
4. `ensureMarketplacePerformanceIndexes()` — line 87
5. `ensureReferralSchema()` — line 88
6. `ensureWebPushSchema()` — line 89
7. `ensureBookingCommandSchema()` — line 90
8. `ensureEducationBundlePurchaseSchema()` — line 91
9. `reconcileKnownTestListings()` — line 92 (not one of the eight schema owners)

They are sequential `await`s with no production/environment predicate around
the **owner invocations**. Any thrown error prevents subsequent calls and
prevents `listen()` at line 100. Thus each owner is invoked on every process
start that reaches its call, not once per migration ledger state. This does
**not** mean every operation inside an invoked owner executes: its own
current-state checks, SQL predicates, and branches still control individual
operations. In particular, Business Growth's static roles (line 2695), payment
work (4881/4894), and interim functions are in the missing/behind-marker path;
the current-marker path performs only the repairs before its return
(5039-5125). The source comments at 81-83 explicitly say production does not
run `drizzle-kit push` and present this as additive rollout work.

## Per-owner transaction and lock ordering

| Owner | Ordering / boundary evidenced in current source |
|---|---|
| Business Growth | Outer entry point saves search path/timeouts and applies session timeouts. Inner runner takes `BUSINESS_GROWTH_SCHEMA_ADVISORY_LOCK_KEY`, sets search path, executes most statement-array work in **autocommit** (`business-growth-schema.ts:4982-4989,5134-5138`), then attempts `ROLLBACK`, turns the snapshot-backfill GUC off, and unlocks. Outer finally restores timeouts/search path and releases. |
| Media | Begins transaction → sets local timeouts → takes `hashtext('lumera:media-schema:v1')` lock → loops ordered literals `11-103` → commits; catch attempts rollback; finally attempts unlock/releases (`media-schema.ts:105-109`). |
| Shipping | Begins transaction → local timeouts → `hashtext` advisory lock → helper sets local search path → locks `shipping_rules` with `SHARE ROW EXCLUSIVE` → deletes duplicate rows → creates unique index → commits; catch rollback; finally unlock/releases (`shipping-config.ts:24-38,47-65`). |
| Marketplace | Saves session timeouts → applies session timeouts → numeric advisory lock → four `CREATE INDEX CONCURRENTLY` calls. No transaction is opened; finally unlocks, restores timeouts, releases (`marketplace-performance-schema.ts:16-46`). |
| Referral | Begins transaction → local timeouts → `hashtext('lumera:referral-schema')` lock → schema/data SQL → commits; catch rollback; finally unlock/releases (`referral-schema.ts:12-55`). |
| Web Push | Begins transaction → local timeouts → `hashtext(LOCK_KEY)` lock → ordered inner routine → commits; catch rollback; finally unlock/releases (`web-push-schema.ts:10-24,30-88`). |
| Booking Command | Begins transaction → local timeouts → numeric advisory lock → schema SQL → commits; catch rollback; finally unlock/releases (`booking-command-schema.ts:9-38`). |
| Education Bundle | Begins transaction → local timeouts → **Business Growth's shared numeric advisory lock** → schema/data SQL → commits; catch rollback; finally unlock/releases (`education-bundle-purchase-schema.ts:6-85`). |

Canonical absence checks for the two financial/attribution owners were
performed against the canonical migration using precise protocol signatures,
not a generic `BEGIN` search:

Each check uses these executable whole-file commands, all of which return no
matches: `rg -n -i '^(BEGIN|COMMIT|ROLLBACK);?$' lib/db/migrations/000001_canonical_schema/migration.sql`;
`rg -n -F -e 'pg_advisory_lock(' -e 'pg_advisory_unlock(' lib/db/migrations/000001_canonical_schema/migration.sql`;
and `rg -n -i '^[[:space:]]*SET[[:space:]]+LOCAL[[:space:]]+(lock_timeout|statement_timeout)' lib/db/migrations/000001_canonical_schema/migration.sql`.

- Education Bundle: no `await client.query("begin")`/`"commit"` lifecycle,
  no `SELECT pg_advisory_lock($1)` or matching unlock, and no
  `set_config(..., 'statement_timeout'/'lock_timeout', true)` transaction-local
  timeout sequence in `000001_canonical_schema/migration.sql`.
- Referral: no `await client.query("begin")`/`"commit"` lifecycle, no
  `SELECT pg_advisory_lock($1)` or matching unlock, and no
  `SET LOCAL statement_timeout` / `SET LOCAL lock_timeout` sequence in the
  canonical migration.

These are exact absence searches for transaction, advisory-lock, and local
timeout patterns; an unrelated SQL `BEGIN` token is not evidence of runtime
protocol parity.

The acquisition/release code is concrete evidence of ordering, but it is not
evidence that every cleanup succeeds: several rollback/unlock/restore calls
deliberately use `.catch(() => {})` or suppress cleanup after a primary error.
No conclusion that a full lifecycle is production-safe or idempotent follows
from its locking or `IF [NOT] EXISTS` syntax.

## Migration-runner separation

There is no invocation of `applyMigrations`/`runMigrations` in the API startup
index. The runner exists independently in `scripts/src/migrations/runner.ts`,
with CLI invocation in `scripts/src/migrations/cli.ts:61`.

`applyMigrations` (runner lines 218-259):

1. loads supplied/discovered migrations;
2. takes the migration advisory lock;
3. ensures and reads the migration ledger;
4. validates ledger order/checksums;
5. skips `APPLIED` and `ADOPTED` records;
6. marks the next pending migration `APPLYING`;
7. runs it in manifest order; and
8. records `APPLIED` or `FAILED`.

For a `transactional` migration, the runner executes preconditions, sends
`BEGIN`, sends the whole body, checks postconditions, marks it finished, then
`COMMIT`; it attempts `ROLLBACK` on error (lines 74-92). For a
`nontransactional` migration it splits the SQL lexer-aware at top-level
semicolon boundaries, sends each statement separately, then runs
postconditions (93-98, 101-215). That distinction matters for marketplace
`CREATE INDEX CONCURRENTLY`.

Therefore canonical migration `000001` is separate from API startup:
the runner's ledger controls versioned migration execution when it is used;
the API startup owners have their own per-owner locks/session behavior and no
ledger decision. The canonical dump's object definitions are evidence of final
schema shape only; they do not prove a startup backfill, delete, function
replacement, marker upsert, report read, or advisory-lock/session lifecycle
has occurred.

## Audit limitations

No production connection, state inspection, migration/adoption, test run,
workflow, git operation, runtime restart, or network operation occurred in
this subtask. Required state-dependent checks are enumerated per record in
`other-owners.md` and `other-owners.json`.