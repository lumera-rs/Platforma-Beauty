# DDL resolution pilot — four other-owner mappings

## Scope and review boundary

This is a documentation-only pilot covering **exactly four distinct DDL
fingerprints**: one media mapping, one shipping mapping, one marketplace
concurrent-index mapping, and one referral mapping. It is not an authorization
to execute, adopt, replay, remove, or replace any startup operation. No
production connection, production inspection, migration execution, application
run, test run, network operation, or runtime DB module was used for this
report.

No real disposable execution results were found; the available disposable
evidence is integration-test source only. That source is not treated as a
runtime result or production proof.

The immutable comparison point is migration `000001` at
`lib/db/migrations/000001_canonical_schema/migration.sql`, SHA-256
`643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`.
Its header declares `lumera:mode transactional`; the startup owners below
have their own runtime transaction or nontransactional behavior. The source
inventory is `scripts/src/production-startup-ddl-baseline.json`, and the
crosswalk implementation is `scripts/src/startup-migration-crosswalk.ts`.
The crosswalk's generated `semanticsVerified` field is `false` for the
candidate-name mappings below; a name match is not treated as semantic proof.

The selected fingerprint IDs are:

| Owner/category | Selected fingerprint | Mapping represented here |
|---|---|---|
| Media | `7cfee093bb641c194587456e373508589806368a08b9cc7cec9f74f862498b7d` | `CREATE TABLE IF NOT EXISTS image_assets` |
| Shipping | `c91656618e3ed810da898b8389d35bed601bffaf49e74b9523491f90d403ed48` | dynamic-schema singleton unique index |
| Marketplace | `aaf9e97329d1d6edc7b5ee7a933a16677766066a331139bf540521ed366955f4` | `appointments_employee_date_status_idx`, `CREATE INDEX CONCURRENTLY` |
| Referral | `a570f58ac2bc80fb8a0ee829d4b2c1aa66953b680261069bbbade8d1020c4ff1` | dynamic-schema `tracking_started_at` column addition |

Every selected mapping, and every related additional-operation record cited
below, remains **`UNRESOLVED`**. Gate dispositions use only `PASSED`, `FAILED`,
or `UNKNOWN`. `PASSED` means that the narrow gate is evidenced at the stated
scope; it never changes the mapping status. Missing evidence is written
`UNKNOWN — NOT SATISFIED`; counterevidence is written
`FAILED — NOT SATISFIED`. Any unavailable production-state, authorization,
recovery, or independent-review evidence is explicitly `UNKNOWN — NOT
SATISFIED`, rather than inferred from source text, a fresh canonical dump,
tests, or object names.

Gate labels use the methodology in
`docs/additional-operations-evidence/DDL-RESOLUTION-METHODOLOGY.md`:
`CB1-7` are `CANONICAL_BASELINE` gates, `FM1-7` are
`FUTURE_MIGRATION_REQUIRED` gates, and `RH1-6` are
`RETIRED_HISTORICAL` gates. `FM1` is marked `PASSED` only as the
“unresolved delta exists” trigger for future review; it is not a future
migration decision.

## Why these four were selected

* **Media** is the comparatively simple, additive case: one table-definition
  fingerprint has a static canonical candidate, while still exposing
  unqualified identifiers, parent-object dependencies, and transaction
  lifecycle differences.
* **Shipping** is the complex destructive-coupling case: the selected DDL
  statement creates the canonical singleton expression index, but it is
  dynamically schema-qualified and is ordered after a destructive duplicate
  deletion that is represented by a separate additional-operation ID.
* **Marketplace** is the required concurrent-index case: the index key and
  order match the canonical index, but `CONCURRENTLY`, no transaction, session
  timeout restoration, interrupted-index recovery, and concurrent writers make
  transition equivalence a separate question.
* **Referral** is an additive dynamic-schema case coupled to a data-changing
  tracking backfill. The selected DDL is small and shape-comparable, while the
  associated business timestamp policy prevents treating the column addition
  as a complete resolution.

These choices deliberately include both a simple shape candidate and cases in
which runtime behavior or existing data is the material semantic delta.

---

## 1. Media — `image_assets` table creation

### Mapping identity and crosswalk facts

* **Fingerprint:** `7cfee093bb641c194587456e373508589806368a08b9cc7cec9f74f862498b7d`
* **Operation kind:** `create-table`
* **Crosswalk summary:** `CREATE TABLE IF NOT EXISTS image_assets`
* **Object identity:** `{ "kind": "table", "schema": "public", "name": "image_assets" }`
* **Crosswalk existing-data effect:** `existing-schema-reconciliation`
* **Crosswalk status:** `UNRESOLVED`
* **Crosswalk dependencies:** `schema:public`
* **Crosswalk preconditions:** all referenced parent objects and existing rows
  satisfy the reviewed operation semantics; the operation has been compared
  with the immutable canonical migration or an approved future migration.
* **Crosswalk postconditions:** the reviewed `table.public.image_assets`
  identity has the approved definition; existing production data is preserved
  or changed only by an explicitly reviewed backfill.
* **Crosswalk rollback consideration:** application rollback must remain
  compatible with the resulting catalog and data state.
* **Crosswalk canonical evidence:** migration `000001`, checksum
  `643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`;
  `candidate-name-match`; line references
  `4663, 4666, 8253, 8256, 8261`; `semanticsVerified: false`.

### Complete occurrence inventory

There is **one occurrence**, and it is reproduced in full. The occurrence is
the second classified operation in the media source's ordered SQL literals
(the first is the preceding enum-creation literal), hence `executionOrder: 2`.

* **Owner:** `ensureMediaSchema`
* **Source locator:** `artifacts/api-server/src/lib/media-schema.ts:17:6`
* **Source position:** `literalLine: 17`, `literalColumn: 5`,
  `operationLine: 17`, `operationColumn: 6`
* **Call site:** `artifacts/api-server/src/index.ts:85:7`
* **Phase:** `pre-listen`
* **Execution path, in source order:**
  `artifacts/api-server/src/index.ts` →
  `artifacts/api-server/src/lib/media-schema.ts::ensureMediaSchema` →
  `artifacts/api-server/src/lib/media-schema.ts:106:49`
* **Exact source SQL:**

```sql
CREATE TABLE IF NOT EXISTS image_assets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      original_filename text NOT NULL,
      source_content_type text NOT NULL,
      source_size integer NOT NULL,
      staging_object_path text NOT NULL,
      original_object_path text,
      original_width integer,
      original_height integer,
      variants jsonb,
      status image_asset_status NOT NULL DEFAULT 'pending',
      alt_text text NOT NULL DEFAULT '',
      failure_reason text,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
```

