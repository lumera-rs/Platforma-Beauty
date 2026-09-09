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
literal). That tolerance is scoped to audit normalization. Version-3
fingerprints retain casts and remain strict.

The fingerprint CLI accepts no eligibility or adoption arguments and has no
imports from those modules. Eligibility/adoption work from #925 remains isolated
behind `schema-drift:eligibility-adoption` and its own test commands. It is
**present but not part of #924 sign-off** and must receive independent review.

## Fingerprints

Both hashes use SHA-256 over a versioned, locale-neutral canonical UTF-8 JSON
payload:

Fingerprint result format 2 and fingerprint payload version 3 support
PostgreSQL 16. The result records the exact
`serverVersionNum`, the parsed major version, and deparser family
`postgresql-16-deparser-v1`. The deparser family is part of both hash payloads;
the patch version is visible metadata but does not by itself change the hashes.
Any unsupported major version, malformed version response, or missing
compatibility metadata fails closed before a fingerprint can be produced.
Adding support for another PostgreSQL major requires a reviewed deparser-format
identifier and updated golden catalog fixtures. Version-2 digests are not
interpreted as version 3. The DDL fixture is not in the normal integration suite:
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

The JSON result exposes both normalized payloads, enum/trigger counts, and the
unmodelled census for review and diffing.
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
