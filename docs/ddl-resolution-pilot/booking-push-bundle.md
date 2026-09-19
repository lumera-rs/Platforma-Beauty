# DDL resolution pilot: booking, Web Push, and education-bundle trigger

## Scope and selection

This is a read-only DDL crosswalk pilot. It selects exactly three distinct
fingerprints:

1. one booking-command scoped unique index;
2. one Web Push additive column (`expires_at`); and
3. one education-bundle trigger creation.

The three were selected because they cover different review risks while
remaining in three different startup owners and source-order positions:

* the booking index tests a dynamic-schema uniqueness boundary without a row
  mutation;
* the Web Push column tests an additive existing-database transition that is
  coupled to an existing-row expiry backfill; and
* the education-bundle trigger tests exact function-body and trigger-binding
  semantics, including a financial immutability policy.

No neighboring fingerprint is silently collapsed into one of these selections.
Each selected fingerprint has one occurrence in the immutable inventory. The
full executable SQL literal, source position, source order, dynamic expansion,
and execution path are retained below. This document does not create, propose,
authorize, or schedule a migration.

The immutable comparison point for every mapping is migration `000001`,
`lib/db/migrations/000001_canonical_schema/migration.sql`, SHA-256
`643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`.
The crosswalk evidence reports `evidence.semanticsVerified: false` for all
three selected mappings. A manually reviewed raw/semantic comparison is
recorded below, but that comparison does not change the crosswalk state.

No actual disposable-environment result was found for these mappings. The only
disposable evidence found was integration-test source; it was not executed and
no disposable runtime result was available. Consequently, no real runtime
equivalence is proven here.

### Gate-result convention

`PASSED` below means that the cited static evidence satisfies that particular
evidence statement. `UNKNOWN — NOT SATISFIED` means that the evidence is
missing or unavailable, including unavailable production evidence.
`FAILED — NOT SATISFIED` means that available evidence contradicts the gate
or shows a required semantic/transition difference. A partially matching
fresh definition does not satisfy an existing-production or transition gate.
In particular, no production connection or state inspection was made; every
production-dependent gate is explicitly `NOT SATISFIED`.

The labels are the methodology's three status families:

* **CB1-CB7** are the `CANONICAL_BASELINE` gates.
* **FM1-FM7** are the `FUTURE_MIGRATION_REQUIRED` gates.
* **RH1-RH6** are the `RETIRED_HISTORICAL` gates.

All three mappings, and every named additional-operation dependency, remain
**`UNRESOLVED`**.

## Mapping 1 — booking-command scoped unique index

### Crosswalk identity and occurrence

* **Fingerprint:** `129cb111342ead768c0787a5db0580c3cf9965d634827dc0960cf3d817a74b2b`
* **Operation kind:** `create-index`
* **Summary:** `CREATE UNIQUE INDEX IF NOT EXISTS booking_command_receipts_scope_key_unique ON ${schema}.booking_command_receipts`
* **Identity:** `kind=index`, `schema=<dynamic>`,
  `name=booking_command_receipts_scope_key_unique`,
  `parent=booking_command_receipts`
* **Crosswalk dynamic expression:** `booking_command_receipts_scope_key_unique ON ${schema}.booking_command_receipts`
* **Existing-data effect:** `existing-schema-reconciliation`
* **Crosswalk dependencies:** `schema:<dynamic>`;
  `table:<dynamic>.booking_command_receipts`
* **Status:** **`UNRESOLVED`**
* **Crosswalk canonical evidence:** migration `000001`; checksum
  `643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`;
  `evidenceType=no-candidate-name-match`; `lineReferences=[]`;
  `semanticsVerified=false`.

There is exactly one occurrence:

| Field | Exact value |
|---|---|
| Owner | `ensureBookingCommandSchema` |
| Source locator | `artifacts/api-server/src/lib/booking-command-schema.ts:27:7` |
| Source position | `literalLine=26`, `literalColumn=24`, `operationLine=27`, `operationColumn=7` |
| Source SQL checksum | `37a86984602b0bee372a5cfeff16ce1e55441a636b4a54da4e45a96f6d02d467` |
| Execution order | `2` within the sourced owner SQL |
| Call site | `artifacts/api-server/src/index.ts:90:7` |
| Phase | `pre-listen` |
| Execution path | `artifacts/api-server/src/index.ts` → `artifacts/api-server/src/lib/booking-command-schema.ts::ensureBookingCommandSchema` → `artifacts/api-server/src/lib/booking-command-schema.ts:26:11` |

The complete executable SQL statement (`sourceSql`) is shown here; the
whitespace-only trailing line is empty in this display. The checksum above
identifies the original literal, including its original whitespace.

```sql

      CREATE UNIQUE INDEX IF NOT EXISTS booking_command_receipts_scope_key_unique
      ON ${schema}.booking_command_receipts (salon_id, actor_type, actor_id, idempotency_key)

```

At runtime, `schemaName` defaults to `"public"` and must match
`/^[a-z_][a-z0-9_]*$/i`; the owner then forms the quoted identifier
`"${schemaName}"`. Thus `${schema}` expands to `"public"` by default, or to
the quoted caller-supplied schema name. The identifier is not a value
parameter. The owner call itself is unconditional seventh startup order, but
this statement is reached only after the table statement at source order 1
succeeds and before the ordinary actor/created index at order 3.

### Canonical exact slice and semantic comparison

The parent table is defined in the canonical fresh baseline at
`migration.sql:2600-2614`:

