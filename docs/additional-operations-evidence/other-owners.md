# Additional startup operations — other owners evidence audit

**Audit boundary.** This companion covers the 16 records assigned to this
report: every `additionalOperations` record whose owner is not
`ensureBusinessGrowthSchema` (12), plus that owner's four
`cleanup-reporting`, `operational-scaffolding`, and `rollout-marker` records.
It deliberately does not assess the other 94 Business Growth records. The
machine-readable, verbatim source evidence is in
[`other-owners.json`](./other-owners.json). No production database was
contacted or inspected, and no source, migration, pin, crosswalk, runtime, or
database state was changed.

## Baseline and scope reconciliation

| Check | Evidence | Result |
|---|---|---|
| Startup owners | Crosswalk `inventory.ownerCount`; baseline owner paths and `src/index.ts:84-91` | 8: Business Growth, Media, Shipping, Marketplace Performance, Referral, Web Push, Booking Command, Education Bundle Purchase |
| Historical DDL occurrences / unique mappings | Crosswalk `inventory.recordCount` / `uniqueFingerprintCount` | 1,459 / 1,435 |
| Additional operations | `additionalOperations.length` | 110 |
| Statuses | Crosswalk status grouping | all 110 additional operations and all 1,435 mappings are `UNRESOLVED`; this report's 16 are `UNRESOLVED` |
| Canonical baseline | Crosswalk `canonicalBaseline`; independently calculated SHA-256 of `lib/db/migrations/000001_canonical_schema/migration.sql` | migration `000001`, SHA-256 `643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60` |
| Assigned-record reconciliation | IDs in JSON and crosswalk selection | 16 distinct IDs: Booking 1, Business Growth selected categories 4, Education Bundle 4, Marketplace 1, Media 1, Referral 2, Shipping 1, Web Push 2 |

The selected categories are: 8 operational-scaffolding, 4 data-backfill, 2
rollout-marker, 1 function-replacement, and 1 cleanup-reporting. The
crosswalk's global statement count (103 executable SQL literals: 70 mutations
and 33 function replacements) applies to all 110 records; this 16-record
slice contains three data-changing `UPDATE`s, one destructive `DELETE`, one
function replacement, and 11 runtime/session/report/marker operations. This
does not purport to reconcile the global 103-literal count; that requires the
complementary Business Growth report.

## Startup and migration context

`artifacts/api-server/src/index.ts:81-92` calls the eight owners
unconditionally and sequentially at module startup, before `listen()` and
workers. The order is: Business Growth (84), Media (85), Shipping (86),
Marketplace (87), Referral (88), Web Push (89), Booking Command (90), then
Education Bundle Purchase (91). Therefore an **owner invocation** is attempted
once per process start only if every preceding owner returns; an error
propagates through top-level `await` and prevents later owners and `listen()`
from being reached. This is not evidence that every operation within an
invoked owner runs: its SQL predicates, relation checks, and marker-controlled
branches still apply. In Business Growth, static roles (2695), payment work
(4881/4894), and interim functions are only in the missing/behind-marker
branch; the current-marker path performs its repairs then returns
(5039-5125). None of the eight owner calls has a `NODE_ENV` predicate.

This startup path does **not** invoke the migration runner. The runner is a
separate CLI/test-facing path (`scripts/src/migrations/runner.ts:218-259`;
`scripts/src/migrations/cli.ts:61`). `applyMigrations` first takes its own
migration advisory lock, ensures/reads a ledger, skips `APPLIED`/`ADOPTED`
rows, marks a pending migration `APPLYING`, then executes migrations in
manifest order. Transactional migration bodies are bracketed by `BEGIN` /
`COMMIT` (runner lines 79-92); nontransactional bodies are lexically split and
sent statement-by-statement (93-98, 101-215). In contrast, these startup
owners use their own locks and mixed transactional/autocommit behavior and
have no ledger check. The canonical schema is a definition baseline, not proof
that historical transformations or runtime actions ran.

## Owner/category summary