* **Exact source SQL SHA-256:** `761562e0686ccf30c9e2d98d21db6d5ce03feff135eae02d64035ee54d4d7840`
* **No other occurrence** of this fingerprint is present in the selected
  crosswalk occurrence list.

### Canonical exact slices and semantic comparison

The crosswalk candidate references are name matches only. The relevant
canonical enum is exactly the following slice (`000001:823-831`):

```sql
--
-- Name: image_asset_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.image_asset_status AS ENUM (
    'pending',
    'processing',
    'ready',
    'failed'
);
```

The canonical table body is exactly (`000001:4662-4683`):

```sql
--
-- Name: image_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.image_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    uploaded_by_user_id uuid,
    original_filename text NOT NULL,
    source_content_type text NOT NULL,
    source_size integer NOT NULL,
    staging_object_path text NOT NULL,
    original_object_path text,
    original_width integer,
    original_height integer,
    variants jsonb,
    status public.image_asset_status DEFAULT 'pending'::public.image_asset_status NOT NULL,
    alt_text text DEFAULT ''::text NOT NULL,
    failure_reason text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
```

The related canonical constraints are separate exact slices:

```sql
-- 000001:8253-8265
--
-- Name: image_assets image_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_assets
    ADD CONSTRAINT image_assets_pkey PRIMARY KEY (id);


--
-- Name: image_assets image_assets_staging_object_path_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_assets
    ADD CONSTRAINT image_assets_staging_object_path_unique UNIQUE (staging_object_path);
```

The canonical indexes cited by the media owner are (`000001:12534-12544`):

```sql
--
-- Name: image_assets_status_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX image_assets_status_expires_idx ON public.image_assets USING btree (status, expires_at);


--
-- Name: image_assets_uploader_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX image_assets_uploader_created_idx ON public.image_assets USING btree (uploaded_by_user_id, created_at);
```

The canonical parent foreign key is (`000001:17696-17700`):

```sql
--
-- Name: image_assets image_assets_uploaded_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_assets
    ADD CONSTRAINT image_assets_uploaded_by_user_id_users_id_fk FOREIGN KEY (uploaded_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
```

**Semantic comparison, not names only:**

* The source enum labels and order match the canonical enum slice, provided the
  source's preceding `DO` literal creates the same `public.image_asset_status`
  type. The source table uses an unqualified type name; the canonical object is
  explicitly `public.image_asset_status`.
* The source table and canonical table agree on the column set, nullability,
  defaults, `timestamptz` versus canonical `timestamp with time zone`, and
  JSON/text/integer types. The source declares the primary key and
  `uploaded_by_user_id` foreign key inline; canonical `000001` emits those
  constraints later. Inline versus later emission is equivalent only if the
  referenced objects and canonical ordering are valid.
* The source's `REFERENCES users(id)` is unqualified and the source owner does
  not set `search_path` in the shown transaction. The canonical FK is explicitly
  `REFERENCES public.users(id)`. Treating those as equivalent requires a
  target-schema/search-path fact that is not present here.
* The source `IF NOT EXISTS` is a conditional catalog action. It does not
  compare an existing table's columns, defaults, enum type, constraints,
  ownership, or privileges. Canonical presence therefore cannot prove that an
  existing table has the source or canonical definition.
* The source table literal itself creates no rows and does not backfill media
  data. Its owner-level transaction and lock protocol are separate runtime
  semantics, not represented in the table SQL or canonical table slice.

### Fresh versus existing, effects, and runtime protocol

**Fresh database facts.** In a genuinely empty target with the enum, `users`,
`gen_random_uuid()`, and the intended schema available, the source's preceding
enum literal followed by this table literal can create the table. The source
creates an inline primary key and FK; `000001` creates the same end-state
components through table and later-constraint statements. This is static
fresh-shape evidence only, not production evidence.

**Existing database facts and unknowns.** If `image_assets` exists, this
literal can no-op solely because the relation exists. It does not prove column,
default, enum, FK, PK, index, privilege, or owner parity. If it does not exist,
the source adds an empty relation; no existing rows are transformed. The
production relation, search path, extension availability, existing constraints,
and dependent application versions were not inspected. Existing-data
equivalence is therefore unknown.

**Execution condition, transaction, lock, and timeout facts.** The owner
invocation is unconditional when startup reaches the second awaited startup
owner. It begins a transaction, calls `setLocalStartupDdlTimeouts`, which sets
both `lock_timeout` and
`statement_timeout` to `30s`, acquires
`pg_advisory_lock(hashtext('lumera:media-schema:v1'))`, and executes its
ordered array serially. The selected table literal is reached only after the
preceding enum literal succeeds. It commits after the array. On error it
attempts `ROLLBACK`; in `finally` it attempts the advisory unlock and releases
the client. Rollback and unlock errors are swallowed in the source. This
differs from the canonical migration's runner-managed transactional mode and
its header-level timeout settings; the canonical table slice does not
evidence the startup lock/session lifecycle.

**Recovery and business decisions.** A pre-commit table failure is intended to
be transactionally rolled back, but the source does not establish a tested
restore boundary for partial catalog effects or pooled-session cleanup.
Whether the unqualified source names may ever target a non-public schema, and
whether an existing table may be adopted without definition/privilege
reconciliation, are unresolved ownership decisions.

**Additional-operation dependency IDs from `complete-evidence.json`:**

* `media/transaction-and-advisory-lock` — status `UNRESOLVED`; its evidence
  records the owner-level transaction, local timeout, advisory-lock,
  serial-array, rollback, unlock, and release lifecycle. It is operational
  evidence and does not resolve this table mapping.

### Media gate matrix