```sql
-- Name: booking_command_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_command_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    idempotency_key text NOT NULL,
    command_type text NOT NULL,
    payload_fingerprint text NOT NULL,
    response_status integer NOT NULL,
    response_body jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
```

The exact canonical index slice is `migration.sql:10349-10353`:

```sql
--
-- Name: booking_command_receipts_scope_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX booking_command_receipts_scope_key_unique ON public.booking_command_receipts USING btree (salon_id, actor_type, actor_id, idempotency_key);
```

**Actual comparison:** after substituting `schemaName=public`, the source and
canonical definitions have the same index name, parent relation, uniqueness,
key order, and key set. PostgreSQL's ordinary default index method is btree,
so the absent source `USING btree` is not a key-semantics difference. The
source has `IF NOT EXISTS`, while the canonical slice is a fresh-database
definition; `IF NOT EXISTS` would not reconcile an existing index of the wrong
definition. The source also permits any validated runtime schema, whereas the
canonical object is only `public`. The canonical slice therefore establishes
a fresh-public shape match, not full transition equivalence. The dynamic
identity is why the generated crosswalk candidate evidence has no line
references; the exact manual slice above is not a claim that the evidence
gate was automatically satisfied.

### Fresh versus existing evidence

* **Fresh database:** `000001` creates the parent table and the unique index
  in the slices above. The startup owner creates its parent table first and
  then this index in one transaction. With `schemaName=public` and the
  required `salons` dependency present, the final key definition is
  shape-equivalent.
* **Existing database:** no production catalog, index definition, duplicate
  count, parent-table state, or dependent application release was inspected.
  Existing duplicate `(salon_id, actor_type, actor_id, idempotency_key)` keys
  could make index creation fail. An existing same-named index could also
  have a different definition while `IF NOT EXISTS` declines to reconcile it.
  The runtime can target a non-public schema that is not represented by the
  canonical slice.
* **Data effect:** the selected statement does not update or delete rows, but
  it changes the catalog and enforces uniqueness for subsequent writes. The
  crosswalk's conservative effect is `existing-schema-reconciliation`; no
  production invariant has been proved.

### Execution, locks, timeouts, recovery, and business decisions

The owner is the seventh awaited startup call at
`artifacts/api-server/src/index.ts:90`; the owner call has no environment
predicate, but preceding owner failure prevents reaching it. On a reached
call, source lines 9-12 begin a transaction, call
`setLocalStartupDdlTimeouts`, and acquire numeric advisory lock
`LOCK_KEY=0x42434d44`. The selected index runs at order 2, then the owner
commits at line 34. A failure attempts rollback; the catch on rollback
suppresses rollback failure, and the finally block conditionally attempts
unlock (also suppressing unlock failure) before releasing the client.
The operation is not `CREATE INDEX CONCURRENTLY`; its ordinary index/table
locks and wait behavior under concurrent writers have not been established.
The timeout helper is `SET LOCAL lock_timeout = '30s'` followed by
`SET LOCAL statement_timeout = '30s'` (the helper's
`STARTUP_DDL_TIMEOUT` is exactly `"30s"`).

Canonical header lines 1-9 declare `lumera:mode transactional` and the
recovery text “Transaction rollback leaves the database unchanged; resolve
the SQL error before retrying”; lines 16-25 set `statement_timeout=0`,
`lock_timeout=0`, `idle_in_transaction_session_timeout=0`, and other session
settings. The canonical migration has no matching startup advisory-lock,
client-release, or suppressed-cleanup protocol. Recovery of the committed
catalog change, retry behavior after a swallowed cleanup error, and timeout
restoration after connection failure remain unknown.

The business decision is the idempotency scope represented by the ordered
four-key tuple. No approval evidence establishes that this scope is the
intended invariant for every supported caller or that duplicate historical
rows are safe to reject.

### Additional-operation dependency

The exact dependency ID from `complete-evidence.json` is:

* **`booking-command/transaction-and-advisory-lock`** — status
  `UNRESOLVED`; owner `ensureBookingCommandSchema`; source path
  `artifacts/api-server/src/lib/booking-command-schema.ts:9-12,35-38`;
  evidence path
  `artifacts/api-server/src/lib/booking-command-schema.ts:9-12,34-39`.
  Its recorded execution is an unconditional seventh top-level await that
  begins the transaction, applies local timeouts, takes `LOCK_KEY`, runs DDL,
  commits or attempts rollback, and conditionally unlocks/releases. Its
  recorded effect is runtime transaction/local-timeout/advisory-lock/client
  scaffolding; lifecycle repeat safety is `UNKNOWN`; production state was not
  inspected. Its recorded uncertainties are which migration/deployment
  serialization replaces the lock, whether suppressed rollback/unlock errors
  leave a retry-safe pooled session, and which later DDL actions need a
  transaction. This ID is not resolved by the selected index's static
  comparison.

### Resolution gates