| Owner | IDs | Runtime order | Effects and state dependence |
|---|---|---|---|
| Booking Command | 1 | 7th | transaction-local timeout and session advisory lock; relies on a usable client and lock release |
| Business Growth selected | 4 | 1st | session lock/search path/GUC restore; reads a cleanup report; marker existence/version determines fast path; marker upsert changes current marker state |
| Education Bundle Purchase | 4 | 8th | two existing-data updates, payment-immutability function replacement, and one transaction/lock boundary |
| Marketplace Performance | 1 | 4th | session lock and session timeout save/restore around `CREATE INDEX CONCURRENTLY`; no transaction is opened |
| Media | 1 | 2nd | transaction, local timeouts, hash advisory lock around a curated statement array |
| Referral | 2 | 5th | one historical timestamp backfill plus transaction-local timeout and hash advisory lock |
| Shipping | 1 | 3rd | locks table, deletes all but lowest UUID, creates singleton index; data-dependent and destructive |
| Web Push | 2 | 6th | expiration backfill plus transaction-local timeout and hash advisory lock |

## Individual records

### `booking-command/transaction-and-advisory-lock`

**Source and order:** exact executable scaffolding is
`booking-command-schema.ts:9-12,34-38` (the crosswalk locator is
`9-12,35-38`). Its owner is invoked unconditionally in 7th position. It connects, begins a
transaction, calls the local-timeout helper, blocks on numeric advisory lock
`0x42434d44`, then runs its DDL statements before commit. On any failure it
attempts rollback; finally it attempts unlock only if acquired and releases the
client.

**Effects / repetition / state:** This is runtime operational scaffolding,
not a data mutation. Repeating a *successful* lifecycle acquires/releases the
same session lock again; the code proves the `locked` flag gates unlock and the
`finally` releases the client. It does **not** prove that the local timeout
helper has no residual effect beyond the transaction, nor that unlock/rollback
cleanup always succeeds (both cleanup queries intentionally swallow errors).
It depends on current connection, transaction, lock availability, and on the
later DDL's database state. **Repeat safety: UNKNOWN** for the complete
operation, notwithstanding idempotent-looking downstream DDL.

**Canonical comparison:** `000001` defines the receipts table
(`2600-2614`), primary key (`7193-7197`), and the two indexes
(`10343-10353`): schema definition only. It contains no advisory-lock,
transaction-lifecycle, or timeout action. **Assessment: UNRESOLVED.**
Required check: decide how a versioned migration or deployment orchestrator
serializes this schema change and what failure/retry policy replaces startup
cleanup.

### `business-growth/advisory-lock-and-session-state`

**Source and order:** `business-growth-schema.ts:5002-5010,5150-5160,
5171-5197,5201-5204`; 1st owner. `ensureBusinessGrowthSchema` captures the
pooled client's `search_path` and timeouts, applies session timeouts, calls the
inner runner, then restores them and releases the client. The inner runner
takes the shared lock, sets `search_path`, and in `finally` rolls back any
open transaction, turns the session-scoped `lumera.snapshot_backfill` GUC
off, and unlocks. It intentionally executes the main rollout in autocommit
(`4982-4989`, `5134-5138`).

**Effects / repetition / state:** Operational/session behavior, including
current-state-dependent pooled-client cleanup. Owner 1 is invoked on each
startup that reaches it, and this wrapper is entered; its protected rollout
work is not uniformly per-startup. Static roles (2695), payment work
(4881/4894), and interim functions are only in the missing/behind-marker
branch, while the current-marker branch applies its repairs and returns
(`5039-5125`). Lock acquisition serializes entries but is not an idempotency
proof; `SET search_path`, `set_config(..., false)`, timeout restoration, and
their failures depend on the acquired session's prior state. Cleanup errors
can be suppressed when a rollout error already exists. **Repeat safety:
UNKNOWN** as a full lifecycle.