| Gate | Disposition | Evidence and blocker |
|---|---|---|
| **CB1** — exact executable source, identifiers, order, owner, every occurrence | **PASSED** | One exact literal, full SQL, source position, owner, call site, phase, execution order `2`, and occurrence count are recorded above. |
| **CB2** — canonical definition plus raw/normalized comparison | **PASSED** | The exact enum/table/constraint/index/FK slices and the raw source-versus-canonical comparison are recorded above. The generated `semanticsVerified: false` field is not used to fail this comparison; independent review is CB7. |
| **CB3** — semantic equivalence of types, defaults, constraints, dependencies | **UNKNOWN — NOT SATISFIED** | End-state components appear comparable, but unqualified source identifiers, separate canonical constraints, privileges, and target schema are not proven equivalent. |
| **CB4** — fresh and reviewed existing-database transition equivalence | **UNKNOWN — NOT SATISFIED** | Fresh shape is static only; existing catalog, rows, search path, and divergent definitions are unknown. |
| **CB5** — transaction, preconditions, postconditions, failure behavior, ordering | **FAILED — NOT SATISFIED** | Startup `BEGIN`/30s local timeouts/advisory lock/rollback behavior is not represented by the canonical table definition, and cleanup error behavior differs from the canonical comparison point. |
| **CB6** — production scope, invariants, dependent behavior | **UNKNOWN — NOT SATISFIED** | Production target identity, catalog, data, privileges, and dependent application behavior were not inspected. |
| **CB7** — independent reviewer confirms no open question | **UNKNOWN — NOT SATISFIED** | No independent reviewer disposition is recorded. |
| **FM1** — unresolved operation/delta specified | **PASSED** | The unresolved delta is the startup conditional table action plus search-path/transition behavior; this does not authorize a future migration. |
| **FM2** — unique manifest ID, immutable SQL, mode, checksum, dependencies, recovery | **UNKNOWN — NOT SATISFIED** | No future migration artifact or plan is supplied. |
| **FM3** — separate fresh/existing transition proof | **UNKNOWN — NOT SATISFIED** | No approved transition evidence exists for existing tables or dependent writers. |
| **FM4** — read-only production preconditions | **UNKNOWN — NOT SATISFIED** | No production database or catalog was inspected. |
| **FM5** — destructive/data/function decisions, owner, restore or compensation | **UNKNOWN — NOT SATISFIED** | No approved owner decision covers adoption of potentially divergent existing media schema or restore boundaries. |
| **FM6** — complete dependency/manifest ordering and recovery | **UNKNOWN — NOT SATISFIED** | Enum, `users`, extension, constraints, lock/session cleanup, and runner ordering are not approved as a complete future sequence. |
| **FM7** — independent review before artifact creation or execution | **UNKNOWN — NOT SATISFIED** | Independent approval is absent. |
| **RH1** — historical and unreachable on every path | **FAILED — NOT SATISFIED** | The owner is a current unconditional pre-listen startup call; this is counterevidence to historical unreachability. |
| **RH2** — replacement canonical and transition equivalence | **UNKNOWN — NOT SATISFIED** | Canonical end-state slices exist, but runtime `IF NOT EXISTS`, search-path, and transaction transition equivalence is open. |
| **RH3** — production replacement/schema/data/dependencies present | **UNKNOWN — NOT SATISFIED** | Production evidence is unavailable. |
| **RH4** — no pending backfill, cleanup, compatibility, or audit obligation | **UNKNOWN — NOT SATISFIED** | Existing table drift, dependent media behavior, and compatibility obligations are unknown. |
| **RH5** — owner, release boundary, observability, rollback | **UNKNOWN — NOT SATISFIED** | No retirement boundary or rollback decision is recorded. |
| **RH6** — independent retirement review | **UNKNOWN — NOT SATISFIED** | Independent retirement review is absent. |

**Candidate recommendation (nonauthoritative; category: Insufficient evidence;
no status change):** retain this
media fingerprint as `UNRESOLVED` until a reviewer verifies the target schema
and existing definition, the exact enum/FK/constraint dependencies, and the
owner-level transaction and cleanup behavior.

---

## 2. Shipping — dynamic singleton unique index

### Mapping identity and crosswalk facts

* **Fingerprint:** `c91656618e3ed810da898b8389d35bed601bffaf49e74b9523491f90d403ed48`
* **Operation kind:** `create-index`
* **Crosswalk summary:** `create unique index if not exists ${SHIPPING_RULES_INDEX_NAME} on ${schema}.shipping_rules`
* **Object identity:** `{ "kind": "index", "schema": "<dynamic>", "name": "${SHIPPING_RULES_INDEX_NAME}", "parent": "shipping_rules", "dynamicExpression": "${SHIPPING_RULES_INDEX_NAME} ON ${schema}.shipping_rules" }`
* **Crosswalk existing-data effect:** `existing-schema-reconciliation`
* **Crosswalk status:** `UNRESOLVED`
* **Crosswalk dependencies:** `schema:<dynamic>`,
  `table:<dynamic>.shipping_rules`
* **Crosswalk preconditions:** all referenced parent objects and existing rows
  satisfy the reviewed operation semantics; the operation has been compared
  with the immutable canonical migration or an approved future migration.
* **Crosswalk postconditions:** the reviewed
  `<dynamic>.${SHIPPING_RULES_INDEX_NAME}` identity has the approved
  definition; existing production data is preserved or changed only by an
  explicitly reviewed backfill.
* **Crosswalk rollback consideration:** application rollback must remain
  compatible with the resulting catalog and data state.
* **Crosswalk canonical evidence:** migration `000001`, the pinned checksum,
  `no-candidate-name-match`, no line references, `semanticsVerified: false`.
  The absence of a candidate is caused by the dynamic index and schema
  expressions, not by proof that no canonical object exists.

### Complete occurrence inventory

There is **one occurrence**, and it is reproduced in full. It is the only
classified DDL operation in `runShippingConfigSchemaDdl`, so its
`executionOrder` is `1`.

* **Owner:** `ensureShippingConfigSchema`
* **Source locator:** `artifacts/api-server/src/lib/shipping-config.ts:63:5`
* **Source position:** `literalLine: 62`, `literalColumn: 22`,
  `operationLine: 63`, `operationColumn: 5`
* **Call site:** `artifacts/api-server/src/index.ts:86:7`
* **Phase:** `pre-listen`
* **Execution path, in source order:**
  `artifacts/api-server/src/index.ts` →
  `artifacts/api-server/src/lib/shipping-config.ts::ensureShippingConfigSchema` →
  `artifacts/api-server/src/lib/shipping-config.ts::runShippingConfigSchemaDdl` →
  `artifacts/api-server/src/lib/shipping-config.ts:62:9`
* **Exact source SQL, including the leading newline and trailing spaces:**

```json
"\n    create unique index if not exists ${SHIPPING_RULES_INDEX_NAME}\n    on ${schema}.shipping_rules ((true))\n  "
```

The JSON-escaped representation above is the exact 111-byte source literal:
`"\n    create unique index if not exists ${SHIPPING_RULES_INDEX_NAME}\n    on ${schema}.shipping_rules ((true))\n  "`.

* **Exact source SQL SHA-256:** `898e47ec30bb30dd0c4e6714512479b3b70eca079b9cb188ad5e47d1e8b1233b`
* **No other occurrence** of this fingerprint is present in the selected
  crosswalk occurrence list.

### Canonical exact slices and semantic comparison

The canonical parent table slice is exactly (`000001:6536-6548`):

```sql
--
-- Name: shipping_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    free_shipping_threshold integer DEFAULT 0 NOT NULL,
    tiers jsonb DEFAULT '[]'::jsonb NOT NULL,
    personal_delivery_enabled boolean DEFAULT false NOT NULL,
    personal_delivery_name text DEFAULT 'Lična dostava u Beogradu'::text NOT NULL,
    personal_delivery_price integer DEFAULT 0 NOT NULL,
    personal_delivery_description text DEFAULT 'Dostava na adresu u Beogradu.'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
```