| Gate | Result | Evidence result |
|---|---|---|
| **CB1** | **PASSED** | The exact executable literal, dynamic `${schema}` expansion, owner, unconditional call site, order 2, one occurrence, and execution path are recorded above. |
| **CB2** | **PASSED** | The parent and exact canonical index SQL slices are reproduced and raw source text is compared with the canonical text. |
| **CB3** | **FAILED — NOT SATISFIED** | Public fresh key order and uniqueness match, but dynamic schema scope, `IF NOT EXISTS` behavior, existing same-name definitions, and runtime transition semantics are not equivalent evidence. |
| **CB4** | **UNKNOWN — NOT SATISFIED** | Fresh-public shape is documented; existing rows, duplicate invariants, existing catalog definitions, and concurrent writers are unknown. |
| **CB5** | **FAILED — NOT SATISFIED** | Source transaction/30-second local timeouts/numeric lock and canonical transactional runner settings differ and are not proven equivalent or stronger for this transition; cleanup suppression and ordinary index-lock behavior remain open. |
| **CB6** | **UNKNOWN — NOT SATISFIED** | No production target identity, catalog/data invariant, dependent application behavior, or execution evidence exists. |
| **CB7** | **UNKNOWN — NOT SATISFIED** | Independent review of all preceding evidence and open dependencies is absent. |
| **FM1** | **PASSED (evidence framing only)** | The unresolved delta is specified statement-by-statement: dynamic runtime schema versus canonical public scope, `IF NOT EXISTS`, duplicate handling, and startup protocol versus canonical definition. This does not authorize a future migration or change status. |
| **FM2** | **UNKNOWN — NOT SATISFIED** | No unique future manifest ID, immutable SQL plan, checksum, transaction mode, dependencies, preconditions, postconditions, recovery procedure, or approved data-effect statement exists. |
| **FM3** | **UNKNOWN — NOT SATISFIED** | Fresh shape is described, but no approved existing-production transition evidence covers duplicates, locks, concurrent writers, retries, partial completion, or application compatibility. |
| **FM4** | **UNKNOWN — NOT SATISFIED** | No read-only production catalog/data evidence or verified target/precondition evidence exists. |
| **FM5** | **UNKNOWN — NOT SATISFIED** | No owner decision, business authorization for the scope, restore/compensation decision, or rollback boundary exists. |
| **FM6** | **UNKNOWN — NOT SATISFIED** | The exact additional-operation dependency ID is identified, but no complete approved ordering or independently safe nontransactional recovery exists. |
| **FM7** | **UNKNOWN — NOT SATISFIED** | No independent reviewer has approved a future-migration plan. |
| **RH1** | **FAILED — NOT SATISFIED** | Reachability is current and unconditional at the seventh startup call; the historical action is demonstrably still reachable, rather than proven unreachable on supported, overlap, or recovery paths. |
| **RH2** | **UNKNOWN — NOT SATISFIED** | A public canonical index is identified, but dynamic scope and existing-transition equivalence are unresolved. |
| **RH3** | **UNKNOWN — NOT SATISFIED** | Production deployment, catalog shape, duplicate invariant, dependent releases, and dependencies are uninspected. |
| **RH4** | **UNKNOWN — NOT SATISFIED** | Pending compatibility, duplicate cleanup, lock lifecycle, and committed historical effects are unknown. |
| **RH5** | **UNKNOWN — NOT SATISFIED** | No removal owner, release boundary, observability, or rollback plan is evidenced. |
| **RH6** | **UNKNOWN — NOT SATISFIED** | Independent retirement review is absent. |

**Non-authoritative recommendation (candidate category):**
**Insufficient evidence**. Mapping status remains **`UNRESOLVED`**; do not
infer resolution from the public fresh index match.

## Mapping 2 — Web Push additive `expires_at` column

### Crosswalk identity and occurrence

* **Fingerprint:** `73652e83d9b635b78ec2067dfc2a786decd9a7f279976fffe768eef1f63c0b20`
* **Operation kind:** `alter-table`
* **Summary:** `ALTER TABLE ${schema}.system_push_deliveries ADD COLUMN IF NOT EXISTS expires_at timestamptz`
* **Identity:** `kind=table`, `schema=<dynamic>`,
  `name=system_push_deliveries`
* **Crosswalk dynamic expression:** `${schema}.system_push_deliveries`
* **Existing-data effect:** `existing-schema-reconciliation`
* **Crosswalk dependencies:** `schema:<dynamic>`
* **Status:** **`UNRESOLVED`**
* **Crosswalk canonical evidence:** migration `000001`; checksum
  `643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`;
  `evidenceType=no-candidate-name-match`; `lineReferences=[]`;
  `semanticsVerified=false`.

There is exactly one occurrence:

| Field | Exact value |
|---|---|
| Owner | `ensureWebPushSchema` |
| Source locator | `artifacts/api-server/src/lib/web-push-schema.ts:80:23` |
| Source position | `literalLine=80`, `literalColumn=22`, `operationLine=80`, `operationColumn=23` |
| Source SQL checksum | `50dcfc53278645c321c677c9f73bc2d3ac64431316cd0d52d380028b2acccbd1` |
| Execution order | `6` within the sourced owner SQL |
| Call site | `artifacts/api-server/src/index.ts:89:7` |
| Phase | `pre-listen` |
| Execution path | `artifacts/api-server/src/index.ts` → `artifacts/api-server/src/lib/web-push-schema.ts::ensureWebPushSchema` → `artifacts/api-server/src/lib/web-push-schema.ts::runWebPushSchemaDdl` → `artifacts/api-server/src/lib/web-push-schema.ts:80:9` |

The complete executable SQL literal (`sourceSql`) is:

```sql
ALTER TABLE ${schema}.system_push_deliveries ADD COLUMN IF NOT EXISTS expires_at timestamptz
```

`ensureWebPushSchema` defaults `schemaName` to `"public"` and
`quotedSchema` accepts only `/^[a-zA-Z_][a-zA-Z0-9_]*$/`, then expands
`${schema}` to the quoted identifier `"${schemaName}"`. The expansion is
dynamic identifier text, not a parameter. The owner call is unconditional in
sixth startup position; this operation is reached only after the preceding
type/table/index statements in `runWebPushSchemaDdl` succeed. The selected
statement is immediately followed by the separate `acknowledged_at` add,
the separate line-82 `expires_at` update, `SET NOT NULL`, and indexes. Those
adjacent statements remain visible in the dependency evidence below but are
not additional selected DDL mappings.

