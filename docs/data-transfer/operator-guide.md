# Data-transfer tool

This task proves the tool on owned disposable PostgreSQL 16 only. It does not
authorize a development/production connection or the phase-8 move.

## Admission and execution

`scripts/src/data-transfer/cli.ts` requires explicit `--source-url=...` and
`--target-url=...`; ambient URLs are not selected. Declare target identity with
the existing `--expected-database`, `--expected-system-identifier`, and
`--expected-transport` flags. The existing optional Neon identity flags remain
paired and independently declared; none were used in this proof.

The expected identity must come from independently approved information, not
be inferred from the candidate target connection. The disposable fixture's
creation-time identity is test evidence, not operator authorization.

The source connection is read-only and every transfer read shares one
REPEATABLE READ snapshot. Target identity/readiness is checked before writes.
Target table locks protect pristine-target admission and the entire load.
The target must have exactly the migration-owned seed contract, with its own
identity-bound four-row migration ledger. The source ledger is excluded before
column discovery or row reads. No ledger row is written by transfer.

The entire load, trigger suppression, constraint verification and sequence
restart occur in one target transaction. A refusal or failure rolls back.
Ordinary user triggers and FK triggers are suppressed using transaction-local
replica mode; ALWAYS/REPLICA user triggers are refused. All FK, CHECK, UNIQUE,
primary-key, standalone unique-index and exclusion constraints are explicitly
checked before commit. Unsupported constraint semantics fail closed.
Constraint reports name each observed violation and its count; a constraint
enforced during INSERT can report only the actually rejected row, not unseen
later rows.

After loading, every table's shared-column count and hash must match its source.
Rows sort by primary key where one exists. For the eight canonical tables
without primary keys, deterministic full-row multiset ordering preserves
duplicates. Stored generated columns are recomputed, excluded from INSERT, and
included in verification. No schema or primary key is invented.

Sequences advance using transactional `ALTER SEQUENCE RESTART`, not
nontransactional `setval`. Unsupported descending/exhausted sequence cases
refuse. Readiness and structural/physical fingerprints are checked after
commit as well as before. A post-commit verification failure is explicitly
reported as post-commit; it cannot retrospectively undo an already committed
transaction.

## Explicit policy only

An optional `--policy-file=...` accepts JSON with:

- `excludeTables`: fully qualified table names.
- `dropColumns`: fully qualified `public.table.column` names for source-only
  columns.
- `casts`: keys naming `public.table.column` and values naming exact reviewed
  type transitions.

The default is no exclusions, no dropped columns and no casts. The migration
ledger is always prohibited; it is not an optional user exclusion. Unknown,
misnamed or inapplicable policy entries fail closed.

Only lossless integer widening is currently accepted: `smallint->integer`,
`smallint->bigint`, and `integer->bigint`. Floating-point conversions and other
arbitrary casts are not allowed. Raw `json` transport is refused because JSONB
transport cannot preserve its lexical representation; `jsonb` uses its native
canonical representation.

A target-only nullable column takes its default, including NULL when no
default is declared. A target-only NOT NULL column without a default blocks.
A source-only column blocks unless it is explicitly named in `dropColumns`.
No policy file is supplied for the snapshot proof.

Seed differences block with `SEED_RECONCILIATION_REQUIRED`; this version offers
no overwrite, upsert, delete, or implicit identity remapping to resolve them.
Owner decisions must precede any future approved reconciliation design.
Excluding pending outbox/session/demo/history tables is also a business
decision, never a default technical choice.

## Output and external effects

Reports expose relation/column/constraint names, statuses, counts and hashes,
not row payloads, personal data or connection strings. Operational errors are
sanitized. Private disposable setup diagnostics remain local.

The tool starts no application process or delivery worker and calls no
mail/SMS/provider API. It copies database references to external objects, not
the objects themselves. Blob migration, provider configuration, credential
provisioning, pending-message replay policy and storage ownership must be
approved separately. Trigger suppression during load does not make later
delivery-worker activation safe without those decisions.

See [inventory.md](./inventory.md) for every table, trigger, function and
owner decision, and [proof.md](./proof.md) for actual result quotations and
complete per-table proof artifacts.