The canonical index slice is exactly (`000001:14558-14561`):

```sql
--
-- Name: shipping_rules_singleton_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX shipping_rules_singleton_unique ON public.shipping_rules USING btree ((true));
```

**Semantic comparison, not names only:**

* With `SHIPPING_RULES_INDEX_NAME` equal to
  `shipping_rules_singleton_unique`, `schemaName` equal to `public`, and the
  expected `search_path`, the source index has the same uniqueness,
  constant-key expression `((true))`, parent relation, and default btree
  access method as the canonical slice. The source does not spell out
  `USING btree`, but btree is PostgreSQL's default.
* That comparison depends on interpolated identifiers and the validated
  `quoteSchema` path. The source index name is a constant, but the relation
  schema is dynamic. The crosswalk cannot infer the production argument from
  the source summary.
* Source `IF NOT EXISTS` can accept an already-named index without checking
  its access method, uniqueness, expression, parent, predicate, or validity.
  Canonical presence of the name is therefore not proof of index-definition
  parity.
* The index statement is executed after `SET LOCAL search_path`, a
  `SHARE ROW EXCLUSIVE` table lock, and a `DELETE` that retains the lowest
  UUID. Those are not represented by the canonical index slice and materially
  change existing-database transition semantics.

### Fresh versus existing, effects, and runtime protocol

**Fresh database facts.** On a fresh target where the selected dynamic schema
and `shipping_rules` table already exist, the expression index can be created
and enforces at most one row. A canonical fresh schema also contains the
same singleton expression index in `public`. The source owner does not create
the parent table in this selected operation.

**Existing database facts and data effects.** The selected DDL statement itself
does not update rows. However, in the same helper and transaction, the
preceding executable statements are:

```sql
set local search_path to ${schema}
lock table ${schema}.shipping_rules in share row exclusive mode

delete from ${schema}.shipping_rules
where id <> (
  select id from ${schema}.shipping_rules order by id asc limit 1
)
```

This is not being counted as another selected DDL mapping. It is a separate
additional operation and a direct business-data effect: every row except the
lowest UUID is deleted before the index is created. Row counts, duplicate
identity, the approved survivor, foreign keys, references, and restore
evidence are unknown. A successful second run may find no duplicates, but that
does not make the first committed deletion reversible or business-correct.

**Execution condition, transaction, lock, and timeout facts.** The owner
invocation is unconditional when startup reaches the third awaited startup
owner. At entry it begins a transaction, sets local `lock_timeout` and
`statement_timeout` to `30s`, and takes
`pg_advisory_lock(hashtext('lumera:shipping-rules-singleton'))`. The selected
index is reached only after the dynamic local search path, the table lock, and
the preceding duplicate-delete statement succeed. The helper takes
`SHARE ROW EXCLUSIVE` on the table, deletes duplicates, creates the index, and
returns to the wrapper for commit. An error causes an attempted rollback;
`finally` attempts advisory unlock and client release, swallowing unlock
errors. The table lock and advisory lock serialize this owner path, but do not
prove safety against writers that do not use that advisory key or against an
incorrect survivor policy.

**Recovery and business decisions.** Before commit, the wrapper's rollback is
the coded recovery behavior. After commit, deleted duplicate rows require a
tested restore or approved compensation; retry, `IF NOT EXISTS`, and the
lowest-UUID heuristic are not recovery. The business decision that the lowest
UUID is the approved shipping configuration is not supplied. The target schema
argument, existing index validity, concurrent writers, lock duration, and
backup/restore boundary are unresolved.

**Additional-operation dependency ID from `complete-evidence.json`:**

* `shipping/duplicate-row-cleanup` — status `UNRESOLVED`; its complete evidence
  records the source order, table lock, destructive deletion, lowest-ID
  survivor policy, current-data dependence, and lack of production inspection.
  The selected DDL cannot be resolved while that coupled data operation is
  unresolved.

### Shipping gate matrix

| Gate | Disposition | Evidence and blocker |
|---|---|---|
| **CB1** — exact executable source, identifiers, order, owner, every occurrence | **PASSED** | One full interpolated literal, dynamic expressions, source position, helper path, call site, phase, and order `1` are recorded above. |
| **CB2** — canonical definition plus raw/normalized comparison | **PASSED** | The exact canonical parent/index slices and the conditional interpolation comparison are recorded above. The dynamic no-candidate evidence is not used to fail this comparison; independent review is CB7. |
| **CB3** — semantic equivalence of types, defaults, constraints, dependencies | **UNKNOWN — NOT SATISFIED** | The expression/index shape can match under specific arguments, but dynamic schema, existing index validity, table state, and dependent-row effects are not proven. |
| **CB4** — fresh and reviewed existing-database transition equivalence | **UNKNOWN — NOT SATISFIED** | Fresh expression shape is static; existing duplicate rows, survivor correctness, index validity, and writer behavior are unknown. |
| **CB5** — transaction, preconditions, postconditions, failure behavior, ordering | **FAILED — NOT SATISFIED** | Runtime transaction/30s timeout/advisory/table-lock/delete/index ordering differs from the canonical index definition, and post-commit recovery is not represented. |
| **CB6** — production scope, invariants, dependent behavior | **UNKNOWN — NOT SATISFIED** | Production target schema, row set, foreign-key dependents, duplicate count, and backup/restore evidence were not inspected. |
| **CB7** — independent reviewer confirms no open question | **UNKNOWN — NOT SATISFIED** | No independent reviewer disposition exists, and the survivor business decision is open. |
| **FM1** — unresolved operation/delta specified | **PASSED** | The unresolved delta includes dynamic interpolation and the coupled destructive cleanup/transition; this does not authorize a future migration. |
| **FM2** — unique manifest ID, immutable SQL, mode, checksum, dependencies, recovery | **UNKNOWN — NOT SATISFIED** | No future migration artifact or plan exists; no safe post-delete recovery boundary is supplied. |
| **FM3** — separate fresh/existing transition proof | **UNKNOWN — NOT SATISFIED** | No approved proof covers duplicate deletion, index build, table locks, concurrent writers, or retries. |
| **FM4** — read-only production preconditions | **UNKNOWN — NOT SATISFIED** | Production row and catalog state were not inspected. |
| **FM5** — destructive/data/function decisions, owner, restore or compensation | **UNKNOWN — NOT SATISFIED** | The approved survivor, deletion owner, backup/restore, and compensation decision are unavailable. |
| **FM6** — complete dependency/manifest ordering and recovery | **UNKNOWN — NOT SATISFIED** | Dynamic schema validation, parent table, destructive cleanup, table lock, index validity, and transaction recovery are not approved as a complete sequence. |
| **FM7** — independent review before artifact creation or execution | **UNKNOWN — NOT SATISFIED** | Independent approval is absent. |
| **RH1** — historical and unreachable on every path | **FAILED — NOT SATISFIED** | `ensureShippingConfigSchema` is a current unconditional pre-listen owner; this is counterevidence to historical unreachability. |
| **RH2** — replacement canonical and transition equivalence | **FAILED — NOT SATISFIED** | The canonical expression index matches only one interpolated end-state; canonical evidence does not represent the runtime cleanup and lock transition. |
| **RH3** — production replacement/schema/data/dependencies present | **UNKNOWN — NOT SATISFIED** | Production evidence is unavailable. |
| **RH4** — no pending backfill, cleanup, compatibility, or audit obligation | **UNKNOWN — NOT SATISFIED** | The duplicate cleanup, survivor decision, and dependent-row obligations remain open. |
| **RH5** — owner, release boundary, observability, rollback | **UNKNOWN — NOT SATISFIED** | No retirement boundary, deletion audit, restore plan, or owner decision is recorded. |
| **RH6** — independent retirement review | **UNKNOWN — NOT SATISFIED** | Independent retirement review is absent. |