### Canonical exact slice and semantic comparison

The exact canonical table slice is `migration.sql:6711-6734`:

```sql
--
-- Name: system_push_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_push_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    subscription_id uuid NOT NULL,
    user_id uuid NOT NULL,
    payload jsonb NOT NULL,
    status public.system_push_delivery_status DEFAULT 'queued'::public.system_push_delivery_status NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    claim_token text,
    claimed_at timestamp with time zone,
    claim_expires_at timestamp with time zone,
    last_attempt_at timestamp with time zone,
    last_http_status integer,
    last_error text,
    sent_at timestamp with time zone,
    acknowledged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
```

**Actual comparison:** the source add uses `IF NOT EXISTS` and declares
`expires_at timestamptz` without `NOT NULL`; the canonical fresh table
declares the equivalent PostgreSQL type as `timestamp with time zone NOT
NULL`. Conditional source-only observation: if the preceding source table
creation succeeded with exactly that definition, this selected add would
encounter an existing `expires_at` and be a no-op under `IF NOT EXISTS`; no
database evidence verifies that precondition. On an existing table that lacks
the column, the selected statement first creates a nullable column, then the
separate line-82 backfill and line-83 `ALTER COLUMN ... SET NOT NULL` perform
a data-dependent transition. The canonical slice contains no 24-hour
backfill. Thus type/final-column presence matches the fresh baseline, but the
selected existing transition and its coupled data policy do not have canonical
equivalence.

### Fresh versus existing evidence

* **Fresh database:** the source's `CREATE TABLE` literal has
  `expires_at timestamptz NOT NULL`, and the canonical slice has
  `expires_at timestamp with time zone NOT NULL`. Conditional source-only
  observation: if the preceding source table creation succeeded with exactly
  that definition, this selected `ADD COLUMN` would encounter an existing
  `expires_at` and be a no-op under `IF NOT EXISTS`. No database evidence
  verifies that precondition; this is not a production idempotence or runtime
  equivalence finding.
* **Existing database:** no production table definition, column null count,
  `created_at` distribution, expiry policy, concurrent writer behavior, or
  application version was inspected. A legacy table can receive a nullable
  column, and the line-82 update may rewrite every null row before the
  not-null transition. A pre-existing same-named column with a divergent type
  is not reconciled by `IF NOT EXISTS`.
* **Data effect:** the selected `ADD COLUMN` alone changes schema and does not
  update rows. The directly coupled additional operation at line 82 fills
  null `expires_at` values with `created_at + interval '24 hours'`; that is an
  existing-data mutation and is not silently attributed to the selected DDL
  fingerprint. The crosswalk effect for the selected mapping remains
  `existing-schema-reconciliation`.

### Execution, locks, timeouts, recovery, and business decisions

The owner begins at `web-push-schema.ts:10-25`: it connects, sends
`begin`, applies `SET LOCAL lock_timeout = '30s'` and
`SET LOCAL statement_timeout = '30s'` through the timeout helper, takes
`select pg_advisory_lock(hashtext($1))` for
`LOCK_KEY="lumera:web-push-schema:v1"`, invokes the ordered inner routine,
and commits. Failure attempts rollback and rethrows; rollback failure is
swallowed. Finally, unlock is attempted only when `locked` is true, unlock
failure is swallowed, and the client is released. The line-80 statement is
inside this transaction and lock; it is an ordinary `ALTER TABLE`, not a
concurrent operation. The operation is conditionally reached after earlier
queries succeed, despite the unconditional owner invocation.

Canonical header lines 1-9 identify `000001` as transactional and describe
rollback recovery; lines 16-25 set session timeouts to zero rather than
providing this owner’s 30-second local timeout/lock protocol. The canonical
table definition has no startup advisory lock, client cleanup, or line-82
backfill. Retry behavior after suppressed cleanup failure, lock duration,
partial completion, and timeout restoration after connection failure remain
unknown.

The business decision is whether historical delivery rows should receive a
retroactive 24-hour expiry derived from `created_at`, and whether that policy
is compatible with delivery retention and acknowledgment workflows. No
business authorization or row-level evidence establishes that decision.

### Additional-operation dependencies

The exact dependency IDs from `complete-evidence.json` are:

* **`web-push/transaction-and-advisory-lock`** — status `UNRESOLVED`; owner
  `ensureWebPushSchema`; source path
  `artifacts/api-server/src/lib/web-push-schema.ts:11-15,18-24`;
  evidence path `artifacts/api-server/src/lib/web-push-schema.ts:10-25`.
  The recorded execution is unconditional sixth-owner invocation, transaction,
  local timeouts, hash advisory lock, inner source order 30-88, commit or
  rollback, and unlock/release. Its effect is runtime transaction/local
  timeout/advisory-lock scaffolding; repeat safety is `UNKNOWN`; production
  state is uninspected. Its exact unresolved questions are what versioned
  transaction sequence will pair column/backfill/not-null and whether lock
  cleanup is proven under connection loss.