**Canonical comparison:** canonical line 21 contains dump setup
`pg_catalog.set_config('search_path', '', false)` but it is not this runtime
session protocol; searches find no canonical `pg_advisory_lock`, no
`lumera.snapshot_backfill`, and no matching runtime restoration. This is
runtime operational behavior, not represented by canonical schema definition.
**Assessment: UNRESOLVED.** Required check: specify the owner/lifetime of the
lock and GUC when startup DDL disappears, and test pooled-session cleanup
under each failure point.

### `business-growth/cleanup-report-read`

**Source and order:** `business-growth-schema.ts:5175-5184`, after the inner
rollout returns but before the ready log. The owner is invoked on each reached
startup; if the inner runner returns successfully (after whichever
marker-controlled branch applies), this query executes. It executes `SELECT
candidates, detached_users, deleted_salons, retired_salons ... WHERE version =
99`, then logs only if a row exists.

**Effects / repetition / state:** Read-only observation and logging; no source
write. The read itself is repeatable in the narrow sense that it does not
change database rows, but whether it returns/logs is explicitly dependent on
the current report table and row 99. The query can fail if the table is absent;
the preceding inner runner tries to create its shape at `5024-5028`. No
production state was checked. **Repeat safety: conditionally read-only, not
proof of operational safety** (each failed read fails startup).

**Canonical comparison:** `000001` defines the report table and its primary
key (`4291-4301`, `8037-8041`), but has no `SELECT ... WHERE version = 99`,
logging behavior, or evidence of the historical cleanup that would write a
version-99 row. That is schema definition, not report/data provenance.
**Assessment: UNRESOLVED.** Required check: establish whether and where the
v99 cleanup/report write is a reviewed migration, and whether startup still
must require this observation.

### `business-growth/rollout-marker-read`

**Source and order:** `business-growth-schema.ts:5035-5043`; it occurs after
the report-table repair and cover-image repair, inside owner 1. It first asks
`to_regclass($1)` whether `${schemaName}.business_growth_schema_rollout`
exists. Only if present does it read the `singleton = true` version. A version
at least `BUSINESS_GROWTH_SCHEMA_VERSION` selects the fast-path repairs and
returns at `5125`; otherwise the full statement collection is executed.

**Effects / repetition / state:** Read-only marker observation with a control
flow effect. On each successful entry to this point of an invoked owner it
probes the relation, but the version query is itself conditional on relation
existence. The marker table's existence, row presence, and version are current
production database state that was not inspected. Missing row becomes version
0; a malformed/duplicate state is not ruled out by source. **Repeat safety:
UNKNOWN** as it selects materially different rollout work; read-only syntax
does not prove branch equivalence.

**Canonical comparison:** `000001` defines the marker table and primary key
(`2672-2680`, `7225-7229`). It has no `to_regclass` state probe, version
predicate, or fast-path selection. Thus it represents definition, not the
runtime reconciliation decision. **Assessment: UNRESOLVED.** Required check:
migration-ledger adoption state and marker state must be reconciled on an
isolated copy before any retirement decision.

### `business-growth/rollout-marker-write`

**Source and order:** `business-growth-schema.ts:5139-5149`, after the
full statement array loop (`5134-5138`) and only when the fast-path has not
returned. It creates the marker table if missing, then inserts singleton
version/current time or updates both version and `completed_at` on conflict.

**Effects / repetition / state:** Current-data reconciliation/operational
marker write, not historical backfill. It is conditional on the marker read
not selecting the current-version fast path; it runs in autocommit. `ON
CONFLICT` prevents a second singleton row only when the primary-key invariant
exists; it deliberately changes `completed_at` on every qualifying rerun and
can advance a marker after only the current branch's preceding statements.
**Repeat safety: not idempotent as row values; safety UNKNOWN.**

**Canonical comparison:** canonical defines the table/PK (`2672-2680`,
`7225-7229`) but contains no data `INSERT`, upsert, version constant, or
completion timestamp behavior. Schema definition does not represent this
current-state reconciliation. **Assessment: UNRESOLVED.** Required check:
prove the marker accurately records an atomically completed migration state
and replace it with reviewed ledger ownership before removal.

### `education-bundle/learner-id-backfill`