**Candidate recommendation (nonauthoritative; category: Insufficient evidence;
no status change):** retain this
shipping fingerprint as `UNRESOLVED` and do not treat the canonical singleton
index name or expression as sufficient until the dynamic target, duplicate
survivor decision, dependent rows, and committed-deletion recovery evidence are
independently reviewed.

---

## 3. Marketplace — concurrent appointments index

### Mapping identity and crosswalk facts

* **Fingerprint:** `aaf9e97329d1d6edc7b5ee7a933a16677766066a331139bf540521ed366955f4`
* **Operation kind:** `create-index`
* **Crosswalk summary:** `create index concurrently if not exists appointments_employee_date_status_idx on appointments`
* **Object identity:** `{ "kind": "index", "schema": "public", "name": "appointments_employee_date_status_idx", "parent": "appointments" }`
* **Crosswalk existing-data effect:** `existing-schema-reconciliation`
* **Crosswalk status:** `UNRESOLVED`
* **Crosswalk dependencies:** `schema:public`,
  `table:public.appointments`
* **Crosswalk preconditions:** all referenced parent objects and existing rows
  satisfy the reviewed operation semantics; the operation has been compared
  with the immutable canonical migration or an approved future migration.
* **Crosswalk postconditions:** the reviewed
  `index.public.appointments_employee_date_status_idx` identity has the
  approved definition; existing production data is preserved or changed only
  by an explicitly reviewed backfill.
* **Crosswalk rollback consideration:** application rollback must remain
  compatible with the resulting catalog and data state.
* **Crosswalk canonical evidence:** migration `000001`, pinned checksum,
  `candidate-name-match`; line references `9755` and `9758`;
  `semanticsVerified: false`.

### Complete occurrence inventory

There is **one occurrence**, the first classified SQL operation in the
marketplace owner, so its `executionOrder` is `1`. The owner then issues three
more concurrent index statements in source order; those are not additional
occurrences of this selected fingerprint.

* **Owner:** `ensureMarketplacePerformanceIndexes`
* **Source locator:** `artifacts/api-server/src/lib/marketplace-performance-schema.ts:22:8`
* **Source position:** `literalLine: 22`, `literalColumn: 7`,
  `operationLine: 22`, `operationColumn: 8`
* **Call site:** `artifacts/api-server/src/index.ts:87:7`
* **Phase:** `pre-listen`
* **Execution path, in source order:**
  `artifacts/api-server/src/index.ts` →
  `artifacts/api-server/src/lib/marketplace-performance-schema.ts::ensureMarketplacePerformanceIndexes`
* **Exact source SQL:**

```sql
create index concurrently if not exists appointments_employee_date_status_idx on appointments (employee_id, appointment_date, status)
```

* **Exact source SQL SHA-256:** `f41a0d91663ad5a69b893a658d25f55cf04fa902a5b442863b1694c0da6fafc9`
* **No other occurrence** of this fingerprint is present in the selected
  crosswalk occurrence list.

### Canonical exact slices and semantic comparison

The canonical parent table includes the indexed columns in this exact slice
(`000001:2037-2065`):

```sql
-- Name: appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    customer_id uuid,
    salon_customer_id uuid,
    employee_id uuid,
    service_id uuid NOT NULL,
    series_id uuid,
    booking_group_id uuid,
    appointment_date date NOT NULL,
    start_time text NOT NULL,
    end_time text NOT NULL,
    duration_minutes integer NOT NULL,
    pre_processing_minutes integer DEFAULT 0 NOT NULL,
    processing_minutes integer DEFAULT 0 NOT NULL,
    post_processing_minutes integer DEFAULT 0 NOT NULL,
    buffer_minutes integer DEFAULT 0 NOT NULL,
    seat_count integer DEFAULT 1 NOT NULL,
    price integer NOT NULL,
    treatment_location text DEFAULT 'salon'::text NOT NULL,
    travel_fee integer DEFAULT 0 NOT NULL,
    treatment_address_line_1 text,
    treatment_address_city text,
    treatment_address_postal_code text,
    treatment_address_details text,
    status public.appointment_status DEFAULT 'pending'::public.appointment_status NOT NULL,
```

The exact canonical index candidate is (`000001:9755-9758`):

```sql
--
-- Name: appointments_employee_date_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_employee_date_status_idx ON public.appointments USING btree (employee_id, appointment_date, status);
```

**Semantic comparison, not names only:**

* Under the source owner's expected `public` search path, the source and
  canonical index agree on non-unique semantics, parent relation, btree
  method (implicit in source, explicit in canonical), and ordered keys:
  `employee_id`, `appointment_date`, `status`.
* The source includes `CONCURRENTLY`; the canonical index does not. The source
  owner deliberately opens no transaction because PostgreSQL concurrent index
  creation cannot run inside a transaction. Canonical `000001` is marked
  transactional, so an ordinary canonical index statement is not the same
  existing-database transition even where the final index shape matches.
* The source includes `IF NOT EXISTS`, which does not validate an existing
  index's key order, method, predicate, validity, or parent. A canonical name
  match proves neither a completed concurrent build nor absence of an invalid
  index left by interruption.
* The source omits a schema qualifier and does not set `search_path` in this
  owner. The public identity is therefore a crosswalk interpretation that
  depends on the actual session search path, not a literal in the selected
  SQL.

### Fresh versus existing, effects, and runtime protocol

**Fresh database facts.** On a fresh target with `appointments` and the
referenced columns present, the source builds the requested non-unique btree
index concurrently. The canonical migration creates the same final key shape
through a normal `CREATE INDEX`. The fresh final shape is comparable, but the
two execution modes still differ.