* **`ensureWebPushSchema/source-discovered-82-dd7107a5f655438a`** — status
  `UNRESOLVED`; owner `ensureWebPushSchema`; source path
  `artifacts/api-server/src/lib/web-push-schema.ts:82:22`; evidence path
  `artifacts/api-server/src/lib/web-push-schema.ts:82`. Its exact source
  evidence records the surrounding executable sequence:

  ```sql
    await client.query(`ALTER TABLE ${schema}.system_push_deliveries ADD COLUMN IF NOT EXISTS expires_at timestamptz`);
    await client.query(`ALTER TABLE ${schema}.system_push_deliveries ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz`);
    await client.query(`UPDATE ${schema}.system_push_deliveries SET expires_at = created_at + interval '24 hours' WHERE expires_at IS NULL`);
    await client.query(`ALTER TABLE ${schema}.system_push_deliveries ALTER COLUMN expires_at SET NOT NULL`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS system_push_deliveries_event_subscription_unique ON ${schema}.system_push_deliveries(event_key, subscription_id)`);
  ```

  Its recorded execution is after the add-if-absent success and before
  `SET NOT NULL`, inside the owner transaction/lock. Its effect is the
  existing-data expiration backfill; repeat safety is conditional convergence
  but overall `UNKNOWN`; production is uninspected. The exact recorded
  uncertainties are whether historical expiry semantics are truly 24 hours
  and how many nulls exist or will be retroactively affected.

These IDs identify coupled evidence; neither additional operation is resolved
by the canonical column slice.

### Resolution gates

| Gate | Result | Evidence result |
|---|---|---|
| **CB1** | **PASSED** | The exact add-column literal, dynamic expansion, owner, unconditional call site, source order 6, one occurrence, and execution path are recorded above. |
| **CB2** | **PASSED** | The exact canonical table slice is reproduced and the source type/nullability text is compared with it. |
| **CB3** | **FAILED — NOT SATISFIED** | Fresh final type/column shape matches, but nullable legacy addition, `IF NOT EXISTS`, the separate 24-hour backfill, and later not-null transition are not semantically represented by the canonical definition. |
| **CB4** | **UNKNOWN — NOT SATISFIED** | Fresh behavior is described; existing null rows, existing column definitions, expiry policy, concurrent writers, and application compatibility are unknown. |
| **CB5** | **FAILED — NOT SATISFIED** | Source transaction/30-second local timeouts/hash lock and canonical migration settings differ and are not proven equivalent for a lock-sensitive add/backfill/not-null sequence; suppressed cleanup and partial failure remain open. |
| **CB6** | **UNKNOWN — NOT SATISFIED** | No production catalog, row counts, null invariant, target identity, dependent behavior, or execution evidence exists. |
| **CB7** | **UNKNOWN — NOT SATISFIED** | Independent review confirming the source/canonical and transition evidence is absent. |
| **FM1** | **PASSED (evidence framing only)** | The unresolved delta is specified statement-by-statement: nullable dynamic add, line-82 24-hour update, later not-null enforcement, and canonical fresh-only definition. This does not authorize a future migration or change status. |
| **FM2** | **UNKNOWN — NOT SATISFIED** | No unique manifest ID, immutable SQL plan, checksum, mode, recovery procedure, dependencies, preconditions, postconditions, or explicit approved data-effect statement exists. |
| **FM3** | **UNKNOWN — NOT SATISFIED** | Fresh conditional behavior and the legacy path are described, but no approved existing transition covers nulls, locks, writers, retries, partial completion, or compatibility. |
| **FM4** | **UNKNOWN — NOT SATISFIED** | No read-only production evidence identifies the actual table/column/null state or proves transition preconditions. |
| **FM5** | **UNKNOWN — NOT SATISFIED** | No owner or business decision approves retroactive expiry, restore/compensation, or a rollback boundary. |
| **FM6** | **UNKNOWN — NOT SATISFIED** | Both exact additional-operation IDs are identified, but no complete approved ordering and independently safe recovery exists for the coupled backfill and DDL. |
| **FM7** | **UNKNOWN — NOT SATISFIED** | No independent reviewer has approved a future-migration plan. |
| **RH1** | **FAILED — NOT SATISFIED** | The Web Push owner is currently an unconditional sixth startup call; the historical action is demonstrably still reachable, rather than proven unreachable on supported or recovery paths. |
| **RH2** | **UNKNOWN — NOT SATISFIED** | A canonical fresh column exists, but existing transition and backfill equivalence are unresolved. |
| **RH3** | **UNKNOWN — NOT SATISFIED** | Production deployment, column/data state, dependent versions, and required coupled operations are uninspected. |
| **RH4** | **UNKNOWN — NOT SATISFIED** | Pending expiry, retention, acknowledgment, lock, retry, and data-policy obligations are unknown. |
| **RH5** | **UNKNOWN — NOT SATISFIED** | No explicit removal owner, release boundary, observability, or rollback evidence exists. |
| **RH6** | **UNKNOWN — NOT SATISFIED** | Independent retirement review is absent. |

**Non-authoritative recommendation (candidate category):**
**Insufficient evidence**. Mapping status remains **`UNRESOLVED`**; do not
treat the conditional source-only observation as proof of the legacy
add/backfill transition.

## Mapping 3 — education-bundle payment-reference immutability trigger

### Crosswalk identity and occurrence

* **Fingerprint:** `be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3`
* **Operation kind:** `create-trigger`
* **Summary:** `CREATE TRIGGER education_bundle_purchases_payment_reference_immutable`
* **Identity:** `kind=trigger`, `schema=<dynamic>`,
  `name=education_bundle_purchases_payment_reference_immutable`,
  `parent=education_bundle_purchases`
* **Existing-data effect:** `existing-schema-reconciliation`
* **Crosswalk dependencies:** `schema:<dynamic>`;
  `table:<dynamic>.education_bundle_purchases`
* **Status:** **`UNRESOLVED`**
* **Crosswalk canonical evidence:** migration `000001`; checksum
  `643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`;
  `evidenceType=candidate-name-match`;
  `lineReferences=[migration.sql:14775,migration.sql:14778]`;
  `semanticsVerified=false`.

There is exactly one occurrence of this create-trigger fingerprint. The nearby
`DROP TRIGGER IF EXISTS` statements are different DDL fingerprints and are not
collapsed into this mapping:

| Field | Exact value |
|---|---|
| Owner | `ensureEducationBundlePurchaseSchema` |
| Source locator | `artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:49:25` |
| Source position | `literalLine=49`, `literalColumn=24`, `operationLine=49`, `operationColumn=25` |
| Source SQL checksum | `fc3da8600bf4e60a2ec1b2f78189bc2c70ee590210d48f52e88049645867d165` |
| Execution order | `10` within the sourced owner SQL |
| Call site | `artifacts/api-server/src/index.ts:91:7` |
| Phase | `pre-listen` |
| Execution path | `artifacts/api-server/src/index.ts` → `artifacts/api-server/src/lib/education-bundle-purchase-schema.ts::ensureEducationBundlePurchaseSchema` → `artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:49:11` |

The complete executable SQL literal (`sourceSql`) is:

```sql
CREATE TRIGGER education_bundle_purchases_payment_reference_immutable
      BEFORE UPDATE OF payment_reference, payment_instructions ON ${schema}.education_bundle_purchases
      FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_bundle_payment_reference_change()
