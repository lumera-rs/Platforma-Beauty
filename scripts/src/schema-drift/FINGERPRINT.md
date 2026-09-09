# Schema catalog fingerprint

Run `pnpm --silent run schema-drift:fingerprint` to read the current development
PostgreSQL catalog and write one machine-readable JSON document to stdout.
A deterministic summary is written to stderr. Failures write only to stderr
and exit with status 2.

The command starts a `REPEATABLE READ, READ ONLY` transaction and routes every
catalog query through the schema-drift read-only query guard. It does not compare
baseline eligibility and does not write a manifest, ledger, migration, or
database row.

## Fingerprints

Both hashes use SHA-256 over a versioned, locale-neutral canonical UTF-8 JSON
payload:

- `structuralFingerprint` proves the semantic schema structure, including
  schema/table/column identity and column order, types, column collations,
  nullability, defaults, identity/generated modes and generated expressions,
  keys, foreign-key order/targets/actions and SET target columns, check
  inheritance behavior, and
  exclusion constraints, and complete index definitions. Constraint
  validation/deferrability/match/null
  semantics and ordinary or constraint-backed index key/include expressions,
  ordering, collations, opclasses, NULLS NOT DISTINCT, validity, and readiness
  are represented. Physical
  constraint and index names are omitted.
- `physicalFingerprint` proves the same normalized structure and additionally
  includes physical primary-key, unique, foreign-key, check, and index names.

The JSON result exposes both normalized payloads for review and diffing.
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
baseline eligibility decision.