**Existing database facts and effects.** The selected operation does not update
application rows, but a concurrent build reads the relation and maintains the
index while writers continue. Whether the table is large, whether writes
continue, whether an index of this name already exists, whether it is valid,
whether another index is equivalent, and whether a failed build leaves an
invalid catalog entry are all unverified. The source's `IF NOT EXISTS` does not
repair any of those states.

### F5 correction — timeout, INVALID index, and a misleading successful retry

The conditional failure chain is **timeout → INVALID index → IF NOT EXISTS
skip**, not an observed production incident. Source
`marketplace-performance-schema.ts:17-23` applies session timeouts before the
concurrent build; `startup-ddl-safety.ts:3,21-23` sets both to `30s`.
A concurrent build uses multiple internal transactions. If cancellation by
statement timeout (or another build failure) happens after the index catalog
entry has been committed but before validation completes, an INVALID index
can remain. A timeout before that point need not leave an index. No database
was inspected to determine either outcome.

On the next reached startup attempt, the same index name can cause
`CREATE INDEX CONCURRENTLY IF NOT EXISTS` to skip creation. That clause does
not inspect or repair `pg_index.indisvalid`. Consequently, the query can return
without error while the intended usable index remains absent. If the later
index statements and cleanup also succeed, the owner can log “ready”
(`marketplace-performance-schema.ts:38`), and startup can advance toward
`index.ts:100` without proving this index is valid. The original failed attempt
still throws and blocks that attempt's startup; the risk is the later skip.

The advisory lock serializes participating builders, not index validation.
Unlocking/restoring timeouts or retrying does not remove the invalid catalog
entry. The source has no catalog-validity postcondition or repair branch.
An invalid index is not available to the query planner as the intended usable
index; residual maintenance overhead is also possible depending on build
phase. Recovery therefore needs separately reviewed identification of the
actual index and validity state and an approved rebuild/removal procedure,
not an assertion that `IF NOT EXISTS` is recovery. None is executed here.

Canonical ordinary `CREATE INDEX` inside the transactional baseline does not
have this same multi-transaction concurrent-build residue path: a failed
transaction normally rolls back its catalog changes. That comparison does not
prove actual rollback or production parity. CB5 remains FAILED — NOT SATISFIED;
CB4/CB6, FM3/FM6 and RH4 remain UNKNOWN — NOT SATISFIED with this explicit
postcondition/recovery gap, and the mapping remains UNRESOLVED.

**Execution condition, transaction, lock, and timeout facts.** The owner
invocation is unconditional when startup reaches the fourth awaited startup
owner. It first reads the current `lock_timeout` and `statement_timeout`,
applies both as session timeouts of `30s`, and takes numeric advisory lock
`0x4d500001`. The selected index is reached only after those setup steps
succeed. It opens no transaction. It executes four
`CREATE INDEX CONCURRENTLY` statements in source order, beginning with this
selected operation. In `finally` it attempts the advisory unlock, restores the
saved session timeouts, and releases the client. If the primary operation
failed, cleanup errors are suppressed by the existing `startupError` path; if
only cleanup fails, the cleanup error is thrown.

**Recovery and business decisions.** A failed concurrent build may require
inspection and explicit handling of an invalid index; retry and
`IF NOT EXISTS` are not a recovery procedure. The appropriate nontransactional
runner mode, timeout values, writer compatibility, catalog validation, and
recovery owner are not decided. Canonical `000001`'s transactional mode cannot
be used as proof that the startup concurrent transition is represented.

**Additional-operation dependency ID from `complete-evidence.json`:**

* `marketplace/advisory-lock-and-session-state` — status `UNRESOLVED`; its
  complete evidence records the session-timeout save/apply/restore, numeric
  advisory lock, no-transaction boundary, cleanup behavior, and unknown
  invalid-index recovery. It is separate operational evidence and does not
  resolve the index mapping.

### Marketplace gate matrix

| Gate | Disposition | Evidence and blocker |
|---|---|---|
| **CB1** — exact executable source, identifiers, order, owner, every occurrence | **PASSED** | One exact source string, source position, owner, call site, phase, source order `1`, and full occurrence data are recorded above. |
| **CB2** — canonical definition plus raw/normalized comparison | **PASSED** | The canonical parent columns/index slice and key-by-key method, uniqueness, and ordered-key comparison are recorded above. The generated `semanticsVerified: false` field is not used to fail this comparison; independent review is CB7. |
| **CB3** — semantic equivalence of types, defaults, constraints, dependencies | **UNKNOWN — NOT SATISFIED** | Key/method/uniqueness shape is comparable, but search path, index validity, and production dependency state are not proven. |
| **CB4** — fresh and reviewed existing-database transition equivalence | **UNKNOWN — NOT SATISFIED** | Fresh final shape is static; existing writers, index validity, interrupted builds, and concurrent transition behavior are unknown. |
| **CB5** — transaction, preconditions, postconditions, failure behavior, ordering | **FAILED — NOT SATISFIED** | Source is explicitly nontransactional with session-timeout restoration and concurrent builds; canonical is transactional ordinary `CREATE INDEX`, so the transition and recovery behavior differ. |
| **CB6** — production scope, invariants, dependent behavior | **UNKNOWN — NOT SATISFIED** | Production target, catalog validity, writer load, and application query behavior were not inspected. |
| **CB7** — independent reviewer confirms no open question | **UNKNOWN — NOT SATISFIED** | No independent reviewer disposition is recorded. |
| **FM1** — unresolved operation/delta specified | **PASSED** | The unresolved delta is the `CONCURRENTLY`/transaction/session/recovery transition despite comparable keys; this does not authorize a future migration. |
| **FM2** — unique manifest ID, immutable SQL, mode, checksum, dependencies, recovery | **UNKNOWN — NOT SATISFIED** | No future migration artifact or plan specifies nontransactional mode or invalid-index recovery. |
| **FM3** — separate fresh/existing transition proof | **UNKNOWN — NOT SATISFIED** | No proof covers concurrent writers, lock waits, retries, partial builds, or application compatibility. |
| **FM4** — read-only production preconditions | **UNKNOWN — NOT SATISFIED** | Production catalog and writer state were not inspected. |
| **FM5** — destructive/data/function decisions, owner, restore or compensation | **UNKNOWN — NOT SATISFIED** | No approved owner or compensating/recovery decision exists for invalid or partial indexes. |
| **FM6** — complete dependency/manifest ordering and recovery | **UNKNOWN — NOT SATISFIED** | Four-index ordering, runner mode, timeout restoration, advisory lock, and statement-by-statement recovery are not approved as a complete sequence. |
| **FM7** — independent review before artifact creation or execution | **UNKNOWN — NOT SATISFIED** | Independent approval is absent. |
| **RH1** — historical and unreachable on every path | **FAILED — NOT SATISFIED** | The owner is a current unconditional pre-listen call; this is counterevidence to historical unreachability. |
| **RH2** — replacement canonical and transition equivalence | **FAILED — NOT SATISFIED** | Canonical key shape exists, but ordinary transactional creation is explicit counterevidence to concurrent transition equivalence. |
| **RH3** — production replacement/schema/data/dependencies present | **UNKNOWN — NOT SATISFIED** | Production catalog and dependent behavior evidence are unavailable. |
| **RH4** — no pending backfill, cleanup, compatibility, or audit obligation | **UNKNOWN — NOT SATISFIED** | Invalid-index recovery, writer compatibility, and operational obligations remain open. |
| **RH5** — owner, release boundary, observability, rollback | **UNKNOWN — NOT SATISFIED** | No retirement boundary, observability decision, or rollback/recovery owner is recorded. |
| **RH6** — independent retirement review | **UNKNOWN — NOT SATISFIED** | Independent retirement review is absent. |