```

`schemaName` defaults to `"public"` and must match
`/^[a-z_][a-z0-9_]*$/i`; the source forms the quoted `"${schemaName}"`.
Both the trigger parent and function reference therefore expand dynamically.
The owner is the eighth unconditional awaited startup call. Within that
owner, this create is reached after the payment-reference backfills, not-null
and constraint work, function replacement at source lines 39-47, and the
different drop-trigger operation at line 48. It is followed by the target
constraint drops and learner backfill.

### Cross-owner ordering and final-state boundary

`ensureBusinessGrowthSchema` is the first startup owner
(`artifacts/api-server/src/index.ts:84:7`).  Its selected
`71356...` occurrence is a conditional validation probe in the non-fast-path
statement array, not a target-check replacement and not the payment-trigger
body.  Its current-version fast path has separate target-check and payment
trigger fingerprints at source lines `5088-5123`; those are not silently
collapsed into either selected mapping here.

`ensureEducationBundlePurchaseSchema` is the eighth owner
(`artifacts/api-server/src/index.ts:91:7`).  It replaces the payment function
at lines `39-47`, drops the old trigger at `48`, and creates the selected
binding at `49-51`.  It then drops old target checks at `52-53`, performs the
learner-ID backfill at `54-58`, and adds/validates the replacement target check
at `59-63`.  If this owner transaction commits, the later eighth-owner
function/trigger binding and target-check sequence is the relevant source-level
final state; that conditional ordering is not evidence of the production
catalog, row correctness, or successful validation.

### Original function body and canonical exact evidence

The trigger's original executable function replacement, preserved because
trigger semantics depend on it, is at
`artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:39-47`:

```sql
CREATE OR REPLACE FUNCTION ${schema}.reject_bundle_payment_reference_change() RETURNS trigger AS $$
      BEGIN
        IF NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
          OR NEW.payment_instructions IS DISTINCT FROM OLD.payment_instructions THEN
          RAISE EXCEPTION 'education bundle payment_reference is immutable; payment instructions are immutable';
        END IF;
        RETURN NEW;
      END
    $$ LANGUAGE plpgsql
```

The exact canonical function body is `migration.sql:1693-1706`:

```sql
--
-- Name: reject_bundle_payment_reference_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_bundle_payment_reference_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
          OR NEW.payment_instructions IS DISTINCT FROM OLD.payment_instructions THEN
          RAISE EXCEPTION 'education bundle payment_reference is immutable; payment instructions are immutable';
        END IF;
        RETURN NEW;
      END
    $$;