**Source and order:** `education-bundle-purchase-schema.ts:54-58`; this is
8th startup owner, after it has dropped the old target checks (52-53) and
before adding/validating the replacement check (59-63). It assigns
`purchase.learner_user_id = employee.user_id` only for `salon_employee`
purchases with a matching employee and null learner ID.

**Effects / repetition / state:** Existing-data mutation and identity
reconciliation. The `IS NULL` predicate makes already-populated target rows
untouched, so the same resulting data normally causes no matching update on a
second run. That is not proof of correctness or full repeat safety: the
selected employee/user mapping and the actual null rows are production state,
and the statement silently leaves unresolved nulls where no employee/user
match exists, causing subsequent constraint validation to fail. **Repeat
safety: conditional/no-op after successful fill for matching rows; overall
UNKNOWN.**

**Canonical comparison:** `000001` defines nullable `learner_user_id`, the
non-null-in-branch target check, and its user foreign key (`3421-3448`,
`16440-16444`). It contains no historical update from `employees.user_id`.
This is a historical transformation absent from canonical definition.
**Assessment: UNRESOLVED.** Required check: review every candidate and
non-candidate on a backup/isolated snapshot and obtain data-ownership approval
for employee-to-learner identity assignment.

### `education-bundle/payment-reference-backfill`

**Source and order:** `education-bundle-purchase-schema.ts:24-31`; it follows
column add/drop-trigger (22-23) and precedes `SET NOT NULL`, unique index,
check, function, and trigger (32-51). The first update generates
`BND-` plus the first 30 hyphen-free UUID characters and writes the same
reference into JSON; the second makes JSON `reference` match any existing
`payment_reference`.

**Effects / repetition / state:** Existing payment data mutation. The first
predicate is `payment_reference IS NULL`; the second uses `IS DISTINCT FROM`.
They provide concrete convergence predicates, but do not prove the generated
30-character references are unique across actual historical UUIDs, nor that
changing an existing JSON snapshot is legally/financially correct. The later
unique index/NOT NULL can fail based on current rows. **Repeat safety:
conditional convergence only; overall UNKNOWN.**

**Canonical comparison:** canonical defines `payment_reference NOT NULL`, the
JSON equality check (`3421-3448`), the unique index (`11162-11165`), the
immutability function (`1693-1706`), and trigger (`14775-14778`). None is a
data backfill. Therefore it represents final schema definition, not generated
payment-reference history. **Assessment: UNRESOLVED.** Required check:
collision analysis against real IDs, financial/audit approval for snapshot
rewrites, and a reviewed compensating/restore plan.

### `education-bundle/payment-reference-function`

**Source and order:** `education-bundle-purchase-schema.ts:39-47`; it is
executed after the two payment updates, not-null/index/check setup, and before
the trigger is recreated at 48-51. `CREATE OR REPLACE FUNCTION` changes the
body used by the trigger to reject either payment field changing on update.

**Effects / repetition / state:** Existing-schema reconciliation, not a data
write. PostgreSQL's replacement syntax makes a second identical definition
replace the body again, but source alone cannot prove equivalence to the
currently installed definition or compatibility with all trigger callers.
It depends on the function namespace and the trigger/table existing in the
current database. **Repeat safety: syntactically replaceable; semantic safety
UNKNOWN.**

**Canonical comparison:** `000001:1693-1706` contains materially the same
function body and `14775-14778` attaches the matching trigger. This is strong
definition evidence, but it does not prove the production function body,
trigger binding, or prior payment data was corrected. **Assessment:
UNRESOLVED.** Required check: compare installed function and trigger
definitions to canonical in a controlled catalog snapshot and decide whether a
versioned `CREATE OR REPLACE` is required.

### `education-bundle/transaction-and-advisory-lock`

**Source and order:** actual scaffolding is
`education-bundle-purchase-schema.ts:6-8,85`; the crosswalk's `9-12,81-84`
locator also includes ordinary DDL/index literals and omits the `BEGIN` line.
It is 8th in `index.ts`. The owner starts a transaction, sets local timeouts,
takes the *Business Growth* advisory lock, commits after all statements, rolls
back on error, then conditionally unlocks/releases.