**Candidate recommendation (nonauthoritative; category: Insufficient evidence;
no status change):** retain this
marketplace fingerprint as `UNRESOLVED` until a reviewer separately verifies
the existing index catalog and concurrent-writer transition, then confirms a
nontransactional recovery and timeout/lock ownership decision.

---

## 4. Referral — `tracking_started_at` column addition

### Mapping identity and crosswalk facts

* **Fingerprint:** `a570f58ac2bc80fb8a0ee829d4b2c1aa66953b680261069bbbade8d1020c4ff1`
* **Operation kind:** `alter-table`
* **Crosswalk summary:** `alter table ${schema}.referral_qualifications add column if not exists tracking_started_at timestamptz`
* **Object identity:** `{ "kind": "table", "schema": "<dynamic>", "name": "referral_qualifications", "dynamicExpression": "${schema}.referral_qualifications" }`
* **Crosswalk existing-data effect:** `existing-schema-reconciliation`
* **Crosswalk status:** `UNRESOLVED`
* **Crosswalk dependencies:** `schema:<dynamic>`
* **Crosswalk preconditions:** all referenced parent objects and existing rows
  satisfy the reviewed operation semantics; the operation has been compared
  with the immutable canonical migration or an approved future migration.
* **Crosswalk postconditions:** the reviewed
  `table.<dynamic>.referral_qualifications` identity has the approved
  definition; existing production data is preserved or changed only by an
  explicitly reviewed backfill.
* **Crosswalk rollback consideration:** application rollback must remain
  compatible with the resulting catalog and data state.
* **Crosswalk canonical evidence:** migration `000001`, pinned checksum,
  `no-candidate-name-match`, no line references, `semanticsVerified: false`.
  The no-candidate result reflects the dynamic schema expression even though
  the canonical public table slice contains the same column name.

### Complete occurrence inventory

There is **one occurrence**. It is the fifth classified DDL operation in the
referral owner, after the two `orders` and two `retail_orders` column additions,
hence `executionOrder: 5`.

* **Owner:** `ensureReferralSchema`
* **Source locator:** `artifacts/api-server/src/lib/referral-schema.ts:20:25`
* **Source position:** `literalLine: 20`, `literalColumn: 24`,
  `operationLine: 20`, `operationColumn: 25`
* **Call site:** `artifacts/api-server/src/index.ts:88:7`
* **Phase:** `pre-listen`
* **Execution path, in source order:**
  `artifacts/api-server/src/index.ts` →
  `artifacts/api-server/src/lib/referral-schema.ts::ensureReferralSchema`
* **Exact source SQL:**

```sql
alter table ${schema}.referral_qualifications add column if not exists tracking_started_at timestamptz
```

* **Exact source SQL SHA-256:** `db0289f781a70024a76924134fea9a849ea83b699c8da66475802a0a436faebe`
* **No other occurrence** of this fingerprint is present in the selected
  crosswalk occurrence list.

### Canonical exact slices and semantic comparison

The canonical table slice is exactly (`000001:5645-5663`):

```sql
--
-- Name: referral_qualifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_qualifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    attribution_id uuid NOT NULL,
    referred_salon_id uuid,
    referred_education_center_id uuid,
    status public.referral_qualification_status DEFAULT 'pending_verification'::public.referral_qualification_status NOT NULL,
    required_evidence_count integer NOT NULL,
    tracking_started_at timestamp with time zone,
    qualified_at timestamp with time zone,
    hold_until timestamp with time zone,
    available_at timestamp with time zone,
    reversed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT referral_qualifications_target_business_check CHECK ((num_nonnulls(referred_salon_id, referred_education_center_id) <= 1))
);
```

The canonical attribution foreign key that is relevant to the selected table
and its coupled backfill is exactly (`000001:18560-18564`):

```sql
--
-- Name: referral_qualifications referral_qualifications_attribution_id_referral_attributions_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_qualifications
    ADD CONSTRAINT referral_qualifications_attribution_id_referral_attributions_id FOREIGN KEY (attribution_id) REFERENCES public.referral_attributions(id) ON DELETE RESTRICT;
```

**Semantic comparison, not names only:**

* `timestamptz` in the source is PostgreSQL's `timestamp with time zone`, and
  the source supplies no default or `NOT NULL`; the canonical column is also
  nullable with no default. For an existing table whose actual schema target
  is the intended schema, the column's direct type/nullability shape is
  comparable.
* The source is dynamic and unqualified beyond `${schema}`. The canonical
  table is explicitly `public`. The source `IF NOT EXISTS` does not compare
  an existing column's type, default, collation, ownership, or privileges.
* The canonical table slice includes the parent table's broader constraints
  and columns, but the selected source statement neither creates that table
  nor verifies those dependencies. A fresh canonical table would make this
  source statement a no-op; a fresh database without that table would make
  the source statement fail.
* The selected DDL does not itself populate timestamps. The owner immediately
  couples it to a separate `UPDATE` that derives timestamps from verification
  audits or falls back to `updated_at`; that business/data behavior is not
  represented by this column definition.

### Fresh versus existing, effects, and runtime protocol

**Fresh database facts.** If the target table is already present from the
canonical schema, `ADD COLUMN IF NOT EXISTS` is a no-op because the column is
already defined. If the target table is absent, `ALTER TABLE` fails; this
literal is not a table-creation operation. The source does not establish the
canonical table, attribution FK, or qualification check.

**Existing database facts and data effects.** Adding a nullable column without
a default creates null values for existing rows and does not directly update
them. If the column already exists with a different type or semantics, the
`IF NOT EXISTS` clause can conceal that drift. The separately recorded tracking
backfill then updates selected rows based on current referral attributions,
verification-audit JSON, statuses, channels, and timestamps. No production row
set, ambiguity count, audit completeness, or application compatibility was
inspected.

