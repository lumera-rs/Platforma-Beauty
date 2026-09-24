# Data-transfer integration and mutation evidence

The integration command ran in a clean CI-matching environment:

```sh
env -i HOME="$HOME" PATH="$PATH" CI=true NODE_ENV=test \
  pnpm --filter @workspace/scripts exec tsx --test \
  src/data-transfer-tests/transfer.integration.test.ts
```

Each test owns its PostgreSQL 16 cluster through `withOwnedPair`; it does not
accept an administrator URL or inherit database/provider credentials.
The non-empty canonical target and wrong-declared-identity cases execute
migrations 000001–000004 through the migration runner on both disposable
databases and call the real `transferData` application entry point.
The smaller synthetic cases explicitly use the shared transaction engine's
fixture adapter. They do not claim to exercise application readiness.

## Correct implementation

Actual output retained in `.local/data-transfer/testing/final-integration.log`;
the corresponding `.exit` file contains `0`:

```text
✔ transfer refuses a source-only column without changing the target (3799.275332ms)
✔ transfer refuses a target-only NOT NULL column without a default (3467.051739ms)
✔ transfer reports foreign-key violation counts and rolls back every loaded row (3441.528371ms)
✔ transfer refuses a non-empty target even when its schema is canonical (17276.957405ms)
✔ shared load transaction refuses a non-empty synthetic target (3362.735087ms)
✔ transfer refuses a wrong declared target identity before any write (15200.958047ms)
✔ transfer never reads the source ledger or writes the target ledger (3333.726302ms)
✔ shared load transaction suppresses synthetic INSERT trigger side effects and preserves source values (3448.959904ms)
✔ transfer explicitly verifies standalone unique indexes and exclusion constraints (3345.464108ms)
✔ standalone unique constraint rejection reports the observed row and rolls back (3224.422982ms)
✔ shared generated-column mismatch rolls back instead of silently recomputing data (3380.719671ms)
✔ target-only sequence default is blocked without advancing its sequence (3309.039891ms)
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 67108.112315
```

The generated-column test deliberately uses different generation expressions
in source and target, then checks content-mismatch refusal and zero surviving
target rows. The sequence test verifies both the empty destination and unchanged
`last_value`/`is_called`. The standalone unique violation count is the one
rejected row observed by PostgreSQL, not a count of unattempted later rows.

## Actual mutants

All four mutants were made in independent copies under
`.local/data-transfer/testing/final-mutants/`; tracked engine files were not
mutated. Each copy used the final integration test source and ran one named
test in the same clean environment. Each process exited `1` with the exact
summary `ℹ tests 1`, `ℹ pass 0`, `ℹ fail 1`. These were assertion failures,
not import, migration, or disposable-harness errors.

### Skip post-load constraint verification

The mutant removed the explicit post-load `verifyConstraints` call while
leaving pre-load verification and all other loading behavior intact.
Actual output from `final-mutant-skip-constraints.log`:

```text
✖ transfer reports foreign-key violation counts and rolls back every loaded row (3620.295277ms)
  AssertionError [ERR_ASSERTION]: constraint verification must reject a transferred orphan
```

### Copy the source migration ledger

The mutant selected source ledger receipts, deleted target ledger receipts,
and inserted source receipts into the target before commit.
Actual output from `final-mutant-copy-ledger.log`:

```text
✖ transfer never reads the source ledger or writes the target ledger (3807.530545ms)
  AssertionError [ERR_ASSERTION]: the source ledger must never be queried
```

### Accept a non-empty target

The mutant bypassed pristine-target admission and the subsequent reconciliation
refusal for existing rows. Actual output from `final-mutant-accept-nonempty.log`:

```text
✖ shared load transaction refuses a non-empty synthetic target (3336.600763ms)
  AssertionError [ERR_ASSERTION]: non-empty application targets must be refused
```

### Silently drop a source-only column

The mutant treated an unnamed source-only column as an approved drop.
Actual output from `final-mutant-drop-column.log`:

```text
✖ transfer refuses a source-only column without changing the target (3322.515963ms)
  AssertionError [ERR_ASSERTION]: a source-only column must never be silently dropped
```

These results cover the integration and mutation work only. Full CI job and
snapshot-proof outcomes are recorded separately and are not inferred from
these focused runs.