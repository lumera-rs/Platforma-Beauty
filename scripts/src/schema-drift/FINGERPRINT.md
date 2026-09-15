# Schema catalog fingerprint

Run `pnpm --silent run schema-drift:fingerprint` to read the current development
PostgreSQL catalog and write one machine-readable JSON document to stdout.
A deterministic summary is written to stderr. Failures write only to stderr
and exit with status 2.

The command starts a `REPEATABLE READ, READ ONLY` transaction and routes every
catalog query through the schema-drift read-only query guard. It does not compare
baseline eligibility and does not write a manifest, ledger, migration, or
database row.

Legacy `schema-drift:audit` intentionally strips catalog-added casts while
comparing defaults and expressions (for example, an enum literal or `jsonb`
literal). That tolerance is scoped to audit normalization. Version-4
fingerprints retain casts and remain strict.

The fingerprint CLI accepts no eligibility arguments and has no imports from
the eligibility module. Read-only eligibility classification is exposed
separately as `schema-drift:eligibility`. It accepts no CLI arguments and reads
only the fixed repository-owned `baseline-manifest.json` beside its source.
The checked-in manifest intentionally has no approved entries, so there is
currently no approved LEGACY baseline and no live catalog can be classified as
`KNOWN_LEGACY` by the CLI. `eligibleForMetadataAdoption` is retained only as a
read-only classifier compatibility field; there is no executable
baseline-adoption path.

## Fingerprints

Both hashes use SHA-256 over a versioned, locale-neutral canonical UTF-8 JSON
payload:

Fingerprint result format 2 and fingerprint payload version 4 support
PostgreSQL 16. The result records the exact
`serverVersionNum`, the parsed major version, and deparser family
`postgresql-16-deparser-v1`. The deparser family is part of both hash payloads;
the patch version is visible metadata but does not by itself change the hashes.
Any unsupported major version, malformed version response, or missing
compatibility metadata fails closed before a fingerprint can be produced.
Adding support for another PostgreSQL major requires a reviewed deparser-format
identifier and updated golden catalog fixtures. Earlier payload digests are not
interpreted as version 4. The DDL fixture is not in the normal integration suite:
`test:schema-drift:golden-fixture` requires both
`SCHEMA_DRIFT_DISPOSABLE_DB=1` and a database name containing a `test` or
`disposable` token, and otherwise fails closed. It pins the same deparser
environment and checks ordered and empty enums, OLD/NEW conditional-trigger
semantics, a constraint trigger, trigger arguments, function-body sensitivity,
and trigger-name sensitivity. It must never run against the development DB.

- `structuralFingerprint` proves the semantic schema structure, including
  schema/table/column identity and column order, types, column collations,
  nullability, defaults, identity/generated modes and generated expressions,
  keys, foreign-key order/targets/actions and SET target columns, check
  inheritance behavior, and
  exclusion constraints, and complete index definitions. Constraint
  validation/deferrability/match/null
  semantics and ordinary or constraint-backed index key/include expressions,
  ordering, collations, opclasses, NULLS NOT DISTINCT, validity, and readiness
  are represented. PostgreSQL enum identities and label order, non-internal
  public-table trigger definitions, target function identity, arguments, and the
  pinned-deparser `pg_get_functiondef` function definition are also represented.
  Version 4 additionally models every non-system, non-extension-owned application
  function, window function, or procedure, including its identity signature, arguments, return
  semantics, language, execution properties, configuration, and canonical
  `pg_get_functiondef` output. This includes standalone routines that no trigger
  references.
  Physical constraint and index names are omitted. Trigger names remain
  structural because they control same-kind firing order and are exposed as
  `TG_NAME` to trigger functions.
- `physicalFingerprint` proves the same normalized structure and additionally
  includes physical primary-key, unique, foreign-key, check, exclusion, and
  index names.

Both payloads carry an explicit `payloadKind`, so even an empty schema has
domain-separated structural and physical digests. Both also include a sorted
unmodelled-object census for views, materialized views, foreign tables,
sequences, non-public application schemas, RLS state and policy definitions,
and installed extensions. These objects are detected and hashed, but are not
claimed to have full migration support.

Future migration metadata namespaces are tool-owned metadata, not application
schema identity. No such namespace exists today. P.2 must define an explicit,
reviewed catalog-ownership policy before creating one; it must not silently add
a tool-owned namespace to or remove one from the application census.

P.2 must also design and review, rather than inherit from the removed adoption
path: verified database identity (`current_database`, system identifier, and
expected environment), a dedicated adoption command, a repeatable-read write
transaction without all-table `ACCESS EXCLUSIVE` locking, migration-role
privilege separation, an immutable migration ledger, baseline as ledger row
zero, backup/restore-point evidence, the migration frontier, and convergence of
fresh and adopted databases.

The JSON result exposes both normalized payloads, enum/trigger/function counts,
and the unmodelled census for review and diffing.
Payload ordering is independent of input table, constraint, check, and index
ordering. Column positions and key/index column order remain meaningful.
Fingerprint transactions pin `search_path` to `pg_catalog` before invoking
PostgreSQL deparsers, force identifier quoting, and use standard-conforming
strings. Interval/date rendering, time zone, numeric/bytea rendering, and
locale-sensitive output settings are also pinned so role/session defaults
cannot change the payload.

## Ownership exceptions

Only exact registry matches that are present in the snapshot are excluded.
Each applied exception is returned in `ownershipExceptions` with
`handling: "EXCLUDED"`. Unknown extra objects remain in both payloads and
therefore affect both hashes. This is transparent catalog handling, not a
baseline eligibility decision. Eligibility fingerprints the live snapshot with
the same registry first, so a registered extension/bootstrap-owned table is
excluded. An unknown extra table is not excluded and prevents an exact match.