**Effects / repetition / state:** Operational locking/transaction behavior;
not a data mutation itself. It serializes with Business Growth only while that
session lock is held, and is state-dependent on connection/lock availability.
The catch ignores rollback failure and the final unlock ignores errors. **Repeat
safety: UNKNOWN** for failure and transaction lifecycle; no claim follows from
the downstream `IF NOT EXISTS` syntax.

**Canonical comparison:** canonical contains final education-bundle objects
but no begin/commit/rollback, advisory-lock, timeout-helper, or pooled-client
protocol. It is not represented as canonical schema definition.
**Assessment: UNRESOLVED.** Required check: document lock-domain ownership and
transaction requirements for moving both data work and DDL out of startup.

### `marketplace/advisory-lock-and-session-state`

**Source and order:** `marketplace-performance-schema.ts:16-20,39-46`; 4th
owner. It saves session timeouts, applies session timeouts, locks, creates four
indexes `CONCURRENTLY` (21-37), then unlocks, restores saved timeouts, releases
the client, and may throw a cleanup error only absent a startup error.

**Effects / repetition / state:** Operational/session scaffolding. It is
deliberately **not** wrapped in a transaction, which is required by
`CREATE INDEX CONCURRENTLY`; timeout and lock state is tied to the particular
pooled connection. The code makes repeated successful attempts reacquire and
release, but restoration can fail and be suppressed. Index validity after
interruption and lock/timeout behavior require current catalog/session state.
**Repeat safety: UNKNOWN.**

**Canonical comparison:** the named indexes are canonical definitions
(`9755-9758`, `13143-13153`, `13374-13377`); canonical has no concurrent-build
execution, advisory lock, or timeout lifecycle. Definition equivalence does
not show a failed concurrent index build was repaired. **Assessment:
UNRESOLVED.** Required check: catalog validity/concurrent-index recovery plan
and a migration mode that preserves nontransactional execution semantics.

### `media/transaction-and-advisory-lock`

**Source and order:** `media-schema.ts:105-109`; 2nd owner. It starts a
transaction, sets local timeouts, locks `hashtext('lumera:media-schema:v1')`,
executes the `statements` array in order (`106`), commits, logs, rolls back on
error, then attempts unlock and releases the client. The grouped curated
literals being protected are exactly `media-schema.ts:11-103`.

**Effects / repetition / state:** Runtime transaction/session/lock
scaffolding. The owner invocation is per reached startup; when its wrapper
reaches the loop, each array member is attempted in source-array order, subject
to preceding success and that member's own database-state behavior.
Rollback/unlock error suppression means full retry safety is not demonstrated.
**Repeat safety: UNKNOWN.**

**Canonical comparison:** `000001` defines media tables/indexes (for example
`4663-4666`, `4857-4906`, `12534-12803`) but has no source-array loop,
transaction lifecycle, local timeout, or hash advisory lock. Those are runtime
operations, not canonical definition. **Assessment: UNRESOLVED.** Required
check: retain a complete ordered migration plan for the array and determine
which session serialization remains necessary.

### `referral/tracking-start-backfill`

**Source and order:** `referral-schema.ts:27-41`; 5th owner, after columns
are added (16-23) and before enum alteration/commit (42-49). It updates only
A/B1 attribution rows that are no longer pending verification and whose
tracking timestamp is null. It chooses the earliest matching verified audit
timestamp, otherwise the qualification's `updated_at`.

**Effects / repetition / state:** Historical data transformation. The null
predicate creates a no-op on later runs for successfully written rows; however
the fallback to `updated_at` is an irreversible policy choice, audit matching
uses JSON text and can have no matching record, and new/current source state
can change which rows qualify before fill. **Repeat safety: conditional
convergence only; overall UNKNOWN.**

**Canonical comparison:** canonical defines the nullable
`tracking_started_at` column (`5645-5663`) and relevant foreign key
(`18560-18564`), but contains no update, audit lookup, channel filter, or
fallback policy. It is schema definition, not historical transformation.
**Assessment: UNRESOLVED.** Required check: business/legal approval for the
fallback and a candidate/outlier review with preserved audit evidence.