```

The exact canonical trigger slice is `migration.sql:14775-14778`:

```sql
--
-- Name: education_bundle_purchases education_bundle_purchases_payment_reference_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER education_bundle_purchases_payment_reference_immutable BEFORE UPDATE OF payment_reference, payment_instructions ON public.education_bundle_purchases FOR EACH ROW EXECUTE FUNCTION public.reject_bundle_payment_reference_change();
```

**Actual semantic comparison:** after substituting `schemaName=public`, the
source trigger and canonical trigger have the same trigger name, parent table,
`BEFORE UPDATE OF payment_reference, payment_instructions` event, `FOR EACH
ROW` granularity, and function name. The source function body and canonical
function body have the same two `IS DISTINCT FROM` predicates, the same
exception text, and the same `RETURN NEW`; `CREATE OR REPLACE` versus
canonical fresh `CREATE FUNCTION`, whitespace, and the source's omitted
statement terminator do not alter that body. The body comparison is therefore
a real semantic match for the shown public text, not a name-only match.

That match does not establish transition equivalence. The source replaces the
function, drops any existing trigger, and creates a new binding in a dynamic
schema during startup. The canonical migration creates a fresh public
function/binding and does not encode function replacement, trigger rebinding,
ownership, privileges, search-path behavior, advisory lock, or existing
catalog state. The function is an additional operation with its own
`UNRESOLVED` evidence, so the trigger mapping cannot inherit resolution from
the matching body.

The conditional source-level postcondition, if the eighth-owner transaction
commits, is that this trigger binding exists and points to the function body
installed immediately beforehand at lines `39-47`.  The create-trigger
statement does not itself backfill payment rows, prove that the function was
accepted by the target catalog, or establish that the later target-check
replacement and learner-ID reconciliation completed.  No production
postcondition is claimed.

### Fresh versus existing evidence

* **Fresh database:** canonical lines 1693-1706 and 14775-14778 establish the
  public function and binding. The source's public final trigger semantics
  match those exact slices when the required parent columns and function
  dependencies exist.
* **Existing database:** no production `pg_get_functiondef`, trigger binding,
  parent-column state, owner, privileges, search path, existing trigger
  existence, or deployed application version was inspected. The source's
  function replacement and drop/create sequence can change write acceptance
  immediately; `IF EXISTS` only makes the drop conditional and does not prove
  safe replacement or recovery.
* **Data effect:** creating the trigger does not itself rewrite rows. It
  changes whether updates changing either payment field are accepted. The
  coupled payment-reference backfill rewrites existing financial snapshots
  before the trigger is recreated, but that is a separate additional operation
  and is not attributed to this create-trigger fingerprint.

### Execution, locks, timeouts, recovery, and business decisions

The owner source lines 6-8 begin one transaction, apply local 30-second
timeouts, and take `BUSINESS_GROWTH_SCHEMA_ADVISORY_LOCK_KEY` through
`SELECT pg_advisory_lock($1)`. The selected trigger runs at source order 10,
after all preceding statements succeed, and the owner commits at line 85.
Failure attempts rollback and rethrows; rollback failure is swallowed. The
finally block conditionally attempts the shared advisory unlock, swallows
unlock failure, and releases the client. The lock is shared with the
Business Growth owner by design in source, but lock serialization and
connection-loss behavior are not production-proven.

Canonical `000001` is transactional by header, but its object slices do not
contain the startup `BEGIN`/`COMMIT`, local 30-second timeout, shared numeric
lock, cleanup suppression, dynamic schema expansion, or trigger drop/rebind
protocol. A trigger-function replacement can fail after a prior drop or can
leave a different deployed body/privilege state; retry is not a recovery
proof.

The business decision is the financial/audit policy that both
`payment_reference` and its JSON `payment_instructions` snapshot are
immutable after the startup reconciliation. The exact exception behavior is
visible in the function body, but no business owner, production financial
record evidence, compensation decision, or restore boundary was supplied.

### Additional-operation dependencies

The exact four Education Bundle additional-operation IDs from
`complete-evidence.json` are all `UNRESOLVED`.  “Direct” below means that the
operation mutates a field/table defined by the mapping or supplies its
function; “indirect” means that it supplies the owner transaction/advisory
lock or changes later data/catalog state without being required by the trigger
binding itself:

| Relationship to selected create-trigger mapping | Exact ID | Source path | Recorded effect |
|---|---|---|---|
| Direct semantic dependency | `education-bundle/payment-reference-function` | `artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:39-47` | Replaces the function body invoked by the trigger; existing-schema reconciliation |
| Indirect operational dependency | `education-bundle/transaction-and-advisory-lock` | `artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:9-12,81-84` (evidence `:6-8,85`) | Brackets function/trigger work in the eighth-owner transaction and shared advisory lock |
| Direct preceding data dependency | `education-bundle/payment-reference-backfill` | `artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:24-31` | Rewrites payment references and JSON snapshots before function/trigger work |
| Indirect later target-state dependency | `education-bundle/learner-id-backfill` | `artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:54-58` | Assigns `learner_user_id` from employee/user relationships before target-check replacement/validation |

The exact evidence details are:

* **`education-bundle/payment-reference-backfill`** — status `UNRESOLVED`;
  owner `ensureEducationBundlePurchaseSchema`; source path
  `artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:24-31`.
  Its two exact updates generate `BND-` plus the first 30 characters of the
  UUID with `payment_reference IS NULL`, then rewrite the JSON reference when
  it is `IS DISTINCT FROM payment_reference`. Its recorded execution is
  before not-null, unique-index, snapshot-check, function, and trigger work in
  the same transaction. Its effect is existing financial-data mutation;
  repeat safety is overall `UNKNOWN` because uniqueness and snapshot policy
  are unverified; current purchase rows and JSON were not inspected.
* **`education-bundle/payment-reference-function`** — status `UNRESOLVED`;
  owner `ensureEducationBundlePurchaseSchema`; source path
  `artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:39-47`.
  Its exact source body is reproduced above. It runs after the payment updates
  and before the selected trigger, and its recorded effect is existing-schema
  function replacement. Its body changes write acceptance immediately; repeat
  safety is `UNKNOWN`; dependent columns, deployed body, privileges, and
  production state are uninspected.
* **`education-bundle/learner-id-backfill`** — status `UNRESOLVED`;
  owner `ensureEducationBundlePurchaseSchema`; source path
  `artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:54-58`.
  It runs after the target checks are dropped and before the replacement check
  is added/validated at `59-63`, assigning
  `purchase.learner_user_id = employee.user_id` only for matching
  `salon_employee` purchases whose learner ID is null.  Its effect is existing
  learner-identity data mutation; repeat safety is conditional convergence but
  overall `UNKNOWN` because mappings, unmatched rows, and production data were
  not inspected.  It is indirect to the selected trigger and does not supply
  the trigger function body or binding.

  Exact source SQL:

  ```sql
  UPDATE ${schema}.education_bundle_purchases purchase
    SET learner_user_id = employee.user_id
    FROM ${schema}.employees employee
    WHERE purchase.target_type = 'salon_employee' AND purchase.employee_id = employee.id
      AND purchase.learner_user_id IS NULL AND employee.user_id IS NOT NULL
  ```
* **`education-bundle/transaction-and-advisory-lock`** — status `UNRESOLVED`;
  owner `ensureEducationBundlePurchaseSchema`; source path
  `artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:9-12,81-84`;
  evidence path
  `artifacts/api-server/src/lib/education-bundle-purchase-schema.ts:6-8,85`.
  Its recorded execution brackets all Education Bundle statements in one
  transaction and shares the Business Growth advisory lock. Its effect is
  transaction/timeout/lock scaffolding; repeat safety is `UNKNOWN`; rollback
  and unlock failures are suppressed and production state is uninspected.

These exact IDs are dependency evidence, not resolved classifications.  The
learner-ID backfill and the target-check replacement are included to preserve
the eighth-owner ordering, not to imply that learner identity participates in
the payment-trigger body.

### Resolution gates

| Gate | Result | Evidence result |
|---|---|---|
| **CB1** | **PASSED** | The exact create-trigger literal, dynamic parent/function expansions, owner, unconditional call site, source order 10, one occurrence, and execution path are recorded above. |
| **CB2** | **PASSED** | The original function body, canonical function body, and canonical trigger slice are reproduced and compared in raw and semantic terms; this is definition/binding evidence only, not proof of the deployed replacement or its production postcondition. |
| **CB3** | **FAILED — NOT SATISFIED** | Predicates, exception behavior, event columns, row granularity, and function binding match for public fresh text, but dynamic scope, replacement/drop/rebind transition, ownership, privileges, search path, and dependency behavior are not equivalent evidence. |
| **CB4** | **UNKNOWN — NOT SATISFIED** | Fresh public body/binding match is shown; existing deployed body, trigger, columns, permissions, dependent writes, and financial rows are unknown. |
| **CB5** | **FAILED — NOT SATISFIED** | Source shared-lock/30-second local-timeout transaction and function-replacement/drop/create order differ from canonical transactional execution and are not proven safe under partial failure. |
| **CB6** | **UNKNOWN — NOT SATISFIED** | No production function, trigger, owner/privilege, data, dependent application, or execution evidence exists. |
| **CB7** | **UNKNOWN — NOT SATISFIED** | Independent review confirming body, binding, transition, authorization, and rollback evidence is absent. |
| **FM1** | **PASSED (evidence framing only)** | The unresolved delta is specified: source function replacement and trigger drop/create in a dynamic schema versus canonical fresh public function/binding, plus payment backfill, learner-ID backfill/target-check sequencing, and lock dependencies. This does not authorize a future migration or change status. |
| **FM2** | **UNKNOWN — NOT SATISFIED** | No unique manifest ID, immutable SQL plan, checksum, transaction declaration, recovery procedure, dependency ordering, or explicit approved financial data effect exists. |
| **FM3** | **UNKNOWN — NOT SATISFIED** | Fresh body/binding behavior is compared, but no approved existing transition covers deployed bodies, trigger replacement, concurrent writes, retries, partial completion, or compatibility. |
| **FM4** | **UNKNOWN — NOT SATISFIED** | No read-only production evidence identifies function/trigger/privilege/data state or proves transition preconditions. |
| **FM5** | **UNKNOWN — NOT SATISFIED** | No approved financial business owner, restore/compensation decision, or rollback boundary exists for payment-reference immutability and snapshot changes. |
| **FM6** | **UNKNOWN — NOT SATISFIED** | All four exact additional-operation dependency IDs are identified with direct/indirect relationships, but no complete approved ordering or independently safe recovery exists across payment backfill, function replacement, trigger binding, learner-ID/target-check work, and shared lock. |
| **FM7** | **UNKNOWN — NOT SATISFIED** | No independent reviewer has approved a future-migration plan. |
| **RH1** | **FAILED — NOT SATISFIED** | The owner and trigger path remain reachable at the eighth startup call; the historical replacement is demonstrably still reachable, rather than proven unreachable on supported or recovery paths. |
| **RH2** | **UNKNOWN — NOT SATISFIED** | Canonical fresh function and binding are identified and body-matched, but transition, dynamic-schema, and existing-state equivalence remain unresolved. |
| **RH3** | **UNKNOWN — NOT SATISFIED** | Production deployment of the replacement body/binding, privileges, data dependencies, and dependent releases is uninspected. |
| **RH4** | **UNKNOWN — NOT SATISFIED** | Pending financial and learner-identity backfills, target-check replacement, function/trigger lifecycle, lock, compatibility, and audit obligations are unknown. |
| **RH5** | **UNKNOWN — NOT SATISFIED** | No removal owner, release boundary, observability, or rollback evidence exists for the trigger policy. |
| **RH6** | **UNKNOWN — NOT SATISFIED** | Independent retirement review is absent. |

**Non-authoritative recommendation (candidate category):**
**Insufficient evidence**. Mapping status remains **`UNRESOLVED`**; do not
infer trigger equivalence from matching names or the matching fresh function
body alone.

## Pilot conclusion

The selected IDs are exactly:

* `129cb111342ead768c0787a5db0580c3cf9965d634827dc0960cf3d817a74b2b`
* `73652e83d9b635b78ec2067dfc2a786decd9a7f279976fffe768eef1f63c0b20`
* `be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3`

Static source and canonical slices establish useful fresh-shape comparisons,
but no selected mapping satisfies all applicable CB, FM, or RH gates. Missing
production evidence is explicitly `NOT SATISFIED`, all mapping statuses remain
`UNRESOLVED`, and none of the exact additional-operation dependency IDs is
resolved by this pilot.