**Execution condition, transaction, lock, and timeout facts.** The owner
invocation is unconditional when startup reaches the fifth awaited startup
owner. It begins a transaction, sets local `lock_timeout` and
`statement_timeout` to `30s`, and acquires
`pg_advisory_lock(hashtext('lumera:referral-schema'))`. The selected column
addition is reached only after the four preceding referral column statements
succeed. It runs this statement fifth among the DDL literals, then later runs
the tracking `UPDATE` and enum `DO` literal before commit. On error it attempts
rollback; `finally` attempts unlock and client release, swallowing unlock
errors. The transaction boundary can pair the column addition and backfill,
but source cleanup behavior and existing-writer compatibility are not
independently proven.

**Recovery and business decisions.** A pre-commit failure is coded to trigger
rollback, but it is not a tested restore proof. The fallback from earliest
verified audit time to `q.updated_at`, the A/B1 channel scope, the
`pending_verification` exclusion, and treatment of unmatched or ambiguous
audit rows are business/data decisions, not consequences of adding a nullable
column. No decision establishes whether the backfill may be adopted, retained,
or removed.

**Additional-operation dependency IDs from `complete-evidence.json`:**

* `referral/tracking-start-backfill` — status `UNRESOLVED`; its complete
  evidence records the exact data mutation, source order after the additive
  columns, audit/fallback semantics, current-state dependence, and unknown
  restore policy.
* `referral/transaction-and-advisory-lock` — status `UNRESOLVED`; its complete
  evidence records the transaction, 30-second local timeout policy, advisory
  lock, rollback/unlock cleanup, and coupling to the referral statements.

These IDs are additional-operation dependencies, not extra DDL mappings in
this four-fingerprint pilot.

### Referral gate matrix

| Gate | Disposition | Evidence and blocker |
|---|---|---|
| **CB1** — exact executable source, identifiers, order, owner, every occurrence | **PASSED** | One exact interpolated column literal, source position, owner, call site, phase, order `5`, and occurrence count are recorded above. |
| **CB2** — canonical definition plus raw/normalized comparison | **PASSED** | The exact public table slice and type/nullability comparison are recorded above. The dynamic target is a CB3/CB4 issue, not a reason to fail this actual canonical comparison; independent review is CB7. |
| **CB3** — semantic equivalence of types, defaults, constraints, dependencies | **UNKNOWN — NOT SATISFIED** | Direct column shape is comparable, but existing drift, dynamic target, parent table/FK, privileges, and coupled backfill semantics are not proven equivalent. |
| **CB4** — fresh and reviewed existing-database transition equivalence | **UNKNOWN — NOT SATISFIED** | Fresh canonical-table no-op versus absent-table failure is known statically; existing catalog, rows, writers, and backfill state are unknown. |
| **CB5** — transaction, preconditions, postconditions, failure behavior, ordering | **FAILED — NOT SATISFIED** | The source transaction/30s timeout/advisory lock and paired update are not represented by the canonical column slice; the selected operation is coupled to a runtime data update and cleanup behavior absent from the canonical definition. |
| **CB6** — production scope, invariants, dependent behavior | **UNKNOWN — NOT SATISFIED** | Production schema argument, column definition, qualification rows, audit evidence, and dependent referral behavior were not inspected. |
| **CB7** — independent reviewer confirms no open question | **UNKNOWN — NOT SATISFIED** | No independent reviewer disposition is recorded. |
| **FM1** — unresolved operation/delta specified | **PASSED** | The unresolved delta is the dynamic additive transition coupled to a current-data timestamp policy; this does not authorize a future migration. |
| **FM2** — unique manifest ID, immutable SQL, mode, checksum, dependencies, recovery | **UNKNOWN — NOT SATISFIED** | No future migration artifact or plan specifies the column/backfill boundary or recovery. |
| **FM3** — separate fresh/existing transition proof | **UNKNOWN — NOT SATISFIED** | No proof covers absent tables, existing type drift, concurrent writers, audit ambiguity, or retry behavior. |
| **FM4** — read-only production preconditions | **UNKNOWN — NOT SATISFIED** | Production catalog, rows, audit linkage, and schema target were not inspected. |
| **FM5** — destructive/data/function decisions, owner, restore or compensation | **UNKNOWN — NOT SATISFIED** | The timestamp fallback and restore/compensation policy for the coupled backfill are not approved. |
| **FM6** — complete dependency/manifest ordering and recovery | **UNKNOWN — NOT SATISFIED** | Additive column order, tracking update, enum addition, FK/data dependencies, transaction, and cleanup recovery are not approved as a complete sequence. |
| **FM7** — independent review before artifact creation or execution | **UNKNOWN — NOT SATISFIED** | Independent approval is absent. |
| **RH1** — historical and unreachable on every path | **FAILED — NOT SATISFIED** | The referral owner is a current unconditional pre-listen call; this is counterevidence to historical unreachability. |
| **RH2** — replacement canonical and transition equivalence | **FAILED — NOT SATISFIED** | Canonical contains the nullable column, but its absence of the dynamic alter transition and tracking backfill is counterevidence to replacement transition equivalence. |
| **RH3** — production replacement/schema/data/dependencies present | **UNKNOWN — NOT SATISFIED** | Production evidence is unavailable. |
| **RH4** — no pending backfill, cleanup, compatibility, or audit obligation | **UNKNOWN — NOT SATISFIED** | The tracking backfill, audit completeness, fallback policy, and mixed-version obligations remain open. |
| **RH5** — owner, release boundary, observability, rollback | **UNKNOWN — NOT SATISFIED** | No retirement boundary, data audit, restore decision, or owner is recorded. |
| **RH6** — independent retirement review | **UNKNOWN — NOT SATISFIED** | Independent retirement review is absent. |

**Candidate recommendation (nonauthoritative; category: Insufficient evidence;
no status change):** retain this
referral fingerprint as `UNRESOLVED` until a reviewer verifies the dynamic
schema and existing column, then separately approves the tracking timestamp
data policy, audit/fallback behavior, and transaction/recovery boundary.

---

## Final pilot conclusion

The four selected mappings provide static source proof, full source SQL,
fingerprints, source positions, execution order, canonical line slices, and
semantic comparisons at the level available without production access. They do
not establish production representation, existing-data correctness,
idempotence, transition safety, migration-ledger adoption, retirement,
business authorization, or independent approval. The canonical object slices
are evidence of fresh-schema definitions only. All four mappings therefore
remain **`UNRESOLVED`**, and none of the four candidate recommendations is
authoritative or a migration plan.