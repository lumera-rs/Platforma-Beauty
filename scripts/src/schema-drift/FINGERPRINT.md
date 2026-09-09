# Schema catalog fingerprint

Run `pnpm --silent run schema-drift:fingerprint` to read the current development
PostgreSQL catalog and write one machine-readable JSON document to stdout.
A deterministic summary is written to stderr. Failures write only to stderr
and exit with status 2.

The command starts a `REPEATABLE READ, READ ONLY` transaction and routes every
catalog query through the schema-drift read-only query guard. It does not compare
baseline eligibility and does not write a manifest, ledger, migration, or
database row.

Pass `--eligibility-manifest=path/to/manifest.json` to classify the same live
snapshot against a reviewed, versioned set of expected fingerprints. The command
still performs no database writes. Only an exact structural and physical match
to a `LEGACY` entry returns `eligibleForMetadataAdoption: true`.

Eligibility codes are explicit and fail closed:

- `FRESH_DATABASE`: no included application tables; adoption is unnecessary.
- `ALREADY_CURRENT`: exact match to a reviewed `CURRENT` entry.
- `KNOWN_LEGACY`: exact match to a reviewed `LEGACY` entry; the only eligible code.
- `PARTIAL_SCHEMA`: some expected Lumera tables exist but the expected set is incomplete.
- `WRONG_DATABASE`: no expected Lumera table identity overlaps the live snapshot.
- `UNEXPECTED_P0_P1_DRIFT`: the closest complete table set has unknown critical drift.
- `UNKNOWN_FINGERPRINT`: Lumera-shaped but not an approved exact fingerprint and
  without a P0/P1 finding from the legacy comparator.

Each expected entry pins the fingerprint format, algorithm, fingerprint version,
schema format, both digests, and its reviewed physical snapshot. Incompatible
versions, malformed hashes, duplicate IDs, and empty manifests are errors rather
than permissive fallbacks. Each digest pair is unique, cannot receive conflicting
`CURRENT`/`LEGACY` labels, and is recomputed from its reviewed physical snapshot
before classification. P0/P1 findings are returned for review but never authorize
adoption.

## Fingerprints

Both hashes use SHA-256 over a versioned, locale-neutral canonical UTF-8 JSON
payload:

Fingerprint result format 2 and fingerprint payload version 2 support
PostgreSQL 16. The result records the exact
`serverVersionNum`, the parsed major version, and deparser family
`postgresql-16-deparser-v1`. The deparser family is part of both hash payloads;
the patch version is visible metadata but does not by itself change the hashes.
Any unsupported major version, malformed version response, or missing
compatibility metadata fails closed before a fingerprint can be produced.
Adding support for another PostgreSQL major requires a reviewed deparser-format
identifier and updated golden catalog fixtures. The integration suite creates
its representative fixture inside a transaction and rolls it back after
verifying real server output for defaults, checks, expression/INCLUDE indexes,
NULLS NOT DISTINCT, and exclusion constraints.

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
  includes physical primary-key, unique, foreign-key, check, exclusion, and
  index names.

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
baseline eligibility decision. Eligibility fingerprints the live snapshot with
the same registry first, so a registered extension/bootstrap-owned table is
excluded. An unknown extra table is not excluded and prevents an exact match.