### `referral/transaction-and-advisory-lock`

**Source and order:** actual lifecycle is
`referral-schema.ts:12-15,49-55` (crosswalk locator `16-18,48-53` points into
the body rather than the full lifecycle); 5th owner. It opens a transaction,
sets local timeouts, locks `hashtext('lumera:referral-schema')`, runs all
schema/backfill statements, commits; catch rolls back; finally conditionally
unlocks and releases.

**Effects / repetition / state:** Runtime operational scaffolding; lock and
transaction state depend on the selected client and server. Successful
reacquisition/release is evidenced by code, but swallowed rollback/unlock
errors prevent a proof that retries always start cleanly. **Repeat safety:
UNKNOWN.**

**Canonical comparison:** canonical defines referral end-state objects but has
no advisory lock, timeout, transaction, or report of this runtime sequence.
**Assessment: UNRESOLVED.** Required check: migration serialization and
failure-recovery policy for the paired referral backfill.

### `shipping/duplicate-row-cleanup`

**Source and order:** `shipping-config.ts:24-35,47-65`; 3rd owner. The
transaction/lock wrapper calls `runShippingConfigSchemaDdl`, which sets a
transaction-local search path, locks `shipping_rules` in `SHARE ROW EXCLUSIVE`
mode, deletes every row except the ascending-lowest UUID, then creates the
unique expression index. The crosswalk locator `24-35,54-65` omits the helper
call/signature but covers the executable SQL.

**Effects / repetition / state:** Destructive existing-data mutation plus
schema reconciliation. The survivor policy is data-dependent and assumes UUID
lexicographic order represents the approved row. A second run after a
successful cleanup matches no duplicates, but that does not restore deleted
configuration or establish that the initial survivor was correct. A run on an
empty table does not create a row; the unique index only supports later
request-path conflict handling. **Repeat safety: conditionally no-op after
successful deletion; destructive semantic safety UNKNOWN.**

**Canonical comparison:** canonical defines `shipping_rules` (`6536-6548`) and
the singleton index (`14558-14561`), but has no table lock or deletion/survivor
policy. This is a historical/current-data cleanup absent from canonical
definition. **Assessment: UNRESOLVED.** Required check: backup/candidate
inventory, explicit product-owner survivor criteria, restore procedure, and
lock impact review.

### `ensureWebPushSchema/source-discovered-82-dd7107a5f655438a`

**Source and order:** exact literal is `web-push-schema.ts:82`; its owner is
6th. It is ordered after adding `expires_at` if absent (80), before enforcing
not-null (83), and inside the outer transaction/lock established by
`10-24`. It fills a null expiry with `created_at + interval '24 hours'`.

**Effects / repetition / state:** Existing-data expiration backfill. The
null predicate means filled rows are not rewritten by a later run, but the
chosen 24-hour expiry could immediately expire historical deliveries and does
not prove `created_at` is non-null or semantically correct for every row.
Constraint enforcement and actual candidates depend on uninspected production
state. **Repeat safety: conditional convergence only; overall UNKNOWN.**

**Canonical comparison:** canonical defines `expires_at NOT NULL` in
`system_push_deliveries` (`6711-6734`) and its indexes (`14670-14701`), but
has no update/backfill. It is definition only, not historical data policy.
**Assessment: UNRESOLVED.** Required check: review all null candidates and
delivery-retention consequences, and define approved migration/recovery logic.

### `web-push/transaction-and-advisory-lock`

**Source and order:** `web-push-schema.ts:10-24`; 6th owner. It begins a
transaction, applies local timeouts, takes hash advisory lock
`lumera:web-push-schema:v1`, calls the ordered inner DDL routine, commits, or
rolls back on error; finally it conditionally unlocks and releases.

**Effects / repetition / state:** Runtime operational scaffolding. The owner
invocation is per reached startup; the wrapper reaches the inner routine only
when connection/timeout/lock steps succeed, and individual inner SQL remains
subject to its own state. It depends on connection and lock state; cleanup
calls can fail silently. The inner routine's query order is exactly lines
30-88, including the expiration update at 82. **Repeat safety: UNKNOWN.**

**Canonical comparison:** canonical has final push table/index/FK definitions
(`5499-5504`, `6711-6734`, `13437-13447`, `14670-14701`,
`19352-19364`) but no transaction/advisory-lock/timeout protocol. **Assessment:
UNRESOLVED.** Required check: establish versioned transaction boundaries that
pair column addition, backfill, and not-null enforcement.

## Authoritative locator versus expanded audit location

The authoritative crosswalk was not edited. In every JSON record,
`sourcePath` is copied **exactly** from its crosswalk record, including an
individual-literal column position where supplied. Where the audit needed
complete executable context beyond that curated locator, `evidenceSourcePath`
records the broader reviewed range and `sourceEvidence` retains the exact
verbatim source fragments. The differing location is audit evidence, not a
correction to authoritative crosswalk data.

| ID | Authoritative `sourcePath` from crosswalk | Expanded `evidenceSourcePath` |
|---|---|---|
| `booking-command/transaction-and-advisory-lock` | `booking-command-schema.ts:9-12,35-38` | `booking-command-schema.ts:9-12,34-38` |
| `business-growth/advisory-lock-and-session-state` | `business-growth-schema.ts:5002-5010,5153-5160,5190-5204` | `business-growth-schema.ts:5002-5010,5150-5160,5171-5197,5201-5204` |
| `business-growth/cleanup-report-read` | `business-growth-schema.ts:5175-5178` | `business-growth-schema.ts:5175-5184` |
| `business-growth/rollout-marker-read` | `business-growth-schema.ts:5036-5042` | `business-growth-schema.ts:5035-5043` |
| `business-growth/rollout-marker-write` | `business-growth-schema.ts:5145-5148` | `business-growth-schema.ts:5139-5149` |
| `education-bundle/transaction-and-advisory-lock` | `education-bundle-purchase-schema.ts:9-12,81-84` | `education-bundle-purchase-schema.ts:6-8,85` |
| `marketplace/advisory-lock-and-session-state` | `marketplace-performance-schema.ts:18-20,39-44` | `marketplace-performance-schema.ts:16-20,39-46` |
| `referral/transaction-and-advisory-lock` | `referral-schema.ts:16-18,48-53` | `referral-schema.ts:12-15,49-55` |
| `shipping/duplicate-row-cleanup` | `shipping-config.ts:24-35,54-65` | `shipping-config.ts:24-35,47-65` |
| `ensureWebPushSchema/source-discovered-82-dd7107a5f655438a` | `web-push-schema.ts:82:22` | `web-push-schema.ts:82` |
| `web-push/transaction-and-advisory-lock` | `web-push-schema.ts:11-15,18-24` | `web-push-schema.ts:10-24` |

The five remaining report records have no expanded locator because their
authoritative crosswalk `sourcePath` already identifies the audited literal or
function range; their complete current-source evidence remains in
`sourceEvidence`.

## Unresolved questions for independent review

1. Which migration/ledger state, if any, is authoritative for the Business
   Growth marker, and can marker/current schema divergence be safely detected?
2. Are the payment-reference, learner-identity, referral-timestamp, shipping
   survivor, and push-expiry policies approved for every historical row?
3. What backups, candidate counts, collisions, nulls, invalid indexes, and
   function/trigger definitions exist in production? They were intentionally
   not inspected here.
4. Which locks, GUC/search-path/timeout lifecycle, transaction boundaries, and
   `CREATE INDEX CONCURRENTLY` nontransactional behavior must be retained by a
   future migration/deployment mechanism?
5. Can cleanup failure suppression on rollback/unlock/restore cause an unsafe
   retry on a pooled client, and what test proves otherwise?
6. Does the v99 cleanup report have a reviewed writer and should absence of its
   row/table block API startup?

Every assessment remains **UNRESOLVED**. No report record is a resolution,
production-safety determination, or idempotency